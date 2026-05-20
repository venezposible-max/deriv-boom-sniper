import WebSocket from 'ws';
import fs from 'fs';

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];
const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD';

let botState = {
    stake: 10,
    target: 10,
    needsRecovery: false,
    transitionMatrices: {}
};

SYMBOLS.forEach(s => {
    botState.transitionMatrices[s] = {};
    for (let i = 0; i <= 9; i++) {
        botState.transitionMatrices[s][i] = {};
        for (let j = 0; j <= 9; j++) botState.transitionMatrices[s][i][j] = 0;
    }
});

async function runGoalBacktest24h() {
    console.log("🎯 Iniciando Backtesting de OBJETIVO ($10) en las últimas 24h...");
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (24 * 3600);

    let totalPnL = 0;
    let tradesCount = 0;
    let timeStarted = null;
    let timeReached = null;
    let wins = 0;
    let losses = 0;

    // Descargamos datos (usamos una muestra combinada de los 4 mercados)
    const allTicks = [];
    for (const symbol of SYMBOLS) {
        console.log(`📡 Descargando ${symbol}...`);
        const ticks = await fetchHistoryChunk(symbol, endTime, 20000);
        allTicks.push({ symbol, ticks });
    }

    // Simulamos el paso del tiempo tick a tick combinando mercados
    let currentIdx = 0;
    let digitHistory = {};
    SYMBOLS.forEach(s => digitHistory[s] = []);

    console.log("🚀 Buscando el objetivo...");

    for (let i = 0; i < 20000; i++) {
        for (const symbol of SYMBOLS) {
            const ticks = allTicks.find(t => t.symbol === symbol).ticks;
            const tick = ticks[i];
            if (!tick) continue;
            
            const d = parseInt(String(tick.quote.toFixed(2)).slice(-1));
            const prevD = digitHistory[symbol].slice(-1)[0];
            if (prevD !== undefined) botState.transitionMatrices[symbol][prevD][d]++;
            digitHistory[symbol].push(d);

            if (i > 5000 && totalPnL < botState.target) {
                if (!timeStarted) timeStarted = tick.epoch || Date.now()/1000;

                const last4 = digitHistory[symbol].slice(-4);
                if (last4.length === 4 && last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
                    const barrier = last4[0];
                    const trans = botState.transitionMatrices[symbol][barrier];
                    let total = 0;
                    for (let j = 0; j <= 9; j++) total += trans[j];

                    if (total > 30 && (trans[barrier]/total) <= 0.12) {
                        // GHOST MODE
                        const virtualTick = parseInt(String(ticks[i+1]?.quote.toFixed(2)).slice(-1));
                        if (virtualTick === barrier) {
                            // REAL TRADE
                            const realTick = parseInt(String(ticks[i+2]?.quote.toFixed(2)).slice(-1));
                            if (realTick !== undefined) {
                                const isWin = realTick !== barrier;
                                const stake = botState.needsRecovery ? 100 : 10;
                                const profit = isWin ? (stake * 0.091) : -stake;

                                totalPnL += profit;
                                tradesCount++;
                                if (isWin) { wins++; botState.needsRecovery = false; }
                                else { losses++; botState.needsRecovery = true; }

                                if (totalPnL >= botState.target && !timeReached) {
                                    timeReached = ticks[i+2].epoch || Date.now()/1000;
                                }
                            }
                        }
                    }
                }
            }
        }
        if (totalPnL >= botState.target) break;
    }

    console.log("\n==========================================");
    console.log("🏁 RESULTADO DE LA MISIÓN: OBJETIVO $10");
    console.log("==========================================");
    if (totalPnL >= botState.target) {
        const minutes = Math.floor((timeReached - timeStarted) / 60);
        console.log(`✅ OBJETIVO ALCANZADO: +$${totalPnL.toFixed(2)}`);
        console.log(`⏱️ TIEMPO REQUERIDO: ${minutes} minutos`);
        console.log(`📊 TRADES TOTALES: ${tradesCount} (${wins} ✅ / ${losses} ❌)`);
    } else {
        console.log("❌ NO SE ALCANZÓ EL OBJETIVO EN LA MUESTRA.");
        console.log(`💰 PnL FINAL: $${totalPnL.toFixed(2)}`);
    }
    console.log("==========================================\n");
    process.exit();
}

function fetchHistoryChunk(symbol, end, count) {
    return new Promise((resolve) => {
        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + APP_ID);
        ws.on('open', () => { ws.send(JSON.stringify({ authorize: TOKEN })); });
        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.msg_type === 'authorize') {
                ws.send(JSON.stringify({ ticks_history: symbol, count, end, style: 'ticks' }));
            }
            if (msg.msg_type === 'history') {
                const ticks = msg.history.prices.map((p, i) => ({ quote: p, epoch: msg.history.times[i] }));
                ws.close();
                resolve(ticks);
            }
        });
    });
}

runGoalBacktest24h();
