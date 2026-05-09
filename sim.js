// sim.js - Simulación del Cazador de Desequilibrios PRNG
const TOTAL_TICKS = 14400; // 4 horas a 1 tick por segundo (por mercado)
const MEMORY_WINDOW = 100; // 100 ticks en memoria
const TRIGGER_THRESHOLD = 18; // Si un dígito sale 18 o más veces (promedio es 10), está "Sobrecomprado"

let balance = 0;
let wins = 0;
let losses = 0;
let trades = 0;

let currentStake = 5;
const BASE_STAKE = 5;

// Array circular para memoria
let history = [];

// Función para simular el PRNG del casino (Ligeramente equilibrado)
function getNextTick() {
    return Math.floor(Math.random() * 10);
}

for (let i = 0; i < TOTAL_TICKS; i++) {
    const tick = getNextTick();
    history.push(tick);
    if (history.length > MEMORY_WINDOW) history.shift();

    if (history.length === MEMORY_WINDOW) {
        // Contar frecuencias
        let freqs = new Array(10).fill(0);
        for (let d of history) freqs[d]++;

        // Buscar el dígito más caliente que supere el umbral
        let hotDigit = -1;
        let maxFreq = 0;
        for (let d = 0; d < 10; d++) {
            if (freqs[d] >= TRIGGER_THRESHOLD && freqs[d] > maxFreq) {
                maxFreq = freqs[d];
                hotDigit = d;
            }
        }

        // Si encontramos un desequilibrio brutal, disparamos
        if (hotDigit !== -1) {
            // El disparo es para el SIGUIENTE tick
            // Como esto es un loop continuo, avanzamos el simulador un paso (consumimos un tick para el trade)
            i++; 
            if (i >= TOTAL_TICKS) break;
            
            const nextTick = getNextTick();
            history.push(nextTick);
            history.shift();
            
            trades++;
            
            if (nextTick !== hotDigit) {
                // WIN!
                wins++;
                balance += currentStake * 0.099; // +9.9% ganancia neta
                currentStake = BASE_STAKE; // Reset stake
            } else {
                // LOSS! (El número caliente volvió a salir)
                losses++;
                balance -= currentStake;
                // Martingala Fantasma: multiplicador para recuperar en la *siguiente* anomalía (pueden pasar minutos)
                currentStake = currentStake * 11; // Multiplicador pesado para Differs
            }
        }
    }
}

console.log(`--- REPORTE 4 HORAS (Cazador PRNG) ---`);
console.log(`Ticks Escaneados: ${TOTAL_TICKS}`);
console.log(`Desequilibrios Detectados (Trades): ${trades}`);
console.log(`Ganados: ${wins} | Perdidos: ${losses}`);
console.log(`Win Rate Real: ${((wins/trades)*100).toFixed(2)}%`);
console.log(`Balance Final: $${balance.toFixed(2)}`);
