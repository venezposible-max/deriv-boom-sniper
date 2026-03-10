const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: 'BOOM1000',
        count: 500, // Aprox últimes 5-8 minutos
        end: 'latest',
        style: 'ticks'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        const times = msg.history.times;

        let spikes = [];
        for (let i = 1; i < prices.length; i++) {
            let diff = prices[i] - prices[i - 1];
            // En Boom 1000, un spike es una subida abrupta (normalmente más de 5 o 10 puntos, a veces 30+)
            if (diff > 5) {
                spikes.push({
                    time: new Date(times[i] * 1000).toLocaleString('es-VE', { timeZone: 'America/Caracas' }), // Mismo huso horario del usuario
                    diff: `+${diff.toFixed(2)} pts`,
                    priceFrom: prices[i - 1],
                    priceTo: prices[i]
                });
            }
        }

        console.log("============ RADAR DE SPIKES ============");
        console.log("Revisando los últimos 500 Ticks (Aprox 5-8 min):");
        if (spikes.length > 0) {
            console.log("¡SPIKES DETECTADOS! 🔥🔥🔥");
            spikes.forEach(s => {
                console.log(`- Fecha/Hora: ${s.time} | Subida: ${s.diff} | Salto: de ${s.priceFrom} a ${s.priceTo}`);
            });
        } else {
            console.log("Tristeza... 🛑 NO HUBIERON SPIKES en los últimos minutos.");
            console.log("El mercado lleva bajando o en rango sin explotar desde " + new Date(times[0] * 1000).toLocaleString('es-VE', { timeZone: 'America/Caracas' }));
        }
        console.log("=========================================");
        process.exit(0);
    }
});
