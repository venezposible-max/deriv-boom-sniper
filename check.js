/* ═══════════════════════════════════════════════════════════════════════════
   KRAKEN ENGINE — Frontend Controller
   ═══════════════════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────
let state = {
  isRunning: false,
  isConnectedToDeriv: false,
  balance: 0,
  prevBalance: 0,
  pnlSession: 0,
  winsSession: 0,
  lossesSession: 0,
  totalTradesSession: 0,
  stake: 1,
  maxDailyLoss: 20,
  takeProfit: 15,
  dailyLoss: 0,
  dailyProfit: 0,
  consecutiveLosses: 0,
  maxTradesPerDay: 50,
  circuitBreakerUntil: 0,
  engineEvenOdd: true,
  engineOverUnder: true,
  engineMatch: true,
  engineStats: {
    EVEN_ODD: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
    OVER_UNDER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
    MATCH: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
  },
  shannonEntropy: 0,
  markovEdge: 0,
  hotDigit: null,
  hotDigitFreq: 0,
  lastDigit: null,
  digitHistory: [],
  digitFrequency: {},
  symbol: 'R_25',
  winRate: '0.0',
  currentEngine: null,
  currentContractType: null,
  currentBarrier: null,
  momentumShieldLevel: 0,
  consecutiveWins: 0,
  profitPeak: 0,
  profitFloor: 0
};

let prevDigitHistoryLength = 0;
let prevLastDigit = null;
let prevTotalTrades = 0;
let historyData = [];
let pnlHistory = [0];
let animatingBalance = false;
let displayedBalance = 0;
let configDebounce = null;

// ── DOM Refs ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Init digit bars ────────────────────────────────────────────────────────
function initDigitBars() {
  const barsContainer = $('digitBars');
  const labelsContainer = $('digitLabels');
  barsContainer.innerHTML = '';
  labelsContainer.innerHTML = '';
  for (let i = 0; i <= 9; i++) {
    const col = document.createElement('div');
    col.className = 'digit-bar-col';
    const bar = document.createElement('div');
    bar.className = 'digit-bar';
    bar.id = `bar-${i}`;
    bar.style.height = '4px';
    bar.style.background = i % 2 === 0
      ? 'var(--accent-green)'
      : 'var(--accent-red)';
    const count = document.createElement('span');
    count.className = 'digit-bar-count';
    count.id = `barCount-${i}`;
    count.textContent = '0';
    bar.appendChild(count);
    col.appendChild(bar);
    barsContainer.appendChild(col);

    const label = document.createElement('span');
    label.className = 'digit-bar-label';
    label.textContent = i;
    labelsContainer.appendChild(label);
  }
}

// ── Balance Animation ──────────────────────────────────────────────────────
function animateBalance(target) {
  if (displayedBalance === target) return;
  const start = displayedBalance;
  const diff = target - start;
  const duration = 600;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    displayedBalance = start + diff * ease;
    $('balanceDisplay').textContent = '$' + displayedBalance.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      displayedBalance = target;
      $('balanceDisplay').textContent = '$' + target.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  }
  requestAnimationFrame(tick);
}

// ── Format helpers ─────────────────────────────────────────────────────────
function formatMoney(val) {
  const sign = val >= 0 ? '+' : '';
  return sign + '$' + Math.abs(val).toFixed(2);
}

function pnlClass(val) {
  return val > 0 ? 'positive' : val < 0 ? 'negative' : 'neutral';
}

function calcWinRate(w, l) {
  const total = w + l;
  return total === 0 ? '0.0' : ((w / total) * 100).toFixed(1);
}

// ── Update UI ──────────────────────────────────────────────────────────────
function updateUI(data) {
  // Connection
  const dot = $('connDot');
  const label = $('connLabel');
  if (data.isConnectedToDeriv) {
    dot.classList.add('connected');
    label.textContent = 'Conectado a Deriv';
  } else {
    dot.classList.remove('connected');
    label.textContent = 'Desconectado';
  }

  // Balance
  if (data.balance !== state.balance) {
    animateBalance(data.balance);
  }

  // Stats row
  const pnlEl = $('statPnl');
  pnlEl.textContent = formatMoney(data.pnlSession);
  pnlEl.className = 'stat-value ' + pnlClass(data.pnlSession);

  const wrEl = $('statWinRate');
  wrEl.textContent = parseFloat(data.winRate).toFixed(1) + '%';

  $('statTotalTrades').textContent = data.totalTradesSession;
  $('statWinLoss').textContent = data.winsSession + ' / ' + data.lossesSession;

  // Engine toggles sync
  $('toggleEvenOdd').checked = data.engineEvenOdd;
  $('toggleOverUnder').checked = data.engineOverUnder;
  $('toggleMatch').checked = data.engineMatch;

  // Martingale sync
  const toggleCob = $('toggleCobertura');
  if (toggleCob) {
    toggleCob.checked = !!data.coberturaEnabled;
  }
  const levelDisplay = $('martingaleLevelDisplay');
  if (levelDisplay) {
    levelDisplay.textContent = 'Paso: ' + (data.martingaleStep || 0);
  }

  // Engine cards active state
  updateEngineCard('engineCardEvenOdd', 'statusEvenOdd', data.engineEvenOdd, data.isRunning, data.currentEngine === 'EVEN_ODD');
  updateEngineCard('engineCardOverUnder', 'statusOverUnder', data.engineOverUnder, data.isRunning, data.currentEngine === 'OVER_UNDER');
  updateEngineCard('engineCardMatch', 'statusMatch', data.engineMatch, data.isRunning, data.currentEngine === 'MATCH');

  // Engine stats
  updateEngineStats('eo', data.engineStats.EVEN_ODD);
  updateEngineStats('ou', data.engineStats.OVER_UNDER);
  updateEngineStats('ma', data.engineStats.MATCH);

  // Darwin mode badges toggling
  ['EVEN_ODD', 'OVER_UNDER', 'MATCH'].forEach(eng => {
    const stats = data.engineStats[eng];
    const badgeId = {
      'EVEN_ODD': 'darwinBadgeEvenOdd',
      'OVER_UNDER': 'darwinBadgeOverUnder',
      'MATCH': 'darwinBadgeMatch'
    }[eng];
    const badge = $(badgeId);
    if (badge) {
      if (stats && stats.autoDisabled) {
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    }
  });

  // Detect trade fired for pulse
  if (data.totalTradesSession > prevTotalTrades && data.currentEngine) {
    pulseEngine(data.currentEngine);
  }
  prevTotalTrades = data.totalTradesSession;

  // Digit display
  if (data.digitHistory && data.digitHistory.length > 0) {
    if (data.digitHistory.length !== prevDigitHistoryLength || data.lastDigit !== prevLastDigit) {
      renderDigitCircles(data.digitHistory, data.lastDigit);
      prevDigitHistoryLength = data.digitHistory.length;
      prevLastDigit = data.lastDigit;
    }
  }

  // Digit frequency
  renderDigitFrequency(data.digitFrequency || {});

  // Digit metrics
  $('shannonValue').textContent = parseFloat(data.shannonEntropy || 0).toFixed(3);
  $('markovValue').textContent = parseFloat(data.markovEdge || 0).toFixed(1) + '%';
  $('hotDigitValue').textContent = data.hotDigit !== null ? data.hotDigit + ' (' + (data.hotDigitFreq || 0) + ')' : '—';

  // Buttons state
  const btnStart = $('btnStart');
  if (data.isRunning) {
    btnStart.classList.add('running');
    btnStart.innerHTML = '⏸ EN EJECUCIÓN';
  } else {
    btnStart.classList.remove('running');
    btnStart.innerHTML = '▶ INICIAR';
  }

  // Market select
  $('selectMarket').value = data.symbol || 'R_25';

  // Config inputs (only update if not focused)
  if (document.activeElement !== $('inputStake')) $('inputStake').value = data.stake;
  if (document.activeElement !== $('inputMaxLoss')) $('inputMaxLoss').value = data.maxDailyLoss;
  if (document.activeElement !== $('inputTakeProfit')) $('inputTakeProfit').value = data.takeProfit;

  // Risk metrics
  const maxLoss = data.maxDailyLoss || 20;
  const tp = data.takeProfit || 15;
  $('riskDailyLoss').textContent = '$' + Math.abs(data.dailyLoss || 0).toFixed(2) + ' / $' + maxLoss;
  $('riskDailyProfit').textContent = '$' + (data.dailyProfit || 0).toFixed(2) + ' / $' + tp;

  const lossPct = Math.min((Math.abs(data.dailyLoss || 0) / maxLoss) * 100, 100);
  const profitPct = Math.min(((data.dailyProfit || 0) / tp) * 100, 100);
  $('progressLoss').style.width = lossPct + '%';
  $('progressProfit').style.width = profitPct + '%';

  // Profit Lock visual sync
  const profitLockVal = data.profitFloor || 0;
  const peakVal = data.profitPeak || 0;
  $('riskProfitLock').textContent = '$' + profitLockVal.toFixed(2);
  $('profitLockInfo').textContent = `Piso: $${profitLockVal.toFixed(2)} | Pico: $${peakVal.toFixed(2)}`;
  const progressLockPct = Math.min((profitLockVal / Math.max(peakVal, tp, 1)) * 100, 100);
  $('progressProfitLock').style.width = progressLockPct + '%';

  const remaining = (data.maxTradesPerDay || 50) - (data.totalTradesSession || 0);
  $('riskTradesRemaining').textContent = remaining + ' / ' + (data.maxTradesPerDay || 50);

  const consec = data.consecutiveLosses || 0;
  const consecEl = $('riskConsecLosses');
  consecEl.textContent = consec;
  consecEl.style.color = consec >= 3 ? 'var(--accent-red)' : 'var(--text-primary)';

  const cbEl = $('riskCircuitBreaker');
  if (data.circuitBreakerUntil && data.circuitBreakerUntil > Date.now()) {
    const secsLeft = Math.ceil((data.circuitBreakerUntil - Date.now()) / 1000);
    cbEl.className = 'ri-badge danger';
    cbEl.textContent = '⚠ Activo — ' + secsLeft + 's';
  } else {
    cbEl.className = 'ri-badge ok';
    cbEl.textContent = '✓ Inactivo';
  }

  // Momentum Shield visual sync
  const shieldLevel = data.momentumShieldLevel || 0;
  for (let i = 0; i <= 4; i++) {
    const el = $('shieldLevel' + i);
    if (el) {
      el.className = 'shield-level';
      if (i === shieldLevel) {
        el.classList.add('level-' + i + '-active');
      }
    }
  }

  const shieldTexts = {
    0: 'Normal — Motor DIFFER activo (Flujo Continuo)',
    1: 'Alerta — Continuando operación al 100% de stake',
    2: 'Defensa — Continuando operación al 100% de stake',
    3: 'Crítico — Continuando operación al 100% de stake',
    4: 'LOCKDOWN — Continuando operación al 100% de stake'
  };
  $('shieldStatusText').textContent = shieldTexts[shieldLevel] || shieldTexts[0];

  const cooldownSecs = (data.dynamicCooldown || 6000) / 1000;
  $('shieldCooldown').textContent = `Cooldown: ${cooldownSecs.toFixed(0)}s`;

  // Sparkline Chart update on every status poll
  const currentPnl = data.pnlSession || 0;
  if (data.totalTradesSession === 0 && pnlHistory.length > 1) {
    pnlHistory = [0];
    drawSparkline(pnlHistory);
  } else if (pnlHistory.length === 0 || pnlHistory[pnlHistory.length - 1] !== currentPnl) {
    pnlHistory.push(currentPnl);
    if (pnlHistory.length > 50) {
      pnlHistory.shift();
    }
    drawSparkline(pnlHistory);
  }

  // Store state
  Object.assign(state, data);
}

function updateEngineCard(cardId, statusId, enabled, running, isCurrent) {
  const card = $(cardId);
  const statusEl = $(statusId);

  if (!enabled) {
    card.classList.remove('active');
    statusEl.className = 'engine-status-text disabled';
    statusEl.innerHTML = '<span>●</span> Desactivado';
  } else if (!running) {
    card.classList.remove('active');
    statusEl.className = 'engine-status-text disabled';
    statusEl.innerHTML = '<span>●</span> En espera';
  } else if (isCurrent) {
    card.classList.add('active');
    statusEl.className = 'engine-status-text signal';
    statusEl.innerHTML = '<span>●</span> Señal detectada!';
  } else {
    card.classList.add('active');
    statusEl.className = 'engine-status-text searching';
    statusEl.innerHTML = '<span>●</span> Buscando señal...';
  }
}

function updateEngineStats(prefix, stats) {
  if (!stats) return;
  const w = stats.wins || 0;
  const l = stats.losses || 0;
  const pnl = stats.pnl || 0;
  const wr = calcWinRate(w, l);

  $(prefix + 'Wins').textContent = w;
  $(prefix + 'Losses').textContent = l;

  const pnlEl = $(prefix + 'Pnl');
  pnlEl.textContent = formatMoney(pnl);
  pnlEl.className = 'es-value ' + pnlClass(pnl);

  $(prefix + 'WinRate').textContent = wr + '%';
}

function pulseEngine(engineKey) {
  const map = {
    'EVEN_ODD': 'engineCardEvenOdd',
    'OVER_UNDER': 'engineCardOverUnder',
    'MATCH': 'engineCardMatch',
    'DIFFER': 'engineCardDiffer'
  };
  const card = $(map[engineKey]);
  if (!card) return;
  card.classList.remove('pulse-trade');
  void card.offsetWidth; // force reflow
  card.classList.add('pulse-trade');
  setTimeout(() => card.classList.remove('pulse-trade'), 900);
}

// ── Digit Circles ──────────────────────────────────────────────────────────
function renderDigitCircles(history, lastDigit) {
  const container = $('digitCircles');
  const last20 = history.slice(-20);
  container.innerHTML = '';

  last20.forEach((d, i) => {
    const el = document.createElement('div');
    const isEven = d % 2 === 0;
    const isLast = i === last20.length - 1;
    el.className = 'digit-circle ' + (isEven ? 'even' : 'odd') + (isLast ? ' current' : '');
    el.textContent = d;
    el.style.animationDelay = (i * 0.03) + 's';
    container.appendChild(el);
  });

  if (last20.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:20px 0;">Esperando datos de dígitos...</div>';
  }
}

// ── Digit Frequency Bars ───────────────────────────────────────────────────
function renderDigitFrequency(freq) {
  let maxCount = 1;
  for (let i = 0; i <= 9; i++) {
    const c = freq[i] || freq[String(i)] || 0;
    if (c > maxCount) maxCount = c;
  }

  for (let i = 0; i <= 9; i++) {
    const count = freq[i] || freq[String(i)] || 0;
    const bar = $('bar-' + i);
    const countEl = $('barCount-' + i);
    if (!bar) continue;
    const pct = (count / maxCount) * 100;
    bar.style.height = Math.max(4, pct) + '%';
    if (countEl) countEl.textContent = count;
  }
}

// Helper robusto para formatear la hora en zona horaria de Venezuela (America/Caracas)
function formatTimeVE(timeVal) {
  if (!timeVal) return '—';
  
  let d = new Date(timeVal);
  if (!isNaN(d.getTime())) {
    return d.toLocaleTimeString('es-VE', { 
      timeZone: 'America/Caracas', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  }
  
  if (typeof timeVal === 'string') {
    if (timeVal.includes(',')) {
      const parts = timeVal.split(',');
      if (parts[1]) {
        return parts[1].trim();
      }
    }
    return timeVal;
  }
  
  return '—';
}

// ── History Table ──────────────────────────────────────────────────────────
function renderHistory(history) {
  const tbody = $('historyBody');
  const countEl = $('historyCount');

  if (!history || history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-history"><span>📭</span>No hay operaciones registradas aún</td></tr>`;
    countEl.textContent = '0 operaciones';
    return;
  }

  countEl.textContent = history.length + ' operaciones';

  const last30 = history.slice(-30).reverse();
  const newHTML = last30.map((t, idx) => {
    const isWin = t.result === 'WIN' || t.profit > 0;
    const rowClass = isWin ? 'win' : 'loss';
    const resultBadge = isWin
      ? '<span class="result-badge win">✓ Ganada</span>'
      : '<span class="result-badge loss">✗ Perdida</span>';
    const profitStr = (t.profit >= 0 ? '+' : '') + '$' + Math.abs(t.profit || 0).toFixed(2);
    const profitClass = t.profit >= 0 ? 'positive' : 'negative';
    const balStr = '$' + (t.balanceAfter || 0).toFixed(2);
    const time = formatTimeVE(t.time);
    const num = history.length - idx;

    const engineLabel = {
      'EVEN_ODD': 'Even/Odd',
      'OVER_UNDER': 'Over/Under',
      'MATCH': 'Match'
    }[t.engine] || t.engine || '—';

    return `<tr class="${rowClass}">
      <td>${num}</td>
      <td>${time}</td>
      <td>${engineLabel}</td>
      <td>${t.contractType || t.type || '—'}</td>
      <td>${t.barrier !== undefined && t.barrier !== null ? t.barrier : '—'}</td>
      <td>${t.digit !== undefined && t.digit !== null ? t.digit : '—'}</td>
      <td>${resultBadge}</td>
      <td class="${profitClass}">${profitStr}</td>
      <td>${balStr}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = newHTML;
}

// ── Draw Sparkline Chart ───────────────────────────────────────────────────
function drawSparkline(points) {
  const canvas = $('pnlSparkline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  if (points.length < 2) {
    ctx.beginPath();
    ctx.strokeStyle = 'var(--text-muted)';
    ctx.lineWidth = 2;
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min === 0 ? 1 : max - min;

  const isUp = points[points.length - 1] >= points[0];
  const color = isUp ? '#10b981' : '#ef4444';
  const colorDim = isUp ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';

  ctx.beginPath();
  
  const coords = points.map((p, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const y = height - 4 - ((p - min) / range) * (height - 8);
    return { x, y };
  });

  ctx.moveTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i++) {
    ctx.lineTo(coords[i].x, coords[i].y);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Area under
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, colorDim);
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fill();
}

// ── API Calls ──────────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const json = await res.json();
    if (json.success && json.data) {
      updateUI(json.data);
    }
  } catch (e) {
    $('connDot').classList.remove('connected');
    $('connLabel').textContent = 'Sin conexión al servidor';
  }
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/history');
    const json = await res.json();
    if (json.success && json.history) {
      if (JSON.stringify(json.history) !== JSON.stringify(historyData)) {
        historyData = json.history;
        renderHistory(historyData);
        
        // Reconstruct PnL history path
        const reconstructedPnl = [0];
        let currentSum = 0;
        historyData.forEach(t => {
          currentSum += t.profit || 0;
          reconstructedPnl.push(currentSum);
        });
        pnlHistory = reconstructedPnl.slice(-50);
        drawSparkline(pnlHistory);
      }
    }
  } catch (e) { /* silent */ }
}

