const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === GAME DATA ===
const animals = [
  { kanji: '犬', hiragana: 'いぬ', english: 'dog', emoji: '🐕' },
  { kanji: '猫', hiragana: 'ねこ', english: 'cat', emoji: '🐱' },
  { kanji: '鳥', hiragana: 'とり', english: 'bird', emoji: '🐦' },
  { kanji: '魚', hiragana: 'さかな', english: 'fish', emoji: '🐟' },
  { kanji: '馬', hiragana: 'うま', english: 'horse', emoji: '🐴' },
  { kanji: '牛', hiragana: 'うし', english: 'cow', emoji: '🐄' },
  { kanji: '虫', hiragana: 'むし', english: 'insect', emoji: '🐛' },
  { kanji: '羊', hiragana: 'ひつじ', english: 'sheep', emoji: '🐑' },
  { kanji: '熊', hiragana: 'くま', english: 'bear', emoji: '🐻' },
  { kanji: '豚', hiragana: 'ぶた', english: 'pig', emoji: '🐷' },
  { kanji: '兎', hiragana: 'うさぎ', english: 'rabbit', emoji: '🐰' },
  { kanji: '象', hiragana: 'ぞう', english: 'elephant', emoji: '🐘' }
];

// === GAME CONSTANTS ===
const TIME_LIMIT = 10000;    // 10 seconds per question
const REVEAL_TIME = 3500;    // 3.5 seconds to show answer
const TOTAL_ANIMALS = 10;    // 10 animals × 2 (kanji + hiragana) = 20 questions

// === GAME STATE ===
let gameState = {
  phase: 'lobby', // lobby, playing, results
  players: {},
  currentQuestion: null,
  currentAnimal: null,
  questionStartTime: null,
  questionNumber: 0,
  totalQuestions: TOTAL_ANIMALS * 2,
  usedAnimals: [],
  timerHandle: null,
  paused: false,
  pausedTimeRemaining: null,
  currentStep: 'kanji', // 'kanji' or 'hiragana'
  animalIndex: 0
};

// === HELPER FUNCTIONS ===
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateQuestion() {
  let available = animals.filter(a => !gameState.usedAnimals.includes(a.kanji));
  if (available.length === 0) {
    gameState.usedAnimals = [];
    available = animals;
  }

  const correct = available[Math.floor(Math.random() * available.length)];
  gameState.usedAnimals.push(correct.kanji);
  gameState.currentAnimal = correct;

  const isKanjiToAnimal = Math.random() > 0.5;
  const wrong = shuffle(animals.filter(a => a.kanji !== correct.kanji)).slice(0, 3);
  const options = shuffle([correct, ...wrong]);

  return {
    type: isKanjiToAnimal ? 'kanjiToAnimal' : 'animalToKanji',
    prompt: isKanjiToAnimal ? correct.kanji : correct.emoji,
    options: options.map(a => ({
      id: a.kanji,
      display: isKanjiToAnimal ? a.emoji : a.kanji
    })),
    correctId: correct.kanji
  };
}

function generateHiraganaQuestion() {
  const correct = gameState.currentAnimal;
  const wrong = shuffle(animals.filter(a => a.kanji !== correct.kanji)).slice(0, 3);
  const options = shuffle([correct, ...wrong]);

  return {
    type: 'hiragana',
    prompt: correct.kanji,
    options: options.map(a => ({
      id: a.kanji,
      display: a.hiragana
    })),
    correctId: correct.kanji
  };
}

function calculateScore(timeMs) {
  const points = Math.max(100, Math.round(1000 - (timeMs / TIME_LIMIT) * 900));
  return points;
}

function getLeaderboard() {
  const entries = Object.entries(gameState.players)
    .sort((a, b) => b[1].score - a[1].score);
  let currentRank = 1;
  return entries.map(([id, p], i) => {
    if (i > 0 && p.score < entries[i - 1][1].score) currentRank = i + 1;
    return { rank: currentRank, name: p.name, score: p.score, id };
  });
}

function resetPlayerAnswers() {
  for (const id in gameState.players) {
    gameState.players[id].answered = false;
    gameState.players[id].lastAnswer = null;
  }
}

