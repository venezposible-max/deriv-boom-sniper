/**
 * ============================================================
 *  DIFFERS SNIPER ENGINE v18.13 [THE GOLDEN SNIPER]
 *  Estrategia: DIFFERS — El último dígito NO será X
 *  Símbolo: R_100 (Sincronía Atómica por cadencia Fibonacci)
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

// ─── CONFIGURACIÓN CENTRAL ───────────────────────────────────
const APP_ID = process.env.DERIV_APP_ID || '36544';
const DERIV_TOKEN_DEMO = process.env.DERIV_TOKEN_DEMO || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-differs.json');
let SYMBOL = 'R_100';

// ─── ESTADO GLOBAL ────────────────────────────────────────────
let botState = {
    isRunning: true,
    isConnectedToDeriv: false,
    isRealAccount: false,
    balance: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    isRecoveryEnabled: true,
    recoveryActive: false,
    tradeHistory: [],
    lastDigit: null,
    digitHistory: [],
    digitFrequency: {},
    currentBarrier: null,
    stake: 10.00,
    maxDailyLoss: 200,
    takeProfit: 50,
    dailyLoss: 0,
    dailyProfit: 0,
    lastTradeTime: 0,
    cooldownMs: 3000,
    isBuying: false,
    activeContractId: null,
    isAuthing: false,
    lastTickReceivedAt: Date.now(),
    avgTickInterval: 1000,
    tickIntervals: [],
    digitTransitions: {},
    currentPing: 50,
    lastPingSentAt: 0,
    lastTickPrice: 0,
    rsiValues: [],
    lastRSI: 50,
    lastEMA: 0,
    emaInitialized: false,
    pnlSession: 0,
    ghostStreak: 0,
    nextBarrier: null
};

// ─── CARGAR ESTADO ───
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        botState = { ...botState, ...saved.botState, isBuying: false, isAuthing: false };
        if (saved.botState.isRunning === undefined) botState.isRunning = true;
    } catch (e) {}
}

const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ botState })); } catch (e) {} };

// [v18.13] FIBONACCI CYCLE ANALYSIS
const FIBO_SECUENCE = [1, 2, 3, 5, 8, 13, 21];

function chooseBestBarrier() {
    const hist = botState.digitHistory;
    if (hist.length < 25) return '5';

    let digitScores = Array(10).fill(0);

    // 1. Frecuencia Reciente (Filtro v18.12)
    const freqLast = {};
    hist.slice(-40).forEach(d => freqLast[d] = (freqLast[d] || 0) + 1);
    for (let d = 0; d <= 9; d++) {
        digitScores[d] += (freqLast[d] || 0) * 10; // Peso 40%
    }

    // 2. Transiciones (Filtro v18.8)
    const lastD = hist[hist.length - 1];
    for (let d = 0; d <= 9; d++) {
        const t = botState.digitTransitions[`${lastD}->${d}`] || 0;
        digitScores[d] += t * 5; // Peso 30%
    }

    // 3. CICLOS DE FIBONACCI [v18.13]
    FIBO_SECUENCE.forEach((steps) => {
        const index = hist.length - 1 - steps;
        if (index >= 0) {
            const digitAtFiboPoint = hist[index];
            digitScores[digitAtFiboPoint] += 25; // Penalización alta por Ciclo de Oro
        }
    });

    // Encontrar el dígito con el MENOR SCORE de riesgo
    let bestDigit = '0';
    let minScore = 99999;
    
    for (let d = 0; d <= 9; d++) {
        if (digitScores[d] < minScore) {
            minScore = digitScores[d];
            bestDigit = String(d);
        }
    }

    botState.currentBarrier = bestDigit;
    return bestDigit;
}

// ─── SERVIDOR WEB (EXPRESS) ───
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/differs/status', (req, res) => {
    res.json({ success: true, data: { ...botState, symbol: SYMBOL, winRate: botState.totalTradesSession > 0 ? ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1) : '0.0' } });
});

app.post('/differs/control', (req, res) => {
    const { action, stake, maxDailyLoss, takeProfit } = req.body;
    if (action === 'START') {
        if (stake) botState.stake = parseFloat(stake);
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (takeProfit) botState.takeProfit = parseFloat(takeProfit);
        botState.isRunning = true;
        console.log(`▶️ SNIPER v18.13 INICIADO [GOLDEN FIBO]`);
        return res.json({ success: true, isRunning: true });
    }
    if (action === 'STOP') { botState.isRunning = false; return res.json({ success: true, isRunning: false }); }
    if (action === 'RESET_DAY') { botState.dailyLoss = 0; botState.dailyProfit = 0; botState.tradeHistory = []; saveState(); return res.json({ success: true }); }
    res.status(400).json({ success: false });
});

app.post('/differs/toggle-recovery', (req, res) => {
    const { enabled } = req.body;
    botState.isRecoveryEnabled = !!enabled;
    saveState();
    res.json({ success: true, isRecoveryEnabled: botState.isRecoveryEnabled });
});

app.post('/differs/switch-market', (req, res) => {
    const { symbol } = req.body;
    if (symbol) {
        SYMBOL = symbol;
        botState.symbol = symbol;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            setTimeout(() => { ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL })); }, 1000);
        }
    }
    res.json({ success: true, symbol: SYMBOL });
});

app.post('/differs/switch-account', (req, res) => {
    const { isReal } = req.body;
    botState.isRealAccount = !!isReal;
    if (ws) { ws.close(); }
    res.json({ success: true, isRealAccount: botState.isRealAccount });
});

// ─── CONEXIÓN A DERIV ───
let ws = null;
let reconnectTimeout = null;

function connectDeriv() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN && !botState.isAuthing) {
                const token = (botState.isRealAccount ? process.env.DERIV_TOKEN_REAL : process.env.DERIV_TOKEN_DEMO) || DERIV_TOKEN_DEMO;
                botState.isAuthing = true;
                ws.send(JSON.stringify({ authorize: token.trim() }));
            }
        }, 2000);
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        if (msg.msg_type === 'authorize' && msg.authorize) {
             botState.isAuthing = false;
             botState.isConnectedToDeriv = true;
             botState.balance = parseFloat(msg.authorize.balance || 0);
             ws.send(JSON.stringify({ forget_all: "ticks" }));
             botState.lastPingSentAt = Date.now();
             ws.send(JSON.stringify({ ping: 1 }));
             setTimeout(() => {
                 if (ws && ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
                     ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                     console.log(`🎯 SNIPER v18.13 ACTIVADO | Armonía Áurea de Fibonacci...`);
                 }
             }, 2000);
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const now = Date.now();
            const lastInt = now - botState.lastTickReceivedAt;
            botState.lastTickReceivedAt = now;
            if (lastInt > 100 && lastInt < 3000) {
                botState.tickIntervals.push(lastInt);
                if (botState.tickIntervals.length > 10) botState.tickIntervals.shift();
                botState.avgTickInterval = botState.tickIntervals.reduce((a, b) => a + b, 0) / botState.tickIntervals.length;
            }
            const tickDigit = parseInt(String(msg.tick.quote).slice(-1));
            const tickPrice = parseFloat(msg.tick.quote);
            botState.lastTickPrice = tickPrice;
            
            // [v18.13] SIMULACIÓN FANTASMA CON FIBONACCI
            if (botState.nextBarrier !== null) {
                if (tickDigit !== parseInt(botState.nextBarrier)) {
                    botState.ghostStreak++;
                } else {
                    botState.ghostStreak = 0;
                    console.log(`👻 GHOST LOSS: Ciclo roto en dígito ${tickDigit}.`);
                }
            }
            
            botState.nextBarrier = chooseBestBarrier();
            if (botState.lastDigit !== null) { botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] = (botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] || 0) + 1; }
            botState.lastDigit = tickDigit;
            botState.digitHistory.push(tickDigit);
            if (botState.digitHistory.length > 100) botState.digitHistory.shift();

            const freq = {};
            botState.digitHistory.forEach(d => freq[d] = (freq[d] || 0) + 1);
            botState.digitFrequency = freq;

            if (botState.isRunning && !botState.isBuying && !botState.activeContractId) {
                botState.pendingSignal = { type: 'DIFFERS' };
            }
        }

        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
        if (msg.msg_type === 'ping') { botState.currentPing = Date.now() - botState.lastPingSentAt; }

        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            botState.isBuying = false;
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
            const c = msg.proposal_open_contract;
            if (c.is_sold) {
                const profit = parseFloat(c.profit);
                if (profit > 0) {
                    botState.winsSession++;
                    botState.dailyProfit += profit;
                    if (botState.recoveryActive) {
                        console.log(`✅ RESCATE ÁUREO COMPLETADO.`);
                        botState.recoveryActive = false;
                    }
                } else {
                    const lossVal = Math.abs(profit);
                    botState.lossesSession++;
                    botState.dailyLoss += lossVal;
                    const netDaily = botState.dailyProfit - botState.dailyLoss;
                    if (botState.recoveryActive) {
                        botState.recoveryActive = false;
                        botState.lastTradeTime = Date.now() + 60000;
                    } else if (botState.isRecoveryEnabled) {
                        if (netDaily <= 0) {
                            botState.recoveryActive = true;
                            botState.lastTradeTime = Date.now() + 15000;
                            console.log(`🛡️ RESCATE x11 ACTIVADO: PnL -$${Math.abs(netDaily).toFixed(2)}. Invocando Heavy-Ghost...`);
                        } else {
                            console.log(`🛡️ ESCUDO DE GANANCIA: PnL +$${netDaily.toFixed(2)}. Protegiendo acumulado.`);
                            botState.lastTradeTime = Date.now() + 10000;
                        }
                    }
                }

                botState.tradeHistory.unshift({
                    type: 'DIFFERS', profit: parseFloat(profit.toFixed(2)), time: new Date().toLocaleTimeString(),
                    barrier: botState.currentBarrier,
                    result: profit > 0 ? 'WIN ✅' : 'LOSS ❌',
                    lastDigit: botState.lastDigit
                });
                if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
                botState.totalTradesSession++;
                botState.activeContractId = null;
                botState.ghostStreak = 0; 
                saveState();
                console.log(`💰 RESULTADO: ${profit > 0 ? 'WIN' : 'LOSS'} | PnL: $${(botState.dailyProfit - botState.dailyLoss).toFixed(2)}`);
            }
        }
    });

    ws.on('close', (code) => {
        botState.isConnectedToDeriv = false;
        botState.isBuying = false;
        if (!reconnectTimeout) reconnectTimeout = setTimeout(connectDeriv, 5000);
    });
}

function executeFlashMirrorFire() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !botState.pendingSignal || botState.isBuying || botState.activeContractId) return;
    const now = Date.now();
    if (now - botState.lastTradeTime < 1000) return;
    const requiredGhost = botState.recoveryActive ? 4 : 2;
    if (botState.ghostStreak < requiredGhost) return;
    const barrier = botState.nextBarrier || chooseBestBarrier();
    botState.isBuying = true;
    if (botState.currentPing > 150) { botState.isBuying = false; return; }
    let finalStake = botState.stake;
    if (botState.recoveryActive) finalStake = botState.stake * 11;
    console.log(`🚀 LANZADO [GOLDEN v18.13] | NO-${barrier} | Fibo-Conf: ${botState.ghostStreak}`);
    ws.send(JSON.stringify({
        buy: 1, price: finalStake,
        parameters: {
            amount: finalStake, basis: 'stake', contract_type: 'DIGITDIFF',
            currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: barrier
        }
    }));
    botState.pendingSignal = null;
}

setInterval(() => {
    if (!botState.isRunning || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now % 10000 < 50) { botState.lastPingSentAt = now; ws.send(JSON.stringify({ ping: 1 })); }
    const timeSinceLast = now - botState.lastTickReceivedAt;
    const nextExpected = botState.avgTickInterval;
    const dynamicLead = Math.min(400, botState.currentPing + 25);
    if (botState.currentPing > 300) return;
    if (timeSinceLast >= (nextExpected - dynamicLead)) { executeFlashMirrorFire(); }
}, 50);

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 v18.13 ONLINE EN PUERTO ${PORT}`);
    connectDeriv();
});
