import WebSocket from 'ws';
import fs from 'fs';

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];
const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD';

let results = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    coberturasWin: 0,
    coberturasLoss: 0,
    ghostSaves: 0
};

let botState = {
    stake: 5,
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

async function runGhostBacktest24h() {
    console.log("🔍 Iniciando Backtesting REAL 24h con MODO FANTASMA ACTIVADO...");
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (24 * 3600);

    for (const symbol of SYMBOLS) {
        console.log(`📡 Descargando historial de ${symbol}...`);
        const ticks = await fetchAllHistory(symbol, startTime, endTime);
        console.log(`✅ ${ticks.length} ticks obtenidos para ${symbol}. Procesando con Fantasma...`);

        let digitHistory = [];
        let lastDigit = null;

        const trainLimit = Math.floor(ticks.length * 0.2);
        for (let i = 0; i < trainLimit; i++) {
            const d = parseInt(String(ticks[i].quote.toFixed(2)).slice(-1));
            if (lastDigit !== null) botState.transitionMatrices[symbol][lastDigit][d]++;
            lastDigit = d;
            digitHistory.push(d);
        }

        for (let i = trainLimit; i < ticks.length; i++) {
            const d = parseInt(String(ticks[i].quote.toFixed(2)).slice(-1));
            const prevDigit = lastDigit;
            botState.transitionMatrices[symbol][prevDigit][d]++;
            digitHistory.push(d);
            lastDigit = d;

            const last4 = digitHistory.slice(-4);
            if (last4.length === 4 && last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
                const barrier = last4[0];
                
                // Filtro Markov
                const trans = botState.transitionMatrices[symbol][barrier];
                let totalTrans = 0;
                for (let j = 0; j <= 9; j++) totalTrans += trans[j];
                const prob = (trans[barrier] / totalTrans) * 100;

                if (prob <= 12) {
                    // MODO FANTASMA: Esperar un fallo virtual (el número debe salir una 5ª vez)
                    const virtualTick = parseInt(String(ticks[i+1]?.quote.toFixed(2)).slice(-1));
                    if (virtualTick === undefined) break;

                    if (virtualTick === barrier) {
                        // ¡FALLO VIRTUAL DETECTADO! Ahora disparamos REAL
                        const realTick = parseInt(String(ticks[i+2]?.quote.toFixed(2)).slice(-1));
                        if (realTick === undefined) break;

                        const isWin = realTick !== barrier;
                        const stake = botState.needsRecovery ? 50 : 5;
                        const profit = isWin ? (stake * 0.091) : -stake;

                        results.totalTrades++;
                        if (isWin) {
                            results.wins++;
                            if (botState.needsRecovery) results.coberturasWin++;
                            botState.needsRecovery = false;
                        } else {
                            results.losses++;
                            if (botState.needsRecovery) results.coberturasLoss++;
                            botState.needsRecovery = true;
                        }
                        results.pnl += profit;
                        i += 2; // Saltamos los ticks procesados
                    } else {
                        // El fantasma ganó (el número no salió una 5ª vez). No disparamos.
                        results.ghostSaves++;
                        i++;
                    }
                }
            }
        }
    }

    console.log("\n==========================================");
    console.log("📊 RESULTADOS CON MODO FANTASMA (24 HORAS)");
    console.log("==========================================");
    console.log(`🔹 Fallos Virtuales Evitados: ${results.ghostSaves}`);
    console.log(`🔹 Trades Reales Ejecutados: ${results.totalTrades}`);
    console.log(`🔹 Ganados ✅: ${results.wins}`);
    console.log(`🔹 Perdidos ❌: ${results.losses}`);
    console.log(`🔹 Coberturas (x10) Ganadas: ${results.coberturasWin}`);
    console.log(`💰 PnL Real con Fantasma: +$${results.pnl.toFixed(2)}`);
    console.log(`📈 Eficiencia Real: ${((results.wins / results.totalTrades) * 100).toFixed(2)}%`);
    console.log("==========================================\n");
    process.exit();
}

async function fetchAllHistory(symbol, start, end) {
    let allTicks = [];
    let currentEnd = end;
    for (let j = 0; j < 18; j++) { 
        const chunk = await fetchHistoryChunk(symbol, currentEnd);
        if (chunk.length === 0) break;
        allTicks = chunk.concat(allTicks);
        currentEnd = chunk[0].epoch - 1;
        if (currentEnd < start) break;
    }
    return allTicks;
}

function fetchHistoryChunk(symbol, end) {
    return new Promise((resolve) => {
        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + APP_ID);
        ws.on('open', () => { ws.send(JSON.stringify({ authorize: TOKEN })); });
        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.msg_type === 'authorize') {
                ws.send(JSON.stringify({
                    ticks_history: symbol, count: 5000, end: end, style: 'ticks'
                }));
            }
            if (msg.msg_type === 'history') {
                const ticks = msg.history.prices.map((p, i) => ({ quote: p, epoch: msg.history.times[i] }));
                ws.close();
                resolve(ticks);
            }
        });
    });
}

runGhostBacktest24h();
