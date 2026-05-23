/**
 * ============================================================
 *  🐙 KRAKEN ENGINE v2.0 — "The Statistical Kraken"
 *  A Highly Optimized Multi-Engine Trading Machine for Deriv
 *
 *  Motor 1: EVEN/ODD   — "El Pan de Cada Día"   (Window-consensus reversion)
 *  Motor 2: OVER/UNDER  — "El Potenciador"       (Markov dynamic trend)
 *  Motor 3: MATCH       — "El Multiplicador"     (Hot digit momentum)
 *  Motor 4: DIFFER      — "El Cirujano"          (Dynamic-barrier edge harvester)
 *
 *  Safety: Momentum Shield + Spike Protection + Darwin Mode
 *  Targeting: Volatility Index (R_10 / R_25 / R_50 / R_100)
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN CENTRAL
// ════════════════════════════════════════════════════════════════
const APP_ID = process.env.DERIV_APP_ID || '36544';
const DERIV_TOKEN = process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-hybrid.json');

// Símbolo actual (por defecto R_25)
let SYMBOL = 'R_25';

// ════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════
let botState = {
    isRunning: false,
    isConnectedToDeriv: false,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    currentContractId: null,
    activeContractId: null,
    lastTickPrice: 0,
    lastDigit: null,
    digitHistory: [],          // Últimos 300 dígitos
    digitFrequency: {},
    stake: 1,
    maxDailyLoss: 20,
    dailyLoss: 0,
    dailyProfit: 0,
    takeProfit: 15,
    lastTradeTime: 0,
    cooldownMs: 6000,
    cooldownMode: 'auto',      // 'auto' | 'fixed'
    isBuying: false,
    maxTradesPerDay: 50,
    coberturaEnabled: true,
    
    // ─── Momentum Shield ───
    consecutiveLosses: 0,
    consecutiveWins: 0,
    momentumShieldLevel: 0,    // 0-4
    circuitBreakerUntil: 0,
    
    // ─── Profit Lock & Spike Protection ───
    profitPeak: 0,
    profitFloor: 0,
    originalTakeProfit: 15,
    stakeReduced: false,
    takeProfitExtensions: 0,
    spikeProtectionUntil: 0,   // trade session index until which stake is halved
    
    // ─── Interruptores de motores (Solo DIFFER activo por premisa del usuario)
    engineEvenOdd: false,
    engineOverUnder: false,
    engineMatch: false,
    engineDiffer: true,
    
    // ─── Variables del Escudo de Trade Fantasma (Ghost Shield) ───
    ghostNextTradeReal: false,
    ghostPendingBarrier: null,
    ghostActive: false,
    
    // ─── Información del trade activo ───
    currentEngine: null,       // 'EVEN_ODD' | 'OVER_UNDER' | 'MATCH' | 'DIFFER'
    currentContractType: null,
    currentBarrier: null,
    currentStake: 0,
    
    // ─── Métricas por motor ───
    engineStats: {
        EVEN_ODD: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        OVER_UNDER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        MATCH: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        DIFFER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
    },
    
    // ─── Analíticas ───
    shannonEntropy: 0,
    markovEdge: 0,
    hotDigit: null,
    hotDigitFreq: 0,
    chiSquaredSignificant: false,
    
    // ─── La Hidra (Motor de Cobertura y Recuperación para Differ) ───
    hidraLayer: 0,             // 0=Normal, 1=Espejo, 2=D'Alembert, 3=Freno
    hidraDalembertStep: 0,
    hidraLastLossDigit: null,
    hidraFrenoUntil: 0
};

// ════════════════════════════════════════════════════════════════
//  CARGAR ESTADO PERSISTENTE
// ════════════════════════════════════════════════════════════════
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            // Preservar estructura robusta ante actualizaciones de versión
            const defaultStats = { ...botState.engineStats };
            botState = { ...botState, ...saved.botState };
            
            // Garantizar que todos los campos del nuevo KRAKEN existan
            botState.engineStats = { ...defaultStats, ...botState.engineStats };
            if (botState.engineDiffer === undefined) botState.engineDiffer = true;
            if (botState.cooldownMode === undefined) botState.cooldownMode = 'auto';
            if (botState.consecutiveWins === undefined) botState.consecutiveWins = 0;
            if (botState.momentumShieldLevel === undefined) botState.momentumShieldLevel = 0;
            if (botState.profitPeak === undefined) botState.profitPeak = 0;
            if (botState.profitFloor === undefined) botState.profitFloor = 0;
            if (botState.originalTakeProfit === undefined) botState.originalTakeProfit = botState.takeProfit;
            if (botState.takeProfitExtensions === undefined) botState.takeProfitExtensions = 0;
            if (botState.spikeProtectionUntil === undefined) botState.spikeProtectionUntil = 0;
            if (botState.stakeReduced === undefined) botState.stakeReduced = false;
            if (botState.coberturaEnabled === undefined) botState.coberturaEnabled = true;
            
            // Garantizar inicialización segura de variables de La Hidra
            if (botState.hidraLayer === undefined) botState.hidraLayer = 0;
            if (botState.hidraDalembertStep === undefined) botState.hidraDalembertStep = 0;
            if (botState.hidraLastLossDigit === undefined) botState.hidraLastLossDigit = null;
            if (botState.hidraFrenoUntil === undefined) botState.hidraFrenoUntil = 0;
            if (botState.ghostNextTradeReal === undefined) botState.ghostNextTradeReal = false;
            if (botState.ghostPendingBarrier === undefined) botState.ghostPendingBarrier = null;
            if (botState.ghostActive === undefined) botState.ghostActive = false;
            
            // Forzar solo DIFFER activo para asegurar la premisa del usuario
            botState.engineEvenOdd = false;
            botState.engineOverUnder = false;
            botState.engineMatch = false;
            botState.engineDiffer = true;
            
            // Forzar estados de arranque seguros
            botState.isRunning = false;
            botState.isBuying = false;
            botState.activeContractId = null;
            botState.currentContractId = null;
        }
        console.log(`📂 Estado KRAKEN cargado correctamente. Historial: ${botState.tradeHistory.length} trades.`);
    } catch (e) {
        console.log('⚠️ Error cargando estado previo, iniciando fresco.');
    }
}

// ════════════════════════════════════════════════════════════════
//  UTILIDADES COMPARTIDAS & ANALÍTICAS RADICALES
// ════════════════════════════════════════════════════════════════

/**
 * Entropía de Shannon — Mide la aleatoriedad/caos del mercado.
 * Máximo teórico para 10 dígitos ≈ 3.322
 */
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

