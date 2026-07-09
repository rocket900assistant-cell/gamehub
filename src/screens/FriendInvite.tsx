import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, Send } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Avatar } from '../components/ui/Avatar'
import { getSocket, type ServerFriend } from '../lib/socket'
import { makeJoinLink, shareJoinLink } from '../lib/telegram'
import { t } from '../lib/i18n'

interface FriendInviteProps {
  title: string
  subtitle: string
  game: 'chess' | 'durak' | 'nardy'
  minutes: number
  transfer?: boolean
  friends: ServerFriend[]
  shareText: string
  onBack: () => void
  onInviteFriend: (tgId: number) => void
}

/** "Play with a friend" screen — invite an online friend directly, or share a link. */
export function FriendInvite({
  title,
  subtitle,
  game,
  minutes,
  transfer,
  friends,
  shareText,
  onBack,
  onInviteFriend,
}: FriendInviteProps) {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [invited, setInvited] = useState<Set<number>>(new Set())
  const [showAll, setShowAll] = useState(false)

  // Create a real room up front so the share link drops the friend into this lobby.
  useEffect(() => {
    getSocket().emit('createRoom', { game, minutes, transfer }, (id: string) => setRoomId(id))
  }, [game, minutes, transfer])

  const link = roomId ? makeJoinLink(roomId) : ''
  const sorted = [...friends].sort((a, b) => Number(b.online) - Number(a.online))
  const visible = showAll ? sorted : sorted.slice(0, 4)

  function invite(id: number) {
    setInvited((prev) => new Set(prev).add(id))
    onInviteFriend(id)
  }
  function copyLink() {
    if (!link) return
    navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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
        <div>
          <h1 className="text-2xl font-extrabold leading-tight">{title}</h1>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </div>

      <section>
        <p className="mb-2 text-sm font-bold">{t('invite.fromFriends')}</p>
        <Card className="divide-y divide-line/70 p-0">
          {sorted.length === 0 && (
            <p className="p-4 text-center text-sm text-muted">
              {t('invite.noFriends')}
            </p>
          )}
          {visible.map((f) => {
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
                  <p className="text-xs text-muted">{f.online ? t('common.online') : t('common.offline')}</p>
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
          {sorted.length > 4 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full py-3 text-sm font-bold text-gold-dark"
            >
              {showAll ? t('invite.collapse') : `${t('invite.showAll')} (${sorted.length})`}
            </button>
          )}
        </Card>
      </section>

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
            onClick={() => roomId && shareJoinLink(roomId, shareText)}
          >
            <Send size={16} /> {t('friends.shareLink')}
          </Button>
        </Card>
      </section>
    </div>
  )
}
