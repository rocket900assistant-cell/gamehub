import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Flag, Gem, MessageCircle, RotateCcw, Send, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PlayingCard } from '../components/PlayingCard'
import { Confetti } from '../components/Confetti'
import { HandFan, CardFan, PlayerTile, ConfirmDialog } from './DurakMatch'
import { equippedDurakFeltSrc, isVip } from '../lib/skins'
import { t } from '../lib/i18n'
import { getSocket } from '../lib/socket'
import { player } from '../data/mock'
import { displayName, type TgUser } from '../lib/telegram'
import {
  createGameN,
  botStep,
  playAttack,
  playDefend,
  playTransfer,
  canTransfer,
  beginTake,
  pass as enginePass,
  canTake,
  resign as engineResign,
  type Card,
  type DurakNState,
} from '../lib/durakN'

export interface SeatInfo {
  name: string
  vip: boolean
  bot: boolean
  photoUrl?: string | null
}

export interface OnlineDurakN {
  roomId: string
  seat: number // this player's seat index
  players: number
  seats: SeatInfo[] // by seat index
  initial: DurakNState // server view for this seat (own hand visible)
  deadline: number
}

interface DurakMatchNProps {
  user: TgUser
  players: number
  deck: number
  neighborsOnly: boolean
  transfer: boolean
  allowDraw: boolean
  myName?: string
  online?: OnlineDurakN | null
  onExit: () => void
}

const FELT_BASE: React.CSSProperties = {
  backgroundColor: '#2f4560',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}

const MOVE_MS = 60000

