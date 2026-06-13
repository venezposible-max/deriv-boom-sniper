const WebSocket = require('ws');
const fs = require('fs');

const APP_ID = '36544';
const CONFIG = {
    stakeBase: 10.0,
    markovThreshold: 4.0,
    recoveryThresholdFloor: 3.8,
    cooldownTicks: 6, // 6 segundos cooldown normal entre trades
    lossCooldownTicks: 60 // 60 segundos retraso tras pérdida antes de cobertura
};

const SYMBOLS = ['1HZ10V', 'R_50'];

// Utilidad para pausar ejecución
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Descargar ticks paginados para un símbolo (últimas 12 horas)
async function downloadTicks(symbol, hours = 12) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        let allPrices = [];
        let allTimes = [];
        const endTime = Math.floor(Date.now() / 1000);
        const startTime = endTime - (hours * 3600);

        function fetchHistory(endTS) {
            ws.send(JSON.stringify({
                ticks_history: symbol,
                count: 5000,
                end: endTS,
                style: 'ticks'
            }));
        }

        ws.on('open', () => {
            console.log(`📡 Solicitando ticks históricos de ${symbol} (12 Horas)...`);
            fetchHistory('latest');
        });

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (msg.msg_type === 'history' && msg.history) {
                const h = msg.history;
                allPrices = [...h.prices, ...allPrices];
                allTimes = [...h.times, ...allTimes];

                const firstTime = allTimes[0];
                const lastTime = allTimes[allTimes.length - 1];
                const currentHours = (lastTime - firstTime) / 3600;

                process.stdout.write(`\r📦 Descargando ${symbol}: ${allPrices.length} ticks (${currentHours.toFixed(1)}h / ${hours}h)...`);

                if (currentHours < hours && h.prices.length > 0) {
                    // Petición paginada hacia atrás
                    fetchHistory(allTimes[0] - 1);
                } else {
                    console.log(`\n✅ ${symbol} descargado con éxito. Total: ${allPrices.length} ticks.`);
                    ws.close();
                    
                    // Extraer los decimales y los dígitos correspondientes
                    let decimals = 2;
                    if (symbol === 'R_50' || symbol === 'R_75') decimals = 4;
                    else if (symbol === 'R_10' || symbol === 'R_25') decimals = 3;

                    const digits = allPrices.map(p => {
                        const val = p.toFixed(decimals);
                        return parseInt(val.charAt(val.length - 1));
                    });
                    
                    resolve({ prices: allPrices, times: allTimes, digits, decimals });
                }
            }
            if (msg.error) {
                console.error(`\n❌ Error en Deriv API:`, msg.error);
                ws.close();
                reject(msg.error);
            }
        });

        ws.on('error', (e) => reject(e));
        setTimeout(() => { ws.close(); reject('Timeout'); }, 90000);
    });
}

