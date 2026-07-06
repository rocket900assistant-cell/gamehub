import { cn } from '../../lib/cn'

interface AvatarProps {
  name: string
  src?: string
  size?: number
  /** Golden ring for VIP players. */
  vip?: boolean
  className?: string
}

export function Avatar({ name, src, size = 44, vip, className }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div
      className={cn(
        'relative shrink-0 rounded-full',
        vip && 'p-[2px] bg-gradient-to-br from-gold to-gold-light',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <div className="h-full w-full overflow-hidden rounded-full bg-gold-light/40 flex items-center justify-center">
        {src ? (
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span
            className="font-bold text-ink/70"
            style={{ fontSize: size * 0.36 }}
          >
            {initials}
          </span>
        )}
      </div>
    </div>
  )
}