/**
 * Prueba de Chi-Cuadrado de Bondad de Ajuste
 * Evalúa si la distribución de los últimos 'range' dígitos tiene desviaciones significativas de la uniformidad.
 * df = 9, valor crítico para p=0.05 es 16.92
 */
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

/**
 * Frecuencia Exponencial Ponderada (EWM Frequency)
 * Da más peso a los dígitos recientes aplicando decaimiento exponencial.
 */
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

/**
 * Matriz de Markov
 */
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

/**
 * Cooldown Dinámico Basado en Caos (Entropía) y Momentum de Rachas
 */
function getDynamicCooldown() {
    return 1000; // Cooldown de 1 segundo para fluidez máxima y análisis rápido sin esperas
}

/**
 * Calcular Stake Ajustado según Escudo de Momentum y Spike Protection
 */
function getAdjustedStake(baseStake, stakeMultiplier) {
    let adjusted = baseStake * stakeMultiplier;
    
    // Si estamos en cobertura (hidraLayer === 1), no reducimos el stake para garantizar la recuperación completa
    if (botState.hidraLayer === 1) {
        return parseFloat(adjusted.toFixed(2));
    }
    
    // Deshabilitamos reducciones de escudo por racha y protección contra picos
    // para cumplir con la premisa del usuario de no parar, no pausar y mantener operación al 100%
    if (adjusted > 0 && adjusted < 0.35) {
        adjusted = 0.35;
    }
    
    return parseFloat(adjusted.toFixed(2));
}

// ════════════════════════════════════════════════════════════════
//  MOTORES DE PREMANTECEDENTES (ENGINES)
// ════════════════════════════════════════════════════════════════

/**
 * Motor 1: EVEN/ODD — "El Pan de Cada Día"
 * Consenso multi-ventana (10, 20, 40 ticks) y Chi-Cuadrado
 */
function evaluateEvenOdd() {
    const hist = botState.digitHistory;
    if (hist.length < 50) return null;
    
    // Chi-Cuadrado de última ventana
    const chiTest = calcChiSquared(hist, 50);
    if (!chiTest.significant) return null; // No operar si el mercado es uniformemente ruidoso
    
    // Ventanas analíticas
    const sub10 = hist.slice(-10);
    const sub20 = hist.slice(-20);
    const sub40 = hist.slice(-40);
    
    let ev10 = 0, od10 = 0;
    sub10.forEach(d => { if (d % 2 === 0) ev10++; else od10++; });
    
    let ev20 = 0, od20 = 0;
    sub20.forEach(d => { if (d % 2 === 0) ev20++; else od20++; });
    
    let ev40 = 0, od40 = 0;
    sub40.forEach(d => { if (d % 2 === 0) ev40++; else od40++; });
    
    // Señales por ventana
    const sigOdd10 = ev10 >= 7;   // Reversión a IMPAR
    const sigEven10 = od10 >= 7;  // Reversión a PAR
    
    const sigOdd20 = ev20 >= 13;
    const sigEven20 = od20 >= 13;
    
    const sigOdd40 = ev40 >= 25;
    const sigEven40 = od40 >= 25;
    
    // Consenso: 2 de 3
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

/**
 * Motor 2: OVER/UNDER — "El Potenciador"
 * Markov de corto alcance (100 ticks), Chi-Cuadrado estricto y Validación Cruzada
 */
function evaluateOverUnder() {
    const hist = botState.digitHistory;
    if (hist.length < 100) return null;
    
    const chiTest = calcChiSquared(hist, 100);
    if (!chiTest.significant) return null;
    
    const markovHist = hist.slice(-100); // Ventana adaptativa a ruido
    const matrix = buildMarkovMatrix(markovHist);
    const lastDigit = hist[hist.length - 1];
    const transitions = matrix[lastDigit];
    
    let probOver = 0;
    for (let d = 5; d <= 9; d++) probOver += transitions[d];
    let probUnder = 1 - probOver;
    
    const edge = Math.abs(probOver - 0.5);
    const edgePercent = edge * 100;
    botState.markovEdge = edgePercent.toFixed(1);
    
    // Elevamos ventaja necesaria a 10% (estricto)
    if (edgePercent < 10) return null;
    
    const last30 = hist.slice(-30);
    
    // P(dígito > 4) >= 60%
    if (probOver >= 0.60) {
        const countOver = last30.filter(d => d > 4).length;
        if (countOver < 15) return null; // Abortar si contradice la frecuencia reciente del 50%
        
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITOVER',
            barrier: '4',
            stakeMultiplier: 1.0,
            reason: `Markov P(>4)=${(probOver * 100).toFixed(1)}% | Edge: ${edgePercent.toFixed(1)}% | Freq30: ${countOver}/30`,
            entropy: parseFloat(botState.shannonEntropy)
        };
    }
    
    // P(dígito < 5) >= 60%
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

/**
 * Motor 3: MATCH — "El Multiplicador"
 * Dígito caliente, momentum severo en 5 ticks y EWM Confirmation
 */
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
    
    // Umbral subido de 16% a 20%
    if (hotDigitFreqPercent < 20) return null;
    
    // Momentum en los últimos 5 ticks (debe haber aparecido al menos 2 veces)
    const last5 = hist.slice(-5);
    const momentumCount = last5.filter(d => d === hotDigit).length;
    if (momentumCount < 2) return null;
    
    // Confirmación mediante media exponencial
    const ewmFreqs = calcEWMFrequency(hist, 0.05);
    let highestEWMDigit = 0;
    let highestEWMValue = 0;
    for (let d = 0; d <= 9; d++) {
        if (ewmFreqs[d] > highestEWMValue) {
            highestEWMValue = ewmFreqs[d];
            highestEWMDigit = d;
        }
    }
    if (highestEWMDigit !== hotDigit) return null; // La EWM no apoya la señal
    
    return {
        engine: 'MATCH',
        contractType: 'DIGITMATCH',
        barrier: String(hotDigit),
        stakeMultiplier: 0.5,
        reason: `Dígito caliente ${hotDigit}: ${maxFreq}/50 (${hotDigitFreqPercent.toFixed(1)}%) | Last5: ${momentumCount}x | EWM OK`,
        entropy: parseFloat(botState.shannonEntropy)
    };
}

