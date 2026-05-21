import WebSocket from 'ws';

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN DEL BACKTEST (PARÁMETROS POR DEFECTO KRAKEN v2.0)
// ════════════════════════════════════════════════════════════════
const SYMBOL = 'R_25';
const TARGET_HOURS = 5;
const BASE_STAKE = 1.0;
const MAX_DAILY_LOSS = 20.0;
const TAKE_PROFIT = 15.0;
const MAX_TRADES = 50;

// Estado del Bot para la simulación
let botState = {
    isRunning: true,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    digitHistory: [],          // Últimos 300 dígitos
    digitFrequency: {},
    stake: BASE_STAKE,
    maxDailyLoss: MAX_DAILY_LOSS,
    dailyLoss: 0,
    dailyProfit: 0,
    takeProfit: TAKE_PROFIT,
    lastTradeTime: 0,
    cooldownMs: 6000,
    cooldownMode: 'auto',
    maxTradesPerDay: MAX_TRADES,
    
    // Momentum Shield
    consecutiveLosses: 0,
    consecutiveWins: 0,
    momentumShieldLevel: 0,    // 0-4
    circuitBreakerUntil: 0,
    
    // Profit Lock & Spike Protection
    profitPeak: 0,
    profitFloor: 0,
    originalTakeProfit: TAKE_PROFIT,
    stakeReduced: false,
    takeProfitExtensions: 0,
    spikeProtectionUntil: 0,   // trade session index until which stake is halved
    
    // Interruptores de motores
    engineEvenOdd: true,
    engineOverUnder: true,
    engineMatch: true,
    engineDiffer: true,
    
    // Analíticas
    shannonEntropy: 0,
    markovEdge: 0,
    hotDigit: null,
    hotDigitFreq: 0,
    chiSquaredSignificant: false,

    // Estadísticas por motor
    engineStats: {
        EVEN_ODD: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        OVER_UNDER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        MATCH: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        DIFFER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
    }
};

// ════════════════════════════════════════════════════════════════
//  UTILIDADES COMPARTIDAS & ANALÍTICAS RADICALES
// ════════════════════════════════════════════════════════════════

