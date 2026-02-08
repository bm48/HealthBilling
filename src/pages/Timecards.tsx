import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Timecard} from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { LogIn, LogOut, Plus } from 'lucide-react'

export default function Timecards() {
  const { user, userProfile } = useAuth()
  const [timecards, setTimecards] = useState<Timecard[]>([])
  // const [clinics, setClinics] = useState<Clinic[]>([])
  const [selectedClinic, setSelectedClinic] = useState<string>('')
  const [currentClockIn, setCurrentClockIn] = useState<Timecard | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    clock_in: '',
    clock_out: '',
    notes: '',
  })

  useEffect(() => {
    if (user && userProfile) {
      loadClinics()
      loadCurrentClockIn()
      loadTimecards()
    }
  }, [user, userProfile])

  async function loadClinics() {
    if (!userProfile?.clinic_ids.length) return

    const { data } = await supabase
      .from('clinics')
      .select('*')
      .in('id', userProfile.clinic_ids)

    if (data) {
      // setClinics(data)
      if (data.length > 0) {
        setSelectedClinic(data[0].id)
      }
    }
  }

  async function loadCurrentClockIn() {
    if (!user) return
    
    const { data } = await supabase
      .from('timecards')
      .select('*')
      .eq('user_id', user.id)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      setCurrentClockIn(data)
    }
  }

  async function loadTimecards() {
    if (!user) return
    
    const { data } = await supabase
      .from('timecards')
      .select('*')
      .eq('user_id', user.id)
      .order('clock_in', { ascending: false })
      .limit(10)

    if (data) {
      setTimecards(data)
    }
  }

  const handleClockIn = async () => {
    if (!selectedClinic || !user) return

    const now = new Date()
    // Calculate week start date (Monday of current week)
    const weekStart = new Date(now)
    const day = weekStart.getDay()
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from('timecards')
      .insert({
        user_id: user.id,
        clinic_id: selectedClinic,
        clock_in: now.toISOString(),
        week_start_date: weekStart.toISOString().split('T')[0], // YYYY-MM-DD format
      })
      .select()
      .maybeSingle()

    if (error) {
      alert('Failed to clock in. Please try again.')
      return
    }

    if (data) {
      setCurrentClockIn(data)
      loadTimecards()
    }
  }

  const handleClockOut = async () => {
    if (!currentClockIn) return

    const clockOutTime = new Date()
    const clockInTime = new Date(currentClockIn.clock_in)
    const hours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60)

    await supabase
      .from('timecards')
      .update({
        clock_out: clockOutTime.toISOString(),
        hours: Math.round(hours * 100) / 100,
      })
      .eq('id', currentClockIn.id)

    setCurrentClockIn(null)
    loadTimecards()
  }

  const handleManualEntry = async () => {
    if (!selectedClinic || !formData.clock_in || !formData.clock_out || !user) return

    const clockOutTime = new Date(formData.clock_out)
    const clockInTime = new Date(formData.clock_in)
    const hours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60)

    // Calculate week start date (Monday of the week containing clock_in)
    const weekStart = new Date(clockInTime)
    const day = weekStart.getDay()
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)

    const { error } = await supabase.from('timecards').insert({
      user_id: user.id,
      clinic_id: selectedClinic,
      clock_in: formData.clock_in,
      clock_out: formData.clock_out,
      hours: Math.round(hours * 100) / 100,
      notes: formData.notes || null,
      week_start_date: weekStart.toISOString().split('T')[0], // YYYY-MM-DD format
    })

    if (error) {
      alert('Failed to create time entry. Please try again.')
      return
    }

    setShowModal(false)
    setFormData({ clock_in: '', clock_out: '', notes: '' })
    loadTimecards()
  }

  // Working time per entry = clock_out - clock_in (stored as tc.hours). Weekly total = sum of those hours for all entries in that week. Average weekly = sum of all weekly totals / number of weeks.
  const totalHours = timecards
    .filter((tc) => tc.hours)
    .reduce((sum, tc) => sum + (tc.hours || 0), 0)

  const getWeekStart = (tc: Timecard): string => {
    if (tc.week_start_date) return tc.week_start_date
    const d = new Date(tc.clock_in)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const weekStart = new Date(d)
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)
    return weekStart.toISOString().split('T')[0]
  }
  // Group by week: each week's total = sum of (clock_out - clock_in) for every entry in that week
  const hoursByWeek = timecards
    .filter((tc) => tc.hours)
    .reduce<Record<string, number>>((acc, tc) => {
      const week = getWeekStart(tc)
      acc[week] = (acc[week] || 0) + (tc.hours || 0)
      return acc
    }, {})
  const weekEntries = Object.entries(hoursByWeek)
    .map(([date, hours]) => ({ date, hours }))
    .sort((a, b) => b.date.localeCompare(a.date))
  const averageHoursPerWeek = weekEntries.length > 0 ? totalHours / weekEntries.length : 0

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Timecards</h1>
        <p className="text-white/70">Track your work hours</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
          <h2 className="text-xl font-semibold text-white mb-4">Clock In/Out</h2>
          {/* <div className="mb-4">
            <label className="block text-sm font-medium text-white/90 mb-2">
              Clinic
            </label>
            <select
              value={selectedClinic}
              onChange={(e) => setSelectedClinic(e.target.value)}
              className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
            >
              <option value="" className="bg-slate-900">Select clinic</option>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id} className="bg-slate-900">
                  {clinic.name}
                </option>
              ))}
            </select>
          </div> */}
          {currentClockIn ? (
            <div>
              <p className="text-sm text-white/70 mb-4">
                Clocked in at: {new Date(currentClockIn.clock_in).toLocaleString()}
              </p>
              <button
                onClick={handleClockOut}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                <LogOut className="w-5 h-5" />
                Clock Out
              </button>
            </div>
          ) : (
            <button
              onClick={handleClockIn}
              disabled={!selectedClinic}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              <LogIn className="w-5 h-5" />
              Clock In
            </button>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-md"
          >
            <Plus className="w-5 h-5" />
            Manual Entry
          </button>
        </div>

        <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
          <h2 className="text-xl font-semibold text-white mb-4">Summary</h2>
          <div className="flex justify-between items-center">
            <span className="text-white/70">Average hours per week</span>
            <span className="font-semibold text-white text-xl">
              {averageHoursPerWeek.toFixed(2)} hrs
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl overflow-hidden border border-white/20">
        <div className="p-4 border-b border-white/20">
          <h2 className="font-semibold text-white">Recent Timecards</h2>
        </div>
        <div className="table-container dark-theme">
          <table className="table-spreadsheet dark-theme">
            <thead>
              <tr>
                <th>Date</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Hours</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {timecards.map((timecard) => (
                <tr key={timecard.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(timecard.clock_in).toLocaleDateString()}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(timecard.clock_in).toLocaleTimeString()}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {timecard.clock_out ? new Date(timecard.clock_out).toLocaleTimeString() : '-'}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {timecard.hours ? timecard.hours.toFixed(2) : '-'}
                  </td>
                  <td>{timecard.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 bg-white/10 backdrop-blur-md rounded-lg shadow-xl overflow-hidden border border-white/20">
        <div className="p-4 border-b border-white/20">
          <h2 className="font-semibold text-white">Weekly Summary</h2>
        </div>
        <div className="table-container dark-theme">
          <table className="table-spreadsheet dark-theme">
            <thead>
              <tr>
                <th>Week</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {weekEntries.length === 0 ? (
                <tr>
                  <td colSpan={2} className="text-white/60 text-center py-6">
                    No hours recorded yet.
                  </td>
                </tr>
              ) : (
                weekEntries.map(({ date, hours }) => {
                  const weekStart = new Date(date + 'T00:00:00')
                  const weekEnd = new Date(weekStart)
                  weekEnd.setDate(weekEnd.getDate() + 6)
                  const dateRange = weekStart.getMonth() === weekEnd.getMonth()
                    ? `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}-${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
                    : `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  return (
                    <tr key={date}>
                      <td style={{ whiteSpace: 'nowrap' }} className="text-white/90">{dateRange}</td>
                      <td style={{ fontWeight: 500 }} className="text-white">{hours.toFixed(2)} hrs</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800/95 backdrop-blur-md rounded-lg p-6 w-full max-w-md border border-white/20">
            <h2 className="text-xl font-bold text-white mb-4">Manual Time Entry</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Clock In</label>
                <input
                  type="datetime-local"
                  value={formData.clock_in}
                  onChange={(e) => setFormData({ ...formData, clock_in: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Clock Out</label>
                <input
                  type="datetime-local"
                  value={formData.clock_out}
                  onChange={(e) => setFormData({ ...formData, clock_out: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md placeholder-white/50"
                  rows={3}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-4 justify-end">
              <button
                onClick={() => {
                  setShowModal(false)
                  setFormData({ clock_in: '', clock_out: '', notes: '' })
                }}
                className="px-4 py-2 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleManualEntry}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
