/**
 * ============================================================
 *  🥇 KRAKEN GOLD CHOCH SNIPER v4.0 — "The Midas Machine"
 *  A Highly Optimized Asymmetric Multiplier Trading Engine for Deriv
 *
 *  Market: Gold / XAUUSD (frxXAUUSD)
 *  Contract: MULTUP (Call) / MULTDOWN (Put)
 *  Estrategia: CHOCH Dual Sniper (Change of Character Structure Breakout)
 *  Timeframe: M5 Candles (5-minute granularity)
 *  Apalancamiento: Multiplier x200 / x400
 *  Gestión de Riesgo: Asymmetric Stop Loss (Swing Low/High) & 2x Take Profit
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN CENTRAL
// ════════════════════════════════════════════════════════════════
const APP_ID = process.env.DERIV_APP_ID || '36544';
const SYMBOL = 'frxXAUUSD';
const GRANULARITY = 300; // Velas de 5 minutos (300 segundos)
const STATE_FILE = path.join(__dirname, 'persistent-state-hybrid.json');

// ════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════
let botState = {
    isRunning: false,
    isConnectedToDeriv: false,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    activeContractId: null,
    currentContractId: null,
    isBuying: false,
    
    // Configuración Oro
    stake: 10,
    multiplier: 200,
    accountMode: 'demo',
    demoToken: '',
    realToken: '',
    currency: 'USD',
    
    // Buffers y Datos del Oro
    candles: [],         // Últimas 50 velas M5 { epoch, open, high, low, close }
    lastSH: 0,           // Swing High actual detectado
    lastSL: 0,           // Swing Low actual detectado
    lastPrice: 0,        // Precio del oro en tiempo real
    
    // Cobertura y Failsafes
    coberturaEnabled: true,
    martingaleStep: 0,   // Nivel de progresión D'Alembert
    maxMartingaleSteps: 4,
    lastTradeTime: 0
};

// Cargar estado inicial
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            botState = { ...botState, ...saved.botState };
            // Forzar estados de arranque seguros
            botState.isRunning = false;
            botState.isBuying = false;
            botState.activeContractId = null;
            botState.currentContractId = null;
            botState.candles = [];
        }
        console.log(`📥 Estado de Oro cargado correctamente. Historial: ${botState.tradeHistory.length} trades.`);
    } catch (e) {
        console.log('⚠️ Error cargando estado previo, iniciando fresco.');
    }
}

const saveState = () => {
    try {
        const stateToSave = {
            stake: botState.stake,
            multiplier: botState.multiplier,
            accountMode: botState.accountMode,
            demoToken: botState.demoToken,
            realToken: botState.realToken,
            pnlSession: botState.pnlSession,
            winsSession: botState.winsSession,
            lossesSession: botState.lossesSession,
            totalTradesSession: botState.totalTradesSession,
            coberturaEnabled: botState.coberturaEnabled,
            martingaleStep: botState.martingaleStep,
            tradeHistory: botState.tradeHistory.slice(0, 30)
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify({ botState: stateToSave }));
    } catch (e) {
        console.error("⚠️ Error guardando estado:", e.message);
    }
};

// ════════════════════════════════════════════════════════════════
//  ORQUESTADOR WEBSOCKET CON socketInstance CONTEXTO AISLADO
// ════════════════════════════════════════════════════════════════
let ws = null;
let reconnectTimeout = null;
let heartbeatInterval = null;

function connectDeriv() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    const options = {};
    if (process.env.PROXY_URL) {
        console.log(`🔒 ENRUTAMIENTO SEGURO: Conectando a Deriv a través de Proxy Residencial.`);
        options.agent = new HttpsProxyAgent(process.env.PROXY_URL);
    }
    
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`, options);
    const socketInstance = ws;
    
    socketInstance.on('open', () => {
        console.log('🔌 Conexión establecida con WebSocket de Deriv. Autenticando...');
        
        // Optimización Latencia HFT
        if (socketInstance._socket) {
            try {
                socketInstance._socket.setNoDelay(true);
                socketInstance._socket.setKeepAlive(true, 5000);
            } catch (e) {}
        }
        
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (ws === socketInstance && socketInstance.readyState === WebSocket.OPEN) {
                socketInstance.send(JSON.stringify({ ping: 1 }));
            }
        }, 30000);
        
        setTimeout(() => {
            if (ws === socketInstance && socketInstance.readyState === WebSocket.OPEN) {
                const tokenReal = botState.realToken || process.env.DERIV_TOKEN_REAL || '';
                const tokenDemo = botState.demoToken || process.env.DERIV_TOKEN_DEMO || process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
                const activeToken = botState.accountMode === 'real' ? tokenReal : tokenDemo;
                
                console.log(`🔌 [WEBSOCKET] Autorizando cuenta ${botState.accountMode.toUpperCase()} para Oro...`);
                socketInstance.send(JSON.stringify({ authorize: activeToken }));
            }
        }, 2000);
    });
    
    socketInstance.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        
        if (msg.ping || msg.msg_type === 'ping') {
            socketInstance.send(JSON.stringify({ ping: 1 }));
            return;
        }
        
        if (msg.msg_type === 'authorize' && msg.authorize) {
            console.log(`✅ Autenticación exitosa en KRAKEN GOLD: ${msg.authorize.email} [Divisa: ${msg.authorize.currency || 'USD'}]`);
            botState.isConnectedToDeriv = true;
            botState.currency = msg.authorize.currency || 'USD';
            
            socketInstance.send(JSON.stringify({ forget_all: 'ticks' }));
            socketInstance.send(JSON.stringify({ forget_all: 'proposal_open_contract' }));
            
            // Re-suscribirse si hay un contrato activo colgado
            if (botState.activeContractId) {
                console.log(`🔄 [RECONEXIÓN] Re-suscribiendo al contrato activo en Oro: ID ${botState.activeContractId}`);
                socketInstance.send(JSON.stringify({
                    proposal_open_contract: 1,
                    contract_id: botState.activeContractId,
                    subscribe: 1
                }));
            }
            
            // Descargar historial M5 de Oro + suscripción
            console.log(`📥 Descargando historial de 50 velas M5 y activando suscripción OHLC para ${SYMBOL}...`);
            socketInstance.send(JSON.stringify({
                ticks_history: SYMBOL,
                end: 'latest',
                count: 50,
                style: 'candles',
                granularity: GRANULARITY,
                subscribe: 1
            }));
            
            socketInstance.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            socketInstance.send(JSON.stringify({ portfolio: 1 }));
        }
        
        // Historial Inicial de Velas M5
        if (msg.msg_type === 'candles' && msg.candles) {
            botState.candles = msg.candles.map(c => ({
                epoch: c.epoch,
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close)
            }));
            console.log(`📡 Historial inicializado con ${botState.candles.length} velas del Oro.`);
            updateChochPivots();
        }
        
        // Actualizaciones en Vivo de Velas OHLC
        if (msg.msg_type === 'ohlc' && msg.ohlc) {
            const o = msg.ohlc;
            botState.lastPrice = parseFloat(o.close);
            
            if (botState.candles.length > 0) {
                const lastIdx = botState.candles.length - 1;
                const lastCandle = botState.candles[lastIdx];
                
                if (lastCandle.epoch === o.epoch) {
                    // Actualizar la vela actual en curso
                    lastCandle.open = parseFloat(o.open);
                    lastCandle.high = parseFloat(o.high);
                    lastCandle.low = parseFloat(o.low);
                    lastCandle.close = parseFloat(o.close);
                } else if (o.epoch > lastCandle.epoch) {
                    // Ha iniciado una nueva vela de 5 minutos
                    console.log(`⏰ [CHOCH] ¡Nueva vela M5 iniciada! Cerrando vela epoch ${lastCandle.epoch}.`);
                    botState.candles.push({
                        epoch: o.epoch,
                        open: parseFloat(o.open),
                        high: parseFloat(o.high),
                        low: parseFloat(o.low),
                        close: parseFloat(o.close)
                    });
                    if (botState.candles.length > 50) botState.candles.shift();
                    
                    // Recalcular pivotes estructurales con las velas ya cerradas
                    updateChochPivots();
                }
            } else {
                botState.candles.push({
                    epoch: o.epoch,
                    open: parseFloat(o.open),
                    high: parseFloat(o.high),
                    low: parseFloat(o.low),
                    close: parseFloat(o.close)
                });
            }
            
            // Evaluar disparos en tiempo real
            tryFireTrade();
        }
        
        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            botState.currentContractId = msg.buy.contract_id;
            botState.isBuying = false;
            
            console.log(`🚀 [COMPRA EXITOSA] Oro ID: ${msg.buy.contract_id} | Tipo: ${botState.currentContractType} | Stake: $${botState.currentStake}`);
            socketInstance.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: msg.buy.contract_id,
                subscribe: 1
            }));
            saveState();
        }
        
        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c) return;
            
            if (c.contract_id === botState.activeContractId && !c.is_sold) {
                botState.currentContractId = c.contract_id;
                botState.lastTradeTime = Date.now();
            }
            
            if (c.contract_id === botState.activeContractId && c.is_sold) {
                finalizeTrade(c);
            }
        }
        
        if (msg.msg_type === 'balance') {
            botState.balance = msg.balance.balance;
        }
        
        if (msg.msg_type === 'portfolio' && msg.portfolio) {
            const contracts = msg.portfolio.contracts || [];
            const goldContract = contracts.find(c => c.symbol === SYMBOL && (c.contract_type === 'MULTUP' || c.contract_type === 'MULTDOWN'));
            if (goldContract) {
                if (botState.activeContractId !== goldContract.contract_id) {
                    console.log(`🛡️ [RECOVERY] Detectado contrato Oro activo en Deriv [ID: ${goldContract.contract_id}]. Adoptándolo...`);
                    botState.activeContractId = goldContract.contract_id;
                    botState.currentContractId = goldContract.contract_id;
                    botState.currentContractType = goldContract.contract_type;
                    botState.isBuying = false;
                    socketInstance.send(JSON.stringify({
                        proposal_open_contract: 1,
                        contract_id: goldContract.contract_id,
                        subscribe: 1
                    }));
                    saveState();
                }
            }
        }
        
        if (msg.error) {
            console.error(`⚠️ Deriv API Error [${msg.error.code}]: ${msg.error.message}`);
            if (msg.error.code === 'WrongResponse' || msg.error.code === 'AuthorizationRequired') {
                botState.isConnectedToDeriv = false;
                if (ws === socketInstance) socketInstance.close();
            }
            if (msg.msg_type === 'buy' || botState.isBuying) {
                botState.isBuying = false;
            }
        }
    });
    
    socketInstance.on('error', (err) => {
        console.error('❌ WebSocket Error:', err.message);
        botState.isConnectedToDeriv = false;
    });
    
    socketInstance.on('close', (code) => {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        const wait = code === 1008 ? 15000 : 5000;
        console.log(`⚠️ Conexión de red cerrada. Reestableciendo conexión en ${wait/1000}s...`);
        botState.isConnectedToDeriv = false;
        botState.isBuying = false;
        
        socketInstance.removeAllListeners();
        try { socketInstance.terminate(); } catch (e) {}
        
        if (ws === socketInstance) {
            ws = null;
        }
        
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(connectDeriv, wait);
        }
    });
}

// ════════════════════════════════════════════════════════════════
//  ALGORITMO DETECTOR DE ESTRUCTURA CHOCH (CHANGE OF CHARACTER)
// ════════════════════════════════════════════════════════════════
function updateChochPivots() {
    const list = botState.candles;
    if (list.length < 30) return;
    
    let lastSH = 0;
    let lastSL = 0;
    
    // Escanear hacia atrás desde la penúltima vela (la última ya cerrada)
    // Buscamos pivotes en una ventana de 25 velas
    const limit = Math.max(1, list.length - 26);
    
    for (let j = list.length - 2; j >= limit; j--) {
        const prev = list[j - 1];
        const cur = list[j];
        const next = list[j + 1];
        if (!prev || !next) continue;
        
        // Pivot Swing High
        if (!lastSH && cur.high > prev.high && cur.high > next.high) {
            lastSH = cur.high;
        }
        // Pivot Swing Low
        if (!lastSL && cur.low < prev.low && cur.low < next.low) {
            lastSL = cur.low;
        }
        
        if (lastSH && lastSL) break;
    }
    
    if (lastSH > 0 && lastSL > 0) {
        botState.lastSH = lastSH;
        botState.lastSL = lastSL;
        console.log(`🎯 [CHOCH PIVOTS] Máximo (Swing High): ${lastSH.toFixed(2)} | Mínimo (Swing Low): ${lastSL.toFixed(2)}`);
    }
}

// ════════════════════════════════════════════════════════════════
//  GATILLO E ENTRADA SNIPER EN RUPTURA ESTRUCTURAL
// ════════════════════════════════════════════════════════════════
function tryFireTrade() {
    if (!botState.isRunning || botState.isBuying || botState.activeContractId) return;
    
    const price = botState.lastPrice;
    const sh = botState.lastSH;
    const sl = botState.lastSL;
    
    if (price <= 0 || sh <= 0 || sl <= 0) return;
    
    // Pequeño retardo entre trades (1 minuto mínimo)
    if (Date.now() - botState.lastTradeTime < 60000) return;
    
    let signalType = null;
    let slPrice = 0;
    
    if (price > sh) {
        signalType = 'BUY';   // RUPTURA AL ALZA ➔ Compra
        slPrice = sl;         // El SL se coloca en el mínimo de la estructura (Swing Low)
    } else if (price < sl) {
        signalType = 'SELL';  // RUPTURA A LA BAJA ➔ Venta
        slPrice = sh;         // El SL se coloca en el máximo de la estructura (Swing High)
    }
    
    if (!signalType) return;
    
    botState.isBuying = true;
    botState.lastTradeTime = Date.now();
    
    // --- GESTIÓN DE RIESGO ASIMÉTRICO ---
    const stake = parseFloat(getAdjustedStake());
    const multiplier = botState.multiplier || 200;
    
    // Distancia al SL en porcentaje
    const distPct = Math.abs(price - slPrice) / price;
    
    // slAmount = stake * multiplier * distPct
    let slAmount = stake * multiplier * (distPct + 0.0001);
    
    // Failsafe Cap: Limitar el Stop Loss a máximo 95% del stake
    if (slAmount >= stake) slAmount = stake * 0.95;
    if (slAmount < 1.5) slAmount = 1.5; // Mínimo SL permitido por Deriv en Oro
    
    // Take Profit = 2x Stop Loss (Relación Asimétrica de 1:2)
    let tpAmount = slAmount * 2.0;
    
    botState.currentStake = stake;
    botState.currentContractType = signalType === 'BUY' ? 'MULTUP' : 'MULTDOWN';
    
    const buyReq = {
        buy: 1,
        subscribe: 1,
        price: stake,
        parameters: {
            amount: stake,
            basis: 'stake',
            contract_type: botState.currentContractType,
            currency: botState.currency || 'USD',
            symbol: SYMBOL,
            multiplier: multiplier,
            limit_order: {
                take_profit: parseFloat(tpAmount.toFixed(2)),
                stop_loss: parseFloat(slAmount.toFixed(2))
            }
        }
    };
    
    console.log(`🔥 [DISPARO CHOCH] Oro Breakout ${signalType}! Precio: ${price.toFixed(2)} | Pivote: ${signalType === 'BUY' ? sh.toFixed(2) : sl.toFixed(2)}`);
    console.log(`🛡️ Riesgo Asimétrico: Stake: $${stake} | SL: -$${slAmount.toFixed(2)} | TP: +$${tpAmount.toFixed(2)} (x${multiplier})`);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(buyReq));
    } else {
        botState.isBuying = false;
    }
}

function getAdjustedStake() {
    let base = botState.stake || 10;
    if (botState.coberturaEnabled && botState.martingaleStep > 0) {
        // Progresión lineal D'Alembert para recuperación
        base = base * (1 + botState.martingaleStep * 0.5);
    }
    return parseFloat(base.toFixed(2));
}

// ════════════════════════════════════════════════════════════════
//  FINALIZACIÓN Y AUDITORÍA DE PNLS
// ════════════════════════════════════════════════════════════════
function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    
    botState.pnlSession += profit;
    botState.totalTradesSession++;
    
    if (isWin) {
        botState.winsSession++;
        botState.martingaleStep = 0; // Resetear cobertura
        console.log(`🎯 [TAKE PROFIT ORO] ¡Meta alcanzada! Ganancia: +$${profit.toFixed(2)} | PnL Sesión: $${botState.pnlSession.toFixed(2)}`);
    } else {
        botState.lossesSession++;
        if (botState.coberturaEnabled) {
            botState.martingaleStep++;
            if (botState.martingaleStep > botState.maxMartingaleSteps) {
                botState.martingaleStep = 0; // Failsafe para no quemar
                console.log(`💀 [COBERTURA MÁXIMA] Superado límite de pasos. Stake base restablecido.`);
            } else {
                console.log(`🛡️ [COBERTURA ACTIVA] Progresión a Nivel ${botState.martingaleStep}. Stake próximo: $${getAdjustedStake()}`);
            }
        }
        console.log(`❌ [STOP LOSS ORO] SL Tocado. Pérdida: -$${Math.abs(profit).toFixed(2)} | PnL Sesión: $${botState.pnlSession.toFixed(2)}`);
    }
    
    const timeVE = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas', hour12: true });
    botState.tradeHistory.unshift({
        symbol: 'ORO',
        engine: 'CHOCH SNIPER',
        contractType: botState.currentContractType,
        profit: profit,
        result: isWin ? 'WIN' : 'LOSS',
        time: timeVE,
        balanceAfter: botState.balance
    });
    
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
    
    botState.activeContractId = null;
    botState.currentContractId = null;
    botState.isBuying = false;
    
    saveState();
}

// ════════════════════════════════════════════════════════════════
//  EXPRESS API PARA EL DASHBOARD
// ════════════════════════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    const winRate = botState.totalTradesSession > 0 
        ? ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1)
        : '0.0';
        
    res.json({
        success: true,
        data: {
            ...botState,
            winRate,
            symbol: SYMBOL,
            // Variables simuladas para compatibilidad con index.html sin romper bindings
            engineEvenOdd: false,
            engineOverUnder: false,
            engineAccumulator: false,
            quirurgicoMode: false,
            ghostActive: false,
            martingaleStep: botState.martingaleStep,
            digitHistory: [],
            digitFrequency: {}
        }
    });
});

app.get('/api/history', (req, res) => {
    res.json({
        success: true,
        history: botState.tradeHistory
    });
});

app.post('/api/control', (req, res) => {
    const { action, stake, takeProfit, maxDailyLoss } = req.body;
    
    if (action === 'START') {
        botState.isRunning = true;
        if (stake) botState.stake = Math.max(1.0, parseFloat(stake));
        botState.isBuying = false;
        botState.activeContractId = null;
        botState.currentContractId = null;
        console.log(`▶️ KRAKEN GOLD INICIADO | Stake: $${botState.stake} | Multiplicador: x${botState.multiplier}`);
        saveState();
        return res.json({ success: true, message: 'Kraken Gold Sniper Activado 🐙' });
    }
    
    if (action === 'STOP') {
        botState.isRunning = false;
        botState.isBuying = false;
        botState.activeContractId = null;
        botState.currentContractId = null;
        console.log('🛑 STOP RECIBIDO: Kraken Gold pausado y estados saneados.');
        saveState();
        return res.json({ success: true, message: 'Bot Pausado ⏸️' });
    }
    
    if (action === 'RESET_DAY') {
        botState.pnlSession = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.totalTradesSession = 0;
        botState.tradeHistory = [];
        botState.martingaleStep = 0;
        console.log('🔄 REGISTROS DE REINICIO DIARIO: Métricas restablecidas en KRAKEN GOLD.');
        saveState();
        return res.json({ success: true, message: 'Métricas Kraken Gold reiniciadas 🔄' });
    }
    
    res.status(400).json({ success: false, error: 'Acción no soportada.' });
});

app.post('/api/config', (req, res) => {
    const fields = req.body;
    let reconnectNeeded = false;
    
    if (fields.stake !== undefined) botState.stake = parseFloat(fields.stake);
    if (fields.multiplier !== undefined) botState.multiplier = parseInt(fields.multiplier);
    if (fields.coberturaEnabled !== undefined) botState.coberturaEnabled = !!fields.coberturaEnabled;
    if (fields.demoToken !== undefined) botState.demoToken = fields.demoToken;
    if (fields.realToken !== undefined) botState.realToken = fields.realToken;
    
    if (fields.accountMode !== undefined && fields.accountMode !== botState.accountMode) {
        botState.accountMode = fields.accountMode;
        reconnectNeeded = true;
    }
    
    saveState();
    
    if (reconnectNeeded) {
        console.log(`🔄 CAMBIO DE CUENTA ORO: Conmutando a modo ${botState.accountMode.toUpperCase()}`);
        botState.isConnectedToDeriv = false;
        botState.isBuying = false;
        if (ws) {
            ws.removeAllListeners();
            try { ws.terminate(); } catch (e) {}
            ws = null;
        }
        setTimeout(connectDeriv, 1000);
        return res.json({ success: true, reconnectTriggered: true });
    }
    
    res.json({ success: true });
});

// Endpoint para Cierre Manual de Multiplicador
app.post('/api/close', (req, res) => {
    if (!botState.activeContractId) return res.status(400).json({ success: false, error: 'No hay operación activa.' });
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log(`🎯 [VENTA MANUAL] Enviando orden de cierre para contrato: ${botState.activeContractId}`);
        ws.send(JSON.stringify({ sell: botState.activeContractId, price: 0 }));
        return res.json({ success: true });
    }
    res.status(500).json({ success: false, error: 'WebSocket no disponible' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('═'.repeat(75));
    console.log('  🥇 KRAKEN GOLD DUAL CHOCH SNIPER v4.0 INICIADO');
    console.log(`  🌍 Servidor Web en puerto ${PORT}`);
    console.log('═'.repeat(75));
    connectDeriv();
});
