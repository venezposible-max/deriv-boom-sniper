const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Fecha: 9 de Marzo de 2026 (Hace 2 días)
const targetDate = new Date('2026-03-09T00:00:00Z');
const endTS = Math.floor(new Date('2026-03-09T23:59:59Z').getTime() / 1000);
const startTS = Math.floor(targetDate.getTime() / 1000);

const TOTAL_TICKS_NEEDED = 45000;

const CONFIG = {
    stake: 20,
    takeProfit: 4.00,
    stopLoss: 2.50,
    multiplier: 200,
    timeStopTicks: 50,
    rsiThreshold: 75, // Mantenemos la recomendada
    antiSpikeLimit: 0.1,
    harvestMaxTicks: 300,
    cooldownSecondsWin: 45,
    cooldownSecondsLoss: 180
};

let allTicks = [];
let allTimes = [];

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para BOOM 500 (Fecha: 2026-03-09)...`);
    fetchTicks(endTS);
});

function fetchTicks(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices || [];
        const times = msg.history.times || [];

        allTicks = [...prices, ...allTicks];
        allTimes = [...times, ...allTimes];

        if (allTicks.length < TOTAL_TICKS_NEEDED && prices.length > 0 && times[0] > (startTS - 5000)) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA CARGADA: ${allTicks.length} ticks. Analizando Trend Grinder (RSI 75)...`);
            runTrendGrinderBacktest();
            ws.close();
        }
    }
});

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

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let startIndex = Math.max(1, prices.length - 60);
    let avgGain = 0, avgLoss = 0;
    for (let i = startIndex; i < startIndex + period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff; else if (diff < 0) avgLoss += Math.abs(diff);
    }
    avgGain /= period; avgLoss /= period;
    for (let i = startIndex + period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let cg = diff > 0 ? diff : 0;
        let cl = diff < 0 ? Math.abs(diff) : 0;
        avgGain = ((avgGain * (period - 1)) + cg) / period;
        avgLoss = ((avgLoss * (period - 1)) + cl) / period;
    }
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
}

function runTrendGrinderBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, openTime = 0, ticksInTrade = 0;
    let cooldownExpiryTime = 0;
    let tradeHistory = [];

    for (let i = 4000; i < allTicks.length; i++) {
        const quote = allTicks[i];
        const currentTime = allTimes[i];
        const prevQuote = allTicks[i - 1];

        if (inTrade) {
            ticksInTrade++;
            const secondsElapsed = currentTime - openTime;
            const profit = ((entryPrice - quote) / entryPrice) * CONFIG.multiplier * CONFIG.stake;

            let closed = false, reason = "";
            if (quote > entryPrice + CONFIG.antiSpikeLimit) { closed = true; reason = "🛡️ ANTI-SPIKE"; }
            else if (profit >= CONFIG.takeProfit) { closed = true; reason = "🎯 TAKE PROFIT"; }
            else if (profit <= -CONFIG.stopLoss) { closed = true; reason = "🛡️ STOP LOSS"; }
            else if (secondsElapsed >= CONFIG.timeStopTicks && profit < 2.00) { closed = true; reason = "⏱️ TIME-STOP"; }
            else if (ticksInTrade >= CONFIG.harvestMaxTicks) { closed = true; reason = "🌾 COSECHA MAX"; }

            if (closed) {
                balance += profit;
                if (profit > 0) { wins++; cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsWin; }
                else { losses++; cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsLoss; }
                inTrade = false;
                tradeHistory.push({ time: new Date(openTime * 1000).toLocaleTimeString(), profit, reason });
            }
        } else if (currentTime >= cooldownExpiryTime) {
            const rsi = calculateRSI(buildM1Candles(allTimes.slice(i - 4000, i), allTicks.slice(i - 4000, i)), 14);
            if (rsi >= CONFIG.rsiThreshold && quote < prevQuote) {
                inTrade = true; entryPrice = quote; openTime = currentTime; ticksInTrade = 0; trades++;
            }
        }
    }

    console.log("\n=========================================");
    console.log("🌾 TREND GRINDER: BOOM 500 (Hace 2 Días)");
    console.log("=========================================");
    console.log(`Fecha Auditoría: 9 de Marzo, 2026`);
    console.log(`Total Trades: ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Neto: $${balance.toFixed(2)} 💰`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log("-----------------------------------------");
    const spikeLosses = tradeHistory.filter(t => t.profit < 0);
    console.log(`Spikes Incidentes: ${spikeLosses.length}`);
    spikeLosses.forEach(s => console.log(`[${s.time}] 🚨 ${s.reason} | PnL: ${s.profit.toFixed(2)}$`));
    console.log("=========================================\n");
}
