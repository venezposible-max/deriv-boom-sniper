const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Fecha: Último mes (30 días)
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).getTime() / 1000);

// RANGOS PARA OPTIMIZAR
const RANGES = {
    rsiThreshold: [70, 72, 75, 78, 80, 82, 85],
    takeProfit: [0.3, 0.5, 0.7, 1.0],
    cooldownMinutesLoss: [1, 2, 3, 5],
    antiSpikeStop: [2.50, 4.00, 5.50] // Stop Loss real estimado con escudo
};

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🚀 INICIANDO OPTIMIZADOR BULLSEYE - BOOM 500 (30 DÍAS)...`);
    console.log(`📥 Descargando data histórica...`);
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

        if (allCandles.length < 40000 && earliestReceived > startTS && candles.length > 0) {
            process.stdout.write('.');
            fetchCandles(earliestReceived);
        } else {
            console.log(`\n✅ DATA LISTA: ${allCandles.length} velas. Procesando todas las combinaciones...`);
            runOptimization();
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

function runOptimization() {
    let bestResult = { pnl: -99999, params: {} };
    const closes = allCandles.map(c => c.close);
    let totalCombinations = RANGES.rsiThreshold.length * RANGES.takeProfit.length * RANGES.cooldownMinutesLoss.length * RANGES.antiSpikeStop.length;
    let currentCount = 0;

    console.log(`🔍 Probando ${totalCombinations} combinaciones posibles...`);

    for (let rsi of RANGES.rsiThreshold) {
        for (let tp of RANGES.takeProfit) {
            for (let cool of RANGES.cooldownMinutesLoss) {
                for (let sl of RANGES.antiSpikeStop) {
                    currentCount++;
                    const result = backtest(rsi, tp, cool, sl, closes);
                    if (result.pnl > bestResult.pnl) {
                        bestResult = { pnl: result.pnl, params: { rsi, tp, cool, sl }, wins: result.wins, losses: result.losses };
                    }
                }
            }
        }
        process.stdout.write('|');
    }

    console.log("\n\n🏆 ¡COMBINACIÓN DE MÁXIMA GANANCIA ENCONTRADA!");
    console.log("=================================================");
    console.log(`💰 PNL NETO MENSUAL: $${bestResult.pnl.toFixed(2)}`);
    console.log(`📈 Ganancia Diaria: $${(bestResult.pnl / 30).toFixed(2)}`);
    console.log("-------------------------------------------------");
    console.log("PARAMETROS GANADORES:");
    console.log(`📍 GATILLO RSI: ${bestResult.params.rsi}`);
    console.log(`📍 SPIKE TARGET (TP): $${bestResult.params.tp.toFixed(2)}`);
    console.log(`📍 RECARGA (COOLDOWN): ${bestResult.params.cool * 60} Segundos`);
    console.log(`📍 STOP LOSS (SL REAL): $${bestResult.params.sl.toFixed(2)}`);
    console.log("-------------------------------------------------");
    console.log(`Estadísticas: ${bestResult.wins} Ganadas | ${bestResult.losses} Perdidas`);
    console.log(`Win Rate: ${((bestResult.wins / (bestResult.wins + bestResult.losses)) * 100).toFixed(1)}%`);
    console.log("=================================================");
}

function backtest(rsiThreshold, tp, cooldownMinutes, sl, closes) {
    let balance = 0, wins = 0, losses = 0;
    let cooldownUntil = 0;
    const spikeThreshold = 0.5;

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];
        if (candle.epoch < cooldownUntil) continue;

        const rsiValue = calculateRSI(closes.slice(i - 40, i), 14);

        if (rsiValue >= rsiThreshold) {
            const spikeDetected = (candle.high - candle.open) > spikeThreshold;
            if (spikeDetected) {
                balance -= sl;
                losses++;
                cooldownUntil = candle.epoch + (cooldownMinutes * 60);
            } else {
                balance += tp;
                wins++;
                cooldownUntil = candle.epoch + 60; // 1 min normal
            }
        }
    }
    return { pnl: balance, wins, losses };
}
