const WebSocket = require('ws');

// CONFIGURACIÓN PRO: 3 MESES DE BACKTEST
const SYMBOL = 'frxXAUUSD';
const STAKE = 10;
const MULTIPLIER = 200;
const TP_MOVE = 1.00;
const SL_MOVE = 0.50;
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;

const APP_ID = 1089;
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let allCandles = [];
let monthsData = {};

ws.on('open', () => {
    console.log("🥇 Iniciando auditoría de 3 meses para Gold Sniper...");
    console.log("⏳ Descargando datos históricos (esto puede tardar unos segundos)...");

    // Pedimos las últimas 15,000 velas (Aprox 3 meses de mercado comercial)
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 15000,
        style: 'candles',
        granularity: 300
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        processBacktest(msg.candles);
        ws.close();
    }
});

function processBacktest(candles) {
    let activeTrade = null;
    let monthlyPnL = {};

    for (let i = EMA_PERIOD; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);
        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        const date = new Date(candles[i].epoch * 1000);
        const monthKey = date.toLocaleString('es-VE', { month: 'long', year: 'numeric' });

        if (!monthlyPnL[monthKey]) monthlyPnL[monthKey] = 0;

        if (!activeTrade) {
            if (rsi >= 70 && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice, monthKey };
            } else if (rsi <= 30 && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice, monthKey };
            }
        } else {
            const diff = currentPrice - activeTrade.entry;
            let profit = 0;

            if (activeTrade.type === 'BUY') {
                if (diff >= TP_MOVE) profit = calculateRealProfit(activeTrade.entry, TP_MOVE);
                else if (diff <= -SL_MOVE) profit = -calculateRealProfit(activeTrade.entry, SL_MOVE);
            } else {
                if (-diff >= TP_MOVE) profit = calculateRealProfit(activeTrade.entry, TP_MOVE);
                else if (-diff <= -SL_MOVE) profit = -calculateRealProfit(activeTrade.entry, SL_MOVE);
            }

            if (profit !== 0) {
                monthlyPnL[activeTrade.monthKey] += profit;
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 RESULTADOS DE 3 MESES (STAKE $10)");
    console.log("========================================");

    let total = 0;
    Object.keys(monthlyPnL).forEach(month => {
        console.log(`${month.toUpperCase()}: 🟢 PnL: $${monthlyPnL[month].toFixed(2)}`);
        total += monthlyPnL[month];
    });

    console.log("----------------------------------------");
    console.log(`PnL ACUMULADO TOTAL: $${total.toFixed(2)}`);
    console.log(`RETORNO TOTAL: ${((total / 100) * 100).toFixed(1)}%`);
    console.log("========================================\n");
}

function calculateRealProfit(entry, move) {
    // Fórmula exacta de Deriv Multipliers
    return (move / entry) * STAKE * MULTIPLIER;
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
