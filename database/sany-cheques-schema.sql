-- SANY CHEQUES schema (applied to Supabase project SANY contas)
-- Additive only: all objects use sany_cheques_* names and do not modify existing SANY CONTAS tables.

create table if not exists public.sany_cheques_parties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  party_type text not null check (party_type in ('cliente','fornecedor','outro')),
  document text,
  phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sany_cheques_parties_name_idx on public.sany_cheques_parties (lower(name));
create index if not exists sany_cheques_parties_type_idx on public.sany_cheques_parties (party_type, active);

create table if not exists public.sany_cheques_records (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('recebido','emitido')),
  check_number text,
  bank_name text,
  branch text,
  account_number text,
  amount numeric(14,2) not null check (amount > 0),
  issue_date date,
  due_date date,
  origin_client_id uuid references public.sany_cheques_parties(id) on delete restrict,
  issuer_name text,
  issuer_kind text not null default 'desconhecido' check (issuer_kind in ('cliente','terceiro','sany','desconhecido')),
  beneficiary_party_id uuid references public.sany_cheques_parties(id) on delete restrict,
  current_holder text not null default 'Sany Embalagens',
  status text not null default 'em_carteira' check (status in ('em_carteira','repassado','compensado_confirmado','devolvido','cancelado')),
  notes text,
  source_file text,
  source_sheet text,
  source_row integer,
  import_key text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sany_cheques_records_due_date_idx on public.sany_cheques_records (due_date);
create index if not exists sany_cheques_records_direction_status_idx on public.sany_cheques_records (direction, status);
create index if not exists sany_cheques_records_check_number_idx on public.sany_cheques_records (check_number);
create unique index if not exists sany_cheques_records_import_key_uidx on public.sany_cheques_records (import_key) where import_key is not null;
create index if not exists sany_cheques_records_origin_client_idx on public.sany_cheques_records (origin_client_id);
create index if not exists sany_cheques_records_beneficiary_idx on public.sany_cheques_records (beneficiary_party_id);

