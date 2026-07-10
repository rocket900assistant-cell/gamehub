// N-player подкидной дурак — JS port of src/lib/durakN.ts (server-authoritative).
// Seats are indices 0..n-1; viewForN hides other hands per seat.

const SUITS = ['♠', '♥', '♦', '♣']
export const cardId = (c) => `${c.rank}${c.suit}`

const minRankFor = (size) => (size === 24 ? 9 : size === 52 ? 2 : 6)

function makeDeck(size = 36) {
  const min = minRankFor(size)
  const d = []
  for (const suit of SUITS) for (let r = min; r <= 14; r++) d.push({ rank: r, suit })
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

function sortHand(hand, trump) {
  return [...hand].sort((a, b) => {
    const at = a.suit === trump ? 1 : 0
    const bt = b.suit === trump ? 1 : 0
    if (at !== bt) return at - bt
    if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
    return a.rank - b.rank
  })
}

export function beats(att, def, trump) {
  if (att.suit === def.suit) return def.rank > att.rank
  return def.suit === trump && att.suit !== trump
}

export function createGameN(opts = {}) {
  const n = Math.max(2, Math.min(6, opts.players ?? 2))
  const deck = makeDeck(opts.deck ?? 36)
  const trumpCard = deck[deck.length - 1]
  const trump = trumpCard.suit
  const hands = Array.from({ length: n }, () => [])
  for (let i = 0; i < 6; i++) for (let p = 0; p < n; p++) hands[p].push(deck.shift())
  for (let p = 0; p < n; p++) hands[p] = sortHand(hands[p], trump)

  const lowestTrump = (h) =>
    h.filter((c) => c.suit === trump).reduce((m, c) => Math.min(m, c.rank), 99)
  let attacker = 0
  let best = 999
  for (let p = 0; p < n; p++) {
    const lt = lowestTrump(hands[p])
    if (lt < best) {
      best = lt
      attacker = p
    }
  }
  const out = Array(n).fill(false)
  const defender = nextIn(out, attacker)
  return {
    n,
    deck,
    trump,
    trumpCard,
    hands,
    table: [],
    attacker,
    defender,
    turn: attacker,
    taking: false,
    passed: Array(n).fill(false),
    out,
    discard: 0,
    neighborsOnly: !!opts.neighborsOnly,
    transfer: !!opts.transfer,
    allowDraw: opts.allowDraw ?? true,
    result: null,
  }
}

function nextIn(out, from) {
  const n = out.length
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n
    if (!out[s]) return s
  }
  return from
}
function prevIn(out, from) {
  const n = out.length
  for (let i = 1; i <= n; i++) {
    const s = (from - i + n) % n
    if (!out[s]) return s
  }
  return from
}

const inPlayCount = (s) => s.out.filter((o) => !o).length

const ranksOnTable = (s) => {
  const set = new Set()
  for (const p of s.table) {
    set.add(p.attack.rank)
    if (p.defend) set.add(p.defend.rank)
  }
  return set
}
const undefended = (s) => s.table.filter((p) => !p.defend).length
const tableLimit = (s) =>
  Math.min(6, s.hands[s.defender].length + s.table.filter((p) => p.defend).length)

function throwers(s) {
  if (s.neighborsOnly) {
    const order = []
    for (const seat of [s.attacker, prevIn(s.out, s.defender), nextIn(s.out, s.defender)]) {
      if (seat !== s.defender && !s.out[seat] && !order.includes(seat)) order.push(seat)
    }
    return order
  }
  const order = []
  for (let i = 0; i < s.n; i++) {
    const seat = (s.attacker + i) % s.n
    if (seat === s.defender || s.out[seat]) continue
    order.push(seat)
  }
  return order
}

export function legalThrow(s, seat) {
  if (s.result || s.out[seat] || seat === s.defender) return []
  const hand = s.hands[seat]
  if (s.table.length === 0) return seat === s.attacker && !s.taking ? hand : []
  if (s.table.length >= 6) return []
  const ranks = ranksOnTable(s)
  if (!s.taking && s.table.length >= tableLimit(s)) return []
  if (!s.taking && undefended(s) >= s.hands[s.defender].length) return []
  return hand.filter((c) => ranks.has(c.rank))
}

