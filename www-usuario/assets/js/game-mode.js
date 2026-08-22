import venueService from '../../services/venues.js';
import storage from '../../storage/storage.js';
import { qsa } from '../../utils/helpers.js';

let match = null;
let countdownInterval = null;
let gameTimerInterval = null;
let roundInterval = null;
let matchObserver = null;
let isGameActive = false;
let tvWakeLock = null;
let gameTabsDelegated = false;

function $id(id) { return document.getElementById(id); }

function initStars(container) {
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'game-rating__star';
    // Icone, nao caractere: o simbolo cru herda a fonte do sistema e
    // sai com peso e alinhamento diferentes em cada aparelho.
    btn.innerHTML = '<i class="ic ic-star" data-lucide="star"></i>';
    btn.dataset.value = i;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.game-rating__star').forEach((s, idx) => {
        s.classList.toggle('active', idx < i);
      });
    });
    container.appendChild(btn);
  }
  // Sem isso os <i data-lucide> ficam vazios e as estrelas somem da tela.
  window.pqRefreshIcons?.(container);
}

function renderPlayers(list, container, showBadge) {
  container.innerHTML = list.map(p => {
    const initial = p.name.charAt(0).toUpperCase();
    const badge = showBadge ? `<span class="game-player__badge confirmed"><i class="ic" data-lucide="check"></i>Confirmado</span>` : '';
    return `<div class="game-player">
      <div class="game-player__avatar">${initial}</div>
      <div class="game-player__info">
        <div class="game-player__name">${p.name}</div>
        <div class="game-player__meta">
          <span>${p.position}</span>
          <span><i class="ic ic-star" data-lucide="star"></i>${p.rating}</span>
          ${p.confirmedAt ? `<span>· ${p.confirmedAt}</span>` : ''}
        </div>
      </div>
      ${badge}
    </div>`;
  }).join('');
  window.pqRefreshIcons?.(container);
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

function renderTeams() {
  renderTeamsEmpty();
  const empty = '<div class="game-team-card__empty">Ainda não sorteou</div>';
  const a = $id('teamAPlayers');
  const b = $id('teamBPlayers');
  if (a) a.innerHTML = teamOnSide('A') ? teamListHtml(teamOnSide('A').players) : empty;
  if (b) b.innerHTML = teamOnSide('B') ? teamListHtml(teamOnSide('B').players) : empty;
  renderQueue();
}

function renderQueue() {
  const block = document.querySelector('[data-queue-block]');
  const list = document.querySelector('[data-queue-list]');
  if (!block || !list) return;
  const queue = match?.teams?.queue || [];
  block.hidden = queue.length === 0;
  document.querySelector('[data-queue-count]') &&
    (document.querySelector('[data-queue-count]').textContent =
      queue.length === 1 ? '1 time' : queue.length + ' times');
  list.innerHTML = queue.map((id, i) => {
    const team = teamById(id);
    if (!team) return '';
    const badge = i === 0 ? '<span class="game-queue__next">Próximo</span>' : '';
    const names = team.players.map((p) => p.name.split(' ')[0]).join(', ');
    return '<div class="game-queue__item" data-team-accent="' + team.accent + '">' +
      '<span class="game-queue__pos">' + (i + 1) + '</span>' +
      '<span class="game-queue__info"><strong>' + team.name + '</strong><small>' + names + '</small></span>' +
      badge +
    '</div>';
  }).join('');
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
  renderTeams();
  renderRoundClock();
  renderRoundControls();

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

  setAll('[data-game-countdown-unit]', '');  // o valor ja e mm:ss
  const halfNames = ['', '1º tempo', '2º tempo'];
  $id('gameHalf').textContent = halfNames[m.currentHalf] || `${m.currentHalf}º tempo`;
  setAll('[data-team-score="A"]', m.score.teamA);
  setAll('[data-team-score="B"]', m.score.teamB);

  renderTeams();
  renderEvents(m.goals);

  renderScore();
  renderRounds();
  renderRoundClock();
  renderRoundControls();
  syncTeamLabels();

  // A contagem regressiva da FASE morre aqui. Sem isto ela continua viva
  // escrevendo '00:00' a cada segundo por cima do cronometro da rodada, e o
  // relogio pisca entre o valor certo e zero.
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  tickDuringGame(m);
  gameTimerInterval = setInterval(() => tickDuringGame(m), 500);
}

/* Dois relogios com papeis distintos: o da rodada (controlavel, e o que
   aparece grande) e o da reserva, que so vira nota de rodape e decide
   quando a partida acaba de vez. */
function tickDuringGame(m) {
  renderRoundClock();
  const left = m.endTimestamp - Date.now();
  if (left <= 0) {
    match.phase = 'post-game';
    switchPhase('post-game');
    return;
  }
  const min = Math.floor(left / 60000);
  document.querySelectorAll('[data-venue-note]').forEach((el) => { el.hidden = false; });
  setAll('[data-venue-remaining]', min >= 60
    ? Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0')
    : min + ' min');
}

function updatePostGame(m) {
  $id('gamePrePhase').style.display = 'none';
  $id('gameDuringPhase').style.display = 'none';
  $id('gamePostPhase').style.display = '';
  renderPhaseDots('post-game');

  setAll('[data-game-countdown]', '00:00');
  setAll('[data-game-countdown-unit]', '');
  $id('gameFinalScoreA').textContent = m.score.teamA;
  $id('gameFinalScoreB').textContent = m.score.teamB;

  if (m.score.teamA > m.score.teamB) {
    $id('gameResultWinner').textContent = `${teamNameOnSide('A')} venceu!`;
  } else if (m.score.teamB > m.score.teamA) {
    $id('gameResultWinner').textContent = `${teamNameOnSide('B')} venceu!`;
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

/* ═══════════════ Persistencia ═══════════════
   Sem isto, sair de #game e voltar apagava o sorteio e o placar — o
   getActiveMatch() do mock reclona a semente a cada chamada e todo metodo de
   escrita e um no-op {ok:true}.

   A chave inclui startTimestamp de proposito: demoMatchOffsetMinutes()
   recalcula os timestamps por query string, entao ?partida=aovivo e
   ?partida=fim sao partidas diferentes — sem isso o placar de um demo
   vazaria para o outro. */
function matchStateKey() {
  /* So o id. Antes entrava tambem o startTimestamp, que e recalculado na
     carga do modulo (Date.now() + offset do demo) — entao a chave mudava a
     cada F5 e o estado salvo NUNCA casava. Placar, times e cronometro
     sumiam em silencio a cada recarga. */
  return match ? String(match.id) : null;
}

function saveMatchState() {
  const key = matchStateKey();
  if (!key) return;
  storage.set('match_state', {
    key,
    teams: match.teams,
    score: match.score,
    goals: match.goals,
    rounds: match.rounds,
    roundNumber: match.roundNumber,
    round: match.round
  });
}

function restoreMatchState() {
  const key = matchStateKey();
  if (!key) return;
  const saved = storage.get('match_state', null);
  if (!saved || saved.key !== key) return;
  match.teams = normalizeTeams(saved.teams);
  match.score = saved.score || match.score;
  match.goals = saved.goals || match.goals;
  match.rounds = saved.rounds || [];
  match.roundNumber = saved.roundNumber || 1;
  match.round = saved.round || match.round;
  /* Retoma PAUSADO, sem somar o tempo em que o app esteve fechado. O codigo
     anterior dizia fazer isso no comentario e fazia o contrario: somava a
     ausencia inteira, entao sair 15 minutos com uma rodada de 10 rodando
     devolvia 00:00. */
  if (match.round?.running) {
    match.round.startedAt = null;
    match.round.running = false;
  }
}

export function clearMatchState() {
  storage.remove('match_state');
}

const TEAM_ACCENTS = 6;

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ═══════════════ Times ═══════════════
   match.score continua {teamA, teamB} de proposito: o app inteiro fala
   "lado A / lado B" (data-team-score, .team-a, buildGameCard na home).
   O que muda e QUEM ocupa cada lado — onCourt. Assim mobile.js nao muda. */

function normalizeTeams(raw) {
  if (!raw) return null;
  if (Array.isArray(raw.list)) return raw;
  if (raw.teamA || raw.teamB) {
    return {
      version: 2,
      rule: 'winner-stays',
      list: [
        { id: 't1', name: raw.teamAName || 'Time 1', accent: 0, players: raw.teamA || [] },
        { id: 't2', name: raw.teamBName || 'Time 2', accent: 1, players: raw.teamB || [] }
      ],
      onCourt: { A: 't1', B: 't2' },
      queue: []
    };
  }
  return null;
}

function teamById(id) {
  return match?.teams?.list.find((t) => t.id === id) || null;
}

function teamOnSide(side) {
  return teamById(match?.teams?.onCourt?.[side]);
}

function teamNameOnSide(side) {
  return teamOnSide(side)?.name || (side === 'A' ? 'Time A' : 'Time B');
}

function syncTeamLabels() {
  setAll('[data-team-label="A"]', teamNameOnSide('A'));
  setAll('[data-team-label="B"]', teamNameOnSide('B'));
  const accentA = teamOnSide('A')?.accent ?? 0;
  const accentB = teamOnSide('B')?.accent ?? 1;
  const cardA = $id('teamACard');
  const cardB = $id('teamBCard');
  if (cardA) cardA.dataset.teamAccent = accentA;
  if (cardB) cardB.dataset.teamAccent = accentB;
}

/* Serpentina: para 2 times reproduz a distribuicao anterior (0->A, 1->B,
   2->B, 3->A), entao o caso padrão nao regride. */
function snakeDraft(sorted, teamCount) {
  const buckets = Array.from({ length: teamCount }, () => []);
  sorted.forEach((player, i) => {
    const round = Math.floor(i / teamCount);
    const pos = i % teamCount;
    buckets[round % 2 === 0 ? pos : teamCount - 1 - pos].push(player);
  });
  return buckets;
}

function selectedTeamCount() {
  const on = document.querySelector('[data-team-count].is-on');
  return Math.min(6, Math.max(2, Number(on?.dataset.teamCount) || 2));
}

/* Alimenta o anel do relogio. Recebe 0..1 e vira porcentagem no CSS. */
function setClockProgress(fraction) {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  document.querySelectorAll('[data-clock-dial]').forEach((el) => {
    el.style.setProperty('--game-progress', String(pct));
  });
}

/* Estado vazio da aba Times: mostra quantos ja confirmaram e quantos por
   time. Sem isso o botao de sortear ficava sem contexto e a aba virava um
   vazio de meia tela. */
function renderTeamsEmpty() {
  const bloco = document.querySelector('[data-teams-empty]');
  const grade = document.getElementById('gameTeamsDisplay');
  if (!bloco || !grade) return;

  const sorteado = Boolean(match?.teams?.list?.length);
  bloco.hidden = sorteado;
  grade.hidden = !sorteado;
  if (sorteado) return;

  const total = match?.players?.confirmed?.length || 0;
  const times = selectedTeamCount();
  const titulo = bloco.querySelector('[data-teams-empty-count]');
  const dica = bloco.querySelector('[data-teams-empty-hint]');
  if (titulo) {
    titulo.textContent = total
      ? `${total} ${total === 1 ? 'confirmado' : 'confirmados'}`
      : 'Ninguém confirmado ainda';
  }
  if (dica) {
    dica.textContent = total >= times
      ? `Dá para ${times} times de ${Math.floor(total / times)}. Toque em sortear.`
      : `Faltam ${times - total} para fechar ${times} times.`;
  }
}

function shuffleTeams() {
  if (!match) return;
  const count = selectedTeamCount();
  const players = [...(match.players?.confirmed || [])];
  if (players.length < count) {
    window.pqToast?.('Confirme pelo menos ' + count + ' jogadores para ' + count + ' times');
    return;
  }
  const sorted = shuffleArray(players).sort((a, b) => b.rating - a.rating);
  const list = snakeDraft(sorted, count).map((squad, i) => ({
    id: 't' + (i + 1),
    name: 'Time ' + (i + 1),
    accent: i % TEAM_ACCENTS,
    players: squad
  }));

  match.teams = {
    version: 2,
    rule: 'winner-stays',
    list,
    onCourt: { A: list[0].id, B: list[1].id },
    queue: list.slice(2).map((t) => t.id)
  };
  match.score = { teamA: 0, teamB: 0 };
  match.roundNumber = 1;
  match.rounds = [];
  resetRound({ silent: true });

  renderTeams();
  syncTeamLabels();
  renderScore();
  renderRounds();
  venueService.setMatchTeams?.(match.id, match.teams);
  saveMatchState();
  window.pqToast?.(count === 2 ? 'Times sorteados!' : count + ' times sorteados!');
}

/* Invariante que dispensa contador de sequencia: o lado A e sempre quem esta
   em quadra ha mais tempo. Por isso, no empate, quem sai e o A. */
function endRound() {
  if (!match?.teams) {
    window.pqToast?.('Sorteie os times primeiro');
    return;
  }
  const { A, B } = match.teams.onCourt;
  const a = match.score.teamA;
  const b = match.score.teamB;
  const winner = a > b ? A : (b > a ? B : null);

  match.rounds = match.rounds || [];
  match.rounds.push({
    number: match.roundNumber || 1,
    a: A,
    b: B,
    score: { a, b },
    winner,
    endedAt: Date.now()
  });
  match.roundNumber = (match.roundNumber || 1) + 1;
  match.score = { teamA: 0, teamB: 0 };

  const queue = match.teams.queue;
  if (queue.length) {
    const stays = winner || B;
    const leaves = stays === A ? B : A;
    const next = queue.shift();
    queue.push(leaves);
    match.teams.onCourt = { A: stays, B: next };
    window.pqToast?.(winner
      ? teamById(winner).name + ' fica em quadra'
      : 'Empate — ' + teamById(leaves).name + ' sai');
  } else {
    window.pqToast?.('Rodada encerrada');
  }

  resetRound({ silent: true });
  renderTeams();
  syncTeamLabels();
  renderScore();
  renderRounds();
  saveMatchState();
}

function stepScore(side, delta) {
  if (!match) return;
  const key = 'team' + side;
  const next = Math.max(0, (match.score[key] || 0) + delta);
  if (next === match.score[key]) return;
  match.score[key] = next;
  match.goals = match.goals || [];
  if (delta > 0) {
    match.goals.push({
      type: 'goal',
      team: side,
      text: 'Gol do ' + teamNameOnSide(side) + ' · rodada ' + (match.roundNumber || 1)
    });
  } else {
    // desfaz o ultimo gol daquele lado (correcao de toque errado)
    const back = [...match.goals].reverse().findIndex((g) => g.type === 'goal' && g.team === side);
    if (back >= 0) match.goals.splice(match.goals.length - 1 - back, 1);
  }
  renderScore();
  renderEvents(match.goals);
  saveMatchState();
}

function renderScore() {
  setAll('[data-team-score="A"]', match?.score?.teamA ?? 0);
  setAll('[data-team-score="B"]', match?.score?.teamB ?? 0);
}

function renderRounds() {
  setAll('[data-round-label]', 'Rodada ' + (match?.roundNumber || 1));
}

/* ═══════════════ Cronometro da rodada ═══════════════
   Independente do relogio da reserva: a pessoa define a duracao, inicia,
   pausa e zera. O tempo de quadra vira nota de rodape. */

function roundState() {
  if (!match.round) {
    match.round = { durationMin: 10, elapsedMs: 0, startedAt: null, running: false };
  }
  return match.round;
}

function roundRemainingMs() {
  const r = roundState();
  const live = r.running && r.startedAt ? Date.now() - r.startedAt : 0;
  return Math.max(0, r.durationMin * 60000 - (r.elapsedMs + live));
}

function formatMs(ms) {
  const total = Math.ceil(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function renderRoundClock() {
  if (!match) return;
  const remaining = roundRemainingMs();
  const total = roundState().durationMin * 60000 || 1;
  setClockProgress(1 - remaining / total);
  setAll('[data-game-timer]', formatMs(remaining));
  setAll('[data-game-countdown]', formatMs(remaining));
  $id('gameScreen')?.classList.toggle('is-ending', remaining <= 60000 && remaining > 0);
  if (remaining <= 0 && roundState().running) {
    pauseRound();
    window.pqToast?.('Fim do tempo!');
    navigator.vibrate?.([200, 100, 200]);
  }
}

function renderRoundControls() {
  const r = roundState();
  setAll('[data-round-toggle-label]', r.running ? 'Pausar' : (r.elapsedMs > 0 ? 'Retomar' : 'Iniciar'));
  const toggle = document.querySelector('[data-round-toggle]');
  const icon = toggle?.querySelector('.ic');
  if (icon) {
    icon.setAttribute('data-lucide', r.running ? 'pause' : 'play');
    window.pqRefreshIcons?.(toggle);
  }
  qsa('[data-round-duration]').forEach((chip) => {
    chip.classList.toggle('is-on', Number(chip.dataset.roundDuration) === r.durationMin);
  });
}

/* O cronometro da rodada precisa de tick PROPRIO.

   Antes ele dependia de gameTimerInterval, que so nasce dentro de
   updateDuringGame — ou seja, so quando a partida ja comecou. No caso
   padrão (partida daqui a 25 min, fase pre-game) apertar Iniciar trocava o
   rotulo do botao e o numero nunca se mexia. Era literalmente impossivel
   cronometrar antes do horário da reserva. */
function startRoundTicker() {
  if (roundInterval) clearInterval(roundInterval);
  roundInterval = setInterval(renderRoundClock, 250);
}

function stopRoundTicker() {
  if (roundInterval) clearInterval(roundInterval);
  roundInterval = null;
}

function startRound() {
  const r = roundState();
  if (r.running) return;
  if (roundRemainingMs() <= 0) r.elapsedMs = 0;
  r.startedAt = Date.now();
  r.running = true;
  startRoundTicker();
  renderRoundClock();
  renderRoundControls();
  saveMatchState();
}

function pauseRound() {
  const r = roundState();
  if (!r.running) return;
  r.elapsedMs += Date.now() - (r.startedAt || Date.now());
  r.startedAt = null;
  r.running = false;
  stopRoundTicker();
  renderRoundClock();
  renderRoundControls();
  saveMatchState();
}

function toggleRound() {
  if (roundState().running) pauseRound();
  else startRound();
}

function resetRound(opts) {
  const r = roundState();
  r.elapsedMs = 0;
  r.startedAt = null;
  r.running = false;
  stopRoundTicker();
  renderRoundClock();
  renderRoundControls();
  if (!opts || !opts.silent) {
    window.pqToast?.('Zerado');
    saveMatchState();
  }
}

function setRoundDuration(min) {
  const r = roundState();
  r.durationMin = Math.min(60, Math.max(1, Number(min) || 10));
  r.elapsedMs = 0;
  r.startedAt = null;
  r.running = false;
  stopRoundTicker();
  renderRoundClock();
  renderRoundControls();
  saveMatchState();
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
  // Delegacao registrada uma unica vez. Antes era um listener por elemento,
  // religado a cada loadGame(): as abas do topo morrem junto com o fragmento
  // da rota, mas as do rodape vivem fora dele e acumulariam um listener a
  // cada visita a #game. Um listener para a vida do modulo cobre as duas
  // fileiras pelo mesmo caminho.
  if (!gameTabsDelegated) {
    gameTabsDelegated = true;
    document.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-game-tab]');
      if (tab) selectGameTab(tab.dataset.gameTab);
    });
  }
  // Com a bola rolando o cronometro e o que interessa; fora isso, a partida.
  selectGameTab(match?.phase === 'during-game' ? 'cronometro' : 'partida');
}

/**
 * Retorna 'ok' | 'empty' | 'error'.
 *
 * A distincao importa: um try/catch unico transformava qualquer excecao de
 * montagem em "nenhuma partida ativa", ou seja, um bug de codigo aparecia
 * para a pessoa como um estado de dados legitimo. Falha de montagem agora
 * diz que falhou.
 */
// Fullscreen, trava de orientacao e wake lock sao todos best-effort: cada um
// falha em alguma plataforma e nenhum deles e necessario — a rotacao real
// vem do CSS. Por isso os tres em try/catch separados.
/* Placar por arraste, no Modo placar.

   Nao existia nenhum handler de gesto no projeto — este e o primeiro. Tres
   cuidados que fazem a diferenca no meio de um jogo:

   - LIMIAR de 40px antes de contar o primeiro gol. Toque parado ou tremida
     de mao nao viram placar.
   - setPointerCapture, para o dedo poder sair de cima do numero sem soltar
     o gesto no meio.
   - o eixo e travado no primeiro movimento: se a pessoa comecou arrastando
     de lado, nao vira gol nenhum. Evita gol acidental ao tentar rolar.

   Cada 40px arrastados = 1 gol, entao da para somar varios num gesto so. */
const DRAG_STEP = 40;

function bindScoreDrag() {
  document.querySelectorAll('[data-score-drag]').forEach((el) => {
    if (el.dataset.dragBound) return;
    el.dataset.dragBound = '1';

    let inicioY = 0;
    let inicioX = 0;
    let aplicados = 0;
    let eixo = null;

    let arrastando = false;

    el.addEventListener('pointerdown', (event) => {
      inicioY = event.clientY;
      inicioX = event.clientX;
      aplicados = 0;
      eixo = null;
      arrastando = true;
      // A captura e conveniencia, nao pre-requisito: em alguns navegadores
      // ela recusa, e travar o gesto atras dela mataria o arraste inteiro.
      try { el.setPointerCapture(event.pointerId); } catch (erro) { /* segue sem */ }
      el.classList.add('is-dragging');
    });

    el.addEventListener('pointermove', (event) => {
      if (!arrastando) return;
      const dy = inicioY - event.clientY;
      const dx = event.clientX - inicioX;

      if (!eixo) {
        if (Math.abs(dy) < 12 && Math.abs(dx) < 12) return;
        eixo = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
      }
      if (eixo !== 'y') return;
      event.preventDefault();

      const passos = Math.trunc(dy / DRAG_STEP);
      if (passos === aplicados) return;
      const delta = passos - aplicados;
      aplicados = passos;
      stepScore(el.dataset.scoreDrag, delta);
      navigator.vibrate?.(12);
    });

    const soltar = (event) => {
      arrastando = false;
      el.classList.remove('is-dragging');
      try { el.releasePointerCapture(event.pointerId); } catch (erro) { /* ja solto */ }
    };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);

    // Teclado: o gesto nao pode ser o unico caminho.
    el.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp') { event.preventDefault(); stepScore(el.dataset.scoreDrag, 1); }
      if (event.key === 'ArrowDown') { event.preventDefault(); stepScore(el.dataset.scoreDrag, -1); }
    });
  });
}

