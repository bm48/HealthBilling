# admin-update-password

Allows super admins to set any user's password. The function validates the caller is `super_admin` via JWT + `public.users`, then uses the Auth Admin API to update the target user's password.

## Deploy (required: disable gateway JWT verification)

The Supabase Edge Function gateway validates JWTs by default and can return **401 Invalid JWT** before the request reaches this function. This function does its own auth (decode JWT → check `public.users.role = 'super_admin'`), so deploy with verification disabled:

```bash
npx supabase functions deploy admin-update-password --no-verify-jwt
```

## Environment

- `SUPABASE_URL` – project URL (set by Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` – required for Auth Admin API (set by Supabase)

## Request

- **Method:** POST
- **Headers:** `Authorization: Bearer <caller's session access_token>`, `Content-Type: application/json`
- **Body:** `{ "userId": "<uuid>", "newPassword": "<string, min 6 chars>" }`

Only callers with `role = 'super_admin'` in `public.users` can succeed; others receive 403.
