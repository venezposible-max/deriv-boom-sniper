/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          EDGE FINDER — ANÁLISIS FORENSE MULTI-VOLATILIDAD       ║
 * ║   Busca sesgos explotables en DIFFER para Deriv Synthetic Index ║
 * ║   Método: Markov, Chi², Autocorrelación, Entropía, Heatmaps     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import WebSocket from 'ws';

const APP_ID = '1089'; // app_id público de Deriv
const WS_URL  = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const TICKS_PER_SYMBOL = 2000;

// Número de decimales por símbolo (Deriv usa 2 para volatilidades sintéticas)
function getDecimals(sym) {
    if (sym === 'R_10') return 3;
    if (sym === 'R_25') return 3;
    if (sym === 'R_50') return 4;
    if (sym === 'R_75') return 4;
    if (sym === 'R_100') return 2;
    return 2;
}

function getLastDigit(price, decimals) {
    return parseInt(parseFloat(price).toFixed(decimals).slice(-1));
}

// ── Conexión y descarga histórica ──────────────────────────────────────────────
async function fetchHistory(sym, count) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        ws.on('open', () => {
            ws.send(JSON.stringify({
                ticks_history: sym,
                count: count,
                end: 'latest',
                style: 'ticks',
                adjust_start_time: 1
            }));
        });
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (msg.msg_type === 'history') {
                ws.close();
                resolve(msg.history.prices);
            } else if (msg.error) {
                ws.close();
                reject(new Error(msg.error.message));
            }
        });
        ws.on('error', reject);
        setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 30000);
    });
}

// ── Estadísticas básicas ───────────────────────────────────────────────────────
function chiSquared(freq, n) {
    const expected = n / 10;
    let chi2 = 0;
    for (let d = 0; d <= 9; d++) chi2 += Math.pow(freq[d] - expected, 2) / expected;
    return chi2;
}

// Chi² p-value aproximado (df=9, tabla estándar)
function chiPValue(chi2) {
    if (chi2 > 27.88) return '<0.001';
    if (chi2 > 21.67) return '<0.01';
    if (chi2 > 16.92) return '<0.05';
    if (chi2 > 14.68) return '<0.10';
    return '>0.10';
}

function shannonEntropy(freq, n) {
    let h = 0;
    for (let d = 0; d <= 9; d++) {
        const p = freq[d] / n;
        if (p > 0) h -= p * Math.log2(p);
    }
    return h;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stddev(arr) {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length);
}

// ── Autocorrelación ─────────────────────────────────────────────────────────────
function autocorrelation(digits, lag) {
    const n = digits.length - lag;
    let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
        const x = digits[i], y = digits[i + lag];
        sumXY += x * y; sumX += x; sumY += y;
        sumX2 += x * x; sumY2 += y * y;
    }
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return den === 0 ? 0 : num / den;
}

// ── Markov Orden 1 ──────────────────────────────────────────────────────────────
function buildMarkov1(digits) {
    const counts = Array(10).fill(null).map(() => Array(10).fill(0));
    for (let i = 0; i < digits.length - 1; i++) {
        counts[digits[i]][digits[i + 1]]++;
    }
    const prob = Array(10).fill(null).map((_, r) => {
        const total = counts[r].reduce((a, b) => a + b, 0);
        return counts[r].map(c => total > 0 ? c / total : 0.1);
    });
    return { counts, prob };
}

// ── Markov Orden 2 ──────────────────────────────────────────────────────────────
function buildMarkov2(digits) {
    const counts = {};
    for (let i = 0; i <= 99; i++) {
        counts[i] = Array(10).fill(0);
    }
    for (let i = 2; i < digits.length; i++) {
        const state = digits[i - 2] * 10 + digits[i - 1];
        counts[state][digits[i]]++;
    }
    const prob = {};
    for (let i = 0; i <= 99; i++) {
        const total = counts[i].reduce((a, b) => a + b, 0);
        prob[i] = counts[i].map(c => total > 0 ? c / total : 0.1);
    }
    return { counts, prob };
}

