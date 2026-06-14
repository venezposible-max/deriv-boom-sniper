const WebSocket = require('ws');

const APP_ID = '36544';
const SYMBOLS = ['R_50', 'R_75'];
const TARGET_HOURS = 24;

// Global settings
const DECAY_FACTOR = 0.998;
const DECAY_WEIGHTS = [];
for (let i = 0; i < 3000; i++) {
    DECAY_WEIGHTS.push(Math.pow(DECAY_FACTOR, i));
}

// Store historical tick data for both symbols
const dataStore = {
    R_50: { prices: [], times: [] },
    R_75: { prices: [], times: [] }
};

let activeDownloads = 2;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

function fetchHistory(symbol, endTime = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: symbol,
        count: 5000,
        end: endTime,
        style: 'ticks',
        req_id: symbol === 'R_50' ? 50 : 75
    }));
}

ws.on('open', () => {
    console.log(`📡 Conectado a Deriv. Descargando historial de 24 horas para R_50 y R_75...`);
    fetchHistory('R_50');
    fetchHistory('R_75');
});

ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    
    if (msg.msg_type === 'history' && msg.history) {
        const symbol = msg.req_id === 50 ? 'R_50' : 'R_75';
        const h = msg.history;
        
        dataStore[symbol].prices = [...h.prices, ...dataStore[symbol].prices];
        dataStore[symbol].times = [...h.times, ...dataStore[symbol].times];
        
        const times = dataStore[symbol].times;
        const prices = dataStore[symbol].prices;
        const firstTime = times[0];
        const lastTime = times[times.length - 1];
        const currentHours = (lastTime - firstTime) / 3600;
        
        console.log(`📥 [${symbol}] Cargando ticks: ${prices.length} ticks (${currentHours.toFixed(1)}h / 24h)...`);
        
        if (currentHours < TARGET_HOURS && prices.length < 60000) {
            // Paginar hacia atrás
            setTimeout(() => {
                fetchHistory(symbol, times[0] - 1);
            }, 150); // Rate limit padding
        } else {
            console.log(`✅ [${symbol}] Descarga completa. total ticks: ${prices.length}`);
            activeDownloads--;
            if (activeDownloads === 0) {
                ws.close();
                runBacktestSimulation();
            }
        }
    }
});

