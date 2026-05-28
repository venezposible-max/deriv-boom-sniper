import WebSocket from 'ws';

const DERIV_WEBSOCKET_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";

function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;
    let gains = [];
    let losses = [];
    for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) { gains.push(diff); losses.push(0); }
        else { gains.push(0); losses.push(-diff); }
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateStdDev(prices, period = 30) {
    const len = prices.length;
    if (len < 2) return 0;
    const n = Math.min(len, period);
    const slice = prices.slice(-n);
    const mean = slice.reduce((a, b) => a + b, 0) / n;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / n;
    return Math.sqrt(variance);
}

async function runBacktest(symbol) {
    return new Promise((resolve) => {
        const ws = new WebSocket(DERIV_WEBSOCKET_URL);

        ws.on('open', () => {
            console.log(`📡 Conectando a Deriv para descargar historial de ${symbol}...`);
            ws.send(JSON.stringify({
                ticks_history: symbol,
                count: 5000,
                end: 'latest',
                style: 'ticks'
            }));
        });

        ws.on('message', (data) => {
            const response = JSON.parse(data);
            if (response.error) {
                console.error(`Error: ${response.error.message}`);
                ws.close();
                resolve();
                return;
            }

            if (response.msg_type === 'history') {
                const prices = response.history.prices;
                console.log(`✅ Historial descargado para ${symbol}: ${prices.length} ticks (aprox ${Math.floor(prices.length * 2 / 3600)} horas)`);
                
                let signals = 0;
                let wins = 0;
                let losses = 0; // Breach (one wins, one loses)
                let codyMultiplier = 1.8;
                let MAX_CODY_BARRIER = 0.70;
                let decimals = 2; // Asumiendo 2 por simplicidad o ajustando

                // Simular el tiempo avanzando tick a tick
                for (let i = 30; i < prices.length - 5; i++) {
                    const window = prices.slice(i - 30, i + 1);
                    const stdDev = calculateStdDev(window, 30);
                    const rsi = calculateRSI(window, 14);
                    const currentPrice = window[window.length - 1];

                    if (rsi >= 65 || rsi <= 35) {
                        let offset = codyMultiplier * stdDev;
                        const minOffset = currentPrice * 0.00005;
                        if (offset < minOffset) offset = minOffset;

                        const formattedOffset = parseFloat(offset.toFixed(decimals));
                        const finalOffset = formattedOffset > 0 ? formattedOffset : Math.pow(10, -decimals);

                        if (finalOffset > MAX_CODY_BARRIER) {
                            // Ignorado por barrera muy ancha (filtro fijo de Deriv, no el filtro de payout)
                            continue;
                        }

                        // ¡Señal Disparada!
                        signals++;
                        
                        // Evaluar qué pasa 5 ticks después
                        const exitPrice = prices[i + 5];
                        const higherBarrier = currentPrice - finalOffset;
                        const lowerBarrier = currentPrice + finalOffset;

                        const wonHigher = exitPrice > higherBarrier;
                        const wonLower = exitPrice < lowerBarrier;

                        if (wonHigher && wonLower) {
                            // Precio se mantuvo en el canal: Ganan ambos (Net Profit)
                            wins++;
                        } else {
                            // Precio rompió una de las barreras (Net Loss, porque el payout de 1 no cubre el stake de 2)
                            losses++;
                        }

                        // Saltar 5 ticks para no sobrelapar trades, como lo haría el bot en la vida real
                        i += 5;
                    }
                }
                
                console.log(`-------------------------------------------------`);
                console.log(`📊 RESULTADOS PARA ${symbol} (Últimos ${prices.length} ticks)`);
                console.log(`Total Señales: ${signals}`);
                console.log(`Victorias (Ambos ganan - Rango respetado): ${wins} (${signals > 0 ? ((wins/signals)*100).toFixed(2) : 0}%)`);
                console.log(`Rupturas Negativas (Uno gana, uno pierde): ${losses} (${signals > 0 ? ((losses/signals)*100).toFixed(2) : 0}%)`);
                console.log(`-------------------------------------------------`);
                ws.close();
                resolve();
            }
        });
    });
}

async function main() {
    console.log("Iniciando Backtest de Motor Cody Dual Sniper sin filtro de Payout...");
    await runBacktest('R_25');
    await runBacktest('R_100');
    await runBacktest('R_50');
    console.log("Backtest finalizado.");
}

main();
