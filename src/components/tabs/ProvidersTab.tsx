import { Provider, SheetRow, BillingCode, StatusColor, Patient, IsLockProviders } from '@/types'
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer, createMultiBubbleDropdownRenderer, MultiSelectCptEditor, DateOfServiceEditor, currencyCellRenderer, copayTextCellRenderer, coinsuranceTextCellRenderer } from '@/lib/handsontableCustomRenderers'
import { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toDisplayValue, toDisplayDate, parseDateOfServiceInput } from '@/lib/utils'
import { computeBillingMetrics } from '@/lib/billingMetrics'

interface ProvidersTabProps {
  /** Required for loading/saving cell highlights and comments; from URL on provider side when they click a clinic */
  clinicId?: string
  /** 1 = default (12 month options); 2 = two pay periods per month (24 options: 1st/2nd January, ...) */
  clinicPayroll?: 1 | 2
  providers: Provider[]
  providerSheetRows: Record<string, SheetRow[]>
  /** Bumped by parent on row reorder so grid refreshes with new order */
  providerRowsVersion?: number
  billingCodes: BillingCode[]
  statusColors: StatusColor[]
  patients: Patient[]
  selectedMonth: Date
  /** When clinicPayroll=2, which half (1 or 2) is selected; used for label "January 1st Half". */
  selectedPayroll?: 1 | 2
  /** Same key parent uses for providerSheetRowsByMonth (e.g. "2025-3" or "2025-3-1"); used to backup pending rows on unload so refresh doesn't lose data. */
  selectedMonthKey?: string
  providerId?: string
  /** Current provider (for context); optional, passed by ClinicDetail and ProviderSheetPage */
  currentProvider?: Provider | null
  canEdit: boolean
  isInSplitScreen: boolean
  /** When true, show provider columns. providerLevel 1 = columns up to Appt/Note Status; providerLevel 2 = all columns. */
  isProviderView?: boolean
  /** Provider level (1 or 2). Level 1 (partial) sees columns up to Appt/Note Status; level 2 (full access) sees all columns. Both can edit only Date of Service, CPT Code, Appt/Note Status. */
  providerLevel?: 1 | 2
  onUpdateProviderSheetRow: (providerId: string, rowId: string, field: string, value: any) => void
  onSaveProviderSheetRowsDirect: (providerId: string, rows: SheetRow[]) => Promise<void>
  onDeleteRow?: (providerId: string, rowId: string) => void
  onAddRowBelow?: (providerId: string, afterRowId: string) => void
  onAddRowAbove?: (providerId: string, beforeRowId: string) => void
  onPreviousMonth: () => void
  onNextMonth: () => void
  /** When clinicPayroll=2, second arg shows "January 1st Half" / "January 2nd Half". */
  formatMonthYear: (date: Date, payroll?: 1 | 2) => string
  filterRowsByMonth: (rows: SheetRow[]) => SheetRow[]
  isLockProviders?: IsLockProviders | null
  onLockProviderColumn?: (columnName: string) => void
  isProviderColumnLocked?: (columnName: keyof IsLockProviders) => boolean
  /** Called when rows are reordered by drag. Parent should update providerSheetRows for the given provider. */
  onReorderProviderRows?: (providerId: string, movedRows: number[], finalIndex: number) => void
  /** When true (e.g. official_staff), only columns ID through Date of Service are editable; rest read-only */
  restrictEditToSchedulingColumns?: boolean
  /** When true (office_staff), show only columns ID through Appt/Note Status and Collected from PT through PT Payment AR Ref Date; office staff can edit Patient ID, First Name, LI, Date of Service, and payment columns. */
  officeStaffView?: boolean
  /** When true (super_admin or office_staff), user can add/see/edit comments in the modal and "See comment" context menu is shown */
  canEditComment?: boolean
  /** Current user's highlight color (from User Management). Used to paint highlighted cells. Super admin uses #2d7e83; default yellow (#eab308). */
  userHighlightColor?: string | null
  /** When true, show an extra "Visit Type" column (In-person / Telehealth) after Appt/Note Status. Set per provider in User Management. */
  showVisitTypeColumn?: boolean
  /** When true, parent is showing backup override rows; always use props and do not prefer ref (so backup data displays after edits). */
  isViewingBackup?: boolean
}

