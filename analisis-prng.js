/**
 * ANÁLISIS FORENSE DEL PRNG DE DERIV
 * Recolecta ticks reales y busca fallas estadísticas.
 */
import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];
const TARGET_TICKS = 500; // por símbolo

const data = {};
SYMBOLS.forEach(s => { data[s] = { digits: [], prices: [] }; });

let totalCollected = 0;
const totalNeeded = TARGET_TICKS * SYMBOLS.length;

console.log(`\n🔬 ANÁLISIS FORENSE DEL PRNG DE DERIV`);
console.log(`${'='.repeat(50)}`);
console.log(`Recolectando ${TARGET_TICKS} ticks por símbolo (${SYMBOLS.length} símbolos)...`);
console.log(`Total: ${totalNeeded} ticks\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    SYMBOLS.forEach(s => ws.send(JSON.stringify({ subscribe: 1, ticks: s })));
});

ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.msg_type !== 'tick' || !msg.tick) return;

    const s = msg.tick.symbol;
    const price = msg.tick.quote;
    const digit = parseInt(String(price.toFixed(2)).slice(-1));

    if (data[s].digits.length >= TARGET_TICKS) return;

    data[s].digits.push(digit);
    data[s].prices.push(price);
    totalCollected++;

    if (totalCollected % 500 === 0) {
        process.stdout.write(`\r  📊 Progreso: ${totalCollected}/${totalNeeded} (${((totalCollected/totalNeeded)*100).toFixed(1)}%)`);
    }

    if (totalCollected >= totalNeeded) {
        ws.close();
        console.log(`\n\n✅ Recolección completa. Analizando...\n`);
        runFullAnalysis();
    }
});

function runFullAnalysis() {
    for (const sym of SYMBOLS) {
        console.log(`\n${'═'.repeat(55)}`);
        console.log(`  📈 ${sym} — ${data[sym].digits.length} ticks`);
        console.log(`${'═'.repeat(55)}`);

        const digits = data[sym].digits;

        // TEST 1: Distribución de frecuencias + Chi-Squared
        testDistribution(digits);

        // TEST 2: Autocorrelación (¿el dígito N predice el N+1?)
        testAutocorrelation(digits);

        // TEST 3: Matriz de transición (Markov)
        testTransitionMatrix(digits);

        // TEST 4: Análisis de rachas
        testStreaks(digits);

        // TEST 5: Runs Test (aleatoriedad)
        testRuns(digits);
    }

    // TEST 6: Correlación entre mercados
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  🔗 CORRELACIÓN ENTRE MERCADOS`);
    console.log(`${'═'.repeat(55)}`);
    testCrossMarket();

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  🏁 CONCLUSIONES`);
    console.log(`${'═'.repeat(55)}`);
    printConclusions();
}

// ── TEST 1: Distribución ──
function testDistribution(digits) {
    console.log(`\n  📊 TEST 1: Distribución de Dígitos`);
    const freq = Array(10).fill(0);
    digits.forEach(d => freq[d]++);
    const expected = digits.length / 10;

    let chiSquared = 0;
    let maxBias = { digit: 0, pct: 0, diff: 0 };

    for (let d = 0; d <= 9; d++) {
        const pct = ((freq[d] / digits.length) * 100).toFixed(2);
        const diff = ((freq[d] - expected) / expected * 100).toFixed(2);
        chiSquared += Math.pow(freq[d] - expected, 2) / expected;

        const bar = '█'.repeat(Math.round(freq[d] / (digits.length / 100)));
        const flag = Math.abs(parseFloat(diff)) > 5 ? ' ⚠️' : '';
        console.log(`     ${d}: ${freq[d].toString().padStart(4)} (${pct}%) ${diff > 0 ? '+' : ''}${diff}% ${bar}${flag}`);

        if (Math.abs(parseFloat(diff)) > Math.abs(maxBias.diff)) {
            maxBias = { digit: d, pct: parseFloat(pct), diff: parseFloat(diff) };
        }
    }

    // Chi-squared critical value for 9 df, p=0.05 is 16.92
    const pValue = chiSquared > 16.92 ? '<0.05 ⚠️ NO UNIFORME' : '>0.05 ✅ Uniforme';
    console.log(`     Chi²: ${chiSquared.toFixed(3)} | p-value: ${pValue}`);
    console.log(`     Mayor sesgo: dígito ${maxBias.digit} con ${maxBias.diff > 0 ? '+' : ''}${maxBias.diff}%`);
}

// ── TEST 2: Autocorrelación ──
function testAutocorrelation(digits) {
    console.log(`\n  🔄 TEST 2: Autocorrelación (¿un dígito predice el siguiente?)`);
    for (const lag of [1, 2, 3, 5, 10]) {
        let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
        const n = digits.length - lag;
        for (let i = 0; i < n; i++) {
            const x = digits[i], y = digits[i + lag];
            sumXY += x * y; sumX += x; sumY += y;
            sumX2 += x * x; sumY2 += y * y;
        }
        const r = (n * sumXY - sumX * sumY) /
            Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        const flag = Math.abs(r) > 0.05 ? ' ⚠️ CORRELACIÓN DETECTADA' : ' ✅';
        console.log(`     Lag ${lag.toString().padStart(2)}: r = ${r.toFixed(5)}${flag}`);
    }
}

// ── TEST 3: Matriz de Transición ──
function testTransitionMatrix(digits) {
    console.log(`\n  🧠 TEST 3: Matriz de Transición (Markov)`);
    const matrix = Array(10).fill(null).map(() => Array(10).fill(0));
    for (let i = 0; i < digits.length - 1; i++) {
        matrix[digits[i]][digits[i + 1]]++;
    }

    // Buscar transiciones con sesgo significativo
    let anomalies = [];
    for (let from = 0; from <= 9; from++) {
        const rowTotal = matrix[from].reduce((a, b) => a + b, 0);
        if (rowTotal === 0) continue;
        for (let to = 0; to <= 9; to++) {
            const observed = matrix[from][to] / rowTotal;
            const expected = 0.10;
            const deviation = ((observed - expected) / expected) * 100;
            if (Math.abs(deviation) > 25) {
                anomalies.push({ from, to, observed: (observed * 100).toFixed(1), deviation: deviation.toFixed(1) });
            }
        }
    }

    if (anomalies.length > 0) {
        console.log(`     ⚠️ ${anomalies.length} transiciones anómalas (>25% desviación):`);
        anomalies.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
        anomalies.slice(0, 8).forEach(a => {
            console.log(`        ${a.from}→${a.to}: ${a.observed}% (esperado 10%, desvío ${a.deviation}%)`);
        });
    } else {
        console.log(`     ✅ Sin transiciones anómalas significativas.`);
    }
}

// ── TEST 4: Análisis de Rachas ──
function testStreaks(digits) {
    console.log(`\n  🔥 TEST 4: Análisis de Rachas Consecutivas`);
    const streakCounts = {}; // streakLength -> count
    let currentStreak = 1;

    for (let i = 1; i < digits.length; i++) {
        if (digits[i] === digits[i - 1]) {
            currentStreak++;
        } else {
            streakCounts[currentStreak] = (streakCounts[currentStreak] || 0) + 1;
            currentStreak = 1;
        }
    }
    streakCounts[currentStreak] = (streakCounts[currentStreak] || 0) + 1;

    const n = digits.length;
    console.log(`     Long | Observado | Esperado  | Desviación`);
    console.log(`     ${'─'.repeat(48)}`);
    for (let len = 1; len <= 6; len++) {
        const observed = streakCounts[len] || 0;
        // Expected: n * 0.9 * 0.1^(len-1) approximately
        const expected = n * 0.9 * Math.pow(0.1, len - 1);
        const dev = expected > 0 ? (((observed - expected) / expected) * 100).toFixed(1) : '0';
        const flag = Math.abs(parseFloat(dev)) > 30 ? ' ⚠️' : '';
        console.log(`      ${len}   |   ${observed.toString().padStart(5)}   |  ${expected.toFixed(1).padStart(7)}  | ${dev}%${flag}`);
    }
}

// ── TEST 5: Runs Test ──
function testRuns(digits) {
    console.log(`\n  🎰 TEST 5: Runs Test (Aleatoriedad)`);
    const median = [...digits].sort((a, b) => a - b)[Math.floor(digits.length / 2)];
    const binary = digits.map(d => d >= median ? 1 : 0);

    let runs = 1;
    let n1 = 0, n2 = 0;
    for (let i = 0; i < binary.length; i++) {
        if (binary[i] === 1) n1++; else n2++;
        if (i > 0 && binary[i] !== binary[i - 1]) runs++;
    }

    const expectedRuns = 1 + (2 * n1 * n2) / (n1 + n2);
    const stdRuns = Math.sqrt((2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / ((n1 + n2) ** 2 * (n1 + n2 - 1)));
    const zScore = (runs - expectedRuns) / stdRuns;

    const verdict = Math.abs(zScore) > 1.96 ? '⚠️ NO ALEATORIO' : '✅ Aleatorio';
    console.log(`     Runs observados: ${runs} | Esperados: ${expectedRuns.toFixed(1)}`);
    console.log(`     Z-Score: ${zScore.toFixed(3)} | Veredicto: ${verdict}`);
}

// ── TEST 6: Correlación entre mercados ──
function testCrossMarket() {
    const minLen = Math.min(...SYMBOLS.map(s => data[s].digits.length));
    for (let i = 0; i < SYMBOLS.length; i++) {
        for (let j = i + 1; j < SYMBOLS.length; j++) {
            const a = data[SYMBOLS[i]].digits.slice(0, minLen);
            const b = data[SYMBOLS[j]].digits.slice(0, minLen);
            let match = 0;
            for (let k = 0; k < minLen; k++) {
                if (a[k] === b[k]) match++;
            }
            const pct = ((match / minLen) * 100).toFixed(2);
            const flag = parseFloat(pct) > 12 ? ' ⚠️' : ' ✅';
            console.log(`     ${SYMBOLS[i]} ↔ ${SYMBOLS[j]}: ${pct}% coincidencia (esperado: 10%)${flag}`);
        }
    }
}

// ── CONCLUSIONES ──
function printConclusions() {
    console.log(`
  Este análisis busca 3 tipos de fallas:
  
  1. BIAS DE DISTRIBUCIÓN: ¿Algún dígito sale más que otro?
     → Si sí, apuestas SIEMPRE contra el dígito que MÁS sale.
     
  2. AUTOCORRELACIÓN: ¿El dígito actual predice el siguiente?
     → Si sí, el PRNG tiene memoria explotable.
     
  3. TRANSICIONES ANÓMALAS: ¿Después del 7, el 3 sale más?
     → Si sí, puedes predecir parcialmente el siguiente dígito.
     
  4. RACHAS ANÓMALAS: ¿Hay más/menos rachas de las esperadas?
     → Si hay MENOS rachas largas, el PRNG tiene anti-clustering
        y nuestro Escudo Nivel 4 es AÚN más seguro.
     → Si hay MÁS rachas largas, el PRNG favorece streaks
        y necesitamos subir a Nivel 5.
  
  ⚠️ Busca las marcas ⚠️ en los resultados de arriba.
  Cualquier anomalía significativa = posible falla explotable.
`);
}
