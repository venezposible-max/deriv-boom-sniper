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
    takeProfit: 1.00, // [DEFAULT TO USER PREFERENCE]
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
    nextBarrier: null,
    sessionDuration: null,
    priceHistory: [],
    lastRSI: 50.0,
    lastEMA: 0.0,
    anomalyCooldown: 0
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

// [ANOMALY SNIPER CORE] Busca cúmulos estadísticos irracionales (El Disparo Perfecto)
function chooseBestBarrier() {
    if (botState.anomalyCooldown > 0) return null; // Ignoramos el mercado mientras se enfría el arma

    const windowSize = 6;
    if (botState.digitHistory.length < windowSize || botState.priceHistory.length < windowSize) return null;

    const recentDigits = botState.digitHistory.slice(-windowSize);
    const recentPrices = botState.priceHistory.slice(-windowSize);

    // Buscar si algún dígito aparece >= 4 veces en la ventana ultra-corta
    const counts = {};
    let anomalyDigit = null;
    let maxCount = 0;
    
    for (const num of recentDigits) {
        counts[num] = (counts[num] || 0) + 1;
        if (counts[num] > maxCount) {
            maxCount = counts[num];
            if (maxCount >= 4) {
                anomalyDigit = num.toString();
            }
        }
    }

    // No hay anomalía real, seguimos acechando en silencio
    if (!anomalyDigit) return null; 

    // Filtro Físico de Movimiento Real (Verificar que el precio no esté atascado)
    const maxPrice = Math.max(...recentPrices);
    const minPrice = Math.min(...recentPrices);
    const movement = maxPrice - minPrice;
    
    // Si el precio apenas se movió (ej. 0.1 o 0.0), es un estancamiento, no una anomalía del RNG
    if (movement < 0.2) return null; 

    // Aquí hemos encontrado el Disparo Perfecto
    if (botState.currentBarrier !== anomalyDigit) {
        console.log(`🎯 [ANOMALY SNIPER] Cúmulo del dígito [${anomalyDigit}] detectado (${maxCount} apariciones). Fluctuación precio: ${movement.toFixed(2)}. BLOQUEADO.`);
        botState.currentBarrier = anomalyDigit;
    }
    
    return anomalyDigit;
}



