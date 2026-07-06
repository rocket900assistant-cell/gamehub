import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { Chess } from 'chess.js'

const PORT = process.env.PORT || 3001

// ── in-memory state (swap for Redis/DB in production) ──────────────
const users = new Map() // userId -> { socketId, name, elo }
const socketUser = new Map() // socketId -> userId
const queues = new Map() // "game:minutes" -> [userId]
const rooms = new Map() // roomId -> room

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

function createRoom(game, minutes) {
  const id = uid()
  rooms.set(id, {
    id,
    game,
    minutes,
    chess: new Chess(),
    players: [], // [{ userId, name, elo, color }]
    clocks: { w: minutes * 60000, b: minutes * 60000 },
    lastTick: null,
    started: false,
    over: false,
    timer: null,
  })
  return id
}

function addPlayer(room, userId) {
  if (room.players.some((p) => p.userId === userId)) return
  if (room.players.length >= 2) return
  const u = users.get(userId)
  room.players.push({
    userId,
    name: u?.name ?? 'Игрок',
    elo: u?.elo ?? 1200,
    color: room.players.length === 0 ? 'w' : 'b',
  })
}

const sidOf = (userId) => users.get(userId)?.socketId
const io = new Server(createServer().listen(PORT), { cors: { origin: '*' } })

function emitToRoom(room, event, payload) {
  for (const p of room.players) {
    const sid = sidOf(p.userId)
    if (sid) io.to(sid).emit(event, payload)
  }
}

const ABORT_WINDOW_MS = 10000

function startRoom(room) {
  if (room.started) return
  room.started = true
  room.startedAt = Date.now()
  room.lastTick = Date.now()
  for (const p of room.players) {
    const opp = room.players.find((x) => x.userId !== p.userId)
    const sid = sidOf(p.userId)
    if (sid)
      io.to(sid).emit('match:found', {
        roomId: room.id,
        color: p.color,
        minutes: room.minutes,
        opponent: { name: opp.name, elo: opp.elo },
        fen: room.chess.fen(),
        clocks: room.clocks,
      })
  }
  room.timer = setInterval(() => tick(room), 250)
}

function tick(room) {
  if (room.over || !room.started) return
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
  socket.on('register', ({ userId, name, elo }) => {
    socketUser.set(socket.id, userId)
    users.set(userId, { socketId: socket.id, name, elo })
  })

  socket.on('quickMatch', ({ game, minutes }) => {
    const userId = socketUser.get(socket.id)
    if (!userId) return
    const key = qkey(game, minutes)
    const q = (queues.get(key) ?? []).filter((id) => id !== userId)
    if (q.length > 0) {
      const oppId = q.shift()
      queues.set(key, q)
      const room = rooms.get(createRoom(game, minutes))
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

  socket.on('createRoom', ({ game, minutes }, cb) => {
    const roomId = createRoom(game, minutes)
    addPlayer(rooms.get(roomId), socketUser.get(socket.id))
    cb?.(roomId)
  })

  socket.on('joinRoom', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) return socket.emit('room:notfound')
    addPlayer(room, socketUser.get(socket.id))
    if (room.players.length === 2) startRoom(room)
  })

  socket.on('invite', ({ toUserId, game, minutes }) => {
    const fromId = socketUser.get(socket.id)
    const roomId = createRoom(game, minutes)
    addPlayer(rooms.get(roomId), fromId)
    const from = users.get(fromId)
    const targetSid = sidOf(toUserId)
    if (targetSid)
      io.to(targetSid).emit('invite:incoming', {
        roomId,
        from: { name: from?.name },
        game,
        minutes,
      })
    socket.emit('invite:sent', { roomId })
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
    for (const room of rooms.values()) {
      if (room.over || !room.started) continue
      const me = room.players.find((p) => p.userId === userId)
      if (me) endGame(room, me.color === 'w' ? 'b' : 'w', 'abandon')
    }
    if (users.get(userId)?.socketId === socket.id) users.delete(userId)
  })
})

console.log(`GameHub realtime server on :${PORT}`)
