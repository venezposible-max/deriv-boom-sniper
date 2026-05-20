/**
 * ============================================================
 *  HYBRID ENGINE v1.0 — "La Trinidad"
 *  Sistema de 3 motores para opciones digitales en Deriv
 *
 *  Motor 1: EVEN/ODD  — "El Pan de Cada Día"   (Reversión a la media)
 *  Motor 2: OVER/UNDER — "El Potenciador"       (Cadena de Markov)
 *  Motor 3: MATCH      — "El Multiplicador"     (Dígito caliente)
 *
 *  Análisis: Shannon Entropy + Markov Transition Matrix
 *  Gestión de riesgo: Circuit Breaker + Stake decreciente
 *  Símbolo: Volatility Index (R_10 / R_25 / R_50 / R_100)
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN CENTRAL
// ════════════════════════════════════════════════════════════════
const APP_ID = process.env.DERIV_APP_ID || '36544';
const DERIV_TOKEN = process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-hybrid.json');

// Símbolo actual (por defecto V25)
let SYMBOL = 'R_25';

// ════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════
let botState = {
    isRunning: false,
    isConnectedToDeriv: false,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    currentContractId: null,
    activeContractId: null,
    lastTickPrice: 0,
    lastDigit: null,
    digitHistory: [],          // Últimos 300 dígitos
    digitFrequency: {},
    stake: 1,
    maxDailyLoss: 20,
    dailyLoss: 0,
    dailyProfit: 0,
    takeProfit: 15,
    lastTradeTime: 0,
    cooldownMs: 5000,
    isBuying: false,
    maxTradesPerDay: 50,
    consecutiveLosses: 0,
    circuitBreakerUntil: 0,
    // ─── Interruptores de motores ───
    engineEvenOdd: true,
    engineOverUnder: true,
    engineMatch: true,
    // ─── Información del trade activo ───
    currentEngine: null,       // 'EVEN_ODD' | 'OVER_UNDER' | 'MATCH'
    currentContractType: null,
    currentBarrier: null,
    currentStake: 0,
    // ─── Métricas por motor ───
    engineStats: {
        EVEN_ODD: { wins: 0, losses: 0, pnl: 0 },
        OVER_UNDER: { wins: 0, losses: 0, pnl: 0 },
        MATCH: { wins: 0, losses: 0, pnl: 0 }
    },
    // ─── Analíticas ───
    shannonEntropy: 0,
    markovEdge: 0,
    hotDigit: null,
    hotDigitFreq: 0,
};

// ════════════════════════════════════════════════════════════════
//  CARGAR ESTADO PERSISTENTE
// ════════════════════════════════════════════════════════════════
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            // Preservar la estructura de engineStats por si se agregaron campos nuevos
            const defaultStats = { ...botState.engineStats };
            botState = { ...botState, ...saved.botState };
            // Asegurar que engineStats tenga todos los motores
            botState.engineStats = { ...defaultStats, ...botState.engineStats };
            // Siempre arrancar en estado seguro
            botState.isRunning = false;
            botState.isBuying = false;
            botState.activeContractId = null;
            botState.currentContractId = null;
        }
        console.log(`📂 Estado Hybrid cargado. Historial: ${botState.tradeHistory.length} trades.`);
    } catch (e) {
        console.log('⚠️ Error cargando estado previo, iniciando fresco.');
    }
}

// ════════════════════════════════════════════════════════════════
//  UTILIDADES COMPARTIDAS
// ════════════════════════════════════════════════════════════════

/**
 * Entropía de Shannon — Mide el caos/aleatoriedad del mercado.
 * Máximo teórico para 10 dígitos = log2(10) ≈ 3.3219
 * Menor entropía = mayor predictibilidad = mejor para operar.
 */
