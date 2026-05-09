/**
 * ============================================================
 *  PROYECTO ANTIGRAVEDAD v7.0 - TRIPLE ESCUDO
 *  Motor: Singularidad Global Multi-Mercado
 *  Mejora 1: 🧊 Cooldown Inteligente Post-Derrota (5 min)
 *  Mejora 2: 🎯 Umbral Adaptativo (Auto-Calibración)
 *  Mejora 3: 👻 Ghost Protocol Revival (Simulación Virtual)
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

const APP_ID = process.env.DERIV_APP_ID || '36544';
const DERIV_TOKEN = process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-differs.json');
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];

let botState = {
    isRunning: false,
    isConnectedToDeriv: false,
    balance: 0,
    dailyProfit: 0,
    dailyLoss: 0,
    totalTradesSession: 0,
    winsSession: 0,
    lossesSession: 0,
    tradeHistory: [],
    stake: 10,
    takeProfit: 20,
    maxDailyLoss: 200,
    activeSymbol: 'R_25',
    activeContractId: null,
    lastTradeTime: 0,
    cooldownMs: 3000,
    isBuying: false,
    recoveryLayer: 0,
    lastHoleDigit: null,
    // ─── MEJORA 1: Cooldown Inteligente ───
    lastRecoveryFailTime: 0,        // Timestamp del último ciclo de recuperación fallido
    penaltyCooldownMs: 300000,      // 5 minutos de castigo tras un ciclo perdedor completo
    // ─── MEJORA 3: Ghost Protocol ───
    ghostMode: true,                // El Ghost Protocol está activo por defecto
    ghostResults: {},               // Resultados virtuales por símbolo { R_10: { wins: 0, total: 0 } }
    ghostMinTrades: 3,              // Mínimo de trades fantasma antes de disparar real
    ghostMinWinRate: 0.33,          // Al menos 1 de 3 fantasmas debe haber ganado (33%)
    // SINGULARIDAD
    markets: {}
};

SYMBOLS.forEach(s => {
    botState.markets[s] = {
        digitHistory: [],
        lastAppearance: Array(10).fill(0),
        entropy: 0,
        virtualSuccess: 0
    };
    botState.ghostResults[s] = { wins: 0, total: 0, lastDigit: null };
});

// ─── PERSISTENCIA ─────────────────────────────────────────────
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            botState = { ...botState, ...saved.botState };
            botState.isRunning = false;
            botState.isBuying = false;
        }
    } catch (e) {}
}
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ botState })); } catch (e) {} };

// ─── DETECCIÓN DE HUECOS (SINGULARIDAD) ───────────────────────
function updateHoleStats(symbol, digit) {
    const m = botState.markets[symbol];
    for (let d = 0; d <= 9; d++) {
        if (d === digit) m.lastAppearance[d] = 0;
        else m.lastAppearance[d]++;
    }
}

// ─── MEJORA 2: UMBRAL ADAPTATIVO ─────────────────────────────
// Calcula el umbral óptimo basándose en la distribución reciente de dígitos del mercado.
// Si el mercado está muy equilibrado (todos los dígitos salen parejo), sube el umbral.
// Si el mercado está caótico (algunos dígitos dominan), baja el umbral.
function calculateAdaptiveThreshold(symbol) {
    const m = botState.markets[symbol];
    if (m.digitHistory.length < 200) return 85; // Default seguro si no hay data

    // Analizamos los últimos 500 ticks
    const recentDigits = m.digitHistory.slice(-500);
    const freq = Array(10).fill(0);
    recentDigits.forEach(d => freq[d]++);

    // Calcular la desviación estándar de las frecuencias
    const mean = recentDigits.length / 10; // Frecuencia esperada (50 para 500 ticks)
    let variance = 0;
    freq.forEach(f => { variance += Math.pow(f - mean, 2); });
    const stdDev = Math.sqrt(variance / 10);

    // Interpretar:
    // stdDev baja (< 5) = mercado muy equilibrado → necesitamos umbral ALTO (más paciencia)
    // stdDev alta (> 10) = mercado caótico con huecos → podemos bajar el umbral
    if (stdDev < 4) return 100;      // Mercado ultra-estable: máxima paciencia
    if (stdDev < 7) return 85;       // Mercado normal: prudente
    if (stdDev < 12) return 75;      // Mercado con sesgo: moderado
    return 70;                        // Piso mínimo: NUNCA bajar de 70
}

// ─── MEJORA 3: GHOST PROTOCOL ─────────────────────────────────
// Simula un trade virtual sin dinero real para validar que el hueco es "de verdad"
function processGhostTrade(symbol, digit, actualNextDigit) {
    const ghost = botState.ghostResults[symbol];
    ghost.total++;
    ghost.lastDigit = digit;
    if (actualNextDigit === digit) {
        ghost.wins++;
        console.log(`👻 [GHOST] MATCH Virtual en ${symbol} | Dígito ${digit} | ✅ WIN (${ghost.wins}/${ghost.total})`);
    } else {
        console.log(`👻 [GHOST] MATCH Virtual en ${symbol} | Dígito ${digit} | ❌ MISS (${ghost.wins}/${ghost.total})`);
    }
}

function isGhostApproved(symbol) {
    const ghost = botState.ghostResults[symbol];
    if (ghost.total < botState.ghostMinTrades) return false;
    const winRate = ghost.wins / ghost.total;
    return winRate >= botState.ghostMinWinRate;
}

function resetGhost(symbol) {
    botState.ghostResults[symbol] = { wins: 0, total: 0, lastDigit: null };
}

// ─── CONEXIÓN ─────────────────────────────────────────────────
let ws = null;
function connectDeriv() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => { setTimeout(() => ws.send(JSON.stringify({ authorize: DERIV_TOKEN })), 1000); });
    ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.msg_type === 'authorize') {
            botState.isConnectedToDeriv = true;
            console.log("🛡️ TRIPLE ESCUDO v7.0 ACTIVADO (Cooldown + Adaptativo + Ghost)");
            SYMBOLS.forEach(s => {
                ws.send(JSON.stringify({ ticks_history: s, count: 5000, end: 'latest', style: 'ticks' }));
                ws.send(JSON.stringify({ subscribe: 1, ticks: s }));
            });
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        if (msg.msg_type === 'history') {
            const s = msg.echo_req.ticks_history;
            const prices = msg.history.prices;
            const digits = prices.map(p => parseInt(String(p.toFixed(2)).slice(-1)));
            botState.markets[s].digitHistory = digits;
            digits.forEach(d => updateHoleStats(s, d));
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const s = msg.tick.symbol;
            const digit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
            const m = botState.markets[s];
            m.digitHistory.push(digit);
            if (m.digitHistory.length > 5000) m.digitHistory.shift();
            updateHoleStats(s, digit);

            // ─── GHOST PROTOCOL: Evaluar trades fantasma en CADA tick ───
            if (botState.isRunning && botState.ghostMode) {
                runGhostEvaluation(s, digit);
            }

            if (botState.isRunning && !botState.activeContractId && !botState.isBuying) {
                evaluateSingularity();
            }
        }

        if (msg.msg_type === 'buy') {
            if (msg.buy) {
                botState.activeContractId = msg.buy.contract_id;
                botState.isBuying = false;
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            } else {
                console.error("❌ ERROR AL COMPRAR:", msg.error?.message || "Desconocido");
                botState.isBuying = false;
                botState.activeContractId = null;
            }
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract?.is_sold) {
            finalizeTrade(msg.proposal_open_contract);
        }
        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
    });
    ws.on('close', () => { botState.isConnectedToDeriv = false; setTimeout(connectDeriv, 5000); });
}

// ─── GHOST EVALUATION (Simulación en cada tick) ───────────────
function runGhostEvaluation(currentSymbol, currentDigit) {
    // Para cada mercado, verificamos si hay un hueco que el Ghost debería simular
    SYMBOLS.forEach(s => {
        const m = botState.markets[s];
        const threshold = calculateAdaptiveThreshold(s);

        let coldest = -1, maxT = -1;
        for (let d = 0; d <= 9; d++) {
            if (m.lastAppearance[d] > maxT) { maxT = m.lastAppearance[d]; coldest = d; }
        }

        // Si hay un hueco por encima del umbral adaptativo Y el ghost aún no tiene suficientes datos
        const ghost = botState.ghostResults[s];
        if (maxT > threshold && ghost.total < botState.ghostMinTrades && s === currentSymbol) {
            // Usamos el tick actual como "resultado" del ghost trade anterior
            if (ghost.lastDigit !== null) {
                // Ya hay un ghost pendiente, este tick es su resultado
                processGhostTrade(s, ghost.lastDigit, currentDigit);
                ghost.lastDigit = null;
            } else {
                // Marcamos este dígito frío como el próximo ghost trade
                ghost.lastDigit = coldest;
            }
        }
    });
}

// ─── MOTOR DE CAZA MULTI-MERCADO (TRIPLE ESCUDO) ──────────────
function evaluateSingularity() {
    const now = Date.now();

    // ─── MEJORA 1: Cooldown Inteligente Post-Derrota ───
    if (botState.lastRecoveryFailTime > 0) {
        const timeSinceFail = now - botState.lastRecoveryFailTime;
        if (timeSinceFail < botState.penaltyCooldownMs) {
            return; // Aún en período de castigo, no operar
        } else {
            botState.lastRecoveryFailTime = 0; // Castigo cumplido
            console.log("⏰ [COOLDOWN] Período de enfriamiento completado. Reanudando cacería.");
        }
    }

    if (now - botState.lastTradeTime < botState.cooldownMs) return;

    let targetHole = null;
    let targetSymbol = null;
    let maxGlobalTension = -1;

    if (botState.recoveryLayer > 0) {
        // MODO PERSISTENCIA: Seguimos cazando el MISMO dígito en el mismo mercado
        targetSymbol = botState.activeSymbol;
        const m = botState.markets[targetSymbol];
        targetHole = { 
            digit: botState.lastHoleDigit, 
            tension: m.lastAppearance[botState.lastHoleDigit] 
        };
    } else {
        // MODO BÚSQUEDA GLOBAL: Escaneamos los 4 mercados por el hueco más profundo
        SYMBOLS.forEach(s => {
            const m = botState.markets[s];
            if (m.digitHistory.length < 100) return;

            // ─── MEJORA 2: Umbral Adaptativo por mercado ───
            const threshold = calculateAdaptiveThreshold(s);

            for (let d = 0; d <= 9; d++) {
                if (m.lastAppearance[d] > threshold && m.lastAppearance[d] > maxGlobalTension) {
                    maxGlobalTension = m.lastAppearance[d];
                    targetSymbol = s;
                    targetHole = { digit: d, tension: maxGlobalTension };
                }
            }
        });
    }

    if (!targetHole) return;

    // ─── MEJORA 3: Ghost Protocol Gate ───
    // Solo en el primer disparo (no en recuperación), verificar que el Ghost apruebe
    if (botState.recoveryLayer === 0 && botState.ghostMode) {
        if (!isGhostApproved(targetSymbol)) {
            return; // El Ghost aún no tiene suficiente confianza
        }
        console.log(`👻 [GHOST APROBADO] ${targetSymbol} pasó la validación virtual. ¡Disparando con dinero real!`);
        resetGhost(targetSymbol); // Limpiar ghost para el próximo ciclo
    }

    botState.activeSymbol = targetSymbol;
    botState.lastHoleDigit = targetHole.digit;
    botState.isBuying = true;
    botState.lastTradeTime = now;

    // Gestión de Stake (Recuperación Conservadora)
    let currentStake = botState.stake;
    if (botState.recoveryLayer === 1) currentStake = botState.stake * 1.5;
    if (botState.recoveryLayer === 2) currentStake = botState.stake * 2.5;
    if (botState.recoveryLayer >= 3) currentStake = botState.stake * 5;

    console.log(`🚀 [SINGULARIDAD] Caza en ${targetSymbol} | Dígito: ${targetHole.digit} | Tensión: ${targetHole.tension} | Capa: ${botState.recoveryLayer} | Stake: $${currentStake}`);

    const req = {
        buy: 1, price: currentStake,
        parameters: {
            amount: currentStake, basis: 'stake', contract_type: 'DIGITMATCH',
            currency: 'USD', symbol: targetSymbol, duration: 1, duration_unit: 't',
            barrier: String(targetHole.digit)
        }
    };
    ws.send(JSON.stringify(req));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    
    botState.dailyProfit += isWin ? profit : 0;
    botState.dailyLoss += isWin ? 0 : Math.abs(profit);
    botState.totalTradesSession++;
    
    if (isWin) {
        console.log(`✨ [HUECO CERRADO] Victoria Maestra +$${profit.toFixed(2)}`);
        botState.winsSession++;
        botState.recoveryLayer = 0;
    } else {
        console.log(`🌑 [HUECO PERSISTENTE] El dígito no salió. Capa ${botState.recoveryLayer + 1}`);
        botState.lossesSession++;
        botState.recoveryLayer++;
        // ─── MEJORA 1: Si el ciclo de recuperación falla por completo, activar castigo ───
        if (botState.recoveryLayer > 3) {
            botState.recoveryLayer = 0;
            botState.lastRecoveryFailTime = Date.now();
            console.log(`🧊 [COOLDOWN ACTIVADO] Ciclo perdedor completo. Enfriamiento de 5 minutos.`);
        }
    }

    botState.tradeHistory.unshift({
        symbol: c.display_symbol,
        type: `MATCH(${botState.lastHoleDigit})`,
        profit,
        result: isWin ? 'WIN ✨' : 'LOSS 🌑',
        time: new Date().toLocaleTimeString()
    });
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
    botState.activeContractId = null;

    const net = botState.dailyProfit - botState.dailyLoss;
    if (net >= botState.takeProfit || botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`🏁 SINGULARIDAD ALCANZADA: $${net.toFixed(2)}`);
    }
    saveState();
}

// ─── API ──────────────────────────────────────────────────────
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));
app.get('/differs/status', (req, res) => {
    // Buscar la mayor tensión actual entre todos los mercados
    let maxT = 0, targetD = '-', bestSymbol = '-';
    SYMBOLS.forEach(s => {
        const m = botState.markets[s];
        for(let d=0; d<=9; d++) {
            if(m.lastAppearance[d] > maxT) {
                maxT = m.lastAppearance[d];
                targetD = d;
                bestSymbol = s;
            }
        }
    });

    // Calcular el umbral adaptativo del mejor mercado para mostrarlo
    const adaptiveThreshold = bestSymbol !== '-' ? calculateAdaptiveThreshold(bestSymbol) : 85;

    // Estado del Ghost Protocol
    const ghostStatus = {};
    SYMBOLS.forEach(s => { ghostStatus[s] = botState.ghostResults[s]; });

    // ─── MEJORA 1: Mostrar si estamos en cooldown ───
    const inCooldown = botState.lastRecoveryFailTime > 0 && 
        (Date.now() - botState.lastRecoveryFailTime < botState.penaltyCooldownMs);
    const cooldownRemaining = inCooldown ? 
        Math.ceil((botState.penaltyCooldownMs - (Date.now() - botState.lastRecoveryFailTime)) / 1000) : 0;

    res.json({ 
        success: true, 
        data: { 
            ...botState, 
            shannonEntropy: maxT,
            markovEdge: targetD,
            currentBarrier: targetD,
            adaptiveThreshold,
            inCooldown,
            cooldownRemaining,
            ghostStatus
        } 
    });
});
app.post('/differs/control', (req, res) => {
    const { action, stake, takeProfit, maxDailyLoss } = req.body;
    if (action === 'START' || action === 'SYNC') {
        if (stake) botState.stake = parseFloat(stake);
        if (takeProfit) botState.takeProfit = parseFloat(takeProfit);
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (action === 'START') botState.isRunning = true;
    } else if (action === 'STOP') botState.isRunning = false;
    else if (action === 'RESET_DAY') { 
        botState.dailyProfit = 0; 
        botState.dailyLoss = 0; 
        botState.totalTradesSession = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.tradeHistory = [];
        botState.lastRecoveryFailTime = 0;
        botState.recoveryLayer = 0;
        // Reset de Ghost Protocol
        SYMBOLS.forEach(s => { botState.ghostResults[s] = { wins: 0, total: 0, lastDigit: null }; });
    }
    saveState(); res.json({ success: true });
});
app.listen(process.env.PORT || 8080, '0.0.0.0', () => connectDeriv());
