-- Safely delete a SANY CHEQUES payment batch and reverse its cheque repass.
create or replace function public.sany_cheques_delete_payment_batch(p_batch_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.sany_cheques_payment_batches%rowtype;
  v_item_count integer;
  v_valid_count integer;
  v_user uuid := auth.uid();
  v_note_line text;
begin
  select * into v_batch
  from public.sany_cheques_payment_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Lote não encontrado.';
  end if;

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
  where i.batch_id = p_batch_id
    and r.id = i.check_id;

  delete from public.sany_cheques_payment_batches where id = p_batch_id;
end;
$$;

revoke all on function public.sany_cheques_delete_payment_batch(uuid) from public, anon;
grant execute on function public.sany_cheques_delete_payment_batch(uuid) to authenticated;
