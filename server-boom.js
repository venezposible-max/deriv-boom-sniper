const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN: BOOM 1000 SNIPER 2026
// ==========================================
const APP_ID = 1089;
const SYMBOL = 'BOOM1000'; // El Rey de las Explosiones
const STATE_FILE = path.join(__dirname, 'persistent-state-boom.json');
const WEB_PASSWORD = process.env.WEB_PASSWORD || 'admin123';

let BOOM_CONFIG = {
    stake: 20,
    takeProfit: 50.00,
    stopLoss: 1.00,
    multiplier: 200,    // Multiplicador válido (100, 200, 300, 400, 500)
    rsiPeriod: 14,
    cciPeriod: 14,
    timeStopTicks: 15,
    cooldownSeconds: 45,
    rsiThreshold: 25,     // Nuevo: Gatillo configurable
    quickReloadSeconds: 3, // Nuevo: Recarga configurable
    useTickFrequency: false // Modo avanzado apagado por default
};

let botState = {
    isRunning: false, // PARADA DE EMERGENCIA POR DEFECTO
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    balanceHistory: [],
    activeContracts: [],
    currentContractId: null,
    activeSymbol: 'BOOM1000',
    activeStrategy: 'SNIPER',
    cooldownRemaining: 0,
    lastScanLogTime: 0,
    sessionDuration: 0,
    lastTickTime: 0,
    currentRSI: 50
};

let tickHistory = [];
let ws;
let isBuying = false;
let cooldownIntervalId = null;

// --- INICIALIZACIÓN DE SERVIDOR WEB PARA RAILWAY ---
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        data: {
            ...botState,
            activeSymbol: 'BOOM 1000',
            activeStrategy: 'SNIPER'
        },
        config: BOOM_CONFIG,
    });
});

app.post('/api/control', (req, res) => {
    const { action, stake, takeProfit, multiplier, stopLoss, timeStopTicks, useTickFrequency, rsiThreshold, quickReloadSeconds } = req.body;

    if (action === 'START') {
        botState.isRunning = true;
        if (stake) BOOM_CONFIG.stake = Number(stake);
        if (takeProfit) BOOM_CONFIG.takeProfit = Number(takeProfit);
        if (timeStopTicks) BOOM_CONFIG.timeStopTicks = Number(timeStopTicks);
        if (rsiThreshold) BOOM_CONFIG.rsiThreshold = Number(rsiThreshold);
        if (quickReloadSeconds) BOOM_CONFIG.quickReloadSeconds = Number(quickReloadSeconds);

        if (multiplier) {
            // Ajustar a valores permitidos por Deriv para Boom (100, 200, 300, 400, 500)
            const val = Number(multiplier);
            if (val >= 450) BOOM_CONFIG.multiplier = 500;
            else if (val >= 350) BOOM_CONFIG.multiplier = 400;
            else if (val >= 250) BOOM_CONFIG.multiplier = 300;
            else if (val >= 150) BOOM_CONFIG.multiplier = 200;
            else BOOM_CONFIG.multiplier = 100;
        }

        if (stopLoss) BOOM_CONFIG.stopLoss = Number(stopLoss);
        if (typeof useTickFrequency !== 'undefined') BOOM_CONFIG.useTickFrequency = Boolean(useTickFrequency);

        saveState();
        console.log(`▶️ BOT BOOM 1000 ENCENDIDO | Sniper Mode | Mult: ${BOOM_CONFIG.multiplier}`);
        return res.json({ success: true, message: 'Bot Boom Sniper Activado', isRunning: true });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        saveState();
        console.log(`⏸️ BOT BOOM 1000 DETENIDO.`);
        return res.json({ success: true, message: 'Bot Pausado', isRunning: false });
    }

    if (action === 'FORCE_CLEAR') {
        botState.currentContractId = null;
        botState.activeContracts = [];
        isBuying = false;
        saveState();
        return res.json({ success: true, message: 'Trades de Boom limpiados' });
    }

    res.status(400).json({ success: false, error: 'Acción inválida' });
});

