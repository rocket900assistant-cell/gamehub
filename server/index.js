import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { Chess } from 'chess.js'
import { initDb, upsertUser, getUser, recordResult, applyElo, dbEnabled, addFriendship, removeFriendship, getFriends, userByUsername, createFriendRequest, listIncomingRequests, acceptFriendRequest, declineFriendRequest, setUserName, setUserVip, getHistory, getEloTrend, recordPayment, grantEntitlement, getEntitlements, getGramHistory, adjustGram, debitIfAffordable, getOrCreateDepositTag, userByDepositTag, getBalance, createWithdrawal, listPendingWithdrawals, listApprovedWithdrawals, getWithdrawal, setWithdrawalStatus, getFeeHistory, refundOrphanedStakes, getAdminStats, listUsers } from './db.js'
import { settleStakes } from './gramStakes.js'
import { initSender, senderReady, hotBalance, sendTon } from './tonSender.js'
import { verifyInitData } from './telegram.js'
import { createNardy, roll as nardyRoll, move as nardyMove, destOf as nardyDest, other as nardyOther, legalMoves as nardyLegalMoves, pass as nardyPass } from './nardy.js'
import * as durak from './durak.js'
import * as durakN from './durakN.js'
import { levelForElo, botChessMove, fakeChessOpponent } from './chessBot.js'

const PORT = process.env.PORT || 3001

// Never let one bad packet or a stray async rejection kill the whole server
// (that would drop every live game). Log loudly and keep running.
process.on('uncaughtException', (e) => console.error('[fatal] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[fatal] unhandledRejection:', e))

// ── in-memory state (live sessions) ──────────────
const users = new Map() // userId -> { socketId, name, elo }
const socketUser = new Map() // socketId -> userId
const userTg = new Map() // composite userId -> verified telegram id (for DB)
const tgSocket = new Map() // telegram id -> socketId (presence: online friends)
const tgInfo = new Map() // telegram id -> { name, username, photoUrl, elos } (last seen)
const queues = new Map() // "game:minutes" -> [userId]
const botFallbackTimers = new Map() // userId -> timer: seed a chess bot if no human matches
const BOT_FALLBACK_MS = 20000 // wait this long for a real opponent before a fill-in bot
function clearBotFallback(userId) {
  const tm = botFallbackTimers.get(userId)
  if (tm) {
    clearTimeout(tm)
    botFallbackTimers.delete(userId)
  }
}

/** If it's the fill-in bot's turn in a chess room, play its move after a human-like pause. */
function scheduleChessBot(room) {
  if (!room || room.over || room.game !== 'chess') return
  const bot = room.players.find((p) => p.isBot)
  if (!bot || room.chess.turn() !== bot.color) return
  clearTimeout(room.botTimer)
  const delay = 900 + Math.floor(Math.random() * 2600) // ~1–3.5s "thinking"
  room.botTimer = setTimeout(() => {
    if (room.over || room.chess.turn() !== bot.color) return
    const mv = botChessMove(room.chess.fen(), bot.botLevel)
    if (!mv) return
    try {
      if (!room.chess.move({ from: mv.from, to: mv.to, promotion: 'q' })) return
    } catch {
      return
    }
    emitToRoom(room, 'game:state', {
      fen: room.chess.fen(),
      turn: room.chess.turn(),
      clocks: room.clocks,
      lastMove: { from: mv.from, to: mv.to },
    })
    if (room.chess.isGameOver()) {
      if (room.chess.isCheckmate()) endGame(room, room.chess.turn() === 'w' ? 'b' : 'w', 'mate')
      else endGame(room, null, 'draw')
    }
  }, delay)
}

/** No human found in time → start a FREE chess game vs a disguised fill-in bot. */
function seedChessBot(userId, minutes) {
  botFallbackTimers.delete(userId)
  const key = qkey('chess', minutes)
  const q = queues.get(key) ?? []
  if (!q.includes(userId)) return // already matched or cancelled
  queues.set(key, q.filter((id) => id !== userId))
  if (!sidOf(userId)) return // player disconnected while waiting
  const room = rooms.get(createRoom('chess', minutes, {}))
  addPlayer(room, userId) // human = players[0]
  const humanElo = room.players[0]?.elo ?? 1200
  const op = fakeChessOpponent(humanElo)
  room.players.push({
    userId: `bot:${room.id}`,
    tgId: null,
    name: op.name,
    elo: op.elo,
    vip: false,
    photoUrl: op.photoUrl, // disguised avatar (falls back to initials if it fails to load)
    color: 'b', // second seat; startRoom may still flip who is white
    isBot: true,
    botLevel: levelForElo(humanElo),
  })
  startRoom(room) // deals + emits match:found (bot has no socket → only the human is notified)
}

/** If it's the durak fill-in bot's turn (seat 'opp'), play one action after a pause.
 *  durakCommit re-invokes this after each move, so multi-card throw-ins chain naturally. */
function scheduleDurakBot(room) {
  if (!room || room.over || room.game !== 'durak') return
  if (!room.players[1]?.isBot) return
  if (room.durak.result || room.durak.turn !== 'opp') return
  clearTimeout(room.botTimer)
  const delay = 700 + Math.floor(Math.random() * 1800) // human-like pause
  room.botTimer = setTimeout(() => {
    if (room.over || room.durak.result || room.durak.turn !== 'opp') return
    const next = durak.botStep(room.durak)
    if (next !== room.durak) durakCommit(room, next) // applies + broadcasts + re-schedules
  }, delay)
}

/** No human found in time → start a FREE 1v1 durak game vs a disguised fill-in bot. */
function seedDurakBot(userId, minutes, transfer) {
  botFallbackTimers.delete(userId)
  const key = `durak:${minutes}:${transfer ? 't' : 'c'}`
  const q = queues.get(key) ?? []
  if (!q.includes(userId)) return // already matched or cancelled
  queues.set(key, q.filter((id) => id !== userId))
  if (!sidOf(userId)) return
  const room = rooms.get(createRoom('durak', minutes, { transfer }))
  addPlayer(room, userId) // human = players[0] = seat 'you'
  const op = fakeChessOpponent(room.players[0]?.elo ?? 1200)
  room.players.push({
    userId: `bot:${room.id}`,
    tgId: null,
    name: op.name,
    elo: op.elo,
    vip: false,
    photoUrl: op.photoUrl,
    color: 'b',
    isBot: true, // seat 'opp'
  })
  startRoom(room)
}

/** Pick one nardy move (long nardy): bear off if possible, else play the biggest die. */
function pickNardyMove(st) {
  const moves = nardyLegalMoves(st)
  if (moves.length === 0) return null
  moves.sort((a, b) => {
    const off = (a.dest === 'off' ? 1 : 0) - (b.dest === 'off' ? 1 : 0)
    return off !== 0 ? -off : b.die - a.die // bear-off first, then bigger die (more progress)
  })
  return moves[0]
}

/** Drive the nardy fill-in bot: roll → play dice one at a time → turn passes. */
function scheduleNardyBot(room) {
  if (!room || room.over || room.game !== 'nardy') return
  const bot = room.players.find((p) => p.isBot)
  if (!bot) return
  if (room.nardy.result || room.nardy.turn !== bot.color) return
  clearTimeout(room.botTimer)
  const delay = 800 + Math.floor(Math.random() * 1500) // human-like pause per action
  room.botTimer = setTimeout(() => {
    if (room.over || room.nardy.result || room.nardy.turn !== bot.color) return
    if (room.nardy.awaitingRoll) {
      room.nardy = nardyRoll(room.nardy) // rolls (auto-passes if no move)
    } else {
      const mv = pickNardyMove(room.nardy)
      room.nardy = mv ? nardyMove(room.nardy, mv.from, mv.die) : nardyPass(room.nardy)
    }
    emitToRoom(room, 'nardy:state', { nardy: room.nardy, deadline: room.deadline })
    if (room.nardy.result) return endGame(room, room.nardy.result, 'win')
    scheduleNardyBot(room) // keep going: another die, or the roll if a new turn
  }, delay)
}

/** No human found in time → start a FREE nardy game vs a disguised fill-in bot. */
function seedNardyBot(userId, minutes) {
  botFallbackTimers.delete(userId)
  const key = qkey('nardy', minutes)
  const q = queues.get(key) ?? []
  if (!q.includes(userId)) return
  queues.set(key, q.filter((id) => id !== userId))
  if (!sidOf(userId)) return
  const room = rooms.get(createRoom('nardy', minutes, {}))
  addPlayer(room, userId)
  const op = fakeChessOpponent(room.players[0]?.elo ?? 1200)
  room.players.push({
    userId: `bot:${room.id}`,
    tgId: null,
    name: op.name,
    elo: op.elo,
    vip: false,
    photoUrl: op.photoUrl,
    color: 'b',
    isBot: true,
  })
  startRoom(room)
}

const nQueues = new Map() // durakn config key -> { ids: [], timer } (fills with bots on timeout)
const DURAKN_FILL_MS = 20000 // wait this long for humans, then fill remaining seats with (disguised) bots
const rooms = new Map() // roomId -> room
const abandonTimers = new Map() // "userId:roomId" -> timeout (reconnect grace)
const RECONNECT_GRACE_MS = 120000 // 2 min to reconnect before a started game abandons you

// persistent DB (Neon Postgres) — optional; no-ops if DATABASE_URL is unset
initDb()
  .then(() => refundOrphanedStakes()) // return any stakes stuck by a prior restart
  .catch((e) => console.error('[db] init failed:', e.message))

/** Shape a users row for the client. */
function dbProfile(r) {
  return {
    tgId: Number(r.tg_id),
    name: r.name,
    username: r.username,
    photoUrl: r.photo_url,
    elo: { chess: r.elo_chess, durak: r.elo_durak, nardy: r.elo_nardy },
    balance: Number(r.balance_gram),
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    vip: !!r.vip,
  }
}

const uid = () => Math.random().toString(36).slice(2, 10)
const qkey = (game, minutes) => `${game}:${minutes}`

/** GameHub Elo formula (symmetric, per game). */
function eloDelta(myElo, oppElo, won) {
  const d = oppElo - myElo
  let win, loss
  if (oppElo >= myElo * 2) [win, loss] = [50, 10]
  else if (d >= 250) [win, loss] = [45, 15]
  else if (d >= 100) [win, loss] = [35, 20]
  else if (d > -100) [win, loss] = [25, 25]
  else if (d > -250) [win, loss] = [18, 35]
  else [win, loss] = [12, 45]
  return won ? win : -loss
}

function createRoom(game, minutes, opts = {}) {
  const id = uid()
  const room = {
    id,
    game,
    minutes,
    players: [], // [{ userId, tgId, name, elo, color }]
    started: false,
    over: false,
    timer: null,
    stake: opts.stake > 0 ? Math.round(opts.stake * 100) / 100 : 0, // GRAM per player (0 = free)
    transfer: !!opts.transfer, // remembered so a rematch can rebuild the same config
  }
  if (game === 'nardy') {
    room.nardy = createNardy()
    room.moveMs = (minutes || 2) * 60000 // per-turn clock (default 2 min)
    room.deadline = 0
  } else if (game === 'durak') {
    // minutes reused as deck size; transfer = переводной mode
    room.durak = durak.createGame({ deck: minutes || 36, transfer: !!opts.transfer })
    room.moveMs = 60000 // per-action clock
    room.deadline = 0
  } else if (game === 'durakn') {
    // N-player durak vs a mix of humans + bots. minutes reused as deck size.
    room.seats = Math.max(2, Math.min(6, opts.players ?? 3))
    room.durakN = durakN.createGameN({
      players: room.seats,
      deck: minutes || 36,
      neighborsOnly: !!opts.neighborsOnly,
      transfer: !!opts.transfer,
      allowDraw: opts.allowDraw ?? true,
    })
    room.moveMs = 60000
    room.deadline = 0
    room.seatUser = [] // filled at startRoom (seat -> userId | null[bot])
  } else {
    room.chess = new Chess()
    room.clocks = { w: minutes * 60000, b: minutes * 60000 }
    room.lastTick = null
  }
  rooms.set(id, room)
  return id
}

