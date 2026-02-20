# send-invite-email

When a super admin adds a user, this function sends an email to the new user with a one-time sign-in link. The link opens the login page with email and password pre-filled.

## Secrets (Supabase Dashboard → Edge Functions → Secrets)

- `GMAIL_USER` – Gmail address that sends the email (same as contact form)
- `GMAIL_APP_PASSWORD` – Gmail app password
- `SUPABASE_URL` – Project URL (e.g. https://xxx.supabase.co); often set automatically
- `SUPABASE_SERVICE_ROLE_KEY` – From Project Settings → API → service_role (secret)

## Database

Run migration `044_invite_tokens.sql` so the `invite_tokens` table exists.

## Deploy

```bash
npx supabase functions deploy send-invite-email
```

## Optional env (app)

Set `VITE_APP_ORIGIN` in your app’s env (e.g. `https://your-app.vercel.app`) so the link in the email uses your production URL. If unset, the link uses the current origin when the super admin adds the user.