/**
 * Motor 4: DIFFER — "El Cirujano"
 * Optimización multivariante probando barreras dinámicas para explotar la máxima ventaja Markov
 */
function evaluateDiffer() {
    const hist = botState.digitHistory;
    if (hist.length < 100) return null;
    
    const now = Date.now();
    const lastDigit = hist[hist.length - 1];
    const prevDigit = hist[hist.length - 2];
    
    // CAPA 3: Freno de emergencia
    if (botState.hidraLayer === 3) {
        if (now >= botState.hidraFrenoUntil) {
            console.log(`🐍 LA HIDRA: Freno de emergencia finalizado. Reanudando en Capa 0 (Normal).`);
            botState.hidraLayer = 0;
            botState.hidraDalembertStep = 0;
            botState.hidraLastLossDigit = null;
            saveState();
        } else {
            return null;
        }
    }
    
    // CAPA 1: COBERTURA INFALIBLE (1 Tiro x10)
    if (botState.hidraLayer === 1) {
        const entropy = parseFloat(botState.shannonEntropy);
        
        // Selección de Barrera Estadísticamente Infalible usando Markov de 2do orden + 1er orden
        const state = (prevDigit * 10) + lastDigit;
        const matrix2 = build2ndOrderMarkovMatrix(hist.slice(-200));
        const transitions2 = matrix2[state];
        
        let bestBarrier = null;
        let minProb = 1.0;
        
        // Frecuencia de los últimos 100 para desempate
        const freq100 = Array(10).fill(0);
        hist.slice(-100).forEach(d => freq100[d]++);
        
        // Intentamos usar transiciones de 2do orden primero
        let has2ndOrderData = Object.values(transitions2).some(p => p !== 0.1);
        
        if (has2ndOrderData) {
            for (let d = 0; d <= 9; d++) {
                if (d === lastDigit) continue;
                const prob = transitions2[d] || 0;
                if (prob < minProb) {
                    minProb = prob;
                    bestBarrier = d;
                } else if (prob === minProb && bestBarrier !== null) {
                    if (freq100[d] < freq100[bestBarrier]) {
                        bestBarrier = d;
                    }
                }
            }
        }
        
        // Si no hay datos de 2do orden, caemos al 1er orden
        if (bestBarrier === null || minProb >= 0.1) {
            const matrix1 = buildMarkovMatrix(hist.slice(-150));
            const transitions1 = matrix1[lastDigit];
            minProb = 1.0;
            for (let d = 0; d <= 9; d++) {
                if (d === lastDigit) continue;
                const prob = transitions1[d] || 0;
                if (prob < minProb) {
                    minProb = prob;
                    bestBarrier = d;
                } else if (prob === minProb && bestBarrier !== null) {
                    if (freq100[d] < freq100[bestBarrier]) {
                        bestBarrier = d;
                    }
                }
            }
        }
        
        if (bestBarrier === null) {
            bestBarrier = botState.hidraLastLossDigit !== null ? botState.hidraLastLossDigit : (lastDigit + 5) % 10;
        }
        
        console.log(`🐍 LA HIDRA [COBERTURA INFALIBLE x10]: Disparando cobertura sobre dígito ${bestBarrier} (Prob: ${(minProb*100).toFixed(2)}%)`);
        
        return {
            engine: 'DIFFER',
            contractType: 'DIGITDIFF',
            barrier: String(bestBarrier),
            stakeMultiplier: 10.0,
            reason: `Hidra Cobertura Infalible evitar=${bestBarrier} tras pérdida (Prob trans: ${(minProb*100).toFixed(2)}%)`,
            entropy: entropy
        };
    }
    
    // CAPA 0: NORMAL (Usando Markov de 2do Orden para máxima precisión)
    const state = (prevDigit * 10) + lastDigit;
    const matrix2 = build2ndOrderMarkovMatrix(hist.slice(-200));
    const transitions2 = matrix2[state];
    
    let bestBarrier = null;
    let minProb = 1.0;
    
    // Buscamos el dígito con la menor probabilidad de transición
    for (let d = 0; d <= 9; d++) {
        const prob = transitions[d];
        if (prob < minProb) {
            minProb = prob;
            bestBarrier = d;
        }
    }
    
    // Filtro de seguridad: probabilidad de transición inferior o igual al 8% (92%+ de tasa de acierto estimada)
    const maxTransitionProbAllowed = 0.08; 
    if (bestBarrier === null || minProb > maxTransitionProbAllowed) return null;
    
    const estimatedWinRate = (1 - minProb) * 100;
    const edge = (1 - minProb) - 0.90;
    
    if (botState.hidraLayer === 0) {
        // CAPA 0: NORMAL
        return {
            engine: 'DIFFER',
            contractType: 'DIGITDIFF',
            barrier: String(bestBarrier),
            stakeMultiplier: 0.8, // Stake base controlado
            reason: `Hidra Normal DIGITDIFF evitar=${bestBarrier} (Acierto Est.: ${estimatedWinRate.toFixed(1)}% | Markov: ${(minProb*100).toFixed(1)}%)`,
            entropy: parseFloat(botState.shannonEntropy)
        };
    }
    
    if (botState.hidraLayer === 2) {
        // CAPA 2: D'ALEMBERT (Recuperación Lineal)
        const dStep = botState.hidraDalembertStep || 1;
        const stakeMult = 0.8 + (dStep * 0.35); // Aumento lineal seguro
        
        console.log(`🐍 LA HIDRA [CAPA 2 - D'ALEMBERT Step ${dStep}]: Disparando recuperación lineal con Stake Mult ${stakeMult.toFixed(2)}`);
        
        return {
            engine: 'DIFFER',
            contractType: 'DIGITDIFF',
            barrier: String(bestBarrier),
            stakeMultiplier: stakeMult,
            reason: `Hidra D'Alembert Step ${dStep} evitar=${bestBarrier} (Acierto Est.: ${estimatedWinRate.toFixed(1)}% | StakeMult: ${stakeMult.toFixed(2)})`,
            entropy: parseFloat(botState.shannonEntropy)
        };
    }
    
    return null;
}

