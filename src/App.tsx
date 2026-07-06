import { useEffect, useState } from 'react'
import { ChevronRight, Swords } from 'lucide-react'
import { BottomNav, type Tab } from './components/BottomNav'
import { InviteBanner } from './components/InviteBanner'
import { Home } from './screens/Home'
import { Store } from './screens/Store'
import { Profile } from './screens/Profile'
import { Friends } from './screens/Friends'
import { NewChessGame } from './screens/NewChessGame'
import { ChessMatch, hasChessSave, readChessSave } from './screens/ChessMatch'
import { DurakMatch, hasDurakSave } from './screens/DurakMatch'
import { DurakSetup, type DurakConfig } from './screens/DurakSetup'
import { NardyMatch } from './screens/NardyMatch'
import { NardySetup, type NardyConfig } from './screens/NardySetup'
import { Matchmaking } from './screens/Matchmaking'
import { initTelegram, displayName, type TgUser } from './lib/telegram'
import {
  getSocket,
  registerUser,
  type IncomingInvite,
  type MatchConfig,
} from './lib/socket'

type SubScreen =
  | 'friends'
  | 'chess-setup'
  | 'durak-setup'
  | 'durak'
  | 'nardy-setup'
  | 'nardy'
  | null

export default function App() {
  const [tab, setTab] = useState<Tab>('games')
  const [sub, setSub] = useState<SubScreen>(null)
  const [durakCfg, setDurakCfg] = useState<DurakConfig | null>(null)
  const [nardyCfg, setNardyCfg] = useState<NardyConfig | null>(null)
  const [durakResume, setDurakResume] = useState(false)
  const [durakSaved, setDurakSaved] = useState(() => hasDurakSave())
  const [chessSaved, setChessSaved] = useState(() => hasChessSave())
  const [user, setUser] = useState<TgUser | null>(null)
  const [match, setMatch] = useState<MatchConfig | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [matchmaking, setMatchmaking] = useState<{
    minutes: number
    label?: string
  } | null>(null)
  const [invite, setInvite] = useState<IncomingInvite | null>(null)

  useEffect(() => {
    const u = initTelegram()
    setUser(u)
    const userId = u.id
      ? String(u.id)
      : `guest_${Math.random().toString(36).slice(2, 8)}`
    registerUser({ userId, name: displayName(u), elo: 2350 })

    const s = getSocket()
    const onFound = (m: {
      roomId: string
      color: 'w' | 'b'
      minutes: number
      opponent: { name: string; elo: number }
      fen: string
      clocks: { w: number; b: number }
    }) => {
      setMatch({ mode: 'online', ...m })
      setMatchmaking(null)
      setMinimized(false)
      setSub(null)
    }
    const onInvite = (inv: IncomingInvite) => setInvite(inv)
    s.on('match:found', onFound)
    s.on('invite:incoming', onInvite)
    return () => {
      s.off('match:found', onFound)
      s.off('invite:incoming', onInvite)
    }
  }, [])

  if (!user) return null

  function startQuick(minutes: number) {
    getSocket().emit('quickMatch', { game: 'chess', minutes })
    setMatchmaking({ minutes })
    setSub(null)
  }
  function inviteFriend(friendUserId: string, minutes: number) {
    getSocket().emit('invite', { toUserId: friendUserId, game: 'chess', minutes })
    setMatchmaking({ minutes, label: 'Ждём соперника…' })
    setSub(null)
  }
  function acceptInvite() {
    if (!invite) return
    getSocket().emit('joinRoom', { roomId: invite.roomId })
    setInvite(null)
  }
  function cancelMatchmaking() {
    getSocket().emit('cancelQuick')
    setMatchmaking(null)
  }

  const inMatchFull = match && !minimized

  const resumeBanner =
    match && minimized ? (
      <button
        onClick={() => setMinimized(false)}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-gold bg-gold-light/40 p-3 text-left"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-gold to-gold-dark text-white">
          <Swords size={20} />
        </div>
        <div className="flex-1">
          <p className="font-bold leading-tight">Вернуться в партию</p>
          <p className="text-xs text-muted">Шахматы · идёт игра</p>
        </div>
        <ChevronRight size={18} className="text-muted" />
      </button>
    ) : null

  const durakBanner =
    durakSaved && sub !== 'durak' ? (
      <button
        onClick={() => {
          setDurakResume(true)
          setSub('durak')
        }}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-gold bg-gold-light/40 p-3 text-left"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-gold to-gold-dark text-white">
          <Swords size={20} />
        </div>
        <div className="flex-1">
          <p className="font-bold leading-tight">Вернуться в партию</p>
          <p className="text-xs text-muted">Дурак · идёт игра</p>
        </div>
        <ChevronRight size={18} className="text-muted" />
      </button>
    ) : null

  // resume a chess game that survived an app close (local/bot)
  const chessBanner =
    chessSaved && !match ? (
      <button
        onClick={() => {
          const sv = readChessSave()
          if (!sv) {
            setChessSaved(false)
            return
          }
          setMatch({
            mode: 'local',
            minutes: sv.minutes,
            bot: sv.bot,
            restoreFen: sv.fen,
            restoreClocks: sv.clocks,
          })
          setMinimized(false)
        }}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-gold bg-gold-light/40 p-3 text-left"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-gold to-gold-dark text-white">
          <Swords size={20} />
        </div>
        <div className="flex-1">
          <p className="font-bold leading-tight">Вернуться в партию</p>
          <p className="text-xs text-muted">Шахматы · идёт игра</p>
        </div>
        <ChevronRight size={18} className="text-muted" />
      </button>
    ) : null

  const banners = (
    <>
      {resumeBanner}
      {chessBanner}
      {durakBanner}
    </>
  )

  return (
    <div
      className="mx-auto flex max-w-md flex-col bg-bg"
      style={{ height: 'var(--app-h, 100dvh)' }}
    >
      {/* Match layer — kept mounted to preserve state; hidden when minimized */}
      {match && (
        <div
          className={
            inMatchFull
              ? 'flex flex-1 flex-col overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-6'
              : 'hidden'
          }
        >
          <ChessMatch
            user={user}
            match={match}
            onMinimize={() => setMinimized(true)}
            onExit={() => {
              setMatch(null)
              setMinimized(false)
              setChessSaved(hasChessSave())
            }}
          />
        </div>
      )}

      {/* Normal app — hidden while a match is fullscreen */}
      {!inMatchFull && (
        <>
          <main className="flex-1 overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-6">
            {invite && (
              <InviteBanner
                invite={invite}
                onAccept={acceptInvite}
                onDecline={() => setInvite(null)}
              />
            )}
            {matchmaking ? (
              <Matchmaking
                minutes={matchmaking.minutes}
                label={matchmaking.label}
                onCancel={cancelMatchmaking}
              />
            ) : sub === 'friends' ? (
              <Friends onBack={() => setSub(null)} />
            ) : sub === 'durak-setup' ? (
              <DurakSetup
                onBack={() => setSub(null)}
                onCreate={(cfg) => {
                  setDurakCfg(cfg)
                  setDurakResume(false)
                  setSub('durak')
                }}
              />
            ) : sub === 'durak' ? (
              <DurakMatch
                user={user}
                config={durakCfg}
                resume={durakResume}
                onExit={() => {
                  setSub(null)
                  setDurakResume(false)
                  setDurakSaved(hasDurakSave())
                }}
              />
            ) : sub === 'nardy-setup' ? (
              <NardySetup
                onBack={() => setSub(null)}
                onCreate={(cfg) => {
                  setNardyCfg(cfg)
                  setSub('nardy')
                }}
              />
            ) : sub === 'nardy' ? (
              <NardyMatch
                user={user}
                config={nardyCfg}
                onExit={() => setSub(null)}
              />
            ) : sub === 'chess-setup' ? (
              <NewChessGame
                onBack={() => setSub(null)}
                onQuickMatch={startQuick}
                onInvite={inviteFriend}
                onBot={(minutes) => {
                  setMatch({ mode: 'local', minutes, bot: true })
                  setMinimized(false)
                  setSub(null)
                }}
              />
            ) : (
              <>
                {tab === 'games' && (
                  <Home
                    user={user}
                    onOpenProfile={() => setTab('profile')}
                    onPlay={(id) => {
                      if (id === 'chess') setSub('chess-setup')
                      else if (id === 'durak') setSub('durak-setup')
                      else if (id === 'backgammon') setSub('nardy-setup')
                    }}
                    resumeBanner={banners}
                  />
                )}
                {tab === 'store' && (
                  <>
                    {banners}
                    <Store />
                  </>
                )}
                {tab === 'profile' && (
                  <>
                    {banners}
                    <Profile user={user} onOpenFriends={() => setSub('friends')} />
                  </>
                )}
              </>
            )}
          </main>
          {sub === null && !matchmaking && (
            <BottomNav active={tab} onChange={setTab} />
          )}
        </>
      )}
    </div>
  )
}
