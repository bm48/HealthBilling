import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider } from '@/types'
import { LayoutDashboard, Building2, FileText, Calendar } from 'lucide-react'

export default function ProviderDashboardPage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [clinics, setClinics] = useState<Clinic[]>([])

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
          setLoading(false)
          return
        }
        setProvider(providerData as Provider)
        const ids = (providerData as Provider).clinic_ids || []
        if (ids.length === 0) {
          setClinics([])
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
      } catch (e) {
        console.error(e)
        setError('Failed to load your clinics.')
        setProvider(null)
        setClinics([])
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
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-white/70">
            {provider ? `${provider.first_name} ${provider.last_name}` : ''}
          </p>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-white mb-4">Clinics</h2>
      {clinics.length === 0 ? (
        <p className="text-white/60">You are not assigned to any clinic yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
          {clinics.map((clinic) => (
            <div
              key={clinic.id}
              className="rounded-xl border border-white/10 bg-slate-800/40 p-5 hover:bg-slate-800/60 transition-colors"
            >
              <div className="flex items-center gap-3 mb-4">
                <Building2 size={24} className="text-primary-400" />
                <h3 className="text-xl font-semibold text-white">{clinic.name}</h3>
              </div>
              <div className="flex flex-wrap gap-3">
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