// ── Análisis de Enfriamiento ─────────────────────────────────────────────────────
function analyzeCoiling(digits, digit, maxN = 30) {
    // Para cada posición donde digit[i] == digit, miramos cuántos ticks
    // han pasado desde la última aparición y qué pasó en el siguiente tick
    const results = Array(maxN + 1).fill(null).map(() => ({ appear: 0, total: 0 }));

    for (let i = 1; i < digits.length; i++) {
        // Contar cuántos ticks sin 'digit' antes de la posición i
        let absence = 0;
        for (let j = i - 1; j >= 0 && absence <= maxN; j--) {
            if (digits[j] === digit) break;
            absence++;
        }
        if (absence > maxN) absence = maxN;
        results[absence].total++;
        if (digits[i] === digit) results[absence].appear++;
    }
    return results;
}

// ── Test de Paridad y Alto/Bajo ─────────────────────────────────────────────────
function parityAnalysis(digits) {
    const even = digits.filter(d => d % 2 === 0).length;
    const odd = digits.length - even;
    const low = digits.filter(d => d < 5).length;
    const high = digits.length - low;
    const mult5 = digits.filter(d => d === 0 || d === 5).length;
    return {
        even, odd, evenPct: even / digits.length,
        low, high, lowPct: low / digits.length,
        mult5, mult5Pct: mult5 / digits.length,
        chiEven: Math.pow(even - digits.length / 2, 2) / (digits.length / 2) +
                 Math.pow(odd - digits.length / 2, 2) / (digits.length / 2),
        chiLow: Math.pow(low - digits.length / 2, 2) / (digits.length / 2) +
                Math.pow(high - digits.length / 2, 2) / (digits.length / 2),
        chiMult5: Math.pow(mult5 - digits.length * 0.2, 2) / (digits.length * 0.2) +
                  Math.pow((digits.length - mult5) - digits.length * 0.8, 2) / (digits.length * 0.8)
    };
}

// ── Análisis de Calor (Momentum local) ─────────────────────────────────────────
function heatAnalysis(digits, window = 20) {
    // Para cada dígito, ¿aparece más en los próximos 5 ticks si ya apareció mucho en los últimos N?
    const results = {};
    for (let d = 0; d <= 9; d++) {
        results[d] = { hotNext: 0, hotTotal: 0, coldNext: 0, coldTotal: 0 };
    }

    for (let i = window; i < digits.length - 5; i++) {
        const win = digits.slice(i - window, i);
        for (let d = 0; d <= 9; d++) {
            const freq = win.filter(x => x === d).length;
            const expected = window / 10;
            const isHot = freq >= expected * 1.5; // 50% más que lo esperado
            const isCold = freq <= expected * 0.5;

            const nextAppears = digits.slice(i, i + 5).includes(d);
            if (isHot) {
                results[d].hotTotal++;
                if (nextAppears) results[d].hotNext++;
            }
            if (isCold) {
                results[d].coldTotal++;
                if (nextAppears) results[d].coldNext++;
            }
        }
    }
    return results;
}

// ── DIFFER Win Rate Heatmap ─────────────────────────────────────────────────────
function differHeatmap(digits) {
    // Para cada par (último dígito Y, barrera predicha X):
    // P(siguiente != X | último == Y)
    const heatmap = Array(10).fill(null).map(() => Array(10).fill(null).map(() => ({ wins: 0, total: 0 })));

    for (let i = 0; i < digits.length - 1; i++) {
        const last = digits[i];
        const next = digits[i + 1];
        for (let x = 0; x <= 9; x++) {
            heatmap[last][x].total++;
            if (next !== x) heatmap[last][x].wins++;
        }
    }

    return heatmap.map(row =>
        row.map(cell => ({
            wins: cell.wins,
            total: cell.total,
            rate: cell.total > 0 ? cell.wins / cell.total : 0.9
        }))
    );
}

