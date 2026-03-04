# save-pending-provider-sheet Edge Function

Saves pending provider sheet rows when the user closes or refreshes the page. The client sends a **keepalive** `fetch()` from a `pagehide` handler so the request can complete even after the page unloads (avoiding AbortError and data loss).

## When it’s called

- From the clinic Billing (Providers) tab when the user has unsaved edits and then refreshes or closes the tab.
- The client backs up pending rows to `localStorage` and, on `pagehide`, POSTs each pending payload to this function with `fetch(..., { keepalive: true })`.

## Request

- **Method:** POST  
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer <user JWT>`  
- **Body:** `{ clinicId, providerId, selectedMonthKey, rows }`  
  - `selectedMonthKey`: e.g. `"2025-3"` or `"2025-3-2"` (year-month or year-month-payroll)

## Behaviour

1. Verifies the Bearer JWT (user must be logged in).
2. Resolves the provider sheet for the given clinic/provider/month (from `provider_sheets`).
3. Filters `rows` (same rules as the app: drop empty placeholder rows with no data).
4. Upserts rows into `provider_sheet_rows` (update by id if UUID, insert otherwise) and deletes rows no longer in the list.

Uses **SUPABASE_SERVICE_ROLE_KEY** so the write succeeds regardless of RLS.

## Deploy

From project root:

```bash
npx supabase functions deploy save-pending-provider-sheet
```

No extra secrets are required beyond `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (set by Supabase for Edge Functions).