function clearGameTimer() {
  if (gameState.timerHandle) {
    clearTimeout(gameState.timerHandle);
    gameState.timerHandle = null;
  }
}

// === AUTO-ADVANCE ENGINE ===
function runNextStep() {
  clearGameTimer();
  resetPlayerAnswers();

  if (gameState.animalIndex >= TOTAL_ANIMALS) {
    gameState.phase = 'results';
    io.emit('gameOver', getLeaderboard());
    return;
  }

  gameState.questionNumber++;

  if (gameState.currentStep === 'kanji') {
    gameState.currentQuestion = generateQuestion();
    gameState.questionStartTime = Date.now();
    io.emit('newQuestion', {
      question: gameState.currentQuestion,
      questionNumber: gameState.questionNumber,
      total: gameState.totalQuestions,
      timeLimit: TIME_LIMIT
    });
  } else {
    gameState.currentQuestion = generateHiraganaQuestion();
    gameState.questionStartTime = Date.now();
    io.emit('hiraganaQuestion', {
      question: gameState.currentQuestion,
      questionNumber: gameState.questionNumber,
      total: gameState.totalQuestions,
      timeLimit: TIME_LIMIT
    });
  }

  gameState.timerHandle = setTimeout(onTimerExpired, TIME_LIMIT);
}

function onTimerExpired() {
  clearGameTimer();
  const animal = gameState.currentAnimal;
  io.emit('timeUp');
  io.emit('showAnswer', {
    kanji: animal.kanji,
    hiragana: animal.hiragana,
    english: animal.english,
    emoji: animal.emoji
  });
  gameState.timerHandle = setTimeout(advanceAfterReveal, REVEAL_TIME);
}

function advanceAfterReveal() {
  clearGameTimer();
  if (gameState.currentStep === 'kanji') {
    gameState.currentStep = 'hiragana';
  } else {
    gameState.currentStep = 'kanji';
    gameState.animalIndex++;
  }
  runNextStep();
}

function checkAllAnswered() {
  const players = Object.values(gameState.players);
  if (players.length === 0) return;
  const allAnswered = players.every(p => p.answered);
  if (allAnswered) {
    clearGameTimer();
    onTimerExpired();
  }
}

