import { useAuth } from '@/contexts/AuthContext'
import { FileText, Users, CheckSquare, BarChart3, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Clinic } from '@/types'

export default function Dashboard() {
  const { userProfile } = useAuth()
  const [clinics, setClinics] = useState<Clinic[]>([])

  useEffect(() => {
    if (userProfile) {
      fetchClinics()
    }
  }, [userProfile])

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
    } catch (error) {
      console.error('Error fetching clinics:', error)
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
            {clinics.map((clinic) => (
              <div
                key={clinic.id}
                className="border border-white/20 rounded-lg p-4 hover:border-primary-400/50 transition-colors bg-white/5"
              >
                <h3 className="font-semibold text-white">{clinic.name}</h3>
                {clinic.address && (
                  <p className="text-sm text-white/60 mt-1">{clinic.address}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
