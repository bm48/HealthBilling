import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import type { SheetRow } from '@/types'
import type { StatusColor } from '@/types'

export type ProviderPayRow = [string, string] // [cpt_code, app_note_status]

export type IsLockProviderPay = {
  cpt_code?: boolean
  app_note_status?: boolean
  cpt_code_comment?: string | null
  app_note_status_comment?: string | null
}

export interface ProviderPayTabProps {
  clinicId: string
  canEdit: boolean
  isInSplitScreen?: boolean
  providerSheetRows: Record<string, SheetRow[]>
  selectedMonth: Date
  onPreviousMonth: () => void
  onNextMonth: () => void
  formatMonthYear: (date: Date) => string
  filterRowsByMonth: (rows: SheetRow[]) => SheetRow[]
  statusColors: StatusColor[]
  onUpdateProviderPayRow: (providerId: string, updatedRow: SheetRow) => void
  isLockProviderPay?: IsLockProviderPay | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockProviderPay) => boolean
}

const COLUMN_FIELDS: (keyof IsLockProviderPay)[] = ['cpt_code', 'app_note_status']
const COLUMN_TITLES = ['CPT Code', 'App/Note Status']

const EMPTY_ROW: ProviderPayRow = ['', '']

export default function ProviderPayTab({
  clinicId,
  canEdit,
  isInSplitScreen,
  providerSheetRows,
  selectedMonth,
  onPreviousMonth,
  onNextMonth,
  formatMonthYear,
  filterRowsByMonth,
  statusColors,
  onUpdateProviderPayRow,
  isLockProviderPay,
  onLockColumn,
  isColumnLocked,
}: ProviderPayTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const lockData = isLockProviderPay || null

  // Flatten all provider rows for the selected month (order: provider order, then row order per provider)
  const flattenedEntries = useMemo(() => {
    const entries: { providerId: string; row: SheetRow }[] = []
    Object.entries(providerSheetRows).forEach(([providerId, rows]) => {
      const filtered = filterRowsByMonth(rows)
      filtered.forEach((row) => entries.push({ providerId, row }))
    })
    return entries
  }, [providerSheetRows, filterRowsByMonth])

  // Table data: first 200 rows (flattened + empty padding)
  const tableData = useMemo(() => {
    const data: ProviderPayRow[] = flattenedEntries.slice(0, 200).map(({ row }) => [
      row.cpt_code ?? '',
      row.appointment_status ?? '',
    ])
    while (data.length < 200) {
      data.push([...EMPTY_ROW])
    }
    return data
  }, [flattenedEntries])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateHeight = () => {
      const h = el.clientHeight
      if (h > 0) setTableHeight(h)
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isInSplitScreen])

  const afterChange = useCallback(
    (changes: unknown, _source?: unknown) => {
      if (!Array.isArray(changes) || !changes.length || !canEdit || !onUpdateProviderPayRow) return
      for (const c of changes) {
        const rowIndex = typeof c[0] === 'number' ? c[0] : -1
        const col = typeof c[1] === 'number' ? c[1] : -1
        const newVal = c[3]
        if (rowIndex < 0 || rowIndex >= flattenedEntries.length || (col !== 0 && col !== 1)) continue
        const { providerId, row } = flattenedEntries[rowIndex]
        const value = newVal != null ? String(newVal) : ''
        if (col === 0) {
          onUpdateProviderPayRow(providerId, { ...row, cpt_code: value || null })
        } else if (col === 1) {
          onUpdateProviderPayRow(providerId, {
            ...row,
            appointment_status: (value || null) as SheetRow['appointment_status'],
          })
        }
      }
    },
    [canEdit, onUpdateProviderPayRow, flattenedEntries]
  )

  const getReadOnly = (columnName: keyof IsLockProviderPay): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  const columnsWithLock = useCallback(
    () => [
      {
        data: 0,
        title: COLUMN_TITLES[0],
        type: 'text' as const,
        width: 120,
        readOnly: !canEdit || getReadOnly('cpt_code'),
      },
      {
        data: 1,
        title: COLUMN_TITLES[1],
        type: 'text' as const,
        width: 180,
        readOnly: !canEdit || getReadOnly('app_note_status'),
      },
    ],
    [canEdit, lockData]
  )

  const getMonthColor = useCallback(
    (month: string): { color: string; textColor: string } | null => {
      if (!month) return null
      const monthColor = statusColors.find((s) => s.status === month && s.type === 'month')
      if (monthColor) {
        return { color: monthColor.color, textColor: monthColor.text_color || '#000000' }
      }
      return null
    },
    [statusColors]
  )

  // Add lock icons to headers after table renders (like BillingTodoTab)
  useEffect(() => {
    if (!canEdit || !onLockColumn || !isColumnLocked) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const addLockIconsToHeader = (headerRow: Element | null) => {
      if (!headerRow) return

      const headerCells = Array.from(headerRow.querySelectorAll('th'))

      headerCells.forEach((th) => {
        const colHeader = th.querySelector('.colHeader')
        let cellText = (colHeader?.textContent ?? th.textContent ?? '').replace(/🔒|🔓/g, '').trim()

        const columnIndex = COLUMN_TITLES.findIndex((title) => {
          const normalizedTitle = title.toLowerCase().trim()
          const normalizedCellText = cellText.toLowerCase().trim()
          return (
            normalizedCellText === normalizedTitle ||
            normalizedCellText.includes(normalizedTitle) ||
            normalizedTitle.includes(normalizedCellText)
          )
        })

        if (columnIndex === -1 || columnIndex >= COLUMN_FIELDS.length) return

        const columnName = COLUMN_FIELDS[columnIndex]
        const isLocked = isColumnLocked(columnName)

        const relative = th.querySelector('.relative')
        if (!relative) return

        const existingLock = relative.querySelector('.provider-pay-lock-icon')
        if (existingLock) existingLock.remove()

        const rel = relative as HTMLElement
        rel.style.display = 'flex'
        rel.style.alignItems = 'center'
        rel.style.justifyContent = 'space-between'
        rel.style.gap = '4px'
        const colHeaderSpan = relative.querySelector('.colHeader')
        if (colHeaderSpan) {
          ;(colHeaderSpan as HTMLElement).style.flex = '1'
          ;(colHeaderSpan as HTMLElement).style.minWidth = '0'
        }

        const lockButton = document.createElement('button')
        lockButton.className = 'provider-pay-lock-icon'
        lockButton.style.cssText = `
          opacity: 1;
          transition: opacity 0.2s;
          padding: 2px;
          cursor: pointer;
          background: transparent;
          border: none;
          display: flex;
          align-items: center;
          color: currentColor;
          flex-shrink: 0;
        `
        lockButton.title = isLocked ? 'Click to unlock column' : 'Click to lock column'
        lockButton.innerHTML = isLocked
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V7a6 6 0 0 1 12 0v2"></path><rect x="3" y="9" width="18" height="12" rx="2"></rect></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12V7a3 3 0 0 1 6 0v5"></path><path d="M3 12h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9z"></path></svg>'
        lockButton.onclick = (e) => {
          e.stopPropagation()
          e.preventDefault()
          onLockColumn(columnName as string)
        }
        relative.appendChild(lockButton)
      })
    }

    const addLockIcons = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      document.querySelectorAll('.provider-pay-lock-icon').forEach((icon) => icon.remove())

      const table = document.querySelector('.handsontable-custom table.htCore')
      if (table) {
        const headerRow = table.querySelector('thead tr')
        if (headerRow) addLockIconsToHeader(headerRow)
      }

      const cloneTop = document.querySelector('.handsontable-custom .ht_clone_top table.htCore')
      if (cloneTop) {
        const headerRow = cloneTop.querySelector('thead tr')
        if (headerRow) addLockIconsToHeader(headerRow)
      }
    }

    const debouncedAddLockIcons = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(addLockIcons, 200)
    }

    timeoutId = setTimeout(addLockIcons, 300)

    const observer = new MutationObserver(() => debouncedAddLockIcons())
    const tableContainer = document.querySelector('.handsontable-custom')
    if (tableContainer) {
      observer.observe(tableContainer, { childList: true, subtree: true, attributes: false })
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      observer.disconnect()
    }
  }, [canEdit, onLockColumn, isColumnLocked, lockData])

  return (
    <div
      className="p-6"
      style={isInSplitScreen ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}
    >
      {/* Month selector - same style as Providers tab */}
      {(() => {
        const monthName = selectedMonth.toLocaleString('en-US', { month: 'long' })
        const monthColor = getMonthColor(monthName)
        const bgColor = monthColor?.color ?? 'rgba(30, 41, 59, 0.5)'
        const textColor = monthColor?.textColor ?? '#fff'
        return (
          <div
            className="relative flex items-center justify-center gap-4 rounded-lg border border-slate-700"
            style={{
              backgroundColor: bgColor,
              color: textColor,
              maxWidth: '40%',
              margin: 'auto',
              marginBottom: '10px',
            }}
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
        ref={containerRef}
        className="table-container dark-theme"
        style={{
          maxHeight: isInSplitScreen ? undefined : 600,
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflowX: 'auto',
          overflowY: 'auto',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5',
        }}
      >
        <HandsontableWrapper
          key={`provider-pay-${clinicId}-${selectedMonth.getTime()}-${JSON.stringify(lockData)}`}
          data={tableData}
          columns={columnsWithLock()}
          colHeaders={COLUMN_TITLES}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          readOnly={!canEdit}
          afterChange={afterChange}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom"
        />
      </div>
    </div>
  )
}
