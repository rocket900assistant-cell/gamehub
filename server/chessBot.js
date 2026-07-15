// Chess fill-in bot: when quick-match finds no human, seed a bot that plays at
// the player's level and is presented as an ordinary opponent. FREE games only —
// never on a GRAM stake (the house must not secretly play a customer for money).
import pkg from 'js-chess-engine'
const { aiMove } = pkg

/** Map a player's Elo to a js-chess-engine difficulty (1–3; 0=random, 4=slow/strong). */
export function levelForElo(elo) {
  const e = Number(elo) || 1200
  if (e < 1100) return 1
  if (e < 1500) return 2
  return 3
}

/** Best move for a FEN at a difficulty level → { from, to } (lowercase), or null. */
export function botChessMove(fen, level) {
  try {
    const mv = aiMove(fen, level) // e.g. { "E2": "E4" }
    const entry = Object.entries(mv)[0]
    if (!entry) return null
    const [from, to] = entry
    return { from: String(from).toLowerCase(), to: String(to).toLowerCase() }
  } catch {
    return null
  }
}

// A believable spread of first names (audience-appropriate), shown instead of "Бот".
const BOT_NAMES = [
  'Alex', 'Maxim', 'Daniel', 'Igor', 'Nikita', 'Pavel', 'Ruslan', 'Timur', 'Denis',
  'Artem', 'Kirill', 'Oleg', 'Marat', 'Vlad', 'Sergey', 'Anton', 'Roman', 'Egor',
  'Sofia', 'Alina', 'Dasha', 'Kamila', 'Milana', 'Amir', 'Sasha', 'Lev', 'Mark',
  'Yusuf', 'Arslan', 'David', 'Georgiy', 'Stas', 'Bogdan', 'Nika', 'Renat',
]

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1))

// Illustrated avatar styles (the kind of pictures real users pick). Random per
// game for variety; served by DiceBear. If it ever fails to load the client
// falls back to initials, so it's a safe dependency.
const AVATAR_STYLES = ['avataaars', 'personas', 'micah', 'adventurer', 'open-peeps']
const avatarUrl = (seed) =>
  `https://api.dicebear.com/7.x/${AVATAR_STYLES[randInt(0, AVATAR_STYLES.length - 1)]}/svg?seed=${encodeURIComponent(seed)}`

/** A disguised opponent identity near the player's Elo (looks like a real user). */
export function fakeChessOpponent(playerElo) {
  const base = Number(playerElo) || 1200
  const name = BOT_NAMES[randInt(0, BOT_NAMES.length - 1)]
  return {
    name,
    elo: Math.max(700, Math.min(2600, base + randInt(-70, 70))),
    photoUrl: avatarUrl(`${name}${randInt(1, 99999)}`),
    vip: false,
  }
}