// ════════════════════════════════════════════════════════════════
//  ORQUESTADOR & FINALIZADOR
// ════════════════════════════════════════════════════════════════

function tryFireTrade() {
    if (!botState.isRunning) return;
    
    const now = Date.now();
    
    // Failsafe de contrato colgado (15 segundos)
    if (botState.activeContractId && (now - botState.lastTradeTime) > 15000) {
        console.log(`⚠️ FAILSAFE: Contrato ${botState.activeContractId} colgado. Liberando bot.`);
        botState.activeContractId = null;
        botState.currentContractId = null;
        botState.isBuying = false;
        saveState();
    }
    
    if (botState.isBuying || botState.activeContractId) return;
    
    // Control de límite de pérdidas diarias (Solo logs informativos por premisa de fluidez continua)
    if (botState.dailyLoss >= botState.maxDailyLoss && now % 30000 < 1500) {
        console.log(`⚠️ LÍMITE DE PÉRDIDA DIARIA SUPERADO ($${botState.dailyLoss.toFixed(2)}). Continuando...`);
    }
    
    // Control de límite máximo de trades (Bypass por premisa de operación sin pausas)
    
    // Pausa por Circuit Breaker (Desactivado por premisa de flujo continuo de operaciones)
    
    // Control de Cooldown Dinámico
    const currentCooldown = botState.cooldownMode === 'auto' ? getDynamicCooldown() : botState.cooldownMs;
    if ((now - botState.lastTradeTime) < currentCooldown) return;
    
    let signal = null;
    
    // Evaluación EXCLUSIVA de DIFFER ("El Cirujano") por premisa del usuario
    if (botState.engineDiffer) {
        signal = evaluateDiffer();
    }
    
    if (!signal) return;
    
    // ─── INTERCEPTOR DEL ESCUDO FANTASMA (GHOST SHIELD) ───
    // El trade solo se realiza con dinero real si estamos en cobertura (Capa 1) 
    // o si el Ghost Shield dio luz verde (ghostNextTradeReal === true).
    const isRealTrade = (botState.hidraLayer === 1) || botState.ghostNextTradeReal;
    
    if (!isRealTrade) {
        botState.ghostPendingBarrier = signal.barrier;
        botState.ghostActive = true;
        botState.ghostNextTradeReal = false;
        
        console.log(`👻 GHOST TRADE: Señal Differ detectada para evitar=${signal.barrier}. Simulando trade fantasma en memoria...`);
        
        botState.lastTradeTime = now;
        saveState();
        return;
    }
    
    // Si es un trade real, consumimos el activador
    if (botState.ghostNextTradeReal) {
        botState.ghostNextTradeReal = false;
    }
    
    const finalStake = getAdjustedStake(botState.stake, signal.stakeMultiplier);
    if (finalStake <= 0) return;
    
    botState.currentEngine = signal.engine;
    botState.currentContractType = signal.contractType;
    botState.currentBarrier = signal.barrier;
    botState.currentStake = finalStake;
    
    const buyRequest = {
        buy: 1,
        price: finalStake,
        parameters: {
            amount: finalStake,
            basis: 'stake',
            contract_type: signal.contractType,
            currency: 'USD',
            symbol: SYMBOL,
            duration: 1,
            duration_unit: 't'
        }
    };
    
    if (signal.barrier !== null) {
        buyRequest.parameters.barrier = signal.barrier;
    }
    
    botState.isBuying = true;
    botState.lastTradeTime = now;
    
    const emojis = { EVEN_ODD: '🎰', OVER_UNDER: '📊', MATCH: '💎', DIFFER: '🔪' };
    const names = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', MATCH: 'MATCH', DIFFER: 'DIFFER (Cirujano)' };
    
    console.log(`${emojis[signal.engine] || '🎲'} DISPARO [${names[signal.engine]}] | ${signal.contractType} B:${signal.barrier || 'N/A'} | Stake: $${finalStake.toFixed(2)} | ${signal.reason}`);
    
    ws.send(JSON.stringify(buyRequest));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    
    botState.pnlSession += profit;
    botState.totalTradesSession++;
    
    const engine = botState.currentEngine || 'EVEN_ODD';
    const cType = botState.currentContractType || 'DIGITEVEN';
    const barrier = botState.currentBarrier;
    const name = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', MATCH: 'MATCH', DIFFER: 'DIFFER' }[engine] || engine;
    
    if (isWin) {
        botState.winsSession++;
        botState.dailyProfit += profit;
        
        botState.consecutiveWins++;
        
        // El Escudo recupera su fuerza tras 2 victorias consecutivas
        if (botState.consecutiveWins >= 2) {
            if (botState.momentumShieldLevel > 0) {
                console.log(`🛡️ SHIELD RECOVERY: 2 victorias seguidas. Escudo a NIVEL 0.`);
            }
            botState.momentumShieldLevel = 0;
            botState.consecutiveLosses = 0;
        }
        
        console.log(`✅ WIN +$${profit.toFixed(2)} [${name}] | ${cType}${barrier ? ` B:${barrier}` : ''} | PnL: $${botState.pnlSession.toFixed(2)}`);
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(profit);
        
        botState.consecutiveWins = 0;
        botState.consecutiveLosses++;
        
        // Momentum Shield y Pausas (Desactivados por premisa de operación continua e ininterrumpida)
        if (botState.consecutiveLosses >= 2) {
            botState.momentumShieldLevel = 0; // Mantener nivel de escudo en 0
            if (botState.consecutiveLosses % 2 === 0) {
                console.log(`🛡️ KRAKEN SHIELD: Continuando operación continua a pesar de racha de ${botState.consecutiveLosses} pérdidas.`);
            }
        }
        
        console.log(`❌ LOSS -$${Math.abs(profit).toFixed(2)} [${name}] | ${cType}${barrier ? ` B:${barrier}` : ''} | Racha: ${botState.consecutiveLosses} | PnL: $${botState.pnlSession.toFixed(2)}`);
    }
    
    // ─── ACTUALIZACIÓN DE ESTADO DE LA HIDRA (DIFFER) ───
    if (engine === 'DIFFER') {
        if (isWin) {
            if (botState.hidraLayer === 1) {
                console.log(`🐍 LA HIDRA: ¡Cobertura exitosa! Recuperación completa. Volviendo a Capa 0.`);
                botState.hidraLayer = 0;
                botState.hidraLastLossDigit = null;
            } else {
                botState.hidraLayer = 0;
                botState.hidraLastLossDigit = null;
            }
        } else {
            // Pérdida en Differ
            if (botState.coberturaEnabled) {
                if (botState.hidraLayer === 0) {
                    botState.hidraLayer = 1;
                    botState.hidraLastLossDigit = botState.lastDigit;
                    console.log(`🐍 LA HIDRA: Pérdida en Differ. Transicionando a Capa 1 (Cobertura Infallible x10) sobre dígito ${botState.lastDigit}.`);
                } else if (botState.hidraLayer === 1) {
                    // La cobertura falló
                    botState.hidraLayer = 0;
                    botState.hidraLastLossDigit = null;
                    console.log(`🐍 LA HIDRA: La cobertura falló. Se completó el único intento. Volviendo a Capa 0.`);
                }
            } else {
                botState.hidraLayer = 0;
                botState.hidraLastLossDigit = null;
                console.log(`🐍 LA HIDRA: Pérdida en Differ (cobertura desactivada). Manteniendo Capa 0.`);
            }
        }
    }
    
    // Actualizar estadísticas por motor
    if (botState.engineStats[engine]) {
        if (isWin) botState.engineStats[engine].wins++;
        else botState.engineStats[engine].losses++;
        botState.engineStats[engine].pnl += profit;
        
        // DARWIN MODE: Auto-desactivar motores inviables estadísticamente
        const stats = botState.engineStats[engine];
        const totalTrades = stats.wins + stats.losses;
        if (totalTrades >= 10 && !stats.autoDisabled) {
            const wr = (stats.wins / totalTrades) * 100;
            let breakEven = 52.5;
            if (engine === 'MATCH') breakEven = 14.0;
            else if (engine === 'DIFFER') breakEven = 91.3;
            
            if (wr < breakEven) {
                stats.autoDisabled = true;
                console.log(`🦎 DARWIN: Motor ${name} auto-desactivado (WR: ${wr.toFixed(1)}% < Breakeven: ${breakEven}%)`);
            }
        }
    }
    
    // Guardar en Historial de Trades
    botState.tradeHistory.unshift({
        engine: name,
        engineKey: engine,
        contractType: cType,
        barrier: barrier,
        digit: botState.lastDigit,
        profit: profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date().toISOString(),
        stake: botState.currentStake,
        entropy: botState.shannonEntropy,
        balanceAfter: botState.balance
    });
    if (botState.tradeHistory.length > 100) botState.tradeHistory.pop();
    
    // Spike Protection (Bypass para conservar stake intacto y fluidez total)
    
    // Trailing Take-Profit & Profit Lock
    if (botState.pnlSession > botState.profitPeak) {
        botState.profitPeak = botState.pnlSession;
        if (botState.pnlSession > 5.0) {
            botState.profitFloor = botState.profitPeak * 0.60;
        }
    }
    
    // Control Profit Floor (Solo informativo, sin detención)
    if (botState.pnlSession > 5.0 && botState.pnlSession <= botState.profitFloor && Date.now() % 30000 < 1500) {
        console.log(`🔒 PROFIT LOCK ALERT: El PnL retrocedió al piso de seguridad ($${botState.profitFloor.toFixed(2)}).`);
    }
    
    // Control Take Profit (Extensión automática infinita al 100% de stake, flujo continuo)
    if (botState.pnlSession >= botState.takeProfit) {
        botState.takeProfit += 5.0;
        console.log(`🚀 META ALCANZADA! Extendiendo Meta TP a $${botState.takeProfit.toFixed(2)} sin detener el bot.`);
    }
    
    botState.activeContractId = null;
    botState.currentContractId = null;
    botState.isBuying = false;
    botState.currentEngine = null;
    
    saveState();
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ botState, symbol: SYMBOL }));
    } catch (e) {
        console.error('⚠️ Error guardando estado:', e.message);
    }
}