function addPlayer(room, userId) {
  if (room.players.some((p) => p.userId === userId)) return
  const max = room.game === 'durakn' ? room.seats : 2
  if (room.players.length >= max) return
  const u = users.get(userId)
  room.players.push({
    userId,
    tgId: userTg.get(userId) ?? null,
    name: u?.name ?? 'Игрок',
    elo: u?.elos?.[room.game] ?? u?.elo ?? 1200,
    vip: !!u?.vip,
    photoUrl: u?.photoUrl ?? null,
    color: room.players.length === 0 ? 'w' : 'b',
  })
}

const sidOf = (userId) => users.get(userId)?.socketId

// ── Durak N-players matchmaking (humans + bot fill) ──
const nKey = (o) =>
  `durakn:${o.players}:${o.deck}:${o.transfer ? 't' : 'c'}:${o.neighborsOnly ? 'n' : 'a'}:${o.allowDraw ? 'd' : 'k'}:${o.stake > 0 ? 's' + o.stake : 'f'}`

function startDurakNRoom(ids, opts) {
  const room = rooms.get(createRoom('durakn', opts.deck, opts))
  for (const id of ids.slice(0, opts.players)) addPlayer(room, id)
  startRoom(room) // free games: remaining seats are bots
}

function quickMatchDurakN(userId, socket, opts) {
  const key = nKey(opts)
  let q = nQueues.get(key)
  if (!q) {
    q = { ids: [], timer: null }
    nQueues.set(key, q)
  }
  if (q.ids.includes(userId)) return
  q.ids.push(userId)
  socket.emit('queue:waiting')
  if (q.ids.length >= opts.players) {
    clearTimeout(q.timer)
    const ids = q.ids.splice(0, opts.players)
    if (q.ids.length === 0) nQueues.delete(key)
    startDurakNRoom(ids, opts)
    return
  }
  // Free games fill empty seats with bots after a wait. STAKED games are
  // human-only (bots can't stake), so they wait for real players.
  if (!q.timer && !(opts.stake > 0)) {
    q.timer = setTimeout(() => {
      const ids = q.ids.slice()
      nQueues.delete(key)
      if (ids.length > 0) startDurakNRoom(ids, opts) // fill the rest with bots
    }, DURAKN_FILL_MS)
  }
}

function leaveNQueues(userId) {
  for (const [k, q] of nQueues) {
    q.ids = q.ids.filter((id) => id !== userId)
    if (q.ids.length === 0) {
      clearTimeout(q.timer)
      nQueues.delete(k)
    }
  }
}

// ── Open lobbies (browsable durakn rooms that wait for real players) ──
const lobbyWatchers = new Set() // socket ids viewing the "Открытые игры" list

const isOpenLobby = (r) => r.game === 'durakn' && !r.started && !r.over && r.players.length > 0

function lobbySummary() {
  const list = []
  for (const r of rooms.values()) {
    if (!isOpenLobby(r)) continue
    list.push({
      roomId: r.id,
      host: r.players[0]?.name ?? 'Игрок',
      names: r.players.map((p) => p.name),
      filled: r.players.length,
      capacity: r.seats,
      deck: r.minutes || 36,
      transfer: !!r.durakN.transfer,
      neighborsOnly: !!r.durakN.neighborsOnly,
      allowDraw: !!r.durakN.allowDraw,
      stake: r.stake || 0,
    })
  }
  return list
}

function broadcastLobbies() {
  const list = lobbySummary()
  for (const sid of lobbyWatchers) io.to(sid).emit('lobby:list', list)
}

/** Waiting-room state for each member (per-recipient isHost flag). */
function emitLobbyState(room) {
  const hostId = room.players[0]?.userId
  for (const p of room.players) {
    const sid = sidOf(p.userId)
    if (!sid) continue
    io.to(sid).emit('lobby:state', {
      roomId: room.id,
      host: room.players[0]?.name ?? 'Игрок',
      isHost: p.userId === hostId,
      capacity: room.seats,
      filled: room.players.length,
      deck: room.minutes || 36,
      transfer: !!room.durakN.transfer,
      neighborsOnly: !!room.durakN.neighborsOnly,
      allowDraw: !!room.durakN.allowDraw,
      stake: room.stake || 0,
      seats: room.players.map((x) => ({ name: x.name, vip: x.vip, photoUrl: x.photoUrl ?? null })),
    })
  }
}

/** Add a user to an open lobby; begin the match once every seat is filled. */
function joinDurakNLobby(room, userId) {
  if (!room || room.game !== 'durakn' || room.started || room.over) return 'gone'
  if (room.players.length >= room.seats && !room.players.some((p) => p.userId === userId))
    return 'gone'
  addPlayer(room, userId)
  if (room.players.length >= room.seats) startRoom(room) // all seats human → begin
  else emitLobbyState(room)
  broadcastLobbies()
  return 'ok'
}

/** Remove a user from any open lobby they're waiting in (dissolve if empty). */
function leaveLobby(userId) {
  let changed = false
  for (const room of rooms.values()) {
    if (room.game !== 'durakn' || room.started || room.over) continue
    if (!room.players.some((p) => p.userId === userId)) continue
    room.players = room.players.filter((p) => p.userId !== userId)
    changed = true
    if (room.players.length === 0) rooms.delete(room.id)
    else emitLobbyState(room)
  }
  if (changed) broadcastLobbies()
}

// ── friends (mutual, by telegram id) ──────────────
/** Build the friend list for a player: profile + live online flag. */
async function friendListFor(tgId) {
  if (!tgId) return []
  const rows = await getFriends(tgId)
  return rows.map((r) => {
    const id = Number(r.tg_id)
    const info = tgInfo.get(id)
    const elo = r.elo_chess ?? info?.elos?.chess ?? 1200
    return {
      id,
      name: r.name ?? info?.name ?? 'Игрок',
      username: r.username ?? info?.username ?? null,
      photoUrl: r.photo_url ?? info?.photoUrl ?? null,
      elo,
      online: tgSocket.has(id),
    }
  })
}

/** Push a fresh friend list to a player if they're online. */
async function pushFriends(tgId) {
  const sid = tgSocket.get(Number(tgId))
  if (!sid) return
  io.to(sid).emit('friends', await friendListFor(tgId))
}

/** Build the incoming friend-request list for a player: requester profile + online flag. */
async function requestListFor(tgId) {
  if (!tgId) return []
  const rows = await listIncomingRequests(tgId)
  return rows.map((r) => {
    const id = Number(r.tg_id)
    const info = tgInfo.get(id)
    return {
      id,
      name: r.name ?? info?.name ?? 'Игрок',
      username: r.username ?? info?.username ?? null,
      photoUrl: r.photo_url ?? info?.photoUrl ?? null,
      online: tgSocket.has(id),
    }
  })
}

/** Push the pending incoming-request list to a player if they're online. */
async function pushRequests(tgId) {
  const sid = tgSocket.get(Number(tgId))
  if (!sid) return
  io.to(sid).emit('friend:requests', await requestListFor(tgId))
}

// ── Telegram Stars payments ──
const BOT_TOKEN = process.env.BOT_TOKEN
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'gh_' + (BOT_TOKEN ? BOT_TOKEN.slice(-10).replace(/\W/g, '') : 'dev')
const MINIAPP_URL = process.env.MINIAPP_URL || 'https://gamehub-teleplay.online'
const PLATFORM_TON_ADDRESS = process.env.PLATFORM_TON_ADDRESS || null // where GRAM deposits land
const FEE_TON_ADDRESS = process.env.FEE_TON_ADDRESS || null // owner's wallet for withdrawing accrued fees
const STAKE_FEE_RATE = Number(process.env.STAKE_FEE_RATE ?? 0.1) // owner fee = 10% of the loser's stake
const MIN_STAKE = 0.1 // GRAM
const WITHDRAW_FEE_RATE = Number(process.env.WITHDRAW_FEE_RATE ?? 0.001) // 0.1% gas fee
const WITHDRAW_FEE_MIN = Number(process.env.WITHDRAW_FEE_MIN ?? 0.05) // floor so gas is always covered
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW ?? 1) // must exceed the fee
const withdrawFee = (amount) => Math.max(Math.round(amount * WITHDRAW_FEE_RATE * 100) / 100, WITHDRAW_FEE_MIN)
const OWNER_TG_ID = process.env.OWNER_TG_ID ? Number(process.env.OWNER_TG_ID) : null // sees the withdrawals admin
const isOwner = (tgId) => OWNER_TG_ID != null && Number(tgId) === OWNER_TG_ID
const isTonAddress = (a) => typeof a === 'string' && /^[EU]Q[A-Za-z0-9_-]{46}$/.test(a.trim())
const WEBHOOK_PATH = `/tg/${WEBHOOK_SECRET}`

// Admin dashboard (separate private bot). Stats are cached so repeated opens
// never hammer the DB or compete with the game for resources.
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || null
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
/** Owner-only JSON route: verifies the admin bot's initData + OWNER_TG_ID, then
 *  replies with whatever `produce()` returns. Shared by all /admin/* endpoints. */
function adminRoute(req, res, produce) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, CORS)
    res.end()
    return
  }
  let body = ''
  req.on('data', (c) => {
    body += c
    if (body.length > 1e5) req.destroy()
  })
  req.on('end', async () => {
    try {
      const { initData } = JSON.parse(body || '{}')
      const user = verifyInitData(initData, ADMIN_BOT_TOKEN)
      if (!user || !isOwner(user.id)) {
        res.writeHead(403, { ...CORS, 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
      const data = await produce()
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    } catch (e) {
      res.writeHead(500, { ...CORS, 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'failed' }))
      console.error('[admin] route:', e.message)
    }
  })
}

async function adminPlayers() {
  const rows = await listUsers(300)
  return rows.map((u) => ({
    id: Number(u.tg_id),
    name: u.name,
    username: u.username,
    balance: Number(u.balance_gram),
    games: u.games,
    online: tgSocket.has(Number(u.tg_id)),
    joined: u.created_at,
  }))
}

let statsCache = { at: 0, data: null }
async function adminStats() {
  if (Date.now() - statsCache.at < 30000 && statsCache.data) return statsCache.data
  const db = await getAdminStats()
  const activeGames = [...rooms.values()].filter((r) => r.started && !r.over).length
  const data = {
    ...(db ?? {}),
    onlineNow: tgSocket.size,
    activeGames,
    hotBalance: senderReady() ? await hotBalance() : null,
    senderReady: senderReady(),
    at: new Date().toISOString(),
  }
  statsCache = { at: Date.now(), data }
  return data
}

// HTTP server: health-check ("/") + the Telegram webhook (payments).
const httpServer = createServer((req, res) => {
  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
      res.writeHead(401)
      res.end()
      return
    }
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1e6) req.destroy()
    })
    req.on('end', () => {
      res.writeHead(200)
      res.end('ok') // acknowledge fast, then process
      try {
        handleTgUpdate(JSON.parse(body))
      } catch (e) {
        console.error('[tg] webhook parse:', e.message)
      }
    })
    return
  }
  // Admin dashboard — owner-only, verified via the ADMIN bot's initData.
  if (req.url === '/admin/stats') return adminRoute(req, res, adminStats)
  if (req.url === '/admin/players') return adminRoute(req, res, adminPlayers)
  if (req.method === 'GET' && req.url === '/status') {
    // Non-sensitive readiness probe: exposes ONLY whether the payout sender
    // initialised (true iff the seed matched HOT_TON_ADDRESS). No address, no
    // balance, no secrets — safe to be public.
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, senderReady: senderReady(), lastHotError }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('GameHub realtime server ok')
})
httpServer.listen(PORT)
const io = new Server(httpServer, { cors: { origin: '*' } })

