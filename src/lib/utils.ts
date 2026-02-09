import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '$0.00'
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(numAmount)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(numAmount)
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return ''
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format date for table cells as MM-DD-YY (e.g. 01-05-25). Returns '' for empty/invalid. */
export function toDisplayDate(value: string | null | undefined): string {
  if (value == null || value === '' || value === 'null') return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${mm}-${dd}-${yy}`
}

/** Use for table cell display: never show the literal "null" or null/undefined. */
export function toDisplayValue(value: string | number | null | undefined): string {
  if (value == null || value === '' || value === 'null') return ''
  return String(value)
}

/** Use when storing optional string fields: treat '' and string 'null' as null. */
export function toStoredString(value: string | null | undefined): string | null {
  if (value === '' || value === 'null') return null
  return value ?? null
}
