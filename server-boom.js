/**
 * ============================================================
 *  DIFFERS SNIPER ENGINE v20.00 [THE RABBIT'S FOOT]
 *  Estrategia: DIFFERS ($1) + UNDER-9 RECOVERY ($10 Total)
 *  Símbolo: R_100 (Recuperación Real v20.00)
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
    waitingForRecovery: false,
    tradeHistory: [],
    lastDigit: null,
    digitHistory: [],
    digitFrequency: {},
    currentBarrier: null,
    stake: 1.00,
    maxDailyLoss: 500,
    takeProfit: 50,
    dailyLoss: 0,
    dailyProfit: 0,
    lastTradeTime: 0,
    cooldownMs: 3000,
    isBuying: false,
    activeContractId: null,
    secondaryContractId: null, 
    isAuthing: false,
    lastTickReceivedAt: Date.now(),
    avgTickInterval: 1000,
    tickIntervals: [],
    digitTransitions: {},
    currentPing: 50,
    lastPingSentAt: 0,
    lastTickPrice: 0,
    pnlSession: 0,
    ghostStreak: 0,
    nextBarrier: null
};

// ─── CARGAR ESTADO ───
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        botState = { ...botState, ...saved.botState, isBuying: false, isAuthing: false, activeContractId: null, secondaryContractId: null };
    } catch (e) {}
}

const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ botState })); } catch (e) {} };

const FIBO_SECUENCE = [1, 2, 3, 5, 8, 13, 21];

function chooseBestBarrier() {
    const hist = botState.digitHistory;
    if (hist.length < 25) return '5';
    let digitScores = Array(10).fill(0);
    const freqLast = {};
    hist.slice(-40).forEach(d => freqLast[d] = (freqLast[d] || 0) + 1);
    for (let d = 0; d <= 9; d++) digitScores[d] += (freqLast[d] || 0) * 10;
    const lastD = hist[hist.length - 1];
    for (let d = 0; d <= 9; d++) {
        const t = botState.digitTransitions[`${lastD}->${d}`] || 0;
        digitScores[d] += t * 5;
    }
    FIBO_SECUENCE.forEach((steps) => {
        const index = hist.length - 1 - steps;
        if (index >= 0) digitScores[hist[index]] += 25;
    });
    let bestDigit = '0';
    let minScore = 99999;
    for (let d = 0; d <= 9; d++) {
        if (digitScores[d] < minScore) { minScore = digitScores[d]; bestDigit = String(d); }
    }
    botState.currentBarrier = bestDigit;
    return bestDigit;
}

// ─── SERVIDOR WEB ───
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/differs/status', (req, res) => res.json({ success: true, data: botState }));

app.post('/differs/control', (req, res) => {
    const { action, stake } = req.body;
    if (action === 'START') {
        if (stake) botState.stake = parseFloat(stake);
        botState.isRunning = true;
        console.log(`▶️ SNIPER v20.00 INICIADO [THE RABBIT'S FOOT]`);
        return res.json({ success: true, isRunning: true });
    }
    if (action === 'STOP') { botState.isRunning = false; return res.json({ success: true, isRunning: false }); }
    if (action === 'RESET_DAY') { botState.dailyLoss = 0; botState.dailyProfit = 0; botState.tradeHistory = []; saveState(); return res.json({ success: true }); }
    res.status(400).json({ success: false });
});

app.post('/differs/toggle-recovery', (req, res) => {
    botState.isRecoveryEnabled = !!req.body.enabled;
    saveState();
    res.json({ success: true, isRecoveryEnabled: botState.isRecoveryEnabled });
});

// ─── CONEXIÓN A DERIV ───
let ws = null;
let reconnectTimeout = null;

function connectDeriv() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        setTimeout(() => {
            const token = (botState.isRealAccount ? process.env.DERIV_TOKEN_REAL : process.env.DERIV_TOKEN_DEMO) || DERIV_TOKEN_DEMO;
            botState.isAuthing = true;
            ws.send(JSON.stringify({ authorize: token.trim() }));
        }, 2000);
    });

    ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch (e) { return; }

        if (msg.msg_type === 'authorize' && msg.authorize) {
             botState.isAuthing = false;
             botState.isConnectedToDeriv = true;
             botState.balance = parseFloat(msg.authorize.balance || 0);
             ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
             ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
             ws.send(JSON.stringify({ ping: 1 }));
             console.log(`🎯 SNIPER v20.00 ONLINE | Rabbit Hunter Activado...`);
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const now = Date.now();
            botState.lastTickReceivedAt = now;
            botState.lastTickPrice = msg.tick.quote;
            const tickDigit = parseInt(String(msg.tick.quote).slice(-1));
            
            if (botState.nextBarrier !== null) {
                if (tickDigit !== parseInt(botState.nextBarrier)) {
                    botState.ghostStreak++;
                } else {
                    botState.ghostStreak = 0;
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

            if (botState.isRunning && !botState.isBuying && !botState.activeContractId && !botState.secondaryContractId) {
                botState.pendingSignal = { type: 'RABBIT' };
            }
        }

        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
        if (msg.msg_type === 'ping') { botState.currentPing = Date.now() - botState.lastPingSentAt; }

        if (msg.msg_type === 'buy' && msg.buy) {
            const cType = msg.echo_req.parameters.contract_type;
            if (cType === 'DIGITDIFF') {
                botState.activeContractId = msg.buy.contract_id;
            } else {
                botState.secondaryContractId = msg.buy.contract_id;
            }
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            botState.isBuying = false;
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
            const c = msg.proposal_open_contract;
            const ids = [botState.activeContractId, botState.secondaryContractId];
            
            if (c.is_sold && ids.includes(c.contract_id)) {
                const profit = parseFloat(c.profit);
                const isDiffer = c.contract_type === 'DIGITDIFF';

                botState.tradeHistory.unshift({
                    type: isDiffer ? 'DIFFERS' : 'RESCUE [UNDER-9]', 
                    profit: parseFloat(profit.toFixed(2)), 
                    time: new Date().toLocaleTimeString(),
                    barrier: c.barrier || botState.currentBarrier,
                    result: profit > 0 ? 'WIN ✅' : 'LOSS ❌'
                });
                if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();

                if (isDiffer) {
                    if (profit > 0) {
                        botState.winsSession++;
                        botState.dailyProfit += profit;
                        botState.recoveryActive = false;
                        botState.waitingForRecovery = false;
                    } else {
                        botState.lossesSession++;
                        botState.dailyLoss += Math.abs(profit);
                        if (botState.isRecoveryEnabled) {
                            botState.recoveryActive = true;
                            botState.waitingForRecovery = false;
                            botState.lastTradeTime = Date.now() + 10000;
                            console.log(`🐇 [RECOVERY] RABBIT HUNTER ACTIVADO...`);
                        }
                    }
                    botState.activeContractId = null;
                    botState.ghostStreak = 0; 
                } else {
                    // Rescate Under-9
                    if (profit > 0) {
                        botState.dailyProfit += profit;
                        console.log(`✅ ¡RESCATE EXITOSO! Under-9 Cubierto.`);
                        botState.recoveryActive = false;
                    } else {
                        botState.dailyLoss += Math.abs(profit);
                        console.log(`❌ RESCATE FALLIDO. Perforamos el Under-9.`);
                    }
                    botState.secondaryContractId = null;
                    botState.waitingForRecovery = false; // RESET CRÍTICO: Evita bloqueo
                    botState.ghostStreak = 0;
                }
                saveState();
            }
        }
    });

    ws.on('close', () => { botState.isConnectedToDeriv = false; if (!reconnectTimeout) reconnectTimeout = setTimeout(connectDeriv, 5000); });
}

function executeFlashMirrorFire() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !botState.pendingSignal || botState.isBuying || botState.activeContractId || botState.secondaryContractId) return;
    
    const isRecovery = botState.recoveryActive;
    if (isRecovery && botState.waitingForRecovery) return;

    // Ghosting moderado para Under-9
    const requiredGhost = isRecovery ? 12 : 2;
    if (botState.ghostStreak < requiredGhost) return;
    
    botState.isBuying = true;

    if (isRecovery) {
        botState.waitingForRecovery = true; 
        process.nextTick(() => { 
            const rabbitStake = 10.00; // Recupera $1.00 aprox con 90% Win
            console.log(`🐇 [RABBIT FIRE] Lanzando Under-9 Hunter | Stake: $${rabbitStake}`);
            
            ws.send(JSON.stringify({
                buy: 1, price: rabbitStake,
                parameters: { amount: rabbitStake, basis: 'stake', contract_type: 'DIGITUNDER', currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: '9' }
            }));
            
            botState.pendingSignal = null;
            botState.lastTradeTime = Date.now();
            botState.ghostStreak = 0;
        });
    } else {
        const barrier = botState.nextBarrier || chooseBestBarrier();
        ws.send(JSON.stringify({
            buy: 1, price: botState.stake,
            parameters: { amount: botState.stake, basis: 'stake', contract_type: 'DIGITDIFF', currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: barrier }
        }));
        botState.pendingSignal = null;
        botState.lastTradeTime = Date.now();
    }
}

setInterval(() => {
    if (!botState.isRunning || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const dynamicLead = Math.min(400, botState.currentPing + 25);
    if (now - botState.lastTickReceivedAt < 3000 && (now - botState.lastTickReceivedAt) >= (botState.avgTickInterval - dynamicLead)) {
        if (botState.recoveryActive) {
            setImmediate(executeFlashMirrorFire);
        } else {
            executeFlashMirrorFire();
        }
    }
}, 50);

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 v19.00 ONLINE [DOUBLE-SNIPER HUNTER]`); connectDeriv(); });
