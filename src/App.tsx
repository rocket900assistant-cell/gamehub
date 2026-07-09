import { useEffect, useState } from 'react'
import { ChevronRight, Swords } from 'lucide-react'
import { BottomNav, type Tab } from './components/BottomNav'
import { InviteBanner } from './components/InviteBanner'
import { Home } from './screens/Home'
import { Store } from './screens/Store'
import { Profile } from './screens/Profile'
import { Friends } from './screens/Friends'
import { FriendInvite } from './screens/FriendInvite'
import { History } from './screens/History'
import { NewChessGame } from './screens/NewChessGame'
import { ChessMatch, hasChessSave, readChessSave } from './screens/ChessMatch'
import { DurakMatch, hasDurakSave, type OnlineDurak } from './screens/DurakMatch'
import { DurakSetup, type DurakConfig } from './screens/DurakSetup'
import { NardyMatch, hasNardySave, type OnlineNardy } from './screens/NardyMatch'
import { NardySetup, type NardyConfig } from './screens/NardySetup'
import { Matchmaking } from './screens/Matchmaking'
import { isVip, syncVip } from './lib/skins'
import {
  initTelegram,
  displayName,
  getInitData,
  getStartParam,
  type TgUser,
} from './lib/telegram'
import {
  getSocket,
  registerUser,
  addFriend,
  requestFriends,
  requestHistory,
  inviteFriend as emitInviteFriend,
  type IncomingInvite,
  type MatchConfig,
  type Profile as PlayerProfile,
  type ServerFriend,
  type HistoryEntry,
} from './lib/socket'

type SubScreen =
  | 'friends'
  | 'chess-setup'
  | 'durak-setup'
  | 'durak'
  | 'nardy-setup'
  | 'nardy'
  | 'invite'
  | 'history'
  | null

interface PendingInvite {
  game: 'durak' | 'nardy'
  minutes: number
  transfer?: boolean
  label: string
}

