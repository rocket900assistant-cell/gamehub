import { useEffect, useState } from 'react'
import { ArrowLeft, Bolt, Bot, Check, Copy, Send, Swords, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Avatar } from '../components/ui/Avatar'
import { makeJoinLink, shareJoinLink } from '../lib/telegram'
import { getSocket } from '../lib/socket'
import { GameTypeToggle, StakeStepper } from '../components/StakePicker'
import { getFriends } from '../lib/friends'
import { cn } from '../lib/cn'

const timeControls: { m: number; label: string; icon: LucideIcon }[] = [
  { m: 3, label: 'Блиц', icon: Zap },
  { m: 5, label: 'Блиц', icon: Bolt },
  { m: 10, label: 'Рапид', icon: Swords },
]

interface NewChessGameProps {
  onBack: () => void
  onQuickMatch: (minutes: number) => void
  onInvite: (friendUserId: string, minutes: number) => void
  onBot: (minutes: number) => void
}

export function NewChessGame({
  onBack,
  onQuickMatch,
  onInvite,
  onBot,
}: NewChessGameProps) {
  const [minutes, setMinutes] = useState(5)
  const [free, setFree] = useState(true)
  const [stakeText, setStakeText] = useState('0.1')
  const [friend, setFriend] = useState(false)
  const [copied, setCopied] = useState(false)
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const [showAllFriends, setShowAllFriends] = useState(false)
  const [friends] = useState(getFriends)
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
  const visibleFriends = showAllFriends ? friends : friends.slice(0, 3)

  function invite(id: string) {
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
          {friend ? 'Игра с другом' : 'Шахматы'}
        </h1>
      </div>

      {/* game type */}
      <GameTypeToggle free={free} onChange={setFree} />
      {!free && <StakeStepper value={stakeText} onChange={setStakeText} />}

      {/* time control */}
      <section>
        <p className="mb-3 text-sm font-bold">Контроль времени</p>
        <div className="grid grid-cols-3 gap-2.5">
          {timeControls.map((t) => {
            const on = t.m === minutes
            const Icon = t.icon
            return (
              <button
                key={t.m}
                onClick={() => setMinutes(t.m)}
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
                <span className="text-lg font-extrabold leading-none">{t.m}</span>
                <span className="text-[11px] text-muted">
                  мин · {t.label}
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
            onClick={() => onQuickMatch(minutes)}
          >
            <Swords size={18} /> Быстрая игра
          </Button>
          <Button
            className="w-full"
            size="lg"
            variant="secondary"
            onClick={() => setFriend(true)}
          >
            Играть с другом
          </Button>
          <Button
            className="w-full"
            size="lg"
            variant="ghost"
            onClick={() => onBot(minutes)}
          >
            <Bot size={18} /> Играть с ботом
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* invite existing friends directly */}
          <section>
            <p className="mb-2 text-sm font-bold">Пригласить из друзей</p>
            <Card className="divide-y divide-line/70 p-0">
              {visibleFriends.map((f) => {
                const isInvited = invited.has(f.id)
                return (
                  <div key={f.id} className="flex items-center gap-3 p-3">
                    <div className="relative">
                      <Avatar name={f.name} size={38} />
                      {f.online && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold leading-tight">{f.name}</p>
                      <p className="text-xs text-muted">
                        {f.online ? 'в сети' : 'не в сети'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={isInvited ? 'secondary' : 'primary'}
                      onClick={() => invite(f.id)}
                    >
                      {isInvited ? (
                        <>
                          <Check size={15} /> Приглашён
                        </>
                      ) : (
                        'Пригласить'
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
                    ? 'Свернуть'
                    : `Показать всех (${friends.length})`}
                </button>
              )}
            </Card>
          </section>

          {/* or invite by link */}
          <section>
            <p className="mb-2 text-sm font-bold">Или по ссылке</p>
            <Card className="space-y-3">
              <div className="flex items-center gap-2 rounded-[var(--radius-input)] border border-line bg-bg px-3 py-2.5">
                <span className="flex-1 truncate text-xs text-muted">
                  {link || 'Создаём ссылку…'}
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
                  shareJoinLink(roomId, 'Партия в шахматы в GameHub — заходи!')
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
