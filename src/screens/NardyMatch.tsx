import { useEffect, useState } from 'react'
import { ChevronLeft, Flag, RotateCcw } from 'lucide-react'
import { Button } from '../components/ui/Button'
import type { NardyConfig } from './NardySetup'
import {
  createNardy,
  legalFrom,
  destOf as _destOf,
  hasAnyMove,
  botStep,
  pass,
  move,
  ownerOf,
  countAt,
  HEAD,
  type NardyState,
  type NPlayer,
} from '../lib/nardy'
import type { TgUser } from '../lib/telegram'

interface NardyMatchProps {
  user: TgUser
  config: NardyConfig | null
  onExit: () => void
}

// screen layout: physical point index for each board slot
const TOP = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
const BOTTOM = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]

const FELT: React.CSSProperties = {
  backgroundColor: '#2f4560',
  backgroundImage: "url('/assets/durak/felt.jpg')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}

export function NardyMatch({ user: _user, config, onExit }: NardyMatchProps) {
  const [s, setS] = useState<NardyState>(() => createNardy())
  const [sel, setSel] = useState<number | null>(null)
  const [confirmResign, setConfirmResign] = useState(false)
  const bank = config && !config.free ? config.stake * 2 : 0

  // bot plays; auto-pass whoever is stuck
  useEffect(() => {
    if (s.result) return
    if (s.turn === 'b') {
      const id = setTimeout(() => setS((c) => (c.turn === 'b' ? botStep(c) : c)), 650)
      return () => clearTimeout(id)
    }
    if (!hasAnyMove(s)) {
      const id = setTimeout(() => setS((c) => (hasAnyMove(c) ? c : pass(c))), 1100)
      return () => clearTimeout(id)
    }
  }, [s])

  const yourTurn = s.turn === 'w' && !s.result

  // legal destinations for the selected checker → { destKey: die }
  const targets = new Map<number | 'off', number>()
  if (sel != null && yourTurn) {
    for (const d of legalFrom(s, sel)) {
      const de = _destOf(s, 'w', sel, d)
      if (de !== null && !targets.has(de)) targets.set(de, d)
    }
  }

  function tapPoint(phys: number) {
    if (!yourTurn) return
    if (sel != null && targets.has(phys)) {
      const die = targets.get(phys)!
      setS(move(s, sel, die))
      setSel(null)
      return
    }
    // select own checker with moves
    if (ownerOf(s.points[phys]) === 'w' && legalFrom(s, phys).length) {
      setSel(sel === phys ? null : phys)
    } else {
      setSel(null)
    }
  }

  function tapOff() {
    if (sel != null && targets.has('off')) {
      setS(move(s, sel, targets.get('off')!))
      setSel(null)
    }
  }

  const status = s.result
    ? ''
    : s.turn === 'b'
      ? 'Ход соперника…'
      : hasAnyMove(s)
        ? sel != null
          ? 'Куда пойти?'
          : 'Ваш ход — выберите шашку'
        : 'Нет ходов'

  return (
    <div
      className="relative -mx-4 -mb-6 -mt-[calc(1rem+env(safe-area-inset-top))] flex flex-col overflow-hidden"
      style={{ ...FELT, minHeight: 'var(--app-h, 100dvh)' }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 120px 30px rgba(0,0,0,0.3)' }}
      />

      <div className="relative z-10 flex flex-1 flex-col px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-[calc(0.6rem+env(safe-area-inset-top))]">
        {/* top bar */}
        <div className="relative flex h-9 items-center gap-2">
          <button
            onClick={onExit}
            aria-label="В меню"
            className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white/90 backdrop-blur active:scale-95"
          >
            <ChevronLeft size={19} />
          </button>
          <button
            onClick={() => setConfirmResign(true)}
            aria-label="Сдаться"
            className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white/90 backdrop-blur active:scale-95"
          >
            <Flag size={17} />
          </button>
          <span className="absolute left-1/2 -translate-x-1/2 text-sm font-bold tracking-wide text-white/90">
            Нарды · с ботом
          </span>
          <span className="ml-auto flex h-9 items-center gap-1.5 rounded-xl bg-white/95 px-3 text-sm font-extrabold text-ink shadow">
            {bank > 0 ? (
              <>
                <span className="text-[11px] font-semibold text-muted">банк</span>
                {bank}
              </>
            ) : (
              <span className="text-[12px] font-semibold text-muted">тренировка</span>
            )}
          </span>
        </div>

        {/* opponent bar */}
        <div className="mt-3 flex items-center justify-between text-white/90">
          <PlayerChip name="Бот" color="b" active={s.turn === 'b' && !s.result} off={s.off.b} />
          <Dice dice={s.dice} rolled={s.rolled} hidden={!!s.result} />
        </div>

        {/* board */}
        <div className="my-3 flex flex-1 items-center justify-center">
          <Board
            s={s}
            sel={sel}
            targets={targets}
            onTapPoint={tapPoint}
            onTapOff={tapOff}
          />
        </div>

        {/* your bar */}
        <div className="flex items-center justify-between">
          <PlayerChip
            name="Вы"
            color="w"
            active={yourTurn}
            off={s.off.w}
          />
          <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
            {status}
          </span>
        </div>
      </div>

      {confirmResign && !s.result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
            <p className="text-lg font-extrabold">Сдаться?</p>
            <p className="mt-1 text-sm text-muted">
              {bank > 0
                ? 'Засчитается поражение — ставка уйдёт сопернику.'
                : 'Засчитается поражение — потеряете рейтинг.'}
            </p>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmResign(false)}>
                Отмена
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setConfirmResign(false)
                  setS((c) => ({ ...c, result: 'b' }))
                }}
              >
                Сдаться
              </Button>
            </div>
          </div>
        </div>
      )}

      {s.result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
            <p className="text-2xl font-extrabold">
              {s.result === 'w' ? 'Вы выиграли!' : 'Вы проиграли'}
            </p>
            <p className="mt-1 text-sm text-muted">Игра с ботом · без рейтинга</p>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onExit}>
                В меню
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setSel(null)
                  setS(createNardy())
                }}
              >
                <RotateCcw size={16} /> Ещё раз
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlayerChip({
  name,
  color,
  active,
  off,
}: {
  name: string
  color: NPlayer
  active: boolean
  off: number
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full px-2.5 py-1 backdrop-blur ${
        active ? 'bg-[#38d66b]/25 ring-1 ring-[#38d66b]' : 'bg-black/30'
      }`}
    >
      <span
        className="h-4 w-4 rounded-full ring-1 ring-black/30"
        style={{ background: color === 'w' ? '#f2ead9' : '#26262a' }}
      />
      <span className="text-xs font-bold text-white">{name}</span>
      {off > 0 && <span className="text-[11px] font-semibold text-white/70">вышло {off}</span>}
    </div>
  )
}

function Dice({
  dice,
  rolled,
  hidden,
}: {
  dice: number[]
  rolled: [number, number] | null
  hidden: boolean
}) {
  if (hidden || !rolled) return <span />
  return (
    <div className="flex gap-2">
      {dice.map((d, i) => (
        <Die key={i} n={d} />
      ))}
    </div>
  )
}

// pip positions per die face (3x3 grid cells)
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}
function Die({ n }: { n: number }) {
  return (
    <div
      className="grid h-9 w-9 grid-cols-3 grid-rows-3 gap-0.5 rounded-lg p-1.5 shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
      style={{ background: 'linear-gradient(150deg,#fdfaf3,#e8dcc4)' }}
    >
      {Array.from({ length: 9 }).map((_, c) => (
        <span
          key={c}
          className={`place-self-center rounded-full ${
            PIPS[n]?.includes(c) ? 'h-1.5 w-1.5 bg-[#b03a2e]' : ''
          }`}
        />
      ))}
    </div>
  )
}

// ── board rendering ──
function Board({
  s,
  sel,
  targets,
  onTapPoint,
  onTapOff,
}: {
  s: NardyState
  sel: number | null
  targets: Map<number | 'off', number>
  onTapPoint: (p: number) => void
  onTapOff: () => void
}) {
  const offReady = targets.has('off')
  return (
    <div className="w-fit overflow-hidden rounded-2xl border-[6px] border-[#93a6b4] bg-[#cdd6dd] shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
      {/* top row */}
      <Row points={TOP} dir="down" s={s} sel={sel} targets={targets} onTap={onTapPoint} />
      {/* bar / off */}
      <div className="flex items-center justify-between bg-[#93a6b4] px-2 py-1">
        <button
          onClick={onTapOff}
          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
            offReady
              ? 'bg-[#38d66b] text-white'
              : 'bg-black/15 text-[#33424e]'
          }`}
        >
          вывод {s.off.w}/15
        </button>
        <span className="text-[11px] font-semibold text-[#33424e]/70">длинные нарды</span>
      </div>
      {/* bottom row */}
      <Row points={BOTTOM} dir="up" s={s} sel={sel} targets={targets} onTap={onTapPoint} />
    </div>
  )
}

