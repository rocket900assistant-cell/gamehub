import { Gem, Plus } from 'lucide-react'
import { openStarsBot } from '../../lib/telegram'

interface StarBalanceProps {
  amount: number
  /** Show the "+" top-up button. */
  plus?: boolean
  onTopUp?: () => void
}

/** GRAM balance pill (in-app currency, backed by TON). Tapping it opens the wallet. */
export function StarBalance({ amount, plus = true, onTopUp }: StarBalanceProps) {
  return (
    <button
      onClick={onTopUp ?? openStarsBot}
      aria-label="GRAM кошелёк"
      className="flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-3 pr-1.5 shadow-[var(--shadow-soft)] transition active:scale-[0.97]"
    >
      <Gem size={15} className="text-gold" />
      <span className="text-sm font-bold tabular-nums">{amount.toLocaleString('ru-RU')}</span>
      <span className="text-[11px] font-semibold text-muted">GRAM</span>
      {plus && (
        <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-white">
          <Plus size={15} strokeWidth={2.5} />
        </span>
      )}
    </button>
  )
}
