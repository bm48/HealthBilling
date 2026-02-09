import { Provider, SheetRow, BillingCode, StatusColor, Patient, IsLockProviders } from '@/types'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer, createMultiBubbleDropdownRenderer, MultiSelectCptEditor, currencyCellRenderer, percentCellRenderer } from '@/lib/handsontableCustomRenderers'
import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { toDisplayValue, toDisplayDate } from '@/lib/utils'
import { computeBillingMetrics } from '@/lib/billingMetrics'

interface ProvidersTabProps {
  /** Required for loading/saving cell highlights and comments; from URL on provider side when they click a clinic */
  clinicId?: string
  providers: Provider[]
  providerSheetRows: Record<string, SheetRow[]>
  /** Bumped by parent on row reorder so grid refreshes with new order */
  providerRowsVersion?: number
  billingCodes: BillingCode[]
  statusColors: StatusColor[]
  patients: Patient[]
  selectedMonth: Date
  providerId?: string
  currentProvider: Provider | null
  canEdit: boolean
  isInSplitScreen: boolean
  /** When true, show provider columns. providerLevel 1 = columns up to Appt/Note Status; providerLevel 2 = all columns. */
  isProviderView?: boolean
  /** Provider level (1 or 2). Level 1 sees only up to Appt/Note Status; level 2 sees all columns. All providers can edit only CPT Code and Appt/Note Status. */
  providerLevel?: 1 | 2
  onUpdateProviderSheetRow: (providerId: string, rowId: string, field: string, value: any) => void
  onSaveProviderSheetRowsDirect: (providerId: string, rows: SheetRow[]) => Promise<void>
  onDeleteRow?: (providerId: string, rowId: string) => void
  onAddRowBelow?: (providerId: string, afterRowId: string) => void
  onAddRowAbove?: (providerId: string, beforeRowId: string) => void
  onPreviousMonth: () => void
  onNextMonth: () => void
  formatMonthYear: (date: Date) => string
  filterRowsByMonth: (rows: SheetRow[]) => SheetRow[]
  isLockProviders?: IsLockProviders | null
  onLockProviderColumn?: (columnName: string) => void
  isProviderColumnLocked?: (columnName: keyof IsLockProviders) => boolean
  /** Called when rows are reordered by drag. Parent should update providerSheetRows for the given provider. */
  onReorderProviderRows?: (providerId: string, movedRows: number[], finalIndex: number) => void
  /** When true (e.g. official_staff), only columns Patient ID through Date of Service are editable; rest read-only */
  restrictEditToSchedulingColumns?: boolean
  /** When true (super_admin only), show "Add comment" in cell context menu */
  canAddComment?: boolean
}

