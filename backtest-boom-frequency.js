const WebSocket = require('ws');

const SYMBOL = 'BOOM1000';
const CONFIG = {
    stake: 20,
    takeProfit: 50.00,
    stopLoss: 1.00,
    multiplier: 200,
    timeStopTicks: 15,
    cooldownSecondsWin: 45,
    cooldownSecondsLoss: 3,
    useTickFrequency: true
};

let prices_all = [];
let times_all = [];

function buildM1Candles(times, prices) {
    let candles = [];
    let currentMinute = -1;
    let currentClose = 0;

    for (let i = 0; i < times.length; i++) {
        const time = times[i];
        const price = prices[i];
        let minuteExact = Math.floor(time / 60) * 60; 

        if (minuteExact !== currentMinute) {
            if (currentMinute !== -1) candles.push(currentClose);
            currentMinute = minuteExact;
        }
        currentClose = price;
    }
    candles.push(currentClose);
    return candles;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    
    let startIndex = prices.length - 60;
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
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
ws.on('open', () => {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, count: 5000, end: 'latest', style: 'ticks' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if(msg.msg_type === 'history') {
        prices_all = msg.history.prices;
        times_all = msg.history.times;
        runBacktest();
        ws.close();
    }
});

function runBacktest() {
    let state = {
        inTrade: false,
        openPrice: 0,
        openTime: 0,
        cooldownExpiryTime: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        trades: []
    };

    console.log(`\n============ SIMULADOR FRECUENCIA SÍSMICA BOOM 1000 ============`);
    console.log(`⏱️ Base del estudio: ${prices_all.length} Ticks.`);
    console.log(`⚙️ Arquitectura: RSI <= 25 + Detector de SILENCIO (>2.5s)`);
    console.log(`===============================================================\n`);

    let startEvalIndex = 4000; 

    for(let i = startEvalIndex; i < prices_all.length; i++) {
        const quote = prices_all[i];
        const currentTime = times_all[i];
        const previousTime = times_all[i-1];

        if (state.inTrade) {
            const spread = CONFIG.stake * 0.0185; 
            const profit = (((quote - state.openPrice) / state.openPrice) * CONFIG.stake * CONFIG.multiplier) - spread;
            const secondsElapsed = currentTime - state.openTime;

            let closed = false, closeReason = "";

            if (profit >= CONFIG.takeProfit) { closed = true; closeReason = `🎯 TAKE PROFIT (+${Math.floor(profit)}$)`; }
            else if (profit <= -CONFIG.stopLoss) { closed = true; closeReason = `🛡️ STOP LOSS (-${Math.abs(profit).toFixed(2)}$)`; }
            else if (secondsElapsed >= CONFIG.timeStopTicks && profit < 2.00) { closed = true; closeReason = `⏱️ TIME-STOP (-${Math.abs(profit).toFixed(2)}$)`; }
            else if (secondsElapsed >= CONFIG.timeStopTicks && profit >= 0 && profit < 2.00) { closed = true; closeReason = `⏱️ MINI SPIKE (+${profit.toFixed(2)}$)`; }

            if (closed) {
                state.inTrade = false;
                state.pnl += profit;
                if (profit > 0) { state.wins++; state.cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsWin; }
                else { state.losses++; state.cooldownExpiryTime = currentTime + CONFIG.cooldownSecondsLoss; }
                
                state.trades.push({
                    open: new Date(state.openTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' }),
                    close: new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' }),
                    reason: closeReason,
                    profit: profit
                });
                continue;
            }
        }

        if (!state.inTrade && currentTime >= state.cooldownExpiryTime) {
            const currentSubTimes = times_all.slice(i - 4000, i + 1);
            const currentSubPrices = prices_all.slice(i - 4000, i + 1);
            
            const rsi = calculateRSI(buildM1Candles(currentSubTimes, currentSubPrices), 14);

            if (!isNaN(rsi) && rsi >= 0 && rsi <= 25) {
                // AQUÍ ESTÁ EL SECRETO DEL DETECTOR: Medimos si hubo un salto temporal con el tick ANTERIOR.
                const timeDelay = currentTime - previousTime;
                
                // Si el salto fue mayor o igual a 3 segundos de reloj (Ojo, el array de Deriv lo guarda en segundos, 3s = 3 enteros)
                if (timeDelay >= 3 && timeDelay < 6) {
                    console.log(`[ALERTA] Silencio Detectado a las ${new Date(currentTime*1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' })} | Retraso: ${timeDelay}s | RSI: ${rsi.toFixed(1)}`);
                    state.inTrade = true;
                    state.openPrice = quote; // Idealmente el bot real habría entrado apenas pasaron los 2.5s.
                    state.openTime = currentTime;
                }
            }
        }
    }

    console.log(`\n============ RESULTADOS MODO HESITATION ============`);
    console.log(`✔️ Ganados: ${state.wins}  |  ❌ Perdidos: ${state.losses}`);
    console.log(`💰 PnL NETO FINAL: ${(state.pnl >= 0 ? "+" : "")}$${state.pnl.toFixed(2)}`);
    console.log(`\n--- HISTORIAL DE TRADES ---`);
    if(state.trades.length === 0) console.log("No hubieron operaciones (El mercado no se congeló estando en RSI profundo).");
    state.trades.forEach((t, index) => {
        console.log(`[${index+1}] ⏰ ${t.open} a ${t.close} | ${t.reason}`);
    });
    console.log(`====================================================\n`);
}
