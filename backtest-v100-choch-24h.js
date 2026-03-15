const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST V100 - ESTRATEGIA CHOCH DUAL SNIPER
const APP_ID = 1089;
const SYMBOL = 'R_100'; // Volatility 100 Index
const STAKE = 10;
const MULTIPLIER = 200;
const GRANULARITY = 300; // 5 minutos (como en el bot)

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("📊 Iniciando Backtest V100 DUAL SNIPER (ChoCh) - Últimas 24 Horas...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 1000, // Fetch more for history
        style: 'candles',
        granularity: GRANULARITY
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        runBacktest(msg.candles);
        ws.close();
    }
});

function runBacktest(candles) {
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let activeTrade = null;
    let history = [];

    const totalCandles = candles.length;
    const startIndex = totalCandles - 288; // Últimas 24 horas (288 velas de 5m)

    for (let i = 30; i < totalCandles; i++) {
        const historySlice = candles.slice(0, i);
        const currentCandle = candles[i];
        const currentPrice = currentCandle.open; // Usamos el open para la "señal" del tick

        const isWithinRange = i >= startIndex;

        if (!activeTrade && isWithinRange) {
            // --- DETECCIÓN DE PIVOTES (ChoCh Logic) ---
            let lastSH = 0; // Last structural high
            let lastSL = 0; // Last structural low

            for (let j = i - 1; j > i - 25; j--) {
                const prev = candles[j - 1];
                const cur = candles[j];
                const next = candles[j + 1];
                if (!prev || !next) continue;

                if (!lastSH && cur.high > prev.high && cur.high > next.high) lastSH = cur.high;
                if (!lastSL && cur.low < prev.low && cur.low < next.low) lastSL = cur.low;
                if (lastSH && lastSL) break;
            }

            if (lastSH && lastSL) {
                // 1. COMPRA (Break High)
                if (currentPrice > lastSH) {
                    const slPrice = lastSL;
                    const distPct = Math.abs(currentPrice - slPrice) / currentPrice;
                    const slAmount = STAKE * MULTIPLIER * (distPct + 0.0001);
                    const tpAmount = slAmount * 2;
                    activeTrade = {
                        type: 'UP',
                        entry: currentPrice,
                        slDist: currentPrice - slPrice,
                        slAmt: Math.max(1, slAmount),
                        tpAmt: Math.max(2, tpAmount),
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
                // 2. VENTA (Break Low)
                else if (currentPrice < lastSL) {
                    const slPrice = lastSH;
                    const distPct = Math.abs(currentPrice - slPrice) / currentPrice;
                    const slAmount = STAKE * MULTIPLIER * (distPct + 0.0001);
                    const tpAmount = slAmount * 2;
                    activeTrade = {
                        type: 'DOWN',
                        entry: currentPrice,
                        slDist: slPrice - currentPrice,
                        slAmt: Math.max(1, slAmount),
                        tpAmt: Math.max(2, tpAmount),
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
            }
        } else if (activeTrade) {
            // Simular el movimiento dentro de la vela (High/Low)
            let exitPrice = 0;
            let profit = 0;

            if (activeTrade.type === 'UP') {
                // Check if hit SL first (pessimistic)
                if (currentCandle.low <= (activeTrade.entry - activeTrade.slDist)) {
                    profit = -activeTrade.slAmt;
                    exitPrice = activeTrade.entry - activeTrade.slDist;
                } else if (currentCandle.high >= (activeTrade.entry + (activeTrade.slDist * 2))) {
                    profit = activeTrade.tpAmt;
                    exitPrice = activeTrade.entry + (activeTrade.slDist * 2);
                }
            } else {
                // SELL: SL is above, TP is below
                if (currentCandle.high >= (activeTrade.entry + activeTrade.slDist)) {
                    profit = -activeTrade.slAmt;
                    exitPrice = activeTrade.entry + activeTrade.slDist;
                } else if (currentCandle.low <= (activeTrade.entry - (activeTrade.slDist * 2))) {
                    profit = activeTrade.tpAmt;
                    exitPrice = activeTrade.entry - (activeTrade.slDist * 2);
                }
            }

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalPnL += profit;
                history.push({ ...activeTrade, profit, exitTime: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE') });
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🔥 RESULTADO V100 DUAL SNIPER (CHOCH)");
    console.log("========================================");
    console.log(`Periodo: Últimas 24 Horas (M5)`);
    console.log(`Estrategia: Estructura + Riesgo 2:1`);
    console.log(`Total Trades: ${history.length}`);
    console.log(`Ganados 🟢: ${wins} | Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    console.log(`PnL NETO (Stake $10): $${totalPnL.toFixed(2)} USD`);
    console.log(`Retorno: ${((totalPnL / STAKE) * 100).toFixed(1)}%`);
    console.log("========================================\n");

    if (history.length > 0) {
        console.log("Detalle de las señales detectadas:");
        history.slice(-15).forEach((h, idx) => {
            console.log(`${idx + 1}. [${h.type}] Ent: ${h.entry.toFixed(2)} | PnL: ${h.profit > 0 ? '🟢' : '🔴'} $${h.profit.toFixed(2)} (${h.time})`);
        });
    } else {
        console.log("No se generaron trades. El precio se mantuvo en rango lateral.");
    }
}
