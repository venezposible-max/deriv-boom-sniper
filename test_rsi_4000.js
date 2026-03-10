const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;

    let startIndex = prices.length - 2000;
    if (startIndex < 1) startIndex = 1;

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = startIndex; i < startIndex + period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff;
        else if (diff < 0) avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = startIndex + period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let currentGain = diff > 0 ? diff : 0;
        let currentLoss = diff < 0 ? Math.abs(diff) : 0;
        
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;
    
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: 'BOOM1000',
        count: 4000,
        end: 'latest',
        style: 'ticks'
    }));
});
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if(msg.msg_type === 'history'){
        const prices = msg.history.prices;
        console.log("Prices length:", prices.length);
        console.log("RSI over prices:", calculateRSI(prices, 14));
        process.exit();
    }
});
