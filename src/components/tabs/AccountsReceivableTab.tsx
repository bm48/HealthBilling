import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { AccountsReceivable, StatusColor, IsLockAccountsReceivable } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer } from '@/lib/handsontableCustomRenderers'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toDisplayValue, toStoredString } from '@/lib/utils'

interface AccountsReceivableTabProps {
  clinicId: string
  canEdit: boolean
  onDelete?: (arId: string) => void
  isLockAccountsReceivable?: IsLockAccountsReceivable | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockAccountsReceivable) => boolean
  isInSplitScreen?: boolean
}

export default function AccountsReceivableTab({ clinicId, canEdit, onDelete, isLockAccountsReceivable, onLockColumn, isColumnLocked, isInSplitScreen }: AccountsReceivableTabProps) {
  const { userProfile } = useAuth()
  const [accountsReceivable, setAccountsReceivable] = useState<AccountsReceivable[]>([])
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => new Date())
  const accountsReceivableRef = useRef<AccountsReceivable[]>([])
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)

  const formatMonthYear = useCallback((date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [])

  const isARInMonth = useCallback((ar: AccountsReceivable, monthDate: Date): boolean => {
    const month = monthDate.getMonth()
    const year = monthDate.getFullYear()
    const now = new Date()
    const isCurrentMonth = month === now.getMonth() && year === now.getFullYear()
    if (ar.id.startsWith('empty-') || ar.id.startsWith('new-')) {
      const hasDate = !!(ar.date_of_service || ar.date_recorded)
      if (hasDate) {
        const d = ar.date_of_service || ar.date_recorded
        const parsed = d ? new Date(String(d)) : null
        if (parsed && !isNaN(parsed.getTime()))
          return parsed.getMonth() === month && parsed.getFullYear() === year
        return false
      }
      return isCurrentMonth
    }
    const dateStr = ar.date_of_service || ar.date_recorded
    if (!dateStr) return isCurrentMonth
    const parsed = new Date(String(dateStr))
    if (isNaN(parsed.getTime())) return isCurrentMonth
    return parsed.getMonth() === month && parsed.getFullYear() === year
  }, [])

  const filteredAR = useMemo(() => {
    return accountsReceivable.filter(ar => isARInMonth(ar, selectedMonth))
  }, [accountsReceivable, selectedMonth, isARInMonth])

  // Display list: always 200 rows. Pad with display-only placeholders (no date pre-filled) when filtered has fewer than 200.
  const displayAR = useMemo(() => {
    const list = filteredAR.slice(0, 200)
    if (list.length >= 200) return list
    const need = 200 - list.length
    const monthKey = selectedMonth.getTime()
    const placeholders: AccountsReceivable[] = Array.from({ length: need }, (_, i) => ({
      id: `placeholder-${monthKey}-${i}`,
      clinic_id: clinicId,
      ar_id: '',
      name: null,
      date_of_service: null,
      amount: null,
      date_recorded: null,
      type: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
    return [...list, ...placeholders]
  }, [filteredAR, selectedMonth.getTime(), clinicId])

  // Use isLockAccountsReceivable from props directly - it will update when parent refreshes
  const lockData = isLockAccountsReceivable || null

  const createEmptyAR = useCallback((index: number): AccountsReceivable => ({
    id: `empty-${index}`,
    clinic_id: clinicId,
    ar_id: '',
    name: null,
    date_of_service: null,
    amount: null,
    date_recorded: null,
    type: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }), [clinicId])

  const fetchStatusColors = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('status_colors')
        .select('*')
        .in('type', ['ar_type', 'month'])

      if (error) throw error
      setStatusColors(data || [])
    } catch (error) {
      console.error('Error fetching status colors:', error)
    }
  }, [])

  const fetchAccountsReceivable = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('accounts_receivable')
        .select('*')
        .eq('clinic_id', clinicId)
        // No sorting - preserve exact order from database (typically creation order)

      if (error) throw error
      const fetchedAR = data || []

      setAccountsReceivable(currentAR => {
        // Map of fetched AR by ID for lookups
        const fetchedARMap = new Map<string, AccountsReceivable>()
        fetchedAR.forEach(ar => {
          fetchedARMap.set(ar.id, ar)
        })

        // Preserve visual table order: walk current rows in order.
        // For each row: keep unsaved (new-/empty-) in place; replace real IDs with fresh data; skip deleted (real but not in fetched).
        const preservedOrder: AccountsReceivable[] = []
        currentAR.forEach(ar => {
          if (ar.id.startsWith('new-') || ar.id.startsWith('empty-')) {
            preservedOrder.push(ar)
          } else {
            const freshData = fetchedARMap.get(ar.id)
            if (freshData) {
              preservedOrder.push({
                ...freshData,
                name: (freshData.name != null && freshData.name !== 'null') ? freshData.name : null,
                date_of_service: (freshData.date_of_service != null && freshData.date_of_service !== 'null') ? freshData.date_of_service : null,
                date_recorded: (freshData.date_recorded != null && freshData.date_recorded !== 'null') ? freshData.date_recorded : null,
                type: (freshData.type != null && (freshData.type as unknown) !== 'null') ? freshData.type : null,
                notes: (freshData.notes != null && freshData.notes !== 'null') ? freshData.notes : null,
              })
              fetchedARMap.delete(ar.id)
            }
            // Deleted AR (real id but not in fetched): skip, so row is effectively removed
          }
        })

        // Add any fetched AR not in current state (e.g. created elsewhere); normalize string "null"
        const newFetchedAR = Array.from(fetchedARMap.values()).map(ax => ({
          ...ax,
          name: (ax.name != null && ax.name !== 'null') ? ax.name : null,
          date_of_service: (ax.date_of_service != null && ax.date_of_service !== 'null') ? ax.date_of_service : null,
          date_recorded: (ax.date_recorded != null && ax.date_recorded !== 'null') ? ax.date_recorded : null,
          type: (ax.type != null && (ax.type as unknown) !== 'null') ? ax.type : null,
          notes: (ax.notes != null && ax.notes !== 'null') ? ax.notes : null,
        }))
        const updated = [...preservedOrder, ...newFetchedAR]

        const totalRows = updated.length
        const emptyRowsNeeded = Math.max(0, 200 - totalRows)
        const existingEmptyCount = updated.filter(ar => ar.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyAR(existingEmptyCount + i)
        )
        const finalUpdated = [...updated, ...newEmptyRows]

        accountsReceivableRef.current = fetchedAR
        return finalUpdated
      })
    } catch (error) {
      console.error('Error fetching accounts receivable:', error)
    } finally {
      setLoading(false)
    }
  }, [clinicId, createEmptyAR])

  useEffect(() => {
    if (clinicId) {
      fetchStatusColors()
      fetchAccountsReceivable()
    }
  }, [clinicId, fetchStatusColors, fetchAccountsReceivable])

  const saveAccountsReceivable = useCallback(async (arToSave: AccountsReceivable[]) => {
    if (!clinicId || !userProfile) return

    // Filter out only truly empty rows (empty- AR with no data)
    // Allow empty- AR that have data to be processed (they'll be inserted as new AR)
    const arToProcess = arToSave.filter(ar => {
      const hasData = ar.ar_id || ar.name || ar.date_of_service || ar.amount !== null || ar.date_recorded || ar.type || ar.notes
      // If it's an empty- AR, only include it if it has data
      if (ar.id.startsWith('empty-')) {
        return hasData
      }
      // For all other AR (new- or real IDs), include if they have data
      return hasData
    })
    
    if (arToProcess.length === 0) return

    try {
      // Store saved AR with their database responses to update in place
      const savedARMap = new Map<string, AccountsReceivable>() // Map old ID -> new AR data
      
      // Process each AR
      for (let i = 0; i < arToProcess.length; i++) {
        const ar = arToProcess[i]
        const oldId = ar.id // Store the old ID to find it in state

        // Generate ar_id if missing
        let finalArId = ar.ar_id || ''
        if (!finalArId) {
          // Generate a simple ID based on timestamp
          finalArId = `AR-${Date.now()}-${i}`
        }

        // Prepare AR data (never send string "null" to DB)
        const arData: any = {
          clinic_id: clinicId,
          ar_id: finalArId.trim(),
          name: (ar.name != null && ar.name !== 'null') ? ar.name : null,
          date_of_service: (ar.date_of_service != null && ar.date_of_service !== 'null') ? ar.date_of_service : null,
          amount: (ar.amount != null && (ar.amount as unknown) !== 'null') ? ar.amount : null,
          date_recorded: (ar.date_recorded != null && ar.date_recorded !== 'null') ? ar.date_recorded : null,
          type: (ar.type != null && (ar.type as unknown) !== 'null') ? ar.type : null,
          notes: (ar.notes != null && ar.notes !== 'null') ? ar.notes : null,
          updated_at: new Date().toISOString(),
        }

        let savedAR: AccountsReceivable | null = null

        // If AR has a real database ID (not new- or empty-), update by ID
        if (!ar.id.startsWith('new-') && !ar.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await supabase
            .from('accounts_receivable')
            .update(arData)
            .eq('id', ar.id)
            .select()

          if (!updateError && updateData && updateData.length > 0) {
            savedAR = updateData[0] as AccountsReceivable
            savedARMap.set(oldId, savedAR)
            continue // Update successful, move to next AR
          }
          // If update failed, fall through to insert
        }

        // Use insert for new AR (new- or empty- IDs) or when update by ID fails
        const { error: insertError, data: insertedAR } = await supabase
          .from('accounts_receivable')
          .insert(arData)
          .select()
          .maybeSingle()

        if (insertError) {
          console.error('[saveAccountsReceivable] Error inserting AR:', insertError, arData)
          throw insertError
        }
        
        if (insertedAR) {
          savedAR = insertedAR as AccountsReceivable
          savedARMap.set(oldId, savedAR) // Map old ID to new AR data
        }
      }

      // Update AR in place without reordering - preserve exact row positions
      setAccountsReceivable(currentAR => {
        return currentAR.map(ar => {
          const savedAR = savedARMap.get(ar.id)
          if (savedAR) {
            // Normalize string "null" from DB so table never displays "null"
            return {
              ...savedAR,
              name: (savedAR.name != null && savedAR.name !== 'null') ? savedAR.name : null,
              date_of_service: (savedAR.date_of_service != null && savedAR.date_of_service !== 'null') ? savedAR.date_of_service : null,
              date_recorded: (savedAR.date_recorded != null && savedAR.date_recorded !== 'null') ? savedAR.date_recorded : null,
              type: (savedAR.type != null && (savedAR.type as unknown) !== 'null') ? savedAR.type : null,
              notes: (savedAR.notes != null && savedAR.notes !== 'null') ? savedAR.notes : null,
            }
          }
          return ar // Keep all other AR exactly as they are
        })
      })
      
      // Update ref
      accountsReceivableRef.current = arToSave
    } catch (error: any) {
      console.error('Error saving accounts receivable:', error)
      alert(error?.message || 'Failed to save accounts receivable. Please try again.')
    }
  }, [clinicId, userProfile])

  const handleDeleteAR = useCallback(async (arId: string) => {
    if (arId.startsWith('new-')) {
      setAccountsReceivable(prev => prev.filter(a => a.id !== arId))
      return
    }

    try {
      const { error } = await supabase
        .from('accounts_receivable')
        .delete()
        .eq('id', arId)

      if (error) throw error
      await fetchAccountsReceivable()
      if (onDelete) onDelete(arId)
    } catch (error) {
      console.error('Error deleting accounts receivable:', error)
      alert('Failed to delete accounts receivable record. Please try again.')
    }
  }, [fetchAccountsReceivable, onDelete])

  // Type color mapping
  const getTypeColor = useCallback((type: string | null): { color: string; textColor: string } | null => {
    if (!type) return null
    const typeColor = statusColors.find(s => s.status === type && s.type === 'ar_type')
    if (typeColor) {
      return { color: typeColor.color, textColor: typeColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  // Month color for month selector (from status_colors type 'month')
  const getMonthColor = useCallback((month: string): { color: string; textColor: string } | null => {
    if (!month) return null
    const monthColor = statusColors.find(s => s.status === month && s.type === 'month')
    if (monthColor) {
      return { color: monthColor.color, textColor: monthColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  // Convert AR to Handsontable data format (displayAR is always 200 rows); never show "null"
  const getARHandsontableData = useCallback(() => {
    return displayAR.map(ar => [
      toDisplayValue(ar.ar_id),
      toDisplayValue(ar.name),
      toDisplayValue(ar.date_of_service),
      toDisplayValue(ar.amount),
      toDisplayValue(ar.date_recorded),
      toDisplayValue(ar.type),
      toDisplayValue(ar.notes),
    ])
  }, [displayAR])

  // Column field names mapping to is_lock_accounts_receivable table columns
  const columnFields: Array<keyof IsLockAccountsReceivable> = ['ar_id', 'name', 'date_of_service', 'amount', 'date_recorded', 'type', 'notes']
  const columnTitles = ['ID #', 'Name', 'Date of Service', 'Amount', 'Date Recorded', 'Type', 'Notes']

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
        lockButton.className = 'ar-lock-icon'
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
      const allLockIcons = document.querySelectorAll('.ar-lock-icon')
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
  }, [canEdit, onLockColumn, isColumnLocked, columnFields, columnTitles, isLockAccountsReceivable])

  const getReadOnly = (columnName: keyof IsLockAccountsReceivable): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  // Create columns with custom renderers
  const arColumns = useMemo(() => [
    { 
      data: 0, 
      title: 'ID #', 
      type: 'text' as const, 
      width: 80,
      readOnly: !canEdit || getReadOnly('ar_id')
    },
    { 
      data: 1, 
      title: 'Name', 
      type: 'text' as const, 
      width: 120,
      readOnly: !canEdit || getReadOnly('name')
    },
    { 
      data: 2, 
      title: 'Date of Service', 
      type: 'date' as const, 
      width: 120,
      format: 'YYYY-MM-DD',
      readOnly: !canEdit || getReadOnly('date_of_service')
    },
    { 
      data: 3, 
      title: 'Amount', 
      type: 'numeric' as const, 
      width: 100,
      numericFormat: {
        pattern: '0.00',
        culture: 'en-US'
      },
      readOnly: !canEdit || getReadOnly('amount')
    },
    { 
      data: 4, 
      title: 'Date Recorded', 
      type: 'date' as const, 
      width: 120,
      format: 'YYYY-MM-DD',
      readOnly: !canEdit || getReadOnly('date_recorded')
    },
    { 
      data: 5, 
      title: 'Type', 
      type: 'dropdown' as const, 
      width: 120,
      editor: 'select',
      selectOptions: ['Patient', 'Insurance', 'Collections', 'MindRx Group'],
      renderer: createBubbleDropdownRenderer(getTypeColor) as any,
      readOnly: !canEdit || getReadOnly('type')
    },
    { 
      data: 6, 
      title: 'Notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('notes')
    },
  ], [canEdit, lockData, getTypeColor])

  const firstDayOfSelectedMonth = useMemo(() => {
    return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`
  }, [selectedMonth])

  const handleARHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return

    const fields: Array<keyof AccountsReceivable> = ['ar_id', 'name', 'date_of_service', 'amount', 'date_recorded', 'type', 'notes']

    setAccountsReceivable(currentAR => {
      const filtered = currentAR.filter(ar => isARInMonth(ar, selectedMonth))
      const updatedAR = [...currentAR]
      let idCounter = 0
      const placeholderChangesByRow = new Map<number, Array<{ col: number; newValue: any }>>()

      changes.forEach(([row, col, , newValue]) => {
        const rowNum = typeof row === 'number' ? row : 0
        const colNum = typeof col === 'number' ? col : 0
        if (rowNum >= filtered.length) {
          if (!placeholderChangesByRow.has(rowNum)) placeholderChangesByRow.set(rowNum, [])
          placeholderChangesByRow.get(rowNum)!.push({ col: colNum, newValue })
          return
        }
        const ar = filtered[rowNum]
        if (!ar) return
        const fullIndex = updatedAR.findIndex(a => a.id === ar.id)
        if (fullIndex < 0) return

        const field = fields[colNum]
        const needsNewId = ar.id.startsWith('empty-')
        const newId = needsNewId ? `new-${Date.now()}-${idCounter++}-${Math.random()}` : ar.id
        const item = updatedAR[fullIndex]

        if (field === 'amount') {
          const numValue = (newValue === '' || newValue === null || newValue === 'null') ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
          updatedAR[fullIndex] = { ...item, id: newId, [field]: numValue, updated_at: new Date().toISOString() } as AccountsReceivable
        } else if (field === 'date_of_service' || field === 'date_recorded' || field === 'type' || field === 'notes') {
          const value = toStoredString(String(newValue ?? ''))
          updatedAR[fullIndex] = { ...item, id: newId, [field]: value, updated_at: new Date().toISOString() } as AccountsReceivable
        } else if (field === 'ar_id') {
          const value = (newValue === '' || newValue === 'null') ? '' : String(newValue)
          updatedAR[fullIndex] = { ...item, id: newId, [field]: value, updated_at: new Date().toISOString() } as AccountsReceivable
        } else if (field) {
          const value = toStoredString(String(newValue ?? ''))
          updatedAR[fullIndex] = { ...item, id: newId, [field]: value, updated_at: new Date().toISOString() } as AccountsReceivable
        }
      })

      let emptyIdx = updatedAR.filter(ar => ar.id.startsWith('empty-')).length
      placeholderChangesByRow.forEach((changesForRow) => {
        const newRow: AccountsReceivable = {
          ...createEmptyAR(emptyIdx++),
          date_of_service: firstDayOfSelectedMonth,
        }
        changesForRow.forEach(({ col, newValue }) => {
          const field = fields[col as number]
          if (field === 'amount') {
            const numValue = (newValue === '' || newValue === null || newValue === 'null') ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
            ;(newRow as any)[field] = numValue
          } else if (field === 'date_of_service' || field === 'date_recorded' || field === 'type' || field === 'notes') {
            ;(newRow as any)[field] = toStoredString(String(newValue ?? ''))
          } else if (field === 'ar_id') {
            ;(newRow as any)[field] = (newValue === '' || newValue === 'null') ? '' : String(newValue)
          } else if (field) {
            ;(newRow as any)[field] = toStoredString(String(newValue ?? ''))
          }
        })
        newRow.updated_at = new Date().toISOString()
        updatedAR.push(newRow)
      })

      setTimeout(() => {
        saveAccountsReceivable(updatedAR).catch(err => {
          console.error('[handleARHandsontableChange] Error in saveAccountsReceivable:', err)
        })
      }, 0)

      return updatedAR
    })
  }, [saveAccountsReceivable, selectedMonth, isARInMonth, createEmptyAR, firstDayOfSelectedMonth])

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

  const handleARHandsontableContextMenu = useCallback((row: number, _col: number, event: MouseEvent) => {
    event.preventDefault()
    if (!canEdit) return
    const ar = displayAR[row]
    if (ar) {
      setTableContextMenu({ x: event.clientX, y: event.clientY, rowIndex: row })
    }
  }, [displayAR, canEdit])

  const handleContextMenuAddRow = useCallback(() => {
    if (tableContextMenu == null) return
    const { rowIndex } = tableContextMenu
    const ar = displayAR[rowIndex]
    const existingEmptyCount = accountsReceivable.filter(a => a.id.startsWith('empty-')).length
    const firstDay = firstDayOfSelectedMonth
    const newRow: AccountsReceivable = {
      ...createEmptyAR(existingEmptyCount),
      date_of_service: firstDay,
    }
    if (ar.id.startsWith('placeholder-')) {
      setAccountsReceivable(prev => [...prev, newRow])
      accountsReceivableRef.current = [...accountsReceivable, newRow]
      saveAccountsReceivable([...accountsReceivable, newRow]).catch(err => console.error('saveAccountsReceivable after add row', err))
    } else {
      const fullIndex = accountsReceivable.findIndex(a => a.id === ar.id)
      const insertAt = fullIndex < 0 ? accountsReceivable.length : fullIndex + 1
      const updated = [...accountsReceivable.slice(0, insertAt), newRow, ...accountsReceivable.slice(insertAt)]
      const capped = updated.length > 200 ? updated.slice(0, 200) : updated
      const toSave = capped.length < 200
        ? [...capped, ...Array.from({ length: 200 - capped.length }, (_, i) => createEmptyAR(existingEmptyCount + 1 + i))]
        : capped
      accountsReceivableRef.current = toSave
      setAccountsReceivable(toSave)
      saveAccountsReceivable(toSave).catch(err => console.error('saveAccountsReceivable after add row', err))
    }
    setTableContextMenu(null)
  }, [tableContextMenu, displayAR, accountsReceivable, createEmptyAR, saveAccountsReceivable, firstDayOfSelectedMonth])

  const handleContextMenuDeleteRow = useCallback(() => {
    if (tableContextMenu == null) return
    const ar = displayAR[tableContextMenu.rowIndex]
    if (!ar) {
      setTableContextMenu(null)
      return
    }
    if (ar.id.startsWith('placeholder-')) {
      setTableContextMenu(null)
      return
    }
    if (ar.id.startsWith('empty-') || ar.id.startsWith('new-')) {
      const updated = accountsReceivable.filter(a => a.id !== ar.id)
      const emptyNeeded = Math.max(0, 200 - updated.length)
      const existingEmpty = updated.filter(a => a.id.startsWith('empty-')).length
      const toSave = emptyNeeded > existingEmpty
        ? [...updated, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyAR(existingEmpty + i))]
        : updated.slice(0, 200)
      accountsReceivableRef.current = toSave
      setAccountsReceivable(toSave)
      saveAccountsReceivable(toSave).catch(err => console.error('saveAccountsReceivable after delete row', err))
    } else {
      handleDeleteAR(ar.id)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, displayAR, accountsReceivable, createEmptyAR, saveAccountsReceivable, handleDeleteAR])

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
        <div className="text-center text-white/70 py-8">Loading accounts receivable...</div>
      </div>
    )
  }

  return (
    <div 
      className="p-6" 
      style={isInSplitScreen ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}
    >
      {!isInSplitScreen && (
        <div className="mb-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">ACCOUNTS RECEIVABLE</h2>
        </div>
      )}
      {/* Month selector - colors from status_colors (type 'month') like Providers tab */}
      {(() => {
        const monthName = selectedMonth.toLocaleString('en-US', { month: 'long' })
        const monthColor = getMonthColor(monthName)
        const bgColor = monthColor?.color ?? 'rgba(30, 41, 59, 0.5)'
        const textColor = monthColor?.textColor ?? '#fff'
        return (
          <div
            className="mb-4 flex items-center justify-center gap-4 rounded-lg border border-slate-700 -mt-4"
            style={{ backgroundColor: bgColor, color: textColor }}
          >
            <button
              onClick={() => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="p-2 hover:opacity-80 rounded-lg transition-opacity"
              style={{ color: textColor }}
              title="Previous month"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-lg font-semibold min-w-[200px] text-center">
              {formatMonthYear(selectedMonth)}
            </div>
            <button
              onClick={() => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="p-2 hover:opacity-80 rounded-lg transition-opacity"
              style={{ color: textColor }}
              title="Next month"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )
      })()}
      <div 
        ref={tableContainerRef}
        className="table-container dark-theme" 
        style={{ 
          maxHeight: isInSplitScreen ? undefined : 'calc(100vh - 300px)',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflowY: 'auto',
          overflowX: 'auto',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`ar-${accountsReceivable.length}-${selectedMonth.getTime()}-${JSON.stringify(lockData)}`}
          data={getARHandsontableData()}
          columns={arColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          afterChange={handleARHandsontableChange}
          onContextMenu={handleARHandsontableContextMenu}
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
