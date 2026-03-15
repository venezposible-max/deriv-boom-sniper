const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST V100 - DÍA DE AYER (11 MARZO 2026)
const APP_ID = 1089;
const SYMBOL = 'R_100';
const STAKE = 10;
const MULTIPLIER = 200;
const TP_MOVE = 1.00;
const SL_MOVE = 0.50;
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;

// Cálculo de fechas para "Ayer" (11 de Marzo de 2026)
// Usamos UTC para precisión en el backtest del servidor de Deriv
const startOfYesterday = new Date('2026-03-11T00:00:00Z').getTime() / 1000;
const endOfYesterday = new Date('2026-03-11T23:59:59Z').getTime() / 1000;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📊 Iniciando Auditoría V100 - Día: 11 de Marzo`);
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: Math.floor(endOfYesterday),
        count: 500, // Velas suficientes para cubrir el día y el calentamiento de indicadores
        style: 'candles',
        granularity: 300
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        runBacktest(msg.candles);
        ws.close();
    }
});

function runBacktest(candles) {
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let activeTrade = null;
    let lastRSI = 50;
    let history = [];

    for (let i = EMA_PERIOD; i < candles.length; i++) {
        const timeAtCandle = candles[i].epoch;
        // Solo procesamos trades que EMPIECEN ayer
        const isYesterday = timeAtCandle >= startOfYesterday && timeAtCandle <= endOfYesterday;

        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);
        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        if (!activeTrade && isYesterday) {
            // LÓGICA DE CRUCE RSI (Sniper)
            if (lastRSI <= 30 && rsi > 30 && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toUTCString() };
            } else if (lastRSI >= 70 && rsi < 70 && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toUTCString() };
            }
        } else if (activeTrade) {
            let diff = currentPrice - activeTrade.entry;
            let profit = 0;

            if (activeTrade.type === 'BUY') {
                if (diff >= TP_MOVE) profit = (TP_MOVE / activeTrade.entry) * STAKE * MULTIPLIER;
                else if (diff <= -SL_MOVE) profit = -((SL_MOVE / activeTrade.entry) * STAKE * MULTIPLIER);
            } else {
                if (-diff >= TP_MOVE) profit = (TP_MOVE / activeTrade.entry) * STAKE * MULTIPLIER;
                else if (-diff <= -SL_MOVE) profit = -((SL_MOVE / activeTrade.entry) * STAKE * MULTIPLIER);
            }

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalPnL += profit;
                history.push({ ...activeTrade, profit, exitTime: new Date(candles[i].epoch * 1000).toUTCString() });
                activeTrade = null;
            }
        }
        lastRSI = rsi;
    }

    console.log("\n========================================");
    console.log("📊 RESULTADO V100 - AYER (11 DE MARZO)");
    console.log("========================================");
    console.log(`Total Trades: ${history.length}`);
    console.log(`Ganados 🟢: ${wins} | Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    console.log(`PnL NETO (Stake $10): $${totalPnL.toFixed(2)} USD`);
    console.log(`Eficacia: ${((wins / history.length) * 100).toFixed(1)}%`);
    console.log("========================================\n");

    if (history.length > 0) {
        console.log("Muestra de trades de ayer:");
        history.forEach((h, idx) => {
            console.log(`${idx + 1}. [${h.time}] ${h.type} -> PnL: ${h.profit > 0 ? '🟢' : '🔴'} $${h.profit.toFixed(2)}`);
        });
    }
}

function calculateRSI(prices, period) {
    let avgGain = 0, avgLoss = 0;
    const slice = prices.slice(-period - 1);
    for (let i = 1; i < slice.length; i++) {
        let diff = slice[i] - slice[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}
