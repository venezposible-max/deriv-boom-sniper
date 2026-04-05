import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';

function query(ws, req, expectedType) {
    return new Promise((resolve) => {
        const handler = (raw) => {
            const msg = JSON.parse(raw);
            if (msg.error) {
                console.error("❌ Deriv Error:", msg.error.message);
                ws.removeListener('message', handler);
                resolve(msg);
            }
            if (msg.msg_type === expectedType) {
                ws.removeListener('message', handler);
                resolve(msg);
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify(req));
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('═'.repeat(60));
    console.log(`📉 BACKTESTING GIGANTE: SHADOW TRADING (24 HORAS)`);
    console.log(`Símbolo: ${SYMBOL} | Periodo: ~45,000 ticks`);
    console.log('═'.repeat(60));

    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    await new Promise(r => ws.on('open', r));

    let allDigits = [];
    let allPrices = [];
    let endEpoch = 'latest';
    const PAGES = 9; 
    
    console.log(`\n📡 Conectando a Deriv... Descargando ${PAGES} bloques de historia (max 5000/req).\n`);

    for (let p = 1; p <= PAGES; p++) {
        const req = { 
            ticks_history: SYMBOL, 
            count: 5000, 
            end: endEpoch,
            style: 'ticks' 
        };
        const histResp = await query(ws, req, 'history');
        if (histResp.error) {
            console.log("   ❌ Abortando por error del servidor.");
            break;
        }

        const times = histResp.history.times;
        const prices = histResp.history.prices;

        const digits = prices.map(price => parseInt(parseFloat(price).toFixed(3).slice(-1)));
        const numPrices = prices.map(p => parseFloat(p));
        
        allDigits = digits.concat(allDigits);
        allPrices = numPrices.concat(allPrices);

        endEpoch = String(times[0] - 1); 
        await delay(1000);
    }

    ws.close();
    console.log(`✅ ¡Descarga completada! Total analizado: ${allDigits.length} ticks.\n`);

    // ==========================================
    // SIMULACIÓN EXACTA DEL MOTOR SHADOW TRADING
    // ==========================================
    let balance = 0;
    
    let diffWins = 0, diffLosses = 0;
    let recovWins = 0, recovLosses = 0;
    
    let virtualLossStreak = 0;
    let recoveryActive = false;
    
    let activeVirtualContract = null; // { barrier }
    let activeRealContract = null;    // { type, barrier, stake }

    let totalDisparosFantasma = 0;
    let totalPerdidasFantasma = 0; // Fantasmas que efectivamente perdieron

    for (let i = 26; i < allDigits.length; i++) {
        const tickDigit = allDigits[i];
        const tickPrice = allPrices[i];
        const prevPrice = allPrices[i - 1];
        
        // Historial hasta este tick (los últimos 26 ticks para el trigger Fantasma)
        const hist = allDigits.slice(i - 25, i + 1);

        // 1. RESOLVER TRADE FANTASMA PENDIENTE
        if (activeVirtualContract && !recoveryActive) {
            const isLoss = (tickDigit === activeVirtualContract.barrier);
            if (isLoss) {
                virtualLossStreak++;
                totalPerdidasFantasma++;
            } else {
                virtualLossStreak = 0;
            }
            activeVirtualContract = null;
        }

        // 2. RESOLVER TRADE REAL PENDIENTE
        // Nota: En la vida real, los contratos tardan 1 o 2 ticks en cerrar.
        // Aquí simulamos que cierra al 1er tick siguiente para simplificar la cuenta estadística.
        if (activeRealContract) {
            if (activeRealContract.type === 'DIGITDIFF') {
                const isWin = (tickDigit !== activeRealContract.barrier);
                if (isWin) {
                    balance += 0.09; // Pago de 9% sobre $1
                    diffWins++;
                    virtualLossStreak = 0;
                } else {
                    balance -= 1.0;
                    diffLosses++;
                    recoveryActive = true; // Activa el Escudo Rescate Over/Under
                }
            } 
            else if (activeRealContract.type === 'DIGITUNDER') {
                const isWin = (tickDigit < 5);
                if (isWin) {
                    balance += (2.10 * 0.95); // Recuperamos la pérdida de Diferir ($1) + Ganancia pequeña
                    recovWins++;
                    recoveryActive = false;
                } else {
                    balance -= 2.10; // Perdimos el Rescate
                    recovLosses++;
                    recoveryActive = false; // "One-Shot", volvemos a intentar Fantasmas de 0
                }
            }
            else if (activeRealContract.type === 'DIGITOVER') {
                const isWin = (tickDigit > 4);
                if (isWin) {
                    balance += (2.10 * 0.95);
                    recovWins++;
                    recoveryActive = false;
                } else {
                    balance -= 2.10;
                    recovLosses++;
                    recoveryActive = false;
                }
            }
            activeRealContract = null;
            continue; // Si acaba de cerrar un trade, descansa 1 tick al menos (Cooldown)
        }

        // 3. BUSCAR GATILLOS
        if (!activeRealContract && !activeVirtualContract) {
            const last1 = hist[hist.length - 1];
            const last2 = hist[hist.length - 2];
            const last3 = hist[hist.length - 3];
            const last4 = hist[hist.length - 4];
            const last5 = hist[hist.length - 5];

            // MODO RESCATE: Busca la rareza de 5 extremos
            if (recoveryActive) {
                const isAllHigh = last1 > 5 && last2 > 5 && last3 > 5 && last4 > 5 && last5 > 5;
                const isAllLow = last1 < 4 && last2 < 4 && last3 < 4 && last4 < 4 && last5 < 4;

                if (isAllHigh) {
                    activeRealContract = { type: 'DIGITUNDER', barrier: 5, stake: 2.10 };
                } else if (isAllLow) {
                    activeRealContract = { type: 'DIGITOVER', barrier: 4, stake: 2.10 };
                }
            } 
            // MODO RECOLECTOR DIFFERS: Busca Gatillos Operativos
            else {
                let targetBarrier = null;
                const priceJump = Math.abs(tickPrice - prevPrice);

                if (last1 === last2) targetBarrier = last1; // SOMBRA
                else if (priceJump > 1.2) targetBarrier = last1; // SPIKE
                else if (!hist.slice(0, 25).includes(last1)) targetBarrier = last1; // FANTASMA

                if (targetBarrier !== null) {
                    // Si no hemos purgado la mala suerte simulando...
                    if (virtualLossStreak < 1) {
                        activeVirtualContract = { barrier: targetBarrier };
                        totalDisparosFantasma++;
                    } 
                    // Si YA purgramos la mala suerte, MANDA BALA REAL
                    else {
                        activeRealContract = { type: 'DIGITDIFF', barrier: targetBarrier, stake: 1.0 };
                        virtualLossStreak = 0; 
                    }
                }
            }
        }
    }

    const totalDiffTrades = diffWins + diffLosses;
    const diffWR = totalDiffTrades > 0 ? ((diffWins / totalDiffTrades) * 100).toFixed(1) : '0.0';
    const totalRecovTrades = recovWins + recovLosses;
    const recovWR = totalRecovTrades > 0 ? ((recovWins / totalRecovTrades) * 100).toFixed(1) : '0.0';

    console.log(`▶️ MODO FANTASMA (Shadow Trading)`);
    console.log(`   🔸 Tiros de prueba Fantasma  : ${totalDisparosFantasma}`);
    console.log(`   🔸 Bajas simuladas (Evitadas): ${totalPerdidasFantasma} trades perdidos que te ahorraste.`);
    console.log(`\n▶️ MODO REAL (DIFFERS Operativo)`);
    console.log(`   🔸 Total Operaciones Reales  : ${totalDiffTrades}`);
    console.log(`   🔸 Victorias DIFFERS         : ${diffWins}`);
    console.log(`   🔸 Derrotas DIFFERS          : ${diffLosses}`);
    console.log(`   🔸 Win Rate en Dinero Real   : ${diffWR}% (Al ser > 91.7% ya es ganancia neta)`);
    console.log(`\n▶️ MODO RESCATE (Over/Under Rebote 5x)`);
    console.log(`   🔸 Rescates Ejecutados       : ${totalRecovTrades}`);
    console.log(`   🔸 Rescates Exitosos         : ${recovWins}`);
    console.log(`   🔸 Rescates Fallidos         : ${recovLosses}`);
    console.log(`   🔸 Win Rate de Rescate       : ${recovWR}%`);
    console.log(`\n==============================================`);
    console.log(`💵 BALANCE FINAL (24h):  ${balance >= 0 ? '+' : ''}$${balance.toFixed(2)} USD`);
    console.log(`==============================================\n`);
}

main().catch(console.error);
