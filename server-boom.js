const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// 🥇 GOLD SNIPER PRO (XAU/USD) - 2026
// ==========================================
const APP_ID = 1089;
const STATE_FILE = path.join(__dirname, 'gold-state.json');

let MARKET_CONFIGS = {
    'frxXAUUSD': {
        stake: 50,
        takeProfit: 1.00,
        stopLoss: 0.50,
        multiplier: 200,
        rsiPeriod: 14,
        emaPeriod: 20,
        rsiOverbought: 70,
        rsiOversold: 30,
        granularity: 300
    },
    'R_100': {
        stake: 10,
        takeProfit: 1.00,
        stopLoss: 0.50,
        multiplier: 200,
        rsiPeriod: 14,
        emaPeriod: 20,
        rsiOverbought: 70,
        rsiOversold: 30,
        granularity: 300
    }
};

let GOLD_CONFIG = MARKET_CONFIGS['frxXAUUSD'];

let botState = {
    isRunning: false,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    currentContractId: null,
    currentRSI: 50,
    currentEMA: 0,
    lastTickPrice: 0,
    tradeStartTime: null,
    tradeProfit: 0,
    tradeSeconds: 0,
    rsiOverbought: 70,
    rsiOversold: 30,
    lastRSI: 50,
    symbol: 'frxXAUUSD'
};

// --- CARGAR ESTADO PREVIO ---
if (fs.existsSync(STATE_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(STATE_FILE));
        if (data.botState) botState = { ...botState, ...data.botState, isRunning: false };
        if (data.botState) botState = { ...botState, ...data.botState, isRunning: false };
        if (data.marketConfigs) {
            MARKET_CONFIGS = { ...MARKET_CONFIGS, ...data.marketConfigs };
            GOLD_CONFIG = MARKET_CONFIGS[botState.symbol];
            // Sincronizar botState con la config cargada
            botState.rsiOverbought = GOLD_CONFIG.rsiOverbought;
            botState.rsiOversold = GOLD_CONFIG.rsiOversold;
        }
        console.log("📂 Estado y configuración cargados con éxito.");
    } catch (e) { console.log("⚠️ No se pudo cargar el estado previo."); }
}

let candleHistory = [];
let ws;
let isBuying = false;

// --- SERVIDOR WEB ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    res.json({ success: true, data: botState, config: GOLD_CONFIG });
});

app.post('/api/control', (req, res) => {
    const { action, stake, takeProfit, stopLoss, multiplier, rsiOverbought, rsiOversold } = req.body;
    if (action === 'START') {
        botState.isRunning = true;
        if (stake) GOLD_CONFIG.stake = Number(stake);
        if (takeProfit) GOLD_CONFIG.takeProfit = Number(takeProfit);
        if (stopLoss) GOLD_CONFIG.stopLoss = Number(stopLoss);
        if (multiplier) GOLD_CONFIG.multiplier = Number(multiplier);
        if (rsiOverbought) { GOLD_CONFIG.rsiOverbought = Number(rsiOverbought); botState.rsiOverbought = Number(rsiOverbought); }
        if (rsiOversold) { GOLD_CONFIG.rsiOversold = Number(rsiOversold); botState.rsiOversold = Number(rsiOversold); }

        // Actualizar el almacenamiento maestro
        MARKET_CONFIGS[botState.symbol] = { ...GOLD_CONFIG };
        saveState();
        const marketName = botState.symbol === 'frxXAUUSD' ? 'ORO' : 'V100';
        console.log(`▶️ SNIPER INICIADO | ${marketName} (${botState.symbol}) | Stake: ${GOLD_CONFIG.stake} | RSI: ${GOLD_CONFIG.rsiOversold}/${GOLD_CONFIG.rsiOverbought}`);
        return res.json({ success: true, message: `Sniper en ${marketName} Activado` });
    }
    if (action === 'STOP') {
        botState.isRunning = false;
        saveState();
        const marketName = botState.symbol === 'frxXAUUSD' ? 'ORO' : 'V100';
        console.log(`⏸️ SNIPER ${marketName} DETENIDO.`);
        return res.json({ success: true, message: 'Bot Pausado' });
    }
    res.status(400).json({ success: false, error: 'Acción inválida' });
});