function calcEntropy(hist, range) {
    const sub = hist.slice(-range);
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    sub.forEach(d => freq[d]++);
    let entropy = 0;
    for (let d = 0; d <= 9; d++) {
        const p = freq[d] / sub.length;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
}

/**
 * Cadena de Markov — Tabla de transiciones dígito→dígito.
 * Cada celda matrix[i][j] = probabilidad de que después del dígito i venga el dígito j.
 */
function buildMarkovMatrix(hist) {
    const matrix = {};
    for (let i = 0; i <= 9; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    for (let k = 1; k < hist.length; k++) {
        matrix[hist[k - 1]][hist[k]]++;
    }
    // Normalizar a probabilidades
    for (let i = 0; i <= 9; i++) {
        const total = Object.values(matrix[i]).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (let j = 0; j <= 9; j++) matrix[i][j] = matrix[i][j] / total;
        }
    }
    return matrix;
}

/**
 * Calcular el stake ajustado según las pérdidas consecutivas.
 * NUNCA se sube por encima de la base. JAMÁS Martingale.
 */
function getAdjustedStake(baseStake, stakeMultiplier) {
    const adjusted = baseStake * stakeMultiplier;
    // Escala según pérdidas consecutivas
    if (botState.consecutiveLosses <= 2) return adjusted;
    if (botState.consecutiveLosses === 3) return adjusted * 0.75;
    if (botState.consecutiveLosses === 4) return adjusted * 0.50;
    // 5+ → El circuit breaker ya debería estar activo, pero por seguridad:
    return adjusted * 0.50;
}

// ════════════════════════════════════════════════════════════════
//  MOTOR 1: EVEN/ODD — "El Pan de Cada Día"
//  Estrategia: Reversión a la media en ventana de 10 ticks
// ════════════════════════════════════════════════════════════════
function evaluateEvenOdd() {
    const hist = botState.digitHistory;
    if (hist.length < 50) return null; // Necesitamos suficiente historia

    // Ventana de los últimos 10 dígitos
    const window10 = hist.slice(-10);
    let evenCount = 0;
    let oddCount = 0;
    for (const d of window10) {
        if (d % 2 === 0) evenCount++;
        else oddCount++;
    }

    // Verificar entropía — requiere < 3.15
    const entropy = calcEntropy(hist, 100);
    if (entropy >= 3.15) return null;

    // Señal: 7+ de 10 son PAR → apostar IMPAR (reversión)
    if (evenCount >= 7) {
        return {
            engine: 'EVEN_ODD',
            contractType: 'DIGITODD',
            barrier: null,           // EVEN/ODD no usa barrera
            stakeMultiplier: 1.0,    // 100% del stake base
            reason: `${evenCount}/10 PARES → Reversión a IMPAR`,
            entropy: entropy,
        };
    }

    // Señal: 7+ de 10 son IMPAR → apostar PAR (reversión)
    if (oddCount >= 7) {
        return {
            engine: 'EVEN_ODD',
            contractType: 'DIGITEVEN',
            barrier: null,
            stakeMultiplier: 1.0,
            reason: `${oddCount}/10 IMPARES → Reversión a PAR`,
            entropy: entropy,
        };
    }

    return null;
}

// ════════════════════════════════════════════════════════════════
//  MOTOR 2: OVER/UNDER — "El Potenciador"
//  Estrategia: Cadena de Markov sobre últimos 200 dígitos
// ════════════════════════════════════════════════════════════════
function evaluateOverUnder() {
    const hist = botState.digitHistory;
    if (hist.length < 100) return null; // Mínimo 100 dígitos para Markov fiable

    // Calcular entropía — requiere < 3.0
    const entropy = calcEntropy(hist, 100);
    if (entropy >= 3.0) return null;

    // Construir matriz de Markov con los últimos 200 dígitos
    const markovHist = hist.slice(-200);
    const matrix = buildMarkovMatrix(markovHist);
    const lastDigit = hist[hist.length - 1];
    const transitions = matrix[lastDigit];

    // Probabilidad de que el siguiente dígito sea > 4 (OVER)
    let probOver = 0;
    for (let d = 5; d <= 9; d++) probOver += transitions[d];

    // Probabilidad de que el siguiente dígito sea < 5 (UNDER)
    let probUnder = 1 - probOver;

    // Calcular ventaja (edge) sobre la distribución uniforme (50%)
    const edge = Math.abs(probOver - 0.5);
    const edgePercent = edge * 100;

    // Actualizar métricas en el estado para la UI
    botState.markovEdge = edgePercent.toFixed(1);

    // Requiere edge >= 7% (0.07)
    if (edgePercent < 7) return null;

    // P(dígito > 4) >= 57% → DIGITOVER barrera '4'
    if (probOver >= 0.57) {
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITOVER',
            barrier: '4',
            stakeMultiplier: 1.0,
            reason: `Markov P(>4)=${(probOver * 100).toFixed(1)}% | Edge: ${edgePercent.toFixed(1)}%`,
            entropy: entropy,
        };
    }

    // P(dígito < 5) >= 57% → DIGITUNDER barrera '5'
    if (probUnder >= 0.57) {
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITUNDER',
            barrier: '5',
            stakeMultiplier: 1.0,
            reason: `Markov P(<5)=${(probUnder * 100).toFixed(1)}% | Edge: ${edgePercent.toFixed(1)}%`,
            entropy: entropy,
        };
    }

    return null;
}

