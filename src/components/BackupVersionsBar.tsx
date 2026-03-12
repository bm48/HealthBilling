import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import {
  listBackupVersions,
  getBackupDownloadUrl,
  type BackupVersion,
} from '@/lib/providerSheetBackups'
import { History, Download, RotateCcw, Loader2, X } from 'lucide-react'

interface BackupVersionsBarProps {
  sheetId: string
  onSelectVersion: (version: BackupVersion) => Promise<void>
  onBackToCurrent: () => void
  viewingVersion: BackupVersion | null
  formatDate?: (iso: string) => string
}

function toLocalDateString(iso: string): string {
  const d = new Date(iso)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function toLocalTimeString(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function BackupVersionsBar({
  sheetId,
  onSelectVersion,
  onBackToCurrent,
  viewingVersion,
  formatDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
}: BackupVersionsBarProps) {
  const [versions, setVersions] = useState<BackupVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedVersionId, setSelectedVersionId] = useState<string>('')

  const fetchVersions = useCallback(() => {
    listBackupVersions(supabase, sheetId)
      .then((list) => setVersions(list))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load versions'))
  }, [sheetId])

  useEffect(() => {
    let cancelled = false
    setError(null)
    listBackupVersions(supabase, sheetId)
      .then((list) => {
        if (!cancelled) setVersions(list)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load versions')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [sheetId])

  useEffect(() => {
    const POLL_MS = 60_000
    const interval = setInterval(fetchVersions, POLL_MS)
    return () => clearInterval(interval)
  }, [fetchVersions])

  const datesWithBackups = useMemo(() => {
    const set = new Set<string>()
    versions.forEach((v) => set.add(toLocalDateString(v.created_at)))
    return Array.from(set).sort().reverse()
  }, [versions])

  const defaultDate = datesWithBackups[0] ?? new Date().toISOString().slice(0, 10)

  const versionsForSelectedDate = useMemo(() => {
    const date = selectedDate || defaultDate
    const forDate = versions.filter((v) => toLocalDateString(v.created_at) === date)
    return [...forDate].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [versions, selectedDate, defaultDate])

  useEffect(() => {
    if (modalOpen && !selectedDate && defaultDate) setSelectedDate(defaultDate)
  }, [modalOpen, defaultDate, selectedDate])

  useEffect(() => {
    if (modalOpen && versionsForSelectedDate.length > 0 && !versionsForSelectedDate.some((v) => v.id === selectedVersionId)) {
      setSelectedVersionId(versionsForSelectedDate[0].id)
    }
    if (modalOpen && versionsForSelectedDate.length > 0 && !selectedVersionId) {
      setSelectedVersionId(versionsForSelectedDate[0].id)
    }
  }, [modalOpen, versionsForSelectedDate, selectedVersionId])

  const handleViewVersion = async (v: BackupVersion) => {
    if (viewingVersion?.version === v.version) return
    setLoadingVersion(v.id)
    setError(null)
    try {
      await onSelectVersion(v)
      setModalOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backup')
    } finally {
      setLoadingVersion(null)
    }
  }

  const handleDownload = async (v: BackupVersion) => {
    try {
      const url = await getBackupDownloadUrl(supabase, v.file_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get download link')
    }
  }

  const selectedVersion = versions.find((v) => v.id === selectedVersionId)

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-white/70 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2 flex-wrap mt-2 pr-4 -mb-6">
        {versions.length === 0 && !viewingVersion && (
          <span className="text-white/50 text-sm">No backup versions yet. Backups run every 12 hours.</span>
        )}
        {viewingVersion && (
          <div>
            <span className="text-white/60 text-sm">Viewing backup from {formatDate(viewingVersion.created_at)}</span>
            <button
              type="button"
              onClick={onBackToCurrent}
              className="ml-4 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 text-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Back to current data
            </button>
          </div>
        )}
        
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium"
        >
          <History className="w-4 h-4" />
          Select version
        </button>
      </div>
      {error && <div className="mt-2 text-amber-400 text-sm">{error}</div>}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex justify-center bg-black/60 pt-20 pb-4 px-4" onClick={() => setModalOpen(false)}>
          <div
            className="bg-gray-900 border border-white/20 rounded-xl shadow-xl max-w-lg w-full p-5 self-start"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Select backup version</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-1">Date</label>
                <input
                  type="date"
                  value={selectedDate || defaultDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value)
                    setSelectedVersionId('')
                  }}
                  className="cursor-pointer w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-1">Version</label>
                <select
                  value={selectedVersionId}
                  onChange={(e) => setSelectedVersionId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent cursor-pointer"
                >
                  {versionsForSelectedDate.length === 0 ? (
                    <option value="">No versions for this date</option>
                  ) : (
                    versionsForSelectedDate.map((v, index) => (
                      <option className="text-black cursor-pointer" key={v.id} value={v.id}>
                        Version {index + 1} — {toLocalTimeString(v.created_at)}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="relative flex flex-wrap gap-2 mt-5">
              <button
                type="button"
                disabled={!selectedVersion || loadingVersion !== null}
                onClick={() => selectedVersion && handleViewVersion(selectedVersion)}
                className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white font-medium disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
              >
                {loadingVersion === selectedVersionId ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                View this version
              </button>
              <button
                type="button"
                disabled={!selectedVersion}
                onClick={() => selectedVersion && handleDownload(selectedVersion)}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium disabled:opacity-50 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="absolute top-0 right-0 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
