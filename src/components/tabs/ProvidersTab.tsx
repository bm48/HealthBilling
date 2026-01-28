import { Provider, SheetRow, BillingCode, StatusColor, Patient, IsLockProviders } from '@/types'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer, createMultiBubbleDropdownRenderer, MultiSelectCptEditor } from '@/lib/handsontableCustomRenderers'
import { useCallback, useMemo, useEffect, useRef } from 'react'

interface ProvidersTabProps {
  providers: Provider[]
  providerSheetRows: Record<string, SheetRow[]>
  billingCodes: BillingCode[]
  statusColors: StatusColor[]
  patients: Patient[]
  selectedMonth: Date
  providerId?: string
  currentProvider: Provider | null
  canEdit: boolean
  isInSplitScreen: boolean
  /** When true, show provider columns: Patient ID, First Name, Last Initial, Insurance, Co-pay, Co-Ins, Date of Service, CPT Code, Appt/Note Status */
  isProviderView?: boolean
  onUpdateProviderSheetRow: (providerId: string, rowId: string, field: string, value: any) => void
  onSaveProviderSheetRowsDirect: (providerId: string, rows: SheetRow[]) => Promise<void>
  onContextMenu: (e: React.MouseEvent, type: 'providerRow', id: string, providerId: string) => void
  onPreviousMonth: () => void
  onNextMonth: () => void
  formatMonthYear: (date: Date) => string
  filterRowsByMonth: (rows: SheetRow[]) => SheetRow[]
  isLockProviders?: IsLockProviders | null
  onLockProviderColumn?: (columnName: string) => void
  isProviderColumnLocked?: (columnName: keyof IsLockProviders) => boolean
}