// ════════════════════════════════════════════════════════════════
//  MOTOR 3: MATCH — "El Multiplicador"
//  Estrategia: Dígito caliente con momentum en últimos 50 ticks
// ════════════════════════════════════════════════════════════════
function evaluateMatch() {
    const hist = botState.digitHistory;
    if (hist.length < 50) return null; // Mínimo 50 ticks para análisis

    // Calcular entropía — requiere < 3.0 (mercado predecible)
    const entropy = calcEntropy(hist, 100);
    if (entropy >= 3.0) return null;

    // Contar frecuencia de cada dígito en los últimos 50 ticks
    const window50 = hist.slice(-50);
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    window50.forEach(d => freq[d]++);

    // Encontrar el dígito más caliente
    let hotDigit = 0;
    let maxFreq = 0;
    for (let d = 0; d <= 9; d++) {
        if (freq[d] > maxFreq) {
            maxFreq = freq[d];
            hotDigit = d;
        }
    }

    const hotDigitFreqPercent = (maxFreq / 50) * 100;

    // Actualizar métricas para la UI
    botState.hotDigit = hotDigit;
    botState.hotDigitFreq = hotDigitFreqPercent.toFixed(1);

    // Condición 1: Frecuencia >= 16% (al menos 8 de 50)
    if (hotDigitFreqPercent < 16) return null;

    // Condición 2: El dígito caliente apareció en los últimos 3 ticks (momentum)
    const last3 = hist.slice(-3);
    if (!last3.includes(hotDigit)) return null;

    // Condición 3: Entropía < 3.0 (ya verificada arriba)

    return {
        engine: 'MATCH',
        contractType: 'DIGITMATCH',
        barrier: String(hotDigit),
        stakeMultiplier: 0.5,        // 50% del stake base (mayor riesgo)
        reason: `Dígito ${hotDigit} caliente: ${maxFreq}/50 (${hotDigitFreqPercent.toFixed(1)}%) con momentum`,
        entropy: entropy,
    };
}

// ════════════════════════════════════════════════════════════════
//  GUARDAR / CARGAR ESTADO
// ════════════════════════════════════════════════════════════════
function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ botState, symbol: SYMBOL }));
    } catch (e) {
        console.error('⚠️ Error guardando estado:', e.message);
    }
}