function calcEntropy(hist, range) {
    const sub = hist.slice(-range);
    if (sub.length === 0) return 3.322;
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    sub.forEach(d => freq[d]++);
    let entropy = 0;
    for (let d = 0; d <= 9; d++) {
        const p = freq[d] / sub.length;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
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

function calcEWMFrequency(hist, alpha = 0.05) {
    const weights = {};
    for (let d = 0; d <= 9; d++) weights[d] = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < hist.length; i++) {
        const dist = hist.length - 1 - i;
        const w = alpha * Math.pow(1 - alpha, dist);
        const digit = hist[i];
        weights[digit] += w;
        totalWeight += w;
    }
    
    const normalized = {};
    for (let d = 0; d <= 9; d++) {
        normalized[d] = totalWeight > 0 ? weights[d] / totalWeight : 0.1;
    }
    return normalized;
}

function buildMarkovMatrix(hist) {
    const matrix = {};
    for (let i = 0; i <= 9; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    for (let k = 1; k < hist.length; k++) {
        matrix[hist[k - 1]][hist[k]]++;
    }
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

function getDynamicCooldown() {
    const entropy = parseFloat(botState.shannonEntropy) || 3.0;
    let cd = 6000; // Base: 6s
    
    if (entropy < 2.8) {
        cd = 4000;
    } else if (entropy >= 2.8 && entropy <= 3.1) {
        cd = 8000;
    } else {
        cd = 15000;
    }
    
    if (botState.consecutiveLosses > 0) {
        cd += 3000;
    }
    
    if (botState.consecutiveWins >= 3) {
        cd = 3000;
    }
    
    if (botState.momentumShieldLevel === 1) {
        cd += 3000;
    } else if (botState.momentumShieldLevel === 2) {
        cd += 10000;
    } else if (botState.momentumShieldLevel === 3) {
        cd += 25000;
    }
    
    return cd;
}

function getAdjustedStake(baseStake, stakeMultiplier) {
    let adjusted = baseStake * stakeMultiplier;
    
    if (botState.momentumShieldLevel === 1) {
        adjusted *= 0.75;
    } else if (botState.momentumShieldLevel === 2) {
        adjusted *= 0.50;
    } else if (botState.momentumShieldLevel === 3) {
        adjusted *= 0.35;
    } else if (botState.momentumShieldLevel === 4) {
        adjusted *= 0.0;
    }
    
    if (botState.totalTradesSession < botState.spikeProtectionUntil) {
        adjusted *= 0.50;
    }
    
    if (adjusted > 0 && adjusted < 0.35) {
        adjusted = 0.35;
    }
    
    return parseFloat(adjusted.toFixed(2));
}

// ════════════════════════════════════════════════════════════════
//  MOTORES DE PREMANTECEDENTES (ENGINES)
// ════════════════════════════════════════════════════════════════

function evaluateEvenOdd() {
    const hist = botState.digitHistory;
    if (hist.length < 50) return null;
    
    const chiTest = calcChiSquared(hist, 50);
    if (!chiTest.significant) return null;
    
    const sub10 = hist.slice(-10);
    const sub20 = hist.slice(-20);
    const sub40 = hist.slice(-40);
    
    let ev10 = 0, od10 = 0;
    sub10.forEach(d => { if (d % 2 === 0) ev10++; else od10++; });
    
    let ev20 = 0, od20 = 0;
    sub20.forEach(d => { if (d % 2 === 0) ev20++; else od20++; });
    
    let ev40 = 0, od40 = 0;
    sub40.forEach(d => { if (d % 2 === 0) ev40++; else od40++; });
    
    const sigOdd10 = ev10 >= 7;
    const sigEven10 = od10 >= 7;
    
    const sigOdd20 = ev20 >= 13;
    const sigEven20 = od20 >= 13;
    
    const sigOdd40 = ev40 >= 25;
    const sigEven40 = od40 >= 25;
    
    const scoreOdd = (sigOdd10 ? 1 : 0) + (sigOdd20 ? 1 : 0) + (sigOdd40 ? 1 : 0);
    const scoreEven = (sigEven10 ? 1 : 0) + (sigEven20 ? 1 : 0) + (sigEven40 ? 1 : 0);
    
    if (scoreOdd >= 2) {
        return {
            engine: 'EVEN_ODD',
            contractType: 'DIGITODD',
            barrier: null,
            stakeMultiplier: 1.0,
            reason: `Consenso IMPAR [10:${ev10}/10, 20:${ev20}/20, 40:${ev40}/40] | Chi2:${chiTest.chi2.toFixed(1)}`,
            entropy: parseFloat(botState.shannonEntropy)
        };
    }
    
    if (scoreEven >= 2) {
        return {
            engine: 'EVEN_ODD',
            contractType: 'DIGITEVEN',
            barrier: null,
            stakeMultiplier: 1.0,
            reason: `Consenso PAR [10:${od10}/10, 20:${od20}/20, 40:${od40}/40] | Chi2:${chiTest.chi2.toFixed(1)}`,
            entropy: parseFloat(botState.shannonEntropy)
        };
    }
    
    return null;
}

function evaluateOverUnder() {
    const hist = botState.digitHistory;
    if (hist.length < 100) return null;
    
    const chiTest = calcChiSquared(hist, 100);
    if (!chiTest.significant) return null;
    
    const markovHist = hist.slice(-100);
    const matrix = buildMarkovMatrix(markovHist);
    const lastDigit = hist[hist.length - 1];
    const transitions = matrix[lastDigit];
    
    let probOver = 0;
    for (let d = 5; d <= 9; d++) probOver += transitions[d];
    let probUnder = 1 - probOver;
    
    const edge = Math.abs(probOver - 0.5);
    const edgePercent = edge * 100;
    botState.markovEdge = edgePercent.toFixed(1);
    
    if (edgePercent < 10) return null;
    
    const last30 = hist.slice(-30);
    
    if (probOver >= 0.60) {
        const countOver = last30.filter(d => d > 4).length;
        if (countOver < 15) return null;
        
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITOVER',
            barrier: '4',
            stakeMultiplier: 1.0,
            reason: `Markov P(>4)=${(probOver * 100).toFixed(1)}% | Edge: ${edgePercent.toFixed(1)}% | Freq30: ${countOver}/30`,
            entropy: parseFloat(botState.shannonEntropy)
        };
    }
    
    if (probUnder >= 0.60) {
        const countUnder = last30.filter(d => d < 5).length;
        if (countUnder < 15) return null;
        
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITUNDER',
            barrier: '5',
            stakeMultiplier: 1.0,
            reason: `Markov P(<5)=${(probUnder * 100).toFixed(1)}% | Edge: ${edgePercent.toFixed(1)}% | Freq30: ${countUnder}/30`,
            entropy: parseFloat(botState.shannonEntropy)
        };
    }
    
    return null;
}

function evaluateMatch() {
    const hist = botState.digitHistory;
    if (hist.length < 50) return null;
    
    const chiTest = calcChiSquared(hist, 50);
    if (!chiTest.significant) return null;
    
    const window50 = hist.slice(-50);
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    window50.forEach(d => freq[d]++);
    
    let hotDigit = 0;
    let maxFreq = 0;
    for (let d = 0; d <= 9; d++) {
        if (freq[d] > maxFreq) {
            maxFreq = freq[d];
            hotDigit = d;
        }
    }
    
    const hotDigitFreqPercent = (maxFreq / 50) * 100;
    botState.hotDigit = hotDigit;
    botState.hotDigitFreq = hotDigitFreqPercent.toFixed(1);
    
    if (hotDigitFreqPercent < 20) return null;
    
    const last5 = hist.slice(-5);
    const momentumCount = last5.filter(d => d === hotDigit).length;
    if (momentumCount < 2) return null;
    
    const ewmFreqs = calcEWMFrequency(hist, 0.05);
    let highestEWMDigit = 0;
    let highestEWMValue = 0;
    for (let d = 0; d <= 9; d++) {
        if (ewmFreqs[d] > highestEWMValue) {
            highestEWMValue = ewmFreqs[d];
            highestEWMDigit = d;
        }
    }
    if (highestEWMDigit !== hotDigit) return null;
    
    return {
        engine: 'MATCH',
        contractType: 'DIGITMATCH',
        barrier: String(hotDigit),
        stakeMultiplier: 0.5,
        reason: `Dígito caliente ${hotDigit}: ${maxFreq}/50 (${hotDigitFreqPercent.toFixed(1)}%) | Last5: ${momentumCount}x | EWM OK`,
        entropy: parseFloat(botState.shannonEntropy)
    };
}

function evaluateDiffer() {
    const hist = botState.digitHistory;
    if (hist.length < 100) return null;
    
    const chiTest = calcChiSquared(hist, 100);
    if (!chiTest.significant) return null;
    
    const markovHist = hist.slice(-100);
    const matrix = buildMarkovMatrix(markovHist);
    const lastDigit = hist[hist.length - 1];
    const transitions = matrix[lastDigit];
    
    let bestBarrier = null;
    let bestContractType = null;
    let maxEdge = 0;
    let bestProb = 0;
    
    for (let b = 0; b <= 9; b++) {
        const theoreticalOver = (9 - b) / 10;
        let probOver = 0;
        for (let d = b + 1; d <= 9; d++) probOver += transitions[d];
        const edgeOver = probOver - theoreticalOver;
        
        const theoreticalUnder = b / 10;
        let probUnder = 0;
        for (let d = 0; d < b; d++) probUnder += transitions[d];
        const edgeUnder = probUnder - theoreticalUnder;
        
        if (edgeOver > maxEdge) {
            maxEdge = edgeOver;
            bestBarrier = b;
            bestContractType = 'DIGITOVER';
            bestProb = probOver;
        }
        if (edgeUnder > maxEdge) {
            maxEdge = edgeUnder;
            bestBarrier = b;
            bestContractType = 'DIGITUNDER';
            bestProb = probUnder;
        }
    }
    
    if (maxEdge < 0.10 || bestBarrier === null) return null;
    
    return {
        engine: 'DIFFER',
        contractType: bestContractType,
        barrier: String(bestBarrier),
        stakeMultiplier: 0.8,
        reason: `Cirujano ${bestContractType} barrera=${bestBarrier} (Prob: ${(bestProb*100).toFixed(1)}% | Edge: ${(maxEdge*100).toFixed(1)}%)`,
        entropy: parseFloat(botState.shannonEntropy)
    };
}

// ════════════════════════════════════════════════════════════════
//  ORQUESTADOR Y EVALUADOR CHRONOLÓGICO DE LA SIMULACIÓN
// ════════════════════════════════════════════════════════════════

// Historial completo de ticks descargado
let allPrices = [];
let allTimes = [];
let pendingTrade = null; // Almacena el trade activo que resolverá en el siguiente tick

function processTick(index) {
    const price = allPrices[index];
    const timeSec = allTimes[index];
    const nowMs = timeSec * 1000;
    const priceStr = String(price);
    const digit = parseInt(priceStr[priceStr.length - 1]);
    
    // 1. Si hay un trade pendiente, resolverlo primero usando el dígito de este tick
    if (pendingTrade) {
        resolvePendingTrade(digit, price, nowMs);
    }
    
    // 2. Actualizar historia de dígitos con el dígito actual
    botState.digitHistory.push(digit);
    if (botState.digitHistory.length > 300) {
        botState.digitHistory.shift();
    }
    botState.digitFrequency[digit] = (botState.digitFrequency[digit] || 0) + 1;
    
    if (botState.digitHistory.length >= 50) {
        botState.shannonEntropy = calcEntropy(botState.digitHistory, 100).toFixed(3);
    }
    
    // 3. Evaluar señales de trading si la sesión sigue activa
    if (!botState.isRunning) return;
    
    // Límites de pérdidas, trades o circuit breaker
    if (botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`\n🚫 [DETENIDO] LÍMITE DE PÉRDIDA DIARIA ALCANZADO ($${botState.dailyLoss.toFixed(2)})`);
        return;
    }
    if (botState.totalTradesSession >= botState.maxTradesPerDay) {
        botState.isRunning = false;
        console.log(`\n🚫 [DETENIDO] MÁXIMO DE TRADES DE SESIÓN ALCANZADO (${botState.maxTradesPerDay})`);
        return;
    }
    if (botState.circuitBreakerUntil > 0) {
        if (nowMs < botState.circuitBreakerUntil) {
            return;
        } else {
            console.log(`\n⚡ [RECUPERACIÓN] El Circuit Breaker ha expirado. Restableciendo escudo a NIVEL 0.`);
            botState.circuitBreakerUntil = 0;
            botState.momentumShieldLevel = 0;
            botState.consecutiveLosses = 0;
        }
    }
    
    // Verificar Cooldown Ms
    const currentCooldown = botState.cooldownMode === 'auto' ? getDynamicCooldown() : botState.cooldownMs;
    if ((nowMs - botState.lastTradeTime) < currentCooldown) return;
    
    // Buscar señales por prioridad
    let signal = null;
    
    // Prioridad 1: MATCH
    if (!signal && botState.engineMatch && !botState.engineStats.MATCH.autoDisabled && botState.momentumShieldLevel < 2) {
        signal = evaluateMatch();
    }
    // Prioridad 2: DIFFER
    if (!signal && botState.engineDiffer && !botState.engineStats.DIFFER.autoDisabled && botState.momentumShieldLevel < 3) {
        signal = evaluateDiffer();
    }
    // Prioridad 3: OVER/UNDER
    if (!signal && botState.engineOverUnder && !botState.engineStats.OVER_UNDER.autoDisabled && botState.momentumShieldLevel < 3) {
        signal = evaluateOverUnder();
    }
    // Prioridad 4: EVEN/ODD
    if (!signal && botState.engineEvenOdd && !botState.engineStats.EVEN_ODD.autoDisabled && botState.momentumShieldLevel < 4) {
        signal = evaluateEvenOdd();
    }
    
    if (!signal) return;
    
    // Firing trade
    const finalStake = getAdjustedStake(botState.stake, signal.stakeMultiplier);
    if (finalStake <= 0) return; // Escudo bloqueando stake
    
    // Preparar el trade pendiente que resolverá en el siguiente tick (1-tick contract)
    pendingTrade = {
        engine: signal.engine,
        contractType: signal.contractType,
        barrier: signal.barrier,
        stake: finalStake,
        entryPrice: price,
        entryTimeMs: nowMs,
        reason: signal.reason,
        entropy: botState.shannonEntropy
    };
    
    botState.lastTradeTime = nowMs;
}

