import { Gamepad2, ShoppingBag, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { t } from '../lib/i18n'

export type Tab = 'games' | 'store' | 'profile'

const items: { id: Tab; key: string; icon: LucideIcon }[] = [
  { id: 'games', key: 'nav.games', icon: Gamepad2 },
  { id: 'store', key: 'nav.store', icon: ShoppingBag },
  { id: 'profile', key: 'nav.profile', icon: User },
]

interface BottomNavProps {
  active: Tab
  onChange: (tab: Tab) => void
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="sticky bottom-0 z-20 border-t border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {items.map(({ id, key, icon: Icon }) => {
          const on = id === active
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 transition',
                on ? 'text-gold' : 'text-muted',
              )}
            >
              <Icon size={22} strokeWidth={on ? 2.4 : 2} />
              <span className={cn('text-[11px]', on && 'font-semibold')}>
                {t(key)}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
