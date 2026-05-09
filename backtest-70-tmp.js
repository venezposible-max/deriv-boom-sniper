
const WebSocket = require('ws');

const APP_ID = '36544';
const SYMBOL = 'R_100';
const STAKE = 10;
const TP = 500;
const SL = 2000;
const THRESHOLD = 70;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🌌 Backtest SINGULARIDAD (70-Ticks) | Últimas 2 Horas...`);
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        count: 7200, 
        end: 'latest',
        style: 'ticks'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        const digits = prices.map(p => parseInt(String(p.toFixed(2)).slice(-1)));
        runSingularityBacktest(digits);
        ws.terminate();
    }
});

function runSingularityBacktest(ticks) {
    let balance = 0, wins = 0, losses = 0, totalTrades = 0, maxRecovery = 0;
    let lastAppearance = Array(10).fill(0), recoveryLayer = 0, targetDigit = null;

    for (let i = 0; i < ticks.length; i++) {
        if (balance >= TP || balance <= -SL) break;
        const digit = ticks[i];
        for (let d = 0; d <= 9; d++) { d === digit ? lastAppearance[d] = 0 : lastAppearance[d]++; }

        if (recoveryLayer === 0) {
            let coldest = -1, maxTension = -1;
            for (let d = 0; d <= 9; d++) { if (lastAppearance[d] > maxTension) { maxTension = lastAppearance[d]; coldest = d; } }

            if (maxTension > THRESHOLD) {
                targetDigit = coldest; totalTrades++;
                const nextDigit = ticks[i+1]; if (nextDigit === undefined) break;
                if (nextDigit === targetDigit) { balance += STAKE * 8.2; wins++; recoveryLayer = 0; }
                else { balance -= STAKE; losses++; recoveryLayer = 1; }
                i++;
            }
        } else {
            totalTrades++;
            const nextDigit = ticks[i+1]; if (nextDigit === undefined) break;
            let currentStake = STAKE * (recoveryLayer === 1 ? 1.5 : recoveryLayer === 2 ? 4 : 12);
            maxRecovery = Math.max(maxRecovery, recoveryLayer);
            if (nextDigit === targetDigit) { balance += currentStake * 8.2; wins++; recoveryLayer = 0; }
            else { balance -= currentStake; losses++; recoveryLayer++; if (recoveryLayer > 6) recoveryLayer = 0; }
            i++; 
        }
    }
    console.log(`\n--- RESULTADO (70-TICKS / 2 HORAS) ---`);
    console.log(`💰 PnL Final: $${balance.toFixed(2)}`);
    console.log(`📈 Trades Totales: ${totalTrades}`);
    console.log(`✅ Ganados: ${wins} | ❌ Fallidos: ${losses}`);
    console.log(`🛡️ Capa Máxima: ${maxRecovery}`);
}