// ── Análisis de Momentos Calientes en V25 ──────────────────────────────────────
function hotMomentsV25(digits) {
    const windowSize = 50;
    const results = [];

    for (let i = windowSize; i < digits.length; i += 10) {
        const win = digits.slice(i - windowSize, i);
        const freq = Array(10).fill(0);
        win.forEach(d => freq[d]++);

        // Dígito dominante
        let maxD = 0, maxF = 0;
        for (let d = 0; d <= 9; d++) {
            if (freq[d] > maxF) { maxF = freq[d]; maxD = d; }
        }

        const chi2 = chiSquared(freq, windowSize);
        if (chi2 > 16.92) { // Significativo
            results.push({
                position: i,
                dominantDigit: maxD,
                dominantFreq: maxF,
                dominantPct: (maxF / windowSize * 100).toFixed(1),
                chi2: chi2.toFixed(2)
            });
        }
    }
    return results;
}

// ── Anti-Repetición Inmediata ───────────────────────────────────────────────────
function antiRepetitionAnalysis(digits) {
    // Para cada dígito D, dado que D apareció en la posición i,
    // ¿cuál es P(D) en posición i+1, i+2, i+3?
    const results = Array(10).fill(null).map(() => ({
        next1: { match: 0, total: 0 },
        next2: { match: 0, total: 0 },
        next3: { match: 0, total: 0 }
    }));

    for (let i = 0; i < digits.length - 3; i++) {
        const d = digits[i];
        results[d].next1.total++;
        results[d].next2.total++;
        results[d].next3.total++;
        if (digits[i + 1] === d) results[d].next1.match++;
        if (digits[i + 2] === d) results[d].next2.match++;
        if (digits[i + 3] === d) results[d].next3.match++;
    }

    return results.map(r => ({
        p1: r.next1.total > 0 ? r.next1.match / r.next1.total : 0.1,
        p2: r.next2.total > 0 ? r.next2.match / r.next2.total : 0.1,
        p3: r.next3.total > 0 ? r.next3.match / r.next3.total : 0.1,
    }));
}

// ── Análisis Markov Orden 2 para DIFFER ─────────────────────────────────────────
function markov2DifferEdge(digits) {
    const m2 = buildMarkov2(digits);
    const edges = [];

    for (let i = 0; i <= 99; i++) {
        const occurrences = m2.counts[i].reduce((a, b) => a + b, 0);
        if (occurrences < 20) continue; // muestra mínima

        const prev2 = Math.floor(i / 10);
        const prev1 = i % 10;

        for (let x = 0; x <= 9; x++) {
            const pX = m2.prob[i][x];
            const differWinRate = 1 - pX;
            const edge = differWinRate - 0.90; // baseline DIFFER = 90%

            if (edge > 0.01) { // Al menos 1% de edge sobre baseline
                // Test de significancia: binomial normal approximation
                const p0 = 0.1; // H0: probabilidad de que aparezca = 10%
                const n = occurrences;
                const observed = m2.counts[i][x];
                const z = (observed - n * p0) / Math.sqrt(n * p0 * (1 - p0));
                edges.push({
                    state: `${prev2}→${prev1}`,
                    barrier: x,
                    occurrences,
                    pBarrier: (pX * 100).toFixed(2),
                    differWR: (differWinRate * 100).toFixed(2),
                    edge: (edge * 100).toFixed(2),
                    zScore: z.toFixed(2),
                    significant: Math.abs(z) > 1.96
                });
            }
        }
    }

    edges.sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));
    return edges;
}

