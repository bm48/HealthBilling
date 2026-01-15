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

  const renderCell = (row: SheetRow, column: string) => {
    const perm = permissions[column]
    if (!perm?.visible) return null

    const isEditable = perm.editable

    switch (column) {
      case 'A': // Patient ID
        return (
          <select
            value={row.patient_id || ''}
            onChange={(e) => onUpdateRow(row.id, 'patient_id', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          >
            <option value="" className="bg-slate-900">Select...</option>
            {patients.map(p => (
              <option key={p.id} value={p.patient_id} className="bg-slate-900">
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          />
        )

      case 'C': // Time
        return (
          <input
            type="time"
            value={row.appointment_time || ''}
            onChange={(e) => onUpdateRow(row.id, 'appointment_time', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          />
        )

      case 'D': // Visit Type
        return (
          <input
            type="text"
            value={row.visit_type || ''}
            onChange={(e) => onUpdateRow(row.id, 'visit_type', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
            style={{ backgroundColor: row.billing_code_color || undefined }}
          >
            <option value="" className="bg-slate-900">Select...</option>
            {billingCodes.map(code => (
              <option key={code.id} value={code.code} className="bg-slate-900">
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          >
            <option value="" className="bg-slate-900">Select...</option>
            {APPOINTMENT_STATUSES.map(status => (
              <option key={status} value={status} className="bg-slate-900">{status}</option>
            ))}
          </select>
        )

      case 'J': // Claim Status
        return (
          <select
            value={row.claim_status || ''}
            onChange={(e) => onUpdateRow(row.id, 'claim_status', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          >
            <option value="" className="bg-slate-900">Select...</option>
            {CLAIM_STATUSES.map(status => (
              <option key={status} value={status} className="bg-slate-900">{status}</option>
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50 text-right"
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50 text-right"
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50 text-right"
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50 text-right"
          />
        )

      case 'P': // Patient Pay Status
        return (
          <select
            value={row.patient_pay_status || ''}
            onChange={(e) => onUpdateRow(row.id, 'patient_pay_status', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          >
            <option value="" className="bg-slate-900">Select...</option>
            {PATIENT_PAY_STATUSES.map(status => (
              <option key={status} value={status} className="bg-slate-900">{status}</option>
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          />
        )

      case 'Z': // AR Type
        return (
          <select
            value={row.ar_type || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_type', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          >
            <option value="" className="bg-slate-900">Select...</option>
            {AR_TYPES.map(type => (
              <option key={type} value={type} className="bg-slate-900">{type}</option>
            ))}
          </select>
        )

      case 'X': // AR Amount
        return (
          <input
            type="number"
            step="0.01"
            value={row.ar_amount || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_amount', e.target.value ? parseFloat(e.target.value) : null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50 text-right"
          />
        )

      case 'AA': // AR Notes
        return (
          <input
            type="text"
            value={row.ar_notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_notes', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
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
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50 text-right"
          />
        )

      case 'AD': // Provider Payment Date
        return (
          <input
            type="date"
            value={row.provider_payment_date || ''}
            onChange={(e) => onUpdateRow(row.id, 'provider_payment_date', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
          />
        )

      case 'AE': // Provider Payment Notes
        return (
          <input
            type="text"
            value={row.provider_payment_notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'provider_payment_notes', e.target.value || null)}
            disabled={!isEditable}
            className="w-full px-2 py-1 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded text-sm disabled:bg-white/5 disabled:opacity-50"
            placeholder="Payment notes"
          />
        )

      default:
        return <div className="px-2 py-1 text-sm text-white/50"></div>
    }
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onToggleColumnsJ_M}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg border border-white/20 backdrop-blur-sm"
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

      <table className="min-w-full border-collapse border border-white/20">
        <thead>
          <tr className="bg-white/10 backdrop-blur-sm">
            <th className="border border-white/20 px-2 py-2 text-left text-xs font-semibold text-white w-12">
              #
            </th>
            {visibleColumns.map(col => {
              if (!showColumnsJ_M && ['J', 'K', 'L', 'M'].includes(col)) return null
              const def = COLUMN_DEFINITIONS[col as keyof typeof COLUMN_DEFINITIONS]
              if (!def) return null
              return (
                <th
                  key={col}
                  className={`border border-white/20 px-2 py-2 text-left text-xs font-semibold text-white ${def.width}`}
                >
                  {def.label || col}
                </th>
              )
            })}
            <th className="border border-white/20 px-2 py-2 text-left text-xs font-semibold text-white w-12">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className="hover:bg-white/5"
              style={{ backgroundColor: row.highlight_color ? `${row.highlight_color}40` : undefined }}
            >
              <td className="border border-white/20 px-2 py-1 text-sm text-center text-white/70">
                {index + 1}
              </td>
              {visibleColumns.map(col => {
                if (!showColumnsJ_M && ['J', 'K', 'L', 'M'].includes(col)) return null
                return (
                  <td key={col} className="border border-white/20 px-1 py-1">
                    {renderCell(row, col)}
                  </td>
                )
              })}
              <td className="border border-white/20 px-2 py-1">
                <button
                  onClick={() => onDeleteRow(row.id)}
                  className="text-red-400 hover:text-red-300"
                  disabled={!permissions['A']?.editable}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + 2} className="text-center py-8 text-white/50">
                No rows yet. Click "Add Row" to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