// ════════════════════════════════════════════════════════════════
//  MOTOR DE DISPARO — Orquestador de los 3 motores
// ════════════════════════════════════════════════════════════════
function tryFireTrade() {
    if (!botState.isRunning) return;
    if (botState.isBuying || botState.activeContractId) return;

    // ─── Protección: Límite de pérdida diaria ───
    if (botState.dailyLoss >= botState.maxDailyLoss) {
        console.log(`🚫 LÍMITE DE PÉRDIDA DIARIA ALCANZADO ($${botState.dailyLoss.toFixed(2)}). Bot detenido.`);
        botState.isRunning = false;
        saveState();
        return;
    }

    // ─── Protección: Meta de ganancia diaria ───
    if (botState.dailyProfit >= botState.takeProfit) {
        console.log(`🏆 META DE GANANCIA DIARIA ALCANZADA ($${botState.dailyProfit.toFixed(2)}). ¡Misión cumplida!`);
        botState.isRunning = false;
        saveState();
        return;
    }

    // ─── Protección: Máximo de trades por día ───
    if (botState.totalTradesSession >= botState.maxTradesPerDay) {
        console.log(`🚫 MÁXIMO DE TRADES DIARIOS ALCANZADO (${botState.maxTradesPerDay}). Bot detenido.`);
        botState.isRunning = false;
        saveState();
        return;
    }

    // ─── Protección: Circuit Breaker (5+ pérdidas consecutivas) ───
    const now = Date.now();
    if (botState.circuitBreakerUntil > now) {
        const remainMs = botState.circuitBreakerUntil - now;
        const remainMin = (remainMs / 60000).toFixed(1);
        // Solo loguear cada ~30 segundos para no saturar la consola
        if (now % 30000 < 1500) {
            console.log(`⚡ CIRCUIT BREAKER ACTIVO. Reanuda en ${remainMin} minutos.`);
        }
        return;
    }

    // ─── Cooldown entre trades ───
    if ((now - botState.lastTradeTime) < botState.cooldownMs) return;

    // ─── Evaluar motores en orden de PRIORIDAD: MATCH > OVER/UNDER > EVEN/ODD ───
    let signal = null;

    // Prioridad 1: MATCH (mayor pago, menor probabilidad)
    if (!signal && botState.engineMatch) {
        signal = evaluateMatch();
    }

    // Prioridad 2: OVER/UNDER (pago medio)
    if (!signal && botState.engineOverUnder) {
        signal = evaluateOverUnder();
    }

    // Prioridad 3: EVEN/ODD (mayor probabilidad, pago estándar)
    if (!signal && botState.engineEvenOdd) {
        signal = evaluateEvenOdd();
    }

    // Sin señal de ningún motor
    if (!signal) return;

    // ─── Calcular stake ajustado ───
    const finalStake = getAdjustedStake(botState.stake, signal.stakeMultiplier);

    // Guardar info del trade activo en el estado
    botState.currentEngine = signal.engine;
    botState.currentContractType = signal.contractType;
    botState.currentBarrier = signal.barrier;
    botState.currentStake = finalStake;
    botState.shannonEntropy = signal.entropy.toFixed(2);

    // ─── Construir la orden de compra ───
    const buyRequest = {
        buy: 1,
        price: finalStake,
        parameters: {
            amount: finalStake,
            basis: 'stake',
            contract_type: signal.contractType,
            currency: 'USD',
            symbol: SYMBOL,
            duration: 1,
            duration_unit: 't',
        }
    };

    // Agregar barrera solo para OVER/UNDER y MATCH (EVEN/ODD no usa barrera)
    if (signal.barrier !== null) {
        buyRequest.parameters.barrier = signal.barrier;
    }

    // ─── Marcar como comprando y disparar ───
    botState.isBuying = true;
    botState.lastTradeTime = now;

    const engineEmojis = { EVEN_ODD: '🎰', OVER_UNDER: '📊', MATCH: '💎' };
    const engineNames = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', MATCH: 'MATCH' };
    const emoji = engineEmojis[signal.engine] || '🎲';
    const name = engineNames[signal.engine] || signal.engine;

    console.log(`${emoji} DISPARO [${name}] | ${signal.contractType}${signal.barrier ? ` barrera=${signal.barrier}` : ''} | Stake: $${finalStake.toFixed(2)} | ${signal.reason} | Entropy: ${signal.entropy.toFixed(2)}`);

    ws.send(JSON.stringify(buyRequest));
}

