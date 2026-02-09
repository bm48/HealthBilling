import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchSheetRows, saveSheetRows } from '@/lib/providerSheetRows'
import { useAuth } from '@/contexts/AuthContext'
import {
  Clinic,
  Provider,
  SheetRow,
  ProviderSheet,
  Patient,
  BillingCode,
  StatusColor,
} from '@/types'
import ProvidersTab from '@/components/tabs/ProvidersTab'
import AccountsReceivableTab from '@/components/tabs/AccountsReceivableTab'
import ProviderPayTab from '@/components/tabs/ProviderPayTab'

export default function ProviderSheetPage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { clinicId: urlClinicId } = useParams<{ clinicId: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [providerLevel, setProviderLevel] = useState<1 | 2>(1)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [providerSheetRows, setProviderSheetRows] = useState<Record<string, SheetRow[]>>({})
  const [patients, setPatients] = useState<Patient[]>([])
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date())
  const providerSheetRowsRef = useRef<Record<string, SheetRow[]>>({})
  const [currentSheet, setCurrentSheet] = useState<ProviderSheet | null>(null)
  /** When provider level is 2: 'sheet' | 'accounts_receivable' | 'provider_pay' */
  const [providerViewTab, setProviderViewTab] = useState<'sheet' | 'accounts_receivable' | 'provider_pay'>('sheet')

  // Redirect non-providers; redirect to dashboard if no clinic in URL
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (userProfile?.role !== 'provider') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (!urlClinicId) {
      navigate('/providers', { replace: true })
    }
  }, [user, userProfile, authLoading, navigate, urlClinicId])

  // Resolve provider by user email (and optional clinic_ids)
  useEffect(() => {
    if (!user?.email || userProfile?.role !== 'provider') return

    const resolveProvider = async () => {
      setLoading(true)
      setError(null)
      try {
        let query = supabase
          .from('providers')
          .select('*')
          .eq('email', user.email!)

        if (userProfile?.clinic_ids?.length) {
          query = query.overlaps('clinic_ids', userProfile.clinic_ids)
        }
        query = query.limit(1)

        const { data, error: err } = await query.maybeSingle()

        if (err) throw err
        if (!data) {
          setError('Your account is not linked to a provider. Please contact your administrator.')
          setProvider(null)
          setLoading(false)
          return
        }
        setProvider(data)
        setProviderLevel(data.level === 2 ? 2 : 1)
      } catch (e) {
        console.error('Error resolving provider:', e)
        setError('Failed to load your provider profile.')
        setProvider(null)
      } finally {
        setLoading(false)
      }
    }

    resolveProvider()
  }, [user?.email, userProfile?.role, userProfile?.clinic_ids])

  // Use clinic from URL; must be one of the provider's clinics
  const clinicId = urlClinicId && provider?.clinic_ids?.includes(urlClinicId) ? urlClinicId : undefined

  // Redirect if URL clinic is invalid for this provider (after provider has loaded)
  useEffect(() => {
    if (!provider || !urlClinicId) return
    if (!provider.clinic_ids?.includes(urlClinicId)) {
      navigate('/providers', { replace: true })
    }
  }, [provider, urlClinicId, navigate])

  // Fetch clinic, patients, billing codes, status colors, and sheet when provider is set
  useEffect(() => {
    if (!provider || !clinicId) return

    const fetchClinic = async () => {
      const { data } = await supabase.from('clinics').select('*').eq('id', clinicId).maybeSingle()
      setClinic(data || null)
    }

    const fetchPatients = async () => {
      const { data, error: err } = await supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('patient_id')
      if (!err) setPatients(data || [])
    }

    const fetchBillingCodes = async () => {
      const { data, error: err } = await supabase.from('billing_codes').select('*').order('code')
      if (!err) setBillingCodes(data || [])
    }

    const fetchStatusColors = async () => {
      const { data } = await supabase.from('status_colors').select('*')
      if (data?.length) setStatusColors(data)
      else
        setStatusColors([
          { id: '1', status: 'Complete', color: '#5d9f5d', text_color: '#000', type: 'appointment', created_at: '', updated_at: '' },
          { id: '2', status: 'Note Not Complete', color: '#e06666', text_color: '#000', type: 'appointment', created_at: '', updated_at: '' },
        ])
    }

    fetchClinic()
    fetchPatients()
    fetchBillingCodes()
    fetchStatusColors()
  }, [provider, clinicId])

  // Fetch provider sheet for selected month
  const fetchProviderSheetData = useCallback(async () => {
    if (!provider || !clinic || !clinicId) return

    const providerId = provider.id
    const month = selectedMonth.getMonth() + 1
    const year = selectedMonth.getFullYear()

    setLoading(true)
    try {
      let { data: sheet, error: sheetsError } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('provider_id', providerId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle()

      if (sheetsError && sheetsError.code !== 'PGRST116') throw sheetsError

      if (!sheet) {
        const { data: newSheet, error: createError } = await supabase
          .from('provider_sheets')
          .insert({
            clinic_id: clinicId,
            provider_id: providerId,
            month,
            year,
            locked: false,
            locked_columns: [],
          })
          .select()
          .maybeSingle()

        if (createError) throw createError
        if (!newSheet) return
        sheet = newSheet
      }

      setCurrentSheet(sheet)

      const sheetRows = await fetchSheetRows(supabase, sheet.id)
      const createEmptyRow = (index: number): SheetRow => ({
        id: `empty-${providerId}-${index}`,
        patient_id: null,
        patient_first_name: null,
        patient_last_name: null,
        last_initial: null,
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
        appointment_status_color: null,
        claim_status: null,
        claim_status_color: null,
        submit_date: null,
        insurance_payment: null,
        insurance_adjustment: null,
        invoice_amount: null,
        collected_from_patient: null,
        patient_pay_status: null,
        patient_pay_status_color: null,
        payment_date: null,
        payment_date_color: null,
        ar_type: null,
        ar_amount: null,
        ar_date: null,
        ar_date_color: null,
        ar_notes: null,
        provider_payment_amount: null,
        provider_payment_date: null,
        provider_payment_notes: null,
        highlight_color: null,
        total: null,
        cpt_code: null,
        cpt_code_color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      const emptyCount = Math.max(0, 200 - sheetRows.length)
      const emptyRows = Array.from({ length: emptyCount }, (_, i) => createEmptyRow(i))
      const allRows = [...sheetRows, ...emptyRows]

      setProviderSheetRows(prev => ({ ...prev, [providerId]: allRows }))
    } catch (e) {
      console.error('Error fetching provider sheet:', e)
    } finally {
      setLoading(false)
    }
  }, [provider, clinic, selectedMonth])

  useEffect(() => {
    providerSheetRowsRef.current = providerSheetRows
  }, [providerSheetRows])

  useEffect(() => {
    if (provider && clinic) fetchProviderSheetData()
  }, [provider, clinic, selectedMonth, fetchProviderSheetData])

  const handleUpdateProviderSheetRow = useCallback(
    (providerId: string, rowId: string, field: string, value: any) => {
      setProviderSheetRows(prev => {
        const rows = prev[providerId] || []
        const updatedRows = rows.map(row => {
          if (row.id !== rowId) return row
          if (row.id.startsWith('empty-')) {
            const newId = `new-${Date.now()}-${Math.random()}`
            const updated: SheetRow = { ...row, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
            if (field === 'cpt_code' && value) {
              const code = billingCodes.find(c => c.code === value)
              ;(updated as any).cpt_code_color = code?.color ?? null
            } else if (field === 'appointment_status' && value) {
              const status = statusColors.find(s => s.status === value && s.type === 'appointment')
              ;(updated as any).appointment_status_color = status?.color ?? null
            }
            return updated
          }
          const updated = { ...row, [field]: value, updated_at: new Date().toISOString() } as SheetRow
          if (field === 'cpt_code' && value) {
            const code = billingCodes.find(c => c.code === value)
            ;(updated as any).cpt_code_color = code?.color ?? null
          } else if (field === 'appointment_status' && value) {
            const status = statusColors.find(s => s.status === value && s.type === 'appointment')
            ;(updated as any).appointment_status_color = status?.color ?? null
          }
          return updated
        })
        return { ...prev, [providerId]: updatedRows }
      })
    },
    [billingCodes, statusColors]
  )

  const saveProviderSheetRows = useCallback(
    async (providerId: string, rowsToSave: SheetRow[]) => {
      if (!currentSheet || !provider || provider.id !== providerId) return
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      if (currentSheet.month !== month || currentSheet.year !== year) return

      try {
        const rowsToProcess = rowsToSave.filter(r => !r.id.startsWith('empty-'))
        await saveSheetRows(supabase, currentSheet.id, rowsToProcess)
      } catch (e) {
        console.error('Error saving provider sheet:', e)
      }
    },
    [currentSheet, provider, selectedMonth]
  )

  const saveProviderSheetRowsDirect = useCallback(
    async (providerId: string, rows: SheetRow[]) => {
      await saveProviderSheetRows(providerId, rows)
    },
    [saveProviderSheetRows]
  )

  const formatMonthYear = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const filterRowsByMonth = (rows: SheetRow[]) => rows
  const handlePreviousMonth = () =>
    setSelectedMonth(d => {
      const n = new Date(d)
      n.setMonth(n.getMonth() - 1)
      return n
    })
  const handleNextMonth = () =>
    setSelectedMonth(d => {
      const n = new Date(d)
      n.setMonth(n.getMonth() + 1)
      return n
    })
  if (authLoading || (userProfile?.role === 'provider' && loading && !provider)) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400" />
      </div>
    )
  }

  if (userProfile?.role !== 'provider') return null

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-amber-900/30 border border-amber-600/50 text-amber-200 p-4">
          {error}
        </div>
      </div>
    )
  }

  if (!provider || !clinicId) return null

  const showARTab = providerLevel === 2
  const showProviderPayTab = providerLevel === 2

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">
          {showARTab || showProviderPayTab ? (providerViewTab === 'sheet' ? 'My Sheet' : providerViewTab === 'accounts_receivable' ? 'Accounts Receivable' : 'Provider Pay') : 'My Sheet'}
        </h1>
        {clinic && <p className="text-white/70">{clinic.name}</p>}
      </div>

      {(showARTab || showProviderPayTab) && (
        <div className="flex gap-1 mb-4 border-b border-white/20 pb-2">
          <button
            type="button"
            onClick={() => setProviderViewTab('sheet')}
            className={`px-4 py-2 rounded-t font-medium transition-colors ${
              providerViewTab === 'sheet' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            My Sheet
          </button>
          <button
            type="button"
            onClick={() => setProviderViewTab('accounts_receivable')}
            className={`px-4 py-2 rounded-t font-medium transition-colors ${
              providerViewTab === 'accounts_receivable' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            Accounts Receivable
          </button>
          <button
            type="button"
            onClick={() => setProviderViewTab('provider_pay')}
            className={`px-4 py-2 rounded-t font-medium transition-colors ${
              providerViewTab === 'provider_pay' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            Provider Pay
          </button>
        </div>
      )}

      {providerViewTab === 'sheet' && (
        <ProvidersTab
          clinicId={clinicId}
          providers={[provider]}
          providerSheetRows={providerSheetRows}
          billingCodes={billingCodes}
          statusColors={statusColors}
          patients={patients}
          selectedMonth={selectedMonth}
          providerId={provider.id}
          currentProvider={provider}
          canEdit={true}
          isInSplitScreen={false}
          isProviderView={true}
          providerLevel={providerLevel}
          onUpdateProviderSheetRow={handleUpdateProviderSheetRow}
          onSaveProviderSheetRowsDirect={saveProviderSheetRowsDirect}
          onPreviousMonth={handlePreviousMonth}
          onNextMonth={handleNextMonth}
          formatMonthYear={formatMonthYear}
          filterRowsByMonth={filterRowsByMonth}
        />
      )}

      {providerViewTab === 'accounts_receivable' && showARTab && clinicId && (
        <AccountsReceivableTab
          clinicId={clinicId}
          canEdit={false}
          isInSplitScreen={false}
        />
      )}

      {providerViewTab === 'provider_pay' && showProviderPayTab && clinicId && provider && (
        <ProviderPayTab
          clinicId={clinicId}
          providerId={provider.id}
          providers={[provider]}
          canEdit={true}
          isInSplitScreen={false}
          selectedMonth={selectedMonth}
          onPreviousMonth={handlePreviousMonth}
          onNextMonth={handleNextMonth}
          formatMonthYear={formatMonthYear}
          statusColors={statusColors}
        />
      )}
    </div>
  )
}