/** Call the Telegram Bot API. */
async function callTG(method, params) {
  if (!BOT_TOKEN) return null
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    })
    const j = await r.json()
    if (!j.ok) console.error('[tg]', method, 'failed:', j.description)
    return j.ok ? j.result : null
  } catch (e) {
    console.error('[tg]', method, 'error:', e.message)
    return null
  }
}

// Shop prices live on the SERVER (client can't tamper them).
const VIP_PRICE_STARS = 999
const SKIN_PRICE_STARS = 150
function productInfo(product) {
  if (product === 'vip') return { title: 'VIP статус', description: 'VIP в GameHub: все скины и привилегии', stars: VIP_PRICE_STARS }
  if (typeof product === 'string' && product.startsWith('skin:')) return { title: 'Скин', description: 'Скин для GameHub', stars: SKIN_PRICE_STARS }
  return null
}

/** Create a Telegram Stars invoice link for `product` bought by `userId`. */
async function createStarsInvoice(userId, product) {
  const info = productInfo(product)
  if (!info) return null
  return callTG('createInvoiceLink', {
    title: info.title,
    description: info.description,
    payload: `${userId}::${product}`, // who + what — checked on successful_payment
    currency: 'XTR', // Telegram Stars
    prices: [{ label: info.title, amount: info.stars }],
  })
}

/** Apply a paid product to the buyer and push the update to their client. */
async function grantProduct(tgId, userId, product) {
  if (product === 'vip') await setUserVip(tgId, true)
  else if (product.startsWith('skin:')) await grantEntitlement(tgId, product)
  const sid = (userId && sidOf(userId)) || (tgId && tgSocket.get(Number(tgId)))
  if (sid) {
    io.to(sid).emit('shop:granted', { product })
    try {
      const row = await getUser(tgId)
      if (row) io.to(sid).emit('profile', dbProfile(row))
    } catch {
      /* ignore */
    }
  }
}

/** Telegram webhook updates — payments only (pre-checkout + successful payment). */
async function handleTgUpdate(update) {
  if (update.pre_checkout_query) {
    // must be answered within 10s or the charge is cancelled
    await callTG('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true })
    return
  }
  // /start (or any plain message) → greet with a button that opens the mini app
  const msg = update.message
  if (msg?.text && !msg.successful_payment) {
    await callTG('sendMessage', {
      chat_id: msg.chat.id,
      text:
        '♟️ Добро пожаловать в GameHub!\n\nШахматы, Дурак и Нарды — играй онлайн с друзьями и соперниками. Собирай лобби и играй компанией, поднимай рейтинг и становись частью комьюнити.\n\nЖми «Играть» 👇',
      reply_markup: {
        inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: MINIAPP_URL } }]],
      },
    })
    return
  }
  const sp = update.message?.successful_payment
  if (sp) {
    const tgId = update.message.from?.id
    const [userId, product] = String(sp.invoice_payload || '').split('::')
    if (!product || !productInfo(product)) return
    const fresh = await recordPayment({ tgId, product, stars: sp.total_amount, chargeId: sp.telegram_payment_charge_id })
    if (fresh) await grantProduct(tgId, userId, product) // grant once per charge (idempotent)
  }
}

/** Point Telegram's webhook at this server so payments reach us. */
async function setupWebhook() {
  if (!BOT_TOKEN) {
    console.warn('[tg] BOT_TOKEN not set — payments disabled')
    return
  }
  const base =
    process.env.RENDER_EXTERNAL_URL ||
    process.env.PUBLIC_URL ||
    'https://gamehub-server-6ujx.onrender.com' // known prod URL fallback
  if (!base) {
    console.warn('[tg] no public URL — webhook not set; payments will not confirm')
    return
  }
  const url = base.replace(/\/+$/, '') + WEBHOOK_PATH
  const r = await callTG('setWebhook', {
    url,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'pre_checkout_query'],
  })
  console.log('[tg] setWebhook', url, r ? '✓' : '✗')
}
setupWebhook()

// ── GRAM deposit watcher: credit incoming TON transfers by their comment tag ──
const TONAPI = 'https://tonapi.io'
const TONAPI_KEY = process.env.TONAPI_KEY
let platformRaw = null // our address in raw 0:.. form (for the direction check)
let pollingDeposits = false

async function tonapi(path) {
  const headers = TONAPI_KEY ? { Authorization: `Bearer ${TONAPI_KEY}` } : {}
  const r = await fetch(TONAPI + path, { headers })
  if (!r.ok) throw new Error('tonapi ' + r.status)
  return r.json()
}

async function pollDeposits() {
  if (!PLATFORM_TON_ADDRESS || !dbEnabled || pollingDeposits) return
  pollingDeposits = true
  try {
    if (!platformRaw) {
      const acc = await tonapi(`/v2/accounts/${PLATFORM_TON_ADDRESS}`)
      platformRaw = acc?.address || null
    }
    const data = await tonapi(`/v2/accounts/${PLATFORM_TON_ADDRESS}/events?limit=50`)
    for (const ev of data.events || []) {
      const actions = ev.actions || []
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i]
        if (a.type !== 'TonTransfer' || (a.status && a.status !== 'ok')) continue
        const tr = a.TonTransfer
        const comment = tr?.comment && String(tr.comment).trim()
        if (!comment) continue
        if (platformRaw && tr.recipient?.address !== platformRaw) continue // must be INCOMING
        const tgId = await userByDepositTag(comment)
        if (!tgId) continue
        const gram = Math.round((Number(tr.amount) / 1e9) * 100) / 100
        if (!(gram > 0)) continue
        const ref = `ton:${ev.event_id}:${i}`
        const newBal = await adjustGram({ tgId, delta: gram, kind: 'deposit', ref, meta: { from: tr.sender?.address ?? null } })
        if (newBal != null) {
          // first time this tx is seen → credited; notify the player if online
          const sid = tgSocket.get(Number(tgId))
          if (sid) {
            io.to(sid).emit('gram:credited', { amount: gram, balance: newBal })
            try {
              const row = await getUser(tgId)
              if (row) io.to(sid).emit('profile', dbProfile(row))
            } catch {
              /* ignore */
            }
          }
          console.log(`[gram] credited +${gram} → tg ${tgId} (${ref})`)
        }
      }
    }
  } catch (e) {
    console.error('[gram] pollDeposits:', e.message)
  } finally {
    pollingDeposits = false
  }
}
if (PLATFORM_TON_ADDRESS) {
  setInterval(pollDeposits, 25000)
  console.log('[gram] deposit watcher on for', PLATFORM_TON_ADDRESS)
}

// ── Withdrawal sender: send approved payouts from the hot wallet ──
const MAX_AUTO_WITHDRAW = Number(process.env.MAX_AUTO_WITHDRAW ?? 0) // 0 = no cap; above this stays manual
let sendingWithdrawals = false
let lastHotError = null // last withdrawal-send problem, surfaced on /status for diagnostics

async function processWithdrawals() {
  if (!senderReady() || !dbEnabled || sendingWithdrawals) return
  sendingWithdrawals = true
  try {
    const list = await listApprovedWithdrawals()
    for (const w of list) {
      const payout = Number(w.meta?.payout ?? 0)
      const address = w.meta?.address
      if (!(payout > 0) || !address) continue // malformed → leave for manual review
      if (MAX_AUTO_WITHDRAW > 0 && payout > MAX_AUTO_WITHDRAW) continue // big payout → manual
      let bal
      try {
        bal = await hotBalance()
      } catch (e) {
        lastHotError = `hotBalance: ${e.message}`
        break
      }
      if (bal < payout + 0.05) {
        lastHotError = `low balance ${bal} < ${payout + 0.05}`
        console.warn(`[hot] balance ${bal} < payout ${payout} — top up the hot wallet`)
        break // queue the rest until topped up
      }
      // lock this row so it can't be picked twice; a crash mid-send leaves it
      // 'sending' for MANUAL review (never auto-retried → no double-send)
      if (!(await setWithdrawalStatus(w.id, 'approved', 'sending'))) continue
      try {
        await sendTon(address, payout, 'GameHub')
        await setWithdrawalStatus(w.id, 'sending', 'sent')
        const sid = tgSocket.get(w.tgId)
        if (sid) {
          io.to(sid).emit('gram:withdraw:sent', { amount: payout })
          io.to(sid).emit('gram:history')
        }
        lastHotError = null // success clears the last error
        console.log(`[hot] sent ${payout} GRAM → ${address} (wd ${w.id})`)
      } catch (e) {
        lastHotError = `send wd ${w.id}: ${e.message}`
        console.error(`[hot] send failed (wd ${w.id}):`, e.message)
        await setWithdrawalStatus(w.id, 'sending', 'approved') // pre-broadcast fail → retry next cycle
      }
    }
  } catch (e) {
    console.error('[hot] processWithdrawals:', e.message)
  } finally {
    sendingWithdrawals = false
  }
}
initSender().then((s) => {
  if (s) {
    setInterval(processWithdrawals, 20000)
    console.log('[hot] withdrawal sender on')
  }
})

function emitToRoom(room, event, payload) {
  for (const p of room.players) {
    const sid = sidOf(p.userId)
    if (sid) io.to(sid).emit(event, payload)
  }
}

// ── Durak N-players (online) helpers ──
const seatOf = (room, userId) => room.seatUser.indexOf(userId)

/** Names/vip/bot per seat, for the client to render opponents. */
function durakNSeatInfo(room) {
  return room.seatUser.map((uid, seat) => {
    if (!uid) {
      // fill-in bot, disguised as an ordinary player (stable identity per seat)
      const b = room.botSeats?.[seat]
      return { name: b?.name ?? 'Игрок', vip: false, bot: false, photoUrl: b?.photoUrl ?? null, offline: false }
    }
    const u = users.get(uid)
    return {
      name: u?.name ?? 'Игрок',
      vip: !!u?.vip,
      bot: false,
      photoUrl: u?.photoUrl ?? null,
      offline: !u?.socketId, // dropped connection (paused, within reconnect grace)
    }
  })
}

function durakNBroadcast(room) {
  const info = durakNSeatInfo(room)
  for (let seat = 0; seat < room.durakN.n; seat++) {
    const uid = room.seatUser[seat]
    const sid = uid && sidOf(uid)
    if (sid)
      io.to(sid).emit('durakn:state', {
        durakn: durakN.viewForN(room.durakN, seat),
        deadline: room.deadline,
        seats: info,
      })
  }
}

/** After any durakN state change: broadcast, end on result, else reset clock + run bots. */
function durakNAfter(room) {
  if (room.over) return
  durakNBroadcast(room)
  if (room.durakN.result) {
    durakNFinish(room)
    return
  }
  room.deadline = Date.now() + room.moveMs
  scheduleDurakNBot(room)
}

/** If the seat to move is a bot, play its move after a short delay. */
function scheduleDurakNBot(room) {
  clearTimeout(room.botTimer)
  const turn = room.durakN.turn
  if (room.durakN.result || room.seatUser[turn]) return // human's turn (or over)
  room.botTimer = setTimeout(() => {
    if (room.over || room.durakN.result) return
    const t = room.durakN.turn
    if (room.seatUser[t]) return // became a human's turn
    const next = durakN.botStep(room.durakN, t)
    if (next !== room.durakN) {
      room.durakN = next
      durakNAfter(room)
    }
  }, 700)
}

