/**
 * ============================================================
 *  DIFFERS SNIPER ENGINE v1.1 [FINAL PRODUCTION STABLE]
 *  Estrategia: DIFFERS — El último dígito NO será X
 *  Probabilidad de ganar: ~90% por operación
 *  Símbolo: R_25 (Volatility 25 índex — analizado en 100 ticks)
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
const DERIV_TOKEN = process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-differs.json');

// Símbolo actual (por defecto V25)
let SYMBOL = 'R_100'; // Volatilidad 100 (Gana-Gana Real)

// ─── ESTADO GLOBAL ────────────────────────────────────────────
let botState = {
    isRunning: false,
    isConnectedToDeriv: false,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    currentContractId: null,
    lastTickPrice: 0,
    lastDigit: null,
    digitHistory: [],         // Historial de últimos 50 dígitos vistos
    digitFrequency: {},        // Frecuencia de aparición de cada dígito
    currentBarrier: null,      // El dígito que actualmente "differimos"
    scanRange: 20,             // Rango de análisis dinámico (dígitos a mirar)
    stake: 1,                  // Apuesta base en USD
    maxDailyLoss: 20,          // Máximo de pérdida diaria permitida
    takeProfit: 10,            // Objetivo de ganancia diaria
    dailyLoss: 0,
    dailyProfit: 0,
    lastTradeTime: 0,
    cooldownMs: 2000,          // 2 segundos entre operaciones
    isBuying: false,
    activeContractId: null,
    tradeCount: 0,
    strategyIndex: 0,          // 0: HOT, 1: COLD, 2: REPEAT
    strategyName: 'HOT-SNIPER',
    blacklist: {},             // Registro de dígitos en 'enfriamiento'
    isRecoveryEnabled: false,   // true: Intentar recuperar tras pérdida
    recoveryActive: false,     // Internal: si el próximo trade es de recuperación
    recoveryStep: 0,           // Contador de intentos de recuperación
    lastLosingDigit: null,     // El que nos hizo perder
    secondaryTarget: null,     // Segundo objetivo de rescate (Doble Dardo)
    virtualLossStreak: 0,      // Racha de pérdidas fantasma
    activeVirtualContract: null, // Si hay un contrato simulado pendiente
    lastBurstTime: 0,           // Control de ráfaga para v9.5
    // [FRANKLIN v16.0] INDICADORES ANTIGRAVEDAD
    rsiValues: [],
    emaValues: [],
    lastRSI: 50,
    lastEMA: 0,
    currentImpulse: null,        // 'UP' o 'DOWN'
};

// ─── CARGAR ESTADO PREVIO ──────────────────────────────────────
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            botState = { ...botState, ...saved.botState };
            
            // 🔥 REPARACIÓN DE EMERGENCIA: Limpiar bloqueos al arrancar CUALQUIER sesión
            botState.isRunning = false;
            botState.isBuying = false;
            botState.activeContractId = null;
            botState.currentContractId = null;
            botState.dailyLoss = 0; // Forzamos limpieza para que no arranque congelado
            botState.dailyProfit = 0;
            botState.recoveryActive = false;
        }
        console.log(`📂 Estado Differs cargado y RE-INICIALIZADO.`);
    } catch (e) {
        console.log('⚠️ Error cargando estado previo, iniciando fresco.');
    }
}

function chooseBestBarrier() {
    const hist = botState.digitHistory;
    const range = 100;
    const lastDigit = hist[hist.length - 1];
    const now = Date.now();

    if (hist.length < 15) return '5';

    // 1. Limpiar Blacklist (Dígitos bloqueados por 2 minutos tras racha o pérdida)
    for (const d in botState.blacklist) {
        if (now > botState.blacklist[d]) delete botState.blacklist[d];
    }

    // 2. Obtener frecuencia de 100 ticks
    const subHistory = hist.slice(-range);
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    subHistory.forEach(d => freq[d]++);

    let chosenDigit = null;
    let strategyLabel = '';

    // ELEGIR ESTRATEGIA (BLOQUEADO A SOLO FLASH-MIRROR POR PETICIÓN)
    strategyLabel = '⚡ FLASH-MIRROR';
    chosenDigit = lastDigit;

    /* BLOQUEO TEMPORAL DE OTROS MODOS
    const mode = botState.strategyIndex % 4;
    ... original logic ...
    */

    // ─── FILTRO ANTI-TRIPLE (NUEVO) ───────────────────────────
    // Si el dígito elegido aparece 2 veces en los últimos 10 ticks, es "Inestable"
    const last10 = hist.slice(-10);
    const countIn10 = last10.filter(d => d === parseInt(chosenDigit)).length;
    
    if (countIn10 >= 2) {
        if (botState.isRunning && (now % 5000 < 500)) console.log(`🛡️ Bloqueando ${chosenDigit} por inestabilidad (visto ${countIn10}x en últimos 10 ticks)`);
        return null;
    }

    // ─── VERIFICAR BLACKLIST ──────────────────────────────────
    if (botState.blacklist[chosenDigit]) return null;

    botState.strategyName = strategyLabel;
    return String(chosenDigit);
}

