-- Price alerts: user-defined notifications when a card sells below/above a threshold.
--
-- Migration: run once in the Supabase SQL editor for your project.
-- The frontend (SalesDatabase.jsx) tries to insert into this table when a user
-- sets a bell alert. If the table is missing it falls back to localStorage and
-- surfaces a toast asking an admin to run this file.

create table if not exists public.user_price_alerts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  driver_name text,
  parallel text,
  grade text,
  threshold_price numeric not null,
  direction text default 'below' check (direction in ('below', 'above')),
  active boolean default true,
  last_triggered_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table public.user_price_alerts enable row level security;

drop policy if exists "users manage own alerts" on public.user_price_alerts;
create policy "users manage own alerts"
  on public.user_price_alerts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_price_alerts_user on public.user_price_alerts(user_id, active);
create index if not exists idx_price_alerts_driver on public.user_price_alerts(driver_name, parallel, grade);
