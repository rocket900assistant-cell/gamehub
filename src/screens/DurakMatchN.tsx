import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, RotateCcw } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PlayingCard } from '../components/PlayingCard'
import { Confetti } from '../components/Confetti'
import { equippedDurakFeltSrc, equippedDurakBackSrc } from '../lib/skins'
import { t } from '../lib/i18n'
import { displayName, type TgUser } from '../lib/telegram'
import {
  createGameN,
  botStep,
  playAttack,
  playDefend,
  beginTake,
  pass as enginePass,
  canTake,
  legalThrow,
  legalDefends,
  cardId,
  rankLabel,
  type Card,
  type DurakNState,
} from '../lib/durakN'

interface DurakMatchNProps {
  user: TgUser
  players: number
  deck: number
  myName?: string
  onExit: () => void
}

const FELT_BASE: React.CSSProperties = {
  backgroundColor: '#2f4560',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}

const ME = 0

export function DurakMatchN({ user, players, deck, myName, onExit }: DurakMatchNProps) {
  const felt = useMemo(
    () => ({ ...FELT_BASE, backgroundImage: `url('${equippedDurakFeltSrc()}')` }),
    [],
  )
  const [s, setS] = useState<DurakNState>(() => createGameN({ players, deck }))
  const [selPair, setSelPair] = useState<number | null>(null)

  // Bots (seats 1..n-1) auto-play until it's the human's turn or the game ends.
  useEffect(() => {
    if (s.result || s.turn === ME) return
    const id = setTimeout(() => setS((cur) => (cur.result || cur.turn === ME ? cur : botStep(cur, cur.turn))), 650)
    return () => clearTimeout(id)
  }, [s])

  const myTurn = !s.result && s.turn === ME
  const iAmDefender = s.defender === ME
  const undef = s.table.filter((p) => !p.defend).length
  const inThrowWindow = myTurn && (s.taking || (undef === 0 && s.table.length > 0))
  const takeNow = myTurn && canTake(s)

  // Which of my cards are playable right now (raised in the fan).
  const legalIds = useMemo(() => {
    if (!myTurn) return new Set<string>()
    const cards = iAmDefender && !s.taking ? legalDefends(s).cards : legalThrow(s, ME)
    return new Set(cards.map(cardId))
  }, [s, myTurn, iAmDefender])

  function playCard(c: Card) {
    if (!myTurn) return
    if (iAmDefender && !s.taking) {
      const idx = selPair ?? s.table.findIndex((p) => !p.defend)
      const next = playDefend(s, c, idx)
      if (next !== s) {
        setSelPair(null)
        setS(next)
      }
      return
    }
    const next = playAttack(s, ME, c)
    if (next !== s) setS(next)
  }

  const statusText = s.result
    ? ''
    : !myTurn
      ? t('durak.oppTurn')
      : iAmDefender && !s.taking && undef > 0
        ? t('durak.defendOrTake')
        : s.table.length === 0
          ? t('durak.attack')
          : t('durak.throwOrBeat')

  const opponents = Array.from({ length: s.n - 1 }, (_, i) => i + 1) // seats 1..n-1
  const iLost = s.result?.loser === ME
  const iWon = s.result != null && !iLost

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
      <div className="relative z-10 flex items-center px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <button
          onClick={onExit}
          aria-label="Выход"
          className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white/90 backdrop-blur active:scale-95"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-bold tracking-wide text-white/90">
          {`${t('game.durak')} · ${s.n} ${t('durakN.players')}`}
        </span>
        <span className="ml-auto flex h-9 items-center rounded-xl bg-white/95 px-3 text-[12px] font-semibold text-[#8a8a8a] shadow">
          {t('match.training')}
        </span>
      </div>

      {/* opponents row */}
      <div className="relative z-10 mt-2 flex items-start justify-around px-2">
        {opponents.map((seat) => (
          <OppTile
            key={seat}
            seat={seat}
            count={s.hands[seat].length}
            isAttacker={s.attacker === seat}
            isDefender={s.defender === seat}
            active={s.turn === seat && !s.result}
          />
        ))}
      </div>

      {/* table area */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {/* deck (left) + бито (right) */}
        <div className="pointer-events-none flex shrink-0 items-start justify-between px-2 pt-2" style={{ minHeight: 92 }}>
          {s.deck.length > 0 ? (
            <div className="relative" style={{ width: 100, height: 88 }}>
              {s.trumpCard && (
                <PlayingCard
                  card={s.trumpCard}
                  size="sm"
                  style={{ position: 'absolute', left: 30, top: 4, transform: 'rotate(90deg)', zIndex: 0 }}
                />
              )}
              <PlayingCard faceDown size="sm" style={{ position: 'absolute', left: 2, top: 4, zIndex: 2 }} />
              <PlayingCard faceDown size="sm" style={{ position: 'absolute', left: 0, top: 2, zIndex: 3 }} />
              <span className="absolute left-[-8px] top-0 z-10 grid h-6 min-w-6 place-items-center rounded-full bg-[#1c1c1c] px-1 text-xs font-extrabold text-white shadow">
                {s.deck.length}
              </span>
            </div>
          ) : (
            <span className="rounded-lg bg-black/25 px-2 py-1 text-[11px] font-bold text-white/80">
              {t('game.durak')} · {s.trump}
            </span>
          )}
          {s.discard > 0 ? (
            <div className="relative h-[56px] w-[40px]">
              <PlayingCard faceDown size="sm" style={{ position: 'absolute', left: 0, top: 0, transform: 'rotate(8deg)' }} />
              <PlayingCard faceDown size="sm" style={{ position: 'absolute', left: 0, top: 0, transform: 'rotate(-6deg)' }} />
            </div>
          ) : (
            <span />
          )}
        </div>

        {/* attack/defend pairs */}
        <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-wrap content-center items-center justify-center gap-x-2 gap-y-3 pb-1">
          {s.table.map((p, i) => {
            const targetable = iAmDefender && !s.taking && !p.defend
            return (
              <button
                key={i}
                onClick={() => targetable && setSelPair(i)}
                className="relative"
                style={{ width: 92, height: 120 }}
              >
                <div style={{ position: 'absolute', left: 2, top: 2 }}>
                  <PlayingCard
                    card={p.attack}
                    size="lg"
                    className={selPair === i ? 'ring-2 ring-[#38d66b]' : ''}
                    style={{ transform: 'rotate(-3deg)' }}
                  />
                </div>
                {p.defend && (
                  <div style={{ position: 'absolute', left: 13, top: 7, zIndex: 20 }}>
                    <PlayingCard
                      card={p.defend}
                      size="lg"
                      className="shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
                      style={{ transform: 'rotate(14deg)' }}
                    />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* status + action bar */}
      <div className="relative z-10 mb-1 text-center text-sm font-semibold text-white/85">
        {statusText}
      </div>

      {/* your hand */}
      <div className="relative z-10 flex min-h-[118px] items-end justify-center px-2">
        <div className="flex items-end">
          {s.hands[ME].map((c, i) => {
            const legal = legalIds.has(cardId(c))
            return (
              <button
                key={cardId(c)}
                onClick={() => playCard(c)}
                aria-label={`${rankLabel(c.rank)}${c.suit}`}
                style={{ marginLeft: i === 0 ? 0 : -26, zIndex: i }}
                className={`transition ${legal ? '-translate-y-3' : 'opacity-70'}`}
              >
                <PlayingCard card={c} size="lg" />
              </button>
            )
          })}
        </div>
      </div>

      {/* action bar */}
      <div className="relative z-10 flex items-center gap-2 rounded-t-3xl bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-1 gap-2">
          {takeNow && (
            <Button variant="secondary" className="flex-1" onClick={() => setS(beginTake(s))}>
              {t('match.take')}
            </Button>
          )}
          {inThrowWindow && (
            <Button className="flex-1" onClick={() => setS(enginePass(s, ME))}>
              {s.taking ? t('match.done') : s.attacker === ME ? t('match.beat') : t('durakN.pass')}
            </Button>
          )}
          {!takeNow && !inThrowWindow && (
            <span className="flex h-11 flex-1 items-center justify-center text-sm font-medium text-muted">
              {myTurn ? statusText : t('durak.oppTurn')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <div
            className={`grid h-11 w-11 place-items-center overflow-hidden rounded-xl text-white shadow ${
              s.turn === ME && !s.result ? 'ring-2 ring-[#38d66b]' : ''
            }`}
            style={{ background: 'linear-gradient(160deg,#d99a2b,#b97817)' }}
          >
            {user.photoUrl ? (
              <img src={user.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              (myName ?? displayName(user)).charAt(0).toUpperCase()
            )}
          </div>
          <span className="mt-0.5 max-w-[72px] truncate text-[10px] font-semibold text-ink">
            {myName ?? displayName(user)}
          </span>
        </div>
      </div>

      {/* game over */}
      {iWon && <Confetti />}
      {s.result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
            <p className="text-2xl font-extrabold">
              {iLost ? t('match.youLost') : t('match.youWon')}
            </p>
            <p className="mt-1 text-sm text-muted">{t('match.botUnrated')}</p>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onExit}>
                {t('match.toMenu')}
              </Button>
              <Button className="flex-1" onClick={() => setS(createGameN({ players, deck }))}>
                <RotateCcw size={16} /> {t('match.again')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Compact opponent tile: face-down fan + avatar + card count + turn/role ring. */
function OppTile({
  seat,
  count,
  isAttacker,
  isDefender,
  active,
}: {
  seat: number
  count: number
  isAttacker: boolean
  isDefender: boolean
  active: boolean
}) {
  const fan = Math.min(count, 5)
  return (
    <div className="flex flex-col items-center">
      <div className="flex h-9 items-start justify-center">
        {Array.from({ length: fan }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-[4px] shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
            style={{ width: 22, height: 32, marginLeft: i === 0 ? 0 : -15, zIndex: i }}
          >
            <img src={equippedDurakBackSrc()} alt="" className="h-full w-full object-cover" />
          </div>
        ))}
      </div>
      <div
        className={`relative mt-1 grid h-10 w-10 place-items-center rounded-xl text-white shadow ${
          active ? 'ring-2 ring-[#38d66b]' : isDefender ? 'ring-2 ring-[#e24b4a]/80' : ''
        }`}
        style={{ background: 'linear-gradient(160deg,#6d8298,#4b5f73)' }}
      >
        {seat + 1}
        {count > 0 && (
          <span className="absolute -bottom-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#1c1c1c] px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </div>
      <span className="mt-0.5 text-[10px] font-semibold text-white/80">
        {isAttacker ? '⚔' : isDefender ? '🛡' : ''} {t('durakN.bot')} {seat}
      </span>
    </div>
  )
}
