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

async function main() {
    console.log('═'.repeat(60));
    console.log(`📉 BACKTESTING: OVER/UNDER (Rebote Estádístico)`);
    console.log(`Símbolo: ${SYMBOL} | Periodo: Últimas ~3 horas (5000 ticks)`);
    console.log('═'.repeat(60));

    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    await new Promise(r => ws.on('open', r));

    console.log('\n📡 Descargando historial directamente de los servidores de Deriv...');
    const req = { ticks_history: SYMBOL, count: 5000, end: 'latest', style: 'ticks' };
    const histResp = await query(ws, req, 'history');
    const prices = histResp.history.prices;
    const digits = prices.map(p => parseInt(parseFloat(p).toFixed(3).slice(-1)));
    console.log(`✅ ¡Éxito! ${digits.length} ticks descargados.\n`);

    ws.close();

    const PAYOUT = 0.95; // 95% de ganancia en cada $1
    const MARTINGALE_MULTI = 2.11; // 1 -> 2.11 -> 4.45

    const strategies = [
        { name: 'Rebote Rápido (3 Altos/Bajos)', streakReq: 3 },
        { name: 'Rebote Seguro (4 Altos/Bajos)', streakReq: 4 },
        { name: 'Rebote Extremo (5 Altos/Bajos)', streakReq: 5 },
    ];

    for (const st of strategies) {
        console.log(`\n▶️ ESTRATEGIA: ${st.name}`);
        
        // Resultados Flat ($1 fijo)
        let wins = 0, losses = 0;
        let pnlFlat = 0;
        
        // Resultados Martingala Limitada (Máx 3 intentos)
        let pnlMart = 0;
        let currentStake = 1.0;
        let martWins = 0, martLosses = 0, martBusts = 0; // Busts = perder el tier 3

        let cooldown = 0; // Esperar para la siguiente operación

        for (let i = st.streakReq; i < digits.length - 1; i++) {
            if (cooldown > 0) { cooldown--; continue; }

            const window = digits.slice(i - st.streakReq, i);
            
            // Evaluar tendencia bajista oculta
            const isAllHigh = window.every(d => d > 5); // 6,7,8,9
            const isAllLow = window.every(d => d < 4);  // 0,1,2,3

            let betUnder = null;
            if (isAllHigh) betUnder = true; // Si salieron puros altos, apostar UNDER (0-4)
            else if (isAllLow) betUnder = false; // Si salieron puros bajos, apostar OVER (5-9)

            if (betUnder !== null) {
                const nextDigit = digits[i + 1];
                let isWin = false;
                
                if (betUnder && nextDigit < 5) isWin = true;       // Ganó UNDER
                else if (!betUnder && nextDigit > 4) isWin = true; // Ganó OVER
                
                // Mates Flat Stake
                if (isWin) {
                    wins++;
                    pnlFlat += PAYOUT;
                } else {
                    losses++;
                    pnlFlat -= 1.0;
                }

                // Mates Martingala
                if (isWin) {
                    martWins++;
                    pnlMart += (currentStake * PAYOUT);
                    currentStake = 1.0; // Reset
                } else {
                    martLosses++;
                    pnlMart -= currentStake;
                    currentStake *= MARTINGALE_MULTI;
                    
                    // Si ha crecido mucho (3 intentos fallidos), resetear y tragar pérdida dura
                    if (currentStake > 5.0) { 
                        martBusts++;
                        currentStake = 1.0; 
                    }
                }
                
                cooldown = 1; // Un pequeño cooldown para no operar ticks simultáneos
            }
        }

        const totalFlat = wins + losses;
        const wr = totalFlat > 0 ? ((wins / totalFlat) * 100).toFixed(1) : '0.0';
        
        console.log(`   🔸 Trades Encontrados: ${totalFlat}`);
        console.log(`   🔸 Win Rate Base:      ${wr}% (Necesitas 51.3% para punto de equilibrio)`);
        console.log(`   💵 PnL sin Martingala: ${pnlFlat >= 0 ? '+' : ''}$${pnlFlat.toFixed(2)} USD`);
        console.log(`   💵 PnL Martingala x2:  ${pnlMart >= 0 ? '+' : ''}$${pnlMart.toFixed(2)} USD (Rachas críticas perdidas: ${martBusts})`);
    }
    console.log('\n═'.repeat(60));
}

main().catch(console.error);
