const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

const STAKE = 20;
const MULTIPLIER = 200;
const TP = 50;
const SL = 1.0;
const TIME_STOP_SECS = 15;
const COOLDOWN_WIN = 45;
const COOLDOWN_LOSS = 3;

ws.on('open', () => {
    ws.send(JSON.stringify({ ticks_history: 'BOOM1000', count: 5000, end: 'latest', style: 'ticks' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        run(msg.history.times, msg.history.prices);
        ws.close();
    }
});

function rsi(p, period = 14) {
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

function run(times, prices) {
    let s = { in: false, op: 0, ot: 0, cd: 0, w: 0, l: 0, pnl: 0, history: [] };

    // Analizamos desde el tick 2000 para tener data previa de RSI
    for (let i = 2000; i < prices.length; i++) {
        let p = prices[i], t = times[i];

        if (s.in) {
            let prof = (((p - s.op) / s.op) * STAKE * MULTIPLIER) - (STAKE * 0.0185);
            let dur = t - s.ot;
            let closed = false, r = "";
            if (prof >= TP) { closed = true; r = "WIN"; }
            else if (prof <= -SL) { closed = true; r = "SL"; }
            else if (dur >= TIME_STOP_SECS && prof < 2) { closed = true; r = "TIME-STOP"; }

            if (closed) {
                s.in = false; s.pnl += prof;
                if (prof > 0) { s.w++; s.cd = t + COOLDOWN_WIN; }
                else { s.l++; s.cd = t + COOLDOWN_LOSS; }
                s.history.push({ time: new Date(t * 1000).toLocaleTimeString(), reason: r, pnl: prof });
            }
        } else if (t >= s.cd) {
            let candles = t2m(times.slice(i - 2000, i + 1), prices.slice(i - 2000, i + 1));
            let val = rsi(candles);
            if (val <= 25) { s.in = true; s.op = p; s.ot = t; }
        }
    }

    console.log("\n================ BACKTEST FINAL (12:20 AM) ================");
    console.log(`Balance Inicial: -- | Balance Final Estimado: $${s.pnl.toFixed(2)}`);
    console.log(`Trades: ${s.w + s.l} | Ganados: ${s.w} | Perdidos: ${s.l}`);
    console.log("-----------------------------------------------------------");
    s.history.forEach(h => console.log(`[${h.time}] -> ${h.reason} ($${h.pnl.toFixed(2)})`));
    console.log("===========================================================\n");
}
