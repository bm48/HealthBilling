import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Patient, TodoItem, TodoNote, ProviderSheet, SheetRow, User, Clinic, AppointmentStatus, Provider, BillingCode } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Users, CheckSquare, FileText, Trash2 } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'

type TabType = 'patients' | 'todo' | 'providers'

export default function ClinicDetail() {
  const { clinicId, tab, providerId } = useParams<{ clinicId: string; tab?: string; providerId?: string }>()
  const location = useLocation()
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
  const [editingProviderCell, setEditingProviderCell] = useState<{ providerId: string; rowId: string; field: string } | null>(null)
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
  const [editingProviderSheetCell, setEditingProviderSheetCell] = useState<{ rowId: string; field: string } | null>(null)
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
          fetchBillingCodes()
          fetchProviders()
        }
      } else {
        // When no providerId, fetch data for the active tab normally
        fetchData()
      }
    }
  }, [clinicId, activeTab, providerId])

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
        await fetchBillingCodes()
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

  const createEmptyPatient = (index: number): Patient => ({
    id: `empty-${index}`,
    clinic_id: clinicId!,
    patient_id: '',
    first_name: '',
    last_name: '',
    insurance: null,
    copay: null,
    coinsurance: null,
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

      // Get current month/year for default sheet
      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()

      // Fetch all sheets for this provider in this clinic
      const { data: sheetsData, error: sheetsError } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('provider_id', providerId)
        .order('year', { ascending: false })
        .order('month', { ascending: false })

      if (sheetsError) throw sheetsError

      // Use the most recent sheet, or create a new one if none exists
      let sheet = sheetsData && sheetsData.length > 0 ? sheetsData[0] : null

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
        appointment_date: null,
        appointment_time: null,
        visit_type: null,
        notes: null,
        billing_code: null,
        billing_code_color: null,
        appointment_status: null,
        claim_status: null,
        submit_date: null,
        insurance_payment: null,
        insurance_adjustment: null,
        invoice_amount: null,
        collected_from_patient: null,
        patient_pay_status: null,
        payment_date: null,
        ar_type: null,
        ar_amount: null,
        ar_date: null,
        ar_notes: null,
        provider_payment_amount: null,
        provider_payment_date: null,
        provider_payment_notes: null,
        highlight_color: null,
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
            appointment_date: null,
            appointment_time: null,
            visit_type: null,
            notes: null,
            billing_code: row.cpt_code || null,
            billing_code_color: null,
            appointment_status: row.appointment_status as any || null,
            claim_status: null,
            submit_date: null,
            insurance_payment: null,
            insurance_adjustment: null,
            invoice_amount: null,
            collected_from_patient: null,
            patient_pay_status: null,
            payment_date: null,
            ar_type: null,
            ar_amount: null,
            ar_date: null,
            ar_notes: null,
            provider_payment_amount: null,
            provider_payment_date: null,
            provider_payment_notes: null,
            highlight_color: null,
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

  const { saveImmediately: saveProviderRowsImmediately } = useDebouncedSave(saveProviderRows, providerRows, 1000)

  const handleUpdateProviderRow = useCallback((rowId: string, field: string, value: any) => {
    setProviderRows(prevRows =>
      prevRows.map(row => {
        if (row.id === rowId) {
          return { ...row, [field]: value }
        }
        return row
      })
    )
  }, [])

  const handleDeleteProviderRow = useCallback(async (rowId: string) => {
    if (!confirm('Are you sure you want to delete this row?')) return

    if (rowId.startsWith('new-')) {
      setProviderRows(prev => prev.filter(r => r.id !== rowId))
      return
    }

    // For existing rows, we need to remove them from the sheet
    setProviderRows(prev => prev.filter(r => r.id !== rowId))
    await saveProviderRowsImmediately()
  }, [saveProviderRowsImmediately])

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
      // Get current month/year
      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()

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
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          claim_status: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          payment_date: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
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

  const saveProviders = useCallback(async (providersToSave: Provider[]) => {
    if (!clinicId || !userProfile) return

    try {
      const newProvidersToCreate: Provider[] = []
      const providersToUpdate: Provider[] = []

      for (const provider of providersToSave) {
        if (provider.id.startsWith('new-')) {
          if (provider.first_name && provider.last_name) {
            newProvidersToCreate.push(provider)
          }
        } else {
          const originalProvider = providersRef.current.find(p => p.id === provider.id)
          if (originalProvider) {
            const hasChanged =
              originalProvider.first_name !== provider.first_name ||
              originalProvider.last_name !== provider.last_name ||
              originalProvider.specialty !== provider.specialty ||
              originalProvider.npi !== provider.npi ||
              originalProvider.email !== provider.email ||
              originalProvider.phone !== provider.phone ||
              originalProvider.active !== provider.active

            if (hasChanged) {
              providersToUpdate.push(provider)
            }
          }
        }
      }

      // Create new providers
      for (const provider of newProvidersToCreate) {
        const { data: newProvider, error } = await supabase.from('providers').insert({
          clinic_id: clinicId,
          first_name: provider.first_name,
          last_name: provider.last_name,
          specialty: provider.specialty || null,
          npi: provider.npi || null,
          email: provider.email || null,
          phone: provider.phone || null,
          active: provider.active !== undefined ? provider.active : true,
        }).select().maybeSingle()
        
        if (error) throw error
        if (!newProvider) {
          console.error('Failed to create provider - no data returned')
          continue
        }
        
        // Create a provider sheet for the new provider
        if (newProvider) {
          const now = new Date()
          const month = now.getMonth() + 1
          const year = now.getFullYear()
          
          const { data: newSheet, error: sheetError } = await supabase
            .from('provider_sheets')
            .insert({
              clinic_id: clinicId,
              provider_id: newProvider.id,
              month,
              year,
              row_data: [],
              locked: false,
              locked_columns: [],
            })
            .select()
            .maybeSingle()
          
          if (sheetError) {
            console.error('Error creating provider sheet:', sheetError)
          } else if (newSheet) {
            setProviderSheets(prev => ({ ...prev, [newProvider.id]: newSheet }))
            setProviderSheetRows(prev => ({ ...prev, [newProvider.id]: [] }))
          }
        }
      }

      // Update existing providers
      for (const provider of providersToUpdate) {
        const { error } = await supabase
          .from('providers')
          .update({
            first_name: provider.first_name,
            last_name: provider.last_name,
            specialty: provider.specialty || null,
            npi: provider.npi || null,
            email: provider.email || null,
            phone: provider.phone || null,
            active: provider.active !== undefined ? provider.active : true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', provider.id)

        if (error) throw error
      }

      if (newProvidersToCreate.length > 0 || providersToUpdate.length > 0) {
        await fetchProviders()
      }
    } catch (error) {
      console.error('Error saving providers:', error)
    }
  }, [clinicId, userProfile, fetchProviders])

  const { saveImmediately: saveProvidersImmediately } = useDebouncedSave<Provider[]>(saveProviders, providers, 1000)

  const handleUpdateProvider = useCallback((providerId: string, field: string, value: any) => {
    setProviders(prevProviders =>
      prevProviders.map(provider => {
        if (provider.id === providerId) {
          const updated = { ...provider, [field]: value, updated_at: new Date().toISOString() }
          if (field === 'active') {
            return { ...updated, active: value === true || value === 'true' }
          }
          return updated
        }
        return provider
      })
    )
  }, [])

  const handleAddProviderRow = useCallback(() => {
    const newProvider: Provider = {
      id: `new-${Date.now()}`,
      clinic_id: clinicId!,
      first_name: '',
      last_name: '',
      specialty: null,
      npi: null,
      email: null,
      phone: null,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setProviders(prev => [newProvider, ...prev])
    // Note: This function is not currently used, but kept for potential future use
    // setEditingProviderCell({ providerId: newProvider.id, field: 'first_name' })
  }, [clinicId])

  const handleDeleteProvider = useCallback(async (providerId: string) => {
    if (!confirm('Are you sure you want to delete this provider?')) return

    if (providerId.startsWith('new-')) {
      setProviders(prev => prev.filter(p => p.id !== providerId))
      return
    }

    try {
      const { error } = await supabase.from('providers').delete().eq('id', providerId)
      if (error) throw error
      await fetchProviders()
    } catch (error) {
      console.error('Error deleting provider:', error)
      alert('Failed to delete provider')
    }
  }, [fetchProviders])

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
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          claim_status: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          payment_date: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
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
            }
            return updated
          }
          const updated = { ...row, [field]: value, updated_at: new Date().toISOString() }
          if (field === 'billing_code') {
            const code = billingCodes.find(c => c.code === value)
            updated.billing_code_color = code?.color || null
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
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          claim_status: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          payment_date: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
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
  }, [billingCodes])

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
      appointment_date: null,
      appointment_time: null,
      visit_type: null,
      notes: null,
      billing_code: null,
      billing_code_color: null,
      appointment_status: null,
      claim_status: null,
      submit_date: null,
      insurance_payment: null,
      insurance_adjustment: null,
      invoice_amount: null,
      collected_from_patient: null,
      patient_pay_status: null,
      payment_date: null,
      ar_type: null,
      ar_amount: null,
      ar_date: null,
      ar_notes: null,
      provider_payment_amount: null,
      provider_payment_date: null,
      provider_payment_notes: null,
      highlight_color: null,
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
            <div className="table-container dark-theme">
              <table className="table-spreadsheet dark-theme">
                <thead>
                  <tr>
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
                                autoFocus
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
                                autoFocus
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
                                autoFocus
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
                                autoFocus
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
                                autoFocus
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
                                autoFocus
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
            <div className="table-container dark-theme">
              <table className="table-spreadsheet dark-theme">
                <thead>
                  <tr>
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
                                autoFocus
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              >
                                <option value="Open" style={{ color: '#000000' }}>Open</option>
                                <option value="In Progress" style={{ color: '#000000' }}>In Progress</option>
                                <option value="Completed" style={{ color: '#000000' }}>Completed</option>
                              </select>
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingTodoCell({ todoId: todo.id, field: 'status' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                              >
                                <span className="status-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff' }}>
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
                                autoFocus
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
                                autoFocus
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
                                autoFocus
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
            <div className="table-container dark-theme">
              <table className="table-spreadsheet dark-theme">
                <thead>
                  <tr>
                    <th>CPT Code</th>
                    <th>Appt/Note Status</th>
                    {canEdit && <th style={{ width: '60px' }}>Actions</th>}
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
                      <td colSpan={canEdit ? 3 : 2} style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)' }}>
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
                          <td colSpan={canEdit ? 3 : 2} className="text-center text-white/70 py-8">
                            {providerId ? 'Provider not found' : 'No providers found for this clinic'}
                          </td>
                        </tr>
                      )
                    }
                    
                    return providersToShow.flatMap((provider) => {
                      const rows = providerSheetRows[provider.id] || []
                      
                      // Filter out empty rows for display logic, but still show them in the table
                      const nonEmptyRows = rows.filter(r => !r.id.startsWith('empty-'))
                      
                      if (nonEmptyRows.length === 0 && rows.filter(r => r.id.startsWith('empty-')).length === 0) {
                        // Show empty row if no rows exist - clicking will add a row
                        return (
                          <tr key={provider.id}>
                            <td>
                              {canEdit ? (
                                <div
                                  onClick={async () => {
                                    await handleAddProviderSheetRow(provider.id)
                                  }}
                                  className="cursor-pointer text-white/50 italic hover:text-white"
                                >
                                  Click to add CPT Code
                                </div>
                              ) : (
                                <span className="text-white/50">-</span>
                              )}
                            </td>
                            <td>
                              {canEdit ? (
                                <div
                                  onClick={async () => {
                                    await handleAddProviderSheetRow(provider.id)
                                  }}
                                  className="cursor-pointer text-white/50 italic hover:text-white"
                                >
                                  Click to add Status
                                </div>
                              ) : (
                                <span className="text-white/50">-</span>
                              )}
                            </td>
                            {canEdit && <td></td>}
                          </tr>
                        )
                      }
                      
                      // Show all rows (including empty ones) for spreadsheet-like feel
                      return rows.map((row) => {
                        const isEmpty = row.id.startsWith('empty-')
                        return (
                        <tr key={`${provider.id}-${row.id}`} className={isEmpty ? 'empty-row' : ''}>
                          <td>
                            {editingProviderCell?.providerId === provider.id && editingProviderCell?.rowId === row.id && editingProviderCell?.field === 'billing_code' ? (
                              <select
                                value={row.billing_code || ''}
                                onChange={(e) => {
                                  handleUpdateProviderSheetRow(provider.id, row.id, 'billing_code', e.target.value || null)
                                }}
                                onBlur={() => {
                                  setEditingProviderCell(null)
                                  saveProviderSheetRowsImmediately()
                                }}
                                autoFocus
                                className="w-full patient-input-edit"
                                style={{ 
                                  color: '#000000', 
                                  backgroundColor: row.billing_code_color || 'rgba(255, 255, 255, 0.9)',
                                  borderColor: row.billing_code_color || undefined
                                }}
                              >
                                <option value="">Select CPT Code...</option>
                                {billingCodes.map(code => (
                                  <option key={code.id} value={code.code} style={{ backgroundColor: code.color }}>
                                    {code.code} - {code.description}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingProviderCell({ providerId: provider.id, rowId: row.id, field: 'billing_code' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                                style={{ 
                                  backgroundColor: row.billing_code_color || undefined,
                                  padding: row.billing_code_color ? '4px 8px' : undefined,
                                  borderRadius: row.billing_code_color ? '4px' : undefined,
                                  minHeight: '24px'
                                }}
                              >
                                {row.billing_code || (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
                          <td>
                            {editingProviderCell?.providerId === provider.id && editingProviderCell?.rowId === row.id && editingProviderCell?.field === 'appointment_status' ? (
                              <select
                                value={row.appointment_status || ''}
                                onChange={(e) => {
                                  handleUpdateProviderSheetRow(provider.id, row.id, 'appointment_status', e.target.value || null)
                                }}
                                onBlur={() => {
                                  setEditingProviderCell(null)
                                  saveProviderSheetRowsImmediately()
                                }}
                                autoFocus
                                className="w-full patient-input-edit"
                                style={{ color: '#000000', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
                              >
                                <option value="">Select Status...</option>
                                <option value="Complete">Complete</option>
                                <option value="PP Complete">PP Complete</option>
                                <option value="NS/LC/RS-no charge">NS/LC/RS-no charge</option>
                                <option value="NS/LC-Charge">NS/LC-Charge</option>
                                <option value="NS/LC-No Charge">NS/LC-No Charge</option>
                                <option value="Note Not Complete">Note Not Complete</option>
                              </select>
                            ) : (
                              <div
                                onClick={() => canEdit && setEditingProviderCell({ providerId: provider.id, rowId: row.id, field: 'appointment_status' })}
                                className={canEdit ? 'cursor-pointer' : ''}
                                style={{ minHeight: '24px' }}
                              >
                                {row.appointment_status || (canEdit ? 'Click to add' : '-')}
                              </div>
                            )}
                          </td>
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
    </div>
  )
}