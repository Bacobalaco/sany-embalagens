-- Customer groups for SANY CHEQUES only.
-- Existing party records and cheque history remain intact.
CREATE TABLE IF NOT EXISTS public.sany_cheques_customer_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sany_cheques_customer_groups_name_lower_uidx
  ON public.sany_cheques_customer_groups (lower(trim(name)));

ALTER TABLE public.sany_cheques_parties
  ADD COLUMN IF NOT EXISTS customer_group_id uuid
  REFERENCES public.sany_cheques_customer_groups(id) ON DELETE SET NULL;

COMMENT ON TABLE public.sany_cheques_customer_groups IS
  'Groups related customer companies for unified search in SANY CHEQUES.';
COMMENT ON COLUMN public.sany_cheques_parties.customer_group_id IS
  'Optional customer group this company belongs to; isolated to SANY CHEQUES.';
