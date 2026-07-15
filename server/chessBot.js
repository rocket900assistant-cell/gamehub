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

/** A disguised opponent identity near the player's Elo (looks like a real user). */
export function fakeChessOpponent(playerElo) {
  const base = Number(playerElo) || 1200
  return {
    name: BOT_NAMES[randInt(0, BOT_NAMES.length - 1)],
    elo: Math.max(700, Math.min(2600, base + randInt(-70, 70))),
    photoUrl: null, // no photo → initials avatar, like many real players
    vip: false,
  }
}