// ════════════════════════════════════════════════════════════════
//  FINALIZAR TRADE — Procesar resultado del contrato
// ════════════════════════════════════════════════════════════════
function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;

    // ─── Actualizar métricas globales ───
    botState.pnlSession += profit;
    botState.totalTradesSession++;

    const engine = botState.currentEngine || 'EVEN_ODD';
    const cType = botState.currentContractType || 'DIGITEVEN';
    const barrier = botState.currentBarrier;

    const engineEmojis = { EVEN_ODD: '🎰', OVER_UNDER: '📊', MATCH: '💎' };
    const engineNames = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', MATCH: 'MATCH' };
    const emoji = engineEmojis[engine] || '🎲';
    const name = engineNames[engine] || engine;

    if (isWin) {
        botState.winsSession++;
        botState.dailyProfit += profit;

        // Resetear pérdidas consecutivas en cualquier victoria
        botState.consecutiveLosses = 0;
        botState.circuitBreakerUntil = 0;

        console.log(`✅ WIN +$${profit.toFixed(2)} [${name}] | ${cType}${barrier ? ` barrera=${barrier}` : ''} | PnL: $${botState.pnlSession.toFixed(2)}`);
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(profit);
        botState.consecutiveLosses++;

        console.log(`❌ LOSS -$${Math.abs(profit).toFixed(2)} [${name}] | ${cType}${barrier ? ` barrera=${barrier}` : ''} | Racha: ${botState.consecutiveLosses} | PnL: $${botState.pnlSession.toFixed(2)}`);

        // ─── Circuit Breaker: 5+ pérdidas consecutivas → pausa 30 minutos ───
        if (botState.consecutiveLosses >= 5) {
            botState.circuitBreakerUntil = Date.now() + (30 * 60 * 1000);
            const reanudar = new Date(botState.circuitBreakerUntil).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
            console.log(`⚡ CIRCUIT BREAKER ACTIVADO. ${botState.consecutiveLosses} pérdidas seguidas. Pausa hasta ${reanudar} (30 min).`);
        }
    }

    // ─── Actualizar estadísticas del motor específico ───
    if (botState.engineStats[engine]) {
        if (isWin) {
            botState.engineStats[engine].wins++;
        } else {
            botState.engineStats[engine].losses++;
        }
        botState.engineStats[engine].pnl += profit;
    }

    // ─── Guardar en historial ───
    const timeVE = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    botState.tradeHistory.unshift({
        engine: name,
        engineKey: engine,
        contractType: cType,
        barrier: barrier,
        profit: profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: timeVE,
        lastDigit: botState.lastDigit,
        stake: botState.currentStake,
        entropy: botState.shannonEntropy,
    });

    // Mantener historial acotado a 100 entradas
    if (botState.tradeHistory.length > 100) botState.tradeHistory.pop();

    // ─── Limpiar contrato activo ───
    botState.activeContractId = null;
    botState.currentContractId = null;
    botState.isBuying = false;

    saveState();
}

// ════════════════════════════════════════════════════════════════
//  SERVIDOR EXPRESS
// ════════════════════════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal — sirve la interfaz web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'hybrid.html'));
});

// ─── API: Estado completo del bot ───
app.get('/api/status', (req, res) => {
    // Calcular winRate global
    const globalWinRate = botState.totalTradesSession > 0
        ? ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1)
        : '0.0';

    // Calcular winRate por motor
    const engineWinRates = {};
    for (const [key, stats] of Object.entries(botState.engineStats)) {
        const total = stats.wins + stats.losses;
        engineWinRates[key] = {
            ...stats,
            pnl: parseFloat(stats.pnl.toFixed(2)),
            totalTrades: total,
            winRate: total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0',
        };
    }

    res.json({
        success: true,
        data: {
            ...botState,
            symbol: SYMBOL,
            strategy: 'HYBRID',
            winRate: globalWinRate,
            engineWinRates: engineWinRates,
            circuitBreakerActive: botState.circuitBreakerUntil > Date.now(),
            circuitBreakerRemaining: Math.max(0, Math.ceil((botState.circuitBreakerUntil - Date.now()) / 1000)),
        }
    });
});

