const COLORS = [
  { name: 'Red', hex: '#f04452' }, { name: 'Orange', hex: '#ff9d38' },
  { name: 'Yellow', hex: '#f1cf49' }, { name: 'Green', hex: '#37c987' },
  { name: 'Blue', hex: '#4787ff' }, { name: 'Purple', hex: '#a66af1' }
];
const $ = id => document.getElementById(id);
const home = $('home'), roomScreen = $('room');
let ws, playerId = localStorage.getItem('colorclash-player') || '', currentRoom = '', currentName = '', state = null, reconnectTimer, toastTimer;
const palette = $('palette');
for (const color of COLORS) {
  const button = document.createElement('button');
  button.className = 'color-button'; button.style.background = color.hex; button.title = color.name;
  button.setAttribute('aria-label', `Tap ${color.name}`);
  button.addEventListener('click', () => { if (state?.status === 'playing') send({ type: 'pick', color: color.name, roundId: state.roundId }); });
  palette.append(button);
}
function send(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function connect(payload) {
  clearTimeout(reconnectTimer);
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${scheme}//${location.host}`);
  $('connection-status').textContent = 'Connecting…';
  ws.addEventListener('open', () => { $('connection-status').textContent = 'Connected'; send(payload); });
  ws.addEventListener('message', event => {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'error') { $('home-error').textContent = data.message; toast(data.message); return; }
    if (data.type === 'joined') { playerId = data.playerId; localStorage.setItem('colorclash-player', playerId); currentRoom = data.roomCode; $('room-code').textContent = currentRoom; $('home-error').textContent = ''; history.replaceState({}, '', `/?room=${currentRoom}`); home.classList.add('hidden'); roomScreen.classList.remove('hidden'); render(); }
    if (data.type === 'state') { state = data; currentRoom = data.roomCode; $('room-code').textContent = currentRoom; render(); }
  });
  ws.addEventListener('close', () => {
    $('connection-status').textContent = 'Reconnecting…';
    if (currentRoom && currentName) reconnectTimer = setTimeout(() => connect({ type: 'join', code: currentRoom, name: currentName, playerId }), 1000);
  });
}
function startAction(type) {
  currentName = $('player-name').value.trim().slice(0, 18);
  if (!currentName) { $('home-error').textContent = 'Enter your name to get started.'; $('player-name').focus(); return; }
  $('home-error').textContent = '';
  const code = $('room-code-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (type === 'join' && code.length !== 6) { $('home-error').textContent = 'Room codes are 6 characters long.'; $('room-code-input').focus(); return; }
  connect({ type, name: currentName, playerId, ...(type === 'join' ? { code } : {}) });
}
$('create-button').addEventListener('click', () => startAction('create'));
$('join-button').addEventListener('click', () => startAction('join'));
$('player-name').addEventListener('keydown', e => { if (e.key === 'Enter') startAction('create'); });
$('room-code-input').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
$('room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') startAction('join'); });
$('start-button').addEventListener('click', () => send({ type: 'start' }));
$('replay-button').addEventListener('click', () => send({ type: 'replay' }));
$('leave-button').addEventListener('click', () => {
  currentRoom = ''; clearTimeout(reconnectTimer); send({ type: 'leave' }); ws?.close(); state = null;
  history.replaceState({}, '', '/'); roomScreen.classList.add('hidden'); home.classList.remove('hidden');
});
$('copy-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText(currentRoom); toast('Room code copied!'); } catch { toast(`Room code: ${currentRoom}`); } });
$('share-button').addEventListener('click', async () => {
  const invite = `${location.origin}/?room=${currentRoom}`;
  try { if (navigator.share) await navigator.share({ title: 'Join my Color Clash game', text: `Room code: ${currentRoom}`, url: invite }); else { await navigator.clipboard.writeText(invite); toast('Invite link copied!'); } } catch { /* dismissed */ }
});
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2300); }
const avatarColors = ['#f3a8b9', '#f2cf79', '#8addc1', '#8baefa', '#c5a1f3', '#f0ae75'];
function avatar(player, index) { return `<span class="avatar" style="background:${avatarColors[index % avatarColors.length]}">${escapeText(player.name).slice(0, 1).toUpperCase()}</span>`; }
function escapeText(s) { const el = document.createElement('span'); el.textContent = s; return el.innerHTML; }
function render() {
  if (!state) return;
  const players = state.players, me = players.find(p => p.id === playerId), isHost = state.hostId === playerId;
  $('player-count').textContent = `${players.length} / 6`;
  $('room-title').textContent = state.status === 'waiting' ? 'Waiting room' : state.status === 'finished' ? 'Final scores' : 'Color Clash';
  $('player-list').innerHTML = players.map((p, i) => `<div class="player-row">${avatar(p, i)}<div class="player-info"><b>${escapeText(p.name)}</b><small>${p.id === playerId ? 'That’s you' : p.connected ? 'Ready to clash' : 'Reconnecting…'}</small></div>${p.id === state.hostId ? '<span class="host-tag">HOST</span>' : !p.connected ? '<span class="disconnected">OFFLINE</span>' : ''}</div>`).join('');
  $('lobby-hint').textContent = isHost ? players.length < 2 ? 'Share your code. You need at least one more player.' : 'Everyone’s here. Ready when you are.' : `Waiting for ${escapeText(players.find(p => p.id === state.hostId)?.name || 'host')} to start.`;
  $('start-button').disabled = !isHost || players.length < 2 || state.status !== 'waiting';
  $('score-list').innerHTML = [...players].sort((a, b) => b.score - a.score).map((p, i) => `<div class="score-entry ${p.id === playerId ? 'me' : ''}">${avatar(p, i)}<div class="player-info"><b>${escapeText(p.name)}${p.id === playerId ? ' · you' : ''}</b><small>${p.id === state.hostId ? 'Host' : p.connected ? 'Playing' : 'Reconnecting'}</small></div><span class="score-value">${p.score}<small style="font-size:9px;color:#8b8994"> / 10</small></span></div>`).join('');
  $('lobby-panel').classList.toggle('hidden', state.status !== 'waiting');
  $('play-panel').classList.toggle('hidden', state.status !== 'playing');
  $('finished-panel').classList.toggle('hidden', state.status !== 'finished');
  if (state.status === 'playing') {
    $('round-label').textContent = `ROUND ${state.roundId}`;
    $('status-pill').classList.toggle('live', !state.roundWinnerId);
    $('status-pill').innerHTML = state.roundWinnerId ? '<i></i> POINT SCORED' : '<i></i> LIVE';
    const color = state.target;
    if (color) { $('target-swatch').style.background = color.hex; $('target-swatch').classList.remove('pulse'); void $('target-swatch').offsetWidth; $('target-swatch').classList.add('pulse'); $('target-name').textContent = color.name; }
    const roundWinner = players.find(p => p.id === state.roundWinnerId);
    $('round-message').textContent = state.roundWinnerId ? `${roundWinner?.name || 'A player'} got the point! Next color coming up…` : 'Tap the matching color as fast as you can.';
    palette.querySelectorAll('button').forEach(button => { button.disabled = !!state.roundWinnerId; });
  }
  if (state.status === 'finished') {
    $('winner-name').textContent = players.find(p => p.id === state.winnerId)?.name || 'Champion';
    const replay = $('replay-button'); replay.classList.toggle('hidden', playerId !== state.winnerId);
    $('replay-hint').textContent = playerId === state.winnerId ? 'Scores reset when the next game starts.' : 'The winner can start a rematch.';
  }
}
const queryRoom = new URLSearchParams(location.search).get('room');
if (queryRoom) { $('room-code-input').value = queryRoom.toUpperCase().slice(0, 6); }
