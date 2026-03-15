
const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TOKEN = process.env.DERIV_TOKEN || 'TSuD37g6G593Uis';

console.log(`🔍 Probando conexión para ${SYMBOL}...`);
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log('✅ Socket abierto. Autorizando...');
    ws.send(JSON.stringify({ authorize: TOKEN }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.error) {
        console.error('❌ Error de Deriv:', msg.error.message);
        process.exit(1);
    }

    if (msg.msg_type === 'authorize') {
        console.log(`✅ Autorizado como: ${msg.authorize.fullname} | Saldo: ${msg.authorize.balance}`);
        console.log(`📡 Suscribiendo a ticks de ${SYMBOL}...`);
        ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
    }

    if (msg.msg_type === 'tick') {
        console.log(`📈 TICK RECIBIDO: ${msg.tick.symbol} -> ${msg.tick.quote}`);
        ws.close();
        process.exit(0);
    }
});

setTimeout(() => {
    console.log('⏰ Timeout: No se recibió ningún tick en 10 segundos.');
    ws.close();
    process.exit(1);
}, 10000);