export default function ProvidersTab({
  clinicId,
  clinicPayroll = 1,
  providers,
  providerSheetRows,
  providerRowsVersion,
  billingCodes,
  statusColors,
  patients,
  selectedMonth,
  selectedMonthKey,
  providerId,
  currentProvider: _currentProvider,
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
  selectedPayroll,
  filterRowsByMonth,
  isLockProviders,
  onLockProviderColumn,
  isProviderColumnLocked,
  onReorderProviderRows,
  restrictEditToSchedulingColumns = false,
  officeStaffView = false,
  canEditComment = false,
  userHighlightColor = '#eab308',
  showVisitTypeColumn = false,
  isViewingBackup = false,
}: ProvidersTabProps) {
  
  const { userProfile } = useAuth()
  // Use isLockProviders from props directly - it will update when parent refreshes
  const lockData = isLockProviders || null
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())
  /** Per-cell highlight color (of the user who highlighted that cell) */
  const [highlightColorByKey, setHighlightColorByKey] = useState<Map<string, string>>(new Map())
  const [commentsMap, setCommentsMap] = useState<Map<string, string>>(new Map())
  const [resolvedCells, setResolvedCells] = useState<Set<string>>(new Set())
  const [commentModal, setCommentModal] = useState<{ row: number; col: number; rowId: string; colKey: string } | null>(null)
  const [commentText, setCommentText] = useState('')
  const [commentModalLoading, setCommentModalLoading] = useState(false)
  const [isCondensed, setIsCondensed] = useState(false)
  const [arSumFromDb, setArSumFromDb] = useState<number | null>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const commentModalContainerRef = useRef<HTMLDivElement>(null)
  const hotInstanceRef = useRef<Handsontable | null>(null)

  const showCondenseButton = !officeStaffView && !isProviderView

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
  /** Latest rows from change handler so rapid edits accumulate and flush-on-unmount has current data (like PatientsTab patientsRef). */
  const latestProviderRowsRef = useRef<{ providerId: string; rows: SheetRow[] } | null>(null)
  const saveProviderSheetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProviderSheetSaveRef = useRef<{ providerId: string; rows: SheetRow[] } | null>(null)

  const localRowsProviderKeyRef = useRef<string | null>(null)

  // Clear refs when provider/month changes, when parent refetched, or when viewing backup (so backup rows from props are used)
  useEffect(() => {
    latestTableDataRef.current = null
    latestProviderRowsRef.current = null
    localRowsProviderKeyRef.current = null
  }, [activeProvider?.id, selectedMonth.getTime(), providerRowsVersion, isViewingBackup])

  // Keep ref in sync for provider/month/backup so change handler and flush-on-unmount have correct key
  useEffect(() => {
    if (!activeProvider) return
    localRowsProviderKeyRef.current = `${activeProvider.id}-${selectedMonth.getTime()}`
  }, [activeProvider?.id, selectedMonth.getTime(), isViewingBackup])

  // Load persisted highlights and comments for this clinic (so they survive reload and show for providers)
  useEffect(() => {
    if (!clinicId) return
    const loadHighlights = async () => {
      const { data } = await supabase
        .from('cell_highlights')
        .select('row_id, column_key, highlight_color')
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
      if (data) {
        const keys = data.map((r: { row_id: string; column_key: string }) => `${r.row_id}:${r.column_key}`)
        setHighlightedCells(new Set(keys))
        const colorMap = new Map<string, string>()
        data.forEach((r: { row_id: string; column_key: string; highlight_color?: string | null }) => {
          const key = `${r.row_id}:${r.column_key}`
          colorMap.set(key, (r.highlight_color && r.highlight_color.trim()) ? r.highlight_color.trim() : '#eab308')
        })
        setHighlightColorByKey(colorMap)
      }
    }
    const loadComments = async () => {
      const { data } = await supabase
        .from('cell_comments')
        .select('row_id, column_key, comment, resolved')
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
      if (data) {
        setCommentsMap(new Map(data.map((r: { row_id: string; column_key: string; comment: string }) => [`${r.row_id}:${r.column_key}`, r.comment ?? ''])))
        setResolvedCells(new Set((data as { row_id: string; column_key: string; resolved?: boolean }[]).filter(r => r.resolved === true).map(r => `${r.row_id}:${r.column_key}`)))
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
      return { color: billingCode.color, textColor: billingCode.text_color ?? '#000000' }
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
    // Support "1st January" / "2nd January" (payroll 2) by normalizing to month name for status_colors lookup
    const monthName = month.replace(/^(1st|2nd)\s+/i, '').trim()
    const monthColor = statusColors.find(s => s.status === monthName && s.type === 'month')
    if (monthColor) {
      return { color: monthColor.color, textColor: monthColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  // Map rows to Handsontable 2D array format (shared by getProviderRowsHandsontableData and change handler); never show "null"
  // When isProviderView and providerLevel 2, show full columns; when providerLevel 1, show only up to Appt/Note Status
  // When officeStaffView, show ID through Appt/Note Status (0-8) and Collected from PT through PT Payment AR Ref Date (14-16)
  const getTableDataFromRows = useCallback((rows: SheetRow[]) => {
    const hasVal = (v: unknown) => v != null && v !== '' && v !== 'null'
    return rows.map(row => {
      const patient = patients.find(p => p.patient_id === row.patient_id)
      const patientDisplay = patient ? toDisplayValue(patient.patient_id) : toDisplayValue(row.patient_id)
      // When row has patient_id but empty patient-info columns, show from patients list (retrieve by ID)
      const firstNameDisplay = hasVal(row.patient_first_name) ? toDisplayValue(row.patient_first_name) : (patient ? toDisplayValue(patient.first_name) : '')
      const lastInitialDisplay = hasVal(row.last_initial) ? toDisplayValue(row.last_initial) : (patient?.last_name ? toDisplayValue(patient.last_name.charAt(0)) : '')
      const insuranceDisplay = hasVal(row.patient_insurance) ? toDisplayValue(row.patient_insurance) : (patient ? toDisplayValue(patient.insurance) : '')
      const copayDisplay = hasVal(row.patient_copay) ? toDisplayValue(row.patient_copay) : (patient != null ? toDisplayValue(patient.copay) : '')
      const coinsuranceDisplay = hasVal(row.patient_coinsurance) ? toDisplayValue(row.patient_coinsurance) : (patient != null ? toDisplayValue(patient.coinsurance) : '')
      const visitTypeVal = () => row.visit_type === 'Telehealth'
      const insertVisitType = (arr: (string | number)[]) => showVisitTypeColumn ? [...arr.slice(0, 9), visitTypeVal(), ...arr.slice(9)] : arr
      if (officeStaffView) {
        const base = [
          patientDisplay,
          firstNameDisplay,
          lastInitialDisplay,
          insuranceDisplay,
          copayDisplay,
          coinsuranceDisplay,
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
          toDisplayValue(row.collected_from_patient),
          toDisplayValue(row.patient_pay_status),
          toDisplayValue(row.ar_date),
        ]
        return insertVisitType(base) as (string | number)[]
      }
      if (isProviderView && providerLevel !== 2) {
        const base = [
          patientDisplay,
          firstNameDisplay,
          lastInitialDisplay,
          insuranceDisplay,
          copayDisplay,
          coinsuranceDisplay,
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
        ]
        return insertVisitType(base) as (string | number)[]
      }
      if (isProviderView && providerLevel === 2) {
        const base = [
          patientDisplay,
          firstNameDisplay,
          lastInitialDisplay,
          insuranceDisplay,
          copayDisplay,
          coinsuranceDisplay,
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
          toDisplayValue(row.claim_status),
          toDisplayValue(row.submit_date),
          toDisplayValue(row.insurance_payment),
          toDisplayValue(row.payment_date),
          toDisplayValue(row.insurance_adjustment),
          toDisplayValue(row.collected_from_patient),
          toDisplayValue(row.patient_pay_status),
          toDisplayValue(row.ar_date),
          toDisplayValue(row.total),
          toDisplayValue(row.notes),
        ]
        return insertVisitType(base) as (string | number)[]
      }
      const fullRow = [
        patientDisplay,
        firstNameDisplay,
        lastInitialDisplay,
        insuranceDisplay,
        copayDisplay,
        coinsuranceDisplay,
        toDisplayDate(row.appointment_date),
        toDisplayValue(row.cpt_code),
        toDisplayValue(row.appointment_status),
        toDisplayValue(row.claim_status),
        toDisplayValue(row.submit_date),
        toDisplayValue(row.insurance_payment),
        toDisplayValue(row.payment_date),
        toDisplayValue(row.insurance_adjustment),
        toDisplayValue(row.collected_from_patient),
        toDisplayValue(row.patient_pay_status),
        toDisplayValue(row.ar_date),
        toDisplayValue(row.total),
        toDisplayValue(row.notes),
      ]
      const withVisitType = insertVisitType(fullRow) as (string | number)[]
      if (showCondenseButton && isCondensed) return withVisitType.slice(0, showVisitTypeColumn ? 10 : 9)
      return withVisitType
    })
  }, [patients, isProviderView, providerLevel, officeStaffView, showCondenseButton, isCondensed, showVisitTypeColumn])

  // Convert rows to Handsontable data format; prefer latest from change handler, then props, to avoid losing typed data when parent re-renders after load (like PatientsTab).
  // When viewing backup, always use backup rows from props. When not viewing backup and ref is null, use props (activeProviderRows) so "Back to current" shows current data immediately instead of stale local state.
  const getProviderRowsHandsontableData = useCallback(() => {
    if (!activeProvider) return []
    if (isViewingBackup) return getTableDataFromRows(activeProviderRows)
    if (latestTableDataRef.current != null) return latestTableDataRef.current
    return getTableDataFromRows(activeProviderRows)
  }, [activeProvider, activeProviderRows, getTableDataFromRows, isViewingBackup])

  // Sum of Ins Pay, Collected from PT, AR, Total (computed from current rows; not stored in DB)
  // For provider level 2 (full) we show full tally; for admin/billing we show insPay, collectedFromPt, total; AR only for provider level 2
  const providerSums = useMemo(() => {
    const parse = (v: unknown): number => {
      if (v == null || v === '' || v === 'null') return 0
      const n = typeof v === 'number' ? v : parseFloat(String(v))
      return Number.isNaN(n) ? 0 : n
    }
    let insPay = 0
    let collectedFromPt = 0
    let arTotal = 0
    let total = 0
    activeProviderRows.forEach((row) => {
      insPay += parse(row.insurance_payment)
      collectedFromPt += parse(row.collected_from_patient)
      arTotal += parse(row.ar_amount)
      total += parse(row.total)
    })
    return { insPay, collectedFromPt, arTotal, total }
  }, [activeProviderRows])

  // Accounts receivable total from accounts_receivables table for the selected month (clinic-level)
  useEffect(() => {
    if (!clinicId) {
      setArSumFromDb(null)
      return
    }
    const y = selectedMonth.getFullYear()
    const m = selectedMonth.getMonth()
    const firstDay = `${y}-${String(m + 1).padStart(2, '0')}-01`
    const lastDay = new Date(y, m + 1, 0)
    const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`

    let cancelled = false
    setArSumFromDb(null)
    supabase
      .from('accounts_receivables')
      .select('amount')
      .eq('clinic_id', clinicId)
      .gte('date_recorded', firstDay)
      .lte('date_recorded', lastDayStr)
      .then(({ data, error }) => {
        if (cancelled || error) {
          if (!cancelled && error) console.error('Fetch accounts_receivables sum:', error)
          return
        }
        const sum = (data || []).reduce((acc, row) => acc + (Number(row?.amount) || 0), 0)
        if (!cancelled) setArSumFromDb(sum)
      })
    return () => { cancelled = true }
  }, [clinicId, selectedMonth])

  // Billing metrics (visits, no shows, paid claims, etc.) for the selected month – admin/billing only
  const billingMetrics = useMemo(() => {
    if (isProviderView) return null
    return computeBillingMetrics(activeProviderRows)
  }, [activeProviderRows, isProviderView])

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  // Column field names mapping to is_lock_providers table columns (visit_type is optional, not in IsLockProviders)
  const columnFieldsFullBase: Array<keyof IsLockProviders> = [
    'patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance',
    'date_of_service', 'cpt_code', 'appointment_note_status', 'claim_status',
    'most_recent_submit_date', 'ins_pay', 'ins_pay_date', 'pt_res', 'collected_from_pt',
    'pt_pay_status', 'pt_payment_ar_ref_date', 'total', 'notes'
  ]
  const columnTitlesFullBase = [
    'ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins',
    'Date of Service', 'CPT Code', 'Appt/Note Status', 'Claim Status', 'Most Recent Submit Date',
    'Ins Pay', 'Ins Pay Date', 'PT RES', 'Collected from PT', 'PT Pay Status',
    'PT Payment AR Ref Date', 'Total', 'Notes'
  ]
  const columnFieldsFull = showVisitTypeColumn
    ? ([...columnFieldsFullBase.slice(0, 9), 'visit_type', ...columnFieldsFullBase.slice(9)] as string[])
    : columnFieldsFullBase
  const columnTitlesFull = showVisitTypeColumn
    ? [...columnTitlesFullBase.slice(0, 9), 'Visit Type', ...columnTitlesFullBase.slice(9)]
    : columnTitlesFullBase
  const columnFieldsProviderView = showVisitTypeColumn
    ? (['patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance', 'date_of_service', 'cpt_code', 'appointment_note_status', 'visit_type'] as const)
    : (['patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance', 'date_of_service', 'cpt_code', 'appointment_note_status'] as const)
  const columnTitlesProviderView = showVisitTypeColumn
    ? ['ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins', 'Date of Service', 'CPT Code', 'Appt/Note Status', 'Visit Type']
    : ['ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins', 'Date of Service', 'CPT Code', 'Appt/Note Status']
  const columnFieldsOfficeStaffBase: Array<keyof IsLockProviders> = [
    'patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance',
    'date_of_service', 'cpt_code', 'appointment_note_status',
    'collected_from_pt', 'pt_pay_status', 'pt_payment_ar_ref_date'
  ]
  const columnFieldsOfficeStaff = showVisitTypeColumn
    ? ([...columnFieldsOfficeStaffBase.slice(0, 9), 'visit_type', ...columnFieldsOfficeStaffBase.slice(9)] as string[])
    : columnFieldsOfficeStaffBase
  const columnTitlesOfficeStaffBase = [
    'ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins',
    'Date of Service', 'CPT Code', 'Appt/Note Status',
    'Collected from PT', 'PT Pay Status', 'PT Payment AR Ref Date'
  ]
  const columnTitlesOfficeStaff = showVisitTypeColumn
    ? [...columnTitlesOfficeStaffBase.slice(0, 9), 'Visit Type', ...columnTitlesOfficeStaffBase.slice(9)]
    : columnTitlesOfficeStaffBase
  const columnFields = officeStaffView
    ? columnFieldsOfficeStaff
    : isProviderView
      ? (providerLevel === 2 ? columnFieldsFull : columnFieldsProviderView)
      : (showCondenseButton && isCondensed ? columnFieldsFull.slice(0, 9) : columnFieldsFull)
  const columnTitles = officeStaffView
    ? columnT