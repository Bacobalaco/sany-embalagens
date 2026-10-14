-- Track edits to cheque data in the isolated SANY CHEQUES audit trail.
-- Review and test in an isolated development environment before applying to production.
alter table public.sany_cheques_records add column if not exists source_file text;
alter table public.sany_cheques_records add column if not exists source_sheet text;
alter table public.sany_cheques_records add column if not exists source_row integer;
alter table public.sany_cheques_records add column if not exists import_key text;
alter table public.sany_cheques_records add column if not exists returned_date date;
create unique index if not exists sany_cheques_records_import_key_uidx
  on public.sany_cheques_records (import_key) where import_key is not null;
drop policy if exists "authenticated can add sany cheque movements" on public.sany_cheques_movements;
revoke insert on public.sany_cheques_movements from authenticated;
grant select on public.sany_cheques_movements to authenticated;
alter table public.sany_cheques_movements
  drop constraint if exists sany_cheques_movements_event_type_check;
alter table public.sany_cheques_movements
  add constraint sany_cheques_movements_event_type_check
  check (event_type in ('criado','repassado','devolvido','compensado_confirmado','cancelado','alteracao_status','alteracao_local','alteracao_dados'));

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
        values (new.id,v_event,null,new.current_holder,case when new.status = 'devolvido' and new.returned_date is not null then new.returned_date else current_date end,'Situação inicial registrada: ' || new.status,auth.uid());
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
    values (new.id,v_event,old.current_holder,new.current_holder,case when new.status = 'devolvido' and new.returned_date is not null then new.returned_date else current_date end,
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
    case when new.returned_date is distinct from old.returned_date then 'data de devolução' end,
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
revoke all on function public.sany_cheques_log_record_changes() from public, anon, authenticated;


-- Extend the existing view without changing the order of its original columns.
create or replace view public.sany_cheques_records_view with (security_invoker = true) as
select
  r.id, r.direction, r.check_number, r.bank_name, r.branch, r.account_number,
  r.amount, r.issue_date, r.due_date, r.origin_client_id, r.issuer_name, r.issuer_kind,
  r.beneficiary_party_id, r.current_holder, r.status, r.notes, r.created_by, r.updated_by,
  r.created_at, r.updated_at,
  case when r.status = 'repassado' and r.due_date is not null and r.due_date <= (current_date - 45)
       then 'compensacao_presumida' else r.status end as effective_status,
  r.returned_date, r.source_file, r.source_sheet, r.source_row, r.import_key
from public.sany_cheques_records r;
grant select on public.sany_cheques_records_view to authenticated;
revoke all on public.sany_cheques_records_view from anon;
