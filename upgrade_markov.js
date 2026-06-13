import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

const newMarkovCode = `
function evaluateMarkovDiffers() {
    if (!botState.engineMarkovDiffers) return null;
    
    let bestSignal = null;
    let absoluteLowestProb = 100;

    for (const sym of Object.keys(botState.markets)) {
        if (!botState.markets[sym] || !botState.markets[sym].digitHistory) continue;
        const hist = botState.markets[sym].digitHistory;
        
        // Wait until we have 2000 ticks for this specific market
        if (hist.length < 2000) continue;

        let matrix = Array(10).fill(0).map(() => Array(10).fill(0));
        let counts = Array(10).fill(0);

        for (let i = 1; i < hist.length; i++) {
            let prev = hist[i - 1];
            let curr = hist[i];
            matrix[prev][curr]++;
            counts[prev]++;
        }

        const currentDigit = hist[hist.length - 1];
        let bestTarget = -1;
        let lowestProb = 100;

        for (let target = 0; target <= 9; target++) {
            if (counts[currentDigit] > 0) {
                let prob = (matrix[currentDigit][target] / counts[currentDigit]) * 100;
                if (prob > 0 && prob <= 2.0) { // THRESHOLD
                    if (prob < lowestProb) {
                        lowestProb = prob;
                        bestTarget = target;
                    }
                }
            }
        }

        if (bestTarget !== -1 && lowestProb < absoluteLowestProb) {
            absoluteLowestProb = lowestProb;
            bestSignal = {
                engine: 'MARKOV_DIFFERS',
                contractType: 'DIGITDIFF',
                symbol: sym, // <--- Esto le dice al bot en qué mercado exacto disparar
                barrier: String(bestTarget),
                ticksRemaining: 1,
                reason: \`Markov \${sym} Prob \${lowestProb.toFixed(1)}%\`
            };
        }
    }
    
    if (bestSignal) {
        console.log(\`🎯 [MARKOV OMNISCIENTE] Anomalía detectada en \${bestSignal.symbol}. Probabilidad de riesgo: \${absoluteLowestProb.toFixed(2)}%. Disparando DIFFERS a \${bestSignal.barrier}\`);
        return bestSignal;
    }
    
    return null;
}
`;

// Replace the old evaluateMarkovDiffers with the new multi-market one
const oldMarkovRegex = /function evaluateMarkovDiffers\(\) \{[\s\S]*?return null;\n\}/;
if (serverContent.match(oldMarkovRegex)) {
    serverContent = serverContent.replace(oldMarkovRegex, newMarkovCode.trim());
}

fs.writeFileSync('server-boom.js', serverContent);
console.log('Markov upgraded to Omniscient Scanner!');
