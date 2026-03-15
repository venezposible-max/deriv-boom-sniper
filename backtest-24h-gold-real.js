const WebSocket = require('ws');

// CONFIGURACIÓN DEL BACKTEST - 24 HORAS REALISTAS
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

// Parámetros de Riesgo del Usuario (Base $100 total, $10 stake)
const STAKE = 10;
const MULTIPLIER = 200;
const TP_LEVEL = 1.00; // $1.00 de movimiento de precio del Oro
const SL_LEVEL = 0.50; // $0.50 de movimiento de precio del Oro

// Configuración de Estrategia
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;
const RSI_OB = 70;
const RSI_OS = 30;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("🥇 Calculando Backtest Gold Sniper - Últimas 24 Horas...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 350, // 24h son 288 velas M5 + margen para indicadores
        style: 'candles',
        granularity: 300 // M5
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
    let history = [];

    // Empezamos después de tener suficientes velas para EMA
    for (let i = EMA_PERIOD; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);

        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        if (!activeTrade) {
            // BUSCAR ENTRADA (Misma lógica que el bot real)
            if (rsi >= RSI_OB && currentPrice > ema) {
                activeTrade = {
                    type: 'SELL',
                    entry: currentPrice,
                    time: new Date(candles[i].epoch * 1000).toLocaleString('es-VE')
                };
            } else if (rsi <= RSI_OS && currentPrice < ema) {
                activeTrade = {
                    type: 'BUY',
                    entry: currentPrice,
                    time: new Date(candles[i].epoch * 1000).toLocaleString('es-VE')
                };
            }
        } else {
            // MONITOREAR TRADE
            let diff = currentPrice - activeTrade.entry;
            let profit = 0;

            // Lógica de PnL para $10 Stake (Ratio 2:1)
            // Si Stake 50 -> TP 100 / SL 50
            // Si Stake 10 -> TP 20 / SL 10
            if (activeTrade.type === 'BUY') {
                if (diff >= TP_LEVEL) profit = 20;
                else if (diff <= -SL_LEVEL) profit = -10;
            } else {
                if (diff <= -TP_LEVEL) profit = 20;
                else if (diff >= SL_LEVEL) profit = -10;
            }

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalPnL += profit;
                history.push({
                    ...activeTrade,
                    exit: currentPrice,
                    profit: profit,
                    endTime: new Date(candles[i].epoch * 1000).toLocaleTimeString()
                });
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 REPORTE 24H: CUENTA PEQUEÑA ($100)");
    console.log("========================================");
    console.log(`Stake: $10.00 | Multiplicador: x200`);
    console.log(`TP: $1.00 (mov) | SL: $0.50 (mov)`);
    console.log("----------------------------------------");
    console.log(`Total de tiros: ${history.length}`);
    console.log(`Ganados 🟢: ${wins}`);
    console.log(`Perdidos 🔴: ${losses}`);
    console.log(`Win Rate: ${((wins / history.length) * 100).toFixed(1)}%`);
    console.log("----------------------------------------");
    console.log(`PnL TOTAL: $${totalPnL.toFixed(2)}`);
    console.log(`Retorno sobre cuenta de $100: ${totalPnL.toFixed(1)}%`);
    console.log("========================================\n");
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
