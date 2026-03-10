const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({ ticks_history: 'BOOM1000', count: 1000, end: 'latest', style: 'ticks' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        const times = msg.history.times;

        console.log("\n--- ANALIZANDO ÚLTIMOS 1000 TICKS (MOMENTO DEL SPIKE) ---");

        let maxJump = 0;
        let jumpTime = 0;
        let jumpStartIndex = 0;

        for (let i = 1; i < prices.length; i++) {
            let diff = prices[i] - prices[i - 1];
            if (diff > 5) { // Un salto de más de 5 puntos es un Spike
                if (diff > maxJump) {
                    maxJump = diff;
                    jumpTime = times[i];
                    jumpStartIndex = i - 1;
                }
            }
        }

        if (maxJump > 0) {
            console.log(`🚀 ¡SPIKE DETECTADO!`);
            console.log(`Hora exacta: ${new Date(jumpTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' })}`);
            console.log(`Tamaño del salto: +${maxJump.toFixed(2)} puntos`);
            console.log(`Precio antes: ${prices[jumpStartIndex].toFixed(2)} -> Precio después: ${prices[jumpStartIndex + 1].toFixed(2)}`);

            // Ver qué pasaba 1 minuto antes del Spike
            console.log("\n--- CONDICIONES PRE-SPIKE (1 minuto antes) ---");
            const preIndex = jumpStartIndex - 60 > 0 ? jumpStartIndex - 60 : 0;
            const subPrices = prices.slice(preIndex - 2000 > 0 ? preIndex - 2000 : 0, preIndex);
            // Simular RSI (Necesitamos velas)
            // Para simplificar, veamos solo el tiempo transcurrido
            const preSpikeTime = times[jumpStartIndex];
            console.log(`Tiempo pre-spike: ${new Date(preSpikeTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' })}`);
        } else {
            console.log("No detecté ningún salto mayor a 5 puntos en los últimos 1000 ticks.");
            console.log(`Último precio registrado: ${prices[prices.length - 1]} a las ${new Date(times[times.length - 1] * 1000).toLocaleTimeString()}`);
        }
        process.exit(0);
    }
});
