import { useState } from 'react'
import { ArrowLeft, Bolt, Bot, Check, Copy, Send, Swords, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Avatar } from '../components/ui/Avatar'
import { makeGameLink, shareGameLink } from '../lib/telegram'
import { GameTypeToggle, StakeStepper } from '../components/StakePicker'
import { friends } from '../data/mock'
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
  const [gameId] = useState(() => `chess_${Math.random().toString(36).slice(2, 8)}`)

  function invite(id: string) {
    setInvited((prev) => new Set(prev).add(id))
    onInvite(id, minutes)
  }

  function copyLink() {
    navigator.clipboard?.writeText(makeGameLink(gameId))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold">Шахматы</h1>
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
              {friends.map((f) => {
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
            </Card>
          </section>

          {/* or invite by link */}
          <section>
            <p className="mb-2 text-sm font-bold">Или по ссылке</p>
            <Card className="space-y-3">
              <div className="flex items-center gap-2 rounded-[var(--radius-input)] border border-line bg-bg px-3 py-2.5">
                <span className="flex-1 truncate text-xs text-muted">
                  {makeGameLink(gameId)}
                </span>
                <button onClick={copyLink} className="text-gold-dark">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() =>
                  shareGameLink(gameId, 'Партия в шахматы в GameHub — заходи!')
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
