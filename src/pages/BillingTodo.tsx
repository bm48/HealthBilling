import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { TodoItem, TodoNote } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Trash2 } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'

export default function BillingTodo() {
  const { userProfile } = useAuth()
  const [todos, setTodos] = useState<TodoItem[]>([])
  const todosRef = useRef<TodoItem[]>([])
  const [todoNotes, setTodoNotes] = useState<Record<string, TodoNote[]>>({})
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState<{ todoId: string; field: string } | null>(null)
  const [clinics, setClinics] = useState<Array<{ id: string; name: string }>>([])
  const fetchingRef = useRef(false)
  const editingSelectRef = useRef<{ todoId: string; field: string } | null>(null)
  const resetLastSavedRef = useRef<(() => void) | null>(null)

  // Keep ref in sync with state
  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  // Fetch clinics for super_admin
  useEffect(() => {
    const fetchClinics = async () => {
      if (userProfile?.role === 'super_admin') {
        try {
          const { data, error } = await supabase
            .from('clinics')
            .select('id, name')
            .order('name')
          
          if (error) throw error
          setClinics(data || [])
        } catch (error) {
          // Error fetching clinics
        }
      }
    }
    fetchClinics()
  }, [userProfile])

  const fetchNotesForTodos = useCallback(async (todoIds: string[]) => {
    if (todoIds.length === 0) return
    
    try {
      const { data, error } = await supabase
        .from('todo_notes')
        .select('*')
        .in('todo_id', todoIds)
        .order('created_at', { ascending: false })

      if (error) throw error
      
      // Group notes by todo_id
      const notesByTodo: Record<string, TodoNote[]> = {}
      data?.forEach(note => {
        if (!notesByTodo[note.todo_id]) {
          notesByTodo[note.todo_id] = []
        }
        notesByTodo[note.todo_id].push(note)
      })
      setTodoNotes(prev => ({ ...prev, ...notesByTodo }))
    } catch (error) {
      // Error fetching notes
    }
  }, [])

  const fetchTodos = useCallback(async () => {
    if (!userProfile) {
      setLoading(false)
      return
    }

    fetchingRef.current = true
    try {
      let query = supabase
        .from('todo_items')
        .select('*')
        .is('completed_at', null)
        .order('created_at', { ascending: false })

      // For super_admin, fetch all todos. For others, filter by clinic_ids
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('clinic_id', userProfile.clinic_ids)
      } else if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length === 0) {
        // Non-super_admin with no clinic_ids - no todos to show
        setTodos([])
        todosRef.current = []
        setLoading(false)
        fetchingRef.current = false
        return
      }

      const { data, error } = await query
      if (error) throw error
      const fetchedTodos = data || []
      
      // Preserve any unsaved todos (with 'new-' prefix) that exist in current state
      setTodos(currentTodos => {
        const unsavedTodos = currentTodos.filter(t => t.id.startsWith('new-'))
        const combined = [...unsavedTodos, ...fetchedTodos]
        return combined
      })
      
      // Update ref with only saved todos (for comparison in saveTodo)
      todosRef.current = fetchedTodos
      
      // Fetch notes for all todos (including saved ones)
      if (fetchedTodos.length > 0) {
        const todoIds = fetchedTodos.map(t => t.id)
        await fetchNotesForTodos(todoIds)
      }
    } catch (error) {
      // Error fetching todos
    } finally {
      setLoading(false)
      // Reset fetching flag after a short delay to allow state to update
      setTimeout(() => {
        fetchingRef.current = false
        if (resetLastSavedRef.current) {
          resetLastSavedRef.current()
        }
      }, 200)
    }
  }, [userProfile, fetchNotesForTodos])

  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])



  const saveTodo = useCallback(async (todosToSave: TodoItem[]) => {
    if (!userProfile?.id) return
    
    // For non-super_admin, require clinic_ids
    if (userProfile.role !== 'super_admin' && !userProfile?.clinic_ids?.[0]) {
      return
    }

    try {
      const newTodosToCreate: TodoItem[] = []
      const todosToUpdate: TodoItem[] = []
      
      // Get last saved state from ref for comparison
      const lastSavedTodos = todosRef.current.filter(t => !t.id.startsWith('new-'))
      
      // Separate new and existing todos
      for (const todo of todosToSave) {
        if (todo.id.startsWith('new-')) {
          // Only create if it has a title
          if (todo.title && todo.title.trim()) {
            newTodosToCreate.push(todo)
          }
        } else {
          // Compare with last saved state to detect actual changes
          const lastSavedTodo = lastSavedTodos.find(t => t.id === todo.id)
          if (lastSavedTodo) {
            const hasChanged = 
              lastSavedTodo.title !== todo.title ||
              lastSavedTodo.status !== todo.status ||
              lastSavedTodo.claim_reference !== todo.claim_reference
            
            if (hasChanged) {
              todosToUpdate.push(todo)
            }
          } else {
            // Todo exists in current state but not in last saved - it's new, update it
            todosToUpdate.push(todo)
          }
        }
      }

      // If no changes, don't do anything
      if (newTodosToCreate.length === 0 && todosToUpdate.length === 0) {
        return
      }

      // Create new todos
      for (const todo of newTodosToCreate) {
        const { error } = await supabase
          .from('todo_items')
          .insert({
            clinic_id: todo.clinic_id,
            title: todo.title,
            status: todo.status,
            claim_reference: todo.claim_reference || null,
            created_by: userProfile.id,
          })
        
        if (error) {
          console.error('Error creating todo:', error)
          throw error
        }
      }

      // Update existing todos that have changed
      for (const todo of todosToUpdate) {
        const { error } = await supabase
          .from('todo_items')
          .update({
            title: todo.title,
            status: todo.status,
            claim_reference: todo.claim_reference,
            updated_at: new Date().toISOString(),
          })
          .eq('id', todo.id)
        
        if (error) {
          // Error updating todo
          throw error
        }
        
        // Update the ref immediately with the saved values to prevent re-saving
        todosRef.current = todosRef.current.map(t => 
          t.id === todo.id ? { ...t, ...todo, updated_at: new Date().toISOString() } : t
        )
      }

      // Only fetch if we created new todos (to get their IDs)
      // For updates, don't fetch or update state - just update the ref
      // The state already has the correct values (user just changed them)
      if (newTodosToCreate.length > 0) {
        await fetchTodos()
      } else if (todosToUpdate.length > 0) {
        // For updates, just update the ref to match what was saved
        // Don't update state to avoid triggering debounced save again
        todosRef.current = todosRef.current.map(t => {
          const updated = todosToUpdate.find(u => u.id === t.id)
          if (updated) {
            return { ...t, ...updated, updated_at: new Date().toISOString() }
          }
          return t
        })
        
        // Update the debounced save state with the current todos state
        // The state already has the user's changes, which we just saved
        // This prevents it from trying to save again
        updateLastSaved(todos)
      }
    } catch (error) {
      console.error('Error saving todos:', error)
      alert('Failed to save changes. Please try again.')
    }
  }, [userProfile, fetchTodos])

  const savingRef = useRef(false)
  const lastSaveTimeRef = useRef<number>(0)
  const lastSaveDataRef = useRef<string>('')
  
  const saveTodoWithFlag = useCallback(async (todosToSave: TodoItem[]) => {
    // Don't save if we're currently fetching or already saving
    if (savingRef.current || fetchingRef.current) {
      return
    }
    
    // CRITICAL: Don't save if we're currently editing a select field (status or claim_reference)
    // The onBlur handler will handle the save instead
    if (editingSelectRef.current) {
      return
    }
    
    // Prevent saving the same data multiple times in quick succession (within 2 seconds)
    const now = Date.now()
    const dataString = JSON.stringify(todosToSave)
    if (now - lastSaveTimeRef.current < 2000 && dataString === lastSaveDataRef.current) {
      return
    }
    
    // Quick check: if todosToSave matches todosRef.current exactly, don't save
    const currentSaved = todosRef.current.filter(t => !t.id.startsWith('new-'))
    const toSaveSaved = todosToSave.filter(t => !t.id.startsWith('new-'))
    
    // Compare only the fields we care about
    const hasRealChanges = toSaveSaved.some(todo => {
      const saved = currentSaved.find(s => s.id === todo.id)
      if (!saved) return true // New todo
      return (
        saved.title !== todo.title ||
        saved.status !== todo.status ||
        saved.claim_reference !== todo.claim_reference
      )
    })
    
    if (!hasRealChanges && toSaveSaved.length === currentSaved.length) {
      return
    }
    
    savingRef.current = true
    lastSaveTimeRef.current = now
    lastSaveDataRef.current = dataString
    try {
      await saveTodo(todosToSave)
    } finally {
      savingRef.current = false
    }
  }, [saveTodo])

  const { saveImmediately, resetLastSaved, updateLastSaved } = useDebouncedSave<TodoItem[]>(saveTodoWithFlag, todos, 1000, editingCell !== null)
  
  // Store resetLastSaved in ref so it can be used in fetchTodos
  useEffect(() => {
    resetLastSavedRef.current = resetLastSaved
  }, [resetLastSaved])

  // Fetch todos on mount and when userProfile changes
  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])

  const handleUpdateTodo = useCallback((todoId: string, field: string, value: any) => {
    setTodos(prevTodos => {
      return prevTodos.map(todo => {
        if (todo.id === todoId) {
          return { ...todo, [field]: value, updated_at: new Date().toISOString() }
        }
        return todo
      })
    })
  }, [])

  const handleAddNewRow = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    
    if (!userProfile?.id) {
      alert('Unable to add new item: User not logged in')
      return
    }

    // Determine clinic_id: use first clinic_id from user, or first clinic for super_admin
    let clinicId: string
    if (userProfile.role === 'super_admin') {
      if (clinics.length > 0) {
        clinicId = clinics[0].id
      } else if (userProfile.clinic_ids?.[0]) {
        clinicId = userProfile.clinic_ids[0]
      } else {
        alert('Unable to add new item: No clinics available. Please create a clinic first.')
        return
      }
    } else {
      if (!userProfile.clinic_ids?.[0]) {
        alert('Unable to add new item: No clinic assigned to your account')
        return
      }
      clinicId = userProfile.clinic_ids[0]
    }
    
    const tempId = `new-${Date.now()}`
    const newTodo: TodoItem = {
      id: tempId,
      clinic_id: clinicId,
      title: '',
      status: 'Open',
      claim_reference: null,
      created_by: userProfile.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    }
    
    setTodos(prev => [newTodo, ...prev])
    setEditingCell({ todoId: tempId, field: 'title' })
  }, [userProfile, clinics])

  const handleAddNote = async (todoId: string, noteText: string, isFollowUp: boolean = false) => {
    if (!noteText.trim() || !userProfile) return

    // Don't save notes for new todos that haven't been created yet
    if (todoId.startsWith('new-')) {
      // For new todos, we'll save the note after the todo is created
      return
    }

    try {
      // For follow-up notes, prefix with [F/U]
      const noteToSave = isFollowUp ? `[F/U] ${noteText}` : noteText
      
      const { error } = await supabase
        .from('todo_notes')
        .insert({
          todo_id: todoId,
          note: noteToSave,
          created_by: userProfile.id,
        })

      if (error) throw error
      await fetchNotesForTodos([todoId])
    } catch (error) {
      // Error adding note
      alert('Failed to add note. Please try again.')
    }
  }

  const handleDelete = async (todoId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return

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

  const getStatusOptions = () => ['Open', '1 Waiting', '2 IP', 'In Progress', 'Resolved']
  const getIssueOptions = () => ['Needs Reprocessing', 'Repeat F/U', 'New F/U', 'Claim Issue', 'Payment Issue']

  const getStatusColor = (status: string) => {
    if (status === '1 Waiting') return '#ef4444' // red
    if (status === '2 IP') return '#a855f7' // purple
    if (status === 'Open') return '#f59e0b' // orange
    return '#3b82f6' // blue
  }

  const getIssueColor = (issue: string) => {
    if (issue === 'Needs Reprocessing') return '#f97316' // orange
    if (issue === 'Repeat F/U') return '#3b82f6' // blue
    if (issue === 'New F/U') return '#10b981' // green
    return '#6b7280' // gray
  }

  const canEdit = ['billing_staff', 'admin', 'super_admin'].includes(userProfile?.role || '')

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Billing To-Do List</h1>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
        {loading ? (
          <div className="text-center py-8 text-white/70">Loading...</div>
        ) : (
          <div className="table-container dark-theme">
            <table className="table-spreadsheet dark-theme">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>ID</th>
                  <th>Title</th>
                  <th style={{ width: '150px' }}>Status</th>
                  <th style={{ width: '180px' }}>Issues</th>
                  <th>Notes</th>
                  <th>F/u Notes</th>
                  {canEdit && <th style={{ width: '80px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {canEdit && (
                  <tr 
                    className="editing" 
                    onClick={(e) => {
                      handleAddNewRow(e)
                    }} 
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ''}
                  >
                    <td 
                      colSpan={7} 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAddNewRow(e)
                      }}
                      style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)', padding: '16px', pointerEvents: 'auto' }}
                    >
                      Click here to add a new to-do item
                    </td>
                  </tr>
                )}
                {todos.map((todo) => {
                  const notes = todoNotes[todo.id] || []
                  // Separate notes: those starting with [F/U] are follow-up notes
                  const regularNotes = notes.filter(n => !n.note.startsWith('[F/U]'))
                  const followUpNotes = notes.filter(n => n.note.startsWith('[F/U]')).map(n => ({
                    ...n,
                    note: n.note.replace(/^\[F\/U\]\s*/, '')
                  }))
                  const latestNote = regularNotes[0]
                  const latestFollowUp = followUpNotes[0]
                  const isNew = todo.id.startsWith('new-')

                  return (
                    <tr key={todo.id} className={isNew ? 'editing' : ''}>
                      <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                        {isNew ? 'New' : todo.id.substring(0, 8)}
                      </td>
                      <td>
                        {editingCell?.todoId === todo.id && editingCell?.field === 'title' ? (
                          <input
                            type="text"
                            value={todo.title}
                            onChange={(e) => handleUpdateTodo(todo.id, 'title', e.target.value)}
                            onBlur={() => {
                              setEditingCell(null)
                              saveImmediately()
                            }}
                            autoFocus
                            className="w-full"
                            placeholder="Enter title..."
                            style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                          />
                        ) : (
                          <div
                            onClick={() => canEdit && setEditingCell({ todoId: todo.id, field: 'title' })}
                            className={canEdit ? 'cursor-pointer' : ''}
                            style={{ fontWeight: todo.title ? 500 : 'normal' }}
                          >
                            {todo.title || (canEdit ? 'Click to add title' : '-')}
                          </div>
                        )}
                      </td>
                      <td>
                        {editingCell?.todoId === todo.id && editingCell?.field === 'status' ? (
                          <select
                            value={todo.status}
                            onChange={(e) => {
                              handleUpdateTodo(todo.id, 'status', e.target.value)
                            }}
                            onFocus={() => {
                              editingSelectRef.current = { todoId: todo.id, field: 'status' }
                            }}
                            onBlur={async (e) => {
                              editingSelectRef.current = null
                              setEditingCell(null)
                              // Get the saved value from ref to compare
                              const savedTodo = todosRef.current.find(t => t.id === todo.id)
                              const newValue = e.target.value
                              // Only save if the value actually changed from what's saved
                              if (savedTodo && newValue !== savedTodo.status) {
                                // Update the ref immediately before saving to prevent debounced save
                                todosRef.current = todosRef.current.map(t => 
                                  t.id === todo.id ? { ...t, status: newValue } : t
                                )
                                await saveImmediately()
                              }
                            }}
                            autoFocus
                            className="w-full"
                            style={{ backgroundColor: getStatusColor(todo.status), color: '#ffffff' }}
                          >
                            {getStatusOptions().map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <div
                            onClick={() => canEdit && setEditingCell({ todoId: todo.id, field: 'status' })}
                            className="status-badge cursor-pointer"
                            style={{
                              backgroundColor: getStatusColor(todo.status),
                              color: '#ffffff',
                            }}
                          >
                            {todo.status}
                          </div>
                        )}
                      </td>
                      <td>
                        {editingCell?.todoId === todo.id && editingCell?.field === 'claim_reference' ? (
                          <select
                            value={todo.claim_reference || ''}
                            onChange={(e) => {
                              handleUpdateTodo(todo.id, 'claim_reference', e.target.value || null)
                            }}
                            onFocus={() => {
                              editingSelectRef.current = { todoId: todo.id, field: 'claim_reference' }
                            }}
                            onBlur={async (e) => {
                              editingSelectRef.current = null
                              setEditingCell(null)
                              // Get the saved value from ref to compare
                              const savedTodo = todosRef.current.find(t => t.id === todo.id)
                              const newValue = e.target.value || null
                              // Only save if the value actually changed from what's saved
                              if (savedTodo && newValue !== savedTodo.claim_reference) {
                                // Update the ref immediately before saving to prevent debounced save
                                todosRef.current = todosRef.current.map(t => 
                                  t.id === todo.id ? { ...t, claim_reference: newValue } : t
                                )
                                await saveImmediately()
                              }
                            }}
                            autoFocus
                            className="w-full"
                            style={{ 
                              backgroundColor: todo.claim_reference ? getIssueColor(todo.claim_reference) : 'rgba(255, 255, 255, 0.9)',
                              color: '#000000'
                            }}
                          >
                            <option value="">Select...</option>
                            {getIssueOptions().map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <div
                            onClick={() => canEdit && setEditingCell({ todoId: todo.id, field: 'claim_reference' })}
                            className="status-badge cursor-pointer"
                            style={{
                              backgroundColor: todo.claim_reference ? getIssueColor(todo.claim_reference) : 'rgba(255,255,255,0.1)',
                              color: '#ffffff',
                            }}
                          >
                            {todo.claim_reference || 'Click to add'}
                          </div>
                        )}
                      </td>
                      <td>
                        {editingCell?.todoId === todo.id && editingCell?.field === 'notes' ? (
                          <textarea
                            defaultValue={latestNote?.note || ''}
                            onBlur={async (e) => {
                              const newValue = e.target.value.trim()
                              if (newValue && newValue !== latestNote?.note) {
                                await handleAddNote(todo.id, newValue, false)
                              }
                              setEditingCell(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setEditingCell(null)
                              } else if (e.key === 'Enter' && e.ctrlKey) {
                                e.currentTarget.blur()
                              }
                            }}
                            autoFocus
                            className="w-full"
                            rows={2}
                            placeholder="Add note..."
                            style={{ minHeight: '48px', color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                          />
                        ) : (
                          <div
                            onClick={() => canEdit && setEditingCell({ todoId: todo.id, field: 'notes' })}
                            className="cursor-pointer min-h-[32px] py-1"
                            title={latestNote ? `Last note: ${latestNote.note}` : 'Click to add note'}
                          >
                            {latestNote ? (
                              <div style={{ whiteSpace: 'pre-wrap', fontSize: '12px' }}>{latestNote.note}</div>
                            ) : (
                              <span style={{ color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>Click to add</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        {editingCell?.todoId === todo.id && editingCell?.field === 'followup' ? (
                          <textarea
                            defaultValue={latestFollowUp?.note || ''}
                            onBlur={async (e) => {
                              const newValue = e.target.value.trim()
                              if (newValue && newValue !== latestFollowUp?.note) {
                                await handleAddNote(todo.id, newValue, true)
                              }
                              setEditingCell(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setEditingCell(null)
                              } else if (e.key === 'Enter' && e.ctrlKey) {
                                e.currentTarget.blur()
                              }
                            }}
                            autoFocus
                            className="w-full"
                            rows={2}
                            placeholder="Add follow-up note..."
                            style={{ minHeight: '48px', color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                          />
                        ) : (
                          <div
                            onClick={() => canEdit && setEditingCell({ todoId: todo.id, field: 'followup' })}
                            className="cursor-pointer min-h-[32px] py-1"
                            title={latestFollowUp ? `Last F/U: ${latestFollowUp.note}` : 'Click to add F/U note'}
                          >
                            {latestFollowUp ? (
                              <div style={{ whiteSpace: 'pre-wrap', fontSize: '12px' }}>{latestFollowUp.note}</div>
                            ) : (
                              <span style={{ color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>Click to add</span>
                            )}
                          </div>
                        )}
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            onClick={() => handleDelete(todo.id)}
                            className="text-red-400 hover:text-red-300"
                            style={{ padding: '4px' }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {todos.length === 0 && !canEdit && (
                  <tr className="empty-row">
                    <td colSpan={6}>
                      No items in your To-Do list
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