// Simular el backtest sin Take Profit
function runBacktest(symbol, data) {
    const digits = data.digits;
    
    let balance = 0;
    let maxDrawdown = 0;
    let peakBalance = 0;
    
    let totalWins = 0;
    let totalLosses = 0;
    let totalTrades = 0;
    
    let martingaleStep = 0; // 0 = normal, 1 = martingala
    let lastTradeTimeIdx = -2000;
    let recoveryAvailableAtIdx = 0;

    let doubleLossesCount = 0; // Contador de pérdidas dobles catastróficas

    // Tabla de payouts reales
    const DIFF_PAYOUT_RATE = 0.0909;

    // Empezamos en el tick 2000 para tener el historial de calentamiento listo
    for (let i = 2000; i < digits.length - 1; i++) {
        const ticksSinceLast = i - lastTradeTimeIdx;

        // Cooldown de trade normal (6 segundos)
        if (martingaleStep === 0 && ticksSinceLast < CONFIG.cooldownTicks) {
            continue;
        }

        // Cooldown tras pérdida (60 segundos)
        if (martingaleStep > 0 && i < recoveryAvailableAtIdx) {
            continue;
        }

        // Analizar Markov en ventana de 2000 ticks
        const hist = digits.slice(i - 2000, i + 1);
        let matrix = Array(10).fill(0).map(() => Array(10).fill(0));
        let counts = Array(10).fill(0);

        for (let k = 1; k < hist.length; k++) {
            let prev = hist[k - 1];
            let curr = hist[k];
            matrix[prev][curr]++;
            counts[prev]++;
        }

        const currentDigit = hist[hist.length - 1];
        let bestTarget = -1;
        let lowestProb = 100;

        let activeThreshold = CONFIG.markovThreshold;
        if (martingaleStep > 0) {
            activeThreshold = Math.max(CONFIG.recoveryThresholdFloor, activeThreshold * 0.8);
        }

        for (let target = 0; target <= 9; target++) {
            if (counts[currentDigit] > 0) {
                let prob = (matrix[currentDigit][target] / counts[currentDigit]) * 100;
                if (prob > 0 && prob <= activeThreshold) {
                    if (prob < lowestProb) {
                        lowestProb = prob;
                        bestTarget = target;
                    }
                }
            }
        }

        if (bestTarget !== -1) {
            const nextDigit = digits[i + 1];
            const won = nextDigit !== bestTarget;
            
            let stake = CONFIG.stakeBase;
            if (martingaleStep > 0) {
                stake = CONFIG.stakeBase * 11;
            }

            totalTrades++;
            lastTradeTimeIdx = i;

            if (won) {
                const profit = stake * DIFF_PAYOUT_RATE;
                balance += profit;
                totalWins++;

                if (martingaleStep > 0) {
                    martingaleStep = 0; // Cobertura exitosa
                }
            } else {
                balance -= stake;
                totalLosses++;

                if (martingaleStep === 0) {
                    martingaleStep = 1; // Entramos a recuperación
                    recoveryAvailableAtIdx = i + CONFIG.lossCooldownTicks;
                } else {
                    martingaleStep = 0; // Pérdida catastrófica doble
                    doubleLossesCount++;
                }
            }

            // Calcular Drawdown
            if (balance > peakBalance) {
                peakBalance = balance;
            }
            const drawdown = peakBalance - balance;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }
    }

    const wr = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0.0';

    return {
        symbol,
        totalTrades,
        wins: totalWins,
        losses: totalLosses,
        winRate: wr,
        pnl: balance,
        maxDrawdown,
        doubleLossesCount
    };
}

async function main() {
    console.log("=========================================================================");
    console.log("🚀 SIMULANDO BACKTESTING DE 12 HORAS CORRIDAS (SIN TAKE PROFIT)");
    console.log(`   ⚙️ Stake Base: $${CONFIG.stakeBase.toFixed(2)}`);
    console.log(`   ⚙️ Umbral Markov Normal: ${CONFIG.markovThreshold.toFixed(1)}%`);
    console.log(`   ⚙️ Cobertura: ON (Martingala x11 con piso de umbral 3.8% y 60s cooldown)`);
    console.log("=========================================================================\n");

    const results = [];
    
    for (const symbol of SYMBOLS) {
        try {
            const data = await downloadTicks(symbol, 12);
            await sleep(1500); // Evitar rate limits de la API
            const result = runBacktest(symbol, data);
            results.push(result);
        } catch (e) {
            console.error(`Error procesando backtest para ${symbol}:`, e);
        }
        console.log("");
    }

    console.log("=========================================================================");
    console.log("📊 INFORME FINAL DE RENTABILIDAD ACUMULADA EN 12 HORAS");
    console.log("=========================================================================");

    for (const r of results) {
        console.log(`📈 RESULTADOS PARA ${r.symbol}:`);
        console.log(`   - Operaciones Totales: ${r.totalTrades}`);
        console.log(`   - Ganadas: ${r.wins} | Perdidas: ${r.losses}`);
        console.log(`   - Win Rate (Tasa de acierto): ${r.winRate}%`);
        console.log(`   - PnL Neto Acumulado (12h): ${(r.pnl >= 0 ? '+' : '')}$${r.pnl.toFixed(2)}`);
        console.log(`   - Máximo Drawdown (Riesgo máximo): $${r.maxDrawdown.toFixed(2)}`);
        console.log(`   - Pérdidas Dobles Catastróficas (x120 perdidos): ⚠️ ${r.doubleLossesCount} veces`);
        console.log("-------------------------------------------------------------------------");
    }
}

main().catch(e => console.error("Error global:", e));
