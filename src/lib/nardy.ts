/**
 * Длинные нарды (Long Nardy), 1 vs 1.
 * Pure engine: state + rule-checked moves + a simple bot. UI-agnostic.
 *
 * Board = 24 physical points (0..23). `points[i]` holds a signed count:
 *   > 0 → white checkers, < 0 → black checkers, 0 → empty.
 * Both players race their 15 checkers 24 steps along their own path to the
 * home quadrant, then bear them off. No hitting: a point with any opponent
 * checker is blocked. Only ONE checker may leave the head per turn.
 */

export type NPlayer = 'w' | 'b'

export interface NardyState {
  points: number[] // length 24; +white / -black / 0 empty
  off: { w: number; b: number } // borne-off checkers
  turn: NPlayer
  dice: number[] // dice still to play this turn ([3,5] or [4,4,4,4])
  rolled: [number, number] | null // last raw roll (for display)
  movedFromHead: boolean // a checker already left the head this turn
  result: NPlayer | null
}

// Each player's route (physical point indices) from head (index 0) to the
// last point before bearing off (index 23). Home = track indices 18..23.
const PATH: Record<NPlayer, number[]> = {
  w: [23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  b: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12],
}
export const HEAD: Record<NPlayer, number> = { w: 23, b: 11 } // physical head point

const sign = (p: NPlayer) => (p === 'w' ? 1 : -1)
export const other = (p: NPlayer): NPlayer => (p === 'w' ? 'b' : 'w')
export const ownerOf = (v: number): NPlayer | null => (v > 0 ? 'w' : v < 0 ? 'b' : null)
export const countAt = (v: number) => Math.abs(v)
const trackIndex = (p: NPlayer, phys: number) => PATH[p].indexOf(phys)

function rollDice(): { rolled: [number, number]; dice: number[] } {
  const a = 1 + Math.floor(Math.random() * 6)
  const b = 1 + Math.floor(Math.random() * 6)
  return { rolled: [a, b], dice: a === b ? [a, a, a, a] : [a, b] }
}

export function createNardy(): NardyState {
  const points = new Array(24).fill(0)
  points[HEAD.w] = 15
  points[HEAD.b] = -15
  const { rolled, dice } = rollDice()
  return {
    points,
    off: { w: 0, b: 0 },
    turn: 'w',
    dice,
    rolled,
    movedFromHead: false,
    result: null,
  }
}

/** Are all of player p's checkers in the home quadrant (track 18..23)? */
function allHome(st: NardyState, p: NPlayer): boolean {
  for (let i = 0; i < 24; i++) {
    if (ownerOf(st.points[i]) === p && trackIndex(p, i) < 18) return false
  }
  return true
}

/** Where a checker at physical `from` lands with die `d`: point index | 'off' | null. */
export function destOf(
  st: NardyState,
  p: NPlayer,
  from: number,
  d: number,
): number | 'off' | null {
  const t = trackIndex(p, from)
  if (t < 0) return null
  const nt = t + d
  if (nt < 24) {
    const phys = PATH[p][nt]
    const o = ownerOf(st.points[phys])
    if (o && o !== p) return null // blocked by opponent
    return phys
  }
  if (!allHome(st, p)) return null
  if (nt === 24) return 'off' // exact bear-off
  // overshoot bear-off: only from the furthest-back checker in home
  for (let i = 0; i < 24; i++) {
    if (ownerOf(st.points[i]) === p && trackIndex(p, i) < t) return null
  }
  return 'off'
}

/** Die values that can be played from physical point `from` this turn. */
export function legalFrom(st: NardyState, from: number): number[] {
  const p = st.turn
  if (st.result || ownerOf(st.points[from]) !== p) return []
  if (from === HEAD[p] && st.movedFromHead) return []
  const res: number[] = []
  const seen = new Set<number>()
  for (const d of st.dice) {
    if (seen.has(d)) continue
    seen.add(d)
    if (destOf(st, p, from, d) !== null) res.push(d)
  }
  return res
}

/** Every legal (from, die, dest) for the current player. */
export function legalMoves(st: NardyState): { from: number; die: number; dest: number | 'off' }[] {
  const out: { from: number; die: number; dest: number | 'off' }[] = []
  if (st.result) return out
  const p = st.turn
  for (let i = 0; i < 24; i++) {
    if (ownerOf(st.points[i]) !== p) continue
    for (const d of legalFrom(st, i)) {
      out.push({ from: i, die: d, dest: destOf(st, p, i, d) as number | 'off' })
    }
  }
  return out
}

export const hasAnyMove = (st: NardyState) => legalMoves(st).length > 0

function clone(st: NardyState): NardyState {
  return { ...st, points: [...st.points], off: { ...st.off } }
}

function endTurn(n: NardyState) {
  n.turn = other(n.turn)
  const r = rollDice()
  n.rolled = r.rolled
  n.dice = r.dice
  n.movedFromHead = false
}

/** Play one checker from physical `from` using die `d`. Illegal → unchanged. */
export function move(st: NardyState, from: number, d: number): NardyState {
  const p = st.turn
  if (!legalFrom(st, from).includes(d)) return st
  const de = destOf(st, p, from, d)
  if (de === null) return st
  const n = clone(st)
  n.points[from] -= sign(p)
  if (de === 'off') n.off[p]++
  else n.points[de] += sign(p)
  const di = n.dice.indexOf(d)
  if (di >= 0) n.dice.splice(di, 1)
  if (from === HEAD[p]) n.movedFromHead = true
  if (n.off[p] === 15) {
    n.result = p
    return n
  }
  if (n.dice.length === 0 || !hasAnyMove(n)) endTurn(n)
  return n
}

/** No legal moves → forfeit the turn (roll passes to the opponent). */
export function pass(st: NardyState): NardyState {
  if (st.result || hasAnyMove(st)) return st
  const n = clone(st)
  endTurn(n)
  return n
}

// ── Simple bot ──────────────────────────────────────────────────────
/** One bot ply: play a single checker (prefers bearing off, then advancing). */
export function botStep(st: NardyState): NardyState {
  if (st.result || st.turn !== 'b') return st
  const moves = legalMoves(st)
  if (moves.length === 0) return pass(st)
  // prefer bearing off; otherwise advance the furthest-back checker; bigger die first
  const score = (m: { from: number; die: number; dest: number | 'off' }) => {
    if (m.dest === 'off') return 1000 + m.die
    return trackIndex('b', m.from) * -1 + m.die // lower track (further back) = higher priority
  }
  const best = [...moves].sort((a, b) => score(b) - score(a))[0]
  return move(st, best.from, best.die)
}
