import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Timecard, Clinic } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { LogIn, LogOut, Plus } from 'lucide-react';

export default function Timecards() {
  const { user, userProfile } = useAuth();
  const [timecards, setTimecards] = useState<Timecard[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<string>('');
  const [currentClockIn, setCurrentClockIn] = useState<Timecard | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    clock_in: '',
    clock_out: '',
    notes: '',
  });

  useEffect(() => {
    if (user && userProfile) {
      loadClinics();
      loadCurrentClockIn();
      loadTimecards();
    }
  }, [user, userProfile]);

  async function loadClinics() {
    if (!userProfile?.clinic_ids.length) return;

    const { data } = await supabase
      .from('clinics')
      .select('*')
      .in('id', userProfile.clinic_ids);

    if (data) {
      setClinics(data);
      if (data.length > 0) {
        setSelectedClinic(data[0].id);
      }
    }
  }

  async function loadCurrentClockIn() {
    if (!user) return;
    
    const { data } = await supabase
      .from('timecards')
      .select('*')
      .eq('user_id', user.id)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      setCurrentClockIn(data);
    }
  }

  async function loadTimecards() {
    if (!user) return;
    
    const { data } = await supabase
      .from('timecards')
      .select('*')
      .eq('user_id', user.id)
      .order('clock_in', { ascending: false })
      .limit(50);

    if (data) {
      setTimecards(data);
    }
  }

  const handleClockIn = async () => {
    if (!selectedClinic || !user) return;

    const { data } = await supabase
      .from('timecards')
      .insert({
        user_id: user.id,
        clinic_id: selectedClinic,
        clock_in: new Date().toISOString(),
      })
      .select()
      .single();

    if (data) {
      setCurrentClockIn(data);
      loadTimecards();
    }
  };

  const handleClockOut = async () => {
    if (!currentClockIn) return;

    const clockOutTime = new Date();
    const clockInTime = new Date(currentClockIn.clock_in);
    const hours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

    await supabase
      .from('timecards')
      .update({
        clock_out: clockOutTime.toISOString(),
        hours: Math.round(hours * 100) / 100,
      })
      .eq('id', currentClockIn.id);

    setCurrentClockIn(null);
    loadTimecards();
  };

  const handleManualEntry = async () => {
    if (!selectedClinic || !formData.clock_in || !formData.clock_out || !user) return;

    const clockOutTime = new Date(formData.clock_out);
    const clockInTime = new Date(formData.clock_in);
    const hours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

    await supabase.from('timecards').insert({
      user_id: user.id,
      clinic_id: selectedClinic,
      clock_in: formData.clock_in,
      clock_out: formData.clock_out,
      hours: Math.round(hours * 100) / 100,
      notes: formData.notes || null,
    });

    setShowModal(false);
    setFormData({ clock_in: '', clock_out: '', notes: '' });
    loadTimecards();
  };

  const totalHours = timecards
    .filter((tc) => tc.hours)
    .reduce((sum, tc) => sum + (tc.hours || 0), 0);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Timecards</h1>
        <p className="text-gray-600">Track your work hours</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Clock In/Out</h2>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Clinic
            </label>
            <select
              value={selectedClinic}
              onChange={(e) => setSelectedClinic(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Select clinic</option>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </div>
          {currentClockIn ? (
            <div>
              <p className="text-sm text-gray-600 mb-4">
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
            className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <Plus className="w-5 h-5" />
            Manual Entry
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Summary</h2>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Hours:</span>
              <span className="font-semibold">{totalHours.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Total Entries:</span>
              <span className="font-semibold">{timecards.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Recent Timecards</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clock In</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clock Out</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {timecards.map((timecard) => (
              <tr key={timecard.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {new Date(timecard.clock_in).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {new Date(timecard.clock_in).toLocaleTimeString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {timecard.clock_out ? new Date(timecard.clock_out).toLocaleTimeString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {timecard.hours ? timecard.hours.toFixed(2) : '-'}
                </td>
                <td className="px-6 py-4 text-sm">{timecard.notes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Manual Time Entry</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Clock In</label>
                <input
                  type="datetime-local"
                  value={formData.clock_in}
                  onChange={(e) => setFormData({ ...formData, clock_in: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Clock Out</label>
                <input
                  type="datetime-local"
                  value={formData.clock_out}
                  onChange={(e) => setFormData({ ...formData, clock_out: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  rows={3}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-4 justify-end">
              <button
                onClick={() => {
                  setShowModal(false);
                  setFormData({ clock_in: '', clock_out: '', notes: '' });
                }}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
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
  );
}
