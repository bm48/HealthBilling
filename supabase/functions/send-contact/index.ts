// Contact form: send email to admin@amerbilling.com via Gmail SMTP (App Password).
// Set secrets in Supabase Dashboard: GMAIL_USER, GMAIL_APP_PASSWORD
// Transport is created only when sending (lazy) so OPTIONS works without secrets.

import nodemailer from 'npm:nodemailer@6.9.10'

const TO_EMAIL = 'admin@amerbilling.com'

interface ContactBody {
  name?: string
  email?: string
  phone?: string
  content?: string
}

Deno.serve(async (req) => {
  const method = req.method
  console.log('[send-contact] request method:', method)

  if (method === 'OPTIONS') {
    console.log('[send-contact] returning 204 for OPTIONS (CORS preflight)')
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  if (method !== 'POST') {
    console.log('[send-contact] method not allowed:', method)
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  let body: ContactBody = {}
  try {
    body = (await req.json()) as ContactBody
    console.log('[send-contact] body parsed ok, keys:', Object.keys(body))
  } catch (e) {
    console.error('[send-contact] body parse error:', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim()
  const content = String(body.content ?? '').trim()
  const phone = String(body.phone ?? '').trim()

  if (!name || !email || !content) {
    console.log('[send-contact] validation failed: missing name/email/content')
    return new Response(
      JSON.stringify({ error: 'Missing required fields: name, email, content' }),
      { status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    )
  }

  const from = Deno.env.get('GMAIL_USER')
  const hasPass = !!Deno.env.get('GMAIL_APP_PASSWORD')
  console.log('[send-contact] env: GMAIL_USER set:', !!from, ', GMAIL_APP_PASSWORD set:', hasPass)

  if (!from || !hasPass) {
    console.error('[send-contact] server email not configured (missing GMAIL_USER or GMAIL_APP_PASSWORD)')
    return new Response(
      JSON.stringify({ error: 'Server email not configured' }),
      { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    )
  }

  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: from,
      pass: Deno.env.get('GMAIL_APP_PASSWORD')!,
    },
  })

  const subject = `Contact form: ${name}`
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : null,
    '',
    'Message:',
    content,
  ]
    .filter(Boolean)
    .join('\n')

  const html = [
    `<p><strong>Name:</strong> ${escapeHtml(name)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
    phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : '',
    '<p><strong>Message:</strong></p>',
    `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`,
  ].join('')

  try {
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from: `"Contact Form" <${from}>`,
          to: TO_EMAIL,
          replyTo: email,
          subject,
          text,
          html,
        },
        (err) => (err ? reject(err) : resolve())
      )
    })
    console.log('[send-contact] email sent successfully to', TO_EMAIL)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[send-contact] send mail error:', msg)
    return new Response(
      JSON.stringify({ error: 'Failed to send message' }),
      { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
  )
})

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
