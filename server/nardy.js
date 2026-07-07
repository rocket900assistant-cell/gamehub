// Server-authoritative Long Nardy engine (JS port of src/lib/nardy.ts).
// points[i]: >0 white count, <0 black count, 0 empty. No hitting; one off the head per turn.

const PATH = {
  w: [23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  b: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12],
}
export const HEAD = { w: 23, b: 11 }

const sign = (p) => (p === 'w' ? 1 : -1)
export const other = (p) => (p === 'w' ? 'b' : 'w')
export const ownerOf = (v) => (v > 0 ? 'w' : v < 0 ? 'b' : null)
const trackIndex = (p, phys) => PATH[p].indexOf(phys)

function rollDice() {
  const a = 1 + Math.floor(Math.random() * 6)
  const b = 1 + Math.floor(Math.random() * 6)
  return { rolled: [a, b], dice: a === b ? [a, a, a, a] : [a, b] }
}

export function createNardy() {
  const points = new Array(24).fill(0)
  points[HEAD.w] = 15
  points[HEAD.b] = -15
  return {
    points,
    off: { w: 0, b: 0 },
    turn: 'w',
    dice: [],
    rolled: null,
    awaitingRoll: true,
    movedFromHead: false,
    lastMove: null,
    result: null,
  }
}

export function roll(st) {
  if (st.result || !st.awaitingRoll) return st
  const n = clone(st)
  const r = rollDice()
  n.rolled = r.rolled
  n.dice = r.dice
  n.awaitingRoll = false
  if (!hasAnyMove(n)) endTurn(n)
  return n
}

function allHome(st, p) {
  for (let i = 0; i < 24; i++) {
    if (ownerOf(st.points[i]) === p && trackIndex(p, i) < 18) return false
  }
  return true
}

export function destOf(st, p, from, d) {
  const t = trackIndex(p, from)
  if (t < 0) return null
  const nt = t + d
  if (nt < 24) {
    const phys = PATH[p][nt]
    const o = ownerOf(st.points[phys])
    if (o && o !== p) return null
    return phys
  }
  if (!allHome(st, p)) return null
  if (nt === 24) return 'off'
  for (let i = 0; i < 24; i++) {
    if (ownerOf(st.points[i]) === p && trackIndex(p, i) < t) return null
  }
  return 'off'
}

export function legalFrom(st, from) {
  const p = st.turn
  if (st.result || ownerOf(st.points[from]) !== p) return []
  if (from === HEAD[p] && st.movedFromHead) return []
  const res = []
  const seen = new Set()
  for (const d of st.dice) {
    if (seen.has(d)) continue
    seen.add(d)
    if (destOf(st, p, from, d) !== null) res.push(d)
  }
  return res
}

export function legalMoves(st) {
  const out = []
  if (st.result) return out
  const p = st.turn
  for (let i = 0; i < 24; i++) {
    if (ownerOf(st.points[i]) !== p) continue
    for (const d of legalFrom(st, i)) out.push({ from: i, die: d, dest: destOf(st, p, i, d) })
  }
  return out
}

export const hasAnyMove = (st) => legalMoves(st).length > 0

function clone(st) {
  return { ...st, points: [...st.points], off: { ...st.off }, dice: [...st.dice] }
}

function endTurn(n) {
  n.turn = other(n.turn)
  n.dice = []
  n.rolled = null
  n.awaitingRoll = true
  n.movedFromHead = false
}

export function move(st, from, d) {
  const p = st.turn
  if (!legalFrom(st, from).includes(d)) return st
  const de = destOf(st, p, from, d)
  if (de === null) return st
  const n = clone(st)
  n.points[from] -= sign(p)
  if (de === 'off') n.off[p]++
  else n.points[de] += sign(p)
  n.lastMove = { from, to: de }
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

export function pass(st) {
  if (st.result || hasAnyMove(st)) return st
  const n = clone(st)
  endTurn(n)
  return n
}
