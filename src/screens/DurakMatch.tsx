import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Flag, Gem, MessageCircle, RotateCcw, Send, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PlayingCard } from '../components/PlayingCard'
import { Confetti } from '../components/Confetti'
import { equippedDurakFeltSrc, isVip } from '../lib/skins'
import { t } from '../lib/i18n'
import type { DurakConfig } from './DurakSetup'
import {
  createGame,
  canPass,
  canTake,
  canFinishTake,
  canTransfer,
  legalTransfers,
  playAttack,
  playDefend,
  playTransfer,
  beginTake,
  finishTake,
  endBout,
  resign,
  botStep,
  cardId,
  type Card,
  type DurakState,
  type Player,
} from '../lib/durak'
import type { TgUser } from '../lib/telegram'
import { displayName } from '../lib/telegram'
import { getSocket } from '../lib/socket'
import { player } from '../data/mock'

export interface OnlineDurak {
  roomId: string
  opponentName: string
  opponentElo: number
  opponentVip?: boolean
  opponentPhoto?: string | null
  myElo: number
  initial: DurakState // the viewer's own view (viewer is always 'you')
  deadline: number
}

interface DurakMatchProps {
  user: TgUser
  config: DurakConfig | null
  resume?: boolean
  online?: OnlineDurak | null
  myName?: string
  onExit: () => void
}

// ── crash-safe save (survives closing the app) ──
const SAVE_KEY = 'gh_durak_save'
type DurakSave = { s: DurakState; config: DurakConfig | null; savedAt: number }

function readDurakSave(): DurakSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const sv = JSON.parse(raw) as DurakSave
    if (sv?.s && !sv.s.result) return sv
  } catch {
    /* ignore */
  }
  return null
}
export const hasDurakSave = () => !!readDurakSave()
export const clearDurakSave = () => {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    /* ignore */
  }
}

// Table felt base — the image comes from the equipped skin (see `felt` below).
const FELT_BASE: React.CSSProperties = {
  backgroundColor: '#2f4560',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}

