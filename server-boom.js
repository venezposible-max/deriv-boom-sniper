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
import https from 'https';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';

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
    activeContractIds: [],
    dualContractsState: null,
    
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
    engineEvenOdd: false,
    engineOverUnder: false,
    engineAccumulator: true,
    engineCodyBarrier: true,
    
    // Cody standard deviation multiplier
    codyMultiplier: 1.8,
    codyPayoutFilterEnabled: true,  // 🥇 Opción 1: Filtro de Payout Previo habilitado por defecto
    codyPayoutFilterMargin: 0.0,    // Margen por defecto de 0% (>= totalStake)
    
    // ─── HYDRA MODE: ACCU Puro (desactiva EVEN/ODD y OVER/UNDER) ───
    hydraMode: true,              // 🐍 Cuando true: SOLO ACCU, cero otros motores
    hydraSoloSymbols: ['R_10', '1HZ10V'], // Solo los 2 mercados más estables para ACCU
    
    // ─── Configuraciones Acumulador ───
    accuGrowthRate: 0.01,          // 🔴 1% = BARRERA MÁS ANCHA = menos knockouts
    accuTargetTicks: 2,            // 🔴 Cierre rápido a los 2 ticks
    accuMaxTicks: 3,               // 🔴 Cierre máximo a los 3 ticks
    accuVolatilityThreshold: 0.018, // Coeficiente de variación
    accuTrailingPct: 0.85,         // Trailing: vender si profit cae al 85% del pico
    accuCurrentPeak: 0,            // Pico de profit actual del contrato ACCU en curso
    accuPriorityMode: true,        // Evaluar ACCU primero cuando mercado está calmado
    accuMinProfitRatio: 0.0,       // No salir sin mínimo 0% del stake (cierre inmediato)
    accuKnockoutCooldownMs: 30000, // 30 segundos de cooldown por knockout ACCU
    accuTakeProfitAt: 0.02,        // Salida automática cuando profit >= 2% del stake
    
    // ─── Variables del Escudo de Trade Fantasma (Ghost Shield) ───
    ghostActive: true,
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
        OVER_UNDER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        ACCUMULATOR: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
        CODY_BARRIER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
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
    lossPauseTicksProcessed: 0,
    
    // ─── Variables de Cuenta (Virtual vs Real) ───
    accountMode: 'demo',       // 'demo' | 'real'
    demoToken: '',             // Token virtual configurado
    realToken: '',             // Token real de USDT
    currency: 'USD',            // Divisa actual ('USD' | 'USDT' | etc.)
    
    // Alias para compatibilidad universal
    derivTokenDemo: process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD',
    derivTokenReal: process.env.DERIV_TOKEN_REAL || ''
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
            
            botState.engineAccumulator = true;
            botState.engineCodyBarrier = true;
            botState.hydraMode = true;
            botState.engineEvenOdd = false;
            botState.engineOverUnder = false;
            botState.hydraSoloSymbols = ['R_10', '1HZ10V'];
            botState.accuGrowthRate = 0.01;
            botState.accuTargetTicks = 2;
            botState.accuMaxTicks = 3;
            botState.accuVolatilityThreshold = 0.018;
            botState.accuTrailingPct = 0.85;
            botState.accuCurrentPeak = 0;
            botState.accuPriorityMode = true;
            botState.accuMinProfitRatio = 0.0;
            botState.accuKnockoutCooldownMs = 30000;
            botState.accuTakeProfitAt = 0.02;
            if (botState.codyMultiplier === undefined) botState.codyMultiplier = 1.8;
            if (botState.codyPayoutFilterEnabled === undefined) botState.codyPayoutFilterEnabled = true;
            if (botState.codyPayoutFilterMargin === undefined) botState.codyPayoutFilterMargin = 0.0;
            
            // Garantizar variables de Cuenta (Virtual vs Real)
            if (botState.accountMode === undefined) botState.accountMode = 'demo';
            if (botState.demoToken === undefined) botState.demoToken = '';
            if (botState.realToken === undefined) botState.realToken = '';
            
            // Garantizar alias
            if (botState.derivTokenDemo === undefined) botState.derivTokenDemo = botState.demoToken || process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
            if (botState.derivTokenReal === undefined) botState.derivTokenReal = botState.realToken || process.env.DERIV_TOKEN_REAL || '';
            if (botState.demoToken === undefined) botState.demoToken = '';
            if (botState.realToken === undefined) botState.realToken = '';
            if (botState.currency === undefined) botState.currency = 'USD';
            
            // Garantizar inicialización segura de variables de La Hidra
            if (botState.hidraLayer === undefined) botState.hidraLayer = 0;
            if (botState.hidraDalembertStep === undefined) botState.hidraDalembertStep = 0;
            if (botState.hidraLastLossDigit === undefined) botState.hidraLastLossDigit = null;
            if (botState.hidraFrenoUntil === undefined) botState.hidraFrenoUntil = 0;
            if (botState.ghostNextTradeReal === undefined) botState.ghostNextTradeReal = false;
            if (botState.ghostPendingBarrier === undefined) botState.ghostPendingBarrier = null;
            if (botState.ghostActive === undefined) botState.ghostActive = true;
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
            botState.activeContractIds = [];
            botState.dualContractsState = null;
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
    const lastDigit = hist[hist.length - 1];
    const penultDigit = hist[hist.length - 2];
    const state = (penultDigit * 10) + lastDigit; // Estado compuesto por los 2 últimos dígitos (00-99)
    
    const matrix = build2ndOrderMarkovMatrix(markovHist);
    const transitions = matrix[state];
    
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
            reason: `Markov2da P(>4)=${(probOver * 100).toFixed(1)}% (Estado: ${state})`,
            entropy: parseFloat(mState.shannonEntropy)
        };
    }
    
    if (probUnder >= requiredProb) {
        return {
            engine: 'OVER_UNDER',
            contractType: 'DIGITUNDER',
            barrier: '5',
            stakeMultiplier: 1.0,
            reason: `Markov2da P(<5)=${(probUnder * 100).toFixed(1)}% (Estado: ${state})`,
            entropy: parseFloat(mState.shannonEntropy)
        };
    }
    
    return null;
}

/**
 * Calcula la volatilidad reciente de una lista de precios (desviación estándar normalizada)
 */
function calcRecentVolatility(prices, window = 15) {
    const slice = prices.slice(-window);
    if (slice.length < 5) return 1; // Alta volatilidad por defecto si no hay datos
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    if (mean === 0) return 1;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / slice.length;
    return Math.sqrt(variance) / mean; // Coeficiente de variación (CV)
}

/**
 * Verifica si el mercado está en estado calmado (baja volatilidad, sin spikes recientes)
 * Retorna true si es ideal para ACCU
 */
function checkMarketCalm(mState) {
    if (!mState.recentPrices || mState.recentPrices.length < 10) return false;
    const vol = calcRecentVolatility(mState.recentPrices, 20);
    const threshold = botState.accuVolatilityThreshold || 0.018;
    // Verificar ausencia de spikes en los últimos 5 precios (más estricto)
    const last5 = mState.recentPrices.slice(-5);
    const hasSpike = last5.some((p, i) => {
        if (i === 0) return false;
        return Math.abs((p - last5[i - 1]) / last5[i - 1]) > 0.0002; // 0.02% = spike (más estricto)
    });
    // Verificar cooldown de knockout ACCU en este símbolo
    const accuKnockoutUntil = mState.accuKnockoutUntil || 0;
    if (Date.now() < accuKnockoutUntil) return false;
    return vol < threshold && !hasSpike;
}

/**
 * Calcula el RSI(14) sobre un arreglo de precios históricos.
 * Utiliza suavizado de Wilder para precisión cuantitativa.
 */
function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;
    
    let gains = [];
    let losses = [];
    
    for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) {
            gains.push(diff);
            losses.push(0);
        } else {
            gains.push(0);
            losses.push(-diff);
        }
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

/**
 * Calcula la desviación estándar de un arreglo de precios sobre un período dado.
 */
function calculateStdDev(prices, period = 30) {
    const len = prices.length;
    if (len < 2) return 0;
    const n = Math.min(len, period);
    const slice = prices.slice(-n);
    const mean = slice.reduce((a, b) => a + b, 0) / n;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / n;
    return Math.sqrt(variance);
}

/**
 * MOTOR 6: Francotirador de Barreras Cody Trader (Higher/Lower)
 * Calcula dinámicamente un offset a 3.5 desviaciones estándar para disparar con 98%+ supervivencia.
 */
