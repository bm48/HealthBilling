import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { SheetRow, ProviderSheet as ProviderSheetType, BillingCode, Patient } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import ProviderSheetTable from '@/components/ProviderSheetTable'
import { Calendar, Lock } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'

export default function ProviderSheet() {
  const { providerId } = useParams()
  const { userProfile } = useAuth()
  const [sheet, setSheet] = useState<ProviderSheetType | null>(null)
  const [rows, setRows] = useState<SheetRow[]>([])
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showColumnsJ_M, setShowColumnsJ_M] = useState(true)
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null)

  useEffect(() => {
    // providerId from URL params is required - it must be a provider ID from the providers table
    if (providerId) {
      fetchSheet()
      fetchBillingCodes()
      fetchPatients()
    } else if (!loading) {
      setLoading(false)
    }
  }, [providerId, month, year])

  const fetchSheet = async () => {
    // providerId must be provided and must be from the providers table, not users table
    if (!providerId) {
      setLoading(false)
      return
    }
    
    const effectiveProviderId = providerId

    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('provider_id', effectiveProviderId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') {
        setLoading(false)
        return
      }

      if (data) {
        setSheet(data)
        setRows(Array.isArray(data.row_data) ? data.row_data : [])
      } else {
        // Verify that the provider_id exists in the providers table before creating
        const { data: provider, error: providerCheckError } = await supabase
          .from('providers')
          .select('id')
          .eq('id', effectiveProviderId)
          .maybeSingle()

        if (providerCheckError && providerCheckError.code !== 'PGRST116') {
          setLoading(false)
          return
        }

        if (!provider) {
          alert(`Error: The provider ID does not exist in the providers table. Please ensure the provider exists before creating a sheet.`)
          setLoading(false)
          return
        }

        // For Super Admin, we need to get a clinic_id first
        let clinicId = userProfile?.clinic_ids[0]
        
        // If Super Admin has no clinic_ids, get the first clinic
        if (!clinicId && userProfile?.role === 'super_admin') {
          const { data: clinics, error: clinicError } = await supabase
            .from('clinics')
            .select('id')
            .limit(1)
            .maybeSingle()
          
          if (clinicError && clinicError.code !== 'PGRST116') {
            // Error fetching clinic
          } else if (clinics) {
            clinicId = clinics.id
          }
        }

        // Only create if we have a clinic_id
        if (clinicId) {
          const newSheet = {
            provider_id: effectiveProviderId,
            clinic_id: clinicId,
            month: month,
            year: year,
            row_data: [],
            locked: false,
            locked_columns: [],
          }
          const { data: created, error: createError } = await supabase
            .from('provider_sheets')
            .insert(newSheet)
            .select()
            .single()

          if (createError) {
            console.error('Error creating sheet:', createError)
            if (createError.code === '23503') {
              alert(`Error: The provider ID does not exist in the providers table. Please ensure the provider exists before creating a sheet.`)
            } else {
              alert(`Error creating sheet: ${createError.message}`)
            }
            setLoading(false)
            return
          }
          setSheet(created)
          setRows([])
        } else {
          console.error('No clinic ID available to create sheet')
          alert('Error: No clinic ID available to create sheet. Please ensure you are assigned to a clinic.')
        }
      }
    } catch (error) {
      console.error('Error fetching sheet:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchBillingCodes = async () => {
    try {
      const { data, error } = await supabase
        .from('billing_codes')
        .select('*')
        .order('code')

      if (error) throw error
      setBillingCodes(data || [])
    } catch (error) {
      console.error('Error fetching billing codes:', error)
    }
  }

  const fetchPatients = async () => {
    try {
      let query = supabase.from('patients').select('*')
      
      // For Super Admin, get all patients
      if (userProfile?.role === 'super_admin') {
        // No filter needed - Super Admin can see all
      } else if (userProfile?.clinic_ids.length) {
        query = query.in('clinic_id', userProfile.clinic_ids)
      } else {
        return // No clinic access
      }

      const { data, error } = await query.order('last_name')

      if (error) throw error
      setPatients(data || [])
    } catch (error) {
      console.error('Error fetching patients:', error)
    }
  }

  const saveSheet = useCallback(async (dataToSave: SheetRow[]) => {
    if (!sheet) return

    try {
      setSaving(true)
      const { error } = await supabase
        .from('provider_sheets')
        .update({
          row_data: dataToSave,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sheet.id)

      if (error) throw error
    } catch (error) {
      console.error('Error saving sheet:', error)
      // Don't show alert for auto-save failures, just log
    } finally {
      setSaving(false)
    }
  }, [sheet])

  // Use debounced auto-save hook - only save when not editing
  const { saveImmediately } = useDebouncedSave<SheetRow[]>(saveSheet, rows, 1000, editingCell !== null)

  const handleUpdateRow = useCallback((rowId: string, field: string, value: any) => {
    setRows(prevRows => {
      const updated = prevRows.map(row => {
        if (row.id === rowId) {
          return { ...row, [field]: value, updated_at: new Date().toISOString() }
        }
        return row
      })
      // Auto-save is handled by useDebouncedSave hook
      return updated
    })
  }, [])

  const handleAddRow = useCallback(() => {
    const newRow: SheetRow = {
      id: `row-${Date.now()}`,
      patient_id: null,
      patient_first_name: null,
      patient_last_name: null,
      patient_insurance: null,
      patient_copay: null,
      patient_coinsurance: null,
      appointment_date: null,
      appointment_time: null,
      visit_type: null,
      notes: null,
      billing_code: null,
      billing_code_color: null,
      appointment_status: null,
      claim_status: null,
      submit_date: null,
      insurance_payment: null,
      insurance_adjustment: null,
      invoice_amount: null,
      collected_from_patient: null,
      patient_pay_status: null,
      payment_date: null,
      ar_type: null,
      ar_amount: null,
      ar_date: null,
      ar_notes: null,
      provider_payment_amount: null,
      provider_payment_date: null,
      provider_payment_notes: null,
      highlight_color: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setRows(prev => [...prev, newRow])
    // Auto-save is handled by useDebouncedSave hook
  }, [])

  const handleDeleteRow = useCallback((rowId: string) => {
    if (confirm('Are you sure you want to delete this row?')) {
      setRows(prev => prev.filter(row => row.id !== rowId))
      // Auto-save is handled by useDebouncedSave hook
    }
  }, [])

  const effectiveProviderId = providerId || userProfile?.id
  const isOwnSheet = userProfile?.id === effectiveProviderId

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  if (!sheet) {
    return (
      <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 border border-white/20">
        <p className="text-white">Sheet not found. Please select a provider first.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Provider Schedule & Billing Sheet</h1>
        {saving && (
          <span className="text-sm text-white/70">Saving...</span>
        )}
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 mb-6 border border-white/20">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={20} className="text-white/70" />
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m} className="bg-slate-900">
                  {new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                <option key={y} value={y} className="bg-slate-900">{y}</option>
              ))}
            </select>
          </div>

          {sheet.locked && (
            <div className="flex items-center gap-2 text-orange-400">
              <Lock size={20} />
              <span className="text-sm font-medium">Sheet is locked</span>
            </div>
          )}
        </div>

        <ProviderSheetTable
          rows={rows}
          onUpdateRow={handleUpdateRow}
          onAddRow={handleAddRow}
          onDeleteRow={handleDeleteRow}
          role={userProfile?.role || 'provider'}
          isOwnSheet={isOwnSheet}
          lockedColumns={sheet.locked_columns}
          billingCodes={billingCodes}
          patients={patients}
          showColumnsJ_M={showColumnsJ_M}
          onToggleColumnsJ_M={() => setShowColumnsJ_M(!showColumnsJ_M)}
          onBlur={saveImmediately}
          onEditingChange={setEditingCell}
        />
      </div>
    </div>
  )
}
