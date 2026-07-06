import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  Copy,
  Crown,
  Gamepad2,
  LayoutGrid,
  MoreHorizontal,
  Settings,
  Spade,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { SectionHeader } from '../components/ui/SectionHeader'
import { StarBalance } from '../components/ui/StarBalance'
import { EloChart } from '../components/EloChart'
import {
  eloTrend,
  favoriteGames,
  player,
  profile,
  profileMenu,
  profileStats,
} from '../data/mock'
import type { FavGame } from '../data/mock'
import type { TgUser } from '../lib/telegram'
import { displayName } from '../lib/telegram'

const gameIcons: Record<string, LucideIcon> = {
  chess: Crown,
  durak: Spade,
}

const menuIcons: Record<string, LucideIcon> = {
  friends: Users,
  collection: LayoutGrid,
  history: ClipboardList,
  stats: BarChart3,
}

interface ProfileProps {
  user: TgUser
  onOpenFriends: () => void
}

export function Profile({ user, onOpenFriends }: ProfileProps) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Профиль</h1>
        <div className="flex items-center gap-2">
          {[Settings, MoreHorizontal].map((Icon, i) => (
            <button
              key={i}
              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
      </div>

      {/* Identity card */}
      <Card className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <Avatar name={displayName(user)} src={user.photoUrl} size={56} vip />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-lg font-bold">{displayName(user)}</p>
              {profile.vip && (
                <span className="rounded-full bg-gradient-to-b from-gold to-gold-dark px-2 py-0.5 text-[10px] font-bold text-white">
                  VIP
                </span>
              )}
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText(String(user.id))}
              className="mt-0.5 flex items-center gap-1 text-xs text-muted"
            >
              ID: {user.id} <Copy size={12} />
            </button>
            {user.username && (
              <p className="text-xs text-gold-dark">@{user.username}</p>
            )}
          </div>
        </div>
        <StarBalance amount={player.balance} plus={false} />
      </Card>

      {/* Elo + stats */}
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted">Elo рейтинг</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-extrabold leading-none">
                {profile.elo}
              </span>
              <span className="text-sm font-bold text-success">
                +{profile.eloDelta}
              </span>
            </div>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted">
            <TrendingUp size={13} /> Топ {profile.topPercent}%
          </span>
        </div>

        <EloChart points={eloTrend} className="mt-3 h-16 w-full" />

        <div className="mt-4 grid grid-cols-4 divide-x divide-line/70 border-t border-line/70 pt-4">
          {profileStats.map((s) => (
            <div key={s.label} className="px-1 text-center">
              <p className="text-lg font-extrabold leading-none">{s.value}</p>
              <p className="mt-1 text-[11px] leading-tight text-muted">
                {s.label}
              </p>
              {s.sub && <p className="text-[11px] font-medium text-gold-dark">{s.sub}</p>}
            </div>
          ))}
        </div>
      </Card>

      {/* Favorite games */}
      <section>
        <SectionHeader title="Любимые игры" actionLabel="Смотреть все" />
        <Card className="divide-y divide-line/70 p-0">
          {favoriteGames.map((g: FavGame) => {
            const Icon = gameIcons[g.id] ?? Gamepad2
            return (
              <div key={g.id} className="flex items-center gap-3 p-3.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-light/40 text-gold-dark">
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-bold">{g.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      Elo {g.elo} · {g.played} игр
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-gold to-gold-dark"
                      style={{ width: `${g.progress * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </Card>
      </section>

      {/* Menu */}
      <Card className="divide-y divide-line/70 p-0">
        {profileMenu.map((m) => {
          const Icon = menuIcons[m.id] ?? ChevronRight
          return (
            <button
              key={m.id}
              onClick={m.id === 'friends' ? onOpenFriends : undefined}
              className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
            >
              <Icon size={20} className="text-muted" />
              <span className="flex-1 font-medium">{m.label}</span>
              {m.value && <span className="text-sm text-muted">{m.value}</span>}
              <ChevronRight size={18} className="text-muted" />
            </button>
          )
        })}
      </Card>
    </div>
  )
}
