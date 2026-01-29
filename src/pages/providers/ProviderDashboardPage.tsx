import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider } from '@/types'
import { LayoutDashboard, Building2, FileText, Calendar, Users, UserCircle, MapPin, Phone } from 'lucide-react'

export default function ProviderDashboardPage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [patientCountByClinic, setPatientCountByClinic] = useState<Record<string, number>>({})
  const [providerCountByClinic, setProviderCountByClinic] = useState<Record<string, number>>({})
  const [upcomingCount, setUpcomingCount] = useState(0)
  const [sheetsThisMonthCount, setSheetsThisMonthCount] = useState(0)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (userProfile?.role !== 'provider') {
      navigate('/dashboard', { replace: true })
    }
  }, [user, userProfile, authLoading, navigate])

  useEffect(() => {
    if (!user?.email || userProfile?.role !== 'provider') return

    const load = async () => {
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
        const { data: providerData, error: err } = await query.limit(1).maybeSingle()
        if (err) throw err
        if (!providerData) {
          setError('Your account is not linked to a provider.')
          setProvider(null)
          setClinics([])
          setPatientCountByClinic({})
          setProviderCountByClinic({})
          setUpcomingCount(0)
          setSheetsThisMonthCount(0)
          setLoading(false)
          return
        }
        setProvider(providerData as Provider)
        const ids = (providerData as Provider).clinic_ids || []
        if (ids.length === 0) {
          setClinics([])
          setPatientCountByClinic({})
          setProviderCountByClinic({})
          setUpcomingCount(0)
          setSheetsThisMonthCount(0)
          setLoading(false)
          return
        }
        const { data: clinicsData, error: clinicsErr } = await supabase
          .from('clinics')
          .select('*')
          .in('id', ids)
          .order('name')
        if (clinicsErr) throw clinicsErr
        setClinics(clinicsData || [])

        if (ids.length > 0) {
          const [patientsRes, providersRes] = await Promise.all([
            supabase.from('patients').select('id, clinic_id').in('clinic_id', ids),
            supabase.from('providers').select('id, clinic_ids').overlaps('clinic_ids', ids),
          ])
          const patientCount: Record<string, number> = {}
          ids.forEach((id) => { patientCount[id] = 0 })
          ;(patientsRes.data || []).forEach((p: { clinic_id: string }) => {
            patientCount[p.clinic_id] = (patientCount[p.clinic_id] || 0) + 1
          })
          setPatientCountByClinic(patientCount)

          const providerCount: Record<string, number> = {}
          ids.forEach((id) => { providerCount[id] = 0 })
          ;(providersRes.data || []).forEach((p: { clinic_ids: string[] }) => {
            (p.clinic_ids || []).forEach((cid: string) => {
              if (providerCount[cid] != null) providerCount[cid] += 1
            })
          })
          setProviderCountByClinic(providerCount)
        }

        const providerId = (providerData as Provider).id
        const now = new Date()
        const today = now.toISOString().slice(0, 10)
        const endDate = new Date(now)
        endDate.setDate(endDate.getDate() + 7)
        const endDateStr = endDate.toISOString().slice(0, 10)
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        const [upcomingRes, sheetsRes] = await Promise.all([
          supabase
            .from('provider_schedules')
            .select('id', { count: 'exact', head: true })
            .eq('provider_id', providerId)
            .gte('date_of_service', today)
            .lte('date_of_service', endDateStr),
          supabase
            .from('provider_sheets')
            .select('id', { count: 'exact', head: true })
            .eq('provider_id', providerId)
            .eq('month', currentMonth)
            .eq('year', currentYear),
        ])
        setUpcomingCount(upcomingRes.count ?? 0)
        setSheetsThisMonthCount(sheetsRes.count ?? 0)
      } catch (e) {
        console.error(e)
        setError('Failed to load your clinics.')
        setProvider(null)
        setClinics([])
        setPatientCountByClinic({})
        setProviderCountByClinic({})
        setUpcomingCount(0)
        setSheetsThisMonthCount(0)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.email, userProfile?.role, userProfile?.clinic_ids])

  if (authLoading || (userProfile?.role === 'provider' && loading)) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400" />
      </div>
    )
  }

  if (userProfile?.role !== 'provider') return null
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-amber-900/30 border border-amber-600/50 text-amber-200 p-4">{error}</div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-8 flex items-center gap-3">
        <LayoutDashboard className="text-primary-400" size={32} />
        <div>
          <h1 className="text-3xl font-bold text-white">Provider Dashboard</h1>
          <p className="text-white/70">
            {provider ? `${provider.first_name} ${provider.last_name}` : ''}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Building2 className="text-primary-400" size={24} />
            <span className="text-3xl font-bold text-white">{clinics.length}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">My Clinics</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Users className="text-green-400" size={24} />
            <span className="text-3xl font-bold text-white">
              {Object.values(patientCountByClinic).reduce((a, b) => a + b, 0)}
            </span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Total Patients</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Calendar className="text-blue-400" size={24} />
            <span className="text-3xl font-bold text-white">{upcomingCount}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Upcoming (7 days)</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <FileText className="text-purple-400" size={24} />
            <span className="text-3xl font-bold text-white">{sheetsThisMonthCount}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Sheets This Month</h3>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-white mb-4">My Clinics</h2>
      {clinics.length === 0 ? (
        <p className="text-white/60">You are not assigned to any clinic yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {clinics.map((clinic) => (
            <div
              key={clinic.id}
              className="rounded-xl border border-white/10 bg-slate-800/40 p-5 hover:bg-slate-800/60 transition-colors flex flex-col"
            >
              <div className="flex items-center gap-3 mb-3">
                <Building2 size={24} className="text-primary-400 shrink-0" />
                <h3 className="text-xl font-semibold text-white">{clinic.name}</h3>
              </div>
              <div className="space-y-2 mb-4 text-sm text-white/80">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-primary-400 shrink-0" />
                  <span>{patientCountByClinic[clinic.id] ?? 0} patients</span>
                </div>
                <div className="flex items-center gap-2">
                  <UserCircle size={16} className="text-primary-400 shrink-0" />
                  <span>{providerCountByClinic[clinic.id] ?? 0} providers</span>
                </div>
                {clinic.address && (
                  <div className="flex items-start gap-2">
                    <MapPin size={16} className="text-primary-400 shrink-0 mt-0.5" />
                    <span>{clinic.address}</span>
                  </div>
                )}
                {clinic.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-primary-400 shrink-0" />
                    <span>{clinic.phone}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3 mt-auto pt-3 border-t border-white/10">
                <Link
                  to={`/providers/clinics/${clinic.id}/sheet`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors"
                >
                  <FileText size={18} />
                  Sheet
                </Link>
                <Link
                  to={`/providers/clinics/${clinic.id}/schedule`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white transition-colors"
                >
                  <Calendar size={18} />
                  Schedule
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
