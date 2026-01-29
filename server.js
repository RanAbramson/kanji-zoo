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

// === GAME STATE ===
let gameState = {
  phase: 'lobby', // lobby, question, hiragana, results
  players: {},    // { odId: { name, score, answered, lastAnswer } }
  currentQuestion: null,
  currentAnimal: null,
  questionStartTime: null,
  questionNumber: 0,
  totalQuestions: 10,
  usedAnimals: []
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
  // Pick an animal not yet used (or reset if all used)
  let available = animals.filter(a => !gameState.usedAnimals.includes(a.kanji));
  if (available.length === 0) {
    gameState.usedAnimals = [];
    available = animals;
  }
  
  const correct = available[Math.floor(Math.random() * available.length)];
  gameState.usedAnimals.push(correct.kanji);
  gameState.currentAnimal = correct;
  
  // Randomly choose question type
  const isKanjiToAnimal = Math.random() > 0.5;
  
  // Get 3 wrong answers
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
  // Max 1000 points, decreases over 10 seconds
  const maxTime = 10000;
  const points = Math.max(100, Math.round(1000 - (timeMs / maxTime) * 900));
  return points;
}

function getLeaderboard() {
  return Object.values(gameState.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

function resetPlayerAnswers() {
  for (const id in gameState.players) {
    gameState.players[id].answered = false;
    gameState.players[id].lastAnswer = null;
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
    if (!player || player.answered || !gameState.currentQuestion) return;
    
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
  });
  
  // Host controls
  socket.on('hostStartGame', () => {
    gameState.phase = 'question';
    gameState.questionNumber = 0;
    gameState.usedAnimals = [];
    for (const id in gameState.players) {
      gameState.players[id].score = 0;
    }
    io.emit('gameStarted');
    io.emit('leaderboard', getLeaderboard());
  });
  
  socket.on('hostNextQuestion', () => {
    gameState.questionNumber++;
    if (gameState.questionNumber > gameState.totalQuestions) {
      gameState.phase = 'results';
      io.emit('gameOver', getLeaderboard());
      return;
    }
    
    resetPlayerAnswers();
    gameState.phase = 'question';
    gameState.currentQuestion = generateQuestion();
    gameState.questionStartTime = Date.now();
    
    io.emit('newQuestion', {
      question: gameState.currentQuestion,
      questionNumber: gameState.questionNumber,
      total: gameState.totalQuestions
    });
  });
  
  socket.on('hostHiraganaRound', () => {
    resetPlayerAnswers();
    gameState.phase = 'hiragana';
    gameState.currentQuestion = generateHiraganaQuestion();
    gameState.questionStartTime = Date.now();
    
    io.emit('hiraganaQuestion', {
      question: gameState.currentQuestion
    });
  });
  
  socket.on('hostShowAnswer', () => {
    const animal = gameState.currentAnimal;
    io.emit('showAnswer', {
      kanji: animal.kanji,
      hiragana: animal.hiragana,
      english: animal.english,
      emoji: animal.emoji
    });
  });
  
  socket.on('hostResetGame', () => {
    gameState.phase = 'lobby';
    gameState.questionNumber = 0;
    gameState.usedAnimals = [];
    gameState.currentQuestion = null;
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
  <title>Kanji Zoo - Host</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f5f0eb; color: #2c2c2c; min-height: 100vh; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; font-size: 3rem; margin-bottom: 10px; color: #bc002d; }
    .subtitle { text-align: center; color: #666; margin-bottom: 30px; }
    .join-info { background: #fff; border: 2px solid #bc002d; padding: 20px; border-radius: 15px; text-align: center; margin-bottom: 30px; }
    .join-url { font-size: 1.8rem; color: #bc002d; font-weight: bold; }
    .main-display { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.08); border-radius: 20px; padding: 40px; text-align: center; min-height: 300px; margin-bottom: 30px; }
    .question-num { color: #888; font-size: 1.2rem; margin-bottom: 20px; }
    .prompt { font-size: 8rem; margin: 20px 0; }
    .options-display { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; max-width: 600px; margin: 0 auto; }
    .option-box { background: #f5f0eb; border: 1px solid #e0d6cc; padding: 30px; border-radius: 15px; font-size: 3rem; }
    .answer-reveal { background: #eafaea; color: #2c2c2c; padding: 30px; border-radius: 15px; margin-top: 20px; }
    .answer-reveal .emoji { font-size: 5rem; }
    .answer-reveal .text { font-size: 2rem; margin-top: 10px; }
    .controls { display: flex; flex-wrap: wrap; gap: 15px; justify-content: center; margin-bottom: 30px; }
    .btn { padding: 15px 30px; font-size: 1.2rem; border: none; border-radius: 10px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.3); }
    .btn-primary { background: #bc002d; color: white; }
    .btn-secondary { background: #fff; color: #bc002d; border: 2px solid #bc002d; }
    .btn-success { background: #1a8d1a; color: white; }
    .sidebar { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .panel { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.08); border-radius: 15px; padding: 20px; }
    .panel h3 { margin-bottom: 15px; color: #bc002d; }
    .player-list { list-style: none; }
    .player-list li { padding: 8px 0; border-bottom: 1px solid #e0d6cc; }
    .leaderboard-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e0d6cc; }
    .rank-1 { color: gold; font-weight: bold; }
    .rank-2 { color: silver; }
    .rank-3 { color: #cd7f32; }
    .final-results { text-align: center; }
    .final-results h2 { font-size: 2.5rem; margin-bottom: 30px; }
    .winner { font-size: 4rem; margin: 20px 0; }
    .winner-name { color: gold; font-size: 3rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎌 Kanji Zoo 🎌</h1>
    <p class="subtitle">Animal Kanji Memory Game</p>
    
    <div class="join-info">
      <p>Players join at:</p>
      <p class="join-url" id="joinUrl"></p>
    </div>
    
    <div class="main-display" id="mainDisplay">
      <p style="font-size: 2rem; color: #888;">Waiting for players...</p>
    </div>
    
    <div class="controls" id="controls">
      <button class="btn btn-primary" id="startBtn">Start Game</button>
    </div>
    
    <div class="sidebar">
      <div class="panel">
        <h3>👥 Players (<span id="playerCount">0</span>)</h3>
        <ul class="player-list" id="playerList"></ul>
      </div>
      <div class="panel">
        <h3>🏆 Leaderboard</h3>
        <div id="leaderboard"></div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let currentPhase = 'lobby';
    
    // Show join URL
    document.getElementById('joinUrl').textContent = window.location.host;
    
    // Update player list
    socket.on('playerList', (players) => {
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
      currentPhase = 'question';
      const q = data.question;
      document.getElementById('mainDisplay').innerHTML = 
        '<p class="question-num">Question ' + data.questionNumber + ' / ' + data.total + '</p>' +
        '<div class="prompt">' + q.prompt + '</div>' +
        '<div class="options-display">' + q.options.map(o => 
          '<div class="option-box">' + o.display + '</div>'
        ).join('') + '</div>';
      updateControls();
    });
    
    // Hiragana question
    socket.on('hiraganaQuestion', (data) => {
      currentPhase = 'hiragana';
      const q = data.question;
      document.getElementById('mainDisplay').innerHTML = 
        '<p class="question-num">Hiragana Round</p>' +
        '<div class="prompt">' + q.prompt + '</div>' +
        '<p style="color:#888;margin-bottom:20px;">Match the hiragana reading</p>' +
        '<div class="options-display">' + q.options.map(o => 
          '<div class="option-box">' + o.display + '</div>'
        ).join('') + '</div>';
      updateControls();
    });
    
    // Show answer
    socket.on('showAnswer', (animal) => {
      currentPhase = 'answer';
      document.getElementById('mainDisplay').innerHTML += 
        '<div class="answer-reveal"><div class="emoji">' + animal.emoji + '</div>' +
        '<div class="text">' + animal.kanji + ' = ' + animal.hiragana + ' (' + animal.english + ')</div></div>';
      updateControls();
    });
    
    // Game over
    socket.on('gameOver', (lb) => {
      currentPhase = 'results';
      const winner = lb[0];
      document.getElementById('mainDisplay').innerHTML = 
        '<div class="final-results"><h2>🎉 Game Over! 🎉</h2>' +
        '<div class="winner">👑</div>' +
        '<div class="winner-name">' + (winner ? winner.name : 'No players') + '</div>' +
        '<p style="font-size:1.5rem;color:#888;margin-top:10px;">' + (winner ? winner.score + ' points' : '') + '</p></div>';
      updateControls();
    });
    
    // Game reset
    socket.on('gameReset', () => {
      currentPhase = 'lobby';
      document.getElementById('mainDisplay').innerHTML = '<p style="font-size: 2rem; color: #888;">Waiting for players...</p>';
      updateControls();
    });
    
    // Control buttons
    function updateControls() {
      let html = '';
      if (currentPhase === 'lobby' || currentPhase === 'results') {
        html = '<button class="btn btn-primary" onclick="startGame()">Start Game</button>';
      } else if (currentPhase === 'question') {
        html = '<button class="btn btn-success" onclick="showAnswer()">Show Answer</button>' +
               '<button class="btn btn-secondary" onclick="hiraganaRound()">Hiragana Round</button>' +
               '<button class="btn btn-primary" onclick="nextQuestion()">Next Question</button>';
      } else if (currentPhase === 'hiragana') {
        html = '<button class="btn btn-success" onclick="showAnswer()">Show Answer</button>' +
               '<button class="btn btn-primary" onclick="nextQuestion()">Next Question</button>';
      } else if (currentPhase === 'answer') {
        html = '<button class="btn btn-secondary" onclick="hiraganaRound()">Hiragana Round</button>' +
               '<button class="btn btn-primary" onclick="nextQuestion()">Next Question</button>';
      }
      html += '<button class="btn btn-secondary" onclick="resetGame()">Reset Game</button>';
      document.getElementById('controls').innerHTML = html;
    }
    
    function startGame() { socket.emit('hostStartGame'); socket.emit('hostNextQuestion'); }
    function nextQuestion() { socket.emit('hostNextQuestion'); }
    function hiraganaRound() { socket.emit('hostHiraganaRound'); }
    function showAnswer() { socket.emit('hostShowAnswer'); }
    function resetGame() { socket.emit('hostResetGame'); }
    
    updateControls();
  </script>
</body></html>`;

const playerHTML = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Kanji Zoo - Play</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f5f0eb; color: #2c2c2c; min-height: 100vh; display: flex; flex-direction: column; }
    .container { flex: 1; display: flex; flex-direction: column; padding: 20px; max-width: 500px; margin: 0 auto; width: 100%; }
    h1 { text-align: center; font-size: 2rem; margin-bottom: 20px; color: #bc002d; }
    .join-form { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px; }
    .join-form input { width: 100%; padding: 20px; font-size: 1.5rem; background: #fff; color: #2c2c2c; border: 2px solid #e0d6cc; border-radius: 15px; text-align: center; }
    .btn { width: 100%; padding: 20px; font-size: 1.5rem; border: none; border-radius: 15px; cursor: pointer; transition: transform 0.1s; }
    .btn:active { transform: scale(0.98); }
    .btn-primary { background: #bc002d; color: white; }
    .btn-disabled { background: #ddd; color: #999; }
    .game-view { flex: 1; display: flex; flex-direction: column; }
    .status { text-align: center; padding: 15px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-radius: 15px; margin-bottom: 20px; }
    .score { font-size: 2rem; font-weight: bold; color: #bc002d; }
    .prompt { text-align: center; font-size: 5rem; margin: 20px 0; }
    .options { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; flex: 1; }
    .option { display: flex; align-items: center; justify-content: center; font-size: 3rem; background: #fff; border: 2px solid #e0d6cc; border-radius: 15px; color: #2c2c2c; cursor: pointer; transition: background 0.2s, transform 0.1s; min-height: 100px; }
    .option:active { transform: scale(0.98); }
    .option.correct { background: #1a8d1a; color: white; }
    .option.wrong { background: #bc002d; color: white; }
    .option.disabled { opacity: 0.5; pointer-events: none; }
    .result { text-align: center; padding: 30px; }
    .result-icon { font-size: 4rem; }
    .result-text { font-size: 1.5rem; margin-top: 10px; }
    .result-points { font-size: 2rem; color: #bc002d; margin-top: 10px; }
    .waiting { text-align: center; font-size: 1.5rem; color: #888; padding: 50px 0; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎌 Kanji Zoo 🎌</h1>
    
    <div class="join-form" id="joinForm">
      <input type="text" id="nameInput" placeholder="Your name" maxlength="15">
      <button class="btn btn-primary" onclick="joinGame()">Join Game</button>
    </div>
    
    <div class="game-view hidden" id="gameView">
      <div class="status">
        <span>Score: </span><span class="score" id="score">0</span>
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

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let myScore = 0;
    let answered = false;
    let currentCorrectId = null;
    
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
    
    function showQuestion(q) {
      answered = false;
      currentCorrectId = q.correctId;
      document.getElementById('waitingArea').classList.add('hidden');
      document.getElementById('resultArea').classList.add('hidden');
      document.getElementById('questionArea').classList.remove('hidden');
      document.getElementById('prompt').textContent = q.prompt;
      
      document.getElementById('options').innerHTML = q.options.map(o => 
        '<button class="option" data-id="' + o.id + '" onclick="answer(this)">' + o.display + '</button>'
      ).join('');
    }
    
    socket.on('newQuestion', (data) => showQuestion(data.question));
    socket.on('hiraganaQuestion', (data) => showQuestion(data.question));
    
    function answer(btn) {
      if (answered) return;
      answered = true;
      
      const id = btn.dataset.id;
      socket.emit('answer', id);
      
      // Disable all buttons
      document.querySelectorAll('.option').forEach(b => b.classList.add('disabled'));
      
      // Show correct/wrong
      if (id === currentCorrectId) {
        btn.classList.add('correct');
      } else {
        btn.classList.add('wrong');
        document.querySelector('.option[data-id="' + currentCorrectId + '"]').classList.add('correct');
      }
    }
    
    socket.on('answerResult', (result) => {
      myScore += result.points;
      document.getElementById('score').textContent = myScore;
      
      setTimeout(() => {
        document.getElementById('questionArea').classList.add('hidden');
        document.getElementById('resultArea').classList.remove('hidden');
        
        if (result.correct) {
          document.getElementById('resultIcon').textContent = '✅';
          document.getElementById('resultText').textContent = 'Correct!';
          document.getElementById('resultPoints').textContent = '+' + result.points + ' points';
        } else {
          document.getElementById('resultIcon').textContent = '❌';
          document.getElementById('resultText').textContent = 'Wrong!';
          document.getElementById('resultPoints').textContent = '';
        }
      }, 1500);
    });
    
    socket.on('showAnswer', () => {
      // Just keep showing result or question
    });
    
    socket.on('gameOver', (lb) => {
      document.getElementById('questionArea').classList.add('hidden');
      document.getElementById('resultArea').classList.add('hidden');
      document.getElementById('waitingArea').classList.remove('hidden');
      
      const myRank = lb.findIndex(p => p.score === myScore) + 1;
      document.getElementById('waitingArea').innerHTML = 
        '<p class="waiting">🎉 Game Over! 🎉</p>' +
        '<p class="waiting">Your score: ' + myScore + '</p>' +
        '<p class="waiting">Rank: #' + myRank + '</p>';
    });
    
    socket.on('gameReset', () => {
      myScore = 0;
      document.getElementById('score').textContent = '0';
      document.getElementById('questionArea').classList.add('hidden');
      document.getElementById('resultArea').classList.add('hidden');
      document.getElementById('waitingArea').classList.remove('hidden');
      document.getElementById('waitingArea').innerHTML = '<p class="waiting">Waiting for the game to start...</p>';
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
