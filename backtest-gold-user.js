const WebSocket = require('ws');
const fs = require('fs');

const SYMBOL = 'frxXAUUSD';
const APP_ID = 1089;

// Rango: Últimos 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const CONFIG = {
    stake: 10,
    takeProfit: 3,
    stopLoss: 2,
    multiplier: 200,
    rsi_period: 14,
    rsi_overbought: 70,
    rsi_oversold: 30,
    ema_period: 20
};

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📡 INICIANDO BACKTEST PARA ORO (XAUUSD)`);
    console.log(`📊 Parámetros: Stake=$${CONFIG.stake}, TP=$${CONFIG.takeProfit}, SL=$${CONFIG.stopLoss}, Multiplier=x${CONFIG.multiplier}`);
    console.log(`📥 Descargando historial de 7 días...`);
    fetchCandles(endTS);
});

function fetchCandles(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
        count: 5000,
        style: 'candles',
        granularity: 300 // Velas de 5 minutos
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        allCandles = [...candles, ...allCandles];
        const earliestReceived = candles.length > 0 ? candles[0].epoch : 0;

        if (allCandles.length < 2016 && earliestReceived > startTS && candles.length > 0) {
            process.stdout.write('.');
            fetchCandles(earliestReceived);
        } else {
            console.log(`\n✅ Data cargada: ${allCandles.length} velas. Procesando estrategia...`);
            runBacktest();
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

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
}

function runBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let dailyStats = {};
    const closes = allCandles.map(c => c.close);

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];
        const dateStr = new Date(candle.epoch * 1000).toLocaleDateString();
        if (!dailyStats[dateStr]) dailyStats[dateStr] = { pnl: 0, wins: 0, losses: 0 };

        const subCloses = closes.slice(i - 40, i);
        const rsi = calculateRSI(subCloses, CONFIG.rsi_period);
        const ema = calculateEMA(subCloses, CONFIG.ema_period);
        const currentPrice = candle.close;

        let entryType = null;
        if (rsi <= CONFIG.rsi_oversold && currentPrice < ema) entryType = 'UP';
        else if (rsi >= CONFIG.rsi_overbought && currentPrice > ema) entryType = 'DOWN';

        if (entryType) {
            const entryPrice = currentPrice;
            let outcome = null;

            // Simular evolución nota a nota (usamos velas siguientes)
            for (let j = i + 1; j < allCandles.length; j++) {
                const nextCandle = allCandles[j];

                // Cálculo de PnL para Multiplicadores
                // Profit = (Change / Entry) * Stake * Multiplier
                let pnlUp = ((nextCandle.high - entryPrice) / entryPrice) * CONFIG.stake * CONFIG.multiplier;
                let lossUp = ((nextCandle.low - entryPrice) / entryPrice) * CONFIG.stake * CONFIG.multiplier;

                let pnlDown = ((entryPrice - nextCandle.low) / entryPrice) * CONFIG.stake * CONFIG.multiplier;
                let lossDown = ((entryPrice - nextCandle.high) / entryPrice) * CONFIG.stake * CONFIG.multiplier;

                if (entryType === 'UP') {
                    if (pnlUp >= CONFIG.takeProfit) { outcome = CONFIG.takeProfit; break; }
                    if (lossUp <= -CONFIG.stopLoss) { outcome = -CONFIG.stopLoss; break; }
                } else {
                    if (pnlDown >= CONFIG.takeProfit) { outcome = CONFIG.takeProfit; break; }
                    if (lossDown <= -CONFIG.stopLoss) { outcome = -CONFIG.stopLoss; break; }
                }

                // Tiempo límite de 24 horas para una operación
                if (j - i > 288) { outcome = entryType === 'UP' ? pnlUp : pnlDown; break; }
            }

            if (outcome !== null) {
                balance += outcome;
                trades++;
                if (outcome > 0) { wins++; dailyStats[dateStr].wins++; }
                else { losses++; dailyStats[dateStr].losses++; }
                dailyStats[dateStr].pnl += outcome;
                i += 5; // Salto para evitar múltiples señales pegadas
            }
        }
    }

    console.log("\n=========================================");
    console.log("🏆 RESULTADOS BACKTEST SEMANAL (ORO)");
    console.log("=========================================");
    console.log(`💰 Stake: $${CONFIG.stake} | Multiplicador: x${CONFIG.multiplier}`);
    console.log(`🎯 TP: $${CONFIG.takeProfit} | SL: $${CONFIG.stopLoss}`);
    console.log("-----------------------------------------");
    for (let day in dailyStats) {
        const stats = dailyStats[day];
        const status = stats.pnl >= 0 ? "✅" : "❌";
        console.log(`${day}: ${status} PnL: $${stats.pnl.toFixed(2)} | W:${stats.wins} L:${stats.losses}`);
    }
    console.log("-----------------------------------------");
    console.log(`💹 PNL NETO FINAL: $${balance.toFixed(2)}`);
    console.log(`📈 Eficiencia: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`🔢 Total Trades: ${trades}`);
    console.log("=========================================\n");
}
