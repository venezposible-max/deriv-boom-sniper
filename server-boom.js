const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN: BOOM 1000 SNIPER 2026
// ==========================================
const APP_ID = 1089;
const SYMBOL = 'BOOM1000'; // El Rey de las Explosiones
const STATE_FILE = path.join(__dirname, 'persistent-state-boom.json');
const WEB_PASSWORD = process.env.WEB_PASSWORD || 'admin123';

// --- ESTRATEGIA: SNIPER DE SPIKES (Seguro para $85) ---
let BOOM_CONFIG = {
    stake: 20,
    takeProfit: 50.00,
    stopLoss: 0.20,
    multiplier: 200,    // Multiplicador válido (100, 200, 300, 400, 500)
    rsiPeriod: 14,
    cciPeriod: 14,
    timeStopTicks: 15,
    cooldownSeconds: 45
};

let botState = {
    isRunning: false, // PARADA DE EMERGENCIA POR DEFECTO
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    balanceHistory: [],
    activeContracts: [],
    currentContractId: null,
    activeSymbol: 'BOOM1000',
    activeStrategy: 'SNIPER',
    cooldownRemaining: 0,
    lastScanLogTime: 0,
    sessionDuration: 0
};

let tickHistory = [];
let ws;
let isBuying = false;

// --- INICIALIZACIÓN DE SERVIDOR WEB PARA RAILWAY ---
const app = express();
app.use(cors());
app.use(express.json());

// --- DINAMIC BRANDING: BOOM 1000 ---
app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    // Inyectamos un script al final del body para cambiar el branding
    const brandingScript = `
    <script>
        window.onload = () => {
            const extremeSurge = () => {
                document.title = "BOOM 1000 SNIPER PRO 💥"; 
                
                // 1. Cirugía Estética Quirúrgica (Textos de etiquetas y títulos)
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let node;
                while (node = walker.nextNode()) {
                    let val = node.nodeValue;
                    // Limpieza de branding viejo
                    if (val.includes('Step Index') || val.includes('STEP INDEX') || val.includes('GOLD') || val.includes('ORO') || val.includes('XAUUSD')) {
                        node.nodeValue = val
                            .replace(/Step Index/gi, 'BOOM 1000')
                            .replace(/STEP INDEX/gi, 'BOOM 1000')
                            .replace(/GOLD/gi, 'BOOM 1000')
                            .replace(/ORO/gi, 'BOOM 1000')
                            .replace(/XAUUSD/gi, 'B1000');
                    }
                    // Re-etiquetado de parámetros (Lo que el usuario pidió)
                    if (val.includes('MOMENTUM (TICKS)')) { node.nodeValue = 'TIME-STOP (TICKS)'; }
                    if (val.includes('PRECISIÓN (DIST)')) { node.nodeValue = 'CCI FILTER (S)'; }
                    if (val.includes('TAKE PROFIT (🚀 $)')) { node.nodeValue = 'SPIKE TARGET ($)'; }
                    if (val.includes('INVERSIÓN BY DEFAULT')) { node.nodeValue = 'STAKE SNIPER ($)'; }
                    if (val.includes('ESTADO ALPHA')) { node.nodeValue = 'MODO SNIPER'; }
                    if (val.includes('ALPHA')) { node.nodeValue = 'SNIPER'; }
                    if (val.includes('ESTÁNDAR')) { node.nodeValue = 'BOOM MODE'; }
                }

                // 2. Ocultar secciones dinámicas de React (Polling agresivo)
                document.querySelectorAll('div, section, h2, h3, p, span, h1').forEach(el => {
                    const txt = el.textContent.toUpperCase();
                    // Ocultar trailing/híbrido/alpha/oro
                    if (txt.includes('TRAILING') || txt.includes('HÍBRIDO') || txt.includes('ALPHA') || (txt.includes('ORO') && !txt.includes('BOOM')) || txt.includes('XAUUSD')) {
                         // Buscamos el contenedor más cercano que parezca una tarjeta o sección
                         let container = el.closest('.card') || el.closest('div') || el.parentElement;
                         if (container && container.children.length < 5) { // Para no ocultar el body accidentalmente
                             container.style.display = 'none';
                             container.style.visibility = 'hidden';
                         }
                    }
                });

                // 3. Forzar valores visuales para evitar confusión
                document.querySelectorAll('input').forEach(input => {
                    if (input.value == "750") input.value = "200";
                    if (input.value == "5" && !input.getAttribute('data-fixed')) {
                        input.value = "15"; // Reflejar Time-stop
                        input.setAttribute('data-fixed', 'true');
                    }
                });
            };
            extremeSurge();
            setInterval(extremeSurge, 500); // Polling ultra-rápido para ganarle a React
        };
    </script>
    `;
    res.send(html.replace('</body>', brandingScript + '</body>'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    // Mapeamos BOOM_CONFIG a los nombres que la interfaz ya conoce para que los rellene
    const mappedConfig = {
        stake: BOOM_CONFIG.stake,
        takeProfit: BOOM_CONFIG.takeProfit,
        multiplier: BOOM_CONFIG.multiplier,
        momentum: BOOM_CONFIG.timeStopTicks, // Mapeo de Time-Stop
        stopLoss: BOOM_CONFIG.stopLoss,
        distLimit: 0.12 // Usamos esto para el filtro CCI/SMA
    };

    res.json({
        success: true,
        data: {
            ...botState,
            activeSymbol: 'BOOM 1000',
            activeStrategy: 'SNIPER'
        },
        config: mappedConfig,
        isSniper: true,
        isBoom: true
    });
});

