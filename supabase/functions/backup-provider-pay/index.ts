// Backup provider_pay + provider_pay_rows to Supabase Storage as versioned CSV per clinic. Uses service role.
// CSV: one row per provider_pay_rows row with header fields (clinic_id, provider_id, year, month, payroll, pay_date, pay_period, notes, row_index, description, amount, notes).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'tab-backups'
const PREFIX = 'provider-pay'

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const s = String(val).trim()
  if (s === '' || s.toLowerCase() === 'null') return ''
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

const COLS = ['clinic_id', 'provider_id', 'year', 'month', 'payroll', 'pay_date', 'pay_period', 'header_notes', 'row_index', 'description', 'amount', 'notes']

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
  }
  const cronSecret = Deno.env.get('BACKUP_CRON_SECRET')
  let body: { cron_secret?: string } = {}
  try { body = (await req.json()) as { cron_secret?: string } } catch { /* empty */ }
  if (!cronSecret || body.cron_secret !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 52428800 }).catch(() => {})

  const { data: clinics } = await supabase.from('clinics').select('id')
  const clinicIds = (clinics || []).map((c: { id: string }) => c.id)
  let backedUp = 0
  const errors: string[] = []

  for (const clinicId of clinicIds) {
    const { data: headers, error: headerError } = await supabase
      .from('provider_pay')
      .select('id, clinic_id, provider_id, year, month, payroll, pay_date, pay_period, notes')
      .eq('clinic_id', clinicId)
      .order('year', { ascending: true })
      .order('month', { ascending: true })
      .order('provider_id', { ascending: true })

    if (headerError) {
      errors.push(`clinic ${clinicId}: ${headerError.message}`)
      continue
    }
    const flatRows: Record<string, unknown>[] = []
    for (const h of headers || []) {
      const { data: rowData } = await supabase
        .from('provider_pay_rows')
        .select('row_index, description, amount, notes')
        .eq('provider_pay_id', h.id)
        .order('row_index', { ascending: true })
      for (const r of rowData || []) {
        flatRows.push({
          clinic_id: h.clinic_id,
          provider_id: h.provider_id,
          year: h.year,
          month: h.month,
          payroll: h.payroll ?? 1,
          pay_date: h.pay_date,
          pay_period: h.pay_period,
          header_notes: h.notes,
          row_index: r.row_index,
          description: r.description,
          amount: r.amount,
          notes: r.notes,
        })
      }
      if (!rowData || rowData.length === 0) {
        flatRows.push({
          clinic_id: h.clinic_id,
          provider_id: h.provider_id,
          year: h.year,
          month: h.month,
          payroll: h.payroll ?? 1,
          pay_date: h.pay_date,
          pay_period: h.pay_period,
          header_notes: h.notes,
          row_index: 0,
          description: '',
          amount: '',
          notes: '',
        })
      }
    }

    const { data: maxVersion } = await supabase.from('provider_pay_backups').select('version').eq('clinic_id', clinicId).order('version', { ascending: false }).limit(1).maybeSingle()
    const nextVersion = (maxVersion?.version ?? 0) + 1
    const filePath = `${PREFIX}/${clinicId}/v${nextVersion}.csv`
    const headerLine = COLS.map((c) => escapeCsvCell(c)).join(',')
    const bodyLines = flatRows.map((r) => COLS.map((c) => escapeCsvCell(r[c] ?? null)).join(','))
    const csv = headerLine + '\n' + bodyLines.join('\n')
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, new TextEncoder().encode(csv), { contentType: 'text/csv', upsert: true })
    if (uploadError) {
      errors.push(`clinic ${clinicId} upload: ${uploadError.message}`)
      continue
    }
    const { error: insertError } = await supabase.from('provider_pay_backups').insert({ clinic_id: clinicId, version: nextVersion, file_path: filePath })
    if (insertError) {
      errors.push(`clinic ${clinicId} insert: ${insertError.message}`)
      continue
    }
    backedUp++
  }

  return new Response(JSON.stringify({ success: true, clinics_total: clinicIds.length, backed_up: backedUp, errors: errors.length > 0 ? errors : undefined }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
})
