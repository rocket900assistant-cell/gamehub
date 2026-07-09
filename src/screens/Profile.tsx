import { useState } from 'react'
import {
  ChevronRight,
  ClipboardList,
  Copy,
  Crown,
  Gamepad2,
  Pencil,
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
  profile as profileMock,
  profileStats,
} from '../data/mock'
import type { FavGame } from '../data/mock'
import type { TgUser } from '../lib/telegram'
import { displayName } from '../lib/telegram'
import { setName } from '../lib/socket'
import type { Profile as PlayerProfile } from '../lib/socket'
import { isVip } from '../lib/skins'
import { Button } from '../components/ui/Button'

const gameIcons: Record<string, LucideIcon> = {
  chess: Crown,
  durak: Spade,
}

interface ProfileProps {
  user: TgUser
  profile: PlayerProfile | null
  friendsCount: number
  onOpenFriends: () => void
  onOpenHistory: () => void
}

export function Profile({ user, profile, friendsCount, onOpenFriends, onOpenHistory }: ProfileProps) {
  const vip = isVip()
  const name = profile?.name ?? displayName(user)
  const [renameOpen, setRenameOpen] = useState(false)
  const [draft, setDraft] = useState(name)
  function openRename() {
    setDraft(name)
    setRenameOpen(true)
  }
  function saveName() {
    const clean = draft.trim().slice(0, 24)
    if (clean) setName(clean)
    setRenameOpen(false)
  }
  const balance = profile?.balance ?? 0
  const eloMain = profile
    ? Math.max(profile.elo.chess, profile.elo.durak, profile.elo.nardy)
    : profileMock.elo
  const games = profile?.games ?? 0
  const wins = profile?.wins ?? 0
  const losses = profile?.losses ?? 0
  const winrate = games ? Math.round((wins / games) * 100) : 0

  const stats = profile
    ? [
        { label: 'Партий', value: String(games), sub: undefined },
        { label: 'Побед', value: String(wins), sub: undefined },
        { label: 'Поражений', value: String(losses), sub: undefined },
        { label: 'Винрейт', value: `${winrate}%`, sub: undefined },
      ]
    : profileStats

  const favGames = profile
    ? [
        { id: 'chess', name: 'Шахматы', elo: profile.elo.chess, played: null as number | null, progress: Math.min(1, profile.elo.chess / 2500) },
        { id: 'durak', name: 'Дурак', elo: profile.elo.durak, played: null, progress: Math.min(1, profile.elo.durak / 2500) },
        { id: 'nardy', name: 'Нарды', elo: profile.elo.nardy, played: null, progress: Math.min(1, profile.elo.nardy / 2500) },
      ]
    : favoriteGames.map((g: FavGame) => ({ ...g, played: g.played as number | null }))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center">
        <h1 className="text-2xl font-extrabold">Профиль</h1>
      </div>

      {/* Identity card */}
      <Card className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <Avatar name={name} src={user.photoUrl} size={56} vip={vip} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-lg font-bold">{name}</p>
              {vip && (
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
        <StarBalance amount={balance} plus={false} />
      </Card>

      {/* Elo + stats */}
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted">Elo рейтинг</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-extrabold leading-none">
                {eloMain}
              </span>
              {!profile && (
                <span className="text-sm font-bold text-success">
                  +{profileMock.eloDelta}
                </span>
              )}
            </div>
          </div>
          {!profile && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <TrendingUp size={13} /> Топ {profileMock.topPercent}%
            </span>
          )}
        </div>

        <EloChart points={eloTrend} className="mt-3 h-16 w-full" />

        <div className="mt-4 grid grid-cols-4 divide-x divide-line/70 border-t border-line/70 pt-4">
          {stats.map((s) => (
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
        <SectionHeader title="Любимые игры" />
        <Card className="divide-y divide-line/70 p-0">
          {favGames.map((g) => {
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
                      Elo {g.elo}
                      {g.played != null ? ` · ${g.played} игр` : ''}
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
        <button
          onClick={openRename}
          className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
        >
          <Pencil size={20} className="text-muted" />
          <span className="flex-1 font-medium">Сменить имя</span>
          <ChevronRight size={18} className="text-muted" />
        </button>
        <button
          onClick={onOpenFriends}
          className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
        >
          <Users size={20} className="text-muted" />
          <span className="flex-1 font-medium">Друзья</span>
          <span className="text-sm text-muted">{friendsCount}</span>
          <ChevronRight size={18} className="text-muted" />
        </button>
        <button
          onClick={onOpenHistory}
          className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
        >
          <ClipboardList size={20} className="text-muted" />
          <span className="flex-1 font-medium">История матчей</span>
          <ChevronRight size={18} className="text-muted" />
        </button>
      </Card>

      {/* Rename dialog */}
      {renameOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={() => setRenameOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-soft)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-extrabold">Сменить имя</p>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              maxLength={24}
              autoFocus
              placeholder="Ваше имя"
              className="mt-3 h-11 w-full rounded-[var(--radius-input)] border border-line bg-bg px-3 text-[15px] outline-none focus:border-gold"
            />
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setRenameOpen(false)}>
                Отмена
              </Button>
              <Button className="flex-1" disabled={!draft.trim()} onClick={saveName}>
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
