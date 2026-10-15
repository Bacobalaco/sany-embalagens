-- Payment breakdown for SANY CHEQUES only. Does not touch SANY CONTAS tables.
ALTER TABLE public.sany_cheques_payment_batches
  ADD COLUMN IF NOT EXISTS invoice_total_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS cheque_total_amount numeric(14,2);

CREATE TABLE IF NOT EXISTS public.sany_cheques_payment_batch_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.sany_cheques_payment_batches(id) ON DELETE CASCADE,
  line_type text NOT NULL CHECK (line_type IN ('payment', 'abatement')),
  method text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sany_cheques_payment_batch_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sany_cheques_payment_batch_methods_select_authenticated ON public.sany_cheques_payment_batch_methods;
CREATE POLICY sany_cheques_payment_batch_methods_select_authenticated
  ON public.sany_cheques_payment_batch_methods FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.sany_cheques_payment_batch_methods FROM anon, authenticated;
GRANT SELECT ON public.sany_cheques_payment_batch_methods TO authenticated;

CREATE OR REPLACE FUNCTION public.sany_cheques_register_payment_batch_v2(
  p_check_ids uuid[],
  p_destination text,
  p_destination_party_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_invoice_total numeric DEFAULT NULL,
  p_methods jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_batch_id uuid;
  v_check_total numeric(14,2);
  v_method_total numeric(14,2);
  v_abatement_total numeric(14,2);
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'É necessário estar autenticado para registrar um pagamento.'; END IF;
  IF p_invoice_total IS NULL OR p_invoice_total <= 0 THEN RAISE EXCEPTION 'Informe o valor total da obrigação com o fornecedor.'; END IF;
  IF p_methods IS NULL OR jsonb_typeof(p_methods) <> 'array' THEN RAISE EXCEPTION 'A lista de formas de pagamento está inválida.'; END IF;

  SELECT COALESCE(sum(r.amount), 0) INTO v_check_total
  FROM public.sany_cheques_records r
  WHERE r.id = ANY(p_check_ids) AND r.status = 'em_carteira' AND r.direction = 'recebido';
  IF p_check_ids IS NULL OR cardinality(p_check_ids) = 0 THEN
    v_check_total := 0;
  ELSIF (SELECT count(*) FROM public.sany_cheques_records r WHERE r.id = ANY(p_check_ids) AND r.status = 'em_carteira' AND r.direction = 'recebido') <> cardinality(p_check_ids) THEN
    RAISE EXCEPTION 'Um ou mais cheques não estão mais em carteira. Atualize a lista e tente novamente.';
  END IF;

  SELECT COALESCE(sum((x->>'amount')::numeric), 0) INTO v_method_total
  FROM jsonb_array_elements(p_methods) x
  WHERE COALESCE(x->>'line_type', 'payment') = 'payment';
  SELECT COALESCE(sum((x->>'amount')::numeric), 0) INTO v_abatement_total
  FROM jsonb_array_elements(p_methods) x
  WHERE x->>'line_type' = 'abatement';

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_methods) x
    WHERE COALESCE(x->>'method', '') = ''
      OR COALESCE((x->>'amount')::numeric, 0) <= 0
      OR COALESCE(x->>'line_type', 'payment') NOT IN ('payment', 'abatement')
  ) THEN
    RAISE EXCEPTION 'Confira as formas de pagamento e os valores informados.';
  END IF;

  IF round(v_check_total + v_method_total + v_abatement_total, 2) <> round(p_invoice_total, 2) THEN
    RAISE EXCEPTION 'A soma dos cheques, outras formas de pagamento e abatimentos precisa ser igual ao valor total informado.';
  END IF;

  IF cardinality(COALESCE(p_check_ids, ARRAY[]::uuid[])) > 0 THEN
    v_batch_id := public.sany_cheques_register_payment_batch(p_check_ids, p_destination, p_destination_party_id, p_notes);
  ELSE
    IF nullif(trim(p_destination), '') IS NULL THEN RAISE EXCEPTION 'Informe o fornecedor/destino.'; END IF;
    IF p_destination_party_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.sany_cheques_parties WHERE id = p_destination_party_id AND party_type = 'fornecedor' AND active = true
    ) THEN RAISE EXCEPTION 'O fornecedor selecionado não existe ou está inativo.'; END IF;
    INSERT INTO public.sany_cheques_payment_batches(destination, notes, total_amount, check_count, created_by)
    VALUES (trim(p_destination), nullif(trim(p_notes), ''), 0, 0, v_user)
    RETURNING id INTO v_batch_id;
  END IF;

  UPDATE public.sany_cheques_payment_batches
  SET invoice_total_amount = p_invoice_total,
      cheque_total_amount = v_check_total,
      total_amount = p_invoice_total
  WHERE id = v_batch_id;

  INSERT INTO public.sany_cheques_payment_batch_methods(batch_id, line_type, method, amount, reference)
  SELECT v_batch_id,
         COALESCE(x->>'line_type', 'payment'),
         trim(x->>'method'),
         (x->>'amount')::numeric,
         nullif(trim(x->>'reference'), '')
  FROM jsonb_array_elements(p_methods) x;

  RETURN v_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sany_cheques_register_payment_batch_v2(uuid[], text, uuid, text, numeric, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sany_cheques_register_payment_batch_v2(uuid[], text, uuid, text, numeric, jsonb) TO authenticated;
