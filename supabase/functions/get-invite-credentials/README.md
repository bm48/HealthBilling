# get-invite-credentials

One-time exchange: GET with `?token=<uuid>` returns `{ email, password }` and deletes the token. Used by the login page when the user opens the invite link.

## Secrets

- `SUPABASE_URL` – Project URL
- `SUPABASE_SERVICE_ROLE_KEY` – Service role key (to read/delete from `invite_tokens`)

## Deploy

```bash
npx supabase functions deploy get-invite-credentials
```
