import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { 
  LayoutDashboard, 
  Users, 
  CheckSquare, 
  FileText, 
  BarChart3, 
  Clock, 
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Building2,
  DollarSign,
  Download,
  Database,
  Palette
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Clinic, Provider } from '@/types'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { userProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [expandedClinics, setExpandedClinics] = useState<Set<string>>(new Set())
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loadingClinics, setLoadingClinics] = useState(false)
  const [clinicProviders, setClinicProviders] = useState<Record<string, Provider[]>>({})
  const [expandedSettings, setExpandedSettings] = useState(false)

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  // Fetch clinics for super admin
  useEffect(() => {
    if (userProfile?.role === 'super_admin') {
      fetchClinics()
    }
  }, [userProfile])

  // Auto-expand clinic if on a clinic detail page
  useEffect(() => {
    if (userProfile?.role === 'super_admin' && location.pathname.startsWith('/clinic/')) {
      const clinicIdMatch = location.pathname.match(/^\/clinic\/([^/]+)/)
      if (clinicIdMatch && clinicIdMatch[1]) {
        const clinicId = clinicIdMatch[1]
        setExpandedClinics(prev => {
          if (!prev.has(clinicId)) {
            return new Set([...prev, clinicId])
          }
          return prev
        })
      }
    }
  }, [location.pathname, userProfile])

  const fetchClinics = async () => {
    setLoadingClinics(true)
    try {
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .order('name')
      
      if (error) throw error
      setClinics(data || [])
      
      // Fetch providers for all clinics immediately
      if (data && data.length > 0) {
        await fetchAllProviders(data.map(c => c.id))
      }
    } catch (error) {
      console.error('Error fetching clinics:', error)
    } finally {
      setLoadingClinics(false)
    }
  }

  const fetchAllProviders = async (clinicIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('providers')
        .select('*')
        .in('clinic_id', clinicIds)
        .order('clinic_id')
        .order('last_name')
        .order('first_name')

      if (error) {
        console.error('Error fetching all providers:', error)
        throw error
      }
      
      console.log(`Fetched ${data?.length || 0} total providers for ${clinicIds.length} clinics:`, data)
      
      // Group providers by clinic_id
      const grouped: Record<string, Provider[]> = {}
      data?.forEach(provider => {
        if (!grouped[provider.clinic_id]) {
          grouped[provider.clinic_id] = []
        }
        grouped[provider.clinic_id].push(provider)
      })
      
      console.log('Grouped providers by clinic:', grouped)
      setClinicProviders(grouped)
    } catch (error) {
      console.error('Error fetching providers:', error)
    }
  }

  const fetchProvidersForClinic = async (clinicId: string) => {
    // Only fetch if not already loaded
    if (clinicProviders[clinicId]) {
      return
    }
    
    try {
      // Fetch providers from the providers table (including inactive ones)
      const { data, error } = await supabase
        .from('providers')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('last_name')
        .order('first_name')

      if (error) {
        console.error('Error fetching providers for clinic:', clinicId, error)
        throw error
      }
      
      console.log(`Fetched ${data?.length || 0} providers for clinic ${clinicId}:`, data)
      setClinicProviders(prev => ({ ...prev, [clinicId]: data || [] }))
    } catch (error) {
      console.error('Error fetching providers:', error)
      setClinicProviders(prev => ({ ...prev, [clinicId]: [] }))
    }
  }

  // Fetch providers when clinic is expanded (fallback)
  useEffect(() => {
    if (userProfile?.role === 'super_admin') {
      expandedClinics.forEach(clinicId => {
        if (!clinicProviders[clinicId] || clinicProviders[clinicId].length === 0) {
          fetchProvidersForClinic(clinicId)
        }
      })
    }
  }, [expandedClinics, userProfile])

  const toggleClinic = (clinicId: string) => {
    setExpandedClinics(prev => {
      const newSet = new Set(prev)
      if (newSet.has(clinicId)) {
        newSet.delete(clinicId)
      } else {
        newSet.add(clinicId)
      }
      return newSet
    })
  }

  const isClinicExpanded = (clinicId: string) => expandedClinics.has(clinicId)

  const toggleSettings = () => {
    setExpandedSettings(prev => !prev)
  }

  // Auto-expand settings if on a settings page
  useEffect(() => {
    if (userProfile?.role === 'super_admin' && (
      location.pathname.startsWith('/super-admin-settings') ||
      location.pathname.includes('/settings/')
    )) {
      setExpandedSettings(true)
    }
  }, [location.pathname, userProfile])

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['*'] },
    { name: 'Patient Database', href: '/patients', icon: Users, roles: ['office_staff', 'billing_staff', 'admin', 'super_admin'] },
    { name: 'Billing To-Do', href: '/todo', icon: CheckSquare, roles: ['billing_staff', 'admin', 'super_admin'] },
    { name: 'Provider Sheet', href: '/provider-sheet', icon: FileText, roles: ['*'] },
    { name: 'Timecards', href: '/timecards', icon: Clock, roles: ['billing_staff', 'admin', 'super_admin'] },
    { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin', 'view_only_admin', 'super_admin'] },
  ]

  const canAccess = (roles: string[]) => {
    if (!userProfile) return false
    if (roles.includes('*')) return true
    return roles.includes(userProfile.role) || userProfile.role === 'super_admin'
  }

  const filteredNavigation = navigation.filter(item => canAccess(item.roles))

  const isActive = (href: string) => location.pathname === href

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-80 bg-slate-900/90 backdrop-blur-md shadow-2xl border-r border-white/10">
        <div className="flex flex-col h-full">
          {/* Logo/Header */}
          <div className="flex items-center justify-center h-16 border-b border-white/10">
            <h1 className="text-xl font-bold text-white">Health Billing</h1>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto scrollbar-hide">
            {userProfile?.role === 'super_admin' ? (
              <>
                {/* Dashboard for Super Admin */}
                <Link
                  to="/dashboard"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive('/dashboard')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <LayoutDashboard size={20} />
                  <span>Dashboard</span>
                </Link>

                {/* Clinics for Super Admin */}
                <div className="mt-2">
                  <div className="px-4 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wider">
                    Clinics
                  </div>
                  {loadingClinics ? (
                    <div className="px-4 py-2 text-xs text-white/50">Loading clinics...</div>
                  ) : (
                    clinics.map((clinic) => {
                      const isExpanded = isClinicExpanded(clinic.id)
                      const clinicPath = `/clinic/${clinic.id}`
                      const isClinicActive = location.pathname.startsWith(clinicPath)
                      
                      return (
                        <div key={clinic.id} className="mb-1">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleClinic(clinic.id)
                              }}
                              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-left flex-1 ${
                                isClinicActive
                                  ? 'bg-primary-600/50 text-white font-medium'
                                  : 'text-white/70 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              {isExpanded ? (
                                <ChevronDown size={16} />
                              ) : (
                                <ChevronRight size={16} />
                              )}
                              <Building2 size={16} />
                              <span className="flex-1 truncate">{clinic.name}</span>
                            </button>
                          </div>
                          
                          {isExpanded && (
                            <div className="ml-6 mt-1 space-y-1">
                              <Link
                                to={`${clinicPath}/patients`}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                  location.pathname === `${clinicPath}/patients`
                                    ? 'bg-primary-600 text-white font-medium'
                                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <Users size={16} />
                                <span>Patient Info</span>
                              </Link>
                              <Link
                                to={`${clinicPath}/todo`}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                  location.pathname === `${clinicPath}/todo`
                                    ? 'bg-primary-600 text-white font-medium'
                                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <CheckSquare size={16} />
                                <span>Billing To-Do</span>
                              </Link>
                              <div className="mb-2">
                                <div className="px-4 py-1 text-xs font-semibold text-white/40 uppercase tracking-wider">
                                  Providers
                                </div>
                                {(() => {
                                  const providers = clinicProviders[clinic.id]
                                  if (providers && providers.length > 0) {
                                    return providers.map((provider) => (
                                      <Link
                                        key={provider.id}
                                        to={`${clinicPath}/providers/${provider.id}`}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ml-2 ${
                                          location.pathname === `${clinicPath}/providers/${provider.id}`
                                            ? 'bg-primary-600 text-white font-medium'
                                            : 'text-white/60 hover:bg-white/10 hover:text-white'
                                        }`}
                                      >
                                        <FileText size={14} />
                                        <span>{provider.first_name} {provider.last_name}</span>
                                        {provider.specialty && (
                                          <span className="text-xs text-white/40">({provider.specialty})</span>
                                        )}
                                      </Link>
                                    ))
                                  } else {
                                    return (
                                      <div className="px-4 py-1 text-xs text-white/40 ml-2">
                                        {providers === undefined ? 'Loading...' : 'No providers'}
                                      </div>
                                    )
                                  }
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Reports, TimeCards, Invoices, Settings for Super Admin */}
                <div className="mt-4">
                  <Link
                    to="/reports"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/reports')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <BarChart3 size={20} />
                    <span>Reports</span>
                  </Link>

                  <Link
                    to="/timecards"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/timecards')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Clock size={20} />
                    <span>TimeCards</span>
                  </Link>

                  <Link
                    to="/invoices"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/invoices')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <DollarSign size={20} />
                    <span>Invoices</span>
                  </Link>

                  {/* Settings with submenu */}
                  <div className="mb-1">
                    <button
                      onClick={toggleSettings}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                        location.pathname.startsWith('/super-admin-settings') || location.pathname.includes('/settings/')
                          ? 'bg-primary-600/50 text-white font-medium'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {expandedSettings ? (
                        <ChevronDown size={16} />

                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <Settings size={20} />
                      <span>Settings</span>
                    </button>

                    {expandedSettings && (
                      <div className="ml-6 mt-1 space-y-1">
                        <Link
                          to="/super-admin-settings?tab=users"
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/super-admin-settings' && location.search.includes('tab=users')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Users size={16} />
                          <span>User Management</span>
                        </Link>
                        <Link
                          to="/super-admin-settings?tab=billing-codes"
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/super-admin-settings' && location.search.includes('tab=billing-codes')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Palette size={16} />
                          <span>Billing Codes</span>
                        </Link>
                        <Link
                          to="/super-admin-settings?tab=clinics"
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/super-admin-settings' && location.search.includes('tab=clinics')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Building2 size={16} />
                          <span>Clinic Management</span>
                        </Link>
                        <Link
                          to="/super-admin-settings?tab=export"
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/super-admin-settings' && location.search.includes('tab=export')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Download size={16} />
                          <span>Export Data</span>
                        </Link>
                        <Link
                          to="/super-admin-settings?tab=audit-logs"
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === '/super-admin-settings' && location.search.includes('tab=audit-logs')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Database size={16} />
                          <span>Audit logs</span>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              filteredNavigation.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive(item.href)
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon size={20} />
                    <span>{item.name}</span>
                  </Link>
                )
              })
            )}

          
          </nav>

          {/* User Info & Sign Out */}
          <div className="border-t border-white/10 p-4">
            <div className="mb-3">
              <div className="text-sm font-medium text-white">
                {userProfile?.full_name || userProfile?.email}
              </div>
              <div className="text-xs text-white/60 capitalize">
                {userProfile?.role?.replace('_', ' ')}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white rounded-lg transition-colors"
            >
              <LogOut size={16} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="pl-80">
        <main className="p-8 text-white">
          {children}
        </main>
      </div>
    </div>
  )
}