// ─── INDICADORES TÉCNICOS (TICK-BY-TICK) ───
function updateIndicators(price) {
    botState.priceHistory.push(price);
    if (botState.priceHistory.length > 50) botState.priceHistory.shift();

    const prices = botState.priceHistory;

    // EMA-5
    if (prices.length > 0) {
        const period = Math.min(5, prices.length);
        const k = 2 / (period + 1);
        let ema = prices[0];
        for (let i = 1; i < prices.length; i++) {
            ema = (prices[i] * k) + (ema * (1 - k));
        }
        botState.lastEMA = ema;
    }

    // RSI-5 Simple
    if (prices.length > 5) {
        const period = 5;
        let gains = 0, losses = 0;
        for (let i = prices.length - period; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        if (losses === 0) {
            botState.lastRSI = gains === 0 ? 50.0 : 100.0;
        } else {
            const rs = (gains / period) / (losses / period);
            botState.lastRSI = 100 - (100 / (1 + rs));
        }
    }
}

// ─── SERVIDOR WEB ───
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/differs/status', (req, res) => {
    const total = botState.winsSession + botState.lossesSession;
    const winRate = total > 0 ? ((botState.winsSession / total) * 100).toFixed(1) : '0.0';
    const pnlSession = botState.dailyProfit - botState.dailyLoss;
    res.json({ success: true, data: { ...botState, winRate, pnlSession, totalTradesSession: total, symbol: SYMBOL } });
});

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
    const { action, stake, takeProfit, maxDailyLoss, isRecoveryEnabled } = req.body;
    
    // Actualización inmediata de parámetros si vienen en el comando
    if (stake) botState.stake = parseFloat(stake);
    if (takeProfit) botState.takeProfit = parseFloat(takeProfit);
    if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
    if (isRecoveryEnabled !== undefined) botState.isRecoveryEnabled = !!isRecoveryEnabled;

    if (action === 'START') {
        botState.isRunning = true;
        botState.sessionDuration = null; // Resetear duración guardada
        if (!botState.startTime) botState.startTime = Date.now(); // [RELOJ] Empieza el cronómetro
        botState.stake = parseFloat(req.body.stake) || 1;
        botState.takeProfit = parseFloat(req.body.takeProfit) || 10;
        console.log(`▶️ SNIPER INICIADO [Meta: $${botState.takeProfit} | Stake: $${botState.stake}]`);
        saveState();
        res.json({ success: true, action: 'STARTED', startTime: botState.startTime });
    } else if (action === 'STOP') {
        botState.isRunning = false;
        if (botState.startTime) botState.sessionDuration = Math.floor((Date.now() - botState.startTime) / 1000);
        // Mantenemos el startTime por si solo pausó, o lo reseteamos si queremos borrón y cuenta nueva
        console.log(`⏸️ SNIPER DETENIDO POR USUARIO | Duración: ${botState.sessionDuration}s`);
        saveState();
        res.json({ success: true, action: 'STOPPED' });
    } else if (action === 'RESET' || action === 'RESET_DAY') {
        botState.dailyProfit = 0;
        botState.dailyLoss = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.totalTradesSession = 0;
        botState.pnlSession = 0;
        botState.tradeHistory = [];
        botState.ghostStreak = 0;
        botState.digitHistory = [];
        botState.digitFrequency = {};
        botState.digitTransitions = {};
        botState.recoveryActive = false;
        botState.waitingForRecovery = false;
        botState.startTime = null;
        botState.sessionDuration = null;
        botState.results = [];
        console.log(`🧹 [RESET COMPLETO] Estadísticas, historial, dígitos y recuperación LIMPIADOS`);
        saveState();
        res.json({ success: true });
    } else {
        res.json({ success: true });
    }
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
        console.log("🚀 v20.51 ONLINE [RESCUE-SPECIALIST]");
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

            // Identificador visual de estado
            const statusLabel = (botState.isRecoveryEnabled && botState.recoveryActive) ? "🛡️ [RESCATE]" : "";

            // [ANTI-LOCK] Si el bot cree que está comprando pero han pasado 5 seg, reseteamos
            if (botState.isBuying && (Date.now() - botState.lastTradeTime > 5000)) {
                console.log("🛠️ [AUTO-FIX] Limpiando gatillo...");
                botState.isBuying = false;
                botState.activeContractId = null;
                botState.secondaryContractId = null;
            }

            botState.lastTickPrice = msg.tick.quote;
            updateIndicators(parseFloat(botState.lastTickPrice));
            const tickDigit = parseInt(parseFloat(botState.lastTickPrice).toFixed(2).slice(-1));
            const now = Date.now();
            botState.lastTickReceivedAt = now;
            
            // Reducir enfriamiento del arma si lo hay
            if (botState.anomalyCooldown > 0) botState.anomalyCooldown--;
            
            const netProfit = botState.dailyProfit - botState.dailyLoss;
            const progressRatio = botState.takeProfit > 0 ? ((netProfit / botState.takeProfit) * 100).toFixed(1) : 0;
            
            console.log(`📡 [TICK ${SYMBOL}] Digit: ${tickDigit} | Streak: ${botState.ghostStreak} | 📊 Goal: $${netProfit.toFixed(2)} / $${botState.takeProfit} (${progressRatio}%) ${statusLabel}`);

            // Recalcular barrera si no existe
            if (botState.nextBarrier === null) {
                botState.nextBarrier = chooseBestBarrier();
            }
            
            if (Number(tickDigit) !== Number(botState.nextBarrier)) {
                botState.ghostStreak++;
            } else {
                botState.ghostStreak = 0;
                // [ADAPTATIVO] Cuando la predicción se cumple, recalcular barrera
                botState.nextBarrier = chooseBestBarrier();
                console.log(`🎯 [STREAK RESET] Dígito ${tickDigit} coincidió → Nueva barrera: NO-${botState.nextBarrier}`);
            }
            if (botState.lastDigit !== null) { 
                botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] = (botState.digitTransitions[`${botState.lastDigit}->${tickDigit}`] || 0) + 1; 
            }
            botState.lastDigit = tickDigit;
            botState.digitHistory.push(tickDigit);
            if (botState.digitHistory.length > 100) botState.digitHistory.shift();

            if (botState.isRunning) {
                const isRecovery = botState.isRecoveryEnabled && botState.recoveryActive;
                
                // [GATILLO DE FUERZA] Si estamos en rescate, forzamos la señal
                if (isRecovery && !botState.waitingForRecovery) {
                    if (botState.isBuying || botState.activeContractId) {
                        console.log("🔥 [FORCE-UNLOCK] Liberando paso para operación de rescate...");
                        botState.isBuying = false;
                        botState.activeContractId = null;
                        botState.secondaryContractId = null;
                    }
                    botState.pendingSignal = { type: 'RABBIT' };
                    executeFlashMirrorFire();
                } else if (!botState.isBuying && !botState.activeContractId && !botState.secondaryContractId) {
                    botState.pendingSignal = { type: 'RABBIT' };
                    executeFlashMirrorFire();
                }
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
                
                // [ADAPTATIVO] Recalcular barrera después de cada trade
                botState.nextBarrier = chooseBestBarrier();
                console.log(`🔄 [POST-TRADE] Nueva barrera calculada: NO-${botState.nextBarrier}`);
                
                // [FRANKLIN REAL-TIME GUARDIAN] Verificación inmediata al cerrar contrato
                const netProfit = botState.dailyProfit - botState.dailyLoss;
                const hasReachedTP = botState.takeProfit > 0 && netProfit >= botState.takeProfit;
                const hasReachedSL = botState.maxDailyLoss > 0 && botState.dailyLoss >= botState.maxDailyLoss;

                if (hasReachedTP || hasReachedSL) {
                    botState.isRunning = false; 
                    if (botState.startTime) botState.sessionDuration = Math.floor((Date.now() - botState.startTime) / 1000);
                    console.log(`🛑 [REAL-TIME STOP] Meta alcanzada al cerrar contrato. Net: ${netProfit.toFixed(2)} / Loss: ${botState.dailyLoss.toFixed(2)} | Duración: ${botState.sessionDuration}s`);
                }

                saveState();
            }
        }
    });

    ws.on('error', (err) => {
        console.log(`⚠️ [WS ERROR] ${err.message}`);
    });

    ws.on('close', () => {
        botState.isConnectedToDeriv = false;
        console.log('🔌 [WS CLOSED] Reconectando en 5s...');
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(() => {
                reconnectTimeout = null;
                connectDeriv();
            }, 5000);
        }
    });
}