// --- ENDPOINT: CONTROL REMOTO (START/STOP/CONFIG) ---
app.post('/api/control', (req, res) => {
    const { action, stake, takeProfit, multiplier, stopLoss, momentum } = req.body;

    if (action === 'START') {
        botState.isRunning = true;
        if (stake) BOOM_CONFIG.stake = Number(stake);
        if (takeProfit) BOOM_CONFIG.takeProfit = Number(takeProfit);
        if (momentum) BOOM_CONFIG.timeStopTicks = Number(momentum);

        if (multiplier) {
            // Ajustar a valores permitidos por Deriv para Boom (100, 200, 300, 400, 500)
            const val = Number(multiplier);
            if (val >= 450) BOOM_CONFIG.multiplier = 500;
            else if (val >= 350) BOOM_CONFIG.multiplier = 400;
            else if (val >= 250) BOOM_CONFIG.multiplier = 300;
            else if (val >= 150) BOOM_CONFIG.multiplier = 200;
            else BOOM_CONFIG.multiplier = 100;
        }

        if (stopLoss) BOOM_CONFIG.stopLoss = Number(stopLoss);
        if (timeStopTicks) BOOM_CONFIG.timeStopTicks = Number(timeStopTicks);

        saveState();
        console.log(`▶️ BOT BOOM 1000 ENCENDIDO | Sniper Mode | Mult: ${BOOM_CONFIG.multiplier}`);
        return res.json({ success: true, message: 'Bot Boom Sniper Activado', isRunning: true });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        saveState();
        console.log(`⏸️ BOT BOOM 1000 DETENIDO.`);
        return res.json({ success: true, message: 'Bot Pausado', isRunning: false });
    }

    if (action === 'FORCE_CLEAR') {
        botState.currentContractId = null;
        botState.activeContracts = [];
        isBuying = false;
        saveState();
        return res.json({ success: true, message: 'Trades de Boom limpiados' });
    }

    res.status(400).json({ success: false, error: 'Acción inválida' });
});

// --- ENDPOINT: TRADES MANUALES ---
app.post('/api/trade', (req, res) => {
    const { action } = req.body;
    if (botState.currentContractId || isBuying) return res.status(400).json({ success: false, error: 'Ya hay una operación activa.' });

    if (action === 'MULTUP' || action === 'MULTDOWN' || action === 'CALL' || action === 'PUT') {
        executeTrade(); // En Boom solo usamos MULTUP para spikes
        return res.json({ success: true, message: `Disparo manual enviado a BOOM 1000` });
    }
});

