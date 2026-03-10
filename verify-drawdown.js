const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

const STAKE = 20;
const MULTIPLIER = 200;
const DURATION_TICKS = 70;

ws.on('open', () => {
    ws.send(JSON.stringify({ ticks_history: 'BOOM1000', count: 5000, end: 'latest', style: 'ticks' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        analyzeDrawdown(msg.history.prices);
        ws.close();
    }
});

function analyzeDrawdown(prices) {
    let drawdowns = [];
    const spread_cost = STAKE * 0.0185; // Aproximación del costo de entrada (comisión/spread)

    console.log(`\n--- SIMULADOR DE DESANGRE BOOM 1000 (70 TICKS) ---`);
    console.log(`Stake: $${STAKE} | Multiplier: x${MULTIPLIER} | Ticks: ${DURATION_TICKS}\n`);

    // Probamos 50 puntos de entrada diferentes donde NO haya spikes (para ver el desangre puro)
    let found = 0;
    for (let i = 0; i < prices.length - DURATION_TICKS; i += 50) {
        const startPrice = prices[i];
        const endPrice = prices[i + DURATION_TICKS];

        // Si el precio subió, hubo un spike, lo ignoramos para ver solo la caída
        if (endPrice > startPrice) continue;

        const pnl = (((endPrice - startPrice) / startPrice) * STAKE * MULTIPLIER) - spread_cost;
        drawdowns.push(pnl);
        found++;
    }

    const avg = drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length;
    const min = Math.min(...drawdowns);
    const max = Math.max(...drawdowns);

    console.log(`Muestras analizadas: ${found} periodos de 70 ticks sin spikes.`);
    console.log(`Perdida Promedio: $${avg.toFixed(2)}`);
    console.log(`Perdida Máxima detectada: $${min.toFixed(2)}`);
    console.log(`Costo de entrada (Spread): $${spread_cost.toFixed(2)}`);
    console.log(`--------------------------------------------------`);

    if (Math.abs(min) >= 1.5) {
        console.log(`⚠️ ALERTA: Con un SL de $1.00 o $1.50 serías sacado del mercado prematuramente.`);
    } else {
        console.log(`✅ Con un SL de $2.00 o $2.50 tienes margen de sobra.`);
    }
}
