"""
Upload src/data.json into the Supabase tables customers_data and brand_sales_data.

Usage:
    python scripts/upload_to_supabase.py            # incremental (errors if data exists)
    python scripts/upload_to_supabase.py --replace  # truncate and reload

Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env vars or .env file).
Uses service_role to bypass RLS during seeding.
"""

import json
import os
import sys
from pathlib import Path

try:
    from supabase import create_client, Client
except ImportError:
    print("Missing 'supabase' package. Install with:  pip install supabase")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DATA_JSON = ROOT / "src" / "data.json"
BATCH = 500


def load_env_file():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def insert_batched(sb: Client, table: str, rows: list, label: str):
    total = len(rows)
    for i in range(0, total, BATCH):
        chunk = rows[i:i + BATCH]
        sb.table(table).insert(chunk).execute()
        print(f"  {label}: {min(i + BATCH, total):>6}/{total}")


def main() -> int:
    replace = "--replace" in sys.argv
    load_env_file()

    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        return 1
    if not DATA_JSON.exists():
        print(f"ERROR: {DATA_JSON} not found. Run scripts/build_data.py first.")
        return 1

    print(f"Connected to {url}")
    with open(DATA_JSON, encoding="utf-8") as f:
        data = json.load(f)

    customers = data["customers"]
    brand_sales = data["brandSales"]
    print(f"Loaded {len(customers):,} customer rows and {len(brand_sales):,} brand-sale rows from data.json")

    sb: Client = create_client(url, service_key)

    if replace:
        print("\n--replace: clearing existing rows…")
        # neq filters need a value; use a never-matching one so we delete everything.
        sb.table("brand_sales_data").delete().neq("id", -1).execute()
        sb.table("customers_data").delete().neq("id", -1).execute()
        print("  cleared")

    print("\nInserting customers_data…")
    insert_batched(sb, "customers_data", customers, "customers")

    print("\nInserting brand_sales_data…")
    insert_batched(sb, "brand_sales_data", brand_sales, "brand_sales")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
