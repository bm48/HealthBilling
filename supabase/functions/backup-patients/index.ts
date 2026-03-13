// Backup patients to Supabase Storage as versioned CSV per clinic. Uses service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'tab-backups'
const PREFIX = 'patients'

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const s = String(val).trim()
  if (s === '' || s.toLowerCase() === 'null') return ''
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** CSV column headers matching Patient Info tab UI */
const DISPLAY_HEADERS = ['Patient ID', 'Patient First', 'Patient Last', 'Insurance', 'Copay', 'Coinsurance']

function formatCopay(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const n = typeof val === 'number' ? val : Number(String(val).trim())
  if (Number.isNaN(n)) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function formatCoinsurance(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const n = typeof val === 'number' ? val : Number(String(val).trim())
  if (Number.isNaN(n)) return ''
  return `${Number(n).toFixed(2)}%`
}

function rowToDisplayValues(r: Record<string, unknown>): string[] {
  return [
    escapeCsvCell(r.patient_id ?? ''),
    escapeCsvCell(r.first_name ?? ''),
    escapeCsvCell(r.last_name ?? ''),
    escapeCsvCell(r.insurance ?? ''),
    escapeCsvCell(formatCopay(r.copay)),
    escapeCsvCell(formatCoinsurance(r.coinsurance)),
  ]
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  const header = DISPLAY_HEADERS.map((c) => escapeCsvCell(c)).join(',')
  const body = rows.map((r) => rowToDisplayValues(r).join(',')).join('\n')
  return header + '\n' + body
}

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
    const { data: rows, error: rowsError } = await supabase.from('patients').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false })
    if (rowsError) {
      errors.push(`clinic ${clinicId}: ${rowsError.message}`)
      continue
    }
    const rowMaps = (rows || []).map((r: Record<string, unknown>) => ({ ...r }))

    const { data: maxVersion } = await supabase.from('patients_backups').select('version').eq('clinic_id', clinicId).order('version', { ascending: false }).limit(1).maybeSingle()
    const nextVersion = (maxVersion?.version ?? 0) + 1
    const filePath = `${PREFIX}/${clinicId}/v${nextVersion}.csv`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, new TextEncoder().encode(rowsToCsv(rowMaps)), { contentType: 'text/csv', upsert: true })
    if (uploadError) {
      errors.push(`clinic ${clinicId} upload: ${uploadError.message}`)
      continue
    }
    const { error: insertError } = await supabase.from('patients_backups').insert({ clinic_id: clinicId, version: nextVersion, file_path: filePath })
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
