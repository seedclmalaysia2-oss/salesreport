"""
Create one auth user per salesperson (plus an admin) and populate sp_user_map.

Idempotent: if a user with the same email already exists, the script skips
the create step and just (re)applies the sp_user_map row.

Usage:
    SUPABASE_URL=https://fgqiwitiqwftvfhkchpt.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... \
    python scripts/seed_users.py

You can also put these in a .env file at the project root (see .env.example).

The service_role key is in Supabase Studio under Settings → API. NEVER commit it.
"""

import os
import sys
import secrets
import string

try:
    from supabase import create_client, Client
except ImportError:
    print("Missing 'supabase' package. Install with:  pip install supabase")
    sys.exit(1)

# Salesperson roster + email convention. Edit emails to match real addresses.
USERS = [
    {"sp": "Alan",          "email": "alan@seedcl.example",          "is_admin": False},
    {"sp": "Dino",          "email": "dino@seedcl.example",          "is_admin": False},
    {"sp": "Khen",          "email": "khen@seedcl.example",          "is_admin": False},
    {"sp": "Sakinah",       "email": "sakinah@seedcl.example",       "is_admin": False},
    {"sp": "Simon",         "email": "simon@seedcl.example",         "is_admin": False},
    {"sp": "Seed Malaysia", "email": "seedmalaysia@seedcl.example",  "is_admin": False},
    {"sp": "admin",         "email": "admin@seedcl.example",         "is_admin": True},
]


def load_env_file():
    """Tiny .env reader — no python-dotenv dependency."""
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


def random_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def main() -> int:
    load_env_file()

    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
              "(env vars or .env file).")
        return 1

    sb: Client = create_client(url, service_key)

    print(f"Connected to {url}")
    print(f"Seeding {len(USERS)} users\n")

    results = []
    for u in USERS:
        password = random_password()
        # Try to create the user; if email already exists, fetch the existing one.
        try:
            r = sb.auth.admin.create_user({
                "email": u["email"],
                "password": password,
                "email_confirm": True,
                "user_metadata": {"sp": u["sp"], "is_admin": u["is_admin"]},
            })
            user_id = r.user.id
            status = "created"
        except Exception as e:
            msg = str(e)
            if "already" in msg.lower() or "registered" in msg.lower():
                # Look up the existing user by email
                page = sb.auth.admin.list_users()
                # supabase-py returns either a list or an object with .users
                users = page if isinstance(page, list) else getattr(page, "users", page)
                match = next((x for x in users if (x.email or "").lower() == u["email"].lower()), None)
                if not match:
                    print(f"  ! could not find existing user for {u['email']} after duplicate error")
                    continue
                user_id = match.id
                password = None
                status = "exists"
            else:
                print(f"  ! failed to create {u['email']}: {e}")
                continue

        # Upsert the mapping row.
        sb.table("sp_user_map").upsert({
            "user_id": user_id,
            "sp": u["sp"],
            "is_admin": u["is_admin"],
        }, on_conflict="user_id").execute()

        results.append({**u, "user_id": user_id, "password": password, "status": status})
        print(f"  {status:8s}  {u['email']:36s}  → sp={u['sp']!r:20s}  admin={u['is_admin']}")

    # Print a credentials summary at the end. Save this somewhere safe.
    print("\n" + "=" * 78)
    print("CREDENTIALS — save these somewhere safe; passwords are shown once.")
    print("=" * 78)
    for r in results:
        if r["password"]:
            print(f"  {r['email']:36s}  password: {r['password']}")
        else:
            print(f"  {r['email']:36s}  password: (already existed — unchanged)")
    print()
    print("Users can change their password from the Supabase login flow once you")
    print("wire that into the dashboard. For now, share these starter passwords")
    print("over a secure channel.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
