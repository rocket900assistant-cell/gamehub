import { useState } from 'react'
import {
  ChevronRight,
  ClipboardList,
  Copy,
  Crown,
  Gamepad2,
  Languages,
  Moon,
  Pencil,
  Spade,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { SectionHeader } from '../components/ui/SectionHeader'
import { StarBalance } from '../components/ui/StarBalance'
import { EloChart } from '../components/EloChart'
import { favoriteGames, profile as profileMock, profileStats } from '../data/mock'
import type { FavGame } from '../data/mock'
import type { TgUser } from '../lib/telegram'
import { displayName } from '../lib/telegram'
import { setName } from '../lib/socket'
import type { EloTrend, Profile as PlayerProfile } from '../lib/socket'
import { isVip } from '../lib/skins'
import { getTheme, setTheme } from '../lib/theme'
import { getLang, setLang, t } from '../lib/i18n'
import { Button } from '../components/ui/Button'

const gameIcons: Record<string, LucideIcon> = {
  chess: Crown,
  durak: Spade,
}

interface ProfileProps {
  user: TgUser
  profile: PlayerProfile | null
  eloTrend: EloTrend | null
  friendsCount: number
  requestCount: number
  onOpenFriends: () => void
  onOpenHistory: () => void
  onOpenWallet: () => void
}

export function Profile({ user, profile, eloTrend, friendsCount, requestCount, onOpenFriends, onOpenHistory, onOpenWallet }: ProfileProps) {
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
  const [dark, setDark] = useState(getTheme() === 'dark')
  const [lang, setLangState] = useState(getLang())
  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    setTheme(next)
    setDark(!dark)
  }
  const balance = profile?.balance ?? 0
  const eloMain = profile
    ? Math.max(profile.elo.chess, profile.elo.durak, profile.elo.nardy)
    : profileMock.elo
  const games = profile?.games ?? 0
  const wins = profile?.wins ?? 0
  const losses = profile?.losses ?? 0
  const winrate = games ? Math.round((wins / games) * 100) : 0
  const trendPoints = eloTrend?.trend && eloTrend.trend.length >= 2 ? eloTrend.trend : null
  const realDelta = eloTrend?.delta ?? 0

  const stats = profile
    ? [
        { label: t('profile.games'), value: String(games), sub: undefined },
        { label: t('profile.wins'), value: String(wins), sub: undefined },
        { label: t('profile.losses'), value: String(losses), sub: undefined },
        { label: t('profile.winrate'), value: `${winrate}%`, sub: undefined },
      ]
    : profileStats

  const favGames = profile
    ? [
        { id: 'chess', name: t('game.chess'), elo: profile.elo.chess, played: null as number | null, progress: Math.min(1, profile.elo.chess / 2500) },
        { id: 'durak', name: t('game.durak'), elo: profile.elo.durak, played: null, progress: Math.min(1, profile.elo.durak / 2500) },
        { id: 'nardy', name: t('game.nardy'), elo: profile.elo.nardy, played: null, progress: Math.min(1, profile.elo.nardy / 2500) },
      ]
    : favoriteGames.map((g: FavGame) => ({ ...g, played: g.played as number | null }))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center">
        <h1 className="text-2xl font-extrabold">{t('profile.title')}</h1>
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
        <StarBalance amount={balance} plus={false} onTopUp={onOpenWallet} />
      </Card>

      {/* Elo + stats */}
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted">{t('profile.elo')}</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-extrabold leading-none">
                {eloMain}
              </span>
              {realDelta !== 0 && (
                <span
                  className={`text-sm font-bold ${realDelta > 0 ? 'text-success' : 'text-danger'}`}
                >
                  {realDelta > 0 ? '+' : '−'}
                  {Math.abs(realDelta)}
                </span>
              )}
            </div>
          </div>
        </div>

        {trendPoints ? (
          <EloChart points={trendPoints} className="mt-3 h-16 w-full" />
        ) : (
          <p className="mt-4 text-center text-xs text-muted">{t('profile.eloHint')}</p>
        )}

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
        <SectionHeader title={t('profile.favGames')} />
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
          onClick={onOpenFriends}
          className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
        >
          <Users size={20} className="text-muted" />
          <span className="flex-1 font-medium">{t('profile.friends')}</span>
          {requestCount > 0 && (
            <span className="grid h-[20px] min-w-[20px] place-items-center rounded-full bg-danger px-1.5 text-[11px] font-bold leading-none text-white">
              {requestCount > 9 ? '9+' : requestCount}
            </span>
          )}
          <span className="text-sm text-muted">{friendsCount}</span>
          <ChevronRight size={18} className="text-muted" />
        </button>
        <button
          onClick={openRename}
          className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
        >
          <Pencil size={20} className="text-muted" />
          <span className="flex-1 font-medium">{t('profile.rename')}</span>
          <ChevronRight size={18} className="text-muted" />
        </button>
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
        >
          <Moon size={20} className="text-muted" />
          <span className="flex-1 font-medium">{t('profile.darkTheme')}</span>
          <span
            className={`relative h-6 w-11 rounded-full transition ${dark ? 'bg-gold' : 'bg-line'}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                dark ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </span>
        </button>
        <div className="flex w-full items-center gap-3 p-4">
          <Languages size={20} className="text-muted" />
          <span className="flex-1 font-medium">{t('profile.language')}</span>
          <div className="flex gap-1 rounded-full border border-line p-0.5">
            {(['ru', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => {
                  setLang(l)
                  setLangState(l)
                }}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  lang === l ? 'bg-gold text-white' : 'text-muted'
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onOpenHistory}
          className="flex w-full items-center gap-3 p-4 text-left transition active:bg-bg"
        >
          <ClipboardList size={20} className="text-muted" />
          <span className="flex-1 font-medium">{t('profile.history')}</span>
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
            <p className="text-lg font-extrabold">{t('profile.renameTitle')}</p>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              maxLength={24}
              autoFocus
              placeholder={t('profile.namePlaceholder')}
              className="mt-3 h-11 w-full rounded-[var(--radius-input)] border border-line bg-bg px-3 text-[15px] outline-none focus:border-gold"
            />
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setRenameOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button className="flex-1" disabled={!draft.trim()} onClick={saveName}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
