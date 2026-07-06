import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Removes the default padding for edge-to-edge media cards. */
  flush?: boolean
}

export function Card({ children, flush, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-soft)] border border-line/60 overflow-hidden',
        !flush && 'p-4',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
