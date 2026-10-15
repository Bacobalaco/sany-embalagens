-- Isolated payment-batch registry for SANY CHEQUES. Does not change cheque statuses or SANY CONTAS objects.
create table if not exists public.sany_cheques_payment_batches (
  id uuid primary key default gen_random_uuid(),
  destination text not null,
  notes text,
  total_amount numeric(14,2) not null check (total_amount > 0),
  check_count integer not null check (check_count > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.sany_cheques_payment_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.sany_cheques_payment_batches(id) on delete cascade,
  check_id uuid not null references public.sany_cheques_records(id) on delete restrict,
  amount_snapshot numeric(14,2) not null check (amount_snapshot > 0),
  due_date_snapshot date,
  status_snapshot text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, check_id)
);
alter table public.sany_cheques_payment_batches enable row level security;
alter table public.sany_cheques_payment_batch_items enable row level security;
drop policy if exists "authenticated can manage sany cheque payment batches" on public.sany_cheques_payment_batches;
create policy "authenticated can manage sany cheque payment batches" on public.sany_cheques_payment_batches for all to authenticated using (true) with check (true);
drop policy if exists "authenticated can manage sany cheque payment batch items" on public.sany_cheques_payment_batch_items;
create policy "authenticated can manage sany cheque payment batch items" on public.sany_cheques_payment_batch_items for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.sany_cheques_payment_batches to authenticated;
grant select, insert, update, delete on public.sany_cheques_payment_batch_items to authenticated;
