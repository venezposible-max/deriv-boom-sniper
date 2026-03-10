const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: 'BOOM1000',
        count: 500,
        end: 'latest',
        style: 'ticks'
    }));
});
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if(msg.msg_type === 'history'){
        const prices = msg.history.prices;
        console.log("Prices array length:", prices.length);
        console.log("First 10 prices:", prices.slice(0, 10));
        console.log("Last 10 prices:", prices.slice(-10));
        ws.close();
    }
});