async function handleStart() {
  const stake = parseFloat($('inputStake').value) || 1;
  const maxDailyLoss = parseFloat($('inputMaxLoss').value) || 20;
  const takeProfit = parseFloat($('inputTakeProfit').value) || 15;

  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'START', stake, maxDailyLoss, takeProfit })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Kraken v2.0 Iniciado', 'success');
    } else {
      showToast('Error: ' + (json.error || 'No se pudo iniciar'), 'error');
    }
  } catch (e) {
    showToast('Error de conexión al servidor', 'error');
  }
  fetchStatus();
}

async function handleStop() {
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'STOP' })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Kraken v2.0 Detenido', 'info');
    } else {
      showToast('Error al detener el bot', 'error');
    }
  } catch (e) {
    showToast('Error de conexión al servidor', 'error');
  }
  fetchStatus();
}

async function handleResetDay() {
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESET_DAY' })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Estadísticas del día reseteadas', 'success');
      pnlHistory = [0];
      drawSparkline(pnlHistory);
    } else {
      showToast('Error al resetear', 'error');
    }
  } catch (e) {
    showToast('Error de conexión al servidor', 'error');
  }
  fetchStatus();
  fetchHistory();
}

async function handleEngineToggle(engine, enabled) {
  try {
    await fetch('/api/engine-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, enabled })
    });
    const engineNames = {
      'EVEN_ODD': 'Even/Odd',
      'OVER_UNDER': 'Over/Under',
      'MATCH': 'Match'
    };
    showToast(`Motor ${engineNames[engine]} ${enabled ? 'activado' : 'desactivado'}`, 'info');
  } catch (e) {
    showToast('Error de conexión', 'error');
  }
  fetchStatus();
}

