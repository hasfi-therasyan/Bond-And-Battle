import { Scene } from './Scene.js';

export class MultiplayerRoomScene extends Scene {
  render() {
    this.el.id = 'multiplayer-room-scene';
    this.el.style.cssText = `
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      height: 100%; gap: 20px;
      background: radial-gradient(circle, #1a0a2e 0%, #0d0714 100%);
    `;

    this.el.innerHTML = `
      <h2 style="font-family:'Cinzel', serif; color:#f2a7bb; font-size:2rem;">Multiplayer Bond</h2>
      
      <div id="connection-status" style="color:rgba(255,248,244,0.6); font-family:'Cormorant Garamond', serif;">
        Connecting to server...
      </div>

      <div id="room-actions" class="hidden" style="display:flex; flex-direction:column; gap:15px; width:300px;">
        <button class="btn-primary" id="host-btn">Host Room</button>
        <div style="display:flex; gap:10px;">
          <input type="text" id="join-code" placeholder="Enter Code" 
            style="flex:1; padding:10px; border-radius:5px; border:1px solid #c9a7d4; background:rgba(255,255,255,0.1); color:white; text-align:center; text-transform:uppercase;">
          <button class="btn-secondary" id="join-btn">Join</button>
        </div>
      </div>

      <div id="room-info" class="hidden" style="text-align:center;">
        <p style="color:#c9a7d4;">Room Code:</p>
        <h1 id="display-code" style="font-size:4rem; letter-spacing:10px; color:white; margin:10px 0;">----</h1>
        <p id="player-count" style="color:rgba(255,248,244,0.6);">Waiting for partner...</p>
      </div>

      <button class="btn-secondary" id="back-btn" style="position:absolute; bottom:40px;">Back to Title</button>
    `;
  }

  start() {
    const status = this.el.querySelector('#connection-status');
    const actions = this.el.querySelector('#room-actions');
    const info = this.el.querySelector('#room-info');
    const displayCode = this.el.querySelector('#display-code');
    const playerCount = this.el.querySelector('#player-count');

    this.ge.network.connect();

    // Handle Network Events
    this.ge.bus.on('network:room_created', (code) => {
      actions.classList.add('hidden');
      info.classList.remove('hidden');
      displayCode.textContent = code;
    });

    this.ge.bus.on('network:room_joined', (code) => {
      actions.classList.add('hidden');
      info.classList.remove('hidden');
      displayCode.textContent = code;
      playerCount.textContent = 'Joined room! Waiting for host to start...';
    });

    this.ge.bus.on('network:player_connected', () => {
      playerCount.textContent = 'Partner connected! Ready to play.';
      setTimeout(() => {
         this.ge.bus.emit('goToMap');
      }, 1500);
    });

    // Button Listeners
    this.el.querySelector('#host-btn').onclick = () => {
      this.ge.network.createRoom();
    };

    this.el.querySelector('#join-btn').onclick = () => {
      const code = this.el.querySelector('#join-code').value.trim();
      if (code) this.ge.network.joinRoom(code);
    };

    this.el.querySelector('#back-btn').onclick = () => {
      this.ge.network.disconnect();
      this.ge.scenes.switchTo(new (import('./TitleScene.js')).TitleScene(this.ge));
    };

    // Update status when connected
    const checkConnection = setInterval(() => {
      if (this.ge.network.socket && this.ge.network.socket.connected) {
        status.textContent = 'Connected to Aether';
        actions.classList.remove('hidden');
        clearInterval(checkConnection);
      }
    }, 500);
    this._checkConnInterval = checkConnection;
  }

  destroy() {
    clearInterval(this._checkConnInterval);
    super.destroy();
  }
}
