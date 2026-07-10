import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, Plus, Send, LogOut, Play, Users } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { getSocket } from '../lib/socket'
import { shareJoinLink } from '../lib/telegram'
import { t } from '../lib/i18n'
import type { LobbyCfg } from './DurakSetup'

interface LobbyRow {
  roomId: string
  host: string
  names: string[]
  filled: number
  capacity: number
  deck: number
  transfer: boolean
  neighborsOnly: boolean
  allowDraw: boolean
}

interface LobbyState {
  roomId: string
  host: string
  isHost: boolean
  capacity: number
  filled: number
  deck: number
  transfer: boolean
  neighborsOnly: boolean
  allowDraw: boolean
  seats: { name: string; vip: boolean }[]
}

interface DurakLobbyProps {
  mode: 'browse' | 'create'
  cfg: LobbyCfg
  onBack: () => void
}

/** Compact config chips for a durak game (deck size + modes). */
function ConfigChips({
  deck,
  transfer,
  neighborsOnly,
  allowDraw,
}: {
  deck: number
  transfer: boolean
  neighborsOnly: boolean
  allowDraw: boolean
}) {
  const chip = 'rounded-md bg-black/10 px-1.5 py-0.5 text-[10px] font-bold text-muted'
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={chip}>{deck}</span>
      <span className={chip}>{transfer ? t('durak.mode.perevodnoy') : t('durak.mode.podkidnoy')}</span>
      <span className={chip}>{neighborsOnly ? t('durak.mode.sosedi') : t('durak.mode.vse')}</span>
      {allowDraw && <span className={chip}>{t('durak.mode.nichya')}</span>}
    </div>
  )
}

export function DurakLobby({ mode, cfg, onBack }: DurakLobbyProps) {
  const [view, setView] = useState<'list' | 'waiting'>(mode === 'create' ? 'waiting' : 'list')
  const [lobbies, setLobbies] = useState<LobbyRow[]>([])
  const [current, setCurrent] = useState<LobbyState | null>(null)
  const [notice, setNotice] = useState('')
  const currentRef = useRef<LobbyState | null>(null)
  currentRef.current = current

  useEffect(() => {
    const s = getSocket()
    const onList = (list: LobbyRow[]) => setLobbies(list)
    const onState = (st: LobbyState) => {
      setCurrent(st)
      setView('waiting')
    }
    const onGone = () => {
      setNotice(t('lobby.gone'))
      setCurrent(null)
      setView('list')
      s.emit('lobby:subscribe')
    }
    s.on('lobby:list', onList)
    s.on('lobby:state', onState)
    s.on('lobby:gone', onGone)

    if (mode === 'create') s.emit('lobby:create', cfg)
    else s.emit('lobby:subscribe')

    return () => {
      s.off('lobby:list', onList)
      s.off('lobby:state', onState)
      s.off('lobby:gone', onGone)
      s.emit('lobby:unsubscribe')
      // leave any open lobby we were waiting in (server ignores started games)
      if (currentRef.current) s.emit('lobby:leave', { roomId: currentRef.current.roomId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const join = (roomId: string) => {
    setNotice('')
    getSocket().emit('lobby:join', { roomId })
  }
  const createHere = () => {
    setNotice('')
    getSocket().emit('lobby:create', cfg)
  }
  const refresh = () => getSocket().emit('lobby:subscribe')
  const leave = () => {
    const s = getSocket()
    if (current) s.emit('lobby:leave', { roomId: current.roomId })
    setCurrent(null)
    setView('list')
    s.emit('lobby:subscribe')
  }
  const startWithBots = () => current && getSocket().emit('lobby:start', { roomId: current.roomId })
  const invite = () => current && shareJoinLink(current.roomId, t('lobby.shareText'))

  // ── Waiting room ──
  if (view === 'waiting' && current) {
    const empty = current.capacity - current.filled
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={leave}
            aria-label="Назад"
            className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-2xl font-extrabold">{t('lobby.waiting')}</h1>
        </div>

        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <ConfigChips
              deck={current.deck}
              transfer={current.transfer}
              neighborsOnly={current.neighborsOnly}
              allowDraw={current.allowDraw}
            />
            <span className="flex items-center gap-1 rounded-full bg-gold-light/60 px-2.5 py-1 text-sm font-extrabold text-gold-dark">
              <Users size={14} /> {current.filled}/{current.capacity}
            </span>
          </div>

          {/* seat slots */}
          <div className="space-y-2">
            {current.seats.map((p, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-black/5 px-3 py-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-b from-gold to-gold-dark text-sm font-extrabold text-white">
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 truncate font-bold">{p.name}</span>
                {i === 0 && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-muted">
                    {t('lobby.host')}
                  </span>
                )}
                {p.vip && (
                  <span className="rounded-full bg-gradient-to-b from-gold to-gold-dark px-1.5 text-[9px] font-bold text-white">
                    VIP
                  </span>
                )}
              </div>
            ))}
            {Array.from({ length: empty }).map((_, i) => (
              <div
                key={`e${i}`}
                className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-muted"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-black/5 text-sm">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-muted" />
                </span>
                <span className="flex-1 text-sm">{t('lobby.waiting')}…</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          <Button size="lg" className="w-full" onClick={invite}>
            <Send size={18} /> {t('lobby.invite')}
          </Button>
          {current.isHost && (
            <Button size="lg" variant="secondary" className="w-full" onClick={startWithBots}>
              <Play size={18} /> {t('lobby.startBots')}
            </Button>
          )}
          <Button size="lg" variant="ghost" className="w-full" onClick={leave}>
            <LogOut size={18} /> {t('lobby.leave')}
          </Button>
        </div>
      </div>
    )
  }

  // ── Browse list ──
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold">{t('lobby.title')}</h1>
        <button
          onClick={refresh}
          aria-label={t('lobby.refresh')}
          className="ml-auto grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-muted active:scale-95"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {notice && (
        <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
          {notice}
        </div>
      )}

      <Button size="lg" className="w-full" onClick={createHere}>
        <Plus size={18} /> {t('lobby.create')}
      </Button>

      {lobbies.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="font-bold">{t('lobby.empty')}</p>
          <p className="mt-1 text-sm text-muted">{t('lobby.emptyHint')}</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {lobbies.map((l) => (
            <Card key={l.roomId} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{l.names.join(', ') || l.host}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="flex items-center gap-1 rounded-full bg-gold-light/60 px-2 py-0.5 text-xs font-extrabold text-gold-dark">
                    <Users size={12} /> {l.filled}/{l.capacity}
                  </span>
                  <ConfigChips
                    deck={l.deck}
                    transfer={l.transfer}
                    neighborsOnly={l.neighborsOnly}
                    allowDraw={l.allowDraw}
                  />
                </div>
              </div>
              <Button size="sm" onClick={() => join(l.roomId)}>
                {t('lobby.join')}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
