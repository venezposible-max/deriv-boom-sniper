/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║   🔬 ANÁLISIS ESTADÍSTICO PROFUNDO — DIFFER ENGINE — DERIV PRNG AUDIT  ║
 * ║   v2.0 EXHAUSTIVO: Chi², Autocorrelación, Markov 1st/2nd/3rd Order,    ║
 * ║   Análisis de Rachas, Fourier FFT, Test de Gap, Entropía de Shannon,   ║
 * ║   Análisis Post-Pérdida, Clumping, Análisis Temporal DIFFER-specific   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import WebSocket from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────
const APP_ID = '1089';  // App ID público de Deriv para demos/análisis
const SYMBOLS = ['R_25', 'R_10'];
const TARGET_TICKS = 5000;

// Función para obtener el último dígito correctamente (fix trailing zeros)
function getLastDigit(price) {
    const s = parseFloat(price).toFixed(4);
    return parseInt(s[s.length - 1]);
}

// ─────────────────────────────────────────────────────────────────────────────
//  DESCARGA DE DATOS VÍA WEBSOCKET (paginada para obtener 5000+ ticks)
// ─────────────────────────────────────────────────────────────────────────────
async function downloadTicks(symbol, targetCount) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);
        let allPrices = [];
        let allTimes = [];
        let pageCount = 0;

        ws.on('open', () => {
            process.stdout.write(`\n  📡 [${symbol}] Descargando ticks (página 1)...`);
            ws.send(JSON.stringify({
                ticks_history: symbol,
                count: 5000,
                end: 'latest',
                style: 'ticks'
            }));
        });

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);

            if (msg.error) {
                ws.close();
                reject(new Error(`API Error [${symbol}]: ${msg.error.message}`));
                return;
            }

            if (msg.msg_type === 'history') {
                const h = msg.history;
                // Prepend (newer ticks arrive first in pagination)
                allPrices = [...h.prices, ...allPrices];
                allTimes = [...h.times, ...allTimes];
                pageCount++;

                process.stdout.write(`\r  📡 [${symbol}] Cargado: ${allPrices.length} ticks (página ${pageCount})...`);

                if (allPrices.length < targetCount && h.prices.length === 5000) {
                    // Request earlier page
                    setTimeout(() => {
                        ws.send(JSON.stringify({
                            ticks_history: symbol,
                            count: 5000,
                            end: String(allTimes[0] - 1),
                            style: 'ticks'
                        }));
                    }, 500);
                } else {
                    ws.close();
                    const digits = allPrices.map(p => getLastDigit(p));
                    console.log(`\n  ✅ [${symbol}] ${digits.length} ticks descargados.\n`);
                    resolve({ digits, prices: allPrices, times: allTimes });
                }
            }
        });

        ws.on('error', (err) => reject(err));
        setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 60000);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  HERRAMIENTAS ESTADÍSTICAS
// ─────────────────────────────────────────────────────────────────────────────

// Chi-cuadrado con tabla de p-values exacta (9 grados de libertad)
function chiSquaredTest(digits) {
    const n = digits.length;
    const freq = Array(10).fill(0);
    digits.forEach(d => freq[d]++);
    const expected = n / 10;
    let chi2 = 0;
    for (let d = 0; d <= 9; d++) {
        chi2 += Math.pow(freq[d] - expected, 2) / expected;
    }
    // Critical values for df=9: p=0.10→14.68, p=0.05→16.92, p=0.01→21.67, p=0.001→27.88
    let pLevel = '>0.10 (Uniforme)';
    if (chi2 > 27.88) pLevel = '<0.001 ⚠️⚠️⚠️ ALTAMENTE NO UNIFORME';
    else if (chi2 > 21.67) pLevel = '<0.01 ⚠️⚠️ MUY NO UNIFORME';
    else if (chi2 > 16.92) pLevel = '<0.05 ⚠️ NO UNIFORME';
    else if (chi2 > 14.68) pLevel = '<0.10 Ligeramente sesgado';
    return { chi2, pLevel, freq, expected };
}

// Autocorrelación Pearson para lag k
function autocorr(digits, lag) {
    const n = digits.length - lag;
    const meanX = digits.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = digits.slice(lag, lag + n).reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = digits[i] - meanX;
        const dy = digits[i + lag] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    return (denX === 0 || denY === 0) ? 0 : num / Math.sqrt(denX * denY);
}

// Construir matriz de transición Markov 1er orden (normalizada)
function buildMarkov1(digits) {
    const counts = Array(10).fill(null).map(() => Array(10).fill(0));
    for (let i = 0; i < digits.length - 1; i++) {
        counts[digits[i]][digits[i + 1]]++;
    }
    const matrix = Array(10).fill(null).map((_, from) => {
        const total = counts[from].reduce((a, b) => a + b, 0);
        return counts[from].map(c => total > 0 ? c / total : 0.1);
    });
    const rawCounts = counts;
    return { matrix, rawCounts };
}

// Construir matriz de transición Markov 2do orden
function buildMarkov2(digits) {
    // Estados: par (from1, from2) → next
    const counts = {};
    for (let i = 0; i <= 9; i++)
        for (let j = 0; j <= 9; j++) {
            const key = `${i},${j}`;
            counts[key] = Array(10).fill(0);
        }

    for (let i = 0; i < digits.length - 2; i++) {
        const key = `${digits[i]},${digits[i + 1]}`;
        counts[key][digits[i + 2]]++;
    }

    const matrix = {};
    for (const key in counts) {
        const total = counts[key].reduce((a, b) => a + b, 0);
        matrix[key] = {
            probs: total > 0 ? counts[key].map(c => c / total) : Array(10).fill(0.1),
            total
        };
    }
    return matrix;
}

// Construir matriz de transición Markov 3er orden
function buildMarkov3(digits) {
    const counts = {};
    for (let i = 0; i < digits.length - 3; i++) {
        const key = `${digits[i]},${digits[i + 1]},${digits[i + 2]}`;
        if (!counts[key]) counts[key] = Array(10).fill(0);
        counts[key][digits[i + 3]]++;
    }

    const matrix = {};
    for (const key in counts) {
        const total = counts[key].reduce((a, b) => a + b, 0);
        matrix[key] = {
            probs: total > 0 ? counts[key].map(c => c / total) : Array(10).fill(0.1),
            total
        };
    }
    return matrix;
}

