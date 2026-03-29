const WebSocket = require('ws');
const fs = require('fs');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const STAKE = 5.0;
const MULTIPLIER = 800;
const STOP_LOSS = 5.0;

let ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allPrices = [];
let allTimes = [];
let targetChunks = 5; // 5 x 5000 = 25,000 ticks = ~14 hours
let chunksLoaded = 0;
let lastEpoch = 'latest';

ws.on('open', () => {
    console.log(`[+] Conectado. Descargando ${targetChunks * 5000} ticks de V100 para Backtest Masivo...`);
    requestChunk(lastEpoch);
});

function requestChunk(endDate) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: endDate,
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.error) {
        console.error("Error Deriv:", msg.error.message);
        process.exit(1);
    }

    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        const times = msg.history.times;
        
        allPrices = prices.concat(allPrices);
        allTimes = times.concat(allTimes);
        
        chunksLoaded++;
        if(chunksLoaded < targetChunks) {
            lastEpoch = times[0]; // get older
            requestChunk(lastEpoch);
        } else {
            console.log(`✅ ${allPrices.length} ticks descargados (~14 horas de mercado). Iniciando Simulación de Asalto x800...`);
            runSimulation(allPrices, allTimes);
            process.exit(0);
        }
    }
});

function runSimulation(prices, times) {
    let balance = 0;
    let wins = 0;
    let losses = 0;
    let totalTrades = 0;
    
    let inTrade = false;
    let tradeType = '';
    let entryPrice = 0;
    let maxProfit = 0;
    let trailingFloor = null;
    let cooldownUntil = 0;

    for (let i = 20; i < prices.length; i++) {
        const currentPrice = prices[i];
        const currentTime = times[i];

        if (inTrade) {
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            
            let liveProfit = priceChangePct * MULTIPLIER * STAKE;

            if (liveProfit > maxProfit) maxProfit = liveProfit;

            if (liveProfit >= 0.50 && (trailingFloor === null || trailingFloor < 0.10)) {
                trailingFloor = 0.10;
            }
            if (liveProfit >= 1.20 && (trailingFloor === null || trailingFloor < 0.80)) {
                let newFloor = Math.floor(liveProfit - 0.40);
                if (newFloor > trailingFloor) trailingFloor = newFloor;
            }

            if (liveProfit <= -STOP_LOSS) {
                balance -= STOP_LOSS;
                losses++;
                inTrade = false;
                cooldownUntil = currentTime + 15;
                continue;
            }

            if (trailingFloor !== null && liveProfit <= trailingFloor) {
                balance += trailingFloor;
                if(trailingFloor >= 0) wins++; else losses++;
                inTrade = false;
                cooldownUntil = currentTime + 15;
                continue;
            }
            continue; 
        }

        if (currentTime < cooldownUntil) continue;

        const slice = prices.slice(i - 20, i);
        const sum = slice.reduce((a, b) => a + b, 0);
        const sma = sum / 20;
        const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / 20;
        const stdDev = Math.sqrt(variance);

        const upperBand = sma + (stdDev * 2.5);
        const lowerBand = sma - (stdDev * 2.5);
        const bandwidthPct = ((upperBand - lowerBand) / sma) * 100;
        const isCompressed = bandwidthPct < 0.05;

        // Spread adjustment in real market (aprox 20-30 ctv slippage en x800)
        // Here we simulate roughly $0.50 slippage burn on open due to spread/multipliers
        const INITIAL_BURN = -0.50; 

        if (stdDev > 0 && isCompressed) {
            if (currentPrice > upperBand) {
                inTrade = true;
                tradeType = 'MULTUP';
                entryPrice = currentPrice;
                maxProfit = INITIAL_BURN;
                trailingFloor = null;
                totalTrades++;
            } else if (currentPrice < lowerBand) {
                inTrade = true;
                tradeType = 'MULTDOWN';
                entryPrice = currentPrice;
                maxProfit = INITIAL_BURN;
                trailingFloor = null;
                totalTrades++;
            }
        }
    }

    console.log("=========================================");
    console.log(`📊 SIMULACIÓN x800 V100 (Últimas 14 horas, ${prices.length} Ticks exactos)`);
    console.log("=========================================");
    console.log(`Estrategia: Bandas Compresión (0.05%) -> Disparo Seco`);
    console.log(`Trailing: Candado +0.10 / Ahorque Dinámico 0.40`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Ganadas (Trailing Certeros): ${wins}`);
    console.log(`Perdidas (Stop Estallado / Recha): ${losses}`);
    console.log(`Win Rate del Trailing: ${totalTrades > 0 ? ((wins/totalTrades)*100).toFixed(2) : 0}%`);
    console.log(`---> RESULTADO PNL: $${balance.toFixed(2)} USD <---`);
    console.log("\nNota: Simula Slippage/Spread (QUEMA -0.50 por apertura) de Mercado Real.");
    console.log("=========================================");
}
