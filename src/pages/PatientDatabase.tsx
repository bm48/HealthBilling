import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Patient } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Search, Trash2 } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'

export default function PatientDatabase() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (userProfile?.role === 'provider') {
      navigate('/providers', { replace: true })
    }
  }, [userProfile?.role, navigate])
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingCell, setEditingCell] = useState<{ patientId: string | 'new'; field: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; patientId: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const fetchPatients = useCallback(async () => {
    if (!userProfile) {
      setLoading(false)
      return
    }

    try {
      let query = supabase
        .from('patients')
        .select('*')
        .order('last_name', { ascending: true })

      // For super_admin, fetch all patients. For others, filter by clinic_ids
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('clinic_id', userProfile.clinic_ids)
      } else if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length === 0) {
        // Non-super_admin with no clinic_ids - no patients to show
        setPatients([])
        setLoading(false)
        return
      }

      const { data, error } = await query
      if (error) throw error
      setPatients(data || [])
    } catch (error) {
      console.error('Error fetching patients:', error)
    } finally {
      setLoading(false)
    }
  }, [userProfile])

  useEffect(() => {
    fetchPatients()
  }, [fetchPatients])

  const savePatients = useCallback(async (patientsToSave: Patient[]) => {
    if (!userProfile) return

    // Determine clinic_id: use first clinic_id from user, or handle super_admin
    let clinicId: string | null = null
    if (userProfile.role === 'super_admin') {
      // For super_admin, try to get clinic_id from the patient's clinic_id if it exists
      // Or use the first clinic_id from userProfile if available
      clinicId = userProfile.clinic_ids?.[0] || null
    } else {
      if (!userProfile.clinic_ids?.[0]) {
        console.warn('Cannot save: No clinic assigned')
        return
      }
      clinicId = userProfile.clinic_ids[0]
    }

    try {
      const newPatientsToCreate: Patient[] = []
      const patientsToUpdate: Patient[] = []
      
      // Separate new and existing patients
      for (const patient of patientsToSave) {
        if (patient.id.startsWith('new-')) {
          // Only create if it has at least patient_id or first_name/last_name
          if (patient.patient_id || (patient.first_name && patient.last_name)) {
            newPatientsToCreate.push(patient)
          }
        } else {
          // Update existing patient - check if it has changed
          const originalPatient = patients.find(p => p.id === patient.id)
          if (originalPatient) {
            const hasChanged = 
              originalPatient.patient_id !== patient.patient_id ||
              originalPatient.first_name !== patient.first_name ||
              originalPatient.last_name !== patient.last_name ||
              originalPatient.subscriber_id !== patient.subscriber_id ||
              originalPatient.insurance !== patient.insurance ||
              originalPatient.copay !== patient.copay ||
              originalPatient.coinsurance !== patient.coinsurance
            
            if (hasChanged) {
              patientsToUpdate.push(patient)
            }
          }
        }
      }

      // Create new patients
      for (const patient of newPatientsToCreate) {
        // Use patient's clinic_id if it exists (for super_admin), otherwise use determined clinicId
        const patientClinicId = patient.clinic_id || clinicId
        if (!patientClinicId) {
          console.error('Cannot create patient: No clinic_id available')
          continue
        }

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
          .eq('clinic_id', patientClinicId)
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
              first_name: patient.first_name || '',
              last_name: patient.last_name || '',
              subscriber_id: patient.subscriber_id || null,
              insurance: patient.insurance || null,
              copay: patient.copay || null,
              coinsurance: patient.coinsurance || null,
              date_of_birth: patient.date_of_birth || null,
              phone: patient.phone || null,
              email: patient.email || null,
              address: patient.address || null,
            })
            .eq('id', existingPatient.id)
          
          if (updateError) {
            console.error('Error updating existing patient:', updateError)
            throw updateError
          }
        } else {
          // Insert new patient
          const { error: insertError } = await supabase
            .from('patients')
            .insert({
              patient_id: finalPatientId,
              first_name: patient.first_name || '',
              last_name: patient.last_name || '',
              subscriber_id: patient.subscriber_id || null,
              insurance: patient.insurance || null,
              copay: patient.copay || null,
              coinsurance: patient.coinsurance || null,
              date_of_birth: patient.date_of_birth || null,
              phone: patient.phone || null,
              email: patient.email || null,
              address: patient.address || null,
              clinic_id: patientClinicId,
            })
          
          if (insertError) {
            // If it's a duplicate key error, try to find and update the existing patient
            if (insertError.code === '23505') {
              const { data: existingPatientData, error: findError } = await supabase
                .from('patients')
                .select('id')
                .eq('clinic_id', patientClinicId)
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
                    first_name: patient.first_name || '',
                    last_name: patient.last_name || '',
                    subscriber_id: patient.subscriber_id || null,
                    insurance: patient.insurance || null,
                    copay: patient.copay || null,
                    coinsurance: patient.coinsurance || null,
                    date_of_birth: patient.date_of_birth || null,
                    phone: patient.phone || null,
                    email: patient.email || null,
                    address: patient.address || null,
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
            subscriber_id: patient.subscriber_id || null,
            insurance: patient.insurance || null,
            copay: patient.copay || null,
            coinsurance: patient.coinsurance || null,
            date_of_birth: patient.date_of_birth || null,
            phone: patient.phone || null,
            email: patient.email || null,
            address: patient.address || null,
          })
          .eq('id', patient.id)
        
        if (error) {
          console.error('Error updating patient:', error)
          throw error
        }
      }

      // Refresh the list if we made changes
      if (newPatientsToCreate.length > 0 || patientsToUpdate.length > 0) {
        await fetchPatients()
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
  }, [userProfile, patients, fetchPatients])

  const { saveImmediately } = useDebouncedSave<Patient[]>(savePatients, patients, 1000, editingCell !== null)

  const handleUpdatePatient = useCallback((patientId: string, field: string, value: any) => {
    setPatients(prevPatients => {
      return prevPatients.map(patient => {
        if (patient.id === patientId) {
          return { ...patient, [field]: value }
        }
        return patient
      })
    })
  }, [])

  const handleAddNewRow = useCallback(() => {
    const tempId = `new-${Date.now()}`
    const newPatient: Patient = {
      id: tempId,
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
      clinic_id: userProfile?.clinic_ids[0] || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setPatients(prev => [newPatient, ...prev])
    setEditingCell({ patientId: tempId, field: 'patient_id' })
  }, [userProfile])

  const handleDelete = async (patient: Patient) => {
    if (!confirm(`Are you sure you want to delete ${patient.first_name} ${patient.last_name}?`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', patient.id)

      if (error) throw error
      await fetchPatients()
    } catch (error) {
      console.error('Error deleting patient:', error)
      alert('Failed to delete patient. Please try again.')
    }
  }

  const filteredPatients = patients.filter(patient =>
    `${patient.first_name} ${patient.last_name} ${patient.patient_id} ${patient.subscriber_id || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const canEdit = ['office_staff', 'billing_staff', 'admin', 'super_admin'].includes(userProfile?.role || '')

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent, patientId: string) => {
    if (!canEdit) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, patientId })
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [contextMenu])

  // Handle delete from context menu
  const handleContextMenuDelete = (patientId: string) => {
    const patient = patients.find(p => p.id === patientId)
    if (patient) {
      handleDelete(patient)
    }
    setContextMenu(null)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Patient Database</h1>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/50" size={20} />
            <input
              type="text"
              placeholder="Search patients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-white/70">Loading...</div>
        ) : (
          <div className="table-container dark-theme">
            <table className="table-spreadsheet dark-theme">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Subscriber ID</th>
                  <th>Insurance</th>
                  <th>Copay</th>
                  <th>Coinsurance</th>
                  {canEdit && (
                    <th style={{ width: 'auto', minWidth: '60px' }}>Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {canEdit && (
                  <tr className="editing" onClick={handleAddNewRow} style={{ cursor: 'pointer' }}>
                    <td colSpan={canEdit ? 8 : 7} style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)' }}>
                      Click here to add a new patient row
                    </td>
                  </tr>
                )}
                {filteredPatients.map((patient) => {
                  const isNew = patient.id.startsWith('new-')
                  return (
                    <tr 
                      key={patient.id} 
                      className={isNew ? 'editing' : ''}
                      onContextMenu={(e) => canEdit && !isNew && handleContextMenu(e, patient.id)}
                    >
                      <td>
                        <input
                          type="text"
                          value={patient.patient_id || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'patient_id', e.target.value)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'ID' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            fontFamily: 'monospace', 
                            fontSize: '12px',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.first_name || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'first_name', e.target.value)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'First Name' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.last_name || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'last_name', e.target.value)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'Last Name' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            fontWeight: 500,
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.subscriber_id || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'subscriber_id', e.target.value || null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'Subscriber ID' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.insurance || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'insurance', e.target.value || null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'Insurance' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={patient.copay || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'copay', e.target.value ? parseFloat(e.target.value) : null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full currency patient-input-edit"
                          placeholder={canEdit ? '0.00' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            textAlign: 'right',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={patient.coinsurance || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'coinsurance', e.target.value ? parseFloat(e.target.value) : null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full currency patient-input-edit"
                          placeholder={canEdit ? '0.00' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            textAlign: 'right',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            onClick={() => handleDelete(patient)}
                            className="text-red-400 hover:text-red-300"
                            style={{ padding: '4px' }}
                            disabled={isNew}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filteredPatients.length === 0 && !canEdit && (
                  <tr className="empty-row">
                    <td colSpan={7}>
                      No patients found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[150px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <button
            onClick={() => handleContextMenuDelete(contextMenu.patientId)}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
