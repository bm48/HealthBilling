-- Add payroll (1 or 2) to provider_sheets for clinics with two pay periods per month.
-- When clinic.payroll = 2, each (provider, month, year) can have two sheets: payroll 1 and payroll 2.

ALTER TABLE provider_sheets
  ADD COLUMN IF NOT EXISTS payroll SMALLINT NOT NULL DEFAULT 1
  CHECK (payroll IN (1, 2));

-- Drop old unique constraint
ALTER TABLE provider_sheets
  DROP CONSTRAINT IF EXISTS provider_sheets_clinic_id_provider_id_month_year_key;

-- Add new unique constraint including payroll (allows two sheets per provider per month when payroll=2)
ALTER TABLE provider_sheets
  ADD CONSTRAINT provider_sheets_clinic_provider_month_year_payroll_key
  UNIQUE (clinic_id, provider_id, month, year, payroll);

CREATE INDEX IF NOT EXISTS idx_provider_sheets_payroll
  ON provider_sheets(clinic_id, provider_id, year, month, payroll);
