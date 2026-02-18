import { useState, useEffect } from 'react'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { supabase, createSupabaseClientForSignUp, createSupabaseClientWithStorageKey } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { User, BillingCode, Clinic, ProviderSheet, AuditLog, Provider } from '@/types'
import { Users, Palette, FileText, Plus, Edit, Trash2, X, Unlock, Building2, Download, Calendar, Link2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import MonthCloseTab from '@/components/MonthCloseTab'

type SettingsTabId = 'users' | 'billing-codes' | 'audit-logs' | 'unlock' | 'clinics' | 'export' | 'month-close'
type Variant = 'super_admin' | 'admin'

export default function SuperAdminSettings() {
  const { userProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') || 'users'
  const [activeTab, setActiveTab] = useState<SettingsTabId>((tabParam as SettingsTabId) || 'users')

  const isSuperAdminPath = location.pathname.startsWith('/super-admin-settings')
  const isAdminPath = location.pathname.startsWith('/admin-settings')
  const variant: Variant | null =
    isSuperAdminPath && userProfile?.role === 'super_admin'
      ? 'super_admin'
      : (isAdminPath && (userProfile?.role === 'admin' || userProfile?.role === 'super_admin'))
        ? 'admin'
        : null

  useEffect(() => {
    if (!userProfile) return
    if (isSuperAdminPath && userProfile.role !== 'super_admin') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (isAdminPath && userProfile.role !== 'admin' && userProfile.role !== 'super_admin') {
      navigate('/dashboard', { replace: true })
      return
    }
  }, [userProfile, isSuperAdminPath, isAdminPath, navigate])

  const pageTitle = variant === 'super_admin' ? 'Super Admin Settings' : 'Admin Settings'
  const [users, setUsers] = useState<User[]>([])
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [providersByClinic, setProvidersByClinic] = useState<Record<string, Provider[]>>({})
  const [providerLevelsMap, setProviderLevelsMap] = useState<Record<string, number>>({})
  const [providerLevelsLoadError, setProviderLevelsLoadError] = useState(false)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [lockedSheets, setLockedSheets] = useState<ProviderSheet[]>([])
  const [loading, setLoading] = useState(true)
  const [showUserForm, setShowUserForm] = useState(false)
  const [showBillingCodeForm, setShowBillingCodeForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editingBillingCode, setEditingBillingCode] = useState<BillingCode | null>(null)
  const [showClinicForm, setShowClinicForm] = useState(false)
  const [editingClinic, setEditingClinic] = useState<Clinic | null>(null)
  const [assignClinicUser, setAssignClinicUser] = useState<User | null>(null)
  const [showAssignClinicModal, setShowAssignClinicModal] = useState(false)
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false)
  const [deleteUserPassword, setDeleteUserPassword] = useState('')
  const [deleteUserError, setDeleteUserError] = useState('')
  const [deleteUserLoading, setDeleteUserLoading] = useState(false)
  const [clinicToDelete, setClinicToDelete] = useState<Clinic | null>(null)
  const [showDeleteClinicModal, setShowDeleteClinicModal] = useState(false)
  const [deleteClinicPassword, setDeleteClinicPassword] = useState('')
  const [deleteClinicError, setDeleteClinicError] = useState('')
  const [deleteClinicLoading, setDeleteClinicLoading] = useState(false)

  useEffect(() => {
    const tab = (searchParams.get('tab') || 'users') as SettingsTabId
    const validForVariant: SettingsTabId[] =
      variant === 'super_admin'
        ? ['users', 'billing-codes', 'clinics', 'export', 'audit-logs', 'unlock']
        : variant === 'admin'
          ? ['users', 'billing-codes', 'clinics', 'export', 'audit-logs', 'month-close']
          : ['users', 'billing-codes', 'clinics', 'export', 'audit-logs']
    if (validForVariant.includes(tab) && tab !== activeTab) {
      setActiveTab(tab)
    } else if (variant === 'admin' && tab === 'unlock') {
      setActiveTab('users')
      setSearchParams({ tab: 'users' })
    } else if (variant === 'super_admin' && tab === 'month-close') {
      setActiveTab('users')
      setSearchParams({ tab: 'users' })
    }
  }, [searchParams, variant])

  useEffect(() => {
    if (variant) fetchData()
  }, [activeTab, variant])

  const fetchData = async () => {
    if (!variant) return
    setLoading(true)
    try {
      await Promise.all([
        fetchUsers(),
        fetchBillingCodes(),
        fetchClinics(),
      ])

      if (activeTab === 'audit-logs') {
        await fetchAuditLogs()
      } else if (activeTab === 'unlock' && variant === 'super_admin') {
        await fetchLockedSheets()
      } else if (activeTab === 'clinics') {
        await fetchClinics()
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase.from('users').select('*').order('email').not('role', 'eq', 'super_admin')
      if (error) throw error
      let list = data || []
      if (variant === 'admin' && userProfile?.clinic_ids?.length) {
        list = list.filter((u: User) =>
          (u.clinic_ids || []).some((cid: string) => userProfile.clinic_ids.includes(cid))
        )
      }
      
      setUsers(list)
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchBillingCodes = async () => {
    try {
      const { data, error } = await supabase.from('billing_codes').select('*').order('code')
      if (error) throw error
      setBillingCodes(data || [])
    } catch (error) {
      console.error('Error fetching billing codes:', error)
    }
  }

  const fetchClinics = async () => {
    try {
      let query = supabase.from('clinics').select('*').order('name')
      if (variant === 'admin' && userProfile?.clinic_ids?.length) {
        query = query.in('id', userProfile.clinic_ids)
      }
      const { data, error } = await query
      if (error) throw error
      setClinics(data || [])

      const clinicIds = data?.length ? data.map((c: Clinic) => c.id) : []
      await fetchProvidersForClinics(clinicIds)
    } catch (error) {
      console.error('Error fetching clinics:', error)
    }
  }

  const fetchProvidersForClinics = async (clinicIds: string[]) => {
    try {
      let providerList: Provider[] = []
      if (variant === 'super_admin') {
        const { data, error } = await supabase
          .from('providers')
          .select('*')
          .order('last_name')
          .order('first_name')
        if (!error) providerList = data || []
      } else {
        const { data, error } = await supabase
          .from('providers')
          .select('*')
          .overlaps('clinic_ids', clinicIds)
          .order('last_name')
          .order('first_name')
        if (!error) providerList = data || []
      }

      // Group providers by clinic (a provider can appear in multiple clinics)
      const grouped: Record<string, Provider[]> = {}
      providerList.forEach(provider => {
        (provider.clinic_ids || []).forEach((cid: string) => {
          if (!grouped[cid]) grouped[cid] = []
          grouped[cid].push(provider)
        })
      })

      setProvidersByClinic(grouped)
      setProviders(providerList)

      // Provider level is on providers table (level column, 1 or 2)
      if (providerList.length > 0 && variant === 'super_admin') {
        const map: Record<string, number> = {}
        providerList.forEach((p: Provider) => {
          map[p.id] = p.level === 2 ? 2 : 1
        })
        setProviderLevelsMap(map)
        setProviderLevelsLoadError(false)
      } else {
        setProviderLevelsMap({})
        setProviderLevelsLoadError(false)
      }
    } catch (error) {
      console.error('Error fetching providers:', error)
    }
  }

  const fetchAuditLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setAuditLogs(data || [])
    } catch (error) {
      console.error('Error fetching audit logs:', error)
    }
  }

  const fetchLockedSheets = async () => {
    try {
      const { data, error } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('locked', true)
        .order('updated_at', { ascending: false })

      if (error) throw error
      setLockedSheets(data || [])
    } catch (error) {
      console.error('Error fetching locked sheets:', error)
    }
  }

  const handleSaveUser = async (
    userData: Partial<User>,
    providerLevel?: number,
    providerCutPercent?: number,
    temporaryPassword?: string
  ) => {
    try {
      if (editingUser) {
        const { error } = await supabase
          .from('users')
          .update(userData)
          .eq('id', editingUser.id)

        if (error) throw error

        // Super admin: update provider level and provider_cut_percent on providers table
        if (variant === 'super_admin' && editingUser.role === 'provider') {
          const providersForEmail = providers.filter(p => p.email === editingUser.email)
          for (const p of providersForEmail) {
            const updatePayload: { level?: number; provider_cut_percent?: number; updated_at: string } = {
              updated_at: new Date().toISOString(),
            }
            if (providerLevel !== undefined && (providerLevel === 1 || providerLevel === 2)) {
              updatePayload.level = providerLevel
            }
            if (providerCutPercent !== undefined && providerCutPercent >= 0 && providerCutPercent <= 1) {
              updatePayload.provider_cut_percent = providerCutPercent
            }
            const { error: providerError } = await supabase
              .from('providers')
              .update(updatePayload)
              .eq('id', p.id)
            if (providerError) throw providerError
          }
        }
        await fetchUsers()
        if (variant === 'super_admin') await fetchClinics()
        setShowUserForm(false)
        setEditingUser(null)
      } else {
        // Add User: create auth user with a separate client so current session stays intact
        const email = (userData.email || '').trim()
        if (!email) {
          alert('Email is required.')
          return
        }
        if (!temporaryPassword || temporaryPassword.length < 6) {
          alert('Please enter a temporary password (at least 6 characters).')
          return
        }
        const tempClient = createSupabaseClientForSignUp()
        const { data: authData, error: signUpError } = await tempClient.auth.signUp({
          email,
          password: temporaryPassword,
          options: {
            data: {
              full_name: userData.full_name || '',
              role: userData.role || 'billing_staff',
            },
          },
        })
        await tempClient.auth.signOut()
        if (signUpError) {
          alert(signUpError.message || 'Failed to create user. Please try again.')
          return
        }
        const newUserId = authData.user?.id
        if (!newUserId) {
          alert('User was created but could not get user id. Please refresh the user list.')
          await fetchUsers()
          setShowUserForm(false)
          setEditingUser(null)
          return
        }
        const { error: updateError } = await supabase
          .from('users')
          .update({
            full_name: userData.full_name ?? null,
            role: userData.role ?? 'billing_staff',
            hourly_pay: userData.hourly_pay ?? null,
            email,
            updated_at: new Date().toISOString(),
          })
          .eq('id', newUserId)
        if (updateError) {
          console.error('Error updating new user profile:', updateError)
          alert('User was created but profile update failed. You can edit the user to set details.')
        }
        if (userData.hourly_pay != null && userData.hourly_pay > 0) {
          const now = new Date()
          const weekStart = new Date(now)
          const day = weekStart.getDay()
          const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
          weekStart.setDate(diff)
          weekStart.setHours(0, 0, 0, 0)
          const { error: tcError } = await supabase.from('timecards').insert({
            user_id: newUserId,
            clock_in: now.toISOString(),
            clock_out: now.toISOString(),
            hours: 0,
            hourly_pay: userData.hourly_pay,
            week_start_date: weekStart.toISOString().split('T')[0],
          })
          if (tcError) {
            console.error('Error saving hourly pay to timecards:', tcError)
          }
        }
        await fetchUsers()
        if (variant === 'super_admin') await fetchClinics()
        setShowUserForm(false)
        setEditingUser(null)
      }
    } catch (error) {
      console.error('Error saving user:', error)
      alert('Failed to save user. Please try again.')
    }
  }

  const handleSaveAssignClinics = async (userId: string, clinicIds: string[]) => {
    console.log('handleSaveAssignClinics', userId, clinicIds)
    try {
      const { error } = await supabase
        .from('users')
        .update({ clinic_ids: clinicIds })
        .eq('id', userId)

      if (error) throw error
      await fetchUsers()
      setShowAssignClinicModal(false)
      setAssignClinicUser(null)
    } catch (error) {
      console.error('Error assigning clinics:', error)
      alert('Failed to assign clinics. Please try again.')
    }
  }

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete || !userProfile?.email) return
    if (userToDelete.id === userProfile.id) {
      setDeleteUserError('You cannot delete your own account.')
      return
    }
    if (!deleteUserPassword.trim()) {
      setDeleteUserError('Please enter your password.')
      return
    }
    setDeleteUserError('')
    setDeleteUserLoading(true)
    try {
      const tempClient = createSupabaseClientWithStorageKey('health-billing-auth-verify-password')
      const { error: signInError } = await tempClient.auth.signInWithPassword({
        email: userProfile.email,
        password: deleteUserPassword,
      })
      await tempClient.auth.signOut()
      if (signInError) {
        setDeleteUserError('Incorrect password.')
        setDeleteUserLoading(false)
        return
      }
      const { error: deleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', userToDelete.id)
      if (deleteError) {
        setDeleteUserError(deleteError.message || 'Failed to delete user. Please try again.')
        setDeleteUserLoading(false)
        return
      }
      setShowDeleteUserModal(false)
      setUserToDelete(null)
      setDeleteUserPassword('')
      await fetchUsers()
      if (variant === 'super_admin') await fetchClinics()
    } catch (error) {
      console.error('Error deleting user:', error)
      setDeleteUserError('Failed to delete user. Please try again.')
    } finally {
      setDeleteUserLoading(false)
    }
  }

  const handleSaveBillingCode = async (codeData: Partial<BillingCode>) => {
    try {
      if (editingBillingCode) {
        const { error } = await supabase
          .from('billing_codes')
          .update(codeData)
          .eq('id', editingBillingCode.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('billing_codes')
          .insert(codeData)

        if (error) throw error
      }
      await fetchBillingCodes()
      setShowBillingCodeForm(false)
      setEditingBillingCode(null)
    } catch (error) {
      console.error('Error saving billing code:', error)
      alert('Failed to save billing code. Please try again.')
    }
  }

  const handleSaveClinic = async (clinicData: Partial<Clinic>) => {
    try {
      if (editingClinic) {
        const { error } = await supabase
          .from('clinics')
          .update({
            name: clinicData.name ?? editingClinic.name,
            address: clinicData.address ?? editingClinic.address,
            address_line_2: clinicData.address_line_2 ?? editingClinic.address_line_2 ?? null,
            phone: clinicData.phone ?? editingClinic.phone,
            fax: clinicData.fax ?? editingClinic.fax ?? null,
            npi: clinicData.npi ?? editingClinic.npi ?? null,
            ein: clinicData.ein ?? editingClinic.ein ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingClinic.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('clinics')
          .insert({
            name: clinicData.name ?? '',
            address: clinicData.address ?? null,
            address_line_2: clinicData.address_line_2 ?? null,
            phone: clinicData.phone ?? null,
            fax: clinicData.fax ?? null,
            npi: clinicData.npi ?? null,
            ein: clinicData.ein ?? null,
          })

        if (error) throw error
      }
      await fetchClinics()
      setShowClinicForm(false)
      setEditingClinic(null)
    } catch (error) {
      console.error('Error saving clinic:', error)
      alert('Failed to save clinic. Please try again.')
    }
  }

  const handleConfirmDeleteClinic = async () => {
    if (!clinicToDelete || !userProfile?.email) return
    if (!deleteClinicPassword.trim()) {
      setDeleteClinicError('Please enter your password.')
      return
    }
    setDeleteClinicError('')
    setDeleteClinicLoading(true)
    try {
      const tempClient = createSupabaseClientWithStorageKey('health-billing-auth-verify-password')
      const { error: signInError } = await tempClient.auth.signInWithPassword({
        email: userProfile.email,
        password: deleteClinicPassword,
      })
      await tempClient.auth.signOut()
      if (signInError) {
        setDeleteClinicError('Incorrect password.')
        setDeleteClinicLoading(false)
        return
      }
      const { error: deleteError } = await supabase.from('clinics').delete().eq('id', clinicToDelete.id)
      if (deleteError) {
        setDeleteClinicError(deleteError.message || 'Failed to delete clinic. Please try again.')
        setDeleteClinicLoading(false)
        return
      }
      setShowDeleteClinicModal(false)
      setClinicToDelete(null)
      setDeleteClinicPassword('')
      await fetchClinics()
    } catch (error) {
      console.error('Error deleting clinic:', error)
      setDeleteClinicError('Failed to delete clinic. Please try again.')
    } finally {
      setDeleteClinicLoading(false)
    }
  }

  const handleDeleteBillingCode = async (id: string) => {
    if (!confirm('Are you sure you want to delete this billing code?')) return

    try {
      const { error } = await supabase
        .from('billing_codes')
        .delete()
        .eq('id', id)

      if (error) throw error
      await fetchBillingCodes()
    } catch (error) {
      console.error('Error deleting billing code:', error)
      alert('Failed to delete billing code. Please try again.')
    }
  }

  const handleUnlockSheet = async (sheetId: string) => {
    if (!confirm('Are you sure you want to unlock this sheet?')) return

    try {
      const { error } = await supabase
        .from('provider_sheets')
        .update({
          locked: false,
          locked_columns: [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', sheetId)

      if (error) throw error
      await fetchLockedSheets()
    } catch (error) {
      console.error('Error unlocking sheet:', error)
      alert('Failed to unlock sheet. Please try again.')
    }
  }

  const baseTabs = [
    { id: 'users' as const, label: 'User Management', icon: Users },
    { id: 'billing-codes' as const, label: 'Billing Codes', icon: Palette },
    { id: 'clinics' as const, label: 'Clinic Management', icon: Building2 },
    { id: 'export' as const, label: 'Export Data', icon: Download },
    { id: 'audit-logs' as const, label: 'Audit Logs', icon: FileText },
  ]
  const tabs =
    variant === 'super_admin'
      ? [...baseTabs, { id: 'unlock' as const, label: 'Locked Sheets', icon: Unlock }]
      : variant === 'admin'
        ? [...baseTabs, { id: 'month-close' as const, label: 'Month Close', icon: Calendar }]
        : baseTabs

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as SettingsTabId)
    setSearchParams({ tab: tabId })
  }

  if (variant === null) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-6">{pageTitle}</h1>

      <div className="bg-white/10 rounded-lg shadow-md">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-1 p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <Icon size={18} />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-gray-700">Loading...</div>
          ) : (
            <>
              {activeTab === 'users' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">User Management</h2>
                    <button
                      onClick={() => {
                        setEditingUser(null)
                        setShowUserForm(true)
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                    >
                      <Plus size={18} />
                      Add User
                    </button>
                  </div>

                  <div className="table-container dark-theme">
                    <table className="table-spreadsheet dark-theme">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Name</th>
                          <th>Role</th>
                          {variant === 'super_admin' && <th>Provider Level</th>}
                          <th>Clinics</th>
                          <th>Assign Clinics</th>
                          <th style={{ width: '80px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => {
                          const providersForUser = user.role === 'provider' ? providers.filter(p => p.email === user.email) : []
                          const levelInMap = providersForUser.length > 0 ? providerLevelsMap[providersForUser[0].id] : undefined
                          const displayLevel = providersForUser.length > 0
                            ? (levelInMap ?? (providerLevelsLoadError ? null : 1))
                            : null
                          const providerCutPercent = providersForUser.length > 0 ? (providersForUser[0].provider_cut_percent ?? 0.7) : 0.7
                          const levelAndPercent = displayLevel != null
                            ? `${displayLevel === 1 ? 'Partial' : 'Full'}, ${Math.round(providerCutPercent * 100)}%`
                            : null
                          return (
                            <tr key={user.id}>
                              <td>{user.email}</td>
                              <td>{user.full_name || '-'}</td>
                              <td>
                                <span className="status-badge" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>
                                  {user.role}
                                </span>
                              </td>
                              {variant === 'super_admin' && (
                                <td>
                                  {user.role === 'provider' ? (levelAndPercent != null ? levelAndPercent : <span title={providerLevelsLoadError ? 'Level could not be loaded' : undefined}>—</span>) : <span className="text-white/50">—</span>}
                                </td>
                              )}
                              <td>
                                {user.clinic_ids.length > 0
                                  ? user.clinic_ids.length + ' clinic(s)'
                                  : 'None'}
                              </td>
                              <td>
                                {(user.role === 'provider' || user.role === 'admin' || user.role === 'billing_staff' || user.role === 'office_staff') ? (
                                  <button
                                    onClick={() => {
                                      setAssignClinicUser(user)
                                      setShowAssignClinicModal(true)
                                    }}
                                    className="text-primary-400 hover:text-primary-300 inline-flex items-center gap-1"
                                    style={{ padding: '4px' }}
                                    title="Assign clinics"
                                  >
                                    <Link2 size={16} />
                                  </button>
                                ) : (
                                  <span className="text-white/50">—</span>
                                )}
                              </td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setEditingUser(user)
                                      setShowUserForm(true)
                                    }}
                                    className="text-primary-400 hover:text-primary-300"
                                    style={{ padding: '4px' }}
                                    title="Edit"
                                  >
                                    <Edit size={16} />
                                  </button>
                                  {variant === 'super_admin' && user.id !== userProfile?.id && (
                                    <button
                                      onClick={() => {
                                        setUserToDelete(user)
                                        setShowDeleteUserModal(true)
                                        setDeleteUserPassword('')
                                        setDeleteUserError('')
                                      }}
                                      className="text-red-400 hover:text-red-300"
                                      style={{ padding: '4px' }}
                                      title="Delete user"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'billing-codes' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Billing Codes</h2>
                    <button
                      onClick={() => {
                        setEditingBillingCode(null)
                        setShowBillingCodeForm(true)
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                    >
                      <Plus size={18} />
                      Add Code
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {billingCodes.map((code) => (
                      <div
                        key={code.id}
                        className="border border-gray-200 rounded-lg p-4"
                        style={{ borderLeftColor: code.color, borderLeftWidth: '4px' }}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="font-semibold text-white">{code.code}</h3>
                            {code.description && (
                              <p className="text-sm text-white/90">{code.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingBillingCode(code)
                                setShowBillingCodeForm(true)
                              }}
                              className="text-primary-600 hover:text-primary-700"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteBillingCode(code.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <div
                          className="w-full h-4 rounded"
                          style={{ backgroundColor: code.color }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'audit-logs' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Audit Logs</h2>
                  <div className="table-container dark-theme">
                    <table className="table-spreadsheet dark-theme">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>User</th>
                          <th>Action</th>
                          <th>Table</th>
                          <th>Record ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{formatDateTime(log.created_at)}</td>
                            <td>
                              {users.find(u => u.id === log.user_id)?.email || log.user_id}
                            </td>
                            <td>
                              <span className="status-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff' }}>
                                {log.action}
                              </span>
                            </td>
                            <td>{log.table_name}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{log.record_id.substring(0, 8)}...</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'clinics' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Clinic Management</h2>
                    <button
                      onClick={() => {
                        setEditingClinic(null)
                        setShowClinicForm(true)
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                    >
                      <Plus size={18} />
                      Add Clinic
                    </button>
                  </div>

                  <div className="table-container dark-theme">
                    <table className="table-spreadsheet dark-theme">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Address</th>
                          <th>Phone</th>
                          <th>Providers</th>
                          <th>Created</th>
                          <th style={{ width: '80px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clinics.map((clinic) => {
                          const clinicProviders = providersByClinic[clinic.id] || []
                          return (
                            <tr key={clinic.id}>
                              <td>{clinic.name}</td>
                              <td>{clinic.address || '-'}</td>
                              <td>{clinic.phone || '-'}</td>
                              <td>
                                {clinicProviders.length > 0 ? (
                                  <div className="space-y-1">
                                    {clinicProviders.map((provider) => (
                                      <div key={provider.id} className="text-sm">
                                        {provider.first_name} {provider.last_name}
                                        {provider.specialty && (
                                          <span className="text-white/60 ml-2">({provider.specialty})</span>
                                        )}
                                        {!provider.active && (
                                          <span className="text-red-400 ml-2 text-xs">(Inactive)</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-white/50">No providers</span>
                                )}
                              </td>
                              <td>{formatDateTime(clinic.created_at)}</td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setEditingClinic(clinic)
                                      setShowClinicForm(true)
                                    }}
                                    className="text-primary-400 hover:text-primary-300"
                                    style={{ padding: '4px' }}
                                    title="Edit"
                                  >
                                    <Edit size={16} />
                                  </button>
                                  {variant === 'super_admin' && (
                                    <button
                                      onClick={() => {
                                        setClinicToDelete(clinic)
                                        setShowDeleteClinicModal(true)
                                        setDeleteClinicPassword('')
                                        setDeleteClinicError('')
                                      }}
                                      className="text-red-400 hover:text-red-300"
                                      style={{ padding: '4px' }}
                                      title="Delete clinic"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'export' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Export Data</h2>
                  <div className="space-y-4">
                    <div className="bg-white/5 rounded-lg p-6 border border-white/20">
                      <h3 className="text-lg font-semibold text-white mb-4">Export Options</h3>
                      <div className="space-y-3">
                        <button
                          onClick={async () => {
                            try {
                              const { data: users } = await supabase.from('users').select('*')
                              const blob = new Blob([JSON.stringify(users, null, 2)], { type: 'application/json' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `users-${new Date().toISOString().split('T')[0]}.json`
                              a.click()
                            } catch (error) {
                              console.error('Error exporting users:', error)
                              alert('Failed to export users')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Users
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const { data: clinics } = await supabase.from('clinics').select('*')
                              const blob = new Blob([JSON.stringify(clinics, null, 2)], { type: 'application/json' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `clinics-${new Date().toISOString().split('T')[0]}.json`
                              a.click()
                            } catch (error) {
                              console.error('Error exporting clinics:', error)
                              alert('Failed to export clinics')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Clinics
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const { data: patients } = await supabase.from('patients').select('*')
                              const blob = new Blob([JSON.stringify(patients, null, 2)], { type: 'application/json' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `patients-${new Date().toISOString().split('T')[0]}.json`
                              a.click()
                            } catch (error) {
                              console.error('Error exporting patients:', error)
                              alert('Failed to export patients')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Patients
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const { data: auditLogs } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(1000)
                              const blob = new Blob([JSON.stringify(auditLogs, null, 2)], { type: 'application/json' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.json`
                              a.click()
                            } catch (error) {
                              console.error('Error exporting audit logs:', error)
                              alert('Failed to export audit logs')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Audit Logs
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'unlock' && variant === 'super_admin' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Locked Sheets</h2>
                  <div className="space-y-4">
                    {lockedSheets.map((sheet) => (
                      <div
                        key={sheet.id}
                        className="border border-white/20 rounded-lg p-4 flex justify-between items-center bg-white/5"
                      >
                        <div>
                          <p className="font-medium text-white">
                            Sheet for Month {sheet.month}/{sheet.year}
                          </p>
                          <p className="text-sm text-white/80">
                            Locked columns: {sheet.locked_columns.join(', ') || 'None'}
                          </p>
                          <p className="text-xs text-white/60 mt-1">
                            Locked: {formatDateTime(sheet.updated_at)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleUnlockSheet(sheet.id)}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                          <Unlock size={16} />
                          Unlock
                        </button>
                      </div>
                    ))}
                    {lockedSheets.length === 0 && (
                      <p className="text-center text-white/60 py-8">No locked sheets</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'month-close' && variant === 'admin' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Month Close & Locking</h2>
                  <MonthCloseTab />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showUserForm && (
        <UserFormModal
          user={editingUser}
          providers={providers}
          providerLevelsMap={providerLevelsMap}
          variant={variant}
          onClose={() => {
            setShowUserForm(false)
            setEditingUser(null)
          }}
          onSave={handleSaveUser}
        />
      )}

      {showBillingCodeForm && (
        <BillingCodeFormModal
          code={editingBillingCode}
          onClose={() => {
            setShowBillingCodeForm(false)
            setEditingBillingCode(null)
          }}
          onSave={handleSaveBillingCode}
        />
      )}

      {showClinicForm && (
        <ClinicFormModal
          clinic={editingClinic}
          onClose={() => {
            setShowClinicForm(false)
            setEditingClinic(null)
          }}
          onSave={handleSaveClinic}
        />
      )}

      {showAssignClinicModal && assignClinicUser && (
        <AssignClinicsModal
          user={assignClinicUser}
          clinics={clinics}
          onClose={() => {
            setShowAssignClinicModal(false)
            setAssignClinicUser(null)
          }}
          onSave={(clinicIds) => handleSaveAssignClinics(assignClinicUser.id, clinicIds)}
        />
      )}

      {showDeleteUserModal && userToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Delete user</h2>
              <button
                onClick={() => {
                  setShowDeleteUserModal(false)
                  setUserToDelete(null)
                  setDeleteUserPassword('')
                  setDeleteUserError('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-700">
                Permanently delete <strong>{userToDelete.email}</strong>? This cannot be undone. Enter your password to confirm.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your password (super admin)</label>
                <input
                  type="password"
                  value={deleteUserPassword}
                  onChange={(e) => {
                    setDeleteUserPassword(e.target.value)
                    setDeleteUserError('')
                  }}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                  disabled={deleteUserLoading}
                />
                {deleteUserError && (
                  <p className="text-sm text-red-600 mt-1">{deleteUserError}</p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteUserModal(false)
                    setUserToDelete(null)
                    setDeleteUserPassword('')
                    setDeleteUserError('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  disabled={deleteUserLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteUser}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  disabled={deleteUserLoading}
                >
                  {deleteUserLoading ? 'Deleting...' : 'Delete user'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteClinicModal && clinicToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Delete clinic</h2>
              <button
                onClick={() => {
                  setShowDeleteClinicModal(false)
                  setClinicToDelete(null)
                  setDeleteClinicPassword('')
                  setDeleteClinicError('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-700">
                Permanently delete clinic <strong>{clinicToDelete.name}</strong>? This will remove all related data (patients, providers, sheets, etc.) and cannot be undone. Enter your password to confirm.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your password (super admin)</label>
                <input
                  type="password"
                  value={deleteClinicPassword}
                  onChange={(e) => {
                    setDeleteClinicPassword(e.target.value)
                    setDeleteClinicError('')
                  }}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                  disabled={deleteClinicLoading}
                />
                {deleteClinicError && (
                  <p className="text-sm text-red-600 mt-1">{deleteClinicError}</p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteClinicModal(false)
                    setClinicToDelete(null)
                    setDeleteClinicPassword('')
                    setDeleteClinicError('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  disabled={deleteClinicLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteClinic}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  disabled={deleteClinicLoading}
                >
                  {deleteClinicLoading ? 'Deleting...' : 'Delete clinic'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UserFormModal({
  user,
  providers,
  providerLevelsMap,
  variant,
  onClose,
  onSave,
}: {
  user: User | null
  providers: Provider[]
  providerLevelsMap: Record<string, number>
  variant: Variant | null
  onSave: (data: Partial<User>, providerLevel?: number, providerCutPercent?: number, temporaryPassword?: string) => Promise<void>
  onClose: () => void
}) {
  const providersForUser = user?.role === 'provider' && user?.email ? providers.filter(p => p.email === user.email) : []
  const initialLevel = providersForUser.length > 0 ? (providerLevelsMap[providersForUser[0].id] ?? 1) : 1
  const initialCutPercent = providersForUser.length > 0 ? (providersForUser[0].provider_cut_percent ?? 0.7) : 0.7
  const [formData, setFormData] = useState({
    email: user?.email || '',
    full_name: user?.full_name || '',
    role: user?.role || 'provider',
    clinic_ids: user?.clinic_ids || [],
    highlight_color: user?.highlight_color || '#3b82f6',
    provider_level: initialLevel as 1 | 2,
    provider_cut_percent: initialCutPercent,
    hourly_pay: user?.hourly_pay ?? '',
    password: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { provider_level, provider_cut_percent, hourly_pay, password, ...rest } = formData
    const userData = {
      ...rest,
      hourly_pay: hourly_pay === '' || hourly_pay == null ? null : Number(hourly_pay),
    }
    await onSave(
      userData,
      formData.role === 'provider' ? provider_level : undefined,
      formData.role === 'provider' ? provider_cut_percent : undefined,
      user ? undefined : password
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {user ? 'Edit User' : 'Add User'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="user@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>

          {!user && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Temporary password</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Min 6 characters"
                minLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
              <p className="text-xs text-gray-500 mt-1">User will sign in with this password; they can change it later.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            >
              {/* <option value="super_admin">Super Admin</option> */}
              <option value="admin">Admin</option>
              {/* <option value="view_only_admin">View-Only Admin</option> */}
              <option value="billing_staff">Billing Staff</option>
              {/* <option value="view_only_billing">View-Only Billing</option> */}
              {/* <option value="official_staff">Official Staff</option> */}
              <option value="provider">Provider</option>
              <option value="office_staff">Office Staff</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hourly pay amount</label>
            <input
              type="number"
              min={0}
              step={0.01}
              placeholder="e.g. 25.00"
              value={formData.hourly_pay === '' ? '' : formData.hourly_pay}
              onChange={(e) => setFormData({ ...formData, hourly_pay: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
            <p className="text-xs text-gray-500 mt-1">Stored on user and applied to timecard entries.</p>
          </div>

          {variant === 'super_admin' && formData.role === 'provider' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider Level</label>
                <select
                  value={formData.provider_level}
                  onChange={(e) => setFormData({ ...formData, provider_level: Number(e.target.value) as 1 | 2 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                >
                  <option value={1}>Partial</option>
                  <option value={2}>Full</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Partial or Full (default is Partial).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider cut %</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={formData.provider_cut_percent}
                  onChange={(e) => setFormData({ ...formData, provider_cut_percent: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                />
                <p className="text-xs text-gray-500 mt-1">Decimal 0–1 (e.g. 0.7 = 70%). Default 0.7. Provider Cut = Total Payments × this.</p>
              </div>
            </>
          )}

          {/* <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Highlight Color</label>
            <input
              type="color"
              value={formData.highlight_color}
              onChange={(e) => setFormData({ ...formData, highlight_color: e.target.value })}
              className="w-full h-10 border border-gray-300 rounded-lg"
            />
          </div> */}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BillingCodeFormModal({
  code,
  onClose,
  onSave,
}: {
  code: BillingCode | null
  onSave: (data: Partial<BillingCode>) => Promise<void>
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    code: code?.code || '',
    description: code?.description || '',
    color: code?.color || '#3b82f6',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code.trim()) {
      alert('Code is required')
      return
    }
    await onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {code ? 'Edit Billing Code' : 'Add Billing Code'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
            <input
              type="text"
              required
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <input
              type="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="w-full h-10 border border-gray-300 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ClinicFormModal({
  clinic,
  onClose,
  onSave,
}: {
  clinic: Clinic | null
  onSave: (data: Partial<Clinic>) => Promise<void>
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: clinic?.name ?? '',
    address: clinic?.address ?? '',
    address_line_2: clinic?.address_line_2 ?? '',
    phone: clinic?.phone ?? '',
    fax: clinic?.fax ?? '',
    npi: clinic?.npi ?? '',
    ein: clinic?.ein ?? '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      alert('Clinic name is required')
      return
    }
    await onSave({
      name: formData.name.trim(),
      address: formData.address.trim() || null,
      address_line_2: formData.address_line_2.trim() || null,
      phone: formData.phone.trim() || null,
      fax: formData.fax.trim() || null,
      npi: formData.npi.trim() || null,
      ein: formData.ein.trim() || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {clinic ? 'Edit Clinic' : 'Add Clinic'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address 1</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address 2</label>
            <input
              type="text"
              value={formData.address_line_2}
              onChange={(e) => setFormData({ ...formData, address_line_2: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fax</label>
            <input
              type="text"
              value={formData.fax}
              onChange={(e) => setFormData({ ...formData, fax: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">NPI</label>
            <input
              type="text"
              value={formData.npi}
              onChange={(e) => setFormData({ ...formData, npi: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              placeholder="National Provider Identifier"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">EIN</label>
            <input
              type="text"
              value={formData.ein}
              onChange={(e) => setFormData({ ...formData, ein: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              placeholder="Employer Identification Number"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AssignClinicsModal({
  user,
  clinics,
  onClose,
  onSave,
}: {
  user: User
  clinics: Clinic[]
  onClose: () => void
  onSave: (clinicIds: string[]) => Promise<void>
}) {
  const [selectedClinicIds, setSelectedClinicIds] = useState<Set<string>>(
    () => new Set(user.clinic_ids || [])
  )

  const isOfficeStaff = user.role === 'office_staff'

  const toggleClinic = (clinicId: string) => {
    setSelectedClinicIds((prev) => {
      const next = new Set(prev)
      if (next.has(clinicId)) {
        next.delete(clinicId)
        return next
      }
      if (isOfficeStaff && next.size >= 1) {
        alert('Office staff can be assigned only one clinic. Please remove the current selection first if you want to change it.')
        return prev
      }
      next.add(clinicId)
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isOfficeStaff && selectedClinicIds.size > 1) {
      alert('Office staff can be assigned only one clinic. Please select only one clinic.')
      return
    }
    await onSave(Array.from(selectedClinicIds))
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Assign Clinics — {user.full_name || user.email}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 overflow-y-auto flex-1">
            <p className="text-sm text-gray-600 mb-4">
              Select clinics to assign to this user. Provider, admin, and billing staff may have multiple clinics. Office staff can be assigned only one clinic.
            </p>
            {isOfficeStaff && (
              <p className="text-sm text-amber-600 font-medium mb-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Office staff: only one clinic can be assigned. Selecting another clinic will show a warning.
              </p>
            )}
            <div className="space-y-2">
              {clinics.map((clinic) => (
                <label
                  key={clinic.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedClinicIds.has(clinic.id)}
                    onChange={() => toggleClinic(clinic.id)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="font-medium text-gray-900">{clinic.name}</span>
                  {clinic.address && (
                    <span className="text-sm text-gray-500 truncate flex-1">{clinic.address}</span>
                  )}
                </label>
              ))}
            </div>
            {clinics.length === 0 && (
              <p className="text-sm text-gray-500">No clinics available.</p>
            )}
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
