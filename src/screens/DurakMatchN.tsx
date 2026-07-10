import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, RotateCcw } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PlayingCard } from '../components/PlayingCard'
import { Confetti } from '../components/Confetti'
import { HandFan, CardFan, PlayerTile } from './DurakMatch'
import { equippedDurakFeltSrc } from '../lib/skins'
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
  const [drag, setDrag] = useState<{ card: Card; x: number; y: number } | null>(null)
  const [selIdx, setSelIdx] = useState(-1)

  // Bots (seats 1..n-1) auto-play until it's the human's turn or the game ends.
  useEffect(() => {
    if (s.result || s.turn === ME) return
    const id = setTimeout(
      () => setS((cur) => (cur.result || cur.turn === ME ? cur : botStep(cur, cur.turn))),
      650,
    )
    return () => clearTimeout(id)
  }, [s])

  const myTurn = !s.result && s.turn === ME
  const iAmDefender = s.defender === ME
  const undef = s.table.filter((p) => !p.defend).length
  const defendingNow = iAmDefender && !s.taking && undef > 0
  const inThrowWindow = myTurn && (s.taking || (undef === 0 && s.table.length > 0))
  const takeNow = myTurn && canTake(s)

  const apply = (next: DurakNState) => {
    if (next !== s) setS(next)
  }

  // Drop a card at a screen point — the engine validates; illegal = snap back.
  function playAt(card: Card, x: number, y: number) {
    if (!defendingNow) {
      apply(playAttack(s, ME, card)) // attacker / thrower — a light flick plays it
      return
    }
    const el = document.elementFromPoint(x, y)
    const pairEl = el?.closest<HTMLElement>('[data-pair]')
    const pair = pairEl ? Number(pairEl.dataset.pair) : s.table.findIndex((p) => !p.defend)
    apply(playDefend(s, card, pair))
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
        const card = s.hands[ME][sel]
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
      const card = s.hands[ME][sel]
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
        ? t('durak.defendOrTake')
        : s.table.length === 0
          ? t('durak.attack')
          : t('durak.throwOrBeat')

  const opponents = Array.from({ length: s.n - 1 }, (_, i) => i + 1)
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
      <div className="relative z-10 flex items-center px-3 pt-[calc(0.4rem+env(safe-area-inset-top))]">
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
      <div className="relative z-10 mt-1 flex items-start justify-around px-1">
        {opponents.map((seat) => (
          <div key={seat} className="flex w-[86px] flex-col items-center">
            <PlayerTile
              name={`${t('durakN.bot')} ${seat}`}
              active={s.turn === seat && !s.result}
              progress={null}
              labelTop
            />
            <CardFan count={s.hands[seat].length} />
          </div>
        ))}
      </div>

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
                className={p.by === ME ? 'gh-drop-bottom' : 'gh-drop-top'}
                style={{ position: 'absolute', left: 2, top: 2 }}
              >
                <PlayingCard card={p.attack} size="lg" style={{ transform: 'rotate(-3deg)' }} />
              </div>
              {p.defend && (
                <div
                  className={s.defender === ME ? 'gh-drop-bottom' : 'gh-drop-top'}
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
          cards={s.hands[ME]}
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
            <Button size="sm" variant="secondary" className="w-full" onClick={() => apply(beginTake(s))}>
              {t('match.take')}
            </Button>
          ) : inThrowWindow ? (
            <Button size="sm" className="w-full" onClick={() => apply(enginePass(s, ME))}>
              {s.taking ? t('match.done') : s.attacker === ME ? t('match.beat') : t('durakN.pass')}
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
            progress={null}
            photo={user.photoUrl}
            you
            onLight
          />
        </div>
        <div className="w-24 shrink-0" />
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

      {/* game over */}
      {iWon && <Confetti />}
      {s.result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
            <p className="text-2xl font-extrabold">{iLost ? t('match.youLost') : t('match.youWon')}</p>
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
