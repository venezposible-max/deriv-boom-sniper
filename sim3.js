// sim3.js - Backtesting de Hit and Run (Sesiones de $10)
const TOTAL_TICKS = 144000; // 10 horas x 4 mercados = 144,000 ticks
const MEMORY_WINDOW = 100;
const TRIGGER_THRESHOLD = 18;

const TAKE_PROFIT = 10.00;
const STOP_LOSS = -30.00; // Si perdemos $30 en una sesión, cerramos el día y asumimos la pérdida.

let totalSessionsWon = 0;
let totalSessionsLost = 0;
let sessionBalance = 0;
let globalBalance = 0;

let history = [];
function getNextTick() { return Math.floor(Math.random() * 10); }

let sessionStartTick = 0;

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
                sessionBalance += 5 * 0.099; // +$0.495
            } else {
                // DIFFERS LOSS
                sessionBalance -= 5.00;
                
                // Escudo
                i++;
                if (i >= TOTAL_TICKS) break;
                const shieldTick = getNextTick();
                history.push(shieldTick);
                history.shift();
                
                if (shieldTick === hotDigit) {
                    sessionBalance += 1 * 8.09; // +$8.09
                } else {
                    sessionBalance -= 1.00; // -$1.00
                }
            }
            
            // Check Session Limits
            if (sessionBalance >= TAKE_PROFIT) {
                totalSessionsWon++;
                globalBalance += sessionBalance;
                sessionBalance = 0; // Reset para nueva sesión
                sessionStartTick = i;
            } else if (sessionBalance <= STOP_LOSS) {
                totalSessionsLost++;
                globalBalance += sessionBalance;
                sessionBalance = 0; // Reset para nueva sesión
                sessionStartTick = i;
            }
        }
    }
}

// Sumar la última sesión que quedó a medias
globalBalance += sessionBalance;

console.log(`--- BACKTESTING 10 HORAS (ESTRATEGIA HIT & RUN) ---`);
console.log(`Meta por Sesión: +$${TAKE_PROFIT}`);
console.log(`Límite de Pérdida por Sesión: -$${Math.abs(STOP_LOSS)}`);
console.log(`-------------------------------------------------`);
console.log(`🏆 Sesiones Ganadas (Tocaron +$10): ${totalSessionsWon}`);
console.log(`💀 Sesiones Perdidas (Tocaron -$30): ${totalSessionsLost}`);
console.log(`Win Rate de Sesiones: ${((totalSessionsWon / (totalSessionsWon + totalSessionsLost)) * 100).toFixed(2)}%`);
console.log(`💵 Balance Global Total: $${globalBalance.toFixed(2)}`);
