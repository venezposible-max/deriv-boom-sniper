/**
 * ============================================================
 *  PROYECTO ANTIGRAVEDAD v6.0 - LA SINGULARIDAD (THE HOLE)
 *  Estrategia: Detección de Sesgos Algorítmicos (PRNG Bias)
 *  Motor: Caza de "Huecos" Estadísticos (Coldest Digit Sniper)
 *  Recuperación: Persistencia Cuántica (Aggressive Double-Down)
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
    recoveryLayer: 0, // 0=Busca Hueco, 1-3=Insistencia en el Hueco
    lastHoleDigit: null,
    // SINGULARIDAD
    markets: {}
};

SYMBOLS.forEach(s => {
    botState.markets[s] = {
        digitHistory: [],
        lastAppearance: Array(10).fill(0), // Ticks desde la última vez que salió cada dígito
        entropy: 0,
        virtualSuccess: 0
    };
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

function findSingularity(symbol) {
    const m = botState.markets[symbol];
    let coldestDigit = 0;
    let maxWait = -1;

    for (let d = 0; d <= 9; d++) {
        if (m.lastAppearance[d] > maxWait) {
            maxWait = m.lastAppearance[d];
            coldestDigit = d;
        }
    }

    // Un "Hueco" real ocurre cuando un dígito no ha salido en > 70 ticks (Probabilidad extrema de retorno)
    if (maxWait > 70) {
        return { digit: coldestDigit, tension: maxWait };
    }
    return null;
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
            console.log("🌌 MODO SINGULARIDAD ACTIVADO");
            SYMBOLS.forEach(s => {
                // Pedimos 5000 ticks para detectar huecos de inmediato
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
            // Calcular lastAppearance desde la historia
            digits.forEach(d => updateHoleStats(s, d));
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const s = msg.tick.symbol;
            const digit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
            const m = botState.markets[s];
            m.digitHistory.push(digit);
            if (m.digitHistory.length > 5000) m.digitHistory.shift();
            updateHoleStats(s, digit);

            if (botState.isRunning && !botState.activeContractId && !botState.isBuying) {
                evaluateSingularity();
            }
        }

        if (msg.msg_type === 'buy') {
            botState.activeContractId = msg.buy.contract_id;
            botState.isBuying = false;
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract?.is_sold) {
            finalizeTrade(msg.proposal_open_contract);
        }
        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
    });
    ws.on('close', () => { botState.isConnectedToDeriv = false; setTimeout(connectDeriv, 5000); });
}

// ─── MOTOR DE CAZA ────────────────────────────────────────────
function evaluateSingularity() {
    const now = Date.now();
    if (now - botState.lastTradeTime < botState.cooldownMs) return;

    let targetHole = null;
    let targetSymbol = null;

    if (botState.recoveryLayer > 0) {
        // MODO PERSISTENCIA: Seguimos cazando el MISMO dígito en el mismo mercado
        targetSymbol = botState.activeSymbol;
        targetHole = { digit: botState.lastHoleDigit, tension: botState.markets[targetSymbol].lastAppearance[botState.lastHoleDigit] };
    } else {
        // MODO BÚSQUEDA: Escaneamos todos los mercados por un hueco
        for (const s of SYMBOLS) {
            const hole = findSingularity(s);
            if (hole) {
                targetHole = hole;
                targetSymbol = s;
                break; 
            }
        }
    }

    if (!targetHole) return;

    botState.activeSymbol = targetSymbol;
    botState.lastHoleDigit = targetHole.digit;
    botState.isBuying = true;
    botState.lastTradeTime = now;

    // Gestión de Stake (Persistencia)
    let currentStake = botState.stake;
    if (botState.recoveryLayer === 1) currentStake = botState.stake * 1.5;
    if (botState.recoveryLayer >= 2) currentStake = botState.stake * 3.5;

    console.log(`🌌 [SINGULARIDAD] Caza en ${targetSymbol} | Dígito: ${targetHole.digit} | Tensión: ${targetHole.tension} Ticks`);

    const req = {
        buy: 1, price: currentStake,
        parameters: {
            amount: currentStake, basis: 'stake', contract_type: 'DIGITMATCHES',
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
        botState.recoveryLayer = 0; // Hueco reseteado
    } else {
        console.log(`🌑 [HUECO PERSISTENTE] El dígito no salió. Incrementando tensión.`);
        botState.lossesSession++;
        botState.recoveryLayer++;
        // Si tras 4 intentos el hueco no se cierra, abortamos para proteger capital
        if (botState.recoveryLayer > 3) botState.recoveryLayer = 0;
    }

    botState.tradeHistory.unshift({
        symbol: c.display_symbol,
        type: `MATCHES(${botState.lastHoleDigit})`,
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
    const m = botState.markets[botState.activeSymbol] || {};
    const hole = findSingularity(botState.activeSymbol);
    res.json({ 
        success: true, 
        data: { 
            ...botState, 
            shannonEntropy: hole ? hole.tension : 0, // Usamos entropy para mostrar la Tensión del hueco
            markovEdge: hole ? hole.digit : 0,        // Usamos markov para mostrar el dígito objetivo
            currentBarrier: hole ? hole.digit : '-'
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
    else if (action === 'RESET_DAY') { botState.dailyProfit = 0; botState.dailyLoss = 0; botState.tradeHistory = []; }
    saveState(); res.json({ success: true });
});
app.listen(process.env.PORT || 8080, '0.0.0.0', () => connectDeriv());
