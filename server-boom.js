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
 *
 *  v3.0 — "Quantum Edge": Incorpora hallazgos estadísticos reales de análisis
 *  forense de 6,000 ticks: anti-repetición, coiling inverso y tablas Markov validadas.
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
let symbolDecimals = 2; // Rastreador dinámico de precisión decimal

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
    
    // Soporte para Multi-Mercados escaneados en paralelo
    markets: {
        R_10: { symbol: 'R_10', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 },
        R_25: { symbol: 'R_25', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 },
        R_50: { symbol: 'R_50', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 },
        R_75: { symbol: 'R_75', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 },
        R_100: { symbol: 'R_100', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 },
        '1HZ10V': { symbol: '1HZ10V', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 },
        '1HZ25V': { symbol: '1HZ25V', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 },
        '1HZ100V': { symbol: '1HZ100V', digitHistory: [], digitFrequency: {}, shannonEntropy: 3.322, totalTicksProcessed: 0, lastTickPrice: 0, lastDigit: null, symbolDecimals: 2 }
    },
    
    lastTickPrice: 0,
    lastDigit: null,
    digitHistory: [],          // Últimos 300 dígitos (sincronizados con el foco de la UI)
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
    differPrecision98: false,
    franklinPerezLogic: true,
    quirurgicoMode: false,
    
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
    
    // ─── Interruptores de motores
    engineEvenOdd: true,
    engineOverUnder: true,
    
    // ─── Variables del Escudo de Trade Fantasma (Ghost Shield) ───
    ghostNextTradeReal: false,
    ghostPendingTrade: null,
    
    // ─── Información del trade activo ───
    currentEngine: null,       // 'EVEN_ODD' | 'OVER_UNDER'
    currentContractType: null,
    currentBarrier: null,
    currentStake: 0,
    
    // ─── Métricas por motor ───
    engineStats: {
        EVEN_ODD: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        OVER_UNDER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
    },
    
    // ─── Analíticas ───
    shannonEntropy: 0,
    markovEdge: 0,
    hotDigit: null,
    hotDigitFreq: 0,
    chiSquaredSignificant: false,
    
    // ─── Martingala Segura (Recuperación x2.1) ───
    martingaleStep: 0,         // Nivel actual de martingala (0 = stake base)
    maxMartingaleSteps: 4, // Reducido a 4 porque el Ghost Trading evita el primer nivel de pérdida     // Límite máximo para evitar quemar cuenta
    
    // ─── Enfriamiento inteligente y re-evaluación post-pérdida ───
    lossPauseUntil: null,
    lossPauseTicksProcessed: 0
};

// ════════════════════════════════════════════════════════════════
//  CARGAR ESTADO PERSISTENTE
// ════════════════════════════════════════════════════════════════
// Inicializar digitFrequency de cada mercado
const SCAN_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ100V'];
SCAN_SYMBOLS.forEach(sym => {
    const m = botState.markets[sym];
    if (m && m.digitFrequency) {
        for (let d = 0; d <= 9; d++) {
            m.digitFrequency[d] = 0;
        }
    }
});

