import { useRef, useEffect, useMemo } from 'react'
import { HotTable } from '@handsontable/react'
import Handsontable from 'handsontable'
import { HyperFormula } from 'hyperformula'
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
    
    // Handle dropdown type
    if (col.type === 'dropdown' && col.selectOptions) {
      processedCol.type = 'text' as const
      processedCol.editor = 'select'
      processedCol.selectOptions = col.selectOptions
      processedCol.strict = col.strict !== false
    }
    
    // Handle date type
    if (col.type === 'date') {
      processedCol.type = 'date' as const
      processedCol.dateFormat = col.format || 'YYYY-MM-DD'
      processedCol.correctFormat = true
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
    return processedCol
  }), [columns])

  if (processedColumns.length > 0) {
    console.log('processedColumns: ', processedColumns.map(col => col.readOnly).join(', '))
  }

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
      pasteMode: 'shift_down',
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
