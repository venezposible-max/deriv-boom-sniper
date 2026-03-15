const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;
const TOTAL_TICKS_NEEDED = 320000; // ~7 Días de Boom 500

const CONFIG = {
    stake: 20,
    takeProfit: 4.00,
    stopLoss: 2.50,
    multiplier: 200,
    timeStopTicks: 50,
    rsiThreshold: 75,
    antiSpikeLimit: 0.1,
    harvestMaxTicks: 300,
    cooldownSecondsWin: 45,
    cooldownSecondsLoss: 180 // 3 Minutos de enfriamiento tras pérdida
};

let allTicks = [];
let allTimes = [];

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para BOOM 500 - TREND GRINDER (SEMANAL - 7D)...`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch || 'latest',
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

        if (allTicks.length < TOTAL_TICKS_NEEDED && prices.length > 0) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n\n✅ DATA CARGADA: ${allTicks.length} ticks. Analizando Estrategia Semanal...`);
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
        const time = times[i];
        const price = prices[i];
        let minuteExact = Math.floor(time / 60) * 60;

        if (minuteExact !== currentMinute) {
            if (currentMinute !== -1) candles.push(currentClose);
            currentMinute = minuteExact;
        }
        currentClose = price;
    }
    candles.push(currentClose);
    return candles;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

    let startIndex = prices.length - 60;
    if (startIndex < 1) startIndex = 1;

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = startIndex; i < startIndex + period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff;
        else if (diff < 0) avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = startIndex + period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let currentGain = (diff > 0) ? diff : 0;
        let currentLoss = (diff < 0) ? Math.abs(diff) : 0;
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
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
                if (profit > 0) {
                    wins++;
                    cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsWin;
                } else {
                    losses++;
                    cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsLoss;
                }
                inTrade = false;
                tradeHistory.push({ type: "SELL ↘️", profit, reason, time: new Date(openTime * 1000).toLocaleDateString() + ' ' + new Date(openTime * 1000).toLocaleTimeString() });
            }
        } else if (currentTime >= cooldownExpiryTime) {
            const subPrices = allTicks.slice(i - 4000, i + 1);
            const subTimes = allTimes.slice(i - 4000, i + 1);
            const candles = buildM1Candles(subTimes, subPrices);
            const rsi = calculateRSI(candles, 14);

            if (rsi >= CONFIG.rsiThreshold && quote < prevQuote) {
                inTrade = true;
                entryPrice = quote;
                openTime = currentTime;
                ticksInTrade = 0;
                trades++;
            }
        }
    }

    console.log("\n=========================================");
    console.log("🌾 RESULTADO TREND GRINDER (SEMANAL - 7D)");
    console.log("=========================================");
    console.log(`Configuración: RSI ${CONFIG.rsiThreshold} | Cooldown Loss: ${CONFIG.cooldownSecondsLoss}s`);
    console.log(`Total Trades Realizados: ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Neto Semanal: $${balance.toFixed(2)} 💰`);
    console.log(`Win Rate Semanal: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log("-----------------------------------------");
    console.log("RESUMEN DE PÉRDIDAS (Spikes):");
    const lossesList = tradeHistory.filter(t => t.profit < 0);
    if (lossesList.length === 0) console.log("¡Increíble! Ninguna pérdida en toda la semana.");
    else {
        lossesList.slice(-15).forEach(t => {
            console.log(`[${t.time}] 🚨 ${t.reason} | PnL: ${t.profit.toFixed(2)}$`);
        });
        if (lossesList.length > 15) console.log(`... y otras ${lossesList.length - 15} pérdidas más.`);
    }
    console.log("=========================================\n");
}
