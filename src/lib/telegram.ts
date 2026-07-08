/**
 * Thin wrapper around the Telegram WebApp SDK (loaded via telegram-web-app.js).
 * Falls back to a mock user when opened outside Telegram (local dev / preview).
 */

export interface TgUser {
  id: number
  firstName: string
  lastName?: string
  username?: string
  photoUrl?: string
}

interface TelegramWebApp {
  ready: () => void
  expand: () => void
  openTelegramLink?: (url: string) => void
  setBackgroundColor?: (color: string) => void
  setHeaderColor?: (color: string) => void
  disableVerticalSwipes?: () => void
  onEvent?: (event: string, cb: () => void) => void
  viewportStableHeight?: number
  viewportHeight?: number
  initData?: string
  initDataUnsafe?: {
    start_param?: string
    user?: {
      id: number
      first_name: string
      last_name?: string
      username?: string
      photo_url?: string
    }
  }
}

// TODO: replace with the real bot username once it exists.
// TEST bot. Change to the official bot username when going live.
export const BOT_USERNAME = 'Testappforcodebot'
export const STARS_BOT_URL = 'https://t.me/'

/** Opens the external stars-purchase bot (inside Telegram if available). */
export function openStarsBot() {
  const wa = getWebApp()
  if (wa?.openTelegramLink) wa.openTelegramLink(STARS_BOT_URL)
  else window.open(STARS_BOT_URL, '_blank')
}

/** Deep link that opens the mini app straight into a specific game room. */
export function makeGameLink(gameId: string): string {
  return `https://t.me/${BOT_USERNAME}?startapp=${gameId}`
}

/** Deep link that drops a friend straight into a specific game room (lobby). */
export function makeJoinLink(roomId: string): string {
  return `https://t.me/${BOT_USERNAME}?startapp=join_${roomId}`
}

/** Opens Telegram's share sheet with a room-join link. */
export function shareJoinLink(roomId: string, text: string) {
  const url = makeJoinLink(roomId)
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  const wa = getWebApp()
  if (wa?.openTelegramLink) wa.openTelegramLink(shareUrl)
  else window.open(shareUrl, '_blank')
}

/** Opens Telegram's native share sheet for a game invite link. */
export function shareGameLink(gameId: string, text: string) {
  const url = makeGameLink(gameId)
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  const wa = getWebApp()
  if (wa?.openTelegramLink) wa.openTelegramLink(shareUrl)
  else window.open(shareUrl, '_blank')
}

/** Deep link that adds the sharer as a friend (mutual) when opened. */
export function makeFriendLink(myId: number | string): string {
  return `https://t.me/${BOT_USERNAME}?startapp=friend_${myId}`
}

/** Opens Telegram's share sheet with a "add me as a friend" link. */
export function shareFriendLink(myId: number | string) {
  const url = makeFriendLink(myId)
  const text = 'Добавляйся ко мне в друзья в GameHub — сыграем в шахматы, дурак или нарды!'
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  const wa = getWebApp()
  if (wa?.openTelegramLink) wa.openTelegramLink(shareUrl)
  else window.open(shareUrl, '_blank')
}

/** Opens Telegram's share sheet with a referral link to the whole app. */
export function shareInvite(refCode: string) {
  const url = `https://t.me/${BOT_USERNAME}?startapp=ref_${refCode}`
  const text =
    'Играй со мной в GameHub — шахматы, дурак и нарды. Заходи, и мы оба получим бонус GRAM 🎁'
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  const wa = getWebApp()
  if (wa?.openTelegramLink) wa.openTelegramLink(shareUrl)
  else window.open(shareUrl, '_blank')
}

/** Raw signed initData string — sent to the server to verify the user's identity. */
export function getInitData(): string {
  return getWebApp()?.initData ?? ''
}

/** The `startapp=` deep-link parameter the app was opened with (if any). */
export function getStartParam(): string | undefined {
  const wa = getWebApp()
  const p = wa?.initDataUnsafe?.start_param
  if (p) return p
  // browser / preview fallback: ?startapp=… or ?tgWebAppStartParam=…
  const q = new URLSearchParams(window.location.search)
  return q.get('startapp') ?? q.get('tgWebAppStartParam') ?? undefined
}

function getWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } })
    .Telegram?.WebApp
}

const MOCK_USER: TgUser = {
  id: 0,
  firstName: 'Александр',
  username: 'mahrmusaev',
}

/** Keeps a CSS var in sync with Telegram's stable viewport height. */
function syncViewport(wa: TelegramWebApp) {
  const apply = () => {
    const h = wa.viewportStableHeight || wa.viewportHeight || window.innerHeight
    document.documentElement.style.setProperty('--app-h', `${h}px`)
  }
  apply()
  wa.onEvent?.('viewportChanged', apply)
}

export function initTelegram(): TgUser {
  const wa = getWebApp()
  if (wa) {
    wa.ready()
    wa.expand()
    try {
      wa.setBackgroundColor?.('#f8f5f0')
      wa.setHeaderColor?.('#f8f5f0')
      wa.disableVerticalSwipes?.()
    } catch {
      // older Telegram clients — ignore
    }
    syncViewport(wa)
    const u = wa.initDataUnsafe?.user
    if (u) {
      return {
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
        photoUrl: u.photo_url,
      }
    }
  }
  return MOCK_USER
}

/** Display name — first (+ last) name; used everywhere in the UI. */
export function displayName(u: TgUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ')
}
