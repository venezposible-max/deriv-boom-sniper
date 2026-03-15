const WebSocket = require('ws');

// CONFIGURACIÓN REALISTA - ÚLTIMAS 24 HORAS
const SYMBOL = 'frxXAUUSD';
const STAKE = 10;
const MULTIPLIER = 200;
const TP_MOVE = 1.00; // El objetivo de movimiento del precio
const SL_MOVE = 0.50; // La protección de movimiento del precio
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;

const APP_ID = 1089;
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("🥇 Calculando PnL Real para hoy (Últimas 24h)...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 350,
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
    let totalDollarPnL = 0;
    let activeTrade = null;

    for (let i = EMA_PERIOD; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);
        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        if (!activeTrade) {
            if (rsi >= 70 && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice };
            } else if (rsi <= 30 && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice };
            }
        } else {
            const diff = currentPrice - activeTrade.entry;
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
                totalDollarPnL += profit;
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 PnL REAL DE HOY (STAKE $10)");
    console.log("========================================");
    console.log(`Trades Realizados: ${wins + losses}`);
    console.log(`Ganados 🟢: ${wins}`);
    console.log(`Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    console.log(`GANANCIA NETA: $${totalDollarPnL.toFixed(2)} USD`);
    console.log("========================================\n");
    console.log(`Nota: Con $10 de stake y $1 de movimiento, ganas ~$0.40 por vez.`);
    console.log(`Para ganar más, necesitas o más Stake o un TP más largo.`);
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