// ─── GUARDAR ESTADO ───────────────────────────────────────────
function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ botState }));
    } catch (e) { }
}

// ─── SERVIDOR WEB ─────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' })); // Permitir TODO para evitar bloqueos
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Estado actual
app.get('/differs/status', (req, res) => {
    res.json({
        success: true,
        data: {
            ...botState,
            symbol: SYMBOL,
            strategy: 'DIFFERS',
            winRate: botState.totalTradesSession > 0
                ? ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1)
                : '0.0'
        }
    });
});

// API: Control Start/Stop
app.post('/differs/control', (req, res) => {
    const { action, stake, maxDailyLoss } = req.body;

    if (action === 'START') {
        const netProfit = botState.dailyProfit - botState.dailyLoss;
        // Permitimos el arranque incluso si hay registro previo (el usuario tiene el control)
        if (stake) botState.stake = Math.max(0.35, parseFloat(stake));
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (req.body.takeProfit) botState.takeProfit = parseFloat(req.body.takeProfit);
        if (req.body.isRecoveryEnabled !== undefined) botState.isRecoveryEnabled = !!req.body.isRecoveryEnabled;
        if (req.body.strategyMode) botState.strategyMode = req.body.strategyMode;
        
        botState.isRunning = true;
        botState.isBuying = false; 
        botState.activeContractId = null;
        botState.lastTradeTime = 0; // Permitir respuesta rápida
        
        console.log(`▶️ SNIPER v4.0 INICIADO | Moneda: ${botState.currency || 'U'}`);
        return res.json({ success: true, message: 'Sniper Activado ✅', isRunning: true });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        botState.isBuying = false;
        botState.activeContractId = null;
        saveState();
        console.log('⏸️ DIFFERS SNIPER DETENIDO.');
        return res.json({ success: true, message: 'Bot Pausado', isRunning: false });
    }

    if (action === 'RESET_DAY') {
        botState.dailyLoss = 0;
        botState.dailyProfit = 0;
        botState.pnlSession = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.totalTradesSession = 0;
        botState.tradeHistory = [];
        botState.isRunning = false;
        botState.recoveryActive = false;
        botState.isBuying = false;
        botState.activeContractId = null;
        saveState();
        console.log('🧹 DÍA REINICIADO.');
        return res.json({ success: true, message: 'Día reiniciado', isRunning: false });
    }

    if (action === 'SYNC') {
        // Endpoint simple para forzar que el server y el cliente coincidan fuera de trades
        return res.json({ success: true, isRunning: botState.isRunning });
    }

    res.status(400).json({ success: false, error: 'Acción inválida' });
});

// API: Toggle Recovery Mode specifically
app.post('/differs/toggle-recovery', (req, res) => {
    const { enabled } = req.body;
    botState.isRecoveryEnabled = !!enabled;
    console.log(`🛡️ RECUPERACIÓN ONE-SHOT: ${botState.isRecoveryEnabled ? 'ACTIVADA' : 'DESACTIVADA'}`);
    res.json({ success: true, isRecoveryEnabled: botState.isRecoveryEnabled });
});

