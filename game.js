(function () {
  'use strict';

  /* ========================================
     Constants
     ======================================== */
  const PAD_FREQUENCIES = [329.63, 277.18, 220.00, 164.81]; // E4, C#4, A3, E3
  const PAD_COLORS = ['green', 'red', 'yellow', 'blue'];

  const SPEED_TABLE = [
    { round: 1, interval: 800 },
    { round: 5, interval: 650 },
    { round: 9, interval: 500 },
    { round: 13, interval: 400 },
    { round: 17, interval: 300 },
    { round: 20, interval: 250 },
  ];

  const MULTIPLIER_TABLE = [
    { round: 1, mult: 1 },
    { round: 5, mult: 1.5 },
    { round: 10, mult: 2 },
    { round: 15, mult: 3 },
    { round: 20, mult: 4 },
  ];

  const INPUT_TIMEOUT_MS = 5000;
  const PAD_LIGHT_DURATION = 300;
  const ROUND_WIN_DELAY = 600;
  const LS_HIGH_SCORE_KEY = 'simon_high_score';

  const KEY_MAP = {
    '1': 0, 'q': 0,
    '2': 1, 'w': 1,
    '3': 2, 'a': 2,
    '4': 3, 's': 3,
  };

  /* ========================================
     State
     ======================================== */
  const GameState = {
    IDLE: 'IDLE',
    COUNTDOWN: 'COUNTDOWN',
    PLAYBACK: 'PLAYBACK',
    PLAYER_INPUT: 'PLAYER_INPUT',
    ROUND_WIN: 'ROUND_WIN',
    GAME_OVER: 'GAME_OVER',
  };

  /* ========================================
     DOM Cache
     ======================================== */
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    startScreen: $('#start-screen'),
    gameScreen: $('#game-screen'),
    gameoverScreen: $('#gameover-screen'),
    startBtn: $('#start-btn'),
    restartBtn: $('#restart-btn'),
    menuBtn: $('#menu-btn'),
    strictToggle: $('#strict-toggle'),
    soundToggle: $('#sound-toggle'),
    musicToggle: $('#music-toggle'),
    pads: Array.from(document.querySelectorAll('.pad')),
    board: $('#simon-board'),
    centerText: $('#center-text'),
    hudRound: $('#hud-round'),
    hudScore: $('#hud-score'),
    hudHighScore: $('#hud-high-score'),
    hudMultiplier: $('#hud-multiplier'),
    strictIndicator: $('#strict-indicator'),
    gameStatus: $('#game-status'),
    countdownOverlay: $('#countdown-overlay'),
    countdownNumber: $('#countdown-number'),
    startHighScore: $('#start-high-score'),
    finalScore: $('#final-score'),
    finalRound: $('#final-round'),
    finalHighScore: $('#final-high-score'),
    newRecordCard: $('#new-record-card'),
    particleCanvas: $('#particle-canvas'),
  };

  /* ========================================
     Audio System
     ======================================== */
  const AudioSystem = {
    ctx: null,
    masterGain: null,
    sfxGain: null,
    droneGain: null,
    droneNodes: null,
    soundEnabled: true,
    musicEnabled: true,

    init() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1;
      this.sfxGain.connect(this.masterGain);

      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0;
      this.droneGain.connect(this.masterGain);
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    playPadTone(padIndex, duration = 0.35) {
      if (!this.soundEnabled || !this.ctx) return;
      const freq = PAD_FREQUENCIES[padIndex];
      const now = this.ctx.currentTime;

      // Sine oscillator
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = freq;

      // Triangle oscillator, detuned
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = freq;
      osc2.detune.value = 6;

      // ADSR envelope
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.5, now + 0.02);   // Attack
      env.gain.linearRampToValueAtTime(0.35, now + 0.08);   // Decay → Sustain
      env.gain.setValueAtTime(0.35, now + duration - 0.05);
      env.gain.linearRampToValueAtTime(0, now + duration);   // Release

      osc1.connect(env);
      osc2.connect(env);
      env.connect(this.sfxGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + duration + 0.01);
      osc2.stop(now + duration + 0.01);
    },

    playErrorBuzz(duration = 0.5) {
      if (!this.soundEnabled || !this.ctx) return;
      const now = this.ctx.currentTime;

      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 110;

      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 116;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.3, now + 0.02);
      env.gain.setValueAtTime(0.3, now + duration - 0.1);
      env.gain.linearRampToValueAtTime(0, now + duration);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(env);
      env.connect(this.sfxGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + duration + 0.01);
      osc2.stop(now + duration + 0.01);
    },

    playRoundWin() {
      if (!this.soundEnabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [329.63, 392.00, 523.25]; // E4, G4, C5 arpeggio

      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const env = this.ctx.createGain();
        const start = now + i * 0.1;
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(0.25, start + 0.02);
        env.gain.linearRampToValueAtTime(0, start + 0.2);

        osc.connect(env);
        env.connect(this.sfxGain);
        osc.start(start);
        osc.stop(start + 0.25);
      });
    },

    playGameOver() {
      if (!this.soundEnabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      // Descending chromatic
      const notes = [392.00, 369.99, 349.23, 329.63, 311.13, 293.66];

      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        const env = this.ctx.createGain();
        const start = now + i * 0.15;
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(0.2, start + 0.02);
        env.gain.linearRampToValueAtTime(0, start + 0.3);

        osc.connect(env);
        env.connect(this.sfxGain);
        osc.start(start);
        osc.stop(start + 0.35);
      });
    },

    startDrone() {
      if (!this.ctx || this.droneNodes) return;
      const now = this.ctx.currentTime;

      // A2 sine
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 110;

      // Detuned triangle
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 110;
      osc2.detune.value = 5;

      // Sub bass A1
      const osc3 = this.ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.value = 55;

      // LFO for breathing effect
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.15;

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.03;

      lfo.connect(lfoGain);

      const droneEnv = this.ctx.createGain();
      droneEnv.gain.value = 0.08;
      lfoGain.connect(droneEnv.gain);

      osc1.connect(droneEnv);
      osc2.connect(droneEnv);
      osc3.connect(droneEnv);
      droneEnv.connect(this.droneGain);

      osc1.start(now);
      osc2.start(now);
      osc3.start(now);
      lfo.start(now);

      // Fade in
      this.droneGain.gain.setValueAtTime(0, now);
      this.droneGain.gain.linearRampToValueAtTime(this.musicEnabled ? 1 : 0, now + 2);

      this.droneNodes = { osc1, osc2, osc3, lfo, lfoGain, droneEnv };
    },

    stopDrone() {
      if (!this.droneNodes || !this.ctx) return;
      const now = this.ctx.currentTime;
      this.droneGain.gain.linearRampToValueAtTime(0, now + 1);

      setTimeout(() => {
        if (this.droneNodes) {
          try {
            this.droneNodes.osc1.stop();
            this.droneNodes.osc2.stop();
            this.droneNodes.osc3.stop();
            this.droneNodes.lfo.stop();
          } catch (e) { /* already stopped */ }
          this.droneNodes = null;
        }
      }, 1200);
    },

    setMusicEnabled(enabled) {
      this.musicEnabled = enabled;
      if (this.ctx && this.droneGain) {
        const now = this.ctx.currentTime;
        this.droneGain.gain.linearRampToValueAtTime(enabled ? 1 : 0, now + 0.5);
      }
    },

    setSoundEnabled(enabled) {
      this.soundEnabled = enabled;
    },
  };

  /* ========================================
     Particle System
     ======================================== */
  const ParticleSystem = {
    canvas: null,
    ctx: null,
    particles: [],
    animId: null,
    width: 0,
    height: 0,

    init() {
      this.canvas = dom.particleCanvas;
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.spawnAmbient(40);
      this.animate();
    },

    resize() {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    },

    spawnAmbient(count) {
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          radius: Math.random() * 2 + 0.5,
          alpha: Math.random() * 0.4 + 0.1,
          color: `hsla(${180 + Math.random() * 40}, 80%, 70%, `,
          life: Infinity,
          ambient: true,
        });
      }
    },

    burst(x, y, color, count = 12) {
      const hue = { green: 145, red: 350, yellow: 55, blue: 220 }[color] || 180;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = Math.random() * 3 + 1.5;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: Math.random() * 3 + 1.5,
          alpha: 1,
          color: `hsla(${hue + Math.random() * 20 - 10}, 90%, 65%, `,
          life: 60 + Math.random() * 30,
          maxLife: 60 + Math.random() * 30,
          ambient: false,
        });
      }
    },

    animate() {
      this.ctx.clearRect(0, 0, this.width, this.height);

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (!p.ambient) {
          p.life--;
          p.alpha = (p.life / p.maxLife) * 0.9;
          p.vx *= 0.97;
          p.vy *= 0.97;
          if (p.life <= 0) {
            this.particles.splice(i, 1);
            continue;
          }
        } else {
          // Wrap around
          if (p.x < -10) p.x = this.width + 10;
          if (p.x > this.width + 10) p.x = -10;
          if (p.y < -10) p.y = this.height + 10;
          if (p.y > this.height + 10) p.y = -10;
          // Gentle alpha oscillation
          p.alpha = 0.15 + Math.sin(Date.now() * 0.001 + i) * 0.1;
        }

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = p.color + p.alpha + ')';
        this.ctx.fill();
      }

      this.animId = requestAnimationFrame(() => this.animate());
    },

    getPadCenter(padIndex) {
      const pad = dom.pads[padIndex];
      const rect = pad.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    },
  };

  /* ========================================
     Game Engine
     ======================================== */
  const Game = {
    state: GameState.IDLE,
    sequence: [],
    playerIndex: 0,
    round: 1,
    score: 0,
    highScore: 0,
    strict: false,
    inputTimer: null,
    playbackTimer: null,

    init() {
      this.highScore = parseInt(localStorage.getItem(LS_HIGH_SCORE_KEY) || '0', 10);
      this.updateHighScoreDisplays();
      this.bindEvents();
      ParticleSystem.init();
    },

    bindEvents() {
      dom.startBtn.addEventListener('click', () => this.startGame());
      dom.restartBtn.addEventListener('click', () => this.startGame());
      dom.menuBtn.addEventListener('click', () => this.goToMenu());

      dom.soundToggle.addEventListener('change', (e) => {
        AudioSystem.setSoundEnabled(e.target.checked);
      });
      dom.musicToggle.addEventListener('change', (e) => {
        AudioSystem.setMusicEnabled(e.target.checked);
      });

      // Pad clicks
      dom.pads.forEach((pad) => {
        const handler = (e) => {
          e.preventDefault();
          if (this.state !== GameState.PLAYER_INPUT) return;
          const idx = parseInt(pad.dataset.pad, 10);
          this.handlePlayerInput(idx);
        };
        pad.addEventListener('mousedown', handler);
        pad.addEventListener('touchstart', handler, { passive: false });
      });

      // Keyboard
      document.addEventListener('keydown', (e) => {
        if (this.state !== GameState.PLAYER_INPUT) return;
        const key = e.key.toLowerCase();
        if (key in KEY_MAP) {
          e.preventDefault();
          this.handlePlayerInput(KEY_MAP[key]);
        }
      });
    },

    startGame() {
      AudioSystem.init();
      AudioSystem.resume();
      AudioSystem.setSoundEnabled(dom.soundToggle.checked);
      AudioSystem.setMusicEnabled(dom.musicToggle.checked);

      this.strict = dom.strictToggle.checked;
      this.sequence = [];
      this.round = 1;
      this.score = 0;
      this.playerIndex = 0;

      this.updateHUD();
      this.showStrictIndicator();
      this.switchScreen('game');

      AudioSystem.startDrone();

      setTimeout(() => this.runCountdown(), 400);
    },

    goToMenu() {
      AudioSystem.stopDrone();
      this.state = GameState.IDLE;
      this.switchScreen('start');
    },

    /* --- Screen Management --- */
    switchScreen(name) {
      const screens = [dom.startScreen, dom.gameScreen, dom.gameoverScreen];
      const target = {
        start: dom.startScreen,
        game: dom.gameScreen,
        gameover: dom.gameoverScreen,
      }[name];

      screens.forEach((s) => {
        if (s === target) {
          s.classList.add('active');
          s.classList.add('entering');
          s.addEventListener('animationend', () => s.classList.remove('entering'), { once: true });
        } else {
          if (s.classList.contains('active')) {
            s.classList.add('exiting');
            s.classList.remove('active');
            s.addEventListener('animationend', () => s.classList.remove('exiting'), { once: true });
          }
        }
      });
    },

    /* --- Countdown --- */
    runCountdown() {
      this.state = GameState.COUNTDOWN;
      dom.countdownOverlay.classList.remove('hidden');
      let count = 3;

      const tick = () => {
        if (count > 0) {
          dom.countdownNumber.textContent = count;
          // Re-trigger animation
          dom.countdownNumber.style.animation = 'none';
          void dom.countdownNumber.offsetHeight;
          dom.countdownNumber.style.animation = '';

          if (AudioSystem.soundEnabled && AudioSystem.ctx) {
            const osc = AudioSystem.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = count === 1 ? 880 : 660;
            const env = AudioSystem.ctx.createGain();
            env.gain.setValueAtTime(0, AudioSystem.ctx.currentTime);
            env.gain.linearRampToValueAtTime(0.15, AudioSystem.ctx.currentTime + 0.02);
            env.gain.linearRampToValueAtTime(0, AudioSystem.ctx.currentTime + 0.2);
            osc.connect(env);
            env.connect(AudioSystem.sfxGain);
            osc.start();
            osc.stop(AudioSystem.ctx.currentTime + 0.25);
          }

          count--;
          setTimeout(tick, 800);
        } else {
          dom.countdownOverlay.classList.add('hidden');
          this.addToSequence();
          this.playSequence();
        }
      };

      tick();
    },

    /* --- Sequence --- */
    addToSequence() {
      this.sequence.push(Math.floor(Math.random() * 4));
    },

    getSpeed() {
      let speed = SPEED_TABLE[0].interval;
      for (const entry of SPEED_TABLE) {
        if (this.round >= entry.round) speed = entry.interval;
      }
      return speed;
    },

    getMultiplier() {
      let mult = 1;
      for (const entry of MULTIPLIER_TABLE) {
        if (this.round >= entry.round) mult = entry.mult;
      }
      return mult;
    },

    playSequence() {
      this.state = GameState.PLAYBACK;
      this.disablePads(true);
      dom.gameStatus.textContent = 'Watch carefully...';
      dom.centerText.textContent = `${this.round}`;

      const speed = this.getSpeed();
      let i = 0;

      const playNext = () => {
        if (i < this.sequence.length) {
          const padIdx = this.sequence[i];
          this.activatePad(padIdx, Math.min(speed * 0.6, PAD_LIGHT_DURATION));
          AudioSystem.playPadTone(padIdx, speed * 0.6 / 1000);
          i++;
          this.playbackTimer = setTimeout(playNext, speed);
        } else {
          // Done playing, enable input
          this.state = GameState.PLAYER_INPUT;
          this.playerIndex = 0;
          this.disablePads(false);
          dom.gameStatus.textContent = 'Your turn!';
          this.startInputTimer();
        }
      };

      this.playbackTimer = setTimeout(playNext, 400);
    },

    /* --- Pad Activation Visual --- */
    activatePad(index, duration = PAD_LIGHT_DURATION) {
      const pad = dom.pads[index];
      pad.classList.add('active');

      // Particle burst
      const center = ParticleSystem.getPadCenter(index);
      ParticleSystem.burst(center.x, center.y, PAD_COLORS[index], 10);

      setTimeout(() => {
        pad.classList.remove('active');
      }, duration);
    },

    disablePads(disabled) {
      dom.pads.forEach((p) => {
        if (disabled) {
          p.classList.add('disabled');
        } else {
          p.classList.remove('disabled');
        }
      });
    },

    /* --- Input Timer --- */
    startInputTimer() {
      this.clearInputTimer();
      this.inputTimer = setTimeout(() => {
        if (this.state === GameState.PLAYER_INPUT) {
          this.handleWrongInput();
        }
      }, INPUT_TIMEOUT_MS);
    },

    clearInputTimer() {
      if (this.inputTimer) {
        clearTimeout(this.inputTimer);
        this.inputTimer = null;
      }
    },

    /* --- Player Input --- */
    handlePlayerInput(padIndex) {
      if (this.state !== GameState.PLAYER_INPUT) return;

      this.clearInputTimer();
      this.activatePad(padIndex);
      AudioSystem.playPadTone(padIndex);

      const expected = this.sequence[this.playerIndex];

      if (padIndex !== expected) {
        this.handleWrongInput();
        return;
      }

      // Correct
      this.playerIndex++;

      if (this.playerIndex >= this.sequence.length) {
        // Round complete
        this.handleRoundWin();
      } else {
        this.startInputTimer();
      }
    },

    handleWrongInput() {
      this.disablePads(true);
      AudioSystem.playErrorBuzz();

      // Flash all pads with error
      dom.pads.forEach((p) => p.classList.add('error-flash'));
      dom.board.classList.add('shake');

      setTimeout(() => {
        dom.pads.forEach((p) => p.classList.remove('error-flash'));
        dom.board.classList.remove('shake');
      }, 500);

      if (this.strict) {
        // Strict mode: game over
        dom.gameStatus.textContent = 'Wrong! Game Over.';
        setTimeout(() => this.gameOver(), 1200);
      } else {
        // Normal mode: replay sequence
        dom.gameStatus.textContent = 'Wrong! Try again...';
        setTimeout(() => {
          this.playSequence();
        }, 1500);
      }
    },

    handleRoundWin() {
      this.state = GameState.ROUND_WIN;
      this.disablePads(true);

      // Calculate score
      const mult = this.getMultiplier();
      const points = Math.floor(this.round * 10 * mult);
      this.score += points;

      // Check high score
      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem(LS_HIGH_SCORE_KEY, this.highScore.toString());
      }

      AudioSystem.playRoundWin();
      dom.gameStatus.textContent = `+${points} points!`;

      // Animate score
      dom.hudScore.classList.add('score-pop');
      setTimeout(() => dom.hudScore.classList.remove('score-pop'), 300);

      this.round++;
      this.updateHUD();

      setTimeout(() => {
        this.addToSequence();
        this.playSequence();
      }, ROUND_WIN_DELAY);
    },

    gameOver() {
      this.state = GameState.GAME_OVER;
      this.clearInputTimer();
      clearTimeout(this.playbackTimer);
      AudioSystem.playGameOver();
      AudioSystem.stopDrone();

      // Update game over screen
      dom.finalScore.textContent = this.score;
      dom.finalRound.textContent = this.round;
      dom.finalHighScore.textContent = this.highScore;

      // New record?
      const isNewRecord = this.score >= this.highScore && this.score > 0;
      if (isNewRecord) {
        dom.newRecordCard.classList.remove('hidden');
      } else {
        dom.newRecordCard.classList.add('hidden');
      }

      this.updateHighScoreDisplays();
      this.switchScreen('gameover');
    },

    /* --- HUD --- */
    updateHUD() {
      dom.hudRound.textContent = this.round;
      dom.hudScore.textContent = this.score;
      dom.hudHighScore.textContent = this.highScore;

      const mult = this.getMultiplier();
      dom.hudMultiplier.textContent = mult === 1 ? '×1' : `×${mult}`;
    },

    updateHighScoreDisplays() {
      dom.startHighScore.textContent = this.highScore;
      dom.hudHighScore.textContent = this.highScore;
    },

    showStrictIndicator() {
      if (this.strict) {
        dom.strictIndicator.classList.remove('hidden');
      } else {
        dom.strictIndicator.classList.add('hidden');
      }
    },
  };

  /* ========================================
     Boot
     ======================================== */
  document.addEventListener('DOMContentLoaded', () => {
    Game.init();
  });
})();
