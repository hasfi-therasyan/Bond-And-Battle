import { SceneManager }   from './SceneManager.js';
import { SaveManager }    from './SaveManager.js';
import { AudioEngine }    from './AudioEngine.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { DialogueSystem } from '../systems/DialogueSystem.js';
import { EventBus }       from '../systems/EventBus.js';
import { NetworkManager } from '../systems/NetworkManager.js';
import { TitleScene }     from '../scenes/TitleScene.js';
import { MapScene }       from '../scenes/MapScene.js';
import { BattleScene }    from '../scenes/BattleScene.js';
import { VictoryScene }   from '../scenes/VictoryScene.js';
import { EndingScene }    from '../scenes/EndingScene.js';
import { CONTENT }        from '../data/content.js';
import { PlatformerScene } from '../scenes/PlatformerScene.js';

const BOSS_ORDER = ['insecurity', 'jealousy', 'fear', 'doubt', 'loneliness'];

export class GameEngine {
  constructor() {
    this.bus       = new EventBus();
    this.save      = new SaveManager();
    this.audio     = new AudioEngine();
    this.particles = new ParticleSystem('particle-canvas');
    this.dialogue  = new DialogueSystem();
    this.network   = new NetworkManager(this);
    this.scenes    = new SceneManager(
      document.getElementById('scene-container'),
      this.bus
    );

    this.state = {
      currentBattle: 0,
      hero: {
        name:   CONTENT.hero.name,
        level:  1,
        hp:     100, maxHp: 100,
        mp:     50,  maxMp: 50,
        atk:    18,
        def:    8,
        xp:     0,
        items:  { memoryPotion: 2, loveShard: 2, petalShield: 1 },
        statusEffects: [],
        revivedThisBattle: false,
      },
      defeatedBosses: [],
      completed: false,
    };

    this._setupCursor();
    this._setupEvents();
  }

  _setupCursor() {
    document.addEventListener('mousemove', e => {
      document.documentElement.style.setProperty('--cursor-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--cursor-y', `${e.clientY}px`);
    });
  }

_setupEvents() {
  this.bus.on('goToMap',      ()    => this._goToMap());
  this.bus.on('startBattle',  (id)  => this._startBattle(id));
  this.bus.on('battleWon',    (id)  => this._onBattleWon(id));
  this.bus.on('goToEnding',   ()    => this._goToEnding());
  this.bus.on('restartGame',  ()    => this._restartGame());
}
  async init() {
    const saved = this.save.load();
    if (saved && !saved.completed) {
      const resume = await this._askResume();
      if (resume) {
        this.state = saved;
        this._goToMap();
        return;
      }
    }
    this.save.clear();
    this._goToTitle();
  }

  _askResume() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-box">
          <h2>Continue Journey?</h2>
          <p>Chiara's adventure was saved. Resume where you left off?</p>
          <div class="modal-actions">
            <button class="btn-primary" id="resume-yes">Continue</button>
            <button class="btn-secondary" id="resume-no">New Game</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#resume-yes').onclick = () => { overlay.remove(); resolve(true); };
      overlay.querySelector('#resume-no').onclick  = () => { overlay.remove(); resolve(false); };
    });
  }

  _goToTitle() {
    this.scenes.switchTo(new TitleScene(this));
  }

  _goToMap() {
    this._updateProgressBar();
    this.scenes.switchTo(new MapScene(this, BOSS_ORDER, this.state));
  }

_startBattle(bossId) {
  this.state.hero.revivedThisBattle = false;
  this.state.hero.statusEffects     = [];
  this._updateProgressBar();
  this._startPlatformer(bossId);
}

_startPlatformer(bossId, lives = 3) {
  const scene = new PlatformerScene(
    this,
    bossId,
    lives,
    // onWin — completed platformer, now start the RPG battle
    () => {
      this.audio.chime();
      this.scenes.switchTo(
        new BattleScene(this, bossId, this.state)
      );
    },
    // onGameOver
    (action) => {
      if (action === 'retry') {
        this._startPlatformer(bossId, 3);
      } else {
        this._goToMap();
      }
    }
  );
  this.scenes.switchTo(scene);
}

  _onBattleWon(bossId) {
    this.state.defeatedBosses.push(bossId);
    this.state.currentBattle = BOSS_ORDER.indexOf(bossId) + 1;
    this._levelUp();
    this.save.save(this.state);

    // No await — VictoryScene.onDone drives what happens next
    this.scenes.switchTo(
      new VictoryScene(this, bossId, this.state, () => {
        this._afterVictory(bossId);
      })
    );
  }

  _afterVictory(bossId) {
    if (bossId === 'loneliness') {
      this._goToEnding();
      return;
    }
    this._showRandomEvent();
  }

  async _showRandomEvent() {
    const { EventScene } = await import('../scenes/EventScene.js');
    this.scenes.switchTo(
      new EventScene(this, this.state, () => {
        this._goToMap();
      })
    );
  }

  _levelUp() {
    const newLevel = this.state.hero.level + 1;
    this.state.hero.level  = newLevel;
    this.state.hero.maxHp += 10;
    this.state.hero.maxMp += 5;
    this.state.hero.hp     = this.state.hero.maxHp;
    this.state.hero.mp     = this.state.hero.maxMp;
    this.state.hero.atk   += 4;
    this.state.hero.def   += 2;
  }

  _goToEnding() {
    this.state.completed = true;
    this.save.clear();
    this.scenes.switchTo(new EndingScene(this));
  }

  _restartGame() {
    this.save.clear();
    location.reload();
  }

  _updateProgressBar() {
    const dots = document.querySelectorAll('.progress-dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('active', 'done');
      if (i < this.state.currentBattle) dot.classList.add('done');
      else if (i === this.state.currentBattle) dot.classList.add('active');
    });
  }

  destroy() {
    this.bus.destroy();
    this.audio.destroy();
    this.particles.destroy();
    this.dialogue.destroy();
    this.network.disconnect();
    this.scenes.destroy();
  }
}