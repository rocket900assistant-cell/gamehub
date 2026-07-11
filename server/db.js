// Postgres persistence (Neon). Optional: if DATABASE_URL is unset the server
// runs exactly as before (in-memory only), so deploys never break.
import pg from 'pg'
import { randomBytes } from 'node:crypto'

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
    CREATE TABLE IF NOT EXISTS payments (
      id         BIGSERIAL PRIMARY KEY,
      tg_id      BIGINT NOT NULL,
      product    TEXT NOT NULL,
      stars      INT NOT NULL,
      charge_id  TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS entitlements (
      tg_id      BIGINT NOT NULL,
      item       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tg_id, item)
    );
    CREATE TABLE IF NOT EXISTS gram_ledger (
      id         BIGSERIAL PRIMARY KEY,
      tg_id      BIGINT NOT NULL,
      kind       TEXT NOT NULL,                 -- deposit | withdraw | stake | win | refund
      amount     NUMERIC(20,2) NOT NULL,        -- signed: +in / -out
      status     TEXT NOT NULL DEFAULT 'done',  -- pending | done | failed
      ref        TEXT,                          -- on-chain tx hash / request id (unique when set)
      meta       JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gram_ledger_ref ON gram_ledger (ref) WHERE ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS gram_ledger_user ON gram_ledger (tg_id, id);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_tag TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS users_deposit_tag ON users (deposit_tag) WHERE deposit_tag IS NOT NULL;
    -- "house" account (tg_id 0) accrues the owner's fee; its balance_gram = withdrawable profit
    INSERT INTO users (tg_id, name) VALUES (0, 'HOUSE') ON CONFLICT (tg_id) DO NOTHING;
  `)
  console.log('[db] ready')
}

/** Create a withdrawal request: hold (debit) the amount and log a pending ledger row.
 *  Returns { id, balance } or { error }. */
export async function createWithdrawal({ tgId, amount, fee, address }) {
  if (!pool || !tgId) return { error: 'no-db' }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const bal = await client.query('SELECT balance_gram FROM users WHERE tg_id = $1 FOR UPDATE', [tgId])
    const cur = bal.rows[0] ? Number(bal.rows[0].balance_gram) : 0
    if (cur < amount) {
      await client.query('ROLLBACK')
      return { error: 'balance', balance: cur }
    }
    const payout = Math.round((amount - fee) * 100) / 100
    const ins = await client.query(
      `INSERT INTO gram_ledger (tg_id, kind, amount, status, meta)
       VALUES ($1,'withdraw',$2,'pending',$3) RETURNING id`,
      [tgId, -amount, { address, fee, payout }],
    )
    const upd = await client.query(
      'UPDATE users SET balance_gram = balance_gram - $2 WHERE tg_id = $1 RETURNING balance_gram',
      [tgId, amount],
    )
    await client.query('COMMIT')
    return { id: ins.rows[0].id, balance: Number(upd.rows[0].balance_gram) }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[db] createWithdrawal failed:', e.message)
    return { error: 'failed' }
  } finally {
    client.release()
  }
}

/** Pending withdrawals for the owner admin. */
export async function listPendingWithdrawals(limit = 50) {
  if (!pool) return []
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.tg_id, (-g.amount) AS amount, g.meta, g.created_at, u.name, u.username
       FROM gram_ledger g LEFT JOIN users u ON u.tg_id = g.tg_id
       WHERE g.kind = 'withdraw' AND g.status = 'pending' ORDER BY g.id ASC LIMIT $1`,
      [limit],
    )
    return rows.map((r) => ({
      id: Number(r.id),
      tgId: Number(r.tg_id),
      name: r.name,
      username: r.username,
      amount: Number(r.amount),
      address: r.meta?.address ?? null,
      fee: r.meta?.fee ?? 0,
      payout: r.meta?.payout ?? 0,
      at: r.created_at,
    }))
  } catch (e) {
    console.error('[db] listPendingWithdrawals failed:', e.message)
    return []
  }
}

/** Read one withdrawal ledger row. */
export async function getWithdrawal(id) {
  if (!pool) return null
  try {
    const { rows } = await pool.query('SELECT id, tg_id, amount, status, meta FROM gram_ledger WHERE id = $1 AND kind = $2', [id, 'withdraw'])
    return rows[0] ? { id: Number(rows[0].id), tgId: Number(rows[0].tg_id), amount: Number(rows[0].amount), status: rows[0].status, meta: rows[0].meta } : null
  } catch (e) {
    console.error('[db] getWithdrawal failed:', e.message)
    return null
  }
}

/** Move a withdrawal to a new status only if it is currently `from` (guards double-processing). */
export async function setWithdrawalStatus(id, from, to) {
  if (!pool) return false
  try {
    const { rowCount } = await pool.query(
      `UPDATE gram_ledger SET status = $3 WHERE id = $1 AND kind = 'withdraw' AND status = $2`,
      [id, from, to],
    )
    return rowCount > 0
  } catch (e) {
    console.error('[db] setWithdrawalStatus failed:', e.message)
    return false
  }
}

