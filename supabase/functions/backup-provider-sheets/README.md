# backup-provider-sheets

Creates versioned CSV backups of all provider sheet rows and uploads them to Supabase Storage.

- **Trigger**: Supabase pg_cron every 12 hours (e.g. 00:00 and 12:00), or manual POST with `cron_secret`.
- **Storage**: Bucket `provider-sheet-backups`, path `{sheet_id}/v{version}.csv`.
- **Database**: Inserts into `provider_sheet_backups` (sheet_id, version, file_path, created_at).

## Secrets

Set in Supabase Dashboard → Edge Functions → backup-provider-sheets → Secrets:

- `BACKUP_CRON_SECRET`: A shared secret string. pg_cron sends this in the request body as `{ "cron_secret": "YOUR_SECRET" }`. Generate a random string and store the same value in Vault for the cron job.

## Manual run

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/backup-provider-sheets" \
  -H "Content-Type: application/json" \
  -d '{"cron_secret":"YOUR_SECRET"}'
```
