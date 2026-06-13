import WebSocket from 'ws';
import fs from 'fs';

const APP_ID = '36544';
const TOKEN = 'PMIt2RhEjEDbcLD'; // Pon tu token real aquí para operar en real/demo
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

const TRAINING_WINDOW = 2000;
const THRESHOLD_PERCENT = 2.0; // Umbral de disparo
const STAKE = 5;

let botState = {};

SYMBOLS.forEach(s => {
    botState[s] = {
        history: [],
        ready: false,
        trading: false
    };
});

console.log("🚀 Iniciando Motor Markov Differs Avanzado...");

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + APP_ID);

ws.on('open', () => {
    ws.send(JSON.stringify({ authorize: TOKEN }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.msg_type === 'authorize') {
        console.log("✅ Autorizado correctamente.");
        // Suscribirse a los ticks
        SYMBOLS.forEach(sym => {
            ws.send(JSON.stringify({ ticks_history: sym, end: 'latest', count: TRAINING_WINDOW, style: 'ticks', subscribe: 1 }));
        });
    }

    if (msg.msg_type === 'history') {
        const sym = msg.echo_req.ticks_history;
        const ticks = msg.history.prices;
        botState[sym].history = ticks.map(p => parseInt(String(p.toFixed(2)).slice(-1)));
        botState[sym].ready = true;
        console.log(`✅ Historial cargado para ${sym} (${botState[sym].history.length} ticks)`);
    }

    if (msg.msg_type === 'tick') {
        const sym = msg.tick.symbol;
        if (!botState[sym] || !botState[sym].ready) return;

        const newDigit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
        
        // Actualizar rolling window
        botState[sym].history.push(newDigit);
        if (botState[sym].history.length > TRAINING_WINDOW) {
            botState[sym].history.shift();
        }

        evaluateMarkov(sym);
    }

    if (msg.msg_type === 'buy') {
        console.log(`🟢 [${msg.echo_req.parameters.symbol}] Contrato comprado. ID: ${msg.buy.contract_id}`);
    }

    if (msg.msg_type === 'proposal_open_contract') {
        const contract = msg.proposal_open_contract;
        if (contract.is_sold) {
            const result = contract.profit > 0 ? 'WIN 🏆' : 'LOSS 💀';
            console.log(`🏁 Contrato Finalizado [${contract.underlying}]: ${result} | PNL: $${contract.profit.toFixed(2)}`);
            botState[contract.underlying].trading = false;
        }
    }
});

function evaluateMarkov(sym) {
    if (botState[sym].trading) return;

    const hist = botState[sym].history;
    if (hist.length < TRAINING_WINDOW) return;

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
            // No queremos apostar a dígitos que NUNCA salen porque a veces es un bug del índice (ej. R_50)
            // Solo apostamos si la probabilidad es mayor a 0 pero menor al umbral
            if (prob > 0 && prob <= THRESHOLD_PERCENT) {
                if (prob < lowestProb) {
                    lowestProb = prob;
                    bestTarget = target;
                }
            }
        }
    }

    if (bestTarget !== -1) {
        console.log(`🎯 [${sym}] Oportunidad Detectada! Último dígito: ${currentDigit}. Probabilidad de ${bestTarget}: ${lowestProb.toFixed(2)}%. Disparando DIFFERS ${bestTarget}...`);
        
        botState[sym].trading = true;
        
        ws.send(JSON.stringify({
            buy: 1,
            price: STAKE,
            parameters: {
                amount: STAKE,
                basis: "stake",
                contract_type: "DIGITDIFF",
                currency: "USD",
                duration: 1,
                duration_unit: "t",
                symbol: sym,
                barrier: String(bestTarget)
            }
        }));

        // Suscribirse al contrato para saber cuando termine
        setTimeout(() => {
            ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
        }, 1500);
    }
}
