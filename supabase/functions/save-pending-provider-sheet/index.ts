// Save pending provider sheet rows on page unload (keepalive). Called from client with fetch(..., { keepalive: true }).
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Caller must send Bearer JWT (verified then we use service role to write).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}

interface Body {
  clinicId?: string
  providerId?: string
  selectedMonthKey?: string
  rows?: Record<string, unknown>[]
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

/** selectedMonthKey: "2025-3" or "2025-3-2" -> { year, month, payroll } */
function parseMonthKey(selectedMonthKey: string): { year: number; month: number; payroll: number } | null {
  const parts = selectedMonthKey.split('-').map((p) => parseInt(p, 10))
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
  const year = parts[0]
  const month = parts[1]
  const payroll = parts.length >= 3 && Number.isFinite(parts[2]) ? parts[2] : 1
  return { year, month, payroll }
}

function rowToDbPayload(
  row: Record<string, unknown>,
  sheetId: string,
  sortOrder: number
): Record<string, unknown> {
  const get = (k: string) => (row[k] === undefined || row[k] === 'null' ? null : row[k])
  const num = (k: string) => {
    const v = row[k]
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isNaN(n) ? null : n
  }
  return {
    sheet_id: sheetId,
    sort_order: sortOrder,
    patient_id: get('patient_id'),
    appointment_date: get('appointment_date'),
    appointment_time: get('appointment_time'),
    visit_type: get('visit_type'),
    notes: get('notes'),
    billing_code: get('billing_code'),
    billing_code_color: get('billing_code_color'),
    cpt_code: get('cpt_code'),
    cpt_code_color: get('cpt_code_color'),
    appointment_status: get('appointment_status'),
    appointment_status_color: get('appointment_status_color'),
    claim_status: get('claim_status'),
    claim_status_color: get('claim_status_color'),
    submit_date: get('submit_date'),
    insurance_payment: get('insurance_payment'),
    insurance_adjustment: get('insurance_adjustment'),
    invoice_amount: num('invoice_amount'),
    collected_from_patient: get('collected_from_patient'),
    patient_pay_status: get('patient_pay_status'),
    patient_pay_status_color: get('patient_pay_status_color'),
    payment_date: get('payment_date'),
    payment_date_color: get('payment_date_color'),
    ar_type: get('ar_type'),
    ar_amount: num('ar_amount'),
    ar_date: get('ar_date'),
    ar_date_color: get('ar_date_color'),
    ar_notes: get('ar_notes'),
    provider_payment_amount: num('provider_payment_amount'),
    provider_payment_date: get('provider_payment_date'),
    provider_payment_notes: get('provider_payment_notes'),
    highlight_color: get('highlight_color'),
    total: row.total != null ? String(row.total) : null,
  }
}

function rowHasData(row: Record<string, unknown>): boolean {
  const id = String(row.id ?? '')
  if (!id.startsWith('empty-')) return true
  return !!(
    row.patient_id ||
    row.appointment_date ||
    row.cpt_code ||
    row.appointment_status ||
    row.claim_status ||
    row.submit_date ||
    row.insurance_payment ||
    row.payment_date ||
    row.insurance_adjustment ||
    row.collected_from_patient ||
    row.patient_pay_status ||
    row.ar_date ||
    row.total !== null ||
    row.notes
  )
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

  const clinicId = typeof body.clinicId === 'string' ? body.clinicId.trim() : ''
  const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
  const selectedMonthKey = typeof body.selectedMonthKey === 'string' ? body.selectedMonthKey.trim() : ''
  const rows = Array.isArray(body.rows) ? body.rows : []

  if (!clinicId || !providerId || !selectedMonthKey) {
    return new Response(JSON.stringify({ error: 'Missing clinicId, providerId, or selectedMonthKey' }), {
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

  const rowsToProcess = rows
    .filter((r) => typeof r === 'object' && r !== null && rowHasData(r as Record<string, unknown>))
    .map((r) => r as Record<string, unknown>)

  if (rowsToProcess.length === 0) {
    return new Response(JSON.stringify({ success: true, saved: 0 }), {
      status: 200,
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: sheet, error: sheetError } = await supabase
    .from('provider_sheets')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .eq('month', parsed.month)
    .eq('year', parsed.year)
    .eq('payroll', parsed.payroll)
    .maybeSingle()

  if (sheetError || !sheet?.id) {
    return new Response(JSON.stringify({ error: 'Sheet not found for this clinic/provider/month' }), {
      status: 404,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const sheetId = sheet.id
  const savedIds: string[] = []

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i]
    const id = String(row.id ?? '')
    const payload = rowToDbPayload(row, sheetId, i)

    if (isUuid(id)) {
      const { data: updated, error: updateError } = await supabase
        .from('provider_sheet_rows')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('sheet_id', sheetId)
        .select('id')
        .maybeSingle()

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        })
      }
      if (updated?.id) savedIds.push(updated.id)
      else savedIds.push(id)
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('provider_sheet_rows')
        .insert(payload)
        .select('id')
        .single()

      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        })
      }
      if (inserted?.id) savedIds.push(inserted.id)
    }
  }

  const { data: existing } = await supabase
    .from('provider_sheet_rows')
    .select('id')
    .eq('sheet_id', sheetId)
  const existingIds = (existing || []).map((r: { id: string }) => r.id)
  const idsToDelete = existingIds.filter((id) => !savedIds.includes(id))
  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase.from('provider_sheet_rows').delete().in('id', idsToDelete)
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      })
    }
  }

  return new Response(JSON.stringify({ success: true, saved: savedIds.length }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
})
