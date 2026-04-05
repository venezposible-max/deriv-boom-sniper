/**
 * ============================================================
 *  🔬 INVESTIGACIÓN PROFUNDA: MATCH CALIENTE + OVER REBOTE
 *  
 *  Corrige el bug del dígito 0 (toFixed) y prueba múltiples
 *  variaciones de cada estrategia para encontrar la más rentable.
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD';
const SYMBOL = 'R_25';
const DECIMALS = 3; // R_25 usa 3 decimales

function getLastDigit(price) {
    // FIX CRÍTICO: Usar toFixed para preservar trailing zeros
    return parseInt(parseFloat(price).toFixed(DECIMALS).slice(-1));
}

function query(ws, req) {
    return new Promise((resolve) => {
        const handler = (raw) => {
            const msg = JSON.parse(raw);
            if (msg.msg_type === 'authorize' && req.authorize) { ws.removeListener('message', handler); resolve(msg); }
            else if (msg.msg_type === 'proposal' && req.proposal) { ws.removeListener('message', handler); resolve(msg); }
            else if (msg.msg_type === 'history' && req.ticks_history) { ws.removeListener('message', handler); resolve(msg); }
            else if (msg.error) { ws.removeListener('message', handler); resolve({ error: msg.error }); }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify(req));
        setTimeout(() => { ws.removeListener('message', handler); resolve({ error: { message: 'Timeout' }}); }, 15000);
    });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log('═'.repeat(65));
    console.log('🔬 INVESTIGACIÓN PROFUNDA — MATCH CALIENTE + OVER REBOTE');
    console.log('═'.repeat(65));

    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    await new Promise(r => ws.on('open', r));

    const auth = await query(ws, { authorize: TOKEN });
    console.log(`✅ Autenticado. Balance: $${auth.authorize.balance}\n`);

    // ─── Obtener payout REAL de cada tipo ───────────────────────
    console.log('💰 Obteniendo payouts reales...');
    
    const matchResp = await query(ws, { proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITMATCH', currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: '5' });
    const MATCH_PAYOUT = matchResp.error ? 8.93 : parseFloat(matchResp.proposal.payout);
    const MATCH_WIN = MATCH_PAYOUT - 1;
    if (matchResp.proposal?.id) ws.send(JSON.stringify({ forget: matchResp.proposal.id }));
    console.log(`   MATCH:  Payout $${MATCH_PAYOUT} → WIN +$${MATCH_WIN.toFixed(2)} / LOSS -$1.00`);

    await sleep(500);
    const overResp = await query(ws, { proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITOVER', currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: '4' });
    const OVER_PAYOUT = overResp.error ? 1.95 : parseFloat(overResp.proposal.payout);
    const OVER_WIN = OVER_PAYOUT - 1;
    if (overResp.proposal?.id) ws.send(JSON.stringify({ forget: overResp.proposal.id }));
    console.log(`   OVER>4: Payout $${OVER_PAYOUT} → WIN +$${OVER_WIN.toFixed(2)} / LOSS -$1.00`);

    await sleep(500);
    const evenResp = await query(ws, { proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITEVEN', currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't' });
    const EVEN_PAYOUT = evenResp.error ? 1.95 : parseFloat(evenResp.proposal.payout);
    const EVEN_WIN = EVEN_PAYOUT - 1;
    if (evenResp.proposal?.id) ws.send(JSON.stringify({ forget: evenResp.proposal.id }));
    console.log(`   EVEN:   Payout $${EVEN_PAYOUT} → WIN +$${EVEN_WIN.toFixed(2)} / LOSS -$1.00`);

    await sleep(500);
    const diffResp = await query(ws, { proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITDIFF', currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: '5' });
    const DIFF_PAYOUT = diffResp.error ? 1.098 : parseFloat(diffResp.proposal.payout);
    const DIFF_WIN = DIFF_PAYOUT - 1;
    if (diffResp.proposal?.id) ws.send(JSON.stringify({ forget: diffResp.proposal.id }));
    console.log(`   DIFFERS:Payout $${DIFF_PAYOUT} → WIN +$${DIFF_WIN.toFixed(3)} / LOSS -$1.00`);

    // ─── Cargar datos históricos ─────────────────────────────────
    console.log('\n📡 Cargando 5000 ticks...');
    const histResp = await query(ws, { ticks_history: SYMBOL, count: 5000, end: 'latest', style: 'ticks' });
    const prices = histResp.history.prices;
    const digits = prices.map(p => getLastDigit(p));
    console.log(`✅ ${digits.length} ticks cargados.`);

    // ─── Distribución CORREGIDA ──────────────────────────────────
    console.log('\n📊 DISTRIBUCIÓN DE DÍGITOS (CORREGIDA con toFixed):');
    const globalFreq = {};
    for (let d = 0; d <= 9; d++) globalFreq[d] = 0;
    digits.forEach(d => globalFreq[d]++);
    
    for (let d = 0; d <= 9; d++) {
        const pct = ((globalFreq[d] / digits.length) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct * 2));
        console.log(`   ${d}: ${bar} ${globalFreq[d]} (${pct}%)`);
    }

    const COOLDOWN = 3; // Ticks entre trades (simula ~2s)

    // ═══════════════════════════════════════════════════════════
    // 🔴 INVESTIGACIÓN 1: MATCH CALIENTE
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('🔴 INVESTIGACIÓN: MATCH CALIENTE (apostar que el más visto se repite)');
    console.log('═'.repeat(65));

    const matchVariations = [
        { name: 'Match-20 (freq≥4)',  window: 20, threshold: 4 },
        { name: 'Match-20 (freq≥3)',  window: 20, threshold: 3 },
        { name: 'Match-30 (freq≥5)',  window: 30, threshold: 5 },
        { name: 'Match-30 (freq≥4)',  window: 30, threshold: 4 },
        { name: 'Match-50 (freq≥7)',  window: 50, threshold: 7 },
        { name: 'Match-50 (freq≥6)',  window: 50, threshold: 6 },
        { name: 'Match-100 (freq≥14)',window: 100, threshold: 14 },
        { name: 'Match-100 (freq≥12)',window: 100, threshold: 12 },
        { name: 'Match-10 (freq≥3)',  window: 10, threshold: 3 },
        { name: 'Match-10 (freq≥2)',  window: 10, threshold: 2 },
        { name: 'Match-5 (último rep)',window: 5, threshold: 2 },
    ];

    console.log(`\n   ┌─────────────────────────┬───────┬───────┬────────┬───────────┬───────────┐`);
    console.log(`   │ Variación               │ Wins  │Losses │ WinRate│ PnL $1    │ Trades    │`);
    console.log(`   ├─────────────────────────┼───────┼───────┼────────┼───────────┼───────────┤`);

    for (const v of matchVariations) {
        let wins = 0, losses = 0, pnl = 0;
        
        for (let i = v.window; i < digits.length - 1; i += COOLDOWN) {
            const window = digits.slice(i - v.window, i);
            const freq = {};
            for (let d = 0; d <= 9; d++) freq[d] = 0;
            window.forEach(d => freq[d]++);
            
            let hottest = 0, maxF = 0;
            for (let d = 0; d <= 9; d++) {
                if (freq[d] > maxF) { maxF = freq[d]; hottest = d; }
            }
            
            if (maxF >= v.threshold) {
                const next = digits[i + 1];
                if (next === hottest) { pnl += MATCH_WIN; wins++; }
                else { pnl -= 1; losses++; }
            }
        }
        
        const total = wins + losses;
        const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
        const icon = pnl > 0 ? '✅' : '❌';
        const breakEven = (1 / MATCH_PAYOUT * 100).toFixed(1);
        
        console.log(`   │ ${icon} ${v.name.padEnd(22)}│${String(wins).padStart(5)}  │${String(losses).padStart(5)}  │ ${wr.padStart(5)}% │ $${pnl.toFixed(2).padStart(8)} │ ${String(total).padStart(6)}    │`);
    }
    console.log(`   └─────────────────────────┴───────┴───────┴────────┴───────────┴───────────┘`);
    console.log(`   Break-even para MATCH: >${(1/MATCH_PAYOUT*100).toFixed(1)}% win rate`);

    // ═══════════════════════════════════════════════════════════
    // 🟢 INVESTIGACIÓN 2: OVER/UNDER REBOTE
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('🟢 INVESTIGACIÓN: OVER/UNDER POR REBOTE');
    console.log('═'.repeat(65));

    const overVariations = [
        { name: 'Rebote-5 (low≥3)', window: 5,  lowThresh: 3, type: 'OVER' },
        { name: 'Rebote-5 (low≥4)', window: 5,  lowThresh: 4, type: 'OVER' },
        { name: 'Rebote-5 (low=5)',  window: 5,  lowThresh: 5, type: 'OVER' },
        { name: 'Rebote-10 (low≥6)', window: 10, lowThresh: 6, type: 'OVER' },
        { name: 'Rebote-10 (low≥7)', window: 10, lowThresh: 7, type: 'OVER' },
        { name: 'Rebote-10 (low≥8)', window: 10, lowThresh: 8, type: 'OVER' },
        { name: 'Rebote-20 (low≥12)',window: 20, lowThresh: 12, type: 'OVER' },
        { name: 'Rebote-20 (low≥14)',window: 20, lowThresh: 14, type: 'OVER' },
        { name: 'Rebote-5 (hi≥3)',   window: 5,  lowThresh: 3, type: 'UNDER' },
        { name: 'Rebote-5 (hi≥4)',   window: 5,  lowThresh: 4, type: 'UNDER' },
        { name: 'Rebote-5 (hi=5)',   window: 5,  lowThresh: 5, type: 'UNDER' },
        { name: 'Rebote-10 (hi≥7)',  window: 10, lowThresh: 7, type: 'UNDER' },
        { name: 'Rebote-10 (hi≥8)',  window: 10, lowThresh: 8, type: 'UNDER' },
    ];

    console.log(`\n   ┌──────────────────────────┬───────┬───────┬────────┬───────────┬───────────┐`);
    console.log(`   │ Variación                │ Wins  │Losses │ WinRate│ PnL $1    │ Trades    │`);
    console.log(`   ├──────────────────────────┼───────┼───────┼────────┼───────────┼───────────┤`);

    for (const v of overVariations) {
        let wins = 0, losses = 0, pnl = 0;
        
        for (let i = v.window; i < digits.length - 1; i += COOLDOWN) {
            const window = digits.slice(i - v.window, i);
            
            if (v.type === 'OVER') {
                const lowCount = window.filter(d => d < 5).length;
                if (lowCount >= v.lowThresh) {
                    const next = digits[i + 1];
                    if (next > 4) { pnl += OVER_WIN; wins++; }
                    else { pnl -= 1; losses++; }
                }
            } else { // UNDER
                const highCount = window.filter(d => d > 4).length;
                if (highCount >= v.lowThresh) {
                    const next = digits[i + 1];
                    if (next < 5) { pnl += OVER_WIN; wins++; }
                    else { pnl -= 1; losses++; }
                }
            }
        }
        
        const total = wins + losses;
        const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
        const icon = pnl > 0 ? '✅' : '❌';
        
        console.log(`   │ ${icon} ${v.name.padEnd(23)}│${String(wins).padStart(5)}  │${String(losses).padStart(5)}  │ ${wr.padStart(5)}% │ $${pnl.toFixed(2).padStart(8)} │ ${String(total).padStart(6)}    │`);
    }
    console.log(`   └──────────────────────────┴───────┴───────┴────────┴───────────┴───────────┘`);
    console.log(`   Break-even para OVER/UNDER: >${(1/OVER_PAYOUT*100).toFixed(1)}% win rate`);

    // ═══════════════════════════════════════════════════════════
    // 🟡 INVESTIGACIÓN 3: EVEN/ODD con patrones
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('🟡 INVESTIGACIÓN: EVEN/ODD CON PATRONES');
    console.log('═'.repeat(65));

    const eoVariations = [
        { name: 'Contrario simple',      logic: 'contrary' },
        { name: 'Mismo que actual',       logic: 'same' },
        { name: 'Contrario si 3/5 iguales', logic: 'streak3' },
        { name: 'Contrario si 4/5 iguales', logic: 'streak4' },
        { name: 'Mayoría últimos 10',     logic: 'majority10' },
        { name: 'Mayoría últimos 20',     logic: 'majority20' },
    ];

    console.log(`\n   ┌──────────────────────────────┬───────┬───────┬────────┬───────────┬────────┐`);
    console.log(`   │ Variación                    │ Wins  │Losses │ WinRate│ PnL $1    │ Trades │`);
    console.log(`   ├──────────────────────────────┼───────┼───────┼────────┼───────────┼────────┤`);

    for (const v of eoVariations) {
        let wins = 0, losses = 0, pnl = 0;
        
        for (let i = 20; i < digits.length - 1; i += COOLDOWN) {
            const current = digits[i];
            const currentEven = current % 2 === 0;
            const next = digits[i + 1];
            const nextEven = next % 2 === 0;
            let betEven = null;
            
            if (v.logic === 'contrary') {
                betEven = !currentEven;
            } else if (v.logic === 'same') {
                betEven = currentEven;
            } else if (v.logic === 'streak3') {
                const last5 = digits.slice(i - 4, i + 1);
                const evenCount = last5.filter(d => d % 2 === 0).length;
                if (evenCount >= 3) betEven = false; // mayoría par → apostar impar
                else if (evenCount <= 2) betEven = true; // mayoría impar → apostar par
                else continue;
            } else if (v.logic === 'streak4') {
                const last5 = digits.slice(i - 4, i + 1);
                const evenCount = last5.filter(d => d % 2 === 0).length;
                if (evenCount >= 4) betEven = false;
                else if (evenCount <= 1) betEven = true;
                else continue;
            } else if (v.logic === 'majority10') {
                const last10 = digits.slice(i - 9, i + 1);
                const evenCount = last10.filter(d => d % 2 === 0).length;
                if (evenCount >= 7) betEven = false;
                else if (evenCount <= 3) betEven = true;
                else continue;
            } else if (v.logic === 'majority20') {
                const last20 = digits.slice(i - 19, i + 1);
                const evenCount = last20.filter(d => d % 2 === 0).length;
                if (evenCount >= 13) betEven = false;
                else if (evenCount <= 7) betEven = true;
                else continue;
            }
            
            if (betEven === null) continue;
            
            if (betEven === nextEven) { pnl += EVEN_WIN; wins++; }
            else { pnl -= 1; losses++; }
        }
        
        const total = wins + losses;
        const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
        const icon = pnl > 0 ? '✅' : '❌';
        
        console.log(`   │ ${icon} ${v.name.padEnd(27)}│${String(wins).padStart(5)}  │${String(losses).padStart(5)}  │ ${wr.padStart(5)}% │ $${pnl.toFixed(2).padStart(8)} │ ${String(total).padStart(5)}  │`);
    }
    console.log(`   └──────────────────────────────┴───────┴───────┴────────┴───────────┴────────┘`);
    console.log(`   Break-even para EVEN/ODD: >${(1/EVEN_PAYOUT*100).toFixed(1)}% win rate`);

    // ═══════════════════════════════════════════════════════════
    // 🔵 INVESTIGACIÓN 4: DIFFERS — Buscando edge real
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('🔵 INVESTIGACIÓN: DIFFERS — ¿Se puede superar 91.7% win rate?');
    console.log('═'.repeat(65));

    const diffVariations = [
        { name: 'Opuesto (+5)', logic: 'opposite' },
        { name: 'Frío (menos visto 20)', logic: 'cold20' },
        { name: 'Frío (menos visto 50)', logic: 'cold50' },
        { name: 'Caliente (más visto como barrera)', logic: 'hot' },
        { name: 'Último dígito (Mirror)', logic: 'mirror' },
        { name: 'Anti-Racha (si d repite 3x)', logic: 'antistreak' },
    ];

    console.log(`\n   ┌────────────────────────────────────┬───────┬───────┬────────┬───────────┐`);
    console.log(`   │ Variación                          │ Wins  │Losses │ WinRate│ PnL $1    │`);
    console.log(`   ├────────────────────────────────────┼───────┼───────┼────────┼───────────┤`);

    for (const v of diffVariations) {
        let wins = 0, losses = 0, pnl = 0;
        
        for (let i = 50; i < digits.length - 1; i += COOLDOWN) {
            let barrier;
            
            if (v.logic === 'opposite') {
                barrier = (digits[i] + 5) % 10;
            } else if (v.logic === 'cold20' || v.logic === 'cold50') {
                const w = v.logic === 'cold20' ? 20 : 50;
                const win = digits.slice(i - w, i);
                const freq = {};
                for (let d = 0; d <= 9; d++) freq[d] = 0;
                win.forEach(d => freq[d]++);
                let coldest = 0, minF = 999;
                for (let d = 0; d <= 9; d++) {
                    if (freq[d] < minF) { minF = freq[d]; coldest = d; }
                }
                barrier = coldest;
            } else if (v.logic === 'hot') {
                const win = digits.slice(i - 20, i);
                const freq = {};
                for (let d = 0; d <= 9; d++) freq[d] = 0;
                win.forEach(d => freq[d]++);
                let hottest = 0, maxF = 0;
                for (let d = 0; d <= 9; d++) {
                    if (freq[d] > maxF) { maxF = freq[d]; hottest = d; }
                }
                barrier = hottest;
            } else if (v.logic === 'mirror') {
                barrier = digits[i]; // El mismo dígito actual
            } else if (v.logic === 'antistreak') {
                const last3 = digits.slice(i - 2, i + 1);
                if (last3[0] === last3[1] && last3[1] === last3[2]) {
                    barrier = last3[0]; // Si se repite 3 veces, apostar contra él
                } else {
                    continue; // No apostar
                }
            }
            
            const next = digits[i + 1];
            if (next !== barrier) { pnl += DIFF_WIN; wins++; }
            else { pnl -= 1; losses++; }
        }
        
        const total = wins + losses;
        const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
        const icon = pnl > 0 ? '✅' : '❌';
        
        console.log(`   │ ${icon} ${v.name.padEnd(33)}│${String(wins).padStart(5)}  │${String(losses).padStart(5)}  │ ${wr.padStart(5)}% │ $${pnl.toFixed(2).padStart(8)} │`);
    }
    console.log(`   └────────────────────────────────────┴───────┴───────┴────────┴───────────┘`);
    console.log(`   Break-even para DIFFERS: >${(1/DIFF_PAYOUT*100).toFixed(1)}% win rate`);

    // ═══════════════════════════════════════════════════════════
    // 🏆 RESUMEN FINAL — TOP ESTRATEGIAS
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log('🏆 BREAK-EVEN COMPARATIVO POR TIPO DE CONTRATO');
    console.log('═'.repeat(65));
    console.log(`\n   DIFFERS:   Paga +$${DIFF_WIN.toFixed(3)} por WIN → Necesitas >${(1/DIFF_PAYOUT*100).toFixed(1)}% WR`);
    console.log(`   MATCH:     Paga +$${MATCH_WIN.toFixed(2)} por WIN → Necesitas >${(1/MATCH_PAYOUT*100).toFixed(1)}% WR`);
    console.log(`   OVER/UNDER:Paga +$${OVER_WIN.toFixed(2)} por WIN → Necesitas >${(1/OVER_PAYOUT*100).toFixed(1)}% WR`);
    console.log(`   EVEN/ODD:  Paga +$${EVEN_WIN.toFixed(2)} por WIN → Necesitas >${(1/EVEN_PAYOUT*100).toFixed(1)}% WR`);
    console.log(`\n   📌 La clave: MATCH solo necesita 11.2% para ser rentable (vs 91.7% de DIFFERS)`);
    console.log(`   📌 OVER/UNDER necesita 51.3% — cualquier edge >1.3% es rentable`);

    ws.close();
    console.log('\n✅ Investigación completada.');
}

main().catch(e => console.error('Error:', e));
