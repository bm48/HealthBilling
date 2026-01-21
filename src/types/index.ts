export type UserRole = 
  | 'super_admin'
  | 'admin'
  | 'view_only_admin'
  | 'billing_staff'
  | 'view_only_billing'
  | 'provider'
  | 'office_staff'

export type AppointmentStatus = 
  | 'Complete'
  | 'PP Complete'
  | 'Charge NS/LC'
  | 'RS No Charge'
  | 'NS No Charge'
  | 'Note not complete'

export type ClaimStatus = 
  | 'Claim Sent'
  | 'RS'
  | 'IP'
  | 'Paid'
  | 'Deductible'
  | 'N/A'
  | 'PP'
  | 'Denial'
  | 'Rejection'
  | 'No Coverage'

export type PatientPayStatus = 
  | 'Paid'
  | 'CC declined'
  | 'Secondary'
  | 'Refunded'
  | 'Payment Plan'
  | 'Waiting on Claims'

export type ARType = 'Insurance' | 'Patient' | 'Clinic'

export interface User {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  clinic_ids: string[]
  highlight_color: string | null
  created_at: string
  updated_at: string
}

export interface Clinic {
  id: string
  name: string
  address: string | null
  phone: string | null
  created_at: string
  updated_at: string
}

export interface Provider {
  id: string
  clinic_id: string
  first_name: string
  last_name: string
  specialty: string | null
  npi: string | null
  email: string | null
  phone: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface Patient {
  id: string
  clinic_id: string
  patient_id: string
  first_name: string
  last_name: string
  subscriber_id: string | null
  insurance: string | null
  copay: number | null
  coinsurance: number | null
  date_of_birth: string | null
  phone: string | null
  email: string | null
  address: string | null
  created_at: string
  updated_at: string
}

export interface ProviderSheet {
  id: string
  clinic_id: string
  provider_id: string
  row_data: SheetRow[]
  month: number
  year: number
  locked: boolean
  locked_columns: string[]
  created_at: string
  updated_at: string
}

export interface SheetRow {
  id: string
  // Columns A-G: Scheduling
  patient_id: string | null
  patient_first_name: string | null
  patient_last_name: string | null
  patient_insurance: string | null
  patient_copay: number | null
  patient_coinsurance: number | null
  appointment_date: string | null
  appointment_time: string | null
  visit_type: string | null
  notes: string | null
  
  // Columns H-I: Provider billing
  billing_code: string | null
  billing_code_color: string | null
  appointment_status: AppointmentStatus | null
  appointment_status_color: string | null
  
  // Columns J-M: Claim status
  claim_status: ClaimStatus | null
  claim_status_color: string | null
  submit_date: string | null
  insurance_payment: string | null
  insurance_adjustment: string | null
  
  // Columns N-Q: Patient invoice/payment
  invoice_amount: number | null
  collected_from_patient: string | null
  patient_pay_status: PatientPayStatus | null
  patient_pay_status_color: string | null
  payment_date: string | null
  payment_date_color: string | null
  
  // Columns U-AA: Accounts Receivable
  ar_type: ARType | null
  ar_amount: number | null
  ar_date: string | null
  ar_date_color: string | null
  ar_notes: string | null
  
  // Columns AC-AE: Provider Payment
  provider_payment_amount: number | null
  provider_payment_date: string | null
  provider_payment_notes: string | null
  
  highlight_color: string | null
  created_at: string
  updated_at: string

  // additional column
  total: string | null
  last_initial: string | null
  cpt_code: string | null
  cpt_code_color: string | null
}

export interface BillingCode {
  id: string
  code: string
  description: string | null
  color: string
  created_at: string
  updated_at: string
}

export interface StatusColor {
  id: string
  status: string
  color: string
  text_color: string
  type: 'appointment' | 'claim' | 'patient_pay' | 'month'
  created_at: string
  updated_at: string
}

export interface ColumnLock {
  id: string
  clinic_id: string
  provider_id: string | null
  column_name: string
  is_locked: boolean
  comment: string | null
  locked_by: string | null
  locked_at: string
  created_at: string
  updated_at: string
}

export interface TodoItem {
  id: string
  clinic_id: string
  title: string
  status: string
  claim_reference: string | null
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface TodoNote {
  id: string
  todo_id: string
  note: string
  created_by: string
  created_at: string
  note_type?: string // 'regular' | 'follow_up'
}

export interface Timecard {
  id: string
  user_id: string
  clinic_id: string | null
  clock_in: string
  clock_out: string | null
  hours: number | null
  notes: string | null
  amount_paid: number | null
  payment_date: string | null
  week_start_date: string
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  user_id: string
  clinic_id: string | null
  action: string
  table_name: string
  record_id: string
  old_values: Record<string, any> | null
  new_values: Record<string, any> | null
  created_at: string
}

export interface ReportFilters {
  start_date: string
  end_date: string
  clinic_id?: string
  provider_id?: string
  group_by?: 'provider' | 'clinic' | 'claim' | 'patient' | 'labor' | 'invoices'
}