// ─── API: Control Start / Stop / Reset ───
app.post('/api/control', (req, res) => {
    const { action, stake, maxDailyLoss, takeProfit } = req.body;

    if (action === 'START') {
        if (stake) botState.stake = Math.max(0.35, parseFloat(stake));
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (takeProfit) botState.takeProfit = parseFloat(takeProfit);
        botState.isRunning = true;
        saveState();
        console.log(`▶️ HYBRID ENGINE INICIADO | Stake: $${botState.stake} | MaxLoss: $${botState.maxDailyLoss} | Meta: $${botState.takeProfit} | Símbolo: ${SYMBOL}`);
        console.log(`   Motores: PAR/IMPAR=${botState.engineEvenOdd ? '✅' : '❌'} | OVER/UNDER=${botState.engineOverUnder ? '✅' : '❌'} | MATCH=${botState.engineMatch ? '✅' : '❌'}`);
        return res.json({ success: true, message: 'Hybrid Engine Activado ✅' });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        botState.isBuying = false;
        botState.activeContractId = null;
        botState.currentContractId = null;
        saveState();
        console.log('🛑 STOP RECIBIDO: Bot pausado y estados limpiados.');
        return res.json({ success: true, message: 'Bot Pausado ⏸️' });
    }

    if (action === 'RESET_DAY') {
        botState.dailyLoss = 0;
        botState.dailyProfit = 0;
        botState.pnlSession = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.totalTradesSession = 0;
        botState.tradeHistory = [];
        botState.consecutiveLosses = 0;
        botState.circuitBreakerUntil = 0;
        botState.engineStats = {
            EVEN_ODD: { wins: 0, losses: 0, pnl: 0 },
            OVER_UNDER: { wins: 0, losses: 0, pnl: 0 },
            MATCH: { wins: 0, losses: 0, pnl: 0 }
        };
        saveState();
        console.log('🔄 DÍA REINICIADO: Todas las métricas a cero.');
        return res.json({ success: true, message: 'Día reiniciado 🔄' });
    }

    res.status(400).json({ success: false, error: 'Acción inválida. Usa START, STOP o RESET_DAY.' });
});

// ─── API: Historial de trades ───
app.get('/api/history', (req, res) => {
    res.json({ success: true, history: botState.tradeHistory.slice(0, 50) });
});

// ─── API: Activar/desactivar motores individuales ───
app.post('/api/engine-toggle', (req, res) => {
    const { engine, enabled } = req.body;

    const engineMap = {
        'EVEN_ODD': 'engineEvenOdd',
        'OVER_UNDER': 'engineOverUnder',
        'MATCH': 'engineMatch',
    };

    if (!engineMap[engine]) {
        return res.status(400).json({ success: false, error: 'Motor inválido. Usa EVEN_ODD, OVER_UNDER o MATCH.' });
    }

    botState[engineMap[engine]] = !!enabled;
    saveState();

    const engineNames = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', MATCH: 'MATCH' };
    const nombre = engineNames[engine];
    const estado = enabled ? 'ACTIVADO ✅' : 'DESACTIVADO ❌';
    console.log(`⚙️ Motor ${nombre} ${estado}`);

    return res.json({ success: true, message: `Motor ${nombre} ${estado}` });
});

// ─── API: Configuración general ───
app.post('/api/config', (req, res) => {
    const { stake, maxDailyLoss, takeProfit, cooldownMs, maxTradesPerDay } = req.body;

    if (stake !== undefined) botState.stake = Math.max(0.35, parseFloat(stake));
    if (maxDailyLoss !== undefined) botState.maxDailyLoss = parseFloat(maxDailyLoss);
    if (takeProfit !== undefined) botState.takeProfit = parseFloat(takeProfit);
    if (cooldownMs !== undefined) botState.cooldownMs = Math.max(1000, parseInt(cooldownMs));
    if (maxTradesPerDay !== undefined) botState.maxTradesPerDay = Math.max(1, parseInt(maxTradesPerDay));

    saveState();
    console.log(`⚙️ CONFIG ACTUALIZADA | Stake: $${botState.stake} | MaxLoss: $${botState.maxDailyLoss} | Meta: $${botState.takeProfit} | Cooldown: ${botState.cooldownMs}ms | MaxTrades: ${botState.maxTradesPerDay}`);

    return res.json({ success: true, message: 'Configuración actualizada ⚙️' });
});

