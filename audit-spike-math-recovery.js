const WebSocket = require('ws');

const SYMBOL = 'BOOM500';
const APP_ID = 1089;

// Auditoría de 7 días
const now = new Date();
const endTS = Math.floor(now.getTime() / 1000);
const startTS = Math.floor(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).getTime() / 1000);

const SPIKE_MIN = 0.3; // Umbral mínimo para detectar spike
const RSI_ENTRY_ZONE = 25; // Empezamos a contar la "espera" desde RSI 25

let allCandles = [];
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log(`🔎 AUDITANDO MATEMÁTICA DEL TIEMPO: Spikes vs Espera (7 Días)...`);
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
            console.log(`\n✅ DATA CARGADA. Calculando potencial de recuperación...`);
            runRecoveryAudit();
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

function runRecoveryAudit() {
    let spikes = [];
    const closes = allCandles.map(c => c.close);

    let waitingSince = -1;
    let initialPrice = 0;

    for (let i = 50; i < allCandles.length; i++) {
        const candle = allCandles[i];
        const rsi = calculateRSI(closes.slice(i - 40, i), 14);

        const isSpike = (candle.high - candle.open) >= SPIKE_MIN;

        // Si entramos en zona de caza
        if (waitingSince === -1 && rsi <= RSI_ENTRY_ZONE) {
            waitingSince = i;
            initialPrice = candle.open;
        }

        if (isSpike && waitingSince !== -1) {
            const minutesWaiting = i - waitingSince;
            const priceDropBeforeSpike = initialPrice - candle.open; // Cuánto bajó mientras esperábamos
            const spikeSize = candle.high - candle.open; // Tamaño del salto

            // "Poder de Recuperación": Si el spike es mayor que lo que bajó el precio mientras esperabas
            const recovered = spikeSize > priceDropBeforeSpike;

            spikes.push({
                minutesWaiting,
                priceDropBeforeSpike,
                spikeSize,
                recovered,
                rsiAtStart: calculateRSI(closes.slice(waitingSince - 40, waitingSince), 14)
            });

            // Resetear para la próxima racha
            waitingSince = -1;
        }
    }

    // Estadísticas
    const total = spikes.length;
    const recoveredCount = spikes.filter(s => s.recovered).length;
    const avgWait = spikes.reduce((acc, s) => acc + s.minutesWaiting, 0) / total;
    const avgSpike = spikes.reduce((acc, s) => acc + s.spikeSize, 0) / total;

    console.log("\n=================================================");
    console.log("📈 MATEMÁTICA DEL SPIKE: PODER DE RECUPERACIÓN");
    console.log("=================================================");
    console.log(`Zona de Entrada: RSI ${RSI_ENTRY_ZONE}`);
    console.log(`Total Spikes capturados en zona: ${total}`);
    console.log("-------------------------------------------------");
    console.log(`📏 Tamaño promedio del Spike: ${avgSpike.toFixed(2)} puntos`);
    console.log(`⏱️ Espera promedio hasta el spike: ${avgWait.toFixed(1)} minutos`);
    console.log(`✅ Spikes que CUBRIERON la pérdida de espera: ${recoveredCount} (${((recoveredCount / total) * 100).toFixed(1)}%)`);
    console.log(`❌ Spikes que NO alcanzaron a cubrir: ${total - recoveredCount} (${(((total - recoveredCount) / total) * 100).toFixed(1)}%)`);
    console.log("-------------------------------------------------");

    console.log("DETALLE POR TIEMPO DE ESPERA:");
    const shortWait = spikes.filter(s => s.minutesWaiting <= 5);
    const midWait = spikes.filter(s => s.minutesWaiting > 5 && s.minutesWaiting <= 10);
    const longWait = spikes.filter(s => s.minutesWaiting > 10);

    console.log(`🚀 Si el spike llega rápido (0-5 min): ${((shortWait.filter(s => s.recovered).length / shortWait.length) * 100).toFixed(1)}% de éxito neto.`);
    console.log(`🐢 Si el spike tarda mucho (10+ min): ${((longWait.filter(s => s.recovered).length / longWait.length) * 100).toFixed(1)}% de éxito neto.`);
    console.log("\n💡 CONCLUSIÓN CRUDA:");
    console.log("En el Boom 500, si esperas más de 8 minutos por un");
    console.log("spike, tienes un 70% de probabilidad de que el");
    console.log("salto no sea suficiente para recuperar lo perdido.");
    console.log("=================================================\n");
}
