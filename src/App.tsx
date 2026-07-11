import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Swords } from 'lucide-react'
import { BottomNav, type Tab } from './components/BottomNav'
import { InviteBanner } from './components/InviteBanner'
import { Home } from './screens/Home'
import { Store } from './screens/Store'
import { Wallet } from './screens/Wallet'
import { WithdrawAdmin } from './screens/WithdrawAdmin'
import { Profile } from './screens/Profile'
import { Friends } from './screens/Friends'
import { FriendInvite } from './screens/FriendInvite'
import { History } from './screens/History'
import { NewChessGame } from './screens/NewChessGame'
import { ChessMatch, hasChessSave, readChessSave } from './screens/ChessMatch'
import { DurakMatch, hasDurakSave, type OnlineDurak } from './screens/DurakMatch'
import { DurakMatchN, type OnlineDurakN } from './screens/DurakMatchN'
import { DurakSetup, type DurakConfig, type LobbyCfg } from './screens/DurakSetup'
import { DurakLobby, type LobbyState } from './screens/DurakLobby'
import { NardyMatch, hasNardySave, type OnlineNardy } from './screens/NardyMatch'
import { NardySetup, type NardyConfig } from './screens/NardySetup'
import { Matchmaking } from './screens/Matchmaking'
import { isVip, syncVip, syncEntitlements, grantSkin } from './lib/skins'
import { onLangChange, t } from './lib/i18n'
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
  requestEloTrend,
  inviteFriend as emitInviteFriend,
  type IncomingInvite,
  type MatchConfig,
  type Profile as PlayerProfile,
  type ServerFriend,
  type FriendRequest,
  type HistoryEntry,
  type EloTrend,
} from './lib/socket'

