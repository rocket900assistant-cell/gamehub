// Postgres persistence (Neon). Optional: if DATABASE_URL is unset the server
// runs exactly as before (in-memory only), so deploys never break.
import pg from 'pg'

const url = process.env.DATABASE_URL
export const dbEnabled = !!url

const pool = url
  ? new pg.Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false }, // Neon requires SSL
      max: 8,
    })
  : null

const ELO_COL = { chess: 'elo_chess', durak: 'elo_durak', nardy: 'elo_nardy' }

export async function initDb() {
  if (!pool) {
    console.warn('[db] DATABASE_URL not set — running without persistence')
    return
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      tg_id        BIGINT PRIMARY KEY,
      username     TEXT,
      name         TEXT,
      photo_url    TEXT,
      elo_chess    INT NOT NULL DEFAULT 1200,
      elo_durak    INT NOT NULL DEFAULT 1200,
      elo_nardy    INT NOT NULL DEFAULT 1200,
      balance_gram NUMERIC(20,2) NOT NULL DEFAULT 0,
      games        INT NOT NULL DEFAULT 0,
      wins         INT NOT NULL DEFAULT 0,
      losses       INT NOT NULL DEFAULT 0,
      referred_by  BIGINT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS game_history (
      id         BIGSERIAL PRIMARY KEY,
      game       TEXT NOT NULL,
      p1         BIGINT,
      p2         BIGINT,
      winner     BIGINT,
      reason     TEXT,
      stake      NUMERIC(20,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS friendships (
      a          BIGINT NOT NULL,
      b          BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (a, b)
    );
  `)
  console.log('[db] ready')
}

// In-memory fallback so friends work in local dev without a database.
const memFriends = new Map() // tgId -> Set(tgId)

/** Record a mutual friendship (both directions). */
export async function addFriendship(a, b) {
  a = Number(a)
  b = Number(b)
  if (!a || !b || a === b) return
  if (!pool) {
    if (!memFriends.has(a)) memFriends.set(a, new Set())
    if (!memFriends.has(b)) memFriends.set(b, new Set())
    memFriends.get(a).add(b)
    memFriends.get(b).add(a)
    return
  }
  await pool.query(
    `INSERT INTO friendships (a, b) VALUES ($1,$2),($2,$1) ON CONFLICT DO NOTHING`,
    [a, b],
  )
}

/** Friend user rows for a player (joined with their profile). */
export async function getFriends(tgId) {
  tgId = Number(tgId)
  if (!tgId) return []
  if (!pool) return [...(memFriends.get(tgId) ?? [])].map((id) => ({ tg_id: id }))
  const { rows } = await pool.query(
    `SELECT u.* FROM friendships f JOIN users u ON u.tg_id = f.b
       WHERE f.a = $1 ORDER BY u.name NULLS LAST`,
    [tgId],
  )
  return rows
}

/** Create the player row if new, else refresh their profile fields. Returns the row. */
export async function upsertUser({ tgId, username, name, photoUrl, referredBy }) {
  if (!pool || !tgId) return null
  const { rows } = await pool.query(
    `INSERT INTO users (tg_id, username, name, photo_url, referred_by)
       VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tg_id) DO UPDATE
       SET username = EXCLUDED.username,
           name     = EXCLUDED.name,
           photo_url = EXCLUDED.photo_url
     RETURNING *`,
    [tgId, username ?? null, name ?? null, photoUrl ?? null, referredBy ?? null],
  )
  return rows[0]
}

export async function getUser(tgId) {
  if (!pool || !tgId) return null
  const { rows } = await pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId])
  return rows[0] ?? null
}

/** Apply an Elo change + win/loss counters and log the game. Best-effort. */
export async function recordResult({ game, winner, loser, winnerDelta, loserDelta, reason, stake = 0 }) {
  if (!pool) return
  const col = ELO_COL[game] ?? 'elo_chess'
  try {
    if (winner)
      await pool.query(
        `UPDATE users SET ${col} = GREATEST(100, ${col} + $2), games = games + 1, wins = wins + 1 WHERE tg_id = $1`,
        [winner, winnerDelta ?? 0],
      )
    if (loser)
      await pool.query(
        `UPDATE users SET ${col} = GREATEST(100, ${col} + $2), games = games + 1, losses = losses + 1 WHERE tg_id = $1`,
        [loser, loserDelta ?? 0],
      )
    await pool.query(
      'INSERT INTO game_history (game, p1, p2, winner, reason, stake) VALUES ($1,$2,$3,$4,$5,$6)',
      [game, winner ?? null, loser ?? null, winner ?? null, reason ?? null, stake],
    )
  } catch (e) {
    console.error('[db] recordResult failed:', e.message)
  }
}
