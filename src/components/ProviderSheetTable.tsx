import { useState } from 'react'
import { SheetRow, AppointmentStatus, ClaimStatus, PatientPayStatus, ARType, BillingCode, Patient } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getColumnPermissions, ColumnPermission } from '@/lib/permissions'
import { UserRole } from '@/types'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

interface ProviderSheetTableProps {
  rows: SheetRow[]
  onUpdateRow: (rowId: string, field: string, value: any) => void
  onAddRow: () => void
  onDeleteRow: (rowId: string) => void
  role: UserRole
  isOwnSheet: boolean
  lockedColumns: string[]
  billingCodes: BillingCode[]
  patients: Patient[]
  showColumnsJ_M: boolean
  onToggleColumnsJ_M: () => void
}

const COLUMN_DEFINITIONS = {
  A: { label: 'Patient ID', width: 'w-32' },
  B: { label: 'Date', width: 'w-32' },
  C: { label: 'Time', width: 'w-24' },
  D: { label: 'Visit Type', width: 'w-32' },
  E: { label: 'Notes', width: 'w-48' },
  F: { label: '', width: 'w-8' },
  G: { label: '', width: 'w-8' },
  H: { label: 'Billing Code', width: 'w-32' },
  I: { label: 'Status', width: 'w-32' },
  J: { label: 'Claim Status', width: 'w-32' },
  K: { label: 'Submit Date', width: 'w-32' },
  L: { label: 'Ins Payment', width: 'w-32' },
  M: { label: 'Ins Adjustment', width: 'w-32' },
  N: { label: 'Invoice', width: 'w-24' },
  O: { label: 'Collected', width: 'w-24' },
  P: { label: 'Pt Pay Status', width: 'w-32' },
  Q: { label: 'Payment Date', width: 'w-32' },
  U: { label: '', width: 'w-8' },
  V: { label: '', width: 'w-8' },
  W: { label: '', width: 'w-8' },
  X: { label: 'AR Amount', width: 'w-24' },
  Y: { label: '', width: 'w-8' },
  Z: { label: 'AR Type', width: 'w-24' },
  AA: { label: 'AR Notes', width: 'w-48' },
  AC: { label: 'Provider Payment', width: 'w-32' },
  AD: { label: 'Payment Date', width: 'w-32' },
  AE: { label: 'Notes', width: 'w-48' },
}

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'Complete',
  'PP Complete',
  'Charge NS/LC',
  'RS No Charge',
  'NS No Charge',
  'Note not complete',
]

const CLAIM_STATUSES: ClaimStatus[] = [
  'Claim Sent',
  'RS',
  'IP',
  'Paid',
  'Deductible',
  'N/A',
  'PP',
  'Denial',
  'Rejection',
  'No Coverage',
]

const PATIENT_PAY_STATUSES: PatientPayStatus[] = [
  'Paid',
  'CC declined',
  'Secondary',
  'Refunded',
  'Payment Plan',
  'Waiting on Claims',
]

const AR_TYPES: ARType[] = ['Insurance', 'Patient', 'Clinic']

