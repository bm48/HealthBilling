import Handsontable from 'handsontable'

/**
 * Custom renderer for dropdown cells with background colors
 */
export function createColoredDropdownRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    instance: any,
    td: HTMLElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    const colorConfig = value ? colorMap(String(value)) : null
    if (colorConfig) {
      td.style.backgroundColor = colorConfig.color
      td.style.color = colorConfig.textColor
      td.style.fontWeight = '500'
    } else {
      td.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
      td.style.color = '#000000'
      td.style.fontWeight = 'normal'
    }
    
    textRenderer(instance, td as HTMLTableCellElement, row, col, prop, value || '', cellProperties)
  }
}

/**
 * Custom editor for dropdown cells with colors
 */
export function createColoredDropdownEditor(
  _options: string[],
  colorMap: (value: string) => { color: string; textColor: string } | null
) {
  return class ColoredDropdownEditor extends Handsontable.editors.SelectEditor {
    beginEditing(initialValue?: string) {
      super.beginEditing(initialValue)
      
      const select = (this as any).select as HTMLSelectElement
      if (select) {
        // Style the select element
        const currentValue = select.value
        const colorConfig = currentValue ? colorMap(currentValue) : null
        if (colorConfig) {
          select.style.backgroundColor = colorConfig.color
          select.style.color = colorConfig.textColor
          select.style.fontWeight = '500'
        }
        
        // Style options
        Array.from(select.options).forEach(option => {
          const optionColorConfig = option.value ? colorMap(option.value) : null
          if (optionColorConfig) {
            option.style.backgroundColor = optionColorConfig.color
            option.style.color = optionColorConfig.textColor
            option.style.fontWeight = '500'
          } else {
            option.style.backgroundColor = '#ffffff'
            option.style.color = '#000000'
          }
        })
        
        // Update on change
        select.addEventListener('change', () => {
          const newValue = select.value
          const newColorConfig = newValue ? colorMap(newValue) : null
          if (newColorConfig) {
            select.style.backgroundColor = newColorConfig.color
            select.style.color = newColorConfig.textColor
            select.style.fontWeight = '500'
          } else {
            select.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
            select.style.color = '#000000'
            select.style.fontWeight = 'normal'
          }
        })
      }
    }
  }
}

/**
 * Custom renderer for date cells
 */
export function createDateRenderer() {
  return function(
    instance: any,
    td: HTMLElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    // Format date for display
    const displayValue = value ? String(value) : ''
    textRenderer(instance, td as HTMLTableCellElement, row, col, prop, displayValue, cellProperties)
  }
}

/**
 * Custom renderer for month selector with colors
 */
export function createMonthRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    instance: any,
    td: HTMLElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    const colorConfig = value ? colorMap(String(value)) : null
    if (colorConfig) {
      td.style.backgroundColor = colorConfig.color
      td.style.color = colorConfig.textColor
      td.style.fontWeight = '500'
    } else {
      td.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
      td.style.color = '#000000'
      td.style.fontWeight = 'normal'
    }
    
    textRenderer(instance, td as HTMLTableCellElement, row, col, prop, value || '', cellProperties)
  }
}

/**
 * Custom renderer for CPT code with colors
 */
export function createCPTCodeRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    instance: any,
    td: HTMLElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    // Handle comma-separated CPT codes - use first one for color
    const primaryCode = value ? String(value).split(',')[0].trim() : ''
    const colorConfig = primaryCode ? colorMap(primaryCode) : null
    if (colorConfig) {
      td.style.backgroundColor = colorConfig.color
      td.style.color = colorConfig.textColor || '#ffffff'
      td.style.fontWeight = '500'
    } else {
      td.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
      td.style.color = '#000000'
      td.style.fontWeight = 'normal'
    }
    
    textRenderer(instance, td as HTMLTableCellElement, row, col, prop, value || '', cellProperties)
  }
}
