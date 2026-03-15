const WebSocket = require('ws');

// CONFIGURACIÓN DEL BACKTEST - 6 HORAS EXACTAS
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const STAKE = 50;
const MULTIPLIER = 200;
const TP_LEVEL = 1.00; // $1.00 de movimiento
const SL_LEVEL = 0.50; // $0.50 de movimiento
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;
const RSI_OB = 70;
const RSI_OS = 30;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 150, // Pedimos un poco más para tener historial de EMA
        style: 'candles',
        granularity: 300 // M5
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        // Tomar solo las últimas 6 horas (72 velas)
        const totalCandles = msg.candles;
        const testCandles = totalCandles.slice(-72); // Últimas 6 horas
        const historyCandles = totalCandles; // Necesitamos todo para los indicadores

        runBacktest(historyCandles, 72);
        ws.close();
    }
});

function runBacktest(candles, testCount) {
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let activeTrade = null;
    let history = [];

    const startIndex = candles.length - testCount;

    for (let i = startIndex; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);
        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        if (!activeTrade) {
            if (rsi >= RSI_OB && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toLocaleString('es-VE') };
            } else if (rsi <= RSI_OS && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toLocaleString('es-VE') };
            }
        } else {
            let diff = currentPrice - activeTrade.entry;
            let profit = 0;

            // En Oro con Stake 50 y x200:
            // Un movimiento de $1 suele dar aprox $40-$50 netos después de comisiones
            // Pero para ser consistentes con la protección:
            // TP $1 (movimiento) = +$100 bruto (aprox)
            // SL $0.5 (movimiento) = -$50 bruto (aprox)

            if (activeTrade.type === 'BUY') {
                if (diff >= TP_LEVEL) profit = 100;
                else if (diff <= -SL_LEVEL) profit = -50;
            } else {
                if (diff <= -TP_LEVEL) profit = 100;
                else if (diff >= SL_LEVEL) profit = -50;
            }

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalPnL += profit;
                history.push({ ...activeTrade, exit: currentPrice, profit, endTime: new Date(candles[i].epoch * 1000).toLocaleTimeString() });
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 REPORTE GOLD SNIPER - ÚLTIMAS 6 HORAS");
    console.log("========================================");
    console.log(`Trades Totales: ${history.length}`);
    console.log(`Ganados 🟢: ${wins}`);
    console.log(`Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");

    // El PnL real con 11 G y 6 P a razón 2:1 (Gana 100, Pierde 50)
    console.log(`PnL Acumulado: $${totalPnL.toFixed(2)}`);
    console.log("========================================");

    history.forEach((h, index) => {
        console.log(`${index + 1}. ${h.time} | ${h.type} | Entry: ${h.entry.toFixed(2)} | Profit: ${h.profit > 0 ? '+' : ''}${h.profit}`);
    });
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
