const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// Serve frontend static files from the root directory
// When running from server/index.js, the root is one level up
const rootDir = path.join(__dirname, '..');
app.use(express.static(rootDir));

// Fallback to index.html for SPA-style routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

const MAX_ROOMS = 8;
const MAX_PLAYERS_PER_ROOM = 2;
const rooms = new Map(); // code -> { players: [id1, id2], state: {} }

function generateCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', () => {
    if (rooms.size >= MAX_ROOMS) {
      socket.emit('error', 'Server is full (max 8 rooms).');
      return;
    }

    const code = generateCode();
    rooms.set(code, { players: [socket.id] });
    socket.join(code);
    socket.emit('room_created', code);
    console.log(`Room created: ${code} by ${socket.id}`);
  });

  socket.on('join_room', (code) => {
    const roomCode = code.toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', 'Room not found.');
      return;
    }

    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit('error', 'Room is full.');
      return;
    }

    room.players.push(socket.id);
    socket.join(roomCode);
    socket.emit('room_joined', roomCode);
    
    // Notify the other player that someone joined
    socket.to(roomCode).emit('player_joined', {
      id: socket.id,
      isHost: false
    });
    
    console.log(`${socket.id} joined room ${roomCode}`);
  });

  socket.on('sync_state', (data) => {
    // Relay data to the other player in the same room
    // data: { x, y, direction, frame, roomCode }
    if (data.roomCode) {
      socket.to(data.roomCode.toUpperCase()).emit('state_update', {
        id: socket.id,
        ...data
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Cleanup rooms
    for (const [code, room] of rooms.entries()) {
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        if (room.players.length === 0) {
          rooms.delete(code);
          console.log(`Room ${code} closed.`);
        } else {
          socket.to(code).emit('player_left', socket.id);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