// Entropía de Shannon
function shannonEntropy(digits) {
    const freq = Array(10).fill(0);
    digits.forEach(d => freq[d]++);
    let h = 0;
    for (const f of freq) {
        const p = f / digits.length;
        if (p > 0) h -= p * Math.log2(p);
    }
    return h;
}

// Test de Rachas (Runs Test)
function runsTest(digits) {
    const median = 4.5; // Mediana teórica de dígitos 0-9
    const binary = digits.map(d => d > median ? 1 : 0);
    let runs = 1;
    let n1 = binary.filter(x => x === 1).length;
    let n2 = binary.filter(x => x === 0).length;
    for (let i = 1; i < binary.length; i++) {
        if (binary[i] !== binary[i - 1]) runs++;
    }
    const expectedRuns = 1 + (2 * n1 * n2) / (n1 + n2);
    const stdRuns = Math.sqrt((2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / (Math.pow(n1 + n2, 2) * (n1 + n2 - 1)));
    const z = (runs - expectedRuns) / stdRuns;
    return { runs, expectedRuns, stdRuns, z, isRandom: Math.abs(z) < 1.96 };
}

// FFT Discreta Simplificada (DFT para detectar periodicidad)
function dft(digits, maxFreqs = 20) {
    const N = digits.length;
    const results = [];
    for (let k = 1; k <= maxFreqs; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
            const angle = -2 * Math.PI * k * n / N;
            re += digits[n] * Math.cos(angle);
            im += digits[n] * Math.sin(angle);
        }
        const magnitude = Math.sqrt(re * re + im * im) / N;
        const period = N / k;
        results.push({ freq: k, magnitude, period });
    }
    return results.sort((a, b) => b.magnitude - a.magnitude);
}

// Test de Gap: distribución de distancias entre apariciones del mismo dígito
function gapTest(digits, targetDigit) {
    const gaps = [];
    let lastPos = -1;
    for (let i = 0; i < digits.length; i++) {
        if (digits[i] === targetDigit) {
            if (lastPos >= 0) gaps.push(i - lastPos);
            lastPos = i;
        }
    }
    if (gaps.length === 0) return null;
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / gaps.length;
    // Para distribución geométrica perfecta: mean=10, var=90
    const expectedMean = 10;
    const expectedVar = 90;
    return { gaps: gaps.length, mean, variance, expectedMean, expectedVar,
             meanDev: ((mean - expectedMean) / expectedMean * 100).toFixed(2),
             varDev: ((variance - expectedVar) / expectedVar * 100).toFixed(2) };
}

// Análisis de clumping: ¿tienden dígitos a aparecer en clusters?
function clumpingAnalysis(digits) {
    // Para cada dígito, contar cuántos aparecen en ventanas de 5 ticks
    // Si hay clumping: más ventanas con 2+ repeticiones del mismo dígito
    const windowSize = 5;
    let clumpWindows = 0;
    let totalWindows = 0;
    for (let i = 0; i <= digits.length - windowSize; i++) {
        const window = digits.slice(i, i + windowSize);
        const freq = {};
        window.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
        const maxFreq = Math.max(...Object.values(freq));
        if (maxFreq >= 3) clumpWindows++;
        totalWindows++;
    }
    const clumpRate = clumpWindows / totalWindows;
    // Probabilidad teórica de ventana con maxFreq>=3 en 5 draws con 10 opciones ≈ 0.068
    const expectedClumpRate = 0.068;
    return { clumpWindows, totalWindows, clumpRate, expectedClumpRate,
             deviation: ((clumpRate - expectedClumpRate) / expectedClumpRate * 100).toFixed(2) };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANÁLISIS ESPECÍFICO DIFFER
// ─────────────────────────────────────────────────────────────────────────────

// Anti-repetición: P(siguiente = X | anterior = X)
function analyzeAntiRepetition(digits) {
    const sameCount = Array(10).fill(0);
    const totalFollowingCount = Array(10).fill(0);
    for (let i = 0; i < digits.length - 1; i++) {
        totalFollowingCount[digits[i]]++;
        if (digits[i + 1] === digits[i]) sameCount[digits[i]]++;
    }
    return Array(10).fill(0).map((_, d) => ({
        digit: d,
        total: totalFollowingCount[d],
        sameNext: sameCount[d],
        prob: totalFollowingCount[d] > 0 ? sameCount[d] / totalFollowingCount[d] : 0
    }));
}

// Análisis post-pérdida: dado que el tick anterior fue X, ¿qué tan probable es X en los próximos 3 ticks?
function analyzePostLoss(digits) {
    const results = {};
    for (let d = 0; d <= 9; d++) {
        results[d] = { lag1: 0, lag2: 0, lag3: 0, count: 0 };
    }
    for (let i = 0; i < digits.length - 3; i++) {
        const x = digits[i];
        results[x].count++;
        if (digits[i + 1] === x) results[x].lag1++;
        if (digits[i + 2] === x) results[x].lag2++;
        if (digits[i + 3] === x) results[x].lag3++;
    }
    return results;
}

// Análisis de Markov 2do orden para encontrar edges en DIFFER
function findDifferEdgesMarkov2(digits, markov2) {
    const edges = [];
    for (const key in markov2) {
        const { probs, total } = markov2[key];
        if (total < 30) continue; // Ignorar estados con pocas observaciones
        // Para DIFFER: queremos P(siguiente=X) lo más bajo posible
        for (let d = 0; d <= 9; d++) {
            const p = probs[d];
            const expectedP = 0.10; // Uniforme
            const deviation = ((p - expectedP) / expectedP * 100);
            if (p < 0.04) { // Menos del 4% — buen DIFFER edge
                const [a, b] = key.split(',').map(Number);
                edges.push({
                    state: `${a}→${b}`,
                    barrier: d,
                    prob: p,
                    total,
                    deviation: deviation.toFixed(1),
                    differEdge: ((0.10 - p) * 100).toFixed(2)
                });
            }
        }
    }
    return edges.sort((a, b) => a.prob - b.prob);
}

// Análisis de racha de mismo dígito y probabilidad de repetición
function streakRepetitionAnalysis(digits) {
    const streakBefore = {};  // Longitud de racha → P(siguiente = mismo)
    let i = 0;
    while (i < digits.length) {
        const d = digits[i];
        let len = 0;
        while (i + len < digits.length && digits[i + len] === d) len++;
        // El siguiente tick después de la racha
        const nextIdx = i + len;
        if (nextIdx < digits.length) {
            const nextIsSame = digits[nextIdx] === d;
            if (!streakBefore[len]) streakBefore[len] = { same: 0, total: 0 };
            streakBefore[len].total++;
            if (nextIsSame) streakBefore[len].same++;
        }
        i += len;
    }
    return streakBefore;
}

// Análisis de pares: ¿hay pares que aparecen juntos con más/menos frecuencia?
function pairAnalysis(digits) {
    const pairCounts = {};
    for (let i = 0; i < 10; i++)
        for (let j = 0; j < 10; j++) pairCounts[`${i}→${j}`] = 0;

    for (let i = 0; i < digits.length - 1; i++) {
        pairCounts[`${digits[i]}→${digits[i + 1]}`]++;
    }

    const n = digits.length - 1;
    const expected = n / 100; // P(any pair) = 1/100
    const anomalies = [];
    for (const key in pairCounts) {
        const obs = pairCounts[key];
        const dev = ((obs - expected) / expected * 100);
        if (Math.abs(dev) > 30) {
            anomalies.push({ pair: key, obs, expected: expected.toFixed(1), dev: dev.toFixed(1) });
        }
    }
    return { pairCounts, anomalies: anomalies.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)) };
}

