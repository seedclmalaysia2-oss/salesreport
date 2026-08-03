// Backend-backed file store for uploaded workbooks.
//
// Replaces the old localStorage registry. Files live in the private
// 'data-files' storage bucket, with a row in public.data_files carrying the
// parsed rows and the visibility flag. Every rule here is also enforced by RLS
// (see 0007_file_acl_and_admin.sql) — the UI checks below are for a decent
// experience, not for security. A user who forges a request still gets nothing
// back, because the database, not the browser, decides what is visible.

import { supabase } from "./supabase.js";
import { aggregate, parseFile } from "./parseXlsx.js";

const BUCKET = "data-files";

export const VISIBILITY = {
  PRIVATE: "private", // admins only
  SP: "sp", // only the reps in allowed_sps
  SHARED: "shared", // every signed-in user
};

export const VISIBILITY_LABELS = {
  private: "Private",
  sp: "Team only",
  shared: "Everyone",
};

export const VISIBILITY_HELP = {
  private: "Only admins can see or download this file.",
  sp: "Visible to the reps listed, plus admins.",
  shared: "Visible to every signed-in user.",
};

function rowToEntry(r) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    sp: r.sp,
    year: r.year,
    rowCount: r.row_count ?? 0,
    sizeBytes: Number(r.size_bytes ?? 0),
    storagePath: r.storage_path,
    visibility: r.visibility,
    allowedSps: r.allowed_sps ?? [],
    rows: r.rows_json ?? null,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at ? new Date(r.uploaded_at).getTime() : null,
    deletedAt: r.deleted_at ? new Date(r.deleted_at).getTime() : null,
  };
}

// Non-admins never receive trashed rows (RLS filters them), so the trash view
// is naturally admin-only without a second query.
export async function listFiles() {
  const { data, error } = await supabase
    .from("data_files")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToEntry);
}

function storagePathFor(file) {
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const unique =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `uploads/${unique}-${safe}`;
}

// Uploads bytes first, then the metadata row. If the row insert fails we remove
// the orphaned object — otherwise the bucket slowly fills with blobs that no
// data_files row points at, which are invisible to every policy and can only be
// cleaned up with the service_role key.
export async function uploadFile(file, parsed, { visibility = VISIBILITY.PRIVATE } = {}) {
  const path = storagePathFor(file);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (upErr) throw new Error(`Upload failed for ${file.name}: ${upErr.message}`);

  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id ?? null;

  const row = {
    name: parsed.file || file.name,
    kind: parsed.kind,
    sp: parsed.sp ?? null,
    year: parsed.year ?? null,
    row_count: parsed.rowCount ?? 0,
    size_bytes: file.size ?? 0,
    storage_path: path,
    visibility,
    // A workbook is named for exactly one rep, so scoping it to that rep is
    // the only sensible meaning of 'sp'.
    allowed_sps: parsed.sp ? [parsed.sp] : [],
    rows_json: parsed.rows ?? null,
    uploaded_by: uid,
  };

  const { data, error } = await supabase
    .from("data_files")
    .insert(row)
    .select()
    .single();

  if (error) {
    // Roll the storage object back so the bucket doesn't fill with orphans
    // that no data_files row points at. Then surface a specific message for
    // the check-constraint failure so the admin knows a migration is missing
    // instead of blaming the file.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    const isKindCheck =
      /data_files_kind_check|violates check constraint.*kind/i.test(error.message || "");
    if (isKindCheck) {
      throw new Error(
        `Saving ${file.name} failed: the database is on an older migration that only allows kind='customer' or 'brand'. ` +
        `Apply supabase/migrations/0009_add_invoice_kind.sql in the SQL Editor, then try the upload again.`
      );
    }
    throw new Error(`Saving ${file.name} failed: ${error.message}`);
  }

  // Same-name re-upload = REPLACEMENT. Soft-delete any older active copy of this
  // filename so the library never shows two — and, critically for invoice files,
  // so the weekly sync folds only the newest export. Without this a re-uploaded
  // "Stock Sales Analysis - Detail <month>.xlsx" left the prior copy live, and
  // dedupeInvoiceUnits kept invoices the revision had removed, so a downward
  // correction never reached the weekly board. Non-fatal: the new row is already
  // saved, so a supersede hiccup just leaves a duplicate to tidy on the Data tab.
  const { error: supErr } = await supabase
    .from("data_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("name", row.name)
    .is("deleted_at", null)
    .neq("id", data.id);
  if (supErr) console.warn(`Could not supersede prior copies of ${row.name}:`, supErr.message);

  return rowToEntry(data);
}

// Replaces the bytes + parsed rows of an existing entry, keeping its id and
// visibility. The old object is removed after the row points at the new one.
export async function replaceFile(entry, file, parsed) {
  const path = storagePathFor(file);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (upErr) throw new Error(`Upload failed for ${file.name}: ${upErr.message}`);

  const { data, error } = await supabase
    .from("data_files")
    .update({
      name: parsed.file || file.name,
      kind: parsed.kind,
      sp: parsed.sp ?? null,
      year: parsed.year ?? null,
      row_count: parsed.rowCount ?? 0,
      size_bytes: file.size ?? 0,
      storage_path: path,
      allowed_sps: parsed.sp ? [parsed.sp] : entry.allowedSps ?? [],
      rows_json: parsed.rows ?? null,
      uploaded_at: new Date().toISOString(),
      deleted_at: null,
    })
    .eq("id", entry.id)
    .select()
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(`Update failed: ${error.message}`);
  }
  if (entry.storagePath && entry.storagePath !== path) {
    await supabase.storage.from(BUCKET).remove([entry.storagePath]).catch(() => {});
  }
  return rowToEntry(data);
}

