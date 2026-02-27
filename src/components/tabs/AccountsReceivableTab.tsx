import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { AccountsReceivable, StatusColor, IsLockAccountsReceivable } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer } from '@/lib/handsontableCustomRenderers'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toDisplayValue, toDisplayDate, toStoredString } from '@/lib/utils'

interface AccountsReceivableTabProps {
  clinicId: string
  /** 1 = default; 2 = clinic has two pay periods, show Payroll 1/2 selector */
  clinicPayroll?: 1 | 2
  canEdit: boolean
  onDelete?: (arId: string) => void
  onRegisterUndo?: (undo: () => void) => void
  isLockAccountsReceivable?: IsLockAccountsReceivable | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockAccountsReceivable) => boolean
  isInSplitScreen?: boolean
}

export default function AccountsReceivableTab({ clinicId, clinicPayroll = 1, canEdit, onDelete, onRegisterUndo, isLockAccountsReceivable, onLockColumn, isColumnLocked, isInSplitScreen }: AccountsReceivableTabProps) {
  const { userProfile } = useAuth()
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => new Date())
  const [selectedPayroll, setSelectedPayroll] = useState<1 | 2>(1)
  const fetchIdRef = useRef(0)
  /** Full list (all months) for save and month switching - like Patients has one list, we keep "all" in ref */
  const fullListRef = useRef<AccountsReceivable[]>([])
  /** Displayed list (current month, 200 rows) - same as Patients: state = what we show, grid row index = array index */
  const [displayedAR, setDisplayedAR] = useState<AccountsReceivable[]>([])
  const displayedARRef = useRef<AccountsReceivable[]>([])
  /** Stable temporary new- id per row (by current row id) so multiple cell edits on one row insert one record, not one per edit - same as Patients pendingPatientIdByRowIdRef */
  const pendingNewIdByRowIdRef = useRef<Map<string, string>>(new Map())
  const saveARTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const [structureVersion, setStructureVersion] = useState(0)
  const scrollToRowAfterUpdateRef = useRef<number | null>(null)
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())

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
      // No date: show in the month being viewed (selected month), so add-row places it in the right view
      return true
    }
    const dateStr = ar.date_of_service || ar.date_recorded
    if (!dateStr) return isCurrentMonth
    const parsed = new Date(String(dateStr))
    if (isNaN(parsed.getTime())) return isCurrentMonth
    return parsed.getMonth() === month && parsed.getFullYear() === year
  }, [])

  // Use isLockAccountsReceivable from props directly - it will update when parent refreshes
  const lockData = isLockAccountsReceivable || null

  /** Build displayed list (200 rows) for selected month from full list - same pattern as Patients: one list = what we show */
  const buildDisplayedFromFull = useCallback((): AccountsReceivable[] => {
    const full = fullListRef.current
    let list = full.filter(ar => isARInMonth(ar, selectedMonth))
    if (clinicPayroll === 2) {
      list = list.filter(ar => (ar.payroll ?? 1) === selectedPayroll)
    }
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
      payroll: clinicPayroll === 2 ? selectedPayroll : 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
    return [...list, ...placeholders]
  }, [selectedMonth, clinicPayroll, selectedPayroll, clinicId, isARInMonth])

  const currentPayrollForAR = clinicPayroll === 2 ? selectedPayroll : 1
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
    payroll: currentPayrollForAR,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }), [clinicId, currentPayrollForAR])

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
    const payrollFilter = clinicPayroll === 2 ? selectedPayroll : 1
    const thisFetchId = ++fetchIdRef.current
    try {
      const { data, error } = await supabase
        .from('accounts_receivables')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('payroll', payrollFilter)
        .order('created_at', { ascending: false })

      if (error) throw error
      let fetchedAR = data || []
      if (clinicPayroll === 2) {
        fetchedAR = fetchedAR.filter((row: { payroll?: number }) => (row.payroll ?? 1) === payrollFilter)
      }

      // Only apply if no newer fetch started (user may have switched payroll before we completed)
      if (fetchIdRef.current !== thisFetchId) return

      const fetchedARMap = new Map<string, AccountsReceivable>()
      fetchedAR.forEach((ar: AccountsReceivable) => {
        fetchedARMap.set(ar.id, ar)
      })

      const newFetchedAR = Array.from(fetchedARMap.values()).map(ax => ({
        ...ax,
        name: (ax.name != null && ax.name !== 'null') ? ax.name : null,
        date_of_service: (ax.date_of_service != null && ax.date_of_service !== 'null') ? ax.date_of_service : null,
        date_recorded: (ax.date_recorded != null && ax.date_recorded !== 'null') ? ax.date_recorded : null,
        type: (ax.type != null && (ax.type as unknown) !== 'null') ? ax.type : null,
        notes: (ax.notes != null && ax.notes !== 'null') ? ax.notes : null,
      }))

      if (clinicPayroll === 1) {
        const currentAR = fullListRef.current
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
          }
        })
        const remainingFetched = Array.from(fetchedARMap.values()).map(ax => ({
          ...ax,
          name: (ax.name != null && ax.name !== 'null') ? ax.name : null,
          date_of_service: (ax.date_of_service != null && ax.date_of_service !== 'null') ? ax.date_of_service : null,
          date_recorded: (ax.date_recorded != null && ax.date_recorded !== 'null') ? ax.date_recorded : null,
          type: (ax.type != null && (ax.type as unknown) !== 'null') ? ax.type : null,
          notes: (ax.notes != null && ax.notes !== 'null') ? ax.notes : null,
        }))
        const updated = [...preservedOrder, ...remainingFetched]
        const emptyRowsNeeded = Math.max(0, 200 - updated.length)
        const existingEmptyCount = updated.filter(ar => ar.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyAR(existingEmptyCount + i)
        )
        fullListRef.current = [...updated, ...newEmptyRows]
      } else {
        const updated = [...newFetchedAR]
        const emptyRowsNeeded = Math.max(0, 200 - updated.length)
        const existingEmptyCount = updated.filter(ar => ar.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyAR(existingEmptyCount + i)
        )
        fullListRef.current = [...updated, ...newEmptyRows]
      }
      setDisplayedAR(buildDisplayedFromFull())
    } catch (error) {
      console.error('Error fetching accounts receivable:', error)
    } finally {
      if (fetchIdRef.current === thisFetchId) {
        setLoading(false)
      }
    }
  }, [clinicId, clinicPayroll, selectedPayroll, createEmptyAR, buildDisplayedFromFull])

  useEffect(() => {
    if (!clinicId) return
    if (clinicPayroll === 2) {
      fullListRef.current = []
      setDisplayedAR([])
      setLoading(true)
    }
    fetchStatusColors()
    fetchAccountsReceivable()
  }, [clinicId, clinicPayroll, selectedPayroll, fetchStatusColors, fetchAccountsReceivable])

  /** Sync displayed ref from state - same as PatientsTab */
  useEffect(() => {
    displayedARRef.current = displayedAR
  }, [displayedAR])

  const prevSelectedMonthRef = useRef<number>(selectedMonth.getTime())
  /** When user changes month: merge current displayed back into full list, then show new month */
  useEffect(() => {
    const currentMonthKey = selectedMonth.getTime()
    if (prevSelectedMonthRef.current === currentMonthKey) return
    prevSelectedMonthRef.current = currentMonthKey
    const otherMonths = fullListRef.current.filter(ar => !isARInMonth(ar, selectedMonth))
    const currentMonthRows = displayedARRef.current.filter(ar => !ar.id.startsWith('empty-'))
    fullListRef.current = [...otherMonths, ...currentMonthRows]
    setDisplayedAR(buildDisplayedFromFull())
  }, [selectedMonth.getTime(), buildDisplayedFromFull, isARInMonth])

  const saveAccountsReceivable = useCallback(async (arToSave: AccountsReceivable[]) => {
    if (!clinicId || !userProfile) {
      console.warn('[saveAR] early return: no clinicId or userProfile')
      return
    }

    const arToProcess = arToSave.filter(ar => {
      const hasData = ar.ar_id || ar.name || ar.date_of_service || ar.amount !== null || ar.date_recorded || ar.type || ar.notes
      if (ar.id.startsWith('empty-')) {
        return hasData
      }
      return hasData
    })

    console.log('[saveAR] start arToSave.length=', arToSave.length, 'arToProcess.length=', arToProcess.length)
    if (arToProcess.length === 0) {
      console.log('[saveAR] nothing to process, return')
      return
    }

    try {
      const savedARMap = new Map<string, AccountsReceivable>()

      for (let i = 0; i < arToProcess.length; i++) {
        const ar = arToProcess[i]
        const oldId = ar.id

        let finalArId = ar.ar_id || ''
        if (!finalArId) {
          finalArId = `AR-${Date.now()}-${i}`
        }

        const payrollValue = clinicPayroll === 2 ? selectedPayroll : 1
        const arData: any = {
          clinic_id: clinicId,
          ar_id: finalArId.trim(),
          name: (ar.name != null && ar.name !== 'null') ? ar.name : null,
          date_of_service: (ar.date_of_service != null && ar.date_of_service !== 'null') ? ar.date_of_service : null,
          amount: (ar.amount != null && (ar.amount as unknown) !== 'null') ? ar.amount : null,
          date_recorded: (ar.date_recorded != null && ar.date_recorded !== 'null') ? ar.date_recorded : null,
          type: (ar.type != null && (ar.type as unknown) !== 'null') ? ar.type : null,
          notes: (ar.notes != null && ar.notes !== 'null') ? ar.notes : null,
          payroll: payrollValue,
          updated_at: new Date().toISOString(),
        }

        let savedAR: AccountsReceivable | null = null

        if (!ar.id.startsWith('new-') && !ar.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await supabase
            .from('accounts_receivables')
            .update(arData)
            .eq('id', ar.id)
            .select()

          if (!updateError && updateData && updateData.length > 0) {
            savedAR = updateData[0] as AccountsReceivable
            savedARMap.set(oldId, savedAR)
            pendingNewIdByRowIdRef.current.delete(oldId)
            continue
          }
        }

        const { error: insertError, data: insertedAR } = await supabase
          .from('accounts_receivables')
          .insert(arData)
          .select()
          .maybeSingle()

        if (insertError) {
          console.error('[saveAR] INSERT failed row', i, 'id=', oldId, 'error=', insertError, 'code=', insertError.code, 'message=', insertError.message, 'arData=', arData)
          throw insertError
        }

        if (insertedAR) {
          savedAR = insertedAR as AccountsReceivable
          savedARMap.set(oldId, savedAR)
          pendingNewIdByRowIdRef.current.delete(oldId)
        }
      }

      console.log('[saveAR] loop done savedARMap.size=', savedARMap.size, 'applying update in place')
      // Update full list in place (like PatientsTab), then refresh displayed list
      fullListRef.current = fullListRef.current.map(ar => {
        const savedAR = savedARMap.get(ar.id)
        if (savedAR) {
          return {
            ...savedAR,
            name: (savedAR.name != null && savedAR.name !== 'null') ? savedAR.name : null,
            date_of_service: (savedAR.date_of_service != null && savedAR.date_of_service !== 'null') ? savedAR.date_of_service : null,
            date_recorded: (savedAR.date_recorded != null && savedAR.date_recorded !== 'null') ? savedAR.date_recorded : null,
            type: (savedAR.type != null && (savedAR.type as unknown) !== 'null') ? savedAR.type : null,
            notes: (savedAR.notes != null && savedAR.notes !== 'null') ? savedAR.notes : null,
          }
        }
        return ar
      })
      setDisplayedAR(buildDisplayedFromFull())
      console.log('[saveAR] success complete')
    } catch (error: any) {
      console.error('[saveAR] catch error=', error, 'message=', error?.message, 'code=', error?.code, 'details=', error?.details)
      if (error?.message) console.error('[saveAR] full error message:', error.message)
      if (error?.stack) console.error('[saveAR] stack:', error.stack)
      alert(error?.message || 'Failed to save accounts receivable. Please try again.')
    }
  }, [clinicId, userProfile, clinicPayroll, selectedPayroll, buildDisplayedFromFull])

  // Flush pending save when tab is left so data isn't lost on switch (same as PatientsTab)
  useEffect(() => {
    return () => {
      if (saveARTimeoutRef.current) {
        clearTimeout(saveARTimeoutRef.current)
        saveARTimeoutRef.current = null
        const displayed = displayedARRef.current
        const otherMonths = fullListRef.current.filter(ar => !isARInMonth(ar, selectedMonth))
        const currentMonthRows = displayed.filter(ar => !ar.id.startsWith('placeholder-'))
        fullListRef.current = [...otherMonths, ...currentMonthRows]
        saveAccountsReceivable(fullListRef.current).catch(err => {
          console.error('[AccountsReceivableTab unmount] Error flushing save:', err)
        })
      }
    }
  }, [saveAccountsReceivable, selectedMonth, isARInMonth])

  const handleDeleteAR = useCallback(async (arId: string) => {
    if (arId.startsWith('new-')) {
      const next = displayedARRef.current.filter(a => a.id !== arId)
      const emptyNeeded = Math.max(0, 200 - next.length)
      const existingEmpty = next.filter(a => a.id.startsWith('empty-')).length
      const toDisplay = emptyNeeded > existingEmpty
        ? [...next, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyAR(existingEmpty + i))]
        : next
      displayedARRef.current = toDisplay
      setDisplayedAR(toDisplay)
      fullListRef.current = [
        ...fullListRef.current.filter(a => !isARInMonth(a, selectedMonth)),
        ...toDisplay.filter(a => !a.id.startsWith('empty-')),
      ]
      setStructureVersion(v => v + 1)
      return
    }

    try {
      const { error } = await supabase
        .from('accounts_receivables')
        .delete()
        .eq('id', arId)

      if (error) throw error
      await fetchAccountsReceivable()
      setStructureVersion(v => v + 1)
      if (onDelete) onDelete(arId)
    } catch (error) {
      console.error('Error deleting accounts receivable:', error)
      alert('Failed to delete accounts receivable record. Please try again.')
    }
  }, [fetchAccountsReceivable, onDelete, createEmptyAR, isARInMonth, selectedMonth])

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

  /** Same as PatientsTab: data from state (displayed list) */
  const getARHandsontableData = useCallback(() => {
    return displayedAR.map(ar => [
      toDisplayValue(ar.ar_id),
      toDisplayValue(ar.name),
      toDisplayDate(ar.date_of_service),
      toDisplayValue(ar.amount),
      toDisplayDate(ar.date_recorded),
      toDisplayValue(ar.type),
      toDisplayValue(ar.notes),
    ])
  }, [displayedAR])

  // Column field names mapping to is_lock_accounts_receivable table columns
  const columnFields: Array<keyof IsLockAccountsReceivable> = ['ar_id', 'name', 'date_of_service', 'amount', 'date_recorded', 'type', 'notes']
  const columnTitles = ['ID #', 'Name', 'Date of Service', 'Amount', 'Date Recorded', 'Type', 'Notes']

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
      const isLocked = isColumnLocked ? isColumnLocked(columnName as keyof IsLockAccountsReceivable) : false
      const menu = document.createElement('div')
      menu.className = 'ar-col-header-context-menu'
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
        let cellText = (th.querySelector('.colHeader')?.textContent ?? th.textContent ?? '').replace(/🔒|🔓/g, '').trim()
        const columnIndex = columnTitles.findIndex(title => {
          const a = title.toLowerCase().trim()
          const b = cellText.toLowerCase().trim()
          return a === b || b.includes(a) || a.includes(b)
        })
        if (columnIndex === -1 || columnIndex >= columnFields.length) return
        const columnName = columnFields[columnIndex]
        const el = th as HTMLElement
        const prev = (el as any)._arHeaderContext
        if (prev) el.removeEventListener('contextmenu', prev)
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._arHeaderContext = handler
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
        const h = (th as any)._arHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
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
      selectOptions: ['Patient', 'Insurance', 'Admin'],
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

  const arCellsCallback = useCallback(
    (row: number, col: number) => {
      const ar = displayedAR[row]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${ar?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key) ? { className: 'cell-highlight-yellow' } : {}
    },
    [displayedAR, columnFields, highlightedCells]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const ar = displayedAR[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${ar?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [displayedAR, columnFields, highlightedCells]
  )

  const handleCellHighlight = useCallback((row: number, col: number) => {
    const ar = displayedAR[row]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${ar?.id ?? `row-${row}`}:${colKey}`
    setHighlightedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [displayedAR, columnFields])

  const firstDayOfSelectedMonth = useMemo(() => {
    return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`
  }, [selectedMonth])

  const handleARRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    const arr = [...(displayedARRef.current.length > 0 ? displayedARRef.current : displayedAR)]
    const toMove = movedRows.map(i => arr[i])
    movedRows.sort((a, b) => b - a).forEach(i => arr.splice(i, 1))
    const insertAt = Math.min(finalIndex, arr.length)
    toMove.forEach((item, i) => arr.splice(insertAt + i, 0, item))
    displayedARRef.current = arr
    setDisplayedAR(arr)
    fullListRef.current = [
      ...fullListRef.current.filter(ar => !isARInMonth(ar, selectedMonth)),
      ...arr.filter(ar => !ar.id.startsWith('empty-')),
    ]
    const realAR = arr.filter(ar => !ar.id.startsWith('new-') && !ar.id.startsWith('empty-'))
    if (realAR.length > 0) {
      const baseTime = Date.now()
      Promise.all(
        realAR.map((ar, i) =>
          supabase
            .from('accounts_receivables')
            .update({ created_at: new Date(baseTime - i * 1000).toISOString() })
            .eq('id', ar.id)
        )
      ).catch(err => console.error('Failed to persist AR order', err))
    }
    setStructureVersion(v => v + 1)
  }, [displayedAR, selectedMonth, isARInMonth])

  /** Same as PatientsTab: grid row index = array index, ref = source of truth, then merge into full list and save */
  const handleARHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return

    const fields: Array<keyof AccountsReceivable> = ['ar_id', 'name', 'date_of_service', 'amount', 'date_recorded', 'type', 'notes']
    const hadDateColumnEdit = changes.some(([, col]) => col === 2 || col === 4)

    const currentDisplayed = displayedARRef.current.length > 0 ? displayedARRef.current : displayedAR
    const updatedDisplayed = [...currentDisplayed]

    changes.forEach(([row, col, , newValue]) => {
      const rowNum = typeof row === 'number' ? row : 0
      const colNum = typeof col === 'number' ? col : 0
      while (updatedDisplayed.length <= rowNum) {
        const existingEmptyCount = updatedDisplayed.filter(ar => ar.id.startsWith('empty-')).length
        updatedDisplayed.push({
          ...createEmptyAR(existingEmptyCount),
          date_of_service: firstDayOfSelectedMonth,
        })
      }
      const ar = updatedDisplayed[rowNum]
      if (!ar) return
      const field = fields[colNum]
      const needsNewId = ar.id.startsWith('empty-') || ar.id.startsWith('placeholder-')
      let newId: string
      if (needsNewId) {
        const existing = pendingNewIdByRowIdRef.current.get(ar.id)
        if (existing) {
          newId = existing
        } else {
          newId = `new-${Date.now()}-${rowNum}-${Math.random()}`
          pendingNewIdByRowIdRef.current.set(ar.id, newId)
        }
      } else {
        newId = ar.id
      }

      if (field === 'amount') {
        const numValue = (newValue === '' || newValue === null || newValue === 'null') ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
        updatedDisplayed[rowNum] = { ...ar, id: newId, [field]: numValue, updated_at: new Date().toISOString() } as AccountsReceivable
      } else if (field === 'date_of_service' || field === 'date_recorded' || field === 'type' || field === 'notes') {
        const value = toStoredString(String(newValue ?? ''))
        updatedDisplayed[rowNum] = { ...ar, id: newId, [field]: value, updated_at: new Date().toISOString() } as AccountsReceivable
      } else if (field === 'ar_id') {
        const value = (newValue === '' || newValue === 'null') ? '' : String(newValue)
        updatedDisplayed[rowNum] = { ...ar, id: newId, [field]: value, updated_at: new Date().toISOString() } as AccountsReceivable
      } else if (field) {
        const value = toStoredString(String(newValue ?? ''))
        updatedDisplayed[rowNum] = { ...ar, id: newId, [field]: value, updated_at: new Date().toISOString() } as AccountsReceivable
      }
    })

    if (updatedDisplayed.length < 200) {
      const emptyRowsNeeded = 200 - updatedDisplayed.length
      const existingEmptyCount = updatedDisplayed.filter(ar => ar.id.startsWith('empty-')).length
      updatedDisplayed.push(...Array.from({ length: emptyRowsNeeded }, (_, i) =>
        createEmptyAR(existingEmptyCount + i)
      ))
    }

    displayedARRef.current = updatedDisplayed
    setDisplayedAR(updatedDisplayed)

    const otherMonths = fullListRef.current.filter(ar => !isARInMonth(ar, selectedMonth))
    const currentMonthRows = updatedDisplayed.filter(ar => !ar.id.startsWith('placeholder-'))
    fullListRef.current = [...otherMonths, ...currentMonthRows]

    if (saveARTimeoutRef.current) clearTimeout(saveARTimeoutRef.current)
    saveARTimeoutRef.current = setTimeout(() => {
      saveARTimeoutRef.current = null
      saveAccountsReceivable(fullListRef.current).catch(err => {
        console.error('[handleARHandsontableChange] Error in saveAccountsReceivable:', err)
      })
    }, 250)

    if (hadDateColumnEdit) setStructureVersion((v) => v + 1)
  }, [displayedAR, saveAccountsReceivable, selectedMonth, isARInMonth, createEmptyAR, firstDayOfSelectedMonth, clinicId, clinicPayroll, selectedPayroll])

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
    const ar = displayedAR[row]
    if (ar) {
      setTableContextMenu({ x: event.clientX, y: event.clientY, rowIndex: row })
    }
  }, [displayedAR, canEdit])

  const handleContextMenuAddRowBelow = useCallback(() => {
    if (tableContextMenu == null) return
    const { rowIndex } = tableContextMenu
    const ar = displayedAR[rowIndex]
    if (!ar) {
      setTableContextMenu(null)
      return
    }
    const existingEmptyCount = displayedAR.filter(a => a.id.startsWith('empty-')).length
    const newRow: AccountsReceivable = { ...createEmptyAR(existingEmptyCount) }
    const updated = [...displayedAR.slice(0, rowIndex + 1), newRow, ...displayedAR.slice(rowIndex + 1)]
    const toDisplay =
      updated.length < 200
        ? [...updated, ...Array.from({ length: 200 - updated.length }, (_, i) => createEmptyAR(existingEmptyCount + 1 + i))]
        : updated
    displayedARRef.current = toDisplay
    setDisplayedAR(toDisplay)
    fullListRef.current = [
      ...fullListRef.current.filter(a => !isARInMonth(a, selectedMonth)),
      ...toDisplay.filter(a => !a.id.startsWith('empty-')),
    ]
    scrollToRowAfterUpdateRef.current = rowIndex + 1
    setStructureVersion(v => v + 1)
    setTableContextMenu(null)
    saveAccountsReceivable(fullListRef.current).catch(err =>
      console.error('saveAccountsReceivable after add row', err)
    )
  }, [tableContextMenu, displayedAR, createEmptyAR, saveAccountsReceivable, selectedMonth, isARInMonth])

  const handleContextMenuAddRowAbove = useCallback(() => {
    if (tableContextMenu == null) return
    const { rowIndex } = tableContextMenu
    const ar = displayedAR[rowIndex]
    if (!ar) {
      setTableContextMenu(null)
      return
    }
    const existingEmptyCount = displayedAR.filter(a => a.id.startsWith('empty-')).length
    const newRow: AccountsReceivable = { ...createEmptyAR(existingEmptyCount) }
    const updated = [...displayedAR.slice(0, rowIndex), newRow, ...displayedAR.slice(rowIndex)]
    const toDisplay =
      updated.length < 200
        ? [...updated, ...Array.from({ length: 200 - updated.length }, (_, i) => createEmptyAR(existingEmptyCount + 1 + i))]
        : updated
    displayedARRef.current = toDisplay
    setDisplayedAR(toDisplay)
    fullListRef.current = [
      ...fullListRef.current.filter(a => !isARInMonth(a, selectedMonth)),
      ...toDisplay.filter(a => !a.id.startsWith('empty-')),
    ]
    scrollToRowAfterUpdateRef.current = rowIndex
    setStructureVersion(v => v + 1)
    setTableContextMenu(null)
    saveAccountsReceivable(fullListRef.current).catch(err =>
      console.error('saveAccountsReceivable after add row', err)
    )
  }, [tableContextMenu, displayedAR, createEmptyAR, saveAccountsReceivable, selectedMonth, isARInMonth])

  const handleContextMenuDeleteRow = useCallback(() => {
    if (tableContextMenu == null) return
    const rowIndex = tableContextMenu.rowIndex
    const ar = displayedAR[rowIndex]
    if (!ar) {
      setTableContextMenu(null)
      return
    }
    if (ar.id.startsWith('empty-')) {
      setTableContextMenu(null)
      return
    }
    const deletedAR = { ...ar }
    if (ar.id.startsWith('new-')) {
      const updated = displayedAR.filter(a => a.id !== ar.id)
      const emptyNeeded = Math.max(0, 200 - updated.length)
      const existingEmpty = updated.filter(a => a.id.startsWith('empty-')).length
      const toDisplay = emptyNeeded > existingEmpty
        ? [...updated, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyAR(existingEmpty + i))]
        : updated
      displayedARRef.current = toDisplay
      setDisplayedAR(toDisplay)
      fullListRef.current = [
        ...fullListRef.current.filter(a => !isARInMonth(a, selectedMonth)),
        ...toDisplay.filter(a => !a.id.startsWith('empty-')),
      ]
      setStructureVersion(v => v + 1)
      saveAccountsReceivable(fullListRef.current).catch(err => console.error('saveAccountsReceivable after delete row', err))
      onRegisterUndo?.(() => {
        const next = [...displayedARRef.current.slice(0, rowIndex), deletedAR, ...displayedARRef.current.slice(rowIndex)].slice(0, 200)
        displayedARRef.current = next
        setDisplayedAR(next)
        fullListRef.current = [
          ...fullListRef.current.filter(a => !isARInMonth(a, selectedMonth)),
          ...next.filter(a => !a.id.startsWith('empty-')),
        ]
        saveAccountsReceivable(fullListRef.current).catch(e => console.error(e))
        setStructureVersion(v => v + 1)
      })
    } else {
      onRegisterUndo?.(() => {
        supabase
          .from('accounts_receivables')
          .insert(deletedAR)
          .then(() => {
            const next = [...displayedARRef.current.slice(0, rowIndex), deletedAR, ...displayedARRef.current.slice(rowIndex)].slice(0, 200)
            displayedARRef.current = next
            setDisplayedAR(next)
            fullListRef.current = [
              ...fullListRef.current.filter(a => !isARInMonth(a, selectedMonth)),
              ...next.filter(a => !a.id.startsWith('empty-')),
            ]
            setStructureVersion(v => v + 1)
          }, (err: unknown) => console.error('Undo delete AR: re-insert failed', err))
      })
      handleDeleteAR(ar.id)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, displayedAR, createEmptyAR, saveAccountsReceivable, handleDeleteAR, onRegisterUndo, selectedMonth, isARInMonth])

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
      {clinicPayroll === 2 && (
        <div className="flex items-center gap-3 mb-3">
          <label className="text-white font-medium">Payroll:</label>
          <select
            value={selectedPayroll}
            onChange={(e) => setSelectedPayroll(Number(e.target.value) as 1 | 2)}
            className="px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white"
          >
            <option value={1}>Payroll 1</option>
            <option value={2}>Payroll 2</option>
          </select>
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
            className="relative flex items-center justify-center gap-4 rounded-lg border border-slate-700"
            style={{ backgroundColor: bgColor, color: textColor, maxWidth: '40%', margin: 'auto', marginBottom: '10px' }}
          >
            <button
              onClick={() => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="absolute left-0 p-2 hover:opacity-80 rounded-lg transition-opacity"
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
              className="absolute right-0 p-2 hover:opacity-80 rounded-lg transition-opacity"
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
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`ar-${selectedMonth.getTime()}-${selectedPayroll}-${JSON.stringify(lockData)}`}
          data={getARHandsontableData()}
          dataVersion={structureVersion}
          scrollToRowAfterUpdateRef={scrollToRowAfterUpdateRef}
          columns={arColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          afterChange={handleARHandsontableChange}
          onAfterRowMove={handleARRowMove}
          onContextMenu={handleARHandsontableContextMenu}
          onCellHighlight={handleCellHighlight}
          getCellIsHighlighted={getCellIsHighlighted}
          cells={arCellsCallback}
          enableFormula={true}
          readOnly={!canEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom"
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