// API: Cambiar Cuenta (Real/Demo)
app.post('/differs/switch-account', (req, res) => {
    const { isReal } = req.body;
    if (botState.isRunning) return res.status(400).json({ success: false, error: 'Detén el bot primero' });

    botState.isRealAccount = !!isReal;
    
    // HARD RESET DE SESIÓN PARA LA NUEVA CUENTA
    botState.balance = 0;
    botState.pnlSession = 0;
    botState.winsSession = 0;
    botState.lossesSession = 0;
    botState.totalTradesSession = 0;
    botState.tradeHistory = [];
    botState.dailyProfit = 0;
    botState.dailyLoss = 0;
    
    // Forzar reconexión inmediata
    if (ws) {
        console.log('🔌 Cerrando conexión anterior para cambio de cuenta...');
        try { ws.send(JSON.stringify({ forget_all: "ticks" })); } catch(e) {}
        ws.terminate(); 
    } else {
        connectDeriv();
    }

    console.log(`👤 CUENTA CAMBIADA A: ${botState.isRealAccount ? 'REAL 🔴' : 'DEMO 🔵'} (Sesión Reiniciada)`);
    res.json({ success: true, isReal: botState.isRealAccount });
});

// API: Cambiar Mercado
app.post('/differs/switch-market', (req, res) => {
    const { symbol } = req.body;
    if (botState.isRunning) return res.status(400).json({ success: false, error: 'Detén el bot antes de cambiar de mercado' });
    
    if (['R_10', 'R_25', 'R_50', 'R_100'].includes(symbol)) {
        SYMBOL = symbol;
        botState.digitHistory = []; // Reset historial para el nuevo mercado
        botState.digitFrequency = {};
        
        // Re-suscribir si está conectado
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ forget_all: "ticks" }));
            ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
        }
        
        console.log(`🔄 MERCADO CAMBIADO A: ${SYMBOL}`);
        return res.json({ success: true, symbol: SYMBOL });
    }
    res.status(400).json({ success: false, error: 'Símbolo no soportado' });
});

// API: Historial
app.get('/differs/history', (req, res) => {
    res.json({ success: true, history: botState.tradeHistory.slice(0, 30) });
});

// ─── CONEXIÓN A DERIV ─────────────────────────────────────────
let ws = null;
let reconnectTimeout = null;

