-- Harden payment batches: clients may read them, but all writes must go through
-- the validated RPC functions so batch items and cheque state stay consistent.

alter function public.sany_cheques_register_payment_batch(uuid[], text, uuid, text)
  security definer;
alter function public.sany_cheques_delete_payment_batch(uuid)
  security definer;

alter function public.sany_cheques_register_payment_batch(uuid[], text, uuid, text)
  set search_path = public, pg_temp;
alter function public.sany_cheques_delete_payment_batch(uuid)
  set search_path = public, pg_temp;

create or replace function public.sany_cheques_register_payment_batch(
  p_check_ids uuid[],
  p_destination text,
  p_destination_party_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_batch_id uuid;
  v_count integer;
  v_total numeric(14,2);
  v_user uuid := auth.uid();
  v_destination text := nullif(trim(p_destination), '');
begin
  if v_user is null then
    raise exception 'É necessário estar autenticado para registrar um lote.';
  end if;
  if v_destination is null then raise exception 'Informe o fornecedor/destino.'; end if;
  if p_check_ids is null or cardinality(p_check_ids) = 0 then raise exception 'Selecione ao menos um cheque.'; end if;
  if (select count(distinct x) from unnest(p_check_ids) x) <> cardinality(p_check_ids) then raise exception 'A seleção contém cheques repetidos.'; end if;

  perform 1
  from public.sany_cheques_records r
  where r.id = any(p_check_ids) and r.status = 'em_carteira' and r.direction = 'recebido'
  for update;

  select count(*), coalesce(sum(r.amount), 0)
  into v_count, v_total
  from public.sany_cheques_records r
  where r.id = any(p_check_ids) and r.status = 'em_carteira' and r.direction = 'recebido';

  if v_count <> cardinality(p_check_ids) then
    raise exception 'Um ou mais cheques não estão mais em carteira ou não são cheques recebidos. Atualize a lista e tente novamente.';
  end if;

  if p_destination_party_id is not null and not exists (
    select 1 from public.sany_cheques_parties p
    where p.id = p_destination_party_id and p.party_type = 'fornecedor' and p.active = true
  ) then
    raise exception 'O fornecedor selecionado não existe ou está inativo.';
  end if;

  insert into public.sany_cheques_payment_batches(destination, notes, total_amount, check_count, created_by)
  values (v_destination, nullif(trim(p_notes), ''), v_total, v_count, v_user)
  returning id into v_batch_id;

  insert into public.sany_cheques_payment_batch_items(batch_id, check_id, amount_snapshot, due_date_snapshot, status_snapshot)
  select v_batch_id, r.id, r.amount, r.due_date, r.status
  from public.sany_cheques_records r
  where r.id = any(p_check_ids);

  update public.sany_cheques_records r
  set status = 'repassado',
      beneficiary_party_id = p_destination_party_id,
      current_holder = v_destination,
      notes = case when nullif(trim(p_notes), '') is not null
        then concat_ws(E'\\n', nullif(r.notes, ''), 'Lote de pagamento: ' || trim(p_notes))
        else r.notes end,
      updated_at = now(),
      updated_by = v_user
  where r.id = any(p_check_ids) and r.status = 'em_carteira' and r.direction = 'recebido';

  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_check_ids) then
    raise exception 'Nem todos os cheques puderam ser repassados. Nenhuma alteração foi confirmada.';
  end if;

  return v_batch_id;
end;
$function$;

create or replace function public.sany_cheques_delete_payment_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_batch public.sany_cheques_payment_batches%rowtype;
  v_item_count integer;
  v_valid_count integer;
  v_user uuid := auth.uid();
  v_note_line text;
begin
  if v_user is null then
    raise exception 'É necessário estar autenticado para excluir um lote.';
  end if;

  select * into v_batch
  from public.sany_cheques_payment_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'Lote não encontrado.'; end if;

  select count(*) into v_item_count
  from public.sany_cheques_payment_batch_items
  where batch_id = p_batch_id;

  if v_item_count <> v_batch.check_count then
    raise exception 'O lote não possui a quantidade esperada de cheques. Não foi excluído; confira os dados antes de continuar.';
  end if;

  select count(*) into v_valid_count
  from public.sany_cheques_payment_batch_items i
  join public.sany_cheques_records r on r.id = i.check_id
  where i.batch_id = p_batch_id
    and r.status = 'repassado'
    and r.direction = 'recebido'
    and coalesce(r.current_holder, '') = v_batch.destination;

  if v_valid_count <> v_item_count then
    raise exception 'Não é possível excluir este lote com segurança: um ou mais cheques foram movimentados ou alterados depois do lote. Revise os cheques antes de tentar novamente.';
  end if;

  v_note_line := case when nullif(trim(v_batch.notes), '') is not null
    then E'\\nLote de pagamento: ' || trim(v_batch.notes)
    else null end;

  update public.sany_cheques_records r
  set status = 'em_carteira',
      beneficiary_party_id = null,
      current_holder = 'Sany Embalagens',
      notes = case
        when v_note_line is null then r.notes
        when r.notes = substring(v_note_line from 2) then null
        when right(coalesce(r.notes, ''), length(v_note_line)) = v_note_line
          then nullif(left(r.notes, length(r.notes) - length(v_note_line)), '')
        else r.notes
      end,
      updated_at = now(),
      updated_by = v_user
  from public.sany_cheques_payment_batch_items i
  where i.batch_id = p_batch_id and r.id = i.check_id;

  delete from public.sany_cheques_payment_batches where id = p_batch_id;
end;
$function$;

revoke all on public.sany_cheques_payment_batches from anon, authenticated;
revoke all on public.sany_cheques_payment_batch_items from anon, authenticated;
grant select on public.sany_cheques_payment_batches to authenticated;
grant select on public.sany_cheques_payment_batch_items to authenticated;

revoke all on function public.sany_cheques_register_payment_batch(uuid[], text, uuid, text) from public, anon;
revoke all on function public.sany_cheques_delete_payment_batch(uuid) from public, anon;
grant execute on function public.sany_cheques_register_payment_batch(uuid[], text, uuid, text) to authenticated;
grant execute on function public.sany_cheques_delete_payment_batch(uuid) to authenticated;