// ── Función principal de análisis ───────────────────────────────────────────────
async function analyzeSymbol(sym, digits) {
    const n = digits.length;
    const decimals = getDecimals(sym);

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  📊 ${sym} — ${n} ticks | Decimales: ${decimals}`);
    console.log(`${'═'.repeat(70)}`);

    // ── 1. Distribución de frecuencias ─────────────────────────────────────────
    console.log(`\n  🔢 [1] DISTRIBUCIÓN DE ÚLTIMOS DÍGITOS`);
    const freq = Array(10).fill(0);
    digits.forEach(d => freq[d]++);
    const chi2 = chiSquared(freq, n);
    const pval = chiPValue(chi2);
    const entropy = shannonEntropy(freq, n);

    for (let d = 0; d <= 9; d++) {
        const pct = (freq[d] / n * 100).toFixed(2);
        const diff = ((freq[d] / n - 0.1) * 100).toFixed(2);
        const bar = '█'.repeat(Math.round(freq[d] / n * 200));
        const flag = Math.abs(parseFloat(diff)) > 2.5 ? ' ⚠️' : '';
        console.log(`     ${d}: ${freq[d].toString().padStart(5)} (${pct}%) Δ${diff > 0 ? '+' : ''}${diff}% ${bar}${flag}`);
    }
    console.log(`\n     Chi²(9df): ${chi2.toFixed(3)} | p-value: ${pval} | Entropía Shannon: ${entropy.toFixed(4)} / 3.3219`);

    // ── 2. Paridad y sesgo alto/bajo ────────────────────────────────────────────
    console.log(`\n  🎲 [2] ANÁLISIS DE SESGO ESTRUCTURAL`);
    const parity = parityAnalysis(digits);
    const zEven = (parity.even - n * 0.5) / Math.sqrt(n * 0.25);
    const zLow = (parity.low - n * 0.5) / Math.sqrt(n * 0.25);
    const zMult5 = (parity.mult5 - n * 0.2) / Math.sqrt(n * 0.2 * 0.8);

    console.log(`     PARIDAD:    PARES=${parity.even} (${(parity.evenPct*100).toFixed(2)}%) IMPARES=${parity.odd} | z=${zEven.toFixed(3)} ${Math.abs(zEven) > 1.96 ? '⚠️ SESGO' : '✅ OK'}`);
    console.log(`     ALTO/BAJO:  0-4=${parity.low} (${(parity.lowPct*100).toFixed(2)}%) 5-9=${parity.high} | z=${zLow.toFixed(3)} ${Math.abs(zLow) > 1.96 ? '⚠️ SESGO' : '✅ OK'}`);
    console.log(`     MULT DE 5:  0,5=${parity.mult5} (${(parity.mult5Pct*100).toFixed(2)}%) esperado=${(n*0.2).toFixed(0)} | z=${zMult5.toFixed(3)} ${Math.abs(zMult5) > 1.96 ? '⚠️ SESGO' : '✅ OK'}`);

    // ── 3. Autocorrelación ──────────────────────────────────────────────────────
    console.log(`\n  🔄 [3] AUTOCORRELACIÓN (Lags 1–10)`);
    const significantLags = [];
    for (const lag of [1, 2, 3, 4, 5, 7, 10]) {
        const r = autocorrelation(digits, lag);
        const zAC = r * Math.sqrt(n - lag);
        const flag = Math.abs(r) > 2 / Math.sqrt(n) ? ' ⚠️' : ' ✅';
        if (Math.abs(r) > 2 / Math.sqrt(n)) significantLags.push({ lag, r });
        console.log(`     Lag ${lag.toString().padStart(2)}: r=${r.toFixed(5)} z=${zAC.toFixed(2)}${flag}`);
    }
    if (significantLags.length > 0) {
        console.log(`     ⚠️ CORRELACIÓN DETECTADA en lags: ${significantLags.map(l => l.lag).join(', ')}`);
    }

    // ── 4. Markov Orden 1 — Transiciones ───────────────────────────────────────
    console.log(`\n  🧠 [4] MARKOV ORDEN 1 — TRANSICIONES ANÓMALAS`);
    const m1 = buildMarkov1(digits);
    const allTransitions = [];
    for (let from = 0; from <= 9; from++) {
        for (let to = 0; to <= 9; to++) {
            const cnt = m1.counts[from][to];
            const rowTotal = m1.counts[from].reduce((a, b) => a + b, 0);
            const prob = rowTotal > 0 ? cnt / rowTotal : 0.1;
            const expected = rowTotal * 0.1;
            const zBinom = rowTotal > 0 ? (cnt - expected) / Math.sqrt(expected * 0.9) : 0;
            allTransitions.push({ from, to, cnt, rowTotal, prob, zBinom });
        }
    }
    allTransitions.sort((a, b) => b.prob - a.prob);

    console.log(`\n     TOP 5 TRANSICIONES MÁS PROBABLES:`);
    allTransitions.slice(0, 5).forEach(t => {
        const flag = Math.abs(t.zBinom) > 2 ? '⚠️' : '  ';
        console.log(`     ${flag} ${t.from}→${t.to}: ${(t.prob*100).toFixed(2)}% (cnt=${t.cnt}/${t.rowTotal}) z=${t.zBinom.toFixed(2)}`);
    });

    console.log(`\n     TOP 5 TRANSICIONES MÁS IMPROBABLES:`);
    allTransitions.slice(-5).reverse().forEach(t => {
        const flag = Math.abs(t.zBinom) > 2 ? '⚠️' : '  ';
        console.log(`     ${flag} ${t.from}→${t.to}: ${(t.prob*100).toFixed(2)}% (cnt=${t.cnt}/${t.rowTotal}) z=${t.zBinom.toFixed(2)}`);
    });

    // ── 5. DIFFER Heatmap ───────────────────────────────────────────────────────
    console.log(`\n  🗺️  [5] MAPA DE CALOR DIFFER — P(ganar | último=Y, barrera=X)`);
    console.log(`     Baseline: 90.00% | ⭐ = >91% | 🔥 = >92%`);
    const hm = differHeatmap(digits);

    // Header
    process.stdout.write(`\n     ${''.padStart(4)}`);
    for (let x = 0; x <= 9; x++) process.stdout.write(`  X=${x} `);
    console.log();

    let bestCells = [];
    for (let y = 0; y <= 9; y++) {
        process.stdout.write(`     Y=${y} `);
        for (let x = 0; x <= 9; x++) {
            const wr = hm[y][x].rate * 100;
            let mark = '     ';
            if (wr >= 92) { mark = ' 🔥  '; }
            else if (wr >= 91) { mark = ' ⭐  '; }
            else if (wr < 89) { mark = ' ❄️   '; }
            else { mark = `${wr.toFixed(1)}`; }
            process.stdout.write(`${mark.padStart(6)}`);

            if (hm[y][x].total >= 50 && wr >= 91) {
                bestCells.push({ y, x, wr: wr.toFixed(2), total: hm[y][x].total });
            }
        }
        console.log();
    }

    if (bestCells.length > 0) {
        console.log(`\n     🏆 COMBINACIONES CON EDGE (WR ≥ 91%, n≥50):`);
        bestCells.sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));
        bestCells.forEach(c => {
            const edge = (parseFloat(c.wr) - 90).toFixed(2);
            console.log(`       Último=${c.y}, Barrera=${c.x}: ${c.wr}% (n=${c.total}) | Edge=+${edge}%`);
        });
    } else {
        console.log(`\n     Sin combinaciones con edge significativo (WR≥91%, n≥50)`);
    }

    // ── 6. Anti-Repetición ─────────────────────────────────────────────────────
    console.log(`\n  🔁 [6] ANTI-REPETICIÓN INMEDIATA — P(dígito reaparece en próximos 1-3 ticks)`);
    const antiRep = antiRepetitionAnalysis(digits);
    let antiRepEdges = [];
    console.log(`     Dígito | P(+1)   | P(+2)   | P(+3)   | Baseline=10%`);
    console.log(`     ${'─'.repeat(55)}`);
    for (let d = 0; d <= 9; d++) {
        const ar = antiRep[d];
        const f1 = Math.abs(ar.p1 - 0.1) > 0.02 ? '⚠️' : '  ';
        const f2 = Math.abs(ar.p2 - 0.1) > 0.02 ? '⚠️' : '  ';
        const f3 = Math.abs(ar.p3 - 0.1) > 0.02 ? '⚠️' : '  ';
        console.log(`       ${d}    | ${(ar.p1*100).toFixed(2)}%${f1}| ${(ar.p2*100).toFixed(2)}%${f2}| ${(ar.p3*100).toFixed(2)}%${f3}`);

        // Si P(+1) < 8% → al aparecer D, es buen momento para DIFFER con barrera=D
        if (ar.p1 < 0.08) {
            antiRepEdges.push({ d, p1: ar.p1, edge: (0.90 + (0.1 - ar.p1)) * 100 });
        }
    }
    if (antiRepEdges.length > 0) {
        console.log(`\n     ⚠️ ANTI-REPETICIÓN EXPLOTABLE (DIFFER P(win) estimado > 92%):`);
        antiRepEdges.forEach(e =>
            console.log(`       Cuando aparece ${e.d}, DIFFER barrera=${e.d} → WR est. ${e.edge.toFixed(2)}%`)
        );
    }

    // ── 7. Análisis de Calor/Frío ───────────────────────────────────────────────
    console.log(`\n  🌡️  [7] ANÁLISIS CALOR/FRÍO — ¿Predict next 5 ticks?`);
    const heat = heatAnalysis(digits, 20);
    let heatEdges = [];
    console.log(`     Dígito | P(caliente→aparece) | P(frío→aparece) | Diff`);
    console.log(`     ${'─'.repeat(55)}`);
    for (let d = 0; d <= 9; d++) {
        const r = heat[d];
        const pHot = r.hotTotal > 0 ? r.hotNext / r.hotTotal : 0;
        const pCold = r.coldTotal > 0 ? r.coldNext / r.coldTotal : 0;
        const diff = pHot - pCold;
        const fh = Math.abs(pHot - 0.4) > 0.05 ? '⚠️' : '  '; // 40% = esperado (aparece al menos 1 vez en 5)
        console.log(`       ${d}    | ${(pHot*100).toFixed(1)}%(n=${r.hotTotal})${fh}| ${(pCold*100).toFixed(1)}%(n=${r.coldTotal})  | ${diff > 0 ? '+' : ''}${(diff*100).toFixed(1)}%`);

        if (r.coldTotal > 30 && pCold > 0.5) {
            heatEdges.push({ d, pCold, coldTotal: r.coldTotal });
        }
    }

    // ── 8. Markov Orden 2 — DIFFER Edges ───────────────────────────────────────
    console.log(`\n  🔬 [8] MARKOV ORDEN 2 — EDGES PARA DIFFER (p-value < 0.05)`);
    const m2Edges = markov2DifferEdge(digits);
    const sigEdges = m2Edges.filter(e => e.significant);

    if (sigEdges.length > 0) {
        console.log(`     ${sigEdges.length} combinaciones con edge significativo (|z| > 1.96):`);
        console.log(`     Estado | Barrera | Ocurrs | P(Barrera) | DIFFER WR | Edge    | z`);
        console.log(`     ${'─'.repeat(70)}`);
        sigEdges.slice(0, 20).forEach(e => {
            const flagHigh = parseFloat(e.differWR) >= 92 ? ' 🔥' : parseFloat(e.differWR) >= 91 ? ' ⭐' : '';
            console.log(`     ${e.state.padEnd(7)} |    ${e.barrier}    |  ${e.occurrences.toString().padStart(4)} | ${e.pBarrier.padStart(8)}% | ${e.differWR}%  ${flagHigh}| +${e.edge}% | ${e.zScore}`);
        });
    } else {
        console.log(`     Sin edges significativos detectados por Markov Orden 2.`);
    }

    // ── 9. Análisis de Enfriamiento (Coiling) ──────────────────────────────────
    console.log(`\n  ❄️  [9] ANÁLISIS DE ENFRIAMIENTO — ¿Aumenta P(D) al no aparecer N ticks?`);
    let coilingEdges = [];
    console.log(`     Dígito | Ausencia=5  | Ausencia=10 | Ausencia=15 | Baseline=10%`);
    console.log(`     ${'─'.repeat(65)}`);
    for (let d = 0; d <= 9; d++) {
        const coil = analyzeCoiling(digits, d, 20);
        const p5 = coil[5].total > 20 ? (coil[5].appear / coil[5].total) : null;
        const p10 = coil[10].total > 10 ? (coil[10].appear / coil[10].total) : null;
        const p15 = coil[15].total > 5 ? (coil[15].appear / coil[15].total) : null;

        const f5 = p5 !== null && Math.abs(p5 - 0.1) > 0.03 ? '⚠️' : '  ';
        const f10 = p10 !== null && Math.abs(p10 - 0.1) > 0.04 ? '⚠️' : '  ';
        const f15 = p15 !== null && Math.abs(p15 - 0.1) > 0.05 ? '⚠️' : '  ';

        const s5 = p5 !== null ? `${(p5*100).toFixed(1)}%${f5}` : 'n/a   ';
        const s10 = p10 !== null ? `${(p10*100).toFixed(1)}%${f10}` : 'n/a    ';
        const s15 = p15 !== null ? `${(p15*100).toFixed(1)}%${f15}` : 'n/a    ';

        console.log(`       ${d}    | ${s5.padEnd(12)} | ${s10.padEnd(12)} | ${s15.padEnd(12)}`);

        // Si tras N ticks sin aparecer, la P disminuye → DIFFER explotable (la barrera es "caliente en frío")
        if (p10 !== null && p10 < 0.07) {
            coilingEdges.push({ d, p10, absence: 10 });
        }
        if (p5 !== null && p5 < 0.07) {
            coilingEdges.push({ d, p10: p5, absence: 5 });
        }
    }

    if (coilingEdges.length > 0) {
        console.log(`\n     ⚠️ DÍGITOS QUE SIGUEN SIENDO 'FRÍOS' (DIFFER EDGE ↑):`);
        coilingEdges.forEach(e =>
            console.log(`       D=${e.d}: tras ${e.absence} ticks sin aparecer, P=${(e.p10*100).toFixed(1)}% (DIFFER WR est. ${(90 + (10 - e.p10*100)).toFixed(1)}%)`)
        );
    }

    return {
        sym, n, chi2, entropy,
        freq, parity,
        bestDifferCells: bestCells,
        m2Edges: sigEdges
    };
}

// ── Análisis Especial V25 — Momentos Calientes ─────────────────────────────────
async function analyzeV25Hot(digits) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  🔥 ANÁLISIS ESPECIAL R_25 — MOMENTOS CALIENTES (PERÍODOS DOMINANTES)`);
    console.log(`${'═'.repeat(70)}`);

    const hotMoments = hotMomentsV25(digits);

    if (hotMoments.length === 0) {
        console.log(`\n  Sin períodos con dominancia estadística significativa detectados.`);
        return;
    }

    console.log(`\n  Períodos con chi² > 16.92 (distribución no uniforme):`);
    console.log(`  Posición | Dígito Dom. | Freq | % Dom. | Chi²`);
    console.log(`  ${'─'.repeat(55)}`);
    hotMoments.slice(0, 30).forEach(m => {
        console.log(`  ${String(m.position).padStart(8)} | ${String(m.dominantDigit).padStart(11)} | ${String(m.dominantFreq).padStart(4)} | ${String(m.dominantPct).padStart(6)}% | ${m.chi2}`);
    });

    // Frecuencia de dominancia por dígito
    const domFreq = Array(10).fill(0);
    hotMoments.forEach(m => domFreq[m.dominantDigit]++);

    console.log(`\n  Distribución de dominancia en períodos calientes:`);
    for (let d = 0; d <= 9; d++) {
        if (domFreq[d] > 0) {
            const pct = (domFreq[d] / hotMoments.length * 100).toFixed(1);
            const bar = '█'.repeat(Math.round(domFreq[d] / hotMoments.length * 50));
            console.log(`   ${d}: ${bar} ${domFreq[d]} veces (${pct}%)`);
        }
    }
}

