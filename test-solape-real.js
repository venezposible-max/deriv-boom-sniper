/**
 * ============================================================
 *  🧬 TEST DE SOLAPE — DIAGNÓSTICO EN VIVO
 *  
 *  Ejecuta 10 trades reales en DEMO y mide:
 *  - ¿El tick que disparó la compra es el mismo que resolvió el contrato?
 *  - ¿Cuántos ms de diferencia hay entre el tick y el buy?
 *  - ¿El overlap realmente funciona?
 * ============================================================
 */

import WebSocket from 'ws';

const APP_ID = '36544';
const DERIV_TOKEN = process.env.DERIV_TOKEN_DEMO || 'PMIt2RhEjEDbcLD';
const SYMBOL = 'R_25';
const STAKE = 0.35; // Mínimo para no gastar mucho en demo
const MAX_TRADES = 15;

let ws = null;
let tradeResults = [];
let pendingTrade = null;
let tradeCount = 0;
let readyToFire = true;

function connect() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    
    ws.on('open', () => {
        console.log('🔌 Conectado. Autenticando...');
        ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch(e) { return; }
        
        if (msg.ping || msg.msg_type === 'ping') {
            ws.send(JSON.stringify({ ping: 1 }));
            return;
        }

        // AUTH OK
        if (msg.msg_type === 'authorize' && msg.authorize) {
            console.log(`✅ Autenticado: ${msg.authorize.fullname}`);
            console.log(`💰 Balance: $${msg.authorize.balance}`);
            console.log(`\n🧬 INICIANDO TEST DE SOLAPE — ${MAX_TRADES} trades\n`);
            console.log('─'.repeat(70));
            
            // Suscribir a ticks
            setTimeout(() => {
                ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
            }, 2000);
        }

        // ERROR
        if (msg.error) {
            console.error(`⚠️ Error [${msg.error.code}]: ${msg.error.message}`);
            
            if (msg.error.code === 'InvalidContractProposal' || 
                msg.error.code === 'ContractBuyValidationError') {
                readyToFire = true;
                pendingTrade = null;
            }
            return;
        }

        // TICK → DISPARO ATÓMICO ULTRA-RÁPIDO
        if (msg.msg_type === 'tick' && msg.tick) {
            if (!readyToFire || tradeCount >= MAX_TRADES) return;
            
            const tickEpoch = msg.tick.epoch;
            const quote = msg.tick.quote;
            const tickDigit = parseInt(String(quote).slice(-1));
            const barrier = String((tickDigit + 5) % 10);
            
            // ⚡ DISPARO INSTANTÁNEO — CERO procesamiento entre leer y enviar
            const sendTime = Date.now();
            ws.send(JSON.stringify({
                buy: 1,
                price: STAKE,
                parameters: {
                    amount: STAKE,
                    basis: 'stake',
                    contract_type: 'DIGITDIFF',
                    currency: 'USD',
                    symbol: SYMBOL,
                    duration: 1,
                    duration_unit: 't',
                    barrier: barrier
                }
            }));
            
            readyToFire = false;
            pendingTrade = {
                triggerTickEpoch: tickEpoch,
                triggerQuote: quote,
                triggerDigit: tickDigit,
                barrier: parseInt(barrier),
                sendTimeMs: sendTime,
                tradeNum: tradeCount + 1
            };

            console.log(`⚡ [#${pendingTrade.tradeNum}] DISPARADO | Tick=${tickDigit} Barrera=NO-${barrier} | Precio=${quote} | Epoch=${tickEpoch}`);
        }

        // COMPRA CONFIRMADA
        if (msg.msg_type === 'buy' && msg.buy) {
            const buyTime = Date.now();
            if (pendingTrade) {
                pendingTrade.contractId = msg.buy.contract_id;
                pendingTrade.buyPrice = msg.buy.buy_price;
                pendingTrade.buyTimeMs = buyTime;
                pendingTrade.latencyMs = buyTime - pendingTrade.sendTimeMs;
                
                console.log(`   📋 Contrato: ${msg.buy.contract_id} | Latencia compra: ${pendingTrade.latencyMs}ms`);
            }
            
            // Suscribir al resultado
            ws.send(JSON.stringify({ 
                proposal_open_contract: 1, 
                contract_id: msg.buy.contract_id, 
                subscribe: 1 
            }));
        }

        // RESULTADO DEL CONTRATO — AQUÍ SABEMOS SI EL SOLAPE FUNCIONÓ
        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c || !c.is_sold || !pendingTrade) return;
            
            const profit = parseFloat(c.profit);
            const isWin = profit > 0;
            
            // DATOS CLAVE PARA EL DIAGNÓSTICO
            const entrySpot = c.entry_spot;
            const exitSpot = c.exit_spot;
            const entryTickTime = c.entry_tick_time || c.date_start;
            const exitTickTime = c.exit_tick_time;
            const entryDigit = entrySpot ? parseInt(String(entrySpot).slice(-1)) : '?';
            const exitDigit = exitSpot ? parseInt(String(exitSpot).slice(-1)) : '?';
            
            // ¿EL TICK QUE VIMOS ES EL MISMO QUE RESOLVIÓ EL CONTRATO?
            const triggerEpoch = pendingTrade.triggerTickEpoch;
            const solapDetected = (triggerEpoch === entryTickTime) || (triggerEpoch === exitTickTime);
            const sameTriggerDigit = (pendingTrade.triggerDigit === exitDigit);
            
            const result = {
                num: pendingTrade.tradeNum,
                triggerDigit: pendingTrade.triggerDigit,
                triggerEpoch: triggerEpoch,
                barrier: pendingTrade.barrier,
                entrySpot: entrySpot,
                entryDigit: entryDigit,
                entryEpoch: entryTickTime,
                exitSpot: exitSpot,
                exitDigit: exitDigit,
                exitEpoch: exitTickTime,
                profit: profit,
                isWin: isWin,
                latencyMs: pendingTrade.latencyMs,
                solapDetected: solapDetected,
                exitMatchesTrigger: sameTriggerDigit
            };
            
            tradeResults.push(result);
            tradeCount++;
            
            const solapIcon = solapDetected ? '🎯 SOLAPE!' : '❌ No-Solape';
            const winIcon = isWin ? '✅ WIN' : '❌ LOSS';
            
            console.log(`   ${winIcon} ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} | ${solapIcon}`);
            console.log(`   📊 Trigger: digit=${pendingTrade.triggerDigit} epoch=${triggerEpoch}`);
            console.log(`   📊 Entry:   digit=${entryDigit} spot=${entrySpot} epoch=${entryTickTime}`);
            console.log(`   📊 Exit:    digit=${exitDigit} spot=${exitSpot} epoch=${exitTickTime}`);
            console.log(`   📊 Latencia: ${pendingTrade.latencyMs}ms | Exit=Trigger? ${sameTriggerDigit ? 'SÍ ✅' : 'NO'}`);
            console.log('─'.repeat(70));
            
            pendingTrade = null;
            
            if (tradeCount >= MAX_TRADES) {
                printFinalReport();
                setTimeout(() => {
                    ws.close();
                    process.exit(0);
                }, 2000);
            } else {
                // Esperar 3 segundos antes del siguiente trade
                setTimeout(() => { readyToFire = true; }, 3000);
            }
        }
    });

    ws.on('error', e => console.error('Error WS:', e.message));
    ws.on('close', () => console.log('Conexión cerrada.'));
}

