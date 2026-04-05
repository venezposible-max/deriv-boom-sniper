/**
 * ============================================================
 *  DIFFERS SNIPER ENGINE v19.00 [DOUBLE-SNIPER HUNTER]
 *  Estrategia: DIFFERS ($1) + DOUBLE-MATCH RECOVERY ($1 Total)
 *  Símbolo: R_100 (Recuperación Real v19.00)
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
    thirdContractId: null, // Para el segundo Sniper del Double-Match
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
        botState = { ...botState, ...saved.botState, isBuying: false, isAuthing: false, activeContractId: null, secondaryContractId: null, thirdContractId: null };
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

// [v19.0] Busca los dos dígitos más dormidos para el Double-Match Recovery
function getMostDormantDigits(count = 2) {
    const hist = botState.digitHistory;
    const lastSeen = Array(10).fill(999);
    for (let i = hist.length - 1; i >= 0; i--) {
        const d = hist[i];
        if (lastSeen[d] === 999) {
            lastSeen[d] = hist.length - 1 - i;
        }
    }
    const sorted = [...Array(10).keys()].sort((a, b) => lastSeen[b] - lastSeen[a]);
    return sorted.slice(0, count).map(String);
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
        console.log(`▶️ SNIPER v19.00 INICIADO [DOUBLE-SNIPER HUNTER]`);
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
             console.log(`🎯 SNIPER v19.00 ONLINE | Double-Sniper Hunter Activado...`);
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
                botState.pendingSignal = { type: 'SNIPER' };
            }
        }

        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
        if (msg.msg_type === 'ping') { botState.currentPing = Date.now() - botState.lastPingSentAt; }

        if (msg.msg_type === 'buy' && msg.buy) {
            const cType = msg.echo_req.parameters.contract_type;
            if (cType === 'DIGITDIFF') {
                botState.activeContractId = msg.buy.contract_id;
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            } else {
                if (!botState.secondaryContractId) {
                    botState.secondaryContractId = msg.buy.contract_id;
                } else {
                    botState.thirdContractId = msg.buy.contract_id;
                }
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            }
            botState.isBuying = false;
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
            const c = msg.proposal_open_contract;
            const ids = [botState.activeContractId, botState.secondaryContractId, botState.thirdContractId];
            
            if (c.is_sold && ids.includes(c.contract_id)) {
                
                const profit = parseFloat(c.profit);
                const isDiffer = c.contract_type === 'DIGITDIFF';

                botState.tradeHistory.unshift({
                    type: isDiffer ? 'DIFFERS' : 'SNIPER [MATCH]', 
                    profit: parseFloat(profit.toFixed(2)), 
                    time: new Date().toLocaleTimeString(),
                    barrier: isDiffer ? botState.currentBarrier : (c.barrier || botState.currentBarrier),
                    result: profit > 0 ? 'WIN ✅' : 'LOSS ❌'
                });
                if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();

                if (isDiffer) {
                    if (profit > 0) {
                        botState.winsSession++;
                        botState.dailyProfit += profit;
                    } else {
                        botState.lossesSession++;
                        botState.dailyLoss += Math.abs(profit);
                        if (botState.isRecoveryEnabled) {
                            botState.recoveryActive = true;
                            botState.lastTradeTime = Date.now() + 10000;
                            console.log(`🎯 [RECOVERY] DOUBLE-SNIPER HUNTER ACTIVADO...`);
                        }
                    }
                    botState.activeContractId = null;
                    botState.ghostStreak = 0; 
                } else {
                    // Manejo de Match Sniper (Recovery)
                    if (profit > 0) {
                        botState.dailyProfit += profit;
                        console.log(`💰 ¡BOOM! SNIPER MATCH GANADO. Recuperación Exitosa.`);
                        botState.recoveryActive = false; // Un solo acierto de los dos basta
                    } else {
                        botState.dailyLoss += Math.abs(profit);
                    }
                    if (c.contract_id === botState.secondaryContractId) botState.secondaryContractId = null;
                    if (c.contract_id === botState.thirdContractId) botState.thirdContractId = null;
                }
                saveState();
            }
        }
    });

    ws.on('close', () => { botState.isConnectedToDeriv = false; if (!reconnectTimeout) reconnectTimeout = setTimeout(connectDeriv, 5000); });
}

function executeFlashMirrorFire() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !botState.pendingSignal || botState.isBuying || botState.activeContractId) return;
    
    const isRecovery = botState.recoveryActive;
    
    // El Ghosting depende del modo
    const requiredGhost = isRecovery ? 15 : 2;
    if (botState.ghostStreak < requiredGhost) return;
    
    botState.isBuying = true;

    if (isRecovery) {
        process.nextTick(() => { 
            const dormantDigits = getMostDormantDigits(2);
            const sniperStake = 0.50; // $0.50 cada uno ($1.00 total)
            console.log(`🎯 [SNIPER BURST] Cazando Dígitos Dormidos: ${dormantDigits.join(', ')} | Stake: $${sniperStake} x2`);
            
            dormantDigits.forEach((digit) => {
                ws.send(JSON.stringify({
                    buy: 1, price: sniperStake,
                    parameters: { amount: sniperStake, basis: 'stake', contract_type: 'DIGITMATCH', currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: digit }
                }));
            });
            
            botState.pendingSignal = null;
            botState.lastTradeTime = Date.now();
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
