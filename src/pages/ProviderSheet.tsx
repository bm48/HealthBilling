import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { SheetRow, ProviderSheet as ProviderSheetType, BillingCode, Patient } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import ProviderSheetTable from '@/components/ProviderSheetTable'
import { Calendar, Lock, Unlock } from 'lucide-react'

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

  useEffect(() => {
    if (providerId) {
      fetchSheet()
      fetchBillingCodes()
      fetchPatients()
    }
  }, [providerId, month, year])

  const fetchSheet = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('provider_id', providerId)
        .eq('month', month)
        .eq('year', year)
        .single()

      if (error && error.code !== 'PGRST116') throw error

      if (data) {
        setSheet(data)
        setRows(Array.isArray(data.row_data) ? data.row_data : [])
      } else {
        // Create new sheet for selected month
        const newSheet = {
          provider_id: providerId,
          clinic_id: userProfile?.clinic_ids[0] || '',
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

        if (createError) throw createError
        setSheet(created)
        setRows([])
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
    if (!userProfile?.clinic_ids.length) return

    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .in('clinic_id', userProfile.clinic_ids)
        .order('last_name')

      if (error) throw error
      setPatients(data || [])
    } catch (error) {
      console.error('Error fetching patients:', error)
    }
  }

  const saveSheet = useCallback(async () => {
    if (!sheet) return

    try {
      setSaving(true)
      const { error } = await supabase
        .from('provider_sheets')
        .update({
          row_data: rows,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sheet.id)

      if (error) throw error
    } catch (error) {
      console.error('Error saving sheet:', error)
      alert('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [sheet, rows])

  const handleUpdateRow = useCallback((rowId: string, field: string, value: any) => {
    setRows(prevRows => {
      const updated = prevRows.map(row => {
        if (row.id === rowId) {
          return { ...row, [field]: value, updated_at: new Date().toISOString() }
        }
        return row
      })
      // Auto-save after a short delay
      setTimeout(() => saveSheet(), 1000)
      return updated
    })
  }, [saveSheet])

  const handleAddRow = useCallback(() => {
    const newRow: SheetRow = {
      id: `row-${Date.now()}`,
      patient_id: null,
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
    setTimeout(() => saveSheet(), 500)
  }, [saveSheet])

  const handleDeleteRow = useCallback((rowId: string) => {
    if (confirm('Are you sure you want to delete this row?')) {
      setRows(prev => prev.filter(row => row.id !== rowId))
      setTimeout(() => saveSheet(), 500)
    }
  }, [saveSheet])

  const isOwnSheet = userProfile?.id === providerId
  const canEdit = userProfile?.role === 'super_admin' || 
                  (userProfile?.role === 'admin' && userProfile.clinic_ids.includes(sheet?.clinic_id || '')) ||
                  (userProfile?.role === 'billing_staff' && userProfile.clinic_ids.includes(sheet?.clinic_id || '')) ||
                  (userProfile?.role === 'provider' && isOwnSheet) ||
                  (userProfile?.role === 'office_staff' && userProfile.clinic_ids.includes(sheet?.clinic_id || ''))

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!sheet) {
    return <div>Sheet not found</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Provider Schedule & Billing Sheet</h1>
        {saving && (
          <span className="text-sm text-gray-600">Saving...</span>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={20} className="text-gray-600" />
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {sheet.locked && (
            <div className="flex items-center gap-2 text-orange-600">
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
        />
      </div>
    </div>
  )
}
