/**
 * ============================================================
 *  PROYECTO ANTIGRAVEDAD v4.0 - EL CEREBRO CAMALEÓN
 *  Estrategia: Metamórfica (Matches / Parity / Differs)
 *  Escaneo: Multi-Mercado en tiempo real (R10, R25, R50, R100)
 *  Selección Automática de Arma según Entropía de Shannon
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const APP_ID = process.env.DERIV_APP_ID || '36544';
const DERIV_TOKEN = process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-differs.json');
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];

// ─── ESTADO GLOBAL ────────────────────────────────────────────
let botState = {
    isRunning: false,
    isConnectedToDeriv: false,
    balance: 0,
    dailyProfit: 0,
    dailyLoss: 0,
    totalTradesSession: 0,
    winsSession: 0,
    lossesSession: 0,
    tradeHistory: [],
    stake: 10,
    takeProfit: 20,
    maxDailyLoss: 200,
    activeSymbol: 'R_25',
    activeContractId: null,
    lastTradeTime: 0,
    cooldownMs: 2000,
    isBuying: false,
    isRecoveryEnabled: true,
    recoveryLayer: 0, // 0=Normal, 1=Defensa, 2=Fénix
    // Datos por mercado
    markets: {}
};

// Inicializar contenedores para cada mercado
SYMBOLS.forEach(s => {
    botState.markets[s] = {
        digitHistory: [],
        entropy: 0,
        markovEdge: 0,
        lastDigit: null,
        bestStrategy: 'WAIT'
    };
});

// ─── LÓGICA DE PERSISTENCIA ──────────────────────────────────
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            // Mezclamos pero reseteamos estados volátiles
            botState = { ...botState, ...saved.botState };
            botState.isRunning = false;
            botState.isBuying = false;
            botState.activeContractId = null;
        }
    } catch (e) {}
}
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ botState })); } catch (e) {} };

// ─── MATEMÁTICAS CUÁNTICAS ────────────────────────────────────
function calcEntropy(hist) {
    if (hist.length < 100) return 3.32;
    const sub = hist.slice(-100);
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

function getMarkovParity(hist) {
    if (hist.length < 100) return null;
    const sub = hist.slice(-200);
    const matrix = { even: { even: 0, odd: 0, total: 0 }, odd: { even: 0, odd: 0, total: 0 } };
    for (let k = 1; k < sub.length; k++) {
        const prev = sub[k-1] % 2 === 0 ? 'even' : 'odd';
        const curr = sub[k] % 2 === 0 ? 'even' : 'odd';
        matrix[prev][curr]++;
        matrix[prev].total++;
    }
    const last = hist[hist.length - 1] % 2 === 0 ? 'even' : 'odd';
    const trans = matrix[last];
    if (trans.total < 10) return null;
    const probEven = trans.even / trans.total;
    const edge = Math.abs(probEven - 0.5);
    botState.markovEdge = (edge * 100).toFixed(1);
    if (probEven > 0.55) return { type: 'DIGITEVEN', label: 'PAR (Markov)' };
    if (probEven < 0.45) return { type: 'DIGITODD', label: 'IMPAR (Markov)' };
    return null;
}

function getMarkovOverUnder(hist) {
    if (hist.length < 100) return null;
    const sub = hist.slice(-200);
    const matrix = {};
    for (let i = 0; i <= 9; i++) {
        matrix[i] = {};
        for (let j = 0; j <= 9; j++) matrix[i][j] = 0;
    }
    for (let k = 1; k < sub.length; k++) {
        matrix[sub[k-1]][sub[k]]++;
    }
    const lastDigit = hist[hist.length - 1];
    let total = 0;
    for (let j = 0; j <= 9; j++) total += matrix[lastDigit][j];
    if (total < 10) return null;
    
    let probOver = 0;
    for (let d = 5; d <= 9; d++) probOver += matrix[lastDigit][d] / total;
    const probUnder = 1 - probOver;
    const edge = Math.abs(probOver - 0.5);
    botState.markovEdge = (edge * 100).toFixed(1);
    
    if (probOver > 0.55) return { type: 'DIGITOVER', barrier: '4', prob: probOver, label: 'OVER 4' };
    if (probUnder > 0.55) return { type: 'DIGITUNDER', barrier: '5', prob: probUnder, label: 'UNDER 5' };
    return null;
}

function getBestStrategy(symbol) {
    const m = botState.markets[symbol];
    const ent = m.entropy;
    
    if (ent > 3.25) return 'WAIT';      // Caos absoluto
    if (ent > 3.10) return 'DIFFERS';   // Mercado inestable -> Alta probabilidad
    if (ent > 2.70) return 'PARITY';    // Mercado normal -> Beneficio 1:1
    return 'MATCHES';                   // Mercado estable -> Alta recompensa (+800%)
}

// ─── CONEXIÓN Y TICK HANDLER ──────────────────────────────────
let ws = null;
function connectDeriv() {
    if (ws) ws.terminate();
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        setTimeout(() => ws.send(JSON.stringify({ authorize: DERIV_TOKEN })), 2000);
    });

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.msg_type === 'authorize') {
            botState.isConnectedToDeriv = true;
            console.log("✅ CEREBRO CAMALEÓN ONLINE");
            SYMBOLS.forEach(s => ws.send(JSON.stringify({ subscribe: 1, ticks: s })));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const s = msg.tick.symbol;
            const price = msg.tick.quote;
            const digit = parseInt(String(price.toFixed(2)).slice(-1));
            
            const m = botState.markets[s];
            m.digitHistory.push(digit);
            if (m.digitHistory.length > 200) m.digitHistory.shift();
            m.lastDigit = digit;
            m.entropy = calcEntropy(m.digitHistory);
            m.bestStrategy = getBestStrategy(s);

            // Actualizar Markov Edge para el dashboard (solo del mercado activo)
            if (s === botState.activeSymbol) {
                if (m.bestStrategy === 'PARITY') {
                    getMarkovParity(m.digitHistory); // Esto actualiza botState.markovEdge
                } else if (m.bestStrategy === 'DIFFERS') {
                    botState.markovEdge = 90; // Differs siempre tiene ~90% de probabilidad
                } else {
                    getMarkovOverUnder(m.digitHistory); // Esto actualiza botState.markovEdge
                }
            }

            // Si no estamos en un trade, el cerebro elige el mejor mercado disponible
            if (!botState.activeContractId && !botState.isBuying && botState.isRunning) {
                evaluateAndFire();
            }
        }

        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
        
        if (msg.msg_type === 'buy' && msg.buy) {
            botState.activeContractId = msg.buy.contract_id;
            botState.isBuying = false;
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract?.is_sold) {
            finalizeTrade(msg.proposal_open_contract);
        }
    });

    ws.on('close', () => { botState.isConnectedToDeriv = false; setTimeout(connectDeriv, 5000); });
}

// ─── EL MOTOR ADAPTATIVO ──────────────────────────────────────
function evaluateAndFire() {
    const now = Date.now();
    if (now - botState.lastTradeTime < botState.cooldownMs) return;

    // Buscamos el mercado con la MENOR entropía (el más predecible)
    let bestSymbol = null;
    let minEntropy = 4;

    SYMBOLS.forEach(s => {
        const m = botState.markets[s];
        if (m.digitHistory.length >= 100 && m.entropy < minEntropy) {
            minEntropy = m.entropy;
            bestSymbol = s;
        }
    });

    if (!bestSymbol) return;
    const targetMarket = botState.markets[bestSymbol];
    const strategy = targetMarket.bestStrategy;
    
    if (strategy === 'WAIT') return;

    // Si estamos en recuperación, forzamos la estrategia de rescate
    let contractType = '';
    let barrier = null;
    let stake = botState.stake;

    if (botState.recoveryLayer === 0) {
        // MODO ATAQUE ADAPTATIVO
        if (strategy === 'MATCHES') {
            contractType = 'DIGITMATCHES';
            barrier = String(targetMarket.lastDigit); // Sniper al mismo dígito
            stake = botState.stake * 0.2; // Stake pequeño porque paga 800%
        } else if (strategy === 'PARITY') {
            // Lógica Paridad
            const evenCount = targetMarket.digitHistory.slice(-20).filter(d => d % 2 === 0).length;
            contractType = evenCount > 10 ? 'DIGITODD' : 'DIGITEVEN'; // Contratendencia de paridad
        } else {
            contractType = 'DIGITDIFF';
            barrier = String(targetMarket.lastDigit);
        }
    } else if (botState.recoveryLayer === 1) {
        // DEFENSA SNIPER
        contractType = 'DIGITDIFF';
        barrier = String(targetMarket.lastDigit);
        stake = botState.stake * 1.1; 
    } else {
        // FÉNIX OVER/UNDER
        contractType = targetMarket.lastDigit > 4 ? 'DIGITUNDER' : 'DIGITOVER';
        barrier = targetMarket.lastDigit > 4 ? '5' : '4';
        stake = botState.stake * 1.5;
    }

    botState.isBuying = true;
    botState.activeSymbol = bestSymbol;
    botState.currentBarrier = barrier;
    botState.currentContractType = contractType;
    botState.lastTradeTime = now;

    console.log(`🎯 [CAMALEÓN] Mercado: ${bestSymbol} | Estrategia: ${strategy} | Entropy: ${minEntropy.toFixed(2)}`);

    const req = {
        buy: 1, price: stake,
        parameters: {
            amount: stake, basis: 'stake', contract_type: contractType,
            currency: 'USD', symbol: bestSymbol, duration: 1, duration_unit: 't'
        }
    };
    if (barrier !== null) req.parameters.barrier = barrier;
    
    ws.send(JSON.stringify(req));
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    
    botState.dailyProfit += isWin ? profit : 0;
    botState.dailyLoss += isWin ? 0 : Math.abs(profit);
    botState.totalTradesSession++;
    if (isWin) botState.winsSession++; else botState.lossesSession++;

    // Transiciones de capas
    if (isWin) {
        botState.recoveryLayer = 0;
    } else {
        botState.recoveryLayer = Math.min(botState.recoveryLayer + 1, 2);
    }

    botState.tradeHistory.unshift({
        symbol: c.display_symbol,
        type: c.contract_type,
        profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date().toLocaleTimeString()
    });

    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
    botState.activeContractId = null;
    
    // Verificación de Meta
    const net = botState.dailyProfit - botState.dailyLoss;
    if (net >= botState.takeProfit || botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`🏁 OBJETIVO ALCANZADO: $${net.toFixed(2)}`);
    }
    saveState();
}

// ─── SERVIDOR ─────────────────────────────────────────────────
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));
app.get('/differs/status', (req, res) => {
    const activeMarket = botState.markets[botState.activeSymbol] || {};
    const flattenedState = {
        ...botState,
        shannonEntropy: activeMarket.entropy || 0,
        markovEdge: activeMarket.markovEdge || 0,
        lastDigit: activeMarket.lastDigit,
        currentBarrier: botState.currentBarrier, // Usar el guardado globalmente
        symbol: botState.activeSymbol,
        winRate: botState.totalTradesSession > 0
            ? ((botState.winsSession / botState.totalTradesSession) * 100).toFixed(1)
            : '0.0'
    };
    res.json({ success: true, data: flattenedState });
});
app.post('/differs/control', (req, res) => {
    const { action, stake, takeProfit, maxDailyLoss, isRecoveryEnabled, scanRange } = req.body;
    
    if (action === 'START' || action === 'SYNC') {
        if (stake !== undefined) botState.stake = parseFloat(stake);
        if (takeProfit !== undefined) botState.takeProfit = parseFloat(takeProfit);
        if (maxDailyLoss !== undefined) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (isRecoveryEnabled !== undefined) botState.isRecoveryEnabled = !!isRecoveryEnabled;
        
        if (action === 'START') botState.isRunning = true;
    } else if (action === 'STOP') {
        botState.isRunning = false;
    } else if (action === 'RESET_DAY') {
        botState.dailyProfit = 0; 
        botState.dailyLoss = 0; 
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.totalTradesSession = 0;
        botState.tradeHistory = [];
    } else if (action === 'CONFIG') {
        if (scanRange) botState.scanRange = parseInt(scanRange);
    }
    
    saveState();
    res.json({ success: true, data: botState });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => { connectDeriv(); });
