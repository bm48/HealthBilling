// Backup provider sheet rows to Supabase Storage as versioned CSV files.
// Invoked by pg_cron every 12 hours (or manually with cron_secret). Uses service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'provider-sheet-backups'

// CSV: UI headers and corresponding DB column names (same order). Tele = visit_type, between cpt code and appt/note status.
const CSV_HEADERS = [
  'ID', 'First Name', 'LI', 'Ins', 'Co-pay', 'Co-ins', 'Date of Service', 'Cpt Code', 'Tele', 'Appt/Note Status',
  'Claim Status', 'Most Recent', 'Ins Pay', 'Ins Pay Date', 'Pt Res', 'Pt Paid', 'Pt Pay Status',
  'Pt Payment Ar Ref Date', 'Total', 'Notes',
]
const CSV_DB_COLUMNS = [
  'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
  'appointment_date', 'cpt_code', 'visit_type', 'appointment_status', 'claim_status', 'submit_date', 'insurance_payment',
  'payment_date', 'invoice_amount', 'collected_from_patient', 'patient_pay_status', 'payment_date_color',
  'total', 'notes',
]

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

const USD_COLUMNS = new Set(['patient_copay', 'insurance_payment', 'invoice_amount', 'collected_from_patient', 'total'])

/** Format value for CSV to match UI: copay/ins pay/pt paid/total as USD ($0.00), coinsurance as percentage (0%). */
function formatCsvValue(col: string, val: unknown): unknown {
  if (val === null || val === undefined || val === '') return val
  const str = String(val).trim()
  if (str === '' || str === 'null') return val
  const num = parseFloat(str)
  if (USD_COLUMNS.has(col) && !Number.isNaN(num)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
  }
  if (col === 'patient_coinsurance' && !Number.isNaN(num)) {
    return `${num}%`
  }
  return val
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  const header = CSV_HEADERS.map((h) => escapeCsvCell(h)).join(',')
  const body = rows
    .map((row) =>
      CSV_DB_COLUMNS.map((col) => escapeCsvCell(formatCsvValue(col, row[col]))).join(',')
    )
    .join('\n')
  return header + '\n' + body
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

  const cronSecret = Deno.env.get('BACKUP_CRON_SECRET')
  let body: { cron_secret?: string } = {}
  try {
    body = (await req.json()) as { cron_secret?: string }
  } catch {
    // empty body is ok
  }
  if (!cronSecret || body.cron_secret !== cronSecret) {
    console.warn('backup-provider-sheets: Unauthorized (missing or invalid cron_secret)')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
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

  console.log('backup-provider-sheets: run started')

  // Ensure bucket exists (idempotent)
  await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 52428800 }).catch(() => {})

  // Fetch all provider_sheets (optionally limit to recent months to keep run time bounded)
  const { data: sheets, error: sheetsError } = await supabase
    .from('provider_sheets')
    .select('id')
  if (sheetsError) {
    console.error('backup-provider-sheets: FAILED to fetch sheets', sheetsError.message)
    return new Response(JSON.stringify({ error: sheetsError.message }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const sheetIds = (sheets || []).map((s: { id: string }) => s.id)
  console.log('backup-provider-sheets: sheets to backup:', sheetIds.length)
  let backedUp = 0
  let errors: string[] = []

  for (const sheetId of sheetIds) {
    const { data: rows, error: rowsError } = await supabase
      .from('provider_sheet_rows')
      .select('*')
      .eq('sheet_id', sheetId)
      .order('sort_order', { ascending: true })

    if (rowsError) {
      const msg = `sheet ${sheetId}: ${rowsError.message}`
      errors.push(msg)
      console.error('backup-provider-sheets:', msg)
      continue
    }

    const rowMaps = (rows || []).map((r: Record<string, unknown>) => ({ ...r }))

    // Next version for this sheet
    const { data: maxVersion } = await supabase
      .from('provider_sheet_backups')
      .select('version')
      .eq('sheet_id', sheetId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextVersion = (maxVersion?.version ?? 0) + 1

    const csv = rowsToCsv(rowMaps)
    const filePath = `${sheetId}/v${nextVersion}.csv`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, new TextEncoder().encode(csv), {
        contentType: 'text/csv',
        upsert: true,
      })

    if (uploadError) {
      const msg = `sheet ${sheetId} upload: ${uploadError.message}`
      errors.push(msg)
      console.error('backup-provider-sheets:', msg)
      continue
    }

    const { error: insertError } = await supabase.from('provider_sheet_backups').insert({
      sheet_id: sheetId,
      version: nextVersion,
      file_path: filePath,
    })

    if (insertError) {
      const msg = `sheet ${sheetId} insert: ${insertError.message}`
      errors.push(msg)
      console.error('backup-provider-sheets:', msg)
      continue
    }
    backedUp += 1
    console.log('backup-provider-sheets: backed up sheet', sheetId.slice(0, 8) + '...', 'v' + nextVersion)
  }

  if (errors.length > 0) {
    console.warn('backup-provider-sheets: BACKUP_COMPLETED_WITH_ERRORS', { sheets_total: sheetIds.length, backed_up: backedUp, errors })
  } else {
    console.log('backup-provider-sheets: BACKUP_SUCCESS', { sheets_total: sheetIds.length, backed_up: backedUp })
  }

  return new Response(
    JSON.stringify({
      success: true,
      sheets_total: sheetIds.length,
      backed_up: backedUp,
      errors: errors.length > 0 ? errors : undefined,
    }),
    {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    }
  )
})