/** After a round: reset the room to an open lobby so the same players can replay. */
function revertDurakNRoom(room) {
  room.finishing = false
  const cfg = {
    players: room.seats,
    deck: room.minutes || 36,
    neighborsOnly: room.durakN.neighborsOnly,
    transfer: room.durakN.transfer,
    allowDraw: room.durakN.allowDraw,
  }
  const survivors = room.players.filter((p) => sidOf(p.userId)) // still connected
  if (survivors.length > 0) {
    room.players = survivors
    room.started = false
    room.seatUser = []
    room.durakN = durakN.createGameN(cfg)
    room.deadline = 0
    setTimeout(() => {
      if (rooms.get(room.id) === room && !room.started && !room.over) {
        emitLobbyState(room)
        broadcastLobbies()
      }
    }, 2500) // brief pause so players see the result, then back to the lobby
  } else {
    room.over = true
  }
}

function durakNFinish(room) {
  if (room.over || room.finishing) return
  room.finishing = true
  clearInterval(room.timer)
  clearTimeout(room.botTimer)
  const loser = room.durakN.result?.loser // seat | null
  const n = room.durakN.n
  const seatUser = [...room.seatUser]
  const finishOrder = [...(room.durakN.finishOrder || [])] // escape order (for stake placement)

  const finalize = async (deltas) => {
    // ── GRAM stakes payout by placement (loser forfeits, 60/30/10 by finish order) ──
    let gram = new Map()
    if (room.stake > 0 && dbEnabled) {
      const tgAt = (seat) => userTg.get(seatUser[seat])
      const order = finishOrder.map(tgAt).filter((x) => x != null)
      const loserTg = loser != null ? tgAt(loser) : null
      gram = await settleRoomStakes(room, loser == null ? { draw: true } : { order, loser: loserTg })
    }
    const canRematch = tableHumans(room).length >= 2
    for (let seat = 0; seat < n; seat++) {
      const uid = seatUser[seat]
      const sid = uid && sidOf(uid)
      if (sid)
        io.to(sid).emit('game:over', {
          youWon: loser == null ? null : loser !== seat,
          draw: loser == null,
          reason: 'durak',
          eloDelta: deltas[seat] ?? 0,
          gram: gram.get(userTg.get(uid)) ?? 0,
          rematch: canRematch,
          stake: room.stake || 0,
        })
    }
    room.finishing = false
    if (!canRematch || !offerRematch(room)) revertDurakNRoom(room) // solo human → back to lobby as before
  }

  // ── rating: only when the дурак is a HUMAN with ≥1 human winner (no bot-farming).
  //    Loser drops once; each winner gains vs the loser — using their real durak Elo. ──
  const humans = []
  for (let seat = 0; seat < n; seat++) {
    const uid = seatUser[seat]
    if (uid) humans.push({ seat, uid, tgId: userTg.get(uid) })
  }
  const winners = humans.filter((h) => h.seat !== loser)
  const loserH = loser != null ? humans.find((h) => h.seat === loser) : null

  if (!loserH || winners.length === 0) {
    finalize({}) // draw, or a bot is the дурак → unrated
    return
  }

  const calcDeltas = (eloOf) => {
    const deltas = {}
    let loss = 0
    for (const w of winners) {
      deltas[w.seat] = eloDelta(eloOf[w.seat], eloOf[loserH.seat], true)
      loss += eloDelta(eloOf[loserH.seat], eloOf[w.seat], false)
    }
    deltas[loserH.seat] = Math.round(loss / winners.length)
    return deltas
  }

  if (!dbEnabled) {
    const eloOf = {}
    for (const h of humans) eloOf[h.seat] = users.get(h.uid)?.elo ?? 1200
    finalize(calcDeltas(eloOf))
    return
  }

  // load each human's real durak Elo from the DB, then rate + persist + emit
  ;(async () => {
    let deltas = {}
    try {
      const eloOf = {}
      await Promise.all(
        humans.map(async (h) => {
          let e = users.get(h.uid)?.elo ?? 1200
          if (h.tgId) {
            try {
              const row = await getUser(h.tgId)
              if (row && typeof row.elo_durak === 'number') e = row.elo_durak
            } catch {
              /* keep fallback */
            }
          }
          eloOf[h.seat] = e
        }),
      )
      deltas = calcDeltas(eloOf)
      for (const w of winners) if (w.tgId) await applyElo({ tgId: w.tgId, game: 'durak', delta: deltas[w.seat], won: true })
      if (loserH.tgId) await applyElo({ tgId: loserH.tgId, game: 'durak', delta: deltas[loserH.seat], won: false })
    } catch (e) {
      console.error('[durakN] rating failed:', e.message)
    }
    finalize(deltas) // always emit game:over + revert the room
    for (const h of humans) {
      const sid = sidOf(h.uid)
      if (!h.tgId || !sid) continue
      try {
        const row = await getUser(h.tgId)
        if (row) io.to(sid).emit('profile', dbProfile(row))
      } catch {
        /* ignore */
      }
    }
  })()
}

// ── Durak (online) helpers ──
const durakSeat = (room, userId) => (room.players[0]?.userId === userId ? 'you' : 'opp')

function durakBroadcast(room) {
  for (const p of room.players) {
    const sid = sidOf(p.userId)
    if (sid)
      io.to(sid).emit('durak:state', {
        durak: durak.viewFor(room.durak, durakSeat(room, p.userId)),
        deadline: room.deadline,
      })
  }
}

/** Apply a committed Durak state: reset clock, broadcast views, end on result. */
function durakCommit(room, next) {
  if (!next || next === room.durak) return
  room.durak = next
  room.deadline = Date.now() + room.moveMs
  durakBroadcast(room)
  if (room.durak.result) durakFinish(room)
  else scheduleDurakBot(room) // if the opponent is the fill-in bot, let it act next
}

function durakFinish(room) {
  const loserSeat = room.durak.result?.loser
  if (loserSeat == null) return endGame(room, null, 'draw')
  const loserId = loserSeat === 'you' ? room.players[0]?.userId : room.players[1]?.userId
  const winner = room.players.find((p) => p.userId !== loserId)
  endGame(room, winner ? winner.color : null, 'durak')
}

const ABORT_WINDOW_MS = 10000

/** Abort a staked game that couldn't collect every stake: stakes already taken were
 *  refunded in escrowStakes; here we just tell the seated players and drop the room. */
function cancelStakedRoom(room) {
  clearInterval(room.timer)
  for (const p of room.players) {
    const sid = sidOf(p.userId)
    if (sid) io.to(sid).emit('stake:error', { reason: 'balance' })
  }
  rooms.delete(room.id)
  broadcastLobbies() // drop it from any open lobby lists
}

// ── Rematch: after a durak game ends, keep the table so players can ready up for a
//    fresh deal (same people, same stake) without rebuilding a lobby. Each rematch is
//    a NEW room, so the proven escrow/settle/refund logic is reused untouched. ──
const REMATCH_MS = 30000

/** Connected human players at this table (for rematch eligibility). */
function tableHumans(room) {
  return room.players.filter((p) => p.tgId && sidOf(p.userId)).map((p) => p.userId)
}

/** Open the ready-up window on a finished durak room. Returns true if offered. */
function offerRematch(room) {
  const humans = tableHumans(room)
  if (humans.length < 2) return false // need at least two humans to rematch
  room.rematchOpen = true
  room.rematchReady = new Set()
  room.rematchHumans = humans
  room.rematchTimer = setTimeout(() => cancelRematch(room), REMATCH_MS)
  return true
}

function broadcastRematch(room) {
  for (const uid of room.rematchHumans || []) {
    const sid = sidOf(uid)
    if (sid) io.to(sid).emit('rematch:status', { ready: room.rematchReady.size, total: room.rematchHumans.length })
  }
}

/** Dissolve a rematch window (timeout / someone left): tell the table and drop the room. */
function cancelRematch(room) {
  if (!room.rematchOpen) return
  room.rematchOpen = false
  clearTimeout(room.rematchTimer)
  for (const uid of room.rematchHumans || []) {
    const sid = sidOf(uid)
    if (sid) io.to(sid).emit('rematch:cancelled')
  }
  rooms.delete(room.id)
}

/** All ready → spin up a fresh room with the same config + players and deal. */
async function startRematch(room) {
  room.rematchOpen = false
  clearTimeout(room.rematchTimer)
  const humanIds = room.rematchHumans.filter((uid) => sidOf(uid))
  let newId
  if (room.game === 'durakn') {
    newId = createRoom('durakn', room.minutes, {
      players: room.seats,
      neighborsOnly: room.durakN.neighborsOnly,
      transfer: room.durakN.transfer,
      allowDraw: room.durakN.allowDraw,
      stake: room.stake,
    })
  } else {
    newId = createRoom('durak', room.minutes, { transfer: room.transfer, stake: room.stake })
  }
  const next = rooms.get(newId)
  for (const uid of humanIds) addPlayer(next, uid)
  rooms.delete(room.id) // retire the old table
  await startRoom(next) // escrows stakes (double-spend-safe) + deals + match:found
}

/** A player pressed «Готов» for a rematch. */
async function readyRematch(userId) {
  const room = [...rooms.values()].find((r) => r.rematchOpen && r.rematchHumans?.includes(userId))
  if (!room) return
  const sid = sidOf(userId)
  if (room.stake > 0) {
    const tg = userTg.get(userId)
    const bal = tg && dbEnabled ? await getBalance(tg) : 0
    if (bal < room.stake) {
      if (sid) io.to(sid).emit('rematch:cantAfford')
      return
    }
  }
  room.rematchReady.add(userId)
  broadcastRematch(room)
  const connected = room.rematchHumans.filter((uid) => sidOf(uid))
  if (room.stake > 0) {
    // staked: every original human must be present AND ready (no bots can cover a stake)
    if (connected.length === room.rematchHumans.length && room.rematchHumans.every((uid) => room.rematchReady.has(uid)))
      await startRematch(room)
  } else {
    // free: the still-connected humans ready up; empty seats refill with bots
    if (connected.length >= 2 && connected.every((uid) => room.rematchReady.has(uid))) await startRematch(room)
  }
}