export function DurakMatchN({
  user,
  players,
  deck,
  neighborsOnly,
  transfer,
  allowDraw,
  myName,
  online,
  onExit,
}: DurakMatchNProps) {
  const isOnline = !!online
  const me = online ? online.seat : 0
  const felt = useMemo(
    () => ({ ...FELT_BASE, backgroundImage: `url('${equippedDurakFeltSrc()}')` }),
    [],
  )
  const [s, setS] = useState<DurakNState>(() =>
    online ? online.initial : createGameN({ players, deck, neighborsOnly, transfer, allowDraw }),
  )
  const [seats, setSeats] = useState<SeatInfo[]>(() => online?.seats ?? [])
  const [drag, setDrag] = useState<{ card: Card; x: number; y: number } | null>(null)
  const [selIdx, setSelIdx] = useState(-1)
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
  const openChat = () => {
    setChatOpen(true)
    setUnread(0)
  }
  const sendChat = () => {
    const txt = chatInput.trim()
    if (!txt) return
    setMessages((m) => [...m, { mine: true, text: txt }])
    if (isOnline) getSocket().emit('chat', { roomId: online!.roomId, text: txt })
    setChatInput('')
  }

  // ── move clock (1 min / turn — server-driven online, local otherwise) ──
  const [deadline, setDeadline] = useState(() => online?.deadline ?? Date.now() + MOVE_MS)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isOnline) return
    const sock = getSocket()
    const onState = (p: { durakn: DurakNState; deadline: number; seats?: SeatInfo[] }) => {
      setS(p.durakn)
      setDeadline(p.deadline)
      if (p.seats) setSeats(p.seats)
    }
    const onOver = (g: { youWon: boolean | null; draw?: boolean }) => {
      setS((cur) =>
        cur.result
          ? cur
          : { ...cur, result: { loser: g.draw ? null : g.youWon === false ? me : -1 } },
      )
    }
    const onChat = (m: { text: string }) => {
      setMessages((prev) => [...prev, { mine: false, text: m.text }])
      if (!chatOpenRef.current) setUnread((u) => u + 1)
    }
    sock.on('durakn:state', onState)
    sock.on('game:over', onOver)
    sock.on('chat:msg', onChat)
    return () => {
      sock.off('durakn:state', onState)
      sock.off('game:over', onOver)
      sock.off('chat:msg', onChat)
    }
  }, [isOnline, me])

  // tick the clock while a game is live
  useEffect(() => {
    if (s.result) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [s.result])

  // local: (re)start the 1-min clock each time it becomes my turn; fold on timeout
  useEffect(() => {
    if (isOnline || s.result || s.turn !== me) return
    setDeadline(Date.now() + MOVE_MS)
  }, [isOnline, s.turn, s.result, me])
  useEffect(() => {
    if (isOnline || s.result || s.turn !== me) return
    const id = setTimeout(
      () => setS((cur) => (cur.result || cur.turn !== me ? cur : engineResign(cur, me))),
      Math.max(0, deadline - Date.now()),
    )
    return () => clearTimeout(id)
  }, [isOnline, s, deadline, me])

  // Bots (local only) auto-play until it's the human's turn or the game ends.
  useEffect(() => {
    if (isOnline || s.result || s.turn === me) return
    const id = setTimeout(
      () => setS((cur) => (cur.result || cur.turn === me ? cur : botStep(cur, cur.turn))),
      650,
    )
    return () => clearTimeout(id)
  }, [s, isOnline, me])

  const myTurn = !s.result && s.turn === me
  const iAmDefender = s.defender === me
  const undef = s.table.filter((p) => !p.defend).length
  const defendingNow = iAmDefender && !s.taking && undef > 0
  const inThrowWindow = myTurn && (s.taking || (undef === 0 && s.table.length > 0))
  const takeNow = myTurn && canTake(s)

  const remaining = Math.max(0, deadline - now)
  const clockFor = (seat: number) => {
    if (s.result || s.turn !== seat) return null
    if (isOnline) return remaining / MOVE_MS // server clock on the active seat
    return seat === me ? remaining / MOVE_MS : null // local: only my own clock
  }
  const doResign = () => {
    setConfirmResign(false)
    if (isOnline) getSocket().emit('resign', { roomId: online!.roomId })
    else setS((cur) => (cur.result ? cur : engineResign(cur, me)))
  }

  const apply = (next: DurakNState) => {
    if (next !== s) setS(next)
  }
  const emitAction = (type: string, extra: object = {}) =>
    getSocket().emit('durakn:action', { roomId: online!.roomId, type, ...extra })

  const doAttack = (card: Card) =>
    isOnline ? emitAction('attack', { card }) : apply(playAttack(s, me, card))
  const doDefend = (card: Card, pair: number) =>
    isOnline ? emitAction('defend', { card, pair }) : apply(playDefend(s, card, pair))
  const doTransfer = (card: Card) =>
    isOnline ? emitAction('transfer', { card }) : apply(playTransfer(s, card))
  const doTake = () => (isOnline ? emitAction('take') : apply(beginTake(s)))
  const doPass = () => (isOnline ? emitAction('pass') : apply(enginePass(s, me)))

  // Drop a card at a screen point — the engine validates; illegal = snap back.
  function playAt(card: Card, x: number, y: number) {
    if (!defendingNow) {
      doAttack(card) // attacker / thrower — a light flick plays it
      return
    }
    const el = document.elementFromPoint(x, y)
    const pairEl = el?.closest<HTMLElement>('[data-pair]')
    if (pairEl) {
      doDefend(card, Number(pairEl.dataset.pair)) // dropped on a pair → beat it
      return
    }
    // dropped on the open table: transfer (переводной) if legal, else beat the first pair
    if (playTransfer(s, card) !== s) {
      doTransfer(card)
      return
    }
    doDefend(card, s.table.findIndex((p) => !p.defend))
  }

  const handIdxAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-hand-idx]')
    return el ? Number(el.dataset.handIdx) : -1
  }

  function beginHand(e: React.PointerEvent) {
    if (!myTurn) return
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
        carrying = true
        const card = s.hands[me][sel]
        if (card) setDrag({ card, x: ev.clientX, y: ev.clientY })
      } else {
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
      const card = s.hands[me][sel]
      setDrag(null)
      setSelIdx(-1)
      if (carrying && card) playAt(card, ev.clientX, ev.clientY)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const status = s.result
    ? ''
    : !myTurn
      ? t('durak.oppTurn')
      : defendingNow
        ? canTransfer(s)
          ? t('durak.defendTransferTake')
          : t('durak.defendOrTake')
        : s.table.length === 0
          ? t('durak.attack')
          : t('durak.throwOrBeat')

  // opponents in play order after me (wraps for online seat > 0)
  const opponents = Array.from({ length: s.n - 1 }, (_, i) => (me + 1 + i) % s.n)
  const oppName = (seat: number) => seats[seat]?.name ?? `${t('durakN.bot')} ${seat}`
  const roleOf = (seat: number): 'attack' | 'take' | null =>
    s.result ? null : seat === s.defender ? (s.taking ? 'take' : null) : seat === s.attacker ? 'attack' : null
  const turnName = s.result ? null : s.turn === me ? myName ?? displayName(user) : oppName(s.turn)

  const draw = s.result != null && s.result.loser === null
  const iLost = s.result?.loser === me
  const iWon = s.result != null && !iLost && !draw

  return (
    <div
      className="relative -mx-4 -mb-6 -mt-[calc(1rem+env(safe-area-inset-top))] flex flex-col overflow-hidden"
      style={{ ...felt, height: 'var(--app-h, 100dvh)' }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 120px 30px rgba(0,0,0,0.28)' }}
      />

      {/* top bar */}
      <div className="relative z-10 flex items-center gap-2 px-3 pt-[calc(0.4rem+env(safe-area-inset-top))]">
        <button
          onClick={onExit}
          aria-label="Выход"
          className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white/90 backdrop-blur active:scale-95"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => setConfirmResign(true)}
          aria-label="Сдаться"
          className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white/90 backdrop-blur active:scale-95"
        >
          <Flag size={17} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-bold tracking-wide text-white/90">
          {`${t('game.durak')} · ${s.n} ${t('durakN.players')}`}
        </span>
        <span className="ml-auto flex h-9 items-center rounded-xl bg-white/95 px-3 text-[12px] font-semibold text-[#8a8a8a] shadow">
          {isOnline ? t('match.onlineWord') : t('match.training')}
        </span>
      </div>

      {/* opponents row */}
      <div className="relative z-10 mt-1 flex items-start justify-around px-1">
        {opponents.map((seat) => (
          <div key={seat} className="flex w-[86px] flex-col items-center">
            <PlayerTile
              name={oppName(seat)}
              active={s.turn === seat && !s.result}
              progress={clockFor(seat)}
              vip={seats[seat]?.vip}
              photo={seats[seat]?.photoUrl ?? undefined}
              role={roleOf(seat)}
              labelTop
            />
            <CardFan count={s.hands[seat].length} />
          </div>
        ))}
      </div>

      {/* whose-turn banner — clearly visible to all players on the field */}
      {turnName && (
        <div className="relative z-10 mt-1 flex justify-center">
          <span className="flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-[12px] font-semibold text-white backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#38d66b]" />
            {t('durak.turnOf')}: {s.turn === me ? t('durak.youWord') : turnName}
          </span>
        </div>
      )}

      {/* table (drop zone) */}
      <div data-table className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div
          className="pointer-events-none flex shrink-0 items-start justify-between px-2 pt-1"
          style={{ minHeight: 96 }}
        >
          {s.deck.length > 0 ? (
            <div className="relative" style={{ width: 110, height: 92 }}>
              {s.trumpCard && (
                <PlayingCard
                  card={s.trumpCard}
                  size="md"
                  style={{ position: 'absolute', left: 32, top: 4, transform: 'rotate(90deg)', zIndex: 0 }}
                />
              )}
              <PlayingCard faceDown size="md" style={{ position: 'absolute', left: 2, top: 4, zIndex: 2 }} />
              <PlayingCard faceDown size="md" style={{ position: 'absolute', left: 0, top: 2, zIndex: 3 }} />
              <span className="absolute left-[-8px] top-0 z-10 grid h-6 min-w-6 place-items-center rounded-full bg-[#1c1c1c] px-1 text-xs font-extrabold text-white shadow">
                {s.deck.length}
              </span>
            </div>
          ) : (
            <span className="rounded-lg bg-black/25 px-2 py-1 text-[11px] font-bold text-white/80">
              {s.trump}
            </span>
          )}
          {s.discard > 0 ? (
            <div className="relative h-[78px] w-[56px]">
              <PlayingCard faceDown size="md" style={{ position: 'absolute', left: 0, top: 0, transform: 'rotate(8deg)' }} />
              <PlayingCard faceDown size="md" style={{ position: 'absolute', left: 0, top: 0, transform: 'rotate(-6deg)' }} />
            </div>
          ) : (
            <span />
          )}
        </div>

        {/* attack/defend pairs — with the same drop animations as 1v1 */}
        <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-wrap content-center items-center justify-center gap-x-2 gap-y-3 pb-1">
          {s.table.map((p, i) => (
            <div key={i} data-pair={i} className="relative" style={{ width: 100, height: 124 }}>
              <div
                className={p.by === me ? 'gh-drop-bottom' : 'gh-drop-top'}
                style={{ position: 'absolute', left: 2, top: 2 }}
              >
                <PlayingCard card={p.attack} size="lg" style={{ transform: 'rotate(-3deg)' }} />
              </div>
              {p.defend && (
                <div
                  className={s.defender === me ? 'gh-drop-bottom' : 'gh-drop-top'}
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

        {/* your hand */}
        <HandFan
          cards={s.hands[me]}
          selIdx={selIdx}
          carrying={drag != null}
          canDrag={myTurn}
          onPointerDown={beginHand}
        />
      </div>

      {/* bottom menu bar */}
      <div className="relative z-10 -mt-1 flex items-center gap-2 rounded-t-3xl bg-surface px-4 pb-[calc(0.6rem+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.3)]">
        <div className="w-24 shrink-0">
          {takeNow ? (
            <Button size="sm" variant="secondary" className="w-full" onClick={doTake}>
              {t('match.take')}
            </Button>
          ) : inThrowWindow ? (
            <Button size="sm" className="w-full" onClick={doPass}>
              {s.taking ? t('match.done') : s.attacker === me ? t('match.beat') : t('durakN.pass')}
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
            active={myTurn}
            progress={clockFor(me)}
            photo={user.photoUrl}
            role={roleOf(me)}
            vip={isVip()}
            you
            onLight
          />
        </div>
        <div className="flex w-24 shrink-0 items-center justify-end gap-2">
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
          <span className="flex items-center gap-1 rounded-full bg-bg px-2 py-1 text-sm font-extrabold text-ink">
            {player.balance}
            <Gem size={13} className="text-gold" />
          </span>
        </div>
      </div>

      {/* dragged card follows the finger */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: drag.x, top: drag.y, transform: 'translate(-50%, -50%) scale(1.12)' }}
        >
          <PlayingCard card={drag.card} size="lg" className="shadow-[0_12px_28px_rgba(0,0,0,0.5)]" />
        </div>
      )}

      {/* chat bottom sheet */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setChatOpen(false)}>
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
                <p className="py-8 text-center text-sm text-muted">{t('match.noMessages')}</p>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <span
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        m.mine ? 'bg-gradient-to-b from-gold to-gold-dark text-white' : 'bg-bg text-ink'
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
        <ConfirmDialog money={false} onCancel={() => setConfirmResign(false)} onConfirm={doResign} />
      )}

      {/* game over */}
      {iWon && <Confetti />}
      {s.result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
            <p className="text-2xl font-extrabold">
              {draw ? t('match.draw') : iLost ? t('match.youLost') : t('match.youWon')}
            </p>
            <p className="mt-1 text-sm text-muted">
              {isOnline ? t('match.onlineGame') : t('match.botUnrated')}
            </p>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onExit}>
                {t('match.toMenu')}
              </Button>
              {!isOnline && (
                <Button
                  className="flex-1"
                  onClick={() => setS(createGameN({ players, deck, neighborsOnly, transfer, allowDraw }))}
                >
                  <RotateCcw size={16} /> {t('match.again')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
