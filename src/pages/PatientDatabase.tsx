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
        <h1 className="text-3xl font-bold text-gray-900">Patient Database</h1>
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

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search patients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Patient ID</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Date of Birth</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Phone</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Insurance</th>
                  {canEdit && (
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredPatients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">{patient.patient_id}</td>
                    <td className="px-4 py-3 text-sm font-medium">{patient.first_name} {patient.last_name}</td>
                    <td className="px-4 py-3 text-sm">{patient.date_of_birth || '-'}</td>
                    <td className="px-4 py-3 text-sm">{patient.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm">{patient.email || '-'}</td>
                    <td className="px-4 py-3 text-sm">{patient.insurance || '-'}</td>
                    {canEdit && (
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingPatient(patient)
                              setShowForm(true)
                            }}
                            className="text-primary-600 hover:text-primary-700"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(patient)}
                            className="text-red-600 hover:text-red-700"
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
                    <td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-gray-500">
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
