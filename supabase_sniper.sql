-- Sniper rules: user-defined alerts for matching auctions
create table if not exists public.user_snipe_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text,
  driver_name text,           -- null = any driver
  parallel text,              -- null = any parallel
  grade text,                 -- null = any grade
  max_price numeric,          -- absolute dollar cap (optional)
  max_percent_of_median int,  -- e.g. 70 means "<= 70% of median" (optional)
  ending_soon_only bool default false,  -- only fire when <6h left
  max_per_day int default 3,
  active bool default true,
  last_triggered_at timestamptz,
  trigger_count int default 0,
  created_at timestamptz default now()
);

alter table public.user_snipe_rules enable row level security;

drop policy if exists "read own rules" on public.user_snipe_rules;
create policy "read own rules" on public.user_snipe_rules
  for select using (auth.uid() = user_id);
drop policy if exists "insert own rules" on public.user_snipe_rules;
create policy "insert own rules" on public.user_snipe_rules
  for insert with check (auth.uid() = user_id);
drop policy if exists "update own rules" on public.user_snipe_rules;
create policy "update own rules" on public.user_snipe_rules
  for update using (auth.uid() = user_id);
drop policy if exists "delete own rules" on public.user_snipe_rules;
create policy "delete own rules" on public.user_snipe_rules
  for delete using (auth.uid() = user_id);

-- History of matches (for analytics + dedup)
create table if not exists public.user_snipe_matches (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.user_snipe_rules(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  auction_id bigint,
  ebay_listing_id text,
  title text,
  current_price numeric,
  median_price numeric,
  matched_at timestamptz default now()
);

alter table public.user_snipe_matches enable row level security;
drop policy if exists "read own matches" on public.user_snipe_matches;
create policy "read own matches" on public.user_snipe_matches
  for select using (auth.uid() = user_id);
