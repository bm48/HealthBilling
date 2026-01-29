import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Patient, ProviderSheet, SheetRow, Clinic, Provider, BillingCode, StatusColor, ColumnLock, IsLockPatients, IsLockBillingTodo, IsLockProviders, IsLockAccountsReceivable } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Users, CheckSquare, FileText, Trash2, Lock, Unlock } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'
import PatientsTab from '@/components/tabs/PatientsTab'
import BillingTodoTab from '@/components/tabs/BillingTodoTab'
import ProvidersTab from '@/components/tabs/ProvidersTab'
import AccountsReceivableTab from '@/components/tabs/AccountsReceivableTab'

type TabType = 'patients' | 'todo' | 'providers' | 'accounts_receivable'

export default function ClinicDetail() {
  const { clinicId, tab, providerId } = useParams<{ clinicId: string; tab?: string; providerId?: string }>()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>(providerId ? 'providers' : ((tab as TabType) || 'patients'))
  const [loading, setLoading] = useState(true)
  const [clinic, setClinic] = useState<Clinic | null>(null)

  // Patients data - still needed for Providers tab (patient dropdown)
  const [patients, setPatients] = useState<Patient[]>([])
  const patientsRef = useRef<Patient[]>([])

  // Providers data - editable provider records from providers table
  const [providers, setProviders] = useState<Provider[]>([])
  const [providerSheets, setProviderSheets] = useState<Record<string, ProviderSheet>>({})
  const [providerSheetRows, setProviderSheetRows] = useState<Record<string, SheetRow[]>>({})
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  const [columnLocks, setColumnLocks] = useState<ColumnLock[]>([])
  const [isLockPatients, setIsLockPatients] = useState<IsLockPatients | null>(null)
  const [isLockBillingTodo, setIsLockBillingTodo] = useState<IsLockBillingTodo | null>(null)
  const [isLockProviders, setIsLockProviders] = useState<IsLockProviders | null>(null)
  const [isLockAccountsReceivable, setIsLockAccountsReceivable] = useState<IsLockAccountsReceivable | null>(null)
  const [showLockDialog, setShowLockDialog] = useState(false)
  const [selectedLockColumn, setSelectedLockColumn] = useState<{ columnName: string; providerId: string | null; isPatientColumn?: boolean; isBillingTodoColumn?: boolean; isProviderColumn?: boolean; isARColumn?: boolean } | null>(null)
  const [lockComment, setLockComment] = useState('')
  
  // Split screen state
  const [splitScreen, setSplitScreen] = useState<{ left: TabType; right: TabType } | null>(null)
  const [splitScreenLeftWidth, setSplitScreenLeftWidth] = useState<number>(50) // Percentage
  const [isResizing, setIsResizing] = useState(false)
  const splitScreenContainerRef = useRef<HTMLDivElement>(null)
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tab: TabType } | null>(null)
  const tabContextMenuRef = useRef<HTMLDivElement>(null)
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ 
    x: number; 
    y: number; 
    type: 'patient' | 'todo' | 'providerRow' | 'ar';
    id: string;
    providerId?: string;
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  
  // Month filter for provider tab
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date())
  const providersRef = useRef<Provider[]>([])
  const providerSheetRowsRef = useRef<Record<string, SheetRow[]>>({})

  // Provider sheet rows for editable view (when viewing a specific provider's sheet via providerId param)
  const [providerRows, setProviderRows] = useState<Array<{
    id: string
    cpt_code: string
    appointment_status: string
    sheetId: string
    rowId: string
  }>>([])
  const [currentProvider, setCurrentProvider] = useState<Provider | null>(null)
  const [currentSheet, setCurrentSheet] = useState<ProviderSheet | null>(null)
  const providerRowsRef = useRef<Array<{ id: string; cpt_code: string; appointment_status: string; sheetId: string; rowId: string }>>([])

  // Sync activeTab with URL parameter
  useEffect(() => {
    if (providerId) {
      setActiveTab('providers')
    } else if (tab && ['patients', 'todo', 'providers', 'accounts_receivable'].includes(tab)) {
      setActiveTab(tab as TabType)
    } else if (!tab && clinicId) {
      navigate(`/clinic/${clinicId}/patients`, { replace: true })
    }
  }, [tab, clinicId, navigate, providerId])

  useEffect(() => {
    patientsRef.current = patients
  }, [patients])

  useEffect(() => {
    providerRowsRef.current = providerRows
  }, [providerRows])

  useEffect(() => {
    providersRef.current = providers
  }, [providers])

  useEffect(() => {
    if (clinicId) {
      fetchClinic()
      if (providerId) {
        // When providerId is in URL, fetch that specific provider's sheet data
        fetchProviderSheetData()
        // Also ensure we have providers list for the tab
        if (activeTab === 'providers') {
          fetchPatients() // Need patients for displaying patient info
          fetchBillingCodes()
          fetchStatusColors()
          fetchColumnLocks()
          fetchProviders()
        }
      } else {
        // When no providerId, fetch data for the active tab normally
        fetchData()
      }
    }
  }, [clinicId, activeTab, providerId, selectedMonth])

  // Refetch provider sheets when selectedMonth changes (for non-providerId view)
  useEffect(() => {
    if (clinicId && activeTab === 'providers' && !providerId) {
      console.log('Selected month changed, refetching provider sheets:', selectedMonth)
      fetchProviderSheets()
    }
  }, [selectedMonth])

  const fetchClinic = async () => {
    try {
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .eq('id', clinicId)
        .maybeSingle()

      if (error) throw error
      setClinic(data || null)
    } catch (error) {
      console.error('Error fetching clinic:', error)
    }
  }

  const fetchData = async () => {
    if (!clinicId) return

    setLoading(true)
    try {
      // Patients, todos, and accounts_receivable tabs now handle their own data fetching
      if (activeTab === 'providers') {
        await fetchPatients() // Need patients for displaying patient info in provider sheets
        await fetchBillingCodes()
        await fetchStatusColors()
        await fetchColumnLocks()
        await fetchProviders()
      } else if (activeTab === 'patients') {
        await fetchIsLockPatients()
        await fetchIsLockBillingTodo()
        await fetchIsLockProviders()
        await fetchIsLockAccountsReceivable()
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchBillingCodes = async () => {
    try {
      const { data, error } = await supabase
        .from('billing_codes')
        .select('*')
        .order('code')
      
      if (error) throw error
      setBillingCodes(data || [])
    } catch (error) {
      console.error('Error fetching billing codes:', error)
    }
  }

  const fetchStatusColors = async () => {
    try {
      const { data } = await supabase
        .from('status_colors')
        .select('*')
      if (data && data.length > 0) {
        setStatusColors(data)
      } else {
        console.log('No status colors found, using defaults')
        setStatusColors(getDefaultStatusColors())
      }
    } catch {
      console.error('Error fetching status colors')
    }
  }


  const fetchColumnLocks = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await supabase
        .from('column_locks')
        .select('*')
        .eq('clinic_id', clinicId)
      
      if (error) {
        console.log('Column locks table not found or error:', error)
        setColumnLocks([])
        return
      }
      setColumnLocks(data || [])
    } catch (error) {
      console.error('Error fetching column locks:', error)
      setColumnLocks([])
    }
  }

  const fetchIsLockPatients = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await supabase
        .from('is_lock_patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      
      if (error) {
        console.log('is_lock_patients table not found or error:', error)
        setIsLockPatients(null)
        return
      }
      
      if (data) {
        setIsLockPatients(data)
      } else {
        // Create default record if it doesn't exist
        const { data: newData, error: insertError } = await supabase
          .from('is_lock_patients')
          .insert({
            clinic_id: clinicId,
            patient_id: false,
            first_name: false,
            last_name: false,
            insurance: false,
            copay: false,
            coinsurance: false,
          })
          .select()
          .single()
        
        if (insertError) {
          console.error('Error creating is_lock_patients record:', insertError)
          setIsLockPatients(null)
        } else {
          setIsLockPatients(newData)
        }
      }
    } catch (error) {
      console.error('Error fetching is_lock_patients:', error)
      setIsLockPatients(null)
    }
  }

  const handleTogglePatientColumnLock = async (columnName: keyof IsLockPatients, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const currentLock = isLockPatients
      const commentField = `${columnName}_comment` as keyof IsLockPatients

      if (currentLock) {
        // Update existing record
        // First, try with comment if provided
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_patients')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment. Please run the migration: supabase/add_patient_lock_comments.sql`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await supabase
            .from('is_lock_patients')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        // Create new record
        const insertData: any = {
          clinic_id: clinicId,
          patient_id: columnName === 'patient_id' ? isLocked : false,
          first_name: columnName === 'first_name' ? isLocked : false,
          last_name: columnName === 'last_name' ? isLocked : false,
          insurance: columnName === 'insurance' ? isLocked : false,
          copay: columnName === 'copay' ? isLocked : false,
          coinsurance: columnName === 'coinsurance' ? isLocked : false,
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          insertData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_patients')
          .insert(insertData)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Creating without comment. Please run the migration: supabase/add_patient_lock_comments.sql`)
          delete insertData[commentField]
          const { error: retryError } = await supabase
            .from('is_lock_patients')
            .insert(insertData)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      }

      // Refresh lock status immediately
      await fetchIsLockPatients()
      
      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling patient column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available. Please run the migration: supabase/add_patient_lock_comments.sql in Supabase SQL editor.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const fetchIsLockBillingTodo = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await supabase
        .from('is_lock_billing_todo')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      
      if (error) {
        console.log('is_lock_billing_todo table not found or error:', error)
        setIsLockBillingTodo(null)
        return
      }
      
      if (data) {
        setIsLockBillingTodo(data)
      } else {
        // Create default record if it doesn't exist
        const { data: newData, error: insertError } = await supabase
          .from('is_lock_billing_todo')
          .insert({
            clinic_id: clinicId,
            id_column: false,
            status: false,
            issue: false,
            notes: false,
            followup_notes: false,
          })
          .select()
          .maybeSingle()
        
        if (insertError) {
          console.log('Error creating default is_lock_billing_todo record:', insertError)
          setIsLockBillingTodo(null)
        } else if (newData) {
          setIsLockBillingTodo(newData)
        }
      }
    } catch (error) {
      console.error('Error fetching is_lock_billing_todo:', error)
      setIsLockBillingTodo(null)
    }
  }

  const isPatientColumnLocked = (columnName: keyof IsLockPatients): boolean => {
    if (!isLockPatients) return false
    return isLockPatients[columnName] === true
  }

  const handleToggleBillingTodoColumnLock = async (columnName: keyof IsLockBillingTodo, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const currentLock = isLockBillingTodo
      const commentField = `${columnName}_comment` as keyof IsLockBillingTodo

      if (currentLock) {
        // Update existing record
        // First, try with comment if provided
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_billing_todo')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment.`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await supabase
            .from('is_lock_billing_todo')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        // Create new record
        const insertData: any = {
          clinic_id: clinicId,
          id_column: columnName === 'id_column' ? isLocked : false,
          status: columnName === 'status' ? isLocked : false,
          issue: columnName === 'issue' ? isLocked : false,
          notes: columnName === 'notes' ? isLocked : false,
          followup_notes: columnName === 'followup_notes' ? isLocked : false,
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          insertData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_billing_todo')
          .insert(insertData)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Creating without comment.`)
          delete insertData[commentField]
          const { error: retryError } = await supabase
            .from('is_lock_billing_todo')
            .insert(insertData)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      }

      // Refresh lock status immediately
      await fetchIsLockBillingTodo()
      
      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling billing todo column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const fetchIsLockProviders = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await supabase
        .from('is_lock_providers')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      
      if (error) {
        console.log('is_lock_providers table not found or error:', error)
        setIsLockProviders(null)
        return
      }
      
      if (data) {
        setIsLockProviders(data)
      } else {
        // Create default record if it doesn't exist
        const { data: newData, error: insertError } = await supabase
          .from('is_lock_providers')
          .insert({
            clinic_id: clinicId,
            patient_id: false,
            first_name: false,
            last_initial: false,
            insurance: false,
            copay: false,
            coinsurance: false,
            date_of_service: false,
            cpt_code: false,
            appointment_note_status: false,
            claim_status: false,
            most_recent_submit_date: false,
            ins_pay: false,
            ins_pay_date: false,
            pt_res: false,
            collected_from_pt: false,
            pt_pay_status: false,
            pt_payment_ar_ref_date: false,
            total: false,
            notes: false,
          })
          .select()
          .maybeSingle()
        
        if (insertError) {
          console.log('Error creating default is_lock_providers record:', insertError)
          setIsLockProviders(null)
        } else if (newData) {
          setIsLockProviders(newData)
        }
      }
    } catch (error) {
      console.error('Error fetching is_lock_providers:', error)
      setIsLockProviders(null)
    }
  }

  const handleToggleProviderColumnLock = async (columnName: keyof IsLockProviders, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const currentLock = isLockProviders
      const commentField = `${columnName}_comment` as keyof IsLockProviders

      if (currentLock) {
        // Update existing record
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_providers')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment.`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await supabase
            .from('is_lock_providers')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        // Create new record
        const insertData: any = {
          clinic_id: clinicId,
          patient_id: columnName === 'patient_id' ? isLocked : false,
          first_name: columnName === 'first_name' ? isLocked : false,
          last_initial: columnName === 'last_initial' ? isLocked : false,
          insurance: columnName === 'insurance' ? isLocked : false,
          copay: columnName === 'copay' ? isLocked : false,
          coinsurance: columnName === 'coinsurance' ? isLocked : false,
          date_of_service: columnName === 'date_of_service' ? isLocked : false,
          cpt_code: columnName === 'cpt_code' ? isLocked : false,
          appointment_note_status: columnName === 'appointment_note_status' ? isLocked : false,
          claim_status: columnName === 'claim_status' ? isLocked : false,
          most_recent_submit_date: columnName === 'most_recent_submit_date' ? isLocked : false,
          ins_pay: columnName === 'ins_pay' ? isLocked : false,
          ins_pay_date: columnName === 'ins_pay_date' ? isLocked : false,
          pt_res: columnName === 'pt_res' ? isLocked : false,
          collected_from_pt: columnName === 'collected_from_pt' ? isLocked : false,
          pt_pay_status: columnName === 'pt_pay_status' ? isLocked : false,
          pt_payment_ar_ref_date: columnName === 'pt_payment_ar_ref_date' ? isLocked : false,
          total: columnName === 'total' ? isLocked : false,
          notes: columnName === 'notes' ? isLocked : false,
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          insertData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_providers')
          .insert(insertData)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Creating without comment.`)
          delete insertData[commentField]
          const { error: retryError } = await supabase
            .from('is_lock_providers')
            .insert(insertData)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      }

      // Refresh lock status immediately
      await fetchIsLockProviders()
      
      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling provider column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const isBillingTodoColumnLocked = (columnName: keyof IsLockBillingTodo): boolean => {
    if (!isLockBillingTodo) return false
    return isLockBillingTodo[columnName] === true
  }

  const fetchIsLockAccountsReceivable = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await supabase
        .from('is_lock_accounts_receivable')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      
      if (error) {
        console.log('is_lock_accounts_receivable table not found or error:', error)
        setIsLockAccountsReceivable(null)
        return
      }
      
      if (data) {
        setIsLockAccountsReceivable(data)
      } else {
        // Create default record if it doesn't exist
        const { data: newData, error: insertError } = await supabase
          .from('is_lock_accounts_receivable')
          .insert({
            clinic_id: clinicId,
            ar_id: false,
            name: false,
            date_of_service: false,
            amount: false,
            date_recorded: false,
            type: false,
            notes: false,
          })
          .select()
          .maybeSingle()
        
        if (insertError) {
          console.log('Error creating default is_lock_accounts_receivable record:', insertError)
          setIsLockAccountsReceivable(null)
        } else if (newData) {
          setIsLockAccountsReceivable(newData)
        }
      }
    } catch (error) {
      console.error('Error fetching is_lock_accounts_receivable:', error)
      setIsLockAccountsReceivable(null)
    }
  }

  const handleToggleARColumnLock = async (columnName: keyof IsLockAccountsReceivable, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const currentLock = isLockAccountsReceivable
      const commentField = `${columnName}_comment` as keyof IsLockAccountsReceivable

      if (currentLock) {
        // Update existing record
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_accounts_receivable')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment.`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await supabase
            .from('is_lock_accounts_receivable')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        // Create new record
        const insertData: any = {
          clinic_id: clinicId,
          ar_id: columnName === 'ar_id' ? isLocked : false,
          name: columnName === 'name' ? isLocked : false,
          date_of_service: columnName === 'date_of_service' ? isLocked : false,
          amount: columnName === 'amount' ? isLocked : false,
          date_recorded: columnName === 'date_recorded' ? isLocked : false,
          type: columnName === 'type' ? isLocked : false,
          notes: columnName === 'notes' ? isLocked : false,
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          insertData[commentField] = comment
        }

        let { error } = await supabase
          .from('is_lock_accounts_receivable')
          .insert(insertData)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Creating without comment.`)
          delete insertData[commentField]
          const { error: retryError } = await supabase
            .from('is_lock_accounts_receivable')
            .insert(insertData)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      }

      // Refresh lock status immediately
      await fetchIsLockAccountsReceivable()
      
      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling AR column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const isProviderColumnLocked = (columnName: keyof IsLockProviders): boolean => {
    if (!isLockProviders) return false
    return isLockProviders[columnName] === true
  }

  const isARColumnLocked = (columnName: keyof IsLockAccountsReceivable): boolean => {
    if (!isLockAccountsReceivable) return false
    return isLockAccountsReceivable[columnName] === true
  }

  const isColumnLocked = (columnName: string, providerId?: string | null): ColumnLock | null => {
    return columnLocks.find(lock => 
      lock.column_name === columnName && 
      lock.is_locked &&
      (lock.provider_id === (providerId || null))
    ) || null
  }

  const handleToggleColumnLock = async (columnName: string, providerId: string | null, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const existing = columnLocks.find(lock => 
        lock.column_name === columnName && 
        lock.provider_id === (providerId || null)
      )

      if (existing) {
        // Update existing lock
        const { error } = await supabase
          .from('column_locks')
          .update({
            is_locked: isLocked,
            comment: comment || existing.comment,
            locked_by: userProfile?.id,
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Create new lock
        const { error } = await supabase
          .from('column_locks')
          .insert({
            clinic_id: clinicId,
            provider_id: providerId,
            column_name: columnName,
            is_locked: isLocked,
            comment: comment || null,
            locked_by: userProfile?.id,
            locked_at: new Date().toISOString()
          })

        if (error) throw error
      }

      // Refresh column locks
      await fetchColumnLocks()
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling column lock:', error)
      alert('Failed to update column lock')
    }
  }

  // Month navigation functions
  const handlePreviousMonth = () => {
    setSelectedMonth(prevDate => {
      const newDate = new Date(prevDate)
      newDate.setMonth(newDate.getMonth() - 1)
      console.log('handlePreviousMonth: ', newDate)
      return newDate
    })
  }

  const handleNextMonth = () => {
    setSelectedMonth(prevDate => {
      const newDate = new Date(prevDate)
      newDate.setMonth(newDate.getMonth() + 1)
      console.log('handleNextMonth: ', newDate)
      return newDate
    })
  }

  const formatMonthYear = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const filterRowsByMonth = (rows: SheetRow[]) => {
    // Since we're now fetching provider sheets by month/year from the database,
    // all rows already belong to the selected month. No filtering needed.
    // Just return all rows (including empty rows for data entry)
    return rows
  }

  // Default color mappings
  const getDefaultStatusColors = (): StatusColor[] => {
    return [
      // Appointment Status Colors
      { id: '1', status: 'Complete', color: '#22c55e', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '2', status: 'PP Complete', color: '#3b82f6', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '3', status: 'Charge NS/LC', color: '#f59e0b', text_color: '#000000', type: 'appointment', created_at: '', updated_at: '' },
      { id: '4', status: 'RS No Charge', color: '#ef4444', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '5', status: 'NS No Charge', color: '#6b7280', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '6', status: 'Note not complete', color: '#dc2626', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      
      // Claim Status Colors
      { id: '7', status: 'Claim Sent', color: '#3b82f6', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '8', status: 'RS', color: '#f59e0b', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '9', status: 'IP', color: '#eab308', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '10', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '11', status: 'Deductible', color: '#a855f7', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '12', status: 'N/A', color: '#6b7280', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '13', status: 'PP', color: '#06b6d4', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '14', status: 'Denial', color: '#ef4444', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '15', status: 'Rejection', color: '#dc2626', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '16', status: 'No Coverage', color: '#991b1b', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      
      // Patient Pay Status Colors
      { id: '17', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '18', status: 'CC declined', color: '#ef4444', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '19', status: 'Secondary', color: '#3b82f6', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '20', status: 'Refunded', color: '#f59e0b', text_color: '#000000', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '21', status: 'Payment Plan', color: '#a855f7', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '22', status: 'Waiting on Claims', color: '#6b7280', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      
      // Month Colors
      { id: '23', status: 'January', color: '#dc2626', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '24', status: 'February', color: '#ec4899', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '25', status: 'March', color: '#f59e0b', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
      { id: '26', status: 'April', color: '#fde047', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
      { id: '27', status: 'May', color: '#84cc16', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '28', status: 'June', color: '#22c55e', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '29', status: 'July', color: '#06b6d4', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '30', status: 'August', color: '#0284c7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '31', status: 'September', color: '#6366f1', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '32', status: 'October', color: '#f97316', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '33', status: 'November', color: '#a855f7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '34', status: 'December', color: '#0ea5e9', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    ]
  }

  // Simplified fetchPatients - only needed for Providers tab patient dropdown
  const fetchPatients = async () => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('last_name', { ascending: true })

      if (error) throw error
      setPatients(data || [])
    } catch (error) {
      console.error('Error fetching patients:', error)
    }
  }

  // Removed unused functions: savePatients, handleUpdatePatient, handleAddPatientRow, handleDeletePatient
  // These are now handled by PatientsTab component
  
  // Removed unused functions: createEmptyTodo, fetchTodos, saveTodos, handleUpdateTodo, handleAddTodoRow, handleDeleteTodo, handleSaveTodoNote
  // These are now handled by BillingTodoTab component
  
  // Removed unused functions: saveAccountsReceivable, handleUpdateAR, handleAddARRow, handleDeleteAR
  // These are now handled by AccountsReceivableTab component

  const fetchProviderSheetData = async () => {
    if (!clinicId || !providerId) {
      // Clear current provider data if providerId is removed
      setCurrentProvider(null)
      setCurrentSheet(null)
      setProviderRows([])
      return
    }

    try {
      setLoading(true)
      
      // Fetch provider info from providers table (not users table)
      const { data: providerData, error: providerError } = await supabase
        .from('providers')
        .select('*')
        .eq('id', providerId)
        .maybeSingle()

      if (providerError && providerError.code !== 'PGRST116') {
        throw providerError
      }
      
      if (!providerData) {
        setCurrentProvider(null)
        setCurrentSheet(null)
        setProviderRows([])
        setProviderSheetRows(prev => {
          const updated = { ...prev }
          delete updated[providerId]
          return updated
        })
        return
      }
      
      setCurrentProvider(providerData)

      // Use selected month/year instead of current date
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()

      console.log('Fetching provider sheet data for:', { providerId, month, year })

      // Fetch sheet for the selected month/year
      const { data: existingSheet, error: sheetsError } = await supabase
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('provider_id', providerId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle()

      if (sheetsError && sheetsError.code !== 'PGRST116') throw sheetsError

      let sheet = existingSheet

      if (!sheet) {
        // Create a new sheet
        const { data: newSheet, error: createError } = await supabase
          .from('provider_sheets')
          .insert({
            clinic_id: clinicId,
            provider_id: providerId,
            month,
            year,
            row_data: [],
            locked: false,
            locked_columns: [],
          })
          .select()
          .maybeSingle()

        if (createError) throw createError
        if (!newSheet) {
          console.error('Failed to create provider sheet - no data returned')
          return
        }
        sheet = newSheet
      }

      setCurrentSheet(sheet)

      // Extract rows with CPT codes and appointment statuses
      const rows: Array<{
        id: string
        cpt_code: string
        appointment_status: string
        sheetId: string
        rowId: string
      }> = []

      if (sheet && Array.isArray(sheet.row_data)) {
        sheet.row_data.forEach((row: SheetRow) => {
          rows.push({
            id: row.id,
            cpt_code: row.billing_code || '',
            appointment_status: row.appointment_status || '',
            sheetId: sheet.id,
            rowId: row.id,
          })
        })
      }

      setProviderRows(rows)
      
      // Create empty rows for providers table (200 rows per provider)
      const createEmptyProviderSheetRow = (index: number): SheetRow => ({
        id: `empty-${index}`,
        patient_id: null,
        patient_first_name: null,
        patient_last_name: null,
        patient_insurance: null,
        patient_copay: null,
        patient_coinsurance: null,
        appointment_date: null,
        appointment_time: null,
        visit_type: null,
        notes: null,
        billing_code: null,
        billing_code_color: null,
        appointment_status: null,
        appointment_status_color: null,
        claim_status: null,
        claim_status_color: null,
        submit_date: null,
        insurance_payment: null,
        insurance_adjustment: null,
        invoice_amount: null,
        collected_from_patient: null,
        patient_pay_status: null,
        patient_pay_status_color: null,
        payment_date: null,
        payment_date_color: null,
        ar_type: null,
        ar_amount: null,
        ar_date: null,
        ar_date_color: null,
        ar_notes: null,
        provider_payment_amount: null,
        provider_payment_date: null,
        provider_payment_notes: null,
        highlight_color: null,
        total: null,
        last_initial: null,
        cpt_code: null,
        cpt_code_color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      const sheetRows = Array.isArray(sheet.row_data) ? sheet.row_data : []
      const emptyRowsNeeded = Math.max(0, 200 - sheetRows.length)
      const emptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
        createEmptyProviderSheetRow(i)
      )
      const allRows = [...sheetRows, ...emptyRows]
      
      // Update providerSheetRows to only show this provider's data
      setProviderSheetRows(prev => ({
        ...prev,
        [providerId]: allRows
      }))
      
      // Update providerSheets map
      setProviderSheets(prev => ({
        ...prev,
        [providerId]: sheet
      }))
    } catch (error) {
      console.error('Error fetching provider sheet data:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveProviderRows = useCallback(async (rowsToSave: typeof providerRows) => {
    if (!currentSheet) return

    try {
      // Convert rows back to SheetRow format and update the sheet
      const updatedRowData: SheetRow[] = []
      
      // Get existing row data
      const existingRows = Array.isArray(currentSheet.row_data) ? currentSheet.row_data : []
      
      // Create a map of existing rows by ID
      const existingRowsMap = new Map(existingRows.map((r: SheetRow) => [r.id, r]))

      // Update rows
      rowsToSave.forEach(row => {
        const existingRow = existingRowsMap.get(row.rowId)
        if (existingRow) {
          // Update existing row
          updatedRowData.push({
            ...existingRow,
            billing_code: row.cpt_code || null,
            appointment_status: row.appointment_status as any || null,
            updated_at: new Date().toISOString(),
          })
          existingRowsMap.delete(row.rowId)
        } else if (row.id.startsWith('new-')) {
          // New row
          const newRow: SheetRow = {
            id: `row-${Date.now()}-${Math.random()}`,
            patient_id: null,
            patient_first_name: null,
            patient_last_name: null,
            patient_insurance: null,
            patient_copay: null,
            patient_coinsurance: null,
            appointment_date: null,
            appointment_time: null,
            visit_type: null,
            notes: null,
            billing_code: row.cpt_code || null,
            billing_code_color: null,
            appointment_status: row.appointment_status as any || null,
            appointment_status_color: null,
            claim_status: null,
            claim_status_color: null,
            submit_date: null,
            insurance_payment: null,
            insurance_adjustment: null,
            invoice_amount: null,
            collected_from_patient: null,
            patient_pay_status: null,
            patient_pay_status_color: null,
            payment_date: null,
            payment_date_color: null,
            ar_type: null,
            ar_amount: null,
            ar_date: null,
            ar_date_color: null,
            ar_notes: null,
            provider_payment_amount: null,
            provider_payment_date: null,
            provider_payment_notes: null,
            highlight_color: null,
            total: null,
            last_initial: null,
            cpt_code: null,
            cpt_code_color: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          updatedRowData.push(newRow)
        }
      })

      // Keep any remaining existing rows that weren't updated
      existingRowsMap.forEach(row => updatedRowData.push(row))

      // Update the sheet
      const { error } = await supabase
        .from('provider_sheets')
        .update({
          row_data: updatedRowData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSheet.id)

      if (error) throw error

      // Update local state
      setCurrentSheet({ ...currentSheet, row_data: updatedRowData })
      await fetchProviderSheetData()
    } catch (error) {
      console.error('Error saving provider rows:', error)
    }
  }, [currentSheet, fetchProviderSheetData])

  const { saveImmediately: _saveProviderRowsImmediately } = useDebouncedSave(saveProviderRows, providerRows, 1000)


  const fetchProviders = async () => {
    try {
      const { data, error } = await supabase
        .from('providers')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('last_name')
        .order('first_name')

      if (error) throw error
      const fetchedProviders = data || []
      // Preserve any unsaved providers (with 'new-' prefix)
      setProviders(currentProviders => {
        const unsavedProviders = currentProviders.filter(p => p.id.startsWith('new-'))
        return [...unsavedProviders, ...fetchedProviders]
      })
    } catch (error) {
      console.error('Error fetching providers:', error)
    }
  }

  const fetchProviderSheets = async () => {
    if (!clinicId || !userProfile) return

    try {
      // Use selected month/year instead of current date
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()

      console.log('Fetching provider sheets for:', { month, year })

      // Fetch all providers for this clinic
      const { data: providersData } = await supabase
        .from('providers')
        .select('id')
        .eq('clinic_id', clinicId)

      if (!providersData || providersData.length === 0) return

      const providerIds = providersData.map(p => p.id)

      // Fetch or create provider sheets for all providers
      const sheetsMap: Record<string, ProviderSheet> = {}
      const rowsMap: Record<string, SheetRow[]> = {}

      for (const providerId of providerIds) {
        // Try to fetch existing sheet
        const { data: existingSheet, error: fetchError } = await supabase
          .from('provider_sheets')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('provider_id', providerId)
          .eq('month', month)
          .eq('year', year)
          .maybeSingle()

        let sheet: ProviderSheet

        if (existingSheet && !fetchError) {
          sheet = existingSheet
        } else {
          // Create new sheet if doesn't exist
          const { data: newSheet, error: createError } = await supabase
            .from('provider_sheets')
            .insert({
              clinic_id: clinicId,
              provider_id: providerId,
              month,
              year,
              row_data: [],
              locked: false,
              locked_columns: [],
            })
            .select()
            .maybeSingle()

          if (createError) {
            console.error('Error creating provider sheet:', createError)
            continue
          }
          if (!newSheet) {
            console.error('Failed to create provider sheet - no data returned')
            continue
          }
          sheet = newSheet
        }

        sheetsMap[providerId] = sheet
        const sheetRows = Array.isArray(sheet.row_data) ? sheet.row_data : []
        
        // Add empty rows to reach 200 total rows per provider
        const createEmptyProviderSheetRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
          patient_insurance: null,
          patient_copay: null,
          patient_coinsurance: null,
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          appointment_status_color: null,
          claim_status: null,
          claim_status_color: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          patient_pay_status_color: null,
          payment_date: null,
          payment_date_color: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_date_color: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
          total: null,
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        
        const emptyRowsNeeded = Math.max(0, 200 - sheetRows.length)
        const emptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
          createEmptyProviderSheetRow(i)
        )
        rowsMap[providerId] = [...sheetRows, ...emptyRows]
      }

      setProviderSheets(sheetsMap)
      setProviderSheetRows(rowsMap)
    } catch (error) {
      console.error('Error fetching provider sheets:', error)
    }
  }



  const saveProviderSheetRows = useCallback(async (providerId: string, rowsToSave: SheetRow[]) => {
    if (!clinicId || !userProfile) return

    const sheet = providerSheets[providerId]
    if (!sheet) return

    // Filter out only truly empty rows (empty- rows with no data)
    // Allow empty- rows that have data to be saved
    const rowsToProcess = rowsToSave.filter(r => {
      if (r.id.startsWith('empty-')) {
        // Check if this empty row has any data
        const hasData = r.patient_id || r.patient_first_name || r.last_initial || 
                       r.patient_insurance || r.patient_copay !== null || r.patient_coinsurance !== null ||
                       r.appointment_date || r.cpt_code || r.appointment_status || r.claim_status ||
                       r.submit_date || r.insurance_payment || r.payment_date || r.insurance_adjustment ||
                       r.collected_from_patient || r.patient_pay_status || r.ar_date || r.total !== null || r.notes
        return hasData
      }
      return true // Include all non-empty rows
    })

    try {
      const { error } = await supabase
        .from('provider_sheets')
        .update({
          row_data: rowsToProcess,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sheet.id)

      if (error) throw error
      
      // Update rows in place without reordering - preserve exact row positions
      setProviderSheetRows(prev => {
        const currentRows = prev[providerId] || []
        // Create a map of saved rows by their old ID
        const savedRowsMap = new Map<string, SheetRow>()
        rowsToProcess.forEach(savedRow => {
          // Find the row in currentRows that matches this saved row
          const matchingRow = currentRows.find(cr => {
            if (savedRow.id.startsWith('empty-')) {
              // For empty rows that were saved, match by position or data
              return cr.id === savedRow.id || 
                     (cr.patient_id === savedRow.patient_id && 
                      cr.patient_first_name === savedRow.patient_first_name &&
                      cr.last_initial === savedRow.last_initial)
            } else {
              return cr.id === savedRow.id
            }
          })
          if (matchingRow) {
            savedRowsMap.set(matchingRow.id, savedRow)
          }
        })
        
        // Update rows in place, preserving order
        const updatedRows = currentRows.map(row => {
          const savedRow = savedRowsMap.get(row.id)
          if (savedRow) {
            // This row was just saved - update with fresh data
            // For empty rows that were saved, they now have real data but keep their position
            return savedRow
          }
          return row // Keep all other rows exactly as they are
        })
        
        // Ensure empty rows are maintained after save
        const nonEmptyRows = updatedRows.filter(r => !r.id.startsWith('empty-'))
        const emptyRowsNeeded = Math.max(0, 200 - nonEmptyRows.length)
        const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
        if (emptyRowsNeeded > existingEmptyCount) {
        const createEmptyRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
          patient_insurance: null,
          patient_copay: null,
          patient_coinsurance: null,
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          appointment_status_color: null,
          claim_status: null,
          claim_status_color: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          patient_pay_status_color: null,
          payment_date: null,
          payment_date_color: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_date_color: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
          total: null,
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
          const newEmptyRows = Array.from({ length: emptyRowsNeeded - existingEmptyCount }, (_, i) => 
            createEmptyRow(existingEmptyCount + i)
        )
        return {
          ...prev,
            [providerId]: [...updatedRows, ...newEmptyRows]
          }
        }
        
        return {
          ...prev,
          [providerId]: updatedRows
        }
      })
    } catch (error) {
      console.error('Error saving provider sheet rows:', error)
    }
  }, [clinicId, userProfile, providerSheets])

  const handleUpdateProviderSheetRow = useCallback((providerId: string, rowId: string, field: string, value: any) => {
    setProviderSheetRows(prev => {
      const rows = prev[providerId] || []
      const updatedRows = rows.map(row => {
        if (row.id === rowId) {
          // If updating an empty row, convert it to a new- prefixed row
          if (row.id.startsWith('empty-')) {
            const newId = `new-${Date.now()}-${Math.random()}`
            const updated: SheetRow = {
              ...row,
              id: newId,
              [field]: value,
              updated_at: new Date().toISOString()
            }
            if (field === 'billing_code') {
              const code = billingCodes.find(c => c.code === value)
              updated.billing_code_color = code?.color || null
            } else if (field === 'cpt_code') {
              // Handle multiple CPT codes (comma-separated)
              if (value) {
                const codes = value.split(',').map((c: string) => c.trim())
                const colors = codes.map((c: string) => {
                  const code = billingCodes.find(bc => bc.code === c)
                  return code?.color || '#cccccc'
                })
                updated.cpt_code_color = colors.join(',')
              } else {
                updated.cpt_code_color = null
              }
            } else if (field === 'appointment_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'appointment')
              updated.appointment_status_color = status?.color || null
            } else if (field === 'claim_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'claim')
              updated.claim_status_color = status?.color || null
            } else if (field === 'patient_pay_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'patient_pay')
              updated.patient_pay_status_color = status?.color || null
            } else if (field === 'payment_date') {
              const month = statusColors.find(s => s.status === value && s.type === 'month')
              updated.payment_date_color = month?.color || null
            } else if (field === 'ar_date') {
              const month = statusColors.find(s => s.status === value && s.type === 'month')
              updated.ar_date_color = month?.color || null
            }
            return updated
          }
          const updated = { ...row, [field]: value, updated_at: new Date().toISOString() }
          if (field === 'billing_code') {
            const code = billingCodes.find(c => c.code === value)
            updated.billing_code_color = code?.color || null
          } else if (field === 'cpt_code') {
            // Handle multiple CPT codes (comma-separated)
            if (value) {
              const codes = value.split(',').map((c: string) => c.trim())
              const colors = codes.map((c: string) => {
                const code = billingCodes.find(bc => bc.code === c)
                return code?.color || '#cccccc'
              })
              updated.cpt_code_color = colors.join(',')
            } else {
              updated.cpt_code_color = null
            }
          } else if (field === 'appointment_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'appointment')
            updated.appointment_status_color = status?.color || null
          } else if (field === 'claim_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'claim')
            updated.claim_status_color = status?.color || null
          } else if (field === 'patient_pay_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'patient_pay')
            updated.patient_pay_status_color = status?.color || null
          } else if (field === 'payment_date') {
            const month = statusColors.find(s => s.status === value && s.type === 'month')
            updated.payment_date_color = month?.color || null
          } else if (field === 'ar_date') {
            const month = statusColors.find(s => s.status === value && s.type === 'month')
            updated.ar_date_color = month?.color || null
          }
          return updated
        }
        return row
      })
      
      // Ensure we maintain 200 rows total per provider
      const nonEmptyRows = updatedRows.filter(r => !r.id.startsWith('empty-'))
      const emptyRowsNeeded = Math.max(0, 200 - nonEmptyRows.length)
      const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
      if (emptyRowsNeeded > existingEmptyCount) {
        const createEmptyRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
          patient_insurance: null,
          patient_copay: null,
          patient_coinsurance: null,
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          appointment_status_color: null,
          claim_status: null,
          claim_status_color: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          patient_pay_status_color: null,
          payment_date: null,
          payment_date_color: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_date_color: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
          total: null,
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        const newEmptyRows = Array.from({ length: emptyRowsNeeded - existingEmptyCount }, (_, i) => 
          createEmptyRow(existingEmptyCount + i)
        )
        return { ...prev, [providerId]: [...updatedRows, ...newEmptyRows] }
      }
      return { ...prev, [providerId]: updatedRows }
    })
  }, [billingCodes, statusColors])


  const handleDeleteProviderSheetRow = useCallback(async (providerId: string, rowId: string) => {
    setProviderSheetRows(prev => {
      const rows = prev[providerId] || []
      return { ...prev, [providerId]: rows.filter(r => r.id !== rowId) }
    })
    const updatedRows = providerSheetRowsRef.current[providerId]?.filter(r => r.id !== rowId) || []
    await saveProviderSheetRows(providerId, updatedRows)
  }, [saveProviderSheetRows])



  // Direct save function that accepts providerId and rows - for use when we have computed updated data
  const saveProviderSheetRowsDirect = useCallback(async (providerId: string, rowsToSave: SheetRow[]) => {
    await saveProviderSheetRows(providerId, rowsToSave)
  }, [saveProviderSheetRows])

  const handleTabChange = (tab: TabType) => {
    if (splitScreen) {
      // In split screen mode, update the appropriate side
      if (splitScreen.right === 'accounts_receivable') {
        setSplitScreen({ left: tab, right: 'accounts_receivable' })
      } else {
        setSplitScreen({ left: splitScreen.left, right: tab })
      }
    } else {
    setActiveTab(tab)
    navigate(`/clinic/${clinicId}/${tab}`, { replace: true })
  }
  }
  
  // Helper function to render tab content
  const renderTabContent = (tab: TabType) => {
    switch (tab) {
      case 'patients':
        return (
          <PatientsTab
            clinicId={clinicId!}
            canEdit={canEdit}
            isLockPatients={isLockPatients}
            onLockColumn={(columnName: string) => {
              // Get existing comment if column is already locked
              const existingComment = isLockPatients && isPatientColumnLocked(columnName as keyof IsLockPatients)
                ? (isLockPatients[`${columnName}_comment` as keyof IsLockPatients] as string | null) || ''
                : ''
              setSelectedLockColumn({ columnName, providerId: null, isPatientColumn: true })
              setLockComment(existingComment)
              setShowLockDialog(true)
            }}
            isColumnLocked={isPatientColumnLocked}
          />
        )
      case 'todo':
        return (
          <BillingTodoTab
            clinicId={clinicId!}
            canEdit={canEdit}
            isLockBillingTodo={isLockBillingTodo}
            onLockColumn={(columnName: string) => {
              // Get existing comment if column is already locked
              const existingComment = isLockBillingTodo && isBillingTodoColumnLocked(columnName as keyof IsLockBillingTodo)
                ? (isLockBillingTodo[`${columnName}_comment` as keyof IsLockBillingTodo] as string | null) || ''
                : ''
              setSelectedLockColumn({ columnName, providerId: null, isBillingTodoColumn: true })
              setLockComment(existingComment)
              setShowLockDialog(true)
            }}
            isColumnLocked={isBillingTodoColumnLocked}
          />
        )
      case 'accounts_receivable':
        return (
          <AccountsReceivableTab
            clinicId={clinicId!}
            canEdit={canEdit}
            isLockAccountsReceivable={isLockAccountsReceivable}
            onLockColumn={(columnName: string) => {
              // Get existing comment if column is already locked
              const existingComment = isLockAccountsReceivable && isARColumnLocked(columnName as keyof IsLockAccountsReceivable)
                ? (isLockAccountsReceivable[`${columnName}_comment` as keyof IsLockAccountsReceivable] as string | null) || ''
                : ''
              setSelectedLockColumn({ columnName, providerId: null, isARColumn: true })
              setLockComment(existingComment)
              setShowLockDialog(true)
            }}
            isColumnLocked={isARColumnLocked}
          />
        )
      case 'providers':
        return (
          <ProvidersTab
            providers={providers}
            providerSheetRows={providerSheetRows}
            billingCodes={billingCodes}
            statusColors={statusColors}
            patients={patients}
            selectedMonth={selectedMonth}
            providerId={providerId}
            currentProvider={currentProvider}
            canEdit={canEdit}
            isInSplitScreen={!!splitScreen}
            onUpdateProviderSheetRow={handleUpdateProviderSheetRow}
            onSaveProviderSheetRowsDirect={saveProviderSheetRowsDirect}
            onDeleteRow={handleDeleteProviderSheetRow}
            onPreviousMonth={handlePreviousMonth}
            onNextMonth={handleNextMonth}
            formatMonthYear={formatMonthYear}
            filterRowsByMonth={filterRowsByMonth}
            isLockProviders={isLockProviders}
            onLockProviderColumn={(columnName: string) => {
              // Get existing comment if column is already locked
              const existingComment = isLockProviders && isProviderColumnLocked(columnName as keyof IsLockProviders)
                ? (isLockProviders[`${columnName}_comment` as keyof IsLockProviders] as string | null) || ''
                : ''
              setSelectedLockColumn({ columnName, providerId: null, isProviderColumn: true })
              setLockComment(existingComment)
              setShowLockDialog(true)
            }}
            isProviderColumnLocked={isProviderColumnLocked}
          />
        )
      default:
        return null
    }
  }
  


  const canEdit = userProfile?.role === 'super_admin'

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent, type: 'patient' | 'todo' | 'providerRow' | 'ar', id: string, providerId?: string) => {
    if (!canEdit) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, providerId })
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
      if (tabContextMenuRef.current && !tabContextMenuRef.current.contains(event.target as Node)) {
        setTabContextMenu(null)
      }
    }

    if (contextMenu || tabContextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [contextMenu, tabContextMenu])
  
  // Handle tab context menu
  const handleTabContextMenu = (e: React.MouseEvent, tab: TabType) => {
    // Allow split screen for all tabs
    e.preventDefault()
    e.stopPropagation()
    setTabContextMenu({ x: e.clientX, y: e.clientY, tab })
  }
  
  // Handle split screen
  const handleSplitScreen = () => {
    if (!tabContextMenu) return
    
    // Determine which tab to show on the right side
    const rightTab = tabContextMenu.tab
    
    // Determine which tabs can be on the right side (accounts_receivable and todo)
    // For other tabs (patients, providers), they will be on the left side
    const rightSideTabs: TabType[] = ['accounts_receivable', 'todo']
    const isRightSideTab = rightSideTabs.includes(rightTab)
    
    if (isRightSideTab) {
      // If right-clicked tab is a right-side tab, use it on the right
      // Use current active tab as left side, or default to 'patients'
      const leftTab = activeTab === rightTab ? 'patients' : activeTab
      setSplitScreen({ left: leftTab, right: rightTab })
    } else {
      // If right-clicked tab is not a right-side tab, use it on the left
      // Use a default right-side tab (accounts_receivable)
      setSplitScreen({ left: rightTab, right: 'accounts_receivable' })
    }
    
    setSplitScreenLeftWidth(50) // Reset to 50/50 split
    setTabContextMenu(null)
  }
  
  // Exit split screen
  const handleExitSplitScreen = () => {
    setSplitScreen(null)
    setActiveTab('patients')
    navigate(`/clinic/${clinicId}/patients`, { replace: true })
  }
  
  // Handle split screen resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !splitScreenContainerRef.current) return
      
      const container = splitScreenContainerRef.current
      const containerRect = container.getBoundingClientRect()
      const containerWidth = containerRect.width
      const mouseX = e.clientX - containerRect.left
      
      // Calculate percentage (with min/max constraints)
      const percentage = Math.max(20, Math.min(80, (mouseX / containerWidth) * 100))
      setSplitScreenLeftWidth(percentage)
    }
    
    const handleMouseUp = () => {
      setIsResizing(false)
    }
    
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing])

  // Handle delete from context menu (only for provider rows now)
  const handleContextMenuDelete = () => {
    if (!contextMenu) return
    
    if (contextMenu.type === 'providerRow' && contextMenu.providerId) {
      handleDeleteProviderSheetRow(contextMenu.providerId, contextMenu.id)
    }
    // Patients, todos, and AR tabs handle their own deletes internally
    setContextMenu(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">{clinic?.name || 'Clinic Details'}</h1>
        {clinic?.address && <p className="text-white/70">{clinic.address}</p>}
      </div>

      <div className="flex gap-2 mb-6 border-b border-white/20">
        <button
          onClick={() => handleTabChange('patients')}
          onContextMenu={(e) => handleTabContextMenu(e, 'patients')}
          className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'patients' || splitScreen?.left === 'patients'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-white/70 hover:text-white'
          }`}
        >
          <Users size={18} />
          Patient Info
        </button>
        <button
          onClick={() => handleTabChange('todo')}
          onContextMenu={(e) => handleTabContextMenu(e, 'todo')}
          className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'todo' || splitScreen?.right === 'todo' || splitScreen?.left === 'todo'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-white/70 hover:text-white'
          }`}
        >
          <CheckSquare size={18} />
          Billing To-Do
        </button>
        <button
          onClick={() => handleTabChange('providers')}
          onContextMenu={(e) => handleTabContextMenu(e, 'providers')}
          className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'providers' || splitScreen?.left === 'providers'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-white/70 hover:text-white'
          }`}
        >
          <FileText size={18} />
          Providers
        </button>
        <button
          onClick={() => handleTabChange('accounts_receivable')}
          onContextMenu={(e) => handleTabContextMenu(e, 'accounts_receivable')}
          className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'accounts_receivable' || splitScreen?.right === 'accounts_receivable'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-white/70 hover:text-white'
          }`}
        >
          <FileText size={18} />
          Accounts Receivable
        </button>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20">
        {splitScreen ? (
          <div 
            ref={splitScreenContainerRef}
            className="flex" 
            style={{ minHeight: '600px', width: '100%', overflow: 'hidden', position: 'relative' }}
          >
            {/* Left side */}
            <div 
              className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20" 
              style={{ 
                width: `${splitScreenLeftWidth}%`,
                minWidth: 0, 
                overflow: 'hidden',
                transition: isResizing ? 'none' : 'width 0.1s ease'
              }}
            >
              <div className="p-2 border-b border-white/20 flex justify-between items-center">
                <span className="text-white font-medium">
                  {splitScreen.left === 'patients' ? 'Patient Info' : 
                   splitScreen.left === 'todo' ? 'Billing To-Do' : 
                   splitScreen.left === 'providers' ? 'Providers' : 'Accounts Receivable'}
                </span>
                              <button
                  onClick={() => setSplitScreen({ ...splitScreen, left: splitScreen.left === 'patients' ? 'todo' : splitScreen.left === 'todo' ? 'providers' : 'patients' })}
                  className="text-white/70 hover:text-white text-sm px-2"
                >
                  Switch
                              </button>
            </div>
              <div style={{ width: '100%', overflow: 'hidden', height: 'calc(100% - 40px)' }}>
                {renderTabContent(splitScreen.left)}
          </div>
            </div>
            
            {/* Resizable Divider */}
            <div 
              className="bg-white/20 hover:bg-white/30 cursor-col-resize flex items-center justify-center"
                                style={{ 
                width: '4px',
                minWidth: '4px',
                position: 'relative',
                zIndex: 10
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizing(true)
              }}
            >
              <div 
                className="bg-white/40 rounded"
                                  style={{ 
                  width: '2px',
                  height: '100%'
                }}
              />
                              </div>
            
            {/* Right side - Accounts Receivable or Billing To-Do */}
            <div 
              className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20" 
              style={{ 
                width: `${100 - splitScreenLeftWidth}%`,
                minWidth: 0, 
                overflow: 'hidden',
                transition: isResizing ? 'none' : 'width 0.1s ease'
              }}
            >
              <div className="p-2 border-b border-white/20 flex justify-between items-center">
                <span className="text-white font-medium">
                  {splitScreen.right === 'accounts_receivable' ? 'Accounts Receivable' : 'Billing To-Do'}
                </span>
                <div className="flex items-center gap-2">
                              <button
                    onClick={() => {
                      // Cycle through available right-side tabs (accounts_receivable and todo)
                      const nextRightTab = splitScreen.right === 'accounts_receivable' ? 'todo' : 'accounts_receivable'
                      setSplitScreen({ ...splitScreen, right: nextRightTab })
                    }}
                    className="text-white/70 hover:text-white text-sm px-2"
                    title="Switch right tab"
                  >
                    Switch
                              </button>
              <button
                    onClick={handleExitSplitScreen}
                    className="text-white/70 hover:text-white text-sm px-2"
                    title="Exit split screen"
                  >
                    ✕
              </button>
              </div>
            </div>
              <div style={{ width: '100%', overflow: 'hidden', height: 'calc(100% - 40px)' }}>
                {renderTabContent(splitScreen.right)}
                            </div>
            </div>
                                </div>
                              ) : (
          renderTabContent(activeTab)
        )}
      </div>

      {/* Tab Context Menu */}
      {tabContextMenu && (
        <div
          ref={tabContextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[150px]"
                                style={{ 
            left: `${tabContextMenu.x}px`,
            top: `${tabContextMenu.y}px`,
          }}
        >
          <button
            onClick={handleSplitScreen}
            className="w-full text-left px-4 py-2 text-white hover:bg-white/10 flex items-center gap-2"
          >
            <FileText size={16} />
            To Split Screen
          </button>
                                </div>
      )}

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
            onClick={handleContextMenuDelete}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
                              >
                                <Trash2 size={16} />
            Delete Row
                              </button>
          </div>
        )}

      {/* Column Lock Dialog */}
      {showLockDialog && selectedLockColumn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-4">
              {selectedLockColumn.isPatientColumn 
                ? (isPatientColumnLocked(selectedLockColumn.columnName as keyof IsLockPatients) ? 'Unlock' : 'Lock')
                : selectedLockColumn.isBillingTodoColumn
                ? (isBillingTodoColumnLocked(selectedLockColumn.columnName as keyof IsLockBillingTodo) ? 'Unlock' : 'Lock')
                : selectedLockColumn.isProviderColumn
                ? (isProviderColumnLocked(selectedLockColumn.columnName as keyof IsLockProviders) ? 'Unlock' : 'Lock')
                : selectedLockColumn.isARColumn
                ? (isARColumnLocked(selectedLockColumn.columnName as keyof IsLockAccountsReceivable) ? 'Unlock' : 'Lock')
                : (isColumnLocked(selectedLockColumn.columnName, selectedLockColumn.providerId) ? 'Unlock' : 'Lock')
              } Column
            </h3>
            
            <div className="mb-4">
              <p className="text-slate-300 mb-2">
                Column: <span className="font-semibold text-white">{selectedLockColumn.columnName}</span>
              </p>
              {selectedLockColumn.providerId && !selectedLockColumn.isPatientColumn && !selectedLockColumn.isBillingTodoColumn && !selectedLockColumn.isProviderColumn && !selectedLockColumn.isARColumn && (
                <p className="text-slate-300 text-sm">
                  Provider-specific lock
                </p>
              )}
              {selectedLockColumn.isPatientColumn && (
                <p className="text-slate-300 text-sm">
                  Patient table column
                </p>
              )}
              {selectedLockColumn.isBillingTodoColumn && (
                <p className="text-slate-300 text-sm">
                  Billing Todo table column
                </p>
              )}
              {selectedLockColumn.isProviderColumn && (
                <p className="text-slate-300 text-sm">
                  Providers table column
                </p>
              )}
              {selectedLockColumn.isARColumn && (
                <p className="text-slate-300 text-sm">
                  Accounts Receivable table column
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-slate-300 mb-2">
                Comment (optional):
              </label>
              <textarea
                value={lockComment}
                onChange={(e) => setLockComment(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 text-white border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Why is this column locked?"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowLockDialog(false)
                  setSelectedLockColumn(null)
                  setLockComment('')
                }}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              
              {selectedLockColumn.isPatientColumn ? (
                <>
                  {isPatientColumnLocked(selectedLockColumn.columnName as keyof IsLockPatients) && (
                    <button
                      onClick={() => handleTogglePatientColumnLock(selectedLockColumn.columnName as keyof IsLockPatients, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isPatientColumnLocked(selectedLockColumn.columnName as keyof IsLockPatients) && (
                    <button
                      onClick={() => handleTogglePatientColumnLock(selectedLockColumn.columnName as keyof IsLockPatients, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : selectedLockColumn.isBillingTodoColumn ? (
                <>
                  {isBillingTodoColumnLocked(selectedLockColumn.columnName as keyof IsLockBillingTodo) && (
                    <button
                      onClick={() => handleToggleBillingTodoColumnLock(selectedLockColumn.columnName as keyof IsLockBillingTodo, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isBillingTodoColumnLocked(selectedLockColumn.columnName as keyof IsLockBillingTodo) && (
                    <button
                      onClick={() => handleToggleBillingTodoColumnLock(selectedLockColumn.columnName as keyof IsLockBillingTodo, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : selectedLockColumn.isProviderColumn ? (
                <>
                  {isProviderColumnLocked(selectedLockColumn.columnName as keyof IsLockProviders) && (
                    <button
                      onClick={() => handleToggleProviderColumnLock(selectedLockColumn.columnName as keyof IsLockProviders, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isProviderColumnLocked(selectedLockColumn.columnName as keyof IsLockProviders) && (
                    <button
                      onClick={() => handleToggleProviderColumnLock(selectedLockColumn.columnName as keyof IsLockProviders, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : selectedLockColumn.isARColumn ? (
                <>
                  {isARColumnLocked(selectedLockColumn.columnName as keyof IsLockAccountsReceivable) && (
                    <button
                      onClick={() => handleToggleARColumnLock(selectedLockColumn.columnName as keyof IsLockAccountsReceivable, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isARColumnLocked(selectedLockColumn.columnName as keyof IsLockAccountsReceivable) && (
                    <button
                      onClick={() => handleToggleARColumnLock(selectedLockColumn.columnName as keyof IsLockAccountsReceivable, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : (
                <>
                  {isColumnLocked(selectedLockColumn.columnName, selectedLockColumn.providerId) && (
                    <button
                      onClick={() => handleToggleColumnLock(selectedLockColumn.columnName, selectedLockColumn.providerId, false)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleToggleColumnLock(selectedLockColumn.columnName, selectedLockColumn.providerId, true, lockComment)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                  >
                    <Lock size={16} />
                    Lock
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}