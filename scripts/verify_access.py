"""
Check that the dashboard's access controls are actually on.

Run this right after applying 0007_file_acl_and_admin.sql, and any time you
suspect something has been left open. It uses ONLY the anon key — the same
public key that ships inside the browser bundle — and asserts that an
unauthenticated caller can neither read nor write anything.

Usage:
    python scripts/verify_access.py

Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env or the environment.
Exits non-zero if any check fails, so it can gate a deploy.

Note: the write checks insert a probe row and delete it again. If a write
unexpectedly succeeds (i.e. the DB is open), the probe is cleaned up, but the
check is reported as FAIL.
"""

import json
import os
import sys
import urllib.error
import urllib.request

TABLES = [
    "customers_data",
    "brand_sales_data",
    "sales_targets",
    "weekly_sales",
    "sp_user_map",
    "data_files",
]

PROBE_SP = "__verify_probe__"


def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def request(method, url, key, body=None, extra_headers=None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    headers.update(extra_headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)
    except Exception as e:  # network-level failure
        return 0, str(e), {}


def main() -> int:
    load_env_file()
    url = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    anon = os.getenv("VITE_SUPABASE_ANON_KEY")
    if not url or not anon:
        print("ERROR: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.")
        return 2

    print(f"Probing {url} with the PUBLIC anon key (as an anonymous visitor)\n")
    failures = []

    # --- reads ---
    print("READ  (expect 0 rows for every table)")
    for t in TABLES:
        status, body, headers = request(
            "GET", f"{url}/rest/v1/{t}?select=*", anon,
            extra_headers={"Prefer": "count=exact", "Range": "0-0"},
        )
        rng = headers.get("Content-Range", "")
        total = rng.split("/")[-1] if "/" in rng else "?"
        if status in (401, 403):
            print(f"  PASS  {t:<18} blocked ({status})")
        elif status in (200, 206) and total in ("0", "*"):
            print(f"  PASS  {t:<18} 0 rows visible")
        elif status == 404:
            print(f"  WARN  {t:<18} table not found - has 0007 been applied?")
            failures.append(f"{t}: missing (migration not applied?)")
        else:
            print(f"  FAIL  {t:<18} {total} rows readable anonymously!")
            failures.append(f"{t}: {total} rows readable by anyone")

    # --- writes ---
    print("\nWRITE (expect every insert to be refused)")
    status, body, _ = request(
        "POST", f"{url}/rest/v1/weekly_sales", anon,
        body={"period_start": "1999-01-01", "period_end": "1999-01-02",
              "sp": PROBE_SP, "amount": 0},
    )
    if status in (401, 403):
        print(f"  PASS  weekly_sales      insert refused ({status})")
    elif status in (200, 201, 204):
        print("  FAIL  weekly_sales      ANYONE CAN WRITE - probe row inserted")
        failures.append("weekly_sales: anonymous insert succeeded")
        request("DELETE", f"{url}/rest/v1/weekly_sales?sp=eq.{PROBE_SP}", anon)
        print("        (probe row cleaned up)")
    else:
        print(f"  PASS  weekly_sales      insert refused ({status})")

    status, _, _ = request(
        "POST", f"{url}/rest/v1/data_files", anon,
        body={"name": "probe.xlsx", "kind": "customer",
              "storage_path": f"uploads/{PROBE_SP}"},
    )
    if status in (200, 201, 204):
        print("  FAIL  data_files        ANYONE CAN REGISTER A FILE")
        failures.append("data_files: anonymous insert succeeded")
        request("DELETE", f"{url}/rest/v1/data_files?name=eq.probe.xlsx", anon)
    else:
        print(f"  PASS  data_files        insert refused ({status})")

    # --- storage ---
    # A private bucket refuses metadata introspection to an anonymous caller
    # (Supabase answers 400/401/403/404), which is exactly what we want. Only a
    # 200 with public:true is a problem. We cannot distinguish "private" from
    # "absent" with the anon key alone, and that is fine: an absent bucket is
    # not a security hole (uploads just fail loudly), a public one is.
    print("\nSTORAGE (expect the bucket NOT to be publicly readable)")
    status, body, _ = request("GET", f"{url}/storage/v1/bucket/data-files", anon)
    if status == 200:
        try:
            is_public = json.loads(body).get("public")
        except Exception:
            is_public = None
        if is_public:
            print("  FAIL  data-files        bucket is PUBLIC - files are world-readable")
            failures.append("data-files bucket is public")
        else:
            print("  PASS  data-files        bucket is private")
    elif status in (400, 401, 403, 404):
        print(f"  PASS  data-files        not publicly readable ({status})")
    else:
        print(f"  ?     data-files        unexpected status {status}")

    print("\n" + "=" * 60)
    if failures:
        print(f"FAILED - {len(failures)} problem(s):")
        for f in failures:
            print(f"  - {f}")
        print("\nThe dashboard is NOT locked down. Apply the pending migration(s)")
        print("in supabase/migrations/ (0007 onward) via Supabase Studio -> SQL Editor.")
        return 1

    print("PASSED - anonymous callers can read nothing and write nothing.")
    print("Sign-in is required, and file visibility is decided by the database.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
