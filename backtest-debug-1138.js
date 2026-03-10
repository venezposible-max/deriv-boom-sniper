const fs = require('fs');

const BOOM_SYMBOL = "BOOM1000";
const STAKE = 20;
const MULTIPLIER = 200;
const TP = 50;
const SL = 1.0;
const TIME_STOP_SECS = 15;
const COOLDOWN_WIN = 45;
const COOLDOWN_LOSS = 3;

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff; else losses += Math.abs(diff);
    }
    let avgG = gains / period, avgL = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        avgG = (avgG * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgL = (avgL * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    }
    return avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
}

function ticksToM1(times, prices) {
    let candles = [], currM = -1, lastP = 0;
    for (let i = 0; i < times.length; i++) {
        let m = Math.floor(times[i] / 60) * 60;
        if (m !== currM) { if (currM !== -1) candles.push(lastP); currM = m; }
        lastP = prices[i];
    }
    candles.push(lastP);
    return candles;
}

const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    console.log("Extrayendo historial...");
    ws.send(JSON.stringify({ ticks_history: BOOM_SYMBOL, count: 5000, end: 'latest', style: 'ticks' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        run(msg.history.times, msg.history.prices);
        ws.close();
    }
});

function run(times, prices) {
    let state = { inT: false, op: 0, ot: 0, cd: 0, wins: 0, loss: 0, pnl: 0, log: [] };
    for (let i = 3000; i < prices.length; i++) {
        let p = prices[i], t = times[i];
        if (state.inT) {
            let prof = (((p - state.op) / state.op) * STAKE * MULTIPLIER) - (STAKE * 0.0185);
            let dur = t - state.ot, closed = false, r = "";
            if (prof >= TP) { closed = true; r = "WIN"; }
            else if (prof <= -SL) { closed = true; r = "SL"; }
            else if (dur >= TIME_STOP_SECS && prof < 2) { closed = true; r = "TS"; }
            if (closed) {
                state.inT = false; state.pnl += prof;
                if (prof > 0) { state.wins++; state.cd = t + COOLDOWN_WIN; }
                else { state.loss++; state.cd = t + COOLDOWN_LOSS; }
                state.log.push({ t, r, prof });
            }
        } else if (t >= state.cd) {
            let rsi = calculateRSI(ticksToM1(times.slice(i - 3000, i + 1), prices.slice(i - 3000, i + 1)));
            if (rsi <= 25) { state.inT = true; state.op = p; state.ot = t; }
        }
    }
    console.log(`\n RESULTADOS SNIPER (Data Real):\n Win: ${state.wins} | Loss: ${state.loss} | Net: $${state.pnl.toFixed(2)}`);
    // Debug 11:38
    state.log.forEach(l => {
        let h = new Date(l.t * 1000).toLocaleTimeString();
        if (h.includes("11:38")) console.log(`Debug ${h}: ${l.r} pnl=${l.prof.toFixed(2)}`);
    });
}