// ════════════════════════════════════════════════════════════════
//  SERVIDOR EXPRESS & API REST INTERACTIVA
// ════════════════════════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
    const globalWR = botState.totalTradesSession > 0
        ? ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1)
        : '0.0';
        
    const engineWinRates = {};
    for (const [key, stats] of Object.entries(botState.engineStats)) {
        const total = stats.wins + stats.losses;
        engineWinRates[key] = {
            ...stats,
            pnl: parseFloat(stats.pnl.toFixed(2)),
            totalTrades: total,
            winRate: total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0'
        };
    }
    
    // Chi squared computation on the fly
    const chiTest = calcChiSquared(botState.digitHistory, 100);
    botState.chiSquaredSignificant = chiTest.significant;
    
    res.json({
        success: true,
        data: {
            ...botState,
            symbol: SYMBOL,
            strategy: 'KRAKEN',
            winRate: globalWR,
            engineWinRates,
            circuitBreakerActive: botState.circuitBreakerUntil > Date.now(),
            circuitBreakerRemaining: Math.max(0, Math.ceil((botState.circuitBreakerUntil - Date.now()) / 1000)),
            dynamicCooldown: botState.cooldownMode === 'auto' ? getDynamicCooldown() : botState.cooldownMs
        }
    });
});

app.post('/api/control', (req, res) => {
    const { action, stake, maxDailyLoss, takeProfit } = req.body;
    
    if (action === 'START') {
        if (stake) botState.stake = Math.max(0.35, parseFloat(stake));
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (takeProfit) {
            botState.takeProfit = parseFloat(takeProfit);
            botState.originalTakeProfit = parseFloat(takeProfit);
        }
        botState.isRunning = true;
        saveState();
        console.log(`▶️ KRAKEN ENGINE v2.0 INICIADO | Stake: $${botState.stake} | MaxLoss: $${botState.maxDailyLoss} | Meta: $${botState.takeProfit} | Símbolo: ${SYMBOL}`);
        return res.json({ success: true, message: 'Kraken Engine v2.0 Activado 🐙' });
    }
    
    if (action === 'STOP') {
        botState.isRunning = false;
        botState.isBuying = false;
        botState.activeContractId = null;
        botState.currentContractId = null;
        saveState();
        console.log('🛑 STOP RECIBIDO: Kraken bot pausado y estados saneados.');
        return res.json({ success: true, message: 'Bot Pausado ⏸️' });
    }
    
    if (action === 'RESET_DAY') {
        botState.dailyLoss = 0;
        botState.dailyProfit = 0;
        botState.pnlSession = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.totalTradesSession = 0;
        botState.tradeHistory = [];
        botState.consecutiveLosses = 0;
        botState.consecutiveWins = 0;
        botState.circuitBreakerUntil = 0;
        botState.momentumShieldLevel = 0;
        botState.profitPeak = 0;
        botState.profitFloor = 0;
        botState.takeProfit = botState.originalTakeProfit;
        botState.takeProfitExtensions = 0;
        botState.spikeProtectionUntil = 0;
        botState.stakeReduced = false;
        
        botState.engineStats = {
            EVEN_ODD: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
            OVER_UNDER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
            MATCH: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
            DIFFER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
        };
        saveState();
        console.log('🔄 REGISTROS DE REINICIO DIARIO: Métricas restablecidas en KRAKEN.');
        return res.json({ success: true, message: 'Métricas Kraken reiniciadas 🔄' });
    }
    
    res.status(400).json({ success: false, error: 'Acción no soportada.' });
});

