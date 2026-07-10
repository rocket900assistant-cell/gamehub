/**
 * Подкидной дурак for N players (2..6). Classic rules, "подкидывают все".
 * Pure engine: state + rule-checked actions + a simple bot. UI/seat-agnostic
 * (seats are indices 0..n-1; the server flips views per seat, like durak.ts).
 */

export type Suit = '♠' | '♥' | '♦' | '♣'
export interface Card {
  rank: number // 6..14 (11=В, 12=Д, 13=К, 14=Т)
  suit: Suit
}
export interface TablePair {
  attack: Card
  defend?: Card
  by: number // seat that threw the attack card in
}

export interface DurakNState {
  n: number
  deck: Card[]
  trump: Suit
  trumpCard: Card | null
  hands: Card[][] // by seat
  table: TablePair[]
  attacker: number
  defender: number
  turn: number // seat whose action is expected now
  taking: boolean // defender chose to take → attackers may throw in more
  passed: boolean[] // throwers who declined in the current throw-in window
  out: boolean[] // players who finished (escaped: safe, no more cards)
  discard: number
  neighborsOnly: boolean // "Соседи" mode: only the defender's neighbours may throw in
  transfer: boolean // "Переводной" mode enabled
  allowDraw: boolean // "Ничья" mode enabled
  result: { loser: number | null } | null // loser seat, or null = draw
}

export interface GameNOptions {
  players?: number // 2..6
  deck?: number // 24 | 36 | 52
  neighborsOnly?: boolean // "Соседи": only the defender's two neighbours may throw in
  transfer?: boolean // "Переводной": defender may bounce the attack to the next player
  allowDraw?: boolean // "Ничья": last attack beaten + both emptied = draw (else attacker loses)
}