function resolvePendingTrade(digit, price, nowMs) {
    const t = pendingTrade;
    pendingTrade = null; // Liberar pendiente
    
    let isWin = false;
    let profit = 0;
    
    const barrierNum = t.barrier !== null ? parseInt(t.barrier) : null;
    
    // Evaluar resultado según tipo de contrato
    if (t.contractType === 'DIGITEVEN') {
        isWin = (digit % 2 === 0);
    } else if (t.contractType === 'DIGITODD') {
        isWin = (digit % 2 !== 0);
    } else if (t.contractType === 'DIGITOVER') {
        isWin = (digit > barrierNum);
    } else if (t.contractType === 'DIGITUNDER') {
        isWin = (digit < barrierNum);
    } else if (t.contractType === 'DIGITMATCH') {
        isWin = (digit === barrierNum);
    }
    
    // Calcular Profit/Loss
    if (isWin) {
        if (t.engine === 'EVEN_ODD') {
            profit = t.stake * 0.96;
        } else if (t.engine === 'MATCH') {
            profit = t.stake * 8.0;
        } else if (t.engine === 'OVER_UNDER') {
            // Standard Over/Under paying ~96%
            profit = t.stake * 0.96;
        } else if (t.engine === 'DIFFER') {
            // DIFFER dynamic payout formula
            let W = 0;
            if (t.contractType === 'DIGITOVER') {
                W = 9 - barrierNum;
            } else if (t.contractType === 'DIGITUNDER') {
                W = barrierNum;
            }
            profit = W > 0 ? t.stake * (10 / W - 1.05) : 0;
        }
        profit = parseFloat(profit.toFixed(2));
    } else {
        profit = -t.stake;
    }
    
    // Actualizar estado general del bot
    botState.pnlSession += profit;
    botState.totalTradesSession++;
    
    const engineName = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', MATCH: 'MATCH', DIFFER: 'DIFFER' }[t.engine] || t.engine;
    const timeStr = new Date(t.entryTimeMs).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    
    if (isWin) {
        botState.winsSession++;
        botState.dailyProfit += profit;
        botState.consecutiveWins++;
        
        // El Escudo recupera su fuerza tras 2 victorias consecutivas
        if (botState.consecutiveWins >= 2) {
            botState.momentumShieldLevel = 0;
            botState.consecutiveLosses = 0;
        }
        
        console.log(`[${timeStr}] ✅ WIN +$${profit.toFixed(2)} [${engineName}] | ${t.contractType}${t.barrier ? ` B:${t.barrier}` : ''} | Dígito: ${digit} | PnL: $${botState.pnlSession.toFixed(2)}`);
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(profit);
        botState.consecutiveWins = 0;
        botState.consecutiveLosses++;
        
        // Configuración escalada del Momentum Shield
        if (botState.consecutiveLosses === 2) {
            botState.momentumShieldLevel = 1;
        } else if (botState.consecutiveLosses === 3) {
            botState.momentumShieldLevel = 2;
        } else if (botState.consecutiveLosses === 4) {
            botState.momentumShieldLevel = 3;
        } else if (botState.consecutiveLosses >= 5) {
            botState.momentumShieldLevel = 4;
            botState.circuitBreakerUntil = nowMs + (10 * 60 * 1000); // 10 min de pausa absoluta
        }
        
        console.log(`[${timeStr}] ❌ LOSS -$${Math.abs(profit).toFixed(2)} [${engineName}] | ${t.contractType}${t.barrier ? ` B:${t.barrier}` : ''} | Dígito: ${digit} | Racha: ${botState.consecutiveLosses} | PnL: $${botState.pnlSession.toFixed(2)}`);
    }
    
    // Actualizar estadísticas por motor
    if (botState.engineStats[t.engine]) {
        const stats = botState.engineStats[t.engine];
        if (isWin) stats.wins++; else stats.losses++;
        stats.pnl += profit;
        
        // DARWIN MODE: Auto-desactivar motores inviables
        const totalTrades = stats.wins + stats.losses;
        if (totalTrades >= 10 && !stats.autoDisabled) {
            const wr = (stats.wins / totalTrades) * 100;
            const breakEven = t.engine === 'MATCH' ? 14.0 : 52.5;
            if (wr < breakEven) {
                stats.autoDisabled = true;
                console.log(`🦎 DARWIN: Motor ${engineName} auto-desactivado (WR: ${wr.toFixed(1)}% < Breakeven: ${breakEven}%)`);
            }
        }
    }
    
    // Registrar en historial para Spike Protection
    botState.tradeHistory.unshift({
        engine: engineName,
        engineKey: t.engine,
        contractType: t.contractType,
        barrier: t.barrier,
        profit: profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date(t.entryTimeMs).toISOString(),
        stake: t.stake,
        entropy: t.entropy
    });
    if (botState.tradeHistory.length > 100) botState.tradeHistory.pop();
    
    // Spike Protection: Si los últimos 5 trades suman < -$3.00
    if (botState.tradeHistory.length >= 5) {
        const last5 = botState.tradeHistory.slice(0, 5);
        const sumProfit = last5.reduce((acc, trade) => acc + trade.profit, 0);
        if (sumProfit < -3.00 && botState.totalTradesSession >= botState.spikeProtectionUntil) {
            botState.spikeProtectionUntil = botState.totalTradesSession + 5;
            console.log(`📉 SPIKE PROTECTION ACTIVO: Pérdidas acumuladas en 5 trades de $${sumProfit.toFixed(2)}. Stake reducido 50% por 5 trades.`);
        }
    }
    
    // Trailing Take-Profit & Profit Lock
    if (botState.pnlSession > botState.profitPeak) {
        botState.profitPeak = botState.pnlSession;
        if (botState.pnlSession > 5.0) {
            botState.profitFloor = botState.profitPeak * 0.60;
        }
    }
    
    // Control Profit Floor
    if (botState.pnlSession > 5.0 && botState.pnlSession <= botState.profitFloor) {
        console.log(`🔒 PROFIT LOCK: El PnL retrocedió al piso de seguridad ($${botState.profitFloor.toFixed(2)}). Ganancias bloqueadas. Deteniendo bot.`);
        botState.isRunning = false;
        return;
    }
    
    // Control Take Profit Extensions (House Money Mode)
    if (botState.pnlSession >= botState.takeProfit) {
        if (botState.takeProfitExtensions < 3) {
            botState.takeProfitExtensions++;
            botState.takeProfit += 5.0;
            botState.stake = parseFloat((botState.stake * 0.5).toFixed(2));
            if (botState.stake < 0.35) botState.stake = 0.35;
            botState.stakeReduced = true;
            console.log(`🚀 META ALCANZADA! Extendiendo Meta TP a $${botState.takeProfit.toFixed(2)} con Stake Reducido al 50% (Dinero de la Casa). [Ext ${botState.takeProfitExtensions}/3]`);
        } else {
            console.log(`🏆 META FINAL KRAKEN ALCANZADA ($${botState.pnlSession.toFixed(2)}). 3 Extensiones logradas. Deteniendo sesión.`);
            botState.isRunning = false;
        }
    }
}

