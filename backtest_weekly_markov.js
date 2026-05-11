import WebSocket from 'ws';
import fs from 'fs';

const SYMBOLS = ['R_10', 'R_25', 'R_100']; // Usamos los 3 más estables para el semanal
const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD';

let dailyResults = [];

async function runWeeklyBacktest() {
    console.log("📅 Iniciando Backtesting SEMANAL (Stake 10 | Fantasma ON | Cobertura x10)...");
    
    for (let day = 0; day < 7; day++) {
        const endTime = Math.floor(Date.now() / 1000) - (day * 86400);
        const startTime = endTime - 86400;
        
        let dayStats = { day: day + 1, trades: 0, wins: 0, losses: 0, pnl: 0, ghostSaves: 0 };
        let botState = { stake: 10, recoveryStake: 100, needsRecovery: false, transitionMatrices: {} };

        // Inicializar matrices para este día
        SYMBOLS.forEach(s => {
            botState.transitionMatrices[s] = {};
            for (let i = 0; i <= 9; i++) {
                botState.transitionMatrices[s][i] = {};
                for (let j = 0; j <= 9; j++) botState.transitionMatrices[s][i][j] = 0;
            }
        });

        console.log(`\n⏳ Procesando Día ${day + 1} (${new Date(startTime * 1000).toLocaleDateString()})...`);

        for (const symbol of SYMBOLS) {
            // Descargamos una muestra significativa de 20,000 ticks por día/símbolo para el semanal
            const ticks = await fetchHistoryChunk(symbol, endTime, 20000); 
            if (ticks.length < 5000) continue;

            let digitHistory = [];
            let lastDigit = null;
            const trainLimit = Math.floor(ticks.length * 0.3);

            for (let i = 0; i < ticks.length; i++) {
                const d = parseInt(String(ticks[i].quote.toFixed(2)).slice(-1));
                if (lastDigit !== null) botState.transitionMatrices[symbol][lastDigit][d]++;
                
                if (i >= trainLimit) {
                    const last4 = digitHistory.slice(-4);
                    if (last4.length === 4 && last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
                        const barrier = last4[0];
                        const trans = botState.transitionMatrices[symbol][barrier];
                        let total = 0;
                        for (let j = 0; j <= 9; j++) total += trans[j];
                        
                        if (total > 50 && (trans[barrier] / total) <= 0.12) {
                            // MODO FANTASMA
                            const virtualTick = parseInt(String(ticks[i+1]?.quote.toFixed(2)).slice(-1));
                            if (virtualTick === barrier) {
                                // DISPARO REAL
                                const realTick = parseInt(String(ticks[i+2]?.quote.toFixed(2)).slice(-1));
                                if (realTick !== undefined) {
                                    const isWin = realTick !== barrier;
                                    const currentStake = botState.needsRecovery ? 100 : 10;
                                    const profit = isWin ? (currentStake * 0.091) : -currentStake;

                                    dayStats.trades++;
                                    if (isWin) { dayStats.wins++; botState.needsRecovery = false; }
                                    else { dayStats.losses++; botState.needsRecovery = true; }
                                    dayStats.pnl += profit;
                                    i += 2;
                                }
                            } else {
                                dayStats.ghostSaves++;
                                i++;
                            }
                        }
                    }
                }
                lastDigit = d;
                digitHistory.push(d);
            }
        }
        // Extrapolamos la muestra de 20k ticks a un día completo de 86k ticks (x4.3)
        const factor = 4.3;
        dailyResults.push({
            label: new Date(startTime * 1000).toLocaleDateString(),
            trades: Math.round(dayStats.trades * factor),
            pnl: (dayStats.pnl * factor).toFixed(2),
            wins: Math.round(dayStats.wins * factor),
            losses: Math.round(dayStats.losses * factor)
        });
    }

    console.log("\n========================================================");
    console.log("📊 REPORTE SEMANAL DE RENDIMIENTO (STAKE 10 | GHOST ON)");
    console.log("========================================================");
    console.log("FECHA         | TRADES | GANADOS | PERDIDOS | PnL NETO");
    console.log("--------------------------------------------------------");
    let totalPnl = 0;
    dailyResults.reverse().forEach(r => {
        console.log(`${r.label}    | ${r.trades}      | ${r.wins}       | ${r.losses}        | +$${r.pnl}`);
        totalPnl += parseFloat(r.pnl);
    });
    console.log("--------------------------------------------------------");
    console.log(`💰 BALANCE TOTAL SEMANAL: +$${totalPnl.toFixed(2)}`);
    console.log("========================================================\n");
    process.exit();
}

function fetchHistoryChunk(symbol, end, count) {
    return new Promise((resolve) => {
        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + APP_ID);
        ws.on('open', () => { ws.send(JSON.stringify({ authorize: TOKEN })); });
        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.msg_type === 'authorize') {
                ws.send(JSON.stringify({
                    ticks_history: symbol, count: count, end: end, style: 'ticks'
                }));
            }
            if (msg.msg_type === 'history') {
                const ticks = msg.history.prices.map((p, i) => ({ quote: p }));
                ws.close();
                resolve(ticks);
            }
        });
    });
}

runWeeklyBacktest();
