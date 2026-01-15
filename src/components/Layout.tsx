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
  UserCog
} from 'lucide-react'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { userProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['*'] },
    { name: 'Patient Database', href: '/patients', icon: Users, roles: ['office_staff', 'billing_staff', 'admin', 'super_admin'] },
    { name: 'Billing To-Do', href: '/todo', icon: CheckSquare, roles: ['billing_staff', 'admin', 'super_admin'] },
    { name: 'Provider Sheet', href: '/provider-sheet', icon: FileText, roles: ['*'] },
    { name: 'Timecards', href: '/timecards', icon: Clock, roles: ['billing_staff', 'admin', 'super_admin'] },
    { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin', 'view_only_admin', 'super_admin'] },
  ]

  const settingsNav = [
    { name: 'Admin Settings', href: '/admin-settings', icon: Settings, roles: ['admin', 'super_admin'] },
    { name: 'Super Admin', href: '/super-admin-settings', icon: UserCog, roles: ['super_admin'] },
  ]

  const canAccess = (roles: string[]) => {
    if (!userProfile) return false
    if (roles.includes('*')) return true
    return roles.includes(userProfile.role) || userProfile.role === 'super_admin'
  }

  const filteredNavigation = navigation.filter(item => canAccess(item.roles))
  const filteredSettings = settingsNav.filter(item => canAccess(item.roles))

  const isActive = (href: string) => location.pathname === href

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-64 bg-slate-900/90 backdrop-blur-md shadow-2xl border-r border-white/10">
        <div className="flex flex-col h-full">
          {/* Logo/Header */}
          <div className="flex items-center justify-center h-16 border-b border-white/10">
            <h1 className="text-xl font-bold text-white">Health Billing</h1>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {filteredNavigation.map((item) => {
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
            })}

            {filteredSettings.length > 0 && (
              <div className="pt-6 mt-6 border-t border-white/10">
                <div className="px-4 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wider">
                  Settings
                </div>
                {filteredSettings.map((item) => {
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
                })}
              </div>
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
      <div className="pl-64">
        <main className="p-8 text-white">
          {children}
        </main>
      </div>
    </div>
  )
}
