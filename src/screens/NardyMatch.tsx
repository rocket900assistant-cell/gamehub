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

// ── board rendering (image board + image checkers positioned by %) ──
// x-centre (% of board width) of the 12 point columns (6 left, 6 right)
const XCOLS = [8.7, 15.0, 21.3, 27.6, 33.9, 40.2, 53.9, 59.7, 65.4, 71.2, 77.0, 82.7]
// physical point -> screen slot
const POS: Record<number, { x: number; top: boolean }> = {}
TOP.forEach((p, i) => {
  POS[p] = { x: XCOLS[i], top: true }
})
BOTTOM.forEach((p, i) => {
  POS[p] = { x: XCOLS[i], top: false }
})
const CD = 6.7 // checker diameter, % of board width
const STEP = 7.4 // vertical gap between stacked checkers, % of board height
const TOP_Y0 = 13
const BOT_Y0 = 87
const CHECK = {
  w: '/assets/nardy/checker-light.png',
  b: '/assets/nardy/checker-dark.png',
}

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
  const stackY = (top: boolean, k: number) =>
    top ? TOP_Y0 + k * STEP : BOT_Y0 - k * STEP
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl shadow-[0_10px_28px_rgba(0,0,0,0.5)]"
      style={{ aspectRatio: '1448 / 1086' }}
    >
      <img
        src="/assets/nardy/board.jpg"
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full"
      />

      {/* checkers on points */}
      {Array.from({ length: 24 }).map((_, p) => {
        const v = s.points[p]
        if (!v) return null
        const { x, top } = POS[p]
        const white = v > 0
        const count = Math.abs(v)
        const shown = Math.min(count, 5)
        return (
          <div key={p}>
            {Array.from({ length: shown }).map((_, k) => (
              <img
                key={k}
                src={white ? CHECK.w : CHECK.b}
                alt=""
                draggable={false}
                className="absolute"
                style={{
                  left: `${x}%`,
                  top: `${stackY(top, k)}%`,
                  width: `${CD}%`,
                  transform: 'translate(-50%,-50%)',
                  zIndex: k,
                }}
              />
            ))}
            {count > 5 && (
              <span
                className="absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/70 text-[10px] font-bold text-white"
                style={{
                  left: `${x}%`,
                  top: `${stackY(top, shown - 1)}%`,
                  width: 16,
                  height: 16,
                }}
              >
                {count}
              </span>
            )}
          </div>
        )
      })}

      {/* white borne-off checkers in the tray */}
      {s.off.w > 0 &&
        Array.from({ length: Math.min(s.off.w, 6) }).map((_, k) => (
          <img
            key={`ow${k}`}
            src={CHECK.w}
            alt=""
            draggable={false}
            className="absolute"
            style={{
              left: '92.7%',
              top: `${14 + k * 5.5}%`,
              width: `${CD}%`,
              transform: 'translate(-50%,-50%)',
            }}
          />
        ))}

      {/* tap hotspots per point */}
      {Array.from({ length: 24 }).map((_, p) => {
        const { x, top } = POS[p]
        const isTarget = targets.has(p)
        return (
          <button
            key={`h${p}`}
            onClick={() => onTapPoint(p)}
            className="absolute"
            style={{
              left: `${x - 3.1}%`,
              width: '6.2%',
              top: top ? '6%' : '52%',
              height: '42%',
            }}
          >
            {sel === p && (
              <span className="absolute inset-x-1 inset-y-2 rounded-lg bg-[#d99a2b]/35 ring-2 ring-[#d99a2b]" />
            )}
            {isTarget && (
              <span
                className="absolute left-1/2 h-[26%] w-[80%] -translate-x-1/2 rounded-full bg-[#38d66b]/55 ring-2 ring-[#38d66b]"
                style={{ [top ? 'top' : 'bottom']: '4%' }}
              />
            )}
          </button>
        )
      })}

      {/* bearing-off tray hotspot */}
      <button
        onClick={onTapOff}
        className="absolute"
        style={{ right: 0, top: '5%', width: '12%', height: '90%' }}
      >
        {targets.has('off') && (
          <span className="absolute inset-2 rounded-lg bg-[#38d66b]/45 ring-2 ring-[#38d66b]" />
        )}
      </button>
    </div>
  )
}