async function startRoom(room) {
  if (room.started || room.starting) return
  room.starting = true // sync guard: no double-start across the escrow await
  const ok = await escrowStakes(room) // atomic stake debit (no-op for free games)
  if (!ok) return cancelStakedRoom(room) // a stake couldn't be collected → abort, don't start
  if (room.game === 'durakn') {
    room.started = true
    room.startedAt = Date.now()
    // seat i = the i-th human that joined; remaining seats are bots (null)
    room.seatUser = Array.from({ length: room.durakN.n }, (_, i) => room.players[i]?.userId ?? null)
    // give each bot seat a stable disguised identity (name + avatar), near a human's Elo
    const refElo = room.players[0]?.elo ?? 1200
    room.botSeats = {}
    for (let seat = 0; seat < room.durakN.n; seat++) {
      if (!room.seatUser[seat]) room.botSeats[seat] = fakeChessOpponent(refElo)
    }
    room.deadline = Date.now() + room.moveMs
    const info = durakNSeatInfo(room)
    for (let seat = 0; seat < room.durakN.n; seat++) {
      const uid = room.seatUser[seat]
      const sid = uid && sidOf(uid)
      if (!sid) continue
      io.to(sid).emit('match:found', {
        roomId: room.id,
        game: 'durakn',
        seat,
        players: room.durakN.n,
        durakn: durakN.viewForN(room.durakN, seat),
        deadline: room.deadline,
        seats: info,
      })
    }
    scheduleDurakNBot(room) // clock handled by the shared tick loop
    return
  }
  // randomize sides for fairness (50/50 who plays white)
  if (room.players.length === 2 && Math.random() < 0.5) {
    room.players[0].color = 'b'
    room.players[1].color = 'w'
  }
  room.started = true
  room.startedAt = Date.now()
  if (room.game === 'nardy' || room.game === 'durak') room.deadline = Date.now() + room.moveMs
  else room.lastTick = Date.now()
  for (const p of room.players) {
    const opp = room.players.find((x) => x.userId !== p.userId)
    const sid = sidOf(p.userId)
    if (!sid) continue
    if (room.game === 'durak') {
      io.to(sid).emit('match:found', {
        roomId: room.id,
        game: 'durak',
        seat: durakSeat(room, p.userId),
        minutes: room.minutes,
        elo: p.elo,
        opponent: { name: opp.name, elo: opp.elo, vip: opp.vip, photoUrl: opp.photoUrl ?? null },
        durak: durak.viewFor(room.durak, durakSeat(room, p.userId)),
        deadline: room.deadline,
      })
    } else if (room.game === 'nardy') {
      io.to(sid).emit('match:found', {
        roomId: room.id,
        game: 'nardy',
        color: p.color,
        minutes: room.minutes,
        elo: p.elo,
        opponent: { name: opp.name, elo: opp.elo, vip: opp.vip, photoUrl: opp.photoUrl ?? null },
        nardy: room.nardy,
        deadline: room.deadline,
      })
    } else {
      io.to(sid).emit('match:found', {
        roomId: room.id,
        color: p.color,
        minutes: room.minutes,
        opponent: { name: opp.name, elo: opp.elo, vip: opp.vip, photoUrl: opp.photoUrl ?? null },
        fen: room.chess.fen(),
        clocks: room.clocks,
      })
    }
  }
  scheduleChessBot(room) // fill-in bot opens if it drew White (no-op otherwise)
  scheduleDurakBot(room) // durak fill-in bot opens if it's the attacker (no-op otherwise)
  scheduleNardyBot(room) // nardy fill-in bot opens if it moves first (no-op otherwise)
  // clock handled by the shared tick loop
}

function tick(room) {
  if (room.over || !room.started) return
  if (room.game === 'nardy') {
    // per-turn clock: whoever is to move loses when it runs out
    if (room.deadline && Date.now() >= room.deadline) {
      endGame(room, nardyOther(room.nardy.turn), 'time')
    }
    return
  }
  if (room.game === 'durak') {
    if (room.deadline && Date.now() >= room.deadline) {
      durakCommit(room, durak.resign(room.durak, room.durak.turn)) // player to act loses
    }
    return
  }
  if (room.game === 'durakn') {
    if (room.deadline && Date.now() >= room.deadline && !room.durakN.result) {
      const turn = room.durakN.turn
      const uid = room.seatUser[turn]
      if (!uid || !sidOf(uid)) {
        // bot's turn, or the player to move is offline → pause the clock (they keep
        // the reconnect grace to return; the abandon timer resigns them if they don't)
        room.deadline = Date.now() + room.moveMs
      } else {
        room.durakN = durakN.resign(room.durakN, turn) // present but timed out → out
        durakNAfter(room)
      }
    }
    return
  }
  const now = Date.now()
  if (!room.lastTick) {
    room.lastTick = now // first tick after start → establish the baseline, no drain
    return
  }
  const dt = now - room.lastTick
  room.lastTick = now
  const t = room.chess.turn()
  room.clocks[t] = Math.max(0, room.clocks[t] - dt)
  if (room.clocks[t] === 0) endGame(room, t === 'w' ? 'b' : 'w', 'time')
}

// One shared clock loop for every active room, instead of a setInterval per game.
// tick() itself skips rooms that aren't running, so this scales to many tables
// with a single timer. (250ms keeps time-outs snappy; clocks display client-side.)
setInterval(() => {
  for (const room of rooms.values()) tick(room)
}, 250)

// ── GRAM stakes: escrow at start, settle at end (human-vs-human only) ──
/** Does this player (human) have enough GRAM to cover a stake? */
async function canAffordStake(userId, stake) {
  const tgId = userTg.get(userId)
  if (!tgId || !dbEnabled) return false
  return (await getBalance(tgId)) >= stake
}

/** Atomically debit each human's stake into escrow when a staked game begins.
 *  Every debit is guarded (can't go negative / double-spend). If ANY player can't
 *  cover it — e.g. they committed the same GRAM to two games at once — refund
 *  everyone already debited and cancel: returns false so the game does NOT start
 *  with a phantom (never-collected) stake. Returns true when the game may proceed. */
async function escrowStakes(room) {
  if (!(room.stake > 0) || !dbEnabled) return true
  if (room.escrowed) return true
  room.escrowed = true
  const humans = room.players.filter((p) => p.tgId)
  const debited = []
  for (const p of humans) {
    const res = await debitIfAffordable({
      tgId: p.tgId,
      amount: room.stake,
      kind: 'stake',
      ref: `stake:${room.id}:${p.tgId}`,
    })
    if (res === 'ok' || res === 'dup') debited.push(p)
    else {
      // couldn't collect this stake → roll back everyone we already debited, abort.
      // Refund under the `stalerefund:` namespace so the restart refunder (which sees
      // these orphaned stake rows have no `settled` marker) won't refund them a 2nd time.
      for (const q of debited) {
        await adjustGram({
          tgId: q.tgId,
          delta: room.stake,
          kind: 'refund',
          ref: `stalerefund:stake:${room.id}:${q.tgId}`,
        })
      }
      return false
    }
  }
  return true
}

/**
 * Pay out a finished staked game. `order` = non-loser tgIds best→worst; `loser` = losing tgId
 * (null / draw=true → refund everyone). Returns Map(tgId → net GRAM delta) for the result screen.
 * Idempotent per game (per-tgId refs + room.settled guard).
 */
async function settleRoomStakes(room, { order = [], loser = null, draw = false }) {
  const deltas = new Map()
  if (!(room.stake > 0) || !dbEnabled || room.settled) return deltas
  const humans = room.players.filter((p) => p.tgId)
  const n = humans.length
  if (n < 2) return deltas
  room.settled = true
  const seatOf = new Map(humans.map((p, i) => [p.tgId, i]))
  let loserSeat = null
  let finishOrder = []
  if (!draw && loser != null && seatOf.has(loser)) {
    loserSeat = seatOf.get(loser)
    finishOrder = order.map((tg) => seatOf.get(tg)).filter((x) => x != null)
  }
  const { payouts, fee } = settleStakes({ n, stake: room.stake, loserSeat, finishOrder, feeRate: STAKE_FEE_RATE })
  for (const p of humans) {
    const pay = payouts[seatOf.get(p.tgId)] ?? 0
    if (pay > 0)
      await adjustGram({ tgId: p.tgId, delta: pay, kind: draw ? 'refund' : 'win', ref: `payout:${room.id}:${p.tgId}` })
    deltas.set(p.tgId, Math.round((pay - room.stake) * 100) / 100) // net change for display
  }
  if (fee > 0) await adjustGram({ tgId: 0, delta: fee, kind: 'fee', ref: `fee:${room.id}` })
  await adjustGram({ tgId: 0, delta: 0, kind: 'settled', ref: `settled:${room.id}` }) // marks the game rated → escrow not orphaned
  for (const p of humans) {
    const sid = sidOf(p.userId)
    if (!sid) continue
    try {
      const row = await getUser(p.tgId)
      if (row) io.to(sid).emit('profile', dbProfile(row))
    } catch {
      /* ignore */
    }
  }
  return deltas
}

function endGame(room, winnerColor, reason) {
  if (room.over) return
  room.over = true
  clearInterval(room.timer)
  const [a, b] = room.players
  let da = 0
  let db = 0
  if (winnerColor && a && b) {
    const winner = a.color === winnerColor ? a : b
    const loser = a.color === winnerColor ? b : a
    // "Марс" (gammon): win by bearing off while the loser has borne off none → ×2 rating
    room.mars = room.game === 'nardy' && reason === 'win' && room.nardy?.off?.[loser.color] === 0
    const mult = room.mars ? 2 : 1
    const dWin = eloDelta(winner.elo, loser.elo, true) * mult
    const dLoss = eloDelta(loser.elo, winner.elo, false) * mult
    if (winner === a) [da, db] = [dWin, dLoss]
    else [da, db] = [dLoss, dWin]
    // persist the rated result, then push fresh profiles so the app updates now
    if (dbEnabled) {
      ;(async () => {
        await recordResult({
          game: room.game,
          winner: winner.tgId ?? null,
          loser: loser.tgId ?? null,
          winnerDelta: winner === a ? da : db,
          loserDelta: loser === a ? da : db,
          reason,
          stake: room.stake ?? 0,
        })
        for (const pl of room.players) {
          if (!pl.tgId) continue
          try {
            const row = await getUser(pl.tgId)
            const sid = sidOf(pl.userId)
            if (row && sid) io.to(sid).emit('profile', dbProfile(row))
          } catch {
            /* ignore */
          }
        }
      })()
    }
  }
  const canRematch = room.game === 'durak' && tableHumans(room).length >= 2
  const emitOver = (gram) => {
    for (const p of room.players) {
      const sid = sidOf(p.userId)
      if (!sid) continue
      io.to(sid).emit('game:over', {
        winner: winnerColor,
        reason,
        youWon: winnerColor ? p.color === winnerColor : null,
        eloDelta: p === a ? da : db,
        mars: !!room.mars,
        gram: gram?.get(p.tgId) ?? 0,
        clocks: room.clocks,
        rematch: canRematch,
        stake: room.stake || 0,
      })
    }
    if (canRematch) offerRematch(room) // keep the table alive for a ready-up rematch
  }
  // ── GRAM stakes payout (1v1 human games): winner takes 1.9×, draw/abort refunds ──
  if (room.stake > 0 && a && b && dbEnabled) {
    const winner = winnerColor ? (a.color === winnerColor ? a : b) : null
    const loser = winner ? (winner === a ? b : a) : null
    settleRoomStakes(
      room,
      winner ? { order: [winner.tgId], loser: loser.tgId } : { draw: true },
    ).then(emitOver)
  } else {
    emitOver(null)
  }
}

/** Push the pending-withdrawals list to the owner if they're online. */
async function notifyOwnerWithdrawals() {
  if (OWNER_TG_ID == null || !dbEnabled) return
  const sid = tgSocket.get(OWNER_TG_ID)
  if (sid) io.to(sid).emit('gram:withdrawals', { items: await listPendingWithdrawals() })
}

// Per-event minimum spacing for sensitive actions (ms). Everything else is
// covered by the general token bucket below.
const EVENT_MIN_MS = { 'shop:buy': 1500, quickMatch: 700, 'lobby:create': 800, register: 400 }

