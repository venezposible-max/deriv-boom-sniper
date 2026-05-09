/**
 * ============================================================
 *  PROYECTO ANTIGRAVEDAD v7.1 - TRIPLE ESCUDO + DIFFERS
 *  Estrategia: Hot Digit Detection (Dígito Sobre-Representado)
 *  Contrato: DIGITDIFF (90% probabilidad base)
 *  Escudo 1: 🧊 Cooldown Inteligente Post-Derrota
 *  Escudo 2: 🎯 Umbral Adaptativo (Auto-Calibración)  
 *  Escudo 3: 👻 Ghost Protocol (Simulación Virtual)
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
    cooldownMs: 1500,
    isBuying: false,
    recoveryLayer: 0,
    lastHotDigit: null,
    // Cooldown Inteligente
    lastRecoveryFailTime: 0,
    penaltyCooldownMs: 180000, // 3 min de castigo (Differs pierde poco, no necesita 5)
    // Ghost Protocol
    ghostResults: {},
    ghostMinTrades: 3,        // 3 trades fantasma para validación rápida
    ghostMinWinRate: 0.66,    // Al menos 2 de 3 ghosts deben ganar (66%)
    // Mercados
    markets: {}
};

SYMBOLS.forEach(s => {
    botState.markets[s] = {
        digitHistory: [],
        lastAppearance: Array(10).fill(0),
        digitFrequency: Array(10).fill(0), // Frecuencia reciente de cada dígito
        entropy: 0
    };
    botState.ghostResults[s] = { wins: 0, total: 0, pendingDigit: null };
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

// ─── DETECCIÓN DE DÍGITO CALIENTE ─────────────────────────────
// Para DIFFERS, buscamos el dígito MÁS FRECUENTE (caliente).
// Si un dígito ha salido demasiado, es probable que el mercado
// se "normalice" y ese dígito deje de salir → apostamos que DIFERIRÁ.
function updateMarketStats(symbol, digit) {
    const m = botState.markets[symbol];
    for (let d = 0; d <= 9; d++) {
        if (d === digit) m.lastAppearance[d] = 0;
        else m.lastAppearance[d]++;
    }
}

function findHottestDigit(symbol) {
    const m = botState.markets[symbol];
    if (m.digitHistory.length < 50) return null;

    // Contar frecuencia en los últimos 100 ticks
    const recent = m.digitHistory.slice(-100);
    const freq = Array(10).fill(0);
    recent.forEach(d => freq[d]++);

    let hottest = 0;
    let maxFreq = -1;
    for (let d = 0; d <= 9; d++) {
        if (freq[d] > maxFreq) {
            maxFreq = freq[d];
            hottest = d;
        }
    }

    // Solo es interesante si el dígito está sobre-representado (>= 14% en vez del 10% esperado)
    const overRepresentation = maxFreq / recent.length;
    return { digit: hottest, frequency: maxFreq, overRep: overRepresentation };
}

// ─── UMBRAL ADAPTATIVO ───────────────────────────────────────
// Para Differs, el umbral controla cuánta "sobre-representación" necesitamos ver
function calculateMinOverRep(symbol) {
    const m = botState.markets[symbol];
    if (m.digitHistory.length < 200) return 0.14; // Default: 14%

    const recent = m.digitHistory.slice(-500);
    const freq = Array(10).fill(0);
    recent.forEach(d => freq[d]++);
    const mean = recent.length / 10;
    let variance = 0;
    freq.forEach(f => { variance += Math.pow(f - mean, 2); });
    const stdDev = Math.sqrt(variance / 10);

    if (stdDev < 4) return 0.16;   // Mercado estable: exigimos 16% para entrar
    if (stdDev < 7) return 0.14;   // Mercado normal: 14%
    if (stdDev < 12) return 0.13;  // Mercado con sesgo: 13%
    return 0.12;                    // Mercado caótico: 12%
}

// ─── GHOST PROTOCOL ──────────────────────────────────────────
function processGhostDiffer(symbol, hotDigit, actualNextDigit) {
    const ghost = botState.ghostResults[symbol];
    ghost.total++;
    if (actualNextDigit !== hotDigit) {
        ghost.wins++; // DIFFERS gana cuando el dígito es DIFERENTE
        console.log(`👻 [GHOST VIRTUAL] ${symbol} | Diferir de ${hotDigit} (Salió ${actualNextDigit}) | ✅ WIN (${ghost.wins}/${ghost.total})`);
    } else {
        console.log(`👻 [GHOST VIRTUAL] ${symbol} | Diferir de ${hotDigit} (Salió ${actualNextDigit}) | ❌ LOSS (${ghost.wins}/${ghost.total})`);
    }
}

function isGhostApproved(symbol) {
    const ghost = botState.ghostResults[symbol];
    if (ghost.total < botState.ghostMinTrades) return false;
    return (ghost.wins / ghost.total) >= botState.ghostMinWinRate;
}

function resetGhost(symbol) {
    botState.ghostResults[symbol] = { wins: 0, total: 0, pendingDigit: null };
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
            console.log("🛡️ TRIPLE ESCUDO v7.1 ACTIVADO (DIFFERS + Cooldown + Adaptativo + Ghost)");
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
            digits.forEach(d => updateMarketStats(s, d));
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const s = msg.tick.symbol;
            const digit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
            const m = botState.markets[s];
            m.digitHistory.push(digit);
            if (m.digitHistory.length > 5000) m.digitHistory.shift();
            updateMarketStats(s, digit);

            // Ghost Protocol: evaluar trades fantasma
            if (botState.isRunning) {
                runGhostEvaluation(s, digit);
            }

            if (botState.isRunning && !botState.activeContractId && !botState.isBuying) {
                evaluateDiffer();
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

// ─── GHOST EVALUATION ─────────────────────────────────────────
function runGhostEvaluation(currentSymbol, currentDigit) {
    SYMBOLS.forEach(s => {
        const ghost = botState.ghostResults[s];
        // Si hay un ghost pendiente, este tick es su resultado
        if (ghost.pendingDigit !== null && s === currentSymbol) {
            processGhostDiffer(s, ghost.pendingDigit, currentDigit);
            ghost.pendingDigit = null;
        }

        // Verificar si hay oportunidad de ghost nuevo
        if (ghost.total < botState.ghostMinTrades && s === currentSymbol) {
            const hot = findHottestDigit(s);
            const minOverRep = calculateMinOverRep(s);
            if (hot && hot.overRep >= minOverRep) {
                ghost.pendingDigit = hot.digit;
            }
        }
    });
}

// ─── MOTOR DE DIFFERS (TRIPLE ESCUDO) ─────────────────────────
function evaluateDiffer() {
    const now = Date.now();

    // Cooldown Post-Derrota
    if (botState.lastRecoveryFailTime > 0) {
        const elapsed = now - botState.lastRecoveryFailTime;
        if (elapsed < botState.penaltyCooldownMs) return;
        botState.lastRecoveryFailTime = 0;
        console.log("⏰ [COOLDOWN] Enfriamiento completado. Reanudando.");
    }

    if (now - botState.lastTradeTime < botState.cooldownMs) return;

    let targetSymbol = null;
    let targetDigit = null;
    let bestOverRep = 0;

    if (botState.recoveryLayer > 0) {
        // Persistencia: mismo mercado, mismo dígito
        targetSymbol = botState.activeSymbol;
        targetDigit = botState.lastHotDigit;
    } else {
        // Búsqueda Global: mercado con el dígito más sobre-representado
        SYMBOLS.forEach(s => {
            const m = botState.markets[s];
            if (m.digitHistory.length < 100) return;

            const hot = findHottestDigit(s);
            const minOverRep = calculateMinOverRep(s);

            if (hot && hot.overRep >= minOverRep && hot.overRep > bestOverRep) {
                bestOverRep = hot.overRep;
                targetSymbol = s;
                targetDigit = hot.digit;
            }
        });
    }

    if (!targetSymbol || targetDigit === null) return;

    // Ghost Gate (solo en primer disparo)
    if (botState.recoveryLayer === 0) {
        if (!isGhostApproved(targetSymbol)) return;
        console.log(`👻 [GHOST OK] ${targetSymbol} aprobado (${botState.ghostResults[targetSymbol].wins}/${botState.ghostResults[targetSymbol].total} wins)`);
        resetGhost(targetSymbol);
    }

    botState.activeSymbol = targetSymbol;
    botState.lastHotDigit = targetDigit;
    botState.isBuying = true;
    botState.lastTradeTime = now;

    // Estrategia Fénix: Differs (Capa 0) -> Match (Capas 1,2,3)
    let currentContractType = 'DIGITDIFF';
    let currentStake = botState.stake;

    if (botState.recoveryLayer > 0) {
        currentContractType = 'DIGITMATCH';
        // Multiplicadores Fénix (Bajos, porque Match paga 800%)
        if (botState.recoveryLayer === 1) currentStake = botState.stake * 1;
        if (botState.recoveryLayer === 2) currentStake = botState.stake * 1.5;
        if (botState.recoveryLayer >= 3) currentStake = botState.stake * 2.5;
        console.log(`🔥 [FÉNIX] ${targetSymbol} | Recuperando con MATCH(=${targetDigit}) | Capa: ${botState.recoveryLayer} | Stake: $${currentStake}`);
    } else {
        console.log(`🎯 [DIFFERS] ${targetSymbol} | Hot Digit: ${targetDigit} (${(bestOverRep*100).toFixed(0)}%) | Capa: 0 | Stake: $${currentStake}`);
    }

    ws.send(JSON.stringify({
        buy: 1, price: currentStake,
        parameters: {
            amount: currentStake, basis: 'stake', contract_type: currentContractType,
            currency: 'USD', symbol: targetSymbol, duration: 1, duration_unit: 't',
            barrier: String(targetDigit)
        }
    }));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    
    botState.dailyProfit += isWin ? profit : 0;
    botState.dailyLoss += isWin ? 0 : Math.abs(profit);
    botState.totalTradesSession++;
    
    const isRecovery = botState.recoveryLayer > 0;
    const typeLabel = isRecovery ? `MATCH(=${botState.lastHotDigit})` : `DIFF(≠${botState.lastHotDigit})`;

    if (isWin) {
        console.log(`✅ [${isRecovery ? 'FÉNIX WIN' : 'DIFFER WIN'}] +$${profit.toFixed(2)} | Balance: $${botState.balance}`);
        botState.winsSession++;
        botState.recoveryLayer = 0;
    } else {
        console.log(`❌ [${isRecovery ? 'FÉNIX LOSS' : 'DIFFER LOSS'}] -$${Math.abs(profit).toFixed(2)} | Capa ${botState.recoveryLayer + 1}`);
        botState.lossesSession++;
        botState.recoveryLayer++;
        if (botState.recoveryLayer > 3) {
            botState.recoveryLayer = 0;
            botState.lastRecoveryFailTime = Date.now();
            console.log(`🧊 [COOLDOWN] Ciclo perdedor. Enfriamiento 3 min.`);
        }
    }

    botState.tradeHistory.unshift({
        symbol: c.display_symbol,
        type: typeLabel,
        profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date().toLocaleTimeString()
    });
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
    botState.activeContractId = null;

    const net = botState.dailyProfit - botState.dailyLoss;
    if (net >= botState.takeProfit || botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`🏁 META ALCANZADA: $${net.toFixed(2)}`);
    }
    saveState();
}

// ─── API ──────────────────────────────────────────────────────
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));
app.get('/differs/status', (req, res) => {
    let maxOverRep = 0, targetD = '-', bestSymbol = '-';
    SYMBOLS.forEach(s => {
        const hot = findHottestDigit(s);
        if (hot && hot.overRep > maxOverRep) {
            maxOverRep = hot.overRep;
            targetD = hot.digit;
            bestSymbol = s;
        }
    });

    const inCooldown = botState.lastRecoveryFailTime > 0 && 
        (Date.now() - botState.lastRecoveryFailTime < botState.penaltyCooldownMs);
    const cooldownRemaining = inCooldown ? 
        Math.ceil((botState.penaltyCooldownMs - (Date.now() - botState.lastRecoveryFailTime)) / 1000) : 0;

    res.json({ 
        success: true, 
        data: { 
            ...botState, 
            shannonEntropy: (maxOverRep * 100).toFixed(1),
            markovEdge: targetD,
            currentBarrier: targetD,
            inCooldown,
            cooldownRemaining
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
        SYMBOLS.forEach(s => { botState.ghostResults[s] = { wins: 0, total: 0, pendingDigit: null }; });
    }
    saveState(); res.json({ success: true });
});
app.listen(process.env.PORT || 8080, '0.0.0.0', () => connectDeriv());
