import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider, ProviderScheduleEntry } from '@/types'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { DateEditor } from '@/lib/handsontableCustomRenderers'

const SCHEDULE_COLUMNS = ['patient_id', 'patient_name', 'insurance', 'copay', 'coinsurance', 'date_of_service'] as const
const COLUMN_TITLES = ['Patient ID', 'Patient Name', 'Insurance', 'Co Pay', 'Co Ins', 'Date of Service']

function createEmptyEntry(index: number, clinicId: string, providerId: string): ProviderScheduleEntry {
  return {
    id: `empty-${index}`,
    clinic_id: clinicId,
    provider_id: providerId,
    patient_id: null,
    patient_name: null,
    insurance: null,
    copay: null,
    coinsurance: null,
    date_of_service: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export default function ProviderSchedulePage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { clinicId: urlClinicId } = useParams<{ clinicId: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [entries, setEntries] = useState<ProviderScheduleEntry[]>([])
  const entriesRef = useRef<ProviderScheduleEntry[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (userProfile?.role !== 'provider') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (!urlClinicId) {
      navigate('/providers', { replace: true })
    }
  }, [user, userProfile, authLoading, navigate, urlClinicId])

  const resolveProvider = useCallback(async () => {
    if (!user?.email || userProfile?.role !== 'provider') return
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('providers')
        .select('*')
        .eq('email', user.email!)
      if (userProfile?.clinic_ids?.length) {
        query = query.overlaps('clinic_ids', userProfile.clinic_ids)
      }
      const { data, error: err } = await query.limit(1).maybeSingle()
      if (err) throw err
      if (!data) {
        setError('Your account is not linked to a provider.')
        setProvider(null)
        return
      }
      setProvider(data)
    } catch (e) {
      console.error(e)
      setError('Failed to load provider profile.')
      setProvider(null)
    } finally {
      setLoading(false)
    }
  }, [user?.email, userProfile?.role, userProfile?.clinic_ids])

  useEffect(() => {
    resolveProvider()
  }, [resolveProvider])

  const fetchClinic = useCallback(async (id: string) => {
    const { data } = await supabase.from('clinics').select('*').eq('id', id).maybeSingle()
    setClinic(data || null)
  }, [])

  // Use clinic from URL; must be one of the provider's clinics
  const clinicId = urlClinicId && provider?.clinic_ids?.includes(urlClinicId) ? urlClinicId : undefined

  useEffect(() => {
    if (!provider || !urlClinicId) return
    if (!provider.clinic_ids?.includes(urlClinicId)) {
      navigate('/providers', { replace: true })
    }
  }, [provider, urlClinicId, navigate])

  const fetchSchedule = useCallback(async () => {
    if (!provider) return
    const cid = clinicId ?? provider.clinic_ids?.[0]
    let query = supabase
      .from('provider_schedules')
      .select('*')
      .eq('provider_id', provider.id)
    if (cid) {
      query = query.eq('clinic_id', cid)
    }
    const { data, error: err } = await query.order('date_of_service', { ascending: true })
    console.log("query: ",query)
    if (err) {
      console.error(err)
      setEntries([])
      return
    }
    console.log("data: ",data)
    const list = (data || []) as ProviderScheduleEntry[]
    const emptyCount = Math.max(0, 200 - list.length)
    const entryCid = cid ?? ''
    const emptyRows = Array.from({ length: emptyCount }, (_, i) =>
      createEmptyEntry(i, entryCid, provider.id)
    )
    setEntries([...list, ...emptyRows])
  }, [provider, clinicId])

  useEffect(() => {
    if (provider && clinicId) {
      fetchClinic(clinicId)
      fetchSchedule()
    }
  }, [provider, clinicId, fetchClinic, fetchSchedule])

  const saveEntry = useCallback(async (entryOrId: ProviderScheduleEntry | string) => {
    if (!provider) return
    const entry = typeof entryOrId === 'string'
      ? entriesRef.current.find(e => e.id === entryOrId)
      : entryOrId
    if (!entry) return
    const isNew = entry.id.startsWith('new-') || entry.id.startsWith('empty-')
    const hasData = !!(
      (entry.patient_id ?? '').toString().trim() ||
      (entry.patient_name ?? '').toString().trim() ||
      (entry.insurance ?? '').toString().trim() ||
      entry.copay != null ||
      entry.coinsurance != null ||
      (entry.date_of_service ?? '').toString().trim()
    )
    if (isNew && !hasData) return
    setSaving(true)
    try {
      const cid = clinicId ?? provider.clinic_ids?.[0] ?? ''
    const payload = {
        clinic_id: cid,
        provider_id: provider.id,
        patient_id: (entry.patient_id ?? '').toString().trim() || null,
        patient_name: (entry.patient_name ?? '').toString().trim() || null,
        insurance: (entry.insurance ?? '').toString().trim() || null,
        copay: entry.copay != null ? Number(entry.copay) : null,
        coinsurance: entry.coinsurance != null ? Number(entry.coinsurance) : null,
        date_of_service: (entry.date_of_service ?? '').toString().trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (isNew) {
        const { data, error: err } = await supabase
          .from('provider_schedules')
          .insert(payload)
          .select()
          .single()
        if (err) throw err
        setEntries(prev => prev.map(e => (e.id === entry.id ? (data as ProviderScheduleEntry) : e)))
      } else {
        const { error: err } = await supabase
          .from('provider_schedules')
          .update(payload)
          .eq('id', entry.id)
        if (err) throw err
      }
    } catch (e) {
      console.error(e)
      alert('Failed to save entry.')
    } finally {
      setSaving(false)
    }
  }, [provider])

  const deleteEntry = useCallback(async (id: string) => {
    if (!confirm('Delete this schedule entry?')) return
    if (id.startsWith('new-') || id.startsWith('empty-')) {
      setEntries(prev => prev.filter(e => e.id !== id))
      const current = entriesRef.current.filter(e => e.id !== id)
      const needEmpty = 200 - current.length
      if (needEmpty > 0 && provider) {
        const start = current.filter(e => e.id.startsWith('empty-')).length
        const cid = provider.clinic_ids?.[0] ?? ''
        setEntries([...current, ...Array.from({ length: needEmpty }, (_, i) =>
          createEmptyEntry(start + i, cid, provider.id)
        )])
      } else {
        setEntries(current)
      }
      return
    }
    setSaving(true)
    try {
      const { error: err } = await supabase.from('provider_schedules').delete().eq('id', id)
      if (err) throw err
      setEntries(prev => {
        const next = prev.filter(e => e.id !== id)
        const needEmpty = 200 - next.length
        if (needEmpty > 0 && provider) {
          const start = next.filter(e => e.id.startsWith('empty-')).length
          const cid = provider.clinic_ids?.[0] ?? ''
          return [...next, ...Array.from({ length: needEmpty }, (_, i) =>
            createEmptyEntry(start + i, cid, provider.id)
          )]
        }
        return next
      })
    } catch (e) {
      console.error(e)
      alert('Failed to delete entry.')
    } finally {
      setSaving(false)
    }
  }, [provider])

  const getScheduleHandsontableData = useCallback(() => {
    return entries.map(e => [
      e.patient_id ?? '',
      e.patient_name ?? '',
      e.insurance ?? '',
      e.copay ?? '',
      e.coinsurance ?? '',
      e.date_of_service ?? '',
    ])
  }, [entries])

  const scheduleColumns = [
    { data: 0, title: COLUMN_TITLES[0], type: 'text' as const, width: 120 },
    { data: 1, title: COLUMN_TITLES[1], type: 'text' as const, width: 160 },
    { data: 2, title: COLUMN_TITLES[2], type: 'text' as const, width: 140 },
    { data: 3, title: COLUMN_TITLES[3], type: 'numeric' as const, width: 90, numericFormat: { pattern: '0.00', culture: 'en-US' } },
    { data: 4, title: COLUMN_TITLES[4], type: 'numeric' as const, width: 90, numericFormat: { pattern: '0.00', culture: 'en-US' } },
    { data: 5, title: COLUMN_TITLES[5], type: 'date' as const, width: 120, editor: DateEditor },
  ]

  const handleScheduleChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return
    const current = entriesRef.current.length ? entriesRef.current : entries
    const updated = current.map(e => ({ ...e }))
    const fields = [...SCHEDULE_COLUMNS]

    changes.forEach(([row, col, , newValue]) => {
      while (updated.length <= row) {
        const emptyCount = updated.filter(e => e.id.startsWith('empty-')).length
        if (provider) updated.push(createEmptyEntry(emptyCount, provider.clinic_ids?.[0] ?? '', provider.id))
      }
      const entry = updated[row]
      if (!entry || !provider) return
      const field = fields[col as number]
      if (field === 'copay' || field === 'coinsurance') {
        const num = newValue === '' || newValue == null ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
        ;(entry as any)[field] = num
      } else if (field) {
        ;(entry as any)[field] = newValue === '' || newValue == null ? null : String(newValue)
      }
      entry.updated_at = new Date().toISOString()
    })

    if (updated.length > 200) updated.splice(200)
    else if (updated.length < 200 && provider) {
      const need = 200 - updated.length
      const start = updated.filter(e => e.id.startsWith('empty-')).length
      const cid = provider.clinic_ids?.[0] ?? ''
      updated.push(...Array.from({ length: need }, (_, i) =>
        createEmptyEntry(start + i, cid, provider.id)
      ))
    }

    entriesRef.current = updated
    setEntries(updated)
    const rowsToSave = new Set(changes.map(([r]) => r))
    rowsToSave.forEach(row => {
      const entry = updated[row]
      if (entry) saveEntry(entry).catch(console.error)
    })
  }, [entries, provider, saveEntry])

  const handleScheduleContextMenu = useCallback((row: number, _col: number, _event: MouseEvent) => {
    const entry = entries[row]
    if (entry) deleteEntry(entry.id)
  }, [entries, deleteEntry])

  if (authLoading || (userProfile?.role === 'provider' && loading && !provider)) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400" />
      </div>
    )
  }

  if (userProfile?.role !== 'provider') return null
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-amber-900/30 border border-amber-600/50 text-amber-200 p-4">{error}</div>
      </div>
    )
  }
  if (!provider) return null

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Schedule</h1>
        {clinic && <p className="text-white/70">{clinic.name}</p>}
        {saving && <span className="text-white/50 text-sm ml-2">Saving…</span>}
      </div>

      <div
        className="table-container dark-theme"
        style={{
          maxHeight: '600px',
          overflowX: 'auto',
          overflowY: 'auto',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5',
        }}
      >
        <HandsontableWrapper
          key={`schedule-${entries.length}`}
          data={getScheduleHandsontableData()}
          columns={scheduleColumns}
          colHeaders={COLUMN_TITLES}
          rowHeaders={true}
          width="100%"
          height={600}
          afterChange={handleScheduleChange}
          onContextMenu={handleScheduleContextMenu}
          enableFormula={false}
          readOnly={false}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom"
        />
      </div>
    </div>
  )
}
