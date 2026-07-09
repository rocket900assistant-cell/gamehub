import { io, type Socket } from 'socket.io-client'

const URL =
  (import.meta.env as Record<string, string | undefined>).VITE_SERVER_URL ??
  'http://localhost:3001'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) socket = io(URL, { transports: ['websocket'] })
  return socket
}

export function registerUser(u: {
  userId: string
  name: string
  elo: number
  initData?: string
  username?: string
  photoUrl?: string
  vip?: boolean
}) {
  getSocket().emit('register', u)
}

/** A friend as the server sees them: real telegram id + live online flag. */
export interface ServerFriend {
  id: number
  name: string
  username?: string | null
  photoUrl?: string | null
  elo: number
  online: boolean
}

/** Add a friend by their telegram id (from a `friend_<id>` invite link). */
export function addFriend(code: string | number) {
  getSocket().emit('friend:add', { code })
}

/** Remove a friend (mutual). */
export function removeFriend(code: string | number) {
  getSocket().emit('friend:remove', { code })
}

/** Ask the server for the current friend list (also pushed automatically). */
export function requestFriends() {
  getSocket().emit('friend:list')
}

/** Change the player's display nickname (server persists + pushes fresh profile). */
export function setName(name: string) {
  getSocket().emit('set:name', { name })
}

/** Tell the server the player is now VIP (persists to DB, account-wide). */
export function setVip() {
  getSocket().emit('set:vip')
}

/** A finished match for the history screen. */
export interface HistoryEntry {
  game: 'chess' | 'durak' | 'nardy' | string
  result: 'win' | 'loss' | 'draw'
  reason?: string
  at: string
}

/** Ask the server for the last 10 matches (replies with 'history'). */
export function requestHistory() {
  getSocket().emit('history:get')
}

/** Invite a friend (by telegram id) into a private room for a game. */
export function inviteFriend(
  toTg: number,
  game: 'chess' | 'durak' | 'nardy',
  minutes: number,
  transfer?: boolean,
) {
  getSocket().emit('invite', { toTg, game, minutes, transfer })
}

/** Persisted player profile from the server DB. */
export interface Profile {
  tgId: number
  name: string
  username?: string
  photoUrl?: string
  elo: { chess: number; durak: number; nardy: number }
  balance: number
  games: number
  wins: number
  losses: number
  vip?: boolean
}

export interface Opponent {
  name: string
  elo: number
  vip?: boolean
}

export type MatchConfig =
  | {
      mode: 'local'
      minutes: number
      bot?: boolean
      // set when resuming a saved local game after the app was closed
      restoreFen?: string
      restoreClocks?: { w: number; b: number }
    }
  | {
      mode: 'online'
      minutes: number
      roomId: string
      color: 'w' | 'b'
      opponent: Opponent
      fen: string
      clocks: { w: number; b: number }
    }

export interface IncomingInvite {
  roomId: string
  from: { name?: string }
  game: string
  minutes: number
}
