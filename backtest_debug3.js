const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

const SYMBOL = 'BOOM1000';
const CONFIG = {
    stake: 20,
    takeProfit: 50.00,
    stopLoss: 1.00,
    multiplier: 200,
    timeStopTicks: 15, // 15 segundos reales
    cooldownSecondsWin: 45,
    cooldownSecondsLoss: 3
};

let prices_all = [];
let times_all = [];

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function downsampleTicksToCandles(ticks, ticksPerCandle = 60) {
    let candles = [];
    for (let i = 0; i < ticks.length; i += ticksPerCandle) {
        candles.push(ticks[i]);
    }
    return candles;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let startIndex = prices.length - 60;
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

function calculateCCI(prices, period) {
    if (prices.length < period) return 0;
    const sma = calculateSMA(prices, period);
    let meanDev = 0;
    const slice = prices.slice(-period);
    for (let p of slice) meanDev += Math.abs(p - sma);
    meanDev = meanDev / period;
    if (meanDev === 0) return 0;
    return (prices[prices.length - 1] - sma) / (0.015 * meanDev);
}

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        count: 5000, // Máximo permitido por la API por petición (Aprox 1 hora)
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
    let tickHistory = [];
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

    console.log(`\n============ SIMULADOR BACKTEST SNIPER (Velas M1 + QuickReload) ============`);
    console.log(`Analizando el máximo historial en crudo: ${prices_all.length} Ticks.`);
    console.log(`Período cubierto: ${hours.toFixed(2)} horas (Aprox ${Math.round(hours * 60)} minutos).`);
    console.log(`===========================================================================\n`);

    for (let i = 0; i < prices_all.length; i++) {
        const quote = prices_all[i];
        const currentTime = times_all[i];

        tickHistory.push(quote);
        if (tickHistory.length > 4050) tickHistory.shift();

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
                closeReason = `🎯 TAKE PROFIT (+${profit.toFixed(2)}$)`;
            } else if (profit <= -CONFIG.stopLoss) {
                closed = true;
                closeReason = `🛡️ STOP LOSS (-${Math.abs(profit).toFixed(2)}$)`;
            } else if (secondsElapsed >= CONFIG.timeStopTicks && profit < 2.00) {
                closed = true;
                closeReason = `⏱️ TIME-STOP (${profit.toFixed(2)}$)`;
            }

            if (closed) {
                state.inTrade = false;
                state.pnl += profit;
                if (profit > 0) {
                    state.wins++;
                    // Enfriamiento de éxito (45s)
                    state.cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsWin;
                } else {
                    state.losses++;
                    // Recarga rápida (3s)
                    state.cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsLoss;
                }

                state.trades.push({
                    openTime: new Date(state.openTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' }),
                    closeTime: new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' }),
                    reason: closeReason,
                    profit: profit
                });
                continue;
            }
        }

        
    // 2. Revisar si disparamos
    const timeStr = new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    if (timeStr.includes('11:38:2') || timeStr.includes('11:38:3')) {
        let m1c = downsampleTicksToCandles(tickHistory, 60);
        let currentRsi = calculateRSI(m1c, 14);
        console.log(`[TICK DEBUG] ${timeStr} | RSI: ${currentRsi.toFixed(2)} | InTrade: ${state.inTrade} | CooldownExpira: ${state.cooldownExpiryTime - currentTime}`);
    }
 (solo si hay historia y no hay cooldown)
        if (!state.inTrade && tickHistory.length >= 60 && currentTime >= state.cooldownExpiryTime) {
            const m1_candles = downsampleTicksToCandles(tickHistory, 60);
            const rsi = calculateRSI(m1_candles, 14);

            if (!isNaN(rsi)) {
                if (rsi >= 0 && rsi <= 25) {
                    // DISPARO
                    state.inTrade = true;
                    state.openPrice = quote;
                    state.openTime = currentTime;
                }
            }
        }
    }

    console.log(`============ RESULTADOS DEL BACKTEST ============`);
    console.log(`Trades Totales: ${state.wins + state.losses}`);
    console.log(`✔️ Ganados: ${state.wins}  |  ❌ Perdidos: ${state.losses} (Time-Stops Protegidos)`);
    console.log(`💰 PnL NETO FINAL: ${(state.pnl >= 0 ? "+" : "")}$${state.pnl.toFixed(2)}`);
    console.log(`\n--- HISTORIAL LÓGICO DE OPERACIONES ---`);
    if (state.trades.length === 0) console.log("No hubieron operaciones (El RSI no bajó de 25 en este largo periodo).");
    state.trades.forEach((t, index) => {
        console.log(`[${index + 1}] Abre ${t.openTime} -> Cierra ${t.closeTime} | Resultado: ${t.reason}`);
    });
    console.log(`=================================================\n`);
}
