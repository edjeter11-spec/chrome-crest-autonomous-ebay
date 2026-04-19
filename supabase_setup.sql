-- User portfolio table (per-user F1 card collection)
create table if not exists public.user_portfolio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  driver_name text,
  parallel text,
  grade text,
  card_number text,
  purchase_price numeric,
  purchase_date date,
  current_value numeric,
  notes text,
  photo_url text,
  ai_scan_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security: users only see their own rows
alter table public.user_portfolio enable row level security;

drop policy if exists "users read own portfolio" on public.user_portfolio;
create policy "users read own portfolio" on public.user_portfolio
  for select using (auth.uid() = user_id);

drop policy if exists "users insert own portfolio" on public.user_portfolio;
create policy "users insert own portfolio" on public.user_portfolio
  for insert with check (auth.uid() = user_id);

drop policy if exists "users update own portfolio" on public.user_portfolio;
create policy "users update own portfolio" on public.user_portfolio
  for update using (auth.uid() = user_id);

drop policy if exists "users delete own portfolio" on public.user_portfolio;
create policy "users delete own portfolio" on public.user_portfolio
  for delete using (auth.uid() = user_id);

-- Storage bucket for card photos
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', true)
on conflict (id) do nothing;

drop policy if exists "users upload own photos" on storage.objects;
create policy "users upload own photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "anyone can view card photos" on storage.objects;
create policy "anyone can view card photos" on storage.objects
  for select using (bucket_id = 'card-photos');

drop policy if exists "users delete own photos" on storage.objects;
create policy "users delete own photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'card-photos' and (storage.foldername(name))[1] = auth.uid()::text);
