import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { addChat, applyAction, createRoom, joinRoom, leaveSocket, publicState, rooms, startGame } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*'} });
const PORT = process.env.PORT || 3001;

function emitRoom(room) {
  for (const [socketId, pid] of room.sockets.entries()) {
    io.to(socketId).emit('state', publicState(room, pid));
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    try { const room = createRoom(socket.id, name || 'Host'); socket.join(room.code); cb?.({ ok:true, code:room.code }); emitRoom(room); }
    catch(e){ cb?.({ ok:false, error:e.message }); }
  });
  socket.on('joinRoom', ({ code, name }, cb) => {
    try { const { room } = joinRoom(code, socket.id, name || 'Buddy'); socket.join(room.code); cb?.({ ok:true, code:room.code }); emitRoom(room); }
    catch(e){ cb?.({ ok:false, error:e.message }); }
  });
  socket.on('startGame', ({ code }, cb) => {
    try { const room = rooms.get(String(code).toUpperCase()); if(!room) throw new Error('Room not found.'); startGame(room); cb?.({ ok:true }); emitRoom(room); }
    catch(e){ cb?.({ ok:false, error:e.message }); }
  });
  socket.on('action', ({ code, action }, cb) => {
    try { const room = rooms.get(String(code).toUpperCase()); if(!room) throw new Error('Room not found.'); const pid = room.sockets.get(socket.id); applyAction(room, pid, action); cb?.({ ok:true }); emitRoom(room); }
    catch(e){ cb?.({ ok:false, error:e.message }); }
  });
  socket.on('chat', ({ code, text }, cb) => {
    try { const room = rooms.get(String(code).toUpperCase()); if(!room) throw new Error('Room not found.'); const pid = room.sockets.get(socket.id); addChat(room, pid, text); cb?.({ ok:true }); emitRoom(room); }
    catch(e){ cb?.({ ok:false, error:e.message }); }
  });
  socket.on('disconnect', () => { const room = leaveSocket(socket.id); if(room) emitRoom(room); });
});

const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get('/health', (_, res) => res.json({ ok:true }));
app.use((req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

server.listen(PORT, () => console.log(`Dungeon Buddies listening on ${PORT}`));
