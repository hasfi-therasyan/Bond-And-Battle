export class Platformer {
  constructor(canvas, zoneId, zoneConfig, onComplete, onLifeLost, ge = null) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext('2d');
    this.zoneId     = zoneId;
    this.zone       = zoneConfig;
    this.onComplete = onComplete;
    this.onLifeLost = onLifeLost;
    this.running    = false;
    this.won        = false;
    this.ge = ge;

    this.TILE = 32;
    this.keys = {};

    this.hero = {
      x: 80, y: 100,
      vx: 0, vy: 0,
      w: 20, h: 28,
      onGround: false,
      direction: 1,
      frame: 0,
      frameTimer: 0,
      invincible: 0,
      checkpointX: 80,
      checkpointY: 100,
    };

    this.camera = { x: 0, y: 0 };
    this.particles = [];
    this.time = 0;
    this.fixedStep = 1 / 60;
    this.accumulator = 0;
    this.lastTime = 0;

    this.remotePlayer = null;

    this._buildLevel();
    this._setupInput();
  }

  _buildLevel() {
    const z   = this.zone;
    this.platforms  = [...z.platforms];
    this.spikes     = [...z.spikes];
    this.gaps       = [];
    this.rocks      = [];
    this.fog        = z.fog ?? false;
    this.fogTimer   = 0;
    this.checkpoint = z.checkpoint ?? { x: z.goalX - 200, y: 200 };
    this.goalX      = z.goalX;
    this.goalY      = z.goalY ?? 200;
    this.levelW     = z.levelW ?? 3200;
    this.levelH     = z.levelH ?? 600;
    this.hearts     = z.hearts ? [...z.hearts] : [];
    this.collectedHearts = 0;

    // Shadow enemies
    this.enemies = (z.enemies ?? []).map(e => ({
      ...e,
      startX: e.x,
      dir: 1,
      frame: 0,
      frameTimer: 0,
    }));

    // Falling rocks
    this.fallingRocks = [];
    this.rockSpawners = z.rockSpawners ?? [];
    this.rockTimer    = 0;
  }

  _setupInput() {
    this._onKeyDown = e => {
      this.keys[e.key] = true;
      if (['ArrowUp','w','W',' '].includes(e.key)) e.preventDefault();
    };
    this._onKeyUp = e => { this.keys[e.key] = false; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────

  update() {
    if (this.won) return;
    this.time += this.fixedStep;
    this._updateHero();
    this._updateEnemies();
    this._updateRocks();
    this._updateParticles();
    this._updateCamera();
    if (this.fog) this.fogTimer += 0.008;

    // Sync state if multiplayer is active
    if (this.ge?.network?.socket?.connected) {
      this.ge.network.syncState({
        x: this.hero.x,
        y: this.hero.y,
        direction: this.hero.direction,
        frame: this.hero.frame
      });
      this.remotePlayer = this.ge.network.remotePlayer;
    }
  }

  _updateHero() {
    const h   = this.hero;
    const spd = this.fog ? 2.8 : 4.2;
    const jump = -11;

    // Horizontal input
    if (this.keys['ArrowLeft']  || this.keys['a'] || this.keys['A']) {
      h.vx = -spd; h.direction = -1;
    } else if (this.keys['ArrowRight'] || this.keys['d'] || this.keys['D']) {
      h.vx = spd;  h.direction =  1;
    } else {
      h.vx *= 0.7;
    }

    // Jump
    if ((this.keys['ArrowUp'] || this.keys['w'] || this.keys['W'] || this.keys[' ']) && h.onGround) {
      h.vy = jump;
      h.onGround = false;
      this._spawnParticles(h.x + h.w/2, h.y + h.h, 'jump');
      this.ge?.audio?.jump(); // ← pixel jump sound
    }

    // Gravity
    h.vy += 0.5;
    h.vy  = Math.min(h.vy, 16);

    // Move X
    h.x += h.vx;
    h.x  = Math.max(0, Math.min(this.levelW - h.w, h.x));
    this._resolveX();

    // Move Y
    h.y += h.vy;
    h.onGround = false;
    this._resolveY();

    // Animation
    if (Math.abs(h.vx) > 0.5) {
      h.frameTimer++;
      if (h.frameTimer > 8) { h.frame = (h.frame + 1) % 4; h.frameTimer = 0; }
    } else {
      h.frame = 0;
    }

    // Invincibility frames
    if (h.invincible > 0) h.invincible--;

    // Fell off bottom
    if (h.y > this.levelH + 50) this._die();

    // Reached goal
    const dx = (h.x + h.w/2) - this.goalX;
    const dy = (h.y + h.h/2) - this.goalY;
    if (Math.sqrt(dx*dx + dy*dy) < 40 && !this.won) {
      this.won = true;
      this._spawnParticles(this.goalX, this.goalY, 'win');
      setTimeout(() => this.onComplete?.(), 1000);
    }

    // Spikes
    if (h.invincible === 0) {
      for (const s of this.spikes) {
        if (this._heroOverlaps(s.x, s.y, s.w ?? this.TILE, s.h ?? 16)) {
          this._die(); return;
        }
      }

      // Enemies
      for (const e of this.enemies) {
        if (this._heroOverlaps(e.x, e.y, 28, 36)) {
          this._die(); return;
        }
      }

      // Rocks
      for (const r of this.fallingRocks) {
        if (this._heroOverlaps(r.x - r.size, r.y - r.size, r.size*2, r.size*2)) {
          this._die(); return;
        }
      }
    }

    // Collect hearts — restores a life
    this.hearts = this.hearts.filter(ht => {
      if (!ht.collected &&
        h.x+h.w > ht.x && h.x < ht.x+20 &&
        h.y+h.h > ht.y && h.y < ht.y+20
      ) {
        ht.collected = true;
        this._spawnParticles(ht.x+10, ht.y+10, 'heart');
        this.onHeartCollected?.(); // notify scene to add a life
        return false;
      }
      return true;
    });

    // Checkpoint
    const cp = this.checkpoint;
    if (Math.abs((h.x + h.w/2) - cp.x) < 30 && Math.abs(h.y - cp.y) < 60) {
      h.checkpointX = cp.x - h.w/2;
      h.checkpointY = cp.y;
    }
  }

  _resolveX() {
    const h = this.hero;
    for (const p of this.platforms) {
      if (
        h.x < p.x + p.w &&
        h.x + h.w > p.x &&
        h.y < p.y + p.h &&
        h.y + h.h > p.y
      ) {
        if (h.vx > 0) h.x = p.x - h.w;
        else           h.x = p.x + p.w;
        h.vx = 0;
      }
    }
  }

  _resolveY() {
    const h = this.hero;
    for (const p of this.platforms) {
      if (
        h.x < p.x + p.w &&
        h.x + h.w > p.x &&
        h.y < p.y + p.h &&
        h.y + h.h > p.y
      ) {
        if (h.vy > 0) {
          h.y        = p.y - h.h;
          h.vy       = 0;
          h.onGround = true;
        } else {
          h.y  = p.y + p.h;
          h.vy = 2;
        }
      }
    }
  }

  _heroOverlaps(x, y, w, h) {
    const hr = this.hero;
    return (
      hr.x < x + w  &&
      hr.x + hr.w > x &&
      hr.y < y + h  &&
      hr.y + hr.h > y
    );
  }

  _die() {
    if (this.hero.invincible > 0) return;
    this._spawnParticles(this.hero.x + this.hero.w/2, this.hero.y + this.hero.h/2, 'die');
    this.hero.x  = this.hero.checkpointX;
    this.hero.y  = this.hero.checkpointY;
    this.hero.vx = 0;
    this.hero.vy = 0;
    this.hero.invincible = 90;
    this.onLifeLost?.();
  }

  _updateEnemies() {
    for (const e of this.enemies) {
      e.x += e.speed * e.dir;
      if (e.x > e.startX + e.range || e.x < e.startX - e.range) e.dir *= -1;
      e.frameTimer++;
      if (e.frameTimer > 12) { e.frame = (e.frame + 1) % 2; e.frameTimer = 0; }
    }
  }

  _updateRocks() {
    this.rockTimer += 0.016;
    for (const spawner of this.rockSpawners) {
      if (this.rockTimer % spawner.interval < 0.05) {
        this.fallingRocks.push({
          x: spawner.x + (Math.random() - 0.5) * spawner.spread,
          y: 0,
          vy: 2 + Math.random() * 2,
          size: 10 + Math.random() * 8,
          rotation: 0,
          rotSpeed: (Math.random() - 0.5) * 0.15,
        });
      }
    }
    this.fallingRocks = this.fallingRocks.filter(r => {
      r.y       += r.vy;
      r.vy      += 0.18;
      r.rotation += r.rotSpeed;
      // Remove if landed on platform or fell off
      for (const p of this.platforms) {
        if (r.x > p.x && r.x < p.x + p.w && r.y + r.size > p.y && r.y < p.y) {
          this._spawnParticles(r.x, r.y, 'rock');
          return false;
        }
      }
      return r.y < this.levelH + 100;
    });
  }

  _updateParticles() {
    this.particles = this.particles.filter(p => {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.15;
      p.life -= p.decay;
      return p.life > 0;
    });
  }

  _spawnParticles(x, y, type) {
    const colors = {
      jump: ['#c9a7d4','#f2a7bb','#ffffff'],
      win:  ['#e8b86d','#f2a7bb','#ffffff','#c9a7d4'],
      die:  ['#e84040','#ff8888','#ffffff'],
      heart:['#f2a7bb','#ff69b4','#ffffff'],
      rock: ['#888','#aaa','#666'],
    };
    const cols = colors[type] || colors.jump;
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 1;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        color: cols[Math.floor(Math.random() * cols.length)],
        size: 3 + Math.random() * 4,
        life: 1,
        decay: 0.03 + Math.random() * 0.02,
      });
    }
  }

  _updateCamera() {
    const targetX = this.hero.x - this.canvas.width  / 2 + this.hero.w / 2;
    const targetY = this.hero.y - this.canvas.height / 2 + this.hero.h / 2;
    this.camera.x += (targetX - this.camera.x) * 0.1;
    this.camera.y += (targetY - this.camera.y) * 0.1;
    this.camera.x  = Math.max(0, Math.min(this.levelW - this.canvas.width,  this.camera.x));
    this.camera.y  = Math.max(0, Math.min(this.levelH - this.canvas.height, this.camera.y));
  }

  // ─── DRAW ─────────────────────────────────────────────────────────────────

  draw() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Sky
    this._drawBackground(ctx, W, H);

    ctx.save();
    ctx.translate(-Math.floor(this.camera.x), -Math.floor(this.camera.y));

    this._drawPlatforms(ctx);
    this._drawSpikes(ctx);
    this._drawGoal(ctx);
    this._drawCheckpoint(ctx);
    this._drawHearts(ctx);
    this._drawEnemies(ctx);
    this._drawRocks(ctx);
    
    // Draw Remote Hero First
    if (this.remotePlayer) {
      this._drawHeroSprite(ctx, this.remotePlayer, true);
    }
    
    // Draw Local Hero
    this._drawHeroSprite(ctx, this.hero, false);
    
    this._drawParticles(ctx);

    ctx.restore();

    // Fog overlay
    if (this.fog) this._drawFog(ctx, W, H);

    // HUD
    this._drawHUD(ctx, W, H);
  }

  _drawBackground(ctx, W, H) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, this.zone.skyTop    ?? '#0d0714');
    grad.addColorStop(1, this.zone.skyBottom ?? '#1a0a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 173.3 + this.camera.x * 0.1) % W);
      const sy = ((i * 97.7) % (H * 0.6));
      const tw = 0.5 + Math.sin(this.time * 2 + i) * 0.3;
      ctx.globalAlpha = tw;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  }

  _drawPlatforms(ctx) {
    const z = this.zone;
    for (const p of this.platforms) {
      // Main block
      ctx.fillStyle = z.tileColor ?? '#4a7c3f';
      ctx.fillRect(p.x, p.y, p.w, p.h);

      // Top highlight
      ctx.fillStyle = z.tileHighlight ?? '#5a9c4f';
      ctx.fillRect(p.x, p.y, p.w, 6);

      // Pixel border
      ctx.strokeStyle = z.tileBorder ?? '#2d4a1e';
      ctx.lineWidth   = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

      // Tile grid lines (Terraria style)
      ctx.strokeStyle = z.tileGrid ?? 'rgba(0,0,0,0.15)';
      ctx.lineWidth   = 0.5;
      for (let tx = p.x; tx < p.x + p.w; tx += this.TILE) {
        ctx.beginPath();
        ctx.moveTo(tx, p.y);
        ctx.lineTo(tx, p.y + p.h);
        ctx.stroke();
      }
      for (let ty = p.y; ty < p.y + p.h; ty += this.TILE) {
        ctx.beginPath();
        ctx.moveTo(p.x, ty);
        ctx.lineTo(p.x + p.w, ty);
        ctx.stroke();
      }

      // Decorative top grass/texture
      if (z.tileTopDeco) {
        ctx.fillStyle = z.tileTopDeco;
        for (let tx = p.x + 4; tx < p.x + p.w - 4; tx += 12) {
          ctx.fillRect(tx, p.y - 3, 3, 4);
        }
      }
    }
  }

  _drawSpikes(ctx) {
    for (const s of this.spikes) {
      const count = Math.floor((s.w ?? this.TILE) / 16);
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = this.zone.spikeColor ?? '#c0392b';
        ctx.beginPath();
        ctx.moveTo(s.x + i * 16,      s.y + 16);
        ctx.lineTo(s.x + i * 16 + 8,  s.y);
        ctx.lineTo(s.x + i * 16 + 16, s.y + 16);
        ctx.closePath();
        ctx.fill();
        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(s.x + i * 16 + 5, s.y + 14);
        ctx.lineTo(s.x + i * 16 + 8, s.y + 4);
        ctx.lineTo(s.x + i * 16 + 9, s.y + 14);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  _drawGoal(ctx) {
    const gx  = this.goalX;
    const gy  = this.goalY;
    const pulse = Math.sin(this.time * 3) * 0.3 + 0.7;

    // Glow
    const grad = ctx.createRadialGradient(gx, gy, 5, gx, gy, 50);
    grad.addColorStop(0,   `rgba(232,184,109,${0.6 * pulse})`);
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, gy, 50, 0, Math.PI * 2);
    ctx.fill();

    // Portal door
    ctx.fillStyle = '#2a0d38';
    ctx.fillRect(gx - 20, gy - 40, 40, 55);
    ctx.fillStyle = `rgba(232,184,109,${0.7 * pulse})`;
    ctx.beginPath();
    ctx.arc(gx, gy - 40, 20, Math.PI, 0);
    ctx.fill();

    // Inner glow
    const inner = ctx.createRadialGradient(gx, gy - 20, 2, gx, gy - 20, 16);
    inner.addColorStop(0, `rgba(255,220,120,${pulse})`);
    inner.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(gx, gy - 20, 16, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle   = '#e8b86d';
    ctx.font        = 'bold 11px Cinzel, serif';
    ctx.textAlign   = 'center';
    ctx.fillText('DUNGEON', gx, gy + 22);
    ctx.fillText(this.zone.label ?? '', gx, gy + 36);
    ctx.textAlign = 'left';
  }

  _drawCheckpoint(ctx) {
    const cp = this.checkpoint;
    const lit = Math.abs((this.hero.x + this.hero.w/2) - cp.x) < 30;
    // Flag pole
    ctx.fillStyle = '#888';
    ctx.fillRect(cp.x - 2, cp.y - 40, 4, 50);
    // Flag
    ctx.fillStyle = lit ? '#f2a7bb' : 'rgba(242,167,187,0.3)';
    ctx.beginPath();
    ctx.moveTo(cp.x + 2, cp.y - 40);
    ctx.lineTo(cp.x + 18, cp.y - 32);
    ctx.lineTo(cp.x + 2,  cp.y - 24);
    ctx.closePath();
    ctx.fill();
    if (lit) {
      ctx.fillStyle = 'rgba(242,167,187,0.2)';
      ctx.beginPath();
      ctx.arc(cp.x, cp.y - 30, 25, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawHearts(ctx) {
    for (const h of this.hearts) {
      const bob = Math.sin(this.time * 4 + h.x * 0.01) * 4;
      ctx.fillStyle = '#f2a7bb';
      const x = h.x, y = h.y + bob;
      ctx.beginPath();
      ctx.moveTo(x + 10, y + 14);
      ctx.bezierCurveTo(x - 5,  y + 4, x - 5,  y - 5, x + 10, y + 2);
      ctx.bezierCurveTo(x + 25, y - 5, x + 25, y + 4, x + 10, y + 14);
      ctx.fill();
      // Shine
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(x + 7, y + 4, 3, 2, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawEnemies(ctx) {
    for (const e of this.enemies) {
      const bob = Math.sin(this.time * 4 + e.x * 0.01) * 3;
      const flip = e.dir < 0 ? -1 : 1;

      ctx.save();
      ctx.translate(e.x + 14, e.y + bob);
      ctx.scale(flip, 1);

      // Shadow body
      const grad = ctx.createRadialGradient(0, 10, 2, 0, 10, 22);
      grad.addColorStop(0, 'rgba(80,0,80,0.9)');
      grad.addColorStop(1, 'rgba(20,0,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 10, 22, 0, Math.PI * 2);
      ctx.fill();

      // Eyes (glowing red)
      ctx.fillStyle = `rgba(255,60,60,${0.6 + Math.sin(this.time*5)*0.4})`;
      ctx.beginPath();
      ctx.ellipse(-6, 6, 5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(6, 6, 5, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pupils
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(-6, 7, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(6, 7, 2, 0, Math.PI * 2);
      ctx.fill();

      // Claws
      ctx.strokeStyle = 'rgba(200,100,200,0.6)';
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      for (let i = -1; i <= 1; i++) {
        const wobble = Math.sin(this.time * 8 + i) * 4;
        ctx.beginPath();
        ctx.moveTo(i * 10, 22);
        ctx.lineTo(i * 12, 32 + wobble);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  _drawRocks(ctx) {
    for (const r of this.fallingRocks) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rotation);
      ctx.fillStyle = '#6b6b7a';
      ctx.beginPath();
      ctx.arc(0, 0, r.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8b8b9a';
      ctx.beginPath();
      ctx.arc(-r.size * 0.3, -r.size * 0.3, r.size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawHeroSprite(ctx, h, isRemote = false) {
    const x = h.x;
    const y = h.y;

    // Invincibility flash for local hero
    if (!isRemote && h.invincible > 0 && Math.floor(h.invincible / 6) % 2 === 0) return;

    ctx.save();
    ctx.translate(x + 10, y + 14); // 20/2, 28/2
    ctx.scale(h.direction, 1);
    ctx.translate(-10, -14);

    // Different colors for remote hero
    const hairColor = isRemote ? '#a7c9d4' : '#c9a7d4';
    const hairDark  = isRemote ? '#94b8c8' : '#b894c8';
    const dressMain = isRemote ? '#bbf2a7' : '#f2a7bb';
    const dressDark = isRemote ? '#a0e8b8' : '#e8a0b8';

    // Glow
    const aura = ctx.createRadialGradient(10, 14, 4, 10, 14, 24);
    aura.addColorStop(0, isRemote ? 'rgba(167,201,212,0.4)' : 'rgba(242,167,187,0.4)');
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(10, 14, 24, 0, Math.PI * 2);
    ctx.fill();

    // Legs (walk animation)
    const legSwing = (!isRemote || h.moving) ? Math.sin(h.frame * Math.PI / 2) * 5 : 0;
    ctx.fillStyle = hairColor;
    ctx.fillRect(1,            18, 7, 10);
    ctx.fillRect(12,           18, 7, 10);
    // Leg offset when walking
    ctx.fillStyle = hairDark;
    ctx.fillRect(2,            18 + legSwing,  6, 9);
    ctx.fillRect(12,           18 - legSwing,  6, 9);

    // Dress body (pixel style)
    ctx.fillStyle = dressDark;
    ctx.fillRect(0, 10, 20, 10);
    ctx.fillStyle = dressMain;
    ctx.fillRect(2, 10, 16, 6);

    // Arms
    const armSwing = (!isRemote || h.moving) ? Math.sin(h.frame * Math.PI / 2) * 4 : 0;
    ctx.fillStyle = '#f2c4d0';
    ctx.fillRect(-4, 12 + armSwing, 5, 10);
    ctx.fillRect(19, 12 - armSwing, 5, 10);

    // Head (pixel)
    ctx.fillStyle = '#f2c4d0';
    ctx.fillRect(3, 0, 14, 12);
    // Hair
    ctx.fillStyle = hairColor;
    ctx.fillRect(2, -3, 16, 6);
    ctx.fillRect(-1, 0, 4, 10);
    // Eyes
    ctx.fillStyle = '#3b1f2e';
    ctx.fillRect(5,  4, 3, 3);
    ctx.fillRect(12, 4, 3, 3);
    // Blush
    ctx.fillStyle = 'rgba(242,167,187,0.5)';
    ctx.fillRect(3,  6, 3, 2);
    ctx.fillRect(14, 6, 3, 2);

    ctx.restore();

    // Shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x + 10, y + 28 + 2, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawHero(ctx) {
     // Old drawHero replaced by _drawHeroSprite
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawFog(ctx, W, H) {
    const density = 0.55 + Math.sin(this.fogTimer) * 0.1;
    // Multiple fog patches
    for (let i = 0; i < 5; i++) {
      const fx = ((this.fogTimer * 30 + i * W / 4) % (W + 200)) - 100;
      const fy = H * 0.3 + Math.sin(this.fogTimer + i) * 40;
      const fg = ctx.createRadialGradient(fx, fy, 20, fx, fy, 180);
      fg.addColorStop(0,   `rgba(30,10,50,${density})`);
      fg.addColorStop(0.5, `rgba(20,5,35,${density * 0.6})`);
      fg.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
    }
    // Bottom mist
    const mist = ctx.createLinearGradient(0, H * 0.7, 0, H);
    mist.addColorStop(0, 'rgba(0,0,0,0)');
    mist.addColorStop(1, `rgba(20,5,35,${density * 0.8})`);
    ctx.fillStyle = mist;
    ctx.fillRect(0, 0, W, H);
  }

  _drawHUD(ctx, W, H) {
    // Zone label
    ctx.fillStyle = 'rgba(10,5,16,0.65)';
    ctx.beginPath();
    ctx.roundRect(10, 10, 180, 30, 8);
    ctx.fill();
    ctx.fillStyle   = this.zone.accentColor ?? '#f2a7bb';
    ctx.font        = 'bold 12px Cinzel, serif';
    ctx.textAlign   = 'left';
    ctx.fillText(`${this.zone.emoji ?? '🌸'} ${this.zone.label}`, 18, 30);

    // Controls
    ctx.fillStyle = 'rgba(10,5,16,0.55)';
    ctx.beginPath();
    ctx.roundRect(10, H - 40, 240, 28, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,248,244,0.5)';
    ctx.font      = '10px Cinzel, serif';
    ctx.fillText('Arrow / WASD to move  ·  W / ↑ / Space to jump', 18, H - 22);

    ctx.textAlign = 'left';
  }

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────

  start() {
    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.accumulator = 0;
    this._loop();
  }

  _loop(nowMs = performance.now()) {
    if (!this.running) return;
    const now = nowMs / 1000;
    let frameTime = now - this.lastTime;
    this.lastTime = now;

    // Clamp very large gaps (tab switches / stalls) to avoid huge catch-up bursts.
    frameTime = Math.min(frameTime, 0.25);
    this.accumulator += frameTime;

    let steps = 0;
    const maxStepsPerFrame = 5;
    while (this.accumulator >= this.fixedStep && steps < maxStepsPerFrame) {
      this.update();
      this.accumulator -= this.fixedStep;
      steps++;
    }

    this.draw();
    this._raf = requestAnimationFrame((ts) => this._loop(ts));
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
  }
}