const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
export const isRed = (s: Suit) => s === '♥' || s === '♦'
export const rankLabel = (r: number): string =>
  ({ 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' } as Record<number, string>)[r] ?? String(r)
export const cardId = (c: Card) => `${c.rank}${c.suit}`

const minRankFor = (size: number) => (size === 24 ? 9 : size === 52 ? 2 : 6)

function makeDeck(size = 36): Card[] {
  const min = minRankFor(size)
  const d: Card[] = []
  for (const suit of SUITS) for (let r = min; r <= 14; r++) d.push({ rank: r, suit })
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

function sortHand(hand: Card[], trump: Suit): Card[] {
  return [...hand].sort((a, b) => {
    const at = a.suit === trump ? 1 : 0
    const bt = b.suit === trump ? 1 : 0
    if (at !== bt) return at - bt
    if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
    return a.rank - b.rank
  })
}

export function beats(att: Card, def: Card, trump: Suit): boolean {
  if (att.suit === def.suit) return def.rank > att.rank
  return def.suit === trump && att.suit !== trump
}

export function createGameN(opts: GameNOptions = {}): DurakNState {
  const n = Math.max(2, Math.min(6, opts.players ?? 2))
  const deck = makeDeck(opts.deck ?? 36)
  const trumpCard = deck[deck.length - 1]
  const trump = trumpCard.suit
  const hands: Card[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < 6; i++) for (let p = 0; p < n; p++) hands[p].push(deck.shift()!)
  for (let p = 0; p < n; p++) hands[p] = sortHand(hands[p], trump)

  // First attacker = player with the lowest trump.
  const lowestTrump = (h: Card[]) =>
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

/** Next seat after `from` (exclusive) that is still in play. */
function nextIn(out: boolean[], from: number): number {
  const n = out.length
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n
    if (!out[s]) return s
  }
  return from
}
/** Previous seat before `from` (exclusive) that is still in play. */
function prevIn(out: boolean[], from: number): number {
  const n = out.length
  for (let i = 1; i <= n; i++) {
    const s = (from - i + n) % n
    if (!out[s]) return s
  }
  return from
}

const inPlayCount = (s: DurakNState) => s.out.filter((o) => !o).length

const ranksOnTable = (s: DurakNState): Set<number> => {
  const set = new Set<number>()
  for (const p of s.table) {
    set.add(p.attack.rank)
    if (p.defend) set.add(p.defend.rank)
  }
  return set
}

const undefended = (s: DurakNState) => s.table.filter((p) => !p.defend).length

/** Max cards allowed on the table this bout (≤6 and ≤ defender hand size). */
const tableLimit = (s: DurakNState) => Math.min(6, s.hands[s.defender].length + s.table.filter((p) => p.defend).length)

/** Seats (in throw order: attacker first) that may throw a card in right now. */
function throwers(s: DurakNState): number[] {
  if (s.neighborsOnly) {
    // "Соседи": only the defender's two neighbours (one of which is the attacker).
    const order: number[] = []
    for (const seat of [s.attacker, prevIn(s.out, s.defender), nextIn(s.out, s.defender)]) {
      if (seat !== s.defender && !s.out[seat] && !order.includes(seat)) order.push(seat)
    }
    return order
  }
  const order: number[] = []
  for (let i = 0; i < s.n; i++) {
    const seat = (s.attacker + i) % s.n
    if (seat === s.defender || s.out[seat]) continue
    order.push(seat)
  }
  return order
}

/** Legal throw-in cards for `seat` (attack or подкидывание). */
export function legalThrow(s: DurakNState, seat: number): Card[] {
  if (s.result || s.out[seat] || seat === s.defender) return []
  const hand = s.hands[seat]
  // First attack: only the attacker, empty table, not taking.
  if (s.table.length === 0) return seat === s.attacker && !s.taking ? hand : []
  if (s.table.length >= 6) return []
  // Throw-ins must match a rank already on the table.
  const ranks = ranksOnTable(s)
  // When not taking, can't exceed what the defender can still beat.
  if (!s.taking && s.table.length >= tableLimit(s)) return []
  if (!s.taking && undefended(s) >= s.hands[s.defender].length) return []
  return hand.filter((c) => ranks.has(c.rank))
}

/** Defender's cards that beat the first undefended attack. */
export function legalDefends(s: DurakNState): { pair: number; cards: Card[] } {
  if (s.result || s.turn !== s.defender || s.taking) return { pair: -1, cards: [] }
  const idx = s.table.findIndex((p) => !p.defend)
  if (idx < 0) return { pair: -1, cards: [] }
  const att = s.table[idx].attack
  return { pair: idx, cards: s.hands[s.defender].filter((c) => beats(att, c, s.trump)) }
}

export const canTake = (s: DurakNState) =>
  !s.result && !s.taking && s.turn === s.defender && undefended(s) > 0

/** Is the throw-in window open (all defended, not taking) for `seat` to add/pass? */
export const canThrowPhase = (s: DurakNState) =>
  !s.result && !s.taking && undefended(s) === 0 && s.table.length > 0

function removeCard(hand: Card[], c: Card): Card[] {
  const i = hand.findIndex((x) => x.rank === c.rank && x.suit === c.suit)
  const copy = [...hand]
  if (i >= 0) copy.splice(i, 1)
  return copy
}

function clone(s: DurakNState): DurakNState {
  return {
    ...s,
    deck: [...s.deck],
    hands: s.hands.map((h) => [...h]),
    table: s.table.map((p) => ({ ...p })),
    passed: [...s.passed],
    out: [...s.out],
  }
}

/** Draw hands back up to 6: attacker first, then the others in play order, defender last. */
function refill(s: DurakNState) {
  const order: number[] = []
  for (let i = 0; i < s.n; i++) {
    const seat = (s.attacker + i) % s.n
    if (seat !== s.defender && !s.out[seat]) order.push(seat)
  }
  if (!s.out[s.defender]) order.push(s.defender)
  for (const p of order) {
    while (s.hands[p].length < 6 && s.deck.length > 0) s.hands[p].push(s.deck.shift()!)
    s.hands[p] = sortHand(s.hands[p], s.trump)
  }
}

/** Mark players who ran out of cards (deck empty) as out; set result if ≤1 remains. */
function settle(s: DurakNState) {
  if (s.deck.length === 0) {
    for (let p = 0; p < s.n; p++) if (!s.out[p] && s.hands[p].length === 0) s.out[p] = true
  }
  const alive = inPlayCount(s)
  if (alive <= 1) {
    let loser = s.out.findIndex((o) => !o) // the lone survivor is the дурак
    // everyone emptied at once: "Ничья" → draw; "Классика" → the last attacker loses
    if (loser < 0) loser = s.allowDraw ? -1 : s.attacker
    s.result = { loser: loser < 0 ? null : loser }
  }
}

/** After a bout, set the new attacker/defender and reset the round. */
function startBout(s: DurakNState, newAttacker: number) {
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

export function playAttack(s: DurakNState, seat: number, card: Card): DurakNState {
  if (!legalThrow(s, seat).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  n.hands[seat] = removeCard(n.hands[seat], card)
  n.table.push({ attack: card, by: seat })
  n.passed = Array(n.n).fill(false) // a new card resets the pass window
  n.turn = n.taking ? nextThrower(n, seat) : n.defender
  if (n.turn < 0) n.turn = n.attacker
  return n
}

export function playDefend(s: DurakNState, card: Card, pairIndex?: number): DurakNState {
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
    n.turn = n.defender // more to beat
  } else {
    // all defended → open the throw-in window (attacker first)
    n.passed = Array(n.n).fill(false)
    n.turn = firstThrower(n)
    if (n.turn < 0) return finishBeaten(n) // no one can throw → бито
  }
  return n
}

// ── Переводной (transfer) ───────────────────────────────────────────
/** Can the defender bounce the (all same-rank, undefended) attack to the next player? */
export function canTransfer(s: DurakNState): boolean {
  if (!s.transfer || s.result || s.taking) return false
  if (s.turn !== s.defender) return false
  if (s.table.length === 0 || s.table.some((p) => p.defend)) return false
  const rank = s.table[0].attack.rank
  if (!s.table.every((p) => p.attack.rank === rank)) return false
  const target = nextIn(s.out, s.defender)
  if (target === s.defender) return false
  // the new defender must be able to receive/beat all of them
  if (s.table.length + 1 > s.hands[target].length) return false
  return s.hands[s.defender].some((c) => c.rank === rank)
}

export function legalTransfers(s: DurakNState): Card[] {
  if (!canTransfer(s)) return []
  const rank = s.table[0].attack.rank
  return s.hands[s.defender].filter((c) => c.rank === rank)
}

/** Defender adds a same-rank card and passes the bout to the next player. */
export function playTransfer(s: DurakNState, card: Card): DurakNState {
  if (!legalTransfers(s).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  const oldDef = n.defender
  n.hands[oldDef] = removeCard(n.hands[oldDef], card)
  n.table.push({ attack: card, by: oldDef })
  n.attacker = oldDef // old defender becomes the attacker
  n.defender = nextIn(n.out, oldDef) // the next player must now defend
  n.passed = Array(n.n).fill(false)
  n.turn = n.defender
  return n
}

/** Defender takes: open a throw-in window so others may подкинуть first. */
export function beginTake(s: DurakNState): DurakNState {
  if (!canTake(s)) return s
  const n = clone(s)
  n.taking = true
  n.passed = Array(n.n).fill(false)
  n.turn = firstThrower(n)
  if (n.turn < 0) return finishTake(n)
  return n
}

/** A thrower passes (declines to throw in). Advances the window; closes it if all pass. */
export function pass(s: DurakNState, seat: number): DurakNState {
  if (s.result) return s
  // Only meaningful while a throw-in window is open (taking, or all-defended).
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

/** First eligible thrower (has legal cards, not passed), starting from the attacker. */
function firstThrower(s: DurakNState): number {
  for (const seat of throwers(s)) {
    if (!s.passed[seat] && legalThrow(s, seat).length > 0) return seat
  }
  return -1
}
/** Next eligible thrower after `from` in throw order. */
function nextThrower(s: DurakNState, from: number): number {
  const order = throwers(s)
  const i = order.indexOf(from)
  for (let k = 1; k <= order.length; k++) {
    const seat = order[(i + k) % order.length]
    if (!s.passed[seat] && legalThrow(s, seat).length > 0) return seat
  }
  return -1
}

/** All attacks were beaten and no one throws in → discard, refill, next bout. */
function finishBeaten(s: DurakNState): DurakNState {
  const n = clone(s)
  for (const p of n.table) n.discard += p.defend ? 2 : 1
  refill(n)
  startBout(n, n.defender) // successful defender becomes attacker
  return n
}

/** Defender scoops the table; the seat after the defender attacks next. */
export function finishTake(s: DurakNState): DurakNState {
  const n = clone(s)
  const def = n.defender
  for (const p of n.table) {
    n.hands[def].push(p.attack)
    if (p.defend) n.hands[def].push(p.defend)
  }
  n.hands[def] = sortHand(n.hands[def], n.trump)
  refill(n)
  startBout(n, nextIn(n.out, def)) // defender skipped; next player attacks
  return n
}

export function resign(s: DurakNState, seat: number): DurakNState {
  if (s.result) return s
  const n = clone(s)
  n.out[seat] = true
  const alive = inPlayCount(n)
  if (alive <= 1) {
    const loser = n.out.findIndex((o) => !o)
    n.result = { loser: loser < 0 ? seat : loser }
  } else if (n.turn === seat || n.attacker === seat || n.defender === seat) {
    // rebuild roles around the resigned player
    startBout(n, nextIn(n.out, seat))
  }
  return n
}

// ── Simple bot ──────────────────────────────────────────────────────
const value = (c: Card, trump: Suit) => c.rank + (c.suit === trump ? 100 : 0)
const cheapest = (cs: Card[], trump: Suit) =>
  [...cs].sort((a, b) => value(a, trump) - value(b, trump))[0]

/** One bot action for `seat` (whatever it's allowed to do now). */
export function botStep(s: DurakNState, seat: number): DurakNState {
  if (s.result || s.turn !== seat) return s
  // Defender's turn
  if (seat === s.defender && !s.taking) {
    if (canTransfer(s)) {
      const tr = legalTransfers(s).filter((c) => c.suit !== s.trump) // cheap non-trump only
      if (tr.length) return playTransfer(s, cheapest(tr, s.trump))
    }
    const { cards, pair } = legalDefends(s)
    if (cards.length) return playDefend(s, cheapest(cards, s.trump), pair)
    return beginTake(s)
  }
  // Thrower (attacker or подкидывающий)
  const legal = legalThrow(s, seat)
  if (legal.length === 0) return pass(s, seat)
  // First attack: always attack the cheapest. Throw-ins: only cheap non-trumps, ~60%.
  if (s.table.length === 0) return playAttack(s, seat, cheapest(legal, s.trump))
  const cheapNonTrump = legal.filter((c) => c.suit !== s.trump)
  if (cheapNonTrump.length && Math.random() < 0.6)
    return playAttack(s, seat, cheapest(cheapNonTrump, s.trump))
  return pass(s, seat)
}

// ── Per-seat view (hide other hands; keep counts) — for the server ──
const hide = (cards: Card[]) => cards.map(() => ({ rank: 0, suit: '♠' as Suit }))

export function viewForN(s: DurakNState, seat: number) {
  return {
    ...s,
    deck: hide(s.deck),
    hands: s.hands.map((h, i) => (i === seat ? h : hide(h))),
  }
}
