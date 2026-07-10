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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS vip BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS elo_history (
      id         BIGSERIAL PRIMARY KEY,
      tg_id      BIGINT NOT NULL,
      game       TEXT NOT NULL,
      elo        INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS elo_history_user ON elo_history (tg_id, game, id);
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

/** Remove a mutual friendship (both directions). */
export async function removeFriendship(a, b) {
  a = Number(a)
  b = Number(b)
  if (!a || !b) return
  if (!pool) {
    memFriends.get(a)?.delete(b)
    memFriends.get(b)?.delete(a)
    return
  }
  await pool.query('DELETE FROM friendships WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)', [a, b])
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
  // NOTE: `name` is only set on first insert — never overwritten on reconnect,
  // so a custom nickname (set via setUserName) survives future logins.
  const { rows } = await pool.query(
    `INSERT INTO users (tg_id, username, name, photo_url, referred_by)
       VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tg_id) DO UPDATE
       SET username = EXCLUDED.username,
           photo_url = EXCLUDED.photo_url
     RETURNING *`,
    [tgId, username ?? null, name ?? null, photoUrl ?? null, referredBy ?? null],
  )
  return rows[0]
}

/** Set the player's custom display name. Returns the updated row. */
export async function setUserName(tgId, name) {
  if (!pool || !tgId) return null
  const { rows } = await pool.query(
    'UPDATE users SET name = $2 WHERE tg_id = $1 RETURNING *',
    [tgId, name],
  )
  return rows[0] ?? null
}

/** Set the player's VIP flag. Returns the updated row. */
export async function setUserVip(tgId, vip) {
  if (!pool || !tgId) return null
  const { rows } = await pool.query(
    'UPDATE users SET vip = $2 WHERE tg_id = $1 RETURNING *',
    [tgId, !!vip],
  )
  return rows[0] ?? null
}

export async function getUser(tgId) {
  if (!pool || !tgId) return null
  const { rows } = await pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId])
  return rows[0] ?? null
}

/** Recent Elo values for a player's game (oldest → newest). */
export async function getEloTrend(tgId, game, limit = 12) {
  tgId = Number(tgId)
  if (!pool || !tgId) return []
  const { rows } = await pool.query(
    `SELECT elo FROM elo_history WHERE tg_id = $1 AND game = $2 ORDER BY id DESC LIMIT $3`,
    [tgId, game, limit],
  )
  return rows.map((r) => r.elo).reverse()
}

/** Last N games for a player (most recent first). */
export async function getHistory(tgId, limit = 10) {
  tgId = Number(tgId)
  if (!pool || !tgId) return []
  const { rows } = await pool.query(
    `SELECT game, winner, p1, p2, reason, created_at FROM game_history
       WHERE p1 = $1 OR p2 = $1 ORDER BY created_at DESC LIMIT $2`,
    [tgId, limit],
  )
  return rows
}

/** Apply an Elo change to ONE player (+ win/loss counter, history). For N-player
 *  games where a single loser faces several winners. Returns the new Elo. */
export async function applyElo({ tgId, game, delta, won }) {
  if (!pool || !tgId) return null
  const col = ELO_COL[game] ?? 'elo_chess'
  const wl = won ? 'wins = wins + 1' : 'losses = losses + 1'
  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${col} = GREATEST(100, ${col} + $2), games = games + 1, ${wl} WHERE tg_id = $1 RETURNING ${col} AS elo`,
      [tgId, delta ?? 0],
    )
    if (rows[0]) {
      await pool.query('INSERT INTO elo_history (tg_id, game, elo) VALUES ($1,$2,$3)', [tgId, game, rows[0].elo])
      return rows[0].elo
    }
  } catch (e) {
    console.error('[db] applyElo failed:', e.message)
  }
  return null
}

/** Apply an Elo change + win/loss counters and log the game. Best-effort. */
export async function recordResult({ game, winner, loser, winnerDelta, loserDelta, reason, stake = 0 }) {
  if (!pool) return
  const col = ELO_COL[game] ?? 'elo_chess'
  try {
    if (winner) {
      const { rows } = await pool.query(
        `UPDATE users SET ${col} = GREATEST(100, ${col} + $2), games = games + 1, wins = wins + 1 WHERE tg_id = $1 RETURNING ${col} AS elo`,
        [winner, winnerDelta ?? 0],
      )
      if (rows[0])
        await pool.query('INSERT INTO elo_history (tg_id, game, elo) VALUES ($1,$2,$3)', [winner, game, rows[0].elo])
    }
    if (loser) {
      const { rows } = await pool.query(
        `UPDATE users SET ${col} = GREATEST(100, ${col} + $2), games = games + 1, losses = losses + 1 WHERE tg_id = $1 RETURNING ${col} AS elo`,
        [loser, loserDelta ?? 0],
      )
      if (rows[0])
        await pool.query('INSERT INTO elo_history (tg_id, game, elo) VALUES ($1,$2,$3)', [loser, game, rows[0].elo])
    }
    await pool.query(
      'INSERT INTO game_history (game, p1, p2, winner, reason, stake) VALUES ($1,$2,$3,$4,$5,$6)',
      [game, winner ?? null, loser ?? null, winner ?? null, reason ?? null, stake],
    )
  } catch (e) {
    console.error('[db] recordResult failed:', e.message)
  }
}