// ════════════════════════════════════════════════════════════════
//  DESCARGADOR Y CONTROLADOR DE WEBSOCKET
// ════════════════════════════════════════════════════════════════

const APP_ID = '36544';
const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const ws = new WebSocket(wsUrl);

let downloadedTicks = 0;
const targetTicksCount = 10000; // Aproximadamente 5.5 horas de R_25 (1 tick cada 2s -> 1800/h = 9000 ticks para 5h)

function fetchHistory(endTime = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        count: 5000,
        end: endTime,
        style: 'ticks'
    }));
}

ws.on('open', () => {
    console.log(`🐙 [KRAKEN BACKTESTER v2.0]`);
    console.log(`====================================================`);
    console.log(`📡 Conectado a Deriv Gateway. Descargando datos para ${SYMBOL}...`);
    console.log(`⏳ Cargando últimas ~${TARGET_HOURS} horas de ticks paginados...`);
    fetchHistory();
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.error) {
        console.error(`❌ Error de la API de Deriv:`, msg.error.message);
        ws.close();
        process.exit(1);
    }
    
    if (msg.msg_type === 'history') {
        const h = msg.history;
        allPrices = [...h.prices, ...allPrices];
        allTimes = [...h.times, ...allTimes];
        
        const firstTime = allTimes[0];
        const lastTime = allTimes[allTimes.length - 1];
        const currentHours = (lastTime - firstTime) / 3600;
        
        process.stdout.write(`📦 Cargado: ${allPrices.length} ticks (${currentHours.toFixed(2)}h / ${TARGET_HOURS}h)...`);
        
        if (currentHours < TARGET_HOURS && allPrices.length < targetTicksCount) {
            // Pedir la siguiente página de datos anteriores
            fetchHistory(allTimes[0] - 1);
        } else {
            console.log("\n\n✅ Datos cargados correctamente!");
            console.log(`📈 Ticks Totales: ${allPrices.length}`);
            console.log(`⏱️ Lapso Histórico Real: ${currentHours.toFixed(2)} horas`);
            console.log(`🚀 Iniciando simulación de alta fidelidad KRAKEN ENGINE v2.0...\n`);
            
            runBacktestSimulation();
            ws.close();
        }
    }
});