// --- ENDPOINT: TRADES MANUALES ---
app.post('/api/trade', (req, res) => {
    const { action } = req.body;
    if (botState.currentContractId || isBuying) return res.status(400).json({ success: false, error: 'Ya hay una operación activa.' });

    if (action === 'MULTUP' || action === 'MULTDOWN' || action === 'CALL' || action === 'PUT') {
        executeTrade(); // En Boom solo usamos MULTUP para spikes
        return res.json({ success: true, message: `Disparo manual enviado a BOOM 1000` });
    }
});

// --- ENDPOINT: CIERRE MANUAL ---
app.post('/api/close', (req, res) => {
    const { contractId } = req.body;
    const idToClose = contractId || botState.currentContractId;
    if (!idToClose) return res.status(400).json({ success: false, error: 'No hay nada que cerrar.' });

    ws.send(JSON.stringify({ sell: idToClose, price: 0 }));
    return res.json({ success: true, message: 'Orden de venta enviada' });
});

// --- ENDPOINT: LIMPIAR HISTORIAL ---
app.post('/api/clear-history', (req, res) => {
    botState.tradeHistory = [];
    botState.balanceHistory = [];
    botState.pnlSession = 0;
    botState.winsSession = 0;
    botState.lossesSession = 0;
    botState.totalTradesSession = 0;
    botState.sessionDuration = 0;
    saveState();
    return res.json({ success: true, message: 'Historial y estadísticas de sesión limpiados' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`\n🚀 Iniciando Motor BOOM 1000 SNIPER...`);
    console.log(`🌍 Módulo Web en puerto ${PORT}`);

    // --- CRONÓMETRO DE SESIÓN ---
    setInterval(() => { if (botState.isRunning) botState.sessionDuration++; }, 1000);

    // --- DETECTOR DE CONGELAMIENTO SÍSMICO (TICK HESITATION) ---
    // Chequea el pulso en un loop paralelo ultrarrápido (cada 150ms)
    setInterval(() => {
        if (!botState.isRunning || !BOOM_CONFIG.useTickFrequency || botState.currentContractId || botState.cooldownRemaining > 0 || isBuying) return;
        if (!botState.lastTickTime || tickHistory.length < 60) return;

        const delay = Date.now() - botState.lastTickTime;
        // Si hay silencio absoluto por más de 2500 milisegundos y menos de 3.5s (para evitar repeticiones)
        if (delay >= 2500 && delay < 3500) {
            const m1_candles = downsampleTicksToCandles(tickHistory, 60);
            const rsi = calculateRSI(m1_candles, 14);

            if (rsi >= 0 && rsi <= BOOM_CONFIG.rsiThreshold) {
                console.log(`\n🧊🔥 ¡CONGELAMIENTO DETECTADO! (${delay}ms de silencio) | RSI: ${rsi.toFixed(1)} -> DISPARO ANTICIPADO DEL SNIPER 💥`);
                // Evitar spam de triggers, moviendo el ultimo tick al futuro
                botState.lastTickTime = Date.now() + 5000;
                executeTrade();
            }
        }
    }, 150);

    connectWebSocket();
});

// --- INDICADORES TÉCNICOS ---
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// Transformador de Ticks puros de Deriv a Velas Simuladas de 1 Minuto (M1).
// Crucial para que los osciladores no colapsen a 0.0 por movimientos microscopicos repetidos.
function downsampleTicksToCandles(ticks, ticksPerCandle = 60) {
    let candles = [];
    for (let i = 0; i < ticks.length; i += ticksPerCandle) {
        candles.push(ticks[i]);
    }
    return candles;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    // Adaptado a Velas M1: Tomamos máximo histórico disponible suavizado (60 Velas)
    let startIndex = prices.length - 60;
    if (startIndex < 1) startIndex = 1;

    let avgGain = 0;
    let avgLoss = 0;

    // 1. SMA inicial (primeras 14 velas desde atrás)
    for (let i = startIndex; i < startIndex + period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff;
        else if (diff < 0) avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;

    // 2. Wilder Smoothing hasta el presente
    for (let i = startIndex + period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let currentGain = diff > 0 ? diff : 0;
        let currentLoss = diff < 0 ? Math.abs(diff) : 0;

        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;

    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateCCI(prices, period) {
    if (prices.length < period) return 0;
    const sma = calculateSMA(prices, period);
    let meanDev = 0;
    const slice = prices.slice(-period);
    for (let p of slice) meanDev += Math.abs(p - sma);
    meanDev = meanDev / period;
    if (meanDev === 0) return 0;
    return (prices[prices.length - 1] - sma) / (0.015 * meanDev);
}

// --- LÓGICA DE CONEXIÓN Y MERCADO ---
function connectWebSocket() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log(`✅ Socket Abierto. Autorizando con Token...`);
        ws.send(JSON.stringify({ authorize: process.env.DERIV_TOKEN || 'GzEO8iO7Y3N9Ym0' }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.error) {
            const errMsg = (msg.error.message || '').toLowerCase();
            console.error(`⚠️ Error en BOOM: ${msg.error.message}`);
            isBuying = false;

            if (errMsg.includes('100 contracts') || errMsg.includes('more than 100')) {
                console.log('🛑 LÍMITE ALCANZADO: Tienes 100+ contratos abiertos. Pausando disparos 2 min.');
                botState.cooldownRemaining = 120;
                const timer = setInterval(() => {
                    if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;
                    else clearInterval(timer);
                }, 1000);
            }
            return;
        }

        if (msg.msg_type === 'authorize') {
            console.log(`✅ DERIV CONECTADO - Usuario: ${msg.authorize.fullname}`);
            // --- CALENTAMIENTO INSTANTÁNEO (WARM START) ---
            console.log(`🚀 Solicitando historial de ticks para arranque inmediato...`);
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                count: 4000,
                end: 'latest',
                style: 'ticks'
            }));

            ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        // --- MANEJO DE HISTORIAL PARA WARM START ---
        if (msg.msg_type === 'history') {
            tickHistory = [...msg.history.prices];
            console.log(`📡 Memoria cargada instantáneamente: ${tickHistory.length} ticks. 🔥 SISTEMA LISTO.`);
        }

        if (msg.msg_type === 'balance') {
            botState.balance = msg.balance.balance;
            console.log(`💰 SALDO: $${botState.balance.toFixed(2)}`);
        }
        if (msg.msg_type === 'tick') {
            const quote = parseFloat(msg.tick.quote);
            tickHistory.push(quote);
            if (tickHistory.length > 4050) tickHistory.shift();

            if (botState.currentContractId) {
                // Ya no contamos ticks aquí para el stop temporal, pero lo dejamos como métrica de data.
                botState.ticksInTrade = (botState.ticksInTrade || 0) + 1;
            }

            processTick(quote);
        }

        if (msg.msg_type === 'buy') {
            const contractId = msg.buy.contract_id;
            botState.currentContractId = contractId;
            botState.ticksInTrade = 0;
            botState.tradeStartTime = Date.now(); // ⏱️ TIEMPO ABSOLUTO CERO
            isBuying = false; // Desbloquear sistema de compra

            // Suscribirnos al contrato manual y explícitamente (vital para Multiplicadores)
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            }));
            console.log(`📡 CONTRATO ABIERTO [${contractId}]. Cronómetro activo: Esperando ${BOOM_CONFIG.timeStopTicks} SEGUNDOS...`);
        }

        if (msg.msg_type === 'proposal_open_contract') {
            const contract = msg.proposal_open_contract;

            // Actualizar contrato activo para la UI
            if (contract && !contract.is_sold) {
                botState.currentContractId = contract.contract_id;
                botState.activeContracts = [contract];
            }

            if (contract && contract.is_sold) {
                finalizeTrade(contract);
            } else if (contract && !contract.is_sold) {
                // Monitoreo Activo (Time-Stop Reloj Real + TP/SL Dinámico Manual)
                const secondsElapsed = Math.floor((Date.now() - botState.tradeStartTime) / 1000);
                const profit = parseFloat(contract.profit);

                if (profit >= BOOM_CONFIG.takeProfit) {
                    console.log(`🎯 TAKE PROFIT ALCANZADO: +$${profit.toFixed(2)}`);
                    botState.currentContractId = null; // Prevenir cierres dobles
                    ws.send(JSON.stringify({ sell: contract.contract_id, price: 0 }));
                } else if (profit <= -Math.abs(BOOM_CONFIG.stopLoss)) {
                    console.log(`🛡️ STOP LOSS CUBIERTO: -$${Math.abs(profit).toFixed(2)}`);
                    botState.currentContractId = null;
                    ws.send(JSON.stringify({ sell: contract.contract_id, price: 0 }));
                } else if (secondsElapsed >= BOOM_CONFIG.timeStopTicks && profit < 2.00) {
                    console.log(`⏱️ TIME-STOP RELOJ: Límite de ${BOOM_CONFIG.timeStopTicks} segundos reales alcanzado. Cerrando Venta con ${profit.toFixed(2)}$`);
                    botState.currentContractId = null;
                    ws.send(JSON.stringify({ sell: contract.contract_id, price: 0 }));
                }
            }
        }
    });
}

