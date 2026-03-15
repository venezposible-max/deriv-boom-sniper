const WebSocket = require('ws');

const SYMBOL = 'frxXAUUSD'; // Oro en Deriv
const APP_ID = 1089;

// Rango: Últimos 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const CONFIG = {
    stake: 100,      // Ejemplo de inversión base
    tp_pips: 100,    // Take Profit en pips (ajustado para Oro)
    sl_pips: 50,     // Stop Loss en pips (protección real)
    rsi_period: 14,
    rsi_overbought: 70,
    rsi_oversold: 30,
    ema_period: 20
};

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📡 CONECTANDO AL MERCADO DEL ORO (XAUUSD) - DERIV...`);
    console.log(`📥 Descargando data de los últimos 7 días...`);
    fetchCandles(endTS);
});

function fetchCandles(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
        count: 5000,
        style: 'candles',
        granularity: 300 // Velas de 5 minutos para mayor estabilidad
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        allCandles = [...candles, ...allCandles];
        const earliestReceived = candles.length > 0 ? candles[0].epoch : 0;

        if (allCandles.length < 2016 && earliestReceived > startTS && candles.length > 0) { // ~7 días en M5
            process.stdout.write('.');
            fetchCandles(earliestReceived);
        } else {
            console.log(`\n✅ DATA DEL ORO CARGADA: ${allCandles.length} velas (M5). Iniciando Backtest...`);
            runGoldBacktest();
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

function runGoldBacktest() {
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

        // Estrategia: Reversión a la media con filtro RSI
        // COMPRA: RSI < 30 y precio por debajo de la EMA (Sobreventa en tendencia)
        if (rsi <= CONFIG.rsi_oversold && currentPrice < ema) {
            const entryPrice = currentPrice;
            const tpPrice = entryPrice + (CONFIG.tp_pips * 0.01);
            const slPrice = entryPrice - (CONFIG.sl_pips * 0.01);

            // Simulación de salida (buscamos en velas siguientes)
            for (let j = i + 1; j < Math.min(i + 50, allCandles.length); j++) {
                const nextCandle = allCandles[j];
                if (nextCandle.high >= tpPrice) {
                    const profit = (CONFIG.stake * 0.5); // Simulación de ganancia fija
                    balance += profit; wins++; trades++;
                    dailyStats[dateStr].pnl += profit; dailyStats[dateStr].wins++;
                    i = j; break;
                } else if (nextCandle.low <= slPrice) {
                    const loss = (CONFIG.stake * 0.25); // Protección de pérdida
                    balance -= loss; losses++; trades++;
                    dailyStats[dateStr].pnl -= loss; dailyStats[dateStr].losses++;
                    i = j; break;
                }
            }
        }
        // VENTA: RSI > 70 y precio por encima de la EMA
        else if (rsi >= CONFIG.rsi_overbought && currentPrice > ema) {
            const entryPrice = currentPrice;
            const tpPrice = entryPrice - (CONFIG.tp_pips * 0.01);
            const slPrice = entryPrice + (CONFIG.sl_pips * 0.01);

            for (let j = i + 1; j < Math.min(i + 50, allCandles.length); j++) {
                const nextCandle = allCandles[j];
                if (nextCandle.low <= tpPrice) {
                    const profit = (CONFIG.stake * 0.5);
                    balance += profit; wins++; trades++;
                    dailyStats[dateStr].pnl += profit; dailyStats[dateStr].wins++;
                    i = j; break;
                } else if (nextCandle.high >= slPrice) {
                    const loss = (CONFIG.stake * 0.25);
                    balance -= loss; losses++; trades++;
                    dailyStats[dateStr].pnl -= loss; dailyStats[dateStr].losses++;
                    i = j; break;
                }
            }
        }
    }

    console.log("\n=========================================");
    console.log("🥇 REPORTE SEMANAL: ORO (XAU/USD)");
    console.log("=========================================");
    console.log(`Inversión Base Sim.: $${CONFIG.stake}`);
    console.log("-----------------------------------------");
    for (let day in dailyStats) {
        const stats = dailyStats[day];
        const status = stats.pnl >= 0 ? "✅" : "❌";
        console.log(`${day}: ${status} PnL: $${stats.pnl.toFixed(2)} | W:${stats.wins} L:${stats.losses}`);
    }
    console.log("-----------------------------------------");
    console.log(`💰 PNL NETO TOTAL: $${balance.toFixed(2)}`);
    console.log(`🎯 Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log("=========================================\n");
}