io.on('connection', (socket) => {
  // ── anti-flood + payload guard (runs before every event handler) ──
  const rl = { tokens: 45, last: Date.now() }
  const lastAt = new Map() // event -> last time it was allowed
  socket.use(([event, payload], next) => {
    // reject malformed payloads (null/primitive would crash handlers that destructure);
    // allow undefined (events with no args) and real objects only
    if (payload !== undefined && (payload === null || typeof payload !== 'object'))
      return next(new Error('bad-payload'))
    const now = Date.now()
    rl.tokens = Math.min(45, rl.tokens + ((now - rl.last) / 1000) * 25) // refill 25/s, burst 45
    rl.last = now
    if (rl.tokens < 1) return next(new Error('rate-limited'))
    rl.tokens -= 1
    const min = EVENT_MIN_MS[event]
    if (min) {
      if (now - (lastAt.get(event) || 0) < min) return next(new Error('rate-limited'))
      lastAt.set(event, now)
    }
    next()
  })

  socket.on('register', async ({ userId, name, elo, initData, username, photoUrl, vip }) => {
    if (typeof userId !== 'string' || !userId || userId.length > 120) return // invalid identity
    name = typeof name === 'string' ? name.slice(0, 48) : 'Игрок'
    username = typeof username === 'string' ? username.slice(0, 48) : undefined
    socketUser.set(socket.id, userId)
    users.set(userId, { ...users.get(userId), socketId: socket.id, name, elo, vip: !!vip, photoUrl })

    // Resolve a trusted telegram id: verify initData if we have a bot token,
    // otherwise fall back to the id embedded in the composite userId.
    const verified = verifyInitData(initData, process.env.BOT_TOKEN)
    let tgId = null
    if (verified?.id) tgId = Number(verified.id)
    else {
      const parsed = Number(String(userId).split('_')[0])
      if (Number.isFinite(parsed) && parsed > 0) tgId = parsed
    }
    userTg.set(userId, tgId)

    // Presence: mark this telegram id online, remember its profile, and refresh
    // friend lists (mine + notify my online friends that I'm now online).
    if (tgId) {
      tgSocket.set(tgId, socket.id)
      tgInfo.set(tgId, { name, username, photoUrl, elos: tgInfo.get(tgId)?.elos })
      pushFriends(tgId).catch(() => {})
      pushRequests(tgId).catch(() => {}) // any friend requests waiting for me
      for (const f of await friendListFor(tgId)) pushFriends(f.id).catch(() => {})
      // owned skins (server = source of truth for paid items)
      getEntitlements(tgId).then((items) => socket.emit('shop:entitlements', { items })).catch(() => {})
      if (isOwner(tgId)) socket.emit('owner:status', { owner: true }) // unlock the withdrawals admin
    }

    // Reconnect: cancel any pending abandon + resume an in-progress game.
    for (const [k, t] of abandonTimers) {
      if (k.startsWith(userId + ':')) {
        clearTimeout(t)
        abandonTimers.delete(k)
      }
    }
    for (const room of rooms.values()) {
      if (room.over || !room.started) continue
      const me = room.players.find((p) => p.userId === userId)
      if (!me) continue
      const opp = room.players.find((p) => p.userId !== userId)
      if (room.game === 'durakn') {
        const seat = room.seatUser.indexOf(userId)
        if (seat < 0) continue
        // returning on your own turn → give a fresh move clock
        if (room.durakN.turn === seat && !room.durakN.result)
          room.deadline = Date.now() + room.moveMs
        const info = durakNSeatInfo(room)
        socket.emit('match:found', {
          roomId: room.id,
          game: 'durakn',
          seat,
          players: room.durakN.n,
          durakn: durakN.viewForN(room.durakN, seat),
          deadline: room.deadline,
          seats: info,
        })
        durakNBroadcast(room) // resync everyone (fresh clock + presence)
      } else if (room.game === 'nardy') {
        socket.emit('match:found', {
          roomId: room.id,
          game: 'nardy',
          color: me.color,
          minutes: room.minutes,
          elo: me.elo,
          opponent: { name: opp?.name, elo: opp?.elo, vip: opp?.vip, photoUrl: opp?.photoUrl ?? null },
          nardy: room.nardy,
          deadline: room.deadline,
        })
        // also push live state so an already-mounted board resyncs
        socket.emit('nardy:state', { nardy: room.nardy, deadline: room.deadline })
      } else if (room.game === 'durak') {
        const seat = durakSeat(room, userId)
        socket.emit('match:found', {
          roomId: room.id,
          game: 'durak',
          seat,
          minutes: room.minutes,
          elo: me.elo,
          opponent: { name: opp?.name, elo: opp?.elo, vip: opp?.vip, photoUrl: opp?.photoUrl ?? null },
          durak: durak.viewFor(room.durak, seat),
          deadline: room.deadline,
        })
        socket.emit('durak:state', {
          durak: durak.viewFor(room.durak, seat),
          deadline: room.deadline,
        })
      } else {
        socket.emit('match:found', {
          roomId: room.id,
          color: me.color,
          minutes: room.minutes,
          opponent: { name: opp?.name, elo: opp?.elo, vip: opp?.vip, photoUrl: opp?.photoUrl ?? null },
          fen: room.chess.fen(),
          clocks: room.clocks,
        })
      }
    }

    if (tgId && dbEnabled) {
      try {
        const row = await upsertUser({
          tgId,
          username: verified?.username ?? username,
          name: verified
            ? [verified.first_name, verified.last_name].filter(Boolean).join(' ')
            : name,
          photoUrl: verified?.photo_url ?? photoUrl,
        })
        if (row) {
          let r = row
          // migrate a locally-bought VIP into the DB the first time we see it
          if (vip && !r.vip) {
            const u = await setUserVip(tgId, true)
            if (u) r = u
          }
          const elos = { chess: r.elo_chess, durak: r.elo_durak, nardy: r.elo_nardy }
          users.set(userId, { ...users.get(userId), name: r.name ?? name, elos, vip: !!r.vip })
          tgInfo.set(tgId, {
            name: r.name ?? name,
            username: r.username ?? username,
            photoUrl: r.photo_url ?? photoUrl,
            elos,
          })
          socket.emit('profile', dbProfile(r))
        }
      } catch (e) {
        console.error('[db] upsert failed:', e.message)
      }
    }
  })

  // Client can request its persisted profile at any time.
  socket.on('getProfile', async (_p, cb) => {
    const tgId = userTg.get(socketUser.get(socket.id))
    if (!tgId || !dbEnabled) return cb?.(null)
    try {
      const row = await getUser(tgId)
      cb?.(row ? dbProfile(row) : null)
    } catch {
      cb?.(null)
    }
  })

  socket.on('quickMatch', async ({ game, minutes, transfer, players, neighborsOnly, allowDraw, stake }) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
    // GRAM stake: validate amount + the player can cover it (human, enough balance)
    const st = stake > 0 ? Math.round(stake * 100) / 100 : 0
    if (st > 0) {
      if (st < MIN_STAKE) return socket.emit('stake:error', { reason: 'min' })
      const tgId = userTg.get(userId)
      const bal = tgId && dbEnabled ? await getBalance(tgId) : 0
      if (!tgId || bal < st) return socket.emit('stake:error', { reason: 'balance', balance: bal })
    }
    if (game === 'durakn') {
      return quickMatchDurakN(userId, socket, {
        players: Math.max(2, Math.min(6, players ?? 3)),
        deck: minutes || 36,
        transfer: !!transfer,
        neighborsOnly: !!neighborsOnly,
        allowDraw: allowDraw ?? true,
        stake: st,
      })
    }
    // same-config AND same-stake players match together
    const key =
      (game === 'durak' ? `durak:${minutes}:${transfer ? 't' : 'c'}` : qkey(game, minutes)) +
      (st > 0 ? `:s${st}` : '')
    const q = (queues.get(key) ?? []).filter((id) => id !== userId)
    if (q.length > 0) {
      const oppId = q.shift()
      queues.set(key, q)
      clearBotFallback(oppId) // a real human showed up → cancel the pending fill-in bot
      const room = rooms.get(createRoom(game, minutes, { transfer, stake: st }))
      addPlayer(room, oppId)
      addPlayer(room, userId)
      startRoom(room)
    } else {
      q.push(userId)
      queues.set(key, q)
      socket.emit('queue:waiting')
      // FREE games only: if no human joins within 20s, seed a disguised fill-in bot.
      if (st === 0 && (game === 'chess' || game === 'durak' || game === 'nardy')) {
        clearBotFallback(userId)
        const seed =
          game === 'chess'
            ? () => seedChessBot(userId, minutes)
            : game === 'durak'
              ? () => seedDurakBot(userId, minutes, !!transfer)
              : () => seedNardyBot(userId, minutes)
        botFallbackTimers.set(userId, setTimeout(seed, BOT_FALLBACK_MS))
      }
    }
  })

  socket.on('cancelQuick', () => {
    const userId = socketUser.get(socket.id)
    clearBotFallback(userId)
    for (const [k, q] of queues) queues.set(k, q.filter((id) => id !== userId))
    leaveNQueues(userId)
  })

  socket.on('createRoom', ({ game, minutes, transfer }, cb) => {
    const roomId = createRoom(game, minutes, { transfer })
    addPlayer(rooms.get(roomId), socketUser.get(socket.id))
    cb?.(roomId)
  })

  socket.on('joinRoom', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) return socket.emit('room:notfound')
    const userId = socketUser.get(socket.id)
    if (room.game === 'durakn') {
      // durakn rooms are open lobbies (invite link / open-games list)
      if (room.started || room.over) return socket.emit('room:notfound')
      leaveLobby(userId)
      if (joinDurakNLobby(room, userId) === 'gone') socket.emit('lobby:gone', { roomId })
      return
    }
    addPlayer(room, userId)
    if (room.players.length === 2) startRoom(room)
  })

  // ── Open lobbies («Открытые игры») ──
  socket.on('lobby:subscribe', () => {
    lobbyWatchers.add(socket.id)
    socket.emit('lobby:list', lobbySummary())
  })
  socket.on('lobby:unsubscribe', () => lobbyWatchers.delete(socket.id))

  socket.on('lobby:create', async (opts, cb) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
    const st = opts?.stake > 0 ? Math.round(opts.stake * 100) / 100 : 0
    if (st > 0 && !(await canAffordStake(userId, st))) return socket.emit('stake:error', { reason: 'balance' })
    leaveLobby(userId) // one open lobby per player
    const roomId = createRoom('durakn', opts?.deck || 36, {
      players: Math.max(2, Math.min(6, opts?.players ?? 3)),
      transfer: !!opts?.transfer,
      neighborsOnly: !!opts?.neighborsOnly,
      allowDraw: opts?.allowDraw ?? true,
      stake: st,
    })
    addPlayer(rooms.get(roomId), userId)
    cb?.(roomId)
    emitLobbyState(rooms.get(roomId))
    broadcastLobbies()
  })

  socket.on('lobby:join', async ({ roomId }) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
    const room = rooms.get(roomId)
    if (room?.stake > 0 && !(await canAffordStake(userId, room.stake)))
      return socket.emit('stake:error', { reason: 'balance' })
    leaveLobby(userId)
    if (joinDurakNLobby(room, userId) === 'gone') socket.emit('lobby:gone', { roomId })
  })

  socket.on('lobby:start', ({ roomId }) => {
    const userId = socketUser.get(socket.id)
    const room = rooms.get(roomId)
    if (!room || room.game !== 'durakn' || room.started || room.over) return
    if (room.players[0]?.userId !== userId) return // host only
    // staked lobbies are human-only (bots can't stake) — can't fill with bots
    if (room.stake > 0 && room.players.length < room.seats)
      return socket.emit('stake:error', { reason: 'need-humans' })
    startRoom(room) // free games: remaining empty seats become bots
    broadcastLobbies()
  })

  socket.on('lobby:leave', () => leaveLobby(socketUser.get(socket.id)))

  // Invite an ONLINE friend straight into this open lobby (by their telegram id).
  socket.on('lobby:invite', ({ roomId, toTg }) => {
    const fromId = socketUser.get(socket.id)
    const room = rooms.get(roomId)
    if (!room || room.game !== 'durakn' || room.started || room.over) return
    if (!room.players.some((p) => p.userId === fromId)) return // must be in the lobby
    const targetSid = tgSocket.get(Number(toTg))
    if (!targetSid) return socket.emit('lobby:inviteResult', { toTg, ok: false })
    const from = users.get(fromId)
    io.to(targetSid).emit('invite:incoming', {
      roomId,
      from: { name: from?.name },
      game: 'durak', // shown as Дурак (deck-based); joinRoom uses the room's real game
      minutes: room.minutes || 36,
    })
    socket.emit('lobby:inviteResult', { toTg, ok: true })
  })

  // Invite a friend (by their telegram id) into a private room for a game.
  socket.on('invite', ({ toTg, game, minutes, transfer }) => {
    const fromId = socketUser.get(socket.id)
    const targetSid = tgSocket.get(Number(toTg))
    if (!targetSid) {
      socket.emit('invite:offline') // friend isn't online right now
      return
    }
    const roomId = createRoom(game, minutes, { transfer })
    addPlayer(rooms.get(roomId), fromId)
    const from = users.get(fromId)
    io.to(targetSid).emit('invite:incoming', {
      roomId,
      from: { name: from?.name },
      game,
      minutes,
    })
    socket.emit('invite:sent', { roomId })
  })

  // ── friends ──
  /** Send a friend request. Target is `code` (a Telegram id, e.g. from an invite link)
   *  or `username` (@handle typed by the user). Recipient must accept before it counts. */
  socket.on('friend:request', async ({ code, username }) => {
    const myTg = userTg.get(socketUser.get(socket.id))
    if (!myTg) return
    let targetTg = code != null ? Number(code) : null
    if (!targetTg && username) {
      const u = await userByUsername(username)
      if (!u) return socket.emit('friend:request:result', { ok: false, reason: 'notfound' })
      targetTg = Number(u.tg_id)
    }
    if (!targetTg) return socket.emit('friend:request:result', { ok: false, reason: 'notfound' })
    if (targetTg === myTg) return socket.emit('friend:request:result', { ok: false, reason: 'self' })
    const status = await createFriendRequest(myTg, targetTg)
    if (status === 'accepted') {
      // they had already requested me → we're friends now
      pushFriends(myTg).catch(() => {})
      pushFriends(targetTg).catch(() => {})
      pushRequests(myTg).catch(() => {})
    } else if (status === 'sent') {
      pushRequests(targetTg).catch(() => {}) // let them see it live
    }
    socket.emit('friend:request:result', { ok: status !== 'self', reason: status })
  })

  socket.on('friend:requests', async () => {
    const myTg = userTg.get(socketUser.get(socket.id))
    socket.emit('friend:requests', await requestListFor(myTg))
  })

  socket.on('friend:accept', async ({ code }) => {
    const myTg = userTg.get(socketUser.get(socket.id))
    const fromTg = Number(code)
    if (!myTg || !fromTg) return
    const ok = await acceptFriendRequest(myTg, fromTg)
    if (ok) {
      pushFriends(myTg).catch(() => {})
      pushFriends(fromTg).catch(() => {})
    }
    pushRequests(myTg).catch(() => {})
  })

  socket.on('friend:decline', async ({ code }) => {
    const myTg = userTg.get(socketUser.get(socket.id))
    const fromTg = Number(code)
    if (!myTg || !fromTg) return
    await declineFriendRequest(myTg, fromTg)
    pushRequests(myTg).catch(() => {})
  })

  // Legacy invite-link handler: now sends a request instead of an instant mutual add.
  socket.on('friend:add', async ({ code }) => {
    const myTg = userTg.get(socketUser.get(socket.id))
    const targetTg = Number(code)
    if (!myTg || !targetTg || myTg === targetTg) return
    const status = await createFriendRequest(myTg, targetTg)
    if (status === 'accepted') {
      pushFriends(myTg).catch(() => {})
      pushFriends(targetTg).catch(() => {})
      pushRequests(myTg).catch(() => {})
    } else if (status === 'sent') {
      pushRequests(targetTg).catch(() => {})
    }
    socket.emit('friend:request:result', { ok: status !== 'self', reason: status })
  })

  socket.on('friend:list', async () => {
    const myTg = userTg.get(socketUser.get(socket.id))
    socket.emit('friends', await friendListFor(myTg))
  })

  socket.on('friend:remove', async ({ code }) => {
    const myTg = userTg.get(socketUser.get(socket.id))
    const friendTg = Number(code)
    if (!myTg || !friendTg) return
    await removeFriendship(myTg, friendTg)
    pushFriends(myTg).catch(() => {})
    pushFriends(friendTg).catch(() => {})
  })

  // Elo trend (sparkline) for the profile: the game with the highest current Elo.
  socket.on('elo:get', async () => {
    const userId = socketUser.get(socket.id)
    const myTg = userTg.get(userId)
    if (!myTg || !dbEnabled) return socket.emit('elo:trend', { game: null, trend: [], delta: 0 })
    const elos = users.get(userId)?.elos ?? { chess: 1200, durak: 1200, nardy: 1200 }
    const game = ['chess', 'durak', 'nardy'].reduce((b, g) => (elos[g] > elos[b] ? g : b), 'chess')
    try {
      const trend = await getEloTrend(myTg, game, 12)
      const delta = trend.length >= 2 ? trend[trend.length - 1] - trend[trend.length - 2] : 0
      socket.emit('elo:trend', { game, trend, delta })
    } catch (e) {
      console.error('[db] eloTrend failed:', e.message)
      socket.emit('elo:trend', { game: null, trend: [], delta: 0 })
    }
  })

  // Last 10 matches for the match-history screen.
  socket.on('history:get', async () => {
    const myTg = userTg.get(socketUser.get(socket.id))
    if (!myTg || !dbEnabled) return socket.emit('history', [])
    try {
      const rows = await getHistory(myTg, 10)
      socket.emit(
        'history',
        rows.map((r) => ({
          game: r.game,
          result: r.winner == null ? 'draw' : Number(r.winner) === Number(myTg) ? 'win' : 'loss',
          reason: r.reason,
          at: r.created_at,
        })),
      )
    } catch (e) {
      console.error('[db] history failed:', e.message)
      socket.emit('history', [])
    }
  })

  // VIP purchased (persist to DB so it's account-wide + visible to opponents).
  socket.on('set:vip', async () => {
    const userId = socketUser.get(socket.id)
    const myTg = userTg.get(userId)
    users.set(userId, { ...users.get(userId), vip: true })
    if (myTg && dbEnabled) {
      try {
        const row = await setUserVip(myTg, true)
        if (row) socket.emit('profile', dbProfile(row))
      } catch (e) {
        console.error('[db] setVip failed:', e.message)
      }
    }
  })

  // Change display nickname.
  socket.on('set:name', async ({ name }) => {
    const userId = socketUser.get(socket.id)
    const myTg = userTg.get(userId)
    const clean = String(name ?? '').trim().slice(0, 24)
    if (!clean) return
    users.set(userId, { ...users.get(userId), name: clean })
    if (myTg) tgInfo.set(myTg, { ...(tgInfo.get(myTg) ?? {}), name: clean })
    if (myTg && dbEnabled) {
      try {
        const row = await setUserName(myTg, clean)
        if (row) socket.emit('profile', dbProfile(row))
      } catch (e) {
        console.error('[db] setName failed:', e.message)
      }
    }
    if (myTg) {
      pushFriends(myTg).catch(() => {})
      for (const f of await friendListFor(myTg)) pushFriends(f.id).catch(() => {})
    }
  })

  socket.on('move', ({ roomId, from, to }) => {
    const room = rooms.get(roomId)
    if (!room || room.over) return
    const color = room.players.find(
      (p) => p.userId === socketUser.get(socket.id),
    )?.color
    if (color !== room.chess.turn()) return
    try {
      if (!room.chess.move({ from, to, promotion: 'q' })) return
    } catch {
      return
    }
    emitToRoom(room, 'game:state', {
      fen: room.chess.fen(),
      turn: room.chess.turn(),
      clocks: room.clocks,
      lastMove: { from, to },
    })
    if (room.chess.isGameOver()) {
      if (room.chess.isCheckmate())
        endGame(room, room.chess.turn() === 'w' ? 'b' : 'w', 'mate')
      else endGame(room, null, 'draw')
    } else {
      scheduleChessBot(room) // if the opponent is the fill-in bot, let it reply
    }
  })

  // ── Durak N-players (online) actions ──
  socket.on('durakn:action', ({ roomId, type, card, pair }) => {
    const room = rooms.get(roomId)
    if (!room || room.over || room.game !== 'durakn') return
    const seat = seatOf(room, socketUser.get(socket.id))
    if (seat < 0 || room.durakN.turn !== seat) return // only the seat whose turn it is
    let next = room.durakN
    if (type === 'attack') next = durakN.playAttack(room.durakN, seat, card)
    else if (type === 'defend') next = durakN.playDefend(room.durakN, card, pair)
    else if (type === 'transfer') next = durakN.playTransfer(room.durakN, card)
    else if (type === 'take') next = durakN.beginTake(room.durakN)
    else if (type === 'pass') next = durakN.pass(room.durakN, seat)
    if (next !== room.durakN) {
      room.durakN = next
      durakNAfter(room)
    }
  })

  // ── Nardy (online) ──
  const myColor = (room) =>
    room.players.find((p) => p.userId === socketUser.get(socket.id))?.color

  socket.on('nardy:roll', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room || room.over || room.game !== 'nardy') return
    if (myColor(room) !== room.nardy.turn || !room.nardy.awaitingRoll) return
    const before = room.nardy.turn
    room.nardy = nardyRoll(room.nardy)
    if (room.nardy.turn !== before) room.deadline = Date.now() + room.moveMs
    emitToRoom(room, 'nardy:state', { nardy: room.nardy, deadline: room.deadline })
    if (room.nardy.result) endGame(room, room.nardy.result, 'win')
    else scheduleNardyBot(room) // if the turn is now the bot's, let it play
  })

  socket.on('nardy:move', ({ roomId, from, seq }) => {
    const room = rooms.get(roomId)
    if (!room || room.over || room.game !== 'nardy') return
    const color = myColor(room)
    if (color !== room.nardy.turn || !Array.isArray(seq) || seq.length === 0) return
    // apply the dice sequence to one checker, validating each hop server-side
    let st = room.nardy
    let pos = from
    for (const d of seq) {
      const de = nardyDest(st, color, pos, d)
      const nx = nardyMove(st, pos, d)
      if (nx === st) {
        // illegal (or out of sync) → re-send authoritative state, ignore
        emitToRoom(room, 'nardy:state', { nardy: room.nardy, deadline: room.deadline })
        return
      }
      st = nx
      if (de === 'off' || de === null) break
      pos = de
    }
    const turnChanged = st.turn !== color || !!st.result
    room.nardy = st
    if (turnChanged && !st.result) room.deadline = Date.now() + room.moveMs
    emitToRoom(room, 'nardy:state', { nardy: room.nardy, deadline: room.deadline })
    if (room.nardy.result) endGame(room, room.nardy.result, 'win')
    else scheduleNardyBot(room) // if the turn passed to the bot, let it play
  })

  // ── Durak (online) actions ──
  const durakGuard = (roomId) => {
    const room = rooms.get(roomId)
    if (!room || room.over || room.game !== 'durak') return null
    if (!room.players.some((p) => p.userId === socketUser.get(socket.id))) return null
    return room
  }
  socket.on('durak:attack', ({ roomId, card }) => {
    const room = durakGuard(roomId)
    if (!room) return
    if (durakSeat(room, socketUser.get(socket.id)) !== room.durak.attacker) return
    durakCommit(room, durak.playAttack(room.durak, card))
  })
  socket.on('durak:defend', ({ roomId, card, pair }) => {
    const room = durakGuard(roomId)
    if (!room) return
    if (durakSeat(room, socketUser.get(socket.id)) !== durak.other(room.durak.attacker)) return
    durakCommit(room, durak.playDefend(room.durak, card, pair))
  })
  socket.on('durak:take', ({ roomId }) => {
    const room = durakGuard(roomId)
    if (!room) return
    if (durakSeat(room, socketUser.get(socket.id)) !== durak.other(room.durak.attacker)) return
    durakCommit(room, durak.beginTake(room.durak))
  })
  socket.on('durak:transfer', ({ roomId, card }) => {
    const room = durakGuard(roomId)
    if (!room) return
    if (durakSeat(room, socketUser.get(socket.id)) !== durak.other(room.durak.attacker)) return
    durakCommit(room, durak.playTransfer(room.durak, card))
  })
  socket.on('durak:done', ({ roomId }) => {
    const room = durakGuard(roomId)
    if (!room) return
    if (durakSeat(room, socketUser.get(socket.id)) !== room.durak.attacker) return
    if (room.durak.taking) durakCommit(room, durak.finishTake(room.durak))
    else if (durak.canPass(room.durak)) durakCommit(room, durak.endBout(room.durak))
  })

  // Rematch ready-up (durak 1v1 + N). «Готов» → ready; leaving the table cancels it.
  socket.on('durak:rematch', () => {
    const userId = socketUser.get(socket.id)
    if (userId) readyRematch(userId).catch(() => {})
  })
  socket.on('durak:leaveRematch', () => {
    const userId = socketUser.get(socket.id)
    const room = [...rooms.values()].find((r) => r.rematchOpen && r.rematchHumans?.includes(userId))
    if (room) cancelRematch(room) // one player bailed → dissolve for everyone
  })

  socket.on('chat', ({ roomId, text }) => {
    const room = rooms.get(roomId)
    if (!room || !text) return
    const me = room.players.find((p) => p.userId === socketUser.get(socket.id))
    for (const p of room.players) {
      if (p.userId === me?.userId) continue
      const sid = sidOf(p.userId)
      if (sid) io.to(sid).emit('chat:msg', { text: String(text).slice(0, 200), from: me?.name })
    }
  })

  socket.on('resign', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room || room.over) return
    if (room.game === 'durakn') {
      const seat = seatOf(room, socketUser.get(socket.id))
      if (seat >= 0 && !room.durakN.result) {
        room.durakN = durakN.resign(room.durakN, seat) // fold → that seat is out
        durakNAfter(room)
      }
      return
    }
    const color = room.players.find(
      (p) => p.userId === socketUser.get(socket.id),
    )?.color
    if (color) endGame(room, color === 'w' ? 'b' : 'w', 'resign')
  })

  // ── GRAM wallet: transaction history ──
  socket.on('gram:history', async (_payload, cb) => {
    const tgId = userTg.get(socketUser.get(socket.id))
    const items = tgId ? await getGramHistory(tgId) : []
    if (typeof cb === 'function') cb({ items })
    else socket.emit('gram:history', { items })
  })

  // ── GRAM wallet: personal deposit details (platform address + this user's tag) ──
  socket.on('gram:deposit', async (_payload, cb) => {
    const tgId = userTg.get(socketUser.get(socket.id))
    const tag = tgId ? await getOrCreateDepositTag(tgId) : null
    if (typeof cb === 'function') cb({ address: PLATFORM_TON_ADDRESS, tag })
  })

  // ── GRAM withdrawal: player creates a request (funds held); owner approves/rejects ──
  socket.on('gram:withdraw', async ({ amount, address } = {}, cb) => {
    const uid = socketUser.get(socket.id)
    const tgId = userTg.get(uid)
    if (!tgId || !dbEnabled) return cb?.({ error: 'no-user' })
    const amt = Math.round(Number(amount) * 100) / 100
    if (!(amt >= MIN_WITHDRAW)) return cb?.({ error: 'min', min: MIN_WITHDRAW })
    if (!isTonAddress(address)) return cb?.({ error: 'address' })
    const fee = withdrawFee(amt)
    const res = await createWithdrawal({ tgId, amount: amt, fee, address: String(address).trim() })
    if (res.error) return cb?.({ error: res.error, balance: res.balance })
    cb?.({ ok: true, balance: res.balance, fee, payout: Math.round((amt - fee) * 100) / 100 })
    try {
      const row = await getUser(tgId)
      if (row) socket.emit('profile', dbProfile(row))
    } catch {
      /* ignore */
    }
    socket.emit('gram:history')
    notifyOwnerWithdrawals()
  })

  socket.on('gram:withdrawals', async (_p, cb) => {
    if (!isOwner(userTg.get(socketUser.get(socket.id)))) return cb?.({ error: 'forbidden' })
    cb?.({ items: await listPendingWithdrawals() })
  })

  // ── Owner: accrued fee (HOUSE balance) + withdraw it to FEE_TON_ADDRESS ──
  socket.on('gram:fee:status', async (_p, cb) => {
    if (!isOwner(userTg.get(socketUser.get(socket.id)))) return cb?.({ error: 'forbidden' })
    cb?.({
      accrued: await getBalance(0),
      feeAddress: FEE_TON_ADDRESS,
      hot: senderReady() ? await hotBalance() : null,
      history: await getFeeHistory(),
    })
  })

  socket.on('gram:fee:withdraw', async (_p, cb) => {
    if (!isOwner(userTg.get(socketUser.get(socket.id)))) return cb?.({ error: 'forbidden' })
    if (!FEE_TON_ADDRESS) return cb?.({ error: 'no-fee-address' })
    if (!senderReady()) return cb?.({ error: 'no-hot' }) // set up the hot wallet first
    const amt = Math.round((await getBalance(0)) * 100) / 100
    if (!(amt > 0)) return cb?.({ error: 'empty' })
    if ((await hotBalance()) < amt + 0.05) return cb?.({ error: 'hot-low' })
    const ref = `feewd:${Date.now()}`
    const newHouse = await adjustGram({ tgId: 0, delta: -amt, kind: 'fee_withdraw', ref, meta: { to: FEE_TON_ADDRESS } })
    if (newHouse == null) return cb?.({ error: 'failed' })
    try {
      await sendTon(FEE_TON_ADDRESS, amt, 'GameHub fee')
      cb?.({ ok: true, sent: amt })
    } catch (e) {
      await adjustGram({ tgId: 0, delta: amt, kind: 'fee', ref: `${ref}:revert` }) // give it back on send failure
      console.error('[hot] fee send failed:', e.message)
      cb?.({ error: 'send-failed' })
    }
  })

  socket.on('gram:withdraw:approve', async ({ id } = {}, cb) => {
    if (!isOwner(userTg.get(socketUser.get(socket.id)))) return cb?.({ error: 'forbidden' })
    const w = await getWithdrawal(id)
    if (!w || w.status !== 'pending') return cb?.({ error: 'gone' })
    if (!(await setWithdrawalStatus(id, 'pending', 'approved'))) return cb?.({ error: 'gone' })
    const fee = w.meta?.fee ?? 0
    if (fee > 0) await adjustGram({ tgId: 0, delta: fee, kind: 'fee', ref: `wfee:${id}` }) // owner income
    cb?.({ ok: true })
    notifyOwnerWithdrawals()
    // NOTE: the on-chain send runs once HOT_TON_MNEMONIC is configured; until then
    // approved requests queue for payout.
  })

  socket.on('gram:withdraw:reject', async ({ id } = {}, cb) => {
    if (!isOwner(userTg.get(socketUser.get(socket.id)))) return cb?.({ error: 'forbidden' })
    const w = await getWithdrawal(id)
    if (!w || w.status !== 'pending') return cb?.({ error: 'gone' })
    if (!(await setWithdrawalStatus(id, 'pending', 'rejected'))) return cb?.({ error: 'gone' })
    await adjustGram({ tgId: w.tgId, delta: -w.amount, kind: 'refund', ref: `wref:${id}` }) // give it back
    const sid = tgSocket.get(w.tgId)
    if (sid) {
      try {
        const row = await getUser(w.tgId)
        if (row) io.to(sid).emit('profile', dbProfile(row))
      } catch {
        /* ignore */
      }
      io.to(sid).emit('gram:refunded', { amount: -w.amount })
    }
    cb?.({ ok: true })
    notifyOwnerWithdrawals()
  })

  // ── Shop: create a Telegram Stars invoice for a product ──
  socket.on('shop:buy', async ({ product }, cb) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return cb?.({ error: 'no-user' })
    if (!productInfo(product)) return cb?.({ error: 'bad-product' })
    if (!BOT_TOKEN) return cb?.({ error: 'payments-off' })
    const link = await createStarsInvoice(userId, product)
    cb?.(link ? { link } : { error: 'invoice-failed' })
  })

  socket.on('abort', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room || room.over) return
    const age = Date.now() - (room.startedAt ?? Date.now())
    if (age < ABORT_WINDOW_MS) {
      endGame(room, null, 'aborted') // free cancel, no Elo
    } else {
      const color = room.players.find(
        (p) => p.userId === socketUser.get(socket.id),
      )?.color
      if (color) endGame(room, color === 'w' ? 'b' : 'w', 'resign')
    }
  })

  socket.on('disconnect', () => {
    const userId = socketUser.get(socket.id)
    socketUser.delete(socket.id)
    lobbyWatchers.delete(socket.id)
    clearBotFallback(userId)
    for (const [k, q] of queues) queues.set(k, q.filter((id) => id !== userId))
    leaveNQueues(userId)
    leaveLobby(userId) // drop out of any open lobby (started games use the abandon timer)
    // If they were in an open rematch window, dissolve it for the table.
    const rmRoom = [...rooms.values()].find((r) => r.rematchOpen && r.rematchHumans?.includes(userId))
    if (rmRoom) cancelRematch(rmRoom)
    // Presence: go offline + tell my friends (only if THIS socket was the live one).
    const tgId = userTg.get(userId)
    if (tgId && tgSocket.get(tgId) === socket.id) {
      tgSocket.delete(tgId)
      friendListFor(tgId)
        .then((list) => list.forEach((f) => pushFriends(f.id).catch(() => {})))
        .catch(() => {})
    }
    // Mark offline but keep the mapping; mobile sockets drop when the app
    // backgrounds. Give a grace period to reconnect before abandoning games.
    if (users.get(userId)?.socketId === socket.id) {
      const u = users.get(userId)
      users.set(userId, { ...u, socketId: null })
    }
    for (const room of rooms.values()) {
      if (room.over || !room.started) continue
      if (!room.players.some((p) => p.userId === userId)) continue
      // let the others see this player as offline (their clock is now paused)
      if (room.game === 'durakn') durakNBroadcast(room)
      const key = `${userId}:${room.id}`
      if (abandonTimers.has(key)) continue
      const t = setTimeout(() => {
        abandonTimers.delete(key)
        const r = rooms.get(room.id)
        if (!r || r.over) return
        if (users.get(userId)?.socketId) return // reconnected — don't abandon
        if (r.game === 'durakn') {
          const seat = r.seatUser.indexOf(userId)
          if (seat >= 0 && !r.durakN.result) {
            r.durakN = durakN.resign(r.durakN, seat) // leaves → that seat is out
            durakNAfter(r)
          }
          return
        }
        const me = r.players.find((p) => p.userId === userId)
        if (me) endGame(r, me.color === 'w' ? 'b' : 'w', 'abandon')
      }, RECONNECT_GRACE_MS)
      abandonTimers.set(key, t)
    }
  })
})

console.log(`GameHub realtime server on :${PORT}`)