// ─── API: Cambiar mercado/símbolo ───
app.post('/api/switch-market', (req, res) => {
    const { symbol } = req.body;

    if (botState.isRunning) {
        return res.status(400).json({ success: false, error: 'Detén el bot antes de cambiar de mercado.' });
    }

    const validSymbols = ['R_10', 'R_25', 'R_50', 'R_100'];
    if (!validSymbols.includes(symbol)) {
        return res.status(400).json({ success: false, error: `Símbolo no soportado. Válidos: ${validSymbols.join(', ')}` });
    }

    SYMBOL = symbol;
    // Limpiar historial de dígitos al cambiar de mercado (cada símbolo tiene su patrón)
    botState.digitHistory = [];
    botState.digitFrequency = {};
    botState.hotDigit = null;
    botState.hotDigitFreq = 0;

    // Re-suscribir a ticks si el WebSocket está conectado
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: 'ticks' }));
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
            }
        }, 1000);
    }

    saveState();
    console.log(`🔄 MERCADO CAMBIADO A: ${SYMBOL}`);
    return res.json({ success: true, symbol: SYMBOL, message: `Mercado cambiado a ${SYMBOL} 🔄` });
});

// ════════════════════════════════════════════════════════════════
//  CONEXIÓN WebSocket A DERIV
// ════════════════════════════════════════════════════════════════
let ws = null;
let reconnectTimeout = null;

function connectDeriv() {
    // Evitar conexiones duplicadas
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log('🔌 Conectado a Deriv WebSocket. Esperando 5s para autenticar...');
        // NO marcar isConnectedToDeriv aquí — esperamos la respuesta del auth

        // Paso 0: Esperar 5s y luego enviar token de autorización
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
            }
        }, 5000);
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        // Responder a pings de Deriv (mantener conexión viva)
        if (msg.ping || msg.msg_type === 'ping') {
            ws.send(JSON.stringify({ ping: 1 }));
            return;
        }

        // ─── AUTORIZACIÓN EXITOSA ───
        if (msg.msg_type === 'authorize' && msg.authorize) {
            console.log(`✅ Autenticado: ${msg.authorize.fullname}`);
            botState.isConnectedToDeriv = true;

            // Limpieza de suscripciones previas
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ forget_all: 'proposal_open_contract' }));

            // Paso 1: Suscribir a ticks después de 3s
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
                    console.log(`📡 Suscrito a ticks de ${SYMBOL}`);
                }
            }, 3000);

            // Paso 2: Suscribir al balance después de 6s
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    console.log(`💰 Suscrito al balance`);
                }
            }, 6000);
        }

        // ─── ERRORES DE DERIV ───
        if (msg.error) {
            console.error(`⚠️ Deriv Error [${msg.error.code}]: ${msg.error.message}`);

            // Errores críticos de sesión → forzar reconexión
            if (msg.error.code === 'WrongResponse' || msg.error.code === 'AuthorizationRequired') {
                console.log('🔄 Error crítico de sesión. Reconectando WebSocket...');
                botState.isConnectedToDeriv = false;
                if (ws) ws.close();
            }

            // Error de compra → limpiar estado de compra
            if (msg.msg_type === 'buy') {
                botState.isBuying = false;
                console.error(`❌ Error al comprar: ${msg.error.message}`);
            }
            return;
        }

        // ─── BALANCE ───
        if (msg.msg_type === 'balance' && msg.balance) {
            botState.balance = msg.balance.balance;
        }

        // ─── TICK RECIBIDO → Analizar dígito y evaluar señales ───
        if (msg.msg_type === 'tick' && msg.tick) {
            const priceStr = String(msg.tick.quote);
            const lastDigit = parseInt(priceStr[priceStr.length - 1]);

            botState.lastTickPrice = parseFloat(msg.tick.quote);
            botState.lastDigit = lastDigit;

            // Guardar dígito en historial (máximo 300 para soportar ventanas de 200)
            botState.digitHistory.push(lastDigit);
            if (botState.digitHistory.length > 300) botState.digitHistory.shift();

            // Actualizar frecuencia acumulada
            botState.digitFrequency[lastDigit] = (botState.digitFrequency[lastDigit] || 0) + 1;

            // Actualizar entropía en tiempo real para la UI
            if (botState.digitHistory.length >= 50) {
                botState.shannonEntropy = calcEntropy(botState.digitHistory, 100).toFixed(2);
            }

            // Intentar disparar trade
            tryFireTrade();
        }

        // ─── COMPRA CONFIRMADA ───
        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            botState.currentContractId = msg.buy.contract_id;
            botState.isBuying = false;

            const engineNames = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', MATCH: 'MATCH' };
            const name = engineNames[botState.currentEngine] || botState.currentEngine;
            console.log(`🎯 CONTRATO ABIERTO [${msg.buy.contract_id}] | Motor: ${name} | ${botState.currentContractType}${botState.currentBarrier ? ` barrera=${botState.currentBarrier}` : ''}`);

            // Suscribir al resultado del contrato
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: msg.buy.contract_id,
                subscribe: 1
            }));
        }

        // ─── RESULTADO DEL CONTRATO ───
        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c || !c.is_sold) return;

            finalizeTrade(c);
        }
    });

    ws.on('error', (e) => {
        console.error('❌ WebSocket Error:', e.message);
        botState.isConnectedToDeriv = false;
    });

    ws.on('close', (code, reason) => {
        const waitTime = code === 1008 ? 15000 : 5000;
        console.log(`⚠️ Conexión cerrada (código: ${code}). Reconectando en ${waitTime / 1000}s...`);
        botState.isConnectedToDeriv = false;
        botState.isBuying = false;

        // Limpiar WebSocket viejo completamente
        if (ws) {
            ws.removeAllListeners();
            try { ws.terminate(); } catch (e) { /* ignorar */ }
            ws = null;
        }

        // Programar reconexión (evitar duplicados)
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(connectDeriv, waitTime);
        }
    });
}

