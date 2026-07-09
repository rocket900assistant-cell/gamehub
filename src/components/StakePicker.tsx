import { Gem, Minus, Plus } from 'lucide-react'
import { t } from '../lib/i18n'
import { Card } from './ui/Card'
import { cn } from '../lib/cn'

export const MIN_STAKE = 0.1

const stepFor = (v: number) =>
  v < 1 ? 0.1 : v < 10 ? 1 : v < 100 ? 10 : v < 1000 ? 100 : v < 10000 ? 1000 : 10000
const fmtNum = (n: number) => parseFloat(n.toFixed(1)).toString()
const PRESETS = [0.1, 1, 10, 100, 1000]

/** Segmented "Бесплатно / На GRAM" toggle. */
export function GameTypeToggle({
  free,
  onChange,
}: {
  free: boolean
  onChange: (free: boolean) => void
}) {
  const options = [
    { label: t('setup.free'), value: true },
    { label: t('setup.onGram'), value: false },
  ]
  return (
    <div className="flex gap-1 rounded-full border border-line bg-bg p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-full py-2 text-sm font-semibold transition',
            free === o.value
              ? 'bg-gradient-to-b from-gold to-gold-dark text-white shadow-[var(--shadow-gold)]'
              : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** +/- stepper with manual input and presets. Controlled via text value. */
export function StakeStepper({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const num = parseFloat(value) || 0
  const setNum = (n: number) => onChange(fmtNum(Math.max(MIN_STAKE, n)))
  return (
    <Card>
      <p className="text-sm font-bold text-muted">{t('setup.yourStake')}</p>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => setNum(num - stepFor(num - 0.001))}
          aria-label="Меньше"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink active:scale-95"
        >
          <Minus size={18} />
        </button>
        <div className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-input)] border border-line bg-bg px-2">
          <input
            value={value}
            inputMode="decimal"
            onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => setNum(num)}
            className="w-full bg-transparent text-center text-lg font-extrabold outline-none"
          />
          <Gem size={18} className="shrink-0 text-gold" />
        </div>
        <button
          onClick={() => setNum(num + stepFor(num))}
          aria-label="Больше"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-b from-gold to-gold-dark text-white active:scale-95"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        {PRESETS.map((v) => (
          <button
            key={v}
            onClick={() => setNum(v)}
            className={cn(
              'flex-1 rounded-full border py-1.5 text-xs font-semibold transition',
              num === v
                ? 'border-gold bg-gold-light/50 text-gold-dark'
                : 'border-line text-muted',
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </Card>
  )
}