// === SOCKET HANDLING ===
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Player joins
  socket.on('join', (name) => {
    gameState.players[socket.id] = {
      name: name.substring(0, 15),
      score: 0,
      answered: false,
      lastAnswer: null
    };
    socket.emit('joined', { phase: gameState.phase });
    io.emit('playerList', Object.values(gameState.players).map(p => p.name));
    io.emit('leaderboard', getLeaderboard());
    console.log(`${name} joined`);
  });

  // Player answers
  socket.on('answer', (answerId) => {
    const player = gameState.players[socket.id];
    if (!player || player.answered || !gameState.currentQuestion || gameState.paused) return;

    player.answered = true;
    const timeMs = Date.now() - gameState.questionStartTime;
    const correct = answerId === gameState.currentQuestion.correctId;

    if (correct) {
      const points = calculateScore(timeMs);
      player.score += points;
      player.lastAnswer = { correct: true, points };
    } else {
      player.lastAnswer = { correct: false, points: 0 };
    }

    socket.emit('answerResult', player.lastAnswer);
    io.emit('leaderboard', getLeaderboard());
    checkAllAnswered();
  });

  // Host: Start Game
  socket.on('hostStartGame', () => {
    gameState.phase = 'playing';
    gameState.questionNumber = 0;
    gameState.usedAnimals = [];
    gameState.animalIndex = 0;
    gameState.currentStep = 'kanji';
    gameState.paused = false;
    gameState.pausedTimeRemaining = null;
    clearGameTimer();
    for (const id in gameState.players) {
      gameState.players[id].score = 0;
    }
    io.emit('gameStarted');
    io.emit('leaderboard', getLeaderboard());
    runNextStep();
  });

  // Host: Pause Game
  socket.on('hostPauseGame', () => {
    if (gameState.phase !== 'playing' || gameState.paused) return;
    gameState.paused = true;
    const elapsed = Date.now() - gameState.questionStartTime;
    gameState.pausedTimeRemaining = Math.max(0, TIME_LIMIT - elapsed);
    clearGameTimer();
    io.emit('gamePaused');
  });

  // Host: Resume Game
  socket.on('hostResumeGame', () => {
    if (gameState.phase !== 'playing' || !gameState.paused) return;
    gameState.paused = false;
    gameState.questionStartTime = Date.now() - (TIME_LIMIT - gameState.pausedTimeRemaining);
    gameState.timerHandle = setTimeout(onTimerExpired, gameState.pausedTimeRemaining);
    gameState.pausedTimeRemaining = null;
    io.emit('gameResumed', { timeRemaining: TIME_LIMIT - (Date.now() - gameState.questionStartTime) });
  });

  // Host: Stop / Reset Game
  socket.on('hostStopGame', () => {
    clearGameTimer();
    gameState.phase = 'lobby';
    gameState.questionNumber = 0;
    gameState.usedAnimals = [];
    gameState.currentQuestion = null;
    gameState.paused = false;
    gameState.pausedTimeRemaining = null;
    gameState.animalIndex = 0;
    gameState.currentStep = 'kanji';
    for (const id in gameState.players) {
      gameState.players[id].score = 0;
      gameState.players[id].answered = false;
    }
    io.emit('gameReset');
    io.emit('leaderboard', getLeaderboard());
  });

  socket.on('hostResetGame', () => {
    clearGameTimer();
    gameState.phase = 'lobby';
    gameState.questionNumber = 0;
    gameState.usedAnimals = [];
    gameState.currentQuestion = null;
    gameState.paused = false;
    gameState.pausedTimeRemaining = null;
    gameState.animalIndex = 0;
    gameState.currentStep = 'kanji';
    for (const id in gameState.players) {
      gameState.players[id].score = 0;
      gameState.players[id].answered = false;
    }
    io.emit('gameReset');
    io.emit('leaderboard', getLeaderboard());
  });

  // Disconnect
  socket.on('disconnect', () => {
    const player = gameState.players[socket.id];
    if (player) console.log(`${player.name} left`);
    delete gameState.players[socket.id];
    io.emit('playerList', Object.values(gameState.players).map(p => p.name));
    io.emit('leaderboard', getLeaderboard());
  });
});

