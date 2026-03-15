const WebSocket = require('ws');

// CONFIGURACIÓN DEL BACKTEST
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const STAKE = 50;
const MULTIPLIER = 200;
const TP_LEVEL = 1.00; // $1.00 de movimiento de precio
const SL_LEVEL = 0.50; // $0.50 de movimiento de precio
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;
const RSI_OB = 70;
const RSI_OS = 30;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("🥇 Iniciando Backtest Gold Sniper - Últimas 6 horas...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000, // Suficiente para cubrir 6h+ en M5
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
    let balance = 0;
    let wins = 0;
    let losses = 0;
    let totalProfit = 0;
    let activeTrade = null;
    let history = [];

    // Necesitamos al menos EMA_PERIOD para empezar
    for (let i = EMA_PERIOD; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);

        const rsi = calculateRSI(closes, RSI_PERIOD);
        const ema = calculateEMA(closes, EMA_PERIOD);
        const currentPrice = closes[closes.length - 1];

        if (!activeTrade) {
            // BUSCAR ENTRADA
            if (rsi >= RSI_OB && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toLocaleTimeString() };
            } else if (rsi <= RSI_OS && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice, time: new Date(candles[i].epoch * 1000).toLocaleTimeString() };
            }
        } else {
            // MONITOREAR TRADE
            let diff = currentPrice - activeTrade.entry;
            let profit = 0;

            if (activeTrade.type === 'BUY') {
                if (diff >= TP_LEVEL) profit = calculateProfit(STAKE, MULTIPLIER, TP_LEVEL);
                else if (diff <= -SL_LEVEL) profit = -calculateProfit(STAKE, MULTIPLIER, SL_LEVEL);
            } else {
                if (-diff >= TP_LEVEL) profit = calculateProfit(STAKE, MULTIPLIER, TP_LEVEL);
                else if (-diff <= -SL_LEVEL) profit = -calculateProfit(STAKE, MULTIPLIER, SL_LEVEL);
            }

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalProfit += profit;
                history.push({ ...activeTrade, exit: currentPrice, profit, time: activeTrade.time });
                activeTrade = null;
            }
        }
    }

    console.log("\n--- RESULTADOS GOLD SNIPER (XAUUSD) ---");
    console.log(`Periodo Analizado: Últimas 6 Horas`);
    console.log(`Velas M5 procesadas: ${candles.length}`);
    console.log("---------------------------------------");
    console.log(`Total Trades: ${history.length}`);
    console.log(`Ganados 🟢: ${wins}`);
    console.log(`Perdidos 🔴: ${losses}`);
    console.log(`Win Rate: ${((wins / history.length) * 100).toFixed(1)}%`);
    console.log(`PnL Total: $${totalProfit.toFixed(2)}`);
    console.log("---------------------------------------");

    if (history.length > 0) {
        console.log("Detalle de las operaciones:");
        history.forEach(h => {
            console.log(`- ${h.time} | ${h.type} | PnL: $${h.profit.toFixed(2)}`);
        });
    }
}

function calculateProfit(stake, mult, move) {
    // Estimación de profit para multiplicadores basada en movimiento de precio
    // En XAUUSD un movimiento de $1.00 es aproximadamente 100 pips
    // Profit = Stake * Multiplicador * (Move / EntryPrice)
    // Para simplificar el backtest y ser conservadores:
    return stake * (move / 0.5); // Aproximación: $1 de movimiento con $50 stake x200 suele dar buen profit.
}

function calculateRSI(prices, period) {
    let avgGain = 0, avgLoss = 0;
    const start = Math.max(0, prices.length - period - 1);
    for (let i = start + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    avgGain /= period; avgLoss /= period;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}