// [CEREBRO DE OPERACIONES PRINCIPAL]
function executeFlashMirrorFire() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !botState.pendingSignal) return;
    
    const isRecovery = botState.isRecoveryEnabled && botState.recoveryActive;

    // [FILTRO ABSOLUTO DE ANOMALÍAS] 
    // Ni el modo normal ni el rescate se ejecutan sin el Disparo Perfecto.
    const barrier = chooseBestBarrier();
    if (!barrier) return; // 🤫 Esperando silenciosamente falla en the matrix...

    // ❄️ Bloquear el arma 6 ticks para que el cúmulo actual desaparezca del radar
    botState.anomalyCooldown = 6; 
    botState.isBuying = true;
    botState.lastTradeTime = Date.now();

    const curr = botState.currency || 'USD'; 

    if (isRecovery) {
        // [BALA DE PLATA: Rescate de Alta Precisión]
        // Stake x11 para recuperar el dólar perdido con ganancia 9% limpiamente.
        botState.waitingForRecovery = true; 
        const silverBulletStake = (botState.stake * 11).toFixed(2); 
        
        console.log(`🛡️ [BALA DE PLATA] Técnica: DIGITDIFF (No ${barrier}) | Stake: $${silverBulletStake}`);
        
        ws.send(JSON.stringify({
            buy: 1, price: parseFloat(silverBulletStake),
            parameters: { amount: parseFloat(silverBulletStake), basis: 'stake', contract_type: 'DIGITDIFF', currency: curr, symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: barrier }
        }));
    } else {
        // [ANOMALY SNIPER NORMAL]
        console.log(`🛒 [DISPARO PERFECTO] Técnica: DIGITDIFF (No ${barrier}) | Stake: $${botState.stake}`);
        
        ws.send(JSON.stringify({
            buy: 1, price: botState.stake,
            parameters: { amount: botState.stake, basis: 'stake', contract_type: 'DIGITDIFF', currency: curr, symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: barrier }
        }));
    }
    botState.pendingSignal = null;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 v20.27 ONLINE [SMART-RABBIT]`); connectDeriv(); });
