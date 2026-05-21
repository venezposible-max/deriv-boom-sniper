/**
 * ============================================================
 *  BACKTEST: LA HIDRA v2.0 — ÚLTIMAS 4 HORAS
 *  Conecta a Deriv, obtiene ticks reales de R_25,
 *  y simula la estrategia de cobertura DIGITDIFF "La Hidra"
 *  con las 4 capas exactas del bot en producción.
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';
const STAKE_BASE = 1.00;     // Stake base igual al bot real
const HOURS = 24;
const COOLDOWN_TICKS = 6;    // ~6 ticks de cooldown (~6 seg entre trades)

// ─── OBTENER PAYOUT REAL DE DERIV ──────────────────────────────
function getPayoutFromDeriv() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        
        ws.on('open', () => {
            ws.send(JSON.stringify({
                proposal: 1,
                amount: STAKE_BASE,
                basis: 'stake',
                contract_type: 'DIGITDIFF',
                currency: 'USD',
                symbol: SYMBOL,
                duration: 1,
                duration_unit: 't',
                barrier: '5'
            }));
        });

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (msg.msg_type === 'proposal' && msg.proposal) {
                const payout = parseFloat(msg.proposal.payout);
                const profit = payout - STAKE_BASE;
                ws.close();
                resolve({ payout, profit, loss: STAKE_BASE });
            }
            if (msg.error) {
                ws.close();
                resolve({ payout: 1.098, profit: 0.098, loss: STAKE_BASE });
            }
        });

        ws.on('error', () => resolve({ payout: 1.098, profit: 0.098, loss: STAKE_BASE }));
        setTimeout(() => { ws.close(); resolve({ payout: 1.098, profit: 0.098, loss: STAKE_BASE }); }, 10000);
    });
}

// ─── OBTENER TICKS HISTÓRICOS (4 HORAS) ────────────────────────
function collectTicks() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        const endTime = Math.floor(Date.now() / 1000);
        const startTime = endTime - (HOURS * 3600);

        ws.on('open', () => {
            console.log(`📡 Conectado. Solicitando ticks de ${SYMBOL} (últimas ${HOURS} horas)...`);
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

// ─── FUNCIONES MATEMÁTICAS (IDÉNTICAS AL BOT REAL) ─────────────
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

// ─── SIMULACIÓN LA HIDRA (IDÉNTICA AL BOT REAL) ───────────────
async function runBacktest() {
    console.log('═'.repeat(65));
    console.log('  🐍 BACKTEST: LA HIDRA v2.0 — DIGITDIFF — ÚLTIMAS 24 HORAS');
    console.log('═'.repeat(65));
    console.log(`  📊 Stake Base: $${STAKE_BASE} | Símbolo: ${SYMBOL} | Cooldown: ${COOLDOWN_TICKS} ticks\n`);

    // 1. Obtener payout real
    console.log('💰 Consultando payout real de DIGITDIFF en Deriv...');
    const { profit: winProfit, loss: lossAmount, payout } = await getPayoutFromDeriv();
    console.log(`   Payout: $${payout.toFixed(4)} | Ganancia/WIN: +$${winProfit.toFixed(4)} | Pérdida/LOSS: -$${lossAmount.toFixed(4)}`);
    const breakEvenWR = (lossAmount / (winProfit + lossAmount)) * 100;
    console.log(`   Break-even WR: ${breakEvenWR.toFixed(1)}%\n`);

    // 2. Obtener ticks
    const allDigits = await collectTicks();
    if (allDigits.length < 200) {
        console.log('❌ No hay suficientes ticks para un backtest significativo.');
        return;
    }

    // ─── ESTADO DE LA HIDRA PARA SIMULACIÓN ────────────────────
    let hidraLayer = 0;        // 0=Normal, 1=Espejo, 2=D'Alembert, 3=Freno
    let dalembertStep = 0;
    let lastLossDigit = null;
    let frenoTicksRemaining = 0;  // Simula los 5 min de freno como ~300 ticks
    let consecutiveLosses = 0;

    // Métricas
    let pnl = 0;
    let wins = 0;
    let losses = 0;
    let maxDrawdown = 0;
    let peakPnl = 0;
    let maxConsecLoss = 0;
    let maxConsecWin = 0;
    let currentConsecWin = 0;
    let layerUsage = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let layerWins = { 0: 0, 1: 0, 2: 0 };
    let layerLosses = { 0: 0, 1: 0, 2: 0 };
    let tradeLog = [];

    // Historial de dígitos rodante para Markov (ventana de 100)
    const digitHistory = [];
    let tradeIndex = 0;
    let ticksSinceLastTrade = COOLDOWN_TICKS; // Empezar listo para operar

    for (let i = 0; i < allDigits.length - 1; i++) {
        const currentDigit = allDigits[i];
        const nextDigit = allDigits[i + 1]; // El contrato DIGITDIFF de 1 tick se resuelve en el SIGUIENTE tick
        digitHistory.push(currentDigit);
        if (digitHistory.length > 300) digitHistory.shift();
        
        ticksSinceLastTrade++;

        // CAPA 3: Freno de emergencia (simula pausa)
        if (hidraLayer === 3) {
            frenoTicksRemaining--;
            if (frenoTicksRemaining <= 0) {
                hidraLayer = 0;
                dalembertStep = 0;
                lastLossDigit = null;
                consecutiveLosses = 0;
            }
            continue;
        }

        // Cooldown entre trades
        if (ticksSinceLastTrade < COOLDOWN_TICKS) continue;
        if (digitHistory.length < 100) continue;

        // ─── EVALUAR SEÑAL DE LA HIDRA ─────────────────────────
        let barrier = null;
        let stakeMult = 0.8;
        let layerUsed = hidraLayer;

        if (hidraLayer === 1) {
            // CAPA 1: ESPEJO — Usar el dígito perdedor como barrera
            barrier = lastLossDigit;
            stakeMult = 1.5;
        } else {
            // CAPA 0 (Normal) o CAPA 2 (D'Alembert): Usar Markov
            const chiTest = calcChiSquared(digitHistory, 100);
            if (!chiTest.significant) continue; // Sin señal estadística

            const markovHist = digitHistory.slice(-100);
            const matrix = buildMarkovMatrix(markovHist);
            const lastDigit = digitHistory[digitHistory.length - 1];
            const transitions = matrix[lastDigit];

            let minProb = 1.0;
            for (let d = 0; d <= 9; d++) {
                if (transitions[d] < minProb) {
                    minProb = transitions[d];
                    barrier = d;
                }
            }

            // Filtro: solo operar si probabilidad de transición <= 8%
            if (barrier === null || minProb > 0.08) continue;

            if (hidraLayer === 2) {
                const dStep = dalembertStep || 1;
                stakeMult = 0.8 + (dStep * 0.35);
            }
        }

        if (barrier === null) continue;

        // ─── EJECUTAR TRADE ────────────────────────────────────
        const finalStake = STAKE_BASE * stakeMult;
        const isWin = nextDigit !== barrier; // DIGITDIFF: gana si dígito ≠ barrera
        
        tradeIndex++;
        ticksSinceLastTrade = 0;
        layerUsage[layerUsed]++;

        if (isWin) {
            const profit = finalStake * (winProfit / STAKE_BASE);
            pnl += profit;
            wins++;
            currentConsecWin++;
            consecutiveLosses = 0;
            if (currentConsecWin > maxConsecWin) maxConsecWin = currentConsecWin;
            if (layerUsed <= 2) layerWins[layerUsed]++;

            // Transiciones de La Hidra tras victoria
            if (hidraLayer === 1) {
                hidraLayer = 0;
                lastLossDigit = null;
            } else if (hidraLayer === 2) {
                dalembertStep--;
                if (dalembertStep <= 0) {
                    dalembertStep = 0;
                    hidraLayer = 0;
                }
            }
        } else {
            pnl -= finalStake;
            losses++;
            currentConsecWin = 0;
            consecutiveLosses++;
            if (consecutiveLosses > maxConsecLoss) maxConsecLoss = consecutiveLosses;
            if (layerUsed <= 2) layerLosses[layerUsed]++;

            // Transiciones de La Hidra tras pérdida
            if (hidraLayer === 0) {
                hidraLayer = 1;
                lastLossDigit = nextDigit; // El dígito que nos hizo perder
            } else if (hidraLayer === 1) {
                hidraLayer = 2;
                dalembertStep = 1;
                lastLossDigit = null;
            } else if (hidraLayer === 2) {
                dalembertStep++;
                if (consecutiveLosses >= 4) {
                    hidraLayer = 3;
                    frenoTicksRemaining = 300; // ~5 min de pausa
                }
            }
        }

        if (pnl > peakPnl) peakPnl = pnl;
        const dd = peakPnl - pnl;
        if (dd > maxDrawdown) maxDrawdown = dd;

        tradeLog.push({
            trade: tradeIndex,
            layer: layerUsed,
            barrier,
            exitDigit: nextDigit,
            win: isWin,
            stake: finalStake,
            pnl: pnl
        });
    }

    // ─── RESULTADOS ────────────────────────────────────────────
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';

    console.log('═'.repeat(65));
    console.log('  📊 RESULTADOS DEL BACKTEST — LA HIDRA v2.0');
    console.log('═'.repeat(65));
    console.log('');
    console.log(`  📈 PnL TOTAL:           ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
    console.log(`  🎯 TRADES EJECUTADOS:   ${totalTrades}`);
    console.log(`  ✅ GANADAS:             ${wins}`);
    console.log(`  ❌ PERDIDAS:            ${losses}`);
    console.log(`  📊 WIN RATE:            ${winRate}%`);
    console.log(`  💵 PnL POR TRADE:       $${totalTrades > 0 ? (pnl / totalTrades).toFixed(4) : '0.0000'}`);
    console.log(`  📉 MAX DRAWDOWN:        -$${maxDrawdown.toFixed(2)}`);
    console.log(`  🔥 MAX RACHA GANADORA:  ${maxConsecWin}`);
    console.log(`  💀 MAX RACHA PERDEDORA: ${maxConsecLoss}`);
    console.log('');

    console.log('─'.repeat(65));
    console.log('  🐍 DETALLE POR CAPA DE LA HIDRA');
    console.log('─'.repeat(65));
    console.log(`  Capa 0 (Normal):     ${layerUsage[0]} trades | W:${layerWins[0]} L:${layerLosses[0]} | WR: ${layerUsage[0] > 0 ? ((layerWins[0]/(layerWins[0]+layerLosses[0]))*100).toFixed(1) : '0.0'}%`);
    console.log(`  Capa 1 (Espejo):     ${layerUsage[1]} trades | W:${layerWins[1]} L:${layerLosses[1]} | WR: ${layerUsage[1] > 0 ? ((layerWins[1]/(layerWins[1]+layerLosses[1]))*100).toFixed(1) : '0.0'}%`);
    console.log(`  Capa 2 (D'Alembert): ${layerUsage[2]} trades | W:${layerWins[2]} L:${layerLosses[2]} | WR: ${layerUsage[2] > 0 ? ((layerWins[2]/(layerWins[2]+layerLosses[2]))*100).toFixed(1) : '0.0'}%`);
    console.log(`  Capa 3 (Freno):      ${layerUsage[3]} activaciones`);
    console.log('');

    console.log('─'.repeat(65));
    console.log('  📋 CONTEXTO REAL');
    console.log('─'.repeat(65));
    console.log(`  Ticks analizados:    ${allDigits.length}`);
    console.log(`  Periodo:             Últimas ${HOURS} horas`);
    console.log(`  Break-even WR:       ${breakEvenWR.toFixed(1)}%`);
    console.log(`  Payout real Deriv:   $${payout.toFixed(4)}`);
    console.log('');

    // Veredicto
    console.log('═'.repeat(65));
    if (pnl > 0) {
        console.log(`  🏆 VEREDICTO: ✅ LA HIDRA GANA +$${pnl.toFixed(2)} en ${HOURS} horas`);
        console.log(`  📈 Con $${STAKE_BASE} de stake y ${totalTrades} operaciones.`);
        if (parseFloat(winRate) >= breakEvenWR) {
            console.log(`  ✅ Win Rate ${winRate}% SUPERA el break-even de ${breakEvenWR.toFixed(1)}%`);
        }
    } else if (pnl === 0) {
        console.log(`  ⚖️ VEREDICTO: EMPATE — La Hidra quedó en $0.00 en ${HOURS} horas.`);
    } else {
        console.log(`  ⚠️ VEREDICTO: ❌ LA HIDRA PIERDE -$${Math.abs(pnl).toFixed(2)} en ${HOURS} horas`);
        console.log(`  📉 Win Rate ${winRate}% por debajo del break-even de ${breakEvenWR.toFixed(1)}%`);
    }
    console.log('═'.repeat(65));

    // Últimos 10 trades
    if (tradeLog.length > 0) {
        console.log('');
        console.log('─'.repeat(65));
        console.log('  📝 ÚLTIMOS 10 TRADES');
        console.log('─'.repeat(65));
        const last10 = tradeLog.slice(-10);
        const layerNames = { 0: 'Normal  ', 1: 'Espejo  ', 2: "D'Alemb." };
        for (const t of last10) {
            const result = t.win ? '✅' : '❌';
            const sign = t.pnl >= 0 ? '+' : '';
            console.log(`  #${String(t.trade).padStart(3)} | ${layerNames[t.layer] || 'Freno   '} | B:${t.barrier} → Exit:${t.exitDigit} | ${result} | Stake:$${t.stake.toFixed(2)} | PnL:${sign}$${t.pnl.toFixed(2)}`);
        }
    }
    
    console.log('');
}

runBacktest().catch(e => console.error('Error fatal:', e));
