/**
 * Подкидной дурак (classic Russian Durak), 1 vs 1.
 * Pure engine: state + rule-checked actions + a simple bot. UI-agnostic.
 */

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Player = 'you' | 'opp'
export interface Card {
  rank: number // 6..14 (11=В, 12=Д, 13=К, 14=Т)
  suit: Suit
}
export interface TablePair {
  attack: Card
  defend?: Card
}

export interface DurakState {
  deck: Card[] // [top ... bottom]; bottom = trump card, drawn last
  trump: Suit
  trumpCard: Card | null // shown under the deck while cards remain
  hands: Record<Player, Card[]>
  table: TablePair[]
  attacker: Player
  turn: Player // whose action now
  taking: boolean // defender chose to take → attacker may throw in more
  transfer: boolean // "переводной" mode enabled
  discard: number // cards sent to the "бито" pile
  result: { loser: Player | null } | null // loser null = draw (both out)
}

export interface GameOptions {
  deck?: number // 24 | 36 | 52
  transfer?: boolean
}

const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
export const other = (p: Player): Player => (p === 'you' ? 'opp' : 'you')
export const isRed = (s: Suit) => s === '♥' || s === '♦'
export const rankLabel = (r: number): string =>
  ({ 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' } as Record<number, string>)[r] ??
  String(r)
export const cardId = (c: Card) => `${c.rank}${c.suit}`

// Deck size → lowest rank: 24→9, 36→6, 52→2.
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

/** Sort a hand: non-trumps by suit+rank, trumps last. */
function sortHand(hand: Card[], trump: Suit): Card[] {
  return [...hand].sort((a, b) => {
    const at = a.suit === trump ? 1 : 0
    const bt = b.suit === trump ? 1 : 0
    if (at !== bt) return at - bt
    if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
    return a.rank - b.rank
  })
}

export function createGame(opts: GameOptions = {}): DurakState {
  const deck = makeDeck(opts.deck ?? 36)
  const trumpCard = deck[deck.length - 1]
  const trump = trumpCard.suit
  const hands: Record<Player, Card[]> = { you: [], opp: [] }
  for (let i = 0; i < 6; i++) {
    hands.you.push(deck.shift()!)
    hands.opp.push(deck.shift()!)
  }
  hands.you = sortHand(hands.you, trump)
  hands.opp = sortHand(hands.opp, trump)

  // First attacker = player with the lowest trump.
  const lowestTrump = (h: Card[]) =>
    h.filter((c) => c.suit === trump).reduce((m, c) => Math.min(m, c.rank), 99)
  const attacker: Player =
    lowestTrump(hands.you) <= lowestTrump(hands.opp) ? 'you' : 'opp'

  return {
    deck,
    trump,
    trumpCard,
    hands,
    table: [],
    attacker,
    turn: attacker,
    taking: false,
    transfer: opts.transfer ?? false,
    discard: 0,
    result: null,
  }
}

/** Does `def` beat `att` given the trump suit? */
export function beats(att: Card, def: Card, trump: Suit): boolean {
  if (att.suit === def.suit) return def.rank > att.rank
  return def.suit === trump && att.suit !== trump
}

const ranksOnTable = (s: DurakState): Set<number> => {
  const set = new Set<number>()
  for (const p of s.table) {
    set.add(p.attack.rank)
    if (p.defend) set.add(p.defend.rank)
  }
  return set
}

const undefendedCount = (s: DurakState) =>
  s.table.filter((p) => !p.defend).length

/** Max cards the attacker may put down this bout. */
const attackLimit = (s: DurakState) =>
  Math.min(6, s.table.length + s.hands[other(s.attacker)].length)

/** Cards the current attacker may play (first attack or throw-in). */
export function legalAttacks(s: DurakState): Card[] {
  if (s.result || s.turn !== s.attacker) return []
  const hand = s.hands[s.attacker]
  if (s.table.length === 0) return s.taking ? [] : hand // first attack: any card
  if (s.table.length >= 6) return []
  const ranks = ranksOnTable(s)
  // Throw-ins (also while the defender is taking) must match a table rank.
  if (s.taking) return hand.filter((c) => ranks.has(c.rank))
  if (s.table.length >= attackLimit(s)) return []
  if (undefendedCount(s) >= s.hands[other(s.attacker)].length) return []
  return hand.filter((c) => ranks.has(c.rank))
}

/** Cards the defender may use to beat the first undefended attack. */
export function legalDefends(s: DurakState): { pair: number; cards: Card[] } {
  const defender = other(s.attacker)
  if (s.result || s.turn !== defender) return { pair: -1, cards: [] }
  const idx = s.table.findIndex((p) => !p.defend)
  if (idx < 0) return { pair: -1, cards: [] }
  const att = s.table[idx].attack
  return {
    pair: idx,
    cards: s.hands[defender].filter((c) => beats(att, c, s.trump)),
  }
}

export const canPass = (s: DurakState) =>
  !s.taking && s.turn === s.attacker && s.table.length > 0 && undefendedCount(s) === 0

export const canTake = (s: DurakState) =>
  !s.taking && s.turn === other(s.attacker) && undefendedCount(s) > 0

/** Attacker has thrown in everything they want and lets the defender scoop. */
export const canFinishTake = (s: DurakState) =>
  s.taking && s.turn === s.attacker

function removeCard(hand: Card[], c: Card): Card[] {
  const i = hand.findIndex((x) => x.rank === c.rank && x.suit === c.suit)
  const copy = [...hand]
  if (i >= 0) copy.splice(i, 1)
  return copy
}

function clone(s: DurakState): DurakState {
  return {
    ...s,
    deck: [...s.deck],
    hands: { you: [...s.hands.you], opp: [...s.hands.opp] },
    table: s.table.map((p) => ({ ...p })),
  }
}

/** Draw hands back up to 6: attacker first, then defender. */
function refill(s: DurakState) {
  const order: Player[] = [s.attacker, other(s.attacker)]
  for (const p of order) {
    while (s.hands[p].length < 6 && s.deck.length > 0) {
      s.hands[p].push(s.deck.shift()!)
    }
    s.hands[p] = sortHand(s.hands[p], s.trump)
  }
}

function checkResult(s: DurakState) {
  if (s.deck.length > 0) return
  const youOut = s.hands.you.length === 0
  const oppOut = s.hands.opp.length === 0
  if (youOut && oppOut) s.result = { loser: null }
  else if (youOut) s.result = { loser: 'opp' }
  else if (oppOut) s.result = { loser: 'you' }
}

export function playAttack(s: DurakState, card: Card): DurakState {
  if (!legalAttacks(s).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  n.hands[n.attacker] = removeCard(n.hands[n.attacker], card)
  n.table.push({ attack: card })
  // While taking, keep throwing in; otherwise the defender must respond.
  n.turn = n.taking ? n.attacker : other(n.attacker)
  return n
}

/**
 * Defend an attack with `card`. `pairIndex` targets a specific undefended
 * attack (drag-to-card); if omitted, the first undefended one is used (bot/tap).
 * Returns the same state unchanged if the move is illegal.
 */
export function playDefend(
  s: DurakState,
  card: Card,
  pairIndex?: number,
): DurakState {
  const defender = other(s.attacker)
  if (s.result || s.turn !== defender) return s
  const idx =
    pairIndex ?? s.table.findIndex((p) => !p.defend)
  if (idx < 0 || idx >= s.table.length) return s
  const pair = s.table[idx]
  if (pair.defend) return s
  if (!s.hands[defender].some((c) => cardId(c) === cardId(card))) return s
  if (!beats(pair.attack, card, s.trump)) return s
  const n = clone(s)
  n.hands[defender] = removeCard(n.hands[defender], card)
  n.table[idx].defend = card
  // If undefended cards remain (e.g. after a transfer left several), the
  // defender keeps beating them; otherwise the attacker adds more or passes.
  n.turn = n.table.some((p) => !p.defend) ? defender : n.attacker
  return n
}

/** Defender takes all cards on the table (immediate, no throw-in window). */
export function takeCards(s: DurakState): DurakState {
  if (!canTake(s)) return s
  return finishTake(beginTakeRaw(s))
}

// Internal: flip into taking phase without the auto-finish guard.
function beginTakeRaw(s: DurakState): DurakState {
  const n = clone(s)
  n.taking = true
  n.turn = n.attacker
  return n
}

/**
 * Defender decides to take → open a throw-in window so the attacker can add
 * more cards before the defender scoops them up. If the attacker has nothing
 * to throw in, the take completes immediately.
 */
export function beginTake(s: DurakState): DurakState {
  if (!canTake(s)) return s
  const n = beginTakeRaw(s)
  return legalAttacks(n).length === 0 ? finishTake(n) : n
}

/** Attacker is done throwing in → defender scoops all table cards. */
export function finishTake(s: DurakState): DurakState {
  if (!s.taking) return s
  const n = clone(s)
  const defender = other(n.attacker)
  for (const p of n.table) {
    n.hands[defender].push(p.attack)
    if (p.defend) n.hands[defender].push(p.defend)
  }
  n.hands[defender] = sortHand(n.hands[defender], n.trump)
  n.table = []
  n.taking = false
  refill(n) // roles unchanged; attacker attacks again
  n.turn = n.attacker
  checkResult(n)
  return n
}

// ── Переводной (transfer) ───────────────────────────────────────────
/** Can the defender bounce the attack to the other player? */
export function canTransfer(s: DurakState): boolean {
  if (!s.transfer || s.result || s.taking) return false
  const defender = other(s.attacker)
  if (s.turn !== defender) return false
  if (s.table.length === 0 || s.table.some((p) => p.defend)) return false
  const rank = s.table[0].attack.rank
  if (!s.table.every((p) => p.attack.rank === rank)) return false
  // the new defender (current attacker) must be able to receive them all
  if (s.table.length + 1 > s.hands[s.attacker].length) return false
  return s.hands[defender].some((c) => c.rank === rank)
}

export function legalTransfers(s: DurakState): Card[] {
  if (!canTransfer(s)) return []
  const rank = s.table[0].attack.rank
  return s.hands[other(s.attacker)].filter((c) => c.rank === rank)
}

/** Defender transfers the bout by adding a same-rank card; roles swap. */
export function playTransfer(s: DurakState, card: Card): DurakState {
  if (!legalTransfers(s).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  const defender = other(n.attacker)
  n.hands[defender] = removeCard(n.hands[defender], card)
  n.table.push({ attack: card })
  n.attacker = defender // defender becomes the attacker
  n.turn = other(defender) // old attacker now defends
  return n
}

/** A player gives up the game. */
export function resign(s: DurakState, who: Player): DurakState {
  if (s.result) return s
  const n = clone(s)
  n.result = { loser: who }
  return n
}

/** Attacker declares "Бито" — bout won, cards discarded, roles swap. */
export function endBout(s: DurakState): DurakState {
  if (!canPass(s)) return s
  const n = clone(s)
  // all cards were beaten → they go to the "бито" pile
  for (const p of n.table) n.discard += p.defend ? 2 : 1
  n.table = []
  refill(n)
  n.attacker = other(n.attacker) // successful defender becomes attacker
  n.turn = n.attacker
  checkResult(n)
  return n
}

// ── Simple bot ──────────────────────────────────────────────────────
const value = (c: Card, trump: Suit) => c.rank + (c.suit === trump ? 100 : 0)

/** Returns the next bot action applied to the state (bot plays as `opp`). */
export function botStep(s: DurakState): DurakState {
  if (s.result) return s
  const bot: Player = 'opp'
  const cheapest = (cs: Card[]) =>
    [...cs].sort((a, b) => value(a, s.trump) - value(b, s.trump))[0]

  // Bot is the attacker while the defender is taking → throw in, then finish.
  if (s.taking && s.turn === bot && bot === s.attacker) {
    const atk = legalAttacks(s)
    if (atk.length) return playAttack(s, cheapest(atk))
    return finishTake(s)
  }
  // Bot defends
  if (s.turn === bot && bot === other(s.attacker)) {
    // Prefer a cheap non-trump transfer if available.
    if (canTransfer(s)) {
      const t = legalTransfers(s).filter((c) => c.suit !== s.trump)
      if (t.length) return playTransfer(s, cheapest(t))
    }
    const { cards, pair } = legalDefends(s)
    if (cards.length === 0) return beginTake(s) // lets the human throw in
    return playDefend(s, cheapest(cards), pair)
  }
  // Bot attacks
  if (s.turn === bot && bot === s.attacker) {
    const atk = legalAttacks(s)
    if (atk.length === 0) return canPass(s) ? endBout(s) : s
    return playAttack(s, cheapest(atk))
  }
  return s
}
