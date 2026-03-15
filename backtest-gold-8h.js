const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST - ÚLTIMAS 8 HORAS
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const STAKE = 10; // Base $10 para cuenta de $100
const MULTIPLIER = 200;
const TP_MOVE = 1.00;
const SL_MOVE = 0.50;
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("🥇 Calculando Backtest Gold Sniper - Últimas 8 Horas...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 150, // 8h em M5 são 96 velas, pedimos 150 para histórico de EMA/RSI
        style: 'candles',
        granularity: 300
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles;
        runBacktest(candles);
        ws.close();
    }
});

function runBacktest(candles) {
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let activeTrade = null;
    let history = [];

    // Processamos apenas as últimas 96 velas (8 horas)
    const startIndex = candles.length - 96;

    for (let i = EMA_PERIOD; i < candles.length; i++) {
        // Só registramos trades que iniciaram dentro das últimas 8 horas
        const isWithinRange = i >= startIndex;

        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);
        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        if (!activeTrade && isWithinRange) {
            if (rsi >= 70 && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toLocaleTimeString() };
            } else if (rsi <= 30 && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toLocaleTimeString() };
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
                history.push({ ...activeTrade, profit, exitTime: new Date(candles[i].epoch * 1000).toLocaleTimeString() });
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 REPORTE GOLD SNIPER - ÚLTIMAS 8 HORAS");
    console.log("========================================");
    console.log(`Periodo: Desde las ${new Date(candles[startIndex].epoch * 1000).toLocaleTimeString()} hasta ahora`);
    console.log(`Trades Totales: ${history.length}`);
    console.log(`Ganados 🟢: ${wins}`);
    console.log(`Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    console.log(`PnL PROMEDIO (Stake $10): $${totalPnL.toFixed(2)}`);
    console.log(`PnL PROMEDIO (Stake $50): $${(totalPnL * 5).toFixed(2)}`);
    console.log("========================================\n");

    if (history.length > 0) {
        console.log("Detalle de trades:");
        history.forEach((h, idx) => {
            console.log(`${idx + 1}. ${h.time} | ${h.type} | PnL ($10 stake): ${h.profit > 0 ? '+' : ''}$${h.profit.toFixed(2)}`);
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
