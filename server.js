const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const sockets = new Set();
const COLORS = [
  { name: 'Red', hex: '#f04452' }, { name: 'Orange', hex: '#ff9d38' },
  { name: 'Yellow', hex: '#f1cf49' }, { name: 'Green', hex: '#37c987' },
  { name: 'Blue', hex: '#4787ff' }, { name: 'Purple', hex: '#a66af1' }
];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.resolve(ROOT, file);
  if (!full.startsWith(ROOT + path.sep) && full !== path.join(ROOT, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

function freshRound(room) {
  room.roundId++;
  room.target = COLORS[Math.floor(Math.random() * COLORS.length)];
  room.status = 'playing';
  room.winnerId = null;
  room.roundWinnerId = null;
  room.roundStartedAt = Date.now();
}
function snapshot(room) {
  return {
    type: 'state', roomCode: room.code, status: room.status, target: room.target,
    roundId: room.roundId, roundWinnerId: room.roundWinnerId, winnerId: room.winnerId,
    hostId: room.hostId, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: !!p.socket }))
  };
}
function send(socket, data) { if (socket && socket.wsReady) socket.write(frame(JSON.stringify(data))); }
function broadcast(room) { const message = snapshot(room); for (const p of room.players.values()) send(p.socket, message); }
function error(socket, message) { send(socket, { type: 'error', message }); }

function handle(socket, message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'create' || message.type === 'join') {
    const name = String(message.name || '').trim().replace(/[<>]/g, '').slice(0, 18);
    if (!name) return error(socket, 'Add a name to join the game.');
    const id = /^[\w-]{8,80}$/.test(String(message.playerId || '')) ? String(message.playerId) : crypto.randomUUID();
    let room;
    if (message.type === 'create') {
      let code;
      do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
      room = { code, players: new Map(), hostId: id, status: 'waiting', target: null, roundId: 0, roundWinnerId: null, winnerId: null };
      rooms.set(code, room);
    } else {
      const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      room = rooms.get(code);
      if (!room) return error(socket, 'That room code was not found. Check it and try again.');
      if (!room.players.has(id) && room.players.size >= 6) return error(socket, 'This room is full. Games can have up to 6 players.');
      if (room.status === 'playing' && !room.players.has(id)) return error(socket, 'This game is already in progress. Ask the host to replay.');
    }
    const previous = room.players.get(id);
    if (!previous && room.players.size >= 6) return error(socket, 'This room is full. Games can have up to 6 players.');
    if (previous?.socket && previous.socket !== socket) { previous.socket.playerKey = null; previous.socket.end(); }
    const player = previous || { id, score: 0, socket: null };
    player.name = name; player.socket = socket;
    room.players.set(id, player);
    socket.playerKey = { roomCode: room.code, id };
    send(socket, { type: 'joined', playerId: id, roomCode: room.code });
    broadcast(room);
    return;
  }
  const key = socket.playerKey;
  if (!key) return error(socket, 'Join a room first.');
  const room = rooms.get(key.roomCode), player = room?.players.get(key.id);
  if (!room || !player || player.socket !== socket) return;
  if (message.type === 'start') {
    if (room.hostId !== player.id) return error(socket, 'Only the host can start the game.');
    if (room.status !== 'waiting' || room.players.size < 2) return error(socket, 'Invite at least one more player before starting.');
    for (const p of room.players.values()) p.score = 0;
    freshRound(room); broadcast(room);
  } else if (message.type === 'pick') {
    if (room.status !== 'playing' || room.roundId !== Number(message.roundId) || room.roundWinnerId) return;
    if (String(message.color || '').toLowerCase() !== room.target.name.toLowerCase()) return;
    // The round winner check and score update happen synchronously in one event-loop turn.
    room.roundWinnerId = player.id;
    player.score++;
    if (player.score >= 10) { room.status = 'finished'; room.winnerId = player.id; }
    broadcast(room);
    if (room.status === 'playing') {
      const expectedRound = room.roundId;
      setTimeout(() => {
        if (room.status === 'playing' && room.roundId === expectedRound && room.roundWinnerId) {
          freshRound(room);
          broadcast(room);
        }
      }, 1350);
    }
  } else if (message.type === 'replay') {
    if (room.status !== 'finished' || player.id !== room.winnerId) return error(socket, 'The winner can start the replay.');
    for (const p of room.players.values()) p.score = 0;
    freshRound(room); broadcast(room);
  } else if (message.type === 'leave') {
    removePlayer(socket, true);
  }
}

function removePlayer(socket, explicit = false) {
  const key = socket.playerKey;
  if (!key) return;
  socket.playerKey = null;
  const room = rooms.get(key.roomCode), player = room?.players.get(key.id);
  if (!room || !player || player.socket !== socket) return;
  player.socket = null;
  if (explicit) room.players.delete(key.id);
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.hostId === key.id) {
    const next = [...room.players.values()].find(p => p.socket);
    if (next) room.hostId = next.id;
  }
  if (room.status === 'playing' && room.roundWinnerId === key.id) room.roundWinnerId = 'disconnected';
  broadcast(room);
}

// Minimal RFC 6455 server framing, so the app has no runtime dependencies.
function frame(text) {
  const payload = Buffer.from(text), n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.wsReady = true; sockets.add(socket);
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f, masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f, offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; const big = buffer.readBigUInt64BE(2); if (big > 1048576n) { socket.destroy(); return; } length = Number(big); offset = 10; }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      let payload = buffer.subarray(offset, offset + length);
      if (masked) { payload = Buffer.from(payload); const mask = buffer.subarray(maskOffset, maskOffset + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
      buffer = buffer.subarray(offset + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      if (opcode === 9) { socket.write(Buffer.from([0x8a, 0])); continue; }
      if (opcode === 1) { try { handle(socket, JSON.parse(payload.toString('utf8'))); } catch { error(socket, 'Could not read that message.'); } }
    }
  });
  socket.on('close', () => { socket.wsReady = false; sockets.delete(socket); removePlayer(socket); });
  socket.on('error', () => { socket.wsReady = false; sockets.delete(socket); removePlayer(socket); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Color Clash listening on ${PORT}`));
process.on('SIGTERM', () => { for (const s of sockets) s.end(); server.close(() => process.exit(0)); });
