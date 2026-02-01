import { useRef, useEffect, useMemo } from 'react'
import { HotTable } from '@handsontable/react'
import Handsontable from 'handsontable'
import { HyperFormula } from 'hyperformula'
import { DateEditor } from '@/lib/handsontableCustomRenderers'
import 'handsontable/dist/handsontable.full.css'

/** Copy row heights from main table to row header clone so the row number column matches data row heights. */
function syncRowHeaderHeightsToClone(hot: Handsontable) {
  const root = hot?.rootElement
  if (!root) return
  const mainTbody = root.querySelector('.ht_master .wtHolder .wtHider table.htCore tbody') as HTMLElement | null
  const cloneTbody =
    (root.querySelector('.ht_clone_left .wtHolder .wtHider table.htCore tbody') as HTMLElement | null) ||
    (root.querySelector('.ht_clone_left table.htCore tbody') as HTMLElement | null)
  if (!mainTbody || !cloneTbody) return
  const mainRows = mainTbody.querySelectorAll('tr')
  const cloneRows = cloneTbody.querySelectorAll('tr')
  const count = Math.min(mainRows.length, cloneRows.length)
  for (let i = 0; i < count; i++) {
    const mainTr = mainRows[i] as HTMLTableRowElement
    const cloneTr = cloneRows[i] as HTMLTableRowElement
    const h = mainTr.offsetHeight
    if (h > 0) {
      cloneTr.style.height = `${h}px`
      cloneTr.style.minHeight = `${h}px`
    }
  }
}

