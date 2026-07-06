import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface StatCardProps {
  icon: ReactNode
  value: ReactNode
  label: string
  /** Optional accent color for the value (e.g. success for winrate). */
  valueClassName?: string
}

export function StatCard({ icon, value, label, valueClassName }: StatCardProps) {
  return (
    <div className="flex-1 rounded-[var(--radius-card)] bg-surface border border-line/60 shadow-[var(--shadow-soft)] p-3.5">
      <div className="mb-2 text-gold">{icon}</div>
      <div className={cn('text-2xl font-extrabold leading-none', valueClassName)}>
        {value}
      </div>
      <div className="mt-1 text-xs font-medium text-muted">{label}</div>
    </div>
  )
}
