/**
 * ============================================================
 *  BACKTEST CUÁNTICO: LA MÁQUINA DEFINITIVA (PRODUCCIÓN)
 *  Simula: Markov de 2do Orden, Filtro de Entropía Flex (3.2),
 *  Stake Fijo y Cobertura La Hidra (Espejo + D'Alembert).
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';
const BASE_BANKROLL = 100.0;
const STAKE_BASE = 1.0; 
const HOURS = 2;
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

// ─── SIMULACIÓN PRINCIPAL ──────────────────────────────────
async function runBacktest() {
    console.log('═'.repeat(65));
    console.log(`  🧪 BACKTEST: MOTOR CUÁNTICO (Producción v3.0) — ${HOURS} HORAS`);
    console.log('═'.repeat(65));

    const allDigits = await collectTicks();
    if (allDigits.length < 300) return;

    let bankroll = BASE_BANKROLL;
    let wins = 0;
    let losses = 0;
    let peakBankroll = BASE_BANKROLL;
    let minBankroll = BASE_BANKROLL;
    let skippedByEntropy = 0;
    
    // Estado de La Hidra
    let hidraLayer = 0;
    let hidraDalembertStep = 0;
    let hidraLastLossDigit = null;
    let hidraFrenoUntil = 0;
    
    const digitHistory = [];
    let ticksSinceLastTrade = COOLDOWN_TICKS;

    const PROFIT_RATE = 0.09; // 9% profit en DIGITDIFF

    for (let i = 0; i < allDigits.length - 1; i++) {
        const currentDigit = allDigits[i];
        const nextDigit = allDigits[i + 1]; 
        digitHistory.push(currentDigit);
        
        if (digitHistory.length > 500) digitHistory.shift();
        ticksSinceLastTrade++;

        // Freno de Emergencia La Hidra
        if (hidraLayer === 3) {
            if (i >= hidraFrenoUntil) {
                hidraLayer = 0;
                hidraDalembertStep = 0;
                hidraLastLossDigit = null;
            } else {
                continue;
            }
        }

        if (ticksSinceLastTrade < COOLDOWN_TICKS) continue;
        if (digitHistory.length < 200) continue;

        // FILTRO DE ENTROPÍA (FLEXIBLE 3.2)
        const entropy = calcEntropy(digitHistory, 50);
        if (entropy > 3.2) { 
            skippedByEntropy++;
            continue; 
        }

        let bestBarrier = null;
        let finalStake = STAKE_BASE;
        let layerUsed = hidraLayer;

        if (hidraLayer === 1) {
            // CAPA 1: ESPEJO
            bestBarrier = hidraLastLossDigit !== null ? hidraLastLossDigit : currentDigit;
            finalStake = STAKE_BASE * 1.5;
        } else {
            // MOTOR MARKOV 2DO ORDEN (Capas 0 y 2)
            const markovHist = digitHistory.slice(-200);
            const matrix = build2ndOrderMarkovMatrix(markovHist);
            
            const lastDigit = digitHistory[digitHistory.length - 1];
            const prevDigit = digitHistory[digitHistory.length - 2];
            const currentState = (prevDigit * 10) + lastDigit;
            const transitions = matrix[currentState];
            
            let minProb = 1.0;
            for (let d = 0; d <= 9; d++) {
                if (transitions[d] < minProb) { 
                    minProb = transitions[d]; 
                    bestBarrier = d; 
                }
            }
            
            // Filtro matemático del 5%
            if (bestBarrier === null || minProb > 0.05) continue; 
            
            if (hidraLayer === 0) {
                finalStake = STAKE_BASE * 1.0;
            } else if (hidraLayer === 2) {
                const dStep = hidraDalembertStep || 1;
                finalStake = STAKE_BASE * (1.0 + (dStep * 0.35));
            }
        }

        // EJECUTAR TRADE
        const isWin = nextDigit !== parseInt(bestBarrier);
        ticksSinceLastTrade = 0;

        if (isWin) {
            const profit = finalStake * PROFIT_RATE;
            bankroll += profit;
            wins++;
            if (bankroll > peakBankroll) peakBankroll = bankroll;
            
            // Manejo Hidra Victorias
            if (hidraLayer === 1) {
                hidraLayer = 0;
                hidraLastLossDigit = null;
            } else if (hidraLayer === 2) {
                hidraDalembertStep--;
                if (hidraDalembertStep <= 0) {
                    hidraDalembertStep = 0;
                    hidraLayer = 0;
                }
            }
        } else {
            bankroll -= finalStake;
            losses++;
            if (bankroll < minBankroll) minBankroll = bankroll;
            
            // Manejo Hidra Derrotas
            if (hidraLayer === 0) {
                hidraLayer = 1;
                hidraLastLossDigit = nextDigit;
            } else if (hidraLayer === 1) {
                hidraLayer = 2;
                hidraDalembertStep = 1;
                hidraLastLossDigit = null;
            } else if (hidraLayer === 2) {
                hidraDalembertStep++;
                if (hidraDalembertStep >= 4) { 
                    hidraLayer = 3;
                    hidraFrenoUntil = i + 300; // Freno simulado ~5 mins
                }
            }
        }
    }

    // RESULTADOS
    const totalTrades = wins + losses;
    const wr = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;
    const netProfit = bankroll - BASE_BANKROLL;
    
    console.log('═'.repeat(65));
    console.log(`  📈 RESULTADOS DEL MOTOR CUÁNTICO v3.0 (PROD) - ${HOURS} HORAS`);
    console.log('═'.repeat(65));
    console.log(`  💰 Bankroll Inicial: $${BASE_BANKROLL.toFixed(2)}`);
    console.log(`  💵 Bankroll Final:   $${bankroll.toFixed(2)} (${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)})`);
    console.log(`  🎯 Trades Ejecutados:${totalTrades}`);
    console.log(`  ✅ Ganadas:          ${wins}`);
    console.log(`  ❌ Perdidas:         ${losses}`);
    console.log(`  📊 Win Rate:         ${wr}%`);
    console.log(`  📉 Max Drawdown:     $${(BASE_BANKROLL - minBankroll).toFixed(2)} (desde base)`);
    console.log(`  🛡️ Trades omitidos por Entropía (>3.2): ${skippedByEntropy}`);
    console.log('═'.repeat(65));
}

runBacktest().catch(e => console.error('Fatal error:', e));
