import { Gem, Plus } from 'lucide-react'
import { openStarsBot } from '../../lib/telegram'

interface StarBalanceProps {
  amount: number
  /** Show the "+" top-up button. */
  plus?: boolean
  onTopUp?: () => void
}

/** GRAM balance pill (in-app currency, backed by TON). */
export function StarBalance({ amount, plus = true, onTopUp }: StarBalanceProps) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-surface border border-line pl-3 pr-1.5 py-1.5 shadow-[var(--shadow-soft)]">
      <Gem size={15} className="text-gold" />
      <span className="text-sm font-bold tabular-nums">
        {amount.toLocaleString('ru-RU')}
      </span>
      <span className="text-[11px] font-semibold text-muted">GRAM</span>
      {plus && (
        <button
          aria-label="Пополнить GRAM"
          onClick={onTopUp ?? openStarsBot}
          className="grid h-6 w-6 place-items-center rounded-full bg-gold text-white transition active:scale-95"
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