export async function setVisibility(entry, visibility, allowedSps) {
  const patch = { visibility };
  if (Array.isArray(allowedSps)) patch.allowed_sps = allowedSps;
  const { data, error } = await supabase
    .from("data_files")
    .update(patch)
    .eq("id", entry.id)
    .select()
    .single();
  if (error) throw new Error(`Could not change visibility: ${error.message}`);
  return rowToEntry(data);
}

export async function softDeleteFile(entry) {
  const { data, error } = await supabase
    .from("data_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", entry.id)
    .select()
    .single();
  if (error) throw new Error(`Could not trash file: ${error.message}`);
  return rowToEntry(data);
}

export async function restoreFile(entry) {
  const { data, error } = await supabase
    .from("data_files")
    .update({ deleted_at: null })
    .eq("id", entry.id)
    .select()
    .single();
  if (error) throw new Error(`Could not restore file: ${error.message}`);
  return rowToEntry(data);
}

export async function purgeFile(entry) {
  if (entry.storagePath) {
    await supabase.storage.from(BUCKET).remove([entry.storagePath]).catch(() => {});
  }
  const { error } = await supabase.from("data_files").delete().eq("id", entry.id);
  if (error) throw new Error(`Could not delete file: ${error.message}`);
}

// Signed URL rather than a public one: the bucket is private, and the signature
// is only minted if the caller passes the storage read policy.
export async function downloadUrl(entry) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(entry.storagePath, 60, { download: entry.name });
  if (error) throw new Error(`Could not prepare download: ${error.message}`);
  return data.signedUrl;
}

// Re-parse an archived workbook straight from the storage bucket and write the
// freshly-parsed rows back into data_files.rows_json. This is the recovery
// path for entries that were uploaded before rows_json existed (or that got
// stored as null for any other reason) — the file bytes are still in the
// bucket, we just missed capturing the parsed data at upload time.
export async function reprocessFile(entry) {
  if (!entry?.storagePath) throw new Error("No storage path on this entry");
  const { data: signed, error: urlErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(entry.storagePath, 120);
  if (urlErr) throw new Error(`Signed URL failed: ${urlErr.message}`);
  const resp = await fetch(signed.signedUrl);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const blob = await resp.blob();
  const file = new File([blob], entry.name, {
    type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const parsed = await parseFile(file);
  if (!parsed.ok) throw new Error(`Parse failed: ${parsed.error}`);

  // Update the registry row so the parsed rows are available for the sync
  // helpers on the next read. Keep the size/name/etc. as-is — reprocess is
  // strictly about (re)filling rows_json and the derived row_count.
  const { data, error } = await supabase
    .from("data_files")
    .update({
      rows_json: parsed.rows ?? [],
      row_count: parsed.rowCount ?? (parsed.rows?.length ?? 0),
      // Also normalise sp/year if the older row was missing them (invoice
      // files have no sp; leave those alone).
      sp:   parsed.sp   ?? entry.sp,
      year: parsed.year ?? entry.year,
      kind: parsed.kind ?? entry.kind,
    })
    .eq("id", entry.id)
    .select()
    .single();
  if (error) throw new Error(`Update failed: ${error.message}`);
  return { entry: rowToEntry(data), parsed };
}

// Reprocess every live file, one at a time. Reports per-file progress so the
// caller can render a checklist. Errors are captured per-file rather than
// aborting the batch, so a single stubborn workbook doesn't block the rest.
export async function reprocessAllFiles(files, onProgress) {
  const active = (files || []).filter((f) => !f.deletedAt);
  const updated = [];
  const errors = [];
  let i = 0;
  for (const f of active) {
    try {
      onProgress?.({ index: i, total: active.length, name: f.name, kind: f.kind });
    } catch {}
    try {
      const { entry } = await reprocessFile(f);
      updated.push(entry);
    } catch (e) {
      errors.push(`${f.name}: ${e.message || e}`);
      updated.push(f); // keep the old entry in the returned list
    }
    i += 1;
  }
  return {
    total: active.length,
    reprocessed: updated.length - errors.length,
    errors,
    files: updated,
  };
}

// Rebuild dashboard aggregates from whatever files this user is allowed to see.
// Returns null when there is nothing visible, so callers fall back to the
// server tables rather than rendering an empty dashboard.
export function recomputeFromFiles(files) {
  const active = files.filter((f) => !f.deletedAt && Array.isArray(f.rows));
  if (!active.length) return null;
  const customerRows = [];
  const brandRows = [];
  for (const f of active) {
    if (f.kind === "customer") customerRows.push(...f.rows);
    else if (f.kind === "brand") brandRows.push(...f.rows);
  }
  if (!customerRows.length && !brandRows.length) return null;
  return aggregate(customerRows, brandRows);
}