function connectDeriv() {
    // Si ya existe una conexión activa o conectándose, no duplicar
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        const isReal = botState.isRealAccount;
        const waitTime = isReal ? 100 : 5000; // Real: Rápido | Demo: Seguro 5s
        
        console.log(`🔌 Conexión abierta. Autenticando en ${waitTime/1000}s...`);

        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const token = isReal 
                    ? (process.env.DERIV_TOKEN_REAL || 'oC2QqWbtJZdjauD') 
                    : (process.env.DERIV_TOKEN_DEMO || 'PMIt2RhEjEDbcLD');
                
                console.log(`🔑 Mandando Token del modo: ${isReal ? 'REAL 🔴' : 'DEMO 🔵'} (Token: ${token.substring(0,4)}...)`);
                ws.send(JSON.stringify({ authorize: token }));
            }
        }, waitTime);
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        // Silenciar y responder a ping de Deriv
        if (msg.ping || msg.msg_type === 'ping') {
            ws.send(JSON.stringify({ ping: 1 }));
            return;
        }

        // Auth OK -> Limpieza y carga secuencial
        if (msg.msg_type === 'authorize' && msg.authorize) {
             const isReal = botState.isRealAccount;
             const currency = msg.authorize.currency || 'USDT';
             botState.currency = currency;
             
             console.log(`✅ Autenticado: ${msg.authorize.fullname} [${isReal ? 'REAL 🔴' : 'DEMO 🔵'}] - Moneda: ${currency}`);
             botState.isConnectedToDeriv = true;
             
             // Limpieza inicial
             ws.send(JSON.stringify({ forget_all: "ticks" }));
             ws.send(JSON.stringify({ forget_all: "proposal_open_contract" }));

             // Paso 1: Ticks (Más rápido en Real)
             setTimeout(() => {
                 if (ws && ws.readyState === WebSocket.OPEN) {
                     console.log(`📡 Suscribiendo a Ticks: ${SYMBOL}...`);
                     ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
                 }
             }, isReal ? 1000 : 3000);

             // Paso 2: Balance (Para ver los $1.64 rápido)
             setTimeout(() => {
                 if (ws && ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                 }
             }, isReal ? 2000 : 6000);
        }

        // Errores de Auth
        if (msg.error && msg.msg_type === 'authorize') {
            console.error(`❌ ERROR DE TOKEN: ${msg.error.message} (${msg.error.code})`);
            botState.isConnectedToDeriv = false;
            
            // Si es un error temporal de red o servidor (WrongResponse), re-intentar en 2s
            if (msg.error.code === 'WrongResponse') {
                console.log('🔄 Re-intentando conexión en 2s por error temporal de Deriv...');
                setTimeout(connectDeriv, 2000);
            }
        }

        // Errores
        if (msg.error) {
            console.error(`⚠️ Deriv Error [${msg.error.code}]: ${msg.error.message}`);
            return;
        }

        // Balance
        if (msg.msg_type === 'balance' && msg.balance) {
            botState.balance = msg.balance.balance;
        }

        // Tick recibido → SMART DIFFERS (3 Gatillos IA)
        // [FRANKLIN v7.0] MOTOR MULTIMODAL HÍBRIDO
        if (msg.msg_type === 'tick' && msg.tick) {
            const quote = msg.tick.quote;
            const tickPrice = parseFloat(quote);
            const tickDigit = parseInt(String(tickPrice.toFixed(3)).slice(-1));
            
            // 1. Calcular volatilidad y actualizar historial (Memoria del bot)
            const prevPrice = botState.lastTickPrice || tickPrice;
            const priceJump = Math.abs(tickPrice - prevPrice);
            
            botState.lastDigit = tickDigit;
            botState.lastTickPrice = tickPrice;
            botState.digitHistory.push(tickDigit);
            if (botState.digitHistory.length > 50) botState.digitHistory.shift();

            // [FRANKLIN v16.0] CALCULADORA ANTIGRAVEDAD (RSI-5 + EMA-5)
            // EMA calculation
            if (!botState.lastEMA) botState.lastEMA = tickPrice;
            const k = 2 / (botState.emaPeriod + 1);
            botState.lastEMA = (tickPrice * k) + (botState.lastEMA * (1 - k));
            
            // RSI calculation
            const prices = botState.rsiValues || [];
            prices.push(tickPrice);
            if (prices.length > 10) prices.shift();
            botState.rsiValues = prices;

            if (prices.length >= 6) {
                let gains = 0, losses = 0;
                for (let i = 1; i < prices.length; i++) {
                    const diff = prices[i] - prices[i-1];
                    if (diff >= 0) gains += diff; else losses -= diff;
                }
                const rs = gains / (losses || 0.001);
                botState.lastRSI = 100 - (100 / (1 + rs));
            }
            

            
            // 2. EVALUACIÓN DE GATILLOS INTELIGENTES (Modo Recolector vs Modo Rescate)
            const hist = botState.digitHistory;
            let triggerActive = null;
            let targetBarrier = null;
            let contractType = 'DIGITDIFF';
            let stakeFinal = botState.stake;

            if (hist.length >= 5) {
                const last1 = hist[hist.length - 1]; // actual
                const last2 = hist[hist.length - 2];
                const last3 = hist[hist.length - 3];
                const last4 = hist[hist.length - 4];
                const last5 = hist[hist.length - 5];

                const isAllHigh = last1 > 5 && last2 > 5 && last3 > 5 && last4 > 5 && last5 > 5;
                const isAllLow  = last1 < 4 && last2 < 4 && last3 < 4 && last4 < 4 && last5 < 4;

                // === ESTRATEGIA: COLOS-8 (Ametralladora 8/10) ===
                if (botState.strategyMode === 'OVER_UNDER') {
                    // El Analista de 25 Ticks
                    const last25 = hist.slice(-25);
                    const counts = {};
                    for(let i=0; i<=9; i++) counts[i] = 0;
                    last25.forEach(d => counts[d]++);

                    // Ordenar por apariciones (De Hot a Cold)
                    const sortedDigits = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
                    
                    // SEGURIDAD ANALITICA: Omitimos los 2 números que MENOS han salido (Los que están muertos)
                    // Disparamos del 0 al 7 (Los 8 más activos)
                    const target8 = sortedDigits.slice(0, 8); 

                    triggerActive = 'COLOS-8 (Rafaga 80% Match)';
                    contractType = 'MATCH_MACHINE_8';
                    targetBarrier = target8.join(',');
                    stakeFinal = 1.00;
                }
                // === ESTRATEGIA PRINCIPAL: DIFFERS ===
                else {
                    // === MODO RESCATE (Técnica: DOBLE DARDO MATCH x9) ===
                    if (botState.recoveryActive) {
                        contractType = 'DIGITMATCH';
                        // Elige el que nos hizo perder O el secundario alternadamente o por racha
                        const target = (botState.recoveryStep === 1) ? botState.lastLosingDigit : botState.secondaryTarget;
                        targetBarrier = String(target || 0);
                        stakeFinal = 0.35; 
                        triggerActive = `DOBLE DARDO [${botState.recoveryStep}/2] (Cazando al ${targetBarrier})`;
                        
                        // Si ya tiramos los 2 dardos, abortamos rescate
                        if (botState.recoveryStep > 2) {
                            botState.recoveryActive = false;
                            botState.recoveryStep = 0;
                            triggerActive = null;
                            contractType = null;
                        }
                    } 
                    // === MODO RECOLECTOR (BOT ESCUDO ANTIGRAVEDAD v16.0) ===
                    else {
                        const targetDigit = botState.lastDigit;
                        targetBarrier = String(targetDigit);

                        // ANALISIS RSI(5) + EMA(5)
                        const rsi = botState.lastRSI;
                        const ema = botState.lastEMA;
                        const currentTick = tickPrice;

                        let impulse = null;
                        if (rsi > 75 && currentTick > ema) impulse = 'UP';
                        if (rsi < 25 && currentTick < ema) impulse = 'DOWN';

                        if (impulse) {
                            triggerActive = `ANTIGRAVEDAD (${impulse})`;
                            contractType = 'ANTIGRAVITY_COMBO';
                            stakeFinal = 10.00;
                            botState.currentImpulse = impulse;
                        } else {
                            triggerActive = null;
                            contractType = null;
                        }
                    }
                }
            }
            
            // 3. DISPARO INTELIGENTE (Si algún gatillo encendió)
            if (triggerActive && contractType && botState.isRunning && !botState.isBuying && !botState.activeContractId) {
                const now = Date.now();
                // Bloqueo de ráfaga (v9.5): Solo una ráfaga cada 1.5 segundos
                if (botState.lastBurstTime && (now - botState.lastBurstTime < 1500)) return; 
                
                if ((now - botState.lastTradeTime) >= botState.cooldownMs) {
                    


                    const netP = botState.dailyProfit - botState.dailyLoss;
                    if (netP < botState.takeProfit && netP > -botState.maxDailyLoss) {

                        if (contractType === 'BINARY_STRIKE') {
                            // --- DISPARO DUAL BINARIO (80% Área de Ganancia) ---
                            // Leg 1: DigitUnder (9) -> Gana con 0,1,2,3,4,5,6,7,8
                            ws.send(JSON.stringify({
                                buy: 1, price: stakeFinal,
                                parameters: {
                                    amount: stakeFinal, basis: 'stake',
                                    contract_type: 'DIGITUNDER', currency: botState.currency || 'USDT',
                                    symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: '9'
                                }
                            }));

                            // Leg 2: DigitOver (0) -> Gana con 1,2,3,4,5,6,7,8,9
                            ws.send(JSON.stringify({
                                buy: 1, price: stakeFinal,
                                parameters: {
                                    amount: stakeFinal, basis: 'stake',
                                    contract_type: 'DIGITOVER', currency: botState.currency || 'USDT',
                                    symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: '0'
                                }
                            }));

                            console.log(`\n🚀 ATAQUE BINARIO AL 80%: [$${stakeFinal} x2]`);
                            console.log(`🎯 ZONA GANANCIA DOBLE: (1 al 8) | ZONA SEGURIDAD: (0 y 9)`);
                            
                            botState.currentContractType = 'BINARY_STRIKE';
                            botState.currentBarrier = '0-9';
                        } else if (contractType === 'ANTIGRAVITY_COMBO') {
                            // --- TRIPLE CAPA ANTIGRAVEDAD v16.0 ---
                            
                            // 1. MOTOR (Differs NO al Last Digit)
                            ws.send(JSON.stringify({
                                buy: 1, price: 10.00,
                                parameters: {
                                    amount: 10.00, basis: 'stake',
                                    contract_type: 'DIGITDIFF', currency: botState.currency || 'USDT',
                                    symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: targetBarrier
                                }
                            }));

                            // 2. ESCUDO (Multiplier x100 con Deal Cancellation)
                            const multi_type = botState.currentImpulse === 'UP' ? 'MULTUP' : 'MULTDOWN';
                            ws.send(JSON.stringify({
                                buy: 1, price: 10.00,
                                parameters: {
                                    amount: 10.00, basis: 'stake',
                                    contract_type: multi_type, currency: botState.currency || 'USDT',
                                    symbol: SYMBOL, multiplier: 100,
                                    limit_order: { stop_loss: 10.00, take_profit: 10.00 },
                                    cancellation_duration: '5m'
                                }
                            }));

                            console.log(`\n🛡️ ESCUDO ANTIGRAVEDAD v16.0 ACTIVADO [${botState.currentImpulse}]`);
                            console.log(`⚡ FILTRO: RSI(${botState.lastRSI.toFixed(2)}) | EMA(${botState.lastEMA.toFixed(2)})`);
                            console.log(`🎯 DISPARO DUAL: Differs($10) + Multiplier($10) + Seguro(5m)`);
                            
                            botState.currentContractType = 'ANTIGRAVITY_COMBO';
                        }


                        botState.isBuying = true;
                        botState.lastTradeTime = now;
                        botState.currentBarrier = targetBarrier;
                        
                    } else if (botState.isRunning) {
                        botState.isRunning = false;
                        console.log(`🎯 Meta Cumplida ($${netP.toFixed(2)}). Detenido.`);
                    }
                }
            }
        }

        // Compra confirmada
        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            botState.currentContractId = msg.buy.contract_id;
            botState.isBuying = false;
            const openStake = msg.buy.buy_price || 0;
            console.log(`🎯 CONTRATO ABIERTO [${msg.buy.contract_id}] | Stake: $${openStake} | Barrera: ${botState.currentBarrier}`);

            // Suscribir al resultado
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
        }

        if (msg.msg_type === 'buy' && msg.error) {
            botState.isBuying = false;
            if (msg.error.code === 'WrongResponse') {
                console.log(`⚠️ Servidor Deriv Ocupado (WrongResponse). Re-intentando en el próximo tick...`);
            } else {
                console.error(`❌ Error al comprar: ${msg.error.message}`);
            }
        }

        // Resultado del contrato
        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c || !c.is_sold) return;

            finalizeTrade(c);
        }
    });

    ws.on('error', (e) => {
        console.error('❌ WebSocket Error:', e.message);
        botState.isConnectedToDeriv = false;
    });

    ws.on('close', (code, reason) => {
        let waitTime = code === 1008 ? 15000 : 5000;
        console.log(`⚠️ Conexión cerrada (${code}). Reconectando en ${waitTime/1000}s...`);
        botState.isConnectedToDeriv = false;
        botState.isBuying = false;
        
        if (ws) {
            ws.removeAllListeners();
            try { ws.terminate(); } catch(e) {}
            ws = null;
        }

        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(connectDeriv, waitTime);
        }
    });
}

