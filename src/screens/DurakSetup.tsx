import { useState } from 'react'
import { ArrowLeft, Bot, Gem, Lock, Minus, Plus, Swords, UserPlus } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/cn'

export const MIN_STAKE = 0.1

export interface DurakConfig {
  free: boolean
  stake: number
  players: number
  deck: number
  fast: boolean
  transfer: boolean
  throwAll: boolean
  draw: boolean
  privateGame: boolean
}

const stepFor = (v: number) =>
  v < 1 ? 0.1 : v < 10 ? 1 : v < 100 ? 10 : v < 1000 ? 100 : v < 10000 ? 1000 : 10000
const fmtNum = (n: number) => parseFloat(n.toFixed(1)).toString()
const PRESETS = [0.1, 1, 10, 100, 1000]

type ModeType =
  | 'podkidnoy'
  | 'perevodnoy'
  | 'sosedi'
  | 'vse'
  | 'klassika'
  | 'nichya'

function ModeIcon({ type }: { type: ModeType }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24">
      {type === 'podkidnoy' && (
        <>
          <rect x="15" y="6" width="6" height="12" rx="1.5" {...p} />
          <path d="M3 12h9" {...p} />
          <path d="M9 9l3 3-3 3" {...p} />
        </>
      )}
      {type === 'perevodnoy' && (
        <>
          <rect x="9" y="10" width="6" height="9" rx="1.5" {...p} />
          <path d="M6 9a6 6 0 0 1 11.5-2.3" {...p} />
          <path d="M18 3.6l-.3 3.4-3.3-.6" {...p} />
        </>
      )}
      {type === 'sosedi' && (
        <>
          <rect x="10" y="7" width="4" height="10" rx="1" {...p} />
          <path d="M2 12h5" {...p} />
          <path d="M5 9.5L7.5 12 5 14.5" {...p} />
          <path d="M22 12h-5" {...p} />
          <path d="M19 9.5L16.5 12 19 14.5" {...p} />
        </>
      )}
      {type === 'vse' && (
        <>
          <rect x="10" y="10" width="4" height="4" rx="0.8" {...p} />
          <path d="M12 2.5V6" {...p} />
          <path d="M10.5 4.5L12 6l1.5-1.5" {...p} />
          <path d="M12 21.5V18" {...p} />
          <path d="M10.5 19.5L12 18l1.5 1.5" {...p} />
          <path d="M2.5 12H6" {...p} />
          <path d="M4.5 10.5L6 12l-1.5 1.5" {...p} />
          <path d="M21.5 12H18" {...p} />
          <path d="M19.5 10.5L18 12l1.5 1.5" {...p} />
        </>
      )}
      {type === 'klassika' && (
        <>
          <rect x="6" y="4" width="12" height="16" rx="2" {...p} />
          <rect
            x="9.7"
            y="9.7"
            width="4.6"
            height="4.6"
            transform="rotate(45 12 12)"
            fill="currentColor"
          />
        </>
      )}
      {type === 'nichya' && (
        <>
          <circle cx="8.5" cy="12" r="2.3" fill="currentColor" />
          <circle cx="15.5" cy="12" r="2.3" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

function ModeTile({
  type,
  label,
  selected,
  onClick,
}: {
  type: ModeType
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-2xl border py-3 transition',
        selected ? 'border-gold bg-gold-light/40' : 'border-line bg-surface',
      )}
    >
      <span className={selected ? 'text-gold-dark' : 'text-muted'}>
        <ModeIcon type={type} />
      </span>
      <span
        className={cn(
          'text-[11px] font-semibold leading-tight',
          selected ? 'text-gold-dark' : 'text-muted',
        )}
      >
        {label}
      </span>
    </button>
  )
}

function Seg<T extends string | number | boolean>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-full border border-line bg-bg p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-full py-2 text-sm font-semibold transition',
            value === o.value
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-center text-sm font-bold">{title}</p>
      {children}
    </div>
  )
}

