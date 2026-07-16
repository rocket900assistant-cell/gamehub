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
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_tg    BIGINT NOT NULL,
      to_tg      BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_tg, to_tg)
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
    -- small key/value store for one-time migrations + watermarks (separate from the ledger)
    CREATE TABLE IF NOT EXISTS app_flags (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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

/** Processed withdrawals (not pending) for the owner's history — newest first. */
export async function listWithdrawalHistory(limit = 40) {
  if (!pool) return []
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.tg_id, (-g.amount) AS amount, g.status, g.meta, g.created_at, u.name, u.username
       FROM gram_ledger g LEFT JOIN users u ON u.tg_id = g.tg_id
       WHERE g.kind = 'withdraw' AND g.status <> 'pending' ORDER BY g.id DESC LIMIT $1`,
      [limit],
    )
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      username: r.username,
      amount: Number(r.amount),
      status: r.status,
      address: r.meta?.address ?? null,
      payout: r.meta?.payout ?? 0,
      at: r.created_at,
    }))
  } catch (e) {
    console.error('[db] listWithdrawalHistory failed:', e.message)
    return []
  }
}

/** Approved withdrawals awaiting on-chain send (oldest first). */
export async function listApprovedWithdrawals(limit = 20) {
  if (!pool) return []
  try {
    const { rows } = await pool.query(
      `SELECT id, tg_id, (-amount) AS amount, meta FROM gram_ledger
       WHERE kind = 'withdraw' AND status = 'approved' ORDER BY id ASC LIMIT $1`,
      [limit],
    )
    return rows.map((r) => ({ id: Number(r.id), tgId: Number(r.tg_id), amount: Number(r.amount), meta: r.meta || {} }))
  } catch (e) {
    console.error('[db] listApprovedWithdrawals failed:', e.message)
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

/** History of owner fee withdrawals (HOUSE account), most recent first. */
export async function getFeeHistory(limit = 20) {
  if (!pool) return []
  try {
    const { rows } = await pool.query(
      `SELECT (-amount) AS amount, meta, created_at FROM gram_ledger
       WHERE tg_id = 0 AND kind = 'fee_withdraw' ORDER BY id DESC LIMIT $1`,
      [limit],
    )
    return rows.map((r) => ({ amount: Number(r.amount), to: r.meta?.to ?? null, at: r.created_at }))
  } catch (e) {
    console.error('[db] getFeeHistory failed:', e.message)
    return []
  }
}

/** Refund stakes whose game never settled (server restarted mid-game). Idempotent.
 *  Runs once at startup. Returns the number refunded. */
export async function refundOrphanedStakes() {
  if (!pool) return 0
  try {
    const { rows } = await pool.query(
      `SELECT tg_id, (-amount) AS amount, ref FROM (
         SELECT tg_id, amount, ref, 'settled:' || split_part(ref, ':', 2) AS mref
         FROM gram_ledger WHERE kind = 'stake'
       ) s
       WHERE NOT EXISTS (SELECT 1 FROM gram_ledger m WHERE m.kind = 'settled' AND m.ref = s.mref)
         AND NOT EXISTS (SELECT 1 FROM gram_ledger r WHERE r.ref = 'stalerefund:' || s.ref)`,
    )
    let n = 0
    for (const r of rows) {
      const res = await adjustGram({
        tgId: Number(r.tg_id),
        delta: Number(r.amount),
        kind: 'refund',
        ref: 'stalerefund:' + r.ref,
      })
      if (res != null) n++
    }
    if (n > 0) console.log(`[gram] refunded ${n} orphaned stake(s) from a prior restart`)
    return n
  } catch (e) {
    console.error('[db] refundOrphanedStakes failed:', e.message)
    return 0
  }
}

/** Aggregate stats for the owner admin dashboard. Read-only, lightweight aggregates. */
export async function getAdminStats() {
  if (!pool) return null
  const q = (text) => pool.query(text)
  const [players, circ, house, dep, wSent, wPend, stakeVol, feeTotal, games, byType, stars] =
    await Promise.all([
      q(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS new24h,
                COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS new7d
           FROM users WHERE tg_id <> 0`),
      q(`SELECT COALESCE(SUM(balance_gram),0)::float AS v FROM users WHERE tg_id <> 0`),
      q(`SELECT COALESCE(SUM(balance_gram),0)::float AS v FROM users WHERE tg_id = 0`),
      q(`SELECT COALESCE(SUM(amount),0)::float AS v, COUNT(*)::int AS n FROM gram_ledger WHERE kind='deposit'`),
      q(`SELECT COALESCE(SUM(-amount),0)::float AS v, COUNT(*)::int AS n FROM gram_ledger WHERE kind='withdraw' AND status='sent'`),
      q(`SELECT COALESCE(SUM(-amount),0)::float AS v, COUNT(*)::int AS n FROM gram_ledger WHERE kind='withdraw' AND status IN ('pending','approved','sending')`),
      q(`SELECT COALESCE(SUM(stake),0)::float AS v FROM game_history WHERE stake > 0`),
      q(`SELECT COALESCE(SUM(amount),0)::float AS v FROM gram_ledger WHERE kind='fee'`),
      q(`SELECT COUNT(*)::int AS n FROM game_history`),
      q(`SELECT game, COUNT(*)::int AS n FROM game_history GROUP BY game ORDER BY n DESC`),
      q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(stars),0)::int AS v FROM payments`),
    ])
  return {
    players: players.rows[0],
    gramInCirculation: circ.rows[0].v,
    houseFee: house.rows[0]?.v ?? 0,
    deposits: dep.rows[0],
    withdrawalsSent: wSent.rows[0],
    withdrawalsPending: wPend.rows[0],
    stakeVolume: stakeVol.rows[0].v,
    feeTotal: feeTotal.rows[0].v,
    gamesTotal: games.rows[0].n,
    gamesByType: byType.rows,
    stars: stars.rows[0],
  }
}

/** Player list for the admin (newest first). Read-only. */
export async function listUsers(limit = 300) {
  if (!pool) return []
  const { rows } = await pool.query(
    `SELECT tg_id, username, name, balance_gram, games, wins, created_at
       FROM users WHERE tg_id <> 0 ORDER BY created_at DESC LIMIT $1`,
    [limit],
  )
  return rows
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
      'SELECT kind, amount, status, ref, meta, created_at FROM gram_ledger WHERE tg_id = $1 ORDER BY id DESC LIMIT $2',
      [tgId, limit],
    )
    return rows.map((r) => ({
      kind: r.kind,
      amount: Number(r.amount),
      status: r.status,
      ref: r.ref,
      // where the money went (withdraw) / came from (deposit) — for the history UI
      address: r.meta?.address ?? r.meta?.from ?? null,
      at: r.created_at,
    }))
  } catch (e) {
    console.error('[db] getGramHistory failed:', e.message)
    return []
  }
}

/** Atomic guarded debit: subtracts `amount` only if the balance can cover it, in one
 *  transaction (so concurrent stakes can't double-spend / go negative). Idempotent on `ref`.
 *  Returns 'ok' (debited now) | 'dup' (this ref already debited) | 'insufficient' | 'error'. */
export async function debitIfAffordable({ tgId, amount, kind, ref = null, meta = null }) {
  if (!pool || !tgId || !(amount > 0)) return 'error'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (ref) {
      const dup = await client.query('SELECT 1 FROM gram_ledger WHERE ref = $1', [ref])
      if (dup.rowCount > 0) {
        await client.query('ROLLBACK')
        return 'dup' // already escrowed earlier — treat as success, don't debit twice
      }
    }
    const { rows } = await client.query(
      'UPDATE users SET balance_gram = balance_gram - $2 WHERE tg_id = $1 AND balance_gram >= $2 RETURNING balance_gram',
      [tgId, amount],
    )
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return 'insufficient' // balance couldn't cover it (lost a race for the same funds)
    }
    await client.query(
      'INSERT INTO gram_ledger (tg_id, kind, amount, status, ref, meta) VALUES ($1,$2,$3,$4,$5,$6)',
      [tgId, kind, -amount, 'done', ref, meta],
    )
    await client.query('COMMIT')
    return 'ok'
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[db] debitIfAffordable failed:', e.message)
    return 'error'
  } finally {
    client.release()
  }
}

/** Adjust a player's GRAM balance and log a ledger entry atomically. Idempotent on `ref`.
 *  Returns the new balance, or null if a duplicate `ref` was already applied. */
export async function adjustGram({ tgId, delta, kind, status = 'done', ref = null, meta = null }) {
  if (!pool || tgId == null) return null // tgId 0 = HOUSE account (fees/settled markers) — must be allowed
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

/** One-time full reset of test balances + GRAM history. Zeroes every user's balance
 *  (including the house account) and wipes the gram_ledger. Idempotent: a marker in
 *  app_flags (a table separate from the ledger, so wiping the ledger can't un-guard it)
 *  ensures it runs at most once per `flag`. Returns true only on the run that applied it. */
export async function resetAllBalancesOnce(flag) {
  if (!pool) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const done = await client.query('SELECT 1 FROM app_flags WHERE key = $1', [flag])
    if (done.rowCount > 0) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query('UPDATE users SET balance_gram = 0')
    await client.query('DELETE FROM gram_ledger')
    await client.query('INSERT INTO app_flags (key) VALUES ($1)', [flag])
    await client.query('COMMIT')
    return true
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[db] resetAllBalancesOnce failed:', e.message)
    return false
  } finally {
    client.release()
  }
}

/** Read a value from the app_flags key/value store (null if unset). */
export async function getFlag(key) {
  if (!pool) return null
  try {
    const { rows } = await pool.query('SELECT value FROM app_flags WHERE key = $1', [key])
    return rows[0] ? rows[0].value : null
  } catch {
    return null
  }
}

/** Upsert a value into the app_flags key/value store. */
export async function setFlag(key, value) {
  if (!pool) return
  try {
    await pool.query(
      `INSERT INTO app_flags (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)],
    )
  } catch (e) {
    console.error('[db] setFlag failed:', e.message)
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

// ── friend requests (pending until the recipient accepts) ──
const memReq = new Map() // toTg -> Set(fromTg): pending incoming requests (no-DB fallback)

/** Find a registered player by their Telegram @username (case-insensitive). */
export async function userByUsername(username) {
  const clean = String(username ?? '').replace(/^@/, '').trim()
  if (!clean || !pool) return null
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
    [clean],
  )
  return rows[0] ?? null
}

