export class NetworkManager {
  constructor(gameEngine) {
    this.ge = gameEngine;
    this.socket = null;
    this.roomCode = null;
    this.isHost = false;
    this.remotePlayer = null; // { id, x, y, direction, frame }
    
    // Auto-detect server URL for unified deployment
    this.serverUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
      ? 'http://localhost:8080' 
      : window.location.origin; 
  }

  connect() {
    if (this.socket) return;
    
    this.socket = io(this.serverUrl);

    this.socket.on('connect', () => {
      console.log('Connected to multiplayer server');
    });

    this.socket.on('room_created', (code) => {
      this.roomCode = code;
      this.isHost = true;
      this.ge.bus.emit('network:room_created', code);
    });

    this.socket.on('room_joined', (code) => {
      this.roomCode = code;
      this.isHost = false;
      this.ge.bus.emit('network:room_joined', code);
    });

    this.socket.on('player_joined', (data) => {
      console.log('Remote player joined:', data.id);
      this.remotePlayer = { id: data.id, x: 0, y: 0 };
      this.ge.bus.emit('network:player_connected', data.id);
    });

    this.socket.on('state_update', (data) => {
      this.remotePlayer = { ...this.remotePlayer, ...data };
      this.ge.bus.emit('network:state_update', data);
    });

    this.socket.on('player_left', (id) => {
      console.log('Remote player left:', id);
      this.remotePlayer = null;
      this.ge.bus.emit('network:player_disconnected', id);
    });

    this.socket.on('error', (msg) => {
      alert(msg);
      this.ge.bus.emit('network:error', msg);
    });
  }

  createRoom() {
    this.socket.emit('create_room');
  }

  joinRoom(code) {
    this.socket.emit('join_room', code);
  }

  syncState(state) {
    if (this.socket && this.roomCode) {
      this.socket.emit('sync_state', {
        ...state,
        roomCode: this.roomCode
      });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.roomCode = null;
    }
  }
}
