const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST ORO (XAUUSD) - ESTRATEGIA CHOCH DUAL SNIPER (SEMANAL)
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD'; // Gold/USD
const STAKE = 10;
const MULTIPLIER = 200;
const GRANULARITY = 300; // 5 minutos

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("📊 Iniciando Backtest ORO DUAL SNIPER (ChoCh) - ÚLTIMA SEMANA...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 2000, // Velas de 5 min (Oro solo abre 5 días, así que 2000 es suficiente para una semana)
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
    // Una semana de oro son aprox 1440 velas (5 días * 24h * 12 velas/h)
    const startIndex = Math.max(30, totalCandles - 1440);

    for (let i = 30; i < totalCandles; i++) {
        const currentCandle = candles[i];
        const currentPrice = currentCandle.open;

        const isWithinRange = i >= startIndex;

        if (!activeTrade && isWithinRange) {
            // --- DETECCIÓN DE PIVOTES (ChoCh Logic) ---
            let lastSH = 0;
            let lastSL = 0;

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
                    let slAmount = STAKE * MULTIPLIER * (distPct + 0.0001);

                    // Cap de seguridad de Deriv
                    if (slAmount >= STAKE) slAmount = STAKE * 0.95;
                    const tpAmount = slAmount * 2;

                    activeTrade = {
                        type: 'UP',
                        entry: currentPrice,
                        slDist: currentPrice - slPrice,
                        slAmt: Math.max(1.5, slAmount), // Min SL en oro es bajo
                        tpAmt: Math.max(3.0, tpAmount),
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
                // 2. VENTA (Break Low)
                else if (currentPrice < lastSL) {
                    const slPrice = lastSH;
                    const distPct = Math.abs(currentPrice - slPrice) / currentPrice;
                    let slAmount = STAKE * MULTIPLIER * (distPct + 0.0001);

                    if (slAmount >= STAKE) slAmount = STAKE * 0.95;
                    const tpAmount = slAmount * 2;

                    activeTrade = {
                        type: 'DOWN',
                        entry: currentPrice,
                        slDist: slPrice - currentPrice,
                        slAmt: Math.max(1.5, slAmount),
                        tpAmt: Math.max(3.0, tpAmount),
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
            }
        } else if (activeTrade) {
            let profit = 0;
            if (activeTrade.type === 'UP') {
                if (currentCandle.low <= (activeTrade.entry - activeTrade.slDist)) {
                    profit = -activeTrade.slAmt;
                } else if (currentCandle.high >= (activeTrade.entry + (activeTrade.slDist * 2))) {
                    profit = activeTrade.tpAmt;
                }
            } else {
                if (currentCandle.high >= (activeTrade.entry + activeTrade.slDist)) {
                    profit = -activeTrade.slAmt;
                } else if (currentCandle.low <= (activeTrade.entry - (activeTrade.slDist * 2))) {
                    profit = activeTrade.tpAmt;
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
    console.log("🥇 RESULTADO SEMANAL ORO DUAL SNIPER");
    console.log("========================================");
    console.log(`Periodo: Últimos 5 Días Hábiles (Velas M5)`);
    console.log(`Estrategia: Estructura + Riesgo Cap (Deriv)`);
    console.log(`Total Trades: ${history.length}`);
    console.log(`Ganados 🟢: ${wins} | Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    console.log(`PnL NETO (Stake $10): $${totalPnL.toFixed(2)} USD`);
    console.log(`Retorno: ${((totalPnL / STAKE) * 100).toFixed(1)}%`);
    console.log(`Eficiencia: ${((wins / history.length) * 100).toFixed(1)}%`);
    console.log("========================================\n");

    if (history.length > 0) {
        console.log("\nÚltimos 5 movimientos de la semana en ORO:");
        history.slice(-5).forEach((h, idx) => {
            console.log(`${idx + 1}. [${h.type}] PnL: ${h.profit > 0 ? '🟢' : '🔴'} $${h.profit.toFixed(2)} (Ent: ${h.entry.toFixed(2)})`);
        });
    } else {
        console.log("No se generaron trades con esta configuración en el ORO.");
    }
}
