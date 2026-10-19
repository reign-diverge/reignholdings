create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('Furniture', 'Carpets', 'Upholstery')),
  amount numeric(12, 2) not null check (amount > 0),
  sold_on date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.spending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket in ('Savings', 'Expenses', 'Restocking')),
  amount numeric(12, 2) not null check (amount > 0),
  spent_on date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('Furniture', 'Carpets', 'Upholstery')),
  item text not null check (length(trim(item)) > 0),
  quantity integer not null check (quantity > 0),
  value_each numeric(12, 2) not null check (value_each >= 0),
  added_on date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  savings_goal numeric(12, 2) not null default 0 check (savings_goal >= 0),
  savings_percent integer not null default 20 check (savings_percent between 0 and 100),
  expenses_percent integer not null default 50 check (expenses_percent between 0 and 100),
  restocking_percent integer not null default 30 check (restocking_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  constraint ledger_settings_split_totals
    check (savings_percent + expenses_percent + restocking_percent = 100)
);

create index if not exists sales_user_date_idx on public.sales (user_id, sold_on desc);
create index if not exists spending_user_date_idx on public.spending (user_id, spent_on desc);
create index if not exists inventory_user_date_idx on public.inventory (user_id, added_on desc);

revoke all on table public.sales, public.spending, public.inventory, public.ledger_settings from anon, public;
grant select, insert, update, delete on table public.sales, public.spending, public.inventory, public.ledger_settings to authenticated;

alter table public.sales enable row level security;
alter table public.spending enable row level security;
alter table public.inventory enable row level security;
alter table public.ledger_settings enable row level security;

create policy "Owners manage their sales"
  on public.sales for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owners manage their spending"
  on public.spending for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owners manage their inventory"
  on public.inventory for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owners manage their settings"
  on public.ledger_settings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.reset_ledger_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.sales where user_id = (select auth.uid());
  delete from public.spending where user_id = (select auth.uid());
  delete from public.inventory where user_id = (select auth.uid());
  delete from public.ledger_settings where user_id = (select auth.uid());
end;
$$;

revoke all on function public.reset_ledger_data() from public, anon;
grant execute on function public.reset_ledger_data() to authenticated;
