import type { SupabaseClient } from '@supabase/supabase-js'
import type { SheetRow } from '@/types'

function normalizeStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function normalizeNumLike(v: unknown): string | number | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Push co-patient demographics from provider sheet rows into `patients` (last-write-wins per save batch).
 * Rows whose patient_id is not in `patients` (private patients) are skipped.
 */
export async function syncCoPatientsFromProviderSheetRows(
  supabase: SupabaseClient,
  clinicId: string,
  rows: SheetRow[]
): Promise<void> {
  if (!rows.length) return

  const patientIds = Array.from(
    new Set(
      rows
        .map((r) => (r.patient_id != null ? String(r.patient_id).trim() : ''))
        .filter((pid) => pid !== '')
    )
  )
  if (patientIds.length === 0) return

  const { data: existingPatients, error: fetchError } = await supabase
    .from('patients')
    .select('id, patient_id, first_name, last_name, insurance, copay, coinsurance')
    .eq('clinic_id', clinicId)
    .in('patient_id', patientIds)
  if (fetchError) {
    console.error('[syncCoPatientsFromProviderSheetRows] fetch failed', fetchError)
    return
  }

  const patientByIdKey = new Map<
    string,
    {
      id: string
      patient_id: string
      first_name: string | null
      last_name: string | null
      insurance: string | null
      copay: string | number | null
      coinsurance: string | number | null
    }
  >()
  for (const p of existingPatients || []) {
    const key = String(p.patient_id ?? '').trim().toLowerCase()
    if (!key) continue
    patientByIdKey.set(key, p as {
      id: string
      patient_id: string
      first_name: string | null
      last_name: string | null
      insurance: string | null
      copay: string | number | null
      coinsurance: string | number | null
    })
  }

  /** Last row in `rows` wins per patient_id (case-insensitive key). */
  const lastRowByKey = new Map<string, SheetRow>()
  for (const row of rows) {
    const rowPatientId = row.patient_id != null ? String(row.patient_id).trim() : ''
    if (!rowPatientId) continue
    const key = rowPatientId.toLowerCase()
    if (!patientByIdKey.has(key)) continue
    lastRowByKey.set(key, row)
  }

  for (const [key, row] of lastRowByKey) {
    const existing = patientByIdKey.get(key)
    if (!existing) continue

    const nextFirstName = normalizeStr(row.patient_first_name)
    const nextInsurance = normalizeStr(row.patient_insurance)
    const nextCopay = normalizeNumLike(row.patient_copay)
    const nextCoinsurance = normalizeNumLike(row.patient_coinsurance)

    const payload = {
      first_name: nextFirstName,
      insurance: nextInsurance,
      copay: nextCopay,
      coinsurance: nextCoinsurance,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('patients')
      .update(payload)
      .eq('id', existing.id)
      .eq('clinic_id', clinicId)
    if (error) {
      console.error('[syncCoPatientsFromProviderSheetRows] update failed', { patientDbId: existing.id, error })
    }
  }
}
