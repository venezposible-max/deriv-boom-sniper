const WebSocket = require('ws');

const APP_ID = 36544; // App ID
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log('Connected to Deriv WebSocket. Starting latency test (10 pings)...');
    
    let count = 0;
    const sendPing = () => {
        if (count >= 10) {
            ws.close();
            return;
        }
        const start = Date.now();
        ws.send(JSON.stringify({ ping: 1, req_id: start }));
        count++;
    };

    sendPing();
    const interval = setInterval(() => {
        if (count >= 10) {
            clearInterval(interval);
            return;
        }
        sendPing();
    }, 1000);
});

ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.msg_type === 'ping') {
        const sendTime = msg.req_id;
        const rtt = Date.now() - sendTime;
        console.log(`Ping #${msg.req_id} - RTT: ${rtt}ms`);
    }
});

ws.on('close', () => {
    console.log('WebSocket closed.');
});
ws.on('error', (err) => {
    console.error('WS Error:', err);
});
