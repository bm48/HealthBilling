import { useState, useEffect } from 'react'
import { TodoItem, TodoNote, User } from '@/types'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { CheckCircle, MessageSquare, Plus, X, Edit2, Trash2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

interface TodoItemCardProps {
  todo: TodoItem
  users: User[]
  onUpdate: () => void
  onComplete: (todoId: string) => void
  onDelete: (todoId: string) => void
}

export default function TodoItemCard({ todo, users, onUpdate, onComplete, onDelete }: TodoItemCardProps) {
  const { userProfile } = useAuth()
  const [notes, setNotes] = useState<TodoNote[]>([])
  const [showNotes, setShowNotes] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [editingStatus, setEditingStatus] = useState(false)
  const [newStatus, setNewStatus] = useState(todo.status)

  useEffect(() => {
    if (showNotes) {
      fetchNotes()
    }
  }, [showNotes, todo.id])

  const fetchNotes = async () => {
    try {
      const { data, error } = await supabase
        .from('todo_notes')
        .select('*')
        .eq('todo_id', todo.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setNotes(data || [])
    } catch (error) {
      console.error('Error fetching notes:', error)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim() || !userProfile) return

    try {
      setAddingNote(true)
      const { error } = await supabase
        .from('todo_notes')
        .insert({
          todo_id: todo.id,
          note: newNote,
          created_by: userProfile.id,
        })

      if (error) throw error
      setNewNote('')
      await fetchNotes()
    } catch (error) {
      console.error('Error adding note:', error)
      alert('Failed to add note. Please try again.')
    } finally {
      setAddingNote(false)
    }
  }

  const handleUpdateStatus = async () => {
    try {
      const { error } = await supabase
        .from('todo_items')
        .update({ status: newStatus })
        .eq('id', todo.id)

      if (error) throw error
      setEditingStatus(false)
      onUpdate()
    } catch (error) {
      console.error('Error updating status:', error)
      alert('Failed to update status. Please try again.')
    }
  }

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId)
    return user?.full_name || user?.email || 'Unknown'
  }

  const canEdit = ['billing_staff', 'admin', 'super_admin'].includes(userProfile?.role || '')

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-gray-900">{todo.title}</h3>
            {editingStatus ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUpdateStatus()
                    if (e.key === 'Escape') {
                      setEditingStatus(false)
                      setNewStatus(todo.status)
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={handleUpdateStatus}
                  className="text-green-600 hover:text-green-700"
                >
                  <CheckCircle size={16} />
                </button>
                <button
                  onClick={() => {
                    setEditingStatus(false)
                    setNewStatus(todo.status)
                  }}
                  className="text-gray-600 hover:text-gray-700"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <span
                className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium cursor-pointer hover:bg-blue-200"
                onClick={() => canEdit && setEditingStatus(true)}
              >
                {todo.status}
              </span>
            )}
          </div>

          {todo.claim_reference && (
            <p className="text-sm text-primary-600 mb-2">
              Claim Reference: {todo.claim_reference}
            </p>
          )}

          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>Created: {formatDateTime(todo.created_at)}</span>
            {notes.length > 0 && (
              <span>{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <button
                onClick={() => setShowNotes(!showNotes)}
                className="p-2 text-gray-600 hover:text-primary-600 hover:bg-gray-100 rounded"
                title="Toggle notes"
              >
                <MessageSquare size={18} />
              </button>
              <button
                onClick={() => onComplete(todo.id)}
                className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                title="Mark complete"
              >
                <CheckCircle size={18} />
              </button>
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to delete this item?')) {
                    onDelete(todo.id)
                  }
                }}
                className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                title="Delete"
              >
                <Trash2 size={18} />
              </button>
            </>
          )}
        </div>
      </div>

      {showNotes && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="bg-gray-50 rounded p-3">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-medium text-gray-700">
                    {getUserName(note.created_by)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDateTime(note.created_at)}
                  </span>
                </div>
                <p className="text-sm text-gray-800">{note.note}</p>
              </div>
            ))}

            {canEdit && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleAddNote()
                    }
                  }}
                  placeholder="Add a note..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                />
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                  className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <Plus size={16} />
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
