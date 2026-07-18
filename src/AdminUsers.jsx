// Users panel — admin-only roster management.
//
// Reads through admin_list_users() (definer function; returns nothing to a
// non-admin) and writes straight to sp_user_map, where the admin UPDATE policy
// applies. The last-admin guard lives in a database trigger, so the warning
// below is a courtesy — the real refusal comes from Postgres.

import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";

const SP_OPTIONS = ["Alan", "Dino", "Khen", "Sakinah", "Simon", "Seed Malaysia"];

const Card = ({children, style}) => (
  <div style={{background:"rgba(var(--tint),0.02)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:14,padding:20,marginBottom:20,...style}}>
    {children}
  </div>
);

const thStyle = {
  textAlign: "left", padding: "10px 14px", fontSize: 10, fontWeight: 600,
  letterSpacing: 1, color: "rgba(var(--tint),0.45)",
  borderBottom: "1px solid rgba(var(--tint),0.06)", textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 14px", borderBottom: "1px solid rgba(var(--tint),0.04)",
  verticalAlign: "middle",
};

const selectStyle = {
  background:"rgba(var(--tint),0.04)", border:"1px solid rgba(var(--tint),0.1)",
  color:"var(--text)", borderRadius:6, padding:"5px 8px", fontSize:11,
  fontFamily:"'DM Sans',sans-serif", cursor:"pointer",
};

export default function AdminUsers({ user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      setRows(data || []);
      setError(null);
    } catch (e) {
      setError(`Could not load users: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const patch = async (row, changes, describe) => {
    setBusyId(row.user_id);
    setError(null);
    setNotice(null);
    try {
      const { error } = await supabase
        .from("sp_user_map")
        .update(changes)
        .eq("user_id", row.user_id);
      if (error) throw error;
      setNotice(describe);
      await refresh();
    } catch (e) {
      // The last-admin trigger surfaces here as a plain Postgres exception.
      setError(e.message || String(e));
      setBusyId(null);
      return;
    }
    setBusyId(null);
  };

  const onToggleAdmin = (row) => {
    const next = !row.is_admin;
    const isSelf = row.email?.toLowerCase() === user?.email?.toLowerCase();
    if (!next && isSelf) {
      if (!confirm("Remove admin from your OWN account? You will lose file management and this panel immediately.")) return;
    }
    patch(
      row,
      { is_admin: next },
      next
        ? `${row.email} is now an admin — they can manage uploaded files and users.`
        : `${row.email} is now a regular user — no file management or user admin.`
    );
  };

  // The correction: everyone sees all data by default; this is how an admin
  // restricts one person to their own rep's rows.
  const onToggleViewAll = (row) => {
    if (row.is_admin) return; // admins always see everything
    const next = !row.can_view_all;
    patch(
      row,
      { can_view_all: next },
      next
        ? `${row.email} can now see every salesperson's data.`
        : `${row.email} is now restricted to their own data (${row.sp}).`
    );
  };

  const onChangeSp = (row, sp) => {
    if (sp === row.sp) return;
    patch(row, { sp }, `${row.email} is now mapped to ${sp}.`);
  };

  const adminCount = rows.filter(r => r.is_admin).length;

  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>
          👤 Users
          <span style={{color:"rgba(var(--tint),0.4)",fontWeight:400,fontSize:12}}> · {rows.length} account{rows.length===1?"":"s"} · {adminCount} admin{adminCount===1?"":"s"}</span>
        </div>
        <button onClick={refresh} style={{background:"transparent",border:"1px solid #3B82F655",color:"#3B82F6",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>↻ Refresh</button>
      </div>

      <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",marginBottom:14,lineHeight:1.6}}>
        Everyone signed in sees <strong>all</strong> sales data by default. Set <strong>Data access</strong> to
        <span style={{color:"#F59E0B"}}> Own only</span> to restrict a user to just their own salesperson's rows.
        <strong> Admin</strong> adds management of uploaded files (the Data tab) and this panel — uploaded files are never visible to regular users.
        New accounts come from <code style={{fontFamily:"'Space Mono',monospace",fontSize:11}}>scripts/seed_users.py</code>; they appear here once seeded.
      </div>

      {error && (
        <div style={{marginBottom:14,padding:"10px 14px",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:8,fontSize:12,color:"#F87171"}}>
          ⚠ {error}
        </div>
      )}
      {notice && (
        <div style={{marginBottom:14,padding:"10px 14px",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.25)",borderRadius:8,fontSize:12,color:"#34D399",display:"flex",justifyContent:"space-between",gap:10}}>
          <span>✓ {notice}</span>
          <button onClick={() => setNotice(null)} style={{background:"transparent",border:"none",color:"#34D399",cursor:"pointer",fontSize:13}}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{fontSize:12,color:"rgba(var(--tint),0.4)",padding:"20px 0",textAlign:"center"}}>Loading users…</div>
      ) : !rows.length ? (
        <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",padding:"20px 0",textAlign:"center"}}>
          No users found. Run <code style={{fontFamily:"'Space Mono',monospace"}}>scripts/seed_users.py</code> to create accounts.
        </div>
      ) : (
        <div style={{overflowX:"auto",border:"1px solid rgba(var(--tint),0.06)",borderRadius:10}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"rgba(var(--tint),0.03)"}}>
                <th style={thStyle}>Account</th>
                <th style={thStyle}>Salesperson</th>
                <th style={thStyle}>Data access</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isSelf = row.email?.toLowerCase() === user?.email?.toLowerCase();
                return (
                  <tr key={row.user_id}>
                    <td style={tdStyle}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{
                          width:24,height:24,borderRadius:"50%",flexShrink:0,
                          background: row.is_admin ? "linear-gradient(135deg,#E8633B,#F59E0B)" : "#3B82F6",
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:10,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#fff",
                        }}>{(row.sp || "?")[0]?.toUpperCase()}</div>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis"}}>
                            {row.email}
                            {isSelf && <span style={{color:"rgba(var(--tint),0.4)",fontWeight:400}}> (you)</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={row.sp || ""}
                        disabled={busyId === row.user_id}
                        onChange={(e) => onChangeSp(row, e.target.value)}
                        style={selectStyle}>
                        {!SP_OPTIONS.includes(row.sp) && row.sp && <option value={row.sp}>{row.sp}</option>}
                        {SP_OPTIONS.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      {row.is_admin ? (
                        <span style={{fontSize:11,color:"rgba(var(--tint),0.5)"}}>All teams (admin)</span>
                      ) : (
                        <button
                          onClick={() => onToggleViewAll(row)}
                          disabled={busyId === row.user_id}
                          title={row.can_view_all ? "Restrict this user to their own data" : "Let this user see all teams"}
                          style={{
                            background: row.can_view_all ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
                            border: `1px solid ${row.can_view_all ? "#34D39955" : "#F59E0B55"}`,
                            color: row.can_view_all ? "#34D399" : "#F59E0B",
                            borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:600,
                            cursor: busyId === row.user_id ? "wait" : "pointer",
                            fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
                          }}>
                          {row.can_view_all ? "🌐 All teams" : "🔒 Own only"}
                        </button>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => onToggleAdmin(row)}
                        disabled={busyId === row.user_id}
                        title={row.is_admin ? "Demote to regular user" : "Promote to admin"}
                        style={{
                          background: row.is_admin ? "rgba(232,99,59,0.12)" : "rgba(var(--tint),0.04)",
                          border: `1px solid ${row.is_admin ? "#E8633B55" : "rgba(var(--tint),0.1)"}`,
                          color: row.is_admin ? "#E8633B" : "rgba(var(--tint),0.6)",
                          borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:600,
                          cursor: busyId === row.user_id ? "wait" : "pointer",
                          fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
                        }}>
                        {row.is_admin ? "★ Admin" : "Regular user"}
                      </button>
                    </td>
                    <td style={{...tdStyle,fontFamily:"'Space Mono',monospace",fontSize:11,color:"rgba(var(--tint),0.55)",whiteSpace:"nowrap"}}>
                      {row.last_sign_in_at
                        ? new Date(row.last_sign_in_at).toLocaleString("en-MY", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
                        : "never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{marginTop:12,fontSize:11,color:"rgba(var(--tint),0.4)",lineHeight:1.6}}>
        The database refuses to remove the last admin, so the dashboard can never be locked out of its own controls.
      </div>
    </Card>
  );
}
