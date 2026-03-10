function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let startIndex = prices.length - 2000;
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
    if(i % 500 === 0) p += 50; // spike gigante
    p -= 0.2; // always drop
    history.push(p);
}
console.log("RSI 14:", calculateRSI(history, 14));
console.log("RSI 840:", calculateRSI(history, 840));