export default function ProvidersTab({
  providers,
  providerSheetRows,
  billingCodes,
  statusColors,
  patients,
  selectedMonth,
  providerId,
  currentProvider,
  canEdit,
  isInSplitScreen,
  isProviderView = false,
  onUpdateProviderSheetRow,
  onSaveProviderSheetRowsDirect,
  onContextMenu,
  onPreviousMonth,
  onNextMonth,
  formatMonthYear,
  filterRowsByMonth,
  isLockProviders,
  onLockProviderColumn,
  isProviderColumnLocked,
}: ProvidersTabProps) {
  
  // Use isLockProviders from props directly - it will update when parent refreshes
  const lockData = isLockProviders || null

  const providersToShow = providerId 
    ? providers.filter(p => p.id === providerId)
    : providers

  // Get rows for the first provider (or selected provider) to display in Handsontable
  const activeProvider = providersToShow.length > 0 ? providersToShow[0] : null
  const activeProviderRows = activeProvider ? filterRowsByMonth(providerSheetRows[activeProvider.id] || []) : []

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

  // Convert rows to Handsontable data format
  const getProviderRowsHandsontableData = useCallback(() => {
    if (!activeProvider) return []
    return activeProviderRows.map(row => {
      // Find patient for dropdown display
      const patient = patients.find(p => p.patient_id === row.patient_id)
      const patientDisplay = patient ? `${patient.patient_id}` : (row.patient_id || '')
      if (isProviderView) {
        return [
          patientDisplay,
          row.patient_first_name || '',
          row.last_initial || '',
          row.patient_insurance || '',
          row.patient_copay !== null ? row.patient_copay : '',
          row.patient_coinsurance !== null ? row.patient_coinsurance : '',
          row.appointment_date || '',
          row.cpt_code || '',
          row.appointment_status || '',
        ]
      }
      return [
        patientDisplay,
        row.patient_first_name || '',
        row.last_initial || '',
        row.patient_insurance || '',
        row.patient_copay !== null ? row.patient_copay : '',
        row.patient_coinsurance !== null ? row.patient_coinsurance : '',
        row.appointment_date || '',
        row.cpt_code || '',
        row.appointment_status || '',
        row.claim_status || '',
        row.submit_date || '',
        row.insurance_payment || '',
        row.payment_date || '',
        row.insurance_adjustment || '',
        row.collected_from_patient || '',
        row.patient_pay_status || '',
        row.ar_date || '',
        row.total || '',
        row.notes || '',
      ]
    })
  }, [activeProvider, activeProviderRows, patients, isProviderView])


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
  const columnFields = isProviderView ? columnFieldsProviderView : columnFieldsFull
  const columnTitles = isProviderView ? columnTitlesProviderView : columnTitlesFull

  const getReadOnly = (columnName: keyof IsLockProviders): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  // Add lock icons to headers after table renders
  useEffect(() => {
    // Only run if lock functionality is enabled (not in provider view)
    if (isProviderView || !canEdit || !onLockProviderColumn || !isProviderColumnLocked) return

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
        const isLocked = isProviderColumnLocked ? isProviderColumnLocked(columnName) : false

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
        lockButton.className = 'provider-lock-icon'
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
          if (onLockProviderColumn) {
            onLockProviderColumn(columnName as string)
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
      const allLockIcons = document.querySelectorAll('.provider-lock-icon')
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
      const table = document.querySelector('.providers-handsontable table.htCore')
      if (table) {
        const headerRow = table.querySelector('thead tr')
        if (headerRow) {
          addLockIconsToHeader(headerRow)
        }
      }

      // Add to cloned header (sticky header)
      const cloneTop = document.querySelector('.providers-handsontable .ht_clone_top table.htCore')
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

    const tableContainer = document.querySelector('.providers-handsontable')
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
  }, [isProviderView, canEdit, onLockProviderColumn, isProviderColumnLocked, columnFields, columnTitles, isLockProviders])

  // Update columns with readOnly based on lock state
  const providerColumnsWithLocks = useMemo(() => {
    if (!activeProvider) return []
    
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    
    if (isProviderView) {
      return [
        { data: 0, title: 'Patient ID', type: 'text' as const, width: 180, readOnly: !canEdit },
        { data: 1, title: 'First Name', type: 'text' as const, width: 120, readOnly: !canEdit },
        { data: 2, title: 'Last Initial', type: 'text' as const, width: 80, readOnly: !canEdit },
        { data: 3, title: 'Insurance', type: 'text' as const, width: 120, readOnly: !canEdit },
        { data: 4, title: 'Co-pay', type: 'numeric' as const, width: 80, readOnly: !canEdit },
        { data: 5, title: 'Co-Ins', type: 'numeric' as const, width: 80, readOnly: !canEdit },
        { data: 6, title: 'Date of Service', type: 'date' as const, width: 120, format: 'YYYY-MM-DD', readOnly: !canEdit },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, readOnly: !canEdit },
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 180, editor: 'select', selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, readOnly: !canEdit },
      ]
    }
    
    return [
      { 
        data: 0, 
        title: 'Patient ID', 
        type: 'text' as const, 
        width: 100,
        readOnly: !canEdit || getReadOnly('patient_id')
      },
      { 
        data: 1, 
        title: 'First Name', 
        type: 'text' as const, 
        width: 120,
        readOnly: !canEdit || getReadOnly('first_name')
      },
      { 
        data: 2, 
        title: 'Last Initial', 
        type: 'text' as const, 
        width: 80,
        readOnly: !canEdit || getReadOnly('last_initial')
      },
      { 
        data: 3, 
        title: 'Insurance', 
        type: 'text' as const, 
        width: 120,
        readOnly: !canEdit || getReadOnly('insurance')
      },
      { 
        data: 4, 
        title: 'Co-pay', 
        type: 'numeric' as const, 
        width: 80,
        readOnly: !canEdit || getReadOnly('copay')
      },
      { 
        data: 5, 
        title: 'Co-Ins', 
        type: 'numeric' as const, 
        width: 80,
        readOnly: !canEdit || getReadOnly('coinsurance')
      },
      { 
        data: 6, 
        title: 'Date of Service', 
        type: 'date' as const, 
        width: 120, 
        format: 'YYYY-MM-DD',
        readOnly: !canEdit || getReadOnly('date_of_service')
      },
      { 
        data: 7, 
        title: 'CPT Code', 
        type: 'dropdown' as const, 
        width: 160,
        editor: MultiSelectCptEditor,
        selectOptions: billingCodes.map(c => c.code),
        renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any,
        readOnly: !canEdit || getReadOnly('cpt_code')
      },
      { 
        data: 8, 
        title: 'Appt/Note Status', 
        type: 'dropdown' as const, 
        width: 150,
        editor: 'select',
        selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any,
        readOnly: !canEdit || getReadOnly('appointment_note_status')
      },
      { 
        data: 9, 
        title: 'Claim Status', 
        type: 'dropdown' as const, 
        width: 120,
        editor: 'select',
        selectOptions: ['Claim Sent', 'RS', 'IP', 'Pending Pay', 'Paid', 'Deductible', 'N/A', 'PP', 'Denial', 'Rejected', 'No Coverage'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'claim')) as any,
        readOnly: !canEdit || getReadOnly('claim_status')
      },
      { 
        data: 10, 
        title: 'Most Recent Submit Date', 
        type: 'text' as const, 
        width: 120,
        readOnly: !canEdit || getReadOnly('most_recent_submit_date')
      },
      { 
        data: 11, 
        title: 'Ins Pay', 
        type: 'text' as const, 
        width: 100,
        readOnly: !canEdit || getReadOnly('ins_pay')
      },
      { 
        data: 12, 
        title: 'Ins Pay Date', 
        type: 'dropdown' as const, 
        width: 100,
        editor: 'select',
        selectOptions: months,
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any,
        readOnly: !canEdit || getReadOnly('ins_pay_date')
      },
      { 
        data: 13, 
        title: 'PT RES', 
        type: 'text' as const, 
        width: 100,
        readOnly: !canEdit || getReadOnly('pt_res')
      },
      { 
        data: 14, 
        title: 'Collected from PT', 
        type: 'text' as const, 
        width: 120,
        readOnly: !canEdit || getReadOnly('collected_from_pt')
      },
      { 
        data: 15, 
        title: 'PT Pay Status', 
        type: 'dropdown' as const, 
        width: 120,
        editor: 'select',
        selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any,
        readOnly: !canEdit || getReadOnly('pt_pay_status')
      },
      { 
        data: 16, 
        title: 'PT Payment AR Ref Date', 
        type: 'dropdown' as const, 
        width: 120,
        editor: 'select',
        selectOptions: months,
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any,
        readOnly: !canEdit || getReadOnly('pt_payment_ar_ref_date')
      },
      { 
        data: 17, 
        title: 'Total', 
        type: 'text' as const, 
        width: 100,
        readOnly: !canEdit || getReadOnly('total')
      },
      { 
        data: 18, 
        title: 'Notes', 
        type: 'text' as const, 
        width: 150,
        readOnly: !canEdit || getReadOnly('notes')
      },
    ]
  }, [activeProvider, billingCodes, statusColors, getCPTColor, getStatusColor, getMonthColor, patients, canEdit, lockData, getReadOnly, isProviderView])

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
    const fields: Array<keyof SheetRow> = isProviderView ? fieldsProviderView : fieldsFull
    
    // Compute all changes locally first
    const updatedRows = [...activeProviderRows]
    let idCounter = 0
    
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
          const raw = String(newValue || '').trim()
          const patientIdOrNull = raw ? (raw.split(' - ')[0] || raw) : null
          // Look up patient from patient database and fill row
          const patient = patientIdOrNull ? patients.find(p => p.patient_id === patientIdOrNull) : null
          const merged: Partial<SheetRow> = {
            ...sheetRow,
            id: newId,
            patient_id: patientIdOrNull,
            updated_at: new Date().toISOString(),
          }
          if (patient) {
            merged.patient_first_name = patient.first_name || null
            merged.last_initial = patient.last_name ? patient.last_name.charAt(0) : null
            merged.patient_insurance = patient.insurance || null
            merged.patient_copay = patient.copay ?? null
            merged.patient_coinsurance = patient.coinsurance ?? null
          }
          updatedRows[row] = merged as SheetRow
        } else if (field === 'patient_copay' || field === 'patient_coinsurance' || field === 'total') {
          const numValue = newValue === '' || newValue === null ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: numValue, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'appointment_date') {
          const value = newValue === '' ? null : String(newValue)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
        } else if (field) {
          const value = String(newValue || '')
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
        }
      }
    })
    
    // Ensure we always have 200 rows after changes
    if (updatedRows.length > 200) {
      updatedRows.splice(200)
    } else if (updatedRows.length < 200) {
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
  }, [activeProvider, activeProviderRows, onUpdateProviderSheetRow, onSaveProviderSheetRowsDirect, isProviderView, patients])

  const handleProviderRowsHandsontableContextMenu = useCallback((row: number) => {
    if (isProviderView) return // No context menu (e.g. delete) for provider view
    const sheetRow = activeProviderRows[row]
    if (sheetRow && activeProvider && canEdit && !sheetRow.id.startsWith('new-') && !sheetRow.id.startsWith('empty-')) {
      const syntheticEvent = { preventDefault: () => {} } as React.MouseEvent
      onContextMenu(syntheticEvent, 'providerRow', sheetRow.id, activeProvider.id)
    }
  }, [activeProvider, activeProviderRows, canEdit, onContextMenu, isProviderView])

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

  return (
    <div className="p-6" style={isInSplitScreen ? { width: '100%', overflow: 'hidden' } : {}}>
      {providerId && currentProvider && (
        <div className="mb-4 pb-4 border-b border-white/20">
          <h2 className="text-xl font-semibold text-white">
            {currentProvider.first_name} {currentProvider.last_name}
            {currentProvider.specialty && (
              <span className="text-white/70 text-sm font-normal ml-2">({currentProvider.specialty})</span>
            )}
          </h2>
        </div>
      )}
      
      <div className="mb-4 flex items-center justify-center gap-4 bg-slate-800/50 rounded-lg p-3 border border-slate-700">
        <button
          onClick={onPreviousMonth}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-white"
          title="Previous month"
        >
          <ChevronLeft size={20} />
        </button>
        
        <div className="text-lg font-semibold text-white min-w-[200px] text-center">
          {formatMonthYear(selectedMonth)}
        </div>
        
        <button
          onClick={onNextMonth}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-white"
          title="Next month"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="table-container dark-theme" style={{ 
        maxHeight: isInSplitScreen ? 'calc(100vh - 400px)' : '600px', 
        overflowX: 'auto', 
        overflowY: 'auto',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '100%',
        backgroundColor: '#d2dbe5'
      }}>
        {activeProvider && (
          <HandsontableWrapper
            key={`providers-${activeProviderRows.length}-${JSON.stringify(lockData)}`}
            data={getProviderRowsHandsontableData()}
            columns={providerColumnsWithLocks}
            colHeaders={columnTitles}
            rowHeaders={true}
            width="100%"
            height={isInSplitScreen ? 400 : 600}
            afterChange={handleProviderRowsHandsontableChange}
            onContextMenu={handleProviderRowsHandsontableContextMenu}
            enableFormula={false}
            readOnly={!canEdit}
            style={{ backgroundColor: '#d2dbe5' }}
            className="handsontable-custom providers-handsontable"
          />
        )}
      </div>
    </div>
  )
}
