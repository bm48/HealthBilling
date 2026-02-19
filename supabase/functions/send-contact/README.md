# send-contact Edge Function

Sends the landing page contact form to **admin@amerbilling.com** via Gmail SMTP (Option A: App Password).

## Setup outside the code editor

1. **Gmail App Password**
   - Use the Gmail account that will send (e.g. the address you set as GMAIL_USER).
   - Turn on **2-Step Verification**: Google Account → Security → 2-Step Verification.
   - Create an **App Password**: Security → 2-Step Verification → App passwords → generate for "Mail", copy the 16-character password.

2. **Supabase Dashboard**
   - Open your project → **Project Settings** → **Edge Functions** (or **Settings** → **Edge Functions**).
   - Add **Secrets**:
     - `GMAIL_USER` = the Gmail address that sends (e.g. your sending address).
     - `GMAIL_APP_PASSWORD` = the 16-character app password (no spaces).

3. **Deploy the function**
   - From project root: `npx supabase functions deploy send-contact`
   - Or via Supabase Dashboard if you deploy from the UI.

After that, the landing page "Send Message" will POST to this function and the email will be delivered to admin@amerbilling.com.