// ─── MOTOR DE DISPARO ─────────────────────────────────────────
function tryFireTrade() {
    if (!botState.isRunning) return;
    if (botState.isBuying || botState.activeContractId) return;

    // Protección de pérdida diaria (Solo detiene la COMPRA, no la conexión)
    if (botState.dailyLoss >= botState.maxDailyLoss) {
        if (botState.isRunning) {
            console.log(`🚫 LÍMITE DE PÉRDIDA ALCANZADO ($${botState.dailyLoss.toFixed(2)}). Deteniendo compras.`);
            botState.isRunning = false;
        }
        return;
    }

    // Objetivo de ganancia (Take Profit)
    const netProfit = botState.dailyProfit - botState.dailyLoss;
    if (netProfit >= botState.takeProfit) {
        if (botState.isRunning) {
            console.log(`🎯 META ALCANZADA ($${netProfit.toFixed(2)}). Deteniendo compras.`);
            botState.isRunning = false;
        }
        return;
    }

    // Cooldown entre trades
    const now = Date.now();
    if ((now - botState.lastTradeTime) < botState.cooldownMs) return;

    // Necesitamos al menos 10 dígitos de historia para elegir barrera inteligente
    if (botState.digitHistory.length < 10) return;

    // Elegir el mejor dígito barrera
    const barrier = chooseBestBarrier();
    
    // Si la técnica de Doble Barrera no da señal, esperamos al siguiente tick
    if (!barrier) return;

    botState.currentBarrier = barrier;

    // DETERMINAR STAKE (NORMAL O RECUPERACIÓN)
    let finalStake = botState.stake;
    if (botState.recoveryActive) {
        // Para DIFFERS, se necesita ~11x el stake perdido para recuperar + mínima ganancia
        finalStake = botState.stake * 11; 
        console.log(`🛡️ USANDO STAKE DE RECUPERACIÓN: $${finalStake.toFixed(2)}`);
    }

    // Construir la orden Differs
    const req = {
        buy: 1,
        price: finalStake,
        parameters: {
            amount: finalStake,
            basis: 'stake',
            contract_type: 'DIGITDIFF',
            currency: botState.currency || 'USDT', // Usar USDT por defecto si no se detectó
            symbol: SYMBOL,
            duration: 1,
            duration_unit: 't', // 1 tick
            barrier: barrier    // El dígito del que differimos
        }
    };

    botState.isBuying = true;
    botState.lastTradeTime = now;

    console.log(`📡 [${botState.strategyName}] Confirmado: NO-${barrier} (Tick Actual: ${botState.lastDigit})`);
    ws.send(JSON.stringify(req));
}

