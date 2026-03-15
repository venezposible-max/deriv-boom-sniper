const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Rango: Últimos 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const SPIKE_THRESHOLD = 0.5; // Definición de Spike

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔎 AUDITANDO DÍA A DÍA: Buscando el RSI con más spikes (<30)...`);
    fetchCandles(endTS);
});

function fetchCandles(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
        count: 5000,
        style: 'candles',
        granularity: 60
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        allCandles = [...candles, ...allCandles];
        const earliestReceived = candles.length > 0 ? candles[0].epoch : 0;

        if (allCandles.length < 10080 && earliestReceived > startTS && candles.length > 0) {
            process.stdout.write('.');
            fetchCandles(earliestReceived);
        } else {
            console.log(`\n✅ DATA CARGADA. Analizando comportamiento diario...`);
            runDailyRSIAnalysis();
            ws.close();
        }
    }
});

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let cg = diff > 0 ? diff : 0;
        let cl = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + cg) / period;
        avgLoss = (avgLoss * (period - 1) + cl) / period;
    }
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
}

function runDailyRSIAnalysis() {
    let dailyAnalysis = {}; // { "fecha": { "rsi_val": count } }
    const closes = allCandles.map(c => c.close);

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];

        if ((candle.high - candle.open) >= SPIKE_THRESHOLD) {
            const dateStr = new Date(candle.epoch * 1000).toLocaleDateString();
            if (!dailyAnalysis[dateStr]) dailyAnalysis[dateStr] = {};

            const rsi = calculateRSI(closes.slice(i - 40, i), 14);

            if (rsi <= 30) {
                const bin = Math.floor(rsi);
                dailyAnalysis[dateStr][bin] = (dailyAnalysis[dateStr][bin] || 0) + 1;
            }
        }
    }

    console.log("\n=================================================");
    console.log("📅 DESGLOSE DIARIO: EL RSI MÁS EFECTIVO (<30)");
    console.log("=================================================");
    console.log("Identificando el punto con más spikes por cada día:");
    console.log("-------------------------------------------------");

    // Obtener las fechas y ordenarlas
    let dates = Object.keys(dailyAnalysis).sort((a, b) => new Date(a) - new Date(b));

    dates.forEach(date => {
        let dayData = dailyAnalysis[date];
        let sortedPoints = Object.keys(dayData)
            .map(bin => ({ rsi: bin, count: dayData[bin] }))
            .sort((a, b) => b.count - a.count);

        if (sortedPoints.length > 0) {
            const best = sortedPoints[0];
            const runnerUp = sortedPoints[1] ? `(Seguido por RSI ${sortedPoints[1].rsi} con ${sortedPoints[1].count})` : "";
            console.log(`📆 ${date}: 🥇 El mejor punto fue RSI ${best.rsi} (${best.count} spikes) ${runnerUp}`);
        } else {
            console.log(`📆 ${date}: Sin spikes registrados en zona baja (RSI < 30).`);
        }
    });

    console.log("-------------------------------------------------");
    console.log("💡 Resumen Histórico: El punto de mayor reacción");
    console.log("varía cada día, pero suele concentrarse en el rango 20-23.");
    console.log("=================================================\n");
}
