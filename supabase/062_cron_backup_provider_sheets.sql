-- Schedule backup-provider-sheets Edge Function every 12 hours at 00:00 and 12:00 UTC-7 (07:00 and 19:00 UTC) using pg_cron + pg_net.
--
-- Prerequisites:
-- 1. Enable "pg_cron" and "pg_net" in Supabase Dashboard → Database → Extensions.
-- 2. Store secrets in Vault (Dashboard → SQL Editor or Project Settings → Vault):
--      SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'backup_project_url');
--      SELECT vault.create_secret('YOUR_RANDOM_CRON_SECRET', 'backup_cron_secret');
--      SELECT vault.create_secret('YOUR_SUPABASE_ANON_KEY', 'backup_anon_key');  -- Project Settings → API → anon public
--    Use the same value for backup_cron_secret as BACKUP_CRON_SECRET in Edge Function secrets.
-- 3. Deploy the backup-provider-sheets Edge Function and set BACKUP_CRON_SECRET there.

-- Ensure extensions exist (may already be enabled in Dashboard)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- To replace an existing schedule, first run: SELECT cron.unschedule('backup-provider-sheets-every-3min'); or SELECT cron.unschedule('backup-provider-sheets-every-12h');

-- Schedule: at 07:00 and 19:00 UTC (= 00:00 and 12:00 UTC-7)
SELECT cron.schedule(
  'backup-provider-sheets-every-12h',
  '0 7,19 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_project_url') || '/functions/v1/backup-provider-sheets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_anon_key')
    ),
    body := jsonb_build_object(
      'cron_secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_cron_secret')
    )
  ) AS request_id;
  $$
);