app.post('/api/clear-history', (req, res) => {
    botState.tradeHistory = [];
    botState.pnlSession = 0;
    botState.winsSession = 0;
    botState.lossesSession = 0;
    botState.totalTradesSession = 0;
    saveState();
    return res.json({ success: true, message: 'Historial limpiado' });
});

app.post('/api/sell-contract', (req, res) => {
    const WebSocket = require('ws');
    if (botState.currentContractId && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ sell: botState.currentContractId, price: 0 }));
        return res.json({ success: true, message: 'Orden de cierre enviada' });
    }
    res.status(400).json({ success: false, error: 'No hay contrato activo' });
});

app.post('/api/switch-market', (req, res) => {
    const { symbol } = req.body;
    if (botState.isRunning) return res.status(400).json({ success: false, error: 'Detén el bot primero' });

    botState.symbol = symbol;
    GOLD_CONFIG = MARKET_CONFIGS[symbol]; // Cargar la config de ese mercado
    candleHistory = []; // Limpiar velas del mercado anterior
    saveState();

    // Reconectar con el nuevo símbolo
    if (ws) ws.close();

    res.json({ success: true, symbol: botState.symbol, config: GOLD_CONFIG });
});

// --- LÓGICA DE TRADING ---
function connectDeriv() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        const marketName = botState.symbol === 'frxXAUUSD' ? 'ORO' : 'V100';
        console.log(`✅ Conectado a Deriv (Módulo ${marketName})`);
        // Priorizar token del entorno, luego token manual del estado si existiera, o el fallback
        const token = process.env.DERIV_TOKEN || 'TSuD37g6G593Uis';
        if (token === 'TSuD37g6G593Uis') {
            console.log("⚠️ ATENCIÓN: Usando token de respaldo. Asegúrate de configurar DERIV_TOKEN en Railway.");
        }
        ws.send(JSON.stringify({ authorize: token }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.msg_type === 'authorize') {
            console.log(`✅ Autenticado con éxito: ${msg.authorize.fullname || 'Usuario'}`);
            ws.send(JSON.stringify({ subscribe: 1, ticks: botState.symbol }));
            ws.send(JSON.stringify({
                ticks_history: botState.symbol,
                end: 'latest',
                count: 100,
                style: 'candles',
                granularity: GOLD_CONFIG.granularity,
                subscribe: 1
            }));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            console.log(`📡 Suscripciones enviadas para ${botState.symbol}`);
        }

        if (msg.error) {
            console.error(`⚠️ Error de Deriv [${msg.msg_type || 'N/A'}]: ${msg.error.message}`);
            if (msg.msg_type === 'ticks' || msg.msg_type === 'tick') {
                if (botState.symbol === 'frxXAUUSD') {
                    console.log(`⚠️ Re-intentando con símbolo alternativo: XAUUSD`);
                    botState.symbol = 'XAUUSD';
                    ws.send(JSON.stringify({ subscribe: 1, ticks: 'XAUUSD' }));
                    ws.send(JSON.stringify({
                        ticks_history: 'XAUUSD',
                        end: 'latest',
                        count: 100,
                        style: 'candles',
                        granularity: GOLD_CONFIG.granularity,
                        subscribe: 1
                    }));
                }
            }
        }

        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;

        if (msg.msg_type === 'candles') {
            candleHistory = msg.candles.map(c => ({
                epoch: c.epoch,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            }));
            console.log(`📡 Historial cargado: ${candleHistory.length} velas.`);
            processStrategy();
        }

        if (msg.msg_type === 'ohlc' && msg.ohlc) {
            const ohlc = msg.ohlc;
            const existing = candleHistory.find(c => c.epoch === ohlc.open_time);
            if (existing) {
                existing.close = ohlc.close;
                existing.high = ohlc.high;
                existing.low = ohlc.low;
            } else {
                candleHistory.push({ epoch: ohlc.open_time, open: ohlc.open, high: ohlc.high, low: ohlc.low, close: ohlc.close });
                if (candleHistory.length > 100) candleHistory.shift();
            }
            processStrategy();
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const quote = parseFloat(msg.tick.quote);
            if (!isNaN(quote)) {
                botState.lastTickPrice = quote;
                if (botState.currentContractId && botState.tradeStartTime) {
                    botState.tradeSeconds = Math.floor((Date.now() - botState.tradeStartTime) / 1000);
                }
            }
        }

        if (msg.msg_type === 'buy' && msg.buy) {
            botState.currentContractId = msg.buy.contract_id;
            botState.tradeStartTime = Date.now();
            isBuying = false;
            console.log(`🎯 POSICIÓN ABIERTA [${msg.buy.contract_id}]`);
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: msg.buy.contract_id,
                subscribe: 1
            }));
        } else if (msg.msg_type === 'buy' && msg.error) {
            isBuying = false;
            console.log(`⚠️ ERROR AL COMPRAR: ${msg.error.message}`);
        }

        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c) return;
            botState.tradeProfit = c.profit;
            if (c.is_sold) finalizeTrade(c);
        }
    });

    ws.on('close', () => setTimeout(connectDeriv, 5000));
}

