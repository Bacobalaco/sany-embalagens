-- Atomic payment batch registration and cheque repass in SANY CHEQUES only.
create or replace function public.sany_cheques_register_payment_batch(
  p_check_ids uuid[],
  p_destination text,
  p_destination_party_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid;
  v_count integer;
  v_total numeric(14,2);
  v_user uuid := auth.uid();
  v_destination text := nullif(trim(p_destination), '');
begin
  if v_destination is null then
    raise exception 'Informe o fornecedor/destino.';
  end if;
  if p_check_ids is null or cardinality(p_check_ids) = 0 then
    raise exception 'Selecione ao menos um cheque.';
  end if;
  if (select count(distinct x) from unnest(p_check_ids) x) <> cardinality(p_check_ids) then
    raise exception 'A seleção contém cheques repetidos.';
  end if;

  perform 1
  from public.sany_cheques_records r
  where r.id = any(p_check_ids)
    and r.status = 'em_carteira'
    and r.direction = 'recebido'
  for update;

  select count(*), coalesce(sum(r.amount), 0)
    into v_count, v_total
  from public.sany_cheques_records r
  where r.id = any(p_check_ids)
    and r.status = 'em_carteira'
    and r.direction = 'recebido';

  if v_count <> cardinality(p_check_ids) then
    raise exception 'Um ou mais cheques não estão mais em carteira ou não são cheques recebidos. Atualize a lista e tente novamente.';
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
        then concat_ws(E'\n', nullif(r.notes, ''), 'Lote de pagamento: ' || trim(p_notes))
        else r.notes end,
      updated_at = now(),
      updated_by = v_user
  where r.id = any(p_check_ids)
    and r.status = 'em_carteira'
    and r.direction = 'recebido';

  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_check_ids) then
    raise exception 'Nem todos os cheques puderam ser repassados. Nenhuma alteração foi confirmada.';
  end if;
  return v_batch_id;
end;
$$;
revoke all on function public.sany_cheques_register_payment_batch(uuid[], text, uuid, text) from public, anon;
grant execute on function public.sany_cheques_register_payment_batch(uuid[], text, uuid, text) to authenticated;