export function DurakMatch({ user, config, resume, online, myName, onExit }: DurakMatchProps) {
  const isOnline = !!online
  // Equipped table felt (chosen in the shop, read once per match).
  const felt = useMemo(
    () => ({ ...FELT_BASE, backgroundImage: `url('${equippedDurakFeltSrc()}')` }),
    [],
  )
  // Elo change from the server (online rated games).
  const [eloDelta, setEloDelta] = useState<number | null>(null)
  const vipMe = isVip()
  // resumed game restores its state + original config from storage
  const saved = useRef(!isOnline && resume ? readDurakSave() : null).current
  const effConfig = config ?? saved?.config ?? null
  const deckSize = effConfig?.deck ?? 36
  const transfer = effConfig?.transfer ?? false
  const fast = effConfig?.fast ?? false
  const moveMs = isOnline ? 60000 : (fast ? 30 : 60) * 1000
  const bank = effConfig && !effConfig.free ? effConfig.stake * effConfig.players : 0

  const [s, setS] = useState<DurakState>(() => {
    if (online) return online.initial
    if (saved?.s) {
      // time kept running while the app was closed → auto-lose if it ran out
      const elapsed = Date.now() - (saved.savedAt ?? Date.now())
      if (!saved.s.result && elapsed > moveMs) return resign(saved.s, saved.s.turn)
      return saved.s
    }
    return createGame({ deck: deckSize, transfer })
  })

  // persist the game so a closed/reopened app can continue it
  useEffect(() => {
    if (!saved) clearDurakSave() // fresh game → drop any stale save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [drag, setDrag] = useState<{ card: Card; x: number; y: number } | null>(
    null,
  )
  const [selIdx, setSelIdx] = useState(-1) // card lifted while browsing the hand
  const [confirmResign, setConfirmResign] = useState(false)

  // ── chat ──
  const [chatOpen, setChatOpen] = useState(false)
  const chatOpenRef = useRef(false)
  useEffect(() => {
    chatOpenRef.current = chatOpen
  }, [chatOpen])
  const [messages, setMessages] = useState<{ mine: boolean; text: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [unread, setUnread] = useState(0)
  function openChat() {
    setChatOpen(true)
    setUnread(0)
  }
  function sendChat() {
    const t = chatInput.trim()
    if (!t) return
    setMessages((m) => [...m, { mine: true, text: t }])
    if (online) getSocket().emit('chat', { roomId: online.roomId, text: t })
    setChatInput('')
  }

  // ── ready gate (confirm before the deal; miss it → leave the table) ──
  const READY_MS = 20000
  const [started, setStarted] = useState(isOnline || !!saved) // online/resumed skip the gate
  const [readyDeadline] = useState(() => Date.now() + READY_MS)

  // save/clear the game as it progresses (local only)
  useEffect(() => {
    if (isOnline || !started) return
    if (s.result) clearDurakSave()
    else {
      try {
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({ s, config: effConfig, savedAt: Date.now() }),
        )
      } catch {
        /* ignore */
      }
    }
  }, [s, started, effConfig])

  // ── move timer ── (online: server-driven via durak:state deadline)
  const [deadline, setDeadline] = useState(() =>
    online ? online.deadline : Date.now() + moveMs,
  )
  const [now, setNow] = useState(Date.now())
  const timedOut = useRef(false)
  useEffect(() => {
    if (isOnline) return
    timedOut.current = false
    setDeadline(Date.now() + moveMs)
  }, [s.turn, s.taking, s.table.length, s.result, moveMs, started, isOnline])
  useEffect(() => {
    if (s.result) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [s.result])

  const readyRemaining = Math.max(0, readyDeadline - now)
  useEffect(() => {
    if (started || readyRemaining > 0) return
    onExit() // didn't press «Готов» in time → left the seat
  }, [readyRemaining, started])

  const remaining = Math.max(0, deadline - now)
  useEffect(() => {
    if (isOnline || !started || s.result || remaining > 0 || timedOut.current) return
    timedOut.current = true
    setS((cur) => (cur.result ? cur : resign(cur, cur.turn)))
  }, [remaining, s.result, started, isOnline])

  // Bot (opp) auto-plays — local only.
  useEffect(() => {
    if (isOnline || !started || s.result || s.turn !== 'opp') return
    const id = setTimeout(() => {
      const next = botStep(s)
      if (next !== s) setS(next)
    }, 750)
    return () => clearTimeout(id)
  }, [s, started, isOnline])

  // Online: authoritative state + game over + chat from the server.
  useEffect(() => {
    if (!isOnline) return
    const sock = getSocket()
    const onState = (p: { durak: DurakState; deadline: number }) => {
      setS(p.durak)
      setDeadline(p.deadline)
    }
    const onOver = (g: { youWon: boolean | null; eloDelta?: number }) => {
      // resign / timeout / opponent-left end via game:over (no durak:state)
      if (typeof g.eloDelta === 'number') setEloDelta(g.eloDelta)
      setS((cur) =>
        cur.result
          ? cur
          : {
              ...cur,
              result: {
                loser: g.youWon === true ? 'opp' : g.youWon === false ? 'you' : null,
              },
            },
      )
    }
    const onChat = (m: { text: string }) => {
      setMessages((prev) => [...prev, { mine: false, text: m.text }])
      if (!chatOpenRef.current) setUnread((u) => u + 1)
    }
    sock.on('durak:state', onState)
    sock.on('game:over', onOver)
    sock.on('chat:msg', onChat)
    return () => {
      sock.off('durak:state', onState)
      sock.off('game:over', onOver)
      sock.off('chat:msg', onChat)
    }
  }, [isOnline])

  const youAttacker = s.attacker === 'you'
  const yourTurn = started && s.turn === 'you' && !s.result

  // Drop a card at a screen point — the engine validates; illegal = snap back.
  function playAt(card: Card, x: number, y: number) {
    const el = document.elementFromPoint(x, y)
    if (youAttacker) {
      // a light flick up plays it — no need to drag all the way to the table
      doAttack(card)
      return
    }
    // defending: use the pair the card was dropped on, else the first undefended one
    const canT = legalTransfers(s).some((c) => cardId(c) === cardId(card))
    const pairEl = el?.closest<HTMLElement>('[data-pair]')
    const pair = pairEl ? Number(pairEl.dataset.pair) : s.table.findIndex((p) => !p.defend)
    if (pair >= 0 && playDefend(s, card, pair) !== s) doDefend(card, pair)
    else if (canT) doTransfer(card)
  }

  const apply = (next: DurakState) => {
    if (next !== s) setS(next)
  }
  // Online sends the ACTION to the server (authoritative); local applies the engine.
  const emitD = (event: string, payload: object = {}) =>
    getSocket().emit(event, { roomId: online!.roomId, ...payload })
  const doAttack = (card: Card) =>
    isOnline ? emitD('durak:attack', { card }) : apply(playAttack(s, card))
  const doDefend = (card: Card, pair: number) =>
    isOnline ? emitD('durak:defend', { card, pair }) : apply(playDefend(s, card, pair))
  const doTransfer = (card: Card) =>
    isOnline ? emitD('durak:transfer', { card }) : apply(playTransfer(s, card))
  const doTake = () => (isOnline ? emitD('durak:take') : apply(beginTake(s)))
  const doDone = () => {
    if (isOnline) return emitD('durak:done')
    if (s.taking) apply(finishTake(s))
    else if (canPass(s)) apply(endBout(s))
  }

  // Which hand card sits under a screen point (respects fan overlap order).
  const handIdxAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-hand-idx]')
    return el ? Number(el.dataset.handIdx) : -1
  }

  // Press a card → it lifts; slide sideways to browse; pull up to carry & drop.
  function beginHand(e: React.PointerEvent) {
    if (!yourTurn) return
    e.preventDefault()
    const startY = e.clientY
    let sel = handIdxAt(e.clientX, e.clientY)
    if (sel < 0) return
    let carrying = false
    setSelIdx(sel)
    const move = (ev: PointerEvent) => {
      if (carrying) {
        setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d))
        return
      }
      if (startY - ev.clientY > 22) {
        // a small upward nudge → pick the selected card up (light gesture)
        carrying = true
        const card = s.hands.you[sel]
        if (card) setDrag({ card, x: ev.clientX, y: ev.clientY })
      } else {
        // sample along the original row so the lift doesn't cause flicker
        const i = handIdxAt(ev.clientX, startY)
        if (i >= 0 && i !== sel) {
          sel = i
          setSelIdx(i)
        }
      }
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const card = s.hands.you[sel]
      setDrag(null)
      setSelIdx(-1)
      if (carrying && card) playAt(card, ev.clientX, ev.clientY)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const status = s.result
    ? ''
    : !yourTurn
      ? s.taking
        ? t('durak.oppTaking')
        : t('durak.oppTurn')
      : s.taking
        ? t('durak.canThrowIn')
        : youAttacker
          ? canPass(s)
            ? t('durak.throwOrBeat')
            : t('durak.attack')
          : canTransfer(s)
            ? t('durak.defendTransferTake')
            : t('durak.defendOrTake')

  const oppProgress =
    started && s.turn === 'opp' && !s.result ? remaining / moveMs : null
  const youProgress = !started
    ? readyRemaining / READY_MS
    : s.turn === 'you' && !s.result
      ? remaining / moveMs
      : null

  return (
    <div
      className="relative -mx-4 -mb-6 -mt-[calc(1rem+env(safe-area-inset-top))] flex flex-col overflow-hidden"
      style={{ ...felt, height: 'var(--app-h, 100dvh)' }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 120px 30px rgba(0,0,0,0.28)' }}
      />

      <div className="relative z-10 flex flex-1 flex-col px-3 pb-1 pt-[calc(0.6rem+env(safe-area-inset-top))]">
        {/* top bar — title dead-centre */}
        <div className="relative flex h-9 items-center gap-2">
          {/* exit to main menu (keeps the game so it can be resumed) */}
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
          <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-bold tracking-wide text-white/90">
            {`${t('game.durak')} · ${isOnline ? t('match.onlineWord') : t('match.vsBot')} · ${s.transfer ? t('mode.transfer') : t('mode.podkidnoy')}`}
          </span>
          <span className="ml-auto flex h-9 items-center gap-1.5 rounded-xl bg-white/95 px-3 text-sm font-extrabold text-[#1c1c1c] shadow">
            {bank > 0 ? (
              <>
                <span className="text-[11px] font-semibold text-[#8a8a8a]">{t('match.bank')}</span>
                {bank}
                <Gem size={13} className="text-gold" />
              </>
            ) : (
              <span className="text-[12px] font-semibold text-[#8a8a8a]">
                {isOnline ? t('match.rated') : t('match.training')}
              </span>
            )}
          </span>
        </div>

        {/* opponent */}
        <div className="mt-3 flex flex-col items-center">
          <PlayerTile
            name={isOnline ? online!.opponentName : t('match.bot')}
            elo={isOnline ? online!.opponentElo : undefined}
            active={s.turn === 'opp' && !s.result}
            progress={oppProgress}
            vip={isOnline ? online!.opponentVip : false}
            photo={isOnline ? online!.opponentPhoto ?? undefined : undefined}
            labelTop
          />
          <CardFan count={s.hands.opp.length} />
        </div>

        {/* table (drop zone) — column: deck/бито row on top, pairs below */}
        <div data-table className="relative flex min-h-0 flex-1 flex-col">
          {/* deck (left) + бито (right) — own top row, so pairs never cover it */}
          <div
            className="pointer-events-none flex shrink-0 items-start justify-between px-2 pt-2"
            style={{ minHeight: 104 }}
          >
            {/* deck: trump peeking out from under a stack of face-down cards */}
            {s.deck.length > 0 ? (
              <div className="relative" style={{ width: 116, height: 100 }}>
                {/* trump lying under the deck, peeking to the right */}
                {s.trumpCard && (
                  <PlayingCard
                    card={s.trumpCard}
                    size="md"
                    style={{
                      position: 'absolute',
                      left: 34,
                      top: 6,
                      transform: 'rotate(90deg)',
                      zIndex: 0,
                    }}
                  />
                )}
                {/* deck stack (thickness) — vertically centred on the trump */}
                <PlayingCard faceDown size="md" style={{ position: 'absolute', left: 4, top: 8, zIndex: 1 }} />
                <PlayingCard faceDown size="md" style={{ position: 'absolute', left: 2, top: 6, zIndex: 2 }} />
                <PlayingCard faceDown size="md" style={{ position: 'absolute', left: 0, top: 4, zIndex: 3 }} />
                <span className="absolute left-[-8px] top-1 z-10 grid h-6 min-w-6 place-items-center rounded-full bg-[#1c1c1c] px-1 text-xs font-extrabold text-white shadow">
                  {s.deck.length}
                </span>
              </div>
            ) : (
              <span />
            )}

            {/* бито (discard pile) */}
            {s.discard > 0 ? (
              <div className="relative h-[78px] w-[56px]">
                <PlayingCard
                  faceDown
                  size="md"
                  style={{ position: 'absolute', left: 0, top: 0, transform: 'rotate(8deg)' }}
                />
                <PlayingCard
                  faceDown
                  size="md"
                  style={{ position: 'absolute', left: 0, top: 0, transform: 'rotate(-6deg)' }}
                />
              </div>
            ) : (
              <span />
            )}
          </div>

          {/* pre-game hint + attack/defend pairs — centred column under the deck,
              kept narrow so rows never reach the deck (left) or бито (right) */}
          <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-wrap content-center items-center justify-center gap-x-2 gap-y-3 pb-2">
            {!started && (
              <span className="rounded-full bg-black/30 px-6 py-3 text-lg font-bold text-white/90 backdrop-blur">
                {t('match.readyPrompt')}
              </span>
            )}
            {started &&
              s.table.map((p, i) => (
                <div
                  key={i}
                  data-pair={i}
                  className="relative"
                  style={{ width: 100, height: 124 }}
                >
                  <div
                    className={youAttacker ? 'gh-drop-bottom' : 'gh-drop-top'}
                    style={{ position: 'absolute', left: 2, top: 2 }}
                  >
                    <PlayingCard card={p.attack} size="lg" style={{ transform: 'rotate(-3deg)' }} />
                  </div>
                  {p.defend && (
                    <div
                      className={youAttacker ? 'gh-drop-top' : 'gh-drop-bottom'}
                      style={{ position: 'absolute', left: 13, top: 7, zIndex: 20 }}
                    >
                      <PlayingCard
                        card={p.defend}
                        size="lg"
                        className="shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
                        style={{ transform: 'rotate(14deg)' }}
                      />
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>

        {/* your hand — dealt only after «Готов» */}
        {started && (
          <HandFan
            cards={s.hands.you}
            selIdx={selIdx}
            carrying={drag != null}
            canDrag={yourTurn}
            onPointerDown={beginHand}
          />
        )}
      </div>

      {/* bottom menu bar */}
      <div className="relative z-10 -mt-1 flex items-center gap-2 rounded-t-3xl bg-surface px-4 pb-[calc(0.6rem+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.3)]">
        <div className="w-24 shrink-0">
          {!started ? (
            <Button size="sm" className="w-full" onClick={() => setStarted(true)}>
              {t('match.ready')}
            </Button>
          ) : yourTurn && canFinishTake(s) ? (
            <Button size="sm" className="w-full" onClick={doDone}>
              {t('match.done')}
            </Button>
          ) : yourTurn && canPass(s) ? (
            <Button size="sm" className="w-full" onClick={doDone}>
              {t('match.beat')}
            </Button>
          ) : yourTurn && canTake(s) ? (
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={doTake}
            >
              {t('match.take')}
            </Button>
          ) : (
            <span className="block text-center text-[11px] font-medium leading-tight text-muted">
              {status}
            </span>
          )}
        </div>

        <div className="flex flex-1 justify-center">
          <PlayerTile
            name={myName ?? displayName(user)}
            elo={isOnline ? online!.myElo : undefined}
            active={started ? yourTurn : true}
            progress={youProgress}
            photo={user.photoUrl}
            you
            onLight
            vip={vipMe}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={openChat}
            aria-label="Чат"
            className="relative grid h-9 w-9 place-items-center rounded-full bg-bg text-ink active:scale-95"
          >
            <MessageCircle size={18} />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </button>
          <span className="flex items-center gap-1 rounded-full bg-bg px-2.5 py-1 text-sm font-extrabold text-ink">
            {player.balance}
            <Gem size={13} className="text-gold" />
          </span>
        </div>
      </div>

      {/* dragged card follows the pointer */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.x,
            top: drag.y,
            transform: 'translate(-50%, -50%) scale(1.12)',
          }}
        >
          <PlayingCard
            card={drag.card}
            size="lg"
            className="shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
          />
        </div>
      )}

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
              <p className="font-bold">{t('match.chat')}</p>
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
                placeholder={t('match.messagePlaceholder')}
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
        <ConfirmDialog
          money={bank > 0}
          onCancel={() => setConfirmResign(false)}
          onConfirm={() => {
            setConfirmResign(false)
            if (online) getSocket().emit('resign', { roomId: online.roomId })
            else setS((cur) => resign(cur, 'you'))
          }}
        />
      )}

      {s.result?.loser === 'opp' && <Confetti />}
      {s.result && (
        <DurakOver
          loser={s.result.loser}
          money={bank > 0}
          canRematch={!isOnline}
          rated={isOnline}
          eloDelta={eloDelta}
          onExit={onExit}
          onRematch={() => setS(createGame({ deck: deckSize, transfer }))}
        />
      )}
    </div>
  )
}

/** Square avatar tile with name label, card-count badge, turn glow + timer ring. */
export function PlayerTile({
  name,
  elo,
  active,
  progress,
  photo,
  you,
  onLight,
  vip,
  labelTop,
  role,
}: {
  name: string
  elo?: number
  active: boolean
  progress: number | null
  photo?: string
  you?: boolean
  onLight?: boolean
  vip?: boolean
  labelTop?: boolean
  role?: 'attack' | 'take' | null
}) {
  const initial = name.charAt(0).toUpperCase()
  const RW = 52
  const RR = 14
  const roleChip =
    role === 'attack'
      ? { text: t('durak.role.attack'), bg: '#16a34a' }
      : role === 'take'
        ? { text: t('durak.role.take'), bg: '#dc2626' }
        : null
  const frac = progress == null ? 0 : Math.max(0, Math.min(1, progress))
  const low = progress != null && progress < 0.25
  const label = (
    <span
      className={`flex max-w-[150px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        labelTop ? 'mb-1' : 'mt-1'
      } ${onLight ? 'text-ink' : 'bg-black/35 text-white backdrop-blur'}`}
    >
      <span className="truncate">{name}</span>
      {vip && (
        <span className="shrink-0 rounded-full bg-gradient-to-b from-gold to-gold-dark px-1 text-[9px] font-bold text-white">
          VIP
        </span>
      )}
      {elo != null && (
        <span
          className={`shrink-0 rounded-full px-1 text-[10px] font-bold ${
            onLight ? 'bg-gold-light text-gold-dark' : 'bg-white/15 text-gold-light'
          }`}
        >
          {elo}
        </span>
      )}
    </span>
  )
  return (
    <div className="flex flex-col items-center">
      {labelTop && label}
      <div className="relative h-[62px] w-[62px]">
        {/* pulsing halo on the player whose turn it is now */}
        {active && (
          <span className="gh-turn-halo pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-xl" />
        )}
        {/* timer outline (follows the rounded-square avatar; pathLength=100 normalises the dash) */}
        {progress != null && (
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 62 62">
            <rect
              x="5"
              y="5"
              width={RW}
              height={RW}
              rx={RR}
              fill="none"
              stroke="rgba(0,0,0,0.22)"
              strokeWidth="3"
            />
            <rect
              x="5"
              y="5"
              width={RW}
              height={RW}
              rx={RR}
              fill="none"
              stroke={low ? '#ef4444' : '#38d66b'}
              strokeWidth="3"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 * (1 - frac)}
            />
          </svg>
        )}
        {/* avatar */}
        <div
          className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-xl text-lg font-extrabold text-white shadow-md"
          style={{
            background: you
              ? 'linear-gradient(160deg,#d99a2b,#b97817)'
              : 'linear-gradient(160deg,#6d8298,#4b5f73)',
            boxShadow: active
              ? '0 0 0 2px #38d66b'
              : '0 0 0 2px rgba(255,255,255,0.85)',
          }}
        >
          {photo ? (
            <img src={photo} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </div>
        {/* role badge — visible to everyone on the field */}
        {roleChip && (
          <span
            className="absolute -bottom-1.5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white shadow"
            style={{ backgroundColor: roleChip.bg }}
          >
            {roleChip.text}
          </span>
        )}
      </div>
      {!labelTop && label}
    </div>
  )
}

/** Measure a container's width (keeps fans inside the viewport). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Fanned overlap so `count` cards of `cardW` never exceed `width`. */
function fanStep(count: number, cardW: number, width: number, loose: number) {
  if (count <= 1) return 0
  const spread = Math.max(1, width - 8 - cardW)
  return Math.min(cardW - loose, spread / (count - 1)) // px between card lefts
}

/** Wide, shallow face-down fan for the opponent (spread out like a held hand). */
export function CardFan({ count }: { count: number }) {
  const [ref, w] = useWidth()
  if (count === 0) return <div ref={ref} className="h-10" />
  const cardW = 40
  // straight even row, wide spread with a little overlap (no tilt)
  const step = fanStep(count, cardW, Math.min(w, 250), 8)
  return (
    <div ref={ref} className="mt-1 flex w-full items-start justify-center">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            marginLeft: i === 0 ? 0 : -(cardW - step),
            zIndex: i,
          }}
        >
          <div
            className="gh-deal-opp"
            style={{ animationDelay: `${Math.min(i, 5) * 35}ms` }}
          >
            <PlayingCard faceDown size="sm" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Your hand — arced, overlapping. Slide to browse (card lifts), pull up to play. */
export function HandFan({
  cards,
  selIdx,
  carrying,
  canDrag,
  onPointerDown,
}: {
  cards: Card[]
  selIdx: number
  carrying: boolean
  canDrag: boolean
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const [ref, w] = useWidth()
  const n = cards.length
  const mid = (n - 1) / 2
  const cardW = 80
  const cardH = 112
  const step = fanStep(n, cardW, w, 18)
  // gentle arced fan; auto-scaled to fit the width
  const per = n > 1 ? Math.min(3.6, 24 / (n - 1)) : 0
  const dyPer = Math.min(3, 14 / Math.max(mid, 1))
  const contentW = cardW + (n - 1) * step
  const rotMargin = cardH * Math.sin((mid * per * Math.PI) / 180)
  const scale = Math.min(1, (w - 6) / (contentW + 2 * rotMargin + 4))
  return (
    <div
      ref={ref}
      className="flex touch-none justify-center pt-2"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
    >
      <div
        className="flex items-end"
        style={{ transform: `scale(${scale})`, transformOrigin: 'bottom center' }}
      >
        {cards.map((c, i) => {
          const lifted = i === selIdx && !carrying
          const carried = i === selIdx && carrying
          const arc = Math.abs(i - mid) * dyPer
          return (
            <div
              key={cardId(c)}
              data-hand-idx={i}
              style={{
                transform: `rotate(${(i - mid) * per}deg) translateY(${arc - (lifted ? 16 : 0)}px)`,
                transformOrigin: 'bottom center',
                transition: 'transform 0.12s ease',
                marginLeft: i === 0 ? 0 : -(cardW - step),
                zIndex: lifted ? 100 : i,
                opacity: carried ? 0 : 1,
                filter: lifted ? 'drop-shadow(0 8px 12px rgba(0,0,0,0.45))' : undefined,
                cursor: canDrag ? 'grab' : 'default',
              }}
            >
              <div
                className="gh-deal-hand"
                style={{ animationDelay: `${Math.min(i, 5) * 35}ms` }}
              >
                <PlayingCard card={c} size="lg" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  money,
  onCancel,
  onConfirm,
}: {
  money: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
      <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
        <p className="text-lg font-extrabold">{t('match.resignQ')}</p>
        <p className="mt-1 text-sm text-muted">
          {money
            ? t('match.resignWarnStake')
            : t('match.resignWarnRating')}
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Отмена
          </Button>
          <Button className="flex-1" onClick={onConfirm}>
            Сдаться
          </Button>
        </div>
      </div>
    </div>
  )
}

function DurakOver({
  loser,
  money,
  canRematch,
  rated,
  eloDelta,
  onExit,
  onRematch,
}: {
  loser: Player | null
  money: boolean
  canRematch: boolean
  rated: boolean
  eloDelta: number | null
  onExit: () => void
  onRematch: () => void
}) {
  const draw = loser === null
  const youWon = loser === 'opp'
  const title = draw ? t('match.draw') : youWon ? t('match.youWon') : t('match.youLost')
  const showElo = rated && !draw && eloDelta != null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
      <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
        <p className="text-2xl font-extrabold">{title}</p>
        <p className="mt-1 text-sm text-muted">
          {money ? t('match.onGram') : canRematch ? t('match.botUnrated') : t('match.onlineGame')}
        </p>
        {showElo && (
          <p
            className={`mt-3 text-3xl font-extrabold ${eloDelta >= 0 ? 'text-success' : 'text-danger'}`}
          >
            {eloDelta >= 0 ? '+' : '−'}
            {Math.abs(eloDelta)} Elo
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onExit}>
            В меню
          </Button>
          {canRematch && (
            <Button className="flex-1" onClick={onRematch}>
              <RotateCcw size={16} /> Ещё раз
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
