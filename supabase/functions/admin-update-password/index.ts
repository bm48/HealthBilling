// Super admin only: update any user's password via Auth Admin API.
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Caller must be super_admin (JWT sub + public.users).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Body {
  userId?: string
  newPassword?: string
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function getCallerIdFromJwt(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.sub ?? null
  } catch {
    return null
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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const callerId = getCallerIdFromJwt(authHeader)
  if (!callerId) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
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

  const userId = String(body.userId ?? '').trim()
  const newPassword = String(body.newPassword ?? '').trim()
  if (!userId || !newPassword) {
    return new Response(JSON.stringify({ error: 'Missing userId or newPassword' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }
  if (newPassword.length < 6) {
    return new Response(JSON.stringify({ error: 'New password must be at least 6 characters' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data: callerRow, error: callerError } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', callerId)
    .maybeSingle()

  if (callerError || !callerRow || callerRow.role !== 'super_admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: super admin only' }), {
      status: 403,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  })

  if (updateError) {
    return new Response(
      JSON.stringify({ error: updateError.message || 'Failed to update password' }),
      { status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    )
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
})
