/**
 * ANÁLISIS FORENSE AVANZADO (PAR/IMPAR, OVER/UNDER, DELAYS)
 */
import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];
const TARGET_TICKS = 200; // Muestra rápida

const data = {};
SYMBOLS.forEach(s => { data[s] = { digits: [] }; });

let totalCollected = 0;
const totalNeeded = TARGET_TICKS * SYMBOLS.length;

console.log(`\n🕵️ INICIANDO ANÁLISIS FORENSE FASE 2`);
console.log(`Buscando fallas en Over/Under y Even/Odd...`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    SYMBOLS.forEach(s => ws.send(JSON.stringify({ subscribe: 1, ticks: s })));
});

ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.msg_type !== 'tick' || !msg.tick) return;

    const s = msg.tick.symbol;
    const digit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));

    if (data[s].digits.length >= TARGET_TICKS) return;

    data[s].digits.push(digit);
    totalCollected++;

    if (totalCollected % 400 === 0) {
        process.stdout.write(`\r  📊 Progreso: ${totalCollected}/${totalNeeded}`);
    }

    if (totalCollected >= totalNeeded) {
        ws.close();
        console.log(`\n\n✅ Recolección completa. Ejecutando algoritmos...\n`);
        runPhase2Analysis();
    }
});

function runPhase2Analysis() {
    for (const sym of SYMBOLS) {
        console.log(`\n${'═'.repeat(55)}`);
        console.log(`  📈 MERCADO: ${sym}`);
        console.log(`${'═'.repeat(55)}`);

        const digits = data[sym].digits;

        // 1. EVEN / ODD
        let evens = 0, odds = 0;
        digits.forEach(d => d % 2 === 0 ? evens++ : odds++);
        const evPct = (evens / digits.length) * 100;
        const odPct = (odds / digits.length) * 100;
        let eoFlag = Math.abs(evPct - 50) > 4 ? '⚠️ SESGO DETECTADO' : '✅ Normal';
        console.log(`  [Par/Impar] Pares: ${evPct.toFixed(1)}% | Impares: ${odPct.toFixed(1)}% ${eoFlag}`);

        // Rachas de Pares/Impares
        let maxEvenStreak = 0, maxOddStreak = 0;
        let currE = 0, currO = 0;
        digits.forEach(d => {
            if (d % 2 === 0) { currE++; currO = 0; maxEvenStreak = Math.max(maxEvenStreak, currE); }
            else { currO++; currE = 0; maxOddStreak = Math.max(maxOddStreak, currO); }
        });
        let eoSStreakFlag = (maxEvenStreak > 9 || maxOddStreak > 9) ? '⚠️ RACHAS LARGAS' : '✅ Normal';
        console.log(`  [Par/Impar] Racha Máx Pares: ${maxEvenStreak} | Máx Impares: ${maxOddStreak} ${eoSStreakFlag}`);

        // 2. OVER / UNDER (Usando Barrera 4: Under = 0-4, Over = 5-9)
        let under = 0, over = 0;
        digits.forEach(d => d <= 4 ? under++ : over++);
        const unPct = (under / digits.length) * 100;
        const ovPct = (over / digits.length) * 100;
        let ouFlag = Math.abs(unPct - 50) > 4 ? '⚠️ SESGO DETECTADO' : '✅ Normal';
        console.log(`\n  [Over/Under 4] Bajos(0-4): ${unPct.toFixed(1)}% | Altos(5-9): ${ovPct.toFixed(1)}% ${ouFlag}`);

        // Corrección del Algoritmo (¿Después de 3 bajos, tira uno alto obligatoriamente?)
        let patternL3H = { total: 0, highNext: 0 }; // LLL -> H?
        let patternH3L = { total: 0, lowNext: 0 };  // HHH -> L?
        
        for (let i = 0; i < digits.length - 3; i++) {
            const isL = (d) => d <= 4;
            const isH = (d) => d >= 5;
            
            if (isL(digits[i]) && isL(digits[i+1]) && isL(digits[i+2])) {
                patternL3H.total++;
                if (isH(digits[i+3])) patternL3H.highNext++;
            }
            if (isH(digits[i]) && isH(digits[i+1]) && isH(digits[i+2])) {
                patternH3L.total++;
                if (isL(digits[i+3])) patternH3L.lowNext++;
            }
        }
        
        const l3hPct = patternL3H.total > 0 ? (patternL3H.highNext / patternL3H.total) * 100 : 0;
        const h3lPct = patternH3L.total > 0 ? (patternH3L.lowNext / patternH3L.total) * 100 : 0;
        
        let l3Flag = l3hPct > 65 ? '🎯 EXPLOTABLE' : '';
        let h3Flag = h3lPct > 65 ? '🎯 EXPLOTABLE' : '';
        
        console.log(`  [Corrección PRNG] LLL→H: ${l3hPct.toFixed(1)}% (Base 50%) ${l3Flag}`);
        console.log(`  [Corrección PRNG] HHH→L: ${h3lPct.toFixed(1)}% (Base 50%) ${h3Flag}`);
    }
}
