// Backup accounts_receivables to Supabase Storage as versioned CSV per clinic. Uses service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'tab-backups'
const PREFIX = 'ar'

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const s = String(val).trim()
  if (s === '' || s.toLowerCase() === 'null') return ''
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** Normalize date to YYYY-MM-DD for CSV so Excel doesn't show #### (e.g. from raw numbers/timestamps). */
function toDateOnly(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const s = String(val).trim()
  if (s === '' || s.toLowerCase() === 'null') return ''
  const n = Number(val)
  if (!Number.isNaN(n) && n > 0) {
    const d = new Date(n > 1e12 ? n : n * 1000)
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const day = String(d.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

/** CSV column headers matching AR tab UI */
const DISPLAY_HEADERS = ['ID', 'Name', 'Date of Service', 'Amount', 'Date Recorded', 'Type', 'Notes']

function rowToDisplayValues(r: Record<string, unknown>): string[] {
  return [
    escapeCsvCell(r.ar_id ?? ''),
    escapeCsvCell(r.name ?? ''),
    escapeCsvCell(toDateOnly(r.date_of_service)),
    escapeCsvCell(r.amount ?? ''),
    escapeCsvCell(toDateOnly(r.date_recorded)),
    escapeCsvCell(r.type ?? ''),
    escapeCsvCell(r.notes ?? ''),
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

  // Only backup current month's data (by created_at) in UTC-7 (Pacific), not UTC.
  const now = new Date()
  const UTC_MINUS_7_HOURS_MS = 7 * 60 * 60 * 1000
  const nowInUtcMinus7 = new Date(now.getTime() - UTC_MINUS_7_HOURS_MS)
  const y = nowInUtcMinus7.getUTCFullYear()
  const m = nowInUtcMinus7.getUTCMonth()
  // Start of month in UTC-7 = (y, m, 1) 00:00 UTC-7 = 07:00 UTC that day
  const startOfMonth = new Date(Date.UTC(y, m, 1) + UTC_MINUS_7_HOURS_MS)
  // End of month in UTC-7 = last day 23:59:59.999 UTC-7 = next month 1st 07:00 UTC - 1ms
  const endOfMonth = new Date(Date.UTC(y, m + 1, 1) + UTC_MINUS_7_HOURS_MS - 1)
  const createdSince = startOfMonth.toISOString()
  const createdUntil = endOfMonth.toISOString()

  for (const clinicId of clinicIds) {
    const { data: rows, error: rowsError } = await supabase
      .from('accounts_receivables')
      .select('*')
      .eq('clinic_id', clinicId)
      .gte('created_at', createdSince)
      .lte('created_at', createdUntil)
      .order('date_recorded', { ascending: true })

    if (rowsError) {
      errors.push(`clinic ${clinicId}: ${rowsError.message}`)
      continue
    }
    const rowMaps = (rows || []).map((r: Record<string, unknown>) => ({ ...r }))

    const { data: maxVersion } = await supabase.from('ar_backups').select('version').eq('clinic_id', clinicId).order('version', { ascending: false }).limit(1).maybeSingle()
    const nextVersion = (maxVersion?.version ?? 0) + 1
    const filePath = `${PREFIX}/${clinicId}/v${nextVersion}.csv`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, new TextEncoder().encode(rowsToCsv(rowMaps)), { contentType: 'text/csv', upsert: true })
    if (uploadError) {
      errors.push(`clinic ${clinicId} upload: ${uploadError.message}`)
      continue
    }
    const { error: insertError } = await supabase.from('ar_backups').insert({ clinic_id: clinicId, version: nextVersion, file_path: filePath })
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
