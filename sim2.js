// sim2.js
const TOTAL_TICKS = 14400 * 4; // 16 horas simuladas combinadas
const MEMORY_WINDOW = 100; 
const TRIGGER_THRESHOLD = 18; 

let balance = 0;
let winsDiffers = 0;
let lossesDiffers = 0;
let winsMatch = 0;
let lossesMatch = 0;

let history = [];
function getNextTick() { return Math.floor(Math.random() * 10); }

for (let i = 0; i < TOTAL_TICKS; i++) {
    const tick = getNextTick();
    history.push(tick);
    if (history.length > MEMORY_WINDOW) history.shift();

    if (history.length === MEMORY_WINDOW) {
        let freqs = new Array(10).fill(0);
        for (let d of history) freqs[d]++;

        let hotDigit = -1;
        let maxFreq = 0;
        for (let d = 0; d < 10; d++) {
            if (freqs[d] >= TRIGGER_THRESHOLD && freqs[d] > maxFreq) {
                maxFreq = freqs[d];
                hotDigit = d;
            }
        }

        if (hotDigit !== -1) {
            i++; 
            if (i >= TOTAL_TICKS) break;
            
            const nextTick = getNextTick();
            history.push(nextTick);
            history.shift();
            
            if (nextTick !== hotDigit) {
                // DIFFERS WIN
                winsDiffers++;
                balance += 5 * 0.099; // +$0.49
            } else {
                // DIFFERS LOSS
                lossesDiffers++;
                balance -= 5.00;
                
                // Activar Escudo Asimétrico (Match al 20% = $1)
                i++;
                if (i >= TOTAL_TICKS) break;
                const shieldTick = getNextTick();
                history.push(shieldTick);
                history.shift();
                
                if (shieldTick === hotDigit) {
                    winsMatch++;
                    balance += 1 * 8.09; // +$8.09
                } else {
                    lossesMatch++;
                    balance -= 1.00; // -$1.00
                }
            }
        }
    }
}

console.log(`--- REPORTE SIMULACIÓN EXTREMA (16 HORAS) ---`);
console.log(`Diferidos Ganados: ${winsDiffers} | Perdidos: ${lossesDiffers}`);
console.log(`Escudos (Match) Ganados: ${winsMatch} | Perdidos: ${lossesMatch}`);
console.log(`Balance Final: $${balance.toFixed(2)}`);
