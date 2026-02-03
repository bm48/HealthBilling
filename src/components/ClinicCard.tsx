import { Link } from 'react-router-dom'
import { Clinic, Provider } from '@/types'

export interface ClinicCardStats {
  patientCount: number
  providerCount: number
  todoCount: number
  currentMonthTotal: number | null
}

interface ClinicCardProps {
  clinic: Clinic
  providers: Provider[]
  stats: ClinicCardStats | null
  /** When true, link to clinic dashboard (/clinic/:id) instead of patients tab */
  dashboardHref?: boolean
}

function formatCurrency(value: number | null): string {
  if (value == null) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export default function ClinicCard({ clinic, providers, stats, dashboardHref }: ClinicCardProps) {
  const addressLine1 = clinic.address ?? ''
  const addressLine2 = clinic.address_line_2 ?? ''

  return (
    <Link
      to={dashboardHref ? `/clinic/${clinic.id}` : `/clinic/${clinic.id}/patients`}
      className="block rounded-lg border border-white/20 bg-white/5 p-4 text-white hover:border-primary-400/50 transition-colors cursor-pointer"
    >
      {/* Top: Clinic info – two columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mb-4">
        <div className="space-y-0.5">
          <div className="font-semibold text-yellow-500 text-lg italic">{clinic.name || 'Clinic Name'}</div>
          <div className="text-sm text-white/70">{addressLine1 || 'Address #1'}</div>
          {addressLine2 && <div className="text-sm text-white/70">{addressLine2}</div>}
        </div>
        <div className="space-y-0.5 text-right text-sm text-white/80">
          <div>{clinic.phone ?? 'Phone#'}</div>
          <div>{clinic.fax ?? 'Fax'}</div>
          <div>{clinic.npi ?? 'NPI'}</div>
          <div>{clinic.ein ?? 'EIN'}</div>
        </div>
      </div>

      {/* Middle: Providers */}
      <div className="border-t border-white/20 pt-3 pb-3 space-y-1">
        {providers.length > 0 ? (
          providers.slice(0, 10).map((provider, i) => (
            <div key={provider.id} className="text-sm text-white">
              #{i + 1} {provider.first_name} {provider.last_name}
              {provider.npi ? ` & NPI ${provider.npi}` : ''}
            </div>
          ))
        ) : (
          <div className="text-sm text-white/50">No providers</div>
        )}
        {providers.length > 10 && (
          <div className="text-xs text-white/50">+{providers.length - 10} more</div>
        )}
      </div>

      {/* Bottom: Pt #, Provider #, Total To Do #, Current month total $ */}
      <div className="border-t border-white/20 pt-3 space-y-1">
        <div className="flex flex-wrap gap-x-4 gap-y-0 text-md text-white/90">
          <span className='text-red-500'>Pt : {stats?.patientCount ?? '—'}</span>
          <span className='text-blue-500'>Provider : {stats?.providerCount ?? '—'}</span>
          <span className='text-green-500'>Total To Do : {stats?.todoCount ?? '—'}</span>
        </div>
        <div className="text-sm text-white/90">
          Current month total : {formatCurrency(stats?.currentMonthTotal ?? null)}
        </div>
      </div>
    </Link>
  )
}
