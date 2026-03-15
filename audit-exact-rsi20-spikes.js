const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Rango: Últimos 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const SPIKE_THRESHOLD = 0.5; // Definición de Spike
const TARGET_RSI = 20.0;
const VECINDAD = 0.5; // Rango exacto (19.5 a 20.5)

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔎 AUDITORÍA PUNTO EXACTO: Spikes en RSI 20.0 (±${VECINDAD}) - BOOM 500...`);
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
            console.log(`\n✅ DATA CARGADA. Analizando coincidencias exactas...`);
            runExactAudit();
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

function runExactAudit() {
    let dailyData = {};
    const closes = allCandles.map(c => c.close);

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];
        const dateStr = new Date(candle.epoch * 1000).toLocaleDateString();

        if (!dailyData[dateStr]) {
            dailyData[dateStr] = { exactHits: 0, spikesAtPoint: 0 };
        }

        // Calculamos el RSI que había JUSTO ANTES de esta vela
        const rsiPrev = calculateRSI(closes.slice(i - 40, i), 14);

        // ¿Estaba el RSI exactamente en la zona de 20?
        if (rsiPrev >= (TARGET_RSI - VECINDAD) && rsiPrev <= (TARGET_RSI + VECINDAD)) {
            dailyData[dateStr].exactHits++;

            // ¿Hubo un spike en esta misma vela donde el RSI era 20?
            if ((candle.high - candle.open) >= SPIKE_THRESHOLD) {
                dailyData[dateStr].spikesAtPoint++;
            }
        }
    }

    console.log("\n=================================================");
    console.log(`📊 CONTEO DIARIO: SPIKES JUSTO EN RSI ${TARGET_RSI}`);
    console.log("=================================================");
    console.log(`Rango auditado: ${TARGET_RSI - VECINDAD} a ${TARGET_RSI + VECINDAD}`);
    console.log("-------------------------------------------------");

    for (let date in dailyData) {
        const d = dailyData[date];
        console.log(`${date}:`);
        console.log(`  - Veces que el RSI tocó el punto 20: ${d.exactHits}`);
        console.log(`  - Spikes ocurridos EN ESE MOMENTO: ${d.spikesAtPoint}`);
        if (d.exactHits > 0) {
            console.log(`  - Probabilidad de "Reacción Exacta": ${((d.spikesAtPoint / d.exactHits) * 100).toFixed(1)}%`);
        }
    }

    console.log("-------------------------------------------------");
    console.log("Nota: Esto mide cuántos spikes ocurren EXACTAMENTE");
    console.log("cuando el RSI está marcando 20.0.");
    console.log("=================================================\n");
}