function processTick(quote) {
    botState.lastTickTime = Date.now();

    // 1. Transformar miles de ticks ruidosos en Velas Sólidas M1
    const m1_candles = downsampleTicksToCandles(tickHistory, 60);

    // 2. Aplicar RSI Clásico 14 Periodos sobre las velas M1
    const rsi = calculateRSI(m1_candles, 14);
    botState.currentRSI = isNaN(rsi) ? 50 : rsi;

    // --- RADAR VISUAL EN CONSOLA (CADA 10 SEGUNDOS) ---
    const now = Date.now();
    if (now - botState.lastScanLogTime > 10000) {
        let zona = "⏳ ZONA NEUTRAL (Paciencia...)";
        if (rsi <= BOOM_CONFIG.rsiThreshold) zona = `🎯 ALERTA: ZONA DE DISPARO (RSI <= ${BOOM_CONFIG.rsiThreshold})`;
        else if (rsi <= 35) zona = "⚠️ ACERCÁNDOSE A SOBREVENTA";
        else if (rsi >= 70) zona = "🔥 SOBRECOMPRA (Muy lejos de disparar)";

        let estadoBot = botState.isRunning
            ? (botState.cooldownRemaining > 0 ? `ENFRIAMIENTO (${botState.cooldownRemaining}s)` : "CAZANDO SPIKES")
            : "APAGADO";

        console.log(`📡 RADAR BOOM 1000 -> RSI: ${rsi.toFixed(1)} | Mercado: ${zona} | Motor: ${estadoBot}`);
        botState.lastScanLogTime = now;
    }

    if (!botState.isRunning) return;

    // Monitor de Seguridad: Si isBuying se queda pegado más de 5 seg, resetear.
    if (isBuying && now - (botState.lastBuyAttemptTime || 0) > 5000) {
        console.log("⚠️ Reseteando bandera de compra por timeout...");
        isBuying = false;
    }

    if (botState.currentContractId || botState.cooldownRemaining > 0 || isBuying) {
        // Log de depuración solo si estamos en zona rsi
        if (rsi <= BOOM_CONFIG.rsiThreshold && now - (botState.lastSkipLogTime || 0) > 5000) {
            let razon = botState.currentContractId ? "Contrato Abierto" : (isBuying ? "Esperando Confirmación Buy" : "En Enfriamiento");
            console.log(`ℹ️ SNIPER: RSI en ${rsi.toFixed(1)} pero ignorando disparo por: ${razon}`);
            botState.lastSkipLogTime = now;
        }
        return;
    }

    // El CCI y el SMA también usan velas y datos limpios de M1
    const cci = calculateCCI(m1_candles, 14);
    const sma50 = calculateSMA(m1_candles, 50);

    if (!sma50 || isNaN(rsi) || isNaN(cci)) return;

    // --- REGLAS SNIPER BOOM (Refinadas) ---
    // En Boom 1000 ignoraremos el CCI estricto y la cercanía al SMA,
    // ya que una caída tan profunda (RSI < Threshold) naturalmente aleja al 
    // precio de sus promedios. Disparamos directo por agotamiento de caída.
    if (rsi >= 0 && rsi <= BOOM_CONFIG.rsiThreshold) {
        if (BOOM_CONFIG.useTickFrequency) {
            // No disparamos normal. Esperaremos a que el motor paralelo detecte el congelamiento.
            if (Date.now() - (botState.lastFreezeLogTime || 0) > 3000) {
                console.log(`🧊 RSI Letal (${rsi.toFixed(1)}). Sniper apuntando. Esperando silencio (Tick Hesitation)...`);
                botState.lastFreezeLogTime = Date.now();
            }
        } else {
            console.log(`💥 SEÑAL ACTIVA: RSI cayó a ${rsi.toFixed(1)} (Meta: ${BOOM_CONFIG.rsiThreshold}) -> ¡Disparo inminente! (CCI: ${cci.toFixed(0)})`);
            executeTrade();
        }
    }
}