async function openTvMode() {
  const el = $id('gameTvMode');
  if (!el) return;
  el.hidden = false;
  document.body.classList.add('is-tv-open');
  bindScoreDrag();
  renderRoundControls();
  try { await document.documentElement.requestFullscreen?.(); } catch (e) { /* recusado: segue */ }
  try { await screen.orientation?.lock?.('landscape'); } catch (e) { /* iOS sempre recusa */ }
  try { tvWakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { /* sem suporte */ }
}

async function closeTvMode() {
  const el = $id('gameTvMode');
  if (el) el.hidden = true;
  document.body.classList.remove('is-tv-open');
  try { screen.orientation?.unlock?.(); } catch (e) { /* nao travou */ }
  try { if (document.fullscreenElement) await document.exitFullscreen?.(); } catch (e) { /* nada */ }
  try { await tvWakeLock?.release(); } catch (e) { /* nada */ }
  tvWakeLock = null;
}

function isTvOpen() {
  return $id('gameTvMode')?.hidden === false;
}

export async function loadGame(matchId) {
  try {
    match = await venueService.getActiveMatch();
  } catch (error) {
    console.error('[game] falha ao buscar a partida:', error);
    return 'error';
  }
  if (!match) return 'empty';

  try {
    $id('gameVenueImg').src = match.venueImage;
    $id('gameVenueName').textContent = match.venueName;
    $id('gameVenueAddress').textContent = match.address;
    $id('gameSport').textContent = match.sport;
    $id('gameTime').textContent = `${match.date} às ${match.startTime}`;
    $id('gameDuration').textContent = `${match.duration} min`;
    $id('gameOrganizer').textContent = match.organizer.name;
    const endEl = $id('gameVenueEnd');
    if (endEl) endEl.textContent = match.endTime || '--:--';

    match.teams = normalizeTeams(match.teams);
    restoreMatchState();
    syncTeamLabels();
    renderRounds();

    if (match.phase === 'during-game') updateDuringGame(match);
    else if (match.phase === 'post-game') updatePostGame(match);
    else updatePreGame(match);

    bindEvents();
    initGameTabs();
    isGameActive = true;

    if (typeof window !== 'undefined') {
      window.gameMatch = match;
    }

    return 'ok';
  } catch (error) {
    console.error('[game] falha ao montar a tela da partida:', error);
    return 'error';
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
    $('gameBtnConfirm').innerHTML = '<i class="ic" data-lucide="check"></i>Confirmado';
    window.pqRefreshIcons?.($('gameBtnConfirm'));
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

  qsa('[data-score-step]').forEach((btn) => {
    const [side, delta] = btn.dataset.scoreStep.split(':');
    btn.addEventListener('click', () => stepScore(side, Number(delta)));
  });

  qsa('[data-round-toggle]').forEach((btn) => btn.addEventListener('click', toggleRound));
  qsa('[data-round-reset]').forEach((btn) => btn.addEventListener('click', () => resetRound()));
  qsa('[data-round-end]').forEach((btn) => btn.addEventListener('click', endRound));

  qsa('[data-round-duration]').forEach((chip) => {
    chip.addEventListener('click', () => setRoundDuration(chip.dataset.roundDuration));
  });

  qsa('[data-team-count]').forEach((chip) => {
    chip.addEventListener('click', () => {
      qsa('[data-team-count]').forEach((c) => c.classList.toggle('is-on', c === chip));
      // A dica do estado vazio fala em "N times de X" — tem que acompanhar.
      renderTeamsEmpty();
    });
  });

  qsa('[data-goto-tab]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      selectGameTab(el.dataset.gotoTab);
    });
  });

  $('gameShuffleBtn')?.addEventListener('click', shuffleTeams);

  $('gameBtnEndMatch')?.addEventListener('click', endMatch);

  $('gameTvBtn')?.addEventListener('click', openTvMode);
  qsa('[data-game-tv-close]').forEach((btn) => btn.addEventListener('click', closeTvMode));

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
    const text = `Partiu Quadra!\n${match.venueName}: ${match.score.teamA} × ${match.score.teamB}\n#PartiuQuadra`;
    if (navigator.share) {
      navigator.share({ title: 'Resultado da partida', text });
    } else {
      navigator.clipboard?.writeText(text);
      window.pqToast?.('Resultado copiado!');
    }
  });

  $('gameShareWhatsApp')?.addEventListener('click', () => {
    if (!match) return;
    const text = encodeURIComponent(`Partiu Quadra!\n${match.venueName}: ${match.score.teamA} × ${match.score.teamB}`);
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
  stopRoundTicker();
  // Sair da rota com o placar aberto deixaria a pessoa presa em tela cheia
  // e travada em paisagem — o overlay some junto com o fragmento da rota.
  closeTvMode();
  isGameActive = false;
  match = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isTvOpen()) closeTvMode();
  });
}
