import WebSocket from 'ws';

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD'; // Demo token from existing scripts
const TICKS_TO_FETCH = 5000;
const TRAINING_WINDOW = 2000;
const THRESHOLD_PERCENT = 1.5; // Probabilidad máxima para disparar (1.5%)

let globalResults = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    maxStreak: 0
};

async function runBacktest() {
    console.log(`🧪 Iniciando Backtesting Avanzado de Markov (Umbral: < ${THRESHOLD_PERCENT}%)...`);
    
    for (const symbol of SYMBOLS) {
        console.log(`\n📡 Obteniendo datos históricos de ${symbol}...`);
        const ticks = await fetchHistory(symbol);
        console.log(`✅ Procesando ${ticks.length} ticks de ${symbol}...`);
        
        if (ticks.length < TRAINING_WINDOW) {
            console.log(`Pocos ticks recibidos para ${symbol}. Saltando...`);
            continue;
        }

        let digits = ticks.map(t => parseInt(String(t.quote.toFixed(2)).slice(-1)));
        
        let localWins = 0;
        let localLosses = 0;
        let localTrades = 0;
        let currentStreak = 0;
        let maxStreak = 0;

        // Fase de ejecución (Rolling Window)
        for (let i = TRAINING_WINDOW; i < digits.length - 1; i++) {
            // Construir la matriz de transición con la ventana móvil [i - TRAINING_WINDOW, i]
            let matrix = Array(10).fill(0).map(() => Array(10).fill(0));
            let counts = Array(10).fill(0);

            for (let j = i - TRAINING_WINDOW + 1; j <= i; j++) {
                let prev = digits[j - 1];
                let curr = digits[j];
                matrix[prev][curr]++;
                counts[prev]++;
            }

            const currentDigit = digits[i];
            const nextDigit = digits[i + 1];

            // Buscar el dígito con la probabilidad más baja de suceder a currentDigit
            let bestTarget = -1;
            let lowestProb = 100;

            for (let target = 0; target <= 9; target++) {
                if (counts[currentDigit] > 0) {
                    let prob = (matrix[currentDigit][target] / counts[currentDigit]) * 100;
                    if (prob < lowestProb) {
                        lowestProb = prob;
                        bestTarget = target;
                    }
                }
            }

            // Disparar si encontramos un dígito con probabilidad menor al umbral
            if (bestTarget !== -1 && lowestProb <= THRESHOLD_PERCENT) {
                localTrades++;
                globalResults.totalTrades++;

                const isWin = nextDigit !== bestTarget;
                const stake = 10;
                const profit = isWin ? (stake * 0.09) : -stake;

                if (isWin) {
                    localWins++;
                    globalResults.wins++;
                    currentStreak++;
                    if (currentStreak > maxStreak) maxStreak = currentStreak;
                    if (currentStreak > globalResults.maxStreak) globalResults.maxStreak = currentStreak;
                } else {
                    localLosses++;
                    globalResults.losses++;
                    currentStreak = 0;
                }

                globalResults.pnl += profit;
            }
        }

        const winRate = localTrades > 0 ? ((localWins / localTrades) * 100).toFixed(2) : 0;
        console.log(`📊 [${symbol}] Trades: ${localTrades} | Wins: ${localWins} | Losses: ${localLosses} | WinRate: ${winRate}% | Max Win Streak: ${maxStreak}`);
    }

    console.log("\n==========================================");
    console.log("📈 RESULTADOS GLOBALES DEL BACKTEST");
    console.log("==========================================");
    console.log(`🔹 Trades Totales: ${globalResults.totalTrades}`);
    console.log(`🔹 Ganados: ${globalResults.wins}`);
    console.log(`🔹 Perdidos: ${globalResults.losses}`);
    console.log(`🔹 Max Racha Ganadora: ${globalResults.maxStreak}`);
    console.log(`💰 PnL Estimado Bruto (Fixed Stake 10 USD): +$${globalResults.pnl.toFixed(2)}`);
    console.log(`📊 Eficiencia Global: ${globalResults.totalTrades > 0 ? ((globalResults.wins / globalResults.totalTrades) * 100).toFixed(2) : 0}%`);
    console.log("==========================================\n");
    process.exit();
}

function fetchHistory(symbol) {
    return new Promise((resolve) => {
        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + APP_ID);
        ws.on('open', () => {
            ws.send(JSON.stringify({ authorize: TOKEN }));
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.msg_type === 'authorize') {
                ws.send(JSON.stringify({
                    ticks_history: symbol,
                    adjust_start_time: 1,
                    count: TICKS_TO_FETCH,
                    end: 'latest',
                    style: 'ticks'
                }));
            }
            if (msg.msg_type === 'history') {
                const ticks = msg.history.prices.map((p, i) => ({ quote: p }));
                ws.close();
                resolve(ticks);
            }
            if (msg.error) {
                console.error("Error fetching", symbol, msg.error);
                ws.close();
                resolve([]);
            }
        });
    });
}

runBacktest();
