import WebSocket from 'ws';
import fs from 'fs';

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];
const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD'; // Demo token for history

let results = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    coberturasWin: 0,
    coberturasLoss: 0,
    pnl: 0,
    maxStreak: 0
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

async function runBacktest() {
    console.log("🧪 Iniciando Backtesting Maestro (Markov + Cisne x4 + Cobertura)...");
    
    for (const symbol of SYMBOLS) {
        console.log(`📡 Obteniendo datos históricos de ${symbol}...`);
        const ticks = await fetchHistory(symbol);
        console.log(`✅ Procesando ${ticks.length} ticks de ${symbol}...`);
        
        let digitHistory = [];
        let lastDigit = null;

        // 1. Fase de Entrenamiento (Primeros 4000 ticks para llenar la Matriz de Markov)
        for (let i = 0; i < 4000; i++) {
            const d = parseInt(String(ticks[i].quote.toFixed(2)).slice(-1));
            if (lastDigit !== null) botState.transitionMatrices[symbol][lastDigit][d]++;
            lastDigit = d;
            digitHistory.push(d);
        }

        // 2. Fase de Ejecución (Últimos 1000 ticks)
        for (let i = 4000; i < ticks.length; i++) {
            const d = parseInt(String(ticks[i].quote.toFixed(2)).slice(-1));
            const prevDigit = lastDigit;
            
            // Actualizar Markov
            botState.transitionMatrices[symbol][prevDigit][d]++;
            digitHistory.push(d);
            lastDigit = d;

            // Lógica de Gatillo Cisne x4
            const last4 = digitHistory.slice(-4);
            if (last4.length === 4 && last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
                const barrier = last4[0];
                
                // Filtro Markov
                const trans = botState.transitionMatrices[symbol][barrier];
                let totalTrans = 0;
                for (let j = 0; j <= 9; j++) totalTrans += trans[j];
                const prob = (trans[barrier] / totalTrans) * 100;

                if (prob <= 12) { // Si es seguro disparar
                    const nextDigit = parseInt(String(ticks[i+1]?.quote.toFixed(2)).slice(-1));
                    if (nextDigit === undefined) break;

                    const isWin = nextDigit !== barrier;
                    const stake = botState.needsRecovery ? 10 : 5;
                    const profit = isWin ? (stake * 0.09) : -stake; // Profit real de Differ (~9%)

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
                    i++; // Saltamos el tick del contrato
                }
            }
        }
    }

    console.log("\n==========================================");
    console.log("📊 RESULTADOS DEL BACKTEST (Últimas 24h Proyectadas)");
    console.log("==========================================");
    // Extrapolamos de 4000 ticks (~1 hora real de disparos) a 24 horas
    const factor = 24; 
    console.log(`🔹 Trades Totales: ${results.totalTrades * factor}`);
    console.log(`🔹 Ganados: ${results.wins * factor}`);
    console.log(`🔹 Perdidos: ${results.losses * factor}`);
    console.log(`🔹 Coberturas Exitosas: ${results.coberturasWin * factor}`);
    console.log(`🔹 Coberturas Fallidas: ${results.coberturasLoss * factor}`);
    console.log(`💰 PnL Estimado: +$${(results.pnl * factor).toFixed(2)}`);
    console.log(`📈 Eficiencia Final: ${((results.wins / results.totalTrades) * 100).toFixed(2)}%`);
    console.log("==========================================\n");
    process.exit();
}

function fetchHistory(symbol) {
    return new Promise((resolve) => {
        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + APP_ID);
        ws.on('open', () => {
            ws.send(JSON.stringify({ authorize: TOKEN }));
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.msg_type === 'authorize') {
                ws.send(JSON.stringify({
                    ticks_history: symbol,
                    adjust_start_time: 1,
                    count: 5000,
                    end: 'latest',
                    style: 'ticks'
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

runBacktest();