async function handleMarketChange() {
  const symbol = $('selectMarket').value;
  try {
    await fetch('/api/switch-market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    showToast('Mercado cambiado a ' + symbol, 'info');
  } catch (e) {
    showToast('Error al cambiar mercado', 'error');
  }
  fetchStatus();
}

function handleConfigChange() {
  clearTimeout(configDebounce);
  configDebounce = setTimeout(async () => {
    const stake = parseFloat($('inputStake').value) || 1;
    const maxDailyLoss = parseFloat($('inputMaxLoss').value) || 20;
    const takeProfit = parseFloat($('inputTakeProfit').value) || 15;
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stake, maxDailyLoss, takeProfit })
      });
      showToast('Configuración actualizada', 'success');
    } catch (e) {
      showToast('Error al actualizar configuración', 'error');
    }
    fetchStatus();
  }, 400);
}

// ── Engine Toggle Listeners ────────────────────────────────────────────────
$('toggleEvenOdd').addEventListener('change', function() {
  handleEngineToggle('EVEN_ODD', this.checked);
});
$('toggleOverUnder').addEventListener('change', function() {
  handleEngineToggle('OVER_UNDER', this.checked);
});
$('toggleMatch').addEventListener('change', function() {
  handleEngineToggle('MATCH', this.checked);
});

async function handleCoberturaToggle(checked) {
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coberturaEnabled: checked })
    });
    showToast(`Martingala ${checked ? 'activada' : 'desactivada'}`, 'success');
  } catch (e) {
    showToast('Error al actualizar Martingala', 'error');
  }
  fetchStatus();
}
// ── Toast System ───────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;

  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  toast.innerHTML = `<span style="font-size:16px;">${icons[type] || 'ℹ'}</span> ${message}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Polling ────────────────────────────────────────────────────────────────
initDigitBars();
fetchStatus();
fetchHistory();

setInterval(fetchStatus, 1500);
setInterval(fetchHistory, 5000);

// ── Keyboard shortcut ──────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') handleStop();
});
