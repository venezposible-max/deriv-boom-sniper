/**
 * BACKTEST V100 SNIPER — Deriv API
 * Compara la estrategia actual vs estrategia con filtros mejorados:
 *   - Filtro 1: Distancia mínima de ruptura (0.10%)
 *   - Filtro 2: Ticks consecutivos (4 de últimos 5 en dirección)
 */

const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const GRANULARITY = 300;
const CANDLES_TO_FETCH = 500;

const STAKE = 10;
const TP_USD = 5.0;
const SL_USD = 9.5;
const MULTIPLIER = 200;
const MIN_FORCE = 0.25;

const MIN_BREAKOUT_PCT = 0.0010;
const MIN_CONSECUTIVE = 4;

function findPivots(candles) {
    let lastSH = 0, shIndex = -1;
    for (let i = candles.length - 3; i > 5; i--) {
        const prev = candles[i - 1], cur = candles[i], next = candles[i + 1];
        if (cur.high > prev.high && cur.high > next.high) { lastSH = cur.high; shIndex = i; break; }
    }
    let lastSL = 0;
    if (lastSH > 0 && shIndex > 6) {
        for (let i = shIndex - 1; i > 5; i--) {
            const prev = candles[i - 1], cur = candles[i], next = candles[i + 1];
            if (cur.low < prev.low && cur.low < next.low && cur.low < lastSH) { lastSL = cur.low; break; }
        }
    }
    return { lastSH, lastSL };
}

function calcMomentum(priceBuffer) {
    if (priceBuffer.length < 5) return { momentumUp: 0, momentumDown: 0, trueAcceleration: 0 };
    const n = priceBuffer.length;
    const momentumUp = priceBuffer[n - 1] - priceBuffer[n - 5];
    const momentumDown = priceBuffer[n - 5] - priceBuffer[n - 1];
    const v1 = priceBuffer[n - 1] - priceBuffer[n - 3];
    const v2 = priceBuffer[n - 3] - priceBuffer[n - 5];
    const trueAcceleration = Math.abs(v1) - Math.abs(v2);
    return { momentumUp, momentumDown, trueAcceleration };
}

function simulateTrade(type, entryPrice, futureCandles) {
    const tpPrice = type === 'BUY'
        ? entryPrice * (1 + (TP_USD / (STAKE * MULTIPLIER)))
        : entryPrice * (1 - (TP_USD / (STAKE * MULTIPLIER)));
    const slPrice = type === 'BUY'
        ? entryPrice * (1 - (SL_USD / (STAKE * MULTIPLIER)))
        : entryPrice * (1 + (SL_USD / (STAKE * MULTIPLIER)));

    for (const candle of futureCandles) {
        if (type === 'BUY') {
            if (candle.low <= slPrice) return { result: 'LOSS', pnl: -SL_USD };
            if (candle.high >= tpPrice) return { result: 'WIN', pnl: TP_USD };
        } else {
            if (candle.high >= slPrice) return { result: 'LOSS', pnl: -SL_USD };
            if (candle.low <= tpPrice) return { result: 'WIN', pnl: TP_USD };
        }
    }
    return null;
}

function runBacktest(candles, useFilters) {
    const results = [];
    let lastTradeIdx = -999;
    const cooldownCandles = 12; // 60s / 5min * candle

    for (let i = 35; i < candles.length - 10; i++) {
        if (i - lastTradeIdx < cooldownCandles) continue;

        const history = candles.slice(0, i);
        const { lastSH, lastSL } = findPivots(history);
        if (!lastSH || !lastSL) continue;

        const priceBuffer = candles.slice(Math.max(0, i - 10), i).map(c => c.close);
        const { momentumUp, momentumDown, trueAcceleration } = calcMomentum(priceBuffer);

        const currentPrice = candles[i].close;
        const isBreakUp = currentPrice > lastSH;
        const isBreakDown = currentPrice < lastSL;

        let signal = null;
        if (isBreakUp && momentumUp > MIN_FORCE && trueAcceleration > 0) signal = 'BUY';
        if (isBreakDown && momentumDown > MIN_FORCE && trueAcceleration > 0) signal = 'SELL';
        if (!signal) continue;

        if (useFilters) {
            if (signal === 'BUY') {
                const dist = (currentPrice - lastSH) / lastSH;
                if (dist < MIN_BREAKOUT_PCT) continue;
            } else {
                const dist = (lastSL - currentPrice) / lastSL;
                if (dist < MIN_BREAKOUT_PCT) continue;
            }

            const last5 = candles.slice(Math.max(0, i - 5), i).map(c => c.close);
            let consecOk = 0;
            for (let j = 1; j < last5.length; j++) {
                if (signal === 'BUY' && last5[j] > last5[j - 1]) consecOk++;
                if (signal === 'SELL' && last5[j] < last5[j - 1]) consecOk++;
            }
            if (consecOk < MIN_CONSECUTIVE) continue;
        }

        const futureCandles = candles.slice(i + 1, i + 30);
        const outcome = simulateTrade(signal, currentPrice, futureCandles);
        if (!outcome) continue;

        results.push({ idx: i, signal, entryPrice: currentPrice.toFixed(2), result: outcome.result, pnl: outcome.pnl });
        lastTradeIdx = i;
    }
    return results;
}

