const WebSocket = require('ws');

const SYMBOL = 'BOOM1000';
const CONFIG = {
    stake: 20,
    takeProfit: 50.00,
    stopLoss: 1.00,
    multiplier: 200,
    timeStopTicks: 15, // Segundos reales
    cooldownSecondsWin: 45,
    cooldownSecondsLoss: 3
};

let prices_all = [];
let times_all = [];

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;

    let startIndex = prices.length - 60; // Suavizado de hasta 60 velas M1 (1 hora)
    if (startIndex < 1) startIndex = 1;

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = startIndex; i < startIndex + period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff;
        else if (diff < 0) avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = startIndex + period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let currentGain = diff > 0 ? diff : 0;
        let currentLoss = diff < 0 ? Math.abs(diff) : 0;

        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// CONSTRUCTOR DE VELAS DE 1 MINUTO EN BASE A TIMESTAMP REAL (No por cantidad de ticks)
function buildM1Candles(times, prices) {
    let candles = [];
    let currentMinute = -1;
    let currentClose = 0;

    for (let i = 0; i < times.length; i++) {
        const time = times[i];
        const price = prices[i];

        // Obtener el minuto absoluto (ej. 11:38:00, 11:39:00)
        let minuteExact = Math.floor(time / 60) * 60;

        if (minuteExact !== currentMinute) {
            // Empezamos nuevo minuto
            if (currentMinute !== -1) {
                candles.push(currentClose);
            }
            currentMinute = minuteExact;
        }
        currentClose = price; // El cierre de la vela M1 actual se va moviendo con cada tick
    }
    candles.push(currentClose);
    return candles;
}

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        count: 5000,
        end: 'latest',
        style: 'ticks'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.error) { console.error(msg.error); process.exit(1); }
    if (msg.msg_type === 'history') {
        prices_all = msg.history.prices;
        times_all = msg.history.times;
        runBacktest();
        ws.close();
    }
});

function runBacktest() {
    let state = {
        inTrade: false,
        openPrice: 0,
        openTime: 0,
        cooldownExpiryTime: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        trades: []
    };

    const startTimeStamp = times_all[0];
    const endTimeStamp = times_all[times_all.length - 1];
    const hours = (endTimeStamp - startTimeStamp) / 3600;

    console.log(`\n============ BACKTEST PROFESIONAL BOOM 1000 ============`);
    console.log(`⏱️ Base del estudio: ${prices_all.length} Ticks (Aprox ${hours.toFixed(1)} horas de mercado).`);
    console.log(`⚙️ Arquitectura: Agrupación Temporal Exacta (60s Reales)`);
    console.log(`===========================================================================\n`);

    // Iteramos por encima de los 4000 ticks para tener un historial base que evaluar
    let startEvalIndex = 4000;

    for (let i = startEvalIndex; i < prices_all.length; i++) {
        const quote = prices_all[i];
        const currentTime = times_all[i];

        // 1. Manejar trade abierto
        if (state.inTrade) {
            const spread = CONFIG.stake * 0.0185;
            const profitRaw = ((quote - state.openPrice) / state.openPrice) * CONFIG.stake * CONFIG.multiplier;
            const profit = profitRaw - spread;

            const secondsElapsed = currentTime - state.openTime;

            let closed = false;
            let closeReason = "";

            if (profit >= CONFIG.takeProfit) {
                closed = true;
                closeReason = `🎯 TAKE PROFIT (+${Math.floor(profit)}$)`;
            } else if (profit <= -CONFIG.stopLoss) {
                closed = true;
                closeReason = `🛡️ STOP LOSS (-${Math.abs(profit).toFixed(2)}$)`;
            } else if (secondsElapsed >= CONFIG.timeStopTicks && profit < 2.00) {
                closed = true;
                closeReason = `⏱️ TIME-STOP (-${Math.abs(profit).toFixed(2)}$)`;
            }
            // Pequeña validación extra: si es un Spike pequeño pero positivo y pasaron los 15s, a veces conviene cerrar manualmente
            else if (secondsElapsed >= CONFIG.timeStopTicks && profit >= 0 && profit < 2.00) {
                closed = true;
                closeReason = `⏱️ MINI SPIKE CERRADO (+${profit.toFixed(2)}$)`;
            }

            if (closed) {
                state.inTrade = false;
                state.pnl += profit;
                if (profit > 0) {
                    state.wins++;
                    state.cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsWin;
                } else {
                    state.losses++;
                    state.cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsLoss;
                }

                state.trades.push({
                    open: new Date(state.openTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' }),
                    close: new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' }),
                    reason: closeReason,
                    profit: profit
                });
                continue;
            }
        }

        // 2. Revisar si disparamos
        if (!state.inTrade && currentTime >= state.cooldownExpiryTime) {
            // El bot del servidor siempre analiza TODO el historial disponible hasta este instante para formar Velas y evaluar RSI
            const currentSubTimes = times_all.slice(i - 4000, i + 1);
            const currentSubPrices = prices_all.slice(i - 4000, i + 1);

            
    const m1_candles = buildM1Candles(currentSubTimes, currentSubPrices);
    const timeStr = new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    if(timeStr.includes('11:38:')) {
        let rsi = calculateRSI(m1_candles, 14);
        if(rsi <= 25) {
            // console.log('DEBUG: ', timeStr, ' RSI:', rsi.toFixed(2));
        }
    }

            const rsi = calculateRSI(m1_candles, 14);

            if (!isNaN(rsi)) {
                if (rsi >= 0 && rsi <= 25) {
                    state.inTrade = true;
                    state.openPrice = quote;
                    state.openTime = currentTime;
                }
            }
        }
    }

    console.log(`============ RESULTADOS ============`);
    console.log(`✔️ Ganados: ${state.wins}  |  ❌ Perdidos: ${state.losses} (Time-Stops/SL)`);
    console.log(`💰 PnL NETO FINAL: ${(state.pnl >= 0 ? "+" : "")}$${state.pnl.toFixed(2)}`);
    console.log(`\n--- HISTORIAL DE TRADES DETALLADO ---`);
    if (state.trades.length === 0) console.log("No hubieron operaciones (El RSI M1 no bajó de 25 en este periodo).");
    state.trades.forEach((t, index) => {
        console.log(`[${index + 1}] ⏰ ${t.open} a ${t.close} | ${t.reason}`);
    });
    console.log(`====================================\n`);
}
