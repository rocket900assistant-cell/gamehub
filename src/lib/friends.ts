import { friends as seed, type Friend } from '../data/mock'

const KEY = 'gh_friends'

/** The user's friends, persisted in localStorage (shared across all screens). */
export function getFriends(): Friend[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Friend[]
  } catch {
    // ignore corrupt storage
  }
  return seed
}

export function saveFriends(list: Friend[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // ignore quota errors
  }
}

export type { Friend }
