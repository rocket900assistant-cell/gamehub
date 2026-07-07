import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Trash2, UserPlus, Users } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { getFriends, saveFriends, type Friend } from '../lib/friends'

interface FriendsProps {
  onBack: () => void
}

export function Friends({ onBack }: FriendsProps) {
  const [list, setList] = useState<Friend[]>(getFriends)
  const [username, setUsername] = useState('')

  // persist so added / removed friends survive a reload (shared with invites)
  useEffect(() => {
    saveFriends(list)
  }, [list])

  function addFriend() {
    const handle = username.trim().replace(/^@/, '')
    if (!handle) return
    if (list.some((f) => f.username.toLowerCase() === handle.toLowerCase())) {
      setUsername('')
      return
    }
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

  function removeFriend(id: string) {
    setList((prev) => prev.filter((f) => f.id !== id))
  }

  // online first, then by name
  const sorted = [...list].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
  )
  const onlineCount = list.filter((f) => f.online).length

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
        {list.length > 0 && (
          <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs font-bold text-muted">
            {list.length} · <span className="text-success">{onlineCount} в сети</span>
          </span>
        )}
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
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-bg text-muted">
            <Users size={26} />
          </div>
          <div>
            <p className="font-bold">Пока никого нет</p>
            <p className="mt-0.5 text-sm text-muted">
              Добавь друга по @username выше
            </p>
          </div>
        </div>
      ) : (
        <>
          <Card className="divide-y divide-line/70 overflow-hidden p-0">
            {sorted.map((f) => (
              <SwipeRow key={f.id} onDelete={() => removeFriend(f.id)}>
                <div className="flex items-center gap-3 bg-surface p-3.5">
                  <div className="relative">
                    <Avatar name={f.name} size={44} />
                    {f.online && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold leading-tight">{f.name}</p>
                    <p className="truncate text-xs text-muted">
                      @{f.username} · {f.online ? 'в сети' : 'не в сети'}
                    </p>
                  </div>
                </div>
              </SwipeRow>
            ))}
          </Card>
          <p className="px-1 text-center text-xs text-muted">
            Смахни влево, чтобы удалить
          </p>
        </>
      )}
    </div>
  )
}

/** iOS-style swipe-left row: reveals a red «Удалить» action behind the content. */
function SwipeRow({
  children,
  onDelete,
}: {
  children: ReactNode
  onDelete: () => void
}) {
  const OPEN = -88
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const base = useRef(0)

  function down(clientX: number) {
    setDragging(true)
    startX.current = clientX
    base.current = x
  }
  function move(clientX: number) {
    if (!dragging) return
    const nx = Math.max(-104, Math.min(0, base.current + clientX - startX.current))
    setX(nx)
  }
  function up() {
    if (!dragging) return
    setDragging(false)
    setX(x < OPEN / 2 ? OPEN : 0)
  }

  return (
    <div className="relative">
      {/* delete action behind the row */}
      <button
        onClick={onDelete}
        aria-label="Удалить"
        className="absolute inset-y-0 right-0 flex w-[88px] flex-col items-center justify-center gap-0.5 bg-danger text-white"
      >
        <Trash2 size={18} />
        <span className="text-[11px] font-bold">Удалить</span>
      </button>
      {/* sliding content */}
      <div
        style={{
          transform: `translateX(${x}px)`,
          transition: dragging ? 'none' : 'transform 0.22s ease',
          touchAction: 'pan-y',
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          down(e.clientX)
        }}
        onPointerMove={(e) => move(e.clientX)}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {children}
      </div>
    </div>
  )
}
