/**
 * ============================================================
 *  BACKTEST: LOS 4 MOTORES — ÚLTIMAS 4 HORAS
 *  Simula la ejecución combinada de EVEN/ODD, OVER/UNDER,
 *  MATCH y DIFFER (La Hidra) como en el bot real en producción.
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';
const STAKE_BASE = 1.00;     
const HOURS = 4;
const COOLDOWN_TICKS = 6;    

// ─── OBTENER TICKS HISTÓRICOS (4 HORAS) ────────────────────────
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
                console.error('Error:', msg.error);
                ws.close();
                reject(msg.error);
            }
        });

        ws.on('error', (e) => reject(e));
        setTimeout(() => { ws.close(); reject('Timeout'); }, 30000);
    });
}

// ─── FUNCIONES MATEMÁTICAS ─────────────────────────────
function buildMarkovMatrix(hist) {
    const matrix = {};
    for (let i = 0; i <= 9; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    for (let k = 1; k < hist.length; k++) {
        matrix[hist[k - 1]][hist[k]]++;
    }
    for (let i = 0; i <= 9; i++) {
        const total = Object.values(matrix[i]).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (let j = 0; j <= 9; j++) matrix[i][j] = matrix[i][j] / total;
        } else {
            for (let j = 0; j <= 9; j++) matrix[i][j] = 0.1;
        }
    }
    return matrix;
}

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

function calcEWMFrequency(hist, alpha = 0.05) {
    const weights = {};
    for (let d = 0; d <= 9; d++) weights[d] = 0;
    let totalWeight = 0;
    for (let i = 0; i < hist.length; i++) {
        const dist = hist.length - 1 - i;
        const w = alpha * Math.pow(1 - alpha, dist);
        const digit = hist[i];
        weights[digit] += w;
        totalWeight += w;
    }
    const normalized = {};
    for (let d = 0; d <= 9; d++) {
        normalized[d] = totalWeight > 0 ? weights[d] / totalWeight : 0.1;
    }
    return normalized;
}

// ─── ESTADO GLOBAL SIMULADO ──────────────────────────────
let botState = {
    hidraLayer: 0,
    hidraDalembertStep: 0,
    hidraLastLossDigit: null,
    hidraFrenoUntil: 0
};

// ─── MOTORES ─────────────────────────────────────────────

function evaluateEvenOdd(hist) {
    if (hist.length < 50) return null;
    const chiTest = calcChiSquared(hist, 50);
    if (!chiTest.significant) return null;
    
    const sub10 = hist.slice(-10);
    const sub20 = hist.slice(-20);
    const sub40 = hist.slice(-40);
    
    let ev10 = 0, od10 = 0; sub10.forEach(d => { if (d % 2 === 0) ev10++; else od10++; });
    let ev20 = 0, od20 = 0; sub20.forEach(d => { if (d % 2 === 0) ev20++; else od20++; });
    let ev40 = 0, od40 = 0; sub40.forEach(d => { if (d % 2 === 0) ev40++; else od40++; });
    
    const scoreOdd = (ev10 >= 7 ? 1 : 0) + (ev20 >= 13 ? 1 : 0) + (ev40 >= 25 ? 1 : 0);
    const scoreEven = (od10 >= 7 ? 1 : 0) + (od20 >= 13 ? 1 : 0) + (od40 >= 25 ? 1 : 0);
    
    if (scoreOdd >= 2) return { engine: 'EVEN_ODD', contractType: 'DIGITODD', stakeMultiplier: 1.0 };
    if (scoreEven >= 2) return { engine: 'EVEN_ODD', contractType: 'DIGITEVEN', stakeMultiplier: 1.0 };
    return null;
}

function evaluateOverUnder(hist) {
    if (hist.length < 100) return null;
    const chiTest = calcChiSquared(hist, 100);
    if (!chiTest.significant) return null;
    
    const markovHist = hist.slice(-100);
    const matrix = buildMarkovMatrix(markovHist);
    const lastDigit = hist[hist.length - 1];
    const transitions = matrix[lastDigit];
    
    let probOver = 0;
    for (let d = 5; d <= 9; d++) probOver += transitions[d];
    let probUnder = 1 - probOver;
    const edgePercent = Math.abs(probOver - 0.5) * 100;
    
    if (edgePercent < 10) return null;
    const last30 = hist.slice(-30);
    
    if (probOver >= 0.60) {
        const countOver = last30.filter(d => d > 4).length;
        if (countOver < 15) return null;
        return { engine: 'OVER_UNDER', contractType: 'DIGITOVER', barrier: '4', stakeMultiplier: 1.0 };
    }
    if (probUnder >= 0.60) {
        const countUnder = last30.filter(d => d < 5).length;
        if (countUnder < 15) return null;
        return { engine: 'OVER_UNDER', contractType: 'DIGITUNDER', barrier: '5', stakeMultiplier: 1.0 };
    }
    return null;
}

function evaluateMatch(hist) {
    if (hist.length < 50) return null;
    const chiTest = calcChiSquared(hist, 50);
    if (!chiTest.significant) return null;
    
    const window50 = hist.slice(-50);
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    window50.forEach(d => freq[d]++);
    
    let hotDigit = 0;
    let maxFreq = 0;
    for (let d = 0; d <= 9; d++) {
        if (freq[d] > maxFreq) { maxFreq = freq[d]; hotDigit = d; }
    }
    
    const hotDigitFreqPercent = (maxFreq / 50) * 100;
    if (hotDigitFreqPercent < 20) return null;
    
    const last5 = hist.slice(-5);
    const momentumCount = last5.filter(d => d === hotDigit).length;
    if (momentumCount < 2) return null;
    
    const ewmFreqs = calcEWMFrequency(hist, 0.05);
    let highestEWMDigit = 0;
    let highestEWMValue = 0;
    for (let d = 0; d <= 9; d++) {
        if (ewmFreqs[d] > highestEWMValue) { highestEWMValue = ewmFreqs[d]; highestEWMDigit = d; }
    }
    if (highestEWMDigit !== hotDigit) return null;
    
    return { engine: 'MATCH', contractType: 'DIGITMATCH', barrier: String(hotDigit), stakeMultiplier: 0.5 };
}

function evaluateDiffer(hist, currentTick) {
    if (hist.length < 100) return null;
    
    if (botState.hidraLayer === 3) {
        if (currentTick >= botState.hidraFrenoUntil) {
            botState.hidraLayer = 0;
            botState.hidraDalembertStep = 0;
            botState.hidraLastLossDigit = null;
        } else {
            return null;
        }
    }
    
    const lastDigit = hist[hist.length - 1];
    
    if (botState.hidraLayer === 1) {
        const mirrorDigit = botState.hidraLastLossDigit !== null ? botState.hidraLastLossDigit : lastDigit;
        return { engine: 'DIFFER', contractType: 'DIGITDIFF', barrier: String(mirrorDigit), stakeMultiplier: 1.5, layer: 1 };
    }
    
    const chiTest = calcChiSquared(hist, 100);
    if (!chiTest.significant) return null;
    
    const markovHist = hist.slice(-100);
    const matrix = buildMarkovMatrix(markovHist);
    const transitions = matrix[lastDigit];
    
    let bestBarrier = null;
    let minProb = 1.0;
    for (let d = 0; d <= 9; d++) {
        if (transitions[d] < minProb) { minProb = transitions[d]; bestBarrier = d; }
    }
    
    if (bestBarrier === null || minProb > 0.08) return null;
    
    if (botState.hidraLayer === 0) {
        return { engine: 'DIFFER', contractType: 'DIGITDIFF', barrier: String(bestBarrier), stakeMultiplier: 0.8, layer: 0 };
    }
    
    if (botState.hidraLayer === 2) {
        const dStep = botState.hidraDalembertStep || 1;
        return { engine: 'DIFFER', contractType: 'DIGITDIFF', barrier: String(bestBarrier), stakeMultiplier: 0.8 + (dStep * 0.35), layer: 2 };
    }
    
    return null;
}

// ─── SIMULACIÓN PRINCIPAL ───────────────────────────────
async function runBacktest() {
    console.log('═'.repeat(65));
    console.log('  🐍 BACKTEST: 4 MOTORES COMBINADOS — ÚLTIMAS 4 HORAS');
    console.log('═'.repeat(65));

    const allDigits = await collectTicks();
    if (allDigits.length < 200) return;

    // Métricas por motor
    const metrics = {
        EVEN_ODD: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        OVER_UNDER: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        MATCH: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        DIFFER: { wins: 0, losses: 0, pnl: 0, trades: 0 }
    };
    
    let totalPnl = 0;
    const digitHistory = [];
    let ticksSinceLastTrade = COOLDOWN_TICKS;

    // Payouts fijos típicos para simulación (ROI de ganancia sobre stake)
    const PROFIT_RATES = {
        DIGITDIFF: 0.09,
        DIGITMATCH: 8.09,
        DIGITODD: 0.96,
        DIGITEVEN: 0.96,
        DIGITOVER: 0.96,
        DIGITUNDER: 0.96
    };

    for (let i = 0; i < allDigits.length - 1; i++) {
        const currentDigit = allDigits[i];
        const nextDigit = allDigits[i + 1]; 
        digitHistory.push(currentDigit);
        if (digitHistory.length > 300) digitHistory.shift();
        
        ticksSinceLastTrade++;

        if (ticksSinceLastTrade < COOLDOWN_TICKS) continue;
        if (digitHistory.length < 100) continue;

        // Evaluar todos los motores en orden de prioridad
        let signal = evaluateEvenOdd(digitHistory) || evaluateOverUnder(digitHistory) || evaluateMatch(digitHistory) || evaluateDiffer(digitHistory, i);
        
        if (!signal) continue;

        // Resolver trade
        const finalStake = STAKE_BASE * signal.stakeMultiplier;
        let isWin = false;

        if (signal.contractType === 'DIGITDIFF') isWin = nextDigit !== parseInt(signal.barrier);
        else if (signal.contractType === 'DIGITMATCH') isWin = nextDigit === parseInt(signal.barrier);
        else if (signal.contractType === 'DIGITODD') isWin = nextDigit % 2 !== 0;
        else if (signal.contractType === 'DIGITEVEN') isWin = nextDigit % 2 === 0;
        else if (signal.contractType === 'DIGITOVER') isWin = nextDigit > parseInt(signal.barrier);
        else if (signal.contractType === 'DIGITUNDER') isWin = nextDigit < parseInt(signal.barrier);

        metrics[signal.engine].trades++;
        ticksSinceLastTrade = 0;

        if (isWin) {
            const profit = finalStake * PROFIT_RATES[signal.contractType];
            metrics[signal.engine].wins++;
            metrics[signal.engine].pnl += profit;
            totalPnl += profit;

            // Manejo Hidra
            if (signal.engine === 'DIFFER') {
                if (botState.hidraLayer === 1) {
                    botState.hidraLayer = 0;
                    botState.hidraLastLossDigit = null;
                } else if (botState.hidraLayer === 2) {
                    botState.hidraDalembertStep--;
                    if (botState.hidraDalembertStep <= 0) {
                        botState.hidraDalembertStep = 0;
                        botState.hidraLayer = 0;
                    }
                }
            }
        } else {
            metrics[signal.engine].losses++;
            metrics[signal.engine].pnl -= finalStake;
            totalPnl -= finalStake;

            // Manejo Hidra
            if (signal.engine === 'DIFFER') {
                if (botState.hidraLayer === 0) {
                    botState.hidraLayer = 1;
                    botState.hidraLastLossDigit = nextDigit;
                } else if (botState.hidraLayer === 1) {
                    botState.hidraLayer = 2;
                    botState.hidraDalembertStep = 1;
                    botState.hidraLastLossDigit = null;
                } else if (botState.hidraLayer === 2) {
                    botState.hidraDalembertStep++;
                    if (botState.hidraDalembertStep >= 4) { // Asumimos 4 perdidas consecutivas para freno
                        botState.hidraLayer = 3;
                        botState.hidraFrenoUntil = i + 300; // ~5 mins
                    }
                }
            }
        }
    }

    // ─── RESULTADOS ────────────────────────────────────────────
    console.log('═'.repeat(65));
    console.log(`  📈 PnL TOTAL 4 MOTORES: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
    console.log('═'.repeat(65));
    
    for (const [engine, m] of Object.entries(metrics)) {
        if (m.trades > 0) {
            const wr = ((m.wins / m.trades) * 100).toFixed(1);
            console.log(`  ⚙️ ${engine}: Trades: ${m.trades} | W:${m.wins} L:${m.losses} | WR: ${wr}% | PnL: ${m.pnl >= 0 ? '+' : ''}$${m.pnl.toFixed(2)}`);
        } else {
            console.log(`  ⚙️ ${engine}: Sin trades ejecutados.`);
        }
    }
    console.log('═'.repeat(65));
}

runBacktest().catch(e => console.error('Error fatal:', e));
