const WebSocket = require('ws');
let ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
ws.on('open', () => ws.send(JSON.stringify({ ticks_history: 'R_100', end: 'latest', count: 5000, style: 'ticks' })));
ws.on('message', data => {
    let msg = JSON.parse(data);
    if(msg.history) {
        let p = msg.history.prices;
        let minB = 1000, maxB = 0, sumB = 0;
        for(let i=20; i<p.length; i++) {
            let slice = p.slice(i-20, i);
            let sma = slice.reduce((a,b)=>a+b,0)/20;
            let varc = slice.reduce((a,b)=>a+Math.pow(b-sma,2),0)/20;
            let std = Math.sqrt(varc);
            let up = sma + (std*2.5), low = sma - (std*2.5);
            let bPct = ((up-low)/sma)*100;
            if(bPct < minB) minB = bPct;
            if(bPct > maxB) maxB = bPct;
            sumB += bPct;
        }
        console.log(`Min: ${minB.toFixed(4)}%, Max: ${maxB.toFixed(4)}%, Avg: ${(sumB/(p.length-20)).toFixed(4)}%`);
        process.exit(0);
    }
});
