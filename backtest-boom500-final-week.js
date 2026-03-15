const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Fecha: Últimos 7 días (del 4 al 11 de marzo de 2026)
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const CONFIG = {
    stake: 60,        // Stake del usuario en la captura
    takeProfit: 1.00, // Cosecha proporcional al stake de 60
    stopLoss: 5.40,   // Pérdida REAL estimada con escudo para un stake de 60 (3x la de stake 20)
    multiplier: 200,
    rsiThreshold: 80, // Tu nueva configuración ganadora
    spikeSizeDefinition: 0.5,
    cooldownMinutesWin: 1,
    cooldownMinutesLoss: 2 // 120s según tu captura
};

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📥 Descargando DATA SEMANAL (M1) para BOOM 500 (Últimos 7 Días)...`);
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
            console.log(`\n✅ DATA SEMANAL CARGADA: ${allCandles.length} Minutos. Analizando Modo Blindado...`);
            runWeeklyBacktest();
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

function runWeeklyBacktest() {
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
            const spikeDetected = (candle.high - candle.open) > CONFIG.spikeSizeDefinition;

            if (spikeDetected) {
                balance -= CONFIG.stopLoss;
                losses++;
                cooldownUntil = currentTime + (CONFIG.cooldownMinutesLoss * 60);
            } else {
                balance += CONFIG.takeProfit;
                wins++;
                cooldownUntil = currentTime + (CONFIG.cooldownMinutesWin * 60);
            }
        }
    }

    console.log("\n=========================================");
    console.log("🛡️ REPORTE SEMANAL BLINDADO (BOOM 500)");
    console.log("=========================================");
    console.log(`Configuración: STAKE $${CONFIG.stake} | RSI ${CONFIG.rsiThreshold}`);
    console.log(`Recarga por Error: ${CONFIG.cooldownMinutesLoss * 60}s`);
    console.log(`-----------------------------------------`);
    console.log(`Total Trades Realizados: ${trades}`);
    console.log(`Ganadas ✅: ${wins} (${((wins / trades) * 100).toFixed(1)}%)`);
    console.log(`Perdidas ❌: ${losses} (${((losses / trades) * 100).toFixed(1)}%)`);
    console.log(`-----------------------------------------`);
    console.log(`💰 PNL NETO SEMANAL: $${balance.toFixed(2)}`);
    console.log(`📈 Ganancia Diaria Promedio: $${(balance / 7).toFixed(2)}`);
    console.log(`📊 ROI s/Cuenta: ${((balance / CONFIG.stake) * 100).toFixed(1)}%`);
    console.log("=========================================\n");
}
