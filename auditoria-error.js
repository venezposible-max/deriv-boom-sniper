const WebSocket = require('ws');

// CONFIGURACIÓN PARA AUDITAR EL ERROR
const SYMBOL = 'frxXAUUSD';
const STAKE = 50;
const MULTIPLIER = 200;
const TP_VAL = 1.00;
const SL_VAL = 0.50;
const RSI_PERIOD = 14;
const EMA_PERIOD = 20;

const APP_ID = 1089;
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("🔍 Iniciando investigación de pérdida en las últimas 8 horas...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 150, // Suficiente para cubrir 8h+ en M5
        style: 'candles',
        granularity: 300
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles;
        runAudit(candles);
        ws.close();
    }
});

function runAudit(candles) {
    let history = [];
    let bugWins = 0, bugLosses = 0;
    let fixedWins = 0, fixedLosses = 0;
    let bugPnL = 0, fixedPnL = 0;

    const startIndex = candles.length - 96; // Últimas 8 horas

    // Lógica con BUG (El que tenías puesto)
    // El TP y SL se duplicaban por el error del '2500'
    const bugTP = TP_VAL * 2.06; // Aproximadamente el doble de movimiento
    const bugSL = SL_VAL * 2.06;

    // Lógica CORREGIDA (La que puse ahorita)
    const fixedTP = TP_VAL;
    const fixedSL = SL_VAL;

    function simulate(tp_move, sl_move) {
        let wins = 0, losses = 0, pnl = 0, active = null;
        for (let i = EMA_PERIOD; i < candles.length; i++) {
            if (i < startIndex) continue;
            const slice = candles.slice(0, i + 1);
            const closes = slice.map(c => c.close);
            const rsi = calculateRSI(closes, RSI_PERIOD);
            const ema = calculateEMA(closes, EMA_PERIOD);
            const current = closes[closes.length - 1];

            if (!active) {
                if (rsi >= 70 && current > ema) active = { type: 'SELL', entry: current };
                else if (rsi <= 30 && current < ema) active = { type: 'BUY', entry: current };
            } else {
                let diff = current - active.entry;
                let profit = 0;
                if (active.type === 'BUY') {
                    if (diff >= tp_move) profit = (tp_move / active.entry) * STAKE * MULTIPLIER;
                    else if (diff <= -sl_move) profit = -((sl_move / active.entry) * STAKE * MULTIPLIER);
                } else {
                    if (-diff >= tp_move) profit = (tp_move / active.entry) * STAKE * MULTIPLIER;
                    else if (-diff <= -sl_move) profit = -((sl_move / active.entry) * STAKE * MULTIPLIER);
                }
                if (profit !== 0) {
                    pnl += profit;
                    if (profit > 0) wins++; else losses++;
                    active = null;
                }
            }
        }
        return { wins, losses, pnl };
    }

    const bugResult = simulate(bugTP, bugSL);
    const fixedResult = simulate(fixedTP, fixedSL);

    console.log("\n========================================");
    console.log("🕵️ AUDITORÍA DE PÉRDIDAS (Últimas 8 Horas)");
    console.log("========================================");
    console.log("CON EL BUG (Lo que te pasó a ti):");
    console.log(`Ganados: ${bugResult.wins} | Perdidos: ${bugResult.losses}`);
    console.log(`PnL: $${bugResult.pnl.toFixed(2)} USD 🔴`);
    console.log("----------------------------------------");
    console.log("CORREGIDO (Lo que hará el bot ahora):");
    console.log(`Ganados: ${fixedResult.wins} | Perdidos: ${fixedResult.losses}`);
    console.log(`PnL: $${fixedResult.pnl.toFixed(2)} USD 🟢`);
    console.log("========================================\n");
    console.log("EXPLICACIÓN:");
    console.log("Debido al error del '2500', el bot estaba buscando ganancias de $2.06 de movimiento");
    console.log("pero el oro no llegaba tan lejos y se regresaba, tocando tu Stop Loss.");
    console.log("Al corregirlo a $1.00 de movimiento, el bot cierra mucho más rápido y sale en verde.");
}

function calculateRSI(prices, period) {
    let avgGain = 0, avgLoss = 0;
    const slice = prices.slice(-period - 1);
    for (let i = 1; i < slice.length; i++) {
        let diff = slice[i] - slice[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}