function processStrategy() {
    if (candleHistory.length < GOLD_CONFIG.emaPeriod) return;

    const closes = candleHistory.map(c => c.close);
    const rsi = calculateRSI(closes, GOLD_CONFIG.rsiPeriod);
    const ema = calculateEMA(closes, GOLD_CONFIG.emaPeriod);
    const currentPrice = closes[closes.length - 1];

    const lastRSI = botState.lastRSI;
    botState.currentRSI = rsi;
    botState.currentEMA = ema;
    botState.lastRSI = rsi; // Actualizar para el siguiente tick

    if (!botState.isRunning || botState.currentContractId || isBuying) return;

    // LÓGICA DE CRUCE (Anti-ametralladora)
    // Buy: RSI cruza hacia arriba el nivel de sobreventa (venía de < 30 y ahora > 30)
    if (lastRSI <= GOLD_CONFIG.rsiOversold && rsi > GOLD_CONFIG.rsiOversold && currentPrice < ema) {
        executeTrade('MULTUP');
        console.log(`📡 SEÑAL COMPRA: RSI cruzó ${GOLD_CONFIG.rsiOversold} hacia arriba.`);
    }
    // Sell: RSI cruza hacia abajo el nivel de sobrecompra (venía de > 70 y ahora < 70)
    else if (lastRSI >= GOLD_CONFIG.rsiOverbought && rsi < GOLD_CONFIG.rsiOverbought && currentPrice > ema) {
        executeTrade('MULTDOWN');
        console.log(`📡 SEÑAL VENTA: RSI cruzó ${GOLD_CONFIG.rsiOverbought} hacia abajo.`);
    }
}

function executeTrade(type) {
    if (isBuying) return;
    isBuying = true;
    const req = {
        buy: 1,
        price: GOLD_CONFIG.stake,
        parameters: {
            amount: GOLD_CONFIG.stake,
            basis: 'stake',
            contract_type: type,
            currency: 'USD',
            symbol: botState.symbol,
            multiplier: GOLD_CONFIG.multiplier,
            limit_order: {
                // Cálculo dinámico según precio actual: (Movimiento / Precio) * Stake * Multiplicador
                take_profit: (GOLD_CONFIG.takeProfit / botState.lastTickPrice) * GOLD_CONFIG.stake * GOLD_CONFIG.multiplier,
                stop_loss: (GOLD_CONFIG.stopLoss / botState.lastTickPrice) * GOLD_CONFIG.stake * GOLD_CONFIG.multiplier
            }
        }
    };
    ws.send(JSON.stringify(req));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    botState.pnlSession += profit;
    botState.totalTradesSession++;
    if (profit > 0) botState.winsSession++; else botState.lossesSession++;

    botState.tradeHistory.unshift({
        type: c.contract_type === 'MULTUP' ? 'BUY 📈' : 'SELL 📉',
        profit: profit,
        time: new Date().toLocaleTimeString()
    });
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();

    botState.currentContractId = null;
    botState.tradeStartTime = null;
    saveState();
}

function calculateRSI(prices, period) {
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let cg = diff > 0 ? diff : 0;
        let cl = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + cg) / period;
        avgLoss = (avgLoss * (period - 1) + cl) / period;
    }
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}

function saveState() {
    try {
        const data = {
            botState: botState,
            marketConfigs: MARKET_CONFIGS
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(data));
    } catch (e) { }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 SERVIDOR ORO SNIPER LISTO EN PUERTO ${PORT}`);
    connectDeriv();
});
