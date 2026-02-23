import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency } from './utils'

export interface ClinicInvoiceSummaryRow {
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

async function loadLogoAsDataUrl(): Promise<string> {
  const res = await fetch('/Logo.png')
  if (!res.ok) throw new Error('Logo not found')
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function formatDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

export async function generateClinicInvoicePdf(
  row: ClinicInvoiceSummaryRow,
  selectedMonth: Date
): Promise<jsPDF> {
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()
  let y = 20

  try {
    const logoDataUrl = await loadLogoAsDataUrl()
    doc.addImage(logoDataUrl, 'PNG', 14, 10, 36, 18)
  } catch {
    doc.setFontSize(12)
    doc.text('American Medical Billing & Coding LLC', 14, 18)
  }

  doc.setFontSize(10)
  doc.text('American Medical Billing and Coding LLC', 14, 30)

  doc.setFontSize(22)
  doc.text('INVOICE', pageW - 14 - doc.getTextWidth('INVOICE'), 22)
  const invoiceNum = `#${row.clinic_id.slice(0, 6).toUpperCase()}-${selectedMonth.getFullYear()}${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`
  doc.setFontSize(11)
  doc.text(invoiceNum, pageW - 14 - doc.getTextWidth(invoiceNum), 30)
  const invoiceDate = formatDateShort(new Date())
  const dueDate = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 15)
  doc.text(`Date: ${invoiceDate}`, pageW - 14 - doc.getTextWidth(`Date: ${invoiceDate}`), 36)
  doc.text(`Due Date: ${formatDateShort(dueDate)}`, pageW - 14 - doc.getTextWidth(`Due Date: ${formatDateShort(dueDate)}`), 42)

  y = 48
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Bill To:', 14, y)
  doc.setFont('helvetica', 'normal')
  doc.text(row.clinic_name, 14, y + 6)

  y += 18
  doc.setDrawColor(200, 200, 200)
  doc.setFillColor(240, 240, 240)
  doc.rect(14, y - 4, pageW - 28, 14, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Balance Due:', 18, y + 5)
  doc.text(formatCurrency(row.invoice_total), pageW - 18 - doc.getTextWidth(formatCurrency(row.invoice_total)), y + 5)
  doc.setFont('helvetica', 'normal')
  y += 22

  const ratePct = row.invoice_rate != null ? (row.invoice_rate * 100).toFixed(2) : '0'
  const tableBody: (string | number)[][] = [
    [`Total Collected From Insurances Only ${formatCurrency(row.insurance_payment_total)}`, '1', '$0.00', formatCurrency(0)],
    [`Billing Fee: ${ratePct}% of Total Collected`, '1', formatCurrency(row.invoice_total), formatCurrency(row.invoice_total)],
  ]
  autoTable(doc, {
    head: [['Item', 'Quantity', 'Rate', 'Amount']],
    body: tableBody,
    startY: y,
    headStyles: { fillColor: [80, 80, 80] },
    margin: { left: 14, right: 14 },
  })
  y = (doc as any).lastAutoTable.finalY + 14

  doc.setFontSize(10)
  doc.text(`Subtotal: ${formatCurrency(row.invoice_total)}`, pageW - 14 - doc.getTextWidth(`Subtotal: ${formatCurrency(row.invoice_total)}`), y)
  y += 6
  doc.text('Tax (0%): No tax $0.00', pageW - 14 - doc.getTextWidth('Tax (0%): No tax $0.00'), y)
  y += 6
  doc.setFont('helvetica', 'bold')
  doc.text(`Total: ${formatCurrency(row.invoice_total)}`, pageW - 14 - doc.getTextWidth(`Total: ${formatCurrency(row.invoice_total)}`), y)
  doc.setFont('helvetica', 'normal')
  y += 14

  const monthName = selectedMonth.toLocaleString('en-US', { month: 'long' })
  const year = selectedMonth.getFullYear()
  doc.setFont('helvetica', 'bold')
  doc.text('Notes:', 14, y)
  doc.setFont('helvetica', 'normal')
  y += 6
  doc.text(`Billing for ${monthName} ${year}`, 14, y)
  y += 6
  doc.text(`Total payments including copays, co-insurance: ${formatCurrency(row.total)}`, 14, y)
  y += 6
  doc.text(`Payments received from insurance only: ${formatCurrency(row.insurance_payment_total)}`, 14, y)
  y += 6
  doc.text(`Patient payments: ${formatCurrency(row.patient_payment_total)}`, 14, y)
  y += 6
  doc.text(`Accounts receivable: ${formatCurrency(row.accounts_receivable_total)}`, 14, y)

  return doc
}
