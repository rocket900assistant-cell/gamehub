/**
 * Cosmetic skins for the shop: chess piece sets + board themes.
 * Selection ("equipped") and ownership persist in localStorage.
 * Free items (default pieces, green board) are always owned.
 */
import type { CSSProperties } from 'react'

export type Tier = 'common' | 'rare' | 'epic' | 'legendary'

export interface PieceSkin {
  id: string
  name: string
  tier: Tier
  price: number
  /** Folder under /public/piece/. Undefined = react-chessboard built-in set. */
  dir?: string
  free?: boolean
}

export interface BoardSkin {
  id: string
  name: string
  tier: Tier
  price: number
  kind: 'solid' | 'texture'
  light?: string
  dark?: string
  texture?: string
  free?: boolean
}

export const PIECE_SKINS: PieceSkin[] = [
  { id: 'default', name: 'Классика', tier: 'common', price: 0, free: true },
  { id: 'dubrovny', name: 'Dubrovny', tier: 'rare', price: 150, dir: 'dubrovny' },
  { id: 'celtic', name: 'Celtic', tier: 'epic', price: 150, dir: 'celtic' },
  { id: 'pirouetti', name: 'Pirouetti', tier: 'legendary', price: 150, dir: 'pirouetti' },
]

export const BOARD_SKINS: BoardSkin[] = [
  { id: 'green', name: 'Классик зелёный', tier: 'common', price: 0, free: true, kind: 'solid', light: '#EEEED2', dark: '#769656' },
  { id: 'grey', name: 'Серый', tier: 'common', price: 150, kind: 'solid', light: '#E8E8E8', dark: '#9E9E9E' },
  { id: 'pink', name: 'Розовый', tier: 'rare', price: 150, kind: 'solid', light: '#F2DCE0', dark: '#C08497' },
  { id: 'marble', name: 'Мрамор', tier: 'epic', price: 150, kind: 'texture', texture: '/assets/board/marble.jpg' },
]

/** Durak card backs (рубашки) — the face-down card image. */
export interface ImageSkin {
  id: string
  name: string
  tier: Tier
  price: number
  src: string
  free?: boolean
}

export const DURAK_BACKS: ImageSkin[] = [
  { id: 'back-default', name: 'Классика', tier: 'common', price: 0, free: true, src: '/assets/durak/card-back-basic.png' },
  { id: 'back-emerald', name: 'Изумруд', tier: 'rare', price: 150, src: '/assets/durak/backs/emerald.jpg' },
  { id: 'back-sapphire', name: 'Сапфир Deco', tier: 'epic', price: 150, src: '/assets/durak/backs/sapphire.jpg' },
  { id: 'back-phoenix', name: 'Феникс', tier: 'legendary', price: 150, src: '/assets/durak/backs/phoenix.jpg' },
]

/** Durak table felts (полотна) — the full-table background. */
export const DURAK_FELTS: ImageSkin[] = [
  { id: 'felt-default', name: 'Синяя кожа', tier: 'common', price: 0, free: true, src: '/assets/durak/felt.jpg' },
  { id: 'felt-cream', name: 'Кремовое', tier: 'rare', price: 150, src: '/assets/durak/felts/cream.jpg' },
  { id: 'felt-green', name: 'Зелёное сукно', tier: 'rare', price: 150, src: '/assets/durak/felts/green.jpg' },
  { id: 'felt-burgundy', name: 'Бордовый бархат', tier: 'epic', price: 150, src: '/assets/durak/felts/burgundy.jpg' },
]

/** Nardy checkers (фишки) — a light + dark pair. */
export interface CheckerSkin {
  id: string
  name: string
  price: number
  light: string
  dark: string
  free?: boolean
}

export const NARDY_CHECKERS: CheckerSkin[] = [
  { id: 'checker-default', name: 'Классика', price: 0, free: true, light: '/assets/nardy/checker-light.png', dark: '/assets/nardy/checker-dark.png' },
  { id: 'checker-marble', name: 'Мрамор', price: 150, light: '/assets/nardy/checkers/marble/light.png', dark: '/assets/nardy/checkers/marble/dark.png' },
  { id: 'checker-emerald', name: 'Изумруд', price: 150, light: '/assets/nardy/checkers/emerald/light.png', dark: '/assets/nardy/checkers/emerald/dark.png' },
  { id: 'checker-royal', name: 'Оникс-Роял', price: 150, light: '/assets/nardy/checkers/royal/light.png', dark: '/assets/nardy/checkers/royal/dark.png' },
]

const FREE_PIECE = 'default'
const FREE_BOARD = 'green'
const FREE_BACK = 'back-default'
const FREE_FELT = 'felt-default'
const FREE_CHECKER = 'checker-default'

const OWNED_KEY = 'gh_owned_skins'
const VIP_KEY = 'gh_vip'
const EQUIP_PIECE_KEY = 'gh_skin_piece'
const EQUIP_BOARD_KEY = 'gh_skin_board'
const EQUIP_BACK_KEY = 'gh_skin_back'
const EQUIP_FELT_KEY = 'gh_skin_felt'
const EQUIP_CHECKER_KEY = 'gh_skin_checker'

