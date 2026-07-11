import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { Chess } from 'chess.js'
import { initDb, upsertUser, getUser, recordResult, applyElo, dbEnabled, addFriendship, removeFriendship, getFriends, setUserName, setUserVip, getHistory, getEloTrend, recordPayment, grantEntitlement, getEntitlements } from './db.js'
import { verifyInitData } from './telegram.js'
import { createNardy, roll as nardyRoll, move as nardyMove, destOf as nardyDest, other as nardyOther } from './nardy.js'
import * as durak from './durak.js'
import * as durakN from './durakN.js'

const PORT = process.env.PORT || 3001

// ── in-memory state (live sessions) ──────────────
const users = new Map() // userId -> { socketId, name, elo }
const socketUser = new Map() // socketId -> userId
const userTg = new Map() // composite userId -> verified telegram id (for DB)
const tgSocket = new Map() // telegram id -> socketId (presence: online friends)
const tgInfo = new Map() // telegram id -> { name, username, photoUrl, elos } (last seen)
const queues = new Map() // "game:minutes" -> [userId]
const nQueues = new Map() // durakn config key -> { ids: [], timer } (fills with bots on timeout)
const DURAKN_FILL_MS = 6000 // wait this long for humans, then fill remaining seats with bots
const rooms = new Map() // roomId -> room
const abandonTimers = new Map() // "userId:roomId" -> timeout (reconnect grace)
const RECONNECT_GRACE_MS = 120000 // 2 min to reconnect before a started game abandons you

// persistent DB (Neon Postgres) — optional; no-ops if DATABASE_URL is unset
initDb().catch((e) => console.error('[db] init failed:', e.message))

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
  `durakn:${o.players}:${o.deck}:${o.transfer ? 't' : 'c'}:${o.neighborsOnly ? 'n' : 'a'}:${o.allowDraw ? 'd' : 'k'}`

