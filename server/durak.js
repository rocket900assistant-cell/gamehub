// Server-authoritative Подкидной дурак engine (JS port of src/lib/durak.ts).
// Two seats: 'you' (players[0]) and 'opp' (players[1]). Symmetric; the client
// always renders itself as 'you' — the server flips the view per seat.

const SUITS = ['♠', '♥', '♦', '♣']
export const other = (p) => (p === 'you' ? 'opp' : 'you')
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

export function createGame(opts = {}) {
  const deck = makeDeck(opts.deck ?? 36)
  const trumpCard = deck[deck.length - 1]
  const trump = trumpCard.suit
  const hands = { you: [], opp: [] }
  for (let i = 0; i < 6; i++) {
    hands.you.push(deck.shift())
    hands.opp.push(deck.shift())
  }
  hands.you = sortHand(hands.you, trump)
  hands.opp = sortHand(hands.opp, trump)
  const lowestTrump = (h) =>
    h.filter((c) => c.suit === trump).reduce((m, c) => Math.min(m, c.rank), 99)
  const attacker = lowestTrump(hands.you) <= lowestTrump(hands.opp) ? 'you' : 'opp'
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

export function beats(att, def, trump) {
  if (att.suit === def.suit) return def.rank > att.rank
  return def.suit === trump && att.suit !== trump
}

const ranksOnTable = (s) => {
  const set = new Set()
  for (const p of s.table) {
    set.add(p.attack.rank)
    if (p.defend) set.add(p.defend.rank)
  }
  return set
}
const undefendedCount = (s) => s.table.filter((p) => !p.defend).length
const attackLimit = (s) => Math.min(6, s.table.length + s.hands[other(s.attacker)].length)

export function legalAttacks(s) {
  if (s.result || s.turn !== s.attacker) return []
  const hand = s.hands[s.attacker]
  if (s.table.length === 0) return s.taking ? [] : hand
  if (s.table.length >= 6) return []
  const ranks = ranksOnTable(s)
  if (s.taking) return hand.filter((c) => ranks.has(c.rank))
  if (s.table.length >= attackLimit(s)) return []
  if (undefendedCount(s) >= s.hands[other(s.attacker)].length) return []
  return hand.filter((c) => ranks.has(c.rank))
}

export function legalDefends(s) {
  const defender = other(s.attacker)
  if (s.result || s.turn !== defender) return { pair: -1, cards: [] }
  const idx = s.table.findIndex((p) => !p.defend)
  if (idx < 0) return { pair: -1, cards: [] }
  const att = s.table[idx].attack
  return { pair: idx, cards: s.hands[defender].filter((c) => beats(att, c, s.trump)) }
}

export const canPass = (s) =>
  !s.taking && s.turn === s.attacker && s.table.length > 0 && undefendedCount(s) === 0
export const canTake = (s) =>
  !s.taking && s.turn === other(s.attacker) && undefendedCount(s) > 0
export const canFinishTake = (s) => s.taking && s.turn === s.attacker

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
    hands: { you: [...s.hands.you], opp: [...s.hands.opp] },
    table: s.table.map((p) => ({ ...p })),
  }
}

function refill(s) {
  const order = [s.attacker, other(s.attacker)]
  for (const p of order) {
    while (s.hands[p].length < 6 && s.deck.length > 0) s.hands[p].push(s.deck.shift())
    s.hands[p] = sortHand(s.hands[p], s.trump)
  }
}

function checkResult(s) {
  if (s.deck.length > 0) return
  const youOut = s.hands.you.length === 0
  const oppOut = s.hands.opp.length === 0
  if (youOut && oppOut) s.result = { loser: null }
  else if (youOut) s.result = { loser: 'opp' }
  else if (oppOut) s.result = { loser: 'you' }
}

