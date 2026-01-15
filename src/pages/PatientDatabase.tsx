import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Patient } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Search, Edit, Trash2 } from 'lucide-react'
import PatientForm from '@/components/PatientForm'

export default function PatientDatabase() {
  const { userProfile } = useAuth()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)

  useEffect(() => {
    fetchPatients()
  }, [userProfile])

  const fetchPatients = async () => {
    if (!userProfile?.clinic_ids.length) {
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .in('clinic_id', userProfile.clinic_ids)
        .order('last_name', { ascending: true })

      if (error) throw error
      setPatients(data || [])
    } catch (error) {
      console.error('Error fetching patients:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (patientData: Partial<Patient>) => {
    if (!userProfile?.clinic_ids[0]) {
      alert('No clinic assigned')
      return
    }

    try {
      if (editingPatient) {
        const { error } = await supabase
          .from('patients')
          .update(patientData)
          .eq('id', editingPatient.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('patients')
          .insert({
            ...patientData,
            clinic_id: userProfile.clinic_ids[0],
          })

        if (error) throw error
      }

      await fetchPatients()
      setShowForm(false)
      setEditingPatient(null)
    } catch (error: any) {
      console.error('Error saving patient:', error)
      throw error
    }
  }

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
    `${patient.first_name} ${patient.last_name} ${patient.patient_id}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const canEdit = ['office_staff', 'billing_staff', 'admin', 'super_admin'].includes(userProfile?.role || '')

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Patient Database</h1>
        {canEdit && (
          <button
            onClick={() => {
              setEditingPatient(null)
              setShowForm(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus size={20} />
            Add Patient
          </button>
        )}
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/10 backdrop-blur-sm">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-white">Patient ID</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-white">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-white">Date of Birth</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-white">Phone</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-white">Email</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-white">Insurance</th>
                  {canEdit && (
                    <th className="px-4 py-3 text-left text-sm font-semibold text-white">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredPatients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-sm text-white">{patient.patient_id}</td>
                    <td className="px-4 py-3 text-sm font-medium text-white">{patient.first_name} {patient.last_name}</td>
                    <td className="px-4 py-3 text-sm text-white/70">{patient.date_of_birth || '-'}</td>
                    <td className="px-4 py-3 text-sm text-white/70">{patient.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm text-white/70">{patient.email || '-'}</td>
                    <td className="px-4 py-3 text-sm text-white/70">{patient.insurance || '-'}</td>
                    {canEdit && (
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingPatient(patient)
                              setShowForm(true)
                            }}
                            className="text-primary-400 hover:text-primary-300"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(patient)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {filteredPatients.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-white/50">
                      No patients found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && userProfile?.clinic_ids[0] && (
        <PatientForm
          patient={editingPatient}
          clinicId={userProfile.clinic_ids[0]}
          onClose={() => {
            setShowForm(false)
            setEditingPatient(null)
          }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
