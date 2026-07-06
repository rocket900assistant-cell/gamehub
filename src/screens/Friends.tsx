import { useState } from 'react'
import { ArrowLeft, Swords, UserPlus } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { friends as initialFriends } from '../data/mock'
import type { Friend } from '../data/mock'

interface FriendsProps {
  onBack: () => void
}

export function Friends({ onBack }: FriendsProps) {
  const [list, setList] = useState<Friend[]>(initialFriends)
  const [username, setUsername] = useState('')

  function addFriend() {
    const handle = username.trim().replace(/^@/, '')
    if (!handle) return
    setList((prev) => [
      {
        id: crypto.randomUUID(),
        name: handle,
        username: handle,
        online: false,
        elo: 500,
      },
      ...prev,
    ])
    setUsername('')
  }

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
      </div>

      {/* Add by username */}
      <Card>
        <p className="mb-2 text-sm font-bold">Добавить друга</p>
        <div className="flex gap-2">
          <div className="flex flex-1 items-center rounded-[var(--radius-input)] border border-line bg-bg px-3">
            <span className="text-muted">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFriend()}
              placeholder="username"
              className="h-11 flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-muted"
            />
          </div>
          <Button onClick={addFriend}>
            <UserPlus size={16} /> Добавить
          </Button>
        </div>
      </Card>

      {/* Friends list */}
      <Card className="divide-y divide-line/70 p-0">
        {list.map((f) => (
          <div key={f.id} className="flex items-center gap-3 p-3.5">
            <div className="relative">
              <Avatar name={f.name} size={44} />
              {f.online && (
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold leading-tight">{f.name}</p>
              <p className="truncate text-xs text-muted">
                @{f.username} · Elo {f.elo}
              </p>
            </div>
            <Button size="sm" variant="secondary">
              <Swords size={15} /> Играть
            </Button>
          </div>
        ))}
      </Card>
    </div>
  )
}
