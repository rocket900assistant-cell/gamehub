import { useEffect, useState } from 'react'
import { ArrowLeft, Bolt, Bot, Check, Copy, Send, Swords, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Avatar } from '../components/ui/Avatar'
import { makeJoinLink, shareJoinLink } from '../lib/telegram'
import { getSocket, type ServerFriend } from '../lib/socket'
import { GameTypeToggle, StakeStepper } from '../components/StakePicker'
import { cn } from '../lib/cn'
import { t } from '../lib/i18n'

const timeControls: { m: number; key: string; icon: LucideIcon }[] = [
  { m: 3, key: 'chess.blitz', icon: Zap },
  { m: 5, key: 'chess.blitz', icon: Bolt },
  { m: 10, key: 'chess.rapid', icon: Swords },
]

interface NewChessGameProps {
  onBack: () => void
  onQuickMatch: (minutes: number, stake: number) => void
  onInvite: (friendTg: number, minutes: number) => void
  onBot: (minutes: number) => void
  friends: ServerFriend[]
}

export function NewChessGame({
  onBack,
  onQuickMatch,
  onInvite,
  onBot,
  friends,
}: NewChessGameProps) {
  const [minutes, setMinutes] = useState(5)
  const [free, setFree] = useState(true)
  const [stakeText, setStakeText] = useState('0.1')
  const [friend, setFriend] = useState(false)
  const [copied, setCopied] = useState(false)
  const [invited, setInvited] = useState<Set<number>>(new Set())
  const [showAllFriends, setShowAllFriends] = useState(false)
  const [roomId, setRoomId] = useState<string | null>(null)

  const stake = free ? 0 : Math.max(0, parseFloat(stakeText.replace(',', '.')) || 0)

  // Create a real server room for the invite link so a friend who taps it
  // lands straight in this lobby (re-create when the settings change).
  useEffect(() => {
    if (!friend) return
    const t = setTimeout(() => {
      getSocket().emit(
        'createRoom',
        { game: 'chess', minutes, free, stake },
        (id: string) => setRoomId(id),
      )
    }, 300)
    return () => clearTimeout(t)
  }, [friend, minutes, free, stake])

  const link = roomId ? makeJoinLink(roomId) : ''
  const sortedFriends = [...friends].sort((a, b) => Number(b.online) - Number(a.online))
  const visibleFriends = showAllFriends ? sortedFriends : sortedFriends.slice(0, 3)

  function invite(id: number) {
    setInvited((prev) => new Set(prev).add(id))
    onInvite(id, minutes)
  }

  function copyLink() {
    if (!link) return
    navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (friend ? setFriend(false) : onBack())}
          aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold">
          {friend ? t('invite.playWithFriend') : t('chess.title')}
        </h1>
      </div>

      {/* game type */}
      <GameTypeToggle free={free} onChange={setFree} />
      {!free && <StakeStepper value={stakeText} onChange={setStakeText} />}

      {/* time control */}
      <section>
        <p className="mb-3 text-sm font-bold">{t('setup.timeControl')}</p>
        <div className="grid grid-cols-3 gap-2.5">
          {timeControls.map((tc) => {
            const on = tc.m === minutes
            const Icon = tc.icon
            return (
              <button
                key={tc.m}
                onClick={() => setMinutes(tc.m)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-2xl border py-4 transition',
                  on
                    ? 'border-gold bg-gold-light/40'
                    : 'border-line bg-surface',
                )}
              >
                <Icon
                  size={20}
                  className={on ? 'text-gold-dark' : 'text-muted'}
                />
                <span className="text-lg font-extrabold leading-none">{tc.m}</span>
                <span className="text-[11px] text-muted">
                  {t('unit.min')} · {t(tc.key)}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* modes */}
      {!friend ? (
        <div className="space-y-3">
          <Button
            className="w-full"
            size="lg"
            onClick={() => onQuickMatch(minutes, stake)}
          >
            <Swords size={18} /> {t('setup.quick')}
          </Button>
          <Button
            className="w-full"
            size="lg"
            variant="secondary"
            onClick={() => setFriend(true)}
          >
            {t('setup.withFriend')}
          </Button>
          <Button
            className="w-full"
            size="lg"
            variant="ghost"
            onClick={() => onBot(minutes)}
          >
            <Bot size={18} /> {t('setup.withBot')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* invite existing friends directly */}
          <section>
            <p className="mb-2 text-sm font-bold">{t('invite.fromFriends')}</p>
            <Card className="divide-y divide-line/70 p-0">
              {friends.length === 0 && (
                <p className="p-4 text-center text-sm text-muted">
                  Пока нет друзей. Добавь их в профиле или пригласи по ссылке ниже.
                </p>
              )}
              {visibleFriends.map((f) => {
                const isInvited = invited.has(f.id)
                return (
                  <div key={f.id} className="flex items-center gap-3 p-3">
                    <div className="relative">
                      <Avatar name={f.name} src={f.photoUrl ?? undefined} size={38} />
                      {f.online && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold leading-tight">{f.name}</p>
                      <p className="text-xs text-muted">
                        {f.online ? t('common.online') : t('common.offline')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={isInvited ? 'secondary' : 'primary'}
                      disabled={!f.online || isInvited}
                      onClick={() => invite(f.id)}
                    >
                      {isInvited ? (
                        <>
                          <Check size={15} /> {t('invite.invited')}
                        </>
                      ) : (
                        t('invite.invite')
                      )}
                    </Button>
                  </div>
                )
              })}
              {friends.length > 3 && (
                <button
                  onClick={() => setShowAllFriends((v) => !v)}
                  className="w-full py-3 text-sm font-bold text-gold-dark"
                >
                  {showAllFriends
                    ? t('invite.collapse')
                    : `${t('invite.showAll')} (${friends.length})`}
                </button>
              )}
            </Card>
          </section>

          {/* or invite by link */}
          <section>
            <p className="mb-2 text-sm font-bold">{t('invite.orByLink')}</p>
            <Card className="space-y-3">
              <div className="flex items-center gap-2 rounded-[var(--radius-input)] border border-line bg-bg px-3 py-2.5">
                <span className="flex-1 truncate text-xs text-muted">
                  {link || t('invite.creatingLink')}
                </span>
                <button onClick={copyLink} className="text-gold-dark">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                disabled={!roomId}
                onClick={() =>
                  roomId &&
                  shareJoinLink(roomId, t('invite.shareText'))
                }
              >
                <Send size={16} /> Поделиться ссылкой
              </Button>
            </Card>
          </section>
        </div>
      )}
    </div>
  )
}