// === HTML PAGES ===
const hostHTML = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>漢字の動物園 - Host</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Noto Serif JP', serif; background: #f7f3e9; color: #1a1a1a; min-height: 100vh; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; font-size: 3rem; margin-bottom: 10px; color: #c03030; font-weight: 700; }
    .subtitle { text-align: center; color: #6b6b6b; margin-bottom: 30px; letter-spacing: 0.05em; }
    .join-info { background: #faf6ed; border: 1px solid #c4b8a8; padding: 20px; border-radius: 6px; text-align: center; margin-bottom: 30px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    .join-url { font-size: 1.8rem; color: #c03030; font-weight: 700; }
    .main-display { background: #faf6ed; border: 1px solid #c4b8a8; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border-radius: 6px; padding: 40px; text-align: center; min-height: 300px; margin-bottom: 30px; position: relative; }
    .question-num { color: #6b6b6b; font-size: 1.2rem; margin-bottom: 20px; }
    .prompt { font-size: 8rem; margin: 20px 0; }
    .options-display { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; max-width: 600px; margin: 0 auto; }
    .option-box { background: #f7f3e9; border: 1px solid #c4b8a8; padding: 30px; border-radius: 6px; font-size: 3rem; }
    .answer-reveal { background: #e8f0e4; color: #1a1a1a; padding: 30px; border-radius: 6px; margin-top: 20px; border: 1px solid #c4b8a8; }
    .answer-reveal .emoji { font-size: 5rem; }
    .answer-reveal .text { font-size: 2rem; margin-top: 10px; }
    .controls { display: flex; flex-wrap: wrap; gap: 15px; justify-content: center; margin-bottom: 30px; }
    .btn { padding: 15px 30px; font-size: 1.2rem; border: none; border-radius: 4px; cursor: pointer; font-family: 'Noto Serif JP', serif; transition: transform 0.2s, box-shadow 0.2s; }
    .btn:hover { transform: translateY(-1px) rotate(-0.5deg); box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .btn-primary { background: #c03030; color: #faf6ed; letter-spacing: 0.05em; }
    .btn-secondary { background: #faf6ed; color: #c03030; border: 1px solid #c03030; }
    .btn-success { background: #2d7a3a; color: #faf6ed; }
    .btn-warning { background: #c49000; color: #faf6ed; }
    .sidebar { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .panel { background: #faf6ed; border: 1px solid #c4b8a8; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border-radius: 6px; padding: 20px; }
    .panel h3 { margin-bottom: 15px; color: #c03030; }
    .player-list { list-style: none; }
    .player-list li { padding: 8px 0; border-bottom: 1px solid #c4b8a8; }
    .leaderboard-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #c4b8a8; }
    .rank-1 { color: gold; font-weight: bold; }
    .rank-2 { color: silver; }
    .rank-3 { color: #cd7f32; }
    .final-results { text-align: center; }
    .final-results h2 { font-size: 2.5rem; margin-bottom: 30px; }
    .winner { font-size: 4rem; margin: 20px 0; }
    .winner-name { color: gold; font-size: 3rem; }
    .timer { font-size: 4rem; font-weight: 700; color: #faf6ed; background: #1a1a1a; width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.25); border: 3px solid #2b2b2b; transition: background 0.3s, transform 0.3s; }
    .timer.urgent { background: #c03030; border-color: #c03030; animation: pulse-scale 0.5s infinite alternate; box-shadow: 0 4px 15px rgba(192,48,48,0.5); }
    @keyframes pulse-scale { from { opacity: 1; transform: scale(1); } to { opacity: 0.7; transform: scale(1.1); } }
    .paused-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(247,243,233,0.92); display: flex; align-items: center; justify-content: center; font-size: 3rem; color: #1a1a1a; font-weight: 700; border-radius: 6px; letter-spacing: 0.1em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>漢字の動物園</h1>
    <p class="subtitle">Kanji Zoo — Animal Kanji Learning Game</p>

    <div class="join-info">
      <p>Players join at:</p>
      <p class="join-url" id="joinUrl"></p>
      <canvas id="qrcode" style="margin-top:15px;"></canvas>
    </div>

    <div class="main-display" id="mainDisplay">
      <p style="font-size: 2rem; color: #6b6b6b;">Waiting for players...</p>
    </div>

    <div class="controls" id="controls">
      <button class="btn btn-primary" onclick="startGame()">Start Game</button>
    </div>

    <div class="sidebar">
      <div class="panel">
        <h3>Players (<span id="playerCount">0</span>)</h3>
        <ul class="player-list" id="playerList"></ul>
      </div>
      <div class="panel">
        <h3>Leaderboard</h3>
        <div id="leaderboard"></div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
  <script>
    const socket = io();
    let currentPhase = 'lobby';
    let lastPlayerCount = 0;
    let countdownInterval = null;
    let isPaused = false;
    let frozenTime = null;

    // Sound effects using Web Audio API
    const SoundFX = {
      ctx: null,
      init() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      },
      _tone(freq, duration, type, vol) {
        if (!this.ctx) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        g.gain.value = vol || 0.3;
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + duration);
      },
      playerJoin() { this.init(); this._tone(500, 0.1, 'sine', 0.15); },
      question() { this.init(); this._tone(880, 0.15, 'sine', 0.2); },
      tick() { this.init(); this._tone(800, 0.03, 'sine', 0.1); },
      tickUrgent() { this.init(); this._tone(1000, 0.06, 'square', 0.15); },
      gameOver() {
        this.init();
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'sine', 0.25), i * 150));
      }
    };
    document.addEventListener('click', () => SoundFX.init(), { once: true });

    // Show join URL and QR code
    const joinUrl = window.location.origin;
    document.getElementById('joinUrl').textContent = window.location.host;
    QRCode.toCanvas(document.getElementById('qrcode'), joinUrl, { width: 200, margin: 1, color: { dark: '#1a1a1a', light: '#faf6ed' } });

    function stopCountdown() {
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    }

    function startCountdown(timeLimit) {
      stopCountdown();
      const startTime = Date.now();
      let lastSec = -1;
      countdownInterval = setInterval(() => {
        if (isPaused) return;
        const el = document.getElementById('hostTimer');
        if (!el) { stopCountdown(); return; }
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, Math.ceil((timeLimit - elapsed) / 1000));
        el.textContent = remaining;
        el.className = remaining <= 3 ? 'timer urgent' : 'timer';
        if (remaining !== lastSec && remaining > 0) {
          lastSec = remaining;
          remaining <= 3 ? SoundFX.tickUrgent() : SoundFX.tick();
        }
        if (remaining <= 0) stopCountdown();
      }, 100);
    }

    // Update player list
    socket.on('playerList', (players) => {
      if (players.length > lastPlayerCount) SoundFX.playerJoin();
      lastPlayerCount = players.length;
      document.getElementById('playerCount').textContent = players.length;
      document.getElementById('playerList').innerHTML = players.map(p => '<li>' + p + '</li>').join('');
    });

    // Update leaderboard
    socket.on('leaderboard', (lb) => {
      document.getElementById('leaderboard').innerHTML = lb.map((p, i) =>
        '<div class="leaderboard-item ' + (i < 3 ? 'rank-' + (i+1) : '') + '">' +
        '<span>#' + p.rank + ' ' + p.name + '</span><span>' + p.score + '</span></div>'
      ).join('');
    });

    // Question display
    socket.on('newQuestion', (data) => {
      SoundFX.question();
      currentPhase = 'playing';
      isPaused = false;
      const q = data.question;
      document.getElementById('mainDisplay').innerHTML =
        '<div class="timer" id="hostTimer">10</div>' +
        '<p class="question-num">Question ' + data.questionNumber + ' / ' + data.total + '</p>' +
        '<div class="prompt">' + q.prompt + '</div>' +
        '<div class="options-display">' + q.options.map(o =>
          '<div class="option-box">' + o.display + '</div>'
        ).join('') + '</div>';
      startCountdown(data.timeLimit);
      updateControls();
    });

    // Hiragana question
    socket.on('hiraganaQuestion', (data) => {
      SoundFX.question();
      currentPhase = 'playing';
      isPaused = false;
      const q = data.question;
      document.getElementById('mainDisplay').innerHTML =
        '<div class="timer" id="hostTimer">10</div>' +
        '<p class="question-num">Question ' + data.questionNumber + ' / ' + data.total + ' (Hiragana)</p>' +
        '<div class="prompt">' + q.prompt + '</div>' +
        '<p style="color:#6b6b6b;margin-bottom:20px;">Match the hiragana reading</p>' +
        '<div class="options-display">' + q.options.map(o =>
          '<div class="option-box">' + o.display + '</div>'
        ).join('') + '</div>';
      startCountdown(data.timeLimit);
      updateControls();
    });

    // Time up
    socket.on('timeUp', () => {
      stopCountdown();
      const el = document.getElementById('hostTimer');
      if (el) { el.textContent = '0'; el.className = 'timer urgent'; }
    });

    // Show answer
    socket.on('showAnswer', (animal) => {
      document.getElementById('mainDisplay').innerHTML +=
        '<div class="answer-reveal"><div class="emoji">' + animal.emoji + '</div>' +
        '<div class="text">' + animal.kanji + ' = ' + animal.hiragana + ' (' + animal.english + ')</div></div>';
    });

    // Game over
    socket.on('gameOver', (lb) => {
      SoundFX.gameOver();
      stopCountdown();
      currentPhase = 'results';
      const winner = lb[0];
      let html = '<div class="final-results"><h2>Game Over</h2>' +
        '<div class="winner">&#x7D42;</div>' +
        '<div class="winner-name">' + (winner ? winner.name : 'No players') + '</div>' +
        '<p style="font-size:1.5rem;color:#6b6b6b;margin-top:10px;">' + (winner ? winner.score + ' points' : '') + '</p>';
      if (lb.length > 1) {
        html += '<div style="margin-top:30px;max-width:400px;margin-left:auto;margin-right:auto;">';
        lb.forEach(function(p) {
          html += '<div class="leaderboard-item"><span>#' + p.rank + ' ' + p.name + '</span><span>' + p.score + '</span></div>';
        });
        html += '</div>';
      }
      html += '</div>';
      document.getElementById('mainDisplay').innerHTML = html;
      updateControls();
    });

    // Game paused
    socket.on('gamePaused', () => {
      isPaused = true;
      const display = document.getElementById('mainDisplay');
      if (display && !document.getElementById('pausedOverlay')) {
        display.innerHTML += '<div class="paused-overlay" id="pausedOverlay">PAUSED</div>';
      }
      updateControls();
    });

    // Game resumed
    socket.on('gameResumed', (data) => {
      isPaused = false;
      const overlay = document.getElementById('pausedOverlay');
      if (overlay) overlay.remove();
      updateControls();
    });

    // Game reset
    socket.on('gameReset', () => {
      stopCountdown();
      currentPhase = 'lobby';
      isPaused = false;
      document.getElementById('mainDisplay').innerHTML = '<p style="font-size: 2rem; color: #6b6b6b;">Waiting for players...</p>';
      updateControls();
    });

    // Control buttons
    function updateControls() {
      let html = '';
      if (currentPhase === 'lobby' || currentPhase === 'results') {
        html = '<button class="btn btn-primary" onclick="startGame()">Start Game</button>';
      } else if (currentPhase === 'playing') {
        if (isPaused) {
          html = '<button class="btn btn-success" onclick="resumeGame()">Resume</button>';
        } else {
          html = '<button class="btn btn-warning" onclick="pauseGame()">Pause</button>';
        }
        html += '<button class="btn btn-secondary" onclick="stopGame()">Stop Game</button>';
      }
      document.getElementById('controls').innerHTML = html;
    }

    function startGame() { socket.emit('hostStartGame'); }
    function pauseGame() { socket.emit('hostPauseGame'); }
    function resumeGame() { socket.emit('hostResumeGame'); }
    function stopGame() { socket.emit('hostStopGame'); }

    updateControls();
  </script>
</body></html>`;

const playerHTML = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>漢字の動物園 - Play</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Noto Serif JP', serif; background: #f7f3e9; color: #1a1a1a; min-height: 100vh; display: flex; flex-direction: column; }
    .container { flex: 1; display: flex; flex-direction: column; padding: 20px; max-width: 500px; margin: 0 auto; width: 100%; }
    h1 { text-align: center; font-size: 2rem; margin-bottom: 20px; color: #c03030; font-weight: 700; }
    .join-form { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px; }
    .join-form input { width: 100%; padding: 20px; font-size: 1.5rem; background: #faf6ed; color: #1a1a1a; border: 1px solid #c4b8a8; border-radius: 6px; text-align: center; font-family: 'Noto Serif JP', serif; }
    .btn { width: 100%; padding: 20px; font-size: 1.5rem; border: none; border-radius: 4px; cursor: pointer; font-family: 'Noto Serif JP', serif; transition: transform 0.1s; }
    .btn:active { transform: scale(0.98); }
    .btn-primary { background: #c03030; color: #faf6ed; letter-spacing: 0.05em; }
    .btn-disabled { background: #d5cfc5; color: #8a8378; }
    .game-view { flex: 1; display: flex; flex-direction: column; }
    .status { text-align: center; padding: 15px; background: #faf6ed; border: 1px solid #c4b8a8; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border-radius: 6px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; }
    .score { font-size: 1.5rem; font-weight: 700; color: #c03030; }
    .player-timer { font-size: 1.8rem; font-weight: 700; color: #faf6ed; background: #1a1a1a; width: 50px; height: 50px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.2); border: 2px solid #2b2b2b; transition: background 0.3s, transform 0.3s; }
    .player-timer:empty { display: none; }
    .player-timer.urgent { background: #c03030; border-color: #c03030; animation: player-pulse 0.5s infinite alternate; box-shadow: 0 2px 10px rgba(192,48,48,0.5); }
    @keyframes player-pulse { from { transform: scale(1); } to { transform: scale(1.15); } }
    .prompt { text-align: center; font-size: 5rem; margin: 20px 0; }
    .options { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; flex: 1; }
    .option { display: flex; align-items: center; justify-content: center; font-size: 3rem; background: #faf6ed; border: 1px solid #c4b8a8; border-radius: 6px; color: #1a1a1a; cursor: pointer; transition: background 0.2s, transform 0.1s; min-height: 100px; }
    .option:active { transform: scale(0.98); }
    .option.correct { background: #2d7a3a; color: #faf6ed; }
    .option.wrong { background: #c03030; color: #faf6ed; }
    .option.disabled { opacity: 0.5; pointer-events: none; }
    .result { text-align: center; padding: 30px; }
    .result-icon { font-size: 4rem; }
    .result-text { font-size: 1.5rem; margin-top: 10px; }
    .result-points { font-size: 2rem; color: #c03030; margin-top: 10px; }
    .waiting { text-align: center; font-size: 1.5rem; color: #6b6b6b; padding: 50px 0; }
    .hidden { display: none !important; }
    .paused-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(247,243,233,0.92); display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: #1a1a1a; font-weight: 700; z-index: 100; letter-spacing: 0.1em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>漢字の動物園</h1>

    <div class="join-form" id="joinForm">
      <input type="text" id="nameInput" placeholder="Your name" maxlength="15">
      <button class="btn btn-primary" onclick="joinGame()">Join Game</button>
    </div>

    <div class="game-view hidden" id="gameView">
      <div class="status">
        <span>Score: <span class="score" id="score">0</span></span>
        <span class="player-timer" id="playerTimer"></span>
      </div>

      <div id="questionArea" class="hidden">
        <div class="prompt" id="prompt"></div>
        <div class="options" id="options"></div>
      </div>

      <div id="resultArea" class="hidden">
        <div class="result">
          <div class="result-icon" id="resultIcon"></div>
          <div class="result-text" id="resultText"></div>
          <div class="result-points" id="resultPoints"></div>
        </div>
      </div>

      <div id="waitingArea">
        <p class="waiting">Waiting for the game to start...</p>
      </div>
    </div>
  </div>

  <div class="paused-overlay hidden" id="pausedOverlay">PAUSED</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let myScore = 0;
    let answered = false;
    let currentCorrectId = null;
    let countdownInterval = null;
    let isPaused = false;

    // Sound effects using Web Audio API
    const SoundFX = {
      ctx: null,
      init() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      },
      _tone(freq, duration, type, vol) {
        if (!this.ctx) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        g.gain.value = vol || 0.3;
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + duration);
      },
      correct() {
        this.init();
        this._tone(440, 0.15, 'sine', 0.3);
        setTimeout(() => this._tone(660, 0.25, 'sine', 0.3), 120);
      },
      wrong() { this.init(); this._tone(200, 0.3, 'square', 0.15); },
      question() { this.init(); this._tone(880, 0.15, 'sine', 0.2); },
      tick() { this.init(); this._tone(800, 0.03, 'sine', 0.1); },
      tickUrgent() { this.init(); this._tone(1000, 0.06, 'square', 0.15); },
      gameOver() {
        this.init();
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'sine', 0.25), i * 150));
      }
    };
    document.addEventListener('click', () => SoundFX.init(), { once: true });

    function stopCountdown() {
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      const el = document.getElementById('playerTimer');
      if (el) el.textContent = '';
    }

    function startCountdown(timeLimit) {
      stopCountdown();
      const startTime = Date.now();
      const el = document.getElementById('playerTimer');
      let lastSec = -1;
      countdownInterval = setInterval(() => {
        if (isPaused) return;
        if (!el) { stopCountdown(); return; }
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, Math.ceil((timeLimit - elapsed) / 1000));
        el.textContent = remaining;
        el.className = remaining <= 3 ? 'player-timer urgent' : 'player-timer';
        if (remaining !== lastSec && remaining > 0) {
          lastSec = remaining;
          remaining <= 3 ? SoundFX.tickUrgent() : SoundFX.tick();
        }
        if (remaining <= 0) { clearInterval(countdownInterval); countdownInterval = null; }
      }, 100);
    }

    function joinGame() {
      const name = document.getElementById('nameInput').value.trim();
      if (!name) return alert('Please enter your name');
      socket.emit('join', name);
    }

    socket.on('joined', () => {
      document.getElementById('joinForm').classList.add('hidden');
      document.getElementById('gameView').classList.remove('hidden');
    });

    socket.on('gameStarted', () => {
      myScore = 0;
      document.getElementById('score').textContent = '0';
    });

    function showQuestion(q, timeLimit) {
      SoundFX.question();
      answered = false;
      currentCorrectId = q.correctId;
      document.getElementById('waitingArea').classList.add('hidden');
      document.getElementById('resultArea').classList.add('hidden');
      document.getElementById('questionArea').classList.remove('hidden');
      document.getElementById('prompt').textContent = q.prompt;

      document.getElementById('options').innerHTML = q.options.map(o =>
        '<button class="option" data-id="' + o.id + '" onclick="answer(this)">' + o.display + '</button>'
      ).join('');

      startCountdown(timeLimit);
    }

    socket.on('newQuestion', (data) => showQuestion(data.question, data.timeLimit));
    socket.on('hiraganaQuestion', (data) => showQuestion(data.question, data.timeLimit));

    // Time up — disable buttons if not answered
    socket.on('timeUp', () => {
      stopCountdown();
      const el = document.getElementById('playerTimer');
      if (el) { el.textContent = '0'; el.className = 'player-timer urgent'; }
      if (!answered) {
        answered = true;
        document.querySelectorAll('.option').forEach(b => b.classList.add('disabled'));
        const correctBtn = document.querySelector('.option[data-id="' + currentCorrectId + '"]');
        if (correctBtn) correctBtn.classList.add('correct');
      }
    });

    function answer(btn) {
      if (answered) return;
      answered = true;

      const id = btn.dataset.id;
      socket.emit('answer', id);

      document.querySelectorAll('.option').forEach(b => b.classList.add('disabled'));

      if (id === currentCorrectId) {
        btn.classList.add('correct');
      } else {
        btn.classList.add('wrong');
        document.querySelector('.option[data-id="' + currentCorrectId + '"]').classList.add('correct');
      }
    }

    socket.on('answerResult', (result) => {
      if (result.correct) SoundFX.correct(); else SoundFX.wrong();
      myScore += result.points;
      document.getElementById('score').textContent = myScore;
    });

    socket.on('showAnswer', () => {
      // Answer is shown on host; player stays on question/result view until next question
    });

    socket.on('gameOver', (lb) => {
      SoundFX.gameOver();
      stopCountdown();
      document.getElementById('questionArea').classList.add('hidden');
      document.getElementById('resultArea').classList.add('hidden');
      document.getElementById('waitingArea').classList.remove('hidden');

      const me = lb.find(p => p.id === socket.id);
      const myRank = me ? me.rank : '-';
      document.getElementById('waitingArea').innerHTML =
        '<p class="waiting">Game Over — 終</p>' +
        '<p class="waiting">Your score: ' + myScore + '</p>' +
        '<p class="waiting">Rank: #' + myRank + ' of ' + lb.length + '</p>';
    });

    // Pause / Resume
    socket.on('gamePaused', () => {
      isPaused = true;
      document.getElementById('pausedOverlay').classList.remove('hidden');
    });

    socket.on('gameResumed', () => {
      isPaused = false;
      document.getElementById('pausedOverlay').classList.add('hidden');
    });

    socket.on('gameReset', () => {
      myScore = 0;
      isPaused = false;
      stopCountdown();
      document.getElementById('score').textContent = '0';
      document.getElementById('questionArea').classList.add('hidden');
      document.getElementById('resultArea').classList.add('hidden');
      document.getElementById('waitingArea').classList.remove('hidden');
      document.getElementById('waitingArea').innerHTML = '<p class="waiting">Waiting for the game to start...</p>';
      document.getElementById('pausedOverlay').classList.add('hidden');
    });
  </script>
</body></html>`;

// === ROUTES ===
app.get('/', (req, res) => res.send(playerHTML));
app.get('/host', (req, res) => res.send(hostHTML));

// === START SERVER ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Kanji Zoo running on port ' + PORT);
  console.log('Host view: /host');
  console.log('Player view: /');
});