// ── RESUMEN EJECUTIVO FINAL ─────────────────────────────────────────────────────
function printFinalSummary(allResults) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  🏆 RESUMEN EJECUTIVO — EDGES ENCONTRADOS`);
    console.log(`${'═'.repeat(70)}`);

    let totalEdges = 0;

    for (const r of allResults) {
        const significant = [];

        // Chi² global
        if (r.chi2 > 16.92) {
            significant.push(`Distribución no uniforme (Chi²=${r.chi2.toFixed(2)}, p<0.05)`);
        }

        // DIFFER heatmap
        if (r.bestDifferCells.length > 0) {
            const best = r.bestDifferCells[0];
            significant.push(`DIFFER edge: Y=${best.y}→X=${best.x} WR=${best.wr}% (n=${best.total})`);
        }

        // Markov Orden 2
        const top2Edge = r.m2Edges.filter(e => parseFloat(e.differWR) >= 91).slice(0, 3);
        top2Edge.forEach(e => {
            significant.push(`M2 edge: ${e.state}→barrera=${e.barrier} WR=${e.differWR}% (z=${e.zScore})`);
        });

        if (significant.length > 0) {
            console.log(`\n  📌 ${r.sym} (${r.n} ticks):`);
            significant.forEach(s => console.log(`     → ${s}`));
            totalEdges += significant.length;
        } else {
            console.log(`\n  ✅ ${r.sym}: Sin edges significativos detectados.`);
        }
    }

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  Total de señales potenciales encontradas: ${totalEdges}`);
    console.log(`\n  ⚠️ NOTA METODOLÓGICA:`);
    console.log(`  Con 2000 ticks, el error estándar de proporción es ±${(2/Math.sqrt(2000)*100).toFixed(2)}%.`);
    console.log(`  Cualquier edge < 1% podría ser ruido estadístico.`);
    console.log(`  Para DIFFER, el break-even es 90.91% (1/1.1 ≈ 90.91% win rate).`);
    console.log(`  Se necesita un edge real de >0.91% sobre el baseline del 90% para ser rentable.`);
    console.log(`${'═'.repeat(70)}\n`);
}