export function legalDefends(s) {
  if (s.result || s.turn !== s.defender || s.taking) return { pair: -1, cards: [] }
  const idx = s.table.findIndex((p) => !p.defend)
  if (idx < 0) return { pair: -1, cards: [] }
  const att = s.table[idx].attack
  return { pair: idx, cards: s.hands[s.defender].filter((c) => beats(att, c, s.trump)) }
}

export const canTake = (s) =>
  !s.result && !s.taking && s.turn === s.defender && undefended(s) > 0

function removeCard(hand, c) {
  const i = hand.findIndex((x) => x.rank === c.rank && x.suit === c.suit)
  const copy = [...hand]
  if (i >= 0) copy.splice(i, 1)
  return copy
}
function clone(s) {
  return {
    ...s,
    deck: [...s.deck],
    hands: s.hands.map((h) => [...h]),
    table: s.table.map((p) => ({ ...p })),
    passed: [...s.passed],
    out: [...s.out],
  }
}
function refill(s) {
  const order = []
  for (let i = 0; i < s.n; i++) {
    const seat = (s.attacker + i) % s.n
    if (seat !== s.defender && !s.out[seat]) order.push(seat)
  }
  if (!s.out[s.defender]) order.push(s.defender)
  for (const p of order) {
    while (s.hands[p].length < 6 && s.deck.length > 0) s.hands[p].push(s.deck.shift())
    s.hands[p] = sortHand(s.hands[p], s.trump)
  }
}
function settle(s) {
  if (s.deck.length === 0) {
    for (let p = 0; p < s.n; p++) if (!s.out[p] && s.hands[p].length === 0) s.out[p] = true
  }
  const alive = inPlayCount(s)
  if (alive <= 1) {
    let loser = s.out.findIndex((o) => !o)
    if (loser < 0) loser = s.allowDraw ? -1 : s.attacker
    s.result = { loser: loser < 0 ? null : loser }
  }
}
function startBout(s, newAttacker) {
  s.table = []
  s.taking = false
  s.passed = Array(s.n).fill(false)
  settle(s)
  if (s.result) return
  let att = newAttacker
  if (s.out[att]) att = nextIn(s.out, att)
  s.attacker = att
  s.defender = nextIn(s.out, att)
  s.turn = att
}