// --- ENDPOINT: CIERRE MANUAL ---
app.post('/api/close', (req, res) => {
    const { contractId } = req.body;
    const idToClose = contractId || botState.currentContractId;
    if (!idToClose) return res.status(400).json({ success: false, error: 'No hay nada que cerrar.' });

    ws.send(JSON.stringify({ sell: idToClose, price: 0 }));
    return res.json({ success: true, message: 'Orden de venta enviada' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`\n🚀 Iniciando Motor BOOM 1000 SNIPER...`);
    console.log(`🌍 Módulo Web en puerto ${PORT}`);

    // --- CRONÓMETRO DE SESIÓN ---
    setInterval(() => { if (botState.isRunning) botState.sessionDuration++; }, 1000);

    connectWebSocket();
});

// --- INDICADORES TÉCNICOS ---
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / (losses / period || 1);
    return 100 - (100 / (1 + rs));
}

function calculateCCI(prices, period) {
    if (prices.length < period) return 0;
    const sma = calculateSMA(prices, period);
    let meanDev = 0;
    const slice = prices.slice(-period);
    for (let p of slice) meanDev += Math.abs(p - sma);
    meanDev = meanDev / period;
    if (meanDev === 0) return 0;
    return (prices[prices.length - 1] - sma) / (0.015 * meanDev);
}

// --- LÓGICA DE CONEXIÓN Y MERCADO ---
function connectWebSocket() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log(`✅ Socket Abierto. Autorizando con Token...`);
        ws.send(JSON.stringify({ authorize: process.env.DERIV_TOKEN || 'GzEO8iO7Y3N9Ym0' }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.error) {
            const errMsg = (msg.error.message || '').toLowerCase();
            console.error(`⚠️ Error en BOOM: ${msg.error.message}`);
            isBuying = false;

            if (errMsg.includes('100 contracts') || errMsg.includes('more than 100')) {
                console.log('🛑 LÍMITE ALCANZADO: Tienes 100+ contratos abiertos. Pausando disparos 2 min.');
                botState.cooldownRemaining = 120;
                const timer = setInterval(() => {
                    if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;
                    else clearInterval(timer);
                }, 1000);
            }
            return;
        }

        if (msg.msg_type === 'authorize') {
            console.log(`✅ DERIV CONECTADO - Usuario: ${msg.authorize.fullname}`);

            // --- CALENTAMIENTO INSTANTÁNEO (WARM START) ---
            console.log(`🚀 Solicitando historial de ticks para arranque inmediato...`);
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                count: 500,
                end: 'latest',
                style: 'ticks'
            }));

            ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        // --- MANEJO DE HISTORIAL PARA WARM START ---
        if (msg.msg_type === 'history') {
            tickHistory = msg.history.prices;
            console.log(`📡 Memoria cargada instantáneamente: ${tickHistory.length} ticks. 🔥 SISTEMA LISTO.`);
        }

        if (msg.msg_type === 'balance') {
            botState.balance = msg.balance.balance;
            console.log(`💰 SALDO: $${botState.balance.toFixed(2)}`);
        }

        if (msg.msg_type === 'tick') {
            const quote = parseFloat(msg.tick.quote);
            tickHistory.push(quote);
            if (tickHistory.length > 500) tickHistory.shift();

            processTick(quote);
        }

        if (msg.msg_type === 'proposal_open_contract') {
            const contract = msg.proposal_open_contract;

            // Actualizar contrato activo para la UI
            if (contract && !contract.is_sold) {
                botState.currentContractId = contract.contract_id;
                botState.activeContracts = [contract];
            }

            if (contract && contract.is_sold) {
                finalizeTrade(contract);
            } else if (contract && !contract.is_sold) {
                // Monitoreo de Time-Stop
                const ticksElapsed = tickHistory.length - (botState.entryTickIdx || 0);
                const profit = parseFloat(contract.profit);

                // Si no hay spike en 15 ticks, cerramos con la "bala" de $0.20 - $1.00
                if (ticksElapsed >= BOOM_CONFIG.timeStopTicks && profit < 2.00) {
                    console.log(`🛡️ TIME-STOP: No hubo spike en ${BOOM_CONFIG.timeStopTicks} ticks. Abortando misión.`);
                    ws.send(JSON.stringify({ sell: contract.contract_id, price: 0 }));
                }
            }
        }
    });
}

