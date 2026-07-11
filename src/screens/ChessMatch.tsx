import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import type {
  PieceDropHandlerArgs,
  PieceRenderObject,
  SquareHandlerArgs,
} from 'react-chessboard'
import { boardStyleFor, equippedBoard, equippedPieceDir, isVip } from '../lib/skins'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Handshake,
  List,
  MessageCircle,
  RotateCcw,
  Send,
  Star,
  Trophy,
  X,
} from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { Confetti } from '../components/Confetti'
import { getSocket, type MatchConfig } from '../lib/socket'
import type { TgUser } from '../lib/telegram'
import { displayName, haptic } from '../lib/telegram'
import { t } from '../lib/i18n'

type Side = 'w' | 'b'
interface Result {
  winner: Side | null
  reason: string
  youWon?: boolean | null
  eloDelta?: number
  gram?: number
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function fenAfter(sans: string[], k: number): string {
  const c = new Chess()
  for (let i = 0; i < k; i++) c.move(sans[i])
  return c.fen()
}

function kingSquare(chess: Chess, color: Side): string | null {
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square
    }
  }
  return null
}

const PIECE_CODES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']

// Render a custom piece set from static SVGs under /public/piece/<dir>/.
function buildPieces(dir: string): PieceRenderObject {
  const obj: PieceRenderObject = {}
  for (const code of PIECE_CODES) {
    obj[code] = () => (
      <img
        src={`/piece/${dir}/${code}.svg`}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    )
  }
  return obj
}

interface ChessMatchProps {
  user: TgUser
  match: MatchConfig
  myName?: string
  myElo: number
  onMinimize: () => void
  onExit: () => void
}

// ── crash-safe save for local/bot games (survives closing the app) ──
const CHESS_SAVE_KEY = 'gh_chess_save'
export type ChessSave = {
  fen: string
  clocks: { w: number; b: number }
  minutes: number
  bot: boolean
  savedAt: number
}
export function readChessSave(): ChessSave | null {
  try {
    const raw = localStorage.getItem(CHESS_SAVE_KEY)
    if (!raw) return null
    const sv = JSON.parse(raw) as ChessSave
    if (sv?.fen) return sv
  } catch {
    /* ignore */
  }
  return null
}
export const hasChessSave = () => !!readChessSave()
export const clearChessSave = () => {
  try {
    localStorage.removeItem(CHESS_SAVE_KEY)
  } catch {
    /* ignore */
  }
}

