import WebSocket from 'ws';

const APP_ID = '36544';
const SYMBOL = 'R_25';
const STAKE_BASE = 1.00;
const COOLDOWN_TICKS = 6;

function getPayoutFromDeriv() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        ws.on('open', () => {
            ws.send(JSON.stringify({
                proposal: 1, amount: STAKE_BASE, basis: 'stake', contract_type: 'DIGITDIFF',
                currency: 'USD', symbol: SYMBOL, duration: 1, duration_unit: 't', barrier: '5'
            }));
        });
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (msg.msg_type === 'proposal' && msg.proposal) {
                const payout = parseFloat(msg.proposal.payout);
                const profit = payout - STAKE_BASE;
                ws.close();
                resolve({ payout, profit, loss: STAKE_BASE });
            }
        });
        setTimeout(() => { ws.close(); resolve({ payout: 1.09, profit: 0.09, loss: STAKE_BASE }); }, 5000);
    });
}

function query(ws, req, expectedType) {
    return new Promise((resolve) => {
        const handler = (raw) => {
            const msg = JSON.parse(raw);
            if (msg.error || msg.msg_type === expectedType) {
                ws.removeListener('message', handler);
                resolve(msg);
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify(req));
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildMarkovMatrix(hist) {
    const matrix = {};
    for (let i = 0; i <= 9; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    for (let k = 1; k < hist.length; k++) matrix[hist[k - 1]][hist[k]]++;
    for (let i = 0; i <= 9; i++) {
        const total = Object.values(matrix[i]).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (let j = 0; j <= 9; j++) matrix[i][j] = matrix[i][j] / total;
        } else {
            for (let j = 0; j <= 9; j++) matrix[i][j] = 0.1;
        }
    }
    return matrix;
}

function calcChiSquared(hist, range) {
    const sub = hist.slice(-range);
    if (sub.length < range) return { chi2: 0, significant: false };
    const observed = {};
    for (let d = 0; d <= 9; d++) observed[d] = 0;
    sub.forEach(d => observed[d]++);
    const expected = range / 10;
    let chi2 = 0;
    for (let d = 0; d <= 9; d++) {
        chi2 += Math.pow(observed[d] - expected, 2) / expected;
    }
    return { chi2, significant: chi2 > 16.92 };
}

async function runBacktest() {
    console.log('═'.repeat(65));
    console.log('  🐍 BACKTEST: LA HIDRA v2.0 — DIGITDIFF — ÚLTIMAS 24 HORAS');
    console.log('═'.repeat(65));

    const { profit: winProfit, loss: lossAmount, payout } = await getPayoutFromDeriv();
    const breakEvenWR = (lossAmount / (winProfit + lossAmount)) * 100;

    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    await new Promise(r => ws.on('open', r));

    let allDigits = [];
    let endEpoch = 'latest';
    const PAGES = 9; 
    
    console.log(`\\n📡 Conectando a Deriv... Descargando ${PAGES} bloques de historia (max 5000/req).\\n`);

    for (let p = 1; p <= PAGES; p++) {
        const req = { ticks_history: SYMBOL, count: 5000, end: endEpoch, style: 'ticks' };
        const histResp = await query(ws, req, 'history');
        if (histResp.error) { console.log("   ❌ Abortando por error del servidor."); break; }

        const times = histResp.history.times;
        const prices = histResp.history.prices;
        const digits = prices.map(price => parseInt(parseFloat(price).toFixed(3).slice(-1)));
        
        allDigits = digits.concat(allDigits);
        endEpoch = String(times[0] - 1); 
        await delay(1000);
    }
    ws.close();

    // ESTADO DE LA HIDRA PARA SIMULACIÓN
    let hidraLayer = 0;        
    let dalembertStep = 0;
    let lastLossDigit = null;
    let frenoTicksRemaining = 0;  
    let consecutiveLosses = 0;

    let pnl = 0, wins = 0, losses = 0, maxDrawdown = 0, peakPnl = 0;
    let maxConsecLoss = 0, maxConsecWin = 0, currentConsecWin = 0;
    let layerUsage = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let layerWins = { 0: 0, 1: 0, 2: 0 };
    let layerLosses = { 0: 0, 1: 0, 2: 0 };

    const digitHistory = [];
    let tradeIndex = 0;
    let ticksSinceLastTrade = COOLDOWN_TICKS; 

    for (let i = 0; i < allDigits.length - 1; i++) {
        const currentDigit = allDigits[i];
        const nextDigit = allDigits[i + 1]; 
        digitHistory.push(currentDigit);
        if (digitHistory.length > 300) digitHistory.shift();
        
        ticksSinceLastTrade++;

        if (hidraLayer === 3) {
            frenoTicksRemaining--;
            if (frenoTicksRemaining <= 0) {
                hidraLayer = 0; dalembertStep = 0; lastLossDigit = null; consecutiveLosses = 0;
            }
            continue;
        }

        if (ticksSinceLastTrade < COOLDOWN_TICKS) continue;
        if (digitHistory.length < 100) continue;

        let barrier = null;
        let stakeMult = 0.8;
        let layerUsed = hidraLayer;

        if (hidraLayer === 1) {
            barrier = lastLossDigit;
            stakeMult = 1.5;
        } else {
            const chiTest = calcChiSquared(digitHistory, 100);
            if (!chiTest.significant) continue; 

            const markovHist = digitHistory.slice(-100);
            const matrix = buildMarkovMatrix(markovHist);
            const lastD = digitHistory[digitHistory.length - 1];
            const transitions = matrix[lastD];

            let minProb = 1.0;
            for (let d = 0; d <= 9; d++) {
                if (transitions[d] < minProb) { minProb = transitions[d]; barrier = d; }
            }

            if (barrier === null || minProb > 0.08) continue;

            if (hidraLayer === 2) {
                const dStep = dalembertStep || 1;
                stakeMult = 0.8 + (dStep * 0.35);
            }
        }

        if (barrier === null) continue;

        const finalStake = STAKE_BASE * stakeMult;
        const isWin = nextDigit !== barrier; 
        
        tradeIndex++;
        ticksSinceLastTrade = 0;
        layerUsage[layerUsed]++;

        if (isWin) {
            const profit = finalStake * (winProfit / STAKE_BASE);
            pnl += profit; wins++; currentConsecWin++; consecutiveLosses = 0;
            if (currentConsecWin > maxConsecWin) maxConsecWin = currentConsecWin;
            if (layerUsed <= 2) layerWins[layerUsed]++;

            if (hidraLayer === 1) { hidraLayer = 0; lastLossDigit = null; } 
            else if (hidraLayer === 2) {
                dalembertStep--;
                if (dalembertStep <= 0) { dalembertStep = 0; hidraLayer = 0; }
            }
        } else {
            pnl -= finalStake; losses++; currentConsecWin = 0; consecutiveLosses++;
            if (consecutiveLosses > maxConsecLoss) maxConsecLoss = consecutiveLosses;
            if (layerUsed <= 2) layerLosses[layerUsed]++;

            if (hidraLayer === 0) { hidraLayer = 1; lastLossDigit = nextDigit; } 
            else if (hidraLayer === 1) { hidraLayer = 2; dalembertStep = 1; lastLossDigit = null; } 
            else if (hidraLayer === 2) {
                dalembertStep++;
                if (consecutiveLosses >= 4) { hidraLayer = 3; frenoTicksRemaining = 300; }
            }
        }

        if (pnl > peakPnl) peakPnl = pnl;
        const dd = peakPnl - pnl;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';

    console.log('═'.repeat(65));
    console.log('  📊 RESULTADOS DEL BACKTEST — LA HIDRA v2.0 (24H)');
    console.log('═'.repeat(65));
    console.log(`  📈 PnL TOTAL:           ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
    console.log(`  🎯 TRADES EJECUTADOS:   ${totalTrades}`);
    console.log(`  ✅ GANADAS:             ${wins}`);
    console.log(`  ❌ PERDIDAS:            ${losses}`);
    console.log(`  📊 WIN RATE:            ${winRate}%`);
    console.log(`  📉 MAX DRAWDOWN:        -$${maxDrawdown.toFixed(2)}`);
    console.log(`  🔥 MAX RACHA GANADORA:  ${maxConsecWin}`);
    console.log(`  💀 MAX RACHA PERDEDORA: ${maxConsecLoss}`);
    console.log('');
    console.log('─'.repeat(65));
    console.log('  🐍 DETALLE POR CAPA DE LA HIDRA');
    console.log('─'.repeat(65));
    console.log(`  Capa 0 (Normal):     ${layerUsage[0]} trades | W:${layerWins[0]} L:${layerLosses[0]} | WR: ${layerUsage[0] > 0 ? ((layerWins[0]/(layerWins[0]+layerLosses[0]))*100).toFixed(1) : '0.0'}%`);
    console.log(`  Capa 1 (Espejo):     ${layerUsage[1]} trades | W:${layerWins[1]} L:${layerLosses[1]} | WR: ${layerUsage[1] > 0 ? ((layerWins[1]/(layerWins[1]+layerLosses[1]))*100).toFixed(1) : '0.0'}%`);
    console.log(`  Capa 2 (D'Alembert): ${layerUsage[2]} trades | W:${layerWins[2]} L:${layerLosses[2]} | WR: ${layerUsage[2] > 0 ? ((layerWins[2]/(layerWins[2]+layerLosses[2]))*100).toFixed(1) : '0.0'}%`);
    console.log(`  Capa 3 (Freno):      ${layerUsage[3]} activaciones`);
}
runBacktest().catch(console.error);
