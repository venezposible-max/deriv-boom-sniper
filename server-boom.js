/**
 * ============================================================
 *  DIFFERS SNIPER ENGINE v20.10 [SMART-RABBIT]
 *  Estrategia: DIFFERS ($1) + ADAPTIVE RABBIT RECOVERY ($10)
 *  Símbolo: R_100 (Recuperación Inteligente v20.10)
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
    maxDailyLoss: 20.00,
    takeProfit: 10.00,
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
    // Si no tenemos suficientes datos, rotar entre números seguros para no quedarse pegado
    if (hist.length < 25) {
        const fallbacks = ['5', '8', '2', '4', '7'];
        return fallbacks[hist.length % fallbacks.length];
    }
    
    let digitScores = Array(10).fill(0);
    const freqLast = {};
    hist.slice(-40).forEach(d => freqLast[d] = (freqLast[d] || 0) + 1);
    for (let d = 0; d <= 9; d++) digitScores[d] += (freqLast[d] || 0) * 10;
    
    // Transiciones: Castigamos dígitos que suelen seguir al actual
    const lastD = hist[hist.length - 1];
    for (let d = 0; d <= 9; d++) {
        const t = botState.digitTransitions[`${lastD}->${d}`] || 0;
        digitScores[d] += t * 15; // Más peso a la transición
    }

    // Fibo
    FIBO_SECUENCE.forEach((steps) => {
        const index = hist.length - 1 - steps;
        if (index >= 0) digitScores[hist[index]] += 30;
    });

    let bestDigit = '5';
    let minScore = 99999;
    for (let d = 0; d <= 9; d++) {
        // Añadimos un pequeño factor aleatorio si los puntajes son iguales para evitar estancamiento
        const noise = Math.random() * 2; 
        if ((digitScores[d] + noise) < minScore) { 
            minScore = digitScores[d] + noise; 
            bestDigit = String(d); 
        }
    }
    botState.currentBarrier = bestDigit;
    return bestDigit;
}

// [v20.10] Analiza si es más seguro usar Under-9 (Excluye 9) o Over-0 (Excluye 0)
function getOptimalRabbitHole() {
    const hist = botState.digitHistory;
    const lastSeen0 = hist.lastIndexOf(0) === -1 ? 999 : (hist.length - 1 - hist.lastIndexOf(0));
    const lastSeen9 = hist.lastIndexOf(9) === -1 ? 999 : (hist.length - 1 - hist.lastIndexOf(9));
    
    const freq0 = hist.slice(-30).filter(d => d === 0).length;
    const freq9 = hist.slice(-30).filter(d => d === 9).length;

    // Priorizamos el que tenga MENOS frecuencia y MÁS tiempo sin salir (Dormancia)
    if (lastSeen9 > lastSeen0 && freq9 <= freq0) {
        return { type: 'DIGITUNDER', barrier: '9', label: 'UNDER-9 (0-8)' };
    } else {
        return { type: 'DIGITOVER', barrier: '0', label: 'OVER-0 (1-9)' };
    }
}

// ─── SERVIDOR WEB ───
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/differs/status', (req, res) => res.json({ success: true, data: botState }));

app.post('/api/config', (req, res) => {
    const { stake, takeProfit, maxDailyLoss } = req.body;
    if (stake) botState.stake = parseFloat(stake);
    if (takeProfit) botState.takeProfit = parseFloat(takeProfit);
    if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
    
    console.log(`⚙️ [CONFIG UPDATE] New Meta: $${botState.takeProfit} | New SL: $${botState.maxDailyLoss} | New Stake: $${botState.stake}`);
    saveState();
    res.json({ success: true, config: { stake: botState.stake, takeProfit: botState.takeProfit, maxDailyLoss: botState.maxDailyLoss } });
});

app.post('/differs/control', (req, res) => {
    const { action, stake } = req.body;
    if (action === 'START') {
        if (stake) botState.stake = parseFloat(stake);
        botState.isRunning = true;
        console.log(`▶️ SNIPER v20.10 INICIADO [SMART-RABBIT]`);
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
    if (ws) ws.terminate();
    ws = new WebSocket(process.env.DERIV_WS_URL || `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        // [SECURITY SWAP] PRIORIDAD CUENTA VIRTUAL PARA PRUEBAS
        const token = process.env.DERIV_TOKEN_DEMO || process.env.DERIV_TOKEN_REAL || DERIV_TOKEN_DEMO;
        ws.send(JSON.stringify({ authorize: token }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.msg_type === 'authorize') {
             botState.isConnectedToDeriv = true;
             // [SAFE READ] Evitamos el crash si authorize viene incompleto
             if (msg.authorize) {
                 botState.currency = msg.authorize.currency || 'USD';
                 console.log(`✅ AUTH SUCCESS: ${msg.authorize.loginid} [Currency: ${botState.currency}]`);
             } else {
                 botState.currency = 'USD';
                 console.log(`✅ AUTH SUCCESS (Partial)`);
             }
             
             botState.activeContractId = null;
             botState.secondaryContractId = null;
             botState.isBuying = false;
             botState.waitingForRecovery = false;
             botState.pendingSignal = null;
             
             ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
             ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            // [STEALTH MODE] Solo procesamos ticks si el bot está encendido
            if (!botState.isRunning) return; 

            botState.lastTickPrice = msg.tick.quote;
            const tickDigit = parseInt(parseFloat(botState.lastTickPrice).toFixed(2).slice(-1));
            const now = Date.now();
            botState.lastTickReceivedAt = now;
            
            if (botState.nextBarrier !== null) {
                if (Number(tickDigit) !== Number(botState.nextBarrier)) {
                    botState.ghostStreak++;
                } else {
                    botState.ghostStreak = 0;
                    console.log(`🎯 [STREAK RESET] Predicción cumplida con el dígito: ${tickDigit}`);
                }
            } else {
                botState.nextBarrier = chooseBestBarrier();
            }
            
            const netProfit = botState.dailyProfit - botState.dailyLoss;
            const progress = botState.takeProfit > 0 ? ((netProfit / botState.takeProfit) * 100).toFixed(1) : 0;
            console.log(`📡 [TICK R_100] Digit: ${tickDigit} | Streak: ${botState.ghostStreak} | 📊 Goal: $${netProfit.toFixed(2)} / $${botState.takeProfit} (${progress}%)`);

            botState.nextBarrier = chooseBestBarrier();
            if (botState.lastDigit !== null) { 
                botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] = (botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] || 0) + 1; 
            }
            botState.lastDigit = tickDigit;
            botState.digitHistory.push(tickDigit);
            if (botState.digitHistory.length > 100) botState.digitHistory.shift();

            if (botState.isRunning && !botState.isBuying && !botState.activeContractId && !botState.secondaryContractId) {
                botState.pendingSignal = { type: 'RABBIT' };
                executeFlashMirrorFire();
            }
        }

        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;

        if (msg.msg_type === 'buy') {
            if (msg.buy) {
                console.log(`🛒 [ORDER SENT] Contract ID: ${msg.buy.contract_id}`);
                if (msg.echo_req.parameters.contract_type === 'DIGITDIFF') {
                    botState.activeContractId = msg.buy.contract_id;
                } else {
                    botState.secondaryContractId = msg.buy.contract_id;
                }
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            }
            botState.isBuying = false; 
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
            const c = msg.proposal_open_contract;
            if (c.status === 'won' || c.status === 'lost') {
                const profit = parseFloat(c.profit);
                const isDiffer = c.contract_type === 'DIGITDIFF';
                const exitDigit = c.exit_tick_display_value ? String(parseFloat(c.exit_tick_display_value).toFixed(2)).slice(-1) : '?';

                let displayBarrier = '';
                if (isDiffer) {
                    displayBarrier = `NO [${c.barrier}] | SALIÓ [${exitDigit}]`;
                } else {
                    displayBarrier = `${c.contract_type === 'DIGITUNDER' ? 'BAJO' : 'SOBRE'} [${c.barrier}] | SALIÓ [${exitDigit}]`;
                }

                botState.tradeHistory.unshift({
                    type: isDiffer ? 'DIFFERS' : 'RECOVERY', 
                    profit: parseFloat(profit.toFixed(2)), 
                    time: new Date().toLocaleTimeString(),
                    barrier: displayBarrier,
                    result: profit > 0 ? 'WIN' : 'LOSS'
                });
                if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();

                if (profit > 0) {
                    botState.winsSession++;
                    botState.dailyProfit += profit;
                    botState.recoveryActive = false;
                } else {
                    botState.lossesSession++;
                    botState.dailyLoss += Math.abs(profit);
                    if (botState.isRecoveryEnabled) botState.recoveryActive = true;
                }
                botState.activeContractId = null;
                botState.secondaryContractId = null;
                botState.ghostStreak = 0;
                botState.isBuying = false;
                
                // [FRANKLIN REAL-TIME GUARDIAN] Verificación inmediata al cerrar contrato
                const netProfit = botState.dailyProfit - botState.dailyLoss;
                const hasReachedTP = botState.takeProfit > 0 && netProfit >= botState.takeProfit;
                const hasReachedSL = botState.maxDailyLoss > 0 && botState.dailyLoss >= botState.maxDailyLoss;

                if (hasReachedTP || hasReachedSL) {
                    botState.isRunning = false; 
                    console.log(`🛑 [REAL-TIME STOP] Meta alcanzada al cerrar contrato. Net: ${netProfit.toFixed(2)} / Loss: ${botState.dailyLoss.toFixed(2)}`);
                }

                saveState();
            }
        }
    });

    ws.on('close', () => { botState.isConnectedToDeriv = false; if (!reconnectTimeout) reconnectTimeout = setTimeout(connectDeriv, 5000); });
}

function executeFlashMirrorFire() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !botState.pendingSignal) return;
    
    const isRecovery = botState.recoveryActive;
    if (isRecovery && botState.waitingForRecovery) return;

    const requiredGhost = isRecovery ? 12 : 2;
    if (botState.ghostStreak < requiredGhost) return;
    
    botState.isBuying = true;
    botState.lastTradeTime = Date.now();
    const curr = botState.currency || 'USD'; // Usamos la moneda detectada

    if (isRecovery) {
        botState.waitingForRecovery = true; 
        const hole = getOptimalRabbitHole();
        const rabbitStake = 10.00; 
        
        ws.send(JSON.stringify({
            buy: 1, price: rabbitStake,
            parameters: { amount: rabbitStake, basis: 'stake', contract_type: hole.type, currency: curr, symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: hole.barrier }
        }));
        botState.pendingSignal = null;
    } else {
        const barrier = botState.nextBarrier;
        
        if (String(barrier) === String(botState.lastBarrierUsed)) {
            botState.consecutiveBarrierCount++;
        } else {
            botState.lastBarrierUsed = String(barrier);
            botState.consecutiveBarrierCount = 1;
        }

        ws.send(JSON.stringify({
            buy: 1, price: botState.stake,
            parameters: { amount: botState.stake, basis: 'stake', contract_type: 'DIGITDIFF', currency: curr, symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: barrier }
        }));
        botState.pendingSignal = null;
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 v20.27 ONLINE [SMART-RABBIT]`); connectDeriv(); });