/** Send a friend request from → to. Returns a status:
 *  'self' | 'already-friends' | 'accepted' (they'd already requested you) | 'sent' | 'exists'. */
export async function createFriendRequest(fromTg, toTg) {
  fromTg = Number(fromTg)
  toTg = Number(toTg)
  if (!fromTg || !toTg || fromTg === toTg) return 'self'
  if (!pool) {
    if (memFriends.get(fromTg)?.has(toTg)) return 'already-friends'
    if (memReq.get(fromTg)?.has(toTg)) {
      // they already requested me → accept immediately
      await addFriendship(fromTg, toTg)
      memReq.get(fromTg).delete(toTg)
      memReq.get(toTg)?.delete(fromTg)
      return 'accepted'
    }
    if (!memReq.has(toTg)) memReq.set(toTg, new Set())
    if (memReq.get(toTg).has(fromTg)) return 'exists'
    memReq.get(toTg).add(fromTg)
    return 'sent'
  }
  const fr = await pool.query('SELECT 1 FROM friendships WHERE a=$1 AND b=$2', [fromTg, toTg])
  if (fr.rowCount > 0) return 'already-friends'
  const rev = await pool.query(
    'SELECT 1 FROM friend_requests WHERE from_tg=$1 AND to_tg=$2',
    [toTg, fromTg],
  )
  if (rev.rowCount > 0) {
    await addFriendship(fromTg, toTg)
    await pool.query(
      'DELETE FROM friend_requests WHERE (from_tg=$1 AND to_tg=$2) OR (from_tg=$2 AND to_tg=$1)',
      [fromTg, toTg],
    )
    return 'accepted'
  }
  const ins = await pool.query(
    'INSERT INTO friend_requests (from_tg, to_tg) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1',
    [fromTg, toTg],
  )
  return ins.rowCount > 0 ? 'sent' : 'exists'
}

