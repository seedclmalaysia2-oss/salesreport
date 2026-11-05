// Saving and loading contracts. A thin layer over Supabase so the tab can be
// exercised with a stub store, and so a database that hasn't had migration 0024
// applied yet produces a plain "run the migration" notice instead of a crash.

import { supabase } from "./supabase.js";

const MISSING = "The contracts tables aren't set up yet. Run migration 0024_sales_contracts.sql in Supabase Studio, then reload.";

// 42P01 = undefined table (Postgres); PGRST205 = table not in PostgREST's schema cache.
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "PGRST205" || /relation .* does not exist|schema cache/i.test(e?.message || "");

function explain(error) {
  if (isMissingTable(error)) return { setup: true, message: MISSING };
  if (error?.code === "42501" || /row-level security|permission denied/i.test(error?.message || "")) {
    return { message: "You don't have permission to save contracts. Ask an admin to give you upload access." };
  }
  return { message: error?.message || "Something went wrong talking to the database." };
}

const toRecord = (row) => ({
  id: row.id,
  title: row.title,
  kind: row.kind,
  baseYear: row.base_year,
  contractYear: row.contract_year,
  status: row.status,
  updatedAt: row.updated_at,
  payload: row.payload || {},
});

export const supabaseStore = {
  async list() {
    const { data, error } = await supabase
      .from("sales_contracts")
      .select("id,title,kind,base_year,contract_year,status,payload,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw explain(error);
    return (data || []).map(toRecord);
  },

  // Insert when there is no id, otherwise update. Returns the saved record.
  async save(c) {
    const row = {
      title: c.title,
      kind: c.kind,
      base_year: c.baseYear,
      contract_year: c.contractYear,
      status: c.status || "draft",
      payload: c.payload,
      updated_at: new Date().toISOString(),
    };
    const q = c.id
      ? supabase.from("sales_contracts").update(row).eq("id", c.id)
      : supabase.from("sales_contracts").insert(row);
    const { data, error } = await q.select("id,title,kind,base_year,contract_year,status,payload,updated_at").single();
    if (error) throw explain(error);
    return toRecord(data);
  },

  async remove(id) {
    const { error } = await supabase.from("sales_contracts").delete().eq("id", id);
    if (error) throw explain(error);
  },

  async getTemplate() {
    const { data, error } = await supabase.from("contract_templates").select("clauses,source_file").eq("key", "default").maybeSingle();
    if (error) throw explain(error);
    return data ? { clauses: data.clauses, source: data.source_file } : null;
  },

  async saveTemplate({ clauses, source }) {
    const { error } = await supabase
      .from("contract_templates")
      .upsert({ key: "default", clauses, source_file: source || null, updated_at: new Date().toISOString() });
    if (error) throw explain(error);
  },
};