function printFinalReport() {
    console.log('\n');
    console.log('═'.repeat(70));
    console.log('🧬 REPORTE FINAL — TEST DE SOLAPE');
    console.log('═'.repeat(70));
    
    const wins = tradeResults.filter(r => r.isWin).length;
    const losses = tradeResults.filter(r => !r.isWin).length;
    const totalPnL = tradeResults.reduce((s, r) => s + r.profit, 0);
    const solapCount = tradeResults.filter(r => r.solapDetected).length;
    const exitMatchCount = tradeResults.filter(r => r.exitMatchesTrigger).length;
    const avgLatency = tradeResults.reduce((s, r) => s + r.latencyMs, 0) / tradeResults.length;
    
    console.log(`\n📊 ESTADÍSTICAS GENERALES:`);
    console.log(`   Trades: ${tradeResults.length}`);
    console.log(`   Wins: ${wins} | Losses: ${losses} | Win Rate: ${((wins/tradeResults.length)*100).toFixed(1)}%`);
    console.log(`   PnL Total: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`);
    console.log(`   Latencia Promedio: ${avgLatency.toFixed(0)}ms`);
    
    console.log(`\n🎯 DIAGNÓSTICO DE SOLAPE:`);
    console.log(`   Solapes detectados (epoch match):  ${solapCount}/${tradeResults.length}`);
    console.log(`   Exit dígito = Trigger dígito:       ${exitMatchCount}/${tradeResults.length}`);
    
    if (solapCount > tradeResults.length * 0.5) {
        console.log(`\n   🟢 ¡EL SOLAPE FUNCIONA! El contrato se resuelve en el mismo tick.`);
        console.log(`   → La estrategia es VIABLE a largo plazo.`);
    } else if (solapCount > 0) {
        console.log(`\n   🟡 SOLAPE PARCIAL: Funciona ${solapCount} de ${tradeResults.length} veces.`);
        console.log(`   → Podrías tener ventaja, pero no es 100% seguro.`);
    } else {
        console.log(`\n   🔴 SIN SOLAPE: El contrato SIEMPRE se resuelve en el tick siguiente.`);
        console.log(`   → Deriv NO permite el overlap. Necesitas otra estrategia.`);
    }
    
    console.log(`\n📋 DETALLE POR TRADE:`);
    console.log(`   ┌─────┬────────┬─────────┬───────────┬──────────┬────────┬──────────┐`);
    console.log(`   │  #  │ Trigger│ Barrera │ Exit Digit│ Resultado│Latencia│ Solape?  │`);
    console.log(`   ├─────┼────────┼─────────┼───────────┼──────────┼────────┼──────────┤`);
    
    tradeResults.forEach(r => {
        const win = r.isWin ? '  WIN ✅' : ' LOSS ❌';
        const sol = r.solapDetected ? '  SÍ 🎯' : '  NO   ';
        console.log(`   │ ${String(r.num).padStart(3)} │   ${r.triggerDigit}    │  NO-${r.barrier}   │     ${r.exitDigit}     │${win} │ ${String(r.latencyMs).padStart(4)}ms │${sol}  │`);
    });
    
    console.log(`   └─────┴────────┴─────────┴───────────┴──────────┴────────┴──────────┘`);
    console.log('');
}

connect();
