const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const prompts = [
  ['classic', 'Name something everyone forgets before leaving home.'],
  ['majority', 'What would most people choose for a midnight snack?'],
  ['classic', 'Name a game people secretly rage at.'],
  ['risky', 'What is the first thing you would buy if you became rich?'],
  ['chaos', 'Name a suspicious flavor of ice cream.'],
  ['classic', 'What would your friend probably order at a restaurant?']
];
const options = ['Pizza', 'Chips', 'Ice cream', 'Maggi'];
function makeCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function cleanName(value) { return String(value || 'Player').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 18) || 'Player'; }
function normalize(value) { return String(value || '').toLowerCase().trim().replace(/[.,!?'"\\x60]/g, '').replace(/\s+/g, ' '); }
function send(ws, message) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function clearTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function arm(room, fn, ms) { clearTimer(room); room.deadline = Date.now() + ms; room.timer = setTimeout(fn, ms); }
function playerView(player) { return { id: player.id, name: player.name, score: player.score, roundPoints: player.roundPoints, streak: player.streak, bestStreak: player.bestStreak, connected: player.connected, avatar: player.avatar, color: player.color, powerups: player.powerups }; }
function view(room, playerId) {
  const visibleAnswers = room.phase === 'results' || room.phase === 'finished' ? room.answers.map(answer => ({ text: answer.text, authorId: answer.authorId, points: answer.points, groupSize: answer.groupSize })) : [];
  return { code: room.code, hostId: room.hostId, phase: room.phase, round: room.round, totalRounds: room.totalRounds, mode: room.mode, modeLabel: room.modeLabel, prompt: room.prompt, options: room.options, chaos: room.chaos, perfectMeld: room.perfectMeld, deadline: room.deadline, players: [...room.players.values()].map(playerView), answers: visibleAnswers, me: room.players.has(playerId) ? { answer: room.players.get(playerId).answer, usedPowerup: room.players.get(playerId).usedPowerup } : null };
}
function broadcast(room) { room.lastActivity = Date.now(); for (const player of room.players.values()) send(player.ws, { type: 'state', state: view(room, player.id) }); }
function migrateHost(room) { const nextHost = [...room.players.values()].find(player => player.connected); if (!nextHost || nextHost.id === room.hostId) return; const previousHost = room.players.get(room.hostId); room.hostId = nextHost.id; for (const player of room.players.values()) send(player.ws, { type: 'toast', message: '👑 ' + nextHost.name + ' is now host.' }); broadcast(room); }
function reaction(room, player, emoji) { if (Date.now() - player.lastReaction < 900) return; player.lastReaction = Date.now(); for (const target of room.players.values()) send(target.ws, { type: 'reaction', emoji, name: player.name }); }
function startRound(room) {
  const promptData = prompts[room.round % prompts.length];
  room.round += 1; room.phase = 'answering'; room.mode = room.round === room.totalRounds ? 'final' : promptData[0];
  room.modeLabel = room.round === room.totalRounds ? 'ULTIMATE MELD · 2X POINTS' : room.mode === 'majority' ? 'MAJORITY MIND · PICK ONE' : room.mode === 'risky' ? 'RISKY MIND · HIGH STAKES' : room.mode === 'chaos' ? 'CHAOS ROUND · DOUBLE POINTS' : 'CLASSIC MIND MELD';
  room.prompt = room.round === room.totalRounds ? 'The one thing everyone would take to a deserted island.' : promptData[1];
  room.options = room.mode === 'majority' ? options : []; room.chaos = room.mode === 'chaos' ? 'Double points + fastest answer bonus' : room.mode === 'risky' ? 'Risk answers pay 2x when matched' : room.mode === 'final' ? 'Every match is worth 2x' : '';
  room.answers = []; room.perfectMeld = false; room.fastestId = null; for (const player of room.players.values()) { player.answer = null; player.submittedAt = null; player.roundPoints = 0; player.usedPowerup = null; }
  arm(room, () => reveal(room), 30000); broadcast(room);
}
function reveal(room) {
  if (room.phase !== 'answering') return;
  room.phase = 'results'; room.deadline = Date.now() + 7500;
  const activePlayers = [...room.players.values()].filter(player => player.connected);
  const groups = new Map();
  for (const player of activePlayers) { if (!player.answer) continue; const key = normalize(player.answer); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(player); }
  const largestGroup = Math.max(0, ...[...groups.values()].map(group => group.length));
  room.perfectMeld = activePlayers.length > 1 && largestGroup === activePlayers.length;
  room.fastestId = activePlayers.filter(player => player.answer && player.submittedAt).sort((a, b) => a.submittedAt - b.submittedAt)[0]?.id || null;
  room.answers = [...groups.values()].flatMap(group => group.map(player => {
    const size = group.length; let points = size > 1 ? size * 10 : 0;
    if (room.mode === 'majority') points = size === largestGroup && size > 1 ? size * 8 + 10 : 0;
    if (room.mode === 'risky' && size > 1) points *= 2;
    if (room.mode === 'chaos' || room.mode === 'final') points *= 2;
    if (player.usedPowerup === 'double' && points) points *= 2;
    if (size > 1) { player.streak += 1; player.bestStreak = Math.max(player.bestStreak, player.streak); const multiplier = player.streak >= 4 ? 1.5 : player.streak === 3 ? 1.25 : player.streak === 2 ? 1.1 : 1; points = Math.round(points * multiplier); } else player.streak = 0;
    if (room.perfectMeld) points += 75;
    if (player.id === room.fastestId && points) points += 5;
    player.roundPoints = points; player.score += points;
    return { text: player.answer, authorId: player.id, points, groupSize: size };
  }));
  arm(room, () => room.round >= room.totalRounds ? finish(room) : startRound(room), 7500); broadcast(room);
}
function finish(room) { clearTimer(room); room.phase = 'finished'; room.deadline = null; broadcast(room); }
function addPlayer(room, ws, sessionId, name) {
  const colors = ['#ff5b35', '#8fe8dc', '#d4f458', '#b9a2ff', '#ff9ecb', '#ffd166', '#91c8ff', '#b7e4c7'];
  const player = { id: sessionId || crypto.randomUUID(), name: cleanName(name), score: 0, roundPoints: 0, streak: 0, bestStreak: 0, connected: true, ws, avatar: ['✦','☻','◉','★','☀','♣','◆','☾'][room.players.size % 8], color: colors[room.players.size % colors.length], powerups: { double: true }, answer: null, usedPowerup: null, lastReaction: 0 };
  room.players.set(player.id, player); ws.roomCode = room.code; ws.playerId = player.id; return player;
}
function create(ws, name, sessionId) {
  let roomCode = makeCode(); while (rooms.has(roomCode)) roomCode = makeCode();
  const room = { code: roomCode, hostId: null, phase: 'lobby', round: 0, totalRounds: 6, mode: '', modeLabel: '', prompt: '', options: [], chaos: '', deadline: null, answers: [], players: new Map(), timer: null, lastActivity: Date.now() };
  const player = addPlayer(room, ws, sessionId, name); room.hostId = player.id; rooms.set(room.code, room); broadcast(room);
}
function join(ws, message) {
  const room = rooms.get(String(message.code || '').toUpperCase());
  if (!room) return send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
  if (room.phase !== 'lobby') return reconnectOrReject(ws, room, message);
  if (room.players.size >= 8) return send(ws, { type: 'error', message: 'That room is full.' });
  if ([...room.players.values()].some(player => player.name.toLowerCase() === cleanName(message.name).toLowerCase())) return send(ws, { type: 'error', message: 'That nickname is already taken.' });
  addPlayer(room, ws, message.sessionId, message.name); broadcast(room);
}
function reconnectOrReject(ws, room, message) {
  const player = room.players.get(message.sessionId);
  if (!player) return send(ws, { type: 'error', message: 'That game has already started. Rejoin with the same browser session.' });
  player.ws = ws; player.connected = true; ws.roomCode = room.code; ws.playerId = player.id; send(ws, { type: 'reconnected', message: 'You are back in the meld.' }); broadcast(room);
}
function handle(ws, message) {
  if (message.type === 'create') return create(ws, message.name, message.sessionId);
  if (message.type === 'join') return join(ws, message);
  const room = rooms.get(ws.roomCode); if (!room) return;
  const player = room.players.get(ws.playerId); if (!player) return;
  if (message.type === 'start' && player.id === room.hostId && room.players.size >= 2 && room.phase === 'lobby') return startRound(room);
  if (message.type === 'answer' && room.phase === 'answering' && !player.answer) { const text = String(message.text || '').trim().slice(0, 90); if (!text || Date.now() > room.deadline) return; if (room.mode === 'majority' && !room.options.includes(text)) return; if (room.mode === 'chaos' && text.split(/\s+/).length > 1) return; player.answer = text; player.submittedAt = Date.now(); if ([...room.players.values()].filter(item => item.connected).every(item => item.answer)) reveal(room); else broadcast(room); }
  if (message.type === 'powerup' && room.phase === 'answering' && message.powerup === 'double' && player.powerups.double && !player.usedPowerup) { player.powerups.double = false; player.usedPowerup = 'double'; send(player.ws, { type: 'toast', message: 'DOUBLE DOWN armed for this round.' }); broadcast(room); }
  if (message.type === 'reaction') reaction(room, player, String(message.emoji || '').slice(0, 2));
}
const server = http.createServer((req, res) => { const requested = req.url === '/' ? '/public/index.html' : '/public' + req.url; const filePath = path.join(__dirname, requested); fs.readFile(filePath, (error, data) => { if (error) { res.writeHead(404); return res.end('Not found'); } const type = filePath.endsWith('.css') ? 'text/css' : filePath.endsWith('.js') ? 'text/javascript' : 'text/html'; res.writeHead(200, { 'Content-Type': type }); res.end(data); }); });
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => { ws.on('message', data => { try { handle(ws, JSON.parse(data)); } catch { send(ws, { type: 'error', message: 'Something went wrong. Try again.' }); } }); ws.on('close', () => { const room = rooms.get(ws.roomCode); if (!room) return; const player = room.players.get(ws.playerId); if (player && player.ws === ws) { player.connected = false; if (room.hostId === player.id) migrateHost(room); else broadcast(room); } }); });
setInterval(() => { for (const [roomCode, room] of rooms) { const connected = [...room.players.values()].some(player => player.connected); if (!connected && Date.now() - room.lastActivity > 10 * 60 * 1000) { clearTimer(room); rooms.delete(roomCode); } } }, 60 * 1000);
server.listen(PORT, () => console.log('Mind Meld Mayhem running at http://localhost:' + PORT));