function startDurakNRoom(ids, opts) {
  const room = rooms.get(createRoom('durakn', opts.deck, opts))
  for (const id of ids.slice(0, opts.players)) addPlayer(room, id)
  startRoom(room) // remaining seats are bots
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
  if (!q.timer) {
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

// ── Telegram Stars payments ──
const BOT_TOKEN = process.env.BOT_TOKEN
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'gh_' + (BOT_TOKEN ? BOT_TOKEN.slice(-10).replace(/\W/g, '') : 'dev')
const WEBHOOK_PATH = `/tg/${WEBHOOK_SECRET}`

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
  return room.seatUser.map((uid) => {
    if (!uid) return { name: 'Бот', vip: false, bot: true, photoUrl: null, offline: false }
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

  const finalize = (deltas) => {
    for (let seat = 0; seat < n; seat++) {
      const uid = seatUser[seat]
      const sid = uid && sidOf(uid)
      if (sid)
        io.to(sid).emit('game:over', {
          youWon: loser == null ? null : loser !== seat,
          draw: loser == null,
          reason: 'durak',
          eloDelta: deltas[seat] ?? 0,
        })
    }
    revertDurakNRoom(room)
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
}

function durakFinish(room) {
  const loserSeat = room.durak.result?.loser
  if (loserSeat == null) return endGame(room, null, 'draw')
  const loserId = loserSeat === 'you' ? room.players[0]?.userId : room.players[1]?.userId
  const winner = room.players.find((p) => p.userId !== loserId)
  endGame(room, winner ? winner.color : null, 'durak')
}

const ABORT_WINDOW_MS = 10000

function startRoom(room) {
  if (room.started) return
  if (room.game === 'durakn') {
    room.started = true
    room.startedAt = Date.now()
    // seat i = the i-th human that joined; remaining seats are bots (null)
    room.seatUser = Array.from({ length: room.durakN.n }, (_, i) => room.players[i]?.userId ?? null)
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
    room.timer = setInterval(() => tick(room), 250)
    scheduleDurakNBot(room)
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
  room.timer = setInterval(() => tick(room), 250)
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
  const dt = now - room.lastTick
  room.lastTick = now
  const t = room.chess.turn()
  room.clocks[t] = Math.max(0, room.clocks[t] - dt)
  if (room.clocks[t] === 0) endGame(room, t === 'w' ? 'b' : 'w', 'time')
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
    const dWin = eloDelta(winner.elo, loser.elo, true)
    const dLoss = eloDelta(loser.elo, winner.elo, false)
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
  for (const p of room.players) {
    const sid = sidOf(p.userId)
    if (!sid) continue
    io.to(sid).emit('game:over', {
      winner: winnerColor,
      reason,
      youWon: winnerColor ? p.color === winnerColor : null,
      eloDelta: p === a ? da : db,
      clocks: room.clocks,
    })
  }
}

io.on('connection', (socket) => {
  socket.on('register', async ({ userId, name, elo, initData, username, photoUrl, vip }) => {
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
      for (const f of await friendListFor(tgId)) pushFriends(f.id).catch(() => {})
      // owned skins (server = source of truth for paid items)
      getEntitlements(tgId).then((items) => socket.emit('shop:entitlements', { items })).catch(() => {})
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

  socket.on('quickMatch', ({ game, minutes, transfer, players, neighborsOnly, allowDraw }) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
    if (game === 'durakn') {
      return quickMatchDurakN(userId, socket, {
        players: Math.max(2, Math.min(6, players ?? 3)),
        deck: minutes || 36,
        transfer: !!transfer,
        neighborsOnly: !!neighborsOnly,
        allowDraw: allowDraw ?? true,
      })
    }
    // include durak options in the bucket so only same-config players match
    const key = game === 'durak' ? `durak:${minutes}:${transfer ? 't' : 'c'}` : qkey(game, minutes)
    const q = (queues.get(key) ?? []).filter((id) => id !== userId)
    if (q.length > 0) {
      const oppId = q.shift()
      queues.set(key, q)
      const room = rooms.get(createRoom(game, minutes, { transfer }))
      addPlayer(room, oppId)
      addPlayer(room, userId)
      startRoom(room)
    } else {
      q.push(userId)
      queues.set(key, q)
      socket.emit('queue:waiting')
    }
  })

  socket.on('cancelQuick', () => {
    const userId = socketUser.get(socket.id)
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

  socket.on('lobby:create', (opts, cb) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
    leaveLobby(userId) // one open lobby per player
    const roomId = createRoom('durakn', opts?.deck || 36, {
      players: Math.max(2, Math.min(6, opts?.players ?? 3)),
      transfer: !!opts?.transfer,
      neighborsOnly: !!opts?.neighborsOnly,
      allowDraw: opts?.allowDraw ?? true,
    })
    addPlayer(rooms.get(roomId), userId)
    cb?.(roomId)
    emitLobbyState(rooms.get(roomId))
    broadcastLobbies()
  })

  socket.on('lobby:join', ({ roomId }) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
    leaveLobby(userId)
    if (joinDurakNLobby(rooms.get(roomId), userId) === 'gone')
      socket.emit('lobby:gone', { roomId })
  })

  socket.on('lobby:start', ({ roomId }) => {
    const userId = socketUser.get(socket.id)
    const room = rooms.get(roomId)
    if (!room || room.game !== 'durakn' || room.started || room.over) return
    if (room.players[0]?.userId !== userId) return // host only
    startRoom(room) // remaining empty seats become bots
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
  socket.on('friend:add', async ({ code }) => {
    const myTg = userTg.get(socketUser.get(socket.id))
    const friendTg = Number(code)
    if (!myTg || !friendTg || myTg === friendTg) return
    await addFriendship(myTg, friendTg)
    pushFriends(myTg).catch(() => {})
    pushFriends(friendTg).catch(() => {})
    socket.emit('friend:added', { id: friendTg, name: tgInfo.get(friendTg)?.name ?? null })
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
    for (const [k, q] of queues) queues.set(k, q.filter((id) => id !== userId))
    leaveNQueues(userId)
    leaveLobby(userId) // drop out of any open lobby (started games use the abandon timer)
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
