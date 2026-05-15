-- Add quantity to brand sales. Each customer × brand × year row tracks both
-- the revenue ('amt') and the unit count ('qty') from the source workbooks.
-- Existing rows default to 0 qty; the seed script will refill from data.json.

alter table public.brand_sales_data
  add column if not exists qty numeric not null default 0;

-- Drop the old amt > 0 implicit assumption: now a row may legitimately have
-- amt = 0 if it was a quantity-only line (rare but possible per the source).
-- No constraint changes needed since amt was never NOT NULL with a check.