// ════════════════════════════════════════════════════════════════
//  ESTADÍSTICAS PERIÓDICAS (cada 60 segundos)
// ════════════════════════════════════════════════════════════════
setInterval(() => {
    if (botState.totalTradesSession === 0) return;

    const wr = ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1);

    // Resumen por motor
    const motorStats = Object.entries(botState.engineStats)
        .filter(([, s]) => (s.wins + s.losses) > 0)
        .map(([key, s]) => {
            const total = s.wins + s.losses;
            const engineWR = ((s.wins / total) * 100).toFixed(1);
            const names = { EVEN_ODD: 'P/I', OVER_UNDER: 'O/U', MATCH: 'MTH' };
            return `${names[key] || key}: ${engineWR}% (${total})`;
        })
        .join(' | ');

    console.log(`📊 [STATS] Trades: ${botState.totalTradesSession} | WinRate: ${wr}% | PnL: $${botState.pnlSession.toFixed(2)} | Balance: $${botState.balance} | ${motorStats}`);
    console.log(`   Entropy: ${botState.shannonEntropy} | Markov Edge: ${botState.markovEdge}% | Dígito caliente: ${botState.hotDigit} (${botState.hotDigitFreq}%) | Pérdidas seguidas: ${botState.consecutiveLosses}`);
}, 60000);

// ════════════════════════════════════════════════════════════════
//  INICIAR SERVIDOR
// ════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('═'.repeat(60));
    console.log('  💎 HYBRID ENGINE v1.0 — "La Trinidad" — ONLINE');
    console.log(`  🌐 Puerto: ${PORT} | Símbolo: ${SYMBOL}`);
    console.log('  🎰 Motor 1: PAR/IMPAR — "El Pan de Cada Día"');
    console.log('  📊 Motor 2: OVER/UNDER — "El Potenciador"');
    console.log('  💎 Motor 3: MATCH — "El Multiplicador"');
    console.log('  📐 Análisis: Shannon Entropy + Markov Chain');
    console.log('  ⚡ Protección: Circuit Breaker + Stake Decreciente');
    console.log('═'.repeat(60));
    connectDeriv();
});

// ════════════════════════════════════════════════════════════════
//  ANTI-CRASH — Guardar estado en errores fatales
// ════════════════════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
    console.error('🔥 Error crítico no capturado:', err.message);
    console.error(err.stack);
    saveState();
});

process.on('unhandledRejection', (reason) => {
    console.error('🔥 Promesa rechazada sin manejar:', reason);
    saveState();
});

// Limpieza al recibir señal de terminación (deploy, restart, etc.)
process.on('SIGTERM', () => {
    console.log('🛑 Señal SIGTERM recibida. Guardando estado y cerrando...');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: 'ticks' }));
        ws.terminate();
    }
    saveState();
    process.exit(0);
});