type SubScreen =
  | 'friends'
  | 'chess-setup'
  | 'durak-setup'
  | 'durak'
  | 'durak-lobby'
  | 'nardy-setup'
  | 'nardy'
  | 'durakN'
  | 'invite'
  | 'history'
  | 'wallet'
  | 'withdrawals-admin'
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
  const subRef = useRef<SubScreen>(null)
  subRef.current = sub
  const [durakCfg, setDurakCfg] = useState<DurakConfig | null>(null)
  const [durakNCfg, setDurakNCfg] = useState<{ players: number; deck: number; neighborsOnly: boolean; transfer: boolean; allowDraw: boolean } | null>(null)
  const [durakLobby, setDurakLobby] = useState<{ mode: 'browse' | 'create' | 'joined'; cfg: LobbyCfg; initial?: LobbyState } | null>(null)
  const [owner, setOwner] = useState(false)
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
  const [durakNOnline, setDurakNOnline] = useState<OnlineDurakN | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [friends, setFriends] = useState<ServerFriend[]>([])
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [eloTrend, setEloTrend] = useState<EloTrend | null>(null)
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null)
  const [, forceLang] = useState(0)
  useEffect(() => onLangChange(() => forceLang((x) => x + 1)), [])

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
        elo: 1200,
        initData: getInitData(),
        username: u.username,
        photoUrl: u.photoUrl,
        vip: isVip(),
      })
      requestFriends()
      requestEloTrend()
    }
    doRegister()

    const s = getSocket()
    // re-register on every (re)connect so the server can resume an active game
    s.on('connect', doRegister)
    const onProfile = (p: PlayerProfile) => {
      setProfile(p)
      syncVip(!!p.vip)
      requestEloTrend() // refresh the sparkline after a rated game
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
      opponent: { name: string; elo: number; vip?: boolean; photoUrl?: string | null }
      game?: string
      elo?: number
      fen?: string
      clocks?: { w: number; b: number }
      nardy?: OnlineNardy['initial']
      durak?: OnlineDurak['initial']
      durakn?: OnlineDurakN['initial']
      seat?: number
      players?: number
      seats?: OnlineDurakN['seats']
      deadline?: number
    }) => {
      setMatchmaking(null)
      setSub(null)
      if (m.game === 'durakn' && m.durakn) {
        setDurakNOnline({
          roomId: m.roomId,
          seat: m.seat ?? 0,
          players: m.players ?? m.durakn.n,
          seats: m.seats ?? [],
          initial: m.durakn,
          deadline: m.deadline ?? Date.now() + 60000,
        })
        return
      }
      if (m.game === 'nardy' && m.nardy) {
        setNardyOnline({
          roomId: m.roomId,
          color: m.color,
          opponentName: m.opponent?.name ?? t('common.opponent'),
          opponentElo: m.opponent?.elo ?? 1200,
          opponentVip: m.opponent?.vip,
          opponentPhoto: m.opponent?.photoUrl,
          myElo: m.elo ?? 1200,
          initial: m.nardy,
          deadline: m.deadline ?? Date.now() + 120000,
        })
        return
      }
      if (m.game === 'durak' && m.durak) {
        setDurakOnline({
          roomId: m.roomId,
          opponentName: m.opponent?.name ?? t('common.opponent'),
          opponentElo: m.opponent?.elo ?? 1200,
          opponentVip: m.opponent?.vip,
          opponentPhoto: m.opponent?.photoUrl,
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
      setJoinError(t('invite.notFound'))
    }
    const onFriends = (list: ServerFriend[]) => setFriends(list)
    const onFriendRequests = (list: FriendRequest[]) => setFriendRequests(list)
    const onHistory = (list: HistoryEntry[]) => setHistory(list)
    const onEloTrend = (e: EloTrend) => setEloTrend(e)
    const onInviteOffline = () => {
      setMatchmaking(null)
      setJoinError(t('invite.offline'))
    }
    const onOwner = (o: { owner: boolean }) => setOwner(!!o.owner)
    const onStakeError = (e: { reason: string; balance?: number }) => {
      setMatchmaking(null)
      setJoinError(
        e.reason === 'balance'
          ? `${t('stake.insufficient')} (${e.balance ?? 0} GRAM)`
          : t('stake.min'),
      )
    }
    // A durakn lobby invite was accepted (or we joined one) while not on the
    // lobby screen → open the waiting room seeded with this state.
    const onLobbyState = (st: LobbyState) => {
      setDurakNOnline(null) // a finished round reverted to the lobby → leave the table
      if (subRef.current === 'durak-lobby') return // already in the lobby UI
      setDurakLobby({
        mode: 'joined',
        cfg: {
          players: st.capacity,
          deck: st.deck,
          transfer: st.transfer,
          neighborsOnly: st.neighborsOnly,
          allowDraw: st.allowDraw,
          stake: st.stake ?? 0,
        },
        initial: st,
      })
      setMatchmaking(null)
      setSub('durak-lobby')
    }
    // Shop: server is the source of truth for owned skins + a confirmed purchase.
    const onEntitlements = (p: { items: string[] }) => syncEntitlements(p.items ?? [])
    const onGranted = (g: { product: string }) => {
      if (g.product === 'vip') syncVip(true)
      else if (g.product.startsWith('skin:')) grantSkin(g.product.slice(5))
    }
    s.on('match:found', onFound)
    s.on('lobby:state', onLobbyState)
    s.on('invite:incoming', onInvite)
    s.on('room:notfound', onNotFound)
    s.on('friends', onFriends)
    s.on('friend:requests', onFriendRequests)
    s.on('history', onHistory)
    s.on('elo:trend', onEloTrend)
    s.on('invite:offline', onInviteOffline)
    s.on('stake:error', onStakeError)
    s.on('owner:status', onOwner)
    s.on('shop:entitlements', onEntitlements)
    s.on('shop:granted', onGranted)

    // Opened via a deep link.
    const sp = getStartParam()
    if (sp && sp.startsWith('join_')) {
      // friend's game-invite link → join their room straight away.
      s.emit('joinRoom', { roomId: sp.slice(5) })
      setMatchmaking({ minutes: 0, label: t('mm.joining'), subtitle: t('mm.connecting') })
    } else if (sp && sp.startsWith('friend_')) {
      // friend-add link → send a friend request to the link owner (they accept).
      addFriend(sp.slice(7))
    }

    return () => {
      s.off('connect', doRegister)
      s.off('profile', onProfile)
      s.off('match:found', onFound)
      s.off('lobby:state', onLobbyState)
      s.off('invite:incoming', onInvite)
      s.off('room:notfound', onNotFound)
      s.off('friends', onFriends)
      s.off('friend:requests', onFriendRequests)
      s.off('history', onHistory)
      s.off('elo:trend', onEloTrend)
      s.off('invite:offline', onInviteOffline)
      s.off('stake:error', onStakeError)
      s.off('owner:status', onOwner)
      s.off('shop:entitlements', onEntitlements)
      s.off('shop:granted', onGranted)
    }
  }, [])

  if (!user) return null
  const myName = profile?.name ?? displayName(user)

  function startQuick(minutes: number, stake = 0) {
    getSocket().emit('quickMatch', { game: 'chess', minutes, stake })
    setMatchmaking({ minutes, subtitle: stake > 0 ? `${t('game.chess')} · ${stake} GRAM` : undefined })
    setSub(null)
  }
  function inviteFriend(
    toTg: number,
    game: 'chess' | 'durak' | 'nardy',
    minutes: number,
    transfer?: boolean,
  ) {
    emitInviteFriend(toTg, game, minutes, transfer)
    const label = game === 'chess' ? t('game.chess') : game === 'durak' ? t('game.durak') : t('game.nardy')
    setMatchmaking({ minutes, label: t('mm.waitingFriend'), subtitle: `${label} · ${t('mm.byInvite')}` })
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
          <p className="font-bold leading-tight">{t('resume.title')}</p>
          <p className="text-xs text-muted">{t('game.chess')} · {t('resume.inProgress')}</p>
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
          <p className="font-bold leading-tight">{t('resume.title')}</p>
          <p className="text-xs text-muted">{t('game.durak')} · {t('resume.inProgress')}</p>
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
          <p className="font-bold leading-tight">{t('resume.title')}</p>
          <p className="text-xs text-muted">{t('game.chess')} · {t('resume.inProgress')}</p>
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
          <p className="font-bold leading-tight">{t('resume.title')}</p>
          <p className="text-xs text-muted">{t('game.nardy')} · {t('resume.inProgress')}</p>
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
            myName={myName}
            myElo={profile?.elo.chess ?? 1200}
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
            balance={profile?.balance ?? 0}
            online={durakOnline}
            myName={myName}
            onExit={() => setDurakOnline(null)}
          />
        </main>
      )}

      {/* Online N-player Durak — fullscreen while active */}
      {durakNOnline && (
        <main className="flex flex-1 flex-col overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-6">
          <DurakMatchN
            user={user}
            players={durakNOnline.players}
            balance={profile?.balance ?? 0}
            deck={0}
            neighborsOnly={false}
            transfer={false}
            allowDraw={false}
            myName={myName}
            online={durakNOnline}
            onExit={() => setDurakNOnline(null)}
          />
        </main>
      )}

      {/* Normal app — hidden while a match is fullscreen */}
      {!inMatchFull && !nardyOnline && !durakOnline && !durakNOnline && (
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
              <Friends friends={friends} requests={friendRequests} myId={user.id} onBack={() => setSub(null)} />
            ) : sub === 'wallet' ? (
              <Wallet
                balance={profile?.balance ?? 0}
                owner={owner}
                onOpenAdmin={() => setSub('withdrawals-admin')}
                onBack={() => setSub(null)}
              />
            ) : sub === 'withdrawals-admin' ? (
              <WithdrawAdmin onBack={() => setSub('wallet')} />
            ) : sub === 'history' ? (
              <History list={history} onBack={() => setSub(null)} />
            ) : sub === 'invite' && pendingInvite ? (
              <FriendInvite
                title={t('invite.playWithFriend')}
                subtitle={pendingInvite.label}
                game={pendingInvite.game}
                minutes={pendingInvite.minutes}
                transfer={pendingInvite.transfer}
                friends={friends}
                shareText={t('invite.shareText')}
                onBack={() => setSub(pendingInvite.game === 'durak' ? 'durak-setup' : 'nardy-setup')}
                onInviteFriend={(tg) =>
                  inviteFriend(tg, pendingInvite.game, pendingInvite.minutes, pendingInvite.transfer)
                }
              />
            ) : sub === 'durak-setup' ? (
              <DurakSetup
                onBack={() => setSub(null)}
                onCreate={(cfg) => {
                  if (cfg.players > 2) {
                    // 3–5 players vs bots → the N-player table
                    setDurakNCfg({ players: cfg.players, deck: cfg.deck, neighborsOnly: !cfg.throwAll, transfer: cfg.transfer, allowDraw: cfg.draw })
                    setSub('durakN')
                  } else {
                    setDurakCfg(cfg)
                    setDurakResume(false)
                    setSub('durak')
                  }
                }}
                onQuickMatch={(deck, transfer, players, throwAll, draw, stake) => {
                  if (players > 2) {
                    getSocket().emit('quickMatch', {
                      game: 'durakn',
                      minutes: deck,
                      players,
                      transfer,
                      neighborsOnly: !throwAll,
                      allowDraw: draw,
                      stake,
                    })
                  } else {
                    getSocket().emit('quickMatch', { game: 'durak', minutes: deck, transfer, stake })
                  }
                  setMatchmaking({
                    minutes: deck,
                    label: t('mm.searching'),
                    subtitle: `${t('game.durak')} · ${players} ${t('durakN.players')}${stake > 0 ? ` · ${stake} GRAM` : ''}`,
                  })
                  setSub(null)
                }}
                onInvite={(deck, transfer) => {
                  setPendingInvite({
                    game: 'durak',
                    minutes: deck,
                    transfer,
                    label: `${t('game.durak')} · ${deck} ${t('unit.cards')}${transfer ? ` · ${t('mode.transfer')}` : ''}`,
                  })
                  setSub('invite')
                }}
                onLobby={(mode, cfg) => {
                  setDurakLobby({ mode, cfg })
                  setSub('durak-lobby')
                }}
              />
            ) : sub === 'durak-lobby' && durakLobby ? (
              <DurakLobby
                mode={durakLobby.mode}
                cfg={durakLobby.cfg}
                friends={friends}
                initial={durakLobby.initial}
                onBack={() => setSub(durakLobby.mode === 'joined' ? null : 'durak-setup')}
              />
            ) : sub === 'durak' ? (
              <DurakMatch
                user={user}
                config={durakCfg}
                balance={profile?.balance ?? 0}
                resume={durakResume}
                myName={myName}
                onExit={() => {
                  setSub(null)
                  setDurakResume(false)
                  setDurakSaved(hasDurakSave())
                }}
              />
            ) : sub === 'durakN' && durakNCfg ? (
              <DurakMatchN
                user={user}
                players={durakNCfg.players}
                balance={profile?.balance ?? 0}
                deck={durakNCfg.deck}
                neighborsOnly={durakNCfg.neighborsOnly}
                transfer={durakNCfg.transfer}
                allowDraw={durakNCfg.allowDraw}
                myName={myName}
                onExit={() => setSub(null)}
              />
            ) : sub === 'nardy-setup' ? (
              <NardySetup
                onBack={() => setSub(null)}
                onCreate={(cfg) => {
                  setNardyCfg(cfg)
                  setNardyResume(false)
                  setSub('nardy')
                }}
                onQuickMatch={(stake) => {
                  getSocket().emit('quickMatch', { game: 'nardy', minutes: 2, stake })
                  setMatchmaking({
                    minutes: 2,
                    label: t('mm.searching'),
                    subtitle: stake > 0 ? `${t('game.nardy')} · ${stake} GRAM` : `${t('game.nardy')} · 2 ${t('unit.min')}`,
                  })
                  setSub(null)
                }}
                onInvite={() => {
                  setPendingInvite({ game: 'nardy', minutes: 2, label: `${t('game.nardy')} · 2 ${t('unit.min')}` })
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
                    onOpenWallet={() => setSub('wallet')}
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
                    <Store balance={profile?.balance ?? 0} onOpenWallet={() => setSub('wallet')} />
                  </>
                )}
                {tab === 'profile' && (
                  <>
                    {banners}
                    <Profile
                      user={user}
                      profile={profile}
                      eloTrend={eloTrend}
                      friendsCount={friends.length}
                      requestCount={friendRequests.length}
                      onOpenFriends={() => setSub('friends')}
                      onOpenWallet={() => setSub('wallet')}
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
            <BottomNav active={tab} onChange={setTab} badges={{ profile: friendRequests.length }} />
          )}
        </>
      )}
    </div>
  )
}