export function ChessMatch({ user, match, myName, myElo, onMinimize, onExit }: ChessMatchProps) {
  const online = match.mode === 'online'
  const isBot = match.mode === 'local' && !!match.bot
  const myColor: Side = match.mode === 'online' ? match.color : 'w'

  const gameRef = useRef(
    new Chess(
      match.mode === 'online'
        ? match.fen
        : (match.restoreFen ?? undefined),
    ),
  )
  const [fen, setFen] = useState(gameRef.current.fen())
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(
    null,
  )
  const [clocks, setClocks] = useState(
    match.mode === 'online'
      ? match.clocks
      : (match.restoreClocks ?? {
          w: match.minutes * 60000,
          b: match.minutes * 60000,
        }),
  )
  const [result, setResult] = useState<Result | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [reviewIdx, setReviewIdx] = useState<number | null>(null)
  const [showMoves, setShowMoves] = useState(false)
  const startRef = useRef(Date.now())
  const [abortLeft, setAbortLeft] = useState(10)
  const [chatOpen, setChatOpen] = useState(false)
  const chatOpenRef = useRef(false)
  const [messages, setMessages] = useState<{ mine: boolean; text: string }[]>([])
  const [unread, setUnread] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [chatInput, setChatInput] = useState('')
  const [confirmResign, setConfirmResign] = useState(false)

  // persist local/bot games so a closed app can resume them
  const clocksRef = useRef(clocks)
  clocksRef.current = clocks
  useEffect(() => {
    if (match.mode !== 'local') return
    if (result) {
      clearChessSave()
      return
    }
    try {
      localStorage.setItem(
        CHESS_SAVE_KEY,
        JSON.stringify({
          fen,
          clocks: clocksRef.current,
          minutes: match.minutes,
          bot: !!match.bot,
          savedAt: Date.now(),
        }),
      )
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, result, match])

  const game = gameRef.current
  const turn = game.turn() as Side
  const sans = game.history()
  const reviewing = reviewIdx !== null
  const boardFen = reviewing ? fenAfter(sans, reviewIdx) : fen
  const iWon = result ? (result.youWon ?? result.winner === myColor) : false
  const celebrate = !!result && (result.reason === 'mate' || iWon)

  // haptic when the game ends
  useEffect(() => {
    if (!result) return
    haptic(result.winner === null ? 'warning' : iWon ? 'success' : 'error')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  // Online: sync state from the authoritative server.
  useEffect(() => {
    if (!online) return
    const s = getSocket()
    const onState = (st: {
      fen: string
      clocks: { w: number; b: number }
      lastMove: { from: string; to: string }
    }) => {
      gameRef.current.load(st.fen)
      setFen(st.fen)
      setClocks(st.clocks)
      setLastMove(st.lastMove)
      setSelected(null)
      setReviewIdx(null)
    }
    const onOver = (o: {
      winner: Side | null
      reason: string
      youWon: boolean | null
      eloDelta: number
      gram?: number
    }) => setResult(o)
    s.on('game:state', onState)
    s.on('game:over', onOver)
    return () => {
      s.off('game:state', onState)
      s.off('game:over', onOver)
    }
  }, [online])

  // Tick the active clock locally (server stays authoritative online).
  useEffect(() => {
    if (result) return
    const id = setInterval(() => {
      setClocks((p) => ({ ...p, [turn]: Math.max(0, p[turn] - 250) }))
    }, 250)
    return () => clearInterval(id)
  }, [turn, result])

  // Local timeout ends the game (online: server decides).
  useEffect(() => {
    if (online || result) return
    if (clocks.w === 0) setResult({ winner: 'b', reason: 'time' })
    else if (clocks.b === 0) setResult({ winner: 'w', reason: 'time' })
  }, [clocks, result, online])

  // Free-cancel window (first 10s); after that leaving = loss.
  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, 10 - Math.floor((Date.now() - startRef.current) / 1000))
      setAbortLeft(left)
      if (left === 0) clearInterval(id)
    }, 250)
    return () => clearInterval(id)
  }, [])

  // Delay the result modal so the mate animation can play first.
  useEffect(() => {
    if (!result) {
      setShowModal(false)
      return
    }
    const id = setTimeout(() => setShowModal(true), celebrate ? 1500 : 600)
    return () => clearTimeout(id)
  }, [result, celebrate])

  function applyMove(from: string, to: string): boolean {
    if (reviewing || result) return false
    const g = gameRef.current
    if (online && g.turn() !== myColor) return false
    try {
      if (!g.move({ from, to, promotion: 'q' })) return false
    } catch {
      return false
    }
    haptic('light')
    setFen(g.fen())
    setLastMove({ from, to })
    setSelected(null)
    if (match.mode === 'online') {
      getSocket().emit('move', { roomId: match.roomId, from, to })
    } else if (g.isGameOver()) {
      if (g.isCheckmate())
        setResult({ winner: g.turn() === 'w' ? 'b' : 'w', reason: 'mate' })
      else setResult({ winner: null, reason: 'draw' })
    }
    return true
  }

  function onPieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs) {
    if (!targetSquare) return false
    return applyMove(sourceSquare, targetSquare)
  }

  function onSquareClick({ square }: SquareHandlerArgs) {
    if (reviewing || result) return
    const g = gameRef.current
    if (selected && applyMove(selected, square)) return
    const piece = g.get(square as never)
    setSelected(piece && piece.color === g.turn() ? square : null)
  }

  // Simple bot: prefers captures, otherwise random (light difficulty).
  useEffect(() => {
    if (!isBot || result || reviewing || turn !== 'b') return
    const id = setTimeout(() => {
      const moves = gameRef.current.moves({ verbose: true }) as Array<{
        from: string
        to: string
        captured?: string
      }>
      if (!moves.length) return
      const val: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
      const caps = moves.filter((m) => m.captured)
      let pick
      if (caps.length && Math.random() < 0.8) {
        caps.sort((a, b) => (val[b.captured!] ?? 0) - (val[a.captured!] ?? 0))
        pick = caps[0]
      } else {
        pick = moves[Math.floor(Math.random() * moves.length)]
      }
      applyMove(pick.from, pick.to)
    }, 550)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, isBot, result, reviewing])

  function resign() {
    if (result) return
    if (match.mode === 'online')
      getSocket().emit('resign', { roomId: match.roomId })
    else setResult({ winner: myColor === 'w' ? 'b' : 'w', reason: 'resign' })
  }

  function abort() {
    if (result) return
    if (match.mode === 'online') getSocket().emit('abort', { roomId: match.roomId })
    else onExit()
  }

  function resetGame() {
    gameRef.current = new Chess()
    setFen(gameRef.current.fen())
    setClocks({ w: match.minutes * 60000, b: match.minutes * 60000 })
    setResult(null)
    setShowModal(false)
    setSelected(null)
    setLastMove(null)
    setReviewIdx(null)
    startRef.current = Date.now()
    setAbortLeft(10)
  }

  useEffect(() => {
    chatOpenRef.current = chatOpen
  }, [chatOpen])

  // Show the push toast for 3s, like a phone notification.
  function showToast(text: string) {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // Incoming chat from the opponent (online).
  useEffect(() => {
    if (!online) return
    const s = getSocket()
    const onChat = (m: { text: string }) => {
      setMessages((prev) => [...prev, { mine: false, text: m.text }])
      if (!chatOpenRef.current) {
        setUnread((u) => u + 1)
        showToast(m.text)
      }
    }
    s.on('chat:msg', onChat)
    return () => {
      s.off('chat:msg', onChat)
    }
  }, [online])

  function openChat() {
    setChatOpen(true)
    setUnread(0)
    setToast(null)
  }

  function sendChat() {
    const t = chatInput.trim()
    if (!t) return
    setMessages((prev) => [...prev, { mine: true, text: t }])
    if (match.mode === 'online') getSocket().emit('chat', { roomId: match.roomId, text: t })
    setChatInput('')
  }

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {}
    if (lastMove && !reviewing) {
      styles[lastMove.from] = { background: 'rgba(245,197,66,0.45)' }
      styles[lastMove.to] = { background: 'rgba(245,197,66,0.45)' }
    }
    if (selected && !reviewing) {
      styles[selected] = { background: 'rgba(245,197,66,0.6)' }
      const moves = gameRef.current.moves({
        square: selected as never,
        verbose: true,
      }) as Array<{ to: string; captured?: string }>
      for (const m of moves) {
        styles[m.to] = m.captured
          ? { background: 'radial-gradient(circle, transparent 54%, rgba(0,0,0,0.18) 56%)' }
          : { background: 'radial-gradient(circle, rgba(0,0,0,0.18) 20%, transparent 22%)' }
      }
    }
    if (!reviewing && gameRef.current.inCheck()) {
      const ks = kingSquare(gameRef.current, gameRef.current.turn() as Side)
      if (ks)
        styles[ks] = {
          background:
            'radial-gradient(circle, rgba(229,57,53,0.9) 0%, rgba(229,57,53,0.4) 65%, transparent 72%)',
        }
    }
    return styles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, lastMove, fen, reviewing])

  const vipMe = isVip()
  // Equipped cosmetic skins (chosen in the shop, read once per match).
  const skinBoard = useMemo(() => boardStyleFor(equippedBoard()), [])
  const skinPieces = useMemo(() => {
    const dir = equippedPieceDir()
    return dir ? buildPieces(dir) : undefined
  }, [])

  const boardOptions = {
    id: 'chess-match',
    position: boardFen,
    onPieceDrop,
    onSquareClick,
    boardOrientation: (myColor === 'b' ? 'black' : 'white') as 'white' | 'black',
    allowDragging: !result && !reviewing,
    animationDurationInMs: 180,
    ...skinBoard,
    squareStyles,
    ...(skinPieces ? { pieces: skinPieces } : {}),
  }

  const oppName =
    match.mode === 'online' ? match.opponent.name : isBot ? t('match.bot') : t('common.opponent')
  const oppElo = match.mode === 'online' ? match.opponent.elo : isBot ? 800 : 2280
  const oppClock = myColor === 'w' ? clocks.b : clocks.w
  const myClock = myColor === 'w' ? clocks.w : clocks.b
  const oppActive = turn !== myColor && !result
  const myActive = turn === myColor && !result

  function stepPrev() {
    const cur = reviewIdx ?? sans.length
    setReviewIdx(Math.max(0, cur - 1))
  }
  function stepNext() {
    const cur = reviewIdx ?? sans.length
    const nx = Math.min(sans.length, cur + 1)
    setReviewIdx(nx === sans.length ? null : nx)
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* GameHub top bar */}
      <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <button
          onClick={onMinimize}
          aria-label="Свернуть"
          className="grid h-8 w-8 place-items-center rounded-lg text-muted"
        >
          <ChevronDown size={20} />
        </button>
        <div className="flex items-center gap-1.5">
          <Star size={15} className="fill-gold text-gold" />
          <span className="font-extrabold tracking-tight">
            GameHub <span className="text-muted">Chess</span>
          </span>
        </div>
        <span className="w-8 text-right text-xs font-medium text-muted">
          {match.minutes}м
        </span>
      </div>

      <PlayerBar
        name={oppName}
        src={match.mode === 'online' ? match.opponent.photoUrl ?? undefined : undefined}
        elo={oppElo}
        clock={fmt(oppClock)}
        active={oppActive}
        vip={match.mode === 'online' ? match.opponent.vip : false}
      />

      <div className="my-2 w-full">
        <Chessboard options={boardOptions} />
      </div>

      <PlayerBar
        name={myName ?? displayName(user)}
        src={user.photoUrl}
        elo={myElo}
        clock={fmt(myClock)}
        active={myActive}
        vip={vipMe}
      />

      {/* move list (toggled) */}
      {showMoves && (
        <div className="mt-3 max-h-24 overflow-y-auto rounded-2xl border border-line bg-surface p-3">
          {sans.length === 0 ? (
            <p className="text-xs text-muted">{t('match.noMoves')}</p>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {sans.map((san, i) => (
                <span key={i} className="tabular-nums">
                  {i % 2 === 0 && (
                    <span className="text-muted">{i / 2 + 1}. </span>
                  )}
                  {san}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* incoming chat notification — top push toast (auto-hides after 3s) */}
      {toast && !chatOpen && (
        <button
          onClick={openChat}
          className="fixed left-1/2 top-3 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-left shadow-[var(--shadow-soft)]"
          style={{ animation: 'gh-pop 0.25s ease-out' }}
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2AABEE] text-white">
            <MessageCircle size={18} />
          </div>
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-bold">{oppName}: </span>
            {toast}
          </span>
          <span className="shrink-0 text-xs font-semibold text-gold-dark">
            Открыть
          </span>
        </button>
      )}

      {/* bottom toolbar (light, evenly spaced) */}
      <div className="mt-3 flex items-stretch gap-1 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-soft)]">
        <ToolBtn
          icon={List}
          label={t('match.moves')}
          active={showMoves}
          onClick={() => setShowMoves((v) => !v)}
        />
        <ToolBtn
          icon={MessageCircle}
          label={t('match.chat')}
          badge={unread}
          onClick={openChat}
        />
        <div className="flex flex-1 items-center justify-center">
          {abortLeft > 0 && !result ? (
            <button
              onClick={abort}
              className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl bg-gradient-to-b from-gold to-gold-dark text-white shadow-[var(--shadow-gold)]"
              aria-label="Отменить"
            >
              <X size={18} />
              <span className="text-[10px] font-bold leading-none">
                {abortLeft}с
              </span>
            </button>
          ) : (
            <button
              onClick={() => setConfirmResign(true)}
              className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-b from-gold to-gold-dark text-white shadow-[var(--shadow-gold)]"
              aria-label="Сдаться"
            >
              <Flag size={20} />
            </button>
          )}
        </div>
        <ToolBtn icon={ChevronLeft} label={t('match.back')} onClick={stepPrev} />
        <ToolBtn icon={ChevronRight} label={t('match.forward')} onClick={stepNext} />
      </div>

      {/* mate / win animation before the modal */}
      {result && !showModal && celebrate && (
        <>
          {iWon && <Confetti />}
          <div className="pointer-events-none fixed inset-0 z-40 flex items-start justify-center pt-32">
            <div
              className="rounded-full bg-ink/85 px-6 py-3 text-lg font-extrabold text-white"
              style={{ animation: 'gh-pop 0.4s ease-out' }}
            >
              {result.reason === 'mate' ? t('match.checkmate') : t('match.victory')}
            </div>
          </div>
        </>
      )}

      {showModal && result && (
        <GameOver
          result={result}
          youWhite={myColor === 'w'}
          rated={!isBot}
          onExit={onExit}
          onRematch={match.mode === 'online' ? onExit : resetGame}
        />
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

      {/* resign confirmation */}
      {confirmResign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6">
          <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-danger/10 text-danger">
              <Flag size={26} />
            </div>
            <p className="mt-3 text-lg font-extrabold">{t('match.resignQ')}</p>
            <p className="mt-1 text-sm text-muted">{t('match.resignWarn')}</p>
            <div className="mt-6 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirmResign(false)}
              >
                Отмена
              </Button>
              <button
                onClick={() => {
                  setConfirmResign(false)
                  resign()
                }}
                className="h-11 flex-1 rounded-[var(--radius-btn)] bg-danger px-5 font-semibold text-white transition active:scale-[0.98]"
              >
                Сдаться
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolBtn({
  icon: Icon,
  label,
  onClick,
  active,
  badge,
}: {
  icon: typeof List
  label: string
  onClick: () => void
  active?: boolean
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 transition active:bg-bg ${
        active ? 'text-gold-dark' : 'text-muted'
      }`}
    >
      {badge ? (
        <span className="absolute right-3 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
          {badge}
        </span>
      ) : null}
      <Icon size={20} />
      <span className="text-[10px]">{label}</span>
    </button>
  )
}

function PlayerBar({
  name,
  src,
  elo,
  clock,
  active,
  vip,
}: {
  name: string
  src?: string
  elo: number
  clock: string
  active: boolean
  vip?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <Avatar name={name} src={src} size={40} vip={vip} />
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <p className="font-bold leading-tight">{name}</p>
          {vip && (
            <span className="rounded-full bg-gradient-to-b from-gold to-gold-dark px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
              VIP
            </span>
          )}
        </div>
        {elo > 0 && <p className="text-xs text-muted">Elo {elo}</p>}
      </div>
      <div
        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-bold tabular-nums ${
          active
            ? 'bg-gradient-to-b from-gold to-gold-dark text-white'
            : 'border border-line bg-surface text-ink'
        }`}
      >
        <Clock size={15} />
        {clock}
      </div>
    </div>
  )
}

function GameOver({
  result,
  youWhite,
  rated,
  onExit,
  onRematch,
}: {
  result: Result
  youWhite: boolean
  rated: boolean
  onExit: () => void
  onRematch: () => void
}) {
  const aborted = result.reason === 'aborted'
  const draw = result.winner === null && !aborted
  const youWon =
    result.youWon ?? (draw || aborted ? null : result.winner === (youWhite ? 'w' : 'b'))

  const title = aborted
    ? t('match.aborted')
    : draw
      ? t('match.draw')
      : youWon
        ? t('match.youWon')
        : t('match.defeat')
  const reasonText =
    aborted
      ? t('match.noPenalty')
      : { mate: t('reason.mate'), time: t('reason.time'), resign: t('reason.resign'), draw: t('reason.draw'), abandon: t('reason.abandon') }[
          result.reason
        ] ?? result.reason
  const delta =
    result.eloDelta !== undefined
      ? (result.eloDelta >= 0 ? '+' : '−') + Math.abs(result.eloDelta)
      : draw
        ? '+0'
        : youWon
          ? '+25'
          : '−25'

  const Icon = aborted ? X : draw ? Handshake : youWon ? Trophy : Flag
  const iconWrap = aborted
    ? 'bg-line text-muted'
    : draw
      ? 'bg-gold-light/60 text-gold-dark'
      : youWon
        ? 'bg-gradient-to-b from-gold to-gold-dark text-white shadow-[var(--shadow-gold)]'
        : 'bg-danger/10 text-danger'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="gh-pop-in w-full max-w-xs overflow-hidden rounded-[var(--radius-card)] bg-surface text-center shadow-[var(--shadow-soft)]">
        <div className="flex flex-col items-center px-6 pt-7">
          <div className={`grid h-20 w-20 place-items-center rounded-full ${iconWrap}`}>
            <Icon size={38} strokeWidth={youWon && !draw && !aborted ? 2 : 1.8} />
          </div>
          <p className="mt-4 text-2xl font-extrabold">{title}</p>
          <p className="mt-1 text-sm text-muted">{reasonText}</p>
          {result.gram != null && result.gram !== 0 && (
            <p className={`mt-3 text-2xl font-extrabold ${result.gram > 0 ? 'text-success' : 'text-danger'}`}>
              {result.gram > 0 ? '+' : '−'}
              {Math.abs(result.gram).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} GRAM
            </p>
          )}
          {!aborted && rated && (
            <p
              className={`mt-4 text-3xl font-extrabold ${
                draw ? 'text-muted' : youWon ? 'text-success' : 'text-danger'
              }`}
            >
              {delta} Elo
            </p>
          )}
          {!aborted && !rated && (
            <p className="mt-4 text-sm font-medium text-muted">
              {t('match.botUnrated')}
            </p>
          )}
        </div>
        <div className="flex gap-2 p-6">
          <Button variant="secondary" className="flex-1" onClick={onExit}>
            {t('match.toMenu')}
          </Button>
          {!aborted && (
            <Button className="flex-1" onClick={onRematch}>
              <RotateCcw size={16} /> {t('match.rematch')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
