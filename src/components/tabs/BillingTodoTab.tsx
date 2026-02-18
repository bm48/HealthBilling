import { useState, useEffect, useCallback, useRef, useMemo, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
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
  const saveTodosTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionIdRef = useRef<string>(`${Date.now()}`) // Stable id prefix for new rows (one id per row index, prevents multi-insert)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const [structureVersion, setStructureVersion] = useState(0) // Bump on add/delete row so grid refreshes immediately
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())

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
        .from('todo_lists')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        // No sorting - preserve exact order from database (typically creation order)

      if (todosError) {
        throw todosError
      }
      const fetchedTodos = todosData || []

      setTodos(currentTodos => {
        // On initial load (empty state), just use all fetched todos and add empty rows
        if (currentTodos.length === 0) {
          // Cap at 200: take only first 200 from DB; normalize string "null" from DB to real null
          let todosToUse = fetchedTodos.slice(0, 200).map(t => ({
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
        // Cap at 200 rows
        if (updated.length > 200) updated = updated.slice(0, 200)
        
        // Add empty rows only when fewer than 200
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
    return () => {
      if (saveTodosTimeoutRef.current) clearTimeout(saveTodosTimeoutRef.current)
    }
  }, [])

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

    // Only persist rows that have meaningful content (issue, notes, or followup_notes).
    // Do not count status alone - dropdown can set "New" on empty rows and would create empty DB records.
    const hasMeaningfulData = (t: TodoItem) => !!(t.issue || t.notes || t.followup_notes)
    const withData = todosToSave.filter(hasMeaningfulData)
    // Deduplicate by id so we never insert the same new row twice (e.g. same new-row-5-xxx)
    const seenIds = new Set<string>()
    const todosToProcess = withData.filter(t => {
      if (t.id.startsWith('new-') || t.id.startsWith('empty-')) {
        if (seenIds.has(t.id)) return false
        seenIds.add(t.id)
      }
      return true
    })

    // Delete existing DB rows that have no meaningful content so DB only has records with values
    const toDeleteFromDb = todosToSave.filter(
      t => !t.id.startsWith('new-') && !t.id.startsWith('empty-') && !hasMeaningfulData(t)
    )

    if (todosToProcess.length === 0 && toDeleteFromDb.length === 0) return

    try {
      const savedTodosMap = new Map<string, TodoItem>()
      const deletedIds = new Set<string>()

      for (const todo of toDeleteFromDb) {
        const { error: deleteError } = await supabase.from('todo_lists').delete().eq('id', todo.id)
        if (deleteError) {
          console.error('[saveTodos] Error deleting empty todo:', deleteError)
          throw deleteError
        }
        deletedIds.add(todo.id)
      }

      // Process each todo (update or insert rows with data)
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

        // If todo has a real database ID (not new- or empty-), update
        if (!todo.id.startsWith('new-') && !todo.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await supabase
            .from('todo_lists')
            .update(todoData)
            .eq('id', todo.id)
            .select()

          if (updateError) {
            console.error('[saveTodos] Error updating todo:', updateError)
            // If it's a table not found error, the migration hasn't been run
            if (updateError.message?.includes('relation') || updateError.message?.includes('does not exist')) {
              throw new Error('todo_lists table does not exist. Please run the migration SQL in Supabase.')
            }
            throw updateError
          }

          if (updateData && updateData.length > 0) {
            savedTodo = updateData[0] as TodoItem
            savedTodosMap.set(oldId, savedTodo)
            continue
          }
          // Update matched 0 rows (e.g. row was deleted in DB); skip, do not insert
          continue
        }

        // Insert for new todos (new- or empty- IDs) that have data
        const todoInsertData = {
          ...todoData,
          created_by: userProfile.id,
        }
        
        const { error: insertError, data: insertedTodo } = await supabase
          .from('todo_lists')
          .insert(todoInsertData)
          .select()
          .maybeSingle()

        if (insertError) {
          console.error('[saveTodos] Error inserting todo:', insertError, todoData)
          // If it's a table not found error, the migration hasn't been run
          if (insertError.message?.includes('relation') || insertError.message?.includes('does not exist')) {
            throw new Error('todo_lists table does not exist. Please run the migration SQL in Supabase.')
          }
          throw insertError
        }
        
        if (insertedTodo) {
          savedTodo = insertedTodo as TodoItem
          savedTodosMap.set(oldId, savedTodo) // Map old ID to new todo data
        }
      }

      // Update state: remove deleted rows, apply saved data, cap and pad to 200
      setTodos(currentTodos => {
        let updated = currentTodos
          .filter(todo => !deletedIds.has(todo.id))
          .map(todo => {
            const savedTodo = savedTodosMap.get(todo.id)
            if (savedTodo) {
              return {
                ...savedTodo,
                issue: (savedTodo.issue && savedTodo.issue !== 'null') ? savedTodo.issue : null,
                notes: (savedTodo.notes && savedTodo.notes !== 'null') ? savedTodo.notes : null,
                followup_notes: (savedTodo.followup_notes && savedTodo.followup_notes !== 'null') ? savedTodo.followup_notes : null,
              }
            }
            return todo
          })

        if (updated.length > 200) updated = updated.slice(0, 200)
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
      
      // Update ref
      todosRef.current = todosToSave
    } catch (error) {
      console.error('[saveTodos] Error saving todos:', error)
      // Only show alert if it's not a network/table error (those are handled above)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (!errorMessage.includes('todo_lists table does not exist') && 
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
        const emptyRowsNeeded = 200 - filtered.length
        if (emptyRowsNeeded > 0) {
          const existingEmptyCount = filtered.filter(t => t.id.startsWith('empty-')).length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(existingEmptyCount + i)
          )
          const next = [...filtered, ...newEmptyRows]
          todosRef.current = next
          return next
        }
        todosRef.current = filtered
        return filtered
      })
      setStructureVersion(v => v + 1)
      return
    }

    try {
      const { error } = await supabase.from('todo_lists').delete().eq('id', todoId)
      if (error) throw error

      setTodos(prev => {
        const filtered = prev.filter(t => t.id !== todoId)
        const emptyRowsNeeded = 200 - filtered.length
        if (emptyRowsNeeded > 0) {
          const existingEmptyCount = filtered.filter(t => t.id.startsWith('empty-')).length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(existingEmptyCount + i)
          )
          const next = [...filtered, ...newEmptyRows]
          todosRef.current = next
          return next
        }
        todosRef.current = filtered
        return filtered
      })
      setStructureVersion(v => v + 1)
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
    console.log('status color', status)
    switch (status) {
      case 'New':
        return { color: '#53d5fd', textColor: '#ffffff' }
      case 'Waiting':
        return { color: '#ff6251', textColor: '#ffffff' }
      case 'In Progress':
        return { color: '#b18cfe', textColor: '#ffffff' }
      case 'Updated':
        return { color: '#fff76b', textColor: '#000' }
      case 'Complete':
        return { color: '#96d35f', textColor: '#33895f' }
      default:
        return null
    }
  }, [])

  // When fewer than 200 rows, pad to 200; when more than 200, cap at 200
  useEffect(() => {
    if (!loading && todos.length > 0) {
      setTodos(prev => {
        if (prev.length > 200) return prev.slice(0, 200)
        if (prev.length >= 200) return prev
        const emptyRowsNeeded = 200 - prev.length
        const existingEmptyCount = prev.filter(t => t.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyTodo(existingEmptyCount + i)
        )
        return [...prev, ...newEmptyRows]
      })
    }
  }, [loading, todos.length, createEmptyTodo])

  // Reorder todos when user drags a row by the row header; persist order via created_at so reload preserves it
  const handleTodosRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    setTodos(prev => {
      const arr = [...prev]
      const toMove = movedRows.map(i => arr[i])
      movedRows.sort((a, b) => b - a).forEach(i => arr.splice(i, 1))
      const insertAt = Math.min(finalIndex, arr.length)
      toMove.forEach((item, i) => arr.splice(insertAt + i, 0, item))
      const next = arr
      // Persist order: set created_at so ORDER BY created_at DESC matches new order (row 0 = newest)
      const realTodos = next.filter(t => !t.id.startsWith('empty-') && !t.id.startsWith('new-'))
      if (realTodos.length > 0) {
        const baseTime = Date.now()
        Promise.all(
          realTodos.map((todo, i) =>
            supabase
              .from('todo_lists')
              .update({ created_at: new Date(baseTime - i * 1000).toISOString() })
              .eq('id', todo.id)
          )
        ).catch(err => console.error('Failed to persist todo order', err))
      }
      return next
    })
  }, [])

  // Convert todos to Handsontable data format
  const getTodosHandsontableData = useCallback(() => {
    return todos.map(todo => [
      todo.id.startsWith('empty-') ? '' : todo.id.substring(0, 8) + '...',
      // No "Open" status; when no value or legacy "Open", show empty cell
      (todo.status && todo.status !== 'Open') ? todo.status : '',
      (todo.issue && todo.issue !== 'null') ? todo.issue : '',
      (todo.notes && todo.notes !== 'null') ? todo.notes : '',
      (todo.followup_notes && todo.followup_notes !== 'null') ? todo.followup_notes : '',
    ])
  }, [todos])

  // Column field names mapping to is_lock_billing_todo table columns
  const columnFields: Array<keyof IsLockBillingTodo> = ['id_column', 'status', 'issue', 'notes', 'followup_notes']
  const columnTitles = ['ID', 'Status', 'Issue', 'Notes', 'F/u notes']

  const todosCellsCallback = useCallback(
    (row: number, col: number) => {
      const todo = todos[row]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${todo?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key) ? { className: 'cell-highlight-yellow' } : {}
    },
    [todos, columnFields, highlightedCells]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const todo = todos[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${todo?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [todos, columnFields, highlightedCells]
  )

  const handleCellHighlight = useCallback((row: number, col: number) => {
    const todo = todos[row]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${todo?.id ?? `row-${row}`}:${colKey}`
    setHighlightedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [todos, columnFields])

  // Right-click on column headers to lock/unlock (no lock icon in header)
  useEffect(() => {
    if (!canEdit || !onLockColumn || !isColumnLocked) return

    let timeoutId: NodeJS.Timeout | null = null
    let menuEl: HTMLElement | null = null
    let closeListener: (() => void) | null = null

    const hideMenu = () => {
      if (menuEl?.parentNode) menuEl.parentNode.removeChild(menuEl)
      menuEl = null
      if (closeListener) {
        document.removeEventListener('click', closeListener)
        document.removeEventListener('contextmenu', closeListener)
        closeListener = null
      }
    }

    const showHeaderContextMenu = (e: MouseEvent, columnName: string) => {
      e.preventDefault()
      e.stopPropagation()
      hideMenu()
      const isLocked = isColumnLocked ? isColumnLocked(columnName as keyof IsLockBillingTodo) : false
      const menu = document.createElement('div')
      menu.className = 'billing-todo-col-header-context-menu'
      menu.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.4);padding:4px 0;min-width:140px;'
      const item = document.createElement('div')
      item.style.cssText = 'padding:6px 12px;cursor:pointer;white-space:nowrap;font-size:13px;'
      item.textContent = isLocked ? 'Unlock column' : 'Lock column'
      item.onclick = () => {
        onLockColumn(columnName)
        hideMenu()
      }
      menu.appendChild(item)
      document.body.appendChild(menu)
      menuEl = menu
      const x = Math.min(e.clientX, window.innerWidth - 150)
      const y = Math.min(e.clientY, window.innerHeight - 40)
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      closeListener = () => { hideMenu() }
      setTimeout(() => {
        document.addEventListener('click', closeListener!, true)
        document.addEventListener('contextmenu', closeListener!, true)
      }, 0)
    }

    const attachContextMenuToHeader = (headerRow: Element | null) => {
      if (!headerRow) return
      const headerCells = Array.from(headerRow.querySelectorAll('th'))
      headerCells.forEach((th) => {
        const colHeader = th.querySelector('.colHeader')
        let cellText = (colHeader?.textContent ?? th.textContent ?? '').replace(/🔒|🔓/g, '').trim()
        const columnIndex = columnTitles.findIndex(title => {
          const a = title.toLowerCase().trim()
          const b = cellText.toLowerCase().trim()
          return a === b || b.includes(a) || a.includes(b)
        })
        if (columnIndex === -1 || columnIndex >= columnFields.length) return
        const columnName = columnFields[columnIndex]
        const el = th as HTMLElement
        const prev = (el as any)._billingTodoHeaderContext
        if (prev) el.removeEventListener('contextmenu', prev)
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._billingTodoHeaderContext = handler
        el.addEventListener('contextmenu', handler)
      })
    }

    const attachAll = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      const table = document.querySelector('.handsontable-custom table.htCore')
      if (table) attachContextMenuToHeader(table.querySelector('thead tr'))
      const cloneTop = document.querySelector('.handsontable-custom .ht_clone_top table.htCore')
      if (cloneTop) attachContextMenuToHeader(cloneTop.querySelector('thead tr'))
    }

    timeoutId = setTimeout(attachAll, 300)
    const observer = new MutationObserver(() => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(attachAll, 200)
    })
    const tableContainer = document.querySelector('.handsontable-custom')
    if (tableContainer) observer.observe(tableContainer, { childList: true, subtree: true })

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      observer.disconnect()
      hideMenu()
      document.querySelectorAll('.handsontable-custom th').forEach((th) => {
        const h = (th as any)._billingTodoHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
    }
  }, [canEdit, onLockColumn, isColumnLocked, columnFields, columnTitles, isLockBillingTodo])

  const getReadOnly = (columnName: keyof IsLockBillingTodo): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  // Create columns with custom renderers; only ID and Status are sortable (Issue, Notes, F/u notes have headerAction: false)
  const todosColumns = useMemo(() => [
    { 
      data: 0, 
      title: 'ID', 
      type: 'text' as const, 
      width: 80,
      readOnly: !canEdit || getReadOnly('id_column'),
    },
    { 
      data: 1, 
      title: 'Status', 
      type: 'dropdown' as const, 
      width: 120,
      selectOptions: ['New', 'Waiting', 'In Progress', 'Complete', 'Updated'],
      allowEmpty: false,
      renderer: createBubbleDropdownRenderer(getStatusColor) as any,
      readOnly: !canEdit || getReadOnly('status'),
    },
    { 
      data: 2, 
      title: 'Issue', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('issue'),
      columnSorting: { headerAction: false },
    },
    { 
      data: 3, 
      title: 'Notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('notes'),
      columnSorting: { headerAction: false },
    },
    { 
      data: 4, 
      title: 'F/u notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('followup_notes'),
      columnSorting: { headerAction: false },
    },
  ], [canEdit, lockData, getStatusColor])

  const handleTodosHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes) return
    // Skip programmatic data load so we never run save after "delete all" refill (avoids inserting 100 empty records)
    if (source === 'loadData' || source === 'populateFromArray') return

    if (isInitialLoadRef.current || loading) return

    // Use ref as single source of truth so rapid edits don't see stale state
    const currentTodos = todosRef.current.length > 0 ? todosRef.current : todos
    const updatedTodos = [...currentTodos]
    const fields: Array<'id' | 'status' | 'issue' | 'notes' | 'followup_notes'> = ['id', 'status', 'issue', 'notes', 'followup_notes']

    changes.forEach(([row, col, , newValue]) => {
      while (updatedTodos.length <= row) {
        const existingEmptyCount = updatedTodos.filter(t => t.id.startsWith('empty-')).length
        updatedTodos.push(createEmptyTodo(existingEmptyCount))
      }

      const todo = updatedTodos[row]
      if (todo) {
        const field = fields[col as number]
        const needsNewId = todo.id.startsWith('empty-')
        // Stable id per row index so multiple cell edits = one row, one insert (no multi-insert)
        const newId = needsNewId ? `new-row-${row}-${sessionIdRef.current}` : todo.id

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

    // When status changes to Complete, move row to bottom of data; when changed from Complete, move to top
    const statusChanged = changes.some(([, col]) => col === 1)
    if (statusChanged) {
      const isEmptyRow = (t: TodoItem) =>
        t.id.startsWith('empty-') &&
        !t.issue &&
        !t.notes &&
        !t.followup_notes &&
        (!t.status || t.status === '' || t.status === 'Open')
      const dataRows = updatedTodos.filter((t) => !isEmptyRow(t))
      let incomplete = dataRows.filter((t) => t.status !== 'Complete')
      const complete = dataRows.filter((t) => t.status === 'Complete')
      const emptyRows = updatedTodos.filter((t) => isEmptyRow(t))
      // Rows that were just changed from Complete to something else go to the top of incomplete
      const movedToTopIds = new Set<string>()
      changes.forEach(([row, , oldVal, newVal]) => {
        if (row < updatedTodos.length && oldVal === 'Complete' && newVal !== 'Complete') {
          movedToTopIds.add(updatedTodos[row].id)
        }
      })
      if (movedToTopIds.size > 0) {
        incomplete = [
          ...incomplete.filter((t) => movedToTopIds.has(t.id)),
          ...incomplete.filter((t) => !movedToTopIds.has(t.id)),
        ]
      }
      const reordered = [...incomplete, ...complete, ...emptyRows]
      // Keep length; truncate or pad to match updatedTodos length so we don't change row count here
      while (reordered.length < updatedTodos.length) {
        const existingEmptyCount = reordered.filter((t) => t.id.startsWith('empty-')).length
        reordered.push(createEmptyTodo(existingEmptyCount))
      }
      if (reordered.length > updatedTodos.length) reordered.length = updatedTodos.length
      updatedTodos.length = 0
      updatedTodos.push(...reordered)
    }

    // Cap at 200 rows
    if (updatedTodos.length > 200) updatedTodos.length = 200
    if (updatedTodos.length < 200) {
      const emptyRowsNeeded = 200 - updatedTodos.length
      const existingEmptyCount = updatedTodos.filter(t => t.id.startsWith('empty-')).length
      updatedTodos.push(...Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyTodo(existingEmptyCount + i)))
    }

    todosRef.current = updatedTodos
    setTodos(updatedTodos)
    if (statusChanged) setStructureVersion((v) => v + 1)

    // Schedule save when change touched issue, notes, followup_notes, or status (so status and order persist).
    const hasMeaningfulChange = changes.some(([, col]) => col === 1 || col === 2 || col === 3 || col === 4)
    if (!hasMeaningfulChange) return

    if (saveTodosTimeoutRef.current) clearTimeout(saveTodosTimeoutRef.current)
    saveTodosTimeoutRef.current = setTimeout(() => {
      saveTodosTimeoutRef.current = null
      saveTodos(todosRef.current).catch(err => {
        console.error('[handleTodosHandsontableChange] Error in saveTodos:', err)
      })
    }, 600)
  }, [saveTodos, createEmptyTodo, loading, todos])

  const [tableContextMenu, setTableContextMenu] = useState<{ x: number; y: number; rowIndex: number; todoId: string } | null>(null)
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
      setTableContextMenu({ x: event.clientX, y: event.clientY, rowIndex: row, todoId: todo.id })
    }
  }, [todos, canEdit])

  const handleContextMenuAddRowBelow = useCallback(() => {
    if (tableContextMenu == null) return
    const { rowIndex } = tableContextMenu
    const existingEmptyCount = todos.filter(t => t.id.startsWith('empty-')).length
    const newRow = createEmptyTodo(existingEmptyCount)
    let updated = [...todos.slice(0, rowIndex + 1), newRow, ...todos.slice(rowIndex + 1)]
    if (updated.length > 200) updated = updated.slice(0, 200)
    const toSave = updated.length < 200
      ? [...updated, ...Array.from({ length: 200 - updated.length }, (_, i) => createEmptyTodo(existingEmptyCount + 1 + i))]
      : updated
    todosRef.current = toSave
    setTodos(toSave)
    setStructureVersion(v => v + 1)
    saveTodos(toSave).catch(err => console.error('saveTodos after add row', err))
    setTableContextMenu(null)
  }, [tableContextMenu, todos, createEmptyTodo, saveTodos])

  const handleContextMenuAddRowAbove = useCallback(() => {
    if (tableContextMenu == null) return
    const { rowIndex } = tableContextMenu
    const existingEmptyCount = todos.filter(t => t.id.startsWith('empty-')).length
    const newRow = createEmptyTodo(existingEmptyCount)
    let updated = [...todos.slice(0, rowIndex), newRow, ...todos.slice(rowIndex)]
    if (updated.length > 200) updated = updated.slice(0, 200)
    const toSave = updated.length < 200
      ? [...updated, ...Array.from({ length: 200 - updated.length }, (_, i) => createEmptyTodo(existingEmptyCount + 1 + i))]
      : updated
    todosRef.current = toSave
    setTodos(toSave)
    setStructureVersion(v => v + 1)
    saveTodos(toSave).catch(err => console.error('saveTodos after add row', err))
    setTableContextMenu(null)
  }, [tableContextMenu, todos, createEmptyTodo, saveTodos])

  const handleContextMenuDeleteRow = useCallback(async () => {
    if (tableContextMenu == null) return
    const { todoId } = tableContextMenu
    setTableContextMenu(null)
    if (todoId.startsWith('empty-') || todoId.startsWith('new-')) {
      const updated = todos.filter(t => t.id !== todoId)
      const emptyNeeded = Math.max(0, 200 - updated.length)
      const existingEmpty = updated.filter(t => t.id.startsWith('empty-')).length
      const toSave = emptyNeeded > existingEmpty
        ? [...updated, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyTodo(existingEmpty + i))]
        : updated
      todosRef.current = toSave
      setTodos(toSave)
      setStructureVersion(v => v + 1)
      saveTodos(toSave).catch(err => console.error('saveTodos after delete row', err))
    } else {
      if (saveTodosTimeoutRef.current) {
        clearTimeout(saveTodosTimeoutRef.current)
        saveTodosTimeoutRef.current = null
      }
      await handleDeleteTodo(todoId)
    }
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
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`todos-${clinicId}-${JSON.stringify(lockData)}`}
          data={getTodosHandsontableData()}
          dataVersion={structureVersion}
          columns={todosColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          afterChange={handleTodosHandsontableChange}
          onAfterRowMove={handleTodosRowMove}
          onContextMenu={handleTodosHandsontableContextMenu}
          onCellHighlight={handleCellHighlight}
          getCellIsHighlighted={getCellIsHighlighted}
          cells={todosCellsCallback}
          enableFormula={true}
          columnSorting={true}
          readOnly={!canEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom billing-todo-sortable"
        />
      </div>

      {tableContextMenu != null && createPortal(
        <div
          ref={tableContextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[160px]"
          style={{ left: tableContextMenu.x, top: tableContextMenu.y }}
        >
          <button
            type="button"
            onClick={handleContextMenuAddRowAbove}
            className="w-full text-left px-4 py-2 text-white hover:bg-white/10 flex items-center gap-2"
          >
            <Plus size={16} />
            Add row above
          </button>
          <button
            type="button"
            onClick={handleContextMenuAddRowBelow}
            className="w-full text-left px-4 py-2 text-white hover:bg-white/10 flex items-center gap-2"
          >
            <Plus size={16} />
            Add row below
          </button>
          <button
            type="button"
            onClick={handleContextMenuDeleteRow}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete row
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