export default function App() {
  const [tab, setTab] = useState<Tab>('games')
  const [sub, setSub] = useState<SubScreen>(null)
  const [durakCfg, setDurakCfg] = useState<DurakConfig | null>(null)
  const [nardyCfg, setNardyCfg] = useState<NardyConfig | null>(null)
  const [durakResume, setDurakResume] = useState(false)
  const [durakSaved, setDurakSaved] = useState(() => hasDurakSave())
  const [chessSaved, setChessSaved] = useState(() => hasChessSave())
  const [nardyResume, setNardyResume] = useState(false)
  const [nardySaved, setNardySaved] = useState(() => hasNardySave())
  const [user, setUser] = useState<TgUser | null>(null)
  const [match, setMatch] = useState<MatchConfig | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [matchmaking, setMatchmaking] = useState<{
    minutes: number
    label?: string
    subtitle?: string
  } | null>(null)
  const [invite, setInvite] = useState<IncomingInvite | null>(null)
  // seed from the last cached profile so real values show instantly (no mock flash)
  const [profile, setProfile] = useState<PlayerProfile | null>(() => {
    try {
      const raw = localStorage.getItem('gh_profile')
      return raw ? (JSON.parse(raw) as PlayerProfile) : null
    } catch {
      return null
    }
  })
  const [nardyOnline, setNardyOnline] = useState<OnlineNardy | null>(null)
  const [durakOnline, setDurakOnline] = useState<OnlineDurak | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [friends, setFriends] = useState<ServerFriend[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null)

  useEffect(() => {
    const u = initTelegram()
    setUser(u)
    // Per-device id: lets the SAME Telegram account play from two phones
    // (real users already differ by telegram id). Persisted so reloads keep it.
    let deviceId = localStorage.getItem('gh_device')
    if (!deviceId) {
      deviceId = Math.random().toString(36).slice(2, 10)
      localStorage.setItem('gh_device', deviceId)
    }
    const userId = `${u.id ? u.id : 'guest'}_${deviceId}`
    const doRegister = () => {
      registerUser({
        userId,
        name: displayName(u),
        elo: 2350,
        initData: getInitData(),
        username: u.username,
        photoUrl: u.photoUrl,
        vip: isVip(),
      })
      requestFriends()
    }
    doRegister()

    const s = getSocket()
    // re-register on every (re)connect so the server can resume an active game
    s.on('connect', doRegister)
    const onProfile = (p: PlayerProfile) => {
      setProfile(p)
      syncVip(!!p.vip)
      try {
        localStorage.setItem('gh_profile', JSON.stringify(p))
      } catch {
        // ignore quota
      }
    }
    s.on('profile', onProfile)
    const onFound = (m: {
      roomId: string
      color: 'w' | 'b'
      minutes: number
      opponent: { name: string; elo: number; vip?: boolean }
      game?: string
      elo?: number
      fen?: string
      clocks?: { w: number; b: number }
      nardy?: OnlineNardy['initial']
      durak?: OnlineDurak['initial']
      deadline?: number
    }) => {
      setMatchmaking(null)
      setSub(null)
      if (m.game === 'nardy' && m.nardy) {
        setNardyOnline({
          roomId: m.roomId,
          color: m.color,
          opponentName: m.opponent?.name ?? 'Соперник',
          opponentElo: m.opponent?.elo ?? 1200,
          opponentVip: m.opponent?.vip,
          myElo: m.elo ?? 1200,
          initial: m.nardy,
          deadline: m.deadline ?? Date.now() + 120000,
        })
        return
      }
      if (m.game === 'durak' && m.durak) {
        setDurakOnline({
          roomId: m.roomId,
          opponentName: m.opponent?.name ?? 'Соперник',
          opponentElo: m.opponent?.elo ?? 1200,
          opponentVip: m.opponent?.vip,
          myElo: m.elo ?? 1200,
          initial: m.durak,
          deadline: m.deadline ?? Date.now() + 60000,
        })
        return
      }
      setMatch({
        mode: 'online',
        roomId: m.roomId,
        color: m.color,
        minutes: m.minutes,
        opponent: m.opponent,
        fen: m.fen!,
        clocks: m.clocks!,
      })
      setMinimized(false)
    }
    const onInvite = (inv: IncomingInvite) => setInvite(inv)
    const onNotFound = () => {
      setMatchmaking(null)
      setJoinError('Партия не найдена или уже началась')
    }
    const onFriends = (list: ServerFriend[]) => setFriends(list)
    const onHistory = (list: HistoryEntry[]) => setHistory(list)
    const onInviteOffline = () => {
      setMatchmaking(null)
      setJoinError('Друг сейчас не в сети')
    }
    s.on('match:found', onFound)
    s.on('invite:incoming', onInvite)
    s.on('room:notfound', onNotFound)
    s.on('friends', onFriends)
    s.on('history', onHistory)
    s.on('invite:offline', onInviteOffline)

    // Opened via a deep link.
    const sp = getStartParam()
    if (sp && sp.startsWith('join_')) {
      // friend's game-invite link → join their room straight away.
      s.emit('joinRoom', { roomId: sp.slice(5) })
      setMatchmaking({ minutes: 0, label: 'Заходим в игру…', subtitle: 'Подключение к сопернику' })
    } else if (sp && sp.startsWith('friend_')) {
      // friend-add link → become mutual friends (after register is sent).
      addFriend(sp.slice(7))
    }

    return () => {
      s.off('connect', doRegister)
      s.off('profile', onProfile)
      s.off('match:found', onFound)
      s.off('invite:incoming', onInvite)
      s.off('room:notfound', onNotFound)
      s.off('friends', onFriends)
      s.off('history', onHistory)
      s.off('invite:offline', onInviteOffline)
    }
  }, [])

  if (!user) return null

  function startQuick(minutes: number) {
    getSocket().emit('quickMatch', { game: 'chess', minutes })
    setMatchmaking({ minutes })
    setSub(null)
  }
  function inviteFriend(
    toTg: number,
    game: 'chess' | 'durak' | 'nardy',
    minutes: number,
    transfer?: boolean,
  ) {
    emitInviteFriend(toTg, game, minutes, transfer)
    const label = game === 'chess' ? 'Шахматы' : game === 'durak' ? 'Дурак' : 'Нарды'
    setMatchmaking({ minutes, label: 'Ждём друга…', subtitle: `${label} · по приглашению` })
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
          // the clock of the side to move keeps running while the app is closed
          const elapsed = Date.now() - (sv.savedAt ?? Date.now())
          const side = sv.fen.split(' ')[1] === 'b' ? 'b' : 'w'
          const clocks = {
            ...sv.clocks,
            [side]: Math.max(0, sv.clocks[side] - elapsed),
          }
          setMatch({
            mode: 'local',
            minutes: sv.minutes,
            bot: sv.bot,
            restoreFen: sv.fen,
            restoreClocks: clocks,
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

  const nardyBanner =
    nardySaved && sub !== 'nardy' ? (
      <button
        onClick={() => {
          setNardyResume(true)
          setSub('nardy')
        }}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-gold bg-gold-light/40 p-3 text-left"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-gold to-gold-dark text-white">
          <Swords size={20} />
        </div>
        <div className="flex-1">
          <p className="font-bold leading-tight">Вернуться в партию</p>
          <p className="text-xs text-muted">Нарды · идёт игра</p>
        </div>
        <ChevronRight size={18} className="text-muted" />
      </button>
    ) : null

  const banners = (
    <>
      {resumeBanner}
      {chessBanner}
      {durakBanner}
      {nardyBanner}
    </>
  )

  return (
    <div
      className="mx-auto flex max-w-md flex-col bg-bg"
      style={{ height: 'var(--app-h, 100dvh)' }}
    >
      {joinError && (
        <button
          onClick={() => setJoinError(null)}
          className="fixed left-1/2 top-3 z-[60] -translate-x-1/2 rounded-2xl bg-danger px-4 py-2 text-sm font-bold text-white shadow-lg"
        >
          {joinError}
        </button>
      )}

      {/* Match layer — kept mounted to preserve state; hidden when minimized */}
      {match && !nardyOnline && !durakOnline && (
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

      {/* Online Nardy — fullscreen while active */}
      {nardyOnline && (
        <main className="flex flex-1 flex-col overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-6">
          <NardyMatch
            user={user}
            config={null}
            online={nardyOnline}
            onExit={() => setNardyOnline(null)}
          />
        </main>
      )}

      {/* Online Durak — fullscreen while active */}
      {durakOnline && (
        <main className="flex flex-1 flex-col overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-6">
          <DurakMatch
            user={user}
            config={null}
            online={durakOnline}
            onExit={() => setDurakOnline(null)}
          />
        </main>
      )}

      {/* Normal app — hidden while a match is fullscreen */}
      {!inMatchFull && !nardyOnline && !durakOnline && (
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
                subtitle={matchmaking.subtitle}
                onCancel={cancelMatchmaking}
              />
            ) : sub === 'friends' ? (
              <Friends friends={friends} myId={user.id} onBack={() => setSub(null)} />
            ) : sub === 'history' ? (
              <History list={history} onBack={() => setSub(null)} />
            ) : sub === 'invite' && pendingInvite ? (
              <FriendInvite
                title="Игра с другом"
                subtitle={pendingInvite.label}
                game={pendingInvite.game}
                minutes={pendingInvite.minutes}
                transfer={pendingInvite.transfer}
                friends={friends}
                shareText="Заходи сыграть со мной в GameHub!"
                onBack={() => setSub(pendingInvite.game === 'durak' ? 'durak-setup' : 'nardy-setup')}
                onInviteFriend={(tg) =>
                  inviteFriend(tg, pendingInvite.game, pendingInvite.minutes, pendingInvite.transfer)
                }
              />
            ) : sub === 'durak-setup' ? (
              <DurakSetup
                onBack={() => setSub(null)}
                onCreate={(cfg) => {
                  setDurakCfg(cfg)
                  setDurakResume(false)
                  setSub('durak')
                }}
                onQuickMatch={(deck, transfer) => {
                  getSocket().emit('quickMatch', { game: 'durak', minutes: deck, transfer })
                  setMatchmaking({
                    minutes: deck,
                    label: 'Поиск соперника…',
                    subtitle: `Дурак · ${deck} карт${transfer ? ' · переводной' : ''}`,
                  })
                  setSub(null)
                }}
                onInvite={(deck, transfer) => {
                  setPendingInvite({
                    game: 'durak',
                    minutes: deck,
                    transfer,
                    label: `Дурак · ${deck} карт${transfer ? ' · переводной' : ''}`,
                  })
                  setSub('invite')
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
                  setNardyResume(false)
                  setSub('nardy')
                }}
                onQuickMatch={() => {
                  getSocket().emit('quickMatch', { game: 'nardy', minutes: 2 })
                  setMatchmaking({
                    minutes: 2,
                    label: 'Поиск соперника…',
                    subtitle: 'Нарды · 2 мин',
                  })
                  setSub(null)
                }}
                onInvite={() => {
                  setPendingInvite({ game: 'nardy', minutes: 2, label: 'Нарды · 2 мин' })
                  setSub('invite')
                }}
              />
            ) : sub === 'nardy' ? (
              <NardyMatch
                user={user}
                config={nardyCfg}
                resume={nardyResume}
                onExit={() => {
                  setSub(null)
                  setNardyResume(false)
                  setNardySaved(hasNardySave())
                }}
              />
            ) : sub === 'chess-setup' ? (
              <NewChessGame
                friends={friends}
                onBack={() => setSub(null)}
                onQuickMatch={startQuick}
                onInvite={(tg, minutes) => inviteFriend(tg, 'chess', minutes)}
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
                    profile={profile}
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
                    <Store balance={profile?.balance ?? 0} />
                  </>
                )}
                {tab === 'profile' && (
                  <>
                    {banners}
                    <Profile
                      user={user}
                      profile={profile}
                      friendsCount={friends.length}
                      onOpenFriends={() => setSub('friends')}
                      onOpenHistory={() => {
                        requestHistory()
                        setSub('history')
                      }}
                    />
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
