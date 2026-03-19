// Add new patients to all provider sheets for a clinic/month. Called from client after saving patients.
// Body: { clinicId, selectedMonthKey, patients: Array<{ id, patient_id, first_name, ... }> }
// We look up each patient by id from the patients table so provider rows use the DB as source of truth.

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

function patientToRowPayload(
  patient: PatientPayload,
  sheetId: string,
  sortOrder: number
): Record<string, unknown> {
  const now = new Date().toISOString()
  const firstName = patient.first_name != null && patient.first_name !== '' ? patient.first_name : null
  const lastName = patient.last_name != null && patient.last_name !== '' ? patient.last_name : null
  const li = lastName && lastName.length > 0 ? lastName.charAt(0) : null
  const copayStr = patient.copay != null && patient.copay !== '' ? String(patient.copay) : null
  const coinsStr = patient.coinsurance != null && patient.coinsurance !== '' ? String(patient.coinsurance) : null
  return {
    sheet_id: sheetId,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
    patient_id: patient.patient_id ?? null,
    patient_first_name: firstName,
    patient_last_name: lastName,
    last_initial: li,
    patient_insurance: patient.insurance != null && patient.insurance !== '' ? patient.insurance : null,
    patient_copay: copayStr,
    patient_coinsurance: coinsStr,
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
  } catch (e) {
    console.log('add-patients-to-provider-sheets: 400 invalid JSON', String(e))
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const clinicId = typeof body.clinicId === 'string' ? body.clinicId.trim() : ''
  const selectedMonthKey = typeof body.selectedMonthKey === 'string' ? body.selectedMonthKey.trim() : ''
  const patients = Array.isArray(body.patients) ? body.patients.filter((p): p is PatientPayload => p != null && typeof p === 'object') : []

  console.log('add-patients-to-provider-sheets: body parsed', { clinicId: clinicId || '(empty)', selectedMonthKey: selectedMonthKey || '(empty)', patientsCount: patients.length })

  if (!clinicId || !selectedMonthKey) {
    console.log('add-patients-to-provider-sheets: 400 missing clinicId or selectedMonthKey')
    return new Response(JSON.stringify({ error: 'Missing clinicId or selectedMonthKey' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const parsed = parseMonthKey(selectedMonthKey)
  if (!parsed) {
    console.log('add-patients-to-provider-sheets: 400 invalid selectedMonthKey', selectedMonthKey)
    return new Response(JSON.stringify({ error: 'Invalid selectedMonthKey' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const { month, year, payroll } = parsed
  console.log('add-patients-to-provider-sheets: monthKey parsed', { year, month, payroll })

  if (patients.length === 0) {
    console.log('add-patients-to-provider-sheets: 200 no patients to add, returning added=0')
    return new Response(JSON.stringify({ success: true, added: 0 }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  patients.forEach((p, idx) => {
    console.log('add-patients-to-provider-sheets: patient[' + idx + ']', {
      id: p.id,
      patient_id: p.patient_id,
      first_name: p.first_name,
      last_name: p.last_name,
      insurance: p.insurance,
      copay: p.copay,
      coinsurance: p.coinsurance,
    })
  })

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceRoleKey) {
    console.log('add-patients-to-provider-sheets: 500 missing SUPABASE_SERVICE_ROLE_KEY')
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
    console.log('add-patients-to-provider-sheets: 500 providers fetch failed', providersError.message)
    return new Response(JSON.stringify({ error: providersError.message }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const providerIds = (providersData || []).map((p: { id: string }) => p.id)
  console.log('add-patients-to-provider-sheets: providers for clinic', { providerCount: providerIds.length, providerIds: providerIds.slice(0, 5).map((id) => id.slice(0, 8) + '...') })

  if (providerIds.length === 0) {
    console.log('add-patients-to-provider-sheets: 200 no providers for clinic, returning added=0')
    return new Response(JSON.stringify({ success: true, added: 0 }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  let totalAdded = 0

  // Resolve each patient from the patients table (by id, then by patient_id+clinic_id) so we use canonical data
  const resolvedPatients: PatientPayload[] = []
  for (const p of patients) {
    const id = p?.id
    const patientId = p?.patient_id != null && p.patient_id !== '' ? String(p.patient_id) : null
    let row: Record<string, unknown> | null = null
    let source = 'request'

    if (id && typeof id === 'string') {
      const { data: byId } = await supabase
        .from('patients')
        .select('id, patient_id, first_name, last_name, insurance, copay, coinsurance')
        .eq('id', id)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (byId) {
        row = byId as Record<string, unknown>
        source = 'patients_by_id'
      }
    }
    if (!row && patientId) {
      const { data: byPatientId } = await supabase
        .from('patients')
        .select('id, patient_id, first_name, last_name, insurance, copay, coinsurance')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .maybeSingle()
      if (byPatientId) {
        row = byPatientId as Record<string, unknown>
        source = 'patients_by_patient_id'
      }
    }
    if (row) {
      const dbInsurance = row.insurance != null && row.insurance !== '' ? (row.insurance as string) : null
      const dbCopay = row.copay != null && row.copay !== '' ? (row.copay as string | number) : null
      const dbCoinsurance = row.coinsurance != null && row.coinsurance !== '' ? (row.coinsurance as string | number) : null
      const resolved: PatientPayload = {
        id: row.id as string,
        patient_id: (row.patient_id as string) ?? null,
        first_name: (row.first_name as string) ?? null,
        last_name: (row.last_name as string) ?? null,
        insurance: dbInsurance ?? (p.insurance != null && p.insurance !== '' ? p.insurance : null),
        copay: dbCopay ?? (p.copay != null ? p.copay : null),
        coinsurance: dbCoinsurance ?? (p.coinsurance != null ? p.coinsurance : null),
      }
      resolvedPatients.push(resolved)
      console.log('add-patients-to-provider-sheets: resolved from DB (' + source + ')', {
        patient_id: resolved.patient_id,
        first_name: resolved.first_name,
        last_name: resolved.last_name,
        insurance: resolved.insurance,
        copay: resolved.copay,
        coinsurance: resolved.coinsurance,
      })
    } else {
      resolvedPatients.push(p)
      console.log('add-patients-to-provider-sheets: no row in patients table, using request body', { id, patient_id: patientId })
    }
  }
  const patientsToInsert = resolvedPatients.length > 0 ? resolvedPatients : patients
  console.log('add-patients-to-provider-sheets: patients to insert count=', patientsToInsert.length)

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
      console.log('add-patients-to-provider-sheets: using existing sheet', { providerId: providerId.slice(0, 8) + '...', sheetId: sheet.id })
    } else {
      const { data: newSheet, error: createError } = await supabase
        .from('provider_sheets')
        .insert({ clinic_id: clinicId, provider_id: providerId, month, year, payroll, locked: false, locked_columns: [] })
        .select('id')
        .maybeSingle()
      if (!createError && newSheet) {
        sheet = newSheet
        console.log('add-patients-to-provider-sheets: created new sheet', { providerId: providerId.slice(0, 8) + '...', sheetId: sheet.id })
      } else {
        console.log('add-patients-to-provider-sheets: skip provider, no sheet', { providerId: providerId.slice(0, 8) + '...', createError: createError?.message })
      }
    }

    if (!sheet?.id) continue

    const sheetId = sheet.id
    const { data: existingRows } = await supabase
      .from('provider_sheet_rows')
      .select('id')
      .eq('sheet_id', sheetId)
      .order('sort_order', { ascending: true })

    const currentLength = (existingRows || []).length
    console.log('add-patients-to-provider-sheets: sheet row count', { sheetId, currentLength, toInsert: patientsToInsert.length })

    for (let i = 0; i < patientsToInsert.length; i++) {
      const payload = patientToRowPayload(patientsToInsert[i], sheetId, currentLength + i)
      const { error: insertError } = await supabase.from('provider_sheet_rows').insert(payload)
      if (insertError) {
        console.log('add-patients-to-provider-sheets: 500 insert failed', { providerId: providerId.slice(0, 8) + '...', sheetId, patientIndex: i, error: insertError.message })
        return new Response(JSON.stringify({ error: insertError.message, providerId, patientIndex: i }), {
          status: 500,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        })
      }
      totalAdded += 1
    }
    console.log('add-patients-to-provider-sheets: inserted for provider', { providerId: providerId.slice(0, 8) + '...', inserted: patientsToInsert.length })
  }

  console.log('add-patients-to-provider-sheets: SUCCESS totalAdded=' + totalAdded + ' (patients=' + patientsToInsert.length + ' x providers=' + providerIds.length + ')')
  return new Response(JSON.stringify({ success: true, added: totalAdded }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
})
