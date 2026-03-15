const WebSocket = require('ws');

// CONFIGURACIÓN DEL BACKTEST - 1 MES (30 DÍAS)
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

// Parámetros de Riesgo del Usuario (Base $100 total, $10 stake)
const STAKE = 10;
const MULTIPLIER = 200;
const TP_LEVEL = 1.00; // $1.00 de movimiento de precio del Oro ($20 de beneficio aprox)
const SL_LEVEL = 0.50; // $0.50 de movimiento de precio del Oro ($10 de pérdida aprox)

// Configuración de Estrategia
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;
const RSI_OB = 70;
const RSI_OS = 30;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("🥇 Analizando Backtest Gold Sniper - ÚLTIMO MES (30 DÍAS)...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000, // Aproximadamente 1 mes en M5 para el Oro (semana comercial)
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
    let weeklyStats = {}; // Agrupamos por semana para no saturar la consola

    for (let i = EMA_PERIOD; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);

        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        // Detectar semana
        const date = new Date(candles[i].epoch * 1000);
        const weekNumber = getWeekNumber(date);
        const weekKey = `Semana ${weekNumber}`;

        if (!weeklyStats[weekKey]) weeklyStats[weekKey] = { pnl: 0, w: 0, l: 0 };

        if (!activeTrade) {
            if (rsi >= RSI_OB && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice, weekKey };
            } else if (rsi <= RSI_OS && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice, weekKey };
            }
        } else {
            let diff = currentPrice - activeTrade.entry;
            let profit = 0;

            if (activeTrade.type === 'BUY') {
                if (diff >= TP_LEVEL) profit = 20;
                else if (diff <= -SL_LEVEL) profit = -10;
            } else {
                if (diff <= -TP_LEVEL) profit = 20;
                else if (diff >= SL_LEVEL) profit = -10;
            }

            if (profit !== 0) {
                if (profit > 0) {
                    wins++;
                    weeklyStats[activeTrade.weekKey].w++;
                } else {
                    losses++;
                    weeklyStats[activeTrade.weekKey].l++;
                }
                totalPnL += profit;
                weeklyStats[activeTrade.weekKey].pnl += profit;
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 REPORTE MENSUAL: GOLD SNIPER PRO");
    console.log("========================================");
    console.log(`Stake: $10.00 | Multiplicador: x200`);
    console.log("----------------------------------------");

    console.log("RENDIMIENTO POR SEMANAS:");
    Object.keys(weeklyStats).forEach(week => {
        const s = weeklyStats[week];
        console.log(`${week}: 🟢 PnL: $${s.pnl.toFixed(2)} (${s.w}G - ${s.l}P)`);
    });

    console.log("----------------------------------------");
    console.log(`OPERACIONES TOTALES: ${wins + losses}`);
    console.log(`Ganados 🟢: ${wins}`);
    console.log(`Perdidos 🔴: ${losses}`);
    console.log(`Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
    console.log("----------------------------------------");
    console.log(`PnL TOTAL DEL MES: $${totalPnL.toFixed(2)}`);

    const capitalFinal = 100 + totalPnL;
    console.log(`CUENTA DE $100 TENDRÍA: $${capitalFinal.toFixed(2)}`);
    console.log(`Retorno Mensual: ${((totalPnL / 100) * 100).toFixed(1)}%`);
    console.log("========================================\n");
}

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
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
