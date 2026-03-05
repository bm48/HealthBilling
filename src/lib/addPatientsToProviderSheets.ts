/**
 * Call the add-patients-to-provider-sheets Edge Function to add new patients
 * to all provider sheets for the given clinic/month. Used after saving multiple
 * patients in Patient Info so the server applies the batch in one place.
 */

import { supabase } from '@/lib/supabase'
import type { Patient } from '@/types'

export interface AddPatientsToProviderSheetsParams {
  clinicId: string
  selectedMonthKey: string
  patients: Pick<Patient, 'id' | 'patient_id' | 'first_name' | 'last_name' | 'insurance' | 'copay' | 'coinsurance'>[]
}

export interface AddPatientsToProviderSheetsResult {
  success: boolean
  added?: number
  error?: string
}

export async function addPatientsToProviderSheets(
  params: AddPatientsToProviderSheetsParams
): Promise<AddPatientsToProviderSheetsResult> {
  const { clinicId, selectedMonthKey, patients } = params

  const { data: refreshed } = await supabase.auth.refreshSession()
  const token = refreshed?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token
  if (!token) {
    return { success: false, error: 'You must be signed in.' }
  }

  // Prefer same-origin API route so it works on Vercel (serverless proxy) and in dev (Vite proxy)
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const url =
    typeof window !== 'undefined'
      ? '/api/add-patients-to-provider-sheets'
      : supabaseUrl
        ? `${supabaseUrl}/functions/v1/add-patients-to-provider-sheets`
        : ''
  if (!url) {
    return { success: false, error: 'App is not configured for provider sheets.' }
  }

  const body = JSON.stringify({
    clinicId,
    selectedMonthKey,
    patients: patients.map((p) => ({
      id: p.id,
      patient_id: p.patient_id ?? null,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      insurance: p.insurance ?? null,
      copay: p.copay ?? null,
      coinsurance: p.coinsurance ?? null,
    })),
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { success: false, error: (data.error as string) || 'Failed to add patients to provider sheets.' }
  }
  return { success: true, added: data.added as number }
}
