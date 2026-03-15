const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Rango: Últimos 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const SPIKE_MAGNITUDE = 0.5; // Umbral para considerar un Spike
const RS_PERIOD = 14;
const TARGET_RSI = 20;
const LOOKAHEAD_MINUTES = 3; // Cuánto tiempo esperamos el spike después de tocar RSI 20

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔍 AUDITANDO SPIKE HUNTER (RSI 20) - BOOM 500 (Últimos 7 días)...`);
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
            console.log(`\n✅ DATA CARGADA: ${allCandles.length} minutos. Analizando días...`);
            runAudit();
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

function runAudit() {
    let dailyData = {};
    const closes = allCandles.map(c => c.close);

    for (let i = 50; i < allCandles.length - LOOKAHEAD_MINUTES; i++) {
        const candle = allCandles[i];
        const dateStr = new Date(candle.epoch * 1000).toLocaleDateString();

        if (!dailyData[dateStr]) {
            dailyData[dateStr] = { rsi20Hits: 0, spikesFound: 0 };
        }

        const rsi = calculateRSI(closes.slice(i - 40, i), RS_PERIOD);

        // Si el RSI toca o baja de 20
        if (rsi <= TARGET_RSI) {
            dailyData[dateStr].rsi20Hits++;

            // Miramos si ocurre un spike en los siguientes minutos
            let foundInWindow = false;
            for (let j = 0; j <= LOOKAHEAD_MINUTES; j++) {
                const checkCandle = allCandles[i + j];
                if (checkCandle && (checkCandle.high - checkCandle.open) >= SPIKE_MAGNITUDE) {
                    foundInWindow = true;
                    break;
                }
            }

            if (foundInWindow) {
                dailyData[dateStr].spikesFound++;
            }
        }
    }

    console.log("\n=================================================");
    console.log("🎯 AUDITORÍA SPIKE HUNTER: NIVEL RSI 20");
    console.log("=================================================");
    console.log("Objetivo: ¿Cuántas veces el precio explotó al llegar a RSI 20?");
    console.log("-------------------------------------------------");

    for (let date in dailyData) {
        const d = dailyData[date];
        const successRate = ((d.spikesFound / (d.rsi20Hits || 1)) * 100).toFixed(1);
        console.log(`${date}: Hits RSI 20: ${d.rsi20Hits} | Spikes Cazados: ${d.spikesFound} | Efectividad: ${successRate}%`);
    }

    console.log("-------------------------------------------------");
    console.log("💡 Nota: Un 'Hit' es cuando el RSI cierra el minuto en 20 o menos.");
    console.log("Efectividad = Probabilidad de spike en los siguientes 3 min.");
    console.log("=================================================\n");
}
