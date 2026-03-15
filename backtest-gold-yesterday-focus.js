const WebSocket = require('ws');

const SYMBOL = 'frxXAUUSD'; // Oro en Deriv
const APP_ID = 1089;

// Fecha: Ayer (10 de Marzo de 2026)
const startTime = Math.floor(new Date('2026-03-10T00:00:00Z').getTime() / 1000);
const endTime = Math.floor(new Date('2026-03-10T23:59:59Z').getTime() / 1000);

const CONFIG = {
    stake: 100,
    tp_pips: 80,     // Take Profit un poco más conservador para asegurar cierres
    sl_pips: 40,     // Stop Loss exacto
    rsi_period: 14,
    rsi_overbought: 70,
    rsi_oversold: 30,
    ema_period: 20
};

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📡 AUDITANDO AYER (10 MARZO): ORO sniper...`);
    fetchCandles(endTime);
});

function fetchCandles(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
        count: 1000, // Sobrado para un día en M5 (un día tiene 288 velas M5)
        style: 'candles',
        granularity: 300 // M5
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        allCandles = msg.candles || [];
        // Filtrar solo las de ayer por seguridad
        allCandles = allCandles.filter(c => c.epoch >= startTime && c.epoch <= endTime);

        console.log(`✅ DATA CARGADA: ${allCandles.length} velas de 5 min. Analizando...`);
        runGoldBacktest();
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

function runGoldBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let tradeHistory = [];
    const closes = allCandles.map(c => c.close);

    for (let i = 25; i < allCandles.length; i++) {
        const candle = allCandles[i];
        const subCloses = closes.slice(i - 20, i);
        const rsi = calculateRSI(subCloses, CONFIG.rsi_period);
        const ema = calculateEMA(subCloses, CONFIG.ema_period);
        const currentPrice = candle.close;

        let entryType = "";
        let tpPrice = 0, slPrice = 0;

        // SEÑAL BUY
        if (rsi <= CONFIG.rsi_oversold && currentPrice < ema) {
            entryType = "BUY 📈";
            tpPrice = currentPrice + (CONFIG.tp_pips * 0.01);
            slPrice = currentPrice - (CONFIG.sl_pips * 0.01);
        }
        // SEÑAL SELL
        else if (rsi >= CONFIG.rsi_overbought && currentPrice > ema) {
            entryType = "SELL 📉";
            tpPrice = currentPrice - (CONFIG.tp_pips * 0.01);
            slPrice = currentPrice + (CONFIG.sl_pips * 0.01);
        }

        if (entryType !== "") {
            for (let j = i + 1; j < allCandles.length; j++) {
                const nextCandle = allCandles[j];
                let closed = false;
                let profit = 0;

                if (entryType === "BUY 📈") {
                    if (nextCandle.high >= tpPrice) {
                        profit = 50; wins++; closed = true;
                    } else if (nextCandle.low <= slPrice) {
                        profit = -25; losses++; closed = true;
                    }
                } else {
                    if (nextCandle.low <= tpPrice) {
                        profit = 50; wins++; closed = true;
                    } else if (nextCandle.high >= slPrice) {
                        profit = -25; losses++; closed = true;
                    }
                }

                if (closed) {
                    balance += profit;
                    trades++;
                    tradeHistory.push({
                        time: new Date(candle.epoch * 1000).toLocaleTimeString(),
                        type: entryType,
                        profit,
                        price: currentPrice.toFixed(2)
                    });
                    i = j; // Saltar velas hasta el cierre
                    break;
                }
            }
        }
    }

    console.log("\n=========================================");
    console.log("🥇 REPORTE ORO (XAUUSD) - AYER 10 MARZO");
    console.log("=========================================");
    console.log(`Total Trades Realizados: ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Neto de Ayer: +$${balance.toFixed(2)} 💰`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log("-----------------------------------------");
    console.log("Últimos trades de ayer:");
    tradeHistory.slice(-5).forEach(t => {
        console.log(`[${t.time}] ${t.type} en ${t.price} | PnL: ${t.profit > 0 ? "+" : ""}${t.profit}$`);
    });
    console.log("=========================================\n");
}
