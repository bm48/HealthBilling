import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { User, BillingCode, Clinic, ProviderSheet, AuditLog } from '@/types'
import { Users, Palette, Lock, FileText, Plus, Edit, Trash2, X, Mail, Unlock } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

export default function SuperAdminSettings() {
  const [activeTab, setActiveTab] = useState<'users' | 'billing-codes' | 'audit-logs' | 'unlock'>('users')
  const [users, setUsers] = useState<User[]>([])
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [lockedSheets, setLockedSheets] = useState<ProviderSheet[]>([])
  const [loading, setLoading] = useState(true)
  const [showUserForm, setShowUserForm] = useState(false)
  const [showBillingCodeForm, setShowBillingCodeForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editingBillingCode, setEditingBillingCode] = useState<BillingCode | null>(null)

  useEffect(() => {
    fetchData()
  }, [activeTab])

  const fetchData = async () => {
    setLoading(true)
    try {
      await Promise.all([
        fetchUsers(),
        fetchBillingCodes(),
        fetchClinics(),
      ])

      if (activeTab === 'audit-logs') {
        await fetchAuditLogs()
      } else if (activeTab === 'unlock') {
        await fetchLockedSheets()
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase.from('users').select('*').order('email')
      if (error) throw error
      setUsers(data || [])
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
      const { data, error } = await supabase.from('clinics').select('*').order('name')
      if (error) throw error
      setClinics(data || [])
    } catch (error) {
      console.error('Error fetching clinics:', error)
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

  const handleSaveUser = async (userData: Partial<User>) => {
    try {
      if (editingUser) {
        const { error } = await supabase
          .from('users')
          .update(userData)
          .eq('id', editingUser.id)

        if (error) throw error
      }
      await fetchUsers()
      setShowUserForm(false)
      setEditingUser(null)
    } catch (error) {
      console.error('Error saving user:', error)
      alert('Failed to save user. Please try again.')
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

  const tabs = [
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'billing-codes', label: 'Billing Codes', icon: Palette },
    { id: 'audit-logs', label: 'Audit Logs', icon: FileText },
    { id: 'unlock', label: 'Unlock Sheets', icon: Unlock },
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Super Admin Settings</h1>

      <div className="bg-white rounded-lg shadow-md">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-1 p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
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
            <div className="text-center py-8">Loading...</div>
          ) : (
            <>
              {activeTab === 'users' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">User Management</h2>
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

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Role</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Clinics</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Highlight Color</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {users.map((user) => (
                          <tr key={user.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm">{user.email}</td>
                            <td className="px-4 py-3 text-sm">{user.full_name || '-'}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                                {user.role}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {user.clinic_ids.length > 0
                                ? user.clinic_ids.length + ' clinic(s)'
                                : 'None'}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {user.highlight_color && (
                                <div
                                  className="w-8 h-8 rounded border border-gray-300"
                                  style={{ backgroundColor: user.highlight_color }}
                                />
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <button
                                onClick={() => {
                                  setEditingUser(user)
                                  setShowUserForm(true)
                                }}
                                className="text-primary-600 hover:text-primary-700"
                              >
                                <Edit size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'billing-codes' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">Billing Codes</h2>
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
                            <h3 className="font-semibold text-gray-900">{code.code}</h3>
                            {code.description && (
                              <p className="text-sm text-gray-600">{code.description}</p>
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
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">Audit Logs</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Date</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">User</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Action</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Table</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Record ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm">{formatDateTime(log.created_at)}</td>
                            <td className="px-4 py-3 text-sm">
                              {users.find(u => u.id === log.user_id)?.email || log.user_id}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs">
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm">{log.table_name}</td>
                            <td className="px-4 py-3 text-sm font-mono text-xs">{log.record_id.substring(0, 8)}...</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'unlock' && (
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">Locked Sheets</h2>
                  <div className="space-y-4">
                    {lockedSheets.map((sheet) => (
                      <div
                        key={sheet.id}
                        className="border border-gray-200 rounded-lg p-4 flex justify-between items-center"
                      >
                        <div>
                          <p className="font-medium text-gray-900">
                            Sheet for Month {sheet.month}/{sheet.year}
                          </p>
                          <p className="text-sm text-gray-600">
                            Locked columns: {sheet.locked_columns.join(', ') || 'None'}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
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
                      <p className="text-center text-gray-500 py-8">No locked sheets</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showUserForm && (
        <UserFormModal
          user={editingUser}
          clinics={clinics}
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
    </div>
  )
}

function UserFormModal({
  user,
  clinics,
  onClose,
  onSave,
}: {
  user: User | null
  clinics: Clinic[]
  onSave: (data: Partial<User>) => Promise<void>
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    full_name: user?.full_name || '',
    role: user?.role || 'provider',
    clinic_ids: user?.clinic_ids || [],
    highlight_color: user?.highlight_color || '#3b82f6',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave(formData)
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="super_admin">Super Admin</option>
              <option value="admin">Admin</option>
              <option value="view_only_admin">View-Only Admin</option>
              <option value="billing_staff">Billing Staff</option>
              <option value="view_only_billing">View-Only Billing</option>
              <option value="provider">Provider</option>
              <option value="office_staff">Office Staff</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Highlight Color</label>
            <input
              type="color"
              value={formData.highlight_color}
              onChange={(e) => setFormData({ ...formData, highlight_color: e.target.value })}
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
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