// Análisis temporal: patrones por hora del día
function temporalAnalysis(digits, times) {
    if (!times || times.length !== digits.length) return null;
    const hourBuckets = {};
    for (let h = 0; h < 24; h++) hourBuckets[h] = Array(10).fill(0);

    for (let i = 0; i < digits.length; i++) {
        const hour = new Date(times[i] * 1000).getUTCHours();
        hourBuckets[hour][digits[i]]++;
    }

    const results = {};
    for (const h in hourBuckets) {
        const total = hourBuckets[h].reduce((a, b) => a + b, 0);
        if (total === 0) continue;
        const expected = total / 10;
        let chi2 = 0;
        for (const cnt of hourBuckets[h]) chi2 += Math.pow(cnt - expected, 2) / expected;
        results[h] = { total, chi2, significant: chi2 > 16.92, freq: hourBuckets[h] };
    }
    return results;
}

// Análisis de "Drought" (sequía) y probabilidad condicional
function droughtAnalysis(digits) {
    const results = {};
    for (let d = 0; d <= 9; d++) {
        results[d] = { droughts: [], condProbs: {} };
        let drought = 0;
        for (let i = 0; i < digits.length; i++) {
            if (digits[i] === d) {
                if (drought > 0) {
                    if (!results[d].condProbs[drought]) results[d].condProbs[drought] = { appear: 0, total: 0 };
                    results[d].condProbs[drought].total++;
                    results[d].condProbs[drought].appear++;
                    results[d].droughts.push(drought);
                }
                drought = 0;
            } else {
                drought++;
            }
        }
    }
    return results;
}

// DIFFER Backtest: con diferentes estrategias de selección de barrera
function backtestDifferStrategies(digits) {
    const DIFF_WIN_RATE = 0.0943; // ~9.43% profit en DIGITDIFF (pago ~$1.094)
    const strategies = {
        'Aleatorio (control)':         { wins: 0, losses: 0 },
        'Mismo dígito actual':         { wins: 0, losses: 0 },
        'Dígito anterior (lag-1)':     { wins: 0, losses: 0 },
        'Dígito más frío (últ. 20)':   { wins: 0, losses: 0 },
        'Dígito más frío (últ. 50)':   { wins: 0, losses: 0 },
        'Dígito más caliente (últ.20)':{ wins: 0, losses: 0 },
        'Anti-racha (rep. 3x)':        { wins: 0, losses: 0 },
        'Dígito opuesto (+5 mod 10)':  { wins: 0, losses: 0 },
        'Markov 2do orden (min prob)': { wins: 0, losses: 0 },
    };

    // Pre-calcular Markov2
    const { matrix: m1 } = buildMarkov1(digits);
    const m2 = buildMarkov2(digits);

    for (let i = 50; i < digits.length - 1; i++) {
        const next = digits[i + 1];
        const window20 = digits.slice(i - 20, i);
        const window50 = digits.slice(i - 50, i);

        // Frío 20
        const freq20 = Array(10).fill(0);
        window20.forEach(d => freq20[d]++);
        const cold20 = freq20.indexOf(Math.min(...freq20));

        // Frío 50
        const freq50 = Array(10).fill(0);
        window50.forEach(d => freq50[d]++);
        const cold50 = freq50.indexOf(Math.min(...freq50));

        // Caliente 20
        const hot20 = freq20.indexOf(Math.max(...freq20));

        // Anti-racha
        let antistreakBarrier = null;
        if (digits[i] === digits[i - 1] && digits[i - 1] === digits[i - 2]) {
            antistreakBarrier = digits[i];
        }

        // Markov 2do orden → buscar dígito menos probable dado estado actual
        const stateKey = `${digits[i - 1]},${digits[i]}`;
        let markov2Barrier = 0;
        let minProb2 = 1;
        if (m2[stateKey] && m2[stateKey].total >= 20) {
            for (let d = 0; d <= 9; d++) {
                if (m2[stateKey].probs[d] < minProb2) {
                    minProb2 = m2[stateKey].probs[d];
                    markov2Barrier = d;
                }
            }
        } else {
            markov2Barrier = null;
        }

        const bets = [
            { name: 'Aleatorio (control)',          barrier: Math.floor(Math.random() * 10) },
            { name: 'Mismo dígito actual',          barrier: digits[i] },
            { name: 'Dígito anterior (lag-1)',      barrier: digits[i - 1] },
            { name: 'Dígito más frío (últ. 20)',    barrier: cold20 },
            { name: 'Dígito más frío (últ. 50)',    barrier: cold50 },
            { name: 'Dígito más caliente (últ.20)', barrier: hot20 },
            { name: 'Anti-racha (rep. 3x)',         barrier: antistreakBarrier },
            { name: 'Dígito opuesto (+5 mod 10)',   barrier: (digits[i] + 5) % 10 },
            { name: 'Markov 2do orden (min prob)',  barrier: markov2Barrier },
        ];

        for (const bet of bets) {
            if (bet.barrier === null) continue;
            const s = strategies[bet.name];
            if (next !== bet.barrier) s.wins++;
            else s.losses++;
        }
    }

    return { strategies, winRate: DIFF_WIN_RATE };
}

