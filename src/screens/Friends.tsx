import { useEffect, useState } from 'react'
import { ArrowLeft, AtSign, Check, Send, Trash2, UserPlus, Users, X } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { shareFriendLink } from '../lib/telegram'
import {
  getSocket,
  removeFriend,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  type ServerFriend,
  type FriendRequest,
} from '../lib/socket'
import { t } from '../lib/i18n'

interface FriendsProps {
  friends: ServerFriend[]
  requests: FriendRequest[]
  myId: number | string
  onBack: () => void
}

/** Map a server result reason to a localized message + tone. */
function resultMessage(reason: string): { msg: string; tone: 'ok' | 'bad' | 'muted' } {
  switch (reason) {
    case 'sent':
      return { msg: t('friends.res.sent'), tone: 'ok' }
    case 'accepted':
      return { msg: t('friends.res.accepted'), tone: 'ok' }
    case 'exists':
      return { msg: t('friends.res.exists'), tone: 'muted' }
    case 'already-friends':
      return { msg: t('friends.res.alreadyFriends'), tone: 'muted' }
    case 'self':
      return { msg: t('friends.res.self'), tone: 'bad' }
    default:
      return { msg: t('friends.res.notfound'), tone: 'bad' }
  }
}

export function Friends({ friends, requests, myId, onBack }: FriendsProps) {
  const [confirm, setConfirm] = useState<ServerFriend | null>(null)
  const [username, setUsername] = useState('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ msg: string; tone: 'ok' | 'bad' | 'muted' } | null>(null)

  useEffect(() => {
    const s = getSocket()
    const onResult = ({ reason }: { ok: boolean; reason: string }) => {
      setSending(false)
      setFeedback(resultMessage(reason))
      if (reason === 'sent' || reason === 'accepted') setUsername('')
    }
    s.on('friend:request:result', onResult)
    return () => {
      s.off('friend:request:result', onResult)
    }
  }, [])

  const submitUsername = () => {
    const name = username.trim().replace(/^@/, '')
    if (!name || sending) return
    setSending(true)
    setFeedback(null)
    sendFriendRequest(name)
  }

  const sorted = [...friends].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
  )
  const onlineCount = friends.filter((f) => f.online).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold">{t('friends.title')}</h1>
        {friends.length > 0 && (
          <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs font-bold text-muted">
            {friends.length} · <span className="text-success">{onlineCount} {t('friends.online')}</span>
          </span>
        )}
      </div>

      {/* Add a friend: by username (request) or by invite link */}
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-light/50 text-gold-dark">
            <UserPlus size={20} />
          </div>
          <div>
            <p className="font-bold leading-tight">{t('friends.add')}</p>
            <p className="text-xs text-muted">{t('friends.addHint')}</p>
          </div>
        </div>

        {/* by username */}
        <div className="flex items-center gap-2">
          <div className="flex h-11 flex-1 items-center gap-1.5 rounded-[var(--radius-input)] border border-line bg-bg px-3">
            <AtSign size={16} className="shrink-0 text-muted" />
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.replace(/[^A-Za-z0-9_@]/g, ''))
                if (feedback) setFeedback(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && submitUsername()}
              placeholder={t('friends.username')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-transparent text-sm font-semibold outline-none"
            />
          </div>
          <Button onClick={submitUsername} disabled={!username.trim() || sending}>
            {t('friends.addBtn')}
          </Button>
        </div>

        {feedback && (
          <p
            className={
              'text-sm font-semibold ' +
              (feedback.tone === 'ok'
                ? 'text-success'
                : feedback.tone === 'bad'
                  ? 'text-danger'
                  : 'text-muted')
            }
          >
            {feedback.msg}
          </p>
        )}

        {/* by link */}
        <div className="flex items-center gap-3 pt-1">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t('friends.orLink')}
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <Button variant="secondary" className="w-full" onClick={() => shareFriendLink(myId)}>
          <Send size={16} /> {t('friends.shareLink')}
        </Button>
      </Card>

      {/* Incoming friend requests */}
      {requests.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
            {t('friends.requests')} · {requests.length}
          </p>
          <Card className="divide-y divide-line/70 overflow-hidden p-0">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 bg-surface p-3.5">
                <div className="relative">
                  <Avatar name={r.name} src={r.photoUrl ?? undefined} size={44} />
                  {r.online && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold leading-tight">{r.name}</p>
                  {r.username && <p className="truncate text-xs text-muted">@{r.username}</p>}
                </div>
                <button
                  onClick={() => acceptFriendRequest(r.id)}
                  aria-label={t('friends.accept')}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success text-white transition active:scale-95"
                >
                  <Check size={20} strokeWidth={2.6} />
                </button>
                <button
                  onClick={() => declineFriendRequest(r.id)}
                  aria-label={t('friends.decline')}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-muted transition active:bg-bg"
                >
                  <X size={18} />
                </button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Friends list */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-bg text-muted">
            <Users size={26} />
          </div>
          <div>
            <p className="font-bold">{t('friends.emptyTitle')}</p>
            <p className="mt-0.5 text-sm text-muted">{t('friends.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden p-0">
          {sorted.map((f) => (
            <div key={f.id} className="flex items-center gap-3 bg-surface p-3.5">
              <div className="relative">
                <Avatar name={f.name} src={f.photoUrl ?? undefined} size={44} />
                {f.online && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold leading-tight">{f.name}</p>
                <p className="truncate text-xs text-muted">
                  {f.username ? `@${f.username} · ` : ''}
                  {f.online ? t('common.online') : t('common.offline')}
                </p>
              </div>
              <button
                onClick={() => setConfirm(f)}
                aria-label="Удалить"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted transition active:bg-bg"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </Card>
      )}

      {/* remove-friend confirmation */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-extrabold">{t('friends.removeTitle')}</p>
            <p className="mt-1 text-sm text-muted">{confirm.name}</p>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </Button>
              <button
                onClick={() => {
                  removeFriend(confirm.id)
                  setConfirm(null)
                }}
                className="h-11 flex-1 rounded-[var(--radius-btn)] bg-danger px-5 font-semibold text-white transition active:scale-[0.98]"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
