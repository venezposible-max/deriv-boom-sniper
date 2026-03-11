const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURACIÓN DE BACKTEST (BOOM 1000 SNIPER)
// ==========================================
const CONFIG = {
    stake: 20,
    multiplier: 200,
    rsiThreshold: 25,
    timeStopTicks: 70,
    quickReloadSeconds: 3,
    stopLoss: 2.50,
    takeProfit: 2.00,
    ticksPerCandle: 60 // M1 candles
};

// --- SIMULACIÓN DE INDICADORES ---
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = period + 1; i < prices.length; i++) {
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

// --- CARGA DE DATOS ---
const STATE_FILE = path.join(__dirname, 'persistent-state-boom.json');
let history = [];
try {
    // Intentamos cargar ticks reales del archivo de estado si existe y tiene historial
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Nota: El bot guarda tickHistory pero no siempre en el JSON. 
    // Como el bot real está corriendo, vamos a simular un set de datos de 10,000 ticks
    // basados en la volatilidad real del Boom 1000 para validar los parámetros.
} catch (e) {
    console.log("Generando escenario de prueba basado en volatilidad real de Boom 1000...");
}

// Escenario: 10,000 milisegundos de mercado (aprox 2.7 horas)
function runSimulation() {
    let balance = 1000;
    let initialBalance = balance;
    let activeTrade = null;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let cooldown = 0;

    // Generar un mercado sintético realista de Boom 1000
    // Desangre: -0.01 a -0.05 por tick
    // Spike: +5.0 a +15.0 puntos (ocurre aprox cada 1000 ticks)
    let price = 12500;
    let ticks = [];
    for (let i = 0; i < 20000; i++) {
        let isSpike = Math.random() < (1 / 1000);
        if (isSpike) price += (5 + Math.random() * 20);
        else price -= (0.01 + Math.random() * 0.04);
        ticks.push(price);
    }

    console.log(`\n📊 INICIANDO BACKTEST SNIPER (Escenario: 20,000 Ticks)`);
    console.log(`----------------------------------------------------`);

    for (let i = 2000; i < ticks.length; i++) {
        if (cooldown > 0) {
            cooldown--;
            continue;
        }

        const currentPrice = ticks[i];

        // Simular cálculo de RSI M1
        let candlePrices = [];
        for (let j = 0; j < i; j += 60) candlePrices.push(ticks[j]);
        const rsi = calculateRSI(candlePrices.slice(-60));

        if (!activeTrade) {
            if (rsi <= CONFIG.rsiThreshold) {
                activeTrade = {
                    entryPrice: currentPrice,
                    startTime: i,
                    maxProfit: 0
                };
                totalTrades++;
            }
        } else {
            let elapsedTicks = i - activeTrade.startTime;
            let pnlRaw = (currentPrice - activeTrade.entryPrice) * (CONFIG.stake * CONFIG.multiplier / activeTrade.entryPrice);
            let commission = 0.35; // Comisión promedio Deriv x200
            let pnl = pnlRaw - commission;

            activeTrade.maxProfit = Math.max(activeTrade.maxProfit, pnl);

            // Reglas de Cierre
            let closed = false;
            let reason = "";

            if (pnl >= CONFIG.takeProfit) {
                wins++;
                balance += pnl;
                closed = true;
                reason = "TAKE PROFIT 🎯";
                cooldown = 45 * 10; // 45s aprox
            } else if (pnl <= -CONFIG.stopLoss) {
                losses++;
                balance += pnl;
                closed = true;
                reason = "STOP LOSS 🛡️";
                cooldown = 3 * 10;
            } else if (elapsedTicks >= CONFIG.timeStopTicks) {
                losses++;
                balance += pnl;
                closed = true;
                reason = "TIME STOP ⏱️";
                cooldown = 3 * 10;
            }

            if (closed) {
                // console.log(`Trade ${totalTrades}: ${reason} | PnL: $${pnl.toFixed(2)} | RSI: ${rsi.toFixed(1)}`);
                activeTrade = null;
            }
        }
    }

    console.log(`\n✅ RESULTADOS DEL BACKTEST:`);
    console.log(`----------------------------------------------------`);
    console.log(`💰 Balance Final: $${balance.toFixed(2)} (${balance >= initialBalance ? '+' : ''}${(((balance / initialBalance) - 1) * 100).toFixed(2)}%)`);
    console.log(`🎯 Total Disparos: ${totalTrades}`);
    console.log(`✅ Spikes Cazados (Wins): ${wins}`);
    console.log(`🛡️ Balas Perdidas (Loss/TS): ${losses}`);
    console.log(`📈 Win Rate: ${((wins / totalTrades) * 100).toFixed(1)}%`);
    console.log(`💵 PnL Neto: $${(balance - initialBalance).toFixed(2)}`);
    console.log(`----------------------------------------------------\n`);
}

runSimulation();
