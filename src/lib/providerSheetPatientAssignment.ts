import type { SupabaseClient } from '@supabase/supabase-js'
import type { SheetRow } from '@/types'

export type PatientAssignmentRecord = { id: string; patient_id: string; provider_id: string | null }

/** Prevents double alerts when the grid rejects an ID and the debounced save validates the same ID moments later. */
const WRONG_PROVIDER_ALERT_DEDUPE_MS = 4000
let wrongProviderAlertLastKey = ''
let wrongProviderAlertLastAt = 0

export function alertPatientIdWrongProviderDeduped(patientIdDisplay: string): void {
  const key = String(patientIdDisplay ?? '').trim().toLowerCase()
  if (!key) return
  const t = Date.now()
  if (key === wrongProviderAlertLastKey && t - wrongProviderAlertLastAt < WRONG_PROVIDER_ALERT_DEDUPE_MS) return
  wrongProviderAlertLastKey = key
  wrongProviderAlertLastAt = t
  alert(
    `Patient ID "${patientIdDisplay}" is already assigned to another provider in this clinic. They cannot be added to this provider's sheet.`
  )
}

export async function loadPatientsAssignmentMap(
  supabase: SupabaseClient,
  clinicId: string
): Promise<Map<string, PatientAssignmentRecord>> {
  const { data, error } = await supabase
    .from('patients')
    .select('id, patient_id, provider_id')
    .eq('clinic_id', clinicId)

  if (error) throw error

  const map = new Map<string, PatientAssignmentRecord>()
  for (const p of data || []) {
    const key = String(p.patient_id ?? '').trim().toLowerCase()
    if (!key) continue
    map.set(key, {
      id: p.id as string,
      patient_id: String(p.patient_id),
      provider_id: (p.provider_id as string | null) ?? null,
    })
  }
  return map
}

export function validatePatientIdsForProviderSheet(
  rows: SheetRow[],
  sheetProviderId: string,
  patientMap: Map<string, PatientAssignmentRecord>
): { ok: true } | { ok: false; conflictingPatientId: string } {
  const checked = new Set<string>()
  for (const row of rows) {
    const pid =
      row.patient_id != null && String(row.patient_id).trim() !== '' ? String(row.patient_id).trim() : ''
    if (!pid) continue
    const key = pid.toLowerCase()
    if (checked.has(key)) continue
    checked.add(key)

    const rec = patientMap.get(key)
    if (rec?.provider_id && rec.provider_id !== sheetProviderId) {
      return {
        ok: false,
        conflictingPatientId: rec.patient_id,
      }
    }
  }
  return { ok: true }
}

export async function claimUnassignedPatientsForProvider(
  supabase: SupabaseClient,
  clinicId: string,
  sheetProviderId: string,
  rows: SheetRow[],
  patientMap: Map<string, PatientAssignmentRecord>
): Promise<void> {
  const keys = new Set<string>()
  for (const row of rows) {
    const pid =
      row.patient_id != null && String(row.patient_id).trim() !== '' ? String(row.patient_id).trim() : ''
    if (pid) keys.add(pid.toLowerCase())
  }

  for (const key of keys) {
    const rec = patientMap.get(key)
    if (!rec || rec.provider_id) continue

    const { error } = await supabase
      .from('patients')
      .update({ provider_id: sheetProviderId, updated_at: new Date().toISOString() })
      .eq('id', rec.id)
      .eq('clinic_id', clinicId)
      .is('provider_id', null)

    if (error) {
      console.error('[claimUnassignedPatientsForProvider]', error)
      continue
    }
    rec.provider_id = sheetProviderId
  }
}
