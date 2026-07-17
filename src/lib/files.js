// Backend-backed file store for uploaded workbooks.
//
// Replaces the old localStorage registry. Files live in the private
// 'data-files' storage bucket, with a row in public.data_files carrying the
// parsed rows and the visibility flag. Every rule here is also enforced by RLS
// (see 0007_file_acl_and_admin.sql) — the UI checks below are for a decent
// experience, not for security. A user who forges a request still gets nothing
// back, because the database, not the browser, decides what is visible.

import { supabase } from "./supabase.js";
import { aggregate } from "./parseXlsx.js";

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
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(`Saving ${file.name} failed: ${error.message}`);
  }
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
