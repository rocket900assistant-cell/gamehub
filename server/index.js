import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { Chess } from 'chess.js'
import { initDb, upsertUser, getUser, recordResult, dbEnabled, addFriendship, removeFriendship, getFriends, setUserName, setUserVip, getHistory } from './db.js'
import { verifyInitData } from './telegram.js'
import { createNardy, roll as nardyRoll, move as nardyMove, destOf as nardyDest, other as nardyOther } from './nardy.js'
import * as durak from './durak.js'

const PORT = process.env.PORT || 3001

// ── in-memory state (live sessions) ──────────────
const users = new Map() // userId -> { socketId, name, elo }
const socketUser = new Map() // socketId -> userId
const userTg = new Map() // composite userId -> verified telegram id (for DB)
const tgSocket = new Map() // telegram id -> socketId (presence: online friends)
const tgInfo = new Map() // telegram id -> { name, username, photoUrl, elos } (last seen)
const queues = new Map() // "game:minutes" -> [userId]
const rooms = new Map() // roomId -> room
const abandonTimers = new Map() // "userId:roomId" -> timeout (reconnect grace)
const RECONNECT_GRACE_MS = 30000

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
  if (room.players.length >= 2) return
  const u = users.get(userId)
  room.players.push({
    userId,
    tgId: userTg.get(userId) ?? null,
    name: u?.name ?? 'Игрок',
    elo: u?.elos?.[room.game] ?? u?.elo ?? 1200,
    vip: !!u?.vip,
    color: room.players.length === 0 ? 'w' : 'b',
  })
}

const sidOf = (userId) => users.get(userId)?.socketId

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

// HTTP server with a health-check route (Render pings "/").
const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('GameHub realtime server ok')
})
httpServer.listen(PORT)
const io = new Server(httpServer, { cors: { origin: '*' } })

function emitToRoom(room, event, payload) {
  for (const p of room.players) {
    const sid = sidOf(p.userId)
    if (sid) io.to(sid).emit(event, payload)
  }
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
        opponent: { name: opp.name, elo: opp.elo, vip: opp.vip },
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
        opponent: { name: opp.name, elo: opp.elo, vip: opp.vip },
        nardy: room.nardy,
        deadline: room.deadline,
      })
    } else {
      io.to(sid).emit('match:found', {
        roomId: room.id,
        color: p.color,
        minutes: room.minutes,
        opponent: { name: opp.name, elo: opp.elo, vip: opp.vip },
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
    users.set(userId, { ...users.get(userId), socketId: socket.id, name, elo, vip: !!vip })

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
      if (room.game === 'nardy') {
        socket.emit('match:found', {
          roomId: room.id,
          game: 'nardy',
          color: me.color,
          minutes: room.minutes,
          elo: me.elo,
          opponent: { name: opp?.name, elo: opp?.elo, vip: opp?.vip },
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
          opponent: { name: opp?.name, elo: opp?.elo, vip: opp?.vip },
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
          opponent: { name: opp?.name, elo: opp?.elo, vip: opp?.vip },
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

  socket.on('quickMatch', ({ game, minutes, transfer }) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
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
  })

  socket.on('createRoom', ({ game, minutes, transfer }, cb) => {
    const roomId = createRoom(game, minutes, { transfer })
    addPlayer(rooms.get(roomId), socketUser.get(socket.id))
    cb?.(roomId)
  })

  socket.on('joinRoom', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) return socket.emit('room:notfound')
    addPlayer(room, socketUser.get(socket.id))
    if (room.players.length === 2) startRoom(room)
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
    const color = room.players.find(
      (p) => p.userId === socketUser.get(socket.id),
    )?.color
    if (color) endGame(room, color === 'w' ? 'b' : 'w', 'resign')
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
    for (const [k, q] of queues) queues.set(k, q.filter((id) => id !== userId))
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
      const key = `${userId}:${room.id}`
      if (abandonTimers.has(key)) continue
      const t = setTimeout(() => {
        abandonTimers.delete(key)
        const r = rooms.get(room.id)
        if (!r || r.over) return
        if (users.get(userId)?.socketId) return // reconnected — don't abandon
        const me = r.players.find((p) => p.userId === userId)
        if (me) endGame(r, me.color === 'w' ? 'b' : 'w', 'abandon')
      }, RECONNECT_GRACE_MS)
      abandonTimers.set(key, t)
    }
  })
})

console.log(`GameHub realtime server on :${PORT}`)
