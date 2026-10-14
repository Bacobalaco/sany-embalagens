-- Track edits to cheque data in the isolated SANY CHEQUES audit trail.
-- Review and test in an isolated development environment before applying to production.
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
    return new;
  end if;

  if new.status is distinct from old.status or new.current_holder is distinct from old.current_holder then
    if new.status = 'repassado' and old.status is distinct from 'repassado' then v_event := 'repassado';
    elsif new.status = 'devolvido' and old.status is distinct from 'devolvido' then v_event := 'devolvido';
    elsif new.status = 'compensado_confirmado' and old.status is distinct from 'compensado_confirmado' then v_event := 'compensado_confirmado';
    elsif new.status = 'cancelado' and old.status is distinct from 'cancelado' then v_event := 'cancelado';
    elsif new.current_holder is distinct from old.current_holder then v_event := 'alteracao_local';
    else v_event := 'alteracao_status';
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