// ─── FINALIZAR TRADE ─────────────────────────────────────────
function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;

    botState.pnlSession += profit;
    botState.totalTradesSession++;
    botState.tradeCount++;

    if (isWin) {
        botState.winsSession++;
        botState.dailyProfit += profit;
        const sn = botState.strategyMode === 'OVER_UNDER' ? 'OVER/UNDER-SNIPER' : botState.strategyName;
        console.log(`✅ WIN [${sn}] +$${profit.toFixed(2)}`);
        
        // Si ganamos, desactivamos recuperación si estaba activa
        if (botState.recoveryActive) {
            console.log("💎 DARDO MATCH IMPACTADO: Recuperación Exitosa.");
            botState.recoveryActive = false;
            botState.recoveryStep = 0;
        }

        // Rotar estrategia solo después de un WIN
        botState.strategyIndex++;
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(profit);
        const sn = botState.strategyMode === 'OVER_UNDER' ? 'OVER/UNDER-SNIPER' : botState.strategyName;
        console.log(`❌ LOSS [${sn}] -$${Math.abs(profit).toFixed(2)}`);
        
        // REGLA DE ORO: Blacklist de 2 minutos para el dígito perdedor
        const badDigit = botState.currentBarrier;
        botState.blacklist[badDigit] = Date.now() + (120 * 1000); 
        console.log(`🛡️ Dígito ${badDigit} en Lista Negra por 2 min.`);

        // LÓGICA ONE-SHOT:
        // LÓGICA DE RESCATE (TÉCNICA: DOBLE DARDO MATCH):
        if (botState.isRecoveryEnabled) {
            if (!botState.recoveryActive) {
                botState.recoveryActive = true;
                botState.recoveryStep = 1;
                botState.lastLosingDigit = botState.currentBarrier;
                
                // Objetivo Secundario: El que más ha salido últimamente (El "Hot")
                const hist = botState.digitHistory;
                const freq = {}; 
                hist.slice(-20).forEach(d => freq[d] = (freq[d] || 0) + 1);
                const mostFreq = Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b, 0);
                botState.secondaryTarget = parseInt(mostFreq);

                console.log(`🛡️ ACTIVANDO DOBLE DARDO: Cazando al ${botState.lastLosingDigit} y al ${botState.secondaryTarget} (x9)`);
                
                // [FRANKLIN] Hack de velocidad: Reducimos cooldown para que el segundo dardo salga de inmediato
                botState.lastTradeTime = 0; 
            } else {
                botState.recoveryStep++;
                if (botState.recoveryStep > 2) {
                    console.log(`⚠️ RESCATE TERMINADO (2 Dardos lanzados).`);
                    botState.recoveryActive = false;
                    botState.recoveryStep = 0;
                } else {
                    // Preparamos el segundo dardo para el próximo tick
                    botState.lastTradeTime = 0; 
                    console.log(`🚀 Lanzando Segundo Dardo del par...`);
                }
            }
        } else {
            botState.recoveryActive = false;
            botState.recoveryStep = 0;
        }

        botState.strategyIndex++;
        
        // [NUEVO v3.1] SELLO DE SEGURIDAD: 2 Segundos de calma tras perder
        botState.lastTradeTime = Date.now() + 2000; 
        console.log("⏳ Calibrando escudo tras pérdida (2s de pausa)...");
    }

    // Guardar en historial
    const timeVE = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    let labelOutput = `DIFFERS (NO-${botState.currentBarrier})`;
    if (botState.currentContractType === 'DIGITOVER') labelOutput = `OVER (${botState.currentBarrier})`;
    if (botState.currentContractType === 'DIGITUNDER') labelOutput = `UNDER (${botState.currentBarrier})`;
    if (botState.currentContractType === 'DIGITMATCH') labelOutput = `🎯 MATCH (SI-${botState.currentBarrier})`;
    if (botState.currentContractType === 'BINARY_STRIKE') labelOutput = `🔥 ATAQUE BINARIO`;
    
    // [FRANKLIN v16.0] ETIQUETADO ANTIGRAVEDAD
    if (botState.currentContractType === 'ANTIGRAVITY_COMBO') {
        const isMulti = c.contract_type.startsWith('MULT');
        labelOutput = isMulti ? `🛡️ ESCUDO: MULTIPLIER ($10)` : `⚡ MOTOR: DIFFERS ($10)`;
    }

    botState.tradeHistory.unshift({
        type: labelOutput,
        profit: profit,
        time: timeVE,
        barrier: botState.currentBarrier,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        lastDigit: botState.lastDigit
    });

    if (botState.tradeHistory.length > 100) botState.tradeHistory.pop();

    // Limpiar contrato activo
    botState.activeContractId = null;
    botState.currentContractId = null;

    saveState();
}

