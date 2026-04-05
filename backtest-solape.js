/**
 * ============================================================
 *  BACKTEST: ESTRATEGIA SOLAPE vs NORMAL
 *  Conecta a Deriv, obtiene 5000 ticks reales de R_25,
 *  y simula ambos escenarios para comparar resultados.
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';
const STAKE = 1.00;
const TICKS_TO_COLLECT = 5000;

// ─── OBTENER PAYOUT REAL DE DERIV ──────────────────────────────
function getPayoutFromDeriv() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        
        ws.on('open', () => {
            // Pedir propuesta para saber el payout real de DIFFERS
            ws.send(JSON.stringify({
                proposal: 1,
                amount: STAKE,
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
                const profit = payout - STAKE;
                console.log(`💰 Payout real de Deriv para DIFFERS $${STAKE}:`);
                console.log(`   Payout: $${payout.toFixed(4)}`);
                console.log(`   Ganancia por WIN: +$${profit.toFixed(4)}`);
                console.log(`   Pérdida por LOSS: -$${STAKE.toFixed(4)}`);
                console.log(`   Ratio: ${((profit / STAKE) * 100).toFixed(2)}%\n`);
                ws.close();
                resolve({ payout, profit, loss: STAKE });
            }
            if (msg.error) {
                console.error('Error obteniendo payout:', msg.error);
                ws.close();
                // Usar payout estimado si falla
                resolve({ payout: 1.098, profit: 0.098, loss: STAKE });
            }
        });

        ws.on('error', (e) => {
            console.error('Error WS:', e.message);
            resolve({ payout: 1.098, profit: 0.098, loss: STAKE });
        });

        setTimeout(() => {
            ws.close();
            resolve({ payout: 1.098, profit: 0.098, loss: STAKE });
        }, 10000);
    });
}

// ─── OBTENER TICKS HISTÓRICOS ──────────────────────────────────
function collectTicks() {
    return new Promise((resolve, reject) => {
        const ticks = [];
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

        ws.on('open', () => {
            console.log(`📡 Conectado. Recolectando ${TICKS_TO_COLLECT} ticks de ${SYMBOL}...`);
            
            // Pedir historial de ticks (máximo 5000)
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                count: TICKS_TO_COLLECT,
                end: 'latest',
                style: 'ticks'
            }));
        });

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            
            if (msg.msg_type === 'history' && msg.history) {
                const prices = msg.history.prices;
                const times = msg.history.times;
                
                for (let i = 0; i < prices.length; i++) {
                    ticks.push({
                        price: prices[i],
                        time: times[i],
                        lastDigit: parseInt(String(prices[i]).slice(-1))
                    });
                }
                
                console.log(`✅ Recibidos ${ticks.length} ticks históricos.\n`);
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

// ─── EJECUTAR BACKTEST ──────────────────────────────────────────
async function runBacktest() {
    console.log('='.repeat(60));
    console.log('🧪 BACKTEST: ESTRATEGIA SOLAPE — DIFFERS R_25');
    console.log('='.repeat(60));
    console.log(`📊 Stake: $${STAKE} | Símbolo: ${SYMBOL}\n`);

    // 1. Obtener payout real
    const { profit: winProfit, loss: lossAmount } = await getPayoutFromDeriv();

    // 2. Recolectar ticks
    const ticks = await collectTicks();
    if (ticks.length < 100) {
        console.log('❌ No hay suficientes ticks para el backtest.');
        return;
    }

    // ─── ANÁLISIS DE DISTRIBUCIÓN DE DÍGITOS ────────────────────
    const digitCount = {};
    for (let d = 0; d <= 9; d++) digitCount[d] = 0;
    ticks.forEach(t => digitCount[t.lastDigit]++);
    
    console.log('📊 DISTRIBUCIÓN DE DÍGITOS EN LA MUESTRA:');
    console.log('─'.repeat(40));
    for (let d = 0; d <= 9; d++) {
        const pct = ((digitCount[d] / ticks.length) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct * 2));
        console.log(`   ${d}: ${bar} ${digitCount[d]} (${pct}%)`);
    }
    console.log('');

    // ─── SIMULACIÓN ESCENARIO A: SOLAPE PERFECTO (100% WIN) ─────
    console.log('═'.repeat(60));
    console.log('🟢 ESCENARIO A: SOLAPE PERFECTO (contrato se resuelve en mismo tick)');
    console.log('═'.repeat(60));
    
    let pnlA = 0;
    let winsA = 0;
    let lossesA = 0;
    const cooldownTicks = 3; // Simula cooldown (~2s ≈ 3 ticks en R_25)

    for (let i = 0; i < ticks.length; i += cooldownTicks) {
        const tick = ticks[i];
        const barrier = (tick.lastDigit + 5) % 10;
        
        // Con solape perfecto, el contrato se resuelve en ESTE tick
        // El dígito que vemos SIEMPRE ≠ barrera (por diseño)
        // → SIEMPRE WIN
        pnlA += winProfit;
        winsA++;
    }

    const totalA = winsA + lossesA;
    const wrA = ((winsA / totalA) * 100).toFixed(1);
    console.log(`   Trades: ${totalA}`);
    console.log(`   Wins: ${winsA} | Losses: ${lossesA}`);
    console.log(`   Win Rate: ${wrA}%`);
    console.log(`   PnL Total: $${pnlA.toFixed(2)}`);
    console.log(`   PnL por trade: $${(pnlA / totalA).toFixed(4)}`);
    console.log('');

    // ─── SIMULACIÓN ESCENARIO B: SIN SOLAPE (tick siguiente) ─────
    console.log('═'.repeat(60));
    console.log('🟡 ESCENARIO B: SIN SOLAPE (contrato se resuelve en el SIGUIENTE tick)');
    console.log('═'.repeat(60));
    
    let pnlB = 0;
    let winsB = 0;
    let lossesB = 0;
    let streakLoss = 0;
    let maxStreakLoss = 0;
    let maxDrawdown = 0;
    let peakPnl = 0;
    const tradeLogB = [];

    for (let i = 0; i < ticks.length - 1; i += cooldownTicks) {
        const tick = ticks[i];
        const nextTick = ticks[i + 1];
        const barrier = (tick.lastDigit + 5) % 10;

        // Sin solape, se resuelve en el SIGUIENTE tick
        const exitDigit = nextTick.lastDigit;
        const isWin = exitDigit !== barrier;

        if (isWin) {
            pnlB += winProfit;
            winsB++;
            streakLoss = 0;
        } else {
            pnlB -= lossAmount;
            lossesB++;
            streakLoss++;
            if (streakLoss > maxStreakLoss) maxStreakLoss = streakLoss;
        }

        if (pnlB > peakPnl) peakPnl = pnlB;
        const dd = peakPnl - pnlB;
        if (dd > maxDrawdown) maxDrawdown = dd;

        tradeLogB.push({ 
            tick: tick.lastDigit, 
            barrier, 
            exit: exitDigit, 
            win: isWin, 
            pnl: pnlB 
        });
    }

    const totalB = winsB + lossesB;
    const wrB = ((winsB / totalB) * 100).toFixed(1);
    console.log(`   Trades: ${totalB}`);
    console.log(`   Wins: ${winsB} | Losses: ${lossesB}`);
    console.log(`   Win Rate: ${wrB}%`);
    console.log(`   PnL Total: $${pnlB.toFixed(2)}`);
    console.log(`   PnL por trade: $${(pnlB / totalB).toFixed(4)}`);
    console.log(`   Max Racha de Pérdidas: ${maxStreakLoss} seguidas`);
    console.log(`   Max Drawdown: -$${maxDrawdown.toFixed(2)}`);
    console.log('');

    // ─── SIMULACIÓN ESCENARIO C: ESTRATEGIA ANTERIOR (barrera = mismo dígito) ──
    console.log('═'.repeat(60));
    console.log('🔴 ESCENARIO C: ESTRATEGIA ANTERIOR (barrera = dígito actual, sin solape)');
    console.log('═'.repeat(60));
    
    let pnlC = 0;
    let winsC = 0;
    let lossesC = 0;

    for (let i = 0; i < ticks.length - 1; i += cooldownTicks) {
        const tick = ticks[i];
        const nextTick = ticks[i + 1];
        const barrier = tick.lastDigit; // Barrera = MISMO dígito (vieja estrategia)

        const exitDigit = nextTick.lastDigit;
        const isWin = exitDigit !== barrier;

        if (isWin) {
            pnlC += winProfit;
            winsC++;
        } else {
            pnlC -= lossAmount;
            lossesC++;
        }
    }

    const totalC = winsC + lossesC;
    const wrC = ((winsC / totalC) * 100).toFixed(1);
    console.log(`   Trades: ${totalC}`);
    console.log(`   Wins: ${winsC} | Losses: ${lossesC}`);
    console.log(`   Win Rate: ${wrC}%`);
    console.log(`   PnL Total: $${pnlC.toFixed(2)}`);
    console.log(`   PnL por trade: $${(pnlC / totalC).toFixed(4)}`);
    console.log('');

    // ─── RESUMEN COMPARATIVO ──────────────────────────────────────
    console.log('═'.repeat(60));
    console.log('📋 RESUMEN COMPARATIVO');
    console.log('═'.repeat(60));
    console.log('');
    console.log(`  Ganancia por WIN:  +$${winProfit.toFixed(4)}`);
    console.log(`  Pérdida por LOSS:  -$${lossAmount.toFixed(4)}`);
    console.log(`  Break-even WR:     ${((lossAmount / (winProfit + lossAmount)) * 100).toFixed(1)}%`);
    console.log('');
    console.log(`  ┌──────────────────┬──────────┬──────────┬──────────────┐`);
    console.log(`  │ Escenario        │ Win Rate │ PnL      │ Por Trade    │`);
    console.log(`  ├──────────────────┼──────────┼──────────┼──────────────┤`);
    console.log(`  │ A: Solape 100%   │ ${wrA.padStart(6)}%  │ $${pnlA.toFixed(2).padStart(7)} │ $${(pnlA/totalA).toFixed(4).padStart(8)}    │`);
    console.log(`  │ B: Sin Solape    │ ${wrB.padStart(6)}%  │ $${pnlB.toFixed(2).padStart(7)} │ $${(pnlB/totalB).toFixed(4).padStart(8)}    │`);
    console.log(`  │ C: Vieja Estrat. │ ${wrC.padStart(6)}%  │ $${pnlC.toFixed(2).padStart(7)} │ $${(pnlC/totalC).toFixed(4).padStart(8)}    │`);
    console.log(`  └──────────────────┴──────────┴──────────┴──────────────┘`);
    console.log('');
    
    // ─── VEREDICTO ─────────────────────────────────────────────────
    console.log('═'.repeat(60));
    console.log('🏆 VEREDICTO');
    console.log('═'.repeat(60));
    
    const breakEven = (lossAmount / (winProfit + lossAmount)) * 100;
    
    if (parseFloat(wrB) >= breakEven) {
        console.log(`✅ SIN SOLAPE: Win Rate ${wrB}% SUPERA el break-even de ${breakEven.toFixed(1)}%`);
        console.log('   → La estrategia es RENTABLE incluso sin necesitar el solape.');
    } else {
        console.log(`⚠️ SIN SOLAPE: Win Rate ${wrB}% NO supera el break-even de ${breakEven.toFixed(1)}%`);
        console.log('   → La estrategia NECESITA el solape para ser rentable.');
        console.log('   → Sin solape, a largo plazo perderás dinero.');
    }
    
    console.log(`\n✅ CON SOLAPE: Win Rate 100% → SIEMPRE RENTABLE ($${(pnlA/totalA).toFixed(4)} por trade)`);
    console.log('\n📌 La pregunta clave: ¿Deriv permite que el contrato se resuelva');
    console.log('   en el mismo tick que disparó la compra? Esto solo se puede');
    console.log('   verificar en VIVO con la cuenta demo.');
}

runBacktest().catch(e => console.error('Error fatal:', e));
