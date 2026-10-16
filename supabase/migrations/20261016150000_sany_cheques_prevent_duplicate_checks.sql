-- Prevent duplicate cheque registrations in SANY CHEQUES only.
-- Existing records are preserved; this trigger blocks new duplicates without touching SANY CONTAS.

CREATE OR REPLACE FUNCTION public.sany_cheques_prevent_duplicate_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_number text;
  v_identity_changed boolean := TG_OP = 'INSERT';
BEGIN
  v_number := regexp_replace(upper(trim(coalesce(NEW.check_number, ''))), '[^0-9A-Z]', '', 'g');

  IF TG_OP = 'UPDATE' THEN
    v_identity_changed :=
      regexp_replace(upper(trim(coalesce(NEW.check_number, ''))), '[^0-9A-Z]', '', 'g')
        IS DISTINCT FROM regexp_replace(upper(trim(coalesce(OLD.check_number, ''))), '[^0-9A-Z]', '', 'g')
      OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
      OR NEW.branch IS DISTINCT FROM OLD.branch
      OR NEW.account_number IS DISTINCT FROM OLD.account_number
      OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.issuer_name IS DISTINCT FROM OLD.issuer_name;
  END IF;

  IF v_identity_changed AND v_number <> '' AND EXISTS (
    SELECT 1
    FROM public.sany_cheques_records r
    WHERE r.id IS DISTINCT FROM NEW.id
      AND regexp_replace(upper(trim(coalesce(r.check_number, ''))), '[^0-9A-Z]', '', 'g') = v_number
  ) THEN
    RAISE EXCEPTION 'Este número de cheque já está cadastrado. Confira a listagem e o histórico antes de incluir outro.'
      USING ERRCODE = '23505';
  END IF;

  IF v_identity_changed
     AND v_number = ''
     AND nullif(trim(coalesce(NEW.bank_name, '')), '') IS NOT NULL
     AND nullif(trim(coalesce(NEW.account_number, '')), '') IS NOT NULL
     AND nullif(trim(coalesce(NEW.issuer_name, '')), '') IS NOT NULL
     AND NEW.amount IS NOT NULL
     AND NEW.due_date IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.sany_cheques_records r
       WHERE r.id IS DISTINCT FROM NEW.id
         AND coalesce(r.check_number, '') = ''
         AND r.direction = NEW.direction
         AND upper(trim(coalesce(r.bank_name, ''))) = upper(trim(NEW.bank_name))
         AND upper(trim(coalesce(r.branch, ''))) = upper(trim(coalesce(NEW.branch, '')))
         AND upper(trim(coalesce(r.account_number, ''))) = upper(trim(NEW.account_number))
         AND r.amount = NEW.amount
         AND r.due_date = NEW.due_date
         AND upper(trim(coalesce(r.issuer_name, ''))) = upper(trim(NEW.issuer_name))
     ) THEN
    RAISE EXCEPTION 'Já existe um cheque com os mesmos dados bancários, emitente, valor e vencimento. Confira antes de cadastrar.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sany_cheques_prevent_duplicate_check ON public.sany_cheques_records;
CREATE TRIGGER sany_cheques_prevent_duplicate_check
BEFORE INSERT OR UPDATE ON public.sany_cheques_records
FOR EACH ROW
EXECUTE FUNCTION public.sany_cheques_prevent_duplicate_check();