function processTick(quote) {
    if (!botState.isRunning || botState.currentContractId || botState.cooldownRemaining > 0 || isBuying) {
        // Log de escaneo cada 30 segundos
        const now = Date.now();
        if (now - botState.lastScanLogTime > 30000) {
            console.log(`🔍 BOOM SCAN: RSI: ${calculateRSI(tickHistory, 14).toFixed(1)} | Cooldown: ${botState.cooldownRemaining}s | Memoria: ${tickHistory.length}/500`);
            botState.lastScanLogTime = now;
        }
        return;
    }

    const rsi = calculateRSI(tickHistory, 14);
    const cci = calculateCCI(tickHistory, 14);
    const sma50 = calculateSMA(tickHistory, 50);

    if (!sma50 || isNaN(rsi) || isNaN(cci)) return;

    // --- REGLAS SNIPER BOOM (Refinadas) ---
    const distSMA = Math.abs(quote - sma50) / sma50 * 100;

    // Evitamos disparos si el RSI es 0.0 (error de datos iniciales)
    if (rsi > 5 && rsi < 25 && cci > -150 && distSMA < 0.12) {
        console.log(`💥 SEÑAL DETECTADA: RSI: ${rsi.toFixed(1)} | CCI: ${cci.toFixed(0)} | ¡FUEGO!`);
        executeTrade();
    }
}

function executeTrade() {
    isBuying = true;
    const req = {
        buy: 1,
        subscribe: 1,
        price: BOOM_CONFIG.stake,
        parameters: {
            amount: BOOM_CONFIG.stake,
            basis: 'stake',
            contract_type: 'MULTUP',
            currency: 'USD',
            symbol: SYMBOL,
            multiplier: BOOM_CONFIG.multiplier
        }
    };
    ws.send(JSON.stringify(req));

    // Registrar el índice del tick de entrada para el Time-Stop
    botState.entryTickIdx = tickHistory.length;

    // BLOQUEO EXTENDIDO: No permitir disparos en ráfaga (10 segundos de protección)
    setTimeout(() => { isBuying = false; }, 10000);
}

function finalizeTrade(contract) {
    const profit = parseFloat(contract.profit);
    botState.pnlSession += profit;
    botState.totalTradesSession++;

    if (profit > 0) {
        botState.winsSession++;
        console.log(`🎯 ¡SPIKE CAZADO! Ganancia: +$${profit.toFixed(2)} 💰💰💰`);
    } else {
        botState.lossesSession++;
        console.log(`🛡️ BALA PERDIDA: -$${Math.abs(profit).toFixed(2)} (Bajo control)`);
    }

    // --- REGISTRO DE TRADING HISTORIAL (Máximo 10) ---
    const now = new Date();
    botState.tradeHistory.unshift({
        id: contract.contract_id,
        type: (contract.contract_type === 'MULTUP') ? 'BUY 🚀' : 'SELL ↘️',
        profit: profit,
        timestamp: now.toLocaleTimeString(),
        duration: Math.floor((now.getTime() / 1000) - contract.date_start) + 's'
    });
    if (botState.tradeHistory.length > 10) botState.tradeHistory.pop();

    botState.currentContractId = null;
    botState.activeContracts = [];
    botState.cooldownRemaining = BOOM_CONFIG.cooldownSeconds;

    const timer = setInterval(() => {
        if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;
        else clearInterval(timer);
    }, 1000);

    saveState();
}

function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(botState)); } catch (e) { }
}
