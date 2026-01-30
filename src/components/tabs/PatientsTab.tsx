import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Patient, IsLockPatients } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { Plus, Trash2 } from 'lucide-react'
import { currencyCellRenderer, percentCellRenderer } from '@/lib/handsontableCustomRenderers'
import { toDisplayValue, toStoredString } from '@/lib/utils'

interface PatientsTabProps {
  clinicId: string
  canEdit: boolean
  onDelete?: (patientId: string) => void
  isLockPatients?: IsLockPatients | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockPatients) => boolean
  isInSplitScreen?: boolean
}

export default function PatientsTab({ clinicId, canEdit, onDelete, isLockPatients, onLockColumn, isColumnLocked, isInSplitScreen }: PatientsTabProps) {
  const { userProfile } = useAuth()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const patientsRef = useRef<Patient[]>([])
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)
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

        // Cap at 200 rows: keep non-empty rows first, then empty rows; trim any excess
        const nonEmpty = updated.filter(p => !p.id.startsWith('empty-'))
        const emptyOnes = updated.filter(p => p.id.startsWith('empty-'))
        let result = [...nonEmpty, ...emptyOnes].slice(0, 200)

        // When there are no more empty rows (or fewer than 200), add empty rows to reach 200
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

        // Generate patient_id if missing
        let finalPatientId = patient.patient_id || ''
        if (!finalPatientId) {
          const timestamp = Date.now().toString().slice(-6)
          const initials = `${(patient.first_name || '').charAt(0)}${(patient.last_name || '').charAt(0)}`.toUpperCase() || 'PT'
          finalPatientId = `${initials}${timestamp}`
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
      console.log('[savePatients] Updating saved patients in place without reordering...')
      setPatients(currentPatients => {
        return currentPatients.map(patient => {
          const savedPatient = savedPatientsMap.get(patient.id)
          if (savedPatient) {
            // Normalize string "null" from DB so table never displays "null"
            return {
              ...savedPatient,
              first_name: (savedPatient.first_name != null && savedPatient.first_name !== 'null') ? savedPatient.first_name : '',
              last_name: (savedPatient.last_name != null && savedPatient.last_name !== 'null') ? savedPatient.last_name : '',
              insurance: (savedPatient.insurance != null && savedPatient.insurance !== 'null') ? savedPatient.insurance : null,
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
      return
    }

    try {
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', patientId)
      
      if (error) throw error
      
      await fetchPatients()
      if (onDelete) onDelete(patientId)
    } catch (error) {
      console.error('Error deleting patient:', error)
      alert(`Failed to delete patient: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [fetchPatients, onDelete])

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

  useEffect(() => {
    if (!canEdit || !onLockColumn || !isColumnLocked) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const addLockIconsToHeader = (headerRow: Element | null) => {
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
        const isLocked = isColumnLocked(columnName)
        let existingText = cellText || columnTitles[columnIndex] || `Column ${columnIndex + 1}`
        const wrapper = document.createElement('div')
        wrapper.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100%; position: relative;'
        const titleSpan = document.createElement('span')
        titleSpan.textContent = existingText
        titleSpan.style.flex = '1'
        wrapper.appendChild(titleSpan)
        const lockButton = document.createElement('button')
        lockButton.className = 'patient-lock-icon'
        lockButton.style.cssText = 'opacity: 0; transition: opacity 0.2s; padding: 2px; cursor: pointer; background: transparent; border: none; display: flex; align-items: center; color: currentColor;'
        lockButton.title = isLocked ? 'Click to unlock column' : 'Click to lock column'
        lockButton.innerHTML = isLocked
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V7a6 6 0 0 1 12 0v2"></path><rect x="3" y="9" width="18" height="12" rx="2"></rect></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12V7a3 3 0 0 1 6 0v5"></path><path d="M3 12h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9z"></path></svg>'
        lockButton.onclick = (e) => {
          e.stopPropagation()
          e.preventDefault()
          onLockColumn(columnName as string)
        }
        wrapper.appendChild(lockButton)
        th.innerHTML = ''
        th.appendChild(wrapper)
        th.style.position = 'relative'
        th.addEventListener('mouseenter', () => { lockButton.style.opacity = '1' })
        th.addEventListener('mouseleave', () => { lockButton.style.opacity = '0' })
      })
    }

    const addLockIcons = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      document.querySelectorAll('.patient-lock-icon').forEach(icon => {
        const th = icon.closest('th')
        if (th) {
          const wrapper = th.querySelector('div')
          if (wrapper) {
            const titleSpan = wrapper.querySelector('span')
            th.innerHTML = titleSpan?.textContent || ''
          }
        }
      })
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
    if (tableContainer) observer.observe(tableContainer, { childList: true, subtree: true, attributes: false })
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      observer.disconnect()
    }
  }, [canEdit, onLockColumn, isColumnLocked, isLockPatients])

  const getReadOnly = (columnName: keyof IsLockPatients): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  const patientsColumns = [
    { data: 0, title: 'Patient ID', type: 'text' as const, width: 120, readOnly: !canEdit || getReadOnly('patient_id') },
    { data: 1, title: 'Patient First', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('first_name') },
    { data: 2, title: 'Patient Last', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('last_name') },
    { data: 3, title: 'Insurance', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('insurance') },
    { data: 4, title: 'Copay', type: 'numeric' as const, width: 100, renderer: currencyCellRenderer, readOnly: !canEdit || getReadOnly('copay') },
    { data: 5, title: 'Coinsurance', type: 'numeric' as const, width: 100, renderer: percentCellRenderer, readOnly: !canEdit || getReadOnly('coinsurance') },
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
          const numValue = (newValue === '' || newValue === null || newValue === 'null') ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
          updatedPatients[row] = { ...patient, [field]: numValue, updated_at: new Date().toISOString() } as Patient
        } else if (field === 'insurance') {
          updatedPatients[row] = { ...patient, [field]: toStoredString(String(newValue ?? '')), updated_at: new Date().toISOString() } as Patient
        } else if (field) {
          updatedPatients[row] = { ...patient, [field]: toStoredString(String(newValue ?? '')) ?? '', updated_at: new Date().toISOString() } as Patient
        }
      }
    })

    if (updatedPatients.length > 200) {
      updatedPatients.splice(200)
    } else if (updatedPatients.length < 200) {
      const emptyRowsNeeded = 200 - updatedPatients.length
      const existingEmptyCount = updatedPatients.filter(p => p.id.startsWith('empty-')).length
      updatedPatients.push(...Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyPatient(existingEmptyCount + i)))
    }

    patientsRef.current = updatedPatients
    setPatients(updatedPatients)
    setTimeout(() => {
      savePatients(updatedPatients).catch(err => {
        console.error('[handlePatientsHandsontableChange] Error in savePatients:', err)
      })
    }, 0)
  }, [patients, savePatients, createEmptyPatient])

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

  const handlePatientsHandsontableContextMenu = useCallback((row: number, _col: number, event: MouseEvent) => {
    event.preventDefault()
    if (!canEdit) return
    const patient = patients[row]
    if (patient) {
      setTableContextMenu({ x: event.clientX, y: event.clientY, rowIndex: row })
    }
  }, [patients, canEdit])

  const handleContextMenuAddRow = useCallback(() => {
    if (tableContextMenu == null) return
    const { rowIndex } = tableContextMenu
    const existingEmptyCount = patients.filter(p => p.id.startsWith('empty-')).length
    const newRow = createEmptyPatient(existingEmptyCount)
    const updated = [...patients.slice(0, rowIndex + 1), newRow, ...patients.slice(rowIndex + 1)]
    const capped = updated.length > 200 ? updated.slice(0, 200) : updated
    const toSave = capped.length < 200
      ? [...capped, ...Array.from({ length: 200 - capped.length }, (_, i) => createEmptyPatient(existingEmptyCount + 1 + i))]
      : capped
    patientsRef.current = toSave
    setPatients(toSave)
    savePatients(toSave).catch(err => console.error('savePatients after add row', err))
    setTableContextMenu(null)
  }, [tableContextMenu, patients, createEmptyPatient, savePatients])

  const handleContextMenuDeleteRow = useCallback(() => {
    if (tableContextMenu == null) return
    const patient = patients[tableContextMenu.rowIndex]
    if (!patient) {
      setTableContextMenu(null)
      return
    }
    if (patient.id.startsWith('empty-') || patient.id.startsWith('new-')) {
      const updated = patients.filter((_, i) => i !== tableContextMenu.rowIndex)
      const emptyNeeded = Math.max(0, 200 - updated.length)
      const existingEmpty = updated.filter(p => p.id.startsWith('empty-')).length
      const toSave = emptyNeeded > existingEmpty
        ? [...updated, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyPatient(existingEmpty + i))]
        : updated.slice(0, 200)
      patientsRef.current = toSave
      setPatients(toSave)
      savePatients(toSave).catch(err => console.error('savePatients after delete row', err))
    } else {
      handleDeletePatient(patient.id)
    }
    setTableContextMenu(null)
  }, [tableContextMenu, patients, createEmptyPatient, savePatients, handleDeletePatient])

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
          overflowX: 'auto', 
          overflowY: 'auto',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`patients-${clinicId}`}
          data={getPatientsHandsontableData()}
          columns={patientsColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          afterChange={handlePatientsHandsontableChange}
          onContextMenu={handlePatientsHandsontableContextMenu}
          enableFormula={true}
          readOnly={!canEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom"
        />
      </div>

      {tableContextMenu != null && (
        <div
          ref={tableContextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[160px]"
          style={{ left: tableContextMenu.x, top: tableContextMenu.y }}
        >
          <button
            type="button"
            onClick={handleContextMenuAddRow}
            className="w-full text-left px-4 py-2 text-white hover:bg-white/10 flex items-center gap-2"
          >
            <Plus size={16} />
            Add row
          </button>
          <button
            type="button"
            onClick={handleContextMenuDeleteRow}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete row
          </button>
        </div>
      )}
    </div>
  )
}