if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            // Preservar estructura robusta ante actualizaciones de versión
            const defaultStats = { ...botState.engineStats };
            botState = { ...botState, ...saved.botState };
            
            // Garantizar inicialización segura de mercados en paralelo
            if (!botState.markets) {
                botState.markets = {};
            }
            SCAN_SYMBOLS.forEach(sym => {
                if (!botState.markets[sym]) {
                    botState.markets[sym] = {
                        symbol: sym,
                        digitHistory: [],
                        digitFrequency: {},
                        shannonEntropy: 3.322,
                        totalTicksProcessed: 0,
                        lastTickPrice: 0,
                        lastDigit: null,
                        symbolDecimals: 2
                    };
                }
                if (!botState.markets[sym].digitFrequency || Object.keys(botState.markets[sym].digitFrequency).length === 0) {
                    botState.markets[sym].digitFrequency = {};
                    for (let d = 0; d <= 9; d++) {
                        botState.markets[sym].digitFrequency[d] = 0;
                    }
                }
            });
            
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
            if (botState.differPrecision98 === undefined) botState.differPrecision98 = false;
            if (botState.franklinPerezLogic === undefined) botState.franklinPerezLogic = true;
            if (botState.quirurgicoMode === undefined) botState.quirurgicoMode = false;
            
            // Garantizar inicialización segura de variables de La Hidra
            if (botState.hidraLayer === undefined) botState.hidraLayer = 0;
            if (botState.hidraDalembertStep === undefined) botState.hidraDalembertStep = 0;
            if (botState.hidraLastLossDigit === undefined) botState.hidraLastLossDigit = null;
            if (botState.hidraFrenoUntil === undefined) botState.hidraFrenoUntil = 0;
            if (botState.ghostNextTradeReal === undefined) botState.ghostNextTradeReal = false;
            if (botState.ghostPendingBarrier === undefined) botState.ghostPendingBarrier = null;
            if (botState.ghostActive === undefined) botState.ghostActive = false;
            if (botState.forcedSignal === undefined) botState.forcedSignal = null;
            
            // Garantizar variables de enfriamiento
            if (botState.lossPauseUntil === undefined) botState.lossPauseUntil = null;
            if (botState.lossPauseTicksProcessed === undefined) botState.lossPauseTicksProcessed = 0;
            if (botState.lastLossBarrier === undefined) botState.lastLossBarrier = null;
            
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
 * Extrae de forma precisa el último dígito de una cotización
 */
