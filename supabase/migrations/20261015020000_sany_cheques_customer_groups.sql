-- Group related customer companies under a shared search name.
-- Isolated to SANY CHEQUES tables; does not touch SANY CONTAS tables.
ALTER TABLE public.sany_cheques_parties
  ADD COLUMN IF NOT EXISTS customer_group_name text;

COMMENT ON COLUMN public.sany_cheques_parties.customer_group_name IS
  'Optional shared search name for related customer companies (for example, Netto).';