function executeTrade() {
    isBuying = true;
    botState.lastBuyAttemptTime = Date.now();
    const req = {
        buy: 1,
        price: BOOM_CONFIG.stake,
        parameters: {
            amount: BOOM_CONFIG.stake,
            basis: 'stake',
            contract_type: 'MULTUP',
            currency: 'USD',
            symbol: SYMBOL,
            multiplier: BOOM_CONFIG.multiplier
        }
    };
    ws.send(JSON.stringify(req));

    botState.ticksInTrade = 0;

    // BLOQUEO EXTENDIDO: Protección por si falla el WebSocket de respuesta 'buy'
    setTimeout(() => { isBuying = false; }, 10000);
}

function finalizeTrade(contract) {
    const profit = parseFloat(contract.profit);
    botState.pnlSession += profit;
    botState.totalTradesSession++;

    if (profit > 0) {
        botState.winsSession++;
        console.log(`🎯 ¡SPIKE CAZADO! Ganancia: +$${profit.toFixed(2)} 💰💰💰`);
        botState.cooldownRemaining = BOOM_CONFIG.cooldownSeconds; // 45s
    } else {
        botState.lossesSession++;
        console.log(`🛡️ BALA PERDIDA: -$${Math.abs(profit).toFixed(2)} (Bajo control)`);
        botState.cooldownRemaining = BOOM_CONFIG.quickReloadSeconds; // Ej: 3s
    }

    // --- REGISTRO DE TRADING HISTORIAL (Máximo 10) ---
    const now = new Date();
    botState.tradeHistory.unshift({
        id: contract.contract_id,
        type: (contract.contract_type === 'MULTUP') ? 'BUY 🚀' : 'SELL ↘️',
        profit: profit,
        timestamp: now.toLocaleTimeString(),
        duration: Math.floor((now.getTime() / 1000) - contract.date_start) + 's'
    });
    if (botState.tradeHistory.length > 10) botState.tradeHistory.pop();

    botState.currentContractId = null;
    botState.activeContracts = [];

    // --- LÓGICA DE RECARGA: RÁFAGA vs DESCANSO ---
    // Si ganamos, hay nuevo trend = Enfriamiento largo (45s)
    // Si perdimos el Time-Stop, el Spike podría estar a un segundo de salir = Recarga rapida (3s)
    botState.cooldownRemaining = (profit > 0) ? BOOM_CONFIG.cooldownSeconds : 3;

    if (cooldownIntervalId) clearInterval(cooldownIntervalId);
    cooldownIntervalId = setInterval(() => {
        if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;
        else clearInterval(cooldownIntervalId);
    }, 1000);

    saveState();
}

function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(botState)); } catch (e) { }
}
