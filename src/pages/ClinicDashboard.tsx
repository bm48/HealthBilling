import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider } from '@/types'
import { fetchSheetRows } from '@/lib/providerSheetRows'
import { computeBillingMetrics, type BillingMetrics } from '@/lib/billingMetrics'
import { Users, FileText, CheckSquare, DollarSign } from 'lucide-react'

interface ClinicStats {
  patientCount: number
  providerCount: number
  todoCount: number
  currentMonthTotal: number | null
}

interface ProviderCardStats {
  providerId: string
  claimsCount: number
  unpaidClaimsCount: number
  todoCount: number
  currentMonthTotal: number
  /** Billing sheet metrics for current month (admin/billing staff) */
  metrics: BillingMetrics
}

function formatCurrency(value: number | null): string {
  if (value == null) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export default function ClinicDashboard() {
  const { clinicId } = useParams<{ clinicId: string }>()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [stats, setStats] = useState<ClinicStats | null>(null)
  const [providerStats, setProviderStats] = useState<ProviderCardStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clinicId || !userProfile) return
    const allowed =
      userProfile.role === 'super_admin' ||
      (userProfile.role === 'admin' && userProfile.clinic_ids?.includes(clinicId)) ||
      (userProfile.clinic_ids?.length && userProfile.clinic_ids.includes(clinicId))
    if (!allowed) {
      navigate('/dashboard', { replace: true })
      return
    }
    // Official staff only see billing tab; redirect from clinic dashboard to billing
    if (userProfile.role === 'official_staff') {
      navigate(`/clinic/${clinicId}/todo`, { replace: true })
      return
    }
    fetchData()
  }, [clinicId, userProfile, navigate])

  const fetchData = async () => {
    if (!clinicId) return
    setLoading(true)
    try {
      const { data: clinicData, error: clinicError } = await supabase
        .from('clinics')
        .select('*')
        .eq('id', clinicId)
        .single()

      if (clinicError || !clinicData) {
        navigate('/dashboard', { replace: true })
        return
      }
      setClinic(clinicData as Clinic)

      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth() + 1
      const currentMonthStart = `${y}-${String(m).padStart(2, '0')}-01`
      const nextMonth = m === 12 ? [y + 1, 1] : [y, m + 1]
      const nextMonthStart = `${nextMonth[0]}-${String(nextMonth[1]).padStart(2, '0')}-01`

      const [providersRes, patientsRes, todosRes, arRes, sheetsRes, allSheetsRes] = await Promise.all([
        supabase
          .from('providers')
          .select('*')
          .contains('clinic_ids', [clinicId])
          .order('last_name')
          .order('first_name'),
        supabase.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
        supabase.from('todo_lists').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
        supabase
          .from('accounts_receivables')
          .select('amount')
          .eq('clinic_id', clinicId)
          .gte('date_recorded', currentMonthStart)
          .lt('date_recorded', nextMonthStart),
        supabase
          .from('provider_sheets')
          .select('id, provider_id')
          .eq('clinic_id', clinicId)
          .eq('month', m)
          .eq('year', y),
        supabase
          .from('provider_sheets')
          .select('id, provider_id')
          .eq('clinic_id', clinicId),
      ])

      const providersList = (providersRes.data || []) as Provider[]
      setProviders(providersList)

      let currentMonthTotal: number | null = null
      if (arRes.data?.length) {
        currentMonthTotal = arRes.data.reduce(
          (s: number, row: { amount: number | null }) => s + Number(row.amount ?? 0),
          0
        )
      }

      setStats({
        patientCount: patientsRes.count ?? 0,
        providerCount: providersList.length,
        todoCount: todosRes.count ?? 0,
        currentMonthTotal,
      })

      const sheets = (sheetsRes.data || []) as { id: string; provider_id: string }[]
      const allSheets = (allSheetsRes.data || []) as { id: string; provider_id: string }[]

      // Visits: count rows with appointment_date set across ALL months (all sheets per provider)
      const visitsByProvider: Record<string, number> = {}
      providersList.forEach((p) => {
        visitsByProvider[p.id] = 0
      })
      if (allSheets.length > 0) {
        const allRowsBySheet: Record<string, Awaited<ReturnType<typeof fetchSheetRows>>> = {}
        await Promise.all(
          allSheets.map(async (sheet) => {
            const rows = await fetchSheetRows(supabase, sheet.id)
            allRowsBySheet[sheet.id] = rows
          })
        )
        allSheets.forEach((sheet) => {
          const rows = allRowsBySheet[sheet.id] || []
          const metrics = computeBillingMetrics(rows)
          visitsByProvider[sheet.provider_id] = (visitsByProvider[sheet.provider_id] ?? 0) + metrics.visits
        })
      }

      if (sheets.length === 0) {
        setProviderStats(
          providersList.map((p) => ({
            providerId: p.id,
            claimsCount: 0,
            unpaidClaimsCount: 0,
            todoCount: todosRes.count ?? 0,
            currentMonthTotal: 0,
            metrics: {
              visits: visitsByProvider[p.id] ?? 0,
              noShows: 0,
              paidClaims: 0,
              privatePay: 0,
              secondary: 0,
              ccDeclines: 0,
            },
          }))
        )
      } else {
        const rowsBySheet: Record<string, Awaited<ReturnType<typeof fetchSheetRows>>> = {}
        await Promise.all(
          sheets.map(async (sheet) => {
            const rows = await fetchSheetRows(supabase, sheet.id)
            rowsBySheet[sheet.id] = rows
          })
        )

        const byProvider: Record<string, { claims: number; unpaid: number; total: number; metrics: BillingMetrics }> = {}
        providersList.forEach((p) => {
          byProvider[p.id] = {
            claims: 0,
            unpaid: 0,
            total: 0,
            metrics: { visits: visitsByProvider[p.id] ?? 0, noShows: 0, paidClaims: 0, privatePay: 0, secondary: 0, ccDeclines: 0 },
          }
        })

        sheets.forEach((sheet) => {
          const rows = rowsBySheet[sheet.id] || []
          const providerId = sheet.provider_id
          if (!byProvider[providerId])
            byProvider[providerId] = {
              claims: 0,
              unpaid: 0,
              total: 0,
              metrics: { visits: visitsByProvider[providerId] ?? 0, noShows: 0, paidClaims: 0, privatePay: 0, secondary: 0, ccDeclines: 0 },
            }
          rows.forEach((row) => {
            byProvider[providerId].claims += 1
            if (row.claim_status !== 'Paid') byProvider[providerId].unpaid += 1
            const ins = parseFloat(String(row.insurance_payment)) || 0
            const pat = parseFloat(String(row.collected_from_patient)) || 0
            const ar = Number(row.ar_amount) || 0
            byProvider[providerId].total += ins + pat + ar
          })
          const metrics = computeBillingMetrics(rows)
          byProvider[providerId].metrics = {
            visits: byProvider[providerId].metrics.visits,
            noShows: metrics.noShows,
            paidClaims: metrics.paidClaims,
            privatePay: metrics.privatePay,
            secondary: metrics.secondary,
            ccDeclines: metrics.ccDeclines,
          }
        })

        setProviderStats(
          providersList.map((p) => ({
            providerId: p.id,
            claimsCount: byProvider[p.id]?.claims ?? 0,
            unpaidClaimsCount: byProvider[p.id]?.unpaid ?? 0,
            todoCount: todosRes.count ?? 0,
            currentMonthTotal: byProvider[p.id]?.total ?? 0,
            metrics: byProvider[p.id]?.metrics ?? { visits: visitsByProvider[p.id] ?? 0, noShows: 0, paidClaims: 0, privatePay: 0, secondary: 0, ccDeclines: 0 },
          }))
        )
      }
    } catch (error) {
      console.error('Error fetching clinic dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !clinic) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Section 1: Clinic name */}
      <div>
        <h1 className="text-3xl font-bold text-white">{clinic.name}</h1>
      </div>

      {/* Section 2: Clinic info card – dashboard style */}
      <div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-white/70 font-medium">Clinic Addresses : </span>
            <span className="text-white">
              {[clinic.address, clinic.address_line_2].filter(Boolean).join(' ') || '—'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-white/70 font-medium">Phone : </span>
            <span className="text-white">{clinic.phone ?? '—'}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-white/70 font-medium">Fax : </span>
            <span className="text-white">{clinic.fax ?? '—'}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-white/70 font-medium">EIN/Tax ID : </span>
            <span className="text-white">{clinic.ein ?? '—'}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-white/70 font-medium">NPI : </span>
            <span className="text-white">{clinic.npi ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* Section 3: Summary cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Users className="text-green-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats?.patientCount ?? 0}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Patients</h3>
        </div>
        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <FileText className="text-blue-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats?.providerCount ?? 0}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Providers</h3>
        </div>
        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <CheckSquare className="text-yellow-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats?.todoCount ?? 0}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">To-Do Items</h3>
        </div>
        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="text-purple-400" size={24} />
            <span className="text-3xl font-bold text-white">
              {formatCurrency(stats?.currentMonthTotal ?? null)}
            </span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Current Month Total</h3>
        </div>
      </div>

      {/* Section 4: Provider summary cards – dashboard style (one per row) */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Providers</h2>
        <div className="space-y-4">
          {providers.map((provider) => {
            const ps = providerStats.find((s) => s.providerId === provider.id)
            console.log('ps', ps)
            return (
              <Link
                key={provider.id}
                to={`/clinic/${clinicId}/providers/${provider.id}`}
                className="block bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20 p-5 hover:border-primary-400/50 transition-colors"
              >
                <div className="space-y-2">
                  <div className="font-semibold text-white italic">
                    {provider.first_name} {provider.last_name}
                  </div>
                  <div className="text-white/80 text-sm">
                    {provider.npi ? ` NPI : ${provider.npi}` : ''}
                  </div>
                  {/* <div className="text-white/80 text-sm">
                    {ps?.claimsCount ?? 0} claims · {ps?.unpaidClaimsCount ?? 0} unpaid claims
                  </div>
                  <div className="text-white/80 text-sm">
                    {ps?.todoCount ?? 0} to-do items
                  </div> */}
                  <div className="text-white/80 text-sm">
                    Total $ for current month: {formatCurrency(ps?.currentMonthTotal ?? 0)}
                    
                    <span className="ml-8">Paid: {ps?.metrics?.paidClaims ?? 0}</span>
                  </div>
                  <div className="text-white/80 text-sm flex flex-wrap gap-x-4 gap-y-0.5 mt-1 border-t border-white/20 pt-2">
                    <span>Visits: {ps?.metrics?.visits ?? 0}</span>
                    <span>No Shows: {ps?.metrics?.noShows ?? 0}</span>
                    <span>PP: {ps?.metrics?.privatePay ?? 0}</span>
                    <span>Secondary: {ps?.metrics?.secondary ?? 0}</span>
                    <span>CC Declines: {ps?.metrics?.ccDeclines ?? 0}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
        {providers.length === 0 && (
          <p className="text-white/70">No providers assigned to this clinic.</p>
        )}
      </div>
    </div>
  )
}
