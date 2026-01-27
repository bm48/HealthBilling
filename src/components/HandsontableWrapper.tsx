import { useRef, useEffect, useMemo } from 'react'
import { HotTable } from '@handsontable/react'
import Handsontable from 'handsontable'
import { HyperFormula } from 'hyperformula'
import { DateEditor } from '@/lib/handsontableCustomRenderers'
import 'handsontable/dist/handsontable.full.css'

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
  onContextMenu?: (row: number, col: number) => void
  readOnly?: boolean
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
}: HandsontableWrapperProps) {
  const hotTableRef = useRef<any>(null)
  const hyperformulaInstanceRef = useRef<HyperFormula | null>(null)
  const isBatchOperationRef = useRef<boolean>(false)

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
    if (data.length > 0) {
      // console.log('data**************************: ', data.length, 'rows')
      // Force Handsontable to update when data length changes
      if (hotTableRef.current?.hotInstance) {
        const hotInstance = hotTableRef.current.hotInstance
        // Update the data to ensure Handsontable recognizes all rows
        hotInstance.updateSettings({
          data: data
        })
        // console.log('[HandsontableWrapper] Updated Handsontable with', data.length, 'rows')
      }
    }
  }, [data])
  
  // Process columns to handle numeric type and custom renderers/editors
  const processedColumns = useMemo(() => columns.map(col => {
    const processedCol: any = { ...col }
    
    if (col.type === 'numeric') {
      processedCol.type = 'text' as const // Use text type as base since numeric may not be registered
      processedCol.editor = 'text'
      // Numeric validation and formatting will be handled in the change handler
    }
    
    // Handle dropdown type - use autocomplete with strict mode (dropdown is based on autocomplete)
    if (col.type === 'dropdown' && col.selectOptions) {
      processedCol.type = 'autocomplete' as const // Use autocomplete type (dropdown is based on this)
      processedCol.source = col.selectOptions // Use source for autocomplete
      processedCol.strict = col.strict !== false // Enable strict mode for dropdown-like behavior
      processedCol.filter = false // Disable filtering for dropdown behavior
      // Remove selectOptions as autocomplete uses source
      delete processedCol.selectOptions
    }
    
    // Handle date type - use text type with custom date editor
    if (col.type === 'date' || processedCol.type === 'date') {
      processedCol.type = 'text' as const // Use text type to avoid registration errors
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
    // Allow date, text, autocomplete types
    if (processedCol.type && 
        processedCol.type !== 'date' && 
        processedCol.type !== 'text' &&
        processedCol.type !== 'autocomplete') {
      // If type is invalid and we have an editor, use text as fallback
      if (processedCol.editor && processedCol.editor !== DateEditor) {
        processedCol.type = 'text' as const
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
    data,
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
    // Set fixed row height to prevent auto-resizing
    rowHeights: undefined, // Let CSS control it, but we'll set a fixed height in CSS
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
    
    // Column sorting
    columnSorting: true,
    
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
    
    // Custom keyboard shortcuts
    customBorders: true,
    
    // Enable search
    search: true,
    
    // Enable filters
    dropdownMenu: false,
    
    // Enable comments
    comments: false,
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

  // Enable single-click editing for dropdown cells
  useEffect(() => {
    if (!hotTableRef.current?.hotInstance) return
    
    const hotInstance = hotTableRef.current.hotInstance
    
    const handleCellMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const cell = target.closest('td')
      if (!cell) return
      
      // Skip if clicking on header cells or other non-data cells
      if (cell.closest('thead') || cell.closest('.ht_clone_top') || cell.closest('.ht_clone_left')) {
        return
      }
      
      // Get cell coordinates using getCoords with proper error handling
      let row: number | null = null
      let col: number | null = null
      
      try {
        const coords = hotInstance.getCoords(cell)
        // Check if coords is a valid array-like object
        if (coords && Array.isArray(coords) && coords.length >= 2) {
          row = coords[0]
          col = coords[1]
        }
      } catch (error) {
        // If getCoords fails, try alternative method using row/col indices
        try {
          const rowElement = cell.closest('tr')
          if (rowElement && rowElement.parentElement) {
            const tbody = rowElement.parentElement
            const rowIndex = Array.from(tbody.children).indexOf(rowElement)
            const cellIndex = Array.from(rowElement.cells).indexOf(cell as HTMLTableCellElement)
            
            if (rowIndex >= 0 && cellIndex >= 0) {
              // Adjust for row headers if present
              const hasRowHeaders = hotInstance.getSettings().rowHeaders
              row = hasRowHeaders ? rowIndex : rowIndex
              col = hasRowHeaders ? cellIndex - 1 : cellIndex
            }
          }
        } catch (e) {
          return
        }
      }
      
      // Validate coordinates
      if (row === null || col === null || row < 0 || col < 0) return
      
      // Check if the cell has a dropdown editor
      try {
        const cellProperties = hotInstance.getCellMeta(row, col)
        if (cellProperties && (cellProperties.type === 'dropdown' || cellProperties.editor === 'select')) {
          // Only trigger if clicking on the bubble or cell, not if already editing
          if (!hotInstance.isEditing()) {
            event.preventDefault()
            event.stopPropagation()
            
            // Select the cell and open editor
            hotInstance.selectCell(row, col)
            setTimeout(() => {
              const editor = hotInstance.getActiveEditor()
              if (editor) {
                editor.beginEditing()
              }
            }, 10)
          }
        }
      } catch (error) {
        // Silently fail if cell meta cannot be retrieved
        return
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
          const coords = hotInstance.getSelectedLast()
          if (coords) {
            onContextMenu(coords[0], coords[1])
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

  return (
    <div style={style} className={className}>
      <HotTable
        ref={hotTableRef}
        settings={settings}
      />
    </div>
  )
}
