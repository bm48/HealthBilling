import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { SheetRow, Clinic } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'

interface InvoiceRow {
  id: string
  patient_id: string
  patient_name: string
  clinic_name: string
  provider_name: string
  invoice_amount: number
  collected_from_patient: string | number
  patient_pay_status: string
  payment_date: string | null
  appointment_date: string | null
}

export default function Invoices() {
  const { userProfile } = useAuth()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [selectedClinic, setSelectedClinic] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'this-month' | 'this-year'>('all')

  useEffect(() => {
    fetchClinics()
    fetchInvoices()
  }, [userProfile, selectedClinic, dateFilter])

  const fetchClinics = async () => {
    if (!userProfile) return

    try {
      let query = supabase.from('clinics').select('*')
      
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('id', userProfile.clinic_ids)
      }

      const { data, error } = await query.order('name')
      if (error) throw error
      setClinics(data || [])
    } catch (error) {
      console.error('Error fetching clinics:', error)
    }
  }

  const fetchInvoices = async () => {
    if (!userProfile) return

    setLoading(true)
    try {
      // Fetch all provider sheets
      let sheetsQuery = supabase.from('provider_sheets').select('*')

      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        sheetsQuery = sheetsQuery.in('clinic_id', userProfile.clinic_ids)
      }

      if (selectedClinic !== 'all') {
        sheetsQuery = sheetsQuery.eq('clinic_id', selectedClinic)
      }

      // Apply date filter
      const now = new Date()
      if (dateFilter === 'this-month') {
        sheetsQuery = sheetsQuery.eq('month', now.getMonth() + 1).eq('year', now.getFullYear())
      } else if (dateFilter === 'this-year') {
        sheetsQuery = sheetsQuery.eq('year', now.getFullYear())
      }

      const { data: sheetsData, error: sheetsError } = await sheetsQuery

      if (sheetsError) throw sheetsError

      // Fetch clinics and users for display
      const clinicIds = [...new Set((sheetsData || []).map(s => s.clinic_id))]
      const providerIds = [...new Set((sheetsData || []).map(s => s.provider_id))]

      const [clinicsData, usersData, patientsData] = await Promise.all([
        supabase.from('clinics').select('*').in('id', clinicIds),
        supabase.from('users').select('*').in('id', providerIds),
        supabase.from('patients').select('*'),
      ])

      const clinicsMap = new Map((clinicsData.data || []).map(c => [c.id, c]))
      const usersMap = new Map((usersData.data || []).map(u => [u.id, u]))
      const patientsMap = new Map((patientsData.data || []).map(p => [`${p.clinic_id}-${p.patient_id}`, p]))

      // Process invoice data
      const invoiceRows: InvoiceRow[] = []

      sheetsData?.forEach(sheet => {
        const clinic = clinicsMap.get(sheet.clinic_id)
        const provider = usersMap.get(sheet.provider_id)
        const rows = Array.isArray(sheet.row_data) ? sheet.row_data : []

        rows.forEach((row: SheetRow) => {
          if (row.invoice_amount || row.collected_from_patient) {
            const patient = row.patient_id
              ? patientsMap.get(`${sheet.clinic_id}-${row.patient_id}`)
              : null

            invoiceRows.push({
              id: `${sheet.id}-${row.id}`,
              patient_id: row.patient_id || '-',
              patient_name: patient
                ? `${patient.first_name} ${patient.last_name}`
                : '-',
              clinic_name: clinic?.name || '-',
              provider_name: provider?.full_name || provider?.email || '-',
              invoice_amount: row.invoice_amount || 0,
              collected_from_patient: row.collected_from_patient || 0,
              patient_pay_status: row.patient_pay_status || '-',
              payment_date: row.payment_date || null,
              appointment_date: row.appointment_date || null,
            })
          }
        })
      })

      setInvoices(invoiceRows)
    } catch (error) {
      console.error('Error fetching invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + (inv.invoice_amount || 0), 0)
  const totalCollected = invoices.reduce((sum, inv) => sum + (inv.collected_from_patient || 0), 0)
  const totalOutstanding = totalInvoiceAmount - totalCollected

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Invoices</h1>
      </div>

      {/* Filters */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 mb-6 border border-white/20">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Clinic</label>
            <select
              value={selectedClinic}
              onChange={(e) => setSelectedClinic(e.target.value)}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
            >
              <option value="all">All Clinics</option>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id} className="bg-slate-900">
                  {clinic.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Date Filter</label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
            >
              <option value="all" className="bg-slate-900">All Time</option>
              <option value="this-month" className="bg-slate-900">This Month</option>
              <option value="this-year" className="bg-slate-900">This Year</option>
            </select>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid md:grid-cols-3 gap-4 mt-6">
          <div className="bg-white/5 rounded-lg p-4 border border-white/20">
            <div className="text-sm text-white/70 mb-1">Total Invoiced</div>
            <div className="text-2xl font-bold text-white">{formatCurrency(totalInvoiceAmount)}</div>
          </div>
          <div className="bg-white/5 rounded-lg p-4 border border-white/20">
            <div className="text-sm text-white/70 mb-1">Total Collected</div>
            <div className="text-2xl font-bold text-green-400">{formatCurrency(totalCollected)}</div>
          </div>
          <div className="bg-white/5 rounded-lg p-4 border border-white/20">
            <div className="text-sm text-white/70 mb-1">Outstanding</div>
            <div className="text-2xl font-bold text-orange-400">{formatCurrency(totalOutstanding)}</div>
          </div>
        </div>
      </div>

      {/* Invoice Table */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20">
        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-white/70">Loading invoices...</div>
          ) : (
            <div className="table-container dark-theme">
              <table className="table-spreadsheet dark-theme">
                <thead>
                  <tr>
                    <th>Patient ID</th>
                    <th>Patient Name</th>
                    <th>Clinic</th>
                    <th>Provider</th>
                    <th>Appointment Date</th>
                    <th>Invoice Amount</th>
                    <th>Collected</th>
                    <th>Payment Status</th>
                    <th>Payment Date</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-white/70 py-8">
                        No invoices found
                      </td>
                    </tr>
                  ) : (
                    invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.patient_id}</td>
                        <td>{invoice.patient_name}</td>
                        <td>{invoice.clinic_name}</td>
                        <td>{invoice.provider_name}</td>
                        <td>{invoice.appointment_date ? formatDate(invoice.appointment_date) : '-'}</td>
                        <td>{formatCurrency(invoice.invoice_amount)}</td>
                        <td>{formatCurrency(invoice.collected_from_patient)}</td>
                        <td>
                          <span className="status-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff' }}>
                            {invoice.patient_pay_status}
                          </span>
                        </td>
                        <td>{invoice.payment_date ? formatDate(invoice.payment_date) : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}