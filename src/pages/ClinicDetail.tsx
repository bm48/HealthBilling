import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Patient, TodoItem, TodoNote, ProviderSheet, SheetRow, Clinic, Provider, BillingCode, StatusColor, ColumnLock } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Users, CheckSquare, FileText, Trash2, Lock, Unlock, ChevronLeft, ChevronRight } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'

type TabType = 'patients' | 'todo' | 'providers'

export default function ClinicDetail() {
  const { clinicId, tab, providerId } = useParams<{ clinicId: string; tab?: string; providerId?: string }>()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>(providerId ? 'providers' : ((tab as TabType) || 'patients'))
  const [loading, setLoading] = useState(true)
  const [clinic, setClinic] = useState<Clinic | null>(null)

  // Patients data
  const [patients, setPatients] = useState<Patient[]>([])
  const [editingPatientCell, setEditingPatientCell] = useState<{ patientId: string; field: string } | null>(null)
  const patientsRef = useRef<Patient[]>([])
  const lastSavedPatientsRef = useRef<string>('') // Track last saved data to detect changes

  // Todo data
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [todoNotes, setTodoNotes] = useState<Record<string, TodoNote[]>>({})
  const [editingTodoCell, setEditingTodoCell] = useState<{ todoId: string; field: string } | null>(null)
  const [editingNoteCell, setEditingNoteCell] = useState<{ todoId: string; noteType: 'regular' | 'followup' } | null>(null)
  const todosRef = useRef<TodoItem[]>([])

  // Providers data - editable provider records from providers table
  const [providers, setProviders] = useState<Provider[]>([])
  const [providerSheets, setProviderSheets] = useState<Record<string, ProviderSheet>>({})
  const [providerSheetRows, setProviderSheetRows] = useState<Record<string, SheetRow[]>>({})
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  const [columnLocks, setColumnLocks] = useState<ColumnLock[]>([])
  const [showLockDialog, setShowLockDialog] = useState(false)
  const [selectedLockColumn, setSelectedLockColumn] = useState<{ columnName: string; providerId: string | null } | null>(null)
  const [lockComment, setLockComment] = useState('')
  const [editingProviderCell, setEditingProviderCell] = useState<{ providerId: string; rowId: string; field: string } | null>(null)
  
  // Month filter for provider tab
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date())
  const providersRef = useRef<Provider[]>([])
  const providerSheetRowsRef = useRef<Record<string, SheetRow[]>>({})

  // Provider sheet rows for editable view (when viewing a specific provider's sheet via providerId param)
  const [providerRows, setProviderRows] = useState<Array<{
    id: string
    cpt_code: string
    appointment_status: string
    sheetId: string
    rowId: string
  }>>([])
  const [currentProvider, setCurrentProvider] = useState<Provider | null>(null)
  const [currentSheet, setCurrentSheet] = useState<ProviderSheet | null>(null)
  const providerRowsRef = useRef<Array<{ id: string; cpt_code: string; appointment_status: string; sheetId: string; rowId: string }>>([])

  // Sync activeTab with URL parameter
  useEffect(() => {
    if (providerId) {
      setActiveTab('providers')
    } else if (tab && ['patients', 'todo', 'providers'].includes(tab)) {
      setActiveTab(tab as TabType)
    } else if (!tab && clinicId) {
      navigate(`/clinic/${clinicId}/patients`, { replace: true })
    }
  }, [tab, clinicId, navigate, providerId])

  useEffect(() => {
    patientsRef.current = patients
  }, [patients])

  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  useEffect(() => {
    providerRowsRef.current = providerRows
  }, [providerRows])

  useEffect(() => {
    providersRef.current = providers
  }, [providers])

  useEffect(() => {
    providerRowsRef.current = providerRows
  }, [providerRows])

  useEffect(() => {
    if (clinicId) {
      fetchClinic()
      if (providerId) {
        // When providerId is in URL, fetch that specific provider's sheet data
        fetchProviderSheetData()
        // Also ensure we have providers list for the tab
        if (activeTab === 'providers') {
          fetchPatients() // Need patients for displaying patient info
          fetchBillingCodes()
          fetchStatusColors()
          fetchColumnLocks()
          fetchProviders()
        }
      } else {
        // When no providerId, fetch data for the active tab normally
        fetchData()
      }
    }
  }, [clinicId, activeTab, providerId, selectedMonth])

  // Refetch provider sheets when selectedMonth changes (for non-providerId view)
  useEffect(() => {
    if (clinicId && activeTab === 'providers' && !providerId) {
      console.log('Selected month changed, refetching provider sheets:', selectedMonth)
      fetchProviderSheets()
    }
  }, [selectedMonth])

  const fetchClinic = async () => {
    try {
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .eq('id', clinicId)
        .maybeSingle()

      if (error) throw error
      setClinic(data || null)
    } catch (error) {
      console.error('Error fetching clinic:', error)
    }
  }

  const fetchData = async () => {
    if (!clinicId) return

    setLoading(true)
    try {
      if (activeTab === 'patients') {
        await fetchPatients()
      } else if (activeTab === 'todo') {
        await fetchTodos()
      } else if (activeTab === 'providers') {
        await fetchPatients() // Need patients for displaying patient info in provider sheets
        await fetchBillingCodes()
        await fetchStatusColors()
        await fetchColumnLocks()
        await fetchProviders()
        await fetchProviderSheets()
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchBillingCodes = async () => {
    try {
      const { data, error } = await supabase
        .from('billing_codes')
        .select('*')
        .order('code')
      
      if (error) throw error
      setBillingCodes(data || [])
    } catch (error) {
      console.error('Error fetching billing codes:', error)
    }
  }

  const fetchStatusColors = async () => {
    try {
      const { data, error } = await supabase
        .from('status_colors')
        .select('*')
      console.log("data: ",data)
      if (error) {
        // If table doesn't exist yet, use default colors
        console.log('Status colors table not found, using defaults')
        setStatusColors(getDefaultStatusColors())
        return
      }
      
      if (data && data.length > 0) {
        console.log('Loaded status colors from database:', data)
        setStatusColors(data)
      } else {
        console.log('No status colors found in database, using defaults')
        setStatusColors(getDefaultStatusColors())
      }
    } catch (error) {
      console.error('Error fetching status colors:', error)
      setStatusColors(getDefaultStatusColors())
    }
  }

  const fetchColumnLocks = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await supabase
        .from('column_locks')
        .select('*')
        .eq('clinic_id', clinicId)
      
      if (error) {
        console.log('Column locks table not found or error:', error)
        setColumnLocks([])
        return
      }
      setColumnLocks(data || [])
    } catch (error) {
      console.error('Error fetching column locks:', error)
      setColumnLocks([])
    }
  }

  const isColumnLocked = (columnName: string, providerId?: string | null): ColumnLock | null => {
    return columnLocks.find(lock => 
      lock.column_name === columnName && 
      lock.is_locked &&
      (lock.provider_id === (providerId || null))
    ) || null
  }

  const handleToggleColumnLock = async (columnName: string, providerId: string | null, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const existing = columnLocks.find(lock => 
        lock.column_name === columnName && 
        lock.provider_id === (providerId || null)
      )

      if (existing) {
        // Update existing lock
        const { error } = await supabase
          .from('column_locks')
          .update({
            is_locked: isLocked,
            comment: comment || existing.comment,
            locked_by: userProfile?.id,
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Create new lock
        const { error } = await supabase
          .from('column_locks')
          .insert({
            clinic_id: clinicId,
            provider_id: providerId,
            column_name: columnName,
            is_locked: isLocked,
            comment: comment || null,
            locked_by: userProfile?.id,
            locked_at: new Date().toISOString()
          })

        if (error) throw error
      }

      // Refresh column locks
      await fetchColumnLocks()
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling column lock:', error)
      alert('Failed to update column lock')
    }
  }

  // Month navigation functions
  const handlePreviousMonth = () => {
    setSelectedMonth(prevDate => {
      const newDate = new Date(prevDate)
      newDate.setMonth(newDate.getMonth() - 1)
      console.log('handlePreviousMonth: ', newDate)
      return newDate
    })
  }

  const handleNextMonth = () => {
    setSelectedMonth(prevDate => {
      const newDate = new Date(prevDate)
      newDate.setMonth(newDate.getMonth() + 1)
      console.log('handleNextMonth: ', newDate)
      return newDate
    })
  }

  const formatMonthYear = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const filterRowsByMonth = (rows: SheetRow[]) => {
    // Since we're now fetching provider sheets by month/year from the database,
    // all rows already belong to the selected month. No filtering needed.
    // Just return all rows (including empty rows for data entry)
    console.log('Provider sheet rows for selected month:', rows.length)
    return rows
  }

  // Default color mappings
  const getDefaultStatusColors = (): StatusColor[] => {
    return [
      // Appointment Status Colors
      { id: '1', status: 'Complete', color: '#22c55e', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '2', status: 'PP Complete', color: '#3b82f6', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '3', status: 'Charge NS/LC', color: '#f59e0b', text_color: '#000000', type: 'appointment', created_at: '', updated_at: '' },
      { id: '4', status: 'RS No Charge', color: '#ef4444', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '5', status: 'NS No Charge', color: '#6b7280', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '6', status: 'Note not complete', color: '#dc2626', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      
      // Claim Status Colors
      { id: '7', status: 'Claim Sent', color: '#3b82f6', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '8', status: 'RS', color: '#f59e0b', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '9', status: 'IP', color: '#eab308', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '10', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '11', status: 'Deductible', color: '#a855f7', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '12', status: 'N/A', color: '#6b7280', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '13', status: 'PP', color: '#06b6d4', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '14', status: 'Denial', color: '#ef4444', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '15', status: 'Rejection', color: '#dc2626', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '16', status: 'No Coverage', color: '#991b1b', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      
      // Patient Pay Status Colors
      { id: '17', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '18', status: 'CC declined', color: '#ef4444', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '19', status: 'Secondary', color: '#3b82f6', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '20', status: 'Refunded', color: '#f59e0b', text_color: '#000000', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '21', status: 'Payment Plan', color: '#a855f7', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '22', status: 'Waiting on Claims', color: '#6b7280', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      
      // Month Colors
      { id: '23', status: 'January', color: '#dc2626', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '24', status: 'February', color: '#ec4899', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '25', status: 'March', color: '#f59e0b', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
      { id: '26', status: 'April', color: '#fde047', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
      { id: '27', status: 'May', color: '#84cc16', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '28', status: 'June', color: '#22c55e', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '29', status: 'July', color: '#06b6d4', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '30', status: 'August', color: '#0284c7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '31', status: 'September', color: '#6366f1', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '32', status: 'October', color: '#f97316', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '33', status: 'November', color: '#a855f7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '34', status: 'December', color: '#0ea5e9', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    ]
  }

  const createEmptyPatient = (index: number): Patient => ({
    id: `empty-${index}`,
    clinic_id: clinicId!,
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
  })

  const fetchPatients = async () => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('last_name', { ascending: true })

      if (error) throw error
      const fetchedPatients = data || []
      
      // Preserve any unsaved patients (with 'new-' prefix)
      setPatients(currentPatients => {
        const unsavedPatients = currentPatients.filter(p => p.id.startsWith('new-') || p.id.startsWith('empty-'))
        const updated = [...unsavedPatients, ...fetchedPatients]
        
        // Add empty rows to reach 200 total rows (excluding empty rows already in unsavedPatients)
        const totalRows = updated.length
        const emptyRowsNeeded = Math.max(0, 200 - totalRows)
        const existingEmptyCount = unsavedPatients.filter(p => p.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyPatient(existingEmptyCount + i)
        )
        const finalUpdated = [...updated, ...newEmptyRows]
        
        // Update last saved reference after fetching (only the fetched patients, not unsaved ones)
        lastSavedPatientsRef.current = JSON.stringify(fetchedPatients)
        console.log('fetchPatients: Updated lastSavedPatientsRef', { count: fetchedPatients.length })
        return finalUpdated
      })
    } catch (error) {
      console.error('Error fetching patients:', error)
    }
  }

  const savePatients = useCallback(async (patientsToSave: Patient[]) => {
    if (!clinicId || !userProfile) {
      console.log('savePatients: Missing clinicId or userProfile', { clinicId, userProfile: !!userProfile })
      return
    }

    // Filter out empty rows (they shouldn't be saved)
    const patientsToProcess = patientsToSave.filter(p => !p.id.startsWith('empty-'))
    console.log('savePatients: Starting save', { patientsCount: patientsToProcess.length })

    try {
      const newPatientsToCreate: Patient[] = []
      const patientsToUpdate: Patient[] = []

      for (const patient of patientsToProcess) {
        if (patient.id.startsWith('new-')) {
          // Save new patients if they have any meaningful data
          if (patient.patient_id || patient.first_name || patient.last_name || patient.insurance || patient.copay !== null || patient.coinsurance !== null) {
            newPatientsToCreate.push(patient)
          }
        } else {
          // For existing patients, we need to compare with what was last saved to the database
          // Parse the last saved patients to compare
          let lastSavedPatients: Patient[] = []
          const lastSavedRefString = lastSavedPatientsRef.current || '[]'
          
          // If ref is empty or not initialized, treat all as needing update (safety fallback)
          if (!lastSavedRefString || lastSavedRefString === '[]') {
            console.log('lastSavedPatientsRef not initialized, treating as update:', patient.id)
            patientsToUpdate.push(patient)
            continue
          }
          
          try {
            lastSavedPatients = JSON.parse(lastSavedRefString)
          } catch (e) {
            // If parsing fails, treat all as needing update (safety fallback)
            console.log('Error parsing last saved patients, treating as update:', e)
            patientsToUpdate.push(patient)
            continue
          }
          
          const originalPatient = lastSavedPatients.find(p => p.id === patient.id)
          
          if (originalPatient) {
            // Compare with what was last saved to database
            const hasChanged =
              (originalPatient.patient_id || '') !== (patient.patient_id || '') ||
              (originalPatient.first_name || '') !== (patient.first_name || '') ||
              (originalPatient.last_name || '') !== (patient.last_name || '') ||
              (originalPatient.insurance || '') !== (patient.insurance || '') ||
              (originalPatient.copay !== null ? originalPatient.copay : 0) !== (patient.copay !== null ? patient.copay : 0) ||
              (originalPatient.coinsurance !== null ? originalPatient.coinsurance : 0) !== (patient.coinsurance !== null ? patient.coinsurance : 0)

            if (hasChanged) {
              console.log('Patient changed:', {
                id: patient.id,
                original_first_name: originalPatient.first_name,
                new_first_name: patient.first_name,
                original_last_name: originalPatient.last_name,
                new_last_name: patient.last_name
              })
              patientsToUpdate.push(patient)
            } else {
              console.log('Patient unchanged:', patient.id, {
                first_name: patient.first_name,
                last_name: patient.last_name
              })
            }
          } else {
            // Patient not found in last saved - might be newly created or ref not initialized
            // Treat as update to be safe
            console.log('Patient not in last saved ref, treating as update (patient might be new or ref not initialized):', patient.id)
            patientsToUpdate.push(patient)
          }
        }
      }

      // Create new patients
      for (const patient of newPatientsToCreate) {
        // Generate a unique patient_id if it's empty
        let finalPatientId = patient.patient_id || ''
        if (!finalPatientId) {
          // Generate a unique patient_id based on first_name, last_name, and timestamp
          const timestamp = Date.now().toString().slice(-6)
          const initials = `${(patient.first_name || '').charAt(0)}${(patient.last_name || '').charAt(0)}`.toUpperCase() || 'PT'
          finalPatientId = `${initials}${timestamp}`
        }

        // Check if a patient with the same clinic_id and patient_id already exists
        const { data: existingPatient, error: checkError } = await supabase
          .from('patients')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('patient_id', finalPatientId)
          .maybeSingle()

        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found" which is fine
          console.error('Error checking for existing patient:', checkError)
          throw checkError
        }

        if (existingPatient) {
          // Patient already exists, update it instead
          const { error: updateError } = await supabase
            .from('patients')
            .update({
              first_name: patient.first_name,
              last_name: patient.last_name,
              insurance: patient.insurance || null,
              copay: patient.copay || null,
              coinsurance: patient.coinsurance || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingPatient.id)
          
          if (updateError) {
            console.error('Error updating existing patient:', updateError)
            throw updateError
          }
        } else {
          // Insert new patient
          const { error: insertError } = await supabase.from('patients').insert({
            clinic_id: clinicId,
            patient_id: finalPatientId,
            first_name: patient.first_name,
            last_name: patient.last_name,
            insurance: patient.insurance || null,
            copay: patient.copay || null,
            coinsurance: patient.coinsurance || null,
          })
          
          if (insertError) {
            // If it's a duplicate key error, try to find and update the existing patient
            if (insertError.code === '23505') {
              const { data: existingPatientData, error: findError } = await supabase
                .from('patients')
                .select('id')
                .eq('clinic_id', clinicId)
                .eq('patient_id', finalPatientId)
                .maybeSingle()

              if (findError && findError.code !== 'PGRST116') {
                console.error('Error finding existing patient after duplicate error:', findError)
                throw insertError
              }

              if (existingPatientData) {
                // Update the existing patient
                const { error: updateError } = await supabase
                  .from('patients')
                  .update({
                    first_name: patient.first_name,
                    last_name: patient.last_name,
                    insurance: patient.insurance || null,
                    copay: patient.copay || null,
                    coinsurance: patient.coinsurance || null,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existingPatientData.id)
                
                if (updateError) {
                  console.error('Error updating existing patient after duplicate error:', updateError)
                  throw updateError
                }
              } else {
                // Couldn't find the existing patient, throw the original error
                throw insertError
              }
            } else {
              console.error('Error creating patient:', insertError)
              throw insertError
            }
          }
        }
      }

      // Update existing patients
      for (const patient of patientsToUpdate) {
        const { error } = await supabase
          .from('patients')
          .update({
            patient_id: patient.patient_id,
            first_name: patient.first_name,
            last_name: patient.last_name,
            insurance: patient.insurance || null,
            copay: patient.copay || null,
            coinsurance: patient.coinsurance || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', patient.id)

        if (error) throw error
      }

      // Remove successfully saved new patients from local state before fetching
      // This prevents duplicates when fetchPatients() runs
      if (newPatientsToCreate.length > 0) {
        const savedPatientIds = newPatientsToCreate.map(p => p.id)
        setPatients(prevPatients => 
          prevPatients.filter(p => !savedPatientIds.includes(p.id))
        )
      }

      console.log('savePatients: Save complete', { 
        newCount: newPatientsToCreate.length, 
        updateCount: patientsToUpdate.length 
      })

      if (newPatientsToCreate.length > 0 || patientsToUpdate.length > 0) {
        // Save was successful, update will happen after fetchPatients
        await fetchPatients()
        // fetchPatients already updates lastSavedPatientsRef, but ensure it's correct
        const savedPatients = patientsToProcess.filter(p => !p.id.startsWith('new-') && !p.id.startsWith('empty-'))
        lastSavedPatientsRef.current = JSON.stringify(savedPatients)
        console.log('savePatients: Updated lastSavedPatientsRef after save', { count: savedPatients.length })
      } else {
        console.log('savePatients: No changes detected, skipping save')
        console.log('savePatients: Debug info', {
          lastSavedCount: JSON.parse(lastSavedPatientsRef.current || '[]').length,
          currentCount: patientsToSave.length,
          samplePatient: patientsToSave[0] ? {
            id: patientsToSave[0].id,
            first_name: patientsToSave[0].first_name,
            last_name: patientsToSave[0].last_name
          } : null
        })
      }
    } catch (error: any) {
      console.error('Error saving patients:', error)
      let errorMessage = 'Failed to save patient. Please try again.'
      
      if (error?.code === '23505') {
        errorMessage = 'A patient with this Patient ID already exists for this clinic. The patient has been updated instead.'
      } else if (error?.message) {
        errorMessage = `Error: ${error.message}`
      }
      
      alert(errorMessage)
    }
  }, [clinicId, userProfile, fetchPatients])

  const { saveImmediately: savePatientsImmediately } = useDebouncedSave<Patient[]>(savePatients, patients, 1000, editingPatientCell !== null)

  const handleUpdatePatient = useCallback((patientId: string, field: string, value: any) => {
    setPatients(prevPatients =>
      prevPatients.map(patient => {
        if (patient.id === patientId) {
          const updated = { ...patient, [field]: value, updated_at: new Date().toISOString() }
          if (field === 'copay' || field === 'coinsurance') {
            return { ...updated, [field]: value === '' ? null : parseFloat(value) || null }
          }
          return updated
        }
        return patient
      })
    )
  }, [])

  const handleAddPatientRow = useCallback(() => {
    const newPatient: Patient = {
      id: `new-${Date.now()}`,
      clinic_id: clinicId!,
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
    }
    setPatients(prev => [newPatient, ...prev])
    setEditingPatientCell({ patientId: newPatient.id, field: 'patient_id' })
  }, [clinicId])

  const handleDeletePatient = useCallback(async (patientId: string) => {
    if (!confirm('Are you sure you want to delete this patient?')) return

    if (patientId.startsWith('new-')) {
      setPatients(prev => prev.filter(p => p.id !== patientId))
      return
    }

    try {
      console.log('Deleting patient:', patientId)
      const { data, error } = await supabase
        .from('patients')
        .delete()
        .eq('id', patientId)
        .select()
      
      if (error) {
        console.error('Delete error:', error)
        alert(`Failed to delete patient: ${error.message || 'Unknown error'}`)
        throw error
      }
      
      console.log('Patient deleted successfully', { deletedCount: data?.length || 0 })
      console.log('Fetching updated list')
      // Update lastSavedPatientsRef to remove deleted patient
      try {
        const lastSaved = JSON.parse(lastSavedPatientsRef.current || '[]')
        const updated = lastSaved.filter((p: Patient) => p.id !== patientId)
        lastSavedPatientsRef.current = JSON.stringify(updated)
      } catch (e) {
        console.error('Error updating lastSavedPatientsRef:', e)
      }
      await fetchPatients()
    } catch (error) {
      console.error('Error deleting patient:', error)
      alert(`Failed to delete patient: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [fetchPatients])

  const createEmptyTodo = (index: number): TodoItem => ({
    id: `empty-${index}`,
    clinic_id: clinicId!,
    title: '',
    status: 'Open',
    claim_reference: null,
    created_by: userProfile?.id || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  })

  const fetchTodos = async () => {
    try {
      const { data: todosData, error: todosError } = await supabase
        .from('todo_items')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })

      if (todosError) throw todosError
      const fetchedTodos = todosData || []

      // Preserve any unsaved todos
      setTodos(currentTodos => {
        const unsavedTodos = currentTodos.filter(t => t.id.startsWith('new-') || t.id.startsWith('empty-'))
        const updated = [...unsavedTodos, ...fetchedTodos]
        
        // Add empty rows to reach 200 total rows (excluding empty rows already in unsavedTodos)
        const totalRows = updated.length
        const emptyRowsNeeded = Math.max(0, 200 - totalRows)
        const existingEmptyCount = unsavedTodos.filter(t => t.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyTodo(existingEmptyCount + i)
        )
        const finalUpdated = [...updated, ...newEmptyRows]
        
        return finalUpdated
      })

      // Fetch notes for all todos
      if (fetchedTodos.length > 0) {
        const todoIds = fetchedTodos.map(t => t.id)
        const { data: notesData, error: notesError } = await supabase
          .from('todo_notes')
          .select('*')
          .in('todo_id', todoIds)
          .order('created_at', { ascending: false })

        if (notesError) throw notesError

        const notesByTodo: Record<string, TodoNote[]> = {}
        notesData?.forEach(note => {
          if (!notesByTodo[note.todo_id]) {
            notesByTodo[note.todo_id] = []
          }
          notesByTodo[note.todo_id].push(note)
        })
        setTodoNotes(notesByTodo)
      }
    } catch (error) {
      console.error('Error fetching todos:', error)
    }
  }

  const saveTodos = useCallback(async (todosToSave: TodoItem[]) => {
    if (!clinicId || !userProfile) return

    // Filter out empty rows (they shouldn't be saved)
    const todosToProcess = todosToSave.filter(t => !t.id.startsWith('empty-'))

    try {
      const newTodosToCreate: TodoItem[] = []
      const todosToUpdate: TodoItem[] = []

      for (const todo of todosToProcess) {
        if (todo.id.startsWith('new-')) {
          if (todo.title) {
            newTodosToCreate.push(todo)
          }
        } else {
          const originalTodo = todosRef.current.find(t => t.id === todo.id)
          if (originalTodo) {
            const hasChanged =
              originalTodo.title !== todo.title ||
              originalTodo.status !== todo.status

            if (hasChanged) {
              todosToUpdate.push(todo)
            }
          }
        }
      }

      // Create new todos
      for (const todo of newTodosToCreate) {
        const { data, error } = await supabase
          .from('todo_items')
          .insert({
            clinic_id: clinicId,
            title: todo.title,
            status: todo.status || 'Open',
            created_by: userProfile.id,
          })
          .select()
          .maybeSingle()

        if (error) throw error
        if (!data) {
          console.error('Failed to create todo item - no data returned')
          continue
        }
      }

      // Update existing todos
      for (const todo of todosToUpdate) {
        const { error } = await supabase
          .from('todo_items')
          .update({
            title: todo.title,
            status: todo.status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', todo.id)

        if (error) throw error
      }

        // Remove successfully saved new todos from local state before fetching
        // This prevents duplicates when fetchTodos() runs
        if (newTodosToCreate.length > 0) {
          const savedTodoIds = newTodosToCreate.map(t => t.id)
          setTodos(prevTodos => 
            prevTodos.filter(t => !savedTodoIds.includes(t.id))
          )
        }

        if (newTodosToCreate.length > 0 || todosToUpdate.length > 0) {
          await fetchTodos()
        }
        
        // Ensure empty rows are maintained after save
        setTodos(currentTodos => {
          const existingEmptyCount = currentTodos.filter(t => t.id.startsWith('empty-')).length
          const nonEmptyTodos = currentTodos.filter(t => !t.id.startsWith('empty-'))
          const emptyRowsNeeded = Math.max(0, 200 - nonEmptyTodos.length)
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
            createEmptyTodo(existingEmptyCount + i)
          )
          return [...nonEmptyTodos, ...newEmptyRows]
        })
    } catch (error) {
      console.error('Error saving todos:', error)
    }
  }, [clinicId, userProfile, fetchTodos])

  const { saveImmediately: saveTodosImmediately } = useDebouncedSave<TodoItem[]>(saveTodos, todos, 1000, editingTodoCell !== null)

  const handleUpdateTodo = useCallback((todoId: string, field: string, value: any) => {
    setTodos(prevTodos => {
      const updated = prevTodos.map(todo => {
        if (todo.id === todoId) {
          // If updating an empty row, convert it to a new- prefixed row
          if (todo.id.startsWith('empty-')) {
            return {
              ...todo,
              id: `new-${Date.now()}-${Math.random()}`,
              [field]: value,
              updated_at: new Date().toISOString()
            }
          }
          return { ...todo, [field]: value, updated_at: new Date().toISOString() }
        }
        return todo
      })
      
      // Ensure we maintain 200 rows total
      const nonEmptyCount = updated.filter(t => !t.id.startsWith('empty-')).length
      const emptyRowsNeeded = Math.max(0, 200 - nonEmptyCount)
      const existingEmptyCount = updated.filter(t => t.id.startsWith('empty-')).length
      if (emptyRowsNeeded > existingEmptyCount) {
        const newEmptyRows = Array.from({ length: emptyRowsNeeded - existingEmptyCount }, (_, i) => 
          createEmptyTodo(existingEmptyCount + i)
        )
        return [...updated, ...newEmptyRows]
      }
      return updated
    })
  }, [])

  const handleAddTodoRow = useCallback(() => {
    if (!userProfile) return

    const newTodo: TodoItem = {
      id: `new-${Date.now()}`,
      clinic_id: clinicId!,
      title: '',
      status: 'Open',
      claim_reference: null,
      created_by: userProfile.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    }
    setTodos(prev => [newTodo, ...prev])
    setEditingTodoCell({ todoId: newTodo.id, field: 'title' })
  }, [clinicId, userProfile])

  const handleDeleteTodo = useCallback(async (todoId: string) => {
    if (!confirm('Are you sure you want to delete this to-do item?')) return

    if (todoId.startsWith('new-')) {
      setTodos(prev => prev.filter(t => t.id !== todoId))
      return
    }

    try {
      const { error } = await supabase.from('todo_items').delete().eq('id', todoId)
      if (error) throw error
      await fetchTodos()
    } catch (error) {
      console.error('Error deleting todo:', error)
      alert('Failed to delete to-do item')
    }
  }, [fetchTodos])

  const handleSaveTodoNote = useCallback(async (todoId: string, noteText: string, noteType: 'regular' | 'followup') => {
    if (!userProfile || todoId.startsWith('new-')) return

    try {
      // Get existing notes for this todo
      const existingNotes = todoNotes[todoId] || []
      
      if (noteType === 'regular') {
        // Remove existing regular notes (non-F/U notes)
        const regularNotes = existingNotes.filter(n => !n.note.startsWith('[F/U]'))
        for (const note of regularNotes) {
          await supabase.from('todo_notes').delete().eq('id', note.id)
        }
        
        // Add new regular note if text is provided
        if (noteText.trim()) {
          const { error } = await supabase.from('todo_notes').insert({
            todo_id: todoId,
            note: noteText.trim(),
            created_by: userProfile.id,
          })
          if (error) throw error
        }
      } else {
        // Remove existing follow-up notes
        const followUpNotes = existingNotes.filter(n => n.note.startsWith('[F/U]'))
        for (const note of followUpNotes) {
          await supabase.from('todo_notes').delete().eq('id', note.id)
        }
        
        // Add new follow-up note if text is provided
        if (noteText.trim()) {
          const { error } = await supabase.from('todo_notes').insert({
            todo_id: todoId,
            note: `[F/U] ${noteText.trim()}`,
            created_by: userProfile.id,
          })
          if (error) throw error
        }
      }
      
      await fetchTodos()
    } catch (error) {
      console.error('Error saving note:', error)
    }
  }, [userProfile, todoNotes, fetchTodos])

  const fetchProviderSheetData = async () => {
    if (!clinicId || !providerId) {
      // Clear current provider data if providerId is removed
      setCurrentProvider(null)
      setCurrentSheet(null)
      setProviderRows([])
      return
    }

    try {
      setLoading(true)
      
      // Fetch provider info from providers table (not users table)
      const { data: providerData, error: providerError } = await supabase
        .from('providers')
        .select('*')
        .eq('id', providerId)
        .maybeSingle()

      if (providerError && providerError.code !== 'PGRST116') {
        throw providerError
      }
      
      if (!providerData) {
        setCurrentProvider(null)
        setCurrentSheet(null)
        setProviderRows([])
        setProviderSheetRows(prev => {
          const updated = { ...prev }
          delete updated[providerId]
          return updated
        })
        return
      }
      
      setCurrentProvider(providerData)

      // Use selected month/year instead of current date
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()

      console.log('Fetching provider sheet data for:', { providerId, month, year })

      // Fetch sheet for the selected month/year
      const { data: existingSheet, error: sheetsError } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('provider_id', providerId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle()

      if (sheetsError && sheetsError.code !== 'PGRST116') throw sheetsError

      let sheet = existingSheet

      if (!sheet) {
        // Create a new sheet
        const { data: newSheet, error: createError } = await supabase
          .from('provider_sheets')
          .insert({
            clinic_id: clinicId,
            provider_id: providerId,
            month,
            year,
            row_data: [],
            locked: false,
            locked_columns: [],
          })
          .select()
          .maybeSingle()

        if (createError) throw createError
        if (!newSheet) {
          console.error('Failed to create provider sheet - no data returned')
          return
        }
        sheet = newSheet
      }

      setCurrentSheet(sheet)

      // Extract rows with CPT codes and appointment statuses
      const rows: Array<{
        id: string
        cpt_code: string
        appointment_status: string
        sheetId: string
        rowId: string
      }> = []

      if (sheet && Array.isArray(sheet.row_data)) {
        sheet.row_data.forEach((row: SheetRow) => {
          rows.push({
            id: row.id,
            cpt_code: row.billing_code || '',
            appointment_status: row.appointment_status || '',
            sheetId: sheet.id,
            rowId: row.id,
          })
        })
      }

      setProviderRows(rows)
      
      // Create empty rows for providers table (200 rows per provider)
      const createEmptyProviderSheetRow = (index: number): SheetRow => ({
        id: `empty-${index}`,
        patient_id: null,
        patient_first_name: null,
        patient_last_name: null,
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
        last_initial: null,
        cpt_code: null,
        cpt_code_color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      const sheetRows = Array.isArray(sheet.row_data) ? sheet.row_data : []
      const emptyRowsNeeded = Math.max(0, 200 - sheetRows.length)
      const emptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
        createEmptyProviderSheetRow(i)
      )
      const allRows = [...sheetRows, ...emptyRows]
      
      // Update providerSheetRows to only show this provider's data
      setProviderSheetRows(prev => ({
        ...prev,
        [providerId]: allRows
      }))
      
      // Update providerSheets map
      setProviderSheets(prev => ({
        ...prev,
        [providerId]: sheet
      }))
    } catch (error) {
      console.error('Error fetching provider sheet data:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveProviderRows = useCallback(async (rowsToSave: typeof providerRows) => {
    if (!currentSheet) return

    try {
      // Convert rows back to SheetRow format and update the sheet
      const updatedRowData: SheetRow[] = []
      
      // Get existing row data
      const existingRows = Array.isArray(currentSheet.row_data) ? currentSheet.row_data : []
      
      // Create a map of existing rows by ID
      const existingRowsMap = new Map(existingRows.map((r: SheetRow) => [r.id, r]))

      // Update rows
      rowsToSave.forEach(row => {
        const existingRow = existingRowsMap.get(row.rowId)
        if (existingRow) {
          // Update existing row
          updatedRowData.push({
            ...existingRow,
            billing_code: row.cpt_code || null,
            appointment_status: row.appointment_status as any || null,
            updated_at: new Date().toISOString(),
          })
          existingRowsMap.delete(row.rowId)
        } else if (row.id.startsWith('new-')) {
          // New row
          const newRow: SheetRow = {
            id: `row-${Date.now()}-${Math.random()}`,
            patient_id: null,
            patient_first_name: null,
            patient_last_name: null,
            patient_insurance: null,
            patient_copay: null,
            patient_coinsurance: null,
            appointment_date: null,
            appointment_time: null,
            visit_type: null,
            notes: null,
            billing_code: row.cpt_code || null,
            billing_code_color: null,
            appointment_status: row.appointment_status as any || null,
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
            last_initial: null,
            cpt_code: null,
            cpt_code_color: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          updatedRowData.push(newRow)
        }
      })

      // Keep any remaining existing rows that weren't updated
      existingRowsMap.forEach(row => updatedRowData.push(row))

      // Update the sheet
      const { error } = await supabase
        .from('provider_sheets')
        .update({
          row_data: updatedRowData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSheet.id)

      if (error) throw error

      // Update local state
      setCurrentSheet({ ...currentSheet, row_data: updatedRowData })
      await fetchProviderSheetData()
    } catch (error) {
      console.error('Error saving provider rows:', error)
    }
  }, [currentSheet, fetchProviderSheetData])

  const { saveImmediately: _saveProviderRowsImmediately } = useDebouncedSave(saveProviderRows, providerRows, 1000)


  const fetchProviders = async () => {
    try {
      const { data, error } = await supabase
        .from('providers')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('last_name')
        .order('first_name')

      if (error) throw error
      const fetchedProviders = data || []
      // Preserve any unsaved providers (with 'new-' prefix)
      setProviders(currentProviders => {
        const unsavedProviders = currentProviders.filter(p => p.id.startsWith('new-'))
        return [...unsavedProviders, ...fetchedProviders]
      })
    } catch (error) {
      console.error('Error fetching providers:', error)
    }
  }

  const fetchProviderSheets = async () => {
    if (!clinicId || !userProfile) return

    try {
      // Use selected month/year instead of current date
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()

      console.log('Fetching provider sheets for:', { month, year })

      // Fetch all providers for this clinic
      const { data: providersData } = await supabase
        .from('providers')
        .select('id')
        .eq('clinic_id', clinicId)

      if (!providersData || providersData.length === 0) return

      const providerIds = providersData.map(p => p.id)

      // Fetch or create provider sheets for all providers
      const sheetsMap: Record<string, ProviderSheet> = {}
      const rowsMap: Record<string, SheetRow[]> = {}

      for (const providerId of providerIds) {
        // Try to fetch existing sheet
        const { data: existingSheet, error: fetchError } = await supabase
          .from('provider_sheets')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('provider_id', providerId)
          .eq('month', month)
          .eq('year', year)
          .maybeSingle()

        let sheet: ProviderSheet

        if (existingSheet && !fetchError) {
          sheet = existingSheet
        } else {
          // Create new sheet if doesn't exist
          const { data: newSheet, error: createError } = await supabase
            .from('provider_sheets')
            .insert({
              clinic_id: clinicId,
              provider_id: providerId,
              month,
              year,
              row_data: [],
              locked: false,
              locked_columns: [],
            })
            .select()
            .maybeSingle()

          if (createError) {
            console.error('Error creating provider sheet:', createError)
            continue
          }
          if (!newSheet) {
            console.error('Failed to create provider sheet - no data returned')
            continue
          }
          sheet = newSheet
        }

        sheetsMap[providerId] = sheet
        const sheetRows = Array.isArray(sheet.row_data) ? sheet.row_data : []
        
        // Add empty rows to reach 200 total rows per provider
        const createEmptyProviderSheetRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
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
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        
        const emptyRowsNeeded = Math.max(0, 200 - sheetRows.length)
        const emptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyProviderSheetRow(i)
        )
        rowsMap[providerId] = [...sheetRows, ...emptyRows]
      }

      setProviderSheets(sheetsMap)
      setProviderSheetRows(rowsMap)
    } catch (error) {
      console.error('Error fetching provider sheets:', error)
    }
  }



  const saveProviderSheetRows = useCallback(async (providerId: string, rowsToSave: SheetRow[]) => {
    if (!clinicId || !userProfile) return

    const sheet = providerSheets[providerId]
    if (!sheet) return

    // Filter out empty rows (they shouldn't be saved)
    const rowsToProcess = rowsToSave.filter(r => !r.id.startsWith('empty-'))

    try {
      const { error } = await supabase
        .from('provider_sheets')
        .update({
          row_data: rowsToProcess,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sheet.id)

      if (error) throw error
      
      // Ensure empty rows are maintained after save
      setProviderSheetRows(prev => {
        const currentRows = prev[providerId] || []
        const nonEmptyRows = currentRows.filter(r => !r.id.startsWith('empty-'))
        const emptyRowsNeeded = Math.max(0, 200 - nonEmptyRows.length)
        const createEmptyRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
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
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyRow(i)
        )
        return {
          ...prev,
          [providerId]: [...nonEmptyRows, ...newEmptyRows]
        }
      })
    } catch (error) {
      console.error('Error saving provider sheet rows:', error)
    }
  }, [clinicId, userProfile, providerSheets])

  const handleUpdateProviderSheetRow = useCallback((providerId: string, rowId: string, field: string, value: any) => {
    setProviderSheetRows(prev => {
      const rows = prev[providerId] || []
      const updatedRows = rows.map(row => {
        if (row.id === rowId) {
          // If updating an empty row, convert it to a new- prefixed row
          if (row.id.startsWith('empty-')) {
            const newId = `new-${Date.now()}-${Math.random()}`
            const updated: SheetRow = {
              ...row,
              id: newId,
              [field]: value,
              updated_at: new Date().toISOString()
            }
            if (field === 'billing_code') {
              const code = billingCodes.find(c => c.code === value)
              updated.billing_code_color = code?.color || null
            } else if (field === 'cpt_code') {
              // Handle multiple CPT codes (comma-separated)
              if (value) {
                const codes = value.split(',').map((c: string) => c.trim())
                const colors = codes.map((c: string) => {
                  const code = billingCodes.find(bc => bc.code === c)
                  return code?.color || '#cccccc'
                })
                updated.cpt_code_color = colors.join(',')
              } else {
                updated.cpt_code_color = null
              }
            } else if (field === 'appointment_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'appointment')
              updated.appointment_status_color = status?.color || null
            } else if (field === 'claim_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'claim')
              updated.claim_status_color = status?.color || null
            } else if (field === 'patient_pay_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'patient_pay')
              updated.patient_pay_status_color = status?.color || null
            } else if (field === 'payment_date') {
              const month = statusColors.find(s => s.status === value && s.type === 'month')
              updated.payment_date_color = month?.color || null
            } else if (field === 'ar_date') {
              const month = statusColors.find(s => s.status === value && s.type === 'month')
              updated.ar_date_color = month?.color || null
            }
            return updated
          }
          const updated = { ...row, [field]: value, updated_at: new Date().toISOString() }
          if (field === 'billing_code') {
            const code = billingCodes.find(c => c.code === value)
            updated.billing_code_color = code?.color || null
          } else if (field === 'cpt_code') {
            // Handle multiple CPT codes (comma-separated)
            if (value) {
              const codes = value.split(',').map((c: string) => c.trim())
              const colors = codes.map((c: string) => {
                const code = billingCodes.find(bc => bc.code === c)
                return code?.color || '#cccccc'
              })
              updated.cpt_code_color = colors.join(',')
            } else {
              updated.cpt_code_color = null
            }
          } else if (field === 'appointment_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'appointment')
            updated.appointment_status_color = status?.color || null
          } else if (field === 'claim_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'claim')
            updated.claim_status_color = status?.color || null
          } else if (field === 'patient_pay_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'patient_pay')
            updated.patient_pay_status_color = status?.color || null
          } else if (field === 'payment_date') {
            const month = statusColors.find(s => s.status === value && s.type === 'month')
            updated.payment_date_color = month?.color || null
          } else if (field === 'ar_date') {
            const month = statusColors.find(s => s.status === value && s.type === 'month')
            updated.ar_date_color = month?.color || null
          }
          return updated
        }
        return row
      })
      
      // Ensure we maintain 200 rows total per provider
      const nonEmptyRows = updatedRows.filter(r => !r.id.startsWith('empty-'))
      const emptyRowsNeeded = Math.max(0, 200 - nonEmptyRows.length)
      const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
      if (emptyRowsNeeded > existingEmptyCount) {
        const createEmptyRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
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
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        const newEmptyRows = Array.from({ length: emptyRowsNeeded - existingEmptyCount }, (_, i) => 
          createEmptyRow(existingEmptyCount + i)
        )
        return { ...prev, [providerId]: [...updatedRows, ...newEmptyRows] }
      }
      return { ...prev, [providerId]: updatedRows }
    })
  }, [billingCodes, statusColors])

  const handleAddProviderSheetRow = useCallback(async (providerId: string) => {
    // Ensure provider sheet exists
    let sheet = providerSheets[providerId]
    
    if (!sheet) {
      // Create provider sheet if it doesn't exist
      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()
      
      const { data: newSheet, error } = await supabase
        .from('provider_sheets')
        .insert({
          clinic_id: clinicId!,
          provider_id: providerId,
          month,
          year,
          row_data: [],
          locked: false,
          locked_columns: [],
        })
        .select()
        .maybeSingle()
      
      if (error) {
        console.error('Error creating provider sheet:', error)
        return
      }
      
      if (!newSheet) {
        console.error('Failed to create provider sheet - no data returned')
        return
      }
      
      sheet = newSheet
      setProviderSheets(prev => ({ ...prev, [providerId]: sheet! }))
    }
    
    const newRow: SheetRow = {
      id: `row-${Date.now()}-${Math.random()}`,
      patient_id: null,
      patient_first_name: null,
      patient_last_name: null,
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
      last_initial: null,
      cpt_code: null,
      cpt_code_color: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    
    setProviderSheetRows(prev => {
      const rows = prev[providerId] || []
      return { ...prev, [providerId]: [newRow, ...rows] }
    })
    
    setEditingProviderCell({ providerId, rowId: newRow.id, field: 'billing_code' })
  }, [clinicId, providerSheets])

  const handleDeleteProviderSheetRow = useCallback(async (providerId: string, rowId: string) => {
    if (!confirm('Are you sure you want to delete this row?')) return

    setProviderSheetRows(prev => {
      const rows = prev[providerId] || []
      return { ...prev, [providerId]: rows.filter(r => r.id !== rowId) }
    })
    
    // Save immediately after deletion
    const updatedRows = providerSheetRowsRef.current[providerId]?.filter(r => r.id !== rowId) || []
    await saveProviderSheetRows(providerId, updatedRows)
  }, [saveProviderSheetRows])

  const saveAllProviderSheetRows = useCallback(async (rowsToSave: Record<string, SheetRow[]>) => {
    console.log('Saving all provider sheet rows:', rowsToSave)
    for (const [providerId, rows] of Object.entries(rowsToSave)) {
      await saveProviderSheetRows(providerId, rows)
    }
  }, [saveProviderSheetRows])

  const { saveImmediately: saveProviderSheetRowsImmediately } = useDebouncedSave<Record<string, SheetRow[]>>(
    saveAllProviderSheetRows,
    providerSheetRows,
    1000
  )

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    navigate(`/clinic/${clinicId}/${tab}`, { replace: true })
  }

  const getRegularNotes = (todoId: string) => {
    const notes = todoNotes[todoId] || []
    const regularNotes = notes.filter(note => !note.note.startsWith('[F/U]')).map(n => n.note)
    return regularNotes.join('; ') || '-'
  }

  const getFollowUpNotes = (todoId: string) => {
    const notes = todoNotes[todoId] || []
    const followUpNotes = notes
      .filter(note => note.note.startsWith('[F/U]'))
      .map(n => n.note.replace(/^\[F\/U\]\s*/, ''))
    return followUpNotes.join('; ') || '-'
  }

  const canEdit = userProfile?.role === 'super_admin'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">{clinic?.name || 'Clinic Details'}</h1>
        {clinic?.address && <p className="text-white/70">{clinic.address}</p>}
      </div>

      <div className="flex gap-2 mb-6 border-b border-white/20">
        <button
          onClick={() => handleTabChange('patients')}
          className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'patients'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-white/70 hover:text-white'
          }`}
        >
          <Users size={18} />
          Patient Info
        </button>
        <button
          onClick={() => handleTabChange('todo')}
          className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'todo'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-white/70 hover:text-white'
          }`}
        >
          <CheckSquare size={18} />
          Billing To-Do
        </button>
        <button
          onClick={() => handleTabChange('providers')}
          className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'providers'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-white/70 hover:text-white'
          }`}
        >
          <FileText size={18} />
          Providers
        </button>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20">
        {activeTab === 'patients' && (
          <div className="p-6">
            <div className="table-container dark-theme" style={{ 
              maxHeight: '600px', 
              overflowX: 'scroll', 
              overflowY: 'scroll',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px'
            }}>
              <table className="table-spreadsheet dark-theme">
                <thead>
                  <tr className='sticky top-0 z-10 bg-[#0a7b71]'>
                    <th>Patient ID</th>
                    <th>Patient First</th>
                    <th>Patient Last</th>
                    <th>Insurance</th>
                    <th>Copay</th>
                    <th>Coinsurance</th>
                    {canEdit && <th style={{ width: '60px' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {canEdit && (
                    <tr className="editing" onClick={handleAddPatientRow} style={{ cursor: 'pointer' }}>
                      <td colSpan={canEdit ? 7 : 6} style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)' }}>
                        Click here to add a new patient row
                      </td>
                    </tr>
                  )}
                  {patients.length === 0 && !canEdit ? (
                    <tr>
                      <td colSpan={6} className="text-center text-white/70 py-8">
                        No patients found for this clinic
                      </td>
                    </tr>
                  ) : (
                    patients.map((patient) => {
                      const isNew = patient.id.startsWith('new-')
                      return (
                        <tr key={patient.id} className={isNew ? 'editing' : ''}>
                          <td>
                            {editingPatientCell?.patientId === patient.id && editingPatientCell?.field === 'patient_id' ? (
                              <input
                                type="text"
                                value={patient.patient_id}
                                onChange={(e) => handleUpdatePatient(patient.id, 'patient_id', e.target.value)}
                                onFocus={() => setEditingPatientCell({ patientId: patient.id, field: 'patient_id' })}
                                onBlur={() => {
                                  setEditingPatientCell(null)
                                  savePatientsImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingPatientCell({ patientId: patient.id, field: 'patient_id' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                                style={{ fontFamily: 'monospace', fontSize: '12px' }}
                              >
                                {patient.patient_id || (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          <td>
                            {editingPatientCell?.patientId === patient.id && editingPatientCell?.field === 'first_name' ? (
                              <input
                                type="text"
                                value={patient.first_name}
                                onChange={(e) => handleUpdatePatient(patient.id, 'first_name', e.target.value)}
                                onFocus={() => setEditingPatientCell({ patientId: patient.id, field: 'first_name' })}
                                onBlur={() => {
                                  setEditingPatientCell(null)
                                  savePatientsImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingPatientCell({ patientId: patient.id, field: 'first_name' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                {patient.first_name || (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          <td>
                            {editingPatientCell?.patientId === patient.id && editingPatientCell?.field === 'last_name' ? (
                              <input
                                type="text"
                                value={patient.last_name}
                                onChange={(e) => handleUpdatePatient(patient.id, 'last_name', e.target.value)}
                                onFocus={() => setEditingPatientCell({ patientId: patient.id, field: 'last_name' })}
                                onBlur={() => {
                                  setEditingPatientCell(null)
                                  savePatientsImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingPatientCell({ patientId: patient.id, field: 'last_name' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                {patient.last_name || (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          <td>
                            {editingPatientCell?.patientId === patient.id && editingPatientCell?.field === 'insurance' ? (
                              <input
                                type="text"
                                value={patient.insurance || ''}
                                onChange={(e) => handleUpdatePatient(patient.id, 'insurance', e.target.value || null)}
                                onFocus={() => setEditingPatientCell({ patientId: patient.id, field: 'insurance' })}
                                onBlur={() => {
                                  setEditingPatientCell(null)
                                  savePatientsImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingPatientCell({ patientId: patient.id, field: 'insurance' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                {patient.insurance || (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          <td>
                            {editingPatientCell?.patientId === patient.id && editingPatientCell?.field === 'copay' ? (
                              <input
                                type="number"
                                step="0.01"
                                value={patient.copay || ''}
                                onChange={(e) => handleUpdatePatient(patient.id, 'copay', e.target.value)}
                                onFocus={() => setEditingPatientCell({ patientId: patient.id, field: 'copay' })}
                                onBlur={() => {
                                  setEditingPatientCell(null)
                                  savePatientsImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingPatientCell({ patientId: patient.id, field: 'copay' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                {patient.copay ? `$${patient.copay.toFixed(2)}` : (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          <td>
                            {editingPatientCell?.patientId === patient.id && editingPatientCell?.field === 'coinsurance' ? (
                              <input
                                type="number"
                                step="0.01"
                                value={patient.coinsurance || ''}
                                onChange={(e) => handleUpdatePatient(patient.id, 'coinsurance', e.target.value)}
                                onFocus={() => setEditingPatientCell({ patientId: patient.id, field: 'coinsurance' })}
                                onBlur={() => {
                                  setEditingPatientCell(null)
                                  savePatientsImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingPatientCell({ patientId: patient.id, field: 'coinsurance' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                {patient.coinsurance ? `${patient.coinsurance}%` : (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          {canEdit && (
                            <td>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  console.log('Delete button clicked for patient:', patient.id)
                                  handleDeletePatient(patient.id)
                                }}
                                className="text-red-400 hover:text-red-300"
                                style={{ padding: '4px', cursor: 'pointer' }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'todo' && (
          <div className="p-6">
            <div className="table-container dark-theme" style={{ 
              maxHeight: '600px', 
              overflowX: 'scroll', 
              overflowY: 'scroll',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px'
            }}>
              <table className="table-spreadsheet dark-theme">
                <thead>
                  <tr className='sticky top-0 z-10 bg-[#0a7b71]'>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Issue</th>
                    <th>Notes</th>
                    <th>F/u notes</th>
                    {canEdit && <th style={{ width: '60px' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {canEdit && (
                    <tr className="editing" onClick={handleAddTodoRow} style={{ cursor: 'pointer' }}>
                      <td colSpan={canEdit ? 6 : 5} style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)' }}>
                        Click here to add a new to-do item row
                      </td>
                    </tr>
                  )}
                  {todos.length === 0 && !canEdit ? (
                    <tr>
                      <td colSpan={5} className="text-center text-white/70 py-8">
                        No billing to-do items found for this clinic
                      </td>
                    </tr>
                  ) : (
                    todos.map((todo) => {
                      const isNew = todo.id.startsWith('new-')
                      return (
                        <tr key={todo.id} className={isNew ? 'editing' : ''}>
                          <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                            {todo.id.substring(0, 8)}...
                          </td>
                          <td>
                            {editingTodoCell?.todoId === todo.id && editingTodoCell?.field === 'status' ? (
                              <select
                                value={todo.status}
                                onChange={(e) => handleUpdateTodo(todo.id, 'status', e.target.value)}
                                onFocus={() => setEditingTodoCell({ todoId: todo.id, field: 'status' })}
                                onBlur={() => {
                                  setEditingTodoCell(null)
                                  saveTodosImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ 
                                  color: '#ffffff', 
                                  backgroundColor: todo.status === 'Open' ? '#238eff' : 
                                                   todo.status === 'In Progress' ? '#714ec5' : 
                                                   todo.status === 'Completed' ? '#00bb5a' : 
                                                   '#714ec5',
                                  fontWeight: '500'
                                }}
                              >
                                <option value="Open" style={{backgroundColor: '#238eff', color: '#ffffff' }}>Open</option>
                                <option value="In Progress" style={{ backgroundColor: '#714ec5', color: '#ffffff' }}>In Progress</option>
                                <option value="Completed" style={{ backgroundColor: '#00bb5a', color: '#ffffff' }}>Completed</option>
                              </select>
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingTodoCell({ todoId: todo.id, field: 'status' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                <span 
                                  className="status-badge" 
                                  style={{ 
                                    backgroundColor: todo.status === 'Open' ? '#238eff' : 
                                                     todo.status === 'In Progress' ? '#714ec5' : 
                                                     todo.status === 'Completed' ? '#00bb5a' : 
                                                     'rgba(255,255,255,0.1)', 
                                    color: '#ffffff',
                                    padding: '4px 12px',
                                    borderRadius: '4px',
                                    display: 'inline-block',
                                    fontWeight: '500'
                                  }}
                                >
                                  {todo.status}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            {editingTodoCell?.todoId === todo.id && editingTodoCell?.field === 'title' ? (
                              <input
                                type="text"
                                value={todo.title}
                                onChange={(e) => handleUpdateTodo(todo.id, 'title', e.target.value)}
                                onFocus={() => setEditingTodoCell({ todoId: todo.id, field: 'title' })}
                                onBlur={() => {
                                  setEditingTodoCell(null)
                                  saveTodosImmediately()
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingTodoCell({ todoId: todo.id, field: 'title' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                {todo.title || (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          <td>
                            {editingNoteCell?.todoId === todo.id && editingNoteCell?.noteType === 'regular' ? (
                              <textarea
                                defaultValue={getRegularNotes(todo.id) === '-' ? '' : getRegularNotes(todo.id)}
                                onBlur={(e) => {
                                  handleSaveTodoNote(todo.id, e.target.value, 'regular')
                                  setEditingNoteCell(null)
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)', padding: '4px 8px', minHeight: '60px', resize: 'vertical', width: '100%' }}
                                placeholder="Add notes..."
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingNoteCell({ todoId: todo.id, noteType: 'regular' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                                style={{ minHeight: '40px' }}
                              >
                                <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{getRegularNotes(todo.id) || (canEdit ? 'Click to add' : '-')}</div>
                              </div>
                            )}
                          </td>
                          <td>
                            {editingNoteCell?.todoId === todo.id && editingNoteCell?.noteType === 'followup' ? (
                              <textarea
                                defaultValue={getFollowUpNotes(todo.id) === '-' ? '' : getFollowUpNotes(todo.id)}
                                onBlur={(e) => {
                                  handleSaveTodoNote(todo.id, e.target.value, 'followup')
                                  setEditingNoteCell(null)
                                }}
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)', padding: '4px 8px', minHeight: '60px', resize: 'vertical', width: '100%' }}
                                placeholder="Add follow-up notes..."
                              />
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingNoteCell({ todoId: todo.id, noteType: 'followup' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                                style={{ minHeight: '40px' }}
                              >
                                <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{getFollowUpNotes(todo.id) || (canEdit ? 'Click to add' : '-')}</div>
                              </div>
                            )}
                          </td>
                          {canEdit && (
                            <td>
                              <button
                                onClick={() => handleDeleteTodo(todo.id)}
                                className="text-red-400 hover:text-red-300"
                                style={{ padding: '4px' }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'providers' && (
          <div className="p-6">
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
            
            {/* Month Selector */}
            <div className="mb-4 flex items-center justify-center gap-4 bg-slate-800/50 rounded-lg p-3 border border-slate-700">
              <button
                onClick={handlePreviousMonth}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-white"
                title="Previous month"
              >
                <ChevronLeft size={20} />
              </button>
              
              <div className="text-lg font-semibold text-white min-w-[200px] text-center">
                {formatMonthYear(selectedMonth)}
              </div>
              
              <button
                onClick={handleNextMonth}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-white"
                title="Next month"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="table-container dark-theme" style={{ 
              maxHeight: '600px', 
              overflowX: 'scroll', 
              overflowY: 'scroll',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px'
            }}>
              <table className="table-spreadsheet dark-theme w-full">
                <thead>
                  <tr className='sticky top-0 z-10'>
                    {(() => {
                      const renderHeaderWithLock = (columnName: string, displayName: string, bgColor: string, txtColor: string, width: string) => {
                        const lockInfo = isColumnLocked(columnName, providerId)
                        const isLocked = !!lockInfo
                        
                        return (
                          <th 
                            className="relative group" 
                            style={{ 
                              minWidth: width, 
                              backgroundColor: bgColor,
                              color: txtColor
                            }}
                            title={lockInfo?.comment || undefined}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span>{displayName}</span>
                              {canEdit && (
                                <button
                                  onClick={() => {
                                    setSelectedLockColumn({ columnName, providerId: providerId || null })
                                    setLockComment(lockInfo?.comment || '')
                                    setShowLockDialog(true)
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
                                  title={isLocked ? `Locked: ${lockInfo?.comment || 'No comment'}` : 'Click to lock column'}
                                >
                                  {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                                </button>
                              )}
                            </div>
                          </th>
                        )
                      }

                      return (
                        <>
                          {renderHeaderWithLock('patient_id', 'Patient ID', '#f5cbcc', '#000000', '100px')}
                          {renderHeaderWithLock('patient_first_name', 'First Name', '#f5cbcc', '#000000', '120px')}
                          {renderHeaderWithLock('patient_last_name', 'Last Initial', '#f5cbcc', '#000000', '80px')}
                          {renderHeaderWithLock('patient_insurance', 'Insurance', '#f5cbcc', '#000000', '120px')}
                          {renderHeaderWithLock('patient_copay', 'Co-pay', '#f5cbcc', '#000000', '80px')}
                          {renderHeaderWithLock('patient_coinsurance', 'Co-Ins', '#f5cbcc', '#000000', '80px')}
                          {renderHeaderWithLock('appointment_date', 'Date of Service', '#f5cbcc', '#000000', '120px')}

                          {renderHeaderWithLock('cpt_code', 'CPT Code', '#fce5cd', '#000000', '120px')}
                          {renderHeaderWithLock('appointment_status', 'Appt/Note Status', '#fce5cd', '#000000', '150px')}

                          {renderHeaderWithLock('claim_status', 'Claim Status', '#ead1dd', '#000000', '120px')}
                          {renderHeaderWithLock('submit_date', 'Most Recent Submit Date', '#ead1dd', '#000000', '120px')}

                          {renderHeaderWithLock('insurance_payment', 'Ins Pay', '#d9d2e9', '#000000', '100px')}
                          {renderHeaderWithLock('payment_date', 'Ins Pay Date', '#d9d2e9', '#000000', '100px')}
                          {renderHeaderWithLock('insurance_adjustment', 'PT RES', '#d9d2e9', '#000000', '100px')}

                          {renderHeaderWithLock('collected_from_patient', 'Collected from PT', '#b191cd', '#000000', '120px')}
                          {renderHeaderWithLock('patient_pay_status', 'PT Pay Status', '#b191cd', '#000000', '120px')}
                          {renderHeaderWithLock('ar_date', 'PT Payment AR Ref Date', '#b191cd', '#000000', '120px')}

                          {renderHeaderWithLock('insurance_adjustment', 'Total', '#d9d2e9', '#000000', '100px')}

                          {renderHeaderWithLock('notes', 'Notes', '#5d9f5d', '#000000', '150px')}
                          {canEdit && <th style={{ width: '60px', backgroundColor: '#5d9f5d', color: '#000000' }}>Actions</th>}
                        </>
                      )
                    })()}
                  </tr>
                </thead>
                <tbody>
                  {canEdit && (
                    <tr className="editing" onClick={() => {
                      // Add row to selected provider or first provider if exists
                      const targetProviderId = providerId || (providers.length > 0 ? providers[0].id : null)
                      if (targetProviderId) {
                        handleAddProviderSheetRow(targetProviderId)
                      }
                    }} style={{ cursor: 'pointer' }}>
                      <td colSpan={canEdit ? 20 : 19} style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)' }}>
                        Click here to add a new row
                      </td>
                    </tr>
                  )}
                  {(() => {
                    // If providerId is in URL, show only that provider's data
                    // Otherwise, show all providers' data
                    const providersToShow = providerId 
                      ? providers.filter(p => p.id === providerId)
                      : providers
                    if (providersToShow.length === 0) {
                      return (
                        <tr>
                          <td colSpan={canEdit ? 20 : 19} className="text-center text-white/70 py-8">
                            {providerId ? 'Provider not found' : 'No providers found for this clinic'}
                          </td>
                        </tr>
                      )
                    }
                    
                    return providersToShow.flatMap((provider) => {
                      const allRows = providerSheetRows[provider.id] || []
                      
                      // Filter rows by selected month
                      const rows = filterRowsByMonth(allRows)
                    
                      // Filter out empty rows for display logic, but still show them in the table
                      const nonEmptyRows = rows.filter(r => !r.id.startsWith('empty-'))
                      
                      if (nonEmptyRows.length === 0 && rows.filter(r => r.id.startsWith('empty-')).length === 0) {
                        // Show empty row if no rows exist - clicking will add a row
                        return (
                          <tr key={provider.id}>
                            <td colSpan={canEdit ? 20 : 19}>
                              {canEdit ? (
                                <div
                                  onClick={async () => {
                                    await handleAddProviderSheetRow(provider.id)
                                  }}
                                  className="cursor-pointer text-white/50 italic hover:text-white text-center py-4"
                                >
                                  Click to add a row
                                </div>
                              ) : (
                                <span className="text-white/50 text-center block py-4">No data</span>
                              )}
                            </td>
                          </tr>
                        )
                      }
                      
                      // Show all rows (including empty ones) for spreadsheet-like feel
                      return rows.map((row) => {
                        const isEmpty = row.id.startsWith('empty-')
                        
                        // Helper function to render editable cell
                        const renderEditableCell = (field: keyof SheetRow, type: 'text' | 'date' | 'number' | 'select' | 'patient' | 'month', options?: string[]) => {
                          // Check if column is locked
                          const lockInfo = isColumnLocked(field, provider.id)
                          const isLocked = !!lockInfo
                          
                          const isEditing = editingProviderCell?.providerId === provider.id && 
                                          editingProviderCell?.rowId === row.id && 
                                          editingProviderCell?.field === field
                          
                          const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
                          
                          // Helper function to get status color type based on field
                          const getStatusType = (): 'appointment' | 'claim' | 'patient_pay' | 'month' | 'cpt_code' | null => {
                            if (field === 'appointment_status') return 'appointment'
                            if (field === 'claim_status') return 'claim'
                            if (field === 'patient_pay_status') return 'patient_pay'
                            if (field === 'payment_date' || field === 'ar_date') return 'month'
                            if (field === 'cpt_code') return 'cpt_code'
                            return null
                          }
                          
                          if (isEditing) {
                            // let step: string = type === 'number' ? '0.01' : undefined
                            if (type === 'select') {
                              const statusType = getStatusType()
                              const currentValue = row[field] as string
                              
                              // For multi-select CPT codes
                              if (field === 'cpt_code') {
                                const selectedCodes = currentValue ? currentValue.split(',').map(c => c.trim()) : []
                                
                                return (
                                  <select
                                    multiple
                                    value={selectedCodes}
                                    onChange={(e) => {
                                      const selected = Array.from(e.target.selectedOptions).map(opt => opt.value)
                                      handleUpdateProviderSheetRow(provider.id, row.id, field, selected.join(',') || null)
                                    }}
                                    onBlur={() => {
                                      setEditingProviderCell(null)
                                      saveProviderSheetRowsImmediately()
                                    }}
                                    className="w-full patient-input-edit"
                                    style={{ 
                                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                      color: '#000000',
                                      minHeight: '100px'
                                    }}
                                  >
                                    {options?.map(opt => {
                                      const code = billingCodes.find(c => c.code === opt)
                                      return (
                                        <option 
                                          key={opt} 
                                          value={opt}
                                          style={{ 
                                            backgroundColor: code?.color || '#ffffff',
                                            color: '#ffffff',
                                            fontWeight: '500',
                                            padding: '4px 8px'
                                          }}
                                        >
                                          {opt}
                                        </option>
                                      )
                                    })}
                                  </select>
                                )
                              }
                              
                              // For single-select status fields
                              let currentColorConfig: { color: string; text_color: string } | null = null
                              if (statusType && currentValue) {
                                const status = statusColors.find(s => s.status === currentValue && s.type === statusType)
                                if (status) {
                                  currentColorConfig = { color: status.color, text_color: status.text_color }
                                }
                              }
                              
                              return (
                                <select
                                  value={currentValue || ''}
                                  onChange={(e) => handleUpdateProviderSheetRow(provider.id, row.id, field, e.target.value || null)}
                                  onBlur={() => {
                                    setEditingProviderCell(null)
                                    saveProviderSheetRowsImmediately()
                                  }}
                                  className="w-full patient-input-edit"
                                  style={{ 
                                    backgroundColor: currentColorConfig?.color || 'rgba(255, 255, 255, 0.9)',
                                    color: currentColorConfig?.text_color || '#000000',
                                    fontWeight: currentColorConfig ? '500' : 'normal'
                                  }}
                                >
                                  <option value="" style={{ backgroundColor: '#ffffff', color: '#000000' }}>Select...</option>
                                  {options?.map(opt => {
                                    let optionColorConfig: { color: string; text_color: string } | null = null
                                    if (statusType) {
                                      const status = statusColors.find(s => s.status === opt && s.type === statusType)
                                      if (status) {
                                        optionColorConfig = { color: status.color, text_color: status.text_color }
                                      }
                                    }
                                    
                                    return (
                                      <option 
                                        key={opt} 
                                        value={opt}
                                        style={{ 
                                          backgroundColor: optionColorConfig?.color || '#ffffff',
                                          color: optionColorConfig?.text_color || '#000000',
                                          fontWeight: '500'
                                        }}
                                      >
                                        {opt}
                                      </option>
                                    )
                                  })}
                                </select>
                              )
                            } else if (type === 'month') {
                              const currentValue = row[field] as string
                              const currentColorConfig = currentValue 
                                ? statusColors.find(s => s.status === currentValue && s.type === 'month')
                                : null
                              
                              return (
                                <select
                                  value={currentValue || ''}
                                  onChange={(e) => handleUpdateProviderSheetRow(provider.id, row.id, field, e.target.value || null)}
                                  onBlur={() => {
                                    setEditingProviderCell(null)
                                    saveProviderSheetRowsImmediately()
                                  }}
                                  className="w-full patient-input-edit"
                                  style={{ 
                                    backgroundColor: currentColorConfig?.color || 'rgba(255, 255, 255, 0.9)',
                                    color: currentColorConfig?.text_color || '#000000',
                                    fontWeight: currentColorConfig ? '500' : 'normal'
                                  }}
                                >
                                  <option value="" style={{ backgroundColor: '#ffffff', color: '#000000' }}>Select Month...</option>
                                  {months.map(month => {
                                    const colorConfig = statusColors.find(s => s.status === month && s.type === 'month')
                                    
                                    // Debug: log color config for January
                                    if (month === 'January') {
                                      console.log(`Color config for ${month}:`, colorConfig)
                                    }
                                    
                                    return (
                                      <option 
                                        key={month} 
                                        value={month}
                                        style={{ 
                                          backgroundColor: colorConfig?.color || '#ffffff',
                                          color: colorConfig?.text_color || '#000000',
                                          fontWeight: '500'
                                        }}
                                      >
                                        {month}
                                      </option>
                                    )
                                  })}
                                </select>
                              )
                            } else if (type === 'patient') {
                              return (
                                <select
                                  value={row.patient_id || ''}
                                  onChange={(e) => handleUpdateProviderSheetRow(provider.id, row.id, 'patient_id', e.target.value || null)}
                                  onBlur={() => {
                                    setEditingProviderCell(null)
                                    saveProviderSheetRowsImmediately()
                                  }}
                                  className="w-full patient-input-edit"
                                  style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                                >
                                  <option value="">Select Patient...</option>
                                  {patients.map(p => (
                                    <option key={p.id} value={p.patient_id}>
                                      {p.patient_id} - {p.first_name} {p.last_name}
                                    </option>
                                  ))}
                                </select>
                              )
                            } else {
                              return (
                                <input
                                  type={type}
                                  value={row[field] as string || ''}
                                  step={type === 'number' ? '0.01' : undefined}
                                  onChange={(e) => {
                                    const value = type === 'number' ? (e.target.value ? parseFloat(e.target.value) : null) : e.target.value || null
                                    handleUpdateProviderSheetRow(provider.id, row.id, field, value)
                                  }}
                                  onBlur={() => {
                                    setEditingProviderCell(null)
                                    saveProviderSheetRowsImmediately()
                                  }}
                                  className="w-full patient-input-edit"
                                  style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                                />
                              )
                            }
                          }
                          
                          // Special handling for multi-select CPT codes
                          if (field === 'cpt_code' && row[field]) {
                            const codes = String(row[field]).split(',').map(c => c.trim()).filter(c => c)
                            const colors = row.cpt_code_color ? String(row.cpt_code_color).split(',').map(c => c.trim()) : []
                            
                            return (
                              <div
                                onClick={() => !isLocked && canEdit && setEditingProviderCell({ providerId: provider.id, rowId: row.id, field })}
                                className={!isLocked && canEdit ? 'cursor-pointer' : isLocked ? 'cursor-not-allowed' : ''}
                                style={{ 
                                  minHeight: '24px',
                                  padding: '4px',
                                  opacity: isLocked ? 0.8 : 1
                                }}
                                title={isLocked ? `🔒 Locked: ${lockInfo?.comment || 'No comment'}` : undefined}
                              >
                                <div className="flex items-center gap-1 flex-wrap">
                                  {isLocked && <Lock size={12} className="flex-shrink-0" />}
                                  {codes.map((code, idx) => {
                                    // Use stored color or fallback to looking up from billingCodes
                                    const storedColor = colors[idx]
                                    const billingCode = billingCodes.find(c => c.code === code)
                                    const bgColor = storedColor || billingCode?.color || '#cccccc'
                                    
                                    return (
                                      <span 
                                        key={idx}
                                        style={{
                                          backgroundColor: bgColor,
                                          color: '#ffffff',
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          fontSize: '12px',
                                          fontWeight: '500',
                                          border: isLocked ? '2px solid rgba(0, 0, 0, 0.3)' : undefined
                                        }}
                                      >
                                        {code}
                                      </span>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          }
                          
                          // Get color for single-value fields
                          let bgColor = undefined
                          if (field === 'appointment_status' && row.appointment_status_color) {
                            bgColor = row.appointment_status_color
                          } else if (field === 'claim_status' && row.claim_status_color) {
                            bgColor = row.claim_status_color
                          } else if (field === 'patient_pay_status' && row.patient_pay_status_color) {
                            bgColor = row.patient_pay_status_color
                          } else if (field === 'payment_date' && row.payment_date_color) {
                            bgColor = row.payment_date_color
                          } else if (field === 'ar_date' && row.ar_date_color) {
                            bgColor = row.ar_date_color
                          } else if (field === 'billing_code' && row.billing_code_color) {
                            bgColor = row.billing_code_color
                          }
                          
                          return (
                            <div
                              onClick={() => !isLocked && canEdit && setEditingProviderCell({ providerId: provider.id, rowId: row.id, field })}
                              className={!isLocked && canEdit ? 'cursor-pointer' : isLocked ? 'cursor-not-allowed' : ''}
                              style={{ 
                                minHeight: '24px',
                                backgroundColor: bgColor || (isLocked ? 'rgba(200, 200, 200, 0.2)' : undefined),
                                padding: bgColor || isLocked ? '4px 8px' : undefined,
                                borderRadius: bgColor || isLocked ? '4px' : undefined,
                                color: bgColor ? '#000000' : undefined,
                                opacity: isLocked && !bgColor ? 0.6 : 1,
                                border: isLocked && bgColor ? '2px solid rgba(0, 0, 0, 0.3)' : undefined
                              }}
                              title={isLocked ? `🔒 Locked: ${lockInfo?.comment || 'No comment'}` : undefined}
                            >
                              <div className="flex items-center gap-1">
                                {isLocked && <Lock size={12} className="flex-shrink-0" />}
                                <span>{row[field] ? String(row[field]) : (canEdit && !isLocked ? 'Click to add' : '-')}</span>
                              </div>
                            </div>
                          )
                        }
                        
                        return (
                        <tr key={`${provider.id}-${row.id}`} className={isEmpty ? 'empty-row' : ''}>
                          {/* Patient ID (Blue section) */}
                          <td>{renderEditableCell('patient_id', 'text')}</td>
                          
                          {/* First Name (Blue section) */}
                          <td>{renderEditableCell('patient_first_name', 'text')}</td>
                          
                          {/* Last Initial (Blue section) */}
                          <td>
                            {renderEditableCell('last_initial', 'text')}
                          </td>
                          
                          {/* Insurance (Blue section) */}
                          <td>{renderEditableCell('patient_insurance', 'text')}</td>
                          
                          {/* Co-pay (Blue section) */}
                          <td>{renderEditableCell('patient_copay', 'number')}</td>
                          
                          {/* Co-Ins (Blue section) */}
                          <td>{renderEditableCell('patient_coinsurance', 'number')}</td>
                          
                          {/* Date of Service (Blue section) */}
                          <td>{renderEditableCell('appointment_date', 'date')}</td>
                          
                          {/* CPT Code (Orange section) */}
                          <td>{renderEditableCell('cpt_code', 'select', billingCodes.map(c => c.code))}</td>
                          
                          {/* Appt/Note Status (Orange section) */}
                          <td>
                            {renderEditableCell('appointment_status', 'select', [
                              'Complete',
                              'PP Complete',
                              'NS/LC - Charge',
                              'NS/LC/RS - No Charge',
                              'NS/LC - No Charge',
                              'Note Not Complete'
                            ])}
                          </td>
                          
                          {/* Claim Status (Dark Green section) */}
                          <td>
                            {renderEditableCell('claim_status', 'select', [
                              'Claim Sent',
                              'RS',
                              'IP',
                              'Pending Pay',
                              'Paid',
                              'Deductible',
                              'N/A',
                              'PP',
                              'Denial',
                              'Rejected',
                              'No Coverage'
                            ])}
                          </td>
                          
                          {/* Most Recent Submit Date (Dark Green section) */}
                          <td>{renderEditableCell('submit_date', 'text')}</td>
                          
                          {/* Ins Pay (Light Green section) */}
                          <td>{renderEditableCell('insurance_payment', 'text')}</td>
                          
                          {/* Ins Pay Date (Light Green section) */}
                          <td>{renderEditableCell('payment_date', 'month')}</td>
                          
                          {/* PT RES (Light Green section) - Using insurance_adjustment */}
                          <td>{renderEditableCell('insurance_adjustment', 'text')}</td>
                          
                          {/* Collected from PT (Purple section) */}
                          <td>{renderEditableCell('collected_from_patient', 'text')}</td>
                          
                          {/* PT Pay Status (Purple section) */}
                          <td>
                            {renderEditableCell('patient_pay_status', 'select', [
                              'Paid',
                              'CC declined',
                              'Secondary',
                              'Refunded',
                              'Payment Plan',
                              'Waiting on Claim',
                              'Collections'
                            ])}
                          </td>
                          
                          {/* PT Payment AR Ref Date (Purple section) - Using ar_date */}
                          <td>{renderEditableCell('ar_date', 'month')}</td>

                          {/* Total (Light Green section) - Using insurance_adjustment */}
                          <td>{renderEditableCell('total', 'text')}</td>

                          
                          {/* Notes (Light Green section) */}
                          <td>{renderEditableCell('notes', 'text')}</td>
                          
                          {canEdit && (
                            <td>
                              <button
                                onClick={() => handleDeleteProviderSheetRow(provider.id, row.id)}
                                className="text-red-400 hover:text-red-300"
                                style={{ padding: '4px' }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>
                        )
                      })
                    })
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Column Lock Dialog */}
      {showLockDialog && selectedLockColumn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-4">
              {isColumnLocked(selectedLockColumn.columnName, selectedLockColumn.providerId) ? 'Unlock' : 'Lock'} Column
            </h3>
            
            <div className="mb-4">
              <p className="text-slate-300 mb-2">
                Column: <span className="font-semibold text-white">{selectedLockColumn.columnName}</span>
              </p>
              {selectedLockColumn.providerId && (
                <p className="text-slate-300 text-sm">
                  Provider-specific lock
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-slate-300 mb-2">
                Comment (optional):
              </label>
              <textarea
                value={lockComment}
                onChange={(e) => setLockComment(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 text-white border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Why is this column locked?"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowLockDialog(false)
                  setSelectedLockColumn(null)
                  setLockComment('')
                }}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              
              {isColumnLocked(selectedLockColumn.columnName, selectedLockColumn.providerId) && (
                <button
                  onClick={() => handleToggleColumnLock(selectedLockColumn.columnName, selectedLockColumn.providerId, false)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                >
                  <Unlock size={16} />
                  Unlock
                </button>
              )}
              
              <button
                onClick={() => handleToggleColumnLock(selectedLockColumn.columnName, selectedLockColumn.providerId, true, lockComment)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
              >
                <Lock size={16} />
                Lock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}