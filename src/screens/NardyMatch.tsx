import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  Flag,
  MessageCircle,
  RotateCcw,
  Send,
  UserPlus,
  X,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import type { NardyConfig } from './NardySetup'
import {
  createNardy,
  legalFrom,
  destOf as _destOf,
  hasAnyMove,
  botStep,
  roll,
  pass,
  move,
  ownerOf,
  type NardyState,
  type NPlayer,
} from '../lib/nardy'
import { shareInvite, type TgUser } from '../lib/telegram'

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

/**
 * Every point (or 'off') the checker at `from` can reach this turn, including
 * moves that chain several dice through one checker (e.g. 3 then 2 = a "5"),
 * provided each intermediate landing is legal. Value = dice sequence to apply.
 */
function reachTargets(st: NardyState, from: number): Map<number | 'off', number[]> {
  const out = new Map<number | 'off', number[]>()
  const turn = st.turn
  const dfs = (state: NardyState, pos: number, seq: number[]) => {
    if (state.result || state.turn !== turn) return
    for (const d of legalFrom(state, pos)) {
      const de = _destOf(state, turn, pos, d)
      if (de === null) continue
      const seq2 = [...seq, d]
      const prev = out.get(de)
      if (!prev || prev.length > seq2.length) out.set(de, seq2)
      if (de !== 'off') dfs(move(state, pos, d), de, seq2)
    }
  }
  dfs(st, from, [])
  return out
}