// Helper for Shannon Entropy
function calcEntropy(history, sampleSize = 100) {
    const slice = history.slice(-sampleSize);
    const counts = {};
    slice.forEach(d => counts[d] = (counts[d] || 0) + 1);
    let entropy = 0;
    const len = slice.length;
    for (let d in counts) {
        const p = counts[d] / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

function runBacktestSimulation() {
    console.log('\n=============================================================');
    console.log('🧪 INICIANDO SIMULACIÓN DE BACKTEST (Z-SCORE MARKOV DIFFERS)');
    console.log('=============================================================');
    console.log('Configuración:');
    console.log('- Stake: $1.00 (Fijo, sin Martingala)');
    console.log('- Periodo: Últimas 24 horas');
    console.log('- Cooldown: 30 segundos (mínimo 15 ticks)');
    console.log('=============================================================\n');

    // Combine ticks chronologically to simulate a real-time event loop
    // Merge R_50 and R_75 streams by timestamp
    const combinedEvents = [];
    
    SYMBOLS.forEach(sym => {
        const prices = dataStore[sym].prices;
        const times = dataStore[sym].times;
        for (let i = 0; i < prices.length; i++) {
            // Get digit from price
            const priceStr = prices[i].toString();
            // Digits are last digit of price quote
            // To be accurate with deriv-boom decimals: R_50 has 4 decimals, R_75 has 4 decimals
            const decimals = sym === 'R_50' ? 4 : 4;
            const priceFixed = prices[i].toFixed(decimals);
            const digit = parseInt(priceFixed[priceFixed.length - 1]);
            
            combinedEvents.push({
                timestamp: times[i],
                symbol: sym,
                digit: digit,
                price: prices[i]
            });
        }
    });
    
    // Sort chronologically
    combinedEvents.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`📊 Combinados ${combinedEvents.length} ticks para simulación cruzada.`);

    // State
    const markets = {
        R_50: { digitHistory: [], lastTradeTime: 0, shannonEntropy: 3.322 },
        R_75: { digitHistory: [], lastTradeTime: 0, shannonEntropy: 3.322 }
    };
    
    let pnl = 0.0;
    let wins = 0;
    let losses = 0;
    let totalTrades = 0;
    let lastGlobalTradeTime = 0;
    let lastBarrier = null;
    
    const tradeLog = [];

    for (let idx = 0; idx < combinedEvents.length; idx++) {
        const event = combinedEvents[idx];
        const sym = event.symbol;
        const digit = event.digit;
        const now = event.timestamp * 1000; // in ms
        
        const mState = markets[sym];
        mState.digitHistory.push(digit);
        if (mState.digitHistory.length > 2500) mState.digitHistory.shift();
        
        if (mState.digitHistory.length >= 50) {
            mState.shannonEntropy = calcEntropy(mState.digitHistory, 100);
        }
        
        // Skip training window
        if (mState.digitHistory.length < 2000) continue;
        
        // Cooldown check (30 seconds)
        if (now - lastGlobalTradeTime < 30000) continue;
        
        // Evaluate Markov differs logic
        const hist = mState.digitHistory;
        const entropyVal = mState.shannonEntropy;
        
        // Entropy base filter (3.26)
        if (entropyVal >= 3.26) continue;
        
        // Window selection
        let adaptiveWindow = 2000;
        if (entropyVal < 3.10) {
            adaptiveWindow = 500;
        } else if (entropyVal < 3.26) {
            adaptiveWindow = 1000;
        }
        
        const sliceStart = Math.max(0, hist.length - adaptiveWindow);
        const trainingHist = hist.slice(sliceStart);
        
        const matrix = Array(10).fill(0).map(() => Array(10).fill(0));
        const matrixRaw = Array(10).fill(0).map(() => Array(10).fill(0));
        const weightedCounts = Array(10).fill(0);
        const rawCounts = Array(10).fill(0);
        const N = trainingHist.length;
        
        for (let i = 1; i < N; i++) {
            const prev = trainingHist[i - 1];
            const curr = trainingHist[i];
            const age = N - 1 - i;
            const weight = DECAY_WEIGHTS[age] || Math.pow(DECAY_FACTOR, age);
            
            matrix[prev][curr] += weight;
            matrixRaw[prev][curr]++;
            weightedCounts[prev] += weight;
            rawCounts[prev]++;
        }
        
        const currentDigit = hist[hist.length - 1];
        if (rawCounts[currentDigit] < 40) continue;
        
        // Z-threshold
        let zThreshold = -2.0;
        if (entropyVal < 3.10) {
            zThreshold = -1.8;
        } else if (entropyVal < 3.20) {
            zThreshold = -2.2;
        } else {
            zThreshold = -2.5;
        }
        
        let bestTarget = -1;
        let lowestZ = 0;
        let bestProb = 100;
        
        for (let target = 0; target <= 9; target++) {
            const totalRaw = rawCounts[currentDigit];
            const observedRaw = matrixRaw[currentDigit][target];
            
            const expected = totalRaw * 0.1;
            const sd = Math.sqrt(totalRaw * 0.1 * 0.9);
            const zScore = (observedRaw - expected) / sd;
            
            if (zScore <= zThreshold) {
                // Micro streak check
                const last8Ticks = hist.slice(-8);
                const occurrences = last8Ticks.filter(d => d === target).length;
                if (occurrences >= 2) continue;
                
                // Consecutive barrier check
                if (lastBarrier !== null && target === lastBarrier) continue;
                
                if (zScore < lowestZ) {
                    lowestZ = zScore;
                    bestTarget = target;
                    bestProb = (matrix[currentDigit][target] / weightedCounts[currentDigit]) * 100;
                }
            }
        }
        
        if (bestTarget !== -1) {
            // Find result digit: we check the next tick for THIS symbol
            let nextDigit = null;
            for (let nextIdx = idx + 1; nextIdx < combinedEvents.length; nextIdx++) {
                if (combinedEvents[nextIdx].symbol === sym) {
                    nextDigit = combinedEvents[nextIdx].digit;
                    break;
                }
            }
            
            if (nextDigit === null) continue; // No next tick found
            
            const isWin = nextDigit !== bestTarget;
            const profit = isWin ? 0.09 : -1.00;
            
            totalTrades++;
            if (isWin) {
                wins++;
            } else {
                losses++;
            }
            pnl += profit;
            
            lastGlobalTradeTime = now;
            lastBarrier = bestTarget;
            
            tradeLog.push({
                time: new Date(event.timestamp * 1000).toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
                symbol: sym,
                entropy: entropyVal.toFixed(3),
                z: lowestZ.toFixed(2),
                prob: bestProb.toFixed(1),
                barrier: bestTarget,
                outcome: nextDigit,
                result: isWin ? 'WIN ✅' : 'LOSS ❌',
                pnlChange: profit >= 0 ? `+$${profit.toFixed(2)}` : `-$${Math.abs(profit).toFixed(2)}`,
                totalPnl: pnl.toFixed(2)
            });
        }
    }
    
    // Output Report
    console.log('\n' + '═'.repeat(75));
    console.log('📊 REPORTE DE RENDIMIENTO (Últimas 24 Horas Reales)');
    console.log('═'.repeat(75));
    console.log(`🔹 Trades Totales:        ${totalTrades}`);
    console.log(`🔹 Ganadas (Wins):        ${wins}`);
    console.log(`🔹 Perdidas (Losses):     ${losses}`);
    console.log(`📈 Tasa de Acierto (WR):  ${totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : '0'}%`);
    console.log(`💰 PnL Neto Total:        ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
    console.log('═'.repeat(75));
    
    if (tradeLog.length > 0) {
        console.log(`\n📋 MUESTRA DE DETALLE DE ÚLTIMOS 25 DISPAROS:`);
        console.log(`   ┌──────────────────────┬──────┬────────┬────────┬───────┬──────┬──────────┬───────────┐`);
        console.log(`   │ Hora                 │ Act. │ Entrop │ Z-sc   │ Barr  │ Out  │ Res      │ PnL Acum  │`);
        console.log(`   ├──────────────────────┼──────┼────────┼────────┼───────┼──────┼──────────┼───────────┤`);
        tradeLog.slice(-25).forEach(t => {
            const resSymbol = t.result === 'WIN ✅' ? ' WIN ✅  ' : 'LOSS ❌  ';
            console.log(`   │ ${t.time.padEnd(20)} │ ${t.symbol.padEnd(4)} │ ${t.entropy.padStart(6)} │ ${t.z.padStart(6)} │  NO-${t.barrier} │  ${t.outcome}   │${resSymbol}│ $${t.totalPnl.padStart(8)} │`);
        });
        console.log(`   └──────────────────────┴──────┴────────┴────────┴───────┴──────┴──────────┴───────────┘`);
    }
}
