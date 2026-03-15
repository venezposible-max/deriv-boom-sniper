const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Fecha: Último mes (del 11 de febrero al 11 de marzo de 2026)
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const CONFIG = {
    stake: 20,
    takeProfit: 0.45,
    stopLoss: 1.80,   // Pérdida REAL con Escudo Anti-Spike de 0.1
    multiplier: 200,
    rsiThreshold: 80, // Modo Francotirador Blindado
    spikeSizeDefinition: 0.5,
    cooldownMinutesWin: 1,
    cooldownMinutesLoss: 3
};

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📥 Descargando DATA MENSUAL (M1) para BOOM 500 (30 Días)...`);
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

        if (allCandles.length < 43200 && earliestReceived > startTS && candles.length > 0) {
            process.stdout.write('.');
            fetchCandles(earliestReceived);
        } else {
            console.log(`\n✅ DATA MENSUAL CARGADA: ${allCandles.length} Minutos (~30 días). Analizando...`);
            runMonthlyBacktest();
            ws.close();
        }
    }
});

function calculateRSI(prices, period = 14) {
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
        avgGain = (avgGain * (period - 1) + currentGain) / period;
        avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function runMonthlyBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let cooldownUntil = 0;
    let tradeHistory = [];

    const closes = allCandles.map(c => c.close);

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];
        const currentTime = candle.epoch;

        if (currentTime < cooldownUntil) continue;

        const subCloses = closes.slice(i - 40, i);
        const rsi = calculateRSI(subCloses, 14);

        if (rsi >= CONFIG.rsiThreshold) {
            trades++;
            // Simulación Spike: High > Open + Umbral
            const spikeDetected = (candle.high - candle.open) > CONFIG.spikeSizeDefinition;

            if (spikeDetected) {
                balance -= CONFIG.stopLoss;
                losses++;
                cooldownUntil = currentTime + (CONFIG.cooldownMinutesLoss * 60);
                tradeHistory.push({ time: new Date(currentTime * 1000).toLocaleDateString(), profit: -CONFIG.stopLoss, type: "🚨 SPIKE" });
            } else {
                balance += CONFIG.takeProfit;
                wins++;
                cooldownUntil = currentTime + (CONFIG.cooldownMinutesWin * 60);
                tradeHistory.push({ time: new Date(currentTime * 1000).toLocaleDateString(), profit: CONFIG.takeProfit, type: "✅ TREND" });
            }
        }
    }

    console.log("\n=========================================");
    console.log("📊 REPORTE MENSUAL: BOOM 500 TREND HUNTER");
    console.log("=========================================");
    console.log(`Periodo: Últimos 30 Días (Modo Blindado)`);
    console.log(`Configuración: RSI ${CONFIG.rsiThreshold} | TP +$0.45 | SL -$1.80`);
    console.log(`-----------------------------------------`);
    console.log(`Total Trades Realizados: ${trades}`);
    console.log(`Ganadas ✅: ${wins} (${((wins / trades) * 100).toFixed(1)}%)`);
    console.log(`Perdidas ❌: ${losses} (${((losses / trades) * 100).toFixed(1)}%)`);
    console.log(`-----------------------------------------`);
    console.log(`💰 PNL NETO TOTAL: $${balance.toFixed(2)}`);
    console.log(`📈 Ganancia Diaria Promedio: $${(balance / 30).toFixed(2)}`);
    console.log(`🚀 ROI s/Stake: ${((balance / CONFIG.stake) * 100).toFixed(1)}%`);
    console.log("=========================================\n");
}
