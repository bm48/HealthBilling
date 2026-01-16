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
  onBlur?: () => void // Optional callback for immediate save on blur
  onEditingChange?: (editing: { rowId: string; field: string } | null) => void // Callback to track editing state
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
  onBlur,
  onEditingChange,
}: ProviderSheetTableProps) {
  const permissions = getColumnPermissions(role, isOwnSheet, lockedColumns)
  const visibleColumns = Object.keys(COLUMN_DEFINITIONS).filter(col => 
    permissions[col]?.visible !== false
  )

  const handleFocus = (rowId: string, field: string) => {
    if (onEditingChange) {
      onEditingChange({ rowId, field })
    }
  }

  const handleBlur = (rowId: string, field: string) => {
    if (onEditingChange) {
      onEditingChange(null)
    }
    if (onBlur) {
      onBlur()
    }
  }

  const renderCell = (row: SheetRow, column: string) => {
    const perm = permissions[column]
    if (!perm?.visible) return null

    const isEditable = perm.editable
    const isLocked = lockedColumns.includes(column)

    switch (column) {
      case 'A': // Patient ID
        return (
          <select
            value={row.patient_id || ''}
            onChange={(e) => {
              onUpdateRow(row.id, 'patient_id', e.target.value || null)
              // Lookup patient data and populate other fields
              const patient = patients.find(p => p.patient_id === e.target.value)
              if (patient) {
                // Auto-populate patient data (if needed, can be handled in parent)
              }
            }}
            onFocus={() => handleFocus(row.id, 'patient_id')}
            onBlur={() => handleBlur(row.id, 'patient_id')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
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
            onFocus={() => handleFocus(row.id, 'appointment_date')}
            onBlur={() => handleBlur(row.id, 'appointment_date')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
          />
        )

      case 'C': // Time
        return (
          <input
            type="time"
            value={row.appointment_time || ''}
            onChange={(e) => onUpdateRow(row.id, 'appointment_time', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'appointment_time')}
            onBlur={() => handleBlur(row.id, 'appointment_time')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
          />
        )

      case 'D': // Visit Type
        return (
          <input
            type="text"
            value={row.visit_type || ''}
            onChange={(e) => onUpdateRow(row.id, 'visit_type', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'visit_type')}
            onBlur={() => handleBlur(row.id, 'visit_type')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
            placeholder="Visit type"
          />
        )

      case 'E': // Notes
        return (
          <input
            type="text"
            value={row.notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'notes', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'notes')}
            onBlur={() => handleBlur(row.id, 'notes')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
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
            onFocus={() => handleFocus(row.id, 'billing_code')}
            onBlur={() => handleBlur(row.id, 'billing_code')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
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
            onFocus={() => handleFocus(row.id, 'appointment_status')}
            onBlur={() => handleBlur(row.id, 'appointment_status')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
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
            onFocus={() => handleFocus(row.id, 'claim_status')}
            onBlur={() => handleBlur(row.id, 'claim_status')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
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
            onFocus={() => handleFocus(row.id, 'submit_date')}
            onBlur={() => handleBlur(row.id, 'submit_date')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
          />
        )

      case 'L': // Insurance Payment
        return (
          <input
            type="number"
            step="0.01"
            value={row.insurance_payment || ''}
            onChange={(e) => onUpdateRow(row.id, 'insurance_payment', e.target.value ? parseFloat(e.target.value) : null)}
            onFocus={() => handleFocus(row.id, 'insurance_payment')}
            onBlur={() => handleBlur(row.id, 'insurance_payment')}
            disabled={!isEditable}
            className={`currency ${isLocked ? 'locked' : ''}`}
          />
        )

      case 'M': // Insurance Adjustment
        return (
          <input
            type="number"
            step="0.01"
            value={row.insurance_adjustment || ''}
            onChange={(e) => onUpdateRow(row.id, 'insurance_adjustment', e.target.value ? parseFloat(e.target.value) : null)}
            onFocus={() => handleFocus(row.id, 'insurance_adjustment')}
            onBlur={() => handleBlur(row.id, 'insurance_adjustment')}
            disabled={!isEditable}
            className={`currency ${isLocked ? 'locked' : ''}`}
          />
        )

      case 'N': // Invoice Amount
        return (
          <input
            type="number"
            step="0.01"
            value={row.invoice_amount || ''}
            onChange={(e) => onUpdateRow(row.id, 'invoice_amount', e.target.value ? parseFloat(e.target.value) : null)}
            onFocus={() => handleFocus(row.id, 'invoice_amount')}
            onBlur={() => handleBlur(row.id, 'invoice_amount')}
            disabled={!isEditable}
            className={`currency ${isLocked ? 'locked' : ''}`}
          />
        )

      case 'O': // Collected from Patient
        return (
          <input
            type="number"
            step="0.01"
            value={row.collected_from_patient || ''}
            onChange={(e) => onUpdateRow(row.id, 'collected_from_patient', e.target.value ? parseFloat(e.target.value) : null)}
            onFocus={() => handleFocus(row.id, 'collected_from_patient')}
            onBlur={() => handleBlur(row.id, 'collected_from_patient')}
            disabled={!isEditable}
            className={`currency ${isLocked ? 'locked' : ''}`}
          />
        )

      case 'P': // Patient Pay Status
        return (
          <select
            value={row.patient_pay_status || ''}
            onChange={(e) => onUpdateRow(row.id, 'patient_pay_status', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'patient_pay_status')}
            onBlur={() => handleBlur(row.id, 'patient_pay_status')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
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
            onFocus={() => handleFocus(row.id, 'payment_date')}
            onBlur={() => handleBlur(row.id, 'payment_date')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
          />
        )

      case 'Z': // AR Type
        return (
          <select
            value={row.ar_type || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_type', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'ar_type')}
            onBlur={() => handleBlur(row.id, 'ar_type')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
          >
            <option value="">Select...</option>
            {AR_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
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
            onFocus={() => handleFocus(row.id, 'ar_amount')}
            onBlur={() => handleBlur(row.id, 'ar_amount')}
            disabled={!isEditable}
            className={`currency ${isLocked ? 'locked' : ''}`}
          />
        )

      case 'AA': // AR Notes
        return (
          <input
            type="text"
            value={row.ar_notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'ar_notes', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'ar_notes')}
            onBlur={() => handleBlur(row.id, 'ar_notes')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
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
            onFocus={() => handleFocus(row.id, 'provider_payment_amount')}
            onBlur={() => handleBlur(row.id, 'provider_payment_amount')}
            disabled={!isEditable}
            className={`currency ${isLocked ? 'locked' : ''}`}
          />
        )

      case 'AD': // Provider Payment Date
        return (
          <input
            type="date"
            value={row.provider_payment_date || ''}
            onChange={(e) => onUpdateRow(row.id, 'provider_payment_date', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'provider_payment_date')}
            onBlur={() => handleBlur(row.id, 'provider_payment_date')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
          />
        )

      case 'AE': // Provider Payment Notes
        return (
          <input
            type="text"
            value={row.provider_payment_notes || ''}
            onChange={(e) => onUpdateRow(row.id, 'provider_payment_notes', e.target.value || null)}
            onFocus={() => handleFocus(row.id, 'provider_payment_notes')}
            onBlur={() => handleBlur(row.id, 'provider_payment_notes')}
            disabled={!isEditable}
            className={isLocked ? 'locked' : ''}
            placeholder="Payment notes"
          />
        )

      default:
        return <div className="px-2 py-1 text-sm text-white/50"></div>
    }
  }

  return (
    <div className="table-container dark-theme">
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

      <table className="table-spreadsheet dark-theme">
        <thead>
          <tr>
            <th style={{ width: '48px' }}>#</th>
            {visibleColumns.map(col => {
              if (!showColumnsJ_M && ['J', 'K', 'L', 'M'].includes(col)) return null
              const def = COLUMN_DEFINITIONS[col as keyof typeof COLUMN_DEFINITIONS]
              if (!def) return null
              return (
                <th key={col} style={{ minWidth: def.width.replace('w-', '').replace('px', '') + 'px' }}>
                  {def.label || col}
                </th>
              )
            })}
            <th style={{ width: '48px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isLockedRow = lockedColumns.length > 0
            return (
              <tr
                key={row.id}
                style={{ backgroundColor: row.highlight_color ? `${row.highlight_color}40` : undefined }}
              >
                <td style={{ textAlign: 'center', fontWeight: 500 }}>
                  {index + 1}
                </td>
                {visibleColumns.map(col => {
                  if (!showColumnsJ_M && ['J', 'K', 'L', 'M'].includes(col)) return null
                  const isLocked = lockedColumns.includes(col)
                  return (
                    <td 
                      key={col} 
                      className={isLocked ? 'locked' : ''}
                      style={{ backgroundColor: row.highlight_color && !isLocked ? `${row.highlight_color}20` : undefined }}
                    >
                      {renderCell(row, col)}
                    </td>
                  )
                })}
                <td>
                  <button
                    onClick={() => onDeleteRow(row.id)}
                    className="text-red-400 hover:text-red-300"
                    disabled={!permissions['A']?.editable}
                    style={{ padding: '4px' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr className="empty-row">
              <td colSpan={visibleColumns.length + 2}>
                No rows yet. Click "Add Row" to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
