const WebSocket = require('ws');

// SIMULACIÓN DE SUPERVIVENCIA - CUENTA $100
const SYMBOL = 'frxXAUUSD';
const INITIAL_BALANCE = 100;
const STAKE = 50; // El 50% de la cuenta por tiro
const MULTIPLIER = 200;
const TP_MOVE = 1.00;
const SL_MOVE = 0.50;
const EMA_PERIOD = 20;

const APP_ID = 1089;
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔥 Iniciando Test de Supervivencia: Cuenta $100 | Stake $50...`);
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 500, // Un poco más de 24h para ver la estabilidad
        style: 'candles',
        granularity: 300
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        runBurnTest(msg.candles);
        ws.close();
    }
});

function runBurnTest(candles) {
    let balance = INITIAL_BALANCE;
    let minBalance = INITIAL_BALANCE;
    let wins = 0;
    let losses = 0;
    let activeTrade = null;
    let burned = false;
    let burnedAt = "";

    for (let i = EMA_PERIOD; i < candles.length; i++) {
        if (balance <= 0) {
            burned = true;
            break;
        }

        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);
        const rsi = calculateRSI(closes, 14);
        const ema = calculateEMA(closes, 20);
        const currentPrice = closes[closes.length - 1];

        if (!activeTrade) {
            if (rsi >= 70 && currentPrice > ema) {
                activeTrade = { type: 'SELL', entry: currentPrice };
            } else if (rsi <= 30 && currentPrice < ema) {
                activeTrade = { type: 'BUY', entry: currentPrice };
            }
        } else {
            const diff = currentPrice - activeTrade.entry;
            let profit = 0;

            if (activeTrade.type === 'BUY') {
                if (diff >= TP_MOVE) profit = (TP_MOVE / activeTrade.entry) * STAKE * MULTIPLIER;
                else if (diff <= -SL_MOVE) profit = -((SL_MOVE / activeTrade.entry) * STAKE * MULTIPLIER);
            } else {
                if (-diff >= TP_MOVE) profit = (TP_MOVE / activeTrade.entry) * STAKE * MULTIPLIER;
                else if (-diff <= -SL_MOVE) profit = -((SL_MOVE / activeTrade.entry) * STAKE * MULTIPLIER);
            }

            if (profit !== 0) {
                balance += profit;
                if (balance < minBalance) minBalance = balance;
                if (profit > 0) wins++; else losses++;
                activeTrade = null;

                if (balance <= 0) {
                    burned = true;
                    burnedAt = new Date(candles[i].epoch * 1000).toLocaleString('es-VE');
                    break;
                }
            }
        }
    }

    console.log("\n========================================");
    console.log("🔥 RESULTADO TEST DE QUEMA (STAKE 50%)");
    console.log("========================================");
    console.log(`Estatus Final: ${burned ? '💀 CUENTA QUEMADA' : '✅ SOBREVIVIÓ'}`);
    if (burned) console.log(`Momento de la quema: ${burnedAt}`);
    console.log(`Saldo Final: $${balance.toFixed(2)}`);
    console.log(`Saldo más bajo alcanzado: $${minBalance.toFixed(2)}`);
    console.log("----------------------------------------");
    console.log(`Ganados: ${wins} | Perdidos: ${losses}`);
    console.log("========================================\n");
}

function calculateRSI(prices, period) {
    let avgGain = 0, avgLoss = 0;
    const slice = prices.slice(-period - 1);
    for (let i = 1; i < slice.length; i++) {
        let diff = slice[i] - slice[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}
