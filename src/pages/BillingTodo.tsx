import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { TodoItem, User } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, X } from 'lucide-react'
import TodoItemCard from '@/components/TodoItemCard'

export default function BillingTodo() {
  const { userProfile } = useAuth()
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    status: 'Open',
    claim_reference: '',
  })

  useEffect(() => {
    fetchTodos()
    fetchUsers()
  }, [userProfile])

  const fetchTodos = async () => {
    if (!userProfile?.clinic_ids.length) {
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('todo_items')
        .select('*')
        .in('clinic_id', userProfile.clinic_ids)
        .is('completed_at', null)
        .order('created_at', { ascending: false })

      if (error) throw error
      setTodos(data || [])
    } catch (error) {
      console.error('Error fetching todos:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')

      if (error) throw error
      setUsers(data || [])
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userProfile?.clinic_ids[0] || !formData.title.trim()) return

    try {
      const { error } = await supabase
        .from('todo_items')
        .insert({
          clinic_id: userProfile.clinic_ids[0],
          title: formData.title,
          status: formData.status,
          claim_reference: formData.claim_reference || null,
          created_by: userProfile.id,
        })

      if (error) throw error
      setFormData({ title: '', status: 'Open', claim_reference: '' })
      setShowForm(false)
      await fetchTodos()
    } catch (error) {
      console.error('Error creating todo:', error)
      alert('Failed to create item. Please try again.')
    }
  }

  const handleComplete = async (todoId: string) => {
    try {
      const { error } = await supabase
        .from('todo_items')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', todoId)

      if (error) throw error
      await fetchTodos()
    } catch (error) {
      console.error('Error completing todo:', error)
      alert('Failed to complete item. Please try again.')
    }
  }

  const handleDelete = async (todoId: string) => {
    try {
      const { error } = await supabase
        .from('todo_items')
        .delete()
        .eq('id', todoId)

      if (error) throw error
      await fetchTodos()
    } catch (error) {
      console.error('Error deleting todo:', error)
      alert('Failed to delete item. Please try again.')
    }
  }

  const canEdit = ['billing_staff', 'admin', 'super_admin'].includes(userProfile?.role || '')

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Billing To-Do List</h1>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus size={20} />
            Add Item
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <div className="space-y-4">
            {todos.map((todo) => (
              <TodoItemCard
                key={todo.id}
                todo={todo}
                users={users}
                onUpdate={fetchTodos}
                onComplete={handleComplete}
                onDelete={handleDelete}
              />
            ))}
            {todos.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No items in your To-Do list
              </div>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Add To-Do Item</h2>
              <button
                onClick={() => {
                  setShowForm(false)
                  setFormData({ title: '', status: 'Open', claim_reference: '' })
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Enter task title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <input
                  type="text"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Open"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Claim Reference (optional)
                </label>
                <input
                  type="text"
                  value={formData.claim_reference}
                  onChange={(e) => setFormData({ ...formData, claim_reference: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Link to a claim..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setFormData({ title: '', status: 'Open', claim_reference: '' })
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
