const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Fecha: Semana pasada (del 1 al 8 de marzo de 2026)
const startTS = Math.floor(new Date('2026-03-01T00:00:00Z').getTime() / 1000);
const endTS = Math.floor(new Date('2026-03-08T23:59:59Z').getTime() / 1000);

const CONFIG = {
    stake: 60,
    takeProfit: 1.00, // Optimizado: Máximo beneficio
    stopLoss: 2.50,   // Tu SL de seguridad con escudo
    multiplier: 200,
    rsiThreshold: 70, // Gatillo optimizado para volumen
    spikeSizeDefinition: 0.5,
    cooldownMinutesWin: 1,
    cooldownMinutesLoss: 1
};

let allCandles = [];

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📥 Descargando DATA VELAS (M1) para BOOM 500 (Semana 01-08 Marzo)...`);
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: endTS,
        start: startTS,
        count: 12000, // Suficientes velas para 7 días
        style: 'candles',
        granularity: 60
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        allCandles = msg.candles || [];
        console.log(`✅ VELAS CARGADAS: ${allCandles.length} Minutos de mercado. Analizando Trend...`);
        runCandleBacktest();
        ws.close();
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

function runCandleBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let cooldownUntil = 0;
    let dailyStats = {};

    const closes = allCandles.map(c => c.close);

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];
        const currentTime = candle.epoch;
        const dateStr = new Date(currentTime * 1000).toLocaleDateString();

        if (!dailyStats[dateStr]) dailyStats[dateStr] = { pnl: 0, wins: 0, losses: 0 };

        if (currentTime < cooldownUntil) continue;

        const subCloses = closes.slice(i - 40, i);
        const rsi = calculateRSI(subCloses, 14);

        if (rsi >= CONFIG.rsiThreshold) {
            trades++;
            const spikeDetected = (candle.high - candle.open) > CONFIG.spikeSizeDefinition;

            if (spikeDetected) {
                balance -= CONFIG.stopLoss;
                losses++;
                dailyStats[dateStr].pnl -= CONFIG.stopLoss;
                dailyStats[dateStr].losses++;
                cooldownUntil = currentTime + (CONFIG.cooldownMinutesLoss * 60);
            } else {
                balance += CONFIG.takeProfit;
                wins++;
                dailyStats[dateStr].pnl += CONFIG.takeProfit;
                dailyStats[dateStr].wins++;
                cooldownUntil = currentTime + (CONFIG.cooldownMinutesWin * 60);
            }
        }
    }

    console.log("\n=========================================");
    console.log("📅 DESGLOSE DIARIO SEMANAL (Modo Maestro)");
    console.log("=========================================");
    console.log(`Configuración: RSI ${CONFIG.rsiThreshold} | TP $${CONFIG.takeProfit} | Stake $${CONFIG.stake}`);
    console.log("-----------------------------------------");

    for (let day in dailyStats) {
        const stats = dailyStats[day];
        const dayStatus = stats.pnl >= 0 ? "✅" : "❌";
        console.log(`${day}: ${dayStatus} PnL: $${stats.pnl.toFixed(2)} | W:${stats.wins} L:${stats.losses}`);
    }

    console.log("-----------------------------------------");
    console.log(`💰 PNL NETO TOTAL: $${balance.toFixed(2)}`);
    console.log(`🎯 Win Rate Global: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log("=========================================\n");
}
