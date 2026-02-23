import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchSheetRows } from '@/lib/providerSheetRows'
import { SheetRow, Clinic } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { generateClinicInvoicePdf } from '@/lib/clinicInvoicePdf'
import { Download } from 'lucide-react'

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

/** Super admin: one row per clinic per month */
interface ClinicInvoiceSummaryRow {
  clinic_id: string
  clinic_name: string
  insurance_payment_total: number
  patient_payment_total: number
  accounts_receivable_total: number
  total: number
  invoice_total: number
  invoice_rate: number | null
  payment_status: string
  payment_date: string | null
}

export default function Invoices() {
  const { userProfile } = useAuth()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [selectedClinic, setSelectedClinic] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'this-month' | 'this-year'>('all')
  const isSuperAdmin = userProfile?.role === 'super_admin'
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [clinicSummaries, setClinicSummaries] = useState<ClinicInvoiceSummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)

  useEffect(() => {
    fetchClinics()
    if (!isSuperAdmin) {
      fetchInvoices()
    } else {
      fetchClinicSummaries()
    }
  }, [userProfile, selectedClinic, dateFilter, isSuperAdmin])
  useEffect(() => {
    if (isSuperAdmin) fetchClinicSummaries()
  }, [selectedMonth, isSuperAdmin])

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
      // Error fetching clinics
    }
  }

  const fetchClinicSummaries = async () => {
    if (!userProfile || !isSuperAdmin) return
    setSummaryLoading(true)
    try {
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      const { data: allClinicsData, error: clinicsErr } = await supabase.from('clinics').select('id, name, invoice_rate').order('name')
      if (clinicsErr) throw clinicsErr
      const allClinics = allClinicsData || []
      const { data: sheetsData, error: sheetsError } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('month', month)
        .eq('year', year)
      if (sheetsError) throw sheetsError
      const sheets = sheetsData || []
      const rowsBySheet = await Promise.all(sheets.map(s => fetchSheetRows(supabase, s.id)))
      const byClinic = new Map<string, {
        insurance: number
        patient: number
        ar: number
        paymentDates: string[]
        statuses: Set<string>
      }>()
      const parseNum = (v: string | number | null | undefined): number => {
        if (v == null) return 0
        if (typeof v === 'number') return Number.isFinite(v) ? v : 0
        const n = parseFloat(String(v).replace(/[$,]/g, ''))
        return Number.isFinite(n) ? n : 0
      }
      sheets.forEach((sheet, i) => {
        const rows = rowsBySheet[i] || [] as SheetRow[]
        rows.forEach((row: SheetRow) => {
          const clinicId = sheet.clinic_id
          if (!byClinic.has(clinicId)) {
            byClinic.set(clinicId, { insurance: 0, patient: 0, ar: 0, paymentDates: [], statuses: new Set() })
          }
          const agg = byClinic.get(clinicId)!
          agg.insurance += parseNum(row.insurance_payment)
          agg.patient += parseNum(row.collected_from_patient)
          agg.ar += parseNum(row.ar_amount)
          if (row.payment_date) agg.paymentDates.push(row.payment_date)
          if (row.patient_pay_status) agg.statuses.add(row.patient_pay_status)
        })
      })
      const summaries: ClinicInvoiceSummaryRow[] = allClinics.map((clinic) => {
        const agg = byClinic.get(clinic.id)
        const insurance = agg?.insurance ?? 0
        const patient = agg?.patient ?? 0
        const ar = agg?.ar ?? 0
        const total = insurance + patient + ar
        const rate = clinic.invoice_rate != null ? Number(clinic.invoice_rate) : 0
        const invoice_total = total * rate
        const paymentDate = agg?.paymentDates?.length
          ? [...agg.paymentDates].sort().reverse()[0]
          : null
        let paymentStatus = '—'
        if (agg?.statuses) {
          if (agg.statuses.size > 1) paymentStatus = 'Mixed'
          else if (agg.statuses.size === 1) paymentStatus = [...agg.statuses][0]
        }
        return {
          clinic_id: clinic.id,
          clinic_name: clinic.name,
          insurance_payment_total: insurance,
          patient_payment_total: patient,
          accounts_receivable_total: ar,
          total,
          invoice_total,
          invoice_rate: clinic.invoice_rate != null ? clinic.invoice_rate : null,
          payment_status: paymentStatus,
          payment_date: paymentDate,
        }
      })
      setClinicSummaries(summaries)
    } catch (error) {
      setClinicSummaries([])
    } finally {
      setSummaryLoading(false)
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

      const sheets = sheetsData || []
      const rowsBySheet = await Promise.all(sheets.map(s => fetchSheetRows(supabase, s.id)))

      // Fetch clinics and users for display
      const clinicIds = [...new Set(sheets.map(s => s.clinic_id))]
      const providerIds = [...new Set(sheets.map(s => s.provider_id))]

      const [clinicsData, usersData, patientsData] = await Promise.all([
        supabase.from('clinics').select('*').in('id', clinicIds),
        supabase.from('users').select('*').in('id', providerIds),
        supabase.from('patients').select('*'),
      ])

      const clinicsMap = new Map((clinicsData.data || []).map(c => [c.id, c]))
      const usersMap = new Map((usersData.data || []).map(u => [u.id, u]))
      const patientsMap = new Map((patientsData.data || []).map(p => [`${p.clinic_id}-${p.patient_id}`, p]))

      const invoiceRows: InvoiceRow[] = []

      sheets.forEach((sheet, i) => {
        const clinic = clinicsMap.get(sheet.clinic_id)
        const provider = usersMap.get(sheet.provider_id)
        const rows = rowsBySheet[i] || []

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
      // Error fetching invoices
    } finally {
      setLoading(false)
    }
  }

  const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + (inv.invoice_amount || 0), 0)
  const totalCollected = invoices.reduce((sum, inv) => {
    const collected = typeof inv.collected_from_patient === 'string' 
      ? parseFloat(inv.collected_from_patient) || 0 
      : inv.collected_from_patient || 0
    return sum + collected
  }, 0)
  const totalOutstanding = totalInvoiceAmount - totalCollected

  async function handleDownloadClinicInvoice(row: ClinicInvoiceSummaryRow) {
    try {
      const pdf = await generateClinicInvoicePdf(row, selectedMonth)
      const monthStr = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`
      const safeName = row.clinic_name.replace(/[^a-z0-9-_]/gi, '_')
      pdf.save(`Invoice_${safeName}_${monthStr}.pdf`)
    } catch (e) {
      console.error(e)
      alert('Failed to generate PDF.')
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => i)
  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear()  - i)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Invoices</h1>
      </div>

      {isSuperAdmin ? (
        <>
          {/* Super admin: month selector */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 mb-6 border border-white/20">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Month</label>
                <select
                  value={selectedMonth.getMonth()}
                  onChange={(e) => {
                    const next = new Date(selectedMonth)
                    next.setMonth(Number(e.target.value))
                    setSelectedMonth(next)
                  }}
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                >
                  {months.map((m) => (
                    <option key={m} value={m} className="bg-slate-900">
                      {new Date(2000, m, 1).toLocaleString('en-US', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Year</label>
                <select
                  value={selectedMonth.getFullYear()}
                  onChange={(e) => {
                    const next = new Date(selectedMonth)
                    next.setFullYear(Number(e.target.value))
                    setSelectedMonth(next)
                  }}
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                >
                  {years.map((y) => (
                    <option key={y} value={y} className="bg-slate-900">{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Super admin: clinic summary table */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20">
            <div className="p-6">
              {summaryLoading ? (
                <div className="text-center py-8 text-white/70">Loading...</div>
              ) : (
                <div className="table-container dark-theme">
                  <table className="table-spreadsheet dark-theme">
                    <thead>
                      <tr>
                        <th>Clinic</th>
                        <th>Insurance Payment Total</th>
                        <th>Patient Payment Total</th>
                        <th>Accounts Receivable Total</th>
                        <th>Total</th>
                        <th>Invoice Total</th>
                        <th>Payment Status</th>
                        <th>Payment Date</th>
                        <th className="w-20">Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clinicSummaries.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center text-white/70 py-8">
                            No data for this month
                          </td>
                        </tr>
                      ) : (
                        clinicSummaries.map((row) => (
                          <tr key={row.clinic_id}>
                            <td className="text-white/90 font-medium">{row.clinic_name}</td>
                            <td>{formatCurrency(row.insurance_payment_total)}</td>
                            <td>{formatCurrency(row.patient_payment_total)}</td>
                            <td>{formatCurrency(row.accounts_receivable_total)}</td>
                            <td>{formatCurrency(row.total)}</td>
                            <td>{formatCurrency(row.invoice_total)}</td>
                            <td>
                              <span className="status-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff' }}>
                                {row.payment_status}
                              </span>
                            </td>
                            <td>{row.payment_date ? formatDate(row.payment_date) : '—'}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleDownloadClinicInvoice(row)}
                                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded inline-flex items-center justify-center"
                                title="Download invoice PDF"
                              >
                                <Download className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Non–super admin: existing filters and table */}
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
        </>
      )}
    </div>
  )
}