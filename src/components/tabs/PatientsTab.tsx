import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { Patient, IsLockPatients } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { Plus, Trash2 } from 'lucide-react'
import { copayTextCellRenderer, coinsuranceTextCellRenderer } from '@/lib/handsontableCustomRenderers'
import { toDisplayValue, toStoredString } from '@/lib/utils'

interface PatientsTabProps {
  clinicId: string
  canEdit: boolean
  onDelete?: (patientId: string) => void
  onRegisterUndo?: (undo: () => void) => void
  isLockPatients?: IsLockPatients | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockPatients) => boolean
  isInSplitScreen?: boolean
}

export default function PatientsTab({ clinicId, canEdit, onDelete, onRegisterUndo, isLockPatients, onLockColumn, isColumnLocked, isInSplitScreen }: PatientsTabProps) {
  const { userProfile } = useAuth()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const patientsRef = useRef<Patient[]>([])
  const tableContainerRef = useRef<HTMLDivElement>(null)
  /** Stable temporary patient_id per row id so multiple cell edits on a new row upsert one record, not one per edit */
  const pendingPatientIdByRowIdRef = useRef<Map<string, string>>(new Map())
  const savePatientsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const [structureVersion, setStructureVersion] = useState(0)
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())
  const lockData = isLockPatients || null

  const createEmptyPatient = useCallback((index: number): Patient => ({
    id: `empty-${index}`,
    clinic_id: clinicId,
    patient_id: '',
    first_name: '',
    last_name: '',
    subscriber_id: null,
    insurance: null,
    copay: null,
    coinsurance: null,
    date_of_birth: null,
    phone: null,
    email: null,
    address: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }), [clinicId])

  const fetchPatients = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        // No sorting - preserve exact order from database (typically creation order)

      if (error) throw error
      const fetchedPatients = data || []
      
      setPatients(currentPatients => {
        const fetchedPatientsMap = new Map<string, Patient>()
        fetchedPatients.forEach(p => fetchedPatientsMap.set(p.id, p))

        // Preserve visual table order: walk current rows in order (like BillingTodoTab / AccountsReceivableTab)
        const preservedOrder: Patient[] = []
        currentPatients.forEach(p => {
          if (p.id.startsWith('new-') || p.id.startsWith('empty-')) {
            preservedOrder.push(p)
          } else {
            const freshData = fetchedPatientsMap.get(p.id)
            if (freshData) {
              preservedOrder.push({
                ...freshData,
                first_name: (freshData.first_name != null && freshData.first_name !== 'null') ? freshData.first_name : '',
                last_name: (freshData.last_name != null && freshData.last_name !== 'null') ? freshData.last_name : '',
                insurance: (freshData.insurance != null && freshData.insurance !== 'null') ? freshData.insurance : null,
              })
              fetchedPatientsMap.delete(p.id)
            }
          }
        })
        const newFetchedPatients = Array.from(fetchedPatientsMap.values()).map(px => ({
          ...px,
          first_name: (px.first_name != null && px.first_name !== 'null') ? px.first_name : '',
          last_name: (px.last_name != null && px.last_name !== 'null') ? px.last_name : '',
          insurance: (px.insurance != null && px.insurance !== 'null') ? px.insurance : null,
        }))
        const updated = [...preservedOrder, ...newFetchedPatients]

        // Keep non-empty rows first, then empty rows (allow more than 200 rows)
        const nonEmpty = updated.filter(p => !p.id.startsWith('empty-'))
        const emptyOnes = updated.filter(p => p.id.startsWith('empty-'))
        let result = [...nonEmpty, ...emptyOnes]

        // When fewer than 200 rows, add empty rows to reach 200
        const totalRows = result.length
        const emptyRowsNeeded = Math.max(0, 200 - totalRows)
        const existingEmptyCount = result.filter(p => p.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyPatient(existingEmptyCount + i)
        )
        return [...result, ...newEmptyRows]
      })
    } catch (error) {
      console.error('Error fetching patients:', error)
    } finally {
      setLoading(false)
    }
  }, [clinicId, createEmptyPatient])

  useEffect(() => {
    patientsRef.current = patients
  }, [patients])

  useEffect(() => {
    return () => {
      if (savePatientsTimeoutRef.current) clearTimeout(savePatientsTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (clinicId) {
      fetchPatients()
    }
  }, [clinicId, fetchPatients])

  const savePatients = useCallback(async (patientsToSave: Patient[]) => {

    if (!clinicId || !userProfile) {
      console.log('[savePatients] Early return - missing clinicId or userProfile', { clinicId, hasUserProfile: !!userProfile })
      return
    }

    // Filter out only truly empty rows (empty- patients with no data)
    // Allow empty- patients that have data to be processed (they'll be inserted as new patients)
    const patientsToProcess = patientsToSave.filter(p => {
      const hasData = p.patient_id || p.first_name || p.last_name || p.insurance || p.copay !== null || p.coinsurance !== null
      // If it's an empty- patient, only include it if it has data
      if (p.id.startsWith('empty-')) {
        return hasData
      }
      // For all other patients (new- or real IDs), include if they have data
      return hasData
    })
    
    
    if (patientsToProcess.length === 0) {
      console.log('[savePatients] No patients to process - all filtered out')
      return
    }

    try {
      // Store saved patients with their database responses to update in place
      const savedPatientsMap = new Map<string, Patient>() // Map old ID -> new Patient data
      
      // Process each patient
      for (let i = 0; i < patientsToProcess.length; i++) {
        const patient = patientsToProcess[i]
        const oldId = patient.id // Store the old ID to find it in state

        // Generate patient_id if missing; reuse same temp id for this row so multiple cell edits upsert one record
        let finalPatientId = patient.patient_id || ''
        if (!finalPatientId) {
          const existing = pendingPatientIdByRowIdRef.current.get(oldId)
          if (existing) {
            finalPatientId = existing
          } else {
            const timestamp = Date.now().toString().slice(-6)
            const initials = `${(patient.first_name || '').charAt(0)}${(patient.last_name || '').charAt(0)}`.toUpperCase() || 'PT'
            finalPatientId = `${initials}${timestamp}`
            pendingPatientIdByRowIdRef.current.set(oldId, finalPatientId)
          }
        }

        // Prepare patient data (never send string "null" to DB)
        const patientData: any = {
          clinic_id: clinicId,
          patient_id: finalPatientId,
          first_name: (patient.first_name && patient.first_name !== 'null') ? patient.first_name : null,
          last_name: (patient.last_name && patient.last_name !== 'null') ? patient.last_name : null,
          insurance: (patient.insurance && patient.insurance !== 'null') ? patient.insurance : null,
          copay: patient.copay != null ? patient.copay : null,
          coinsurance: patient.coinsurance != null ? patient.coinsurance : null,
          updated_at: new Date().toISOString(),
        }


        let savedPatient: Patient | null = null

        // If patient has a real database ID (not new- or empty-), update by ID
        if (!patient.id.startsWith('new-') && !patient.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await supabase
            .from('patients')
            .update(patientData)
            .eq('id', patient.id)
            .select()


          if (!updateError && updateData && updateData.length > 0) {
            savedPatient = updateData[0] as Patient
            savedPatientsMap.set(oldId, savedPatient)
            continue // Update successful, move to next patient
          }
          console.log(`[savePatients] UPDATE failed, will try UPSERT:`, updateError)
          // If update failed (e.g., patient not found), fall through to upsert
        }

        // Use upsert for new patients (new- or empty- IDs) or when update by ID fails
        // Upsert handles the unique constraint (clinic_id, patient_id) automatically
        console.log(`[savePatients] Attempting UPSERT for patient_id: ${finalPatientId} (patient ID: ${patient.id})`)
        const { error: upsertError, data: upsertData } = await supabase
          .from('patients')
          .upsert(patientData, {
            onConflict: 'clinic_id,patient_id',
            ignoreDuplicates: false
          })
          .select()

        console.log(`[savePatients] UPSERT result:`, { upsertError, upsertData })

        if (upsertError) {
          console.error('[savePatients] Error upserting patient:', upsertError, patientData)
          throw upsertError
        }
        
        if (upsertData && upsertData.length > 0) {
          savedPatient = upsertData[0] as Patient
          savedPatientsMap.set(oldId, savedPatient) // Map old ID to new patient data
          console.log(`[savePatients] Successfully saved patient: ${finalPatientId}, new DB ID: ${savedPatient.id}`)
        }
      }

      // Update patients in place without reordering - preserve exact row positions
      // Clear pending ref only inside setState so we don't clear before state has updated (would cause next save to generate new patient_id and insert again)
      console.log('[savePatients] Updating saved patients in place without reordering...')
      setPatients(currentPatients => {
        return currentPatients.map(patient => {
          const savedPatient = savedPatientsMap.get(patient.id)
          if (savedPatient) {
            pendingPatientIdByRowIdRef.current.delete(patient.id)
            // Normalize string "null" from DB so table never displays "null"
            return {
              ...savedPatient,
              first_name: (savedPatient.first_name != null && savedPatient.first_name !== 'null') ? savedPatient.first_name : '',
              last_name: (savedPatient.last_name != null && savedPatient.last_name !== 'null') ? savedPatient.last_name : '',
              insurance: (savedPatient.insurance != null && savedPatient.insurance !== 'null') ? savedPatient.insurance : null,
              copay: (savedPatient.copay != null && String(savedPatient.copay) !== 'null') ? savedPatient.copay : null,
              coinsurance: (savedPatient.coinsurance != null && String(savedPatient.coinsurance) !== 'null') ? savedPatient.coinsurance : null,
            }
          }
          return patient // Keep all other patients exactly as they are
        })
      })
      
      console.log('[savePatients] All patients updated in place - positions preserved')
    } catch (error: any) {
      console.error('[savePatients] Error saving patients:', error)
      alert(error?.message || 'Failed to save patient. Please try again.')
    }
  }, [clinicId, userProfile, fetchPatients])

  // Note: savePatientsImmediately removed - we now call savePatients directly with updated data
  // Note: handleUpdatePatient removed - state is updated directly in handlePatientsHandsontableChange

  const handleDeletePatient = useCallback(async (patientId: string) => {
    if (patientId.startsWith('new-')) {
      setPatients(prev => prev.filter(p => p.id !== patientId))
      setStructureVersion(v => v + 1)
      return
    }

    try {
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', patientId)
      
      if (error) throw error
      
      await fetchPatients()
      setStructureVersion(v => v + 1)
      if (onDelete) onDelete(patientId)
    } catch (error) {
      console.error('Error deleting patient:', error)
      alert(`Failed to delete patient: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [fetchPatients, onDelete])

  // Reorder patients when user drags a row; persist order via created_at so reload preserves it
  const handlePatientsRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    setPatients(prev => {
      const arr = [...prev]
      const toMove = movedRows.map(i => arr[i])
      movedRows.sort((a, b) => b - a).forEach(i => arr.splice(i, 1))
      const insertAt = Math.min(finalIndex, arr.length)
      toMove.forEach((item, i) => arr.splice(insertAt + i, 0, item))
      const next = arr
      const realPatients = next.filter(p => !p.id.startsWith('empty-') && !p.id.startsWith('new-'))
      if (realPatients.length > 0) {
        const baseTime = Date.now()
        Promise.all(
          realPatients.map((patient, i) =>
            supabase
              .from('patients')
              .update({ created_at: new Date(baseTime - i * 1000).toISOString() })
              .eq('id', patient.id)
          )
        ).catch(err => console.error('Failed to persist patient order', err))
      }
      return next
    })
    setStructureVersion(v => v + 1)
  }, [])

  const getPatientsHandsontableData = useCallback(() => {
    return patients.map(patient => [
      toDisplayValue(patient.patient_id),
      toDisplayValue(patient.first_name),
      toDisplayValue(patient.last_name),
      toDisplayValue(patient.insurance),
      toDisplayValue(patient.copay),
      toDisplayValue(patient.coinsurance),
    ])
  }, [patients])
  const columnFields: Array<keyof IsLockPatients> = ['patient_id', 'first_name', 'last_name', 'insurance', 'copay', 'coinsurance']
  const columnTitles = ['Patient ID', 'Patient First', 'Patient Last', 'Insurance', 'Copay', 'Coinsurance']

  const patientsCellsCallback = useCallback(
    (row: number, col: number) => {
      const patient = patients[row]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${patient?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key) ? { className: 'cell-highlight-yellow' } : {}
    },
    [patients, columnFields, highlightedCells]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const patient = patients[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${patient?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [patients, columnFields, highlightedCells]
  )

  const handleCellHighlight = useCallback((row: number, col: number) => {
    const patient = patients[row]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${patient?.id ?? `row-${row}`}:${colKey}`
    setHighlightedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [patients, columnFields])

  // Right-click on column headers to lock/unlock (no lock icon in header)
  useEffect(() => {
    if (!canEdit || !onLockColumn || !isColumnLocked) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
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
      const isLocked = isColumnLocked(columnName as keyof IsLockPatients)
      const menu = document.createElement('div')
      menu.className = 'patient-col-header-context-menu'
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
        let cellText = th.textContent?.trim() || ''
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
        const prev = (el as any)._patientHeaderContext
        if (prev) el.removeEventListener('contextmenu', prev)
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._patientHeaderContext = handler
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
        const h = (th as any)._patientHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
    }
  }, [canEdit, onLockColumn, isColumnLocked, isLockPatients])

  const getReadOnly = (columnName: keyof IsLockPatients): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  const patientsColumns = [
    { data: 0, title: 'Patient ID', type: 'text' as const, width: 120, readOnly: !canEdit || getReadOnly('patient_id'), columnSorting: { indicator: true } },
    { data: 1, title: 'Patient First', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('first_name'), columnSorting: { headerAction: false } },
    { data: 2, title: 'Patient Last', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('last_name'), columnSorting: { headerAction: false } },
    { data: 3, title: 'Insurance', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('insurance'), columnSorting: { headerAction: false } },
    { data: 4, title: 'Copay', type: 'text' as const, width: 100, renderer: copayTextCellRenderer, readOnly: !canEdit || getReadOnly('copay'), columnSorting: { headerAction: false } },
    { data: 5, title: 'Coinsurance', type: 'text' as const, width: 100, renderer: coinsuranceTextCellRenderer, readOnly: !canEdit || getReadOnly('coinsurance'), columnSorting: { headerAction: false } },
  ]
  
  const handlePatientsHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return

    const currentPatients = patientsRef.current.length > 0 ? patientsRef.current : patients
    const updatedPatients = [...currentPatients]
    const fields: Array<keyof Patient> = ['patient_id', 'first_name', 'last_name', 'insurance', 'copay', 'coinsurance']

    changes.forEach(([row, col, , newValue]) => {
      while (updatedPatients.length <= row) {
        const existingEmptyCount = updatedPatients.filter(p => p.id.startsWith('empty-')).length
        updatedPatients.push(createEmptyPatient(existingEmptyCount))
      }
      const patient = updatedPatients[row]
      if (patient) {
        const field = fields[col as number]
        if (field === 'copay' || field === 'coinsurance') {
          const strValue = (newValue === '' || newValue === null || newValue === 'null' || newValue === undefined) ? null : String(newValue)
          updatedPatients[row] = { ...patient, [field]: strValue, updated_at: new Date().toISOString() } as Patient
        } else if (field === 'insurance') {
          updatedPatients[row] = { ...patient, [field]: toStoredString(String(newValue ?? '')), updated_at: new Date().toISOString() } as Patient
        } else if (field) {
          updatedPatients[row] = { ...patient, [field]: toStoredString(String(newValue ?? '')) ?? '', updated_at: new Date().toISOString() } as Patient
        }
      }
    })

    if (updatedPatients.length < 200) {
      const emptyRowsNeeded = 200 - updatedPatients.length
      const existingEmptyCount = updatedPatients.filter(p => p.id.startsWith('empty-')).length
      updatedPatients.push(...Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyPatient(existingEmptyCount + i)))
    }

    patientsRef.current = updatedPatients
    setPatients(updatedPatients)

    // Debounce save so typing multiple cells on a new row upserts one record, not one per cell
    if (savePatientsTimeoutRef.current) clearTimeout(savePatientsTimeoutRef.current)
    savePatientsTimeoutRef.current = setTimeout(() => {
      savePatientsTimeoutRef.current = null
      savePatients(patientsRef.current).catch(err => {
        console.error('[handlePatientsHandsontableChange] Error in savePatients:', err)
      })
    }, 500)
  }, [patients, savePatients, createEmptyPatient])

  const [tableContextMenu, setTableContextMenu] = useState<{ x: number; y: number; rowIndex: number; patientId: string } | null>(null)
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

  const handlePatientsHandsontableContextMenu = useCallback((row: number, _col: number, event: MouseEvent) => {
    event.preventDefault()
    if (!canEdit) return
    const patient = patients[row]
    if (patient) {
      setTableContextMenu({ x: event.clientX, y: event.clientY, rowIndex: row, patientId: patient.id })
    }
  }, [patients, canEdit])

  const handleContextMenuAddRowBelow = useCallback(() => {
    if (tableContextMenu == null) return
    const rowIndex = patients.findIndex(p => p.id === tableContextMenu.patientId)
    if (rowIndex === -1) { setTableContextMenu(null); return }
    const existingEmptyCount = patients.filter(p => p.id.startsWith('empty-')).length
    const newRow = createEmptyPatient(existingEmptyCount)
    const updated = [...patients.slice(0, rowIndex + 1), newRow, ...patients.slice(rowIndex + 1)]
    const toSave = updated.length < 200
      ? [...updated, ...Array.from({ length: 200 - updated.length }, (_, i) => createEmptyPatient(existingEmptyCount + 1 + i))]
      : updated
    patientsRef.current = toSave
    setPatients(toSave)
    setStructureVersion(v => v + 1)
    savePatients(toSave).catch(err => console.error('savePatients after add row', err))
    setTableContextMenu(null)
  }, [tableContextMenu, patients, createEmptyPatient, savePatients])

  const handleContextMenuAddRowAbove = useCallback(() => {
    if (tableContextMenu == null) return
    const rowIndex = patients.findIndex(p => p.id === tableContextMenu.patientId)
    if (rowIndex === -1) { setTableContextMenu(null); return }
    const existingEmptyCount = patients.filter(p => p.id.startsWith('empty-')).length
    const newRow = createEmptyPatient(existingEmptyCount)
    const updated = [...patients.slice(0, rowIndex), newRow, ...patients.slice(rowIndex)]
    const toSave = updated.length < 200
      ? [...updated, ...Array.from({ length: 200 - updated.length }, (_, i) => createEmptyPatient(existingEmptyCount + 1 + i))]
      : updated
    patientsRef.current = toSave
    setPatients(toSave)
    setStructureVersion(v => v + 1)
    savePatients(toSave).catch(err => console.error('savePatients after add row', err))
    setTableContextMenu(null)
  }, [tableContextMenu, patients, createEmptyPatient, savePatients])

  const handleContextMenuDeleteRow = useCallback(() => {
    if (tableContextMenu == null) return
    const rowIndex = patients.findIndex(p => p.id === tableContextMenu.patientId)
    const patient = rowIndex >= 0 ? patients[rowIndex] : null
    if (!patient) {
      setTableContextMenu(null)
      return
    }
    const deletedPatient = { ...patient }
    if (patient.id.startsWith('empty-') || patient.id.startsWith('new-')) {
      const updated = patients.filter(p => p.id !== tableContextMenu.patientId)
      const emptyNeeded = Math.max(0, 200 - updated.length)
      const existingEmpty = updated.filter(p => p.id.startsWith('empty-')).length
      const toSave = emptyNeeded > existingEmpty
        ? [...updated, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyPatient(existingEmpty + i))]
        : updated
      patientsRef.current = toSave
      setPatients(toSave)
      setStructureVersion(v => v + 1)
      savePatients(toSave).catch(err => console.error('savePatients after delete row', err))
      onRegisterUndo?.(() => {
        setPatients(prev => {
          const next = [...prev.slice(0, rowIndex), deletedPatient, ...prev.slice(rowIndex)].slice(0, 200)
          patientsRef.current = next
          savePatients(next).catch(err => console.error('savePatients after undo delete row', err))
          return next
        })
        setStructureVersion(v => v + 1)
      })
    } else {
      onRegisterUndo?.(() => {
        supabase
          .from('patients')
          .insert(deletedPatient)
          .then(() => {
            // Restore at original position in state instead of refetching (fetchPatients would append and put row at bottom)
            setPatients(prev => {
              const next = [...prev.slice(0, rowIndex), deletedPatient, ...prev.slice(rowIndex)].slice(0, 200)
              patientsRef.current = next
              return next
            })
            setStructureVersion(v => v + 1)
          }, (err: unknown) => console.error('Undo delete patient: re-insert failed', err))
      })
      handleDeletePatient(patient.id)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, patients, createEmptyPatient, savePatients, handleDeletePatient, onRegisterUndo])

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
        <div className="text-center text-white/70 py-8">Loading patients...</div>
      </div>
    )
  }

  return (
    <div 
      className="p-6" 
      style={isInSplitScreen ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}
    >
      <div 
        ref={tableContainerRef}
        className="table-container dark-theme" 
        style={{ 
          maxHeight: isInSplitScreen ? undefined : '600px',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`patients-${clinicId}`}
          data={getPatientsHandsontableData()}
          dataVersion={structureVersion}
          columns={patientsColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          afterChange={handlePatientsHandsontableChange}
          onAfterRowMove={handlePatientsRowMove}
          onContextMenu={handlePatientsHandsontableContextMenu}
          onCellHighlight={handleCellHighlight}
          getCellIsHighlighted={getCellIsHighlighted}
          cells={patientsCellsCallback}
          enableFormula={true}
          columnSorting={{ indicator: true }}
          readOnly={!canEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom billing-todo-sortable"
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
