import { ChevronRight, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { StarPromoBanner } from '../components/StarPromoBanner'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { SectionHeader } from '../components/ui/SectionHeader'
import { StarBalance } from '../components/ui/StarBalance'
import { comingGames, popularGames, resumeGames } from '../data/mock'
import type { TgUser } from '../lib/telegram'
import { displayName, shareInvite } from '../lib/telegram'
import type { Profile as PlayerProfile } from '../lib/socket'

// map a UI game id → the per-game Elo field in the DB profile
const ELO_KEY: Record<string, 'chess' | 'durak' | 'nardy'> = {
  chess: 'chess',
  durak: 'durak',
  backgammon: 'nardy',
}

const V = '?v=4' // cache-bust when assets change
const gameImg: Record<string, string> = {
  chess: '/assets/games/chess.png' + V,
  durak: '/assets/games/durak.png' + V,
  backgammon: '/assets/games/backgammon.png' + V,
  poker: '/assets/games/poker.png' + V,
  checkers: '/assets/games/checkers.png' + V,
  tictactoe: '/assets/games/tictactoe.png' + V,
}

interface HomeProps {
  user: TgUser
  profile: PlayerProfile | null
  onOpenProfile: () => void
  onPlay: (gameId: string) => void
  resumeBanner?: ReactNode
}

export function Home({ user, profile, onOpenProfile, onPlay, resumeBanner }: HomeProps) {
  const eloFor = (id: string, fallback: number) => {
    const key = ELO_KEY[id]
    return profile && key ? profile.elo[key] : fallback
  }
  return (
    <div className="space-y-6">
      <AppHeader />

      {/* Identity + balance */}
      <div className="flex items-center justify-between">
        <button
          onClick={onOpenProfile}
          className="flex items-center gap-3 text-left"
        >
          <Avatar name={profile?.name ?? displayName(user)} src={user.photoUrl} size={44} />
          <div>
            <p className="font-bold leading-tight">{profile?.name ?? displayName(user)}</p>
            <p className="flex items-center gap-0.5 text-xs text-muted">
              Профиль <ChevronRight size={13} />
            </p>
          </div>
        </button>
        <StarBalance amount={profile?.balance ?? 0} />
      </div>

      <StarPromoBanner />

      {resumeBanner}

      {/* Play games */}
      <section>
        <SectionHeader title="Во что сыграем?" />
        <div className="grid grid-cols-2 gap-3">
          {resumeGames.slice(0, 2).map((g) => (
            <button key={g.id} onClick={() => onPlay(g.id)} className="text-left">
              <Card flush className="transition active:scale-[0.98]">
                <div className="aspect-square overflow-hidden bg-gold-light/15">
                  <img
                    src={gameImg[g.id]}
                    alt={g.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="p-3.5">
                  <p className="font-bold leading-tight">{g.name}</p>
                  <p className="mt-0.5 text-xs text-muted">Твой Elo {eloFor(g.id, g.elo)}</p>
                </div>
              </Card>
            </button>
          ))}
        </div>

        {resumeGames.slice(2).map((g) => (
          <button
            key={g.id}
            onClick={() => onPlay(g.id)}
            className="mt-3 block w-full text-left"
          >
            <Card flush className="flex items-center transition active:scale-[0.98]">
              <div className="h-24 w-28 shrink-0 overflow-hidden bg-gold-light/15">
                <img
                  src={gameImg[g.id]}
                  alt={g.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex-1 px-4">
                <p className="font-bold leading-tight">{g.name}</p>
                <p className="mt-0.5 text-xs text-muted">Твой Elo {eloFor(g.id, g.elo)}</p>
              </div>
              <ChevronRight size={18} className="mr-4 text-muted" />
            </Card>
          </button>
        ))}
      </section>

      {/* Popular games */}
      <section>
        <SectionHeader title="Популярные игры" />
        <Card className="divide-y divide-line/70 p-0">
          {popularGames.map((g) => (
            <button
              key={g.id}
              onClick={() => onPlay(g.id)}
              className="flex w-full items-center gap-3 p-3 text-left transition active:bg-bg"
            >
              <img
                src={gameImg[g.id]}
                alt={g.name}
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
              />
              <div className="flex-1">
                <p className="font-bold leading-tight">{g.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <Users size={12} />
                  {g.playing.toLocaleString('ru-RU')} играют
                </p>
              </div>
              <ChevronRight size={18} className="text-muted" />
            </button>
          ))}
        </Card>
      </section>

      {/* More games (coming soon) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Больше игр</h2>
          <span className="text-xs font-medium text-muted">Скоро в GameHub</span>
        </div>
        <Card className="grid grid-cols-3 gap-2 p-3">
          {comingGames.map((c) => (
            <div
              key={c.id}
              className="flex flex-col items-center gap-2 text-center"
            >
              <img
                src={gameImg[c.id]}
                alt={c.name}
                className="h-14 w-14 rounded-xl object-cover"
              />
              <div>
                <p className="text-[13px] font-bold leading-tight">{c.name}</p>
                <p className="text-[11px] text-muted">Скоро</p>
              </div>
            </div>
          ))}
        </Card>
      </section>

      {/* Invite a friend */}
      <Card
        flush
        className="relative flex items-center gap-2 bg-gradient-to-br from-gold-light/70 via-surface to-gold-light/40 p-4"
      >
        <img
          src="/assets/invite-gift.png"
          alt=""
          aria-hidden
          className="pointer-events-none -my-3 -ml-2 h-24 w-24 shrink-0 object-contain mix-blend-multiply"
          style={{
            WebkitMaskImage:
              'radial-gradient(ellipse 62% 62% at 50% 50%, #000 45%, transparent 72%)',
            maskImage:
              'radial-gradient(ellipse 62% 62% at 50% 50%, #000 45%, transparent 72%)',
          }}
        />
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">Позови друга</p>
          <p className="mt-0.5 text-xs leading-snug text-muted">
            Вы оба получите бонус GRAM на баланс
          </p>
        </div>
        <Button size="sm" onClick={() => shareInvite(String(user.id || user.username || 'guest'))}>
          Пригласить
        </Button>
      </Card>
    </div>
  )
}