create table if not exists public.sany_cheques_movements (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.sany_cheques_records(id) on delete restrict,
  event_type text not null check (event_type in ('criado','repassado','devolvido','compensado_confirmado','cancelado','alteracao_status','alteracao_local','alteracao_dados')),
  from_holder text,
  to_holder text,
  event_date date not null default current_date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sany_cheques_movements_check_date_idx on public.sany_cheques_movements (check_id, event_date desc, created_at desc);

alter table public.sany_cheques_parties enable row level security;
alter table public.sany_cheques_records enable row level security;
alter table public.sany_cheques_movements enable row level security;
drop policy if exists "authenticated can manage sany cheque parties" on public.sany_cheques_parties;
create policy "authenticated can manage sany cheque parties" on public.sany_cheques_parties for all to authenticated using (true) with check (true);
drop policy if exists "authenticated can manage sany cheque records" on public.sany_cheques_records;
create policy "authenticated can manage sany cheque records" on public.sany_cheques_records for all to authenticated using (true) with check (true);
drop policy if exists "authenticated can read sany cheque movements" on public.sany_cheques_movements;
create policy "authenticated can read sany cheque movements" on public.sany_cheques_movements for select to authenticated using (true);

grant select, insert, update on public.sany_cheques_parties to authenticated;
grant select, insert, update on public.sany_cheques_records to authenticated;
grant select on public.sany_cheques_movements to authenticated;

create or replace function public.sany_cheques_log_record_changes()
returns trigger language plpgsql security definer set search_path = pg_catalog as $
declare
  v_event text;
  v_fields text;
begin
  if tg_op = 'INSERT' then
    insert into public.sany_cheques_movements (check_id,event_type,from_holder,to_holder,event_date,notes,created_by)
    values (new.id,'criado',null,new.current_holder,current_date,'Cadastro inicial do cheque',auth.uid());
    if new.status <> 'em_carteira' then
      v_event := case new.status
        when 'repassado' then 'repassado'
        when 'devolvido' then 'devolvido'
        when 'compensado_confirmado' then 'compensado_confirmado'
        when 'cancelado' then 'cancelado'
        else null end;
      if v_event is not null then
        insert into public.sany_cheques_movements (check_id,event_type,from_holder,to_holder,event_date,notes,created_by)
        values (new.id,v_event,null,new.current_holder,current_date,'Situação inicial registrada: ' || new.status,auth.uid());
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status or new.current_holder is distinct from old.current_holder then
    if new.status is distinct from old.status then
      if new.status = 'repassado' then v_event := 'repassado';
      elsif new.status = 'devolvido' then v_event := 'devolvido';
      elsif new.status = 'compensado_confirmado' then v_event := 'compensado_confirmado';
      elsif new.status = 'cancelado' then v_event := 'cancelado';
      else v_event := 'alteracao_status';
      end if;
    else
      v_event := 'alteracao_local';
    end if;
    insert into public.sany_cheques_movements (check_id,event_type,from_holder,to_holder,event_date,notes,created_by)
    values (new.id,v_event,old.current_holder,new.current_holder,current_date,
      case when new.status is distinct from old.status
        then 'Situação: ' || old.status || ' → ' || new.status
        else 'Localização do cheque alterada' end,
      auth.uid());
  end if;

  select concat_ws(', ',
    case when new.direction is distinct from old.direction then 'tipo' end,
    case when new.check_number is distinct from old.check_number then 'número do cheque' end,
    case when new.bank_name is distinct from old.bank_name then 'banco' end,
    case when new.branch is distinct from old.branch then 'agência' end,
    case when new.account_number is distinct from old.account_number then 'conta' end,
    case when new.amount is distinct from old.amount then 'valor' end,
    case when new.issue_date is distinct from old.issue_date then 'data de emissão' end,
    case when new.due_date is distinct from old.due_date then 'data “Bom para”' end,
    case when new.origin_client_id is distinct from old.origin_client_id then 'cliente de origem' end,
    case when new.issuer_name is distinct from old.issuer_name then 'emitente' end,
    case when new.issuer_kind is distinct from old.issuer_kind then 'tipo de emitente' end,
    case when new.beneficiary_party_id is distinct from old.beneficiary_party_id then 'fornecedor/destino' end,
    case when new.notes is distinct from old.notes then 'observações' end
  ) into v_fields;

  if coalesce(v_fields, '') <> '' then
    insert into public.sany_cheques_movements (check_id,event_type,from_holder,to_holder,event_date,notes,created_by)
    values (new.id,'alteracao_dados',old.current_holder,new.current_holder,current_date,
      'Campos alterados: ' || v_fields,auth.uid());
  end if;

  return new;
end;
$;
drop trigger if exists sany_cheques_record_changes on public.sany_cheques_records;
create trigger sany_cheques_record_changes after insert or update on public.sany_cheques_records for each row execute function public.sany_cheques_log_record_changes();

create or replace view public.sany_cheques_records_view with (security_invoker = true) as
select r.*,
  case when r.status = 'repassado' and r.due_date is not null and r.due_date <= (current_date - 45)
       then 'compensacao_presumida' else r.status end as effective_status
from public.sany_cheques_records r;
grant select on public.sany_cheques_records_view to authenticated;

-- Hardening applied after initial creation.
revoke all on public.sany_cheques_parties from anon;
revoke all on public.sany_cheques_records from anon;
revoke all on public.sany_cheques_movements from anon;
revoke all on public.sany_cheques_records_view from anon;
revoke delete on public.sany_cheques_parties from authenticated;
revoke delete on public.sany_cheques_records from authenticated;
revoke update, delete on public.sany_cheques_movements from authenticated;
revoke all on function public.sany_cheques_log_record_changes() from public, anon, authenticated;
create index if not exists sany_cheques_records_created_by_idx on public.sany_cheques_records (created_by);
create index if not exists sany_cheques_records_updated_by_idx on public.sany_cheques_records (updated_by);
create index if not exists sany_cheques_movements_created_by_idx on public.sany_cheques_movements (created_by);
