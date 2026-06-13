import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

// 1. Add state variable
if (!serverContent.includes('engineMarkovDiffers: false')) {
    serverContent = serverContent.replace(
        'engineCodyBarrier: true,',
        'engineCodyBarrier: true,\n    engineMarkovDiffers: false,'
    );
}

// 2. Add to engineStats
if (!serverContent.includes('MARKOV_DIFFERS: {')) {
    serverContent = serverContent.replace(
        'CODY_BARRIER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }',
        'CODY_BARRIER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },\n        MARKOV_DIFFERS: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }'
    );
}

// 3. Add to API toggle
if (!serverContent.includes("'MARKOV_DIFFERS': 'engineMarkovDiffers'")) {
    serverContent = serverContent.replace(
        "'CODY_BARRIER': 'engineCodyBarrier'",
        "'CODY_BARRIER': 'engineCodyBarrier',\n        'MARKOV_DIFFERS': 'engineMarkovDiffers'"
    );
}

// 4. Add Markov Logic
const markovCode = `
// 🎯 MOTOR 7: MARKOV DIFFERS (Volatility 50 / R_50)
const TRAINING_WINDOW = 2000;
const THRESHOLD_PERCENT = 2.0;
botState.markovHistory = {}; // Store ticks for markov

function evaluateMarkovDiffers() {
    if (!botState.engineMarkovDiffers) return null;
    const sym = 'R_50';
    
    if (!botState.markovHistory[sym]) return null;
    const hist = botState.markovHistory[sym];
    if (hist.length < TRAINING_WINDOW) return null;

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
            if (prob > 0 && prob <= THRESHOLD_PERCENT) {
                if (prob < lowestProb) {
                    lowestProb = prob;
                    bestTarget = target;
                }
            }
        }
    }

    if (bestTarget !== -1) {
        console.log(\`🎯 [MARKOV DIFFERS] Riesgo \${lowestProb.toFixed(2)}% | Último: \${currentDigit}. Apuntando DIGITDIFF a \${bestTarget}\`);
        return {
            engine: 'MARKOV_DIFFERS',
            contractType: 'DIGITDIFF',
            symbol: sym,
            barrier: String(bestTarget),
            ticksRemaining: 1,
            reason: \`Markov Prob \${lowestProb.toFixed(1)}%\`
        };
    }
    return null;
}
`;

if (!serverContent.includes('evaluateMarkovDiffers()')) {
    serverContent = serverContent.replace(
        'function evaluateCodyBarrier(mState) {',
        markovCode + '\nfunction evaluateCodyBarrier(mState) {'
    );
}

// 5. Inject tick history gathering
const tickInject = `
        const sym = msg.tick.symbol;
        if (sym === 'R_50') {
            if (!botState.markovHistory[sym]) botState.markovHistory[sym] = [];
            const d = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
            botState.markovHistory[sym].push(d);
            if (botState.markovHistory[sym].length > TRAINING_WINDOW) botState.markovHistory[sym].shift();
            // Don't process normal Boom logic for R_50
            if (msg.tick.symbol !== SYMBOL) return;
        }
`;

if (!serverContent.includes("botState.markovHistory[sym].push(d);")) {
    serverContent = serverContent.replace(
        "if (msg.msg_type === 'tick') {",
        "if (msg.msg_type === 'tick') {" + tickInject
    );
}

// 6. Subscribe to R_50
if (!serverContent.includes("ticks_history: 'R_50'")) {
    serverContent = serverContent.replace(
        "ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'ticks', subscribe: 1 }));",
        "ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'ticks', subscribe: 1 }));\n        ws.send(JSON.stringify({ ticks_history: 'R_50', end: 'latest', count: TRAINING_WINDOW, style: 'ticks', subscribe: 1 }));"
    );
}

// 7. Fire the engine in botCycle
const fireInject = `
            if (botState.engineMarkovDiffers) {
                const markovSignal = evaluateMarkovDiffers();
                if (markovSignal) signal = markovSignal;
            }
`;

if (!serverContent.includes('evaluateMarkovDiffers()')) { // wait, I already injected the function definition.
    // Replace carefully in the engine priority list
    serverContent = serverContent.replace(
        "if (botState.engineCodyBarrier) {",
        fireInject + "\n            if (botState.engineCodyBarrier && !signal) {"
    );
}

