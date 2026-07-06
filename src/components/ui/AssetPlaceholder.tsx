import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

interface AssetPlaceholderProps {
  icon: LucideIcon
  /** Tailwind gradient classes for the placeholder tint. */
  gradient?: string
  className?: string
  iconSize?: number
}

/**
 * Stand-in for the real 3D illustrations from the design brief
 * (trophy, chess hero, durak cards, avatars, VIP shield, …).
 * Swap for <img src="/assets/..png"> once the transparent PNGs land.
 */
export function AssetPlaceholder({
  icon: Icon,
  gradient = 'from-gold-light/60 to-gold/30',
  className,
  iconSize = 40,
}: AssetPlaceholderProps) {
  return (
    <div
      className={cn(
        'grid place-items-center rounded-2xl bg-gradient-to-br text-gold/80',
        gradient,
        className,
      )}
    >
      <Icon size={iconSize} strokeWidth={1.5} />
    </div>
  )
}
