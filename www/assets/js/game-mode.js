import venueService from '../../services/venues.js';
import { qsa } from '../../utils/helpers.js';

let match = null;
let countdownInterval = null;
let gameTimerInterval = null;
let matchObserver = null;
let isGameActive = false;

function $id(id) { return document.getElementById(id); }

function initStars(container) {
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'game-rating__star';
    btn.textContent = '★';
    btn.dataset.value = i;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.game-rating__star').forEach((s, idx) => {
        s.classList.toggle('active', idx < i);
      });
    });
    container.appendChild(btn);
  }
}

function renderPlayers(list, container, showBadge) {
  container.innerHTML = list.map(p => {
    const initial = p.name.charAt(0).toUpperCase();
    const badge = showBadge ? `<span class="game-player__badge confirmed">✓ Confirmado</span>` : '';
    return `<div class="game-player">
      <div class="game-player__avatar">${initial}</div>
      <div class="game-player__info">
        <div class="game-player__name">${p.name}</div>
        <div class="game-player__meta">
          <span>${p.position}</span>
          <span>★ ${p.rating}</span>
          ${p.confirmedAt ? `<span>· ${p.confirmedAt}</span>` : ''}
        </div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

// O relogio e o placar aparecem em mais de uma aba. Um unico ponto de escrita
// mantem tudo em sincronia sem criar um interval por aba.
function setAll(selector, value) {
  document.querySelectorAll(selector).forEach((el) => { el.textContent = value; });
}

function teamListHtml(players) {
  return players.map(p =>
    `<div class="game-team-card__player"><span>${p.name}</span><span class="game-team-card__position">${p.position}</span></div>`
  ).join('');
}

function renderTeams(teams) {
  const empty = '<div class="game-team-card__empty">Aguardando sorteio...</div>';
  const a = $id('teamAPlayers');
  const b = $id('teamBPlayers');
  if (!a || !b) return;
  a.innerHTML = teams ? teamListHtml(teams.teamA) : empty;
  b.innerHTML = teams ? teamListHtml(teams.teamB) : empty;
}

function renderEvents(events) {
  const container = $id('gameEventsList');
  if (!events || events.length === 0) {
    container.innerHTML = '<div class="game-empty">Nenhum evento registrado</div>';
    $id('gameEventsCount').textContent = '0';
    return;
  }
  container.innerHTML = events.map(e => {
    let iconClass = '';
    if (e.type === 'goal') iconClass = e.team === 'A' ? 'goal-a' : 'goal-b';
    else if (e.type === 'yellow') iconClass = 'yellow';
    else if (e.type === 'red') iconClass = 'red';
    const iconName = e.type === 'goal' ? 'circle' : (e.type === 'red' ? 'octagon' : 'alert-triangle');
    return `<div class="game-event">
      <i class="ic game-event__icon ${iconClass}" data-lucide="${iconName}" style="width:16px;height:16px"></i>
      <span>${e.text}</span>
    </div>`;
  }).join('');
  $id('gameEventsCount').textContent = events.length;
}

function renderPhaseDots(phase) {
  // A fase vira atributo no container: o CSS esconde o placar da aba Cronometro
  // fora de "em campo" sem precisar de branch em JS.
  $id('gameScreen')?.setAttribute('data-phase', phase);
  const steps = qsa('.game-phase__step');
  const phases = ['pre-game', 'during-game', 'post-game'];
  const idx = phases.indexOf(phase);
  steps.forEach((step, i) => {
    step.className = 'game-phase__step';
    if (i < idx) step.classList.add('done');
    else if (i === idx) step.classList.add('active');
  });
}

function updatePreGame(m) {
  $id('gamePrePhase').style.display = '';
  $id('gameDuringPhase').style.display = 'none';
  $id('gamePostPhase').style.display = 'none';
  renderPhaseDots('pre-game');

  $id('gameConfirmedCount').textContent = `${m.players.confirmed.length} jogadores`;
  $id('gamePendingCount').textContent = `${m.players.pending.length} pendentes`;
  renderPlayers(m.players.confirmed, $id('gameConfirmedList'), true);
  renderPlayers(m.players.pending, $id('gamePendingList'), false);
  renderTeams(m.teams);
  setAll('[data-game-clock-label]', 'Sua partida começa em');

  if (countdownInterval) clearInterval(countdownInterval);
  updateCountdown(m);
  countdownInterval = setInterval(() => updateCountdown(m), 1000);
}

function updateCountdown(m) {
  const diff = m.startTimestamp - Date.now();
  if (diff <= 0) {
    setAll('[data-game-countdown]', '00:00');
    setAll('[data-game-countdown-unit]', 'Hora do jogo!');
    if (match && match.phase === 'pre-game') {
      match.phase = 'during-game';
      switchPhase('during-game');
    }
    return;
  }
  const totalSec = Math.floor(diff / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    setAll('[data-game-countdown]', `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    setAll('[data-game-countdown-unit]', 'horas');
  } else {
    setAll('[data-game-countdown]', `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`);
    setAll('[data-game-countdown-unit]', min === 1 ? 'minuto' : 'minutos');
  }
}

function updateDuringGame(m) {
  $id('gamePrePhase').style.display = 'none';
  $id('gameDuringPhase').style.display = '';
  $id('gamePostPhase').style.display = 'none';
  renderPhaseDots('during-game');

  setAll('[data-game-clock-label]', 'Tempo restante');
  setAll('[data-game-countdown-unit]', '');  // o valor ja e mm:ss
  const halfNames = ['', '1º tempo', '2º tempo'];
  $id('gameHalf').textContent = halfNames[m.currentHalf] || `${m.currentHalf}º tempo`;
  setAll('[data-team-score="A"]', m.score.teamA);
  setAll('[data-team-score="B"]', m.score.teamB);

  renderTeams(m.teams);
  renderEvents(m.goals);

  if (gameTimerInterval) clearInterval(gameTimerInterval);
  updateGameTimer(m);
  gameTimerInterval = setInterval(() => updateGameTimer(m), 1000);
}

function updateGameTimer(m) {
  const now = Date.now();
  if (now >= m.endTimestamp) {
    setAll('[data-game-timer]', '00:00');
    match.phase = 'post-game';
    switchPhase('post-game');
    return;
  }
  const elapsed = Math.floor((now - m.startTimestamp) / 1000);
  m.elapsedSeconds = elapsed;
  const total = m.duration * 60;
  const remaining = Math.max(0, total - elapsed);
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  setAll('[data-game-timer]', `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`);
  // Ultimos 5 minutos: destaca o cronometro. So no placar verde — na aba
  // Cronometro o fundo e claro, entao la o realce vem do CSS.
  const warn = remaining <= 300 && remaining > 0;
  const board = $id('gameTimer');
  if (board) board.style.color = warn ? '#ffd88a' : '';
  $id('gameScreen')?.classList.toggle('is-ending', warn);
}

function updatePostGame(m) {
  $id('gamePrePhase').style.display = 'none';
  $id('gameDuringPhase').style.display = 'none';
  $id('gamePostPhase').style.display = '';
  renderPhaseDots('post-game');

  setAll('[data-game-clock-label]', 'Partida encerrada');
  setAll('[data-game-countdown]', '00:00');
  setAll('[data-game-countdown-unit]', '');
  $id('gameFinalScoreA').textContent = m.score.teamA;
  $id('gameFinalScoreB').textContent = m.score.teamB;

  if (m.score.teamA > m.score.teamB) {
    $id('gameResultWinner').textContent = `${m.teams?.teamAName || 'Time A'} venceu!`;
  } else if (m.score.teamB > m.score.teamA) {
    $id('gameResultWinner').textContent = `${m.teams?.teamBName || 'Time B'} venceu!`;
  } else {
    $id('gameResultWinner').textContent = 'Empate!';
  }

  if (countdownInterval) clearInterval(countdownInterval);
  if (gameTimerInterval) clearInterval(gameTimerInterval);

  initStars($id('gameRatingQuadra').querySelector('.game-rating__stars'));
  initStars($id('gameRatingOrganizacao').querySelector('.game-rating__stars'));

  if (m.photos && m.photos.length > 0) {
    renderPhotos(m.photos);
  }
}

function renderPhotos(photos) {
  const grid = $id('gamePhotoGrid');
  const addBtn = grid.querySelector('.game-photo-add');
  grid.innerHTML = '';
  photos.forEach(url => {
    const div = document.createElement('div');
    div.className = 'game-photo-item';
    div.innerHTML = `<img src="${url}" alt="Foto da partida">`;
    grid.appendChild(div);
  });
  grid.appendChild(addBtn);
  $id('gamePhotoCount').textContent = photos.length;
}

function switchPhase(phase) {
  if (!match) return;
  match.phase = phase;
  if (phase === 'during-game') updateDuringGame(match);
  else if (phase === 'post-game') updatePostGame(match);
  else updatePreGame(match);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleTeams() {
  if (!match) return;
  const players = [...match.players.confirmed];
  if (players.length < 2) {
    window.pqToast?.('Confirme pelo menos 2 jogadores para sortear');
    return;
  }
  // Embaralha e distribui em serpentina por nivel, para os times sairem equilibrados.
  const sorted = shuffleArray(players).sort((a, b) => b.rating - a.rating);
  const teamA = [];
  const teamB = [];
  sorted.forEach((player, index) => {
    const toA = index % 4 === 0 || index % 4 === 3;
    (toA ? teamA : teamB).push(player);
  });
  const teamAName = 'Time A';
  const teamBName = 'Time B';
  match.teams = { teamA, teamB, teamAName, teamBName };
  renderTeams(match.teams);
  venueService.setMatchTeams?.(match.id, match.teams);
  setAll('[data-team-label="A"]', teamAName);
  setAll('[data-team-label="B"]', teamBName);
  window.pqToast?.('Times sorteados!');
}

function addGoal(team) {
  if (!match || match.phase !== 'during-game') return;
  match.score[`team${team}`]++;
  const scorer = prompt(`Quem marcou o gol? (Time ${team})`);
  const assist = prompt(`Assistência de (opcional):`);
  const goal = {
    type: 'goal',
    team,
    scorer: scorer || 'Desconhecido',
    assist: assist || null,
    text: `${scorer || 'Alguém'} marcou para o ${team === 'A' ? (match.teams?.teamAName || 'Time A') : (match.teams?.teamBName || 'Time B')}${assist ? ` (assist: ${assist})` : ''}`
  };
  match.goals.push(goal);
  setAll('[data-team-score="A"]', match.score.teamA);
  setAll('[data-team-score="B"]', match.score.teamB);
  renderEvents(match.goals);
}

function addCard(type) {
  if (!match || match.phase !== 'during-game') return;
  const player = prompt(`Jogador que recebeu o cartão ${type}:`);
  if (!player) return;
  const team = prompt('Time (A ou B):').toUpperCase();
  if (team !== 'A' && team !== 'B') return;
  const card = {
    type,
    player,
    team,
    text: `🟨 ${player} (${team === 'A' ? (match.teams?.teamAName || 'Time A') : (match.teams?.teamBName || 'Time B')})`
  };
  if (type === 'red') card.text = `🟥 ${player} (${team})`;
  match.goals.push(card);
  renderEvents(match.goals);
}

function endMatch() {
  if (!match || match.phase !== 'during-game') return;
  if (!confirm('Encerrar a partida? Os times serão notificados.')) return;
  match.endTimestamp = Date.now();
  match.phase = 'post-game';
  switchPhase('post-game');
}

function selectGameTab(name) {
  qsa('[data-game-tab]').forEach((tab) => {
    const on = tab.dataset.gameTab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  qsa('[data-game-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.gamePanel !== name;
  });
}

function initGameTabs() {
  qsa('[data-game-tab]').forEach((tab) => {
    tab.addEventListener('click', () => selectGameTab(tab.dataset.gameTab));
  });
  // Com a bola rolando o cronometro e o que interessa; fora isso, a partida.
  selectGameTab(match?.phase === 'during-game' ? 'cronometro' : 'partida');
}

export async function loadGame(matchId) {
  try {
    match = await venueService.getActiveMatch();
    if (!match) return false;

    $id('gameVenueImg').src = match.venueImage;
    $id('gameVenueName').textContent = match.venueName;
    $id('gameVenueAddress').textContent = match.address;
    $id('gameSport').textContent = match.sport;
    $id('gameTime').textContent = `${match.date} às ${match.startTime}`;
    $id('gameDuration').textContent = `${match.duration} min`;
    $id('gameOrganizer').textContent = match.organizer.name;
    setAll('[data-team-label="A"]', match.teams?.teamAName || 'Time A');
    setAll('[data-team-label="B"]', match.teams?.teamBName || 'Time B');

    if (match.phase === 'during-game') updateDuringGame(match);
    else if (match.phase === 'post-game') updatePostGame(match);
    else updatePreGame(match);

    bindEvents();
    initGameTabs();
    isGameActive = true;

    if (typeof window !== 'undefined') {
      window.gameMatch = match;
    }

    return true;
  } catch (e) {
    console.error('Erro ao carregar partida:', e);
    return false;
  }
}

function bindEvents() {
  const $ = $id;

  $('gameBtnMap')?.addEventListener('click', () => {
    if (!match) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${match.lat},${match.lng}`;
    window.open(url, '_blank');
  });

  $('gameBtnShareLocation')?.addEventListener('click', () => {
    if (!match) return;
    const url = `https://www.google.com/maps?q=${match.lat},${match.lng}`;
    if (navigator.share) {
      navigator.share({ title: match.venueName, text: `Vou jogar no ${match.venueName}!`, url });
    } else {
      navigator.clipboard?.writeText(url);
      window.pqToast?.('Link copiado!');
    }
  });

  $('gameBtnConfirm')?.addEventListener('click', async () => {
    await venueService.confirmPresence(match?.id);
    window.pqToast?.('Presença confirmada!');
    $('gameBtnConfirm').textContent = '✓ Confirmado';
    $('gameBtnConfirm').disabled = true;
    $('gameBtnConfirm').style.opacity = '0.6';
  });

  $('gameBtnDelay')?.addEventListener('click', () => {
    const min = prompt('Quantos minutos de atraso?', '10');
    if (min && !isNaN(min)) {
      venueService.notifyDelay(match?.id, parseInt(min));
      window.pqToast?.(`Aviso de ${min}min enviado ao organizador`);
    }
  });

  qsa('.game-score-btn').forEach(btn => {
    btn.addEventListener('click', () => addGoal(btn.dataset.team));
  });

  $('gameShuffleBtn')?.addEventListener('click', shuffleTeams);

  $('gameBtnEndMatch')?.addEventListener('click', endMatch);

  $('gamePhotoAdd')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      if (!match) return;
      const files = Array.from(e.target.files);
      match.photos = match.photos || [];
      files.forEach(f => match.photos.push(URL.createObjectURL(f)));
      renderPhotos(match.photos);
      window.pqToast?.(`${files.length} foto(s) adicionada(s)`);
    };
    input.click();
  });

  $('gameShareResult')?.addEventListener('click', () => {
    if (!match) return;
    const text = `🏟 Partiu Quadra!\n${match.venueName}: ${match.score.teamA} × ${match.score.teamB}\n#PartiuQuadra`;
    if (navigator.share) {
      navigator.share({ title: 'Resultado da partida', text });
    } else {
      navigator.clipboard?.writeText(text);
      window.pqToast?.('Resultado copiado!');
    }
  });

  $('gameShareWhatsApp')?.addEventListener('click', () => {
    if (!match) return;
    const text = encodeURIComponent(`🏟 Partiu Quadra!\n${match.venueName}: ${match.score.teamA} × ${match.score.teamB}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  });
}

export function getActiveMatch() {
  return match;
}

export function isInGameMode() {
  return isGameActive;
}

export function destroyGame() {
  if (countdownInterval) clearInterval(countdownInterval);
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  isGameActive = false;
  match = null;
}