const FREE_IDS = new Set(
  [...PIECE_SKINS, ...BOARD_SKINS, ...DURAK_BACKS, ...DURAK_FELTS, ...NARDY_CHECKERS]
    .filter((s) => s.free)
    .map((s) => s.id),
)

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function ownedSet(): Set<string> {
  try {
    const raw = read(OWNED_KEY)
    const arr = raw ? (JSON.parse(raw) as string[]) : []
    return new Set(arr)
  } catch {
    return new Set()
  }
}

/** VIP price (uniform across stores). */
export const VIP_PRICE_STARS = 999
export const VIP_PRICE_GRAM = 10

export function isVip(): boolean {
  return read(VIP_KEY) === '1'
}
export function buyVip() {
  write(VIP_KEY, '1')
}
/** Reflect the server's VIP truth locally (so isVip() is consistent on this device). */
export function syncVip(v: boolean) {
  if (v) write(VIP_KEY, '1')
}

export function isOwned(id: string): boolean {
  if (FREE_IDS.has(id)) return true
  if (isVip()) return true // VIP unlocks every skin in the shop
  return ownedSet().has(id)
}

export function buy(id: string) {
  const owned = ownedSet()
  owned.add(id)
  write(OWNED_KEY, JSON.stringify([...owned]))
}

export function getEquippedPieceId(): string {
  const id = read(EQUIP_PIECE_KEY) ?? FREE_PIECE
  return PIECE_SKINS.some((s) => s.id === id) && isOwned(id) ? id : FREE_PIECE
}

export function getEquippedBoardId(): string {
  const id = read(EQUIP_BOARD_KEY) ?? FREE_BOARD
  return BOARD_SKINS.some((s) => s.id === id) && isOwned(id) ? id : FREE_BOARD
}

export function equipPiece(id: string) {
  if (isOwned(id)) write(EQUIP_PIECE_KEY, id)
}
export function equipBoard(id: string) {
  if (isOwned(id)) write(EQUIP_BOARD_KEY, id)
}

/** Folder of the equipped piece set, or undefined for the built-in default. */
export function equippedPieceDir(): string | undefined {
  return PIECE_SKINS.find((s) => s.id === getEquippedPieceId())?.dir
}

export function equippedBoard(): BoardSkin {
  return BOARD_SKINS.find((s) => s.id === getEquippedBoardId()) ?? BOARD_SKINS[0]
}

export function getEquippedBackId(): string {
  const id = read(EQUIP_BACK_KEY) ?? FREE_BACK
  return DURAK_BACKS.some((s) => s.id === id) && isOwned(id) ? id : FREE_BACK
}
export function getEquippedFeltId(): string {
  const id = read(EQUIP_FELT_KEY) ?? FREE_FELT
  return DURAK_FELTS.some((s) => s.id === id) && isOwned(id) ? id : FREE_FELT
}
export function equipDurakBack(id: string) {
  if (isOwned(id)) write(EQUIP_BACK_KEY, id)
}
export function equipDurakFelt(id: string) {
  if (isOwned(id)) write(EQUIP_FELT_KEY, id)
}
/** Image URL of the equipped Durak card back (used by every face-down card). */
export function equippedDurakBackSrc(): string {
  return DURAK_BACKS.find((s) => s.id === getEquippedBackId())?.src ?? DURAK_BACKS[0].src
}
/** Image URL of the equipped Durak table felt. */
export function equippedDurakFeltSrc(): string {
  return DURAK_FELTS.find((s) => s.id === getEquippedFeltId())?.src ?? DURAK_FELTS[0].src
}

export function getEquippedCheckerId(): string {
  const id = read(EQUIP_CHECKER_KEY) ?? FREE_CHECKER
  return NARDY_CHECKERS.some((s) => s.id === id) && isOwned(id) ? id : FREE_CHECKER
}
export function equipChecker(id: string) {
  if (isOwned(id)) write(EQUIP_CHECKER_KEY, id)
}
/** Light + dark image URLs of the equipped Nardy checker set. */
export function equippedCheckerSrcs(): { light: string; dark: string } {
  const s = NARDY_CHECKERS.find((s) => s.id === getEquippedCheckerId()) ?? NARDY_CHECKERS[0]
  return { light: s.light, dark: s.dark }
}

/** react-chessboard style options for a board skin. */
export function boardStyleFor(b: BoardSkin): {
  boardStyle: CSSProperties
  lightSquareStyle: CSSProperties
  darkSquareStyle: CSSProperties
  lightSquareNotationStyle: CSSProperties
  darkSquareNotationStyle: CSSProperties
} {
  if (b.kind === 'texture') {
    return {
      boardStyle: {
        backgroundImage: `url(${b.texture})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderRadius: '10px',
        overflow: 'hidden',
      },
      lightSquareStyle: { backgroundColor: 'rgba(255,255,255,0.06)' },
      darkSquareStyle: { backgroundColor: 'rgba(0,0,0,0.30)' },
      lightSquareNotationStyle: { color: 'rgba(0,0,0,0.5)' },
      darkSquareNotationStyle: { color: 'rgba(255,255,255,0.6)' },
    }
  }
  return {
    boardStyle: { borderRadius: '10px', overflow: 'hidden' },
    lightSquareStyle: { backgroundColor: b.light },
    darkSquareStyle: { backgroundColor: b.dark },
    lightSquareNotationStyle: { color: b.dark },
    darkSquareNotationStyle: { color: b.light },
  }
}