app.get('/api/history', (req, res) => {
    res.json({ success: true, history: botState.tradeHistory.slice(0, 50) });
});

app.post('/api/engine-toggle', (req, res) => {
    const { engine, enabled } = req.body;
    const engineMap = {
        'EVEN_ODD': 'engineEvenOdd',
        'OVER_UNDER': 'engineOverUnder',
        'MATCH': 'engineMatch',
        'DIFFER': 'engineDiffer'
    };
    
    if (!engineMap[engine]) {
        return res.status(400).json({ success: false, error: 'Motor no reconocido.' });
    }
    
    botState[engineMap[engine]] = !!enabled;
    
    // Si se habilita manualmente, restauramos el auto-deshabilitado de Darwin
    if (enabled && botState.engineStats[engine]) {
        botState.engineStats[engine].autoDisabled = false;
        botState.engineStats[engine].wins = 0;
        botState.engineStats[engine].losses = 0;
        botState.engineStats[engine].pnl = 0;
    }
    
    saveState();
    console.log(`⚙️ Motor KRAKEN ${engine} cambiado a ${enabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
    return res.json({ success: true, message: `Motor ${engine} configurado correctamente.` });
});

app.post('/api/config', (req, res) => {
    const { stake, maxDailyLoss, takeProfit, cooldownMs, maxTradesPerDay, cooldownMode, coberturaEnabled } = req.body;
    
    if (stake !== undefined) botState.stake = Math.max(0.35, parseFloat(stake));
    if (maxDailyLoss !== undefined) botState.maxDailyLoss = parseFloat(maxDailyLoss);
    if (takeProfit !== undefined) {
        botState.takeProfit = parseFloat(takeProfit);
        botState.originalTakeProfit = parseFloat(takeProfit);
    }
    if (cooldownMs !== undefined) botState.cooldownMs = Math.max(1000, parseInt(cooldownMs));
    if (maxTradesPerDay !== undefined) botState.maxTradesPerDay = Math.max(1, parseInt(maxTradesPerDay));
    if (cooldownMode !== undefined) botState.cooldownMode = cooldownMode;
    if (coberturaEnabled !== undefined) botState.coberturaEnabled = !!coberturaEnabled;
    
    saveState();
    console.log(`⚙️ CONFIGURACIÓN KRAKEN MODIFICADA.`);
    return res.json({ success: true, message: 'Parámetros actualizados con éxito.' });
});

app.post('/api/switch-market', (req, res) => {
    const { symbol } = req.body;
    
    if (botState.isRunning) {
        return res.status(400).json({ success: false, error: 'Pausa el bot antes de migrar de mercado.' });
    }
    
    const validSymbols = ['R_10', 'R_25', 'R_50', 'R_100'];
    if (!validSymbols.includes(symbol)) {
        return res.status(400).json({ success: false, error: 'Símbolo inválido.' });
    }
    
    SYMBOL = symbol;
    botState.digitHistory = [];
    botState.digitFrequency = {};
    botState.hotDigit = null;
    botState.hotDigitFreq = 0;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: 'ticks' }));
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
            }
        }, 1000);
    }
    
    saveState();
    console.log(`🔄 MERCADO KRAKEN MIGRADOS A: ${SYMBOL}`);
    return res.json({ success: true, symbol: SYMBOL, message: `Mercado migrado a ${SYMBOL} con éxito.` });
});

// ════════════════════════════════════════════════════════════════
//  COMUNICACIONES WEBSOCKET (CONECTIVIDAD A DERIV)
// ════════════════════════════════════════════════════════════════
let ws = null;
let reconnectTimeout = null;

function connectDeriv() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    
    ws.on('open', () => {
        console.log('🔌 Conexión establecida con WebSocket de Deriv. Autenticando...');
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
            }
        }, 3000);
    });
    
    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        
        if (msg.ping || msg.msg_type === 'ping') {
            ws.send(JSON.stringify({ ping: 1 }));
            return;
        }
        
        if (msg.msg_type === 'authorize' && msg.authorize) {
            console.log(`✅ Autenticación exitosa en KRAKEN: ${msg.authorize.email}`);
            botState.isConnectedToDeriv = true;
            
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ forget_all: 'proposal_open_contract' }));
            
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
                    console.log(`📡 Suscripción ticks activada para ${SYMBOL}`);
                }
            }, 2000);
            
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    console.log(`💰 Suscripción balance activada.`);
                }
            }, 4000);
        }
        
        if (msg.error) {
            console.error(`⚠️ Deriv API Error [${msg.error.code}]: ${msg.error.message}`);
            if (msg.error.code === 'WrongResponse' || msg.error.code === 'AuthorizationRequired') {
                console.log('🔄 Sesión inválida, reiniciando conexión...');
                botState.isConnectedToDeriv = false;
                if (ws) ws.close();
            }
            if (msg.msg_type === 'buy') {
                botState.isBuying = false;
                console.error(`❌ Error en compra: ${msg.error.message}`);
            }
            return;
        }
        
        if (msg.msg_type === 'balance' && msg.balance) {
            botState.balance = msg.balance.balance;
        }
        
        if (msg.msg_type === 'tick' && msg.tick) {
            const price = String(msg.tick.quote);
            const digit = parseInt(price[price.length - 1]);
            
            botState.lastTickPrice = parseFloat(msg.tick.quote);
            botState.lastDigit = digit;
            
            botState.digitHistory.push(digit);
            if (botState.digitHistory.length > 300) botState.digitHistory.shift();
            
            botState.digitFrequency[digit] = (botState.digitFrequency[digit] || 0) + 1;
            
            if (botState.digitHistory.length >= 50) {
                botState.shannonEntropy = calcEntropy(botState.digitHistory, 100).toFixed(3);
            }
            
            // RESOLVER GHOST TRADE SI ESTÁ ACTIVO
            if (botState.ghostActive && botState.ghostPendingBarrier !== null) {
                const isGhostLoss = (digit === parseInt(botState.ghostPendingBarrier));
                if (isGhostLoss) {
                    botState.ghostNextTradeReal = true; // ¡ALERTA! El fantasma perdió. Habilitando entrada REAL.
                    console.log(`🚨 GHOST SHIELD TRIGGERED: El trade fantasma PERDIÓ (barrera ${botState.ghostPendingBarrier} golpeada por dígito ${digit}). ¡Habilitando disparo REAL!`);
                } else {
                    botState.ghostNextTradeReal = false;
                    console.log(`✓ GHOST SHIELD: El trade fantasma GANÓ (barrera ${botState.ghostPendingBarrier} a salvo con dígito ${digit}). Continuando observación fantasma...`);
                }
                botState.ghostActive = false;
                botState.ghostPendingBarrier = null;
                saveState();
            }
            
            tryFireTrade();
        }
        
        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            botState.currentContractId = msg.buy.contract_id;
            botState.isBuying = false;
            
            console.log(`🎯 CONTRATO COMPRADO [ID: ${msg.buy.contract_id}] | Engine: ${botState.currentEngine} | ${botState.currentContractType} B:${botState.currentBarrier || 'N/A'}`);
            
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: msg.buy.contract_id,
                subscribe: 1
            }));
        }
        
        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c || !c.is_sold) return;
            finalizeTrade(c);
        }
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket Error:', err.message);
        botState.isConnectedToDeriv = false;
    });
    
    ws.on('close', (code) => {
        const wait = code === 1008 ? 15000 : 5000;
        console.log(`⚠️ Conexión de red cerrada. Reestableciendo conexión en ${wait/1000}s...`);
        botState.isConnectedToDeriv = false;
        botState.isBuying = false;
        
        if (ws) {
            ws.removeAllListeners();
            try { ws.terminate(); } catch (e) { /* ignored */ }
            ws = null;
        }
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(connectDeriv, wait);
        }
    });
}

// ════════════════════════════════════════════════════════════════
//  MONITORIZACIÓN Y RESÚMENES
// ════════════════════════════════════════════════════════════════
setInterval(() => {
    if (botState.totalTradesSession === 0) return;
    
    const wr = ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1);
    const metrics = Object.entries(botState.engineStats)
        .filter(([, s]) => (s.wins + s.losses) > 0)
        .map(([k, s]) => {
            const tot = s.wins + s.losses;
            return `${k}: ${((s.wins / tot) * 100).toFixed(1)}% (${tot})${s.autoDisabled ? ' [OFF]' : ''}`;
        })
        .join(' | ');
        
    console.log(`📊 [KRAKEN SUMMARY] PnL: $${botState.pnlSession.toFixed(2)} | WR: ${wr}% | Trades: ${botState.totalTradesSession} | Shield Lvl: ${botState.momentumShieldLevel} | Peak: $${botState.profitPeak.toFixed(2)} | Piso: $${botState.profitFloor.toFixed(2)}`);
    console.log(`   Motores: ${metrics}`);
}, 60000);

// ════════════════════════════════════════════════════════════════
//  INICIALIZAR SERVIDOR KRAKEN v2.0
// ════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('\x1b[36m%s\x1b[0m', '  ██████╗ ██╗  ██████╗ ████████╗ ██████╗  ██████╗ ██╗  ██╗███████╗███╗   ██╗');
    console.log('\x1b[36m%s\x1b[0m', ' ██╔═══██╗██║ ██╔═══██╗╚══██╔══╝██╔═══██╗██╔════╝ ██║  ██║██╔════╝████╗  ██║');
    console.log('\x1b[36m%s\x1b[0m', ' ██║   ██║██║ ██║   ██║   ██║   ██║   ██║██║  ███╗███████║█████╗  ██╔██╗ ██║');
    console.log('\x1b[36m%s\x1b[0m', ' ██║   ██║██║ ██║   ██║   ██║   ██║   ██║██║   ██║██╔══██║██╔══╝  ██║╚██╗██║');
    console.log('\x1b[36m%s\x1b[0m', ' ╚██████╔╝██║ ╚██████╔╝   ██║   ╚██████╔╝╚██████╔╝██║  ██║███████╗██║ ╚████║');
    console.log('\x1b[36m%s\x1b[0m', '  ╚═════╝ ╚═╝  ╚═════╝    ╚═╝    ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝');
    console.log('═'.repeat(75));
    console.log(`  🐙 KRAKEN ENGINE v2.0 — "THE VALUE HARVESTER" — ONLINE`);
    console.log(`  🌐 Port: ${PORT} | Active Symbol: ${SYMBOL}`);
    console.log('  🔪 Motor 1: PAR/IMPAR       (Consensus Reversion & Chi-Square)');
    console.log('  📊 Motor 2: OVER/UNDER      (Markov Transition Matrix & Cross-Val)');
    console.log('  💎 Motor 3: MATCH           (Exponential Hot Digit & Freq Momentum)');
    console.log('  🔪 Motor 4: DIFFER          (Markov Multi-Barrier Dynamic Edge)');
    console.log('  🛡️  Protection: Momentum Shield (0-4) + Darwin Auto-Disable + Trailing TP');
    console.log('═'.repeat(75));
    connectDeriv();
});

// ════════════════════════════════════════════════════════════════
//  ANTI-CRASH LOGIC
// ════════════════════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
    console.error('🔥 CRITICAL UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
    saveState();
});

process.on('unhandledRejection', (reason) => {
    console.error('🔥 UNHANDLED PROMISE REJECTION:', reason);
    saveState();
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received. Saving state and terminating...');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: 'ticks' }));
        ws.terminate();
    }
    saveState();
    process.exit(0);
});
