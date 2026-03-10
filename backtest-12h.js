const WebSocket = require('ws');

const TICK_COUNT = 43200; // 12 horas aprox (60 * 60 * 12)
const SYMBOL = 'BOOM1000';
const CONFIG = {
    stake: 20,
    takeProfit: 50.00,
    stopLoss: 1.00,
    multiplier: 200,
    timeStopTicks: 15,
    cooldownSecondsWin: 45,
    cooldownSecondsLoss: 3
};

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let currentGain = diff > 0 ? diff : 0;
        let currentLoss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function buildM1Candles(times, prices) {
    let candles = [];
    let currentMinute = -1;
    let currentClose = 0;
    for (let i = 0; i < times.length; i++) {
        let minuteExact = Math.floor(times[i] / 60) * 60;
        if (minuteExact !== currentMinute) {
            if (currentMinute !== -1) candles.push(currentClose);
            currentMinute = minuteExact;
        }
        currentClose = prices[i];
    }
    candles.push(currentClose);
    return candles;
}

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    console.log("Conectando para extracción de 12 horas...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        count: 5000, // Deriv limita a 5000 por llamada
        end: 'latest',
        style: 'ticks'
    }));
});

let allPrices = [];
let allTimes = [];

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        allPrices = msg.history.prices;
        allTimes = msg.history.times;
        console.log(`Recuperados ${allPrices.length} ticks iniciales.`);
        runBacktest();
        ws.close();
    }
});

function runBacktest() {
    let state = {
        inTrade: false,
        openPrice: 0,
        openTime: 0,
        cooldownExpiry: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        trades: []
    };

    const total = allPrices.length;
    // Necesitamos al menos 1 hora de data previa para el RSI M1 estable (60 ticks * 14 periodos aprox)
    // Pero como downsampleamos, 4000 ticks son apenas 66 velas M1.
    for (let i = 2000; i < total; i++) {
        const quote = allPrices[i];
        const currentTime = allTimes[i];

        if (state.inTrade) {
            const spread = CONFIG.stake * 0.0185;
            const profit = (((quote - state.openPrice) / state.openPrice) * CONFIG.stake * CONFIG.multiplier) - spread;
            const elapsed = currentTime - state.openTime;

            let closed = false, reason = "";
            if (profit >= CONFIG.takeProfit) { closed = true; reason = "TAKE PROFIT"; }
            else if (profit <= -CONFIG.stopLoss) { closed = true; reason = "STOP LOSS"; }
            else if (elapsed >= CONFIG.timeStopTicks && profit < 2) { closed = true; reason = "TIME-STOP"; }

            if (closed) {
                state.inTrade = false;
                state.pnl += profit;
                if (profit > 0) { state.wins++; state.cooldownExpiry = currentTime + CONFIG.cooldownSecondsWin; }
                else { state.losses++; state.cooldownExpiry = currentTime + CONFIG.cooldownSecondsLoss; }
                state.trades.push({ profit, reason, time: new Date(currentTime * 1000).toLocaleTimeString() });
                continue;
            }
        }

        if (!state.inTrade && currentTime >= state.cooldownExpiry) {
            // Ultimos 2000 ticks para recalcular indicadores
            const subPrices = allPrices.slice(i - 2000, i + 1);
            const subTimes = allTimes.slice(i - 2000, i + 1);
            const candles = buildM1Candles(subTimes, subPrices);
            const rsi = calculateRSI(candles, 14);

            if (rsi <= 25) {
                state.inTrade = true;
                state.openPrice = quote;
                state.openTime = currentTime;
            }
        }
    }

    console.log("\n========================================");
    console.log("   RESULTADO BACKTEST (ÚLTIMA DATA DISPONIBLE)");
    console.log("========================================");
    console.log(`Período analizado: ${((allTimes[total - 1] - allTimes[0]) / 3600).toFixed(2)} horas`);
    console.log(`Ticks procesados: ${total}`);
    console.log(`Trades Totales: ${state.wins + state.losses}`);
    console.log(`Ganados: ${state.wins} | Perdidos: ${state.losses}`);
    console.log(`PnL Neto Final: $${state.pnl.toFixed(2)}`);
    console.log("========================================\n");
}
