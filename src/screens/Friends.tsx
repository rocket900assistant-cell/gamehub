import { useState } from 'react'
import { ArrowLeft, Send, Trash2, UserPlus, Users } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { shareFriendLink } from '../lib/telegram'
import { removeFriend, type ServerFriend } from '../lib/socket'

interface FriendsProps {
  friends: ServerFriend[]
  myId: number | string
  onBack: () => void
}

export function Friends({ friends, myId, onBack }: FriendsProps) {
  const [confirm, setConfirm] = useState<ServerFriend | null>(null)
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
        <h1 className="text-2xl font-extrabold">Друзья</h1>
        {friends.length > 0 && (
          <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs font-bold text-muted">
            {friends.length} · <span className="text-success">{onlineCount} в сети</span>
          </span>
        )}
      </div>

      {/* Add a friend by sharing an invite link */}
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-light/50 text-gold-dark">
            <UserPlus size={20} />
          </div>
          <div>
            <p className="font-bold leading-tight">Добавить друга</p>
            <p className="text-xs text-muted">
              Отправь ссылку. Друг откроет — и вы добавитесь друг к другу.
            </p>
          </div>
        </div>
        <Button className="w-full" onClick={() => shareFriendLink(myId)}>
          <Send size={16} /> Поделиться ссылкой
        </Button>
      </Card>

      {/* Friends list */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-bg text-muted">
            <Users size={26} />
          </div>
          <div>
            <p className="font-bold">Пока никого нет</p>
            <p className="mt-0.5 text-sm text-muted">
              Пригласи друга по ссылке выше
            </p>
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
                  {f.online ? 'в сети' : 'не в сети'}
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
            <p className="text-lg font-extrabold">Удалить из друзей?</p>
            <p className="mt-1 text-sm text-muted">{confirm.name}</p>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
                Отмена
              </Button>
              <button
                onClick={() => {
                  removeFriend(confirm.id)
                  setConfirm(null)
                }}
                className="h-11 flex-1 rounded-[var(--radius-btn)] bg-danger px-5 font-semibold text-white transition active:scale-[0.98]"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
