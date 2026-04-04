/**
 * ============================================================
 *  DIFFERS SNIPER ENGINE v18.1 [CLEAN & STABLE]
 *  Estrategia: DIFFERS — El último dígito NO será X
 *  Símbolo: R_100 (Sincronía Atómica por cadencia)
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CONFIGURACIÓN CENTRAL ───────────────────────────────────
const APP_ID = process.env.DERIV_APP_ID || '36544';
const DERIV_TOKEN_DEMO = process.env.DERIV_TOKEN_DEMO || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-differs.json');
let SYMBOL = 'R_100';

// ─── ESTADO GLOBAL ────────────────────────────────────────────
let botState = {
    isRunning: true,                  // [v18.2] Auto-Start activado para producción
    isConnectedToDeriv: false,
    isRealAccount: false,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    lastDigit: null,
    digitHistory: [],
    digitFrequency: {},
    currentBarrier: null,
    stake: 10.00,
    maxDailyLoss: 20,
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
    strategyName: 'ESPERANDO...',
    isRecoveryEnabled: false,
    recoveryActive: false,
    recoveryStep: 0,
    lastLosingDigit: null,
    secondaryTarget: null,
    rsiValues: [],
    emaValues: [],
    lastRSI: 50,
    lastEMA: 0,
    emaPeriod: 5,
    straddleUpId: null,
    straddleDownId: null,
    straddleOpenTime: 0,
    straddleTP: 12.00,
    straddleMaxLoss: 3.00,
    straddleTimeoutMs: 240000,
    scanSymbols: ['R_10', 'R_25', 'R_50', 'R_100'],
    currentSymbolIndex: 3,
};

// ─── CARGAR ESTADO ───
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        botState = { ...botState, ...saved.botState, isBuying: false, isAuthing: false };
        // Si el usuario lo paró manualmente, respetamos el estado; si no, auto-start.
        if (saved.botState.isRunning === undefined) botState.isRunning = true;
    } catch (e) {}
}

const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ botState })); } catch (e) {} };

function chooseBestBarrier() {
    const hist = botState.digitHistory;
    if (hist.length < 15) {
        botState.currentBarrier = '5';
        return '5';
    }
    const lastDigit = hist[hist.length - 1];
    let bestDigit = lastDigit;
    let maxFreq = 0;
    for (let d = 0; d <= 9; d++) {
        const freq = botState.digitTransitions[`${lastDigit}->${d}`] || 0;
        if (freq > maxFreq) { maxFreq = freq; bestDigit = d; }
    }
    const last10 = hist.slice(-10);
    const count = last10.filter(d => d === parseInt(bestDigit)).length;
    if (count >= 4) {
        const freq = {};
        hist.slice(-100).forEach(d => freq[d] = (freq[d] || 0) + 1);
        bestDigit = Object.keys(freq).sort((a,b) => freq[a] - freq[b])[0];
    }
    botState.currentBarrier = String(bestDigit);
    return String(bestDigit);
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
        console.log(`▶️ SNIPER v18.1 INICIADO`);
        return res.json({ success: true, isRunning: true });
    }
    if (action === 'STOP') { botState.isRunning = false; return res.json({ success: true, isRunning: false }); }
    if (action === 'RESET_DAY') { botState.dailyLoss = 0; botState.dailyProfit = 0; botState.tradeHistory = []; return res.json({ success: true }); }
    res.status(400).json({ success: false });
});

// ─── CONEXIÓN A DERIV ───
let ws = null;
let reconnectTimeout = null;

function connectDeriv() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log(`🔌 Conexión abierta. Autenticando en 3s...`);
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN && !botState.isAuthing) {
                const token = (botState.isRealAccount ? process.env.DERIV_TOKEN_REAL : process.env.DERIV_TOKEN_DEMO) || DERIV_TOKEN_DEMO;
                botState.isAuthing = true;
                ws.send(JSON.stringify({ authorize: token.trim() }));
            }
        }, 3000);
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        if (msg.msg_type === 'authorize' && msg.authorize) {
             botState.isAuthing = false;
             botState.isConnectedToDeriv = true;
             botState.currency = msg.authorize.currency || 'USD';
             console.log(`✅ Autenticado: ${msg.authorize.fullname}`);
             ws.send(JSON.stringify({ forget_all: "ticks" }));

             // [v18.7] Sincronía Inicial de Ping
             botState.lastPingSentAt = Date.now();
             ws.send(JSON.stringify({ ping: 1 }));

             setTimeout(() => {
                 if (ws && ws.readyState === WebSocket.OPEN) {
                     console.log(`📡 Suscribiendo a Ticks y Balance en ${SYMBOL}...`);
                     ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
                     ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                     console.log(`🎯 SNIPER v18.2 ACTIVADO | Analizando RSI y cadencia de red...`);
                 }
             }, 3000);
        }

        if (msg.error) {
            console.error(`⚠️ Error [${msg.error.code}]: ${msg.error.message}`);
            if (msg.msg_type === 'authorize') {
                botState.isAuthing = false;
                if (msg.error.code === 'PolicyViolation' || msg.error.code === 'WrongResponse') { ws.terminate(); }
            }
            return;
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
            botState.lastTickPrice = tickPrice; // [v18.4] Para que se vea el precio en el panel
            if (botState.lastDigit !== null) { botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] = (botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] || 0) + 1; }
            botState.lastDigit = tickDigit;
            botState.digitHistory.push(tickDigit);
            if (botState.digitHistory.length > 100) botState.digitHistory.shift();

            // Actualizar Frecuencia
            const freq = {};
            botState.digitHistory.forEach(d => freq[d] = (freq[d] || 0) + 1);
            botState.digitFrequency = freq;
            
            // RSI/EMA
            const prices = botState.rsiValues;
            prices.push(tickPrice);
            if (prices.length > 6) prices.shift();
            if (!botState.emaInitialized) { botState.lastEMA = tickPrice; botState.emaInitialized = true; }
            else { botState.lastEMA = (tickPrice * 0.33) + (botState.lastEMA * 0.67); }
            if (prices.length >= 6) {
                let g = 0, l = 0;
                for (let i = 1; i < 6; i++) {
                    const d = prices[i] - prices[i-1];
                    if (d>=0) g+=d; else l-=d;
                }
                botState.lastRSI = 100 - (100 / (1 + (g/(l||0.0001))));
            }

            if (botState.isRunning && !botState.isBuying && !botState.activeContractId) {
                if ((botState.lastRSI > 70 && tickPrice > botState.lastEMA) || (botState.lastRSI < 30 && tickPrice < botState.lastEMA)) {
                    botState.pendingSignal = { type: 'DIFFERS' };
                }
            }
        }

        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
        
        // [v18.7] Procesar Ping de Latencia Real
        if (msg.msg_type === 'ping') {
            botState.currentPing = Date.now() - botState.lastPingSentAt;
            if (botState.currentPing < 5) botState.currentPing = 50; // Fallback
        }

        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            console.log(`🎯 CONTRATO ABIERTO: ${msg.buy.contract_id}`);
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            botState.isBuying = false;
            botState.lastTradeTime = Date.now();
        }
        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
            const c = msg.proposal_open_contract;
            if (c.is_sold) {
                const profit = parseFloat(c.profit);
                botState.pnlSession += profit;
                if (profit > 0) { 
                    botState.winsSession++; botState.dailyProfit += profit; 
                } else { 
                    botState.lossesSession++; botState.dailyLoss += Math.abs(profit); 
                    // [v18.6] Activar Rescate Matemático x11
                    botState.recoveryActive = true;
                    console.log(`🛡️ RESCATE MATEMÁTICO: Siguiente disparo será x11 ($${(botState.stake * 11).toFixed(2)})`);
                }
                botState.totalTradesSession++;
                botState.activeContractId = null;
                
                // Si ganamos un rescate, volvemos al stake base de inmediato
                if (botState.recoveryActive && profit > 0) {
                    console.log(`✅ RESCATE COMPLETADO: Volviendo a Stake Base ($${botState.stake})`);
                    botState.recoveryActive = false;
                }

                botState.tradeHistory.unshift({
                    type: 'DIFFERS', profit, time: new Date().toLocaleTimeString(), 
                    barrier: botState.currentBarrier, 
                    result: profit > 0 ? 'WIN ✅' : 'LOSS ❌', 
                    lastDigit: botState.lastDigit 
                });
                if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();

                saveState();
                console.log(`💰 RESULTADO: ${profit > 0 ? 'WIN' : 'LOSS'} ($${profit})`);
            }
        }
    });

    ws.on('close', (code) => {
        const wait = (code === 1008) ? 60000 : 5000;
        console.log(`🔌 Conexión cerrada (${code}). Reconectando en ${wait/1000}s...`);
        botState.isConnectedToDeriv = false;
        botState.isBuying = false;
        if (!reconnectTimeout) reconnectTimeout = setTimeout(connectDeriv, wait);
    });
}

function executeFlashMirrorFire() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !botState.pendingSignal || botState.isBuying) return;
    const now = Date.now();
    if (now - botState.lastTradeTime < botState.cooldownMs) return;
    const barrier = chooseBestBarrier();
    botState.currentBarrier = barrier;
    botState.isBuying = true;

    // [v18.6] Calculo de Stake con Martingala Matemático x11
    let finalStake = botState.stake;
    if (botState.recoveryActive) finalStake = botState.stake * 11;

    console.log(`🚀 LANZANDO DISPARO | Stake: $${finalStake.toFixed(2)} | Barrera: NO-${barrier}`);

    ws.send(JSON.stringify({ 
        buy: 1, 
        price: finalStake, 
        parameters: { 
            amount: finalStake, 
            basis: 'stake', 
            contract_type: 'DIGITDIFF', 
            currency: botState.currency, 
            symbol: SYMBOL, 
            duration: 1, 
            duration_unit: 't', 
            barrier: barrier 
        } 
    }));
    botState.pendingSignal = null;
}

setInterval(() => {
    if (!botState.isRunning || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();

    // [v18.7] Sonda de Ping cada 10s
    if (now % 10000 < 50) {
        botState.lastPingSentAt = now;
        ws.send(JSON.stringify({ ping: 1 }));
    }

    const timeSinceLast = now - botState.lastTickReceivedAt;
    const nextExpected = botState.avgTickInterval;
    
    // [v18.7] DISPARO DINÁMICO: Solape ajustado al PING REAL (+25ms de gracia)
    const dynamicLead = Math.min(400, botState.currentPing + 25);
    
    // Bloqueo por inestabilidad de red (>300ms de lag)
    if (botState.currentPing > 300) return;

    if (timeSinceLast >= (nextExpected - dynamicLead)) {
        executeFlashMirrorFire();
    }
}, 50);

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 v18.1 ONLINE EN PUERTO ${PORT}`);
    connectDeriv();
});

process.on('uncaughtException', (e) => console.error('🔥 CRASH:', e.message));