// ─── KEEP-ALIVE PING (Desactivado para reducir ruidos) ────────
/*
setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
    }
}, 10000);
*/

// ─── ESTADÍSTICAS PERIÓDICAS ─────────────────────────────────
setInterval(() => {
    if (botState.totalTradesSession === 0) return;
    const wr = ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1);
    console.log(`📊 [STATS] Trades: ${botState.totalTradesSession} | Win Rate: ${wr}% | PnL: $${botState.pnlSession.toFixed(2)} | Balance: $${botState.balance}`);
}, 60000);

// ─── INICIAR SERVIDOR ─────────────────────────────────────────
const PORT = process.env.DIFFERS_PORT || process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(55));
    console.log('🎲 DIFFERS SNIPER ENGINE v1.0 ONLINE');
    console.log(`🌐 Puerto: ${PORT} | Símbolo: ${SYMBOL}`);
    console.log('📊 Estrategia: DIFFERS (90% Win Rate teórico)');
    console.log('='.repeat(55));
    connectDeriv();
});

// ─── ANTI-CRASH ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('🔥 Error crítico:', err.message);
    saveState();
});
process.on('unhandledRejection', (reason) => {
    console.error('🔥 Promesa rechazada:', reason);
    saveState();
});

// Limpieza al apagar (para Railway)
process.on('SIGTERM', () => {
    console.log('🛑 Recibida señal SIGTERM. Cerrando bot...');
    if (ws) {
        ws.send(JSON.stringify({ forget_all: "ticks" }));
        ws.terminate();
    }
    saveState();
    process.exit(0);
});