export function playAttack(s, card) {
  if (!legalAttacks(s).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  n.hands[n.attacker] = removeCard(n.hands[n.attacker], card)
  n.table.push({ attack: card })
  n.turn = n.taking ? n.attacker : other(n.attacker)
  return n
}

export function playDefend(s, card, pairIndex) {
  const defender = other(s.attacker)
  if (s.result || s.turn !== defender) return s
  const idx = pairIndex ?? s.table.findIndex((p) => !p.defend)
  if (idx < 0 || idx >= s.table.length) return s
  const pair = s.table[idx]
  if (pair.defend) return s
  if (!s.hands[defender].some((c) => cardId(c) === cardId(card))) return s
  if (!beats(pair.attack, card, s.trump)) return s
  const n = clone(s)
  n.hands[defender] = removeCard(n.hands[defender], card)
  n.table[idx].defend = card
  n.turn = n.table.some((p) => !p.defend) ? defender : n.attacker
  return n
}

function beginTakeRaw(s) {
  const n = clone(s)
  n.taking = true
  n.turn = n.attacker
  return n
}

export function beginTake(s) {
  if (!canTake(s)) return s
  const n = beginTakeRaw(s)
  return legalAttacks(n).length === 0 ? finishTake(n) : n
}

export function finishTake(s) {
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
  refill(n)
  n.turn = n.attacker
  checkResult(n)
  return n
}

export function canTransfer(s) {
  if (!s.transfer || s.result || s.taking) return false
  const defender = other(s.attacker)
  if (s.turn !== defender) return false
  if (s.table.length === 0 || s.table.some((p) => p.defend)) return false
  const rank = s.table[0].attack.rank
  if (!s.table.every((p) => p.attack.rank === rank)) return false
  if (s.table.length + 1 > s.hands[s.attacker].length) return false
  return s.hands[defender].some((c) => c.rank === rank)
}

export function legalTransfers(s) {
  if (!canTransfer(s)) return []
  const rank = s.table[0].attack.rank
  return s.hands[other(s.attacker)].filter((c) => c.rank === rank)
}

export function playTransfer(s, card) {
  if (!legalTransfers(s).some((c) => cardId(c) === cardId(card))) return s
  const n = clone(s)
  const defender = other(n.attacker)
  n.hands[defender] = removeCard(n.hands[defender], card)
  n.table.push({ attack: card })
  n.attacker = defender
  n.turn = other(defender)
  return n
}

export function resign(s, who) {
  if (s.result) return s
  const n = clone(s)
  n.result = { loser: who }
  return n
}

export function endBout(s) {
  if (!canPass(s)) return s
  const n = clone(s)
  for (const p of n.table) n.discard += p.defend ? 2 : 1
  n.table = []
  refill(n)
  n.attacker = other(n.attacker)
  n.turn = n.attacker
  checkResult(n)
  return n
}

// ── per-seat view: hide the opponent's hand, flip so the viewer is 'you' ──
const hideHand = (cards) => cards.map(() => ({ rank: 0, suit: '♠' }))

export function viewFor(s, seat) {
  const flip = seat === 'opp'
  const you = flip ? s.hands.opp : s.hands.you
  const opp = flip ? s.hands.you : s.hands.opp
  return {
    deck: hideHand(s.deck), // count only; cards face-down
    trump: s.trump,
    trumpCard: s.trumpCard,
    hands: { you, opp: hideHand(opp) },
    table: s.table,
    attacker: flip ? other(s.attacker) : s.attacker,
    turn: flip ? other(s.turn) : s.turn,
    taking: s.taking,
    transfer: s.transfer,
    discard: s.discard,
    result: s.result
      ? { loser: s.result.loser == null ? null : flip ? other(s.result.loser) : s.result.loser }
      : null,
  }
}

// ── 1v1 fill-in bot (plays the 'opp' seat) — same simple heuristic as the offline UI bot ──
const value = (c, trump) => c.rank + (c.suit === trump ? 100 : 0)

/** One bot action for the 'opp' seat. Returns the next state, or the same state if idle. */
export function botStep(s) {
  if (s.result) return s
  const bot = 'opp'
  const cheapest = (cs) => [...cs].sort((a, b) => value(a, s.trump) - value(b, s.trump))[0]
  // attacker while the defender is taking → throw in cheap cards, then finish
  if (s.taking && s.turn === bot && bot === s.attacker) {
    const atk = legalAttacks(s)
    if (atk.length) return playAttack(s, cheapest(atk))
    return finishTake(s)
  }
  // defending
  if (s.turn === bot && bot === other(s.attacker)) {
    if (canTransfer(s)) {
      const t = legalTransfers(s).filter((c) => c.suit !== s.trump)
      if (t.length) return playTransfer(s, cheapest(t))
    }
    const { cards, pair } = legalDefends(s)
    if (cards.length === 0) return beginTake(s)
    return playDefend(s, cheapest(cards), pair)
  }
  // attacking
  if (s.turn === bot && bot === s.attacker) {
    const atk = legalAttacks(s)
    if (atk.length === 0) return canPass(s) ? endBout(s) : s
    return playAttack(s, cheapest(atk))
  }
  return s
}
