import { Scene }   from './Scene.js';
import { CONTENT } from '../data/content.js';

export class TitleScene extends Scene {
  render() {
    this.el.id = 'title-scene';
    this.el.innerHTML = `
      <h1 class="anim-glow">${CONTENT.hero.name} &<br/>The Shadows</h1>
      <p class="subtitle anim-fadeIn">"Face every shadow. Claim every light."</p>
      <div class="start-btn-wrap">
        <button class="btn-primary anim-pulse" id="start-btn">Begin the Journey</button>
        <button class="btn-secondary" id="multi-btn" style="margin-top:10px">Multiplayer Bond</button>
      </div>
      <p style="position:absolute;bottom:20px;font-size:0.75rem;color:rgba(255,248,244,0.3);letter-spacing:0.1em;font-family:var(--font-title);">
        Made with love by ${CONTENT.sender.name}
      </p>`;
  }

  start() {
    this.ge.particles.spawnPetals(20);
    this.el.querySelector('#start-btn').addEventListener('click', () => {
      this.ge.bus.emit('goToMap');
    });

    this.el.querySelector('#multi-btn').addEventListener('click', async () => {
      const { MultiplayerRoomScene } = await import('./MultiplayerRoomScene.js');
      this.ge.scenes.switchTo(new MultiplayerRoomScene(this.ge));
    });
  }
}