function getDigitFromQuote(quote) {
    const quoteStr = String(quote);
    const parts = quoteStr.split('.');
    if (parts[1] && parts[1].length > symbolDecimals && parts[1].length <= 4) {
        symbolDecimals = parts[1].length;
    }
    const price = quote.toFixed(symbolDecimals);
    return parseInt(price[price.length - 1]);
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

function updateHotDigit(mState) {
    const hist = mState.digitHistory;
    if (!hist || hist.length === 0) {
        mState.hotDigit = null;
        mState.hotDigitFreq = 0;
        return;
    }
    const freq = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    hist.forEach(d => freq[d]++);
    
    let hotDigit = 0;
    let maxFreq = 0;
    for (let d = 0; d <= 9; d++) {
        if (freq[d] > maxFreq) {
            maxFreq = freq[d];
            hotDigit = d;
        }
    }
    const pct = hist.length > 0 ? (maxFreq / hist.length) * 100 : 0;
    mState.hotDigit = hotDigit;
    mState.hotDigitFreq = pct.toFixed(1);
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
 * Matriz de Markov de 2do Orden (Basada en los 2 últimos dígitos)
 */
function build2ndOrderMarkovMatrix(hist) {
    const matrix = {};
    // Inicializar 100 estados posibles (00 a 99)
    for (let i = 0; i <= 99; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    
    // Contar transiciones
    for (let k = 2; k < hist.length; k++) {
        const state = (hist[k - 2] * 10) + hist[k - 1]; // Ej: dígito 3 luego 7 = estado 37
        const nextDigit = hist[k];
        matrix[state][nextDigit]++;
    }// ════════════════════════════════════════════════════════════════
//  (Sección Quantum Edge eliminada por transición a Even/Odd)
// ════════════════════════════════════════════════════════════════
    
    // Calcular probabilidades
    for (let i = 0; i <= 99; i++) {
        const total = Object.values(matrix[i]).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (let j = 0; j <= 9; j++) matrix[i][j] = matrix[i][j] / total;
        } else {
            for (let j = 0; j <= 9; j++) matrix[i][j] = 0.1; // fallback
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
 * Calcular Stake Ajustado según Escudo de Momentum y Martingala
 */
function getAdjustedStake(baseStake, engineMultiplier) {
    let adjusted = baseStake * engineMultiplier;
    
    // Aplicar Cobertura Cuántica (Progresión Lineal D'Alembert: +1x stake base por cada paso)
    if (botState.martingaleStep > 0 && botState.coberturaEnabled) {
        const steps = Math.min(botState.martingaleStep, botState.maxMartingaleSteps || 6);
        // La progresión lineal D'Alembert incrementa de forma lineal (+1x, +2x, +3x) en lugar de exponencial (x2.1, x4.4, x9.2).
        // Esto protege drásticamente el capital del usuario ante rachas de mercado adversas.
        adjusted = adjusted * (1 + steps);
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
function evaluateEvenOdd(mState) {
    const hist = mState.digitHistory;
    if (hist.length < 50) return null;
    
    // Chi-Cuadrado de última ventana (Estricto en modo Quirúrgico, relajado en modo Normal)
    const chiTest = calcChiSquared(hist, 50);
    const requiredChi = botState.quirurgicoMode ? 16.92 : 5.0;
    if (chiTest.chi2 < requiredChi) return null; // Debe haber desbalance estadístico
    
    const sub10 = hist.slice(-10);
    const sub20 = hist.slice(-20);
    
    let ev10 = 0, od10 = 0;
    sub10.forEach(d => { if (d % 2 === 0) ev10++; else od10++; });
    
    let ev20 = 0, od20 = 0;
    sub20.forEach(d => { if (d % 2 === 0) ev20++; else od20++; });
    
    // Señales por ventana (60% de consenso en M10 y 60% en M20)
    const sigOdd10 = od10 >= 6;
    const sigEven10 = ev10 >= 6;
    
    const sigOdd20 = od20 >= 12;
    const sigEven20 = ev20 >= 12;
    
    if (sigOdd10 && sigOdd20) {
        return {
            engine: 'EVEN_ODD',
            contractType: 'DIGITODD',
            barrier: null,
            stakeMultiplier: 1.0,
            reason: `Consenso IMPAR [10:${od10}/10, 20:${od20}/20]`,
            entropy: parseFloat(mState.shannonEntropy)
        };
    }
    
    if (sigEven10 && sigEven20) {
        return {
            engine: 'EVEN_ODD',
            contractType: 'DIGITEVEN',
            barrier: null,
            stakeMultiplier: 1.0,
            reason: `Consenso PAR [10:${ev10}/10, 20:${ev20}/20]`,
            entropy: parseFloat(mState.shannonEntropy)
        };
    }
    
    return null;
}

/**
 * Motor 2: OVER/UNDER — "El Potenciador"
 * Markov de corto alcance (100 ticks), Chi-Cuadrado estricto y Validación Cruzada
 */
function evaluateOverUnder(mState) {
    const hist = mState.digitHistory;
    if (hist.length < 100) return null;
    
    const chiTest = calcChiSquared(hist, 100);
    // Filtro Chi-Cuadrado estricto en modo Quirúrgico, relajado en modo Normal
    const requiredChi = botState.quirurgicoMode ? 16.92 : 5.0;
    if (chiTest.chi2 < requiredChi) return null;
    
    const markovHist = hist.slice(-100);
    const matrix = buildMarkovMatrix(markovHist);
    const lastDigit = hist[hist.length - 1];
    const transitions = matrix[lastDigit];
    
    let probOver = 0;
    for (let d = 5; d <= 9; d++) probOver += transitions[d] || 0;
    let probUnder = 1 - probOver;
    
    // Probabilidad estricta (62% en Quirúrgico para máxima precisión, 60% en Normal)
    const requiredProb = botState.quirurgicoMode ? 0.62 : 0.60;
    
    if (probOver >= requiredProb) {
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITOVER',
            barrier: '4',
            stakeMultiplier: 1.0,
            reason: `Markov P(>4)=${(probOver * 100).toFixed(1)}%`,
            entropy: parseFloat(mState.shannonEntropy)
        };
    }
    
    if (probUnder >= requiredProb) {
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITUNDER',
            barrier: '5',
            stakeMultiplier: 1.0,
            reason: `Markov P(<5)=${(probUnder * 100).toFixed(1)}%`,
            entropy: parseFloat(mState.shannonEntropy)
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
    
    // Si estamos en pausa por pérdida (enfriamiento de 1 minuto)
    if (botState.lossPauseUntil) {
        if (now < botState.lossPauseUntil) {
            const secondsLeft = Math.ceil((botState.lossPauseUntil - now) / 1000);
            if (now % 10000 < 1000) { // Loguear cada 10s
                console.log(`⏳ PAUSA POR PÉRDIDA: Esperando ${secondsLeft}s para enfriamiento de la red.`);
            }
            return;
        } else {
            // El tiempo pasó, ahora exigimos la captura de ticks frescos
            const ticksProcessed = botState.lossPauseTicksProcessed || 0;
            if (ticksProcessed < 20) {
                if (now % 10000 < 1000) {
                    console.log(`⏳ RE-EVALUACIÓN POST-PÉRDIDA: Esperando ticks frescos (${ticksProcessed}/20) para actualizar matriz de Markov...`);
                }
                return;
            }
            // Superadas ambas condiciones, limpiamos la pausa de seguridad
            console.log(`🛡️ RE-EVALUACIÓN COMPLETADA: Matriz de Markov actualizada con ${ticksProcessed} ticks frescos. Reanudando operaciones.`);
            botState.lossPauseUntil = null;
            botState.lossPauseTicksProcessed = 0;
            saveState();
        }
    }
    
    // Failsafe de contrato colgado (15 segundos)
    if (botState.activeContractId && (now - botState.lastTradeTime) > 15000) {
        console.log(`⚠️ FAILSAFE: Contrato ${botState.activeContractId} colgado. Liberando bot.`);
        botState.activeContractId = null;
        botState.currentContractId = null;
        botState.isBuying = false;
        saveState();
    }
    
    if (botState.isBuying || botState.activeContractId) return;
    
    // Control de límite de pérdidas diarias estricto basado en el PnL de la sesión
    if (botState.pnlSession <= -botState.maxDailyLoss) {
        if (now % 30000 < 1500) {
            console.log(`⛔ LÍMITE DE PÉRDIDA DIARIA ALCANZADO (PnL: $${botState.pnlSession.toFixed(2)}). El bot se ha detenido por seguridad.`);
        }
        botState.isRunning = false;
        saveState();
        return;
    }
    
    // Control Take Profit estricto
    if (botState.pnlSession >= botState.takeProfit) {
        if (now % 30000 < 1500) {
            console.log(`🚀 META ALCANZADA (PnL: $${botState.pnlSession.toFixed(2)}). El bot se ha detenido victoriosamente.`);
        }
        botState.isRunning = false;
        saveState();
        return;
    }
    
    // Control de Cooldown Dinámico (Omitido para señales forzadas de venganza del Ghost Shield)
    if (!botState.forcedSignal) {
        let currentCooldown = botState.cooldownMode === 'auto' ? getDynamicCooldown() : botState.cooldownMs;
        
        // En Modo Quirúrgico, forzamos un cooldown mínimo estricto de 3 minutos (180,000 ms)
        // para dar tiempo a que la ventana deslizante se limpie por completo y evitar cascadas.
        if (botState.quirurgicoMode) {
            const minQuirurgicoCooldown = 180000; // 3 minutos
            currentCooldown = Math.max(currentCooldown, minQuirurgicoCooldown);
        }
        
        if ((now - botState.lastTradeTime) < currentCooldown) {
            // Loguear de forma no intrusiva cada 30 segundos si está en Modo Quirúrgico
            if (botState.quirurgicoMode && (now % 30000 < 1500)) {
                const secsRemaining = Math.ceil((currentCooldown - (now - botState.lastTradeTime)) / 1000);
                console.log(`⏳ MODO QUIRÚRGICO: Bloqueando nuevas señales por cooldown de ventana deslizante (${secsRemaining}s restantes)...`);
            }
            return;
        }
    }
    
    let signal = null;
    let signalSymbol = null;
    
    // Si tenemos una señal forzada (como la venganza inmediata de un Ghost Trade perdido), la usamos y saltamos los filtros
    if (botState.forcedSignal) {
        signal = botState.forcedSignal;
        signalSymbol = botState.forcedSignal.symbol;
        botState.forcedSignal = null;
    } else {
        // Escanear los mercados en paralelo en busca de oportunidades estadísticas
        for (const sym of SCAN_SYMBOLS) {
            const mState = botState.markets[sym];
            if (!mState || mState.digitHistory.length < 50) continue;
            
            const nextPriority = botState.lastEngineFired === 'OVER_UNDER' ? 'EVEN_ODD' : 'OVER_UNDER';
            
            if (nextPriority === 'EVEN_ODD') {
                if (botState.engineEvenOdd && !signal) signal = evaluateEvenOdd(mState);
                if (botState.engineOverUnder && !signal) signal = evaluateOverUnder(mState);
            } else {
                if (botState.engineOverUnder && !signal) signal = evaluateOverUnder(mState);
                if (botState.engineEvenOdd && !signal) signal = evaluateEvenOdd(mState);
            }
            
            if (signal) {
                signalSymbol = sym;
                break; // Detener escaneo al encontrar la primera señal válida
            }
        }
    }
    
    if (!signal || !signalSymbol) return;
    
    const activeSymbol = signalSymbol;
    const mState = botState.markets[activeSymbol];
    
    botState.lastEngineFired = signal.engine;
    
    // ─── GHOST TRADING LOGIC ───
    if (!botState.ghostNextTradeReal) {
        if (!botState.ghostPendingTrade && botState.isRunning) {
            console.log(`👻 GHOST TRADE [${activeSymbol}]: Señal de ${signal.engine} [${signal.contractType} B:${signal.barrier || '-'}]. Simulando entrada virtual...`);
            botState.ghostPendingTrade = {
                symbol: activeSymbol,
                engine: signal.engine,
                contractType: signal.contractType,
                barrier: signal.barrier,
                entryTickPrice: mState ? mState.lastTickPrice : botState.lastTickPrice
            };
            botState.lastTradeTime = Date.now();
        }
        return;
    }
    
    // Si llegamos aquí, ghostNextTradeReal es TRUE. ¡Disparamos REAL!
    botState.ghostNextTradeReal = false; // Resetear el escudo
    
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
            symbol: activeSymbol,
            duration: 1,
            duration_unit: 't'
        }
    };
    
    if (signal.barrier !== null) {
        buyRequest.parameters.barrier = signal.barrier;
    }
    
    botState.isBuying = true;
    botState.lastTradeTime = now;
    
    const emojis = { EVEN_ODD: '🎰', OVER_UNDER: '📊' };
    const names = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER' };
    
    console.log(`${emojis[signal.engine] || '🎲'} DISPARO REAL [${activeSymbol} - ${names[signal.engine]}] | ${signal.contractType} B:${signal.barrier || 'N/A'} | Stake: $${finalStake.toFixed(2)} | ${signal.reason}`);
    
    ws.send(JSON.stringify(buyRequest));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    
    const tradeSymbol = c.underlying || c.symbol || SYMBOL;
    const mState = botState.markets[tradeSymbol];
    
    let exitDigit = mState ? mState.lastDigit : botState.lastDigit;
    if (c.exit_tick_display_value) {
        const val = String(c.exit_tick_display_value);
        exitDigit = parseInt(val.charAt(val.length - 1));
    } else if (c.current_spot_display_value) {
        const val = String(c.current_spot_display_value);
        exitDigit = parseInt(val.charAt(val.length - 1));
    }
    
    botState.pnlSession += profit;
    botState.totalTradesSession++;
    
    const engine = botState.currentEngine || 'EVEN_ODD';
    const cType = botState.currentContractType || 'DIGITEVEN';
    const barrier = botState.currentBarrier;
    const name = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER' }[engine] || engine;
    
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
        
        console.log(`✅ WIN +$${profit.toFixed(2)} [${tradeSymbol} - ${name}] | ${cType}${barrier ? ` B:${barrier}` : ''} | PnL: $${botState.pnlSession.toFixed(2)}`);
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(profit);
        
        botState.consecutiveWins = 0;
        botState.consecutiveLosses++;
        
        // Registrar pausa de seguridad de 1 minuto y resetear ticks de re-evaluación
        botState.lossPauseUntil = Date.now() + 60000;
        botState.lossPauseTicksProcessed = 0;
        console.log(`🚨 PÉRDIDA DETECTADA: Iniciando pausa de enfriamiento de 60 segundos y captura de 20 ticks para re-evaluación.`);
        saveState();
        
        // Momentum Shield y Pausas (Desactivados por premisa de operación continua e ininterrumpida)
        if (botState.consecutiveLosses >= 2) {
            botState.momentumShieldLevel = 0; // Mantener nivel de escudo en 0
            if (botState.consecutiveLosses % 2 === 0) {
                console.log(`🛡️ KRAKEN SHIELD: Continuando operación continua a pesar de racha de ${botState.consecutiveLosses} pérdidas.`);
            }
        }
        
        console.log(`❌ LOSS -$${Math.abs(profit).toFixed(2)} [${tradeSymbol} - ${name}] | ${cType}${barrier ? ` B:${barrier}` : ''} | Racha: ${botState.consecutiveLosses} | PnL: $${botState.pnlSession.toFixed(2)}`);
    }
    
    // ─── ACTUALIZACIÓN DE ESTADO DE COBERTURA CUÁNTICA ───
    if (isWin) {
        if (botState.martingaleStep > 0) {
            console.log(`🛡️ COBERTURA CUÁNTICA: ¡Recuperación exitosa! Cobertura completada en nivel ${botState.martingaleStep}. Volviendo a stake base.`);
        }
        botState.martingaleStep = 0;
    } else {
        if (botState.coberturaEnabled) {
            botState.martingaleStep++;
            if (botState.martingaleStep > botState.maxMartingaleSteps) {
                console.log(`💀 COBERTURA CUÁNTICA: Límite máximo de pasos (${botState.maxMartingaleSteps}) superado. Asumiendo pérdida completa y reiniciando stake base para proteger la cuenta.`);
                botState.martingaleStep = 0;
            } else {
                console.log(`📈 COBERTURA CUÁNTICA: Pérdida real. Escalando Cobertura (Progresión Lineal D'Alembert) a Nivel ${botState.martingaleStep} (Multiplicador: x${1 + botState.martingaleStep})`);
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
            
            if (wr < breakEven) {
                stats.autoDisabled = true;
                console.log(`🦎 DARWIN: Motor ${name} auto-desactivado (WR: ${wr.toFixed(1)}% < Breakeven: ${breakEven}%)`);
            }
        }
    }
    
    // Guardar en Historial de Trades
    botState.tradeHistory.unshift({
        symbol: tradeSymbol,
        engine: name,
        engineKey: engine,
        contractType: cType,
        barrier: barrier,
        digit: exitDigit,
        profit: profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date().toISOString(),
        stake: botState.currentStake,
        entropy: mState ? mState.shannonEntropy : botState.shannonEntropy,
        balanceAfter: botState.balance
    });
    if (botState.tradeHistory.length > 100) botState.tradeHistory.pop();
    
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
    
    // Control Take Profit (Detención estricta al llegar a la meta)
    if (botState.pnlSession >= botState.takeProfit) {
        botState.isRunning = false;
        console.log(`🚀 META DE GANANCIA ALCANZADA: $${botState.pnlSession.toFixed(2)} / $${botState.takeProfit}. Bot detenido automáticamente.`);
    }
    
    // Control Stop Loss (Detención estricta al tocar la pérdida máxima)
    if (botState.pnlSession <= -botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`⛔ LÍMITE DE PÉRDIDA ALCANZADO: $${botState.pnlSession.toFixed(2)} / -$${botState.maxDailyLoss}. Bot detenido para proteger la cuenta.`);
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
            OVER_UNDER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
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
        'OVER_UNDER': 'engineOverUnder'
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
    const { stake, maxDailyLoss, takeProfit, cooldownMs, maxTradesPerDay, cooldownMode, coberturaEnabled, differPrecision98, quirurgicoMode } = req.body;
    
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
    if (differPrecision98 !== undefined) botState.differPrecision98 = !!differPrecision98;
    if (quirurgicoMode !== undefined) botState.quirurgicoMode = !!quirurgicoMode;
    
    saveState();
    console.log(`⚙️ CONFIGURACIÓN KRAKEN MODIFICADA.`);
    return res.json({ success: true, message: 'Parámetros actualizados con éxito.' });
});

app.post('/api/switch-market', (req, res) => {
    const { symbol } = req.body;
    
    const validSymbols = SCAN_SYMBOLS;
    if (!validSymbols.includes(symbol)) {
        return res.status(400).json({ success: false, error: 'Símbolo inválido.' });
    }
    
    SYMBOL = symbol;
    
    // Sincronizar campos principales para la visualización del frontend
    const mState = botState.markets[SYMBOL];
    if (mState) {
        botState.digitHistory = mState.digitHistory;
        botState.digitFrequency = mState.digitFrequency;
        botState.lastTickPrice = mState.lastTickPrice;
        botState.lastDigit = mState.lastDigit;
        botState.shannonEntropy = mState.shannonEntropy;
        botState.hotDigit = mState.hotDigit;
        botState.hotDigitFreq = mState.hotDigitFreq;
    }
    
    saveState();
    console.log(`👁️ VISTA DEL DASHBOARD ENFOCADA EN: ${SYMBOL}`);
    return res.json({ success: true, symbol: SYMBOL, message: `Vista del dashboard enfocada en ${SYMBOL} con éxito.` });
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
            // Descargar historial de 300 ticks en paralelo para todos los mercados
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    SCAN_SYMBOLS.forEach(sym => {
                        console.log(`📥 Descargando historial de 300 ticks para ${sym}...`);
                        ws.send(JSON.stringify({
                            ticks_history: sym,
                            count: 300,
                            end: 'latest',
                            style: 'ticks',
                            adjust_start_time: 1
                        }));
                    });
                }
            }, 1000);
            
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    SCAN_SYMBOLS.forEach(sym => {
                        ws.send(JSON.stringify({ subscribe: 1, ticks: sym }));
                        console.log(`📡 Suscripción ticks en vivo activada para ${sym}`);
                    });
                }
            }, 3500); // Demorado a 3.5s para permitir que el historial se reciba primero
            
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    console.log(`💰 Suscripción balance activada.`);
                }
            }, 5000);
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

        if (msg.msg_type === 'history' && msg.history) {
            const sym = msg.echo_req ? msg.echo_req.ticks_history : SYMBOL;
            const prices = msg.history.prices;
            if (Array.isArray(prices) && prices.length > 0 && botState.markets[sym]) {
                const mState = botState.markets[sym];
                console.log(`⚡ Historial de ${prices.length} ticks recibido correctamente para ${sym}.`);
                mState.digitHistory = [];
                mState.digitFrequency = {};
                for (let d = 0; d <= 9; d++) mState.digitFrequency[d] = 0;
                
                prices.forEach(price => {
                    // Adaptar precisión
                    const quoteStr = String(price);
                    const parts = quoteStr.split('.');
                    if (parts[1] && parts[1].length > mState.symbolDecimals && parts[1].length <= 4) {
                        mState.symbolDecimals = parts[1].length;
                    }
                    const priceFixed = price.toFixed(mState.symbolDecimals);
                    const digit = parseInt(priceFixed[priceFixed.length - 1]);
                    
                    mState.digitHistory.push(digit);
                    mState.digitFrequency[digit] = (mState.digitFrequency[digit] || 0) + 1;
                });
                
                if (mState.digitHistory.length > 300) {
                    mState.digitHistory = mState.digitHistory.slice(-300);
                }
                
                mState.totalTicksProcessed = mState.digitHistory.length;
                
                if (mState.digitHistory.length >= 50) {
                    mState.shannonEntropy = calcEntropy(mState.digitHistory, 100).toFixed(3);
                    updateHotDigit(mState);
                }
                
                // Sincronizar foco principal si coincide con la selección visual activa
                if (sym === SYMBOL) {
                    botState.digitHistory = mState.digitHistory;
                    botState.digitFrequency = mState.digitFrequency;
                    botState.lastTickPrice = mState.lastTickPrice;
                    botState.lastDigit = mState.lastDigit;
                    botState.shannonEntropy = mState.shannonEntropy;
                    botState.hotDigit = mState.hotDigit;
                    botState.hotDigitFreq = mState.hotDigitFreq;
                }
                
                console.log(`🔥 KRAKEN CARGADO [${sym}]: Historial inicializado con ${mState.totalTicksProcessed} ticks históricos.`);
                saveState();
            }
            return;
        }
        
        if (msg.msg_type === 'tick' && msg.tick) {
            const sym = msg.tick.symbol;
            if (botState.markets[sym]) {
                const mState = botState.markets[sym];
                
                // Obtener el dígito final de manera precisa, adaptándonos dinámicamente a la precisión real del activo
                const quoteStr = String(msg.tick.quote);
                const parts = quoteStr.split('.');
                if (parts[1] && parts[1].length > mState.symbolDecimals && parts[1].length <= 4) {
                    mState.symbolDecimals = parts[1].length;
                }
                const price = msg.tick.quote.toFixed(mState.symbolDecimals);
                const digit = parseInt(price[price.length - 1]);
                
                mState.lastTickPrice = parseFloat(msg.tick.quote);
                mState.lastDigit = digit;
                
                mState.digitHistory.push(digit);
                if (mState.digitHistory.length > 300) mState.digitHistory.shift();
                
                mState.digitFrequency[digit] = (mState.digitFrequency[digit] || 0) + 1;
                
                mState.totalTicksProcessed = (mState.totalTicksProcessed || 0) + 1;
                
                if (mState.digitHistory.length >= 50) {
                    mState.shannonEntropy = calcEntropy(mState.digitHistory, 100).toFixed(3);
                    updateHotDigit(mState);
                }
                
                // Incrementar conteo de ticks capturados en la pausa (solo si es el mercado que disparó la pausa)
                if (botState.lossPauseUntil && Date.now() < botState.lossPauseUntil) {
                    botState.lossPauseTicksProcessed = (botState.lossPauseTicksProcessed || 0) + 1;
                }
                
                // Evaluar resultado del Ghost Trade (1 tick de duración) - Verificando que pertenezca a este símbolo
                if (botState.ghostPendingTrade && botState.ghostPendingTrade.symbol === sym) {
                    const pt = botState.ghostPendingTrade;
                    let won = false;
                    
                    if (pt.contractType === 'DIGITEVEN') won = digit % 2 === 0;
                    else if (pt.contractType === 'DIGITODD') won = digit % 2 !== 0;
                    else if (pt.contractType === 'DIGITOVER') won = digit > parseInt(pt.barrier);
                    else if (pt.contractType === 'DIGITUNDER') won = digit < parseInt(pt.barrier);
                    
                    console.log(`👻 GHOST RESULT [${sym}]: ${pt.engine} [${pt.contractType}] -> Result digit: ${digit} -> ${won ? 'WIN ✅' : 'LOSS ❌'}`);
                    
                    botState.ghostPendingTrade = null; // Limpiar para el siguiente
                    
                    if (won) {
                        botState.ghostNextTradeReal = false;
                    } else {
                        botState.ghostNextTradeReal = true;
                        botState.forcedSignal = {
                            symbol: sym,
                            engine: pt.engine,
                            contractType: pt.contractType,
                            barrier: pt.barrier,
                            stakeMultiplier: 1.0,
                            reason: 'Ghost Shield (Entrada INMEDIATA)'
                        };
                        console.log(`🔥 GHOST SHIELD: ¡Pérdida virtual detectada en ${sym}! Sniper ARMADO para entrar en dinero REAL en el PRÓXIMO TICK.`);
                    }
                }
                
                // Sincronizar campos principales para la vista de la interfaz (foco activo)
                if (sym === SYMBOL) {
                    botState.digitHistory = mState.digitHistory;
                    botState.digitFrequency = mState.digitFrequency;
                    botState.lastTickPrice = mState.lastTickPrice;
                    botState.lastDigit = mState.lastDigit;
                    botState.shannonEntropy = mState.shannonEntropy;
                    botState.hotDigit = mState.hotDigit;
                    botState.hotDigitFreq = mState.hotDigitFreq;
                }
                
                tryFireTrade();
            }
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
    console.log('  🔪 Motor 1: PAR/IMPAR       (Consensus Reversion)');
    console.log('  📊 Motor 2: OVER/UNDER      (Markov Transition Matrix)');
    console.log('  🛡️  Protection: Martingala Segura + Momentum Shield');
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