/** Current GRAM balance (0 if no row / no DB). */
export async function getBalance(tgId) {
  if (!pool || tgId == null) return 0
  try {
    const { rows } = await pool.query('SELECT balance_gram FROM users WHERE tg_id = $1', [tgId])
    return rows[0] ? Number(rows[0].balance_gram) : 0
  } catch (e) {
    console.error('[db] getBalance failed:', e.message)
    return 0
  }
}

/** Each player's personal deposit comment/tag (so incoming TON is attributed to them). */
export async function getOrCreateDepositTag(tgId) {
  if (!pool || !tgId) return null
  try {
    const { rows } = await pool.query('SELECT deposit_tag FROM users WHERE tg_id = $1', [tgId])
    if (rows[0]?.deposit_tag) return rows[0].deposit_tag
    const tag = 'GH' + randomBytes(4).toString('hex').toUpperCase() // e.g. GH9F3A1C7B
    await pool.query('UPDATE users SET deposit_tag = $2 WHERE tg_id = $1', [tgId, tag])
    return tag
  } catch (e) {
    console.error('[db] getOrCreateDepositTag failed:', e.message)
    return null
  }
}

/** Resolve a deposit comment/tag back to its owner (for crediting deposits). */
export async function userByDepositTag(tag) {
  if (!pool || !tag) return null
  try {
    const { rows } = await pool.query('SELECT tg_id FROM users WHERE deposit_tag = $1', [tag])
    return rows[0] ? Number(rows[0].tg_id) : null
  } catch (e) {
    console.error('[db] userByDepositTag failed:', e.message)
    return null
  }
}

/** A player's GRAM transaction history (most recent first). */
export async function getGramHistory(tgId, limit = 30) {
  if (!pool || !tgId) return []
  try {
    const { rows } = await pool.query(
      'SELECT kind, amount, status, ref, created_at FROM gram_ledger WHERE tg_id = $1 ORDER BY id DESC LIMIT $2',
      [tgId, limit],
    )
    return rows.map((r) => ({
      kind: r.kind,
      amount: Number(r.amount),
      status: r.status,
      ref: r.ref,
      at: r.created_at,
    }))
  } catch (e) {
    console.error('[db] getGramHistory failed:', e.message)
    return []
  }
}

/** Adjust a player's GRAM balance and log a ledger entry atomically. Idempotent on `ref`.
 *  Returns the new balance, or null if a duplicate `ref` was already applied. */
export async function adjustGram({ tgId, delta, kind, status = 'done', ref = null, meta = null }) {
  if (!pool || !tgId) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (ref) {
      const dup = await client.query('SELECT 1 FROM gram_ledger WHERE ref = $1', [ref])
      if (dup.rowCount > 0) {
        await client.query('ROLLBACK')
        return null
      }
    }
    await client.query(
      'INSERT INTO gram_ledger (tg_id, kind, amount, status, ref, meta) VALUES ($1,$2,$3,$4,$5,$6)',
      [tgId, kind, delta, status, ref, meta],
    )
    const { rows } = await client.query(
      'UPDATE users SET balance_gram = balance_gram + $2 WHERE tg_id = $1 RETURNING balance_gram',
      [tgId, delta],
    )
    await client.query('COMMIT')
    return rows[0] ? Number(rows[0].balance_gram) : null
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[db] adjustGram failed:', e.message)
    return null
  } finally {
    client.release()
  }
}

/** Log a Stars payment. Idempotent on charge_id — returns true only the FIRST time. */
export async function recordPayment({ tgId, product, stars, chargeId }) {
  if (!pool || !tgId) return true // no DB: treat as new so the grant still runs locally
  try {
    const { rows } = await pool.query(
      `INSERT INTO payments (tg_id, product, stars, charge_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (charge_id) DO NOTHING RETURNING id`,
      [tgId, product, stars, chargeId ?? null],
    )
    return rows.length > 0 // false = duplicate charge, already processed
  } catch (e) {
    console.error('[db] recordPayment failed:', e.message)
    return false
  }
}

/** Grant a durable entitlement (owned skin, etc.). Idempotent. */
export async function grantEntitlement(tgId, item) {
  if (!pool || !tgId) return
  try {
    await pool.query(
      'INSERT INTO entitlements (tg_id, item) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [tgId, item],
    )
  } catch (e) {
    console.error('[db] grantEntitlement failed:', e.message)
  }
}

/** All items a player owns. */
export async function getEntitlements(tgId) {
  if (!pool || !tgId) return []
  try {
    const { rows } = await pool.query('SELECT item FROM entitlements WHERE tg_id = $1', [tgId])
    return rows.map((r) => r.item)
  } catch (e) {
    console.error('[db] getEntitlements failed:', e.message)
    return []
  }
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
