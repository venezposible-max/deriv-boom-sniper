function downsampleTicksToCandles(ticks, ticksPerCandle) {
    let candles = [];
    for (let i = 0; i < ticks.length; i += ticksPerCandle) {
        candles.push(ticks[i]);
    }
    return candles;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    
    // Suavizado en base a cuantas velas tenemos
    // Si tenemos velas M1, period 14, un suavizado de 50 o más velas (los 4000 ticks = 66 velas)
    let startIndex = prices.length - 60; // Maximo suavizado posible (60 velas)
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

    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

let history = [];
let p = 5000;
for(let i=0; i<4000; i++){
    if(i % 500 === 0) p += 50; 
    p -= 0.2; 
    history.push(p);
}

let m1_candles = downsampleTicksToCandles(history, 60);
console.log("RSI 14 en Velas M1 Reales:", calculateRSI(m1_candles, 14));