interface HandsontableWrapperProps {
  data: any[][]
  columns: Array<{
    data: number | string
    title?: string
    type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'autocomplete' | 'checkbox'
    editor?: string | any
    renderer?: string | ((instance: any, td: HTMLElement, row: number, col: number, prop: string | number, value: any, cellProperties: any) => void)
    validator?: any
    selectOptions?: string[] | (() => string[])
    readOnly?: boolean | ((row: number, col: number) => boolean)
    width?: number
    className?: string
    format?: string
    numericFormat?: {
      pattern: string
      culture?: string
    }
    allowEmpty?: boolean
    source?: string[] | (() => string[])
    strict?: boolean
  }>
  colHeaders?: boolean | string[]
  rowHeaders?: boolean | number[] | string[]
  width?: string | number
  height?: string | number
  stretchH?: 'all' | 'last' | 'none'
  licenseKey?: string
  afterChange?: (changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => void
  afterSelection?: (r: number, c: number, r2: number, c2: number) => void
  cells?: (row: number, col: number) => any
  className?: string
  style?: React.CSSProperties
  enableFormula?: boolean
  onContextMenu?: (row: number, col: number, event: MouseEvent) => void
  readOnly?: boolean
  /** Bump when rows are added/removed so the grid refreshes (e.g. context-menu add/delete) */
  dataVersion?: number
  /** Called when rows are reordered by drag (manualRowMove). movedRows = source indexes, finalIndex = index of first moved row after drop */
  onAfterRowMove?: (movedRows: number[], finalIndex: number) => void
  /** When set to a row index (0-based), the grid will scroll to that row after the next data/version update, then clear the ref */
  scrollToRowAfterUpdateRef?: React.MutableRefObject<number | null>
}

export default function HandsontableWrapper({
  data,
  columns,
  colHeaders = true,
  rowHeaders = true,
  width = '100%',
  height = 'auto',
  stretchH = 'all',
  afterChange,
  afterSelection,
  cells,
  className = '',
  style = {},
  enableFormula = false,
  onContextMenu,
  readOnly = false,
  dataVersion = 0,
  onAfterRowMove,
  scrollToRowAfterUpdateRef,
}: HandsontableWrapperProps) {
  const hotTableRef = useRef<any>(null)
  const hyperformulaInstanceRef = useRef<HyperFormula | null>(null)
  const isBatchOperationRef = useRef<boolean>(false)
  const dataRef = useRef(data)
  dataRef.current = data
  const prevDataLengthRef = useRef(data.length)
  const prevDataVersionRef = useRef(dataVersion)
  // Stable ref for settings.data so HotTable doesn't overwrite grid on every re-render (avoids stale data wiping typed input)
  const dataForSettingsRef = useRef(data)

  useEffect(() => {
    if (enableFormula && hotTableRef.current) {
      // Initialize HyperFormula
      const hyperformulaInstance = HyperFormula.buildEmpty({
        licenseKey: 'gpl-v3',
      })
      hyperformulaInstanceRef.current = hyperformulaInstance

      // Get the Handsontable instance
      const hotInstance = hotTableRef.current.hotInstance
      if (hotInstance) {
        // Register HyperFormula as an engine
        hotInstance.updateSettings({
          formulas: {
            engine: hyperformulaInstance,
            sheetName: 'Sheet1',
          },
        })
      }
    }
  }, [enableFormula])

  useEffect(() => {
    if (dataRef.current.length > 0 && hotTableRef.current?.hotInstance) {
      const hotInstance = hotTableRef.current.hotInstance
      // Push data when row count or dataVersion changes (e.g. add/delete row); avoid overwriting during typing otherwise
      const lengthChanged = prevDataLengthRef.current !== dataRef.current.length
      const versionChanged = prevDataVersionRef.current !== dataVersion
      if (lengthChanged || versionChanged) {
        prevDataLengthRef.current = dataRef.current.length
        prevDataVersionRef.current = dataVersion
        hotInstance.updateSettings({
          data: dataRef.current
        })
        dataForSettingsRef.current = dataRef.current
        // Scroll to requested row (e.g. after "Add row" so the new row is visible)
        const rowToScroll = scrollToRowAfterUpdateRef?.current
        if (typeof rowToScroll === 'number' && rowToScroll >= 0 && rowToScroll < dataRef.current.length) {
          if (scrollToRowAfterUpdateRef) scrollToRowAfterUpdateRef.current = null
          requestAnimationFrame(() => {
            try {
              hotInstance.selectCell(rowToScroll, 0, rowToScroll, 0, true)
            } catch {
              // ignore if instance or row no longer valid
            }
          })
        }
      }
    } else {
      prevDataLengthRef.current = dataRef.current.length
      prevDataVersionRef.current = dataVersion
    }
  }, [data.length, dataVersion, scrollToRowAfterUpdateRef])
  
  // Process columns to handle numeric type and custom renderers/editors
  const processedColumns = useMemo(() => columns.map(col => {
    const processedCol: any = { ...col }
    
    if (col.type === 'numeric') {
      processedCol.type = 'text' as const // Use text type as base since numeric may not be registered
      processedCol.editor = 'text'
      // Numeric validation and formatting will be handled in the change handler
    }
    
    // Handle dropdown type - use text type with select editor
    if (col.type === 'dropdown' && col.selectOptions) {
      processedCol.type = 'text' as const // Use text type
      processedCol.editor = 'select' // Use select editor
      processedCol.selectOptions = col.selectOptions
      processedCol.strict = col.strict !== false
    }
    
    // Handle date type - use text type with custom date editor (no external dependencies needed)
    if (col.type === 'date' || processedCol.type === 'date') {
      processedCol.type = 'text' as const // Use text type to avoid registration issues
      processedCol.editor = DateEditor // Use custom date editor with HTML5 date input
      // Store date format for potential use
      if (col.format) {
        processedCol.dateFormat = col.format
      } else {
        processedCol.dateFormat = 'YYYY-MM-DD'
      }
    }
    
    // Preserve custom renderer if provided
    if (typeof col.renderer === 'function') {
      processedCol.renderer = col.renderer
    }
    
    // Preserve custom editor if provided
    if (col.editor && typeof col.editor !== 'string') {
      processedCol.editor = col.editor
    }
    
    // Convert readOnly function to boolean if needed for Handsontable compatibility
    if (typeof processedCol.readOnly === 'function') {
      // Keep function-based readOnly, but ensure it's properly typed
      // Handsontable should support function-based readOnly
    }
    if (col.readOnly === undefined) {
      processedCol.readOnly = false
    } else if (col.readOnly === true) {
      processedCol.readOnly = true
    } else if (col.readOnly === false) {
      processedCol.readOnly = false
    }
    
    // Final safety check: ensure type is valid
    // Allow date, text types, and undefined (for select editor)
    if (processedCol.type && 
        processedCol.type !== 'date' && 
        processedCol.type !== 'text') {
      // If type is invalid and we have an editor, use text as fallback
      if (processedCol.editor && processedCol.editor !== 'select' && processedCol.editor !== 'date') {
        processedCol.type = 'text' as const
      } else if (processedCol.editor === 'select') {
        // For select editor, remove type
        delete processedCol.type
      }
    }
    
    return processedCol
  }), [columns])


  // Update columns when they change (e.g., when readOnly state changes)
  useEffect(() => {
    if (hotTableRef.current?.hotInstance && processedColumns.length > 0) {
      const hotInstance = hotTableRef.current.hotInstance
      hotInstance.updateSettings({
        columns: processedColumns
      })
    }
  }, [processedColumns])

  // Convert rowHeaders number[] to string[] if needed
  const processedRowHeaders: boolean | string[] | ((index: number) => string) | undefined = 
    Array.isArray(rowHeaders) && rowHeaders.length > 0 && typeof rowHeaders[0] === 'number'
      ? rowHeaders.map(String)
      : (rowHeaders as boolean | string[] | undefined)

  const settings: Handsontable.GridSettings = {
    data: dataForSettingsRef.current,
    columns: processedColumns,
    colHeaders,
    rowHeaders: processedRowHeaders,
    width,
    height: height === 'auto' ? undefined : height,
    stretchH,
    licenseKey: 'non-commercial-and-evaluation',
    readOnly,
    // Enable borders for cells
    renderAllRows: false,
    // Ensure Handsontable recognizes all rows for virtual scrolling
    minSpareRows: 0,
    // Default row height; can still grow when Handsontable sets larger height (e.g. dropdown/select)
    rowHeights: 24,
    outsideClickDeselects: true,
    
    // Keyboard shortcuts configuration
    // Arrow Keys - Move between cells (default behavior)
    navigableHeaders: true,
    tabNavigation: true,
    
    // Enter - Edit cell (default behavior)
    // Tab - Next cell (default behavior)
    // Shift+Arrow - Select range (default behavior)
    
    // Enable copy/paste (Ctrl+C / Ctrl+V)
    copyPaste: {
      pasteMode: 'overwrite', // Overwrite cells instead of shifting them down
      rowsLimit: 10000,
      columnsLimit: 1000,
      uiContainer: document.body,
    },
    
    // Enable undo/redo (Ctrl+Z / Ctrl+Y)
    undo: true,
    
    // Delete key - Clear cell content
    // (default behavior when cell is selected)
    
    // Context menu with copy/paste
    contextMenu: onContextMenu ? undefined : [
      'row_above',
      'row_below',
      'remove_row',
      '---------',
      'col_left',
      'col_right',
      'remove_col',
      '---------',
      'copy',
      'cut',
      '---------',
      'undo',
      'redo',
    ] as any,
    
    // Manual column resize
    manualColumnResize: true,
    manualRowResize: true,
    
    // Column sorting: show sort icon in headers, click header to sort
    columnSorting: {
      indicator: true,
      headerAction: true,
    },
    
    // Auto column width
    autoColumnSize: {
      syncLimit: 50,
    },
    
    // Cell selection
    selectionMode: 'multiple',
    
    // After change callback
    afterChange: (changes, source) => {
      // Skip individual callbacks during batch operations (like Ctrl+D fill down)
      if (isBatchOperationRef.current && String(source) === 'CopyDown') {
        return
      }
      if (afterChange && changes) {
        console.log('[Handsontable] After change:', changes, source)
        afterChange(changes, source)
      }
    },
    
    // After selection callback
    afterSelection: (r, c, r2, c2) => {
      if (afterSelection) {
        afterSelection(r, c, r2, c2)
      }
    },
    
    // Custom cell renderer
    cells: cells || undefined,
    
    // Custom header renderer for colored headers - removed as it's not a valid Handsontable setting
    // Header styling is handled via CSS and custom header rendering in individual tabs
    
    // Styling
    className,
    
    // Prevent text selection during navigation
    preventOverflow: 'horizontal',
    
    // Enable fill handle for drag-fill
    fillHandle: {
      direction: 'vertical',
      autoInsertRow: true,
    },
    // Drag row by row header to reorder
    manualRowMove: true,
    afterRowMove: (movedRows, finalIndex) => {
      if (onAfterRowMove) onAfterRowMove(movedRows, finalIndex)
    },
    
    // Custom keyboard shortcuts
    customBorders: true,
    
    // Enable search
    search: true,
    
    // Enable filters
    dropdownMenu: false,
    
    // Enable comments
    comments: false,

    // Sync row heights from main table to row header clone so they always match (e.g. when select/dropdown expands a row)
    afterRender: function (this: Handsontable) {
      syncRowHeaderHeightsToClone(this)
    },
    afterScrollVertically: function (this: Handsontable) {
      syncRowHeaderHeightsToClone(this)
    },
  }
  
  // Add Ctrl+D (or Cmd+D on Mac) keyboard shortcut for fill down
  useEffect(() => {
    if (!hotTableRef.current?.hotInstance) return
    
    const hotInstance = hotTableRef.current.hotInstance
    const rootElement = hotInstance.rootElement
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+D (Windows/Linux) or Cmd+D (Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        event.preventDefault()
        event.stopPropagation()
        
        const selected = hotInstance.getSelected()
        if (!selected || selected.length === 0) return
        // Get the first selection range
        let [startRow, startCol, endRow, endCol] = selected[0]
        
        // Normalize selection: ensure startRow <= endRow and startCol <= endCol
        // (selection can be in reverse order when dragging left or up)
        if (startRow > endRow) {
          [startRow, endRow] = [endRow, startRow]
        }
        if (startCol > endCol) {
          [startCol, endCol] = [endCol, startCol]
        }
        
        // Fill down: each cell gets the value from the cell directly above it
        // Process each column independently
        const changes: Handsontable.CellChange[] = []
        // Collect all changes first, then apply them in a batch
        for (let col = startCol; col <= endCol; col++) {
          // For each column, fill down from top to bottom

          for (let row = startRow; row <= endRow; row++) {
            // Get the value from the cell directly above (row - 1)
            const sourceRow = row - 1
            if (sourceRow < 0) continue // Skip if we're at the top row
            
            const sourceValue = hotInstance.getDataAtCell(sourceRow, col)
            const oldValue = hotInstance.getDataAtCell(row, col)
            
            // Only set if there's a value to copy
            if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
              changes.push([row, col, oldValue, sourceValue])
            }
          }
        }
        // Apply all changes in a single batch to prevent flickering
        if (changes.length > 0) {
          // Set flag to prevent individual afterChange callbacks during batch
          isBatchOperationRef.current = true
          
          // Suspend rendering to batch all updates
          hotInstance.suspendRender()
          try {
            // Apply all changes
            for (const [row, col, _oldValue, newValue] of changes) {
              // Use 'CopyDown' as source to identify this operation
              hotInstance.setDataAtCell(row, col, newValue, 'CopyDown' as Handsontable.ChangeSource)
            }
          } finally {
            hotInstance.resumeRender()
            // Reset flag after render completes
            isBatchOperationRef.current = false
          }
          
          // Use requestAnimationFrame to ensure DOM is fully updated before triggering callback
          // This prevents the flickering where values appear, disappear, then reappear
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // Double RAF ensures the render is complete and parent state updates won't cause flicker
              if (afterChange) {
                afterChange(changes, 'CopyDown' as Handsontable.ChangeSource)
              }
            })
          })
        }
      }
    }
    
    rootElement.addEventListener('keydown', handleKeyDown)
    
    return () => {
      rootElement.removeEventListener('keydown', handleKeyDown)
    }
  }, [afterChange])

  // Single-click to open dropdown: on mousedown select cell and open editor immediately
  useEffect(() => {
    if (!hotTableRef.current?.hotInstance) return

    const hotInstance = hotTableRef.current.hotInstance

    const handleCellMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const cell = target.closest('td')
      if (!cell) return

      if (cell.closest('thead') || cell.closest('.ht_clone_top') || cell.closest('.ht_clone_left')) return

      let row: number | null = null
      let col: number | null = null
      try {
        const coords = hotInstance.getCoords(cell)
        if (coords && Array.isArray(coords) && coords.length >= 2) {
          row = coords[0]
          col = coords[1]
        }
      } catch {
        try {
          const rowElement = cell.closest('tr')
          if (rowElement?.parentElement) {
            const tbody = rowElement.parentElement
            const rowIndex = Array.from(tbody.children).indexOf(rowElement)
            const cellIndex = Array.from(rowElement.cells).indexOf(cell as HTMLTableCellElement)
            if (rowIndex >= 0 && cellIndex >= 0) {
              const hasRowHeaders = hotInstance.getSettings().rowHeaders
              row = hasRowHeaders ? rowIndex : rowIndex
              col = hasRowHeaders ? cellIndex - 1 : cellIndex
            }
          }
        } catch {
          return
        }
      }

      if (row === null || col === null || row < 0 || col < 0) return

      try {
        const cellProperties = hotInstance.getCellMeta(row, col)
        const isDropdown =
          cellProperties &&
          (cellProperties.type === 'dropdown' || cellProperties.editor === 'select' || (cellProperties as any).selectOptions)
        if (isDropdown && !hotInstance.isEditing()) {
          event.preventDefault()
          event.stopPropagation()
          hotInstance.selectCell(row, col)
          // Open editor on next tick so Handsontable has created the editor for the selected cell
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              try {
                if ((hotInstance as any).isDestroyed) return
                const editor = hotInstance.getActiveEditor()
                if (editor && typeof editor.beginEditing === 'function') {
                  editor.beginEditing()
                }
              } catch {
                // ignore
              }
            })
          })
        }
      } catch {
        // ignore
      }
    }

    const rootElement = hotInstance.rootElement
    rootElement.addEventListener('mousedown', handleCellMouseDown, true)

    return () => {
      rootElement.removeEventListener('mousedown', handleCellMouseDown, true)
    }
  }, [])

  // Handle context menu
  useEffect(() => {
    if (hotTableRef.current && onContextMenu) {
      const hotInstance = hotTableRef.current.hotInstance
      if (hotInstance) {
        const handleContextMenu = (event: MouseEvent) => {
          event.preventDefault()
          const td = (event.target as HTMLElement).closest('td')
          if (!td) return
          const coords = hotInstance.getCoords(td as any)
          if (coords && coords.row >= 0 && coords.col >= 0) {
            onContextMenu(coords.row, coords.col, event)
          }
        }
        
        const element = hotInstance.rootElement
        element.addEventListener('contextmenu', handleContextMenu)
        
        return () => {
          element.removeEventListener('contextmenu', handleContextMenu)
        }
      }
    }
  }, [onContextMenu])

  // Round horizontal scroll to whole pixels so column header clone stays aligned with body (no text shift)
  useEffect(() => {
    if (!hotTableRef.current?.hotInstance) return
    const hotInstance = hotTableRef.current.hotInstance
    const holder = hotInstance.rootElement?.querySelector('.ht_master .wtHolder') as HTMLElement | null
    if (!holder) return
    let rafId = 0
    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const left = holder.scrollLeft
        const rounded = Math.round(left)
        if (rounded !== left) holder.scrollLeft = rounded
      })
    }
    holder.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      holder.removeEventListener('scroll', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  // Sync row header column heights to match data rows (after render and when data changes)
  useEffect(() => {
    const hot = hotTableRef.current?.hotInstance
    if (!hot?.rootElement) return
    const run = () => syncRowHeaderHeightsToClone(hot)
    run()
    const t1 = requestAnimationFrame(run)
    const t2 = setTimeout(run, 100)
    return () => {
      cancelAnimationFrame(t1)
      clearTimeout(t2)
    }
  }, [data.length, dataVersion])

  return (
    <div style={style} className={className}>
      <HotTable
        ref={hotTableRef}
        settings={settings}
      />
    </div>
  )
}