export function playAttack(s, seat, card) {
  if (!legalThrow(s, seat).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  n.hands[seat] = removeCard(n.hands[seat], card)
  n.table.push({ attack: card, by: seat })
  n.passed = Array(n.n).fill(false)
  n.turn = n.taking ? nextThrower(n, seat) : n.defender
  if (n.turn < 0) n.turn = n.attacker
  return n
}

export function playDefend(s, card, pairIndex) {
  if (s.result || s.turn !== s.defender || s.taking) return s
  const idx = pairIndex ?? s.table.findIndex((p) => !p.defend)
  if (idx < 0 || idx >= s.table.length) return s
  const pair = s.table[idx]
  if (pair.defend) return s
  if (!s.hands[s.defender].some((c) => cardId(c) === cardId(card))) return s
  if (!beats(pair.attack, card, s.trump)) return s
  const n = clone(s)
  n.hands[n.defender] = removeCard(n.hands[n.defender], card)
  n.table[idx].defend = card
  if (n.table.some((p) => !p.defend)) {
    n.turn = n.defender
  } else {
    n.passed = Array(n.n).fill(false)
    n.turn = firstThrower(n)
    if (n.turn < 0) return finishBeaten(n)
  }
  return n
}

export function canTransfer(s) {
  if (!s.transfer || s.result || s.taking) return false
  if (s.turn !== s.defender) return false
  if (s.table.length === 0 || s.table.some((p) => p.defend)) return false
  const rank = s.table[0].attack.rank
  if (!s.table.every((p) => p.attack.rank === rank)) return false
  const target = nextIn(s.out, s.defender)
  if (target === s.defender) return false
  if (s.table.length + 1 > s.hands[target].length) return false
  return s.hands[s.defender].some((c) => c.rank === rank)
}
export function legalTransfers(s) {
  if (!canTransfer(s)) return []
  const rank = s.table[0].attack.rank
  return s.hands[s.defender].filter((c) => c.rank === rank)
}
export function playTransfer(s, card) {
  if (!legalTransfers(s).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  const oldDef = n.defender
  n.hands[oldDef] = removeCard(n.hands[oldDef], card)
  n.table.push({ attack: card, by: oldDef })
  n.attacker = oldDef
  n.defender = nextIn(n.out, oldDef)
  n.passed = Array(n.n).fill(false)
  n.turn = n.defender
  return n
}

export function beginTake(s) {
  if (!canTake(s)) return s
  const n = clone(s)
  n.taking = true
  n.passed = Array(n.n).fill(false)
  n.turn = firstThrower(n)
  if (n.turn < 0) return finishTake(n)
  return n
}

export function pass(s, seat) {
  if (s.result) return s
  const windowOpen = s.taking || undefended(s) === 0
  if (!windowOpen || seat === s.defender || s.out[seat]) return s
  const n = clone(s)
  n.passed[seat] = true
  const next = nextThrower(n, seat)
  if (next >= 0) {
    n.turn = next
    return n
  }
  return n.taking ? finishTake(n) : finishBeaten(n)
}

function firstThrower(s) {
  for (const seat of throwers(s)) {
    if (!s.passed[seat] && legalThrow(s, seat).length > 0) return seat
  }
  return -1
}
function nextThrower(s, from) {
  const order = throwers(s)
  const i = order.indexOf(from)
  for (let k = 1; k <= order.length; k++) {
    const seat = order[(i + k) % order.length]
    if (!s.passed[seat] && legalThrow(s, seat).length > 0) return seat
  }
  return -1
}

function finishBeaten(s) {
  const n = clone(s)
  for (const p of n.table) n.discard += p.defend ? 2 : 1
  refill(n)
  startBout(n, n.defender)
  return n
}
export function finishTake(s) {
  const n = clone(s)
  const def = n.defender
  for (const p of n.table) {
    n.hands[def].push(p.attack)
    if (p.defend) n.hands[def].push(p.defend)
  }
  n.hands[def] = sortHand(n.hands[def], n.trump)
  refill(n)
  startBout(n, nextIn(n.out, def))
  return n
}

export function resign(s, seat) {
  if (s.result) return s
  const n = clone(s)
  n.out[seat] = true
  const alive = inPlayCount(n)
  if (alive <= 1) {
    const loser = n.out.findIndex((o) => !o)
    n.result = { loser: loser < 0 ? seat : loser }
  } else if (n.turn === seat || n.attacker === seat || n.defender === seat) {
    startBout(n, nextIn(n.out, seat))
  }
  return n
}

// ── bot ──
const value = (c, trump) => c.rank + (c.suit === trump ? 100 : 0)
const cheapest = (cs, trump) => [...cs].sort((a, b) => value(a, trump) - value(b, trump))[0]

export function botStep(s, seat) {
  if (s.result || s.turn !== seat) return s
  if (seat === s.defender && !s.taking) {
    if (canTransfer(s)) {
      const tr = legalTransfers(s).filter((c) => c.suit !== s.trump)
      if (tr.length) return playTransfer(s, cheapest(tr, s.trump))
    }
    const { cards, pair } = legalDefends(s)
    if (cards.length) return playDefend(s, cheapest(cards, s.trump), pair)
    return beginTake(s)
  }
  const legal = legalThrow(s, seat)
  if (legal.length === 0) return pass(s, seat)
  if (s.table.length === 0) return playAttack(s, seat, cheapest(legal, s.trump))
  const cheapNonTrump = legal.filter((c) => c.suit !== s.trump)
  if (cheapNonTrump.length && Math.random() < 0.6)
    return playAttack(s, seat, cheapest(cheapNonTrump, s.trump))
  return pass(s, seat)
}

// ── per-seat view (hide other hands) ──
const hideHand = (cards) => cards.map(() => ({ rank: 0, suit: '♠' }))
export function viewForN(s, seat) {
  return {
    ...s,
    deck: hideHand(s.deck),
    hands: s.hands.map((h, i) => (i === seat ? h : hideHand(h))),
    mySeat: seat,
  }
}