// ── MAIN ────────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n${'╔' + '═'.repeat(68) + '╗'}`);
    console.log(`║        EDGE FINDER — ANÁLISIS FORENSE MULTI-VOLATILIDAD         ║`);
    console.log(`║   Deriv Synthetic Indices | DIFFER | Análisis Estadístico Profundo  ║`);
    console.log(`${'╚' + '═'.repeat(68) + '╝'}`);
    console.log(`\n  Símbolos: ${SYMBOLS.join(', ')}`);
    console.log(`  Ticks por símbolo: ${TICKS_PER_SYMBOL}`);
    console.log(`  Endpoint: ${WS_URL}\n`);

    const allData = {};
    const allResults = [];

    // Descargar todos los históricos
    for (const sym of SYMBOLS) {
        process.stdout.write(`  📡 Descargando ${sym}...`);
        try {
            const prices = await fetchHistory(sym, TICKS_PER_SYMBOL);
            const dec = getDecimals(sym);
            const digits = prices.map(p => getLastDigit(p, dec));
            allData[sym] = { digits, prices };
            console.log(` ✅ ${digits.length} ticks`);
        } catch (e) {
            console.log(` ❌ Error: ${e.message}`);
            allData[sym] = { digits: [], prices: [] };
        }
        // Pequeña pausa para no saturar el servidor
        await new Promise(r => setTimeout(r, 500));
    }

    // Analizar cada símbolo
    for (const sym of SYMBOLS) {
        const { digits } = allData[sym];
        if (digits.length < 100) {
            console.log(`\n  ⚠️ ${sym}: Datos insuficientes (${digits.length} ticks). Saltando.`);
            continue;
        }
        const result = await analyzeSymbol(sym, digits);
        allResults.push(result);
    }

    // Análisis especial V25
    if (allData['R_25'] && allData['R_25'].digits.length > 0) {
        await analyzeV25Hot(allData['R_25'].digits);
    }

    // Resumen final
    printFinalSummary(allResults);
}

main().catch(e => {
    console.error('❌ Error fatal:', e);
    process.exit(1);
});