/** Incoming pending requests for a player (joined with the requester's profile). */
export async function listIncomingRequests(toTg) {
  toTg = Number(toTg)
  if (!toTg) return []
  if (!pool) return [...(memReq.get(toTg) ?? [])].map((id) => ({ tg_id: id }))
  const { rows } = await pool.query(
    `SELECT u.tg_id, u.name, u.username, u.photo_url, u.elo_chess FROM friend_requests r
       JOIN users u ON u.tg_id = r.from_tg
       WHERE r.to_tg = $1 ORDER BY r.created_at DESC`,
    [toTg],
  )
  return rows
}

/** Accept the request from `fromTg` → creates the friendship. Returns true if a request existed. */
export async function acceptFriendRequest(toTg, fromTg) {
  toTg = Number(toTg)
  fromTg = Number(fromTg)
  if (!toTg || !fromTg) return false
  if (!pool) {
    if (!memReq.get(toTg)?.has(fromTg)) return false
    memReq.get(toTg).delete(fromTg)
    await addFriendship(toTg, fromTg)
    return true
  }
  const del = await pool.query(
    'DELETE FROM friend_requests WHERE from_tg=$1 AND to_tg=$2 RETURNING 1',
    [fromTg, toTg],
  )
  if (del.rowCount === 0) return false
  await addFriendship(toTg, fromTg)
  return true
}

/** Decline / cancel a pending request (removes it, no friendship). */
export async function declineFriendRequest(toTg, fromTg) {
  toTg = Number(toTg)
  fromTg = Number(fromTg)
  if (!toTg || !fromTg) return
  if (!pool) {
    memReq.get(toTg)?.delete(fromTg)
    return
  }
  await pool.query('DELETE FROM friend_requests WHERE from_tg=$1 AND to_tg=$2', [fromTg, toTg])
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