export default function ProviderSheetTable({
  rows,
  onUpdateRow,
  onAddRow,
  onDeleteRow,
  role,
  isOwnSheet,
  lockedColumns,
  billingCodes,
  patients,
  showColumnsJ_M,
  onToggleColumnsJ_M,
}: ProviderSheetTableProps) {
  const permissions = getColumnPermissions(role, isOwnSheet, lockedColumns)
  const visibleColumns = Object.keys(COLUMN_DEFINITIONS).filter(col => 
    permissions[col]?.visible !== false
  )

  const getPatientName = (patientId: string | null) => {
    if (!patientId) return ''
    const patient = patients.find(p => p.patient_id === patientId)
    return patient ? `${patient.first_name} ${patient.last_name}` : patientId
  }

  const renderCell = (row: SheetRow, column: string) => {
    const perm = permissions[column]
    if (!perm?.visible) return null

    const isEditable = perm.editable
    const value = getCellValue(row, column)

    switch (column) {
      case 'A': // Patient ID
        return (
          <select
            value={row.patient_id || ''}
            onChange={(e) => onUpdateRow(row.id, 'patient_id', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          >
            <option value="">Select...</option>
            {patients.map(p => (
              <option key={p.id} value={p.patient_id}>
                {p.patient_id} - {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        )

      case 'B': // Date
        return (
          <input
            type="date"
            value={row.appointment_date || ''}
            onChange={(e) => onUpdateRow(row.id, 'appointment_date', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          />
        )

      case 'C': // Time
        return (
          <input
            type="time"
            value={row.appointment_time || ''}
            onChange={(e) => onUpdateRow(row.id, 'appointment_time', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          />
        )

      case 'D': // Visit Type
        return (
          <input
            type="text"
            value={row.visit_type || ''}
            onChange={(e) => onUpdateRow(row.id, 'visit_type', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
            placeholder="Visit type"
          />
        )

      case 'E': // Notes
        return (
          <input
            type="text"
            value={row.notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'notes', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
            placeholder="Notes"
          />
        )

      case 'H': // Billing Code
        return (
          <select
            value={row.billing_code || ''}
            onChange={(e) => {
              const code = billingCodes.find(c => c.code === e.target.value)
              onUpdateRow(row.id, 'billing_code', e.target.value || null)
              onUpdateRow(row.id, 'billing_code_color', code?.color || null)
            }}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
            style={{ backgroundColor: row.billing_code_color || undefined }}
          >
            <option value="">Select...</option>
            {billingCodes.map(code => (
              <option key={code.id} value={code.code}>
                {code.code} - {code.description}
              </option>
            ))}
          </select>
        )

      case 'I': // Appointment Status
        return (
          <select
            value={row.appointment_status || ''}
            onChange={(e) => onUpdateRow(row.id, 'appointment_status', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          >
            <option value="">Select...</option>
            {APPOINTMENT_STATUSES.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        )

      case 'J': // Claim Status
        return (
          <select
            value={row.claim_status || ''}
            onChange={(e) => onUpdateRow(row.id, 'claim_status', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          >
            <option value="">Select...</option>
            {CLAIM_STATUSES.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        )

      case 'K': // Submit Date
        return (
          <input
            type="date"
            value={row.submit_date || ''}
            onChange={(e) => onUpdateRow(row.id, 'submit_date', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          />
        )

      case 'L': // Insurance Payment
        return (
          <input
            type="number"
            step="0.01"
            value={row.insurance_payment || ''}
            onChange={(e) => onUpdateRow(row.id, 'insurance_payment', e.target.value ? parseFloat(e.target.value) : null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 text-right"
          />
        )

      case 'M': // Insurance Adjustment
        return (
          <input
            type="number"
            step="0.01"
            value={row.insurance_adjustment || ''}
            onChange={(e) => onUpdateRow(row.id, 'insurance_adjustment', e.target.value ? parseFloat(e.target.value) : null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 text-right"
          />
        )

      case 'N': // Invoice Amount
        return (
          <input
            type="number"
            step="0.01"
            value={row.invoice_amount || ''}
            onChange={(e) => onUpdateRow(row.id, 'invoice_amount', e.target.value ? parseFloat(e.target.value) : null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 text-right"
          />
        )

      case 'O': // Collected from Patient
        return (
          <input
            type="number"
            step="0.01"
            value={row.collected_from_patient || ''}
            onChange={(e) => onUpdateRow(row.id, 'collected_from_patient', e.target.value ? parseFloat(e.target.value) : null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 text-right"
          />
        )

      case 'P': // Patient Pay Status
        return (
          <select
            value={row.patient_pay_status || ''}
            onChange={(e) => onUpdateRow(row.id, 'patient_pay_status', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          >
            <option value="">Select...</option>
            {PATIENT_PAY_STATUSES.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        )

      case 'Q': // Payment Date
        return (
          <input
            type="date"
            value={row.payment_date || ''}
            onChange={(e) => onUpdateRow(row.id, 'payment_date', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          />
        )

      case 'Z': // AR Type (Column Z per requirements)
        return (
          <select
            value={row.ar_type || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_type', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          >
            <option value="">Select...</option>
            {AR_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        )

      case 'X': // AR Amount (Column X per requirements)
        return (
          <input
            type="number"
            step="0.01"
            value={row.ar_amount || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_amount', e.target.value ? parseFloat(e.target.value) : null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 text-right"
          />
        )

      case 'AA': // AR Notes
        return (
          <input
            type="text"
            value={row.ar_notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_notes', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
            placeholder="AR notes"
          />
        )

      case 'AC': // Provider Payment Amount
        return (
          <input
            type="number"
            step="0.01"
            value={row.provider_payment_amount || ''}
            onChange={(e) => onUpdateRow(row.id, 'provider_payment_amount', e.target.value ? parseFloat(e.target.value) : null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 text-right"
          />
        )

      case 'AD': // Provider Payment Date
        return (
          <input
            type="date"
            value={row.provider_payment_date || ''}
            onChange={(e) => onUpdateRow(row.id, 'provider_payment_date', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
          />
        )

      case 'AE': // Provider Payment Notes
        return (
          <input
            type="text"
            value={row.provider_payment_notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'provider_payment_notes', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
            placeholder="Payment notes"
          />
        )

      default:
        return <div className="px-2 py-1 text-sm text-gray-400">{value || ''}</div>
    }
  }

  const getCellValue = (row: SheetRow, column: string): string => {
    switch (column) {
      case 'A': return row.patient_id || ''
      case 'B': return row.appointment_date || ''
      case 'C': return row.appointment_time || ''
      case 'D': return row.visit_type || ''
      case 'E': return row.notes || ''
      case 'H': return row.billing_code || ''
      case 'I': return row.appointment_status || ''
      case 'J': return row.claim_status || ''
      case 'K': return row.submit_date || ''
      case 'L': return row.insurance_payment?.toString() || ''
      case 'M': return row.insurance_adjustment?.toString() || ''
      case 'N': return row.invoice_amount?.toString() || ''
      case 'O': return row.collected_from_patient?.toString() || ''
      case 'P': return row.patient_pay_status || ''
      case 'Q': return row.payment_date || ''
      case 'Z': return row.ar_type || ''
      case 'X': return row.ar_amount?.toString() || ''
      case 'AA': return row.ar_notes || ''
      case 'AC': return row.provider_payment_amount?.toString() || ''
      case 'AD': return row.provider_payment_date || ''
      case 'AE': return row.provider_payment_notes || ''
      default: return ''
    }
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onToggleColumnsJ_M}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          {showColumnsJ_M ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {showColumnsJ_M ? 'Hide' : 'Show'} Claim Status (J-M)
        </button>
        <button
          onClick={onAddRow}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Plus size={16} />
          Add Row
        </button>
      </div>

      <table className="min-w-full border-collapse border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-700 w-12">
              #
            </th>
            {visibleColumns.map(col => {
              if (!showColumnsJ_M && ['J', 'K', 'L', 'M'].includes(col)) return null
              const def = COLUMN_DEFINITIONS[col as keyof typeof COLUMN_DEFINITIONS]
              if (!def) return null
              return (
                <th
                  key={col}
                  className={`border border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-700 ${def.width}`}
                >
                  {def.label || col}
                </th>
              )
            })}
            <th className="border border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-700 w-12">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className="hover:bg-gray-50"
              style={{ backgroundColor: row.highlight_color || undefined }}
            >
              <td className="border border-gray-300 px-2 py-1 text-sm text-center text-gray-600">
                {index + 1}
              </td>
              {visibleColumns.map(col => {
                if (!showColumnsJ_M && ['J', 'K', 'L', 'M'].includes(col)) return null
                return (
                  <td key={col} className="border border-gray-300 px-1 py-1">
                    {renderCell(row, col)}
                  </td>
                )
              })}
              <td className="border border-gray-300 px-2 py-1">
                <button
                  onClick={() => onDeleteRow(row.id)}
                  className="text-red-600 hover:text-red-700"
                  disabled={!permissions['A']?.editable}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + 2} className="text-center py-8 text-gray-500">
                No rows yet. Click "Add Row" to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
