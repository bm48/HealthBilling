import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Patient, IsLockPatients } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'

interface PatientsTabProps {
  clinicId: string
  canEdit: boolean
  onDelete?: (patientId: string) => void
  isLockPatients?: IsLockPatients | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockPatients) => boolean
}

export default function PatientsTab({ clinicId, canEdit, onDelete, isLockPatients, onLockColumn, isColumnLocked }: PatientsTabProps) {
  const { userProfile } = useAuth()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const patientsRef = useRef<Patient[]>([])
  
  // Use isLockPatients from props, with local state as fallback
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

  // No need for fetchLockData - we use isLockPatients from props

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
        // Separate unsaved patients (new- and empty-)
        const unsavedPatients = currentPatients.filter(p => p.id.startsWith('new-') || p.id.startsWith('empty-'))
        
        // Create a map of existing patients by their database ID to preserve order
        const existingPatientsMap = new Map<string, Patient>()
        currentPatients.forEach(p => {
          // Only include patients with real database IDs (not new- or empty-)
          if (!p.id.startsWith('new-') && !p.id.startsWith('empty-')) {
            existingPatientsMap.set(p.id, p)
          }
        })
        
        // Create a map of fetched patients by ID
        const fetchedPatientsMap = new Map<string, Patient>()
        fetchedPatients.forEach(p => {
          fetchedPatientsMap.set(p.id, p)
        })
        
        // Preserve the order of existing patients, updating them with fresh data from database
        const preservedOrder: Patient[] = []
        currentPatients.forEach(p => {
          if (!p.id.startsWith('new-') && !p.id.startsWith('empty-')) {
            // If this patient exists in fetched data, use the fresh data
            const freshData = fetchedPatientsMap.get(p.id)
            if (freshData) {
              preservedOrder.push(freshData)
              fetchedPatientsMap.delete(p.id) // Remove from map so we don't add it again
            }
          }
        })
        
        // Add any newly fetched patients that weren't in the current state (newly created from other sources)
        const newFetchedPatients = Array.from(fetchedPatientsMap.values())
        
        // Combine: unsaved patients first, then preserved order of existing patients, then new fetched patients
        const updated = [...unsavedPatients, ...preservedOrder, ...newFetchedPatients]
        
        const totalRows = updated.length
        const emptyRowsNeeded = Math.max(0, 200 - totalRows)
        const existingEmptyCount = unsavedPatients.filter(p => p.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyPatient(existingEmptyCount + i)
        )
        const finalUpdated = [...updated, ...newEmptyRows]
        return finalUpdated
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
    console.log('[savePatients] Called with:', {
      clinicId,
      hasUserProfile: !!userProfile,
      patientsToSaveCount: patientsToSave.length,
      patientsToSave: patientsToSave.map(p => ({
        id: p.id,
        patient_id: p.patient_id,
        first_name: p.first_name,
        last_name: p.last_name,
        insurance: p.insurance,
        copay: p.copay,
        coinsurance: p.coinsurance
      }))
    })

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
    
    console.log('[savePatients] After filtering:', {
      patientsToProcessCount: patientsToProcess.length,
      patientsToProcess: patientsToProcess.map(p => ({
        id: p.id,
        patient_id: p.patient_id,
        first_name: p.first_name,
        last_name: p.last_name,
        insurance: p.insurance,
        copay: p.copay,
        coinsurance: p.coinsurance
      }))
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
        console.log(`[savePatients] Processing patient ${i + 1}/${patientsToProcess.length}:`, {
          id: patient.id,
          patient_id: patient.patient_id,
          first_name: patient.first_name,
          last_name: patient.last_name,
          insurance: patient.insurance,
          copay: patient.copay,
          coinsurance: patient.coinsurance
        })

        // Generate patient_id if missing
        let finalPatientId = patient.patient_id || ''
        if (!finalPatientId) {
          const timestamp = Date.now().toString().slice(-6)
          const initials = `${(patient.first_name || '').charAt(0)}${(patient.last_name || '').charAt(0)}`.toUpperCase() || 'PT'
          finalPatientId = `${initials}${timestamp}`
          console.log(`[savePatients] Generated patient_id: ${finalPatientId}`)
        }

        // Prepare patient data
        const patientData: any = {
          clinic_id: clinicId,
          patient_id: finalPatientId,
          first_name: patient.first_name || '',
          last_name: patient.last_name || '',
          insurance: patient.insurance || null,
          copay: patient.copay || null,
          coinsurance: patient.coinsurance || null,
          updated_at: new Date().toISOString(),
        }

        console.log(`[savePatients] Prepared patientData:`, patientData)

        let savedPatient: Patient | null = null

        // If patient has a real database ID (not new- or empty-), update by ID
        if (!patient.id.startsWith('new-') && !patient.id.startsWith('empty-')) {
          console.log(`[savePatients] Attempting UPDATE by ID: ${patient.id}`)
          const { error: updateError, data: updateData } = await supabase
            .from('patients')
            .update(patientData)
            .eq('id', patient.id)
            .select()

          console.log(`[savePatients] UPDATE result:`, { updateError, updateData })

          if (!updateError && updateData && updateData.length > 0) {
            console.log(`[savePatients] UPDATE successful for patient ID: ${patient.id}`)
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
            // This patient was just saved - update with fresh data from database
            // This preserves the row position but updates the data and ID (for new patients)
            console.log(`[savePatients] Updating patient in place: ${patient.id} -> ${savedPatient.id}`)
            return savedPatient
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
    if (!confirm('Are you sure you want to delete this patient?')) return

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
      patient.patient_id || '',
      patient.first_name || '',
      patient.last_name || '',
      patient.insurance || '',
      patient.copay ?? '',
      patient.coinsurance ?? '',
    ])
  }, [patients])
  if (patients) {
    
    console.log('patients: ',patients )
  }
  
  // Column field names mapping to is_lock_patients table columns
  const columnFields: Array<keyof IsLockPatients> = ['patient_id', 'first_name', 'last_name', 'insurance', 'copay', 'coinsurance']
  const columnTitles = ['Patient ID', 'Patient First', 'Patient Last', 'Insurance', 'Copay', 'Coinsurance']

  // Add lock icons to headers after table renders
  useEffect(() => {
    // Only run if lock functionality is enabled
    if (!canEdit || !onLockColumn || !isColumnLocked) return

    let timeoutId: NodeJS.Timeout | null = null

    const addLockIconsToHeader = (headerRow: Element | null) => {
      if (!headerRow) return

      // Get all header cells
      const headerCells = Array.from(headerRow.querySelectorAll('th'))
      
      // Match each header cell to our column by text content
      headerCells.forEach((th) => {
        // Note: Existing lock icons are removed in addLockIcons() before calling this function

        // Get the text content of the header cell
        let cellText = th.textContent?.trim() || th.innerText?.trim() || ''
        
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
        const isLocked = isColumnLocked ? isColumnLocked(columnName) : false

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
        lockButton.className = 'patient-lock-icon'
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
          if (onLockColumn) {
            onLockColumn(columnName as string)
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
      const allLockIcons = document.querySelectorAll('.patient-lock-icon')
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
      const table = document.querySelector('.handsontable-custom table.htCore')
      if (table) {
        const headerRow = table.querySelector('thead tr')
        if (headerRow) {
          addLockIconsToHeader(headerRow)
        }
      }

      // Add to cloned header (sticky header)
      const cloneTop = document.querySelector('.handsontable-custom .ht_clone_top table.htCore')
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

    const tableContainer = document.querySelector('.handsontable-custom')
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
  }, [canEdit, onLockColumn, isColumnLocked, columnFields, columnTitles, isLockPatients])

  const getReadOnly = (columnName: keyof IsLockPatients): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }
  const patientsColumns = useMemo(() => [
    { 
      data: 0, 
      title: 'Patient ID', 
      type: 'text' as const, 
      width: 120,
      readOnly: getReadOnly('patient_id')
    },
    { 
      data: 1, 
      title: 'Patient First', 
      type: 'text' as const, 
      width: 150,
      readOnly: getReadOnly('first_name')
    },
    { 
      data: 2, 
      title: 'Patient Last', 
      type: 'text' as const, 
      width: 150,
      readOnly: getReadOnly('last_name')
    },
    { 
      data: 3, 
      title: 'Insurance', 
      type: 'text' as const, 
      width: 150,
      readOnly: getReadOnly('insurance')
    },
    { 
      data: 4, 
      title: 'Copay', 
      type: 'numeric' as const, 
      width: 100, 
      numericFormat: {
        pattern: '0.00',
        culture: 'en-US'
      },
      readOnly: getReadOnly('copay')
    },
    { 
      data: 5, 
      title: 'Coinsurance', 
      type: 'numeric' as const, 
      width: 100, 
      numericFormat: {
        pattern: '0.00',
        culture: 'en-US'
      },
      readOnly: getReadOnly('coinsurance')
    },
  ], [canEdit, lockData])
  
  const handlePatientsHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return
    
    // Compute all changes locally first - don't rely on state
    setPatients(currentPatients => {
      let updatedPatients = [...currentPatients]
      let idCounter = 0
    
    changes.forEach(([row, col, , newValue]) => {
        // Ensure we have enough rows in the array
        while (updatedPatients.length <= row) {
          const existingEmptyCount = updatedPatients.filter(p => p.id.startsWith('empty-')).length
          updatedPatients.push(createEmptyPatient(existingEmptyCount))
        }
        
        const patient = updatedPatients[row]
      if (patient) {
        const fields: Array<keyof Patient> = ['patient_id', 'first_name', 'last_name', 'insurance', 'copay', 'coinsurance']
          const field = fields[col as number]
          
          // Generate unique ID for empty rows
          const needsNewId = patient.id.startsWith('empty-')
          const newId = needsNewId ? `new-${Date.now()}-${idCounter++}-${Math.random()}` : patient.id
        
        if (field === 'copay' || field === 'coinsurance') {
          const numValue = newValue === '' || newValue === null ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
            updatedPatients[row] = { ...patient, id: newId, [field]: numValue, updated_at: new Date().toISOString() } as Patient
        } else if (field === 'insurance') {
            const value = newValue === '' ? null : String(newValue)
            updatedPatients[row] = { ...patient, id: newId, [field]: value, updated_at: new Date().toISOString() } as Patient
          } else if (field) {
            const value = String(newValue || '')
            updatedPatients[row] = { ...patient, id: newId, [field]: value, updated_at: new Date().toISOString() } as Patient
          }
        }
      })
      
      // Ensure we always have 200 rows after changes
      if (updatedPatients.length > 200) {
        updatedPatients = updatedPatients.slice(0, 200)
      } else if (updatedPatients.length < 200) {
        const emptyRowsNeeded = 200 - updatedPatients.length
        const existingEmptyCount = updatedPatients.filter(p => p.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyPatient(existingEmptyCount + i)
        )
        updatedPatients = [...updatedPatients, ...newEmptyRows]
      }
      
      // Save with computed updated data directly - don't wait for state to update
      setTimeout(() => {
        savePatients(updatedPatients).catch(err => {
          console.error('[handlePatientsHandsontableChange] Error in savePatients:', err)
        })
      }, 0)
      
      return updatedPatients
    })
  }, [savePatients, createEmptyPatient])
  
  const handlePatientsHandsontableContextMenu = useCallback((row: number) => {
    const patient = patients[row]
    if (patient && canEdit && !patient.id.startsWith('new-') && !patient.id.startsWith('empty-')) {
      handleDeletePatient(patient.id)
    }
  }, [patients, canEdit, handleDeletePatient])
  
  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-white/70 py-8">Loading patients...</div>
      </div>
    )
  }
  
  return (
    <div className="p-6">
      <div className="table-container dark-theme" style={{ 
        maxHeight: '600px', 
        overflowX: 'auto', 
        overflowY: 'auto',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        backgroundColor: '#d2dbe5'
      }}>
        <HandsontableWrapper
          key={`patients-${patients.length}-${JSON.stringify(lockData)}`}
          data={getPatientsHandsontableData()}
          columns={patientsColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={600}
          afterChange={handlePatientsHandsontableChange}
          onContextMenu={handlePatientsHandsontableContextMenu}
          enableFormula={true}
          readOnly={!canEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom"
        />
      </div>
    </div>
  )
}
