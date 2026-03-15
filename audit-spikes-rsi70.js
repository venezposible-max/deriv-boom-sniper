const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;
const TOTAL_TICKS_NEEDED = 50000;

const SPIKE_THRESHOLD = 0.8; // Definición de Spike (Salto mayor a 0.8 puntos en un tick)

let allTicks = [];
let allTimes = [];

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔍 AUDITANDO SPIKES EN BOOM 500 (Últimas 24H) con RSI > 75...`);
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
            console.log(`\n✅ DATA CARGADA. Analizando comportamiento...`);
            auditSpikesAboveRSI75();
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
        if (diff > 0) avgGain += diff;
        else avgLoss += Math.abs(diff);
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

function auditSpikesAboveRSI75() {
    let spikesAbove75 = 0;
    let totalSpikes = 0;
    let timestamps = [];

    // Necesitamos historial para el RSI (ventana de 4000 ticks)
    for (let i = 4000; i < allTicks.length; i++) {
        const quote = allTicks[i];
        const prevQuote = allTicks[i - 1];
        const diff = quote - prevQuote;

        // Si es un spike (movimiento alcista violento)
        if (diff >= SPIKE_THRESHOLD) {
            totalSpikes++;

            // Evaluamos RSI en ese preciso instante
            const subPrices = allTicks.slice(i - 4000, i);
            const subTimes = allTimes.slice(i - 4000, i);
            const candles = buildM1Candles(subTimes, subPrices);
            const rsi = calculateRSI(candles, 14);

            if (rsi >= 75) {
                spikesAbove75++;
                timestamps.push({
                    time: new Date(allTimes[i] * 1000).toLocaleTimeString(),
                    rsi: rsi.toFixed(1),
                    size: diff.toFixed(2)
                });
            }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ AUDITORÍA DE SPIKES: BOOM 500 (24H)");
    console.log("=========================================");
    console.log(`Total Spikes Detectados: ${totalSpikes}`);
    console.log(`Spikes con RSI >= 75: ${spikesAbove75} 🚩`);
    console.log(`Peligro en Zona de Trend: ${((spikesAbove75 / totalSpikes) * 100).toFixed(1)}%`);
    console.log("-----------------------------------------");
    if (timestamps.length > 0) {
        console.log("Muestra de Spikes Prohibidos (RSI > 75):");
        timestamps.slice(-10).forEach(s => {
            console.log(`[${s.time}] 🚨 Spike de ${s.size} pts | RSI: ${s.rsi}`);
        });
    } else {
        console.log("✅ No se detectaron spikes en zona de sobrecompra extrema (RSI > 75).");
    }
    console.log("=========================================\n");
}
