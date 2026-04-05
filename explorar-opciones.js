/**
 * ============================================================
 *  🔍 EXPLORADOR DE OPCIONES RENTABLES — DERIV
 *  
 *  1. Consulta TODOS los tipos de contrato disponibles
 *  2. Obtiene payouts reales para cada uno
 *  3. Backtestea estrategias con datos históricos
 *  4. Encuentra la mejor combinación rentable
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD';

function query(ws, req) {
    return new Promise((resolve, reject) => {
        const handler = (raw) => {
            const msg = JSON.parse(raw);
            if (msg.msg_type === 'authorize' && req.authorize) { ws.removeListener('message', handler); resolve(msg); }
            else if (msg.msg_type === 'proposal' && req.proposal) { ws.removeListener('message', handler); resolve(msg); }
            else if (msg.msg_type === 'contracts_for' && req.contracts_for) { ws.removeListener('message', handler); resolve(msg); }
            else if (msg.msg_type === 'history' && req.ticks_history) { ws.removeListener('message', handler); resolve(msg); }
            else if (msg.error && !msg.msg_type?.includes('ping')) { ws.removeListener('message', handler); resolve({ error: msg.error }); }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify(req));
        setTimeout(() => { ws.removeListener('message', handler); resolve({ error: { message: 'Timeout' }}); }, 15000);
    });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log('═'.repeat(65));
    console.log('🔍 EXPLORADOR DE OPCIONES RENTABLES — DERIV');
    console.log('═'.repeat(65));

    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    await new Promise(r => ws.on('open', r));

    // Auth
    const auth = await query(ws, { authorize: TOKEN });
    if (auth.error) { console.error('Auth failed:', auth.error); return; }
    console.log(`✅ Autenticado. Balance: $${auth.authorize.balance}\n`);

    // ═══════════════════════════════════════════════════════════
    // PASO 1: ¿Qué contratos están disponibles para dígitos?
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(65));
    console.log('📋 PASO 1: Contratos disponibles para índices sintéticos');
    console.log('═'.repeat(65));

    const symbols = ['R_10', 'R_25', 'R_50', 'R_100'];
    
    for (const sym of symbols) {
        await sleep(1000);
        const contracts = await query(ws, { contracts_for: sym, currency: 'USD', product_type: 'basic' });
        
        if (contracts.error) {
            console.log(`❌ ${sym}: ${contracts.error.message}`);
            continue;
        }

        const available = contracts.contracts_for.available;
        const types = [...new Set(available.map(c => c.contract_type))];
        console.log(`\n📊 ${sym}: ${types.length} tipos de contrato`);
        console.log(`   Tipos: ${types.join(', ')}`);
    }

    // ═══════════════════════════════════════════════════════════
    // PASO 2: Comparar PAYOUTS de todos los tipos de dígitos
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('💰 PASO 2: Payouts reales por tipo de contrato ($1 stake)');
    console.log('═'.repeat(65));

    const digitTypes = [
        { type: 'DIGITDIFF', label: 'DIFFERS (NO será X)', barrier: '5' },
        { type: 'DIGITMATCH', label: 'MATCH (SÍ será X)', barrier: '5' },
        { type: 'DIGITOVER', label: 'OVER (dígito > X)', barrier: '4' },
        { type: 'DIGITUNDER', label: 'UNDER (dígito < X)', barrier: '5' },
        { type: 'DIGITEVEN', label: 'EVEN (dígito par)', barrier: null },
        { type: 'DIGITODD', label: 'ODD (dígito impar)', barrier: null },
    ];

    const payoutResults = [];

    for (const sym of symbols) {
        console.log(`\n📊 ${sym}:`);
        console.log('   ┌───────────────────────────┬──────────┬──────────┬───────────┐');
        console.log('   │ Tipo                      │ Payout   │ Ganancia │ Prob. Teó │');
        console.log('   ├───────────────────────────┼──────────┼──────────┼───────────┤');

        for (const dt of digitTypes) {
            await sleep(500);
            const params = {
                proposal: 1,
                amount: 1,
                basis: 'stake',
                contract_type: dt.type,
                currency: 'USD',
                symbol: sym,
                duration: 1,
                duration_unit: 't'
            };
            if (dt.barrier !== null) params.barrier = dt.barrier;

            const resp = await query(ws, params);
            
            if (resp.error) {
                console.log(`   │ ${dt.label.padEnd(25)} │  ERROR   │          │           │`);
                continue;
            }

            const payout = parseFloat(resp.proposal.payout);
            const profit = payout - 1;
            const probTeoria = dt.type === 'DIGITDIFF' ? '90%' :
                               dt.type === 'DIGITMATCH' ? '10%' :
                               dt.type === 'DIGITOVER' ? '50%' :
                               dt.type === 'DIGITUNDER' ? '50%' :
                               dt.type === 'DIGITEVEN' ? '50%' :
                               dt.type === 'DIGITODD' ? '50%' : '?';
            
            const breakEven = (1 / payout * 100).toFixed(1);

            console.log(`   │ ${dt.label.padEnd(25)} │ $${payout.toFixed(3).padStart(6)} │ +$${profit.toFixed(3).padStart(5)} │ ${probTeoria.padStart(4)} (BE:${breakEven}%) │`);
            
            payoutResults.push({ sym, type: dt.type, label: dt.label, payout, profit, probTeoria });
            
            // Cancel proposal stream
            if (resp.proposal && resp.proposal.id) {
                ws.send(JSON.stringify({ forget: resp.proposal.id }));
            }
        }
        console.log('   └───────────────────────────┴──────────┴──────────┴───────────┘');
    }

    // ═══════════════════════════════════════════════════════════
    // PASO 3: Probar OVER/UNDER con diferentes barreras
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('🎯 PASO 3: Payouts OVER/UNDER por barrera (R_25, $1 stake)');
    console.log('═'.repeat(65));

    console.log('\n   DIGITOVER (dígito será MAYOR que X):');
    console.log('   ┌──────────┬──────────┬──────────┬───────────┬───────────────┐');
    console.log('   │ Barrera  │ Payout   │ Ganancia │ Prob. Win │ Break-even    │');
    console.log('   ├──────────┼──────────┼──────────┼───────────┼───────────────┤');

    for (let b = 0; b <= 9; b++) {
        await sleep(400);
        const resp = await query(ws, {
            proposal: 1, amount: 1, basis: 'stake',
            contract_type: 'DIGITOVER', currency: 'USD',
            symbol: 'R_25', duration: 1, duration_unit: 't',
            barrier: String(b)
        });

        if (resp.error) {
            console.log(`   │    ${b}     │  ERROR   │          │           │               │`);
            continue;
        }

        const payout = parseFloat(resp.proposal.payout);
        const profit = payout - 1;
        const probWin = ((9 - b) / 10 * 100).toFixed(0); // Dígitos > barrera
        const breakEven = (1 / payout * 100).toFixed(1);

        console.log(`   │    ${b}     │ $${payout.toFixed(3).padStart(6)} │ +$${profit.toFixed(3).padStart(5)} │   ${probWin.padStart(3)}%     │ Need >${breakEven}%    │`);
        
        if (resp.proposal && resp.proposal.id) {
            ws.send(JSON.stringify({ forget: resp.proposal.id }));
        }
    }
    console.log('   └──────────┴──────────┴──────────┴───────────┴───────────────┘');

    console.log('\n   DIGITUNDER (dígito será MENOR que X):');
    console.log('   ┌──────────┬──────────┬──────────┬───────────┬───────────────┐');
    console.log('   │ Barrera  │ Payout   │ Ganancia │ Prob. Win │ Break-even    │');
    console.log('   ├──────────┼──────────┼──────────┼───────────┼───────────────┤');

    for (let b = 0; b <= 9; b++) {
        await sleep(400);
        const resp = await query(ws, {
            proposal: 1, amount: 1, basis: 'stake',
            contract_type: 'DIGITUNDER', currency: 'USD',
            symbol: 'R_25', duration: 1, duration_unit: 't',
            barrier: String(b)
        });

        if (resp.error) {
            console.log(`   │    ${b}     │  ERROR   │          │           │               │`);
            continue;
        }

        const payout = parseFloat(resp.proposal.payout);
        const profit = payout - 1;
        const probWin = (b / 10 * 100).toFixed(0); // Dígitos < barrera
        const breakEven = (1 / payout * 100).toFixed(1);

        console.log(`   │    ${b}     │ $${payout.toFixed(3).padStart(6)} │ +$${profit.toFixed(3).padStart(5)} │   ${probWin.padStart(3)}%     │ Need >${breakEven}%    │`);
        
        if (resp.proposal && resp.proposal.id) {
            ws.send(JSON.stringify({ forget: resp.proposal.id }));
        }
    }
    console.log('   └──────────┴──────────┴──────────┴───────────┴───────────────┘');

    // ═══════════════════════════════════════════════════════════
    // PASO 4: BACKTEST de estrategias con datos históricos
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('🧪 PASO 4: Backtest con 5000 ticks reales de R_25');
    console.log('═'.repeat(65));

    const histResp = await query(ws, { ticks_history: 'R_25', count: 5000, end: 'latest', style: 'ticks' });
    if (histResp.error) { console.error('Error hist:', histResp.error); ws.close(); return; }
    
    const prices = histResp.history.prices;
    const digits = prices.map(p => parseInt(String(p).slice(-1)));
    console.log(`\n📊 ${digits.length} ticks cargados.\n`);

    // ─── Estrategia 1: EVEN/ODD con patrón (si el actual es par, apostar impar) ──
    const evenOddResp = await query(ws, {
        proposal: 1, amount: 1, basis: 'stake',
        contract_type: 'DIGITEVEN', currency: 'USD',
        symbol: 'R_25', duration: 1, duration_unit: 't'
    });
    const evenPayout = evenOddResp.error ? 1.9 : parseFloat(evenOddResp.proposal.payout);
    const evenProfit = evenPayout - 1;
    if (evenOddResp.proposal?.id) ws.send(JSON.stringify({ forget: evenOddResp.proposal.id }));

    // Test: Si actual es par → apostar ODD (contrario), y viceversa
    let eo_wins = 0, eo_losses = 0, eo_pnl = 0;
    for (let i = 0; i < digits.length - 1; i += 3) {
        const current = digits[i];
        const next = digits[i + 1];
        const currentIsEven = current % 2 === 0;
        // Apostamos lo contrario del actual
        const betEven = !currentIsEven;
        const nextIsEven = next % 2 === 0;
        
        if (betEven === nextIsEven) {
            eo_pnl += evenProfit;
            eo_wins++;
        } else {
            eo_pnl -= 1;
            eo_losses++;
        }
    }

    // ─── Estrategia 2: OVER 4 (>4) con análisis de tendencia ──
    const over4Resp = await query(ws, {
        proposal: 1, amount: 1, basis: 'stake',
        contract_type: 'DIGITOVER', currency: 'USD',
        symbol: 'R_25', duration: 1, duration_unit: 't', barrier: '4'
    });
    const over4Payout = over4Resp.error ? 1.9 : parseFloat(over4Resp.proposal.payout);
    const over4Profit = over4Payout - 1;
    if (over4Resp.proposal?.id) ws.send(JSON.stringify({ forget: over4Resp.proposal.id }));

    // Test: Si últimos 5 dígitos tienen mayoría <5, apostar OVER (rebote)
    let ov_wins = 0, ov_losses = 0, ov_pnl = 0;
    for (let i = 5; i < digits.length - 1; i += 3) {
        const last5 = digits.slice(i - 5, i);
        const lowCount = last5.filter(d => d < 5).length;
        
        if (lowCount >= 3) { // Mayoría baja → apostar que rebota a OVER
            const next = digits[i + 1];
            if (next > 4) {
                ov_pnl += over4Profit;
                ov_wins++;
            } else {
                ov_pnl -= 1;
                ov_losses++;
            }
        }
    }

    // ─── Estrategia 3: DIFFERS inteligente (dígito más frío como barrera) ──
    const diffResp = await query(ws, {
        proposal: 1, amount: 1, basis: 'stake',
        contract_type: 'DIGITDIFF', currency: 'USD',
        symbol: 'R_25', duration: 1, duration_unit: 't', barrier: '5'
    });
    const diffPayout = diffResp.error ? 1.098 : parseFloat(diffResp.proposal.payout);
    const diffProfit = diffPayout - 1;
    if (diffResp.proposal?.id) ws.send(JSON.stringify({ forget: diffResp.proposal.id }));

    // Test: Elegir el dígito MÁS FRÍO (menos visto en últimos 20) como barrera
    let di_wins = 0, di_losses = 0, di_pnl = 0;
    for (let i = 20; i < digits.length - 1; i += 3) {
        const last20 = digits.slice(i - 20, i);
        const freq = {};
        for (let d = 0; d <= 9; d++) freq[d] = 0;
        last20.forEach(d => freq[d]++);
        
        // Encontrar el dígito más frío (menos frecuente)
        let coldest = 0, minF = 999;
        for (let d = 0; d <= 9; d++) {
            if (freq[d] < minF) { minF = freq[d]; coldest = d; }
        }
        
        const next = digits[i + 1];
        if (next !== coldest) {
            di_pnl += diffProfit;
            di_wins++;
        } else {
            di_pnl -= 1;
            di_losses++;
        }
    }

    // ─── Estrategia 4: OVER/UNDER Adaptativo (análisis de peso) ──
    let au_wins = 0, au_losses = 0, au_pnl = 0;
    for (let i = 10; i < digits.length - 1; i += 3) {
        const last10 = digits.slice(i - 10, i);
        const avg = last10.reduce((a, b) => a + b, 0) / last10.length;
        
        // Si el promedio de dígitos recientes es bajo (<4.5), apostar OVER
        // Si es alto (>5.5), apostar UNDER
        if (avg < 4.0) {
            const next = digits[i + 1];
            if (next > 4) { au_pnl += over4Profit; au_wins++; }
            else { au_pnl -= 1; au_losses++; }
        } else if (avg > 6.0) {
            const next = digits[i + 1];
            if (next < 5) { au_pnl += over4Profit; au_wins++; }
            else { au_pnl -= 1; au_losses++; }
        }
    }

    // ─── Estrategia 5: MATCH con dígito más caliente (alto riesgo/alta recompensa)──
    const matchResp = await query(ws, {
        proposal: 1, amount: 1, basis: 'stake',
        contract_type: 'DIGITMATCH', currency: 'USD',
        symbol: 'R_25', duration: 1, duration_unit: 't', barrier: '5'
    });
    const matchPayout = matchResp.error ? 9.5 : parseFloat(matchResp.proposal.payout);
    const matchProfit = matchPayout - 1;
    if (matchResp.proposal?.id) ws.send(JSON.stringify({ forget: matchResp.proposal.id }));

    let ma_wins = 0, ma_losses = 0, ma_pnl = 0;
    for (let i = 30; i < digits.length - 1; i += 5) {
        const last30 = digits.slice(i - 30, i);
        const freq = {};
        for (let d = 0; d <= 9; d++) freq[d] = 0;
        last30.forEach(d => freq[d]++);
        
        let hottest = 0, maxF = 0;
        for (let d = 0; d <= 9; d++) {
            if (freq[d] > maxF) { maxF = freq[d]; hottest = d; }
        }
        
        if (maxF >= 5) { // Solo apostar si hay un dígito significativamente caliente
            const next = digits[i + 1];
            if (next === hottest) { ma_pnl += matchProfit; ma_wins++; }
            else { ma_pnl -= 1; ma_losses++; }
        }
    }

    // ─── Estrategia 6: DIFFERS Opuesto (la que tenemos ahora) ──
    let so_wins = 0, so_losses = 0, so_pnl = 0;
    for (let i = 0; i < digits.length - 1; i += 3) {
        const barrier = (digits[i] + 5) % 10;
        const next = digits[i + 1];
        if (next !== barrier) {
            so_pnl += diffProfit;
            so_wins++;
        } else {
            so_pnl -= 1;
            so_losses++;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // RESUMEN FINAL
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(65));
    console.log('🏆 RESUMEN: TODAS LAS ESTRATEGIAS COMPARADAS');
    console.log('═'.repeat(65));
    
    const strategies = [
        { name: 'DIFFERS Opuesto (actual)', wins: so_wins, losses: so_losses, pnl: so_pnl, payout: `+$${diffProfit.toFixed(3)}/-$1` },
        { name: 'DIFFERS Frío (dígito raro)', wins: di_wins, losses: di_losses, pnl: di_pnl, payout: `+$${diffProfit.toFixed(3)}/-$1` },
        { name: 'EVEN/ODD Contrario', wins: eo_wins, losses: eo_losses, pnl: eo_pnl, payout: `+$${evenProfit.toFixed(3)}/-$1` },
        { name: 'OVER>4 por Rebote', wins: ov_wins, losses: ov_losses, pnl: ov_pnl, payout: `+$${over4Profit.toFixed(3)}/-$1` },
        { name: 'OVER/UNDER Adaptativo', wins: au_wins, losses: au_losses, pnl: au_pnl, payout: `+$${over4Profit.toFixed(3)}/-$1` },
        { name: 'MATCH Caliente (x9)', wins: ma_wins, losses: ma_losses, pnl: ma_pnl, payout: `+$${matchProfit.toFixed(1)}/-$1` },
    ];

    console.log(`\n   ┌────────────────────────────┬───────┬───────┬────────┬───────────┬──────────────┐`);
    console.log(`   │ Estrategia                 │ Wins  │Losses │ WinRate│ PnL Total │ Payout       │`);
    console.log(`   ├────────────────────────────┼───────┼───────┼────────┼───────────┼──────────────┤`);
    
    strategies.sort((a, b) => b.pnl - a.pnl);
    
    for (const s of strategies) {
        const total = s.wins + s.losses;
        const wr = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '0.0';
        const icon = s.pnl > 0 ? '✅' : '❌';
        console.log(`   │ ${icon} ${s.name.padEnd(25)}│${String(s.wins).padStart(5)}  │${String(s.losses).padStart(5)}  │ ${wr.padStart(5)}% │ $${s.pnl.toFixed(2).padStart(8)} │ ${s.payout.padEnd(12)} │`);
    }
    console.log(`   └────────────────────────────┴───────┴───────┴────────┴───────────┴──────────────┘`);

    const best = strategies[0];
    console.log(`\n🏆 MEJOR ESTRATEGIA: ${best.name}`);
    console.log(`   PnL: $${best.pnl.toFixed(2)} en ${best.wins + best.losses} trades`);
    console.log(`   Win Rate: ${((best.wins / (best.wins + best.losses)) * 100).toFixed(1)}%`);

    ws.close();
    console.log('\n✅ Análisis completado.');
}

main().catch(e => console.error('Error:', e));
