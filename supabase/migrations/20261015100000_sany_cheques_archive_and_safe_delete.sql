-- Archive support and guarded deletion for SANY CHEQUES.
-- Additive and isolated to SANY CHEQUES tables only.
alter table public.sany_cheques_records add column if not exists archived_at timestamptz;

create or replace view public.sany_cheques_records_view as
select
  r.id, r.direction, r.check_number, r.bank_name, r.branch, r.account_number,
  r.amount, r.issue_date, r.due_date, r.origin_client_id, r.issuer_name, r.issuer_kind,
  r.beneficiary_party_id, r.current_holder, r.status, r.notes, r.created_by, r.updated_by,
  r.created_at, r.updated_at,
  case
    when r.status = 'repassado' and r.due_date is not null and r.due_date <= (current_date - 45)
      then 'compensacao_presumida'
    else r.status
  end as effective_status,
  r.returned_date, r.source_file, r.source_sheet, r.source_row, r.import_key, r.archived_at
from public.sany_cheques_records r;

create or replace function public.sany_cheques_archive_check(p_check_id uuid, p_archive boolean default true)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_check public.sany_cheques_records%rowtype;
begin
  if v_user is null then raise exception 'É necessário estar autenticado.'; end if;
  select * into v_check from public.sany_cheques_records where id = p_check_id for update;
  if not found then raise exception 'Cheque não encontrado.'; end if;

  if p_archive then
    if v_check.archived_at is not null then raise exception 'Este cheque já está arquivado.'; end if;
    update public.sany_cheques_records
      set archived_at = now(), updated_at = now(), updated_by = v_user
      where id = p_check_id;
    insert into public.sany_cheques_movements(check_id, event_type, event_date, from_holder, to_holder, notes, created_by)
      values (p_check_id, 'alteracao_dados', current_date, v_check.current_holder, v_check.current_holder, 'Cheque arquivado (registro preservado)', v_user);
  else
    if v_check.archived_at is null then raise exception 'Este cheque não está arquivado.'; end if;
    update public.sany_cheques_records
      set archived_at = null, updated_at = now(), updated_by = v_user
      where id = p_check_id;
    insert into public.sany_cheques_movements(check_id, event_type, event_date, from_holder, to_holder, notes, created_by)
      values (p_check_id, 'alteracao_dados', current_date, v_check.current_holder, v_check.current_holder, 'Cheque desarquivado (registro preservado)', v_user);
  end if;
end;
$function$;
revoke all on function public.sany_cheques_archive_check(uuid, boolean) from public, anon;
grant execute on function public.sany_cheques_archive_check(uuid, boolean) to authenticated;

create or replace function public.sany_cheques_delete_check(p_check_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'É necessário estar autenticado para excluir um cheque.'; end if;
  perform 1 from public.sany_cheques_records where id = p_check_id for update;
  if not found then raise exception 'Cheque não encontrado.'; end if;
  if exists (select 1 from public.sany_cheques_payment_batch_items where check_id = p_check_id) then
    raise exception 'Este cheque ainda está vinculado a uma ordem de pagamento. Remova a ordem primeiro.';
  end if;
  if exists (select 1 from public.sany_cheques_movements where check_id = p_check_id) then
    raise exception 'Este cheque possui histórico de movimentações. Para preservar o rastreamento, cancele ou arquive o cheque em vez de excluí-lo definitivamente.';
  end if;
  delete from public.sany_cheques_records where id = p_check_id;
end;
$function$;
revoke all on function public.sany_cheques_delete_check(uuid) from public, anon;
grant execute on function public.sany_cheques_delete_check(uuid) to authenticated;
