/**
 * ============================================================
 *  EL FÉNIX ENGINE v2.0 (MODO COMPATIBILIDAD RAILWAY)
 *  Estrategias: DIFFERS + OVER/UNDER (Modo Dual)
 *  Markov Chain + Shannon Entropy + Hidra Recovery
 *  Símbolo: Volatility Index (R_10/R_25/R_50/R_100)
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
    digitHistory: [],         // Historial de últimos 300 dígitos vistos
    digitFrequency: {},        // Frecuencia de aparición de cada dígito
    currentBarrier: null,      // El dígito que actualmente "differimos"
    scanRange: 100,            // PRECISIÓN FIJA: 100 Ticks (Más estable)
    stake: 1,                  // Apuesta base en USD
    maxDailyLoss: 20,          // Máximo de pérdida diaria permitida
    dailyLoss: 0,
    dailyProfit: 0,
    lastTradeTime: 0,
    cooldownMs: 2000,          // 2 segundos entre operaciones
    isBuying: false,
    activeContractId: null,
    tradeCount: 0,
    takeProfit: 10,                // Meta de ganancia diaria
    // ─── EL FÉNIX: Sistema de Recuperación Inteligente ───
    isRecoveryEnabled: false,  // Switch del usuario
    recoveryLayer: 0,          // 0=Normal, 1=Espejo, 2=Fénix(Over/Under), 3=Freno
    consecutiveLosses: 0,
    lastLostBarrier: null,
    dalembertStep: 0,
    emergencyWaitTicks: 0,
    // ─── MARKOV + ENTROPÍA ───
    currentContractType: 'DIGITDIFF', // DIGITDIFF o DIGITOVER/DIGITUNDER
    shannonEntropy: 0,
    markovEdge: 0,             // Ventaja detectada por Markov
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

// ─── LÓGICA CENTRAL: ELEGIR LA BARRERA (DÍGITO A DIFERIR) ────
function chooseBestBarrier() {
    const hist = botState.digitHistory;
    const range = botState.scanRange || 100;
    const lastPrice = botState.lastTickPrice;

    if (hist.length < 50 || !lastPrice) return null;

    // ─── CAPA 3: FRENO DE EMERGENCIA ───
    if (botState.isRecoveryEnabled && botState.recoveryLayer === 3) {
        botState.emergencyWaitTicks++;
        if (botState.emergencyWaitTicks >= 50) {
            console.log(`🔄 [HIDRA] Freno completado. 50 ticks observados. Reseteando a Capa 0.`);
            botState.recoveryLayer = 0;
            botState.dalembertStep = 0;
            botState.consecutiveLosses = 0;
            botState.emergencyWaitTicks = 0;
        } else {
            return null; // No operar, solo observar
        }
    }

    // ─── CAPA 1: GOLPE ESPEJO ───
    if (botState.isRecoveryEnabled && botState.recoveryLayer === 1 && botState.lastLostBarrier !== null) {
        const mirrorBarrier = String(botState.lastLostBarrier);
        console.log(`🪞 [HIDRA CAPA 1] GOLPE ESPEJO: Repitiendo barrera NO-${mirrorBarrier} (99% de que no repita)`);
        return mirrorBarrier;
    }

    // ─── CAPA 2: FÉNIX (Over/Under con Markov) ───
    if (botState.isRecoveryEnabled && botState.recoveryLayer === 2) {
        const markovSignal = getMarkovOverUnder(hist);
        if (markovSignal) {
            botState.currentContractType = markovSignal.type;
            console.log(`🔥 [FÉNIX CAPA 2] ${markovSignal.label} | Prob: ${(markovSignal.prob*100).toFixed(1)}% | Edge: ${botState.markovEdge}%`);
            return markovSignal.barrier;
        }
        // Si Markov no tiene señal, usar Differs con dígito frío como fallback
        const subH = hist.slice(-range);
        const fq = {};
        for (let d = 0; d <= 9; d++) fq[d] = 0;
        subH.forEach(d => fq[d]++);
        let coldDigit = null, minF = Infinity;
        for (let d = 0; d <= 9; d++) {
            if (d === hist[hist.length-1]) continue;
            if (fq[d] < minF) { minF = fq[d]; coldDigit = d; }
        }
        if (coldDigit !== null) {
            botState.currentContractType = 'DIGITDIFF';
            return String(coldDigit);
        }
    }

    // ─── CAPA 0: MODO NORMAL (Filtro de Entropía) ───
    botState.currentContractType = 'DIGITDIFF';
    
    // Si la entropía es muy alta (>3.25), el mercado es caótico, no operar
    if (parseFloat(botState.shannonEntropy) > 3.25) return null;
    const subHistory = hist.slice(-range);
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    subHistory.forEach(d => freq[d]++);

    const recent5 = hist.slice(-5);
    const lastDigit = hist[hist.length - 1];

    let hotDigit = null;
    let maxFreq = -1;

    for (let d = 0; d <= 9; d++) {
        if (d === lastDigit) continue;
        if (!recent5.includes(d)) continue;
        if (freq[d] > maxFreq) {
            maxFreq = freq[d];
            hotDigit = d;
        }
    }

    const threshold = Math.floor(range * 0.12);
    if (hotDigit === null || freq[hotDigit] < threshold) return null;

    console.log(`🎯 [SNIPER] Dígito caliente: ${hotDigit} (${maxFreq}/${range} = ${((maxFreq/range)*100).toFixed(1)}%) | Barrera: NO-${hotDigit}`);
    return String(hotDigit);
}

// ─── GUARDAR ESTADO ───────────────────────────────────────────
function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ botState }));
    } catch (e) { }
}

// ─── CADENA DE MARKOV: Tabla de transiciones dígito→dígito ───
function buildMarkovMatrix(hist) {
    const matrix = {};
    for (let i = 0; i <= 9; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    for (let k = 1; k < hist.length; k++) {
        matrix[hist[k-1]][hist[k]]++;
    }
    // Normalizar a probabilidades
    for (let i = 0; i <= 9; i++) {
        const total = Object.values(matrix[i]).reduce((a,b) => a+b, 0);
        if (total > 0) {
            for (let j = 0; j <= 9; j++) matrix[i][j] = matrix[i][j] / total;
        }
    }
    return matrix;
}

// ─── ENTROPÍA DE SHANNON: Mide el caos del mercado ───
function calcEntropy(hist, range) {
    const sub = hist.slice(-range);
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    sub.forEach(d => freq[d]++);
    let entropy = 0;
    for (let d = 0; d <= 9; d++) {
        const p = freq[d] / sub.length;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy; // Max = 3.32 (totalmente aleatorio)
}

// ─── MARKOV: Decidir Over o Under basado en transiciones ───
function getMarkovOverUnder(hist) {
    if (hist.length < 100) return null;
    const matrix = buildMarkovMatrix(hist.slice(-200));
    const lastDigit = hist[hist.length - 1];
    const transitions = matrix[lastDigit];
    
    // Probabilidad de que el siguiente dígito sea > 4 (OVER)
    let probOver = 0;
    for (let d = 5; d <= 9; d++) probOver += transitions[d];
    
    // Probabilidad de que sea < 5 (UNDER)
    let probUnder = 1 - probOver;
    
    const edge = Math.abs(probOver - 0.5); // Desviación del 50/50
    botState.markovEdge = (edge * 100).toFixed(1);
    
    // Solo operar si hay al menos 5% de ventaja
    if (edge < 0.05) return null;
    
    if (probOver > 0.55) {
        return { type: 'DIGITOVER', barrier: '4', prob: probOver, label: 'OVER 4' };
    } else if (probUnder > 0.55) {
        return { type: 'DIGITUNDER', barrier: '5', prob: probUnder, label: 'UNDER 5' };
    }
    return null;
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
            lastCryptoHash: botState.lastTickPrice ? crypto.createHash('sha256').update(String(botState.lastTickPrice)).digest('hex') : null,
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
        if (req.body.takeProfit) botState.takeProfit = parseFloat(req.body.takeProfit);
        if (req.body.isRecoveryEnabled !== undefined) botState.isRecoveryEnabled = !!req.body.isRecoveryEnabled;
        botState.isRunning = true;
        saveState();
        console.log(`▶️ DIFFERS SNIPER INICIADO | Stake: $${botState.stake} | MaxLoss: $${botState.maxDailyLoss} | Meta: $${botState.takeProfit} | Símbolo: ${SYMBOL}`);
        return res.json({ success: true, message: 'Differs Sniper Activado ✅' });
    }
    if (action === 'STOP') {
        botState.isRunning = false;
        botState.isBuying = false;
        botState.activeContractId = null;
        botState.currentContractId = null;
        saveState();
        console.log('🛑 STOP RECIBIDO: Bot pausado y estados limpiados.');
        return res.json({ success: true, message: 'Bot Pausado y trades cancelados' });
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
    if (action === 'CONFIG') {
        const { scanRange, cooldownMs } = req.body;
        if (scanRange) botState.scanRange = parseInt(scanRange);
        if (cooldownMs) botState.cooldownMs = parseInt(cooldownMs);
        saveState();
        return res.json({ success: true, message: 'Configuración actualizada' });
    }
    if (action === 'SYNC') {
        // Sincronizar todos los valores de config sin iniciar/detener el bot
        if (req.body.stake) botState.stake = Math.max(0.35, parseFloat(req.body.stake));
        if (req.body.maxDailyLoss) botState.maxDailyLoss = parseFloat(req.body.maxDailyLoss);
        if (req.body.takeProfit) botState.takeProfit = parseFloat(req.body.takeProfit);
        if (req.body.isRecoveryEnabled !== undefined) botState.isRecoveryEnabled = !!req.body.isRecoveryEnabled;
        saveState();
        return res.json({ success: true, message: 'Config sincronizada' });
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

        if (msg.ping || msg.msg_type === 'ping') {
            ws.send(JSON.stringify({ ping: 1 }));
            return;
        }

        if (msg.msg_type === 'authorize' && msg.authorize) {
            console.log(`✅ Autenticado: ${msg.authorize.fullname}`);
            botState.isConnectedToDeriv = true; 
            
            ws.send(JSON.stringify({ forget_all: "ticks" }));
            ws.send(JSON.stringify({ forget_all: "proposal_open_contract" }));

            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
                }
            }, 3000);

            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                }
            }, 6000);
        }

        if (msg.error) {
            console.error(`⚠️ Deriv Error [${msg.error.code}]: ${msg.error.message}`);
            if (msg.error.code === 'WrongResponse' || msg.error.code === 'AuthorizationRequired') {
                botState.isConnectedToDeriv = false;
                if (ws) ws.close(); 
            }
            return;
        }

        if (msg.msg_type === 'balance' && msg.balance) {
            botState.balance = msg.balance.balance;
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const priceStr = String(msg.tick.quote);
            const lastDigit = parseInt(priceStr[priceStr.length - 1]);

            botState.lastTickPrice = parseFloat(msg.tick.quote);
            botState.lastDigit = lastDigit;

            botState.digitHistory.push(lastDigit);
            if (botState.digitHistory.length > 300) botState.digitHistory.shift();

            botState.digitFrequency[lastDigit] = (botState.digitFrequency[lastDigit] || 0) + 1;

            // ACTUALIZAR INDICADORES (Markov + Entropía) CADA TICK
            const range = botState.scanRange || 100;
            if (botState.digitHistory.length >= 50) {
                const entropy = calcEntropy(botState.digitHistory, range);
                botState.shannonEntropy = entropy.toFixed(2);
                
                // Actualizar Markov Edge (sin disparar, solo análisis)
                getMarkovOverUnder(botState.digitHistory); 
            }

            tryFireTrade();
        }

        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            botState.currentContractId = msg.buy.contract_id;
            botState.isBuying = false;
            console.log(`🎯 TRADE ABIERTO [${msg.buy.contract_id}] | Barrera: ${botState.currentBarrier}`);
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
        }

        if (msg.msg_type === 'buy' && msg.error) {
            botState.isBuying = false;
            console.error(`❌ Error al comprar: ${msg.error.message}`);
        }

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

    if (botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        return;
    }

    const now = Date.now();
    if ((now - botState.lastTradeTime) < botState.cooldownMs) return;

    if (botState.digitHistory.length < 10) return;

    const barrier = chooseBestBarrier();
    if (!barrier) return;
    
    botState.currentBarrier = barrier;

    let currentStake = botState.stake;
    let layerLabel = 'NORMAL';
    let contractType = botState.currentContractType || 'DIGITDIFF';

    if (botState.isRecoveryEnabled) {
        if (botState.recoveryLayer === 1) {
            currentStake = botState.stake * 1.5;
            layerLabel = '🪞 ESPEJO';
            contractType = 'DIGITDIFF';
        } else if (botState.recoveryLayer === 2) {
            currentStake = botState.stake + (botState.dalembertStep * botState.stake * 0.35);
            layerLabel = `🔥 FÉNIX (${contractType === 'DIGITDIFF' ? 'Differs' : contractType.includes('OVER') ? 'OVER' : 'UNDER'})`;
        }
    }

    const req = {
        buy: 1,
        price: currentStake,
        parameters: {
            amount: currentStake,
            basis: 'stake',
            contract_type: contractType,
            currency: 'USD',
            symbol: SYMBOL,
            duration: 1,
            duration_unit: 't',
            barrier: barrier
        }
    };

    botState.isBuying = true;
    botState.lastTradeTime = now;

    const typeLabel = contractType === 'DIGITDIFF' ? `NO-${barrier}` : (contractType.includes('OVER') ? `OVER ${barrier}` : `UNDER ${barrier}`);
    console.log(`🎲 SHOOT [${layerLabel}] | ${typeLabel} | Stake: $${currentStake.toFixed(2)} | Entropy: ${botState.shannonEntropy}`);
    ws.send(JSON.stringify(req));
}

// ─── FINALIZAR TRADE ─────────────────────────────────────────
function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;

    botState.pnlSession += profit;
    botState.totalTradesSession++;
    botState.tradeCount++;

    const layerNames = ['NORMAL', '🪞 ESPEJO', '🔥 FÉNIX', '🛑 FRENO'];
    const currentLayerName = botState.isRecoveryEnabled ? layerNames[botState.recoveryLayer] : 'NORMAL';
    const cType = botState.currentContractType || 'DIGITDIFF';
    const typeLabel = cType === 'DIGITDIFF' ? `DIFFERS (NO-${botState.currentBarrier})` : (cType.includes('OVER') ? `OVER ${botState.currentBarrier}` : `UNDER ${botState.currentBarrier}`);

    if (isWin) {
        botState.winsSession++;
        botState.dailyProfit += profit;
        console.log(`✅ WIN +$${profit.toFixed(2)} [${currentLayerName}] | ${typeLabel}`);

        if (botState.isRecoveryEnabled) {
            if (botState.recoveryLayer === 1) {
                botState.recoveryLayer = 0;
                botState.consecutiveLosses = 0;
            } else if (botState.recoveryLayer === 2) {
                botState.dalembertStep--;
                if (botState.dalembertStep <= 0) {
                    botState.dalembertStep = 0;
                    botState.recoveryLayer = 0;
                    botState.consecutiveLosses = 0;
                }
            } else {
                botState.consecutiveLosses = 0;
            }
        }
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(profit);
        console.log(`❌ LOSS -$${Math.abs(profit).toFixed(2)} [${currentLayerName}] | ${typeLabel}`);

        if (botState.isRecoveryEnabled) {
            botState.consecutiveLosses++;

            if (botState.recoveryLayer === 0) {
                botState.lastLostBarrier = botState.currentBarrier;
                botState.recoveryLayer = 1;
            } else if (botState.recoveryLayer === 1) {
                botState.recoveryLayer = 2;
                botState.dalembertStep = 1;
            } else if (botState.recoveryLayer === 2) {
                botState.dalembertStep++;
                if (botState.consecutiveLosses >= 3) {
                    botState.recoveryLayer = 3;
                    botState.emergencyWaitTicks = 0;
                }
            }
        }
    }

    const timeVE = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    botState.tradeHistory.unshift({
        type: typeLabel,
        profit: profit,
        time: timeVE,
        barrier: botState.currentBarrier,
        contractType: cType,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        lastDigit: botState.lastDigit,
        layer: currentLayerName
    });

    if (botState.tradeHistory.length > 100) botState.tradeHistory.pop();
    botState.activeContractId = null;
    botState.currentContractId = null;
    saveState();
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 v2.0 EL FÉNIX ONLINE | Puerto: ${PORT} | Símbolo: ${SYMBOL}`);
    connectDeriv();
});

process.on('SIGTERM', () => {
    saveState();
    process.exit(0);
});
