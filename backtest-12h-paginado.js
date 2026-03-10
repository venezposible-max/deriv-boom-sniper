const WebSocket = require('ws');

const SYMBOL = 'BOOM1000';
const CONFIG = {
    stake: 20,
    takeProfit: 50.00,
    stopLoss: 1.00,
    multiplier: 200,
    timeStopTicks: 15,
    cooldownSecondsWin: 45,
    cooldownSecondsLoss: 3,
    rsiTarget: 25
};

let allPrices = [];
let allTimes = [];
let targetDurationHours = 12;
let targetTicks = 50000; // Aproximación para 12 horas en Boom 1000

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff; else losses += Math.abs(diff);
    }
    let avgG = gains / period, avgL = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        avgG = (avgG * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgL = (avgL * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    }
    return avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
}

function ticksToM1(times, prices) {
    let candles = [], currM = -1, lastP = 0;
    for (let i = 0; i < times.length; i++) {
        let m = Math.floor(times[i] / 60) * 60;
        if (m !== currM) { if (currM !== -1) candles.push(lastP); currM = m; }
        lastP = prices[i];
    }
    candles.push(lastP);
    return candles;
}

function fetchHistory(endTime = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        count: 5000,
        end: endTime,
        style: 'ticks'
    }));
}

ws.on('open', () => {
    console.log(`\n⏳ Extrayendo historial de 12 horas (Paginando de 5000 en 5000)...`);
    fetchHistory();
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const h = msg.history;
        allPrices = [...h.prices, ...allPrices];
        allTimes = [...h.times, ...allTimes];

        const firstTime = allTimes[0];
        const lastTime = allTimes[allTimes.length - 1];
        const currentHours = (lastTime - firstTime) / 3600;

        process.stdout.write(`\r📦 Cargando: ${allPrices.length} ticks (${currentHours.toFixed(1)}h / 12h)...`);

        if (currentHours < targetDurationHours && allPrices.length < 100000) {
            // Seguir pidiendo hacia atrás
            fetchHistory(allTimes[0] - 1);
        } else {
            console.log("\n✅ Carga Completa. Iniciando Simulación sniper...");
            runBacktest();
            ws.close();
        }
    }
});

function runBacktest() {
    let state = { inTrade: false, openPrice: 0, openTime: 0, cooldown: 0, wins: 0, losses: 0, pnl: 0, trades: [] };

    // Necesitamos historial para el RSI (usaremos 2000 ticks de "calentamiento")
    const startIdx = 2000;

    for (let i = startIdx; i < allPrices.length; i++) {
        const p = allPrices[i];
        const t = allTimes[i];

        if (state.inTrade) {
            const spread = CONFIG.stake * 0.0185;
            const profit = (((p - state.openPrice) / state.openPrice) * CONFIG.stake * CONFIG.multiplier) - spread;
            const duration = t - state.openTime;

            let closed = false, reason = "";
            if (profit >= CONFIG.takeProfit) { closed = true; reason = "WIN 🎯"; }
            else if (profit <= -CONFIG.stopLoss) { closed = true; reason = "STOP LOSS 🛡️"; }
            else if (duration >= CONFIG.timeStopTicks && profit < 2) { closed = true; reason = "TIME-STOP ⏱️"; }

            if (closed) {
                state.inTrade = false;
                state.pnl += profit;
                if (profit > 0) {
                    state.wins++;
                    state.cooldown = t + CONFIG.cooldownSecondsWin;
                } else {
                    state.losses++;
                    state.cooldown = t + CONFIG.cooldownSecondsLoss;
                }
                state.trades.push({
                    open: new Date(state.openTime * 1000).toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
                    profit, reason
                });
            }
        } else if (t >= state.cooldown) {
            // Buffer de 2000 ticks para indicadores
            const subPrices = allPrices.slice(i - 2000, i + 1);
            const subTimes = allTimes.slice(i - 2000, i + 1);
            const candles = ticksToM1(subTimes, subPrices);
            const rsiVal = calculateRSI(candles, 14);

            if (rsiVal <= CONFIG.rsiTarget) {
                state.inTrade = true;
                state.openPrice = p;
                state.openTime = t;
            }
        }
    }

    console.log("\n====================================================");
    console.log(`📊 INFORME ESTRATÉGICO BOOM 1000 (ÚLTIMAS 12 HORAS)`);
    console.log("====================================================");
    console.log(`⏱️ Período: ${((allTimes[allTimes.length - 1] - allTimes[0]) / 3600).toFixed(1)} horas`);
    console.log(`📉 RSI Gatillo: <= ${CONFIG.rsiTarget}`);
    console.log(`🛡️ Time-Stop: ${CONFIG.timeStopTicks}s`);
    console.log("----------------------------------------------------");
    console.log(`✔️ Trades Ganados: ${state.wins}`);
    console.log(`❌ Balas Perdidas: ${state.losses}`);
    console.log(`💰 PnL NETO FINAL: ${(state.pnl >= 0 ? "+" : "")}$${state.pnl.toFixed(2)}`);
    console.log(`🎯 Tasa de Éxito: ${((state.wins / (state.wins + state.losses)) * 100 || 0).toFixed(1)}%`);
    console.log("====================================================\n");

    if (state.trades.length > 0) {
        console.log("--- ÚLTIMOS 5 TRADES DEL PERÍODO ---");
        state.trades.slice(-5).forEach(tr => {
            console.log(`[${tr.open}] -> ${tr.reason} ($${tr.profit.toFixed(2)})`);
        });
        console.log("------------------------------------\n");
    }
}
