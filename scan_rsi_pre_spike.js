const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({ ticks_history: 'BOOM1000', count: 5000, end: 'latest', style: 'ticks' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        const times = msg.history.times;

        function calculateRSI(p, period = 14) {
            if (p.length < period + 1) return 50;
            let g = 0, l = 0;
            for (let i = 1; i <= period; i++) {
                let d = p[i] - p[i - 1];
                if (d > 0) g += d; else l += Math.abs(d);
            }
            let ag = g / period, al = l / period;
            for (let i = period + 1; i < p.length; i++) {
                let d = p[i] - p[i - 1];
                ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
                al = (al * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
            }
            return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
        }

        function t2m(tm, pr) {
            let c = [], cm = -1, lp = 0;
            for (let i = 0; i < tm.length; i++) {
                let m = Math.floor(tm[i] / 60) * 60;
                if (m !== cm) { if (cm !== -1) c.push(lp); cm = m; }
                lp = pr[i];
            }
            c.push(lp); return c;
        }

        console.log("\n--- ESCANEO DE RSI PRE-SPIKE (11:20-11:25) ---");
        for (let i = 10; i < prices.length; i++) {
            let timeStr = new Date(times[i] * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
            if (timeStr.includes("12:25:") || timeStr.includes("12:24:")) {
                if (i % 10 === 0) { // Un log cada 10 ticks
                    let candles = t2m(times.slice(i - 2000, i + 1), prices.slice(i - 2000, i + 1));
                    let val = calculateRSI(candles);
                    console.log(`Hora: ${timeStr} | RSI M1: ${val.toFixed(2)} | Precio: ${prices[i].toFixed(2)}`);
                }
            }
        }
        process.exit(0);
    }
});
