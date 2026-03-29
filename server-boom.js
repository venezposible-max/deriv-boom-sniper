/**
 * ============================================================
 *  DIFFERS SNIPER ENGINE v1.0
 *  Estrategia: DIFFERS — El último dígito NO será X
 *  Probabilidad de ganar: ~90% por operación
 *  Símbolo: R_10 (Volatility 10 índex — más lento, más predecible para dígitos)
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
let SYMBOL = 'R_25';

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
    dailyLoss: 0,
    dailyProfit: 0,
    lastTradeTime: 0,
    cooldownMs: 2000,          // 2 segundos entre operaciones
    isBuying: false,
    activeContractId: null,
    tradeCount: 0,
};

// ─── CARGAR ESTADO PREVIO ──────────────────────────────────────
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            botState = { ...botState, ...saved.botState };
            botState.isRunning = false;
            botState.isBuying = false;
            botState.activeContractId = null;
            botState.currentContractId = null;
        }
        console.log(`📂 Estado Differs cargado. Historial: ${botState.tradeHistory.length} trades.`);
    } catch (e) {
        console.log('⚠️ Error cargando estado previo, iniciando fresco.');
    }
}

function chooseBestBarrier() {
    const hist = botState.digitHistory;
    const range = 100; // Análisis fijo de 100 ticks

    if (hist.length < 10) return '5'; 

    // Tomar los últimos 100 dígitos (o los que haya disponibles)
    const subHistory = hist.slice(-range);

    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    subHistory.forEach(d => freq[d]++);

    // Elegir el que MÁS veces salió en ese rango (para diferir de él)
    let hotDigit = 0;
    let maxCount = -1;
    for (let d = 0; d <= 9; d++) {
        if (freq[d] > maxCount) {
            maxCount = freq[d];
            hotDigit = d;
        }
    }

    return String(hotDigit);
}

// ─── GUARDAR ESTADO ───────────────────────────────────────────
function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ botState }));
    } catch (e) { }
}

// ─── SERVIDOR WEB ─────────────────────────────────────────────
const app = express();
app.use(cors());
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
        if (stake) botState.stake = Math.max(0.35, parseFloat(stake));
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        botState.isRunning = true;
        console.log(`▶️ DIFFERS SNIPER INICIADO | Stake: $${botState.stake} | Símbolo: ${SYMBOL}`);
        return res.json({ success: true, message: 'Differs Sniper Activado ✅' });
    }
    if (action === 'STOP') {
        botState.isRunning = false;
        saveState();
        console.log('⏸️ DIFFERS SNIPER DETENIDO.');
        return res.json({ success: true, message: 'Bot Pausado' });
    }
    if (action === 'RESET_DAY') {
        botState.dailyLoss = 0;
        botState.dailyProfit = 0;
        botState.pnlSession = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.totalTradesSession = 0;
        botState.tradeHistory = [];
        saveState();
        return res.json({ success: true, message: 'Día reiniciado' });
    }

    res.status(400).json({ success: false, error: 'Acción inválida' });
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
        console.log('🔌 Conectado a Deriv. Esperando 5s para identificar...');
        // NO activamos isConnectedToDeriv aquí, esperamos al Auth
        
        // Retraso inicial de 5s antes de mandar el Token
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
            }
        }, 5000);
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        // Silenciar y responder a ping de Deriv
        if (msg.ping || msg.msg_type === 'ping') {
            ws.send(JSON.stringify({ ping: 1 }));
            return;
        }

        // Auth OK -> Limpieza y carga secuencial ultra-lenta para evitar 1008
        if (msg.msg_type === 'authorize' && msg.authorize) {
            console.log(`✅ Autenticado: ${msg.authorize.fullname}`);
            botState.isConnectedToDeriv = true; // AHORA SÍ estamos listos
            
            // Limpieza inicial de cualquier rastro previo
            ws.send(JSON.stringify({ forget_all: "ticks" }));
            ws.send(JSON.stringify({ forget_all: "proposal_open_contract" }));

            // Paso 1: Ticks después de 3s
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
                }
            }, 3000);

            // Paso 2: Balance después de 6s
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                }
            }, 6000);
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

        // Tick recibido → Analizar dígito
        if (msg.msg_type === 'tick' && msg.tick) {
            const priceStr = String(msg.tick.quote);
            const lastDigit = parseInt(priceStr[priceStr.length - 1]);

            botState.lastTickPrice = parseFloat(msg.tick.quote);
            botState.lastDigit = lastDigit;

            // Guardar en historial de dígitos
            botState.digitHistory.push(lastDigit);
            if (botState.digitHistory.length > 100) botState.digitHistory.shift();

            // Actualizar frecuencia
            botState.digitFrequency[lastDigit] = (botState.digitFrequency[lastDigit] || 0) + 1;

            // Intentar disparar
            tryFireTrade();
        }

        // Compra confirmada
        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            botState.currentContractId = msg.buy.contract_id;
            botState.isBuying = false;
            console.log(`🎯 DIFFERS ABIERTO [${msg.buy.contract_id}] | Barrera: NO-${botState.currentBarrier}`);

            // Suscribir al resultado
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
        }

        if (msg.msg_type === 'buy' && msg.error) {
            botState.isBuying = false;
            console.error(`❌ Error al comprar: ${msg.error.message}`);
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

    // Protección de pérdida diaria
    if (botState.dailyLoss >= botState.maxDailyLoss) {
        console.log(`🚫 LÍMITE DIARIO ALCANZADO ($${botState.dailyLoss.toFixed(2)}). Bot pausado hasta mañana.`);
        botState.isRunning = false;
        return;
    }

    // Cooldown entre trades
    const now = Date.now();
    if ((now - botState.lastTradeTime) < botState.cooldownMs) return;

    // Necesitamos al menos 10 dígitos de historia para elegir barrera inteligente
    if (botState.digitHistory.length < 10) return;

    // Elegir el mejor dígito barrera
    const barrier = chooseBestBarrier();
    botState.currentBarrier = barrier;

    // Construir la orden Differs
    const req = {
        buy: 1,
        price: botState.stake,
        parameters: {
            amount: botState.stake,
            basis: 'stake',
            contract_type: 'DIGITDIFF',
            currency: 'USD',
            symbol: SYMBOL,
            duration: 1,
            duration_unit: 't', // 1 tick
            barrier: barrier    // El dígito del que differimos
        }
    };

    botState.isBuying = true;
    botState.lastTradeTime = now;

    console.log(`🎲 DIFFERS SHOOT | Barrera (NO-${barrier}) | Stake: $${botState.stake} | Últ.Dígito: ${botState.lastDigit}`);
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
        console.log(`✅ WIN +$${profit.toFixed(2)} | Barrera NO-${botState.currentBarrier} AGUANTÓ`);
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(profit);
        console.log(`❌ LOSS -$${Math.abs(profit).toFixed(2)} | El dígito SÍ fue ${botState.currentBarrier}`);
    }

    // Guardar en historial
    const timeVE = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    botState.tradeHistory.unshift({
        type: `DIFFERS (NO-${botState.currentBarrier})`,
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
