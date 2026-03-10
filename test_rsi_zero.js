function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let startIndex = prices.length - 250;
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
for(let i=0; i<300; i++){
    history.push(p);
    p -= 0.5; // Only red ticks!
}
console.log("RSI con solo caida:", calculateRSI(history, 14));
