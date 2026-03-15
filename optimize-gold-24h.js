const WebSocket = require('ws');

const SYMBOL = 'frxXAUUSD';
const APP_ID = 1089;
const STAKE = 10;
const MULTIPLIER = 200;

// Rango: Últimos 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = endTS - (7 * 24 * 60 * 60);

const TP_OPTIONS = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
const SL_OPTIONS = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔍 BUSCANDO MEJORES VALORES (OPTIMIZACIÓN 24H) - ORO`);
    console.log(`📥 Descargando data...`);
    fetchCandles(endTS);
});

function fetchCandles(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
        count: 5000,
        style: 'candles',
        granularity: 300
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        allCandles = candles.filter(c => c.epoch >= startTS);
        console.log(`✅ Data cargada: ${allCandles.length} velas del último día.`);
        runOptimization();
        ws.close();
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

function runOptimization() {
    let results = [];
    const closes = allCandles.map(c => c.close);

    for (const tp of TP_OPTIONS) {
        for (const sl of SL_OPTIONS) {
            let balance = 0, wins = 0, losses = 0, trades = 0;

            for (let i = 40; i < allCandles.length; i++) {
                const subCloses = closes.slice(i - 40, i);
                const rsi = calculateRSI(subCloses, 14);
                const ema = calculateEMA(subCloses, 20);
                const currentPrice = allCandles[i].close;

                let entryType = null;
                if (rsi <= 30 && currentPrice < ema) entryType = 'UP';
                else if (rsi >= 70 && currentPrice > ema) entryType = 'DOWN';

                if (entryType) {
                    const entryPrice = currentPrice;
                    let outcome = null;

                    for (let j = i + 1; j < allCandles.length; j++) {
                        const nextCandle = allCandles[j];
                        let pnl = 0, loss = 0;

                        if (entryType === 'UP') {
                            pnl = ((nextCandle.high - entryPrice) / entryPrice) * STAKE * MULTIPLIER;
                            loss = ((nextCandle.low - entryPrice) / entryPrice) * STAKE * MULTIPLIER;
                        } else {
                            pnl = ((entryPrice - nextCandle.low) / entryPrice) * STAKE * MULTIPLIER;
                            loss = ((entryPrice - nextCandle.high) / entryPrice) * STAKE * MULTIPLIER;
                        }

                        if (pnl >= tp) { outcome = tp; break; }
                        if (loss <= -sl) { outcome = -sl; break; }
                        if (j - i > 150) { outcome = pnl; break; } // Timeout
                    }

                    if (outcome !== null) {
                        balance += outcome;
                        trades++;
                        if (outcome > 0) wins++; else losses++;
                        i += 4; // Gap
                    }
                }
            }

            results.push({ tp, sl, balance, wins, losses, trades, wr: (wins / (trades || 1)) * 100 });
        }
    }

    results.sort((a, b) => b.balance - a.balance);

    console.log("\n=========================================");
    console.log("💎 TOP 3 COMBINACIONES PARA ORO (24H)");
    console.log("=========================================");
    for (let i = 0; i < 3; i++) {
        const r = results[i];
        console.log(`${i + 1}. TP: $${r.tp} | SL: $${r.sl} | PnL: $${r.balance.toFixed(2)} | WR: ${r.wr.toFixed(1)}% | T:${r.trades}`);
    }
    console.log("=========================================\n");
}