function printReport(label, results) {
    if (results.length === 0) {
        console.log(`\n  ${label}: Sin trades suficientes.`);
        return;
    }
    const wins = results.filter(r => r.result === 'WIN').length;
    const losses = results.filter(r => r.result === 'LOSS').length;
    const totalPnl = results.reduce((sum, r) => sum + r.pnl, 0);
    const winRate = ((wins / results.length) * 100).toFixed(1);

    console.log(`\n${'─'.repeat(52)}`);
    console.log(`  ${label}`);
    console.log(`${'─'.repeat(52)}`);
    console.log(`  Total Trades  : ${results.length}`);
    console.log(`  Ganados (WIN) : ${wins}   Perdidos (LOSS): ${losses}`);
    console.log(`  Win Rate      : ${winRate}%`);
    console.log(`  PnL Total     : $${totalPnl.toFixed(2)}`);
    console.log(`  PnL Promedio  : $${(totalPnl / results.length).toFixed(2)} por trade`);
}

console.log(`\n🔌 Conectando a Deriv → ${SYMBOL} | ${CANDLES_TO_FETCH} velas de 5min...`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL, end: 'latest',
        count: CANDLES_TO_FETCH, style: 'candles', granularity: GRANULARITY
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.error) { console.error('Error:', msg.error.message); ws.close(); return; }
    if (msg.msg_type === 'candles') {
        ws.close();
        const candles = msg.candles.map(c => ({
            open: parseFloat(c.open), high: parseFloat(c.high),
            low: parseFloat(c.low), close: parseFloat(c.close)
        }));

        console.log(`✅ ${candles.length} velas cargadas. Ejecutando...\n`);

        const base = runBacktest(candles, false);
        const filtered = runBacktest(candles, true);

        printReport('ESTRATEGIA BASE (Sin filtros)', base);
        printReport('CON FILTROS (Dist. Mín + Consecutivos)', filtered);

        if (base.length > 0 && filtered.length > 0) {
            const bWR = (base.filter(r => r.result === 'WIN').length / base.length) * 100;
            const fWR = (filtered.filter(r => r.result === 'WIN').length / filtered.length) * 100;
            const bPnl = base.reduce((s, r) => s + r.pnl, 0);
            const fPnl = filtered.reduce((s, r) => s + r.pnl, 0);

            console.log(`\n${'═'.repeat(52)}`);
            console.log(`  🎯 RESULTADO DE LOS FILTROS`);
            console.log(`${'═'.repeat(52)}`);
            console.log(`  Win Rate:  ${bWR.toFixed(1)}% → ${fWR.toFixed(1)}%  (${fWR > bWR ? '✅ Mejora' : '❌ Empeora'}: ${(fWR - bWR).toFixed(1)}%)`);
            console.log(`  PnL:       $${bPnl.toFixed(2)} → $${fPnl.toFixed(2)}  (${fPnl > bPnl ? '✅ Mejora' : '❌ Empeora'})`);
            console.log(`  Señales:   ${base.length} → ${filtered.length}  (-${base.length - filtered.length} falsas señales eliminadas)`);
            console.log(`${'═'.repeat(52)}\n`);
        }
    }
});

ws.on('error', e => console.error('WS Error:', e.message));