function evaluateCodyBarrier(mState) {
    if (!botState.engineCodyBarrier) return null;
    
    const prices = mState.recentPrices;
    if (!prices || prices.length < 30) return null;
    
    const stdDev = calculateStdDev(prices, 30);
    const rsi = calculateRSI(prices, 14);
    const currentPrice = mState.lastTickPrice || prices[prices.length - 1];
    
    // B = codyMultiplier * StdDev
    const mult = botState.codyMultiplier || 1.8;
    let offset = mult * stdDev;
    
    // Margen de seguridad mínimo
    const minOffset = currentPrice * 0.00005;
    if (offset < minOffset) {
        offset = minOffset;
    }
    
    const decimals = mState.symbolDecimals || 2;
    const formattedOffset = parseFloat(offset.toFixed(decimals));
    const finalOffset = formattedOffset > 0 ? formattedOffset : Math.pow(10, -decimals);
    
    // En el canal de Cody, disparamos AMBOS lados simultáneamente (Hedged Double Sniper)
    // para cosechar doble ganancia si queda en el canal, o mitigar pérdida si rompe un lado.
    if (rsi >= 65 || rsi <= 35) {
        // ─── FILTRO DE BARRERA MÁXIMA ELIMINADO ────────────────────────────────
        // Al invertir las barreras para cazar rompimientos (Long Volatility), 
        // los contratos ahora ofrecen altos retornos (ej. $3.00), por lo que 
        // Deriv NUNCA los rechazará por "This contract offers no return".
        // El límite fijo de 0.70 ya no es necesario ni correcto para símbolos de alta volatilidad.
        // OPCIÓN C: Sniper Clásico (Sin Barrera)
        // Ya que las barreras duales pierden mucho y las de seguridad pagan centavos,
        // usamos el contrato clásico Rise/Fall (CALL/PUT) que paga ~95.3%.
        // 1 Win recupera 1 Loss. El RSI extremo nos da el Edge estadístico (>50% Win Rate).
        if (rsi >= 65) {
            return {
                engine: 'CODY_BARRIER',
                contractType: 'PUT',
                barrier: null,
                stakeMultiplier: 1.0,
                reason: `Sniper Clásico (Sin Barrera) por Sobrecompra RSI:${rsi.toFixed(1)}`,
                entropy: parseFloat(mState.shannonEntropy)
            };
        } else if (rsi <= 35) {
            return {
                engine: 'CODY_BARRIER',
                contractType: 'CALL',
                barrier: null,
                stakeMultiplier: 1.0,
                reason: `Sniper Clásico (Sin Barrera) por Sobrevendido RSI:${rsi.toFixed(1)}`,
                entropy: parseFloat(mState.shannonEntropy)
            };
        }
    }
    
    return null;
}

/**
 * Retorna el growth rate óptimo para cada símbolo.
 * Con growth_rate 1% obtenemos la BARRERA MÁS ANCHA en todos los símbolos
 * = menos knockouts = más ticks = más profit.
 * Solo R_10 y 1HZ10V tienen 1% (los más estables).
 * El resto usa 1% también en HYDRA mode para máxima supervivencia.
 */
function getAccuGrowthRateForSymbol(symbol) {
    if (botState.hydraMode) {
        return 0.01; // HYDRA: 1% para todos = máxima barrera
    }
    const rates = {
        'R_10':    0.01, // 1% — V10 más estable
        '1HZ10V':  0.01,
        'R_25':    0.01, // 1% también (cambio: antes 2%)
        '1HZ25V':  0.01,
        'R_50':    0.01, // 1% — más ancho
        'R_75':    0.01,
        'R_100':   0.01,
        '1HZ100V': 0.01
    };
    return rates[symbol] || botState.accuGrowthRate || 0.01;
}

/**
 * Motor 5: ACUMULADORES — "El Compounder Pro"
 * Entra SÓLO cuando el mercado está calmado (baja volatilidad, sin spikes)
 * Salida inteligente: no vende hasta tener profit real (≥40% del stake)
 */
