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
    console.log(`📉 BACKTESTING GIGANTE: ÚLTIMAS 24 HORAS`);
    console.log(`Símbolo: ${SYMBOL} | Periodo: ~45,000 ticks`);
    console.log('═'.repeat(60));

    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    await new Promise(r => ws.on('open', r));

    let allDigits = [];
    let endEpoch = 'latest';
    const PAGES = 9; // 9 páginas * 5000 = 45000 ticks = 25 horas aprox
    
    console.log(`\n📡 Conectando a Deriv... Descargando ${PAGES} bloques de historia (max 5000/req).\n`);

    for (let p = 1; p <= PAGES; p++) {
        // console.log(`[Página ${p}/${PAGES}] Descargando 5000 ticks (End: ${endEpoch})...`);
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

        // history.prices viene en forma cronológica [más viejo, ..., más nuevo (endEpoch)]
        const digits = prices.map(price => parseInt(parseFloat(price).toFixed(3).slice(-1)));
        
        // Agregar al inicio del arreglo total (ya que iteramos hacia el pasado)
        allDigits = digits.concat(allDigits);

        // El próximo bloque debe terminar justo antes del tiempo más viejo de este bloque
        endEpoch = String(times[0] - 1); 

        // Respetar Rate Limits de Deriv (1 seg entre peticiones pesadas)
        await delay(1000);
    }

    ws.close();

    console.log(`✅ ¡Descarga completada! Total analizado: ${allDigits.length} ticks.\n`);

    const PAYOUT = 0.95; 
    const MARTINGALE_MULTI = 2.11; 

    // Solo vamos a probar la Estrategia Extrema (5 y 6 repeticiones) para estas 24 horas
    const strategies = [
        { name: 'Rebote Extremo (5 Altos/Bajos) -> MODO ACTUAL', streakReq: 5 },
        { name: 'Rebote Absoluto (6 Altos/Bajos)', streakReq: 6 }
    ];

    for (const st of strategies) {
        console.log(`\n▶️ ESTRATEGIA: ${st.name}`);
        
        let wins = 0, losses = 0;
        let pnlFlat = 0;
        
        let pnlMart = 0;
        let currentStake = 1.0;
        let martWins = 0, martLosses = 0, martBusts = 0; 
        
        let maxDrawdownStreak = 0;
        let currentLosingStreak = 0;
        let cooldown = 0;

        for (let i = st.streakReq; i < allDigits.length - 1; i++) {
            if (cooldown > 0) { cooldown--; continue; }

            const window = allDigits.slice(i - st.streakReq, i);
            const isAllHigh = window.every(d => d > 5); // 6,7,8,9
            const isAllLow = window.every(d => d < 4);  // 0,1,2,3

            let betUnder = null;
            if (isAllHigh) betUnder = true; 
            else if (isAllLow) betUnder = false; 

            if (betUnder !== null) {
                const nextDigit = allDigits[i + 1];
                let isWin = false;
                
                if (betUnder && nextDigit < 5) isWin = true;       
                else if (!betUnder && nextDigit > 4) isWin = true; 
                
                // === ESTRATEGIA LINEAL ($1 FIJO) ===
                if (isWin) {
                    wins++;
                    pnlFlat += PAYOUT;
                    currentLosingStreak = 0;
                } else {
                    losses++;
                    pnlFlat -= 1.0;
                    currentLosingStreak++;
                    if (currentLosingStreak > maxDrawdownStreak) maxDrawdownStreak = currentLosingStreak;
                }

                // === ESTRATEGIA MARTINGALA (x2.11 MÁXIMO 3 INTENTOS) ===
                if (isWin) {
                    martWins++;
                    pnlMart += (currentStake * PAYOUT);
                    currentStake = 1.0; // Reset
                } else {
                    martLosses++;
                    pnlMart -= currentStake;
                    currentStake *= MARTINGALE_MULTI;
                    
                    // Si pierde 3 intentos seguidos (1.0 -> 2.11 -> 4.45 => Pérdida total -$7.56)
                    // Resetear para proteger capital global.
                    if (currentStake > 5.0) { 
                        martBusts++;
                        currentStake = 1.0; 
                    }
                }
                
                // Evitamos operaciones dobles si el mismo tick dispara dos veces, damos 1 pausa
                cooldown = 1; 
            }
        }

        const totalFlat = wins + losses;
        const wr = totalFlat > 0 ? ((wins / totalFlat) * 100).toFixed(1) : '0.0';
        
        console.log(`   🔸 Total de Disparos:        ${totalFlat} veces en 24h (~${(totalFlat / 24).toFixed(1)} trades por hora)`);
        console.log(`   🔸 WIN RATE EXACTO:          ${wr}%`);
        console.log(`   🔸 Peor Racha Perdedora:     ${maxDrawdownStreak} veces seguidas`);
        console.log(`   💵 Dinero Sin Martingala:    ${pnlFlat >= 0 ? '+' : ''}$${pnlFlat.toFixed(2)} USD (Solo apostando $1)`);
        console.log(`   💵 Dinero Con Martingala x2: ${pnlMart >= 0 ? '+' : ''}$${pnlMart.toFixed(2)} USD`);
        console.log(`   ⚠️ Quiebres de Martingala:   ${martBusts} veces (Racha insalvable de 3 trades seguidos perdidos)`);
    }
    console.log('\n═'.repeat(60));
}

main().catch(console.error);
