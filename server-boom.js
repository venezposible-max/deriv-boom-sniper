/**
 * ============================================================
 *  PROYECTO ANTIGRAVEDAD v14.0 - EL EFECTO SOMBRA
 *  Estrategia: Motor Sombra (Evasión de Radar)
 *  Contrato: DIGITDIFF
 *  Lógica: Usa las rachas de 2 como distracción para apostar
 *  contra el dígito más 'invisible' de la mesa.
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
const DERIV_TOKEN_DEMO = process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
const DERIV_TOKEN_REAL = process.env.DERIV_TOKEN_REAL || '';
let currentDerivToken = DERIV_TOKEN_DEMO;
const STATE_FILE = path.join(__dirname, 'persistent-state-institutional.json');
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];
const MOTOR_A_SYMBOLS = ['R_10', 'R_25', 'R_100']; // DIGITDIFF (aleatorios)
const MOTOR_B_SYMBOL = 'R_50';                     // DIGITMATCH (autocorrelado)

let botState = {
    isRunning: false,
    isConnectedToDeriv: false,
    isRealAccount: false,
    balance: 0,
    currency: 'USD',
    dailyProfit: 0,
    dailyLoss: 0,
    totalTradesSession: 0,
    winsSession: 0,
    lossesSession: 0,
    tradeHistory: [],
    stake: 5,
    takeProfit: 10,
    maxDailyLoss: 50,
    activeSymbol: null,
    activeContractId: null,
    activeMotor: null,       // 'A' o 'B'
    lastTradeTime: 0,
    lastTradeTimeB: 0,
    cooldownMs: 5000,
    isBuying: false,
    viewedSymbol: 'R_100',
    markets: {},
    coberturaActiva: false,
    isRecovering: false,
    // ─── MOTOR B (DIGITMATCH R_50) ───
    motorBEnabled: true,
    motorBStake: 1,          // $1 fijo
    motorBWins: 0,
    motorBLosses: 0,
    startTime: null,
    sessionDuration: 0,
    motorBTrades: 0,
    motorBMaxTrades: 5,      // Máx 5 disparos por sesión
    motorBConsecutiveLosses: 0,
    motorBMaxConsecutiveLosses: 3, // Freno: 3 pérdidas seguidas = pausa
    motorBProfit: 0,
    motorBPaused: false,
    // ─── MODO FANTASMA (TRADES GHOST) ───
    ghostMode: false,
    waitingForRealShot: false,
    ghostTarget: null // { symbol, digit }
};

SYMBOLS.forEach(s => {
    botState.markets[s] = { digitHistory: [] };
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

// ─── CONEXIÓN A DERIV ─────────────────────────────────────────
let ws = null;
function connectDeriv() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => { setTimeout(() => ws.send(JSON.stringify({ authorize: currentDerivToken })), 1000); });
    ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.msg_type === 'authorize') {
            botState.isConnectedToDeriv = true;
            if (msg.authorize && msg.authorize.currency) {
                botState.currency = msg.authorize.currency;
            }
            console.log(`🥷 ANTIGRAVEDAD v14.0 | A: SOMBRA (R_10/25/100) | B: MATCH (R_50) | Divisa: ${botState.currency}`);
            SYMBOLS.forEach(s => {
                ws.send(JSON.stringify({ subscribe: 1, ticks: s }));
            });
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const s = msg.tick.symbol;
            const digit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
            
            const m = botState.markets[s];
            m.digitHistory.push(digit);
            m.lastDigit = digit;
            m.lastTickPrice = msg.tick.quote;
            if (m.digitHistory.length > 1000) m.digitHistory.shift(); // 1000 ticks para la Matriz de Markov

            if (botState.isRunning && !botState.activeContractId && !botState.isBuying) {
                // Lógica de validación Ghost (si hay un target pendiente)
                if (botState.ghostMode && botState.ghostTarget && botState.ghostTarget.symbol === s) {
                    if (digit === botState.ghostTarget.digit) {
                        botState.waitingForRealShot = true;
                        console.log(`🎯 [GHOST LOSS DETECTED] Sombra ${digit} golpeada virtualmente. ¡ARMANDO DISPARO REAL!`);
                    } else {
                        // console.log(`👻 [GHOST WIN] Sombra segura. Seguimos acechando...`);
                    }
                    botState.ghostTarget = null; // Limpiar después de 1 tick de validación
                }

                evaluateMotorA();
                evaluateMotorB(s, digit);
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
    ws.on('close', () => { 
        botState.isConnectedToDeriv = false; 
        console.log("⚠️ Conexión WebSocket cerrada. Reconectando en 2s...");
        setTimeout(connectDeriv, 2000); 
    });
}

// ─── MOTOR A: EFECTO SOMBRA (Evasión de Radar) ────────────────
function evaluateMotorA() {
    const now = Date.now();
    if (now - botState.lastTradeTime < botState.cooldownMs) return;

    let targetSymbol = null;
    let shadowDigit = null;

    // Escanear mercados limpios
    for (const s of MOTOR_A_SYMBOLS) {
        const history = botState.markets[s].digitHistory;
        if (history.length < 100) continue; // Necesitamos contexto para la sombra
        
        // 1. EL GATILLO: Una racha de 4 repeticiones (Cisne Negro)
        const last4 = history.slice(-4);
        if (last4.length < 4 || last4[0] !== last4[1] || last4[1] !== last4[2] || last4[2] !== last4[3]) continue; 

        botState.lastTriggerDigit = last4[0];
        const last100 = history.slice(-100);
        const freq = Array(10).fill(0);
        const lastSeen = Array(10).fill(-1);

        // Calcular frecuencias y último visto (0 es el tick actual)
        for (let i = 0; i < 100; i++) {
            const d = last100[i];
            freq[d]++;
            lastSeen[d] = 99 - i; // Distancia desde el presente (menor es más reciente)
        }

        // Criterios de la Sombra perfecta (NUEVO FILTRO DE POLARIDAD):
        // - Debe ser de la polaridad OPUESTA a la racha gatillo
        // - No ha salido en los últimos 5 ticks (invisible)
        // - Salió en los últimos 20 ticks (no es el más frío extremo)
        // - Frecuencia normal (entre 8% y 12%)
        
        const triggerDigit = last3[0];
        const isTriggerHigh = triggerDigit >= 5;

        let bestCandidate = null;
        let bestDistTo10 = 100;

        for (let d = 0; d <= 9; d++) {
            // ESCUDO DE POLARIDAD: Si el gatillo es Alto, la Sombra debe ser Baja (y viceversa)
            const isCandidateHigh = d >= 5;
            if (isTriggerHigh === isCandidateHigh) continue;

            if (lastSeen[d] >= 5 && lastSeen[d] <= 20) {
                if (freq[d] >= 7 && freq[d] <= 13) {
                    const distTo10 = Math.abs(freq[d] - 10);
                    if (distTo10 < bestDistTo10) {
                        bestDistTo10 = distTo10;
                        bestCandidate = d;
                    }
                }
            }
        }

        if (bestCandidate !== null) {
            targetSymbol = s;
            shadowDigit = bestCandidate;
            botState.lastTriggerDigit = triggerDigit; // Guardar para el log
            break; // Sombra encontrada, dejamos de buscar
        }
    }

    if (!targetSymbol || shadowDigit === null) return;

    botState.activeSymbol = targetSymbol;
    botState.activeMotor = 'A';
    botState.isBuying = true;
    botState.lastTradeTime = now;

    let currentStake = botState.stake;

    const tHigh = botState.lastTriggerDigit >= 5;
    
    // FILTRO MODO FANTASMA
    if (botState.ghostMode && !botState.waitingForRealShot) {
        botState.ghostTarget = { symbol: targetSymbol, digit: shadowDigit };
        console.log(`👻 [ACECHO GHOST] ${targetSymbol} | Sombra: ${shadowDigit} (${tHigh?'BAJO':'ALTO'}) | Esperando fallo virtual...`);
        return; 
    }

    // Si llegamos aquí es un DISPARO REAL
    botState.waitingForRealShot = false; // Resetear bandera tras disparar
    console.log(`🥷 [CISNE NEGRO REAL] ${targetSymbol} | Gatillo: ${botState.lastTriggerDigit}x4 (${tHigh?'ALTO':'BAJO'}) | Sombra: NO será ${shadowDigit} (${tHigh?'BAJO':'ALTO'}) | DIFF $${currentStake}`);

    ws.send(JSON.stringify({
        buy: 1, price: currentStake,
        parameters: {
            amount: currentStake, basis: 'stake', contract_type: 'DIGITDIFF',
            currency: botState.currency, symbol: targetSymbol, duration: 1, duration_unit: 't',
            barrier: String(shadowDigit)
        }
    }));
}

// ─── MOTOR B: DIGITMATCH en R_50 (Explotación PRNG) ──────────
function evaluateMotorB(tickSymbol, tickDigit) {
    if (tickSymbol !== MOTOR_B_SYMBOL) return;
    if (!botState.motorBEnabled || botState.motorBPaused) return;
    if (botState.motorBTrades >= botState.motorBMaxTrades) return;

    const now = Date.now();
    if (now - botState.lastTradeTimeB < 8000) return; // cooldown 8s para Motor B
    if (botState.isBuying || botState.activeContractId) return;

    const history = botState.markets[MOTOR_B_SYMBOL].digitHistory;
    if (history.length < 2) return;

    const last2 = history.slice(-2);
    if (last2[0] !== last2[1]) return; // Solo disparar si hay 2 repetidos

    const targetDigit = last2[0];

    botState.activeSymbol = MOTOR_B_SYMBOL;
    botState.activeMotor = 'B';
    botState.isBuying = true;
    botState.lastTradeTimeB = now;
    botState.lastTradeTime = now;

    console.log(`⚡ [MOTOR B] R_50 | Autocorrelación detectada (${targetDigit}×2) | MATCH =$${botState.motorBStake}`);

    ws.send(JSON.stringify({
        buy: 1, price: botState.motorBStake,
        parameters: {
            amount: botState.motorBStake, basis: 'stake', contract_type: 'DIGITMATCH',
            currency: botState.currency, symbol: MOTOR_B_SYMBOL, duration: 1, duration_unit: 't',
            barrier: String(targetDigit)
        }
    }));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    const motor = botState.activeMotor || 'A';
    
    botState.dailyProfit += isWin ? profit : 0;
    botState.dailyLoss += isWin ? 0 : Math.abs(profit);
    botState.totalTradesSession++;

    const barrierMatch = c.shortcode.match(/_(\d)_/);
    const barrierDigit = barrierMatch ? barrierMatch[1] : '?';
    const isMatch = c.shortcode.includes('DIGITMATCH');
    
    if (motor === 'B' || isMatch) {
        // ── MOTOR B RESULT ──
        botState.motorBTrades++;
        botState.motorBProfit += profit;
        if (isWin) {
            botState.motorBWins++;
            botState.motorBConsecutiveLosses = 0;
            botState.winsSession++;
            console.log(`⚡ [MOTOR B WIN] +$${profit.toFixed(2)} 🎯 MATCH! | Balance: $${botState.balance}`);
        } else {
            botState.motorBLosses++;
            botState.motorBConsecutiveLosses++;
            botState.lossesSession++;
            console.log(`⚡ [MOTOR B LOSS] -$${Math.abs(profit).toFixed(2)} | Racha negativa: ${botState.motorBConsecutiveLosses}/3`);
            if (botState.motorBConsecutiveLosses >= botState.motorBMaxConsecutiveLosses) {
                botState.motorBPaused = true;
                console.log(`🛑 [MOTOR B PAUSADO] 3 pérdidas seguidas. Motor B en pausa por seguridad.`);
            }
        }
        botState.tradeHistory.unshift({
            symbol: 'R_50', type: `⚡ MATCH(=${barrierDigit})`, profit,
            result: isWin ? 'WIN ✅' : 'LOSS ❌', time: new Date().toLocaleTimeString()
        });
    } else {
        // ── MOTOR A RESULT ──
        if (isWin) {
            console.log(`🥷 [SOMBRA WIN] +$${profit.toFixed(2)} | Balance: $${botState.balance}`);
            botState.winsSession++;
        } else {
            console.log(`🥷 [SOMBRA LOSS] -$${Math.abs(profit).toFixed(2)} | Sombra detectada por la Matrix.`);
            botState.lossesSession++;
        }
        botState.tradeHistory.unshift({
            symbol: botState.activeSymbol || c.display_symbol,
            type: `🥷 DIFF(≠${barrierDigit})`, profit,
            result: isWin ? 'WIN ✅' : 'LOSS ❌', time: new Date().toLocaleTimeString()
        });
    }
    
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
    botState.activeContractId = null;
    botState.activeMotor = null;

    const net = botState.dailyProfit - botState.dailyLoss;
    if (net >= botState.takeProfit || botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`🏁 META DE SESIÓN ALCANZADA. Bot detenido.`);
    }
    saveState();
}

// ─── API DASHBOARD ────────────────────────────────────────────
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));

app.get('/differs/status', (req, res) => {
    // Para el dashboard visual, mostramos si hay alguna racha formándose
    let activeStreak = 0;
    let streakDigit = '-';
    let streakSymbol = '-';

    SYMBOLS.forEach(s => {
        const h = botState.markets[s].digitHistory;
        if (h.length >= 4) {
            const last4 = h.slice(-4);
            if (last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
                activeStreak = 4;
                streakDigit = last4[0];
                streakSymbol = s;
            } else if (last4[1] === last4[2] && last4[2] === last4[3]) {
                if (activeStreak < 3) {
                    activeStreak = 3;
                    streakDigit = last4[1];
                    streakSymbol = s;
                }
            } else if (last4[2] === last4[3]) {
                if (activeStreak < 2) {
                    activeStreak = 2;
                    streakDigit = last4[2];
                    streakSymbol = s;
                }
            }
        }
    });

    const viewed = botState.viewedSymbol || 'R_100';
    const market = botState.markets[viewed] || { digitHistory: [] };

    const pnlSession = botState.dailyProfit - botState.dailyLoss;
    const winRate = botState.totalTradesSession > 0 
        ? ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1)
        : '0.0';

    // Motor B streak para R_50
    const r50h = botState.markets['R_50'].digitHistory;
    let motorBStreak = 0;
    if (r50h.length >= 2 && r50h[r50h.length-1] === r50h[r50h.length-2]) motorBStreak = 2;
    if (r50h.length >= 3 && motorBStreak === 2 && r50h[r50h.length-3] === r50h[r50h.length-1]) motorBStreak = 3;

    res.json({ 
        success: true, 
        data: { 
            ...botState, 
            symbol: viewed,
            lastDigit: market.lastDigit,
            lastTickPrice: market.lastTickPrice,
            digitHistory: market.digitHistory.slice(-20),
            shannonEntropy: `Cisne: ${activeStreak}/4`,
            markovEdge: streakDigit,
            streakSymbol: streakSymbol,
            currentBarrier: streakDigit,
            activeStreak: activeStreak,
            isRunning: botState.isRunning,
            isFetching: botState.isBuying,
            activeContractId: botState.activeContractId,
            coberturaActiva: botState.coberturaActiva,
            isRecovering: botState.isRecovering,
            pnlSession: pnlSession,
            winRate: winRate,
            // Motor B data
            motorBEnabled: botState.motorBEnabled,
            motorBWins: botState.motorBWins,
            motorBLosses: botState.motorBLosses,
            motorBTrades: botState.motorBTrades,
            motorBMaxTrades: botState.motorBMaxTrades,
            motorBProfit: botState.motorBProfit,
            motorBPaused: botState.motorBPaused,
            motorBStake: botState.motorBStake,
            motorBStreak: motorBStreak,
            motorBConsecutiveLosses: botState.motorBConsecutiveLosses,
            startTime: botState.startTime,
            sessionDuration: botState.sessionDuration || 0,
            ghostMode: botState.ghostMode,
            waitingForRealShot: botState.waitingForRealShot
        } 
    });
});

app.post('/differs/control', (req, res) => {
    const { action, stake, takeProfit, maxDailyLoss, symbol } = req.body;
    if (action === 'TOGGLE_COBERTURA') {
        botState.coberturaActiva = !botState.coberturaActiva;
        if (!botState.coberturaActiva) botState.isRecovering = false;
        console.log(`🛡️ COBERTURA: ${botState.coberturaActiva ? 'ACTIVADA' : 'DESACTIVADA'}`);
        return res.json({ success: true, coberturaActiva: botState.coberturaActiva });
    }
    if (action === 'TOGGLE_MOTOR_B') {
        botState.motorBEnabled = !botState.motorBEnabled;
        if (!botState.motorBEnabled) botState.motorBPaused = false;
        console.log(`⚡ MOTOR B: ${botState.motorBEnabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
        return res.json({ success: true, motorBEnabled: botState.motorBEnabled });
    }
    if (action === 'TOGGLE_GHOST_MODE') {
        botState.ghostMode = !botState.ghostMode;
        if (!botState.ghostMode) {
            botState.waitingForRealShot = false;
            botState.ghostTarget = null;
        }
        console.log(`👻 MODO FANTASMA: ${botState.ghostMode ? 'ACTIVADO' : 'DESACTIVADO'}`);
        return res.json({ success: true, ghostMode: botState.ghostMode });
    }
    if (action === 'RESET_MOTOR_B') {
        botState.motorBPaused = false;
        botState.motorBConsecutiveLosses = 0;
        botState.motorBTrades = 0;
        console.log(`🔄 Motor B reseteado.`);
        return res.json({ success: true });
    }

    if (action === 'START' || action === 'SYNC') {
        if (stake) botState.stake = parseFloat(stake);
        if (takeProfit) botState.takeProfit = parseFloat(takeProfit);
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (symbol) botState.viewedSymbol = symbol;
        
        if (action === 'START') {
            botState.isRunning = true;
            botState.startTime = Date.now();
            botState.motorBPaused = false;
            botState.motorBConsecutiveLosses = 0;
            botState.motorBTrades = 0;
            console.log(`🚀 BOT INICIADO | A: DIFF (Sombra 🥷) | B: MATCH (Autocorrelación ⚡)`);
        }
    } else if (action === 'STOP') {
        botState.isRunning = false;
        if (botState.startTime) {
            botState.sessionDuration = (botState.sessionDuration || 0) + (Date.now() - botState.startTime);
            botState.startTime = null;
        }
        console.log(`⏸️ BOT PAUSADO.`);
    } else if (action === 'RESET_DAY') { 
        botState.dailyProfit = 0; botState.dailyLoss = 0;
        botState.totalTradesSession = 0; botState.winsSession = 0; botState.lossesSession = 0;
        botState.tradeHistory = [];
        botState.motorBWins = 0; botState.motorBLosses = 0; botState.motorBTrades = 0;
        botState.motorBProfit = 0; botState.motorBPaused = false; botState.motorBConsecutiveLosses = 0;
        console.log(`🔄 Historial limpiado.`);
    }
    saveState(); res.json({ success: true });
});

app.post('/differs/switch-account', (req, res) => {
    const { isReal } = req.body;
    if (botState.isRunning) {
        return res.status(400).json({ error: "Detén el bot primero" });
    }
    
    botState.isRealAccount = isReal;
    if (isReal && DERIV_TOKEN_REAL) {
        currentDerivToken = DERIV_TOKEN_REAL;
        console.log("🔄 Cambiando a cuenta REAL USD");
    } else {
        currentDerivToken = DERIV_TOKEN_DEMO;
        console.log("🔄 Cambiando a cuenta DEMO VIRTUAL");
    }
    
    // Forzar reconexión para usar el nuevo token
    if (ws) ws.close();
    
    res.json({ success: true, isReal: botState.isRealAccount });
});

app.listen(process.env.PORT || 8080, '0.0.0.0', () => connectDeriv());
