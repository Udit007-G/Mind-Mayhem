const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const ANSWER_TIME_MS = 30000;
const MAX_MESSAGES_PER_SECOND = 40;
const MAX_ROOM_ACTIONS_PER_MINUTE = 8;
const roomActions = new WeakMap();
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
function validSessionId(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function normalizedSessionId(value) { return validSessionId(value) ? value : crypto.randomUUID(); }
function allowRoomAction(ws) { const now = Date.now(); const recent = (roomActions.get(ws) || []).filter(timestamp => now - timestamp < 60000); if (recent.length >= MAX_ROOM_ACTIONS_PER_MINUTE) return false; recent.push(now); roomActions.set(ws, recent); return true; }
function normalize(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' '); }
function send(ws, message) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function clearTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function arm(room, fn, ms) { clearTimer(room); room.deadline = Date.now() + ms; room.timer = setTimeout(fn, ms); }
function playerView(player) { return { id: player.id, name: player.name, score: player.score, roundPoints: player.roundPoints, streak: player.streak, bestStreak: player.bestStreak, matches: player.matches, averageSubmitMs: player.submitCount ? Math.round(player.totalSubmitMs / player.submitCount) : null, connected: player.connected, avatar: player.avatar, color: player.color, powerups: player.powerups }; }
function view(room, playerId) {
  const visibleAnswers = room.phase === 'results' || room.phase === 'finished' ? room.answers.map(answer => ({ text: answer.text, authorId: answer.authorId, points: answer.points, groupSize: answer.groupSize, memberIds: answer.memberIds })) : [];
  return { code: room.code, hostId: room.hostId, phase: room.phase, round: room.round, totalRounds: room.totalRounds, mode: room.mode, modeLabel: room.modeLabel, prompt: room.prompt, options: room.options, chaos: room.chaos, perfectMeld: room.perfectMeld, fastestId: room.fastestId, deadline: room.deadline, players: [...room.players.values()].map(playerView), answers: visibleAnswers, me: room.players.has(playerId) ? { answer: room.players.get(playerId).answer, risk: room.players.get(playerId).risk, usedPowerup: room.players.get(playerId).usedPowerup } : null };
}
function broadcast(room) { room.lastActivity = Date.now(); for (const player of room.players.values()) send(player.ws, { type: 'state', state: view(room, player.id) }); for (const spectator of room.spectators || []) send(spectator, { type: 'state', state: view(room, null) }); }
function migrateHost(room) { const nextHost = [...room.players.values()].find(player => player.connected); if (!nextHost || nextHost.id === room.hostId) return; const previousHost = room.players.get(room.hostId); room.hostId = nextHost.id; for (const player of room.players.values()) send(player.ws, { type: 'toast', message: '👑 ' + nextHost.name + ' is now host.' }); broadcast(room); }
function reaction(room, player, emoji) { if (Date.now() - player.lastReaction < 900) return; player.lastReaction = Date.now(); for (const target of room.players.values()) send(target.ws, { type: 'reaction', emoji, name: player.name }); }
function startRound(room) {
  const promptData = prompts[room.round % prompts.length];
  room.round += 1; room.phase = 'answering'; room.mode = room.round === room.totalRounds ? 'final' : promptData[0];
  room.modeLabel = room.round === room.totalRounds ? 'ULTIMATE MELD · 2X POINTS' : room.mode === 'majority' ? 'MAJORITY MIND · PICK ONE' : room.mode === 'risky' ? 'RISKY MIND · HIGH STAKES' : room.mode === 'chaos' ? 'CHAOS ROUND · DOUBLE POINTS' : 'CLASSIC MIND MELD';
  room.prompt = room.round === room.totalRounds ? 'The one thing everyone would take to a deserted island.' : promptData[1];
  room.options = room.mode === 'majority' ? options : []; room.chaos = room.mode === 'chaos' ? 'Double points + fastest answer bonus · ONE WORD ONLY' : room.mode === 'risky' ? 'Risk answers pay 2x when matched' : room.mode === 'final' ? 'Every match is worth 2x' : '';
  room.answers = []; room.perfectMeld = false; room.fastestId = null; for (const player of room.players.values()) { player.answer = null; player.risk = false; player.submittedAt = null; player.roundPoints = 0; player.usedPowerup = null; }
  arm(room, () => reveal(room), ANSWER_TIME_MS); broadcast(room);
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
    if (room.mode === 'risky') points = player.risk && size > 1 ? points * 2 : player.risk ? 0 : points;
    if (room.mode === 'chaos' || room.mode === 'final') points *= 2;
    if (player.usedPowerup === 'double' && points) points *= 2;
    if (size > 1) { player.matches += 1; player.streak += 1; player.bestStreak = Math.max(player.bestStreak, player.streak); const multiplier = player.streak >= 4 ? 1.5 : player.streak === 3 ? 1.25 : player.streak === 2 ? 1.1 : 1; points = Math.round(points * multiplier); } else player.streak = 0;
    if (room.perfectMeld) points += 75;
    if (player.id === room.fastestId && points) points += 5;
    player.roundPoints = points; player.score += points;
    return { text: player.answer, authorId: player.id, points, groupSize: size, memberIds: group.map(member => member.id) };
  }));
  arm(room, () => room.round >= room.totalRounds ? finish(room) : startRound(room), 7500); broadcast(room);
}
function finish(room) { clearTimer(room); room.phase = 'finished'; room.deadline = null; broadcast(room); }
function addPlayer(room, ws, sessionId, name) {
  const colors = ['#ff5b35', '#8fe8dc', '#d4f458', '#b9a2ff', '#ff9ecb', '#ffd166', '#91c8ff', '#b7e4c7'];
  const player = { id: sessionId || crypto.randomUUID(), name: cleanName(name), score: 0, roundPoints: 0, streak: 0, bestStreak: 0, matches: 0, totalSubmitMs: 0, submitCount: 0, connected: true, ws, avatar: ['✦','☻','◉','★','☀','♣','◆','☾'][room.players.size % 8], color: colors[room.players.size % colors.length], powerups: { double: true }, answer: null, risk: false, usedPowerup: null, lastReaction: 0 };
  player.id = normalizedSessionId(player.id); room.players.set(player.id, player); ws.roomCode = room.code; ws.playerId = player.id; return player;
}
function create(ws, name, sessionId) {
  if (!allowRoomAction(ws)) return send(ws, { type: 'error', message: 'Too many room requests. Try again in a minute.' });
  let roomCode = makeCode(); while (rooms.has(roomCode)) roomCode = makeCode();
  const room = { code: roomCode, hostId: null, phase: 'lobby', round: 0, totalRounds: 6, mode: '', modeLabel: '', prompt: '', options: [], chaos: '', deadline: null, answers: [], players: new Map(), spectators: new Set(), timer: null, lastActivity: Date.now() };
  const player = addPlayer(room, ws, sessionId, name); room.hostId = player.id; rooms.set(room.code, room); broadcast(room);
}
function join(ws, message) {
  if (!allowRoomAction(ws)) return send(ws, { type: 'error', message: 'Too many room requests. Try again in a minute.' });
  const room = rooms.get(String(message.code || '').toUpperCase());
  if (!room) return send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
  if (validSessionId(message.sessionId) && room.players.has(message.sessionId) && !room.players.get(message.sessionId).connected) return reconnectOrReject(ws, room, message);
  if (room.phase !== 'lobby') return reconnectOrReject(ws, room, message);
  if (room.players.size >= 8) return send(ws, { type: 'error', message: 'That room is full.' });
  if ([...room.players.values()].some(player => player.name.toLowerCase() === cleanName(message.name).toLowerCase())) return send(ws, { type: 'error', message: 'That nickname is already taken.' });
  const requestedSession = validSessionId(message.sessionId) ? message.sessionId : crypto.randomUUID(); if ([...room.players.values()].some(player => player.id === requestedSession)) return send(ws, { type: 'error', message: 'That session is already active.' }); addPlayer(room, ws, requestedSession, message.name); broadcast(room);
}
function reconnectOrReject(ws, room, message) {
  if (!validSessionId(message.sessionId)) return send(ws, { type: 'error', message: 'Reconnect session is invalid.' });
  const player = room.players.get(message.sessionId);
  if (!player) return send(ws, { type: 'error', message: 'That game has already started. Rejoin with the same browser session.' });
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer); player.disconnectTimer = null; player.ws = ws; player.connected = true; ws.roomCode = room.code; ws.playerId = player.id; send(ws, { type: 'reconnected', message: 'You are back in the meld.' }); broadcast(room);
}
function removeDisconnectedPlayer(room, player) { if (player.connected || player.ws) return; room.players.delete(player.id); if (room.hostId === player.id) migrateHost(room); else broadcast(room); }
function handle(ws, message) {
  if (message.type === 'spectate') { const room = rooms.get(String(message.code || '').toUpperCase()); if (!room) return send(ws, { type: 'error', message: 'Room not found.' }); ws.isSpectator = true; ws.roomCode = room.code; room.spectators.add(ws); send(ws, { type: 'state', state: view(room, null) }); return; }
  if (message.type === 'create') return create(ws, message.name, normalizedSessionId(message.sessionId));
  if (message.type === 'join') return join(ws, message);
  const room = rooms.get(ws.roomCode); if (!room) return;
  const player = room.players.get(ws.playerId); if (!player) return;
  if (message.type === 'start' && player.id === room.hostId && room.players.size >= 2 && room.phase === 'lobby') return startRound(room);
  if (message.type === 'answer' && room.phase === 'answering' && !player.answer) { const text = String(message.text || '').trim().slice(0, 90); if (!text || Date.now() > room.deadline) return send(player.ws, { type:'error', message: 'That round is closed.' }); if (room.mode === 'majority' && !room.options.includes(text)) return send(player.ws, { type:'error', message: 'Pick one of the choices shown.' }); if (room.mode === 'chaos' && text.split(/\s+/).length > 1) return send(player.ws, { type:'error', message: 'Chaos round: use one word only.' }); player.answer = text; player.risk = room.mode === 'risky' && message.risk === true; player.submittedAt = Date.now(); player.totalSubmitMs += player.submittedAt - (room.deadline - ANSWER_TIME_MS); player.submitCount += 1; if ([...room.players.values()].filter(item => item.connected).every(item => item.answer)) reveal(room); else broadcast(room); }
  if (message.type === 'powerup' && room.phase === 'answering' && message.powerup === 'double' && player.powerups.double && !player.usedPowerup) { player.powerups.double = false; player.usedPowerup = 'double'; send(player.ws, { type: 'toast', message: 'DOUBLE DOWN armed for this round.' }); broadcast(room); }
  if (message.type === 'reaction') reaction(room, player, String(message.emoji || '').slice(0, 2));
}
const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://localhost'); const pathname = url.pathname === '/' ? '/index.html' : url.pathname; const publicRoot = path.resolve(__dirname, 'public'); const filePath = path.resolve(publicRoot, '.' + pathname); if (!filePath.startsWith(publicRoot + path.sep)) { res.writeHead(403); return res.end('Forbidden'); } fs.readFile(filePath, (error, data) => { if (error) { res.writeHead(404); return res.end('Not found'); } const type = filePath.endsWith('.css') ? 'text/css' : filePath.endsWith('.js') ? 'text/javascript' : 'text/html'; res.writeHead(200, { 'Content-Type': type }); res.end(data); }); });
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => { ws.messageWindow = { started: Date.now(), count: 0 }; ws.rateViolations = 0; ws.on('message', data => { const now = Date.now(); if (now - ws.messageWindow.started >= 1000) { ws.messageWindow = { started: now, count: 0 }; ws.rateViolations = 0; } if (++ws.messageWindow.count > MAX_MESSAGES_PER_SECOND) { ws.rateViolations += 1; if (ws.rateViolations >= 3) return ws.close(1008, 'Message rate exceeded'); return send(ws, { type: 'error', message: 'Too many messages. Slow down.' }); } try { handle(ws, JSON.parse(data)); } catch { send(ws, { type: 'error', message: 'Something went wrong. Try again.' }); } }); ws.on('close', () => { const room = rooms.get(ws.roomCode); if (!room) return; if (ws.isSpectator) { room.spectators.delete(ws); return; } const player = room.players.get(ws.playerId); if (player && player.ws === ws) { player.connected = false; player.ws = null; player.disconnectTimer = setTimeout(() => removeDisconnectedPlayer(room, player), 5000); broadcast(room); } }); });
setInterval(() => { for (const [roomCode, room] of rooms) { const connected = [...room.players.values()].some(player => player.connected); if (!connected && Date.now() - room.lastActivity > 10 * 60 * 1000) { clearTimer(room); rooms.delete(roomCode); } } }, 60 * 1000);
server.listen(PORT, () => console.log('Mind Meld Mayhem running at http://localhost:' + PORT));
