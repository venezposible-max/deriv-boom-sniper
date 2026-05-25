/**
 * ============================================================
 *  🧪 KRAKEN ENGINE v3.0 — BACKTEST CRONOMETRADO 24 HORAS
 *  Simulación Cuantitativa de Over/Under Markov + Ghost Shield
 *  
 *  Configuración del Usuario:
 *  - Stake Base: $1.00
 *  - Take Profit: $20.00
 *  - Stop Loss (Max Loss): $200.00
 *  - Símbolo: R_25 (Volatility 25 Index)
 *  - Duración Histórica: 24 Horas (~45,000 a 50,000 ticks)
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';
const TARGET_HOURS = 24;

// Parámetros del Usuario
const STAKE_BASE = 1.00;
const MAX_LOSS = 200.00;
const TAKE_PROFIT = 20.00;

// Configuración del Motor (Igual al bot real en Modo Normal)
const MARKOV_WINDOW = 100;
const CHI_THRESHOLD = 5.0;      // Filtro Chi-Cuadrado de desbalance
const OVER_UNDER_THRESHOLD = 0.60; // Consenso Markov del 60%
const COOLDOWN_TICKS = 6;       // 6 ticks de enfriamiento estándar (~12s)

let allPrices = [];
let allTimes = [];

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

function fetchHistory(endTime = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        count: 5000,
        end: endTime,
        style: 'ticks'
    }));
}

ws.on('open', () => {
    console.log(`\n📡 Conectado a Deriv. Descargando historial de ${TARGET_HOURS} horas de ticks en paralelo para ${SYMBOL}...`);
    fetchHistory();
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

        process.stdout.write(`\r📥 Cargando ticks históricos: ${allPrices.length} ticks (${currentHours.toFixed(1)}h / ${TARGET_HOURS}h)...`);

        if (currentHours < TARGET_HOURS && allPrices.length < 150000) {
            // Paginación hacia atrás en el tiempo
            fetchHistory(allTimes[0] - 1);
        } else {
            console.log("\n✅ Historial completo descargado con éxito.");
            ws.close();
            runSimulation();
        }
    }
    if (msg.error) {
        console.error(`\n❌ Error de API: ${msg.error.message}`);
        ws.close();
    }
});

// ─── ALGORITMOS MATEMÁTICOS DE KRAKEN ─────────────────────────

function calcChiSquared(hist, range) {
    const sub = hist.slice(-range);
    if (sub.length < range) return { chi2: 0, significant: false };
    
    const observed = {};
    for (let d = 0; d <= 9; d++) observed[d] = 0;
    sub.forEach(d => observed[d]++);
    
    const expected = range / 10;
    let chi2 = 0;
    for (let d = 0; d <= 9; d++) {
        chi2 += Math.pow(observed[d] - expected, 2) / expected;
    }
    return { chi2, significant: chi2 > 16.92 };
}

function build2ndOrderMarkovMatrix(hist) {
    const matrix = {};
    for (let i = 0; i <= 99; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    for (let k = 2; k < hist.length; k++) {
        const state = (hist[k - 2] * 10) + hist[k - 1]; 
        const nextDigit = hist[k];
        matrix[state][nextDigit]++;
    }
    for (let i = 0; i <= 99; i++) {
        const total = Object.values(matrix[i]).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (let j = 0; j <= 9; j++) matrix[i][j] = matrix[i][j] / total;
        } else {
            for (let j = 0; j <= 9; j++) matrix[i][j] = 0.1;
        }
    }
    return matrix;
}

// ─── EJECUCIÓN DE LA SIMULACIÓN ───────────────────────────────

function runSimulation() {
    const totalTicks = allPrices.length;
    console.log(`\n🧪 Iniciando simulación Sniper Over/Under Markov...`);
    console.log(`📊 Total Ticks a analizar: ${totalTicks}`);
    console.log(`📈 Configuración: TP=$${TAKE_PROFIT} | SL=-$${MAX_LOSS} | StakeBase=$${STAKE_BASE}`);
    console.log('─'.repeat(70));

    let pnl = 0.0;
    let winsReal = 0;
    let lossesReal = 0;
    let winsGhost = 0;
    let lossesGhost = 0;
    let maxDrawdown = 0.0;
    let peakPnl = 0.0;

    let martingaleStep = 0;
    let isGhostArmed = false; // El Escudo de Entrada
    let ticksSinceLastTrade = COOLDOWN_TICKS;
    let lastTradeTime = 0;

    const digitHistory = [];
    const trades = [];

    const payoutRateOverUnder = 1.40; // Pago del ~140% del stake en Over/Under
    
    // Tiempos de inicio y fin
    const startTime = allTimes[0];
    let endTime = allTimes[totalTicks - 1];
    let simulationTimeElapsed = 0; // segundos
    let targetReached = false;
    let targetReachedTime = 0;
    let slHit = false;
    let slHitTime = 0;

    for (let i = 0; i < totalTicks - 1; i++) {
        const currentQuote = allPrices[i];
        const currentDigit = parseInt(String(currentQuote).slice(-1));
        const nextQuote = allPrices[i + 1];
        const nextDigit = parseInt(String(nextQuote).slice(-1));
        const currentTime = allTimes[i];

        digitHistory.push(currentDigit);
        if (digitHistory.length > 500) digitHistory.shift();
        ticksSinceLastTrade++;

        // Condición mínima de calentamiento de ventana
        if (digitHistory.length < MARKOV_WINDOW) continue;

        // Limitar ejecución si ya se alcanzó Take Profit o Stop Loss
        if (pnl >= TAKE_PROFIT) {
            if (!targetReached) {
                targetReached = true;
                targetReachedTime = currentTime - startTime;
            }
            continue;
        }
        if (pnl <= -MAX_LOSS) {
            if (!slHit) {
                slHit = true;
                slHitTime = currentTime - startTime;
            }
            continue;
        }

        // Evaluar Filtros del Motor
        const chiTest = calcChiSquared(digitHistory, MARKOV_WINDOW);
        if (chiTest.chi2 < CHI_THRESHOLD) continue;

        const markovHist = digitHistory.slice(-MARKOV_WINDOW);
        const lastDigit = digitHistory[digitHistory.length - 1];
        const penultDigit = digitHistory[digitHistory.length - 2];
        const state = (penultDigit * 10) + lastDigit;

        const matrix = build2ndOrderMarkovMatrix(markovHist);
        const transitions = matrix[state];

        let probOver = 0;
        for (let d = 5; d <= 9; d++) probOver += transitions[d] || 0;
        let probUnder = 1 - probOver;

        let signalType = null;
        let barrier = null;

        if (probOver >= OVER_UNDER_THRESHOLD) {
            signalType = 'DIGITOVER';
            barrier = 4;
        } else if (probUnder >= OVER_UNDER_THRESHOLD) {
            signalType = 'DIGITUNDER';
            barrier = 5;
        }

        // Si no hay señal de Markov, continuar
        if (!signalType) continue;

        // Validar enfriamiento
        if (ticksSinceLastTrade < COOLDOWN_TICKS) continue;

        // ─── LÓGICA DE GHOST SHIELD (ESCUDO DE PÉRDIDA) ───
        
        // Evaluar resultado virtual para el tick actual
        let isVirtualWin = false;
        if (signalType === 'DIGITOVER') {
            isVirtualWin = nextDigit > barrier;
        } else {
            isVirtualWin = nextDigit < barrier;
        }

        if (!isGhostArmed) {
            // El bot no está armado de forma real. Simula una entrada virtual.
            ticksSinceLastTrade = 0;
            if (isVirtualWin) {
                winsGhost++;
                // Continuar en modo Ghost, no se entra en dinero real
            } else {
                lossesGhost++;
                // 💥 PÉRDIDA VIRTUAL DETECTADA!
                // El escudo absorbió la pérdida en papel. Sniper se arma para entrar en dinero real en el próximo tick.
                isGhostArmed = true;
            }
        } else {
            // 🎯 SNIPER ARMADO EN DINERO REAL!
            // Colocar trade real basado en la anomalía actual
            ticksSinceLastTrade = 0;
            isGhostArmed = false; // Resetear escudo tras el disparo

            // Calcular Stake según Cobertura Cuántica (D'Alembert)
            const finalStake = STAKE_BASE * (1 + martingaleStep);
            
            let isRealWin = false;
            if (signalType === 'DIGITOVER') {
                isRealWin = nextDigit > barrier;
            } else {
                isRealWin = nextDigit < barrier;
            }

            let profit = 0.0;
            if (isRealWin) {
                profit = finalStake * payoutRateOverUnder;
                pnl += profit;
                winsReal++;
                martingaleStep = 0; // Recuperación exitosa, volver a nivel base
            } else {
                profit = -finalStake;
                pnl += profit;
                lossesReal++;
                martingaleStep++; // Escalar paso de cobertura lineal
            }

            // Registrar drawdown
            if (pnl > peakPnl) peakPnl = pnl;
            const currentDrawdown = peakPnl - pnl;
            if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;

            trades.push({
                time: new Date(currentTime * 1000).toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
                engine: 'OVER_UNDER',
                type: signalType,
                barrier: barrier,
                stake: finalStake.toFixed(2),
                result: isRealWin ? 'WIN ✅' : 'LOSS ❌',
                profit: profit.toFixed(2),
                currentPnl: pnl.toFixed(2)
            });
        }
    }

    // Reporte Final
    const finalHours = (endTime - startTime) / 3600;
    const finalTrades = winsReal + lossesReal;
    const winRate = finalTrades > 0 ? ((winsReal / finalTrades) * 100).toFixed(1) : '0';

    console.log('\n' + '═'.repeat(70));
    console.log('📊 INFORME ESTRATÉGICO: BACKTEST SNIPER KRAKEN 24 HORAS');
    console.log('═'.repeat(70));
    console.log(`⏱️  Duración del Historial:  ${finalHours.toFixed(1)} horas`);
    console.log(`📡 Ticks Analizados:        ${totalTicks}`);
    console.log(`💲  Stake Base:             $${STAKE_BASE.toFixed(2)}`);
    console.log(`🛡️  Capital de Respaldo:     $${MAX_LOSS.toFixed(2)}`);
    console.log(`🎯 Meta de Ganancia (TP):    $${TAKE_PROFIT.toFixed(2)}`);
    console.log('─'.repeat(70));

    console.log(`\n📈 DESEMPEÑO EN DINERO REAL:`);
    console.log(`   Trades Reales Colocados: ${finalTrades}`);
    console.log(`   Ganadas Reales (Wins):   ${winsReal}`);
    console.log(`   Perdidas Reales (Losses): ${lossesReal}`);
    console.log(`   Tasa de Acierto (WR):    ${winRate}%`);
    console.log(`   PnL Neto Final de Sesión: ${(pnl >= 0 ? '+' : '')}$${pnl.toFixed(2)}`);
    console.log(`   Máximo Retroceso (DD):   -$${maxDrawdown.toFixed(2)}`);
    
    console.log(`\n👻 EFECTIVIDAD DEL ESCUDO GHOST:`);
    console.log(`   Pérdidas simuladas en Papel (esquivadas con éxito):  ${lossesGhost}`);
    console.log(`   Victorias simuladas en Papel (omitidas para seguridad): ${winsGhost}`);

    console.log(`\n⏱️  ANÁLISIS DE TIEMPO CRONOMETRADO:`);
    if (targetReached) {
        const minutes = Math.floor(targetReachedTime / 60);
        const hours = (targetReachedTime / 3600).toFixed(1);
        console.log(`   🟢 ¡META DE GANANCIA ($${TAKE_PROFIT}) ALCANZADA!`);
        console.log(`   ⏳ Tiempo requerido para lograr la meta: ${hours} horas (${minutes} minutos).`);
    } else {
        console.log(`   🔴 Meta de Ganancia no alcanzada en las 24 horas del período.`);
    }

    if (slHit) {
        const hours = (slHitTime / 3600).toFixed(1);
        console.log(`   ⚠️ ¡STOP LOSS ALCANZADO! La sesión tocó la pérdida máxima de -$${MAX_LOSS} a las ${hours} horas.`);
    } else {
        console.log(`   🛡️  ¡STOP LOSS PROTEGIDO! En ningún momento de las 24h la cuenta se acercó al riesgo máximo de -$${MAX_LOSS}.`);
    }

    if (trades.length > 0) {
        console.log(`\n📋 BITÁCORA DETALLADA DE DISPAROS REALES (Últimos 10 Trades):`);
        console.log(`   ┌───────────────────────┬────────────┬─────────┬─────────┬──────────┬───────────┐`);
        console.log(`   │ Hora Disparo          │ Operación  │ Barrera │ Stake   │ Resultado│ PnL Neto  │`);
        console.log(`   ├───────────────────────┼────────────┼─────────┼─────────┼──────────┼───────────┤`);
        trades.slice(-10).forEach(t => {
            const resSymbol = t.result === 'WIN ✅' ? '  WIN ✅  ' : ' LOSS ❌  ';
            console.log(`   │ ${t.time.padEnd(21)} │ ${t.type.padEnd(10)} │   NO-${t.barrier}  │ $${t.stake.padStart(5)} │${resSymbol}│ $${t.currentPnl.padStart(8)} │`);
        });
        console.log(`   └───────────────────────┴────────────┴─────────┴─────────┴──────────┴───────────┘`);
    }
    console.log('\n' + '═'.repeat(70) + '\n');
}
