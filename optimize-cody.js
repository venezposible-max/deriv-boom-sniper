import WebSocket from 'ws';

const DERIV_WEBSOCKET_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";

function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;
    let gains = [];
    let losses = [];
    for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) { gains.push(diff); losses.push(0); }
        else { gains.push(0); losses.push(-diff); }
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateStdDev(prices, period = 30) {
    const len = prices.length;
    if (len < 2) return 0;
    const n = Math.min(len, period);
    const slice = prices.slice(-n);
    const mean = slice.reduce((a, b) => a + b, 0) / n;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / n;
    return Math.sqrt(variance);
}

function downloadData(symbol) {
    return new Promise((resolve) => {
        const ws = new WebSocket(DERIV_WEBSOCKET_URL);
        ws.on('open', () => {
            console.log(`📡 Descargando historial para ${symbol}...`);
            ws.send(JSON.stringify({
                ticks_history: symbol,
                count: 10000,
                end: 'latest',
                style: 'ticks'
            }));
        });
        ws.on('message', (data) => {
            const response = JSON.parse(data);
            if (response.msg_type === 'history') {
                ws.close();
                resolve(response.history.prices);
            }
        });
    });
}

function simulate(prices, codyMultiplier, rsiMin, rsiMax, minEntropy = 0) {
    let signals = 0;
    let wins = 0;
    let losses = 0;
    const stake = 10; // $10 c/u, total $20
    let totalPnl = 0;

    for (let i = 30; i < prices.length - 5; i++) {
        const window = prices.slice(i - 30, i + 1);
        const stdDev = calculateStdDev(window, 30);
        const rsi = calculateRSI(window, 14);
        const currentPrice = window[window.length - 1];

        // Evaluar entropía (Shannon) para el caos
        const hist = window.slice(-20);
        const freq = {};
        hist.forEach(p => {
            const digit = parseInt(String(p.toFixed(2)).slice(-1));
            freq[digit] = (freq[digit] || 0) + 1;
        });
        let entropy = 0;
        Object.values(freq).forEach(f => {
            const p = f / hist.length;
            entropy -= p * Math.log2(p);
        });

        if (entropy < minEntropy) continue;

        // Condición de RSI
        const isRsiMatch = (rsiMin !== null && rsiMax !== null)
            ? (rsi >= rsiMin && rsi <= rsiMax)
            : (rsi >= 65 || rsi <= 35); // Original

        if (isRsiMatch) {
            let offset = codyMultiplier * stdDev;
            const minOffset = currentPrice * 0.00005;
            if (offset < minOffset) offset = minOffset;

            const formattedOffset = parseFloat(offset.toFixed(2));
            const finalOffset = formattedOffset > 0 ? formattedOffset : 0.01;

            if (finalOffset > 0.70) continue;

            signals++;

            const exitPrice = prices[i + 5];
            const higherBarrier = currentPrice - finalOffset;
            const lowerBarrier = currentPrice + finalOffset;

            const wonHigher = exitPrice > higherBarrier;
            const wonLower = exitPrice < lowerBarrier;

            const wonBoth = wonHigher && wonLower;
            if (wonBoth) wins++;
            else losses++;

            i += 5;
        }
    }

    const wr = signals > 0 ? wins / signals : 0;
    const p_breach = 1 - wr;
    const winProfit = 2 * stake * p_breach * 0.9;
    const lossCost = stake * (1 - p_breach * 0.9);

    totalPnl = (wins * winProfit) - (losses * lossCost);

    return {
        signals,
        wins,
        losses,
        winRate: (wr * 100).toFixed(2),
        estWinProfit: winProfit.toFixed(2),
        estLossCost: lossCost.toFixed(2),
        totalPnl: totalPnl.toFixed(2)
    };
}

async function run() {
    const prices = await downloadData('R_25');
    console.log(`\n=== OPTIMIZACIÓN DE MOTOR CODY EN R_25 (${prices.length} ticks) ===`);

    const tests = [
        { label: "Original (Mult 1.8, RSI Extremos >=65/<=35)", mult: 1.8, rsiMin: null, rsiMax: null },
        { label: "Mult 1.8, RSI Rango Medio (40-60)", mult: 1.8, rsiMin: 40, rsiMax: 60 },
        { label: "Mult 2.2, RSI Extremos >=65/<=35", mult: 2.2, rsiMin: null, rsiMax: null },
        { label: "Mult 2.2, RSI Rango Medio (40-60)", mult: 2.2, rsiMin: 40, rsiMax: 60 },
        { label: "Mult 2.5, RSI Extremos >=65/<=35", mult: 2.5, rsiMin: null, rsiMax: null },
        { label: "Mult 2.5, RSI Rango Medio (40-60)", mult: 2.5, rsiMin: 40, rsiMax: 60 },
        { label: "Mult 3.0, RSI Extremos >=65/<=35", mult: 3.0, rsiMin: null, rsiMax: null },
        { label: "Mult 3.0, RSI Rango Medio (40-60)", mult: 3.0, rsiMin: 40, rsiMax: 60 }
    ];

    for (const t of tests) {
        const res = simulate(prices, t.mult, t.rsiMin, t.rsiMax, t.entropy || 0);
        console.log(`\n📌 ${t.label}:`);
        console.log(`   Señales: ${res.signals} | Acierto (Canal): ${res.winRate}%`);
        console.log(`   Est. Retorno por Win: +$${res.estWinProfit} | Pérdida por Loss: -$${res.estLossCost}`);
        console.log(`   PnL Estimado Total: ${parseFloat(res.totalPnl) >= 0 ? '🟢 +' : '🔴 '}$${res.totalPnl}`);
    }
}

run();
