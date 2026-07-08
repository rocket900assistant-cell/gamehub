/** Mock data for the design build. Replaced by real API later. */

export interface Game {
  id: string
  name: string
  tagline: string
  online: number
  elo: number
  live: boolean
  accent: string // token-based tailwind gradient classes
}

export interface ComingGame {
  id: string
  name: string
}

export interface LeaderRow {
  rank: number
  name: string
  stars: number
}

export interface ShopItem {
  id: string
  name: string
  price: number
  tier: 'common' | 'rare' | 'epic' | 'legendary'
  category: string
}

export const player = {
  balance: 13,
  elo: 1240,
  winrate: 68,
  streak: 5,
}

export const profile = {
  id: 123456789,
  vip: true,
  elo: 2350,
  eloDelta: 48,
  topPercent: 12,
}

/** Elo history points for the profile sparkline. */
export const eloTrend = [2180, 2205, 2188, 2246, 2268, 2238, 2296, 2318, 2304, 2350]

export interface ProfileStat {
  label: string
  value: number
  sub?: string
}

export const profileStats: ProfileStat[] = [
  { label: 'Победы', value: 248, sub: '62%' },
  { label: 'Поражения', value: 152, sub: '38%' },
  { label: 'Ничьих', value: 28, sub: '8%' },
  { label: 'Всего партий', value: 428 },
]

export interface FavGame {
  id: string
  name: string
  elo: number | null
  played: number
  progress: number
  soon?: boolean
}

export const favoriteGames: FavGame[] = [
  { id: 'chess', name: 'Шахматы', elo: 2350, played: 248, progress: 0.85 },
  { id: 'durak', name: 'Дурак', elo: 1800, played: 152, progress: 0.6 },
]

export interface Friend {
  id: string
  name: string
  username: string
  online: boolean
  elo: number
}

// Empty by default — the user's real friends live in localStorage (added by @username).
export const friends: Friend[] = []

export interface ProfileMenuItem {
  id: string
  label: string
  value?: string
}

export const profileMenu: ProfileMenuItem[] = [
  { id: 'friends', label: 'Друзья', value: '24' },
  { id: 'collection', label: 'Коллекция', value: '24/120' },
  { id: 'history', label: 'История матчей' },
  { id: 'stats', label: 'Статистика' },
]

export const games: Game[] = [
  {
    id: 'durak',
    name: 'Дурак',
    tagline: 'Классика на GRAM',
    online: 1234,
    elo: 1180,
    live: true,
    accent: 'from-danger/90 to-danger',
  },
  {
    id: 'chess',
    name: 'Шахматы',
    tagline: 'Стратегия и интеллект',
    online: 987,
    elo: 1240,
    live: true,
    accent: 'from-ink/90 to-ink',
  },
]

export const comingGames: ComingGame[] = [
  { id: 'poker', name: 'Покер' },
  { id: 'checkers', name: 'Шашки' },
  { id: 'tictactoe', name: 'Крестики' },
]

export interface ResumeGame {
  id: string
  name: string
  elo: number
}

export const resumeGames: ResumeGame[] = [
  { id: 'chess', name: 'Шахматы', elo: 2350 },
  { id: 'durak', name: 'Дурак', elo: 1800 },
  { id: 'backgammon', name: 'Нарды', elo: 1500 },
]

export interface PopularGame {
  id: string
  name: string
  playing: number
}

export const popularGames: PopularGame[] = [
  { id: 'chess', name: 'Шахматы', playing: 1234 },
  { id: 'durak', name: 'Дурак', playing: 987 },
]

export const leaderboard: LeaderRow[] = [
  { rank: 1, name: 'Дмитрий', stars: 48500 },
  { rank: 2, name: 'Мария', stars: 35200 },
  { rank: 3, name: 'Иван', stars: 22150 },
]

export const shopTabs = ['Популярное', 'VIP', 'Косметика'] as const

export const cardDecks: ShopItem[] = [
  { id: 'royal-gold', name: 'Royal Gold', price: 1500, tier: 'legendary', category: 'Колоды карт' },
  { id: 'dark-knight', name: 'Dark Knight', price: 1500, tier: 'epic', category: 'Колоды карт' },
  { id: 'ice-queen', name: 'Ice Queen', price: 1500, tier: 'epic', category: 'Колоды карт' },
  { id: 'crimson-king', name: 'Crimson King', price: 1500, tier: 'rare', category: 'Колоды карт' },
]

export const vipTiers: ShopItem[] = [
  { id: 'vip-gold', name: 'VIP Gold', price: 4990, tier: 'rare', category: 'VIP статус' },
  { id: 'vip-platinum', name: 'VIP Platinum', price: 9990, tier: 'epic', category: 'VIP статус' },
  { id: 'vip-diamond', name: 'VIP Diamond', price: 14990, tier: 'legendary', category: 'VIP статус' },
]
