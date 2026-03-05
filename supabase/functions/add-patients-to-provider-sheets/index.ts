// Add new patients to all provider sheets for a clinic/month. Called from client after saving patients.
// Body: { clinicId, selectedMonthKey, patients: Array<{ id, patient_id, first_name, last_name, insurance, copay, coinsurance }> }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface PatientPayload {
  id?: string
  patient_id?: string | null
  first_name?: string | null
  last_name?: string | null
  insurance?: string | null
  copay?: string | number | null
  coinsurance?: string | number | null
}

interface Body {
  clinicId?: string
  selectedMonthKey?: string
  patients?: PatientPayload[]
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

/** selectedMonthKey: "2026-3" or "2026-3-2" -> { year, month, payroll } */
function parseMonthKey(selectedMonthKey: string): { year: number; month: number; payroll: number } | null {
  const parts = selectedMonthKey.split('-').map((p) => parseInt(p, 10))
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
  const year = parts[0]
  const month = parts[1]
  const payroll = parts.length >= 3 && Number.isFinite(parts[2]) ? parts[2] : 1
  return { year, month, payroll }
}

function patientToRowPayload(patient: PatientPayload, sheetId: string, sortOrder: number): Record<string, unknown> {
  const now = new Date().toISOString()
  const lastInitial = patient.last_name ? patient.last_name.charAt(0) : null
  return {
    sheet_id: sheetId,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
    patient_id: patient.patient_id ?? null,
    patient_first_name: patient.first_name ?? null,
    patient_last_name: patient.last_name ?? null,
    last_initial: lastInitial,
    patient_insurance: patient.insurance ?? null,
    patient_copay: patient.copay != null ? String(patient.copay) : null,
    patient_coinsurance: patient.coinsurance != null ? String(patient.coinsurance) : null,
    appointment_date: null,
    appointment_time: null,
    visit_type: null,
    notes: null,
    billing_code: null,
    billing_code_color: null,
    cpt_code: null,
    cpt_code_color: null,
    appointment_status: null,
    appointment_status_color: null,
    claim_status: null,
    claim_status_color: null,
    submit_date: null,
    insurance_payment: null,
    insurance_adjustment: null,
    invoice_amount: null,
    collected_from_patient: null,
    patient_pay_status: null,
    patient_pay_status_color: null,
    payment_date: null,
    payment_date_color: null,
    ar_type: null,
    ar_amount: null,
    ar_date: null,
    ar_date_color: null,
    ar_notes: null,
    provider_payment_amount: null,
    provider_payment_date: null,
    provider_payment_notes: null,
    highlight_color: null,
    total: null,
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

  console.log('add-patients-to-provider-sheets: POST received')
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    console.log('add-patients-to-provider-sheets: 401 no Bearer header')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    console.log('add-patients-to-provider-sheets: missing SUPABASE_URL or SUPABASE_ANON_KEY')
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userError } = await authClient.auth.getUser(token)
  if (userError || !user?.id) {
    console.log('add-patients-to-provider-sheets: 401 getUser failed', userError?.message ?? 'no user')
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }
  const callerId = user.id
  console.log('add-patients-to-provider-sheets: auth ok callerId=', callerId.slice(0, 8), '...')

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const clinicId = typeof body.clinicId === 'string' ? body.clinicId.trim() : ''
  const selectedMonthKey = typeof body.selectedMonthKey === 'string' ? body.selectedMonthKey.trim() : ''
  const patients = Array.isArray(body.patients) ? body.patients.filter((p): p is PatientPayload => p != null && typeof p === 'object') : []

  if (!clinicId || !selectedMonthKey) {
    return new Response(JSON.stringify({ error: 'Missing clinicId or selectedMonthKey' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const parsed = parseMonthKey(selectedMonthKey)
  if (!parsed) {
    return new Response(JSON.stringify({ error: 'Invalid selectedMonthKey' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  if (patients.length === 0) {
    return new Response(JSON.stringify({ success: true, added: 0 }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: providersData, error: providersError } = await supabase
    .from('providers')
    .select('id')
    .eq('active', true)
    .contains('clinic_ids', [clinicId])

  if (providersError) {
    return new Response(JSON.stringify({ error: providersError.message }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const providerIds = (providersData || []).map((p: { id: string }) => p.id)
  if (providerIds.length === 0) {
    return new Response(JSON.stringify({ success: true, added: 0 }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const { month, year, payroll } = parsed
  let totalAdded = 0

  for (const providerId of providerIds) {
    let sheet: { id: string } | null = null
    const { data: existingSheet, error: fetchError } = await supabase
      .from('provider_sheets')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('provider_id', providerId)
      .eq('month', month)
      .eq('year', year)
      .eq('payroll', payroll)
      .maybeSingle()

    if (existingSheet && !fetchError) {
      sheet = existingSheet
    } else {
      const { data: newSheet, error: createError } = await supabase
        .from('provider_sheets')
        .insert({ clinic_id: clinicId, provider_id: providerId, month, year, payroll, locked: false, locked_columns: [] })
        .select('id')
        .maybeSingle()
      if (!createError && newSheet) sheet = newSheet
    }

    if (!sheet?.id) continue

    const sheetId = sheet.id
    const { data: existingRows } = await supabase
      .from('provider_sheet_rows')
      .select('id')
      .eq('sheet_id', sheetId)
      .order('sort_order', { ascending: true })

    const currentLength = (existingRows || []).length

    for (let i = 0; i < patients.length; i++) {
      const payload = patientToRowPayload(patients[i], sheetId, currentLength + i)
      const { error: insertError } = await supabase.from('provider_sheet_rows').insert(payload)
      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message, providerId, patientIndex: i }), {
          status: 500,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        })
      }
      totalAdded += 1
    }
  }

  console.log('add-patients-to-provider-sheets: success added=', totalAdded)
  return new Response(JSON.stringify({ success: true, added: totalAdded }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
})