export function NardyMatch({ user, config, onExit }: NardyMatchProps) {
  const [s, setS] = useState<NardyState>(() => createNardy())
  const [sel, setSel] = useState<number | null>(null)
  const [confirmResign, setConfirmResign] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<{ mine: boolean; text: string }[]>([])
  const bank = config && !config.free ? config.stake * 2 : 0

  function sendChat() {
    const t = chatInput.trim()
    if (!t) return
    setMessages((prev) => [...prev, { mine: true, text: t }])
    setChatInput('')
  }
  const invite = () =>
    shareInvite(String(user.id || user.username || 'guest'))

  // bot plays (rolls, then moves); auto-pass whoever is stuck after a roll
  useEffect(() => {
    if (s.result) return
    if (s.turn === 'b') {
      if (s.awaitingRoll) {
        const id = setTimeout(
          () => setS((c) => (c.turn === 'b' && c.awaitingRoll ? roll(c) : c)),
          500,
        )
        return () => clearTimeout(id)
      }
      const id = setTimeout(
        () => setS((c) => (c.turn === 'b' && !c.awaitingRoll ? botStep(c) : c)),
        650,
      )
      return () => clearTimeout(id)
    }
    if (!s.awaitingRoll && !hasAnyMove(s)) {
      const id = setTimeout(() => setS((c) => (hasAnyMove(c) ? c : pass(c))), 1100)
      return () => clearTimeout(id)
    }
  }, [s])

  const yourTurn = s.turn === 'w' && !s.result

  // All destinations for the selected checker, including COMBINED moves that
  // use several dice on one checker (e.g. 3+2 = a single "5" landing), as long
  // as each intermediate step is legal. Value = the dice sequence to apply.
  const targets =
    sel != null && yourTurn ? reachTargets(s, sel) : new Map<number | 'off', number[]>()

  function applySeq(from: number, seq: number[]) {
    let st = s
    let pos = from
    for (const d of seq) {
      const de = _destOf(st, 'w', pos, d)
      st = move(st, pos, d)
      if (de === 'off' || de === null) break
      pos = de
    }
    setS(st)
    setSel(null)
  }

  function tapPoint(phys: number) {
    if (!yourTurn) return
    if (sel != null && targets.has(phys)) {
      applySeq(sel, targets.get(phys)!)
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
      applySeq(sel, targets.get('off')!)
    }
  }

  const status = s.result
    ? ''
    : s.turn === 'b'
      ? s.awaitingRoll
        ? 'Соперник бросает…'
        : 'Ход соперника…'
      : s.awaitingRoll
        ? 'Ваш ход — бросьте кубики'
        : hasAnyMove(s)
          ? sel != null
            ? 'Куда пойти?'
            : 'Выберите шашку'
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
        <div className="mt-3 flex min-h-[44px] items-center justify-between text-white/90">
          <PlayerChip name="Бот" color="b" active={s.turn === 'b' && !s.result} off={s.off.b} />
          <DiceRow s={s} />
        </div>

        {/* board */}
        <div className="-mx-3 my-2 flex flex-1 items-center justify-center px-1.5">
          <Board
            s={s}
            targets={targets}
            onTapPoint={tapPoint}
            onTapOff={tapOff}
          />
        </div>

        {/* roll button under the board */}
        {yourTurn && s.awaitingRoll && (
          <button
            onClick={() => setS(roll(s))}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-base font-extrabold text-[#4a2f00] shadow-[0_6px_18px_rgba(0,0,0,0.45)] active:scale-[0.98]"
            style={{ background: 'linear-gradient(180deg,#f6dc9f,#d9b25e)' }}
          >
            <span className="text-xl leading-none">🎲</span> Бросить кубики
          </button>
        )}

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

        {/* bottom toolbar */}
        <div className="mt-2 flex items-stretch gap-1.5 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-soft)]">
          <ToolBtn
            icon={MessageCircle}
            label="Чат"
            badge={messages.length}
            onClick={() => setChatOpen(true)}
          />
          <ToolBtn icon={UserPlus} label="Пригласить" onClick={invite} />
        </div>
      </div>

      {/* chat bottom sheet */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setChatOpen(false)}
        >
          <div
            className="mx-auto flex h-[58%] w-full max-w-md flex-col rounded-t-[24px] bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line p-4">
              <p className="font-bold">Чат</p>
              <button onClick={() => setChatOpen(false)} aria-label="Закрыть">
                <X size={20} className="text-muted" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Сообщений пока нет
                </p>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <span
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        m.mine
                          ? 'bg-gradient-to-b from-gold to-gold-dark text-white'
                          : 'bg-bg text-ink'
                      }`}
                    >
                      {m.text}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-line p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="Сообщение…"
                className="h-11 flex-1 rounded-[var(--radius-input)] border border-line bg-bg px-3 text-[15px] outline-none placeholder:text-muted"
              />
              <button
                onClick={sendChat}
                aria-label="Отправить"
                className="grid h-11 w-11 place-items-center rounded-[var(--radius-input)] bg-gradient-to-b from-gold to-gold-dark text-white"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

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
      className="grid h-11 w-11 grid-cols-3 grid-rows-3 gap-[3px] rounded-[11px] p-2"
      style={{
        background: 'linear-gradient(145deg,#fbeecb 0%,#efd9a4 45%,#e3c689 100%)',
        boxShadow:
          'inset 0 1.5px 2px rgba(255,255,255,0.85), inset 0 -2.5px 4px rgba(150,110,40,0.55), 0 3px 7px rgba(0,0,0,0.45)',
      }}
    >
      {Array.from({ length: 9 }).map((_, c) => (
        <span key={c} className="grid place-items-center">
          {PIPS[n]?.includes(c) && (
            <span
              className="block h-[7px] w-[7px] rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 35% 30%, #a52a3d 0%, #7a1626 55%, #4c0d18 100%)',
                boxShadow:
                  'inset 0 1px 1px rgba(255,255,255,0.45), inset 0 -1px 2px rgba(0,0,0,0.6), 0 0 1px rgba(0,0,0,0.4)',
              }}
            />
          )}
        </span>
      ))}
    </div>
  )
}

// ── board rendering (image board + image checkers positioned by %) ──
// x-centre (% of board width) of the 12 point columns (6 left, 6 right)
const XCOLS = [9.4, 15.6, 21.8, 28.0, 34.2, 40.4, 54.1, 60.0, 65.9, 71.8, 77.7, 83.6]
// physical point -> screen slot
const POS: Record<number, { x: number; top: boolean }> = {}
TOP.forEach((p, i) => {
  POS[p] = { x: XCOLS[i], top: true }
})
BOTTOM.forEach((p, i) => {
  POS[p] = { x: XCOLS[i], top: false }
})
const CD = 7.2 // checker diameter, % of board width
const STEP = 7.0 // vertical gap between stacked checkers, % of board height
const STACK_SPAN = 30 // max height a stack may occupy (compresses when many)
const TOP_Y0 = 11.5 // first checker centre from the top (triangle base ≈ 6%)
const BOT_Y0 = 88.5 // first checker centre from the bottom (base ≈ 94%)
const CHECK = {
  w: '/assets/nardy/checker-light.png',
  b: '/assets/nardy/checker-dark.png',
}

function Board({
  s,
  targets,
  onTapPoint,
  onTapOff,
}: {
  s: NardyState
  targets: Map<number | 'off', number[]>
  onTapPoint: (p: number) => void
  onTapOff: () => void
}) {
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

      {/* checkers on points — all shown, stack compresses to fit */}
      {Array.from({ length: 24 }).map((_, p) => {
        const v = s.points[p]
        if (!v) return null
        const { x, top } = POS[p]
        const white = v > 0
        const count = Math.abs(v)
        // Fixed step (compressed only for tall stacks). Constant per checker so
        // a stack always shrinks from its END (tip), never re-spaces on removal.
        const step = count > 5 ? STACK_SPAN / 14 : STEP
        return (
          <div key={p}>
            {Array.from({ length: count }).map((_, k) => (
              <img
                key={k}
                src={white ? CHECK.w : CHECK.b}
                alt=""
                draggable={false}
                className="absolute"
                style={{
                  left: `${x}%`,
                  top: `${top ? TOP_Y0 + k * step : BOT_Y0 - k * step}%`,
                  width: `${CD}%`,
                  transform: 'translate(-50%,-50%)',
                  zIndex: k,
                }}
              />
            ))}
          </div>
        )
      })}

      {/* white borne-off checkers in the tray (all shown, compressed to fit) */}
      {s.off.w > 0 &&
        Array.from({ length: s.off.w }).map((_, k) => {
          const trayStep = s.off.w > 1 ? Math.min(5.5, 72 / (s.off.w - 1)) : 0
          return (
            <img
              key={`ow${k}`}
              src={CHECK.w}
              alt=""
              draggable={false}
              className="absolute"
              style={{
                left: '92.7%',
                top: `${14 + k * trayStep}%`,
                width: `${CD}%`,
                transform: 'translate(-50%,-50%)',
                zIndex: k,
              }}
            />
          )
        })}

      {/* move targets — a clean ghost checker where the move would land */}
      {Array.from({ length: 24 }).map((_, p) => {
        if (!targets.has(p)) return null
        const { x, top } = POS[p]
        const cnt = Math.abs(s.points[p])
        const landStep = cnt + 1 > 5 ? STACK_SPAN / 14 : STEP
        const landY = top ? TOP_Y0 + cnt * landStep : BOT_Y0 - cnt * landStep
        return (
          <span
            key={`ind${p}`}
            className="pointer-events-none absolute rounded-full border-2 border-[#38d66b] bg-[#38d66b]/25"
            style={{
              left: `${x}%`,
              top: `${landY}%`,
              width: `${CD}%`,
              aspectRatio: '1',
              transform: 'translate(-50%,-50%)',
            }}
          />
        )
      })}

      {/* tap hotspots per point (transparent) */}
      {Array.from({ length: 24 }).map((_, p) => {
        const { x, top } = POS[p]
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
          />
        )
      })}

      {/* bearing-off tray hotspot */}
      <button
        onClick={onTapOff}
        className="absolute"
        style={{ right: 0, top: '5%', width: '12%', height: '90%' }}
      >
        {targets.has('off') && (
          <span
            className="absolute inset-x-2 inset-y-3 rounded-xl border-2 border-[#38d66b] bg-[#38d66b]/25 animate-pulse"
            style={{ boxShadow: '0 0 12px 2px rgba(56,214,107,0.45)' }}
          />
        )}
      </button>

    </div>
  )
}

/** The rolled pair (used dice dim; doubles show a ×N remaining counter). */
function DiceRow({ s }: { s: NardyState }) {
  if (!s.rolled || s.result || s.dice.length === 0) return null
  const isDouble = s.rolled[0] === s.rolled[1]
  return (
    <div
      key={`${s.rolled[0]}-${s.rolled[1]}-${s.turn}`}
      className="flex items-center gap-2 drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)]"
      style={{ animation: 'nardyDiceIn 300ms ease-out' }}
    >
      <style>{`@keyframes nardyDiceIn{0%{transform:translateY(-45%) rotate(-25deg) scale(0.6);opacity:0}100%{transform:none;opacity:1}}`}</style>
      {s.rolled.map((d, i) => {
        const used = !isDouble && !s.dice.includes(d)
        return (
          <div
            key={i}
            style={{ opacity: used ? 0.35 : 1, filter: used ? 'grayscale(1)' : 'none' }}
          >
            <Die n={d} />
          </div>
        )
      })}
      {isDouble && (
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-black/40 px-1.5 text-xs font-extrabold text-white">
          ×{s.dice.length}
        </span>
      )}
    </div>
  )
}

function ToolBtn({
  icon: Icon,
  label,
  onClick,
  badge,
}: {
  icon: typeof MessageCircle
  label: string
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-muted transition active:bg-bg"
    >
      {badge ? (
        <span className="absolute right-6 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
          {badge}
        </span>
      ) : null}
      <Icon size={20} />
      <span className="text-[10px]">{label}</span>
    </button>
  )
}