// 8. Emojis and Names mapping
serverContent = serverContent.replace(
    "const emojis = { EVEN_ODD: '🎰', OVER_UNDER: '📊', ACCUMULATOR: '📈', CODY_BARRIER: '🎯' };",
    "const emojis = { EVEN_ODD: '🎰', OVER_UNDER: '📊', ACCUMULATOR: '📈', CODY_BARRIER: '🎯', MARKOV_DIFFERS: '🧠' };"
);
serverContent = serverContent.replace(
    "const names = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', ACCUMULATOR: 'ACUMULADOR', CODY_BARRIER: 'BARRERAS CODY' };",
    "const names = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', ACCUMULATOR: 'ACUMULADOR', CODY_BARRIER: 'BARRERAS CODY', MARKOV_DIFFERS: 'MARKOV DIFFERS' };"
);
serverContent = serverContent.replace(
    "['EVEN_ODD', 'OVER_UNDER', 'ACCUMULATOR', 'CODY_BARRIER']",
    "['EVEN_ODD', 'OVER_UNDER', 'ACCUMULATOR', 'CODY_BARRIER', 'MARKOV_DIFFERS']"
);

fs.writeFileSync('server-boom.js', serverContent);
console.log('server-boom.js patched!');

// PATCH INDEX.HTML
let indexContent = fs.readFileSync('public/index.html', 'utf8');

// Inject the UI card
const uiCard = `
    <!-- MARKOV DIFFERS -->
    <div class="engine-card glass engine-markov" id="engineCardMarkov">
      <div class="engine-header">
        <div class="engine-info-wrap">
            <div class="engine-icon">🧠</div>
            <div class="engine-name">MARKOV DIFFERS</div>
            <div class="engine-subtitle">R_50 Statistical Sniper</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="toggleMarkov">
          <span class="slider round"></span>
        </label>
      </div>
      <div class="engine-status">
        <span class="status-dot disabled" id="dotMarkov"></span>
        <span class="engine-status-text disabled" id="statusMarkov">En espera</span>
      </div>
      <div class="engine-stats">
        <div class="es-box">
          <span class="es-label">GANADAS</span>
          <span class="es-value positive" id="markovWins">0</span>
        </div>
        <div class="es-box">
          <span class="es-label">PERDIDAS</span>
          <span class="es-value negative" id="markovLosses">0</span>
        </div>
        <div class="es-box">
          <span class="es-label">PNL</span>
          <span class="es-value neutral" id="markovPnl">$0.00</span>
        </div>
        <div class="es-box">
          <span class="es-label">WIN RATE</span>
          <span class="es-value neutral" id="markovWinRate">0.0%</span>
        </div>
      </div>
    </div>
`;

if (!indexContent.includes('MARKOV DIFFERS')) {
    indexContent = indexContent.replace(
        '<!-- CODY BARRIER (MOTOR 6) -->',
        uiCard + '\n    <!-- CODY BARRIER (MOTOR 6) -->'
    );
}

// Update JS in index.html
if (!indexContent.includes('toggleMarkov')) {
    indexContent = indexContent.replace(
        "const toggleCody = $('toggleCodyBarrier');",
        "const toggleMarkov = $('toggleMarkov');\n  if (toggleMarkov) toggleMarkov.checked = !!data.engineMarkovDiffers;\n  const toggleCody = $('toggleCodyBarrier');"
    );
    
    indexContent = indexContent.replace(
        "updateEngineCard('engineCardCodyBarrier', 'statusCodyBarrier', data.engineCodyBarrier, data.isRunning, data.currentEngine === 'CODY_BARRIER');",
        "updateEngineCard('engineCardCodyBarrier', 'statusCodyBarrier', data.engineCodyBarrier, data.isRunning, data.currentEngine === 'CODY_BARRIER');\n  updateEngineCard('engineCardMarkov', 'statusMarkov', data.engineMarkovDiffers, data.isRunning, data.currentEngine === 'MARKOV_DIFFERS');"
    );
    
    indexContent = indexContent.replace(
        "if (data.engineStats.CODY_BARRIER) updateEngineStats('cody', data.engineStats.CODY_BARRIER);",
        "if (data.engineStats.CODY_BARRIER) updateEngineStats('cody', data.engineStats.CODY_BARRIER);\n  if (data.engineStats.MARKOV_DIFFERS) updateEngineStats('markov', data.engineStats.MARKOV_DIFFERS);"
    );
    
    indexContent = indexContent.replace(
        "$('toggleCodyBarrier').addEventListener('change', function() {",
        "$('toggleMarkov').addEventListener('change', function() {\n  handleEngineToggle('MARKOV_DIFFERS', this.checked);\n});\n\n$('toggleCodyBarrier').addEventListener('change', function() {"
    );
}

fs.writeFileSync('public/index.html', indexContent);
console.log('public/index.html patched!');