ws.on('error', (err) => {
    console.error(`❌ Error en conexión WebSocket:`, err.message);
});

// ════════════════════════════════════════════════════════════════
//  EJECUCIÓN DE LA SIMULACIÓN Y GENERACIÓN DEL REPORTE
// ════════════════════════════════════════════════════════════════

function runBacktestSimulation() {
    // 100 ticks de calentamiento requeridos para llenar el buffer inicial y Markov
    const warmupTicks = 100;
    
    if (allPrices.length < warmupTicks) {
        console.error("❌ Datos históricos insuficientes para ejecutar el calentamiento.");
        return;
    }
    
    // Calentamiento del buffer
    for (let i = 0; i < warmupTicks; i++) {
        const price = allPrices[i];
        const priceStr = String(price);
        const digit = parseInt(priceStr[priceStr.length - 1]);
        
        botState.digitHistory.push(digit);
        botState.digitFrequency[digit] = (botState.digitFrequency[digit] || 0) + 1;
    }
    
    botState.shannonEntropy = calcEntropy(botState.digitHistory, 100).toFixed(3);
    
    console.log(`====================================================`);
    console.log(`🤖 ESTADO INICIAL DE LA MÁQUINA (Calentamiento completado)`);
    console.log(`====================================================`);
    console.log(`• Ticks de Calentamiento: ${warmupTicks}`);
    console.log(`• Entropía Inicial: ${botState.shannonEntropy}`);
    console.log(`• Frecuencias Iniciales:`, JSON.stringify(botState.digitFrequency));
    console.log(`----------------------------------------------------\n`);
    
    // Correr simulación cronológica tick por tick
    let maxDrawdown = 0;
    let peakPnL = 0;
    
    for (let i = warmupTicks; i < allPrices.length; i++) {
        processTick(i);
        
        // Registrar pico de PnL y Drawdown máximo de la sesión
        if (botState.pnlSession > peakPnL) {
            peakPnL = botState.pnlSession;
        }
        const drawdown = peakPnL - botState.pnlSession;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
        }
    }
    
    // ════════════════════════════════════════════════════════════════
    //  INFORME DE RENDIMIENTO TERMINAL PREMIUM
    // ════════════════════════════════════════════════════════════════
    
    console.log(`\n====================================================`);
    console.log(`📊 INFORME ESTRATÉGICO KRAKEN ENGINE v2.0 (5 HORAS)`);
    console.log(`====================================================`);
    console.log(`⏱️ Período Analizado : ${TARGET_HOURS} horas (Últimos ${allPrices.length} ticks)`);
    console.log(`💰 Parámetros Inicial: Base stake: $${BASE_STAKE.toFixed(2)} | TP: $${TAKE_PROFIT.toFixed(2)} | Max Loss: $${MAX_DAILY_LOSS.toFixed(2)}`);
    console.log(`----------------------------------------------------`);
    console.log(`✔️ Trades Ganados    : ${botState.winsSession}`);
    console.log(`❌ Trades Perdidos   : ${botState.lossesSession}`);
    console.log(`🎯 Tasa de Acierto   : ${((botState.winsSession / botState.totalTradesSession) * 100 || 0).toFixed(1)}%`);
    console.log(`📈 Cantidad de Trades: ${botState.totalTradesSession}`);
    console.log(`📉 Máximo Drawdown  : $${maxDrawdown.toFixed(2)}`);
    console.log(`💸 Pico PnL Sesión   : $${peakPnL.toFixed(2)}`);
    console.log(`🔒 Profit Floor Final: $${botState.profitFloor.toFixed(2)}`);
    console.log(`🚀 TP Final Alcanzado: $${botState.takeProfit.toFixed(2)} [Extensiones: ${botState.takeProfitExtensions}/3]`);
    console.log(`💰 PnL NETO FINAL    : ${(botState.pnlSession >= 0 ? "+" : "")}$${botState.pnlSession.toFixed(2)}`);
    console.log(`====================================================`);
    console.log(`⚡ ANÁLISIS DE RENDIMIENTO POR MOTORES (ENGINES)`);
    console.log(`====================================================`);
    
    Object.keys(botState.engineStats).forEach(key => {
        const stats = botState.engineStats[key];
        const total = stats.wins + stats.losses;
        const wr = total > 0 ? (stats.wins / total) * 100 : 0;
        const darwinStatus = stats.autoDisabled ? '🦎 DESACTIVADO POR DARWIN' : '🟢 ACTIVO';
        
        console.log(`• Engine ${key.padEnd(10)}: WR: ${wr.toFixed(1).padStart(5)}% | Trades: ${String(total).padStart(2)} (W:${stats.wins} L:${stats.losses}) | PnL: ${(stats.pnl >= 0 ? "+" : "")}$${stats.pnl.toFixed(2).padEnd(6)} | [${darwinStatus}]`);
    });
    console.log(`====================================================\n`);
}