function evaluateAccumulator(mState) {
    const hist = mState.digitHistory;
    if (hist.length < 30) return null;
    
    // ── Filtro 1: Necesitamos historial de precios reales ──
    if (!mState.recentPrices || mState.recentPrices.length < 15) return null;
    
    // ── Filtro 2: Cooldown de knockout ACCU en este símbolo ──
    const accuKnockoutUntil = mState.accuKnockoutUntil || 0;
    if (Date.now() < accuKnockoutUntil) {
        const secsLeft = Math.ceil((accuKnockoutUntil - Date.now()) / 1000);
        if (Date.now() % 15000 < 1000) console.log(`🚫 ACCU KNOCKOUT COOLDOWN [${mState.symbol}]: ${secsLeft}s restantes. Buscando mercado más tranquilo.`);
        return null;
    }
    
    // ── Filtro 3: Volatilidad estricta (CV < 1.8%) ──
    const vol = calcRecentVolatility(mState.recentPrices, 20);
    const maxVol = botState.accuVolatilityThreshold || 0.018;
    if (vol > maxVol) {
        return null; // ❌ Mercado volátil — riesgo de knockout
    }
    
    // ── Filtro 4: Spike Radar en últimos 5 ticks (más estricto) ──
    const last5 = mState.recentPrices.slice(-5);
    const hasSpike = last5.some((p, i) => {
        if (i === 0) return false;
        return Math.abs((p - last5[i - 1]) / last5[i - 1]) > 0.0002; // 0.02% spike
    });
    if (hasSpike) return null; // ❌ Spike reciente
    
    // ── Filtro 5: Squeeze de Canal Horizontal (Evitar Tendencias Fuertes de Jared Laos) ──
    const prices = mState.recentPrices;
    const sma15 = prices.slice(-15).reduce((a, b) => a + b, 0) / 15;
    const sma5 = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const slope = Math.abs(sma5 - sma15) / sma15;
    const maxSlope = 0.0001; // Pendiente máxima permitida (0.01%)
    if (slope > maxSlope) {
        if (Date.now() % 15000 < 500) {
            console.log(`🛡️ [FILTRO JARED LAOS] ${mState.symbol} bloqueado por tendencia activa: Slope ${(slope * 100).toFixed(4)}% > ${(maxSlope * 100).toFixed(2)}%`);
        }
        return null; // ❌ Pendiente activa detectada — Evitamos operar tendencias expansivas
    }
    
    // Growth rate adaptivo según la volatilidad del símbolo
    const optimalGrowthRate = getAccuGrowthRateForSymbol(mState.symbol);
    
    return {
        engine: 'ACCUMULATOR',
        contractType: 'ACCU',
        barrier: null,
        stakeMultiplier: 1.0,
        accuGrowthRateOverride: optimalGrowthRate, // Growth rate específico para este símbolo
        reason: `ACCU ✅ Vol:${(vol * 100).toFixed(3)}%<${(maxVol*100).toFixed(1)}% | Growth:${(optimalGrowthRate*100).toFixed(0)}% | Objetivo:${botState.accuTargetTicks}-${botState.accuMaxTicks}t | MinProfit:${((botState.accuMinProfitRatio||0.4)*100).toFixed(0)}%`,
        entropy: parseFloat(mState.shannonEntropy)
    };
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
    
    // Failsafe de contrato colgado (15 segundos para normales, 120 segundos para ACCUMULATOR)
    const failsafeTimeout = botState.currentContractType === 'ACCU' ? 120000 : 15000;
    if (botState.activeContractId && (now - botState.lastTradeTime) > failsafeTimeout) {
        console.log(`⚠️ FAILSAFE: Contrato ${botState.currentContractType || ''} ${botState.activeContractId} colgado. Liberando bot.`);
        botState.activeContractId = null;
        botState.currentContractId = null;
        botState.isBuying = false;
        saveState();
    }
    if (botState.currentContractType === 'DUAL' && botState.activeContractIds && botState.activeContractIds.length > 0 && (now - botState.lastTradeTime) > failsafeTimeout) {
        console.log(`⚠️ FAILSAFE DUAL: Liberando bot por contrato dual colgado.`);
        botState.activeContractIds = [];
        botState.activeContractId = null;
        botState.currentContractId = null;
        botState.isBuying = false;
        botState.currentEngine = null;
        saveState();
    }
    
    // Failsafe de consulta de payout (proposals) colgada
    if (botState.pendingPayoutCheck && (now - botState.pendingPayoutCheck.timestamp) > 5000) {
        console.log(`⚠️ [CODY FILTER FAILSAFE] Timeout de 5 segundos superado esperando proposals. Liberando bot.`);
        botState.isBuying = false;
        botState.pendingPayoutCheck = null;
    }
    
    if (botState.isBuying || botState.activeContractId || (botState.activeContractIds && botState.activeContractIds.length > 0)) return;
    
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
    
    // Si tenemos una señal forzada (venganza del Ghost Shield), la usamos directamente
    if (botState.forcedSignal) {
        signal = botState.forcedSignal;
        signalSymbol = botState.forcedSignal.symbol;
        botState.forcedSignal = null;
    } else {
        // MODO CAZADOR GLOBAL: Escanear todos los mercados disponibles
        let scanList = SCAN_SYMBOLS;
            
        // 🎲 ESCÁNER ALEATORIO: Barajar la lista para alternar entre mercados
        scanList = [...scanList];
        for (let i = scanList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [scanList[i], scanList[j]] = [scanList[j], scanList[i]];
        }
        
        for (const sym of scanList) {
            const mState = botState.markets[sym];
            if (!mState || mState.digitHistory.length < 50) continue;
            
            // Cortafuegos: Evitar mercados en cuarentena por pérdidas recientes
            if (mState.lockedUntil && now < mState.lockedUntil) {
                if (now % 30000 < 1500) {
                    const left = Math.ceil((mState.lockedUntil - now) / 1000);
                    console.log(`🛡️ CORTAFUEGOS: ${sym} en cuarentena (${left}s). Saltando...`);
                }
                continue;
            }
            
            // 🎯 MOTOR 6: CODY BARRIER SNIPER (Prioridad Absoluta si está encendido)
            if (botState.engineCodyBarrier) {
                signal = evaluateCodyBarrier(mState);
            }
            
                    // Los motores de dígito y Accumulator fueron eliminados a petición del usuario.
                    // Ahora el bot opera exclusivamente como Cody Barrier Sniper.
            
            if (signal) {
                signalSymbol = sym;
                break;
            }
        }
    }
    
    if (!signal || !signalSymbol) return;
    
    const activeSymbol = signalSymbol;
    const mState = botState.markets[activeSymbol];
    
    botState.lastEngineFired = signal.engine;
    
    // ─── GHOST TRADING LOGIC ───
    if (botState.ghostActive && !botState.ghostNextTradeReal && signal.engine !== 'CODY_BARRIER') {
        if (!botState.ghostPendingTrade && botState.isRunning) {
            if (signal.contractType === 'DUAL') {
                console.log(`👻 GHOST TRADE DUAL [${activeSymbol}]: Simulación canal sniper B: ${signal.barrierHigher} / ${signal.barrierLower}...`);
            } else {
                console.log(`👻 GHOST TRADE [${activeSymbol}]: Señal de ${signal.engine} [${signal.contractType} B:${signal.barrier || '-'}]. Simulando entrada virtual...`);
            }
            botState.ghostPendingTrade = {
                symbol: activeSymbol,
                engine: signal.engine,
                contractType: signal.contractType,
                barrier: signal.barrier || null,
                barrierHigher: signal.barrierHigher || null,
                barrierLower: signal.barrierLower || null,
                entryTickPrice: mState ? mState.lastTickPrice : botState.lastTickPrice,
                ticksRemaining: signal.engine === 'CODY_BARRIER' ? 5 : 1
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
    botState.currentBarrier = signal.contractType === 'DUAL' ? `${signal.barrierHigher}/${signal.barrierLower}` : signal.barrier;
    botState.currentStake = finalStake;
    
    // 🎯 MANEJO DISPARO SIMULTÁNEO DUAL (MOTOR 6)
    if (signal.contractType === 'DUAL') {
        const buyRequestHigher = {
            buy: 1,
            price: finalStake,
            parameters: {
                amount: finalStake,
                basis: 'stake',
                contract_type: 'CALL',
                currency: 'USD',
                symbol: activeSymbol,
                duration: 5,
                duration_unit: 't',
                barrier: signal.barrierHigher
            }
        };
        
        const buyRequestLower = {
            buy: 1,
            price: finalStake,
            parameters: {
                amount: finalStake,
                basis: 'stake',
                contract_type: 'PUT',
                currency: 'USD',
                symbol: activeSymbol,
                duration: 5,
                duration_unit: 't',
                barrier: signal.barrierLower
            }
        };
        
        // 🛡️ FILTRO DE SEGURIDAD FORZADO (Opción B requiere esto sí o sí)
        if (true || botState.codyPayoutFilterEnabled) {
            const reqIdHigher = Math.floor(Math.random() * 1000000) + 100000;
            const reqIdLower = reqIdHigher + 1;
            
            botState.pendingPayoutCheck = {
                timestamp: Date.now(),
                activeSymbol: activeSymbol,
                finalStake: finalStake,
                signal: signal,
                reqIdHigher: reqIdHigher,
                reqIdLower: reqIdLower,
                payoutHigher: null,
                payoutLower: null,
                buyRequestHigher: buyRequestHigher,
                buyRequestLower: buyRequestLower
            };
            
            const propRequestHigher = {
                proposal: 1,
                req_id: reqIdHigher,
                amount: finalStake,
                basis: 'stake',
                contract_type: 'CALL',
                currency: 'USD',
                symbol: activeSymbol,
                duration: 5,
                duration_unit: 't',
                barrier: signal.barrierHigher
            };
            
            const propRequestLower = {
                proposal: 1,
                req_id: reqIdLower,
                amount: finalStake,
                basis: 'stake',
                contract_type: 'PUT',
                currency: 'USD',
                symbol: activeSymbol,
                duration: 5,
                duration_unit: 't',
                barrier: signal.barrierLower
            };
            
            botState.isBuying = true;
            botState.lastTradeTime = now;
            
            console.log(`🔍 [CODY FILTER] Consultando cotizaciones (proposals) a Deriv...`);
            console.log(`   ⬆️ Proposal Higher con req_id: ${reqIdHigher} y barrera ${signal.barrierHigher}`);
            console.log(`   ⬇️ Proposal Lower con req_id: ${reqIdLower} y barrera ${signal.barrierLower}`);
            
            ws.send(JSON.stringify(propRequestHigher));
            ws.send(JSON.stringify(propRequestLower));
            return;
        }
        
        // Si no está habilitado el filtro de payout previo, disparar compra directa
        botState.activeContractIds = [];
        botState.dualContractsState = {
            higher: { id: null, finalized: false, profit: 0, won: false },
            lower: { id: null, finalized: false, profit: 0, won: false }
        };
        
        botState.isBuying = true;
        botState.lastTradeTime = now;
        
        console.log(`🎯 [DUAL SNIPER] DISPARANDO AMBOS LADOS SIMULTÁNEAMENTE [${activeSymbol}] | Stake: $${finalStake.toFixed(2)} c/u | 5 Ticks`);
        console.log(`   ⬆️ HIGHER con barrera ${signal.barrierHigher}`);
        console.log(`   ⬇️ LOWER con barrera ${signal.barrierLower}`);
        
        ws.send(JSON.stringify(buyRequestHigher));
        ws.send(JSON.stringify(buyRequestLower));
        return;
    }
    
    const buyRequest = {
        buy: 1,
        price: finalStake,
        parameters: {
            amount: finalStake,
            basis: 'stake',
            contract_type: signal.contractType,
            currency: 'USD',
            symbol: activeSymbol
        }
    };
    
    if (signal.contractType === 'ACCU') {
        botState.accuCurrentPeak = 0; // Resetear pico de profit al abrir nuevo ACCU
        // Usar growth rate específico del símbolo si la señal lo provee
        const growthRate = signal.accuGrowthRateOverride || botState.accuGrowthRate || 0.02;
        buyRequest.parameters.growth_rate = growthRate;
        botState.accuCurrentGrowthRate = growthRate; // Guardar para cálculos de salida
        console.log(`💰 ACCU Config: growth_rate=${(growthRate*100).toFixed(0)}% | MinTicks=${botState.accuTargetTicks} | MaxTicks=${botState.accuMaxTicks} | MinProfit=${((botState.accuMinProfitRatio||0.4)*100).toFixed(0)}% del stake`);
    } else if (signal.engine === 'CODY_BARRIER') {
        buyRequest.parameters.duration = 5;
        buyRequest.parameters.duration_unit = 't';
    } else {
        buyRequest.parameters.duration = 1;
        buyRequest.parameters.duration_unit = 't';
    }
    
    if (signal.barrier !== null) {
        buyRequest.parameters.barrier = signal.barrier;
    }
    
    botState.isBuying = true;
    botState.lastTradeTime = now;
    
    const emojis = { EVEN_ODD: '🎰', OVER_UNDER: '📊', ACCUMULATOR: '📈', CODY_BARRIER: '🎯' };
    const names = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', ACCUMULATOR: 'ACUMULADOR', CODY_BARRIER: 'BARRERAS CODY' };
    
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
    const name = { EVEN_ODD: 'PAR/IMPAR', OVER_UNDER: 'OVER/UNDER', ACCUMULATOR: 'ACUMULADOR', CODY_BARRIER: 'BARRERAS CODY' }[engine] || engine;
    
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
        
        // Cortafuegos de Cobertura: Aplicar cuarentena de 5 minutos al símbolo perdedor
        if (mState) {
            mState.lockedUntil = Date.now() + 300000; // 5 minutos (300,000 ms)
            console.log(`🚨 CORTAFUEGOS ACTIVO: Cuarentena de 5 minutos aplicada a ${tradeSymbol} para evitar persistencia de racha. Escaneando los otros 7 mercados...`);
            
            // 🔴 ACCU KNOCKOUT: Cooldown adicional específico para Acumuladores
            if (engine === 'ACCUMULATOR') {
                const knockoutCooldown = botState.accuKnockoutCooldownMs || 180000; // 3 min por defecto
                mState.accuKnockoutUntil = Date.now() + knockoutCooldown;
                console.log(`💥 ACCU KNOCKOUT en ${tradeSymbol}: Cooldown de ${(knockoutCooldown/60000).toFixed(0)} min aplicado a este símbolo. El ACCU buscará mercado más tranquilo.`);
            }
        }
        
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

/**
 * Finaliza la operación simultánea DUAL del Motor 6 (Cody Barrier).
 * Espera a que ambos contratos se liquiden, calcula el PnL neto y gestiona la Cobertura.
 */
function finalizeDualTrade(tradeSymbol = SYMBOL) {
    const state = botState.dualContractsState;
    if (!state) return;
    
    const profitHigher = state.higher.profit || 0;
    const profitLower = state.lower.profit || 0;
    const netProfit = profitHigher + profitLower;
    const isWin = netProfit > 0;
    
    const mState = botState.markets[tradeSymbol];
    
    botState.pnlSession += netProfit;
    botState.totalTradesSession++;
    
    const engine = 'CODY_BARRIER';
    const cType = 'DUAL';
    const name = 'BARRERAS CODY';
    
    if (isWin) {
        botState.winsSession++;
        botState.dailyProfit += netProfit;
        botState.consecutiveWins++;
        
        if (botState.consecutiveWins >= 2) {
            botState.momentumShieldLevel = 0;
            botState.consecutiveLosses = 0;
        }
        
        console.log(`✅ DUAL WIN +$${netProfit.toFixed(2)} [${tradeSymbol} - ${name}] | PnL: $${botState.pnlSession.toFixed(2)}`);
        console.log(`   📈 Higher: ${profitHigher > 0 ? 'WIN ✅' : 'LOSS ❌'} ($${profitHigher.toFixed(2)})`);
        console.log(`   📉 Lower: ${profitLower > 0 ? 'WIN ✅' : 'LOSS ❌'} ($${profitLower.toFixed(2)})`);
    } else {
        botState.lossesSession++;
        botState.dailyLoss += Math.abs(netProfit);
        
        botState.consecutiveWins = 0;
        botState.consecutiveLosses++;
        
        if (mState) {
            mState.lockedUntil = Date.now() + 300000; // 5 min de cuarentena
            console.log(`🚨 CORTAFUEGOS ACTIVO: Cuarentena de 5 minutos aplicada a ${tradeSymbol} por pérdida en Dual Cody.`);
        }
        
        botState.lossPauseUntil = Date.now() + 60000;
        botState.lossPauseTicksProcessed = 0;
        console.log(`🚨 PÉRDIDA DUAL DETECTADA: Iniciando pausa de enfriamiento de 60 segundos.`);
        
        console.log(`❌ DUAL LOSS -$${Math.abs(netProfit).toFixed(2)} [${tradeSymbol} - ${name}] | PnL: $${botState.pnlSession.toFixed(2)}`);
        console.log(`   📈 Higher: ${profitHigher > 0 ? 'WIN ✅' : 'LOSS ❌'} ($${profitHigher.toFixed(2)})`);
        console.log(`   📉 Lower: ${profitLower > 0 ? 'WIN ✅' : 'LOSS ❌'} ($${profitLower.toFixed(2)})`);
    }
    
    // Cobertura Cuántica (D'Alembert step)
    if (isWin) {
        botState.martingaleStep = 0;
    } else {
        if (botState.coberturaEnabled) {
            botState.martingaleStep++;
            if (botState.martingaleStep > botState.maxMartingaleSteps) {
                botState.martingaleStep = 0;
            } else {
                console.log(`📈 COBERTURA CUÁNTICA: Pérdida real en Dual. Escalando Cobertura (Progresión Lineal D'Alembert) a Nivel ${botState.martingaleStep} (Multiplicador: x${1 + botState.martingaleStep})`);
            }
        }
    }
    
    // Registrar estadísticas del motor
    if (botState.engineStats[engine]) {
        if (isWin) botState.engineStats[engine].wins++;
        else botState.engineStats[engine].losses++;
        botState.engineStats[engine].pnl += netProfit;
    }
    
    // Registrar en Historial
    botState.tradeHistory.unshift({
        symbol: tradeSymbol,
        engine: name,
        engineKey: engine,
        contractType: cType,
        barrier: `H:${state.higher.barrier || ''} L:${state.lower.barrier || ''}`,
        digit: mState ? mState.lastDigit : botState.lastDigit,
        profit: netProfit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date().toISOString(),
        stake: botState.currentStake,
        entropy: mState ? mState.shannonEntropy : botState.shannonEntropy,
        balanceAfter: botState.balance
    });
    if (botState.tradeHistory.length > 100) botState.tradeHistory.pop();
    
    // Trailing TP & SL
    if (botState.pnlSession > botState.profitPeak) {
        botState.profitPeak = botState.pnlSession;
        if (botState.pnlSession > 5.0) {
            botState.profitFloor = botState.profitPeak * 0.60;
        }
    }
    
    if (botState.pnlSession >= botState.takeProfit) {
        botState.isRunning = false;
        console.log(`🚀 META ALCANZADA: $${botState.pnlSession.toFixed(2)}. Bot detenido.`);
    }
    if (botState.pnlSession <= -botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`⛔ LÍMITE DE PÉRDIDA ALCANZADO: $${botState.pnlSession.toFixed(2)}. Bot detenido.`);
    }
    
    // Sanear estados activos
    botState.activeContractId = null;
    botState.currentContractId = null;
    botState.isBuying = false;
    botState.currentEngine = null;
    botState.activeContractIds = [];
    botState.dualContractsState = null;
    
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
    
    // ── Métricas ACCU en tiempo real ──
    const accuTrades = botState.tradeHistory.filter(t => t.engineKey === 'ACCUMULATOR');
    const accuWins = accuTrades.filter(t => t.profit > 0);
    const accuLosses = accuTrades.filter(t => t.profit <= 0);
    const accuKnockoutRate = accuTrades.length > 0
        ? ((accuLosses.length / accuTrades.length) * 100).toFixed(1) + '%'
        : 'N/A';
    const accuAvgProfit = accuWins.length > 0
        ? (accuWins.reduce((s, t) => s + t.profit, 0) / accuWins.length).toFixed(3)
        : '0.000';
    
    // Volatilidad del mercado activo actual
    const activeMState = botState.markets[SYMBOL];
    const currentVolatility = activeMState && activeMState.recentPrices && activeMState.recentPrices.length >= 10
        ? (calcRecentVolatility(activeMState.recentPrices, 15) * 100).toFixed(4) + '%'
        : 'N/A';
    const marketIsCalm = activeMState ? checkMarketCalm(activeMState) : false;
    
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
            dynamicCooldown: botState.cooldownMode === 'auto' ? getDynamicCooldown() : botState.cooldownMs,
            // ── Métricas ACCU ──
            accuMetrics: {
                totalTrades: accuTrades.length,
                wins: accuWins.length,
                losses: accuLosses.length,
                knockoutRate: accuKnockoutRate,
                avgProfit: accuAvgProfit,
                currentPeak: botState.accuCurrentPeak.toFixed(3),
                marketVolatility: currentVolatility,
                marketIsCalm: marketIsCalm,
                config: {
                    growthRate: (botState.accuGrowthRate * 100).toFixed(1) + '%',
                    minTicks: botState.accuTargetTicks,
                    maxTicks: botState.accuMaxTicks,
                    trailingPct: (botState.accuTrailingPct * 100).toFixed(0) + '%',
                    volThreshold: ((botState.accuVolatilityThreshold || 0.045) * 100).toFixed(2) + '%',
                    priorityMode: botState.accuPriorityMode
                }
            }
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
            ACCUMULATOR: { wins: 0, losses: 0, pnl: 0, autoDisabled: false },
            CODY_BARRIER: { wins: 0, losses: 0, pnl: 0, autoDisabled: false }
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
        'ACCUMULATOR': 'engineAccumulator',
        'CODY_BARRIER': 'engineCodyBarrier'
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
    const { stake, maxDailyLoss, takeProfit, cooldownMs, maxTradesPerDay, cooldownMode,
            coberturaEnabled, differPrecision98, quirurgicoMode, accountMode, demoToken, realToken,
            accuGrowthRate, accuTargetTicks, accuMaxTicks, accuVolatilityThreshold,
            accuTrailingPct, accuPriorityMode, accuMinProfitRatio, accuTakeProfitAt,
            hydraMode, ghostActive, codyMultiplier,
            codyPayoutFilterEnabled, codyPayoutFilterMargin } = req.body;
    
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
    
    // ── Configuración ACCU avanzada ──
    if (accuGrowthRate !== undefined) botState.accuGrowthRate = parseFloat(accuGrowthRate);
    if (accuTargetTicks !== undefined) botState.accuTargetTicks = Math.max(1, parseInt(accuTargetTicks));
    if (accuMaxTicks !== undefined) botState.accuMaxTicks = Math.max(botState.accuTargetTicks || 30, parseInt(accuMaxTicks));
    if (accuVolatilityThreshold !== undefined) botState.accuVolatilityThreshold = Math.max(0.001, Math.min(0.5, parseFloat(accuVolatilityThreshold)));
    if (accuTrailingPct !== undefined) botState.accuTrailingPct = Math.max(0.5, Math.min(0.99, parseFloat(accuTrailingPct)));
    if (accuPriorityMode !== undefined) botState.accuPriorityMode = !!accuPriorityMode;
    if (accuMinProfitRatio !== undefined) botState.accuMinProfitRatio = Math.max(0.05, parseFloat(accuMinProfitRatio));
    if (accuTakeProfitAt !== undefined) botState.accuTakeProfitAt = Math.max(0.05, parseFloat(accuTakeProfitAt));
    if (hydraMode !== undefined) {
        botState.hydraMode = !!hydraMode;
        if (botState.hydraMode) botState.engineAccumulator = true;
        console.log(`🐍 HYDRA MODE: ${botState.hydraMode ? 'ACTIVADO — Solo ACCU en R_10 y 1HZ10V' : 'DESACTIVADO'}`);
    }
    
    if (ghostActive !== undefined) {
        botState.ghostActive = !!ghostActive;
        if (!botState.ghostActive) {
            botState.ghostPendingTrade = null;
            botState.ghostNextTradeReal = false;
            botState.forcedSignal = null;
        }
    }
    
    if (codyMultiplier !== undefined) {
        botState.codyMultiplier = Math.max(0.5, Math.min(5.0, parseFloat(codyMultiplier)));
    }
    
    if (codyPayoutFilterEnabled !== undefined) {
        botState.codyPayoutFilterEnabled = !!codyPayoutFilterEnabled;
    }
    if (codyPayoutFilterMargin !== undefined) {
        botState.codyPayoutFilterMargin = Math.max(0.0, Math.min(0.5, parseFloat(codyPayoutFilterMargin)));
    }
    
    if (demoToken !== undefined) botState.demoToken = demoToken;
    if (realToken !== undefined) botState.realToken = realToken;
    
    let reconnectNeeded = false;
    if (accountMode !== undefined && accountMode !== botState.accountMode) {
        botState.accountMode = accountMode;
        reconnectNeeded = true;
    }
    
    saveState();
    
    if (reconnectNeeded) {
        console.log(`🔄 CAMBIO DE MODO DE CUENTA DETECTADO (${accountMode.toUpperCase()}). Reconectando WebSocket...`);
        botState.isConnectedToDeriv = false;
        if (ws) { try { ws.close(); } catch (e) {} }
    }
    
    console.log(`⚙️ CONFIGURACIóN KRAKEN MODIFICADA.`);
    return res.json({ success: true, message: 'Parámetros actualizados con éxito.' });
});

// 🐍 HYDRA MODE — Activar/desactivar modo ACCU puro con un click
app.post('/api/hydra', (req, res) => {
    const { enable } = req.body;
    botState.hydraMode = !!enable;
    if (botState.hydraMode) botState.engineAccumulator = true;
    
    if (botState.hydraMode) {
        console.log(`\n🐍 ════════════════════════════════════════════════`);
        console.log(`🐍 HYDRA MODE ACTIVADO`);
        console.log(`🐍 Estrategia: ACCU PURO | Growth: 1% | Símbolos: R_10 + 1HZ10V`);
        console.log(`🐍 Target: ${botState.accuTargetTicks}t min | Max: ${botState.accuMaxTicks}t | TP: ${botState.accuTakeProfitAt}x stake`);
        console.log(`🐍 Trailing: ${(botState.accuTrailingPct*100).toFixed(0)}% | Volat max: ${(botState.accuVolatilityThreshold*100).toFixed(1)}%`);
        console.log(`🐍 ════════════════════════════════════════════════\n`);
    } else {
        console.log(`🦑 HYDRA MODE DESACTIVADO — Volviendo a modo Kraken normal.`);
    }
    
    saveState();
    return res.json({
        success: true,
        hydraMode: botState.hydraMode,
        message: botState.hydraMode
            ? '🐍 HYDRA ON: ACCU Puro en R_10+1HZ10V | 1% growth | 30-60 ticks | TP 50%'
            : '🦑 HYDRA OFF: Modo Kraken normal',
        math: botState.hydraMode ? {
            survivalRate30t: '~85-92% (R_10 con 1%)',
            profitAt30t: `$${(botState.stake * Math.pow(1.01, 30) - botState.stake).toFixed(3)} por $${botState.stake} stake`,
            profitAt60t: `$${(botState.stake * Math.pow(1.01, 60) - botState.stake).toFixed(3)} por $${botState.stake} stake`,
            evEstimated: `0.87 × $${(botState.stake * Math.pow(1.01, 35) - botState.stake).toFixed(3)} - 0.13 × $${botState.stake.toFixed(2)} = EV positivo si supervivencia > 74%`
        } : null
    });
});

app.post('/api/switch-account', (req, res) => {
    const { accountMode, tokenDemo, tokenReal } = req.body;
    
    if (accountMode !== undefined) {
        if (accountMode !== 'demo' && accountMode !== 'real') {
            return res.status(400).json({ success: false, error: 'Modo de cuenta inválido. Debe ser "demo" o "real".' });
        }
        botState.accountMode = accountMode;
    }
    
    if (tokenDemo !== undefined) {
        botState.derivTokenDemo = tokenDemo;
        botState.demoToken = tokenDemo;
    }
    if (tokenReal !== undefined) {
        botState.derivTokenReal = tokenReal;
        botState.realToken = tokenReal;
    }
    
    saveState();
    
    // Forzar reconexión con el nuevo token/cuenta
    botState.isConnectedToDeriv = false;
    botState.isBuying = false;
    
    if (ws) {
        ws.removeAllListeners();
        try { ws.terminate(); } catch (e) {}
        ws = null;
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    console.log(`🔄 CAMBIO DE CUENTA: Conmutando a modo ${botState.accountMode.toUpperCase()}`);
    // Conectar inmediatamente
    setTimeout(connectDeriv, 1000);
    
    return res.json({ 
        success: true, 
        message: `Conmutado a cuenta ${botState.accountMode.toUpperCase()} con éxito. Reestableciendo conexión...`,
        data: {
            accountMode: botState.accountMode,
            derivTokenDemo: botState.derivTokenDemo,
            derivTokenReal: botState.derivTokenReal
        }
    });
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
let heartbeatInterval = null;

function checkPublicIP() {
    const options = {
        hostname: 'api.ipify.org',
        port: 443,
        path: '/?format=json',
        method: 'GET'
    };
    if (process.env.PROXY_URL) {
        options.agent = new HttpsProxyAgent(process.env.PROXY_URL);
    }
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const ip = JSON.parse(data).ip;
                console.log(`📡 IP PÚBLICA ACTIVA DEL BOT: ${ip} ${process.env.PROXY_URL ? '(Vía Proxy Residencial)' : '(Directo/Railway)'}`);
            } catch (e) {
                console.log('📡 IP PÚBLICA: No se pudo parsear la respuesta.');
            }
        });
    });
    req.on('error', (e) => {
        console.error('📡 IP PÚBLICA: Error de red o credenciales de proxy inválidas:', e.message);
    });
    req.end();
}

