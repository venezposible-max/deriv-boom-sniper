function calculateRSIPuro(prices, period) {
    if (prices.length < period + 1) return 50;

    let history = prices.slice(-(period + 1));
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < history.length; i++) {
        let diff = history[i] - history[i - 1];
        if (diff > 0) {
            gains += diff;
        } else if (diff < 0) {
            losses += Math.abs(diff); // IMPORTANTE: Math.abs para sumar las pérdidas como positivos
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}
let history = [];
let price = 5000;
for(let i=0; i<300; i++){
    history.push(price);
    price -= 0.5; // bajada pura
}
console.log(calculateRSIPuro(history,14));

history.push(5000); // Super spike
console.log(calculateRSIPuro(history,14));

history.push(4999);
console.log(calculateRSIPuro(history,14));

