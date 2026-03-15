const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST V100 - REQUERIMIENTO USUARIO (TP 3 / SL 10)
const APP_ID = 1089;
const SYMBOL = 'R_100';
const STAKE = 10;
const TP_AMT = 5.0; // Recomendación para rentabilidad
const SL_AMT = 10.0;
const GRANULARITY = 300; // 5 minutos

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`📊 Iniciando Backtest Mensual V100 | TP: $${TP_AMT} | SL: $${SL_AMT}`);
    // Pedimos las primeras 5000
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000,
        style: 'candles',
        granularity: GRANULARITY
    }));
});

let allCandles = [];
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles' && allCandles.length === 0) {
        allCandles = msg.candles;
        // Pedimos las siguientes 5000 antes de la primera de la lista actual
        const oldestEpoch = msg.candles[0].epoch;
        ws.send(JSON.stringify({
            ticks_history: SYMBOL,
            end: oldestEpoch.toString(),
            count: 5000,
            style: 'candles',
            granularity: GRANULARITY
        }));
    } else if (msg.msg_type === 'candles' && allCandles.length > 0) {
        // Combinamos: [nuevas_viejas] + [anteriores]
        allCandles = [...msg.candles, ...allCandles];
        runBacktest(allCandles);
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

    // Empezamos después de 30 velas para tener historial de pivots
    for (let i = 30; i < totalCandles; i++) {
        const currentCandle = candles[i];
        const currentPrice = currentCandle.open;

        if (!activeTrade) {
            // --- DETECCIÓN DE PIVOTES (Estructura de Mercado) ---
            let lastSH = 0;
            let lastSL = 0;

            // Buscamos los pivotes más cercanos en las últimas 25 velas
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
                // DISTANCIA PARA EL MOVIMIENTO (Basada en estructura)
                // Usamos la distancia al pivote opuesto para determinar la "fuerza" del movimiento

                // 1. COMPRA (Break High)
                if (currentPrice > lastSH) {
                    activeTrade = {
                        type: 'COMPRA 🔼',
                        entry: currentPrice,
                        targetPrice: currentPrice + (Math.abs(currentPrice - lastSL) * 0.5), // Referencia visual
                        slPrice: currentPrice - (Math.abs(currentPrice - lastSL)), // Referencia visual
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
                // 2. VENTA (Break Low)
                else if (currentPrice < lastSL) {
                    activeTrade = {
                        type: 'VENTA 🔽',
                        entry: currentPrice,
                        targetPrice: currentPrice - (Math.abs(currentPrice - lastSH) * 0.5),
                        slPrice: currentPrice + (Math.abs(currentPrice - lastSH)),
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
            }
        } else {
            // --- GESTIÓN DE LA OPERACIÓN (Basada en TP/SL fijos de dinero) ---
            // Nota: En Multipliers de Deriv, el PnL no es lineal al precio, depende del multiplicador.
            // Para simplificar el backtest y ser conservadores, asumimos un multiplicador que mueva 
            // el dinero proporcionalmente a la distancia estructural media.

            let profit = 0;
            const priceChangePct = (candles[i].close - activeTrade.entry) / activeTrade.entry;
            let currentPnL = (activeTrade.type === 'COMPRA 🔼' ? priceChangePct : -priceChangePct) * 200 * STAKE;

            // Verificamos si tocó Stop Loss (-10) o Take Profit (+3) en las sombras (high/low)
            const highChange = (candles[i].high - activeTrade.entry) / activeTrade.entry;
            const lowChange = (candles[i].low - activeTrade.entry) / activeTrade.entry;

            let maxPnLInCandle = (activeTrade.type === 'COMPRA 🔼' ? highChange : -lowChange) * 200 * STAKE;
            let minPnLInCandle = (activeTrade.type === 'COMPRA 🔼' ? lowChange : -highChange) * 200 * STAKE;

            if (minPnLInCandle <= -SL_AMT) {
                profit = -SL_AMT;
            } else if (maxPnLInCandle >= TP_AMT) {
                profit = TP_AMT;
            }

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalPnL += profit;
                history.push({ ...activeTrade, profit, exitTime: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE') });
                activeTrade = null;
                // Cooldown: Esperar 12 velas (1 hora) antes de buscar otro trade para no quemar
                i += 12;
            }
        }
    }

    console.log("\n========================================");
    console.log("📊 RESULTADO BACKTEST V100 (REQUERIMIENTO)");
    console.log("========================================");
    console.log(`Config: STAKE $10 | TP: $${TP_AMT} | SL: $${SL_AMT}`);
    console.log(`Muestra: ~30 días de mercado (${candles.length} velas M5)`);
    console.log(`Total Trades: ${history.length}`);
    console.log(`Ganados 🟢: ${wins} | Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    const netReturn = (totalPnL / STAKE) * 100;
    console.log(`PnL NETO: $${totalPnL.toFixed(2)} USD`);
    console.log(`Retorno: ${netReturn.toFixed(1)}%`);
    console.log(`Eficiencia: ${((wins / (history.length || 1)) * 100).toFixed(1)}%`);
    console.log("========================================\n");

    if (history.length > 0) {
        console.log("Últimos resultados:");
        history.slice(-10).forEach((h, idx) => {
            console.log(`${idx + 1}. [${h.type}] PnL: ${h.profit > 0 ? '🟢' : '🔴'} $${h.profit.toFixed(2)} (${h.time})`);
        });
    }
}
