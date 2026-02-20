// Send invite email to new user with sign-in link. Requires: GMAIL_USER, GMAIL_APP_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.10'

interface Body {
  email?: string
  tempPassword?: string
  appOrigin?: string
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const email = String(body.email ?? '').trim()
  const tempPassword = String(body.tempPassword ?? body.temp_password ?? '').trim()
  const appOrigin = String(body.appOrigin ?? '').replace(/\/$/, '')

  if (!email || !tempPassword || !appOrigin) {
    return new Response(
      JSON.stringify({ error: 'Missing email, tempPassword, or appOrigin' }),
      { status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: row, error: insertError } = await supabase
    .from('invite_tokens')
    .insert({
      email,
      temp_password: tempPassword,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('token')
    .single()

  if (insertError || !row?.token) {
    console.error('invite_tokens insert error:', insertError)
    return new Response(JSON.stringify({ error: 'Failed to create invite token' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const signInLink = `${appOrigin}/login?email=${encodeURIComponent(email)}&invite=${row.token}`

  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) {
    return new Response(JSON.stringify({ error: 'Email not configured' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  })

  try {
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from: `"Matrix" <${gmailUser}>`,
          to: email,
          subject: 'Your Matrix sign-in link',
          text: `You have been added to Matrix. Sign in using this link (email and password will be pre-filled):\n\n${signInLink}\n\nThis link is valid for 24 hours and can only be used once.`,
          html: `<p>You have been added to Matrix. Click the link below to sign in (your email and password will be pre-filled):</p><p><a href="${signInLink}">Sign in to Matrix</a></p><p>This link is valid for 24 hours and can only be used once.</p>`,
        },
        (err) => (err ? reject(err) : resolve())
      )
    })
  } catch (err) {
    console.error('Send invite email error:', err)
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
})