export default function ProvidersTab({
  clinicId,
  providers,
  providerSheetRows,
  providerRowsVersion,
  billingCodes,
  statusColors,
  patients,
  selectedMonth,
  providerId,
  currentProvider,
  canEdit,
  isInSplitScreen,
  isProviderView = false,
  providerLevel = 1,
  onUpdateProviderSheetRow,
  onSaveProviderSheetRowsDirect,
  onDeleteRow,
  onAddRowBelow,
  onAddRowAbove,
  onPreviousMonth,
  onNextMonth,
  formatMonthYear,
  filterRowsByMonth,
  isLockProviders,
  onLockProviderColumn,
  isProviderColumnLocked,
  onReorderProviderRows,
  restrictEditToSchedulingColumns = false,
  canAddComment = false,
}: ProvidersTabProps) {
  
  // Use isLockProviders from props directly - it will update when parent refreshes
  const lockData = isLockProviders || null
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())
  const [commentsMap, setCommentsMap] = useState<Map<string, string>>(new Map())
  const [commentModal, setCommentModal] = useState<{ row: number; col: number; rowId: string; colKey: string } | null>(null)
  const [commentText, setCommentText] = useState('')
  const [commentModalLoading, setCommentModalLoading] = useState(false)

  const providersToShow = providerId 
    ? providers.filter(p => p.id === providerId)
    : providers

  // Get rows for the first provider (or selected provider) to display in Handsontable
  const activeProvider = providersToShow.length > 0 ? providersToShow[0] : null
  const activeProviderRows = activeProvider ? filterRowsByMonth(providerSheetRows[activeProvider.id] || []) : []

  const handleProviderRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    if (!activeProvider || !onReorderProviderRows) return
    onReorderProviderRows(activeProvider.id, movedRows, finalIndex)
  }, [activeProvider, onReorderProviderRows])

  // Ref for latest table data from change handler so we don't pass stale data when parent re-renders before state updates
  const latestTableDataRef = useRef<any[][] | null>(null)

  useEffect(() => {
    latestTableDataRef.current = null
  }, [activeProvider?.id, selectedMonth.getTime()])

  // Load persisted highlights and comments for this clinic (so they survive reload and show for providers)
  useEffect(() => {
    if (!clinicId) return
    const loadHighlights = async () => {
      const { data } = await supabase
        .from('cell_highlights')
        .select('row_id, column_key')
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
      if (data) {
        setHighlightedCells(new Set(data.map((r: { row_id: string; column_key: string }) => `${r.row_id}:${r.column_key}`)))
      }
    }
    const loadComments = async () => {
      const { data } = await supabase
        .from('cell_comments')
        .select('row_id, column_key, comment')
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
      if (data) {
        setCommentsMap(new Map(data.map((r: { row_id: string; column_key: string; comment: string }) => [`${r.row_id}:${r.column_key}`, r.comment ?? ''])))
      }
    }
    loadHighlights()
    loadComments()
  }, [clinicId])

  // Color mapping functions
  const getCPTColor = useCallback((code: string): { color: string; textColor: string } | null => {
    if (!code) return null
    const primaryCode = code.split(',')[0].trim()
    const billingCode = billingCodes.find(c => c.code === primaryCode)
    if (billingCode) {
      return { color: billingCode.color, textColor: '#ffffff' }
    }
    return null
  }, [billingCodes])

  const getStatusColor = useCallback((status: string, type: 'appointment' | 'claim' | 'patient_pay' | 'month' | 'cpt_code'): { color: string; textColor: string } | null => {
    if (!status) return null
    const statusColor = statusColors.find(s => s.status === status && s.type === type)
    if (statusColor) {
      return { color: statusColor.color, textColor: statusColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  const getMonthColor = useCallback((month: string): { color: string; textColor: string } | null => {
    if (!month) return null
    const monthColor = statusColors.find(s => s.status === month && s.type === 'month')
    if (monthColor) {
      return { color: monthColor.color, textColor: monthColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  // Map rows to Handsontable 2D array format (shared by getProviderRowsHandsontableData and change handler); never show "null"
  // When isProviderView and providerLevel 2, show full columns; when providerLevel 1, show only up to Appt/Note Status
  const getTableDataFromRows = useCallback((rows: SheetRow[]) => {
    return rows.map(row => {
      const patient = patients.find(p => p.patient_id === row.patient_id)
      const patientDisplay = patient ? toDisplayValue(patient.patient_id) : toDisplayValue(row.patient_id)
      if (isProviderView && providerLevel !== 2) {
        return [
          patientDisplay,
          toDisplayValue(row.patient_first_name),
          toDisplayValue(row.last_initial),
          toDisplayValue(row.patient_insurance),
          toDisplayValue(row.patient_copay),
          toDisplayValue(row.patient_coinsurance),
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
        ]
      }
      if (isProviderView && providerLevel === 2) {
        return [
          patientDisplay,
          toDisplayValue(row.patient_first_name),
          toDisplayValue(row.last_initial),
          toDisplayValue(row.patient_insurance),
          toDisplayValue(row.patient_copay),
          toDisplayValue(row.patient_coinsurance),
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
          toDisplayValue(row.claim_status),
          toDisplayDate(row.submit_date),
          toDisplayValue(row.insurance_payment),
          toDisplayValue(row.payment_date),
          toDisplayValue(row.insurance_adjustment),
          toDisplayValue(row.collected_from_patient),
          toDisplayValue(row.patient_pay_status),
          toDisplayValue(row.ar_date),
          toDisplayValue(row.total),
          toDisplayValue(row.notes),
        ]
      }
      return [
        patientDisplay,
        toDisplayValue(row.patient_first_name),
        toDisplayValue(row.last_initial),
        toDisplayValue(row.patient_insurance),
        toDisplayValue(row.patient_copay),
        toDisplayValue(row.patient_coinsurance),
        toDisplayDate(row.appointment_date),
        toDisplayValue(row.cpt_code),
        toDisplayValue(row.appointment_status),
        toDisplayValue(row.claim_status),
        toDisplayDate(row.submit_date),
        toDisplayValue(row.insurance_payment),
        toDisplayValue(row.payment_date),
        toDisplayValue(row.insurance_adjustment),
        toDisplayValue(row.collected_from_patient),
        toDisplayValue(row.patient_pay_status),
        toDisplayValue(row.ar_date),
        toDisplayValue(row.total),
        toDisplayValue(row.notes),
      ]
    })
  }, [patients, isProviderView, providerLevel])

  // Convert rows to Handsontable data format; prefer latest from change handler to avoid stale data on re-render
  const getProviderRowsHandsontableData = useCallback(() => {
    if (!activeProvider) return []
    if (latestTableDataRef.current != null) return latestTableDataRef.current
    return getTableDataFromRows(activeProviderRows)
  }, [activeProvider, activeProviderRows, getTableDataFromRows])

  // Sum of Ins Pay, Collected from PT, Total (computed from current rows; not stored in DB)
  const providerSums = useMemo(() => {
    if (isProviderView) return { insPay: 0, collectedFromPt: 0, total: 0 }
    const parse = (v: unknown): number => {
      if (v == null || v === '' || v === 'null') return 0
      const n = typeof v === 'number' ? v : parseFloat(String(v))
      return Number.isNaN(n) ? 0 : n
    }
    let insPay = 0
    let collectedFromPt = 0
    let total = 0
    activeProviderRows.forEach((row) => {
      insPay += parse(row.insurance_payment)
      collectedFromPt += parse(row.collected_from_patient)
      total += parse(row.total)
    })
    return { insPay, collectedFromPt, total }
  }, [activeProviderRows, isProviderView])

  // Billing metrics (visits, no shows, paid claims, etc.) for the selected month – admin/billing only
  const billingMetrics = useMemo(() => {
    if (isProviderView) return null
    return computeBillingMetrics(activeProviderRows)
  }, [activeProviderRows, isProviderView])

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  // Column field names mapping to is_lock_providers table columns
  const columnFieldsFull: Array<keyof IsLockProviders> = [
    'patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance',
    'date_of_service', 'cpt_code', 'appointment_note_status', 'claim_status',
    'most_recent_submit_date', 'ins_pay', 'ins_pay_date', 'pt_res', 'collected_from_pt',
    'pt_pay_status', 'pt_payment_ar_ref_date', 'total', 'notes'
  ]
  const columnTitlesFull = [
    'Patient ID', 'First Name', 'Last Initial', 'Insurance', 'Co-pay', 'Co-Ins',
    'Date of Service', 'CPT Code', 'Appt/Note Status', 'Claim Status', 'Most Recent Submit Date',
    'Ins Pay', 'Ins Pay Date', 'PT RES', 'Collected from PT', 'PT Pay Status',
    'PT Payment AR Ref Date', 'Total', 'Notes'
  ]
  const columnFieldsProviderView = ['patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance', 'date_of_service', 'cpt_code', 'appointment_note_status'] as const
  const columnTitlesProviderView = ['Patient ID', 'First Name', 'Last Initial', 'Insurance', 'Co-pay', 'Co-Ins', 'Date of Service', 'CPT Code', 'Appt/Note Status']
  const columnFields = isProviderView
    ? (providerLevel === 2 ? columnFieldsFull : columnFieldsProviderView)
    : columnFieldsFull
  const columnTitles = isProviderView
    ? (providerLevel === 2 ? columnTitlesFull : columnTitlesProviderView)
    : columnTitlesFull
  /** In provider view, only CPT Code (7) and Appt/Note Status (8) are editable */
  const isProviderEditableColumn = (dataIndex: number) => dataIndex === 7 || dataIndex === 8
  const getReadOnlyProviderView = (dataIndex: number) => !canEdit || !isProviderEditableColumn(dataIndex)

  const getReadOnly = (columnName: keyof IsLockProviders): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  /** For official_staff: only columns 0-6 (Patient ID through Date of Service) are editable */
  const isSchedulingColumn = (dataIndex: number) => dataIndex <= 6
  const getReadOnlyForColumn = (dataIndex: number, baseReadOnly: boolean) =>
    baseReadOnly || (restrictEditToSchedulingColumns && !isSchedulingColumn(dataIndex))

  // Right-click on column headers to lock/unlock (no lock icon in header)
  useEffect(() => {
    if (isProviderView || !canEdit || !onLockProviderColumn || !isProviderColumnLocked) return

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
      const isLocked = isProviderColumnLocked ? isProviderColumnLocked(columnName as keyof IsLockProviders) : false
      const menu = document.createElement('div')
      menu.className = 'provider-col-header-context-menu'
      menu.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.4);padding:4px 0;min-width:140px;'
      const item = document.createElement('div')
      item.style.cssText = 'padding:6px 12px;cursor:pointer;white-space:nowrap;font-size:13px;'
      item.textContent = isLocked ? 'Unlock column' : 'Lock column'
      item.onclick = () => {
        onLockProviderColumn(columnName)
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
        let cellText = th.textContent?.trim() || th.innerText?.trim() || ''
        const existingWrapper = th.querySelector('div')
        if (existingWrapper) {
          const titleSpan = existingWrapper.querySelector('span')
          if (titleSpan) cellText = titleSpan.textContent?.trim() || cellText
        }
        cellText = cellText.replace(/🔒|🔓/g, '').trim()
        const columnIndex = columnTitles.findIndex(title => {
          const a = title.toLowerCase().trim()
          const b = cellText.toLowerCase().trim()
          return a === b || b.includes(a) || a.includes(b)
        })
        if (columnIndex === -1 || columnIndex >= columnFields.length) return
        const columnName = columnFields[columnIndex]
        const el = th as HTMLElement
        const prev = (el as any)._providerHeaderContext
        if (prev) {
          el.removeEventListener('contextmenu', prev)
        }
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._providerHeaderContext = handler
        el.addEventListener('contextmenu', handler)
      })
    }

    const attachAll = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      const table = document.querySelector('.providers-handsontable table.htCore')
      if (table) attachContextMenuToHeader(table.querySelector('thead tr'))
      const cloneTop = document.querySelector('.providers-handsontable .ht_clone_top table.htCore')
      if (cloneTop) attachContextMenuToHeader(cloneTop.querySelector('thead tr'))
    }

    const debouncedAttach = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(attachAll, 200)
    }

    timeoutId = setTimeout(attachAll, 300)
    const observer = new MutationObserver(() => debouncedAttach())
    const tableContainer = document.querySelector('.providers-handsontable')
    if (tableContainer) observer.observe(tableContainer, { childList: true, subtree: true })

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      observer.disconnect()
      hideMenu()
      document.querySelectorAll('.providers-handsontable th').forEach((th) => {
        const h = (th as any)._providerHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
    }
  }, [isProviderView, canEdit, onLockProviderColumn, isProviderColumnLocked, columnFields, columnTitles, isLockProviders])

  const providerCellsCallback = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      const classes = [
        highlightedCells.has(key) ? 'cell-highlight-yellow' : '',
        commentsMap.has(key) ? 'cell-has-comment' : '',
      ].filter(Boolean).join(' ')
      return classes ? { className: classes } : {}
    },
    [activeProviderRows, columnFields, highlightedCells, commentsMap]
  )

  // Tooltip for cells with comments (e.g. on provider side when hovering)
  const getCellTitle = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
      if (!colKey) return undefined
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      return commentsMap.get(key) ?? undefined
    },
    [activeProviderRows, columnFields, commentsMap]
  )

  const getCellHasComment = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      return commentsMap.has(key)
    },
    [activeProviderRows, columnFields, commentsMap]
  )

  const handleCellRemoveComment = useCallback(
    async (row: number, col: number) => {
      if (!clinicId) return
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
      if (!colKey) return
      const rowId = sheetRow?.id ?? `row-${row}`
      const key = `${rowId}:${colKey}`
      await supabase
        .from('cell_comments')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
        .eq('row_id', rowId)
        .eq('column_key', colKey)
      setCommentsMap((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
    },
    [activeProviderRows, columnFields, clinicId]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [activeProviderRows, columnFields, highlightedCells]
  )

  const handleCellHighlight = useCallback(async (row: number, col: number) => {
    if (!clinicId) return
    const sheetRow = activeProviderRows[row]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
    const isHighlighted = highlightedCells.has(key)
    if (isHighlighted) {
      await supabase
        .from('cell_highlights')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
        .eq('row_id', sheetRow?.id ?? `row-${row}`)
        .eq('column_key', colKey)
      setHighlightedCells((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    } else {
      await supabase.from('cell_highlights').upsert(
        {
          clinic_id: clinicId,
          sheet_type: 'providers',
          row_id: sheetRow?.id ?? `row-${row}`,
          column_key: colKey,
        },
        { onConflict: 'clinic_id,sheet_type,row_id,column_key' }
      )
      setHighlightedCells((prev) => new Set(prev).add(key))
    }
  }, [activeProviderRows, columnFields, clinicId, highlightedCells])

  const handleCellAddComment = useCallback((row: number, col: number) => {
    if (!clinicId) return
    const sheetRow = activeProviderRows[row]
    const colKey = columnFields[col]
    if (!colKey) return
    const rowId = sheetRow?.id ?? `row-${row}`
    const key = `${rowId}:${colKey}`
    const existing = commentsMap.get(key)
    if (existing !== undefined) {
      setCommentText(existing)
      setCommentModalLoading(false)
    } else {
      setCommentText('')
      setCommentModalLoading(true)
      supabase
        .from('cell_comments')
        .select('comment')
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
        .eq('row_id', rowId)
        .eq('column_key', colKey)
        .maybeSingle()
        .then(({ data }) => {
          setCommentModalLoading(false)
          if (data?.comment != null) setCommentText(data.comment)
        })
    }
    setCommentModal({ row, col, rowId, colKey })
  }, [activeProviderRows, columnFields, commentsMap, clinicId])

  const handleSaveComment = useCallback(async () => {
    if (!commentModal || !clinicId) return
    const key = `${commentModal.rowId}:${commentModal.colKey}`
    await supabase.from('cell_comments').upsert(
      {
        clinic_id: clinicId,
        sheet_type: 'providers',
        row_id: commentModal.rowId,
        column_key: commentModal.colKey,
        comment: commentText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,sheet_type,row_id,column_key' }
    )
    setCommentsMap((prev) => new Map(prev).set(key, commentText))
    setCommentModal(null)
    setCommentText('')
  }, [commentModal, clinicId, commentText])

  // Update columns with readOnly based on lock state
  const providerColumnsWithLocks = useMemo(() => {
    if (!activeProvider) return []
    
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    
    if (isProviderView && providerLevel !== 2) {
      return [
        { data: 0, title: 'Patient ID', type: 'text' as const, width: 180, readOnly: getReadOnlyProviderView(0) },
        { data: 1, title: 'First Name', type: 'text' as const, width: 120, readOnly: getReadOnlyProviderView(1) },
        { data: 2, title: 'Last Initial', type: 'text' as const, width: 80, readOnly: getReadOnlyProviderView(2) },
        { data: 3, title: 'Insurance', type: 'text' as const, width: 120, readOnly: getReadOnlyProviderView(3) },
        { data: 4, title: 'Co-pay', type: 'numeric' as const, width: 80, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(4) },
        { data: 5, title: 'Co-Ins', type: 'numeric' as const, width: 80, renderer: percentCellRenderer, readOnly: getReadOnlyProviderView(5) },
        { data: 6, title: 'Date of Service', type: 'date' as const, width: 120, format: 'YYYY-MM-DD', readOnly: getReadOnlyProviderView(6) },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, readOnly: getReadOnlyProviderView(7) },
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 180, selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, readOnly: getReadOnlyProviderView(8) },
      ]
    }
    if (isProviderView && providerLevel === 2) {
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      return [
        { data: 0, title: 'Patient ID', type: 'text' as const, width: 100, readOnly: getReadOnlyProviderView(0) },
        { data: 1, title: 'First Name', type: 'text' as const, width: 120, readOnly: getReadOnlyProviderView(1) },
        { data: 2, title: 'Last Initial', type: 'text' as const, width: 40, readOnly: getReadOnlyProviderView(2) },
        { data: 3, title: 'Insurance', type: 'text' as const, width: 120, readOnly: getReadOnlyProviderView(3) },
        { data: 4, title: 'Co-pay', type: 'numeric' as const, width: 80, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(4) },
        { data: 5, title: 'Co-Ins', type: 'numeric' as const, width: 80, renderer: percentCellRenderer, readOnly: getReadOnlyProviderView(5) },
        { data: 6, title: 'Date of Service', type: 'date' as const, width: 120, format: 'YYYY-MM-DD', readOnly: getReadOnlyProviderView(6) },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, readOnly: getReadOnlyProviderView(7) },
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 150, selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, readOnly: getReadOnlyProviderView(8) },
        { data: 9, title: 'Claim Status', type: 'dropdown' as const, width: 120, selectOptions: ['Claim Sent', 'RS', 'IP', 'Pending Pay', 'Paid', 'Deductible', 'N/A', 'PP', 'Denial', 'Rejected', 'No Coverage'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'claim')) as any, readOnly: getReadOnlyProviderView(9) },
        { data: 10, title: 'Most Recent Submit Date', type: 'text' as const, width: 120, readOnly: getReadOnlyProviderView(10) },
        { data: 11, title: 'Ins Pay', type: 'numeric' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(11) },
        { data: 12, title: 'Ins Pay Date', type: 'dropdown' as const, width: 100, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, readOnly: getReadOnlyProviderView(12) },
        { data: 13, title: 'PT RES', type: 'text' as const, width: 100, readOnly: getReadOnlyProviderView(13) },
        { data: 14, title: 'Collected from PT', type: 'numeric' as const, width: 120, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(14) },
        { data: 15, title: 'PT Pay Status', type: 'dropdown' as const, width: 120, selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any, readOnly: getReadOnlyProviderView(15) },
        { data: 16, title: 'PT Payment AR Ref Date', type: 'dropdown' as const, width: 120, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, readOnly: getReadOnlyProviderView(16) },
        { data: 17, title: 'Total', type: 'numeric' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(17) },
        { data: 18, title: 'Notes', type: 'text' as const, width: 150, readOnly: getReadOnlyProviderView(18) },
      ]
    }
    
    return [
      { 
        data: 0, 
        title: 'Patient ID', 
        type: 'text' as const, 
        width: 100,
        readOnly: getReadOnlyForColumn(0, !canEdit || getReadOnly('patient_id'))
      },
      { 
        data: 1, 
        title: 'First Name', 
        type: 'text' as const, 
        width: 120,
        readOnly: getReadOnlyForColumn(1, !canEdit || getReadOnly('first_name'))
      },
      { 
        data: 2, 
        title: 'Last Initial', 
        type: 'text' as const, 
        width: 40,
        readOnly: getReadOnlyForColumn(2, !canEdit || getReadOnly('last_initial'))
      },
      { 
        data: 3, 
        title: 'Insurance', 
        type: 'text' as const, 
        width: 120,
        readOnly: getReadOnlyForColumn(3, !canEdit || getReadOnly('insurance'))
      },
      { 
        data: 4, 
        title: 'Co-pay', 
        type: 'numeric' as const, 
        width: 80,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(4, !canEdit || getReadOnly('copay'))
      },
      { 
        data: 5, 
        title: 'Co-Ins', 
        type: 'numeric' as const, 
        width: 80,
        renderer: percentCellRenderer,
        readOnly: getReadOnlyForColumn(5, !canEdit || getReadOnly('coinsurance'))
      },
      { 
        data: 6, 
        title: 'Date of Service', 
        type: 'date' as const, 
        width: 120, 
        format: 'YYYY-MM-DD',
        readOnly: getReadOnlyForColumn(6, !canEdit || getReadOnly('date_of_service'))
      },
      { 
        data: 7, 
        title: 'CPT Code', 
        type: 'dropdown' as const, 
        width: 160,
        editor: MultiSelectCptEditor,
        selectOptions: billingCodes.map(c => c.code),
        renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any,
        readOnly: getReadOnlyForColumn(7, !canEdit || getReadOnly('cpt_code'))
      },
      { 
        data: 8, 
        title: 'Appt/Note Status', 
        type: 'dropdown' as const, 
        width: 150,
        selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any,
        readOnly: getReadOnlyForColumn(8, !canEdit || getReadOnly('appointment_note_status'))
      },
      { 
        data: 9, 
        title: 'Claim Status', 
        type: 'dropdown' as const, 
        width: 120,
        selectOptions: ['Claim Sent', 'RS', 'IP', 'Pending Pay', 'Paid', 'Deductible', 'N/A', 'PP', 'Denial', 'Rejected', 'No Coverage'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'claim')) as any,
        readOnly: getReadOnlyForColumn(9, !canEdit || getReadOnly('claim_status'))
      },
      { 
        data: 10, 
        title: 'Most Recent Submit Date', 
        type: 'text' as const, 
        width: 120,
        readOnly: getReadOnlyForColumn(10, !canEdit || getReadOnly('most_recent_submit_date'))
      },
      { 
        data: 11, 
        title: 'Ins Pay', 
        type: 'numeric' as const, 
        width: 100,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(11, !canEdit || getReadOnly('ins_pay'))
      },
      { 
        data: 12, 
        title: 'Ins Pay Date', 
        type: 'dropdown' as const, 
        width: 100,
        selectOptions: months,
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any,
        readOnly: getReadOnlyForColumn(12, !canEdit || getReadOnly('ins_pay_date'))
      },
      { 
        data: 13, 
        title: 'PT RES', 
        type: 'text' as const, 
        width: 100,
        readOnly: getReadOnlyForColumn(13, !canEdit || getReadOnly('pt_res'))
      },
      { 
        data: 14, 
        title: 'Collected from PT', 
        type: 'numeric' as const, 
        width: 120,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(14, !canEdit || getReadOnly('collected_from_pt'))
      },
      { 
        data: 15, 
        title: 'PT Pay Status', 
        type: 'dropdown' as const, 
        width: 120,
        selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any,
        readOnly: getReadOnlyForColumn(15, !canEdit || getReadOnly('pt_pay_status'))
      },
      { 
        data: 16, 
        title: 'PT Payment AR Ref Date', 
        type: 'dropdown' as const, 
        width: 120,
        selectOptions: months,
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any,
        readOnly: getReadOnlyForColumn(16, !canEdit || getReadOnly('pt_payment_ar_ref_date'))
      },
      { 
        data: 17, 
        title: 'Total', 
        type: 'numeric' as const, 
        width: 100,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(17, !canEdit || getReadOnly('total'))
      },
      { 
        data: 18, 
        title: 'Notes', 
        type: 'text' as const, 
        width: 150,
        readOnly: getReadOnlyForColumn(18, !canEdit || getReadOnly('notes'))
      },
    ]
  }, [activeProvider, billingCodes, statusColors, getCPTColor, getStatusColor, getMonthColor, patients, canEdit, lockData, getReadOnly, isProviderView, providerLevel, restrictEditToSchedulingColumns])

  const handleProviderRowsHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData' || !activeProvider) return
    
    // Column index -> SheetRow field
    const fieldsFull: Array<keyof SheetRow> = [
      'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
      'appointment_date', 'cpt_code', 'appointment_status', 'claim_status', 'submit_date', 'insurance_payment',
      'payment_date', 'insurance_adjustment', 'collected_from_patient', 'patient_pay_status', 'ar_date', 'total', 'notes'
    ]
    const fieldsProviderView: Array<keyof SheetRow> = [
      'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
      'appointment_date', 'cpt_code', 'appointment_status'
    ]
    const fields: Array<keyof SheetRow> = isProviderView ? (providerLevel === 2 ? fieldsFull : fieldsProviderView) : fieldsFull
    
    const dateFields: (keyof SheetRow)[] = ['appointment_date', 'submit_date', 'payment_date', 'ar_date']
    // Compute all changes locally first
    const updatedRows = [...activeProviderRows]
    let idCounter = 0
    let hadPatientIdMerge = false
    let hadDateColumnEdit = false

    changes.forEach(([row, col, , newValue]) => {
      // Ensure we have enough rows
      while (updatedRows.length <= row) {
        const createEmptyRow = (index: number): SheetRow => ({
          id: `empty-${activeProvider.id}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
          last_initial: null,
          patient_insurance: null,
          patient_copay: null,
          patient_coinsurance: null,
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          appointment_status_color: null,
          claim_status: null,
          claim_status_color: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          patient_pay_status_color: null,
          payment_date: null,
          payment_date_color: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_date_color: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
          total: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
        updatedRows.push(createEmptyRow(existingEmptyCount))
      }
      
      const sheetRow = updatedRows[row]
      if (sheetRow) {
        const field = fields[col as number]
        
        // Generate unique ID for empty rows
        const needsNewId = sheetRow.id.startsWith('empty-')
        const newId = needsNewId ? `new-${Date.now()}-${idCounter++}-${Math.random()}` : sheetRow.id
        
        if (field === 'patient_id') {
          // Extract patient_id from dropdown value (format: "patient_id - first_name last_name") or raw input
          const raw = String(newValue ?? '').trim()
          const patientIdOrNull = raw ? (raw.split(' - ')[0]?.trim() || raw) : null
          // Look up patient from patient database (case-insensitive, trimmed) and fill row
          const patient = patientIdOrNull
            ? patients.find(p => String(p.patient_id ?? '').trim().toLowerCase() === patientIdOrNull.trim().toLowerCase())
            : null
          const merged: Partial<SheetRow> = {
            ...sheetRow,
            id: newId,
            patient_id: patientIdOrNull,
            updated_at: new Date().toISOString(),
          }
          if (patient) {
            hadPatientIdMerge = true
            merged.patient_first_name = patient.first_name || null
            merged.last_initial = patient.last_name ? patient.last_name.charAt(0) : null
            merged.patient_insurance = patient.insurance || null
            merged.patient_copay = patient.copay ?? null
            merged.patient_coinsurance = patient.coinsurance ?? null
          }
          updatedRows[row] = merged as SheetRow
        } else if (field === 'patient_copay' || field === 'patient_coinsurance' || field === 'total') {
          const numValue = (newValue === '' || newValue === null || newValue === 'null') ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: numValue, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'appointment_date') {
          hadDateColumnEdit = true
          const value = (newValue === '' || newValue === 'null') ? null : String(newValue)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
        } else if (field) {
          if (dateFields.includes(field)) hadDateColumnEdit = true
          const value = (newValue === '' || newValue === 'null') ? null : String(newValue)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
        }
      }
    })
    
    // Only pad to 200 when under 200 (allow more than 200 rows)
    if (updatedRows.length < 200) {
      const emptyRowsNeeded = 200 - updatedRows.length
      const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
      const createEmptyRow = (index: number): SheetRow => ({
        id: `empty-${activeProvider.id}-${index}`,
        patient_id: null,
        patient_first_name: null,
        patient_last_name: null,
        last_initial: null,
        patient_insurance: null,
        patient_copay: null,
        patient_coinsurance: null,
        appointment_date: null,
        appointment_time: null,
        visit_type: null,
        notes: null,
        billing_code: null,
        billing_code_color: null,
        appointment_status: null,
        appointment_status_color: null,
        claim_status: null,
        claim_status_color: null,
        submit_date: null,
        insurance_payment: null,
        insurance_adjustment: null,
        invoice_amount: null,
        collected_from_patient: null,
        patient_pay_status: null,
        patient_pay_status_color: null,
        payment_date: null,
        payment_date_color: null,
        ar_type: null,
        ar_amount: null,
        ar_date: null,
        ar_date_color: null,
        ar_notes: null,
        provider_payment_amount: null,
        provider_payment_date: null,
        provider_payment_notes: null,
        highlight_color: null,
        total: null,
        cpt_code: null,
        cpt_code_color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
        createEmptyRow(existingEmptyCount + i)
      )
      updatedRows.push(...newEmptyRows)
    }

    // Store latest table data so next render passes fresh data even if parent state hasn't updated yet
    latestTableDataRef.current = getTableDataFromRows(updatedRows)
    
    // Apply all changes to parent state
    updatedRows.forEach((row, index) => {
      const originalRow = activeProviderRows[index]
      if (originalRow) {
        // Update each changed field
        const fieldsToCheck: Array<keyof SheetRow> = [
          'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
          'appointment_date', 'cpt_code', 'appointment_status', 'claim_status', 'submit_date', 'insurance_payment',
          'payment_date', 'insurance_adjustment', 'collected_from_patient', 'patient_pay_status', 'ar_date', 'total', 'notes'
        ]
        
        fieldsToCheck.forEach(field => {
          if (row[field] !== originalRow[field]) {
            if (field === 'patient_id') {
              onUpdateProviderSheetRow(activeProvider.id, originalRow.id, field, row[field] as string | null)
            } else if (field === 'patient_copay' || field === 'patient_coinsurance' || field === 'total') {
              onUpdateProviderSheetRow(activeProvider.id, originalRow.id, field, row[field] as number | null)
            } else if (field === 'appointment_date') {
              onUpdateProviderSheetRow(activeProvider.id, originalRow.id, field, row[field] as string | null)
            } else {
              onUpdateProviderSheetRow(activeProvider.id, originalRow.id, field, row[field] as any)
            }
          }
        })
        
        // Handle ID change (empty- to new-)
        if (row.id !== originalRow.id && row.id.startsWith('new-')) {
          // The parent's handleUpdateProviderSheetRow already handles this when we update any field
        }
      } else if (!originalRow && row) {
        // New row - update all non-null fields
        const fieldsToUpdate: Array<keyof SheetRow> = [
          'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
          'appointment_date', 'cpt_code', 'appointment_status', 'claim_status', 'submit_date', 'insurance_payment',
          'payment_date', 'insurance_adjustment', 'collected_from_patient', 'patient_pay_status', 'ar_date', 'total', 'notes'
        ]
        
        fieldsToUpdate.forEach(field => {
          if (row[field] !== null && row[field] !== '') {
            if (field === 'patient_id') {
              onUpdateProviderSheetRow(activeProvider.id, row.id, field, row[field] as string | null)
            } else if (field === 'patient_copay' || field === 'patient_coinsurance' || field === 'total') {
              onUpdateProviderSheetRow(activeProvider.id, row.id, field, row[field] as number | null)
            } else if (field === 'appointment_date') {
              onUpdateProviderSheetRow(activeProvider.id, row.id, field, row[field] as string | null)
    } else {
              onUpdateProviderSheetRow(activeProvider.id, row.id, field, row[field] as any)
            }
          }
        })
      }
    })
    
    // Save with updated data directly - don't wait for state to update
    setTimeout(() => {
      onSaveProviderSheetRowsDirect(activeProvider.id, updatedRows).catch(err => {
        console.error('[handleProviderRowsHandsontableChange] Error in saveProviderSheetRowsDirect:', err)
      })
    }, 0)

    // When patient_id was merged or a date column was edited, bump so HandsontableWrapper pushes
    // the ref data to the grid (wrapper only updates on dataVersion/length change). This makes
    // date cells show MM-DD-YY immediately instead of YYYY-MM-DD until reload.
    if (hadPatientIdMerge || hadDateColumnEdit) {
      setStructureVersion((v) => v + 1)
    }
  }, [activeProvider, activeProviderRows, onUpdateProviderSheetRow, onSaveProviderSheetRowsDirect, isProviderView, providerLevel, patients, getTableDataFromRows])

  const handleDeleteProviderSheetRow = useCallback((providerId: string, rowId: string) => {
    if (onDeleteRow) onDeleteRow(providerId, rowId)
  }, [onDeleteRow])

  const [tableContextMenu, setTableContextMenu] = useState<{ x: number; y: number; rowIndex: number } | null>(null)
  const tableContextMenuRef = useRef<HTMLDivElement>(null)
  const [structureVersion, setStructureVersion] = useState(0)

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

  const handleProviderRowsHandsontableContextMenu = useCallback((row: number, _col: number, event: MouseEvent) => {
    event.preventDefault()
    if (isProviderView || !canEdit || !activeProvider) return
    const sheetRow = activeProviderRows[row]
    if (sheetRow) {
      setTableContextMenu({ x: event.clientX, y: event.clientY, rowIndex: row })
    }
  }, [activeProvider, activeProviderRows, canEdit, isProviderView])

  const handleContextMenuAddRowBelow = useCallback(() => {
    if (tableContextMenu == null || !activeProvider || !onAddRowBelow) return
    const sheetRow = activeProviderRows[tableContextMenu.rowIndex]
    if (sheetRow) {
      onAddRowBelow(activeProvider.id, sheetRow.id)
      setStructureVersion(v => v + 1)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, activeProvider, activeProviderRows, onAddRowBelow])

  const handleContextMenuAddRowAbove = useCallback(() => {
    if (tableContextMenu == null || !activeProvider || !onAddRowAbove) return
    const sheetRow = activeProviderRows[tableContextMenu.rowIndex]
    if (sheetRow) {
      onAddRowAbove(activeProvider.id, sheetRow.id)
      setStructureVersion(v => v + 1)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, activeProvider, activeProviderRows, onAddRowAbove])

  const handleContextMenuDeleteRow = useCallback(() => {
    if (tableContextMenu == null || !activeProvider || !onDeleteRow) return
    const sheetRow = activeProviderRows[tableContextMenu.rowIndex]
    if (sheetRow) {
      handleDeleteProviderSheetRow(activeProvider.id, sheetRow.id)
      setStructureVersion(v => v + 1)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, activeProvider, activeProviderRows, onDeleteRow, handleDeleteProviderSheetRow])

  // Apply custom header colors after table renders
  const hotTableRef = useRef<any>(null)
  useEffect(() => {
    if (hotTableRef.current?.hotInstance) {
      const hotInstance = hotTableRef.current.hotInstance
      const headerColors = isProviderView
        ? ['#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#fce5cd', '#fce5cd', '#ead1dd'] // Patient info (pink), Date/CPT (orange/beige), Appt/Note Status (purple/pink)
        : [
            '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', // Patient info columns
            '#fce5cd', '#fce5cd', // CPT and Appointment status
            '#ead1dd', '#ead1dd', // Claim status columns
            '#d9d2e9', '#d9d2e9', '#d9d2e9', // Insurance payment columns
            '#b191cd', '#b191cd', '#b191cd', // Patient payment columns
            '#d9d2e9', // Total
            '#5d9f5d' // Notes
          ]
      
      // Apply header colors
      setTimeout(() => {
        const headerCells = hotInstance.rootElement.querySelectorAll('.ht_clone_top th, table.htCore thead th')
        headerCells.forEach((th: HTMLElement, index: number) => {
          if (headerColors[index]) {
            th.style.backgroundColor = headerColors[index]
            th.style.color = '#000000'
          }
        })
      }, 100)
    }
  }, [activeProvider, providerColumnsWithLocks, isProviderView])

  if (providersToShow.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center text-white/70 py-8">
          {providerId ? 'Provider not found' : 'No providers found for this clinic'}
        </div>
      </div>
    )
  }

  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(isInSplitScreen ? 400 : 600)
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

  return (
    <div 
      className="p-6" 
      style={isInSplitScreen ? { width: '100%', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}
    >
      {providerId && currentProvider && !isInSplitScreen && (
        <div className="mb-2 pb-4 border-b border-white/20">
          <h2 className="text-xl font-semibold text-white">
            {currentProvider.first_name} {currentProvider.last_name}
            {currentProvider.specialty && (
              <span className="text-white/70 text-sm font-normal ml-2">({currentProvider.specialty})</span>
            )}
          </h2>
        </div>
      )}
      {/* month selector - background color from status_colors (month type), like Ins Pay Date column */}
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
              onClick={onPreviousMonth}
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
              onClick={onNextMonth}
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
          maxHeight: isInSplitScreen ? undefined : '600px',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflowX: 'auto', 
          overflowY: 'auto',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '100%',
          backgroundColor: '#d2dbe5'
        }}
      >
        {activeProvider && (
          <HandsontableWrapper
            key={`providers-${activeProvider?.id ?? ''}-${selectedMonth.getTime()}`}
            data={getProviderRowsHandsontableData()}
            dataVersion={(providerRowsVersion ?? 0) + structureVersion}
            columns={providerColumnsWithLocks}
            colHeaders={columnTitles}
            rowHeaders={true}
            width="100%"
            height={isInSplitScreen ? tableHeight : 600}
            afterChange={handleProviderRowsHandsontableChange}
            onAfterRowMove={handleProviderRowMove}
            onContextMenu={handleProviderRowsHandsontableContextMenu}
            onCellHighlight={handleCellHighlight}
            getCellIsHighlighted={getCellIsHighlighted}
            onCellAddComment={canAddComment ? handleCellAddComment : undefined}
            onCellRemoveComment={canAddComment ? handleCellRemoveComment : undefined}
            getCellHasComment={canAddComment ? getCellHasComment : undefined}
            getCellTitle={getCellTitle}
            cells={providerCellsCallback}
            enableFormula={true}
            readOnly={!canEdit}
            style={{ backgroundColor: '#d2dbe5' }}
            className="handsontable-custom providers-handsontable"
          />
        )}
      </div>

      {activeProvider && !isProviderView && (
        <div
          className="mt-3 flex flex-col gap-2 px-4 py-3 rounded-lg border border-white/20 bg-slate-800/80 text-white"
          style={{ width: '100%', maxWidth: '100%' }}
        >
          <div className="flex items-center gap-6 flex-wrap">
            <span className="font-medium text-red-500">Sums:</span>
            <span className="ml-2"><strong>Ins Pay:</strong> {formatCurrency(providerSums.insPay)}</span>
            <span className="ml-2"><strong>Collected from PT:</strong> {formatCurrency(providerSums.collectedFromPt)}</span>
            <span className="ml-2"><strong>Total:</strong> {formatCurrency(providerSums.total)}</span>
          </div>
          {billingMetrics && (
            <div className="flex items-center gap-4 flex-wrap text-sm border-t border-white/20 pt-2">
              <span className="font-medium text-red-500/90">Metrics:</span>
              <span>Visits: <strong>{billingMetrics.visits}</strong></span>
              <span>No Shows: <strong>{billingMetrics.noShows}</strong></span>
              <span>Paid claims: <strong>{billingMetrics.paidClaims}</strong></span>
              <span>Private Pay: <strong>{billingMetrics.privatePay}</strong></span>
              <span>Secondary: <strong>{billingMetrics.secondary}</strong></span>
              <span>CC Declines: <strong>{billingMetrics.ccDeclines}</strong></span>
            </div>
          )}
        </div>
      )}

      {commentModal != null && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-slate-800/95 backdrop-blur-md rounded-lg p-6 w-full max-w-md border border-white/20">
            <h2 className="text-xl font-bold text-white mb-2">Add comment for provider</h2>
            <p className="text-sm text-white/70 mb-4">Cell: row {commentModal.row + 1}, column &quot;{commentModal.colKey}&quot;</p>
            {commentModalLoading ? (
              <p className="text-white/80">Loading...</p>
            ) : (
              <>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Enter your comment..."
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 text-white rounded-md placeholder-white/50 min-h-[100px]"
                  rows={4}
                  autoFocus
                />
                <div className="mt-4 flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => { setCommentModal(null); setCommentText('') }}
                    className="px-4 py-2 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-md"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveComment()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

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
