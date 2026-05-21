/**
 * ============================================================
 *  BACKTEST CUÁNTICO: LA MÁQUINA DEFINITIVA
 *  Simula: Markov de 2do Orden, Filtro de Entropía Estricto
 *  y Gestión de Riesgo de Kelly.
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';
const BASE_BANKROLL = 100.0; // Empezamos con $100 virtuales
const HOURS = 6;
const COOLDOWN_TICKS = 6;

// ─── OBTENER TICKS HISTÓRICOS ──────────────────────────────
function collectTicks() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        const endTime = Math.floor(Date.now() / 1000);
        const startTime = endTime - (HOURS * 3600);

        ws.on('open', () => {
            console.log(`📡 Solicitando ticks de ${SYMBOL} (últimas ${HOURS} horas)...`);
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                start: startTime,
                end: endTime,
                style: 'ticks',
                count: 5000
            }));
        });

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (msg.msg_type === 'history' && msg.history) {
                const prices = msg.history.prices;
                const ticks = prices.map(p => parseInt(String(p).slice(-1)));
                console.log(`✅ Recibidos ${ticks.length} ticks.\n`);
                ws.close();
                resolve(ticks);
            }
            if (msg.error) {
                ws.close();
                reject(msg.error);
            }
        });

        setTimeout(() => { ws.close(); reject('Timeout'); }, 30000);
    });
}

// ─── MATEMÁTICAS CUÁNTICAS ─────────────────────────────────

// Entropía de Shannon
function calcEntropy(hist, range = 50) {
    const sub = hist.slice(-range);
    if (sub.length === 0) return 3.322;
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    sub.forEach(d => freq[d]++);
    let entropy = 0;
    for (let d = 0; d <= 9; d++) {
        const p = freq[d] / sub.length;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
}

// Matriz de Markov de 2do Orden (Basada en los 2 últimos dígitos)
function build2ndOrderMarkovMatrix(hist) {
    const matrix = {};
    // Inicializar 100 estados posibles (00 a 99)
    for (let i = 0; i <= 99; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    
    // Contar transiciones
    for (let k = 2; k < hist.length; k++) {
        const state = (hist[k - 2] * 10) + hist[k - 1]; // Ej: dígito 3 luego 7 = estado 37
        const nextDigit = hist[k];
        matrix[state][nextDigit]++;
    }
    
    // Calcular probabilidades
    for (let i = 0; i <= 99; i++) {
        const total = Object.values(matrix[i]).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (let j = 0; j <= 9; j++) matrix[i][j] = matrix[i][j] / total;
        } else {
            for (let j = 0; j <= 9; j++) matrix[i][j] = 0.1; // fallback
        }
    }
    return matrix;
}

// Criterio de Kelly para DIGITDIFF
function calculateKellyStake(bankroll, winProb, winProfitMultiplier) {
    // Fórmula Kelly: f* = (p(b+1) - 1) / b
    // donde p = probabilidad de ganar, b = odds (profit / loss)
    // Para DIGITDIFF, ganas ~0.09 por cada 1 perdido. b = 0.09.
    const b = winProfitMultiplier; 
    const p = winProb;
    
    let f = (p * (b + 1) - 1) / b;
    
    if (f <= 0) return 0; // Edge negativo, no apostar nada
    
    // Half-Kelly o Fraction-Kelly es más seguro. Usamos 1/4 Kelly para evitar la ruina.
    const fractionalKelly = f * 0.25; 
    
    // Tope máximo de apuesta: 5% del bankroll
    const maxRisk = 0.05;
    const finalFraction = Math.min(fractionalKelly, maxRisk);
    
    let stake = bankroll * finalFraction;
    
    // Failsafes de Deriv
    if (stake < 0.35) stake = 0.35; // Mínimo de Deriv
    if (stake > 10.0) stake = 10.0; // Hard cap para el bot
    
    return stake;
}

// ─── SIMULACIÓN PRINCIPAL ──────────────────────────────────
async function runBacktest() {
    console.log('═'.repeat(65));
    console.log('  🧪 BACKTEST: MOTOR CUÁNTICO (Markov 2do Orden + Kelly)');
    console.log('═'.repeat(65));

    const allDigits = await collectTicks();
    if (allDigits.length < 300) return;

    let bankroll = BASE_BANKROLL;
    let wins = 0;
    let losses = 0;
    let peakBankroll = BASE_BANKROLL;
    let minBankroll = BASE_BANKROLL;
    let skippedByEntropy = 0;
    
    const digitHistory = [];
    let ticksSinceLastTrade = COOLDOWN_TICKS;

    const PROFIT_RATE = 0.09; // 9% profit en DIGITDIFF

    for (let i = 0; i < allDigits.length - 1; i++) {
        const currentDigit = allDigits[i];
        const nextDigit = allDigits[i + 1]; 
        digitHistory.push(currentDigit);
        
        // Ventana de memoria profunda para Markov 2do orden
        if (digitHistory.length > 500) digitHistory.shift();
        
        ticksSinceLastTrade++;

        if (ticksSinceLastTrade < COOLDOWN_TICKS) continue;
        if (digitHistory.length < 200) continue;

        // FILTRO DE ENTROPÍA (Solo operamos en caos bajo/tendencia)
        const entropy = calcEntropy(digitHistory, 50);
        if (entropy > 3.1) { // Ligeramente más flexible que 3.0 para ver trades en el backtest
            skippedByEntropy++;
            continue; 
        }

        // MOTOR MARKOV 2DO ORDEN
        const markovHist = digitHistory.slice(-200);
        const matrix = build2ndOrderMarkovMatrix(markovHist);
        
        const lastDigit = digitHistory[digitHistory.length - 1];
        const prevDigit = digitHistory[digitHistory.length - 2];
        const currentState = (prevDigit * 10) + lastDigit;
        
        const transitions = matrix[currentState];
        
        let bestBarrier = null;
        let minProb = 1.0;
        
        for (let d = 0; d <= 9; d++) {
            if (transitions[d] < minProb) { 
                minProb = transitions[d]; 
                bestBarrier = d; 
            }
        }
        
        // El estado actual pudo no haber ocurrido suficientes veces. 
        // Exigimos que la probabilidad de transición sea MUY baja para entrar (Edge claro)
        if (bestBarrier === null || minProb > 0.05) continue; 
        
        // CALCULAR STAKE (Criterio de Kelly)
        const estimatedWinProb = 1 - minProb;
        let stake = calculateKellyStake(bankroll, estimatedWinProb, PROFIT_RATE);
        
        // EJECUTAR TRADE
        const isWin = nextDigit !== bestBarrier;
        ticksSinceLastTrade = 0;

        if (isWin) {
            const profit = stake * PROFIT_RATE;
            bankroll += profit;
            wins++;
            if (bankroll > peakBankroll) peakBankroll = bankroll;
        } else {
            bankroll -= stake;
            losses++;
            if (bankroll < minBankroll) minBankroll = bankroll;
        }
    }

    // RESULTADOS
    const totalTrades = wins + losses;
    const wr = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;
    const netProfit = bankroll - BASE_BANKROLL;
    
    console.log('═'.repeat(65));
    console.log(`  📈 RESULTADOS DEL MOTOR CUÁNTICO v3.0`);
    console.log('═'.repeat(65));
    console.log(`  💰 Bankroll Inicial: $${BASE_BANKROLL.toFixed(2)}`);
    console.log(`  💵 Bankroll Final:   $${bankroll.toFixed(2)} (${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)})`);
    console.log(`  🎯 Trades Ejecutados:${totalTrades}`);
    console.log(`  ✅ Ganadas:          ${wins}`);
    console.log(`  ❌ Perdidas:         ${losses}`);
    console.log(`  📊 Win Rate:         ${wr}%`);
    console.log(`  📉 Max Drawdown:     $${(BASE_BANKROLL - minBankroll).toFixed(2)} (desde base)`);
    console.log(`  🛡️ Trades omitidos por Entropía (Caos): ${skippedByEntropy}`);
    console.log('═'.repeat(65));
}

runBacktest().catch(e => console.error('Fatal error:', e));
