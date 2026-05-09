/**
 * ============================================================
 *  PROYECTO ANTIGRAVEDAD v5.0 - GHOST PROTOCOL (GANAR-GANAR)
 *  Motor: Cerebro Camaleón Adaptativo
 *  Protocolo: Trading Virtual Pre-Validación (Ghost Mode)
 *  Escaneo: Multi-Mercado (R10, R25, R50, R100)
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
    cooldownMs: 2500,
    isBuying: false,
    isRecoveryEnabled: true,
    recoveryLayer: 0,
    shannonEntropy: 0,
    markovEdge: 0,
    currentBarrier: null,
    currentContractType: 'DIGITDIFF',
    // PROTOCOLO FANTASMA
    isGhostMode: true, // Siempre activo por seguridad
    virtualWinRate: 0,
    markets: {}
};

SYMBOLS.forEach(s => {
    botState.markets[s] = {
        digitHistory: [],
        entropy: 0,
        virtualSuccessHistory: [], // [true, false, ...] de los últimos 10 ticks
        lastDigit: null,
        bestStrategy: 'WAIT'
    };
});

// ─── CARGAR/GUARDAR ESTADO ────────────────────────────────────
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

// ─── MATEMÁTICAS Y ESTRATEGIAS ────────────────────────────────
function calcEntropy(hist) {
    if (hist.length < 50) return 3.32;
    const sub = hist.slice(-50);
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

function getMarkovParityEdge(hist) {
    if (hist.length < 50) return 0;
    const sub = hist.slice(-100);
    let transitions = { even: { even: 0, odd: 0, total: 0 }, odd: { even: 0, odd: 0, total: 0 } };
    for (let i = 1; i < sub.length; i++) {
        const prev = sub[i-1] % 2 === 0 ? 'even' : 'odd';
        const curr = sub[i] % 2 === 0 ? 'even' : 'odd';
        transitions[prev][curr]++;
        transitions[prev].total++;
    }
    const last = hist[hist.length-1] % 2 === 0 ? 'even' : 'odd';
    const t = transitions[last];
    if (t.total === 0) return 0.5;
    return t.even / t.total; // Probabilidad de que el siguiente sea PAR
}

function getBestStrategy(symbol) {
    const m = botState.markets[symbol];
    const ent = m.entropy;
    if (ent > 3.25) return 'WAIT';
    if (ent > 3.10) return 'DIFFERS';
    if (ent > 2.70) return 'PARITY';
    return 'MATCHES';
}

// ─── PROTOCOLO FANTASMA: ¿Sería ganador este tick? ────────────
function updateVirtualPerformance(symbol) {
    const m = botState.markets[symbol];
    const hist = m.digitHistory;
    if (hist.length < 20) return;

    const lastDigit = hist[hist.length - 1];
    const prevHistory = hist.slice(0, -1);
    const prevDigit = prevHistory[prevHistory.length - 1];
    
    // Simulamos qué habríamos hecho un tick atrás
    const strat = getBestStrategy(symbol);
    let virtualWin = false;

    if (strat === 'DIFFERS') {
        virtualWin = lastDigit !== prevDigit; // Diferir del anterior
    } else if (strat === 'PARITY') {
        const probEven = getMarkovParityEdge(prevHistory);
        const prediction = probEven > 0.5 ? 'even' : 'odd';
        const actual = lastDigit % 2 === 0 ? 'even' : 'odd';
        virtualWin = prediction === actual;
    } else if (strat === 'MATCHES') {
        virtualWin = lastDigit === prevDigit;
    }

    m.virtualSuccessHistory.push(virtualWin);
    if (m.virtualSuccessHistory.length > 10) m.virtualSuccessHistory.shift();
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
            SYMBOLS.forEach(s => ws.send(JSON.stringify({ subscribe: 1, ticks: s })));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }
        if (msg.msg_type === 'tick' && msg.tick) {
            const s = msg.tick.symbol;
            const digit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
            const m = botState.markets[s];
            m.digitHistory.push(digit);
            if (m.digitHistory.length > 200) m.digitHistory.shift();
            m.lastDigit = digit;
            m.entropy = calcEntropy(m.digitHistory);
            m.bestStrategy = getBestStrategy(s);
            
            updateVirtualPerformance(s);

            if (s === botState.activeSymbol) {
                const wins = m.virtualSuccessHistory.filter(h => h === true).length;
                botState.virtualWinRate = (wins / m.virtualSuccessHistory.length) * 100 || 0;
                botState.shannonEntropy = m.entropy;
                botState.markovEdge = botState.virtualWinRate; // Usamos el WinRate virtual como indicador de "confianza"
            }

            if (!botState.activeContractId && !botState.isBuying && botState.isRunning) {
                evaluateAndFire();
            }
        }
        if (msg.msg_type === 'buy' && msg.buy) {
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

// ─── MOTOR DE EJECUCIÓN ───────────────────────────────────────
function evaluateAndFire() {
    const now = Date.now();
    if (now - botState.lastTradeTime < botState.cooldownMs) return;

    // 1. ELEGIR MEJOR MERCADO
    let bestSymbol = null;
    let minEntropy = 4;
    SYMBOLS.forEach(s => {
        const m = botState.markets[s];
        if (m.digitHistory.length >= 50 && m.entropy < minEntropy) {
            minEntropy = m.entropy;
            bestSymbol = s;
        }
    });

    if (!bestSymbol) return;
    const m = botState.markets[bestSymbol];
    botState.activeSymbol = bestSymbol;

    // 2. VALIDACIÓN PROTOCOLO FANTASMA (Solo operar si el virtual va bien)
    const virtualWins = m.virtualSuccessHistory.filter(h => h === true).length;
    const vWR = (virtualWins / m.virtualSuccessHistory.length) * 100;
    
    // Umbral de seguridad: Solo entramos si en modo virtual habríamos ganado 8 de los últimos 10
    if (vWR < 80 && botState.recoveryLayer === 0) {
        // console.log(`🕵️ [GHOST] Esperando racha virtual ganadora en ${bestSymbol}... (Actual: ${vWR}%)`);
        return; 
    }

    // 3. DEFINIR CONTRATO
    let contractType = '';
    let barrier = null;
    let stake = botState.stake;
    const strat = m.bestStrategy;

    if (botState.recoveryLayer === 0) {
        if (strat === 'MATCHES') {
            contractType = 'DIGITMATCHES';
            barrier = String(m.lastDigit);
            stake = botState.stake * 0.2;
        } else if (strat === 'PARITY') {
            const pEven = getMarkovParityEdge(m.digitHistory);
            contractType = pEven > 0.5 ? 'DIGITEVEN' : 'DIGITODD';
        } else if (strat === 'DIFFERS') {
            contractType = 'DIGITDIFF';
            barrier = String(m.lastDigit);
        } else return;
    } else {
        // Capas de Recuperación (HIDRA)
        contractType = 'DIGITDIFF';
        barrier = String(m.lastDigit);
        stake = botState.stake * (botState.recoveryLayer === 1 ? 1.1 : 2.5);
    }

    botState.isBuying = true;
    botState.currentBarrier = barrier;
    botState.currentContractType = contractType;
    botState.lastTradeTime = now;

    console.log(`🚀 [REAL] DISPARO en ${bestSymbol} | Estrategia: ${strat} | V-WinRate: ${vWR}%`);

    const req = {
        buy: 1, price: stake,
        parameters: {
            amount: stake, basis: 'stake', contract_type: contractType,
            currency: 'USD', symbol: bestSymbol, duration: 1, duration_unit: 't'
        }
    };
    if (barrier !== null) req.parameters.barrier = barrier;
    ws.send(JSON.stringify(req));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    botState.dailyProfit += isWin ? profit : 0;
    botState.dailyLoss += isWin ? 0 : Math.abs(profit);
    botState.totalTradesSession++;
    if (isWin) { botState.winsSession++; botState.recoveryLayer = 0; } 
    else { botState.lossesSession++; botState.recoveryLayer = Math.min(botState.recoveryLayer + 1, 2); }

    botState.tradeHistory.unshift({
        symbol: c.display_symbol,
        type: c.contract_type,
        profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date().toLocaleTimeString()
    });
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
    botState.activeContractId = null;

    const net = botState.dailyProfit - botState.dailyLoss;
    if (net >= botState.takeProfit || botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`🏁 OBJETIVO: $${net.toFixed(2)}`);
    }
    saveState();
}

// ─── API ──────────────────────────────────────────────────────
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));
app.get('/differs/status', (req, res) => {
    const m = botState.markets[botState.activeSymbol] || {};
    res.json({ success: true, data: { ...botState, shannonEntropy: m.entropy, markovEdge: botState.virtualWinRate } });
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
