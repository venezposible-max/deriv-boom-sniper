const fs = require('fs');

const stateFile = 'persistent-state-hybrid.json';
if (!fs.existsSync(stateFile)) {
    console.log("No state file found.");
    process.exit(1);
}

const state = JSON.parse(fs.readFileSync(stateFile));
const markets = state.botState.markets;

console.log("=================================================");
console.log("🔍 MÍNIMOS ENCONTRADOS EN LA MATRIZ DE MARKOV");
console.log("=================================================");

for (const sym of Object.keys(markets)) {
    const market = markets[sym];
    const hist = market.digitHistory;
    if (!hist || hist.length < 1000) {
        console.log(`- ${sym}: Historial insuficiente (${hist ? hist.length : 0} ticks)`);
        continue;
    }

    let matrix = Array(10).fill(0).map(() => Array(10).fill(0));
    let counts = Array(10).fill(0);

    for (let i = 1; i < hist.length; i++) {
        let prev = hist[i - 1];
        let curr = hist[i];
        matrix[prev][curr]++;
        counts[prev]++;
    }

    let absoluteMin = 100;
    let minSource = -1;
    let minTarget = -1;

    for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
            if (counts[i] > 0) {
                let prob = (matrix[i][j] / counts[i]) * 100;
                // Queremos ver probabilidades reales mayores que cero
                if (prob > 0 && prob < absoluteMin) {
                    absoluteMin = prob;
                    minSource = i;
                    minTarget = j;
                }
            }
        }
    }

    console.log(`- ${sym}: El mínimo real es ${absoluteMin.toFixed(2)}% (Transición de ${minSource} a ${minTarget})`);
}
console.log("=================================================");