function Row({
  points,
  dir,
  s,
  sel,
  targets,
  onTap,
}: {
  points: number[]
  dir: 'up' | 'down'
  s: NardyState
  sel: number | null
  targets: Map<number | 'off', number>
  onTap: (p: number) => void
}) {
  return (
    <div className="flex">
      {points.map((p, i) => (
        <div key={p} className={i === 6 ? 'ml-2' : ''}>
          <Point
            phys={p}
            dir={dir}
            dark={i % 2 === 0}
            value={s.points[p]}
            head={p === HEAD.w || p === HEAD.b}
            selected={sel === p}
            target={targets.has(p)}
            onTap={() => onTap(p)}
          />
        </div>
      ))}
    </div>
  )
}

function Point({
  phys: _phys,
  dir,
  dark,
  value,
  selected,
  target,
  onTap,
}: {
  phys: number
  dir: 'up' | 'down'
  dark: boolean
  value: number
  head: boolean
  selected: boolean
  target: boolean
  onTap: () => void
}) {
  const owner = ownerOf(value)
  const count = countAt(value)
  const tri =
    dir === 'down'
      ? 'polygon(0 0, 100% 0, 50% 100%)'
      : 'polygon(50% 0, 0 100%, 100% 100%)'
  const shown = Math.min(count, 5)
  const CH = 26 // checker size
  return (
    <button
      onClick={onTap}
      className="relative block"
      style={{ width: 30, height: 146 }}
    >
      {/* triangle */}
      <span
        className="absolute inset-0"
        style={{
          clipPath: tri,
          background: target
            ? 'rgba(56,214,107,0.6)'
            : dark
              ? '#a9bcca'
              : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 6px), #dcae86',
          opacity: target ? 1 : 0.95,
        }}
      />
      {selected && (
        <span
          className="absolute inset-0"
          style={{ clipPath: tri, background: 'rgba(217,154,43,0.5)' }}
        />
      )}
      {/* checkers */}
      {Array.from({ length: shown }).map((_, i) => {
        const pos = i * CH * 0.92
        const white = owner === 'w'
        return (
          <span
            key={i}
            className="absolute left-1/2 grid place-items-center rounded-full"
            style={{
              width: CH,
              height: CH,
              transform: 'translateX(-50%)',
              [dir === 'down' ? 'top' : 'bottom']: pos,
              background: white
                ? 'radial-gradient(circle at 35% 30%, #fbf7ee, #d8cdb8)'
                : 'radial-gradient(circle at 35% 30%, #7d97a8, #3f5a6b)',
              boxShadow: white
                ? 'inset 0 0 0 2px rgba(120,140,155,0.5), 0 1px 2px rgba(0,0,0,0.35)'
                : 'inset 0 0 0 2px rgba(255,255,255,0.35), 0 1px 2px rgba(0,0,0,0.4)',
            } as React.CSSProperties}
          >
            {/* center dot, like the reference */}
            <span
              className="rounded-full"
              style={{
                width: CH * 0.28,
                height: CH * 0.28,
                background: white ? '#8aa0af' : '#b03a2e',
              }}
            />
          </span>
        )
      })}
      {count > 5 && (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-1 text-[10px] font-bold text-white"
          style={{ [dir === 'down' ? 'top' : 'bottom']: 5 * CH * 0.92 - 6 } as React.CSSProperties}
        >
          {count}
        </span>
      )}
    </button>
  )
}