interface DurakSetupProps {
  onBack: () => void
  onCreate: (cfg: DurakConfig) => void
  onQuickMatch: () => void
  onInvite: () => void
}

export function DurakSetup({ onBack, onCreate, onQuickMatch, onInvite }: DurakSetupProps) {
  const [free, setFree] = useState(true)
  const [stakeText, setStakeText] = useState('0.1')
  const [players, setPlayers] = useState(2)
  const [deck, setDeck] = useState(36)
  const [fast, setFast] = useState(false)
  const [transfer, setTransfer] = useState(false)
  const [throwAll, setThrowAll] = useState(true)
  const [draw, setDraw] = useState(false)
  const [privateGame, setPrivateGame] = useState(false)

  const num = parseFloat(stakeText) || 0
  const setNum = (n: number) => setStakeText(fmtNum(Math.max(MIN_STAKE, n)))

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold">Создать игру</h1>
      </div>

      {/* free vs stake */}
      <Seg
        value={free}
        onChange={setFree}
        options={[
          { label: 'Бесплатно', value: true },
          { label: 'На GRAM', value: false },
        ]}
      />

      {/* stake stepper */}
      {!free && (
      <Card>
        <p className="text-sm font-bold text-muted">Ваша ставка</p>
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
              value={stakeText}
              inputMode="decimal"
              onChange={(e) =>
                setStakeText(e.target.value.replace(/[^\d.]/g, ''))
              }
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
      )}

      <Section title="Игроки">
        <Seg
          value={players}
          onChange={setPlayers}
          options={[2, 3, 4, 5].map((n) => ({ label: String(n), value: n }))}
        />
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Section title="Колода">
          <Seg
            value={deck}
            onChange={setDeck}
            options={[24, 36, 52].map((n) => ({ label: String(n), value: n }))}
          />
        </Section>
        <Section title="Скорость">
          <Seg
            value={fast}
            onChange={setFast}
            options={[
              { label: 'Обычная', value: false },
              { label: 'Быстрая', value: true },
            ]}
          />
        </Section>
      </div>

      <Section title="Режимы">
        {/* 3 columns = 3 pairs; top row = option A, bottom row = option B */}
        <div className="grid grid-cols-3 gap-2">
          <ModeTile type="podkidnoy" label="Подкидной" selected={!transfer} onClick={() => setTransfer(false)} />
          <ModeTile type="sosedi" label="Соседи" selected={!throwAll} onClick={() => setThrowAll(false)} />
          <ModeTile type="klassika" label="Классика" selected={!draw} onClick={() => setDraw(false)} />
          <ModeTile type="perevodnoy" label="Переводной" selected={transfer} onClick={() => setTransfer(true)} />
          <ModeTile type="vse" label="Все" selected={throwAll} onClick={() => setThrowAll(true)} />
          <ModeTile type="nichya" label="Ничья" selected={draw} onClick={() => setDraw(true)} />
        </div>
      </Section>

      <button
        onClick={() => setPrivateGame((v) => !v)}
        className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left"
      >
        <span
          className={cn(
            'grid h-6 w-6 place-items-center rounded-md border',
            privateGame ? 'border-gold bg-gold text-white' : 'border-line',
          )}
        >
          {privateGame && <Lock size={13} />}
        </span>
        <div className="flex-1">
          <p className="font-bold leading-tight">Приватная игра</p>
          <p className="text-xs text-muted">Только по ссылке-приглашению</p>
        </div>
      </button>

      <div className="space-y-3">
        <Button size="lg" className="w-full" onClick={onQuickMatch}>
          <Swords size={18} /> Быстрая игра (онлайн)
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={onInvite}>
          <UserPlus size={18} /> Играть с другом
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="w-full"
          onClick={() =>
            onCreate({
              free,
              stake: free ? 0 : Math.max(MIN_STAKE, num),
              players,
              deck,
              fast,
              transfer,
              throwAll,
              draw,
              privateGame,
            })
          }
        >
          <Bot size={18} /> Играть с ботом
        </Button>
      </div>
    </div>
  )
}
