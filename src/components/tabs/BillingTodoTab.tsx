import { useState, useEffect, useCallback, useRef, useMemo, type MutableRefObject } from 'react'
import { supabase } from '@/lib/supabase'
import { TodoItem, IsLockBillingTodo } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer } from '@/lib/handsontableCustomRenderers'
import { Plus, Trash2 } from 'lucide-react'

interface BillingTodoTabProps {
  clinicId: string
  canEdit: boolean
  onDelete?: (todoId: string) => void
  isLockBillingTodo?: IsLockBillingTodo | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockBillingTodo) => boolean
  isInSplitScreen?: boolean
  exportRef?: MutableRefObject<{ exportToCSV: () => void } | null>
}

export default function BillingTodoTab({ clinicId, canEdit, onDelete, isLockBillingTodo, onLockColumn, isColumnLocked, isInSplitScreen, exportRef }: BillingTodoTabProps) {
  const { userProfile } = useAuth()
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(true)
  const todosRef = useRef<TodoItem[]>([])
  const isInitialLoadRef = useRef(true) // Track if we're still in initial load phase
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)

  // Use isLockBillingTodo from props directly - it will update when parent refreshes
  const lockData = isLockBillingTodo || null

  const createEmptyTodo = useCallback((index: number): TodoItem => ({
    id: `empty-${index}`,
    clinic_id: clinicId,
    issue: null,
    status: '',
    notes: null,
    followup_notes: null,
    created_by: userProfile?.id || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  }), [clinicId, userProfile])

  const fetchTodos = useCallback(async () => {
    try {
      const { data: todosData, error: todosError } = await supabase
        .from('todo_list')
        .select('*')
        .eq('clinic_id', clinicId)
        // No sorting - preserve exact order from database (typically creation order)

      if (todosError) {
        throw todosError
      }
      const fetchedTodos = todosData || []

      setTodos(currentTodos => {
        // On initial load (empty state), just use all fetched todos and add empty rows
        if (currentTodos.length === 0) {
          // Cap fetched todos at 200; normalize string "null" from DB to real null
          let todosToUse = (fetchedTodos.length > 200 ? fetchedTodos.slice(0, 200) : fetchedTodos).map(t => ({
            ...t,
            issue: (t.issue && t.issue !== 'null') ? t.issue : null,
            notes: (t.notes && t.notes !== 'null') ? t.notes : null,
            followup_notes: (t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : null,
          }))
          const emptyRowsNeeded = 200 - todosToUse.length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(i)
          )
          const result = [...todosToUse, ...newEmptyRows]
          return result
        }
        
        // For subsequent loads, preserve order of existing todos
        // Separate unsaved todos (new- and empty-)
        const unsavedTodos = currentTodos.filter(t => t.id.startsWith('new-') || t.id.startsWith('empty-'))
        
        // Create a map of existing todos by their database ID to preserve order
        const existingTodosMap = new Map<string, TodoItem>()
        currentTodos.forEach(t => {
          // Only include todos with real database IDs (not new- or empty-)
          if (!t.id.startsWith('new-') && !t.id.startsWith('empty-')) {
            existingTodosMap.set(t.id, t)
          }
        })
        
        // Create a map of fetched todos by ID
        const fetchedTodosMap = new Map<string, TodoItem>()
        fetchedTodos.forEach(t => {
          fetchedTodosMap.set(t.id, t)
        })
        
        // Preserve the order of existing todos, updating them with fresh data from database
        const preservedOrder: TodoItem[] = []
        currentTodos.forEach(t => {
          if (!t.id.startsWith('new-') && !t.id.startsWith('empty-')) {
            // If this todo exists in fetched data, use the fresh data
            const freshData = fetchedTodosMap.get(t.id)
            if (freshData) {
              preservedOrder.push({
                ...freshData,
                issue: (freshData.issue && freshData.issue !== 'null') ? freshData.issue : null,
                notes: (freshData.notes && freshData.notes !== 'null') ? freshData.notes : null,
                followup_notes: (freshData.followup_notes && freshData.followup_notes !== 'null') ? freshData.followup_notes : null,
              })
              fetchedTodosMap.delete(t.id) // Remove from map so we don't add it again
            }
          }
        })
        
        // Add any newly fetched todos that weren't in the current state (newly created from other sources)
        const newFetchedTodos = Array.from(fetchedTodosMap.values()).map(t => ({
          ...t,
          issue: (t.issue && t.issue !== 'null') ? t.issue : null,
          notes: (t.notes && t.notes !== 'null') ? t.notes : null,
          followup_notes: (t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : null,
        }))
        
        // Combine: unsaved todos first, then preserved order of existing todos, then new fetched todos
        let updated = [...unsavedTodos, ...preservedOrder, ...newFetchedTodos]
        
        // Cap at 200 rows maximum
        if (updated.length > 200) {
          updated = updated.slice(0, 200)
        }
        
        // Add empty rows to reach exactly 200
        const emptyRowsNeeded = 200 - updated.length
        if (emptyRowsNeeded > 0) {
          const existingEmptyCount = updated.filter(t => t.id.startsWith('empty-')).length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(existingEmptyCount + i)
          )
          updated = [...updated, ...newEmptyRows]
        }
        
        return updated
      })
    } catch (error) {
      console.error('Error fetching todos:', error)
    } finally {
      setLoading(false)
      // Mark initial load as complete after a short delay to allow Handsontable to initialize
      setTimeout(() => {
        isInitialLoadRef.current = false
      }, 500)
    }
  }, [clinicId, createEmptyTodo])

  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  useEffect(() => {
    if (clinicId) {
      fetchTodos()
    }
  }, [clinicId, fetchTodos])

  const saveTodos = useCallback(async (todosToSave: TodoItem[]) => {
    if (!clinicId || !userProfile) {
      console.log('[saveTodos] Skipping save - missing clinicId or userProfile')
      return
    }

    // Don't save during initial load
    if (isInitialLoadRef.current || loading) {
      console.log('[saveTodos] Skipping save during initial load')
      return
    }

    // Filter out only truly empty rows (empty- todos with no data)
    // Allow empty- todos that have data to be processed (they'll be inserted as new todos)
    const todosToProcess = todosToSave.filter(t => {
      const hasData = t.issue || t.status || t.notes || t.followup_notes
      // If it's an empty- todo, only include it if it has data
      if (t.id.startsWith('empty-')) {
        return hasData
      }
      // For all other todos (new- or real IDs), include if they have data
      return hasData
    })
    
    if (todosToProcess.length === 0) {
      console.log('[saveTodos] No todos to process')
      return
    }

    try {
      // Store saved todos with their database responses to update in place
      const savedTodosMap = new Map<string, TodoItem>() // Map old ID -> new TodoItem data
      
      // Process each todo
      for (let i = 0; i < todosToProcess.length; i++) {
        const todo = todosToProcess[i]
        const oldId = todo.id // Store the old ID to find it in state

        // Prepare todo data (no "Open" status; treat as empty)
        const statusValue = (todo.status === 'Open' || !todo.status) ? '' : todo.status
        const todoData: any = {
          clinic_id: clinicId,
          issue: (todo.issue && todo.issue !== 'null') ? todo.issue : null,
          status: statusValue,
          notes: (todo.notes && todo.notes !== 'null') ? todo.notes : null,
          followup_notes: (todo.followup_notes && todo.followup_notes !== 'null') ? todo.followup_notes : null,
          updated_at: new Date().toISOString(),
        }

        let savedTodo: TodoItem | null = null

        // If todo has a real database ID (not new- or empty-), update by ID
        if (!todo.id.startsWith('new-') && !todo.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await supabase
            .from('todo_list')
            .update(todoData)
            .eq('id', todo.id)
            .select()

          if (updateError) {
            console.error(`[saveTodos] Error updating todo ${todo.id}:`, updateError)
            // If it's a table not found error, the migration hasn't been run
            if (updateError.message?.includes('relation') || updateError.message?.includes('does not exist')) {
              throw new Error('todo_list table does not exist. Please run the migration SQL in Supabase.')
            }
            throw updateError
          }

          if (updateData && updateData.length > 0) {
            savedTodo = updateData[0] as TodoItem
            savedTodosMap.set(oldId, savedTodo)
            continue // Update successful, move to next todo
          }
          // If update failed, fall through to insert
        }

        // Use insert for new todos (new- or empty- IDs) or when update by ID fails
        const todoInsertData = {
          ...todoData,
          created_by: userProfile.id,
        }
        
        const { error: insertError, data: insertedTodo } = await supabase
          .from('todo_list')
          .insert(todoInsertData)
          .select()
          .maybeSingle()

        if (insertError) {
          console.error('[saveTodos] Error inserting todo:', insertError, todoData)
          // If it's a table not found error, the migration hasn't been run
          if (insertError.message?.includes('relation') || insertError.message?.includes('does not exist')) {
            throw new Error('todo_list table does not exist. Please run the migration SQL in Supabase.')
          }
          throw insertError
        }
        
        if (insertedTodo) {
          savedTodo = insertedTodo as TodoItem
          savedTodosMap.set(oldId, savedTodo) // Map old ID to new todo data
        }
      }

      // Update todos in place without reordering - preserve exact row positions
      setTodos(currentTodos => {
        const updated = currentTodos.map(todo => {
          const savedTodo = savedTodosMap.get(todo.id)
          if (savedTodo) {
            // Normalize string "null" from DB to real null so F/u notes and Notes don't display "null"
            return {
              ...savedTodo,
              issue: (savedTodo.issue && savedTodo.issue !== 'null') ? savedTodo.issue : null,
              notes: (savedTodo.notes && savedTodo.notes !== 'null') ? savedTodo.notes : null,
              followup_notes: (savedTodo.followup_notes && savedTodo.followup_notes !== 'null') ? savedTodo.followup_notes : null,
            }
          }
          return todo // Keep all other todos exactly as they are
        })
        
        // Ensure we have exactly 200 rows (cap at 200)
        if (updated.length > 200) {
          return updated.slice(0, 200)
        }
        
        const emptyRowsNeeded = 200 - updated.length
        if (emptyRowsNeeded > 0) {
          const existingEmptyCount = updated.filter(t => t.id.startsWith('empty-')).length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(existingEmptyCount + i)
          )
          return [...updated, ...newEmptyRows]
        }
        console.log('saved todo: ', updated)
        return updated
      })
      
      // Update ref
      todosRef.current = todosToSave
    } catch (error) {
      console.error('[saveTodos] Error saving todos:', error)
      // Only show alert if it's not a network/table error (those are handled above)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (!errorMessage.includes('todo_list table does not exist') && 
          !errorMessage.includes('relation') && 
          !errorMessage.includes('does not exist')) {
        alert(errorMessage || 'Failed to save todo. Please try again.')
      }
    }
  }, [clinicId, userProfile, createEmptyTodo, loading])

  const handleDeleteTodo = useCallback(async (todoId: string) => {
    if (todoId.startsWith('new-') || todoId.startsWith('empty-')) {
      setTodos(prev => {
        const filtered = prev.filter(t => t.id !== todoId)
        // Ensure we have exactly 200 rows
        const emptyRowsNeeded = 200 - filtered.length
        if (emptyRowsNeeded > 0) {
          const existingEmptyCount = filtered.filter(t => t.id.startsWith('empty-')).length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(existingEmptyCount + i)
          )
          return [...filtered, ...newEmptyRows]
        }
        return filtered
      })
      return
    }

    try {
      const { error } = await supabase.from('todo_list').delete().eq('id', todoId)
      if (error) throw error
      
      // Update in place without refetching
      setTodos(prev => {
        const filtered = prev.filter(t => t.id !== todoId)
        // Ensure we have exactly 200 rows
        const emptyRowsNeeded = 200 - filtered.length
        if (emptyRowsNeeded > 0) {
          const existingEmptyCount = filtered.filter(t => t.id.startsWith('empty-')).length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(existingEmptyCount + i)
          )
          return [...filtered, ...newEmptyRows]
        }
        return filtered
      })
      if (onDelete) onDelete(todoId)
    } catch (error) {
      console.error('Error deleting todo:', error)
      alert('Failed to delete to-do item')
    }
  }, [onDelete, createEmptyTodo])

  // Export todos to CSV (only rows with at least one value)
  const exportToCsv = useCallback(() => {
    const headers = ['ID', 'Status', 'Issue', 'Notes', 'F/u notes']
    const escapeCsv = (val: string): string => {
      const s = String(val ?? '')
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }
    const rowsWithData = todos.filter(t => t.issue || t.status || t.notes || t.followup_notes)
    const statusDisplay = (s: string | null) => (s && s !== 'Open') ? s : ''
    const csvRows = [
      headers.join(','),
      ...rowsWithData.map(t => [
        t.id.startsWith('empty-') || t.id.startsWith('new-') ? '' : t.id.substring(0, 8) + '...',
        escapeCsv(statusDisplay(t.status || '')),
        escapeCsv((t.issue && t.issue !== 'null') ? t.issue : ''),
        escapeCsv((t.notes && t.notes !== 'null') ? t.notes : ''),
        escapeCsv((t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : ''),
      ].join(',')),
    ]
    const csv = csvRows.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `billing-todo-${clinicId}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [todos, clinicId])

  // Expose export to parent for header (single view and split screen)
  useEffect(() => {
    if (exportRef) {
      exportRef.current = { exportToCSV: exportToCsv }
      return () => {
        exportRef.current = null
      }
    }
  }, [exportRef, exportToCsv])

  // Status color mapping (five statuses: New, Waiting, In Progress, Complete, Updated)
  const getStatusColor = useCallback((status: string): { color: string; textColor: string } | null => {
    switch (status) {
      case 'New':
        return { color: '#3b82f6', textColor: '#ffffff' }
      case 'Waiting':
        return { color: '#f59e0b', textColor: '#ffffff' }
      case 'In Progress':
        return { color: '#714ec5', textColor: '#ffffff' }
      case 'Updated':
        return { color: '#0ea5e9', textColor: '#ffffff' }
      case 'Completed':
        return { color: '#00bb5a', textColor: '#ffffff' }
      default:
        return null
    }
  }, [])

  // Ensure todos always has exactly 200 rows (no more, no less)
  useEffect(() => {
    if (!loading && todos.length !== 200) {
      console.log('[useEffect] Ensuring 200 rows. Current todos length:', todos.length)
      setTodos(prev => {
        // If we have exactly 200 rows, return as-is
        if (prev.length === 200) {
          return prev
        }
        
        // If we have more than 200, slice to 200 (keep first 200)
        if (prev.length > 200) {
          return prev.slice(0, 200)
        }
        
        // If we have less than 200, add empty rows
        const emptyRowsNeeded = 200 - prev.length
        const existingEmptyCount = prev.filter(t => t.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyTodo(existingEmptyCount + i)
        )
        const result = [...prev, ...newEmptyRows]
        return result
      })
    }
  }, [loading, todos.length, createEmptyTodo])

  // Convert todos to Handsontable data format
  const getTodosHandsontableData = useCallback(() => {
    // Simply map todos - the useEffect should ensure todos always has 200 items
    const data = todos.map(todo => [
      todo.id.startsWith('empty-') ? '' : todo.id.substring(0, 8) + '...',
      // No "Open" status; when no value or legacy "Open", show empty cell
      (todo.status && todo.status !== 'Open') ? todo.status : '',
      (todo.issue && todo.issue !== 'null') ? todo.issue : '',
      (todo.notes && todo.notes !== 'null') ? todo.notes : '',
      (todo.followup_notes && todo.followup_notes !== 'null') ? todo.followup_notes : '',
    ])
    
    if (data.length !== 200) {
      console.warn('[getTodosHandsontableData] WARNING: Data length is', data.length, 'but should be 200!')
    }
    return data
  }, [todos])

  // Column field names mapping to is_lock_billing_todo table columns
  const columnFields: Array<keyof IsLockBillingTodo> = ['id_column', 'status', 'issue', 'notes', 'followup_notes']
  const columnTitles = ['ID', 'Status', 'Issue', 'Notes', 'F/u notes']

  // Add lock icons to headers after table renders
  useEffect(() => {
    // Only run if lock functionality is enabled
    if (!canEdit || !onLockColumn || !isColumnLocked) return

    let timeoutId: NodeJS.Timeout | null = null

    const addLockIconsToHeader = (headerRow: Element | null) => {
      if (!headerRow) return

      // Get all header cells
      const headerCells = Array.from(headerRow.querySelectorAll('th'))
      
      // Match each header cell to our column by text content
      headerCells.forEach((th) => {
        // Get the text content of the header cell (before any modifications)
        let cellText = th.textContent?.trim() || th.innerText?.trim() || ''
        
        // If there's already a lock icon, extract the original text from the span
        const existingWrapper = th.querySelector('div')
        if (existingWrapper) {
          const titleSpan = existingWrapper.querySelector('span')
          if (titleSpan) {
            cellText = titleSpan.textContent?.trim() || cellText
          }
        }
        
        // Remove any existing lock icon text if present
        cellText = cellText.replace(/🔒|🔓/g, '').trim()
        
        // Find the matching column index by comparing with column titles
        const columnIndex = columnTitles.findIndex(title => {
          const normalizedTitle = title.toLowerCase().trim()
          const normalizedCellText = cellText.toLowerCase().trim()
          return normalizedCellText === normalizedTitle || normalizedCellText.includes(normalizedTitle) || normalizedTitle.includes(normalizedCellText)
        })
        
        // Skip if we couldn't match this header to a column
        if (columnIndex === -1 || columnIndex >= columnFields.length) return

        const columnName = columnFields[columnIndex]
        const isLocked = isColumnLocked ? isColumnLocked(columnName) : false

        // Get existing text content (use the original cell text or fallback to column title)
        let existingText = cellText || columnTitles[columnIndex] || `Column ${columnIndex + 1}`

        // Create header wrapper
        const wrapper = document.createElement('div')
        wrapper.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100%; position: relative;'

        const titleSpan = document.createElement('span')
        titleSpan.textContent = existingText
        titleSpan.style.flex = '1'
        wrapper.appendChild(titleSpan)

        // Create lock button
        const lockButton = document.createElement('button')
        lockButton.className = 'billing-todo-lock-icon'
        lockButton.style.cssText = `
          opacity: 0;
          transition: opacity 0.2s;
          padding: 2px;
          cursor: pointer;
          background: transparent;
          border: none;
          display: flex;
          align-items: center;
          color: currentColor;
        `
        lockButton.title = isLocked ? 'Click to unlock column' : 'Click to lock column'

        // Lock icon SVG
        const lockIconSvg = isLocked
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V7a6 6 0 0 1 12 0v2"></path><rect x="3" y="9" width="18" height="12" rx="2"></rect></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12V7a3 3 0 0 1 6 0v5"></path><path d="M3 12h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9z"></path></svg>'

        lockButton.innerHTML = lockIconSvg
        lockButton.onclick = (e) => {
          e.stopPropagation()
          e.preventDefault()
          if (onLockColumn) {
            onLockColumn(columnName as string)
          }
        }

        wrapper.appendChild(lockButton)
        th.innerHTML = ''
        th.appendChild(wrapper)
        th.style.position = 'relative'

        // Add hover effect
        th.addEventListener('mouseenter', () => {
          lockButton.style.opacity = '1'
        })
        th.addEventListener('mouseleave', () => {
          lockButton.style.opacity = '0'
        })
      })
    }

    const addLockIcons = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      // Remove all existing lock icons first to refresh them
      const allLockIcons = document.querySelectorAll('.billing-todo-lock-icon')
      allLockIcons.forEach(icon => {
        const th = icon.closest('th')
        if (th) {
          const wrapper = th.querySelector('div')
          if (wrapper) {
            const titleSpan = wrapper.querySelector('span')
            const originalText = titleSpan?.textContent || ''
            th.innerHTML = originalText
          }
        }
      })

      // Add to main table header
      const table = document.querySelector('.handsontable-custom table.htCore')
      if (table) {
        const headerRow = table.querySelector('thead tr')
        if (headerRow) {
          addLockIconsToHeader(headerRow)
        }
      }

      // Add to cloned header (sticky header)
      const cloneTop = document.querySelector('.handsontable-custom .ht_clone_top table.htCore')
      if (cloneTop) {
        const headerRow = cloneTop.querySelector('thead tr')
        if (headerRow) {
          addLockIconsToHeader(headerRow)
        }
      }
    }

    // Debounced version
    const debouncedAddLockIcons = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(addLockIcons, 200)
    }

    // Add lock icons after a delay
    timeoutId = setTimeout(addLockIcons, 300)

    // Mutation observer for dynamic updates
    const observer = new MutationObserver(() => {
      debouncedAddLockIcons()
    })

    const tableContainer = document.querySelector('.handsontable-custom')
    if (tableContainer) {
      observer.observe(tableContainer, { 
        childList: true, 
        subtree: true,
        attributes: false
      })
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      observer.disconnect()
    }
  }, [canEdit, onLockColumn, isColumnLocked, columnFields, columnTitles, isLockBillingTodo])

  const getReadOnly = (columnName: keyof IsLockBillingTodo): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  // Create columns with custom renderers
  const todosColumns = useMemo(() => [
    { 
      data: 0, 
      title: 'ID', 
      type: 'text' as const, 
      width: 80,
      readOnly: !canEdit || getReadOnly('id_column')
    },
    { 
      data: 1, 
      title: 'Status', 
      type: 'dropdown' as const, 
      width: 120,
      editor: 'select',
      selectOptions: ['New', 'Waiting', 'In Progress', 'Complete', 'Updated'],
      allowEmpty: false,
      renderer: createBubbleDropdownRenderer(getStatusColor) as any,
      readOnly: !canEdit || getReadOnly('status')
    },
    { 
      data: 2, 
      title: 'Issue', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('issue')
    },
    { 
      data: 3, 
      title: 'Notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('notes')
    },
    { 
      data: 4, 
      title: 'F/u notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('followup_notes')
    },
  ], [canEdit, lockData, getStatusColor])

  const handleTodosHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return

    if (isInitialLoadRef.current || loading) return

    // Use ref as single source of truth (like ProvidersTab) so rapid edits don't see stale state
    const currentTodos = todosRef.current.length > 0 ? todosRef.current : todos
    const updatedTodos = [...currentTodos]
    const fields: Array<'id' | 'status' | 'issue' | 'notes' | 'followup_notes'> = ['id', 'status', 'issue', 'notes', 'followup_notes']
    let idCounter = 0

    changes.forEach(([row, col, , newValue]) => {
      while (updatedTodos.length <= row) {
        const existingEmptyCount = updatedTodos.filter(t => t.id.startsWith('empty-')).length
        updatedTodos.push(createEmptyTodo(existingEmptyCount))
      }

      const todo = updatedTodos[row]
      if (todo) {
        const field = fields[col as number]
        const needsNewId = todo.id.startsWith('empty-')
        const newId = needsNewId ? `new-${Date.now()}-${idCounter++}-${Math.random()}` : todo.id

        if (field === 'status') {
          updatedTodos[row] = { ...todo, id: newId, status: String(newValue || ''), updated_at: new Date().toISOString() }
        } else if (field === 'issue') {
          const issueVal = (newValue === '' || newValue === 'null') ? null : String(newValue)
          updatedTodos[row] = { ...todo, id: newId, issue: issueVal, updated_at: new Date().toISOString() }
        } else if (field === 'notes') {
          const notesVal = (newValue === '' || newValue === 'null') ? null : String(newValue)
          updatedTodos[row] = { ...todo, id: newId, notes: notesVal, updated_at: new Date().toISOString() }
        } else if (field === 'followup_notes') {
          const followupVal = (newValue === '' || newValue === 'null') ? null : String(newValue)
          updatedTodos[row] = { ...todo, id: newId, followup_notes: followupVal, updated_at: new Date().toISOString() }
        } else if (needsNewId) {
          updatedTodos[row] = { ...todo, id: newId, updated_at: new Date().toISOString() }
        }
      }
    })

    if (updatedTodos.length > 200) {
      updatedTodos.splice(200)
    } else if (updatedTodos.length < 200) {
      const emptyRowsNeeded = 200 - updatedTodos.length
      const existingEmptyCount = updatedTodos.filter(t => t.id.startsWith('empty-')).length
      updatedTodos.push(...Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyTodo(existingEmptyCount + i)))
    }

    todosRef.current = updatedTodos
    setTodos(updatedTodos)
    setTimeout(() => {
      saveTodos(updatedTodos).catch(err => {
        console.error('[handleTodosHandsontableChange] Error in saveTodos:', err)
      })
    }, 0)
  }, [saveTodos, createEmptyTodo, loading, todos])

  const [tableContextMenu, setTableContextMenu] = useState<{ x: number; y: number; rowIndex: number } | null>(null)
  const tableContextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!tableContextMenu) return
    const handleClickOutside = (event: MouseEvent) => {
      if (tableContextMenuRef.current && !tableContextMenuRef.current.contains(event.target as Node)) {
        setTableContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [tableContextMenu])

  const handleTodosHandsontableContextMenu = useCallback((row: number, _col: number, event: MouseEvent) => {
    event.preventDefault()
    if (!canEdit) return
    const todo = todos[row]
    if (todo) {
      setTableContextMenu({ x: event.clientX, y: event.clientY, rowIndex: row })
    }
  }, [todos, canEdit])

  const handleContextMenuAddRow = useCallback(() => {
    if (tableContextMenu == null) return
    const { rowIndex } = tableContextMenu
    const existingEmptyCount = todos.filter(t => t.id.startsWith('empty-')).length
    const newRow = createEmptyTodo(existingEmptyCount)
    const updated = [...todos.slice(0, rowIndex + 1), newRow, ...todos.slice(rowIndex + 1)]
    const capped = updated.length > 200 ? updated.slice(0, 200) : updated
    const toSave = capped.length < 200
      ? [...capped, ...Array.from({ length: 200 - capped.length }, (_, i) => createEmptyTodo(existingEmptyCount + 1 + i))]
      : capped
    todosRef.current = toSave
    setTodos(toSave)
    saveTodos(toSave).catch(err => console.error('saveTodos after add row', err))
    setTableContextMenu(null)
  }, [tableContextMenu, todos, createEmptyTodo, saveTodos])

  const handleContextMenuDeleteRow = useCallback(() => {
    if (tableContextMenu == null) return
    const todo = todos[tableContextMenu.rowIndex]
    if (!todo) {
      setTableContextMenu(null)
      return
    }
    if (todo.id.startsWith('empty-') || todo.id.startsWith('new-')) {
      const updated = todos.filter((_, i) => i !== tableContextMenu.rowIndex)
      const emptyNeeded = Math.max(0, 200 - updated.length)
      const existingEmpty = updated.filter(t => t.id.startsWith('empty-')).length
      const toSave = emptyNeeded > existingEmpty
        ? [...updated, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyTodo(existingEmpty + i))]
        : updated.slice(0, 200)
      todosRef.current = toSave
      setTodos(toSave)
      saveTodos(toSave).catch(err => console.error('saveTodos after delete row', err))
    } else {
      handleDeleteTodo(todo.id)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, todos, createEmptyTodo, saveTodos, handleDeleteTodo])

  // ResizeObserver for split screen: fill table height (must run before any early return)
  useEffect(() => {
    if (!isInSplitScreen) return
    const el = tableContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setTableHeight(el.clientHeight)
    })
    ro.observe(el)
    setTableHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [isInSplitScreen])

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-white/70 py-8">Loading to-do items...</div>
      </div>
    )
  }

  return (
    <div 
      className="p-6" 
      style={isInSplitScreen ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}
    >
      <div 
        ref={tableContainerRef}
        className="table-container dark-theme" 
        style={{ 
          maxHeight: isInSplitScreen ? undefined : '600px',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflowX: 'auto', 
          overflowY: 'auto',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`todos-${todos.length}-${JSON.stringify(lockData)}`}
          data={getTodosHandsontableData()}
          columns={todosColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          afterChange={handleTodosHandsontableChange}
          onContextMenu={handleTodosHandsontableContextMenu}
          enableFormula={false}
          readOnly={!canEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom"
        />
      </div>

      {tableContextMenu != null && (
        <div
          ref={tableContextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[160px]"
          style={{ left: tableContextMenu.x, top: tableContextMenu.y }}
        >
          <button
            type="button"
            onClick={handleContextMenuAddRow}
            className="w-full text-left px-4 py-2 text-white hover:bg-white/10 flex items-center gap-2"
          >
            <Plus size={16} />
            Add row
          </button>
          <button
            type="button"
            onClick={handleContextMenuDeleteRow}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete row
          </button>
        </div>
      )}
    </div>
  )
}
