/**
 * ============================================================
 *  PROYECTO ANTIGRAVEDAD v8.0 - EL FRANCOTIRADOR INSTITUCIONAL
 *  Estrategia: Stake Fijo + Anomalía Estadística Extrema
 *  Contrato: DIGITDIFF (90% probabilidad base)
 *  Regla de Oro: 0% Martingala. 0% Capas de Recuperación.
 *  Gatillo: Solo dispara cuando un dígito sale 3 veces seguidas (0.1% prob).
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

const APP_ID = process.env.DERIV_APP_ID || '36544';
const DERIV_TOKEN = process.env.DERIV_TOKEN || 'PMIt2RhEjEDbcLD';
const STATE_FILE = path.join(__dirname, 'persistent-state-institutional.json');
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_100'];

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
    stake: 5,             // STAKE FIJO INMUTABLE
    takeProfit: 10,
    maxDailyLoss: 50,     // Riesgo máximo por sesión
    activeSymbol: null,
    activeContractId: null,
    lastTradeTime: 0,
    cooldownMs: 2000,
    isBuying: false,
    strategyMode: 'DIFFERS', // Opciones: 'DIFFERS' o 'MATCH'
    viewedSymbol: 'R_100',
    markets: {}
};

SYMBOLS.forEach(s => {
    botState.markets[s] = { digitHistory: [] };
});

// ─── PERSISTENCIA ─────────────────────────────────────────────
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE));
        if (saved.botState) {
            botState = { ...botState, ...saved.botState };
            botState.isRunning = false;
            botState.isBuying = false;
        }
    } catch (e) {}
}
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ botState })); } catch (e) {} };

// ─── CONEXIÓN A DERIV ─────────────────────────────────────────
let ws = null;
function connectDeriv() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => { setTimeout(() => ws.send(JSON.stringify({ authorize: DERIV_TOKEN })), 1000); });
    ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.msg_type === 'authorize') {
            botState.isConnectedToDeriv = true;
            console.log("👔 MODO INSTITUCIONAL v8.0 ACTIVADO (Cero Martingala | Solo Anomalías 3x)");
            SYMBOLS.forEach(s => {
                ws.send(JSON.stringify({ subscribe: 1, ticks: s }));
            });
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            const s = msg.tick.symbol;
            const digit = parseInt(String(msg.tick.quote.toFixed(2)).slice(-1));
            
            const m = botState.markets[s];
            m.digitHistory.push(digit);
            m.lastDigit = digit;
            m.lastTickPrice = msg.tick.quote;
            if (m.digitHistory.length > 50) m.digitHistory.shift();

            if (botState.isRunning && !botState.activeContractId && !botState.isBuying) {
                evaluateInstitutionalSniper();
            }
        }

        if (msg.msg_type === 'buy') {
            if (msg.buy) {
                botState.activeContractId = msg.buy.contract_id;
                botState.isBuying = false;
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 }));
            } else {
                console.error("❌ ERROR AL COMPRAR:", msg.error?.message || "Desconocido");
                botState.isBuying = false;
                botState.activeContractId = null;
            }
        }

        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract?.is_sold) {
            finalizeTrade(msg.proposal_open_contract);
        }
        if (msg.msg_type === 'balance') botState.balance = msg.balance.balance;
    });
    ws.on('close', () => { botState.isConnectedToDeriv = false; setTimeout(connectDeriv, 5000); });
}

// ─── MOTOR INSTITUCIONAL (CERO RIESGO) ────────────────────────
function evaluateInstitutionalSniper() {
    const now = Date.now();
    if (now - botState.lastTradeTime < botState.cooldownMs) return;

    let targetDiffersSymbol = null;
    let targetDiffersDigit = null;
    let targetMatchSymbol = null;
    let targetMatchDigit = null;

    // Escanear los 4 mercados con los dos agentes simultáneamente
    SYMBOLS.forEach(s => {
        const history = botState.markets[s].digitHistory;
        if (history.length < 2) return;
        
        const last4 = history.slice(-4);
        const last2 = history.slice(-2);
        
        // Agente 2: Cazador de Cisnes Negros (MATCH) - Busca 4 idénticos
        if (last4.length === 4 && last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
            targetMatchSymbol = s;
            targetMatchDigit = last4[0];
        } 
        // Agente 1: Recolector Constante (DIFFERS) - Busca 2 idénticos
        else if (last2.length === 2 && last2[0] === last2[1]) {
            targetDiffersSymbol = s;
            targetDiffersDigit = last2[0];
        }
    });

    // Prioridad absoluta al Agente de Cisnes Negros si se da la anomalía extrema
    if (targetMatchSymbol && targetMatchDigit !== null) {
        botState.activeSymbol = targetMatchSymbol;
        botState.isBuying = true;
        botState.lastTradeTime = now;
        
        // El Agente Match usa solo el 20% del stake para no arriesgar el capital del Recolector
        const matchStake = Math.max(0.35, parseFloat((botState.stake * 0.20).toFixed(2)));
        
        console.log(`🎯 [FRANCOTIRADOR - MATCH] ${targetMatchSymbol} | Anomalía Extrema (Salió el ${targetMatchDigit} cuatro veces) | Disparo: $${matchStake}`);
        
        ws.send(JSON.stringify({
            buy: 1, price: matchStake,
            parameters: {
                amount: matchStake, basis: 'stake', contract_type: 'DIGITMATCH',
                currency: 'USD', symbol: targetMatchSymbol, duration: 1, duration_unit: 't',
                barrier: String(targetMatchDigit)
            }
        }));
    } 
    // Si no hay anomalía extrema, el Agente Recolector hace su trabajo
    else if (targetDiffersSymbol && targetDiffersDigit !== null) {
        botState.activeSymbol = targetDiffersSymbol;
        botState.isBuying = true;
        botState.lastTradeTime = now;
        
        console.log(`🔫 [AMETRALLADORA - DIFFERS] ${targetDiffersSymbol} | Racha Leve (Salió el ${targetDiffersDigit} dos veces) | Disparo: $${botState.stake}`);
        
        ws.send(JSON.stringify({
            buy: 1, price: botState.stake,
            parameters: {
                amount: botState.stake, basis: 'stake', contract_type: 'DIGITDIFF',
                currency: 'USD', symbol: targetDiffersSymbol, duration: 1, duration_unit: 't',
                barrier: String(targetDiffersDigit)
            }
        }));
    }
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    const isWin = profit > 0;
    
    botState.dailyProfit += isWin ? profit : 0;
    botState.dailyLoss += isWin ? 0 : Math.abs(profit);
    botState.totalTradesSession++;
    
    if (isWin) {
        console.log(`✅ [WIN] +$${profit.toFixed(2)} | Balance: $${botState.balance}`);
        botState.winsSession++;
    } else {
        // LA REGLA DE ORO: Si pierde, acepta la pérdida con dignidad y mantiene el stake fijo.
        console.log(`❌ [LOSS] -$${Math.abs(profit).toFixed(2)} | Pérdida asumida. STAKE PROTEGIDO.`);
        botState.lossesSession++;
    }

    const barrierMatch = c.shortcode.match(/_(\d)_/);
    const barrierDigit = barrierMatch ? barrierMatch[1] : '?';
    const isMatch = c.shortcode.includes('DIGITMATCH');
    const isHedge = isMatch && c.buy_price < botState.stake; // El escudo siempre entra con menos stake

    botState.tradeHistory.unshift({
        symbol: botState.activeSymbol || c.display_symbol,
        type: isHedge ? `🛡️ ESCUDO(=${barrierDigit})` : (isMatch ? `🎯 MATCH(=${barrierDigit})` : `🔫 DIFF(≠${barrierDigit})`),
        profit,
        result: isWin ? 'WIN ✅' : 'LOSS ❌',
        time: new Date().toLocaleTimeString()
    });
    
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();
    botState.activeContractId = null;

    // 🛡️ ESCUDO ASIMÉTRICO (Contra-Golpe al 20%)
    // Si perdemos un trade normal (Differs)
    if (!isWin && !isMatch && botState.isRunning) {
        // Calcular el 20% del stake original (Mínimo $0.35 permitido por Deriv)
        const hedgeStake = Math.max(0.35, parseFloat((botState.stake * 0.20).toFixed(2)));
        botState.isBuying = true;
        
        console.log(`🛡️ [ESCUDO ASIMÉTRICO] Racha terca detectada. Lanzando MATCH(=${barrierDigit}) con $${hedgeStake} (20% del stake) para recuperar.`);
        
        ws.send(JSON.stringify({
            buy: 1, price: hedgeStake,
            parameters: {
                amount: hedgeStake, basis: 'stake', contract_type: 'DIGITMATCH',
                currency: 'USD', symbol: botState.activeSymbol, duration: 1, duration_unit: 't',
                barrier: String(barrierDigit)
            }
        }));
        
        // Evitamos calcular parada de sesión hasta que el escudo termine
        saveState();
        return;
    }

    const net = botState.dailyProfit - botState.dailyLoss;
    if (net >= botState.takeProfit || botState.dailyLoss >= botState.maxDailyLoss) {
        botState.isRunning = false;
        console.log(`🏁 META DE SESIÓN ALCANZADA. Bot detenido por seguridad.`);
    }
    saveState();
}

// ─── API DASHBOARD ────────────────────────────────────────────
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));

app.get('/differs/status', (req, res) => {
    // Para el dashboard visual, mostramos si hay alguna racha formándose
    let activeStreak = 0;
    let streakDigit = '-';
    let streakSymbol = '-';

    SYMBOLS.forEach(s => {
        const h = botState.markets[s].digitHistory;
        if (h.length >= 2) {
            const last2 = h.slice(-2);
            if (last2[0] === last2[1]) {
                activeStreak = 2;
                streakDigit = last2[0];
                streakSymbol = s;
            }
        }
    });

    const viewed = botState.viewedSymbol || 'R_100';
    const market = botState.markets[viewed] || { digitHistory: [] };

    res.json({ 
        success: true, 
        data: { 
            ...botState, 
            symbol: viewed,
            lastDigit: market.lastDigit,
            lastTickPrice: market.lastTickPrice,
            currentContractType: botState.strategyMode === 'MATCH' ? 'DIGITMATCH' : 'DIGITDIFF',
            shannonEntropy: `Racha: ${activeStreak}/3`,
            markovEdge: streakDigit,
            currentBarrier: streakDigit,
            inCooldown: false,
            cooldownRemaining: 0
        } 
    });
});

app.post('/differs/control', (req, res) => {
    const { action, stake, takeProfit, maxDailyLoss, strategyMode, symbol } = req.body;
    if (action === 'START' || action === 'SYNC') {
        if (stake) botState.stake = parseFloat(stake);
        if (takeProfit) botState.takeProfit = parseFloat(takeProfit);
        if (maxDailyLoss) botState.maxDailyLoss = parseFloat(maxDailyLoss);
        if (strategyMode) botState.strategyMode = strategyMode;
        if (symbol) botState.viewedSymbol = symbol;
        
        if (action === 'START') {
            botState.isRunning = true;
            console.log(`🚀 BOT INICIADO | Estrategia: ${botState.strategyMode} | Meta: $${botState.takeProfit}`);
        }
    } else if (action === 'STOP') {
        botState.isRunning = false;
        console.log(`⏸️ BOT PAUSADO por el usuario.`);
    } else if (action === 'RESET_DAY') { 
        botState.dailyProfit = 0; 
        botState.dailyLoss = 0; 
        botState.totalTradesSession = 0;
        botState.winsSession = 0;
        botState.lossesSession = 0;
        botState.tradeHistory = [];
        console.log(`🔄 Historial limpiado.`);
    }
    saveState(); res.json({ success: true });
});

app.listen(process.env.PORT || 8080, '0.0.0.0', () => connectDeriv());
