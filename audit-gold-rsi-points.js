const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Rango: Últimos 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const SPIKE_THRESHOLD = 0.5; // Definición de Spike

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔎 BUSCANDO EL "PUNTO DE ORO": ¿Dónde ocurren más spikes (RSI 0-25)?...`);
    fetchCandles(endTS);
});

function fetchCandles(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
        count: 5000,
        style: 'candles',
        granularity: 60
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        allCandles = [...candles, ...allCandles];
        const earliestReceived = candles.length > 0 ? candles[0].epoch : 0;

        if (allCandles.length < 10080 && earliestReceived > startTS && candles.length > 0) {
            process.stdout.write('.');
            fetchCandles(earliestReceived);
        } else {
            console.log(`\n✅ DATA CARGADA. Mapeando zona de explosión...`);
            findGoldPoints();
            ws.close();
        }
    }
});

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let cg = diff > 0 ? diff : 0;
        let cl = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + cg) / period;
        avgLoss = (avgLoss * (period - 1) + cl) / period;
    }
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
}

function findGoldPoints() {
    let bins = {}; // Agruparemos por rangos de 2 puntos de RSI (0-2, 2-4, etc.)
    const closes = allCandles.map(c => c.close);

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];

        // Detectamos si HUBO un spike en este minuto
        if ((candle.high - candle.open) >= SPIKE_THRESHOLD) {
            // Calculamos el RSI que había justo antes del spike
            const rsi = calculateRSI(closes.slice(i - 40, i), 14);

            // Solo nos interesa la zona baja (0 a 30 para ver el contexto)
            if (rsi <= 30) {
                const binKey = Math.floor(rsi / 1) * 1; // Bins de 1 punto de RSI para máxima precisión
                bins[binKey] = (bins[binKey] || 0) + 1;
            }
        }
    }

    // Ordenar resultados
    let sortedBins = Object.keys(bins)
        .map(b => ({ rsi: parseInt(b), count: bins[b] }))
        .sort((a, b) => b.count - a.count);

    console.log("\n=================================================");
    console.log("🏆 RANKING DE EXPLOSIÓN: ¿Qué RSI lanza más spikes?");
    console.log("=================================================");
    console.log("Top 10 puntos calientes (RSI 0-30):");
    console.log("-------------------------------------------------");

    sortedBins.slice(0, 10).forEach((b, index) => {
        let emoji = index === 0 ? "🥇" : (index === 1 ? "🥈" : (index === 2 ? "🥉" : "📍"));
        console.log(`${emoji} RSI ${b.rsi}.0 a ${b.rsi + 0.9}: ${b.count} Spikes registrados`);
    });

    console.log("-------------------------------------------------");
    console.log("💡 CONCLUSIÓN TÉCNICA:");
    if (sortedBins.length > 0) {
        console.log(`El "Punto de Oro" real es el RSI ${sortedBins[0].rsi}.`);
        console.log(`Es donde el Boom 500 ha reaccionado más veces esta semana.`);
    }
    console.log("=================================================\n");
}
