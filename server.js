const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const prompts = [
  'A terrible slogan for a luxury pigeon hotel',
  'The least reassuring name for a time machine',
  'A wizard’s excuse for being late to wizard school',
  'A suspicious flavor of ice cream',
  'The worst app to accidentally open during a meeting',
  'A new Olympic sport nobody asked for',
  'A very dramatic name for a tiny dog',
  'The title of a cookbook written by a raccoon'
];

function code() { return Math.random().toString(36).slice(2, 6).toUpperCase(); }
function send(ws, message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function roomView(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    totalRounds: room.totalRounds,
    prompt: room.prompt,
    deadline: room.deadline,
    players: [...room.players.values()].map(player => ({ id: player.id, name: player.name, score: player.score, connected: player.connected })),
    answers: room.phase === 'answering' ? [] : room.answers.map(answer => ({ id: answer.id, text: answer.text, authorId: answer.authorId, votes: answer.votes })),
    myAnswer: null,
    myPrediction: null
  };
}
function broadcast(room) {
  for (const player of room.players.values()) send(player.ws, { type: 'state', state: roomView(room) });
}
function clearTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function armTimer(room, callback, ms) { clearTimer(room); room.deadline = Date.now() + ms; room.timer = setTimeout(callback, ms); }
function startRound(room) {
  room.phase = 'answering';
  room.round += 1;
  room.prompt = prompts[(room.round - 1) % prompts.length];
  room.answers = [];
  room.predictions = new Map();
  for (const player of room.players.values()) player.answer = null;
  armTimer(room, () => revealAnswers(room), 45000);
  broadcast(room);
}
function revealAnswers(room) {
  if (room.phase !== 'answering') return;
  room.phase = 'predicting';
  room.deadline = Date.now() + 20000;
  room.answers = [...room.players.values()].filter(player => player.answer).map(player => ({ id: crypto.randomUUID(), text: player.answer, authorId: player.id, votes: 0 }));
  armTimer(room, () => revealResults(room), 20000);
  broadcast(room);
}
function revealResults(room) {
  if (room.phase !== 'predicting') return;
  room.phase = 'results';
  for (const answer of room.answers) answer.votes = 0;
  for (const answerId of room.predictions.values()) {
    const answer = room.answers.find(item => item.id === answerId);
    if (answer) answer.votes += 1;
  }
  const maxVotes = Math.max(0, ...room.answers.map(answer => answer.votes));
  const winners = room.answers.filter(answer => answer.votes === maxVotes && maxVotes > 0);
  for (const player of room.players.values()) {
    const answer = room.answers.find(item => item.authorId === player.id);
    const won = winners.some(item => item.authorId === player.id);
    const receivedVote = answer && answer.votes > 0;
    if (won) player.score += 3;
    else if (receivedVote) player.score += 1;
    if (winners.some(item => item.id === room.predictions.get(player.id))) player.score += 2;
  }
  armTimer(room, () => {
    if (room.round >= room.totalRounds) { room.phase = 'finished'; room.deadline = null; broadcast(room); }
    else startRound(room);
  }, 9000);
  broadcast(room);
}
function createRoom(ws, name) {
  let roomCode = code();
  while (rooms.has(roomCode)) roomCode = code();
  const playerId = crypto.randomUUID();
  const room = { code: roomCode, hostId: playerId, phase: 'lobby', round: 0, totalRounds: 6, prompt: '', deadline: null, answers: [], predictions: new Map(), players: new Map() };
  room.players.set(playerId, { id: playerId, name: name || 'Player', score: 0, ws, connected: true, answer: null });
  rooms.set(roomCode, room);
  ws.roomCode = roomCode; ws.playerId = playerId;
  broadcast(room);
}
function joinRoom(ws, roomCode, name) {
  const room = rooms.get(String(roomCode || '').toUpperCase());
  if (!room) return send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
  if (room.players.size >= 8) return send(ws, { type: 'error', message: 'That room is full.' });
  if (room.phase !== 'lobby') return send(ws, { type: 'error', message: 'That game has already started.' });
  const playerId = crypto.randomUUID();
  room.players.set(playerId, { id: playerId, name: name || 'Player', score: 0, ws, connected: true, answer: null });
  ws.roomCode = room.code; ws.playerId = playerId;
  broadcast(room);
}
function handle(ws, message) {
  const room = rooms.get(ws.roomCode);
  if (message.type === 'create') return createRoom(ws, message.name);
  if (message.type === 'join') return joinRoom(ws, message.code, message.name);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;
  if (message.type === 'start' && player.id === room.hostId && room.players.size >= 2) return startRound(room);
  if (message.type === 'answer' && room.phase === 'answering' && !player.answer) {
    player.answer = String(message.text || '').trim().slice(0, 90);
    if ([...room.players.values()].every(item => item.answer)) revealAnswers(room);
    else broadcast(room);
  }
  if (message.type === 'predict' && room.phase === 'predicting' && !room.predictions.has(player.id)) {
    if (room.answers.some(answer => answer.id === message.answerId && answer.authorId !== player.id)) room.predictions.set(player.id, message.answerId);
    if (room.predictions.size >= room.players.size) revealResults(room);
    else broadcast(room);
  }
}

const server = http.createServer((req, res) => {
  const requested = req.url === '/' ? '/public/index.html' : `/public${req.url}`;
  const filePath = path.join(__dirname, requested);
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const type = filePath.endsWith('.css') ? 'text/css' : filePath.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': type }); res.end(data);
  });
});
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  ws.on('message', data => { try { handle(ws, JSON.parse(data)); } catch { send(ws, { type: 'error', message: 'Something went wrong.' }); } });
  ws.on('close', () => { const room = rooms.get(ws.roomCode); if (!room) return; const player = room.players.get(ws.playerId); if (player) player.connected = false; broadcast(room); });
});
server.listen(PORT, () => console.log(`Mind Meld Mayhem running at http://localhost:${PORT}`));
