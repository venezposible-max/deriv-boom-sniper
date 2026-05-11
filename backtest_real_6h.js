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
    coberturasLoss: 0
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

async function runRealBacktest() {
    console.log("🔍 Iniciando Backtesting REAL de las últimas 6 horas...");
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (6 * 3600);

    for (const symbol of SYMBOLS) {
        console.log(`📡 Descargando historial de ${symbol}...`);
        const ticks = await fetchAllHistory(symbol, startTime, endTime);
        console.log(`✅ ${ticks.length} ticks obtenidos para ${symbol}. Procesando...`);

        let digitHistory = [];
        let lastDigit = null;

        // Entrenar con el primer 50% de la data
        const trainLimit = Math.floor(ticks.length * 0.5);
        for (let i = 0; i < trainLimit; i++) {
            const d = parseInt(String(ticks[i].quote.toFixed(2)).slice(-1));
            if (lastDigit !== null) botState.transitionMatrices[symbol][lastDigit][d]++;
            lastDigit = d;
            digitHistory.push(d);
        }

        // Ejecutar con el segundo 50%
        for (let i = trainLimit; i < ticks.length; i++) {
            const d = parseInt(String(ticks[i].quote.toFixed(2)).slice(-1));
            const prevDigit = lastDigit;
            botState.transitionMatrices[symbol][prevDigit][d]++;
            digitHistory.push(d);
            lastDigit = d;

            const last4 = digitHistory.slice(-4);
            if (last4.length === 4 && last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
                const barrier = last4[0];
                const trans = botState.transitionMatrices[symbol][barrier];
                let totalTrans = 0;
                for (let j = 0; j <= 9; j++) totalTrans += trans[j];
                const prob = (trans[barrier] / totalTrans) * 100;

                if (prob <= 12) {
                    const nextDigit = parseInt(String(ticks[i+1]?.quote.toFixed(2)).slice(-1));
                    if (nextDigit === undefined) break;

                    const isWin = nextDigit !== barrier;
                    const stake = botState.needsRecovery ? 10 : 5;
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
                    i++; 
                }
            }
        }
    }

    console.log("\n==========================================");
    console.log("📊 RESULTADOS REALES (Últimas 6 Horas)");
    console.log("==========================================");
    console.log(`🔹 Trades Ejecutados: ${results.totalTrades}`);
    console.log(`🔹 Ganados ✅: ${results.wins}`);
    console.log(`🔹 Perdidos ❌: ${results.losses}`);
    console.log(`🔹 Coberturas Exitosas: ${results.coberturasWin}`);
    console.log(`💰 PnL Real: $${results.pnl.toFixed(2)}`);
    console.log(`📈 Eficiencia: ${((results.wins / results.totalTrades) * 100).toFixed(2)}%`);
    console.log("==========================================\n");
    process.exit();
}

async function fetchAllHistory(symbol, start, end) {
    let allTicks = [];
    let currentEnd = end;
    
    // Hacemos varias peticiones para cubrir 6 horas (aprox 21600 ticks)
    for (let j = 0; j < 5; j++) { 
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
                    ticks_history: symbol,
                    count: 5000,
                    end: end,
                    style: 'ticks'
                }));
            }
            if (msg.msg_type === 'history') {
                const ticks = msg.history.prices.map((p, i) => ({ 
                    quote: p, 
                    epoch: msg.history.times[i] 
                }));
                ws.close();
                resolve(ticks);
            }
        });
    });
}

runRealBacktest();