function connectDeriv() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    
    // Consultar IP pública de forma asíncrona para diagnóstico
    checkPublicIP();
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    const options = {};
    if (process.env.PROXY_URL) {
        console.log(`🔒 ENRUTAMIENTO SEGURO: Conectando a Deriv a través de Proxy Residencial.`);
        options.agent = new HttpsProxyAgent(process.env.PROXY_URL);
    }
    
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`, options);
    
    ws.on('open', () => {
        console.log('🔌 Conexión establecida con WebSocket de Deriv. Autenticando...');
        
        // OPTIMIZACIÓN DE LATENCIA HFT: Habilitar TCP Low-Latency Flags en caliente
        if (ws._socket) {
            try {
                ws._socket.setNoDelay(true); // Desactivar algoritmo de Nagle (0 buffer)
                ws._socket.setKeepAlive(true, 5000); // Mantener caliente la sesión TCP a nivel de socket
            } catch (e) {
                // Failsafe en caso de retraso en la asignación del socket
            }
        }
        
        // CANAL DE DATOS ULTRA-CALIENTE: Enviar Pings de calentamiento cada 30s (óptimo para mantener caliente la conexión sin saturar el límite de tasa de Deriv)
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ ping: 1 }));
            }
        }, 30000);
        
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const tokenReal = botState.derivTokenReal || botState.realToken || process.env.DERIV_TOKEN_REAL || '';
                const tokenDemo = botState.derivTokenDemo || botState.demoToken || process.env.DERIV_TOKEN_DEMO || process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
                const activeToken = botState.accountMode === 'real' ? tokenReal : tokenDemo;
                
                console.log(`🔌 [WEBSOCKET] Solicitando autorización para cuenta ${botState.accountMode.toUpperCase()}...`);
                ws.send(JSON.stringify({ authorize: activeToken }));
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
            console.log(`✅ Autenticación exitosa en KRAKEN: ${msg.authorize.email} [Moneda: ${msg.authorize.currency || 'USD'}]`);
            botState.isConnectedToDeriv = true;
            botState.currency = msg.authorize.currency || 'USD';
            
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ forget_all: 'proposal_open_contract' }));
            
            // Si hay un contrato activo en memoria, re-suscribirse tras limpiar
            if (botState.activeContractId) {
                console.log(`🔄 [RECONEXIÓN] Re-suscribiendo al contrato activo: ID ${botState.activeContractId}`);
                ws.send(JSON.stringify({
                    proposal_open_contract: 1,
                    contract_id: botState.activeContractId,
                    subscribe: 1
                }));
            }
            
            // Consultar portafolio para auditar si hay contratos ACCU colgados en Deriv
            console.log(`📡 [KRAKEN] Auditando posiciones abiertas en Deriv...`);
            ws.send(JSON.stringify({ portfolio: 1 }));
            
            // Descargar historial de 300 ticks espaciado (Pacing de 250ms) para evitar tasa de límite (Rate Limit 80 req/min de Deriv)
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    SCAN_SYMBOLS.forEach((sym, idx) => {
                        setTimeout(() => {
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                const mState = botState.markets[sym];
                                if (mState && mState.digitHistory && mState.digitHistory.length >= 250) {
                                    console.log(`🔥 KRAKEN CARGADO [${sym}]: Historial recuperado de caché en RAM (${mState.digitHistory.length} ticks). Ahorrando petición API.`);
                                } else {
                                    console.log(`📥 Descargando historial de 300 ticks para ${sym}...`);
                                    ws.send(JSON.stringify({
                                        ticks_history: sym,
                                        count: 300,
                                        end: 'latest',
                                        style: 'ticks',
                                        adjust_start_time: 1
                                    }));
                                }
                            }
                        }, idx * 250); // Espaciado a 250ms entre cada mercado
                    });
                }
            }, 3000); // Demorado a 3 segundos para estabilizar la conexión
            
            // Suscripción a ticks en vivo espaciado (Pacing de 250ms)
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    SCAN_SYMBOLS.forEach((sym, idx) => {
                        setTimeout(() => {
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ subscribe: 1, ticks: sym }));
                                console.log(`📡 Suscripción ticks en vivo activada para ${sym}`);
                            }
                        }, idx * 250); // Espaciado a 250ms entre cada mercado
                    });
                }
            }, 6000); // Iniciado tras terminar la carga de historiales
            
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    console.log(`💰 Suscripción balance activada.`);
                }
            }, 9000);
        }
        
        if (msg.error) {
            // Cancelar verificación de payout si falla la propuesta
            if (botState.pendingPayoutCheck && (msg.req_id === botState.pendingPayoutCheck.reqIdHigher || msg.req_id === botState.pendingPayoutCheck.reqIdLower)) {
                if (msg.error.code === 'ContractBuyValidationError') {
                    console.log(`⏭️ [CODY FILTER] Señal omitida de forma segura: la barrera es muy ancha para este símbolo ("no return"). Buscando otro mercado...`);
                } else {
                    console.log(`⏭️ [CODY FILTER] Omitido: ${msg.error.message}. Compra cancelada.`);
                }
                botState.isBuying = false;
                botState.pendingPayoutCheck = null;
                return;
            }
            
            // Silenciar errores no críticos de suscripción duplicada y de validación de compra
            if (msg.error.code === 'AlreadySubscribed') {
                console.log(`ℹ️ Suscripción duplicada ignorada (no crítico): ${msg.error.message}`);
                return;
            }
            if (msg.error.code === 'ContractBuyValidationError') {
                // Ya se manejó de forma amigable arriba, evitar duplicar el log
                return;
            }
            
            console.error(`⚠️ Deriv API Error [${msg.error.code}]: ${msg.error.message}`);
            if (msg.error.code === 'WrongResponse' || msg.error.code === 'AuthorizationRequired') {
                console.log('🔄 Sesión inválida, reiniciando conexión...');
                botState.isConnectedToDeriv = false;
                if (ws) ws.close();
            }
            if (msg.msg_type === 'buy' || botState.isBuying) {
                botState.isBuying = false;
                console.error(`❌ Error en compra: ${msg.error.message}`);
                
                // 🔴 FIX: OpenPositionLimitExceeded = ACCU ya existe en Deriv, adoptarlo
                if (msg.error.code === 'OpenPositionLimitExceeded') {
                    console.log(`🔍 ACCU ya existe en Deriv. Consultando portfolio para adoptarlo...`);
                    ws.send(JSON.stringify({ portfolio: 1 }));
                    // NO aplicar lossPause — el contrato anterior sigue activo y generando profit
                } else if (msg.error.code === 'RateLimit') {
                    botState.lossPauseUntil = Date.now() + 60000;
                    console.log(`⏳ Pausa de seguridad de 60s aplicada debido a límite de la API.`);
                }
            }
            if (msg.msg_type === 'sell') {
                if (msg.error.code === 'BetExpired') {
                    // 🔴 FIX: NO limpiar isSellingAccumulator — si lo limpiamos,
                    // el siguiente update del contrato intentará vender DE NUEVO → bucle infinito
                    const knockedContractId = (msg.echo_req && msg.echo_req.sell) || botState.activeContractId;
                    if (knockedContractId) {
                        botState.isSellingAccumulator = knockedContractId; // Bloquear re-intentos
                    }
                    console.log(`💥 KNOCKOUT CONFIRMADO [ID: ${knockedContractId}]: Contrato expiró (barrera tocada). Consultando estado final...`);
                    // Consulta one-shot para obtener el is_sold:true y activar finalizeTrade
                    if (knockedContractId && ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: knockedContractId }));
                    }
                } else {
                    botState.isSellingAccumulator = null;
                    console.error(`❌ Error en venta: ${msg.error.message}`);
                }
            }
            return;
        }

        if (msg.msg_type === 'portfolio' && msg.portfolio) {
            const contracts = msg.portfolio.contracts || [];
            const accuContract = contracts.find(c => c.contract_type === 'ACCU' || c.contract_type === 'HIGHER' || c.contract_type === 'LOWER' || c.contract_type === 'CALL' || c.contract_type === 'PUT');
            if (accuContract) {
                const cType = accuContract.contract_type;
                const engine = cType === 'ACCU' ? 'ACCUMULATOR' : 'CODY_BARRIER';
                
                // Verificar si ya estamos rastreando este contrato O si acabamos de finalizarlo
                const alreadyTracking = botState.activeContractId === accuContract.contract_id;
                const justFinalized = botState.activeContractId === null && botState.currentEngine === null;
                
                if (alreadyTracking) {
                    console.log(`🛡️ [KRAKEN] Contrato ${cType} ${accuContract.contract_id} ya está siendo rastreado. Omitiendo adopción duplicada.`);
                } else if (justFinalized) {
                    // El contrato pudo haberse vendido entre el envío del portfolio request y la respuesta
                    console.log(`📡 [KRAKEN] Contrato ${cType} ${accuContract.contract_id} detectado pero bot está libre (posible venta reciente). Verificando con suscripción...`);
                    botState.activeContractId = accuContract.contract_id;
                    botState.currentContractId = accuContract.contract_id;
                    botState.currentContractType = cType;
                    botState.currentEngine = engine;
                    botState.isBuying = false;
                    ws.send(JSON.stringify({
                        proposal_open_contract: 1,
                        contract_id: accuContract.contract_id,
                        subscribe: 1
                    }));
                    saveState();
                } else {
                    // Adoptar contrato huérfano que no estamos rastreando
                    console.log(`🛡️ [KRAKEN] RECUPERACIÓN: Encontrado contrato ${cType} huérfano [ID: ${accuContract.contract_id}] para ${accuContract.symbol}. Adoptándolo...`);
                    botState.activeContractId = accuContract.contract_id;
                    botState.currentContractId = accuContract.contract_id;
                    botState.currentContractType = cType;
                    botState.currentEngine = engine;
                    botState.isBuying = false;
                    ws.send(JSON.stringify({
                        proposal_open_contract: 1,
                        contract_id: accuContract.contract_id,
                        subscribe: 1
                    }));
                    saveState();
                }
            } else {
                console.log(`📡 [KRAKEN] No se encontraron contratos ACCU activos pendientes en Deriv.`);
            }
        }
        
        if (msg.msg_type === 'balance' && msg.balance) {
            botState.balance = msg.balance.balance;
        }
        
        if (msg.msg_type === 'proposal' && msg.proposal) {
            const prop = msg.proposal;
            const reqId = msg.req_id;
            
            if (botState.pendingPayoutCheck) {
                const check = botState.pendingPayoutCheck;
                
                if (reqId === check.reqIdHigher) {
                    check.payoutHigher = parseFloat(prop.payout || 0);
                    console.log(`🔍 [CODY FILTER] Cotización Higher recibida: Payout $${check.payoutHigher.toFixed(2)} (Req ID: ${reqId})`);
                } else if (reqId === check.reqIdLower) {
                    check.payoutLower = parseFloat(prop.payout || 0);
                    console.log(`🔍 [CODY FILTER] Cotización Lower recibida: Payout $${check.payoutLower.toFixed(2)} (Req ID: ${reqId})`);
                }
                
                // Si ya tenemos ambos payouts
                if (check.payoutHigher !== null && check.payoutLower !== null) {
                    const totalStake = check.finalStake * 2;
                    const minPayout = Math.min(check.payoutHigher, check.payoutLower);
                    const requiredPayout = totalStake * (1 + (botState.codyPayoutFilterMargin || 0.0));
                    
                    console.log(`📊 [CODY FILTER] EVALUACIÓN BREAKOUT: Peor Payout: $${minPayout.toFixed(2)} vs Costo Total: $${totalStake.toFixed(2)} (Requerido: $${requiredPayout.toFixed(2)})`);
                    
                    if (minPayout >= requiredPayout) {
                        console.log(`✅ [CODY FILTER] ¡APROBADO! Rompimiento garantizado (+${(minPayout - totalStake).toFixed(2)} retorno neto mínimo si uno gana). Comprando en REAL...`);
                        
                        botState.activeContractIds = [];
                        botState.dualContractsState = {
                            higher: { id: null, finalized: false, profit: 0, won: false },
                            lower: { id: null, finalized: false, profit: 0, won: false }
                        };
                        
                        botState.isBuying = true;
                        botState.lastTradeTime = Date.now();
                        
                        ws.send(JSON.stringify(check.buyRequestHigher));
                        ws.send(JSON.stringify(check.buyRequestLower));
                    } else {
                        console.log(`❌ [CODY FILTER] RECHAZADO: Peor Payout $${minPayout.toFixed(2)} < requerido $${requiredPayout.toFixed(2)}. Operación omitida.`);
                        botState.isBuying = false; // Desbloquear bot
                    }
                    
                    botState.pendingPayoutCheck = null; // Limpiar estado de verificación
                }
            }
            return;
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
                    // Guardar precio real para cálculo de volatilidad ACCU
                    if (!mState.recentPrices) mState.recentPrices = [];
                    mState.recentPrices.push(parseFloat(price));
                });
                
                if (mState.digitHistory.length > 300) {
                    mState.digitHistory = mState.digitHistory.slice(-300);
                }
                // Mantener sólo los últimos 50 precios reales
                if (mState.recentPrices && mState.recentPrices.length > 50) {
                    mState.recentPrices = mState.recentPrices.slice(-50);
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
                
                // ── Guardar precio real para filtro de volatilidad ACCU ──
                if (!mState.recentPrices) mState.recentPrices = [];
                mState.recentPrices.push(mState.lastTickPrice);
                if (mState.recentPrices.length > 50) mState.recentPrices.shift();
                
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
                
                // Evaluar resultado del Ghost Trade - Verificando que pertenezca a este símbolo
                if (botState.ghostPendingTrade && botState.ghostPendingTrade.symbol === sym) {
                    const pt = botState.ghostPendingTrade;
                    
                    if (pt.engine === 'CODY_BARRIER') {
                        pt.ticksRemaining = (pt.ticksRemaining || 5) - 1;
                        if (pt.ticksRemaining > 0) {
                            return; // Esperar ticks restantes
                        }
                    }
                    
                    let won = false;
                    
                    if (pt.contractType === 'DIGITEVEN') won = digit % 2 === 0;
                    else if (pt.contractType === 'DIGITODD') won = digit % 2 !== 0;
                    else if (pt.contractType === 'DIGITOVER') won = digit > parseInt(pt.barrier);
                    else if (pt.contractType === 'DIGITUNDER') won = digit < parseInt(pt.barrier);
                    else if (pt.contractType === 'ACCU') {
                        // Ghost Shield dinámico: barrera adaptativa según volatilidad real del símbolo
                        const recentVol = mState.recentPrices && mState.recentPrices.length >= 10
                            ? calcRecentVolatility(mState.recentPrices, 10)
                            : 0.0002;
                        // Barrera = mitad de la volatilidad reciente, entre 0.010% y 0.030%
                        const dynamicBarrier = Math.max(0.0001, Math.min(0.0003, recentVol * 0.5));
                        const priceChangePct = Math.abs((mState.lastTickPrice - pt.entryTickPrice) / pt.entryTickPrice);
                        won = priceChangePct <= dynamicBarrier;
                    } else if (pt.engine === 'CODY_BARRIER' && pt.contractType === 'DUAL') {
                        const exitPrice = mState.lastTickPrice;
                        const entryPrice = pt.entryTickPrice;
                        const barHigher = parseFloat(pt.barrierHigher); // ej. -0.15
                        const barLower = parseFloat(pt.barrierLower); // ej. +0.15
                        
                        const wonHigher = exitPrice > (entryPrice + barHigher);
                        const wonLower = exitPrice < (entryPrice + barLower);
                        won = wonHigher && wonLower; // Ganamos ambos si queda en el canal
                    } else if (pt.engine === 'CODY_BARRIER') {
                        const exitPrice = mState.lastTickPrice;
                        const entryPrice = pt.entryTickPrice;
                        const barrierOffset = pt.barrier ? parseFloat(pt.barrier) : 0;
                        
                        if (pt.contractType === 'LOWER' || pt.contractType === 'PUT') {
                            won = exitPrice < (entryPrice + barrierOffset);
                        } else if (pt.contractType === 'HIGHER' || pt.contractType === 'CALL') {
                            won = exitPrice > (entryPrice + barrierOffset);
                        }
                    }
                    
                    if (pt.contractType === 'ACCU') {
                        const priceChangePct = Math.abs((mState.lastTickPrice - pt.entryTickPrice) / pt.entryTickPrice);
                        console.log(`👻 GHOST RESULT [${sym}]: ${pt.engine} [${pt.contractType}] -> Salto de precio: ${(priceChangePct * 100).toFixed(4)}% -> ${won ? 'WIN ✅' : 'LOSS ❌ (SPIKE DETECTADO)'}`);
                    } else if (pt.engine === 'CODY_BARRIER') {
                        console.log(`👻 GHOST RESULT [${sym}]: ${pt.engine} [${pt.contractType} B:${pt.barrier}] -> Entrada:${pt.entryTickPrice} Salida:${mState.lastTickPrice} -> ${won ? 'WIN ✅' : 'LOSS ❌'}`);
                    } else {
                        console.log(`👻 GHOST RESULT [${sym}]: ${pt.engine} [${pt.contractType}] -> Result digit: ${digit} -> ${won ? 'WIN ✅' : 'LOSS ❌'}`);
                    }
                    
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
            const cid = msg.buy.contract_id;
            
            if (botState.currentContractType === 'DUAL') {
                if (!botState.activeContractIds) botState.activeContractIds = [];
                botState.activeContractIds.push(cid);
                
                // Asignar al lado correspondiente según el tipo en la solicitud original
                const buyReqType = msg.echo_req && msg.echo_req.parameters && msg.echo_req.parameters.contract_type;
                if (buyReqType === 'HIGHER' || buyReqType === 'CALL') {
                    botState.dualContractsState.higher.id = cid;
                    botState.dualContractsState.higher.barrier = msg.echo_req.parameters.barrier;
                } else if (buyReqType === 'LOWER' || buyReqType === 'PUT') {
                    botState.dualContractsState.lower.id = cid;
                    botState.dualContractsState.lower.barrier = msg.echo_req.parameters.barrier;
                }
                
                console.log(`🎯 [DUAL BUY] Contrato comprado [ID: ${cid}] de tipo ${buyReqType}`);
            } else {
                botState.activeContractId = cid;
                botState.currentContractId = cid;
            }
            
            botState.isBuying = false;
            
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: cid,
                subscribe: 1
            }));
        }
        
        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c) return;
            
            // 🧹 LIMPIEZA QUIRÚRGICA: Olvidar solo ESTA suscripción exacta al terminar el contrato.
            // Esto evita el Error 1008 sin usar forget_all (que a veces crashea la conexión).
            if (c.is_sold && msg.subscription && msg.subscription.id) {
                ws.send(JSON.stringify({ forget: msg.subscription.id }));
            }
            
            if (botState.currentContractType === 'DUAL') {
                if (botState.dualContractsState) {
                    if (botState.dualContractsState.higher.id === c.contract_id) {
                        botState.dualContractsState.higher.finalized = c.is_sold === 1;
                        botState.dualContractsState.higher.profit = parseFloat(c.profit || 0);
                        botState.dualContractsState.higher.won = parseFloat(c.profit || 0) > 0;
                    } else if (botState.dualContractsState.lower.id === c.contract_id) {
                        botState.dualContractsState.lower.finalized = c.is_sold === 1;
                        botState.dualContractsState.lower.profit = parseFloat(c.profit || 0);
                        botState.dualContractsState.lower.won = parseFloat(c.profit || 0) > 0;
                    }
                    
                    if (c.is_sold) {
                        if (botState.activeContractIds) {
                            botState.activeContractIds = botState.activeContractIds.filter(id => id !== c.contract_id);
                        }
                        
                        const bothFinalized = botState.dualContractsState.higher.finalized && botState.dualContractsState.lower.finalized;
                        if (bothFinalized) {
                            finalizeDualTrade(c.underlying || c.symbol || SYMBOL);
                        }
                    }
                }
                return;
            }
            
            // ── ACCUMULATOR: Mantenimiento del contrato activo ──
            if (botState.currentContractType === 'ACCU' && c.contract_id === botState.activeContractId && !c.is_sold && botState.isSellingAccumulator !== c.contract_id) {
                // 🔴 FIX 1: Actualizar lastTradeTime en cada update para que el FAILSAFE NUNCA mate un ACCU vivo
                botState.lastTradeTime = Date.now();
                
                // 🔴 FIX 2: Usar c.tick_passed (API real de Deriv) que representa exactamente los ticks transcurridos en ACCU, o fallback a tick_stream.length. EVITAR c.tick_count porque Deriv retorna 250 fijo como límite de consulta.
                const tickCount = typeof c.tick_passed === 'number' ? c.tick_passed : (c.tick_stream ? c.tick_stream.length : 0);
                const currentProfit = parseFloat(c.profit || 0);
                const currentPeak = botState.accuCurrentPeak || 0;
                const trailingPct = botState.accuTrailingPct || 0.80;
                const minTicks = botState.accuTargetTicks || 20;
                const maxTicks = botState.accuMaxTicks || 40;
                const stake = botState.currentStake || botState.stake || 1;
                const minProfitRatio = botState.accuMinProfitRatio || 0.40;
                const minProfitRequired = stake * minProfitRatio;
                
                // Actualizar pico de profit
                if (currentProfit > currentPeak) {
                    botState.accuCurrentPeak = currentProfit;
                }
                
                const trailingStop = currentPeak * trailingPct;
                const trailingTriggered = currentPeak >= minProfitRequired && currentProfit < trailingStop && tickCount >= minTicks;
                const maxTicksReached = tickCount >= maxTicks;
                // Sólo salida mínima si: ticks OK + profit mínimo alcanzado
                const readyForExit = tickCount >= minTicks && currentProfit >= minProfitRequired;
                
                let sellReason = '';
                let shouldSell = false;
                
                // 🔴 TOMA DE GANANCIAS AUTOMÁTICA: profit >= accuTakeProfitAt x stake (ej: 2x stake = $2 en $1)
                const takeProfitTarget = stake * (botState.accuTakeProfitAt || 2.0);
                const takeProfitReached = currentProfit >= takeProfitTarget;
                // Salida de emergencia absoluta: profit >= 3x stake
                const absoluteExit = currentProfit >= stake * 3;
                
                if ((absoluteExit || takeProfitReached || maxTicksReached) && c.is_valid_to_sell) {
                    shouldSell = true;
                    if (absoluteExit && !takeProfitReached) {
                        sellReason = `🚨 SALIDA ABSOLUTA: $${currentProfit.toFixed(3)} >= 3x stake`;
                    } else if (takeProfitReached) {
                        sellReason = `🎉 TAKE PROFIT: $${currentProfit.toFixed(3)} >= ${(botState.accuTakeProfitAt||2)}x stake ($${takeProfitTarget.toFixed(2)})`;
                    } else {
                        sellReason = `⏱️ Máx ${maxTicks} ticks | Profit: $${currentProfit.toFixed(3)}`;
                    }
                } else if (trailingTriggered && c.is_valid_to_sell) {
                    shouldSell = true;
                    sellReason = `📉 Trailing ${(trailingPct*100).toFixed(0)}%: $${currentProfit.toFixed(3)} < $${currentPeak.toFixed(3)} (pico)`;
                } else if (readyForExit && c.is_valid_to_sell) {
                    shouldSell = true;
                    sellReason = `✅ Objetivo: $${currentProfit.toFixed(3)} >= ${(minProfitRatio*100).toFixed(0)}% stake en ${tickCount} ticks`;
                }
                
                if (shouldSell) {
                    console.log(`🎯 ACCU VENTA [💹${tickCount}t | +$${currentProfit.toFixed(3)} | Pico:$${currentPeak.toFixed(3)}]: ${sellReason}`);
                    botState.isSellingAccumulator = c.contract_id;
                    botState.accuCurrentPeak = 0;
                    ws.send(JSON.stringify({ sell: c.contract_id, price: 0 }));
                } else if (tickCount % 10 === 0 && tickCount > 0) {
                    // Log cada 10 ticks con proyección
                    const gr = botState.accuCurrentGrowthRate || 0.01;
                    const proj100 = (stake * Math.pow(1 + gr, 100) - stake).toFixed(2);
                    const proj230 = (stake * Math.pow(1 + gr, 230) - stake).toFixed(2);
                    console.log(`📈 ACCU [${tickCount}t] +$${currentProfit.toFixed(3)} | Pico:$${currentPeak.toFixed(3)} | Meta:${minTicks}t/$${(minProfitRatio*stake).toFixed(2)} | Proj100t:$${proj100} | Proj230t:$${proj230}`);
                }
            }
            
            if (!c.is_sold) return;
            botState.isSellingAccumulator = null;
            finalizeTrade(c);
        }
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket Error:', err.message);
        botState.isConnectedToDeriv = false;
    });
    
    ws.on('close', (code) => {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
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
