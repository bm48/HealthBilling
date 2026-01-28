import { useAuth } from '@/contexts/AuthContext'
import { FileText, Users, CheckSquare, BarChart3, Clock, Building2, AlertCircle } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Clinic } from '@/types'

interface DashboardStats {
  totalClinics: number
  totalPatients: number
  totalUsers: number
  totalTodos: number
  totalProviderSheets: number
  totalTodosOpen: number
  totalTodosCompleted: number
}

interface ClinicStats {
  clinicId: string
  patientCount: number
  providerCount: number
}

export default function Dashboard() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [clinicStats, setClinicStats] = useState<Record<string, ClinicStats>>({})
  const [stats, setStats] = useState<DashboardStats>({
    totalClinics: 0,
    totalPatients: 0,
    totalUsers: 0,
    totalTodos: 0,
    totalProviderSheets: 0,
    totalTodosOpen: 0,
    totalTodosCompleted: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userProfile) {
      if (userProfile.role === 'provider') {
        navigate('/providers/sheet', { replace: true })
        return
      }
      if (userProfile.role === 'super_admin') {
        fetchSuperAdminDashboard()
      } else {
        fetchClinics()
        setLoading(false)
      }
    }
  }, [userProfile, navigate])

  const fetchSuperAdminDashboard = async () => {
    if (!userProfile) return

    try {
      setLoading(true)
      
      // Fetch all data in parallel
      const [clinicsData, patientsData, usersData, todosData, sheetsData] = await Promise.all([
        supabase.from('clinics').select('id', { count: 'exact', head: true }),
        supabase.from('patients').select('id', { count: 'exact', head: true }),
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('todo_items').select('id, completed_at', { count: 'exact' }),
        supabase.from('provider_sheets').select('id', { count: 'exact', head: true }),
      ])

      // Fetch clinics list
      const { data: clinicsList, error: clinicsError } = await supabase
        .from('clinics')
        .select('*')
        .order('name')

      if (clinicsError) throw clinicsError
      setClinics(clinicsList || [])
      
      // Fetch stats for each clinic
      if (clinicsList && clinicsList.length > 0) {
        await fetchClinicStats(clinicsList.map(c => c.id))
      }

      // Calculate stats
      const todos = todosData.data || []
      const openTodos = todos.filter(t => !t.completed_at)
      const completedTodos = todos.filter(t => t.completed_at)

      setStats({
        totalClinics: clinicsData.count || 0,
        totalPatients: patientsData.count || 0,
        totalUsers: usersData.count || 0,
        totalTodos: todos.length,
        totalProviderSheets: sheetsData.count || 0,
        totalTodosOpen: openTodos.length,
        totalTodosCompleted: completedTodos.length,
      })
    } catch (error) {
      // Error fetching dashboard data
    } finally {
      setLoading(false)
    }
  }

  const fetchClinics = async () => {
    if (!userProfile) return

    try {
      let query = supabase.from('clinics').select('*')
      
      // If not super admin, filter by clinic_ids
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('id', userProfile.clinic_ids)
      }

      const { data, error } = await query
      if (error) throw error
      setClinics(data || [])
      
      // Fetch stats for each clinic
      if (data && data.length > 0) {
        await fetchClinicStats(data.map(c => c.id))
      }
    } catch (error) {
      // Error fetching clinics
    }
  }

  const fetchClinicStats = async (clinicIds: string[]) => {
    try {
      const statsMap: Record<string, ClinicStats> = {}

      // Fetch patient and provider counts for each clinic in parallel
      await Promise.all(
        clinicIds.map(async (clinicId) => {
          const [patientsResult, providersResult] = await Promise.all([
            supabase
              .from('patients')
              .select('id', { count: 'exact', head: true })
              .eq('clinic_id', clinicId),
            supabase
              .from('providers')
              .select('id', { count: 'exact', head: true })
              .eq('clinic_id', clinicId),
          ])

          statsMap[clinicId] = {
            clinicId,
            patientCount: patientsResult.count || 0,
            providerCount: providersResult.count || 0,
          }
        })
      )

      setClinicStats(statsMap)
    } catch (error) {
      console.error('Error fetching clinic stats:', error)
    }
  }

  const getQuickActions = () => {
    if (!userProfile) return []

    const actions = [
      { path: '/patients', label: 'Patient Database', icon: Users, roles: ['office_staff', 'billing_staff', 'admin', 'super_admin'] },
      { path: '/todo', label: 'Billing To-Do', icon: CheckSquare, roles: ['billing_staff', 'admin', 'super_admin'] },
      { path: '/timecards', label: 'Timecards', icon: Clock, roles: ['billing_staff', 'admin', 'super_admin'] },
      { path: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'view_only_admin', 'super_admin'] },
    ]

    return actions.filter(action => 
      action.roles.includes(userProfile.role) || userProfile.role === 'super_admin'
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  // Super Admin Dashboard
  if (userProfile?.role === 'super_admin') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Super Admin Dashboard</h1>
          <p className="text-white/70 mt-2">
            Welcome back, {userProfile?.full_name || userProfile?.email}
          </p>
        </div>

        {/* Summary Statistics */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Building2 className="text-primary-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalClinics}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total Clinics</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Users className="text-green-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalPatients}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total Patients</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Users className="text-blue-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalUsers}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total Users</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <CheckSquare className="text-yellow-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalTodos}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total To-Do Items</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <FileText className="text-purple-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalProviderSheets}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Provider Sheets</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <AlertCircle className="text-orange-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalTodosOpen}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Open To-Do Items</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <CheckSquare className="text-green-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalTodosCompleted}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Completed To-Do Items</h3>
          </div>
        </div>

        {/* Clinics List */}
        {clinics.length > 0 && (
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4">All Clinics</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clinics.map((clinic) => {
                const stats = clinicStats[clinic.id]
                return (
                  <Link
                    key={clinic.id}
                    to={`/clinic/${clinic.id}/patients`}
                    className="border border-white/20 rounded-lg p-4 hover:border-primary-400/50 transition-colors bg-white/5 cursor-pointer"
                  >
                    <h3 className="font-semibold text-white mb-3">{clinic.name}</h3>
                    
                    {/* Stats Section */}
                    {stats && (
                      <div className="flex gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <Users size={16} className="text-green-400" />
                          <div>
                            <p className="text-xs text-white/60">Patients</p>
                            <p className="text-sm font-semibold text-white">{stats.patientCount}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <FileText size={16} className="text-blue-400" />
                          <div>
                            <p className="text-xs text-white/60">Providers</p>
                            <p className="text-sm font-semibold text-white">{stats.providerCount}</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {clinic.address && (
                      <p className="text-sm text-white/60 mt-1">{clinic.address}</p>
                    )}
                    {clinic.phone && (
                      <p className="text-sm text-white/60 mt-1">{clinic.phone}</p>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Regular Dashboard for non-super-admin users
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-white/70 mt-2">
          Welcome back, {userProfile?.full_name || userProfile?.email}
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {getQuickActions().map((action) => {
          const Icon = action.icon
          return (
            <Link
              key={action.path}
              to={action.path}
              className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl hover:shadow-2xl transition-all border border-white/20 hover:border-primary-400/50 hover:scale-105"
            >
              <Icon className="text-primary-400 mb-4" size={32} />
              <h3 className="text-lg font-semibold text-white">{action.label}</h3>
            </Link>
          )
        })}
      </div>

      {clinics.length > 0 && (
        <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
          <h2 className="text-xl font-semibold text-white mb-4">Your Clinics</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clinics.map((clinic) => {
              const stats = clinicStats[clinic.id]
              return (
                <Link
                  key={clinic.id}
                  to={`/clinic/${clinic.id}/patients`}
                  className="border border-white/20 rounded-lg p-4 hover:border-primary-400/50 transition-colors bg-white/5 cursor-pointer"
                >
                  <h3 className="font-semibold text-white mb-3">{clinic.name}</h3>
                  
                  {/* Stats Section */}
                  {stats && (
                    <div className="flex gap-4 mb-3">
                      <div className="flex items-center gap-2">
                        <Users size={16} className="text-green-400" />
                        <div>
                          <p className="text-xs text-white/60">Patients</p>
                          <p className="text-sm font-semibold text-white">{stats.patientCount}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-blue-400" />
                        <div>
                          <p className="text-xs text-white/60">Providers</p>
                          <p className="text-sm font-semibold text-white">{stats.providerCount}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {clinic.address && (
                    <p className="text-sm text-white/60 mt-1">{clinic.address}</p>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