// ─────────────────────────────────────────────────────────────────────────────
//  REPORTE FINAL
// ─────────────────────────────────────────────────────────────────────────────
function printReport(symbol, digits, times) {
    const n = digits.length;
    const sep = '═'.repeat(70);
    const sep2 = '─'.repeat(70);
    console.log(`\n${sep}`);
    console.log(`  🔬 ANÁLISIS COMPLETO: ${symbol}  (N=${n} ticks)`);
    console.log(sep);

    // ══════════════════════════════════════════
    // TEST A: Distribución + Chi-cuadrado
    // ══════════════════════════════════════════
    console.log(`\n  ── A. CHI-CUADRADO DE UNIFORMIDAD (9 df) ──────────────────────`);
    const chi = chiSquaredTest(digits);
    console.log(`  Chi² = ${chi.chi2.toFixed(4)} | p-value: ${chi.pLevel}`);
    console.log(`  Expected por dígito: ${chi.expected.toFixed(1)}`);
    console.log(`\n  Dígito | Frec | % Obs | % Esp | Desv%  | Barra`);
    console.log(`  ${'─'.repeat(55)}`);
    for (let d = 0; d <= 9; d++) {
        const obs = chi.freq[d];
        const pct = (obs / n * 100).toFixed(2);
        const dev = ((obs - chi.expected) / chi.expected * 100).toFixed(2);
        const bar = '█'.repeat(Math.round(Math.abs(obs - chi.expected) / chi.expected * 20));
        const flag = Math.abs(parseFloat(dev)) > 5 ? ' ⚠️' : '';
        console.log(`     ${d}   | ${String(obs).padStart(4)} | ${pct.padStart(5)}% |  10.00% | ${(parseFloat(dev) >= 0 ? '+' : '')}${dev.padStart(5)}% | ${bar}${flag}`);
    }

    // ══════════════════════════════════════════
    // TEST B: Autocorrelación lag 1-50
    // ══════════════════════════════════════════
    console.log(`\n  ── B. AUTOCORRELACIÓN (Lags 1–50) ─────────────────────────────`);
    console.log(`  (|r| > 0.028 es estadísticamente significativo para N=5000, p<0.05)`);
    const threshold = 1.96 / Math.sqrt(n);
    let autocorrAnomalies = [];
    const lagResults = [];
    for (let lag = 1; lag <= 50; lag++) {
        const r = autocorr(digits, lag);
        lagResults.push({ lag, r });
        if (Math.abs(r) > threshold) autocorrAnomalies.push({ lag, r });
    }
    // Mostrar todos con compacto
    const lags1_10 = lagResults.slice(0, 10).map(l => `  Lag ${String(l.lag).padStart(2)}: r=${l.r.toFixed(5)}${Math.abs(l.r) > threshold ? ' ⚠️' : ''}`).join('\n');
    console.log(lags1_10);
    console.log(`  [Lags 11-50 resumido — Anomalías detectadas:]`);
    if (autocorrAnomalies.filter(a => a.lag > 10).length === 0) {
        console.log(`  Ninguna anomalía significativa (|r| > ${threshold.toFixed(4)}) en lags 11-50`);
    } else {
        autocorrAnomalies.filter(a => a.lag > 10).forEach(a =>
            console.log(`  Lag ${String(a.lag).padStart(2)}: r=${a.r.toFixed(5)} ⚠️ SIGNIFICATIVO`)
        );
    }
    if (autocorrAnomalies.length === 0) {
        console.log(`  ✅ CONCLUSIÓN: Sin autocorrelación significativa detectada`);
    } else {
        console.log(`  ⚠️ CONCLUSIÓN: ${autocorrAnomalies.length} lags con correlación significativa (|r|>${threshold.toFixed(4)})`);
        console.log(`     Lags: ${autocorrAnomalies.map(a => a.lag).join(', ')}`);
    }

    // ══════════════════════════════════════════
    // TEST C: Análisis de Rachas
    // ══════════════════════════════════════════
    console.log(`\n  ── C. ANÁLISIS DE RACHAS CONSECUTIVAS ─────────────────────────`);
    const streakCounts = {};
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
    console.log(`  Long | Observado | Esperado  | Desv%   | Veredicto`);
    console.log(`  ${'─'.repeat(55)}`);
    for (let len = 1; len <= 8; len++) {
        const obs = streakCounts[len] || 0;
        // Esperado: n * P(racha de long L) ≈ n * 0.9 * (0.1)^(L-1) * 0.9
        // Fórmula exacta: P(racha exactamente L) = (1/10)^(L-1) * (9/10)^2  para L>=2
        // Para L=1: P = (9/10) = 0.9
        let expected;
        if (len === 1) expected = n * 0.9;
        else expected = n * Math.pow(0.1, len - 1) * 0.81;
        const dev = expected > 0 ? ((obs - expected) / expected * 100).toFixed(2) : 'N/A';
        const flag = Math.abs(parseFloat(dev)) > 25 ? ' ⚠️' : '';
        console.log(`   ${len}    | ${String(obs).padStart(8)} | ${expected.toFixed(1).padStart(9)} | ${(parseFloat(dev) >= 0 ? '+' : '')}${String(dev).padStart(6)}% |${flag}`);
    }

    // ══════════════════════════════════════════
    // TEST D: Markov 1er Orden
    // ══════════════════════════════════════════
    console.log(`\n  ── D. MARKOV 1er ORDEN — TRANSICIONES ANÓMALAS ────────────────`);
    const { matrix: m1, rawCounts: rc } = buildMarkov1(digits);
    let m1anomalies = [];
    for (let from = 0; from <= 9; from++) {
        for (let to = 0; to <= 9; to++) {
            const p = m1[from][to];
            const total = rc[from].reduce((a, b) => a + b, 0);
            const dev = ((p - 0.1) / 0.1 * 100);
            if (Math.abs(dev) > 25 && total > 50) {
                m1anomalies.push({ from, to, p: (p * 100).toFixed(2), dev: dev.toFixed(1), total });
            }
        }
    }
    m1anomalies.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
    if (m1anomalies.length === 0) {
        console.log(`  ✅ Sin transiciones anómalas >25% desviación en Markov 1er orden`);
    } else {
        console.log(`  Encontradas ${m1anomalies.length} transiciones anómalas (>25% desv. de 10%):`);
        console.log(`  Desde→Hacia | P(trans.)% | Desv.%   | N-obs`);
        console.log(`  ${'─'.repeat(45)}`);
        m1anomalies.slice(0, 15).forEach(a =>
            console.log(`     ${a.from}→${a.to}       |   ${a.p.padStart(5)}%    | ${(parseFloat(a.dev) >= 0 ? '+' : '')}${a.dev.padStart(6)}%  | ${a.total}`)
        );
    }

    // TABLA COMPLETA Markov 1er orden
    console.log(`\n  Matriz completa P(j|i) × 100% (filas=origen, cols=destino):`);
    process.stdout.write('       ');
    for (let j = 0; j <= 9; j++) process.stdout.write(`  ${j}   `);
    console.log();
    for (let i = 0; i <= 9; i++) {
        process.stdout.write(`  [${i}]  `);
        for (let j = 0; j <= 9; j++) {
            const v = (m1[i][j] * 100).toFixed(1).padStart(5);
            const isAnomaly = Math.abs(m1[i][j] - 0.1) > 0.025;
            process.stdout.write(` ${isAnomaly ? '*' : ' '}${v}`);
        }
        console.log();
    }
    console.log(`  (* = desviación >25% del valor esperado 10.0%)`);

    // ══════════════════════════════════════════
    // TEST E: Markov 2do Orden — CLAVE
    // ══════════════════════════════════════════
    console.log(`\n  ── E. MARKOV 2do ORDEN — EDGES DIFFER ─────────────────────────`);
    const m2 = buildMarkov2(digits);
    const edges2 = findDifferEdgesMarkov2(digits, m2);
    if (edges2.length === 0) {
        console.log(`  ✅ Sin edges Markov-2 significativos (<4% prob con N>=30)`);
    } else {
        console.log(`  ⚠️ EDGES EXPLOTABLES DETECTADOS (P(X|estado) < 4%):`)
        console.log(`  Estado | Barrera | P(X)% | Desv.%  | N-obs  | EDGE DIFFER`);
        console.log(`  ${'─'.repeat(60)}`);
        edges2.slice(0, 20).forEach(e =>
            console.log(`  ${e.state.padEnd(7)}| ${e.barrier.toString().padStart(5)}   | ${(e.prob * 100).toFixed(2).padStart(5)}% | ${e.deviation.padStart(7)}% | ${String(e.total).padStart(5)}  | +${e.differEdge}%`)
        );
    }

    // ══════════════════════════════════════════
    // TEST F: Markov 3er Orden
    // ══════════════════════════════════════════
    console.log(`\n  ── F. MARKOV 3er ORDEN — TOP EDGES ────────────────────────────`);
    const m3 = buildMarkov3(digits);
    let edges3 = [];
    for (const key in m3) {
        const { probs, total } = m3[key];
        if (total < 20) continue;
        for (let d = 0; d <= 9; d++) {
            if (probs[d] < 0.03) {
                edges3.push({ state: key, barrier: d, prob: probs[d], total, edge: ((0.10 - probs[d]) * 100).toFixed(2) });
            }
        }
    }
    edges3.sort((a, b) => a.prob - b.prob);
    if (edges3.length === 0) {
        console.log(`  ✅ Sin edges Markov-3 significativos (<3% con N>=20)`);
    } else {
        console.log(`  ⚠️ ${edges3.length} estados de 3er orden con P < 3%:`);
        edges3.slice(0, 10).forEach(e =>
            console.log(`  [${e.state}]→ barrera=${e.barrier}: P=${(e.prob * 100).toFixed(2)}% (edge=+${e.edge}%, N=${e.total})`)
        );
    }

    // ══════════════════════════════════════════
    // TEST G: Anti-repetición (Post-pérdida DIFFER)
    // ══════════════════════════════════════════
    console.log(`\n  ── G. ANTI-REPETICIÓN — P(siguiente=X | anterior=X) ──────────`);
    console.log(`  (Teórico esperado: 10.0% — si <10% hay anti-clustering explotable)`);
    const antiRep = analyzeAntiRepetition(digits);
    console.log(`  Dígito | N-obs | P(repite%)| vs 10%    | Verdict`);
    console.log(`  ${'─'.repeat(55)}`);
    let totalRepetitions = 0;
    antiRep.forEach(r => {
        totalRepetitions += r.sameNext;
        const dev = ((r.prob - 0.10) / 0.10 * 100).toFixed(2);
        const flag = Math.abs(r.prob - 0.10) > 0.02 ? ' ⚠️' : ' ✅';
        console.log(`     ${r.digit}   | ${String(r.total).padStart(4)} | ${(r.prob * 100).toFixed(2).padStart(7)}% | ${(parseFloat(dev) >= 0 ? '+' : '')}${dev.padStart(7)}% |${flag}`);
    });
    const overallRepRate = totalRepetitions / (n - 1);
    console.log(`\n  Tasa global de repetición: ${(overallRepRate * 100).toFixed(3)}% (esperado: 10.000%)`);
    const repDev = ((overallRepRate - 0.10) / 0.10 * 100).toFixed(3);
    console.log(`  Desviación global: ${repDev}%`);
    console.log(`  → ESTRATEGIA DIFFER: Apostar DIFFER en el dígito que acaba de salir`);
    console.log(`    Si P(repite) < 10% → EDGE positivo para esa barrera`);

    // ══════════════════════════════════════════
    // TEST H: Post-pérdida (lag 1-3 del mismo dígito)
    // ══════════════════════════════════════════
    console.log(`\n  ── H. ANÁLISIS POST-PÉRDIDA (Condicional lag 1-3) ─────────────`);
    const postLoss = analyzePostLoss(digits);
    console.log(`  Dígito | N  |  P(lag1=X)% | P(lag2=X)% | P(lag3=X)%`);
    console.log(`  ${'─'.repeat(60)}`);
    for (let d = 0; d <= 9; d++) {
        const r = postLoss[d];
        const p1 = r.count > 0 ? (r.lag1 / r.count * 100).toFixed(2) : 'N/A';
        const p2 = r.count > 0 ? (r.lag2 / r.count * 100).toFixed(2) : 'N/A';
        const p3 = r.count > 0 ? (r.lag3 / r.count * 100).toFixed(2) : 'N/A';
        const flag = (parseFloat(p1) < 7 || parseFloat(p1) > 13) ? ' ⚠️' : '';
        console.log(`     ${d}   |${String(r.count).padStart(4)}| ${p1.padStart(10)}% | ${p2.padStart(10)}% | ${p3.padStart(10)}%${flag}`);
    }

    // ══════════════════════════════════════════
    // TEST I: FFT / Análisis Espectral
    // ══════════════════════════════════════════
    console.log(`\n  ── I. ANÁLISIS ESPECTRAL (DFT — Top 10 frecuencias) ───────────`);
    const sampleForFFT = digits.slice(0, Math.min(2000, n));
    const spectrum = dft(sampleForFFT, 30);
    const avgMagnitude = spectrum.reduce((a, b) => a + b.magnitude, 0) / spectrum.length;
    console.log(`  Frecuencia | Magnitud  | Período (ticks) | ¿Significativo?`);
    console.log(`  ${'─'.repeat(55)}`);
    spectrum.slice(0, 10).forEach(s => {
        const isSignificant = s.magnitude > avgMagnitude * 3;
        console.log(`     k=${String(s.freq).padStart(3)}   | ${s.magnitude.toFixed(5)} | ${s.period.toFixed(1).padStart(14)} | ${isSignificant ? '⚠️ PICO DETECTADO' : '✅ Normal'}`);
    });
    console.log(`  Magnitud promedio del espectro: ${avgMagnitude.toFixed(5)}`);

    // ══════════════════════════════════════════
    // TEST J: Gap Test
    // ══════════════════════════════════════════
    console.log(`\n  ── J. TEST DE GAP (distribución de distancias entre iguales) ──`);
    console.log(`  (Distribución geométrica perfecta: media=10, varianza=90)`);
    console.log(`  Dígito | N-gaps | Media  | Var.    | ΔMedia% | ΔVar%`);
    console.log(`  ${'─'.repeat(60)}`);
    let gapAnomalies = 0;
    for (let d = 0; d <= 9; d++) {
        const g = gapTest(digits, d);
        if (!g) continue;
        const meanFlag = Math.abs(parseFloat(g.meanDev)) > 10 ? ' ⚠️' : '';
        console.log(`     ${d}   | ${String(g.gaps).padStart(5)} | ${g.mean.toFixed(2).padStart(5)} | ${g.variance.toFixed(1).padStart(6)} | ${(parseFloat(g.meanDev) >= 0 ? '+' : '')}${g.meanDev.padStart(6)}%${meanFlag} | ${(parseFloat(g.varDev) >= 0 ? '+' : '')}${g.varDev}%`);
        if (Math.abs(parseFloat(g.meanDev)) > 10) gapAnomalies++;
    }
    if (gapAnomalies === 0) {
        console.log(`  ✅ Distribución de gaps consistente con distribución geométrica`);
    } else {
        console.log(`  ⚠️ ${gapAnomalies} dígitos con distribución de gaps significativamente diferente`);
    }

    // ══════════════════════════════════════════
    // TEST K: Análisis de Pares
    // ══════════════════════════════════════════
    console.log(`\n  ── K. ANÁLISIS DE PARES CONSECUTIVOS ──────────────────────────`);
    const { anomalies: pairAnom } = pairAnalysis(digits);
    if (pairAnom.length === 0) {
        console.log(`  ✅ Ningún par con desviación >30% del esperado`);
    } else {
        console.log(`  ⚠️ ${pairAnom.length} pares con desviación >30%:`);
        console.log(`  Par  | Observado | Esperado | Desv%`);
        pairAnom.slice(0, 12).forEach(p =>
            console.log(`  ${p.pair.padEnd(5)}| ${String(p.obs).padStart(8)} | ${p.expected.padStart(7)} | ${(parseFloat(p.dev) >= 0 ? '+' : '')}${p.dev}%`)
        );
    }

    // ══════════════════════════════════════════
    // TEST L: Clumping
    // ══════════════════════════════════════════
    console.log(`\n  ── L. ANÁLISIS DE CLUMPING (ventanas de 5 ticks) ──────────────`);
    const clump = clumpingAnalysis(digits);
    const clumpDev = ((clump.clumpRate - clump.expectedClumpRate) / clump.expectedClumpRate * 100).toFixed(2);
    console.log(`  Ventanas con maxFreq>=3: ${clump.clumpWindows}/${clump.totalWindows} (${(clump.clumpRate * 100).toFixed(3)}%)`);
    console.log(`  Esperado teórico: ${(clump.expectedClumpRate * 100).toFixed(3)}%`);
    console.log(`  Desviación: ${clumpDev}% ${Math.abs(parseFloat(clumpDev)) > 20 ? '⚠️ CLUMPING ANÓMALO' : '✅ Normal'}`);

    // ══════════════════════════════════════════
    // TEST M: Análisis Temporal
    // ══════════════════════════════════════════
    if (times) {
        console.log(`\n  ── M. ANÁLISIS TEMPORAL (por hora UTC) ─────────────────────────`);
        const temporal = temporalAnalysis(digits, times);
        if (temporal) {
            let significantHours = [];
            console.log(`  Hora UTC | N-ticks | Chi²   | ¿No uniforme?`);
            console.log(`  ${'─'.repeat(45)}`);
            for (const h in temporal) {
                const r = temporal[h];
                console.log(`     ${String(h).padStart(2)}:00  | ${String(r.total).padStart(6)} | ${r.chi2.toFixed(2).padStart(5)} | ${r.significant ? '⚠️ SÍ — Sesgo en esta hora' : '✅ Uniforme'}`);
                if (r.significant) significantHours.push(parseInt(h));
            }
            if (significantHours.length > 0) {
                console.log(`\n  ⚠️ HORAS CON DISTRIBUCIÓN NO UNIFORME: ${significantHours.join(', ')}h UTC`);
                console.log(`  → Posible oportunidad de explotación temporal`);
            }
        }
    }

    // ══════════════════════════════════════════
    // TEST N: Runs Test
    // ══════════════════════════════════════════
    console.log(`\n  ── N. RUNS TEST (Aleatoriedad global) ──────────────────────────`);
    const rt = runsTest(digits);
    console.log(`  Runs observados: ${rt.runs} | Esperados: ${rt.expectedRuns.toFixed(1)} | Std: ${rt.stdRuns.toFixed(2)}`);
    console.log(`  Z-Score: ${rt.z.toFixed(4)} | Veredicto: ${rt.isRandom ? '✅ Aleatorio (p>0.05)' : '⚠️ NO ALEATORIO (p<0.05)'}`);

    // ══════════════════════════════════════════
    // TEST O: Entropía de Shannon
    // ══════════════════════════════════════════
    console.log(`\n  ── O. ENTROPÍA DE SHANNON ──────────────────────────────────────`);
    const H_max = Math.log2(10); // 3.3219 bits para uniforme perfecta
    const H_global = shannonEntropy(digits);
    console.log(`  Entropía global: ${H_global.toFixed(5)} bits (máx teórico: ${H_max.toFixed(5)} bits)`);
    console.log(`  Eficiencia: ${(H_global / H_max * 100).toFixed(3)}%`);
    // Entropía por ventanas
    const windowSizes = [50, 100, 200];
    for (const ws of windowSizes) {
        let minH = Infinity, maxH = -Infinity;
        for (let i = ws; i <= digits.length; i += ws) {
            const H = shannonEntropy(digits.slice(i - ws, i));
            if (H < minH) minH = H;
            if (H > maxH) maxH = H;
        }
        console.log(`  Ventana ${ws}: min=${minH.toFixed(4)} bits, max=${maxH.toFixed(4)} bits (rango=${(maxH - minH).toFixed(4)})`);
    }

    // ══════════════════════════════════════════
    // TEST P: Racha de repetición y DIFFER edge
    // ══════════════════════════════════════════
    console.log(`\n  ── P. RACHA DE REPETICIÓN → PROBABILIDAD SIGUIENTE IGUAL ────`);
    const streakRep = streakRepetitionAnalysis(digits);
    console.log(`  Long.racha | N | P(sigue=mismo)% | vs 10% | DIFFER edge`);
    console.log(`  ${'─'.repeat(55)}`);
    for (let L = 1; L <= 6; L++) {
        const r = streakRep[L];
        if (!r || r.total < 5) continue;
        const prob = r.same / r.total;
        const dev = ((prob - 0.10) / 0.10 * 100).toFixed(1);
        const differEdge = ((0.10 - prob) / 0.10 * 100).toFixed(1);
        const flag = prob < 0.07 ? ' ⚠️ EXPLOTABLE' : '';
        console.log(`     ${L}          |${String(r.total).padStart(4)}| ${(prob * 100).toFixed(2).padStart(13)}% | ${(parseFloat(dev) >= 0 ? '+' : '')}${dev.padStart(6)}% | ${differEdge}%${flag}`);
    }

    // ══════════════════════════════════════════
    // TEST Q: Backtest DIFFER Estrategias
    // ══════════════════════════════════════════
    console.log(`\n  ── Q. BACKTEST DIFFER: TODAS LAS ESTRATEGIAS ──────────────────`);
    console.log(`  (Payout DIGITDIFF ~$1.094 por $1, necesita >91.7% WR para BE)`);
    const { strategies } = backtestDifferStrategies(digits);
    console.log(`  Estrategia                      | Wins  | Losses| WR%   | PnL ($1 stake, ${n} ticks)`);
    console.log(`  ${'─'.repeat(75)}`);
    for (const name in strategies) {
        const s = strategies[name];
        const total = s.wins + s.losses;
        const wr = total > 0 ? (s.wins / total * 100).toFixed(2) : '0.00';
        // PnL: win=+0.0943, loss=-1
        const pnl = s.wins * 0.0943 - s.losses * 1;
        const flag = s.wins / total > 0.917 ? ' ✅ RENTABLE' : (s.wins / total > 0.90 ? ' 🟡 CERCA' : '');
        const icon = parseFloat(wr) > 91.7 ? '⭐' : '  ';
        console.log(`  ${icon} ${name.padEnd(32)}|${String(s.wins).padStart(6)} |${String(s.losses).padStart(6)} | ${wr.padStart(5)}% | $${pnl.toFixed(2)}${flag}`);
    }

    // ══════════════════════════════════════════
    // RESUMEN Y CONCLUSIONES
    // ══════════════════════════════════════════
    console.log(`\n${sep}`);
    console.log(`  🏆 RESUMEN EJECUTIVO — ${symbol}`);
    console.log(sep);

    // Calcular hallazgos significativos
    const findings = [];

    if (chi.chi2 > 16.92) {
        const biasedDigits = [];
        for (let d = 0; d <= 9; d++) {
            const dev = (chi.freq[d] - chi.expected) / chi.expected;
            if (Math.abs(dev) > 0.05) biasedDigits.push({ d, dev: (dev * 100).toFixed(1) });
        }
        findings.push(`⚠️ CHI²=${chi.chi2.toFixed(2)}: Distribución NO uniforme — ${chi.pLevel}`);
        biasedDigits.forEach(b => findings.push(`   Dígito ${b.d}: ${b.dev}% de desviación`));
    } else {
        findings.push(`✅ Chi²=${chi.chi2.toFixed(2)}: Distribución uniforme (p>0.05)`);
    }

    if (!rt.isRandom) {
        findings.push(`⚠️ Runs Test Z=${rt.z.toFixed(3)}: Secuencia NO aleatoria`);
    } else {
        findings.push(`✅ Runs Test Z=${rt.z.toFixed(3)}: Secuencia aleatoria`);
    }

    if (autocorrAnomalies.length > 0) {
        findings.push(`⚠️ Autocorrelaciones significativas en lags: ${autocorrAnomalies.map(a => a.lag).join(', ')}`);
    } else {
        findings.push(`✅ Sin autocorrelación significativa (umbral |r|>${threshold.toFixed(4)})`);
    }

    if (m1anomalies.length > 0) {
        findings.push(`⚠️ Markov 1er orden: ${m1anomalies.length} transiciones anómalas`);
        findings.push(`   Top: ${m1anomalies[0].from}→${m1anomalies[0].to} = ${m1anomalies[0].p}% (desv. ${m1anomalies[0].dev}%)`);
    } else {
        findings.push(`✅ Markov 1er orden: Sin transiciones anómalas`);
    }

    if (edges2.length > 0) {
        findings.push(`⭐ MARKOV 2do ORDEN: ${edges2.length} EDGES EXPLOTABLES PARA DIFFER`);
        findings.push(`   Mejor: estado ${edges2[0].state}, barrera=${edges2[0].barrier}, P=${(edges2[0].prob * 100).toFixed(2)}% (edge=+${edges2[0].differEdge}%)`);
    } else {
        findings.push(`✅ Markov 2do orden: Sin edges Markov-2 significativos`);
    }

    if (edges3.length > 0) {
        findings.push(`⭐ MARKOV 3er ORDEN: ${edges3.length} estados con P<3%`);
    }

    if (Math.abs(parseFloat(clumpDev)) > 20) {
        findings.push(`⚠️ CLUMPING ${parseFloat(clumpDev) > 0 ? 'EXCESIVO' : 'REDUCIDO'}: ${clumpDev}% vs esperado`);
    }

    console.log();
    findings.forEach(f => console.log(`  ${f}`));

    console.log(`\n  📐 Magnitud del edge DIFFER (si existe):`);
    console.log(`     Break-even base: 91.7% WR ($1.094 payout)`);
    console.log(`     Para ser rentable: necesitas que P(barrera=X) < 8.33%`);

    if (edges2.length > 0) {
        console.log(`\n  ⭐ EDGE IDENTIFICADO vía MARKOV 2do ORDEN:`);
        edges2.slice(0, 5).forEach(e => {
            const impliedWR = ((1 - e.prob) * 100).toFixed(2);
            const edge = (parseFloat(impliedWR) - 91.7).toFixed(2);
            console.log(`     Estado [${e.state}] → barrera ${e.barrier}: WR implícito = ${impliedWR}% (edge = ${edge}% sobre BE)`);
        });
    }

    console.log(`\n${sep}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANÁLISIS CRUZADO ENTRE SÍMBOLOS
// ─────────────────────────────────────────────────────────────────────────────
function crossMarketAnalysis(dataMap) {
    const symbols = Object.keys(dataMap);
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  🔗 ANÁLISIS CRUZADO ENTRE MERCADOS`);
    console.log(`${'═'.repeat(70)}`);

    for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
            const a = dataMap[symbols[i]].digits;
            const b = dataMap[symbols[j]].digits;
            const minLen = Math.min(a.length, b.length);
            let match = 0;
            for (let k = 0; k < minLen; k++) if (a[k] === b[k]) match++;
            const pct = (match / minLen * 100).toFixed(3);
            const flag = parseFloat(pct) > 11.5 ? ' ⚠️ CORRELADOS' : ' ✅ Independientes';
            console.log(`  ${symbols[i]} ↔ ${symbols[j]}: ${pct}% coincidencia simultánea (esperado: 10.000%)${flag}`);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n' + '╔' + '═'.repeat(68) + '╗');
    console.log('║   🔬 ANÁLISIS ESTADÍSTICO PROFUNDO — DERIV DIFFER ENGINE      ║');
    console.log('║   Búsqueda de fallas en PRNG para contratos DIGITDIFF         ║');
    console.log('╚' + '═'.repeat(68) + '╝');
    console.log(`\n  Conexión: wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);
    console.log(`  Símbolos: ${SYMBOLS.join(', ')}`);
    console.log(`  Objetivo: ${TARGET_TICKS}+ ticks por símbolo`);
    console.log(`  Inicio: ${new Date().toISOString()}\n`);

    const dataMap = {};

    for (const sym of SYMBOLS) {
        try {
            console.log(`\n${'─'.repeat(50)}`);
            console.log(`  📥 Descargando ${TARGET_TICKS}+ ticks de ${sym}...`);
            const data = await downloadTicks(sym, TARGET_TICKS);
            dataMap[sym] = data;
        } catch (err) {
            console.error(`  ❌ Error descargando ${sym}: ${err.message}`);
            process.exit(1);
        }
        // Pequeño delay entre símbolos para no saturar la API
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log('\n' + '═'.repeat(70));
    console.log('  📊 INICIANDO ANÁLISIS ESTADÍSTICO COMPLETO...');
    console.log('═'.repeat(70));

    for (const sym of SYMBOLS) {
        const { digits, times } = dataMap[sym];
        printReport(sym, digits, times);
    }

    // Análisis cruzado
    crossMarketAnalysis(dataMap);

    console.log('\n' + '╔' + '═'.repeat(68) + '╗');
    console.log('║   ✅ ANÁLISIS COMPLETADO                                       ║');
    console.log(`║   Fin: ${new Date().toISOString().padEnd(60)}║`);
    console.log('╚' + '═'.repeat(68) + '╝\n');
}

main().catch(err => {
    console.error('\n❌ ERROR FATAL:', err);
    process.exit(1);
});
