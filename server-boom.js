const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// 🥇 GOLD SNIPER PRO (XAU/USD) - 2026
// ==========================================
const APP_ID = 1089;
const STATE_FILE = path.join(__dirname, 'persistent-state-boom.json');

let MARKET_CONFIGS = {
    'frxXAUUSD': {
        stake: 10,
        takeProfit: 5.0,
        stopLoss: 10.0,
        multiplier: 200,
        rsiPeriod: 14,
        emaPeriod: 20,
        rsiOverbought: 70,
        rsiOversold: 30,
        granularity: 300
    },
    'R_100': {
        stake: 10,
        takeProfit: 5.0,
        stopLoss: 10.0,
        multiplier: 200,
        rsiPeriod: 14,
        emaPeriod: 20,
        rsiOverbought: 70,
        rsiOversold: 30,
        granularity: 300
    }
};

let GOLD_CONFIG = MARKET_CONFIGS['frxXAUUSD'];

let botState = {
    isRunning: false,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    currentContractId: null,
    currentRSI: 50,
    currentEMA: 0,
    lastTickPrice: 0,
    tickBuffer: [], // For acceleration
    tradeStartTime: null,
    tradeProfit: 0,
    tradeSeconds: 0,
    rsiOverbought: 70,
    rsiOversold: 30,
    lastRSI: 50,
    symbol: 'frxXAUUSD',
    marketStatus: 'OPEN',
    lastV100Structure: { hh: 0, ll: 0, lastSignal: 'WAIT' },
    activeContracts: [], // Nueva lista para manejar múltiples operaciones
    lastTradeTime: 0 // Para gestionar el enfriamiento de 60 segundos
};

// --- CARGAR ESTADO PREVIO ---
// Intentar cargar desde gold-state.json o persistent-state-boom.json para compatibilidad
const STATE_FILES = [
    path.join(__dirname, 'persistent-state-boom.json'),
    path.join(__dirname, 'gold-state.json')
];

let stateLoaded = false;
for (const file of STATE_FILES) {
    if (fs.existsSync(file)) {
        try {
            const data = JSON.parse(fs.readFileSync(file));
            if (data.botState) {
                botState = { ...botState, ...data.botState };
                // FORZAR RESET DE ESTADO DE MERCADO AL ARRANCAR
                botState.marketStatus = 'SEARCHING';
                botState.lastTickPrice = 0;
                botState.tickBuffer = [];
                // Garantizar que cargamos el historial
                if (data.botState.tradeHistory) botState.tradeHistory = data.botState.tradeHistory;
                if (data.botState.activeContracts) botState.activeContracts = data.botState.activeContracts;
            }
            if (data.marketConfigs) {
                MARKET_CONFIGS = { ...MARKET_CONFIGS, ...data.marketConfigs };
                GOLD_CONFIG = MARKET_CONFIGS[botState.symbol];
            }
            console.log(`📂 Estado recuperado desde ${path.basename(file)}. Historial: ${botState.tradeHistory.length} trades.`);
            stateLoaded = true;
            break;
        } catch (e) { console.log(`⚠️ Error cargando ${path.basename(file)}`); }
    }
}

let candleHistory = [];
let ws;
let isBuying = false;

// --- SERVIDOR WEB ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    res.json({ success: true, data: botState, config: GOLD_CONFIG });
});

app.post('/api/control', (req, res) => {
    const { action, stake, takeProfit, stopLoss, multiplier, rsiOverbought, rsiOversold } = req.body;
    if (action === 'START') {
        botState.isRunning = true;
        if (stake) GOLD_CONFIG.stake = Number(stake);
        if (takeProfit) GOLD_CONFIG.takeProfit = Number(takeProfit);
        if (stopLoss) GOLD_CONFIG.stopLoss = Number(stopLoss);
        if (multiplier) GOLD_CONFIG.multiplier = Number(multiplier);
        if (rsiOverbought) { GOLD_CONFIG.rsiOverbought = Number(rsiOverbought); botState.rsiOverbought = Number(rsiOverbought); }
        if (rsiOversold) { GOLD_CONFIG.rsiOversold = Number(rsiOversold); botState.rsiOversold = Number(rsiOversold); }

        // Actualizar el almacenamiento maestro
        MARKET_CONFIGS[botState.symbol] = { ...GOLD_CONFIG };
        saveState();
        const marketName = botState.symbol === 'frxXAUUSD' ? 'ORO' : 'V100';
        console.log(`▶️ V100 DUAL SNIPER INICIADO | ${marketName} (${botState.symbol}) | Stake: ${GOLD_CONFIG.stake}`);
        return res.json({ success: true, message: `V100 DUAL SNIPER en ${marketName} Activado` });
    }
    if (action === 'STOP') {
        botState.isRunning = false;
        saveState();
        const marketName = botState.symbol === 'frxXAUUSD' ? 'ORO' : 'V100';
        console.log(`⏸️ SNIPER ${marketName} DETENIDO.`);
        return res.json({ success: true, message: 'Bot Pausado' });
    }
    res.status(400).json({ success: false, error: 'Acción inválida' });
});

app.post('/api/clear-history', (req, res) => {
    botState.tradeHistory = [];
    botState.pnlSession = 0;
    botState.winsSession = 0;
    botState.lossesSession = 0;
    botState.totalTradesSession = 0;
    saveState();
    return res.json({ success: true, message: 'Historial limpiado' });
});

app.post('/api/sell-contract', (req, res) => {
    if (botState.currentContractId && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ sell: botState.currentContractId, price: 0 }));
        return res.json({ success: true, message: 'Orden de cierre enviada' });
    }
    res.status(400).json({ success: false, error: 'No hay contrato activo' });
});

app.post('/api/trade', (req, res) => {
    const { action } = req.body;
    if (botState.currentContractId || isBuying) return res.status(400).json({ success: false, error: 'Ya hay una operación en curso.' });
    if (action === 'MULTUP' || action === 'MULTDOWN') {
        executeTrade(action);
        return res.json({ success: true, message: `Disparo manual ${action} enviado` });
    }
    res.status(400).json({ success: false, error: 'Acción de trade de prueba inválida' });
});

app.post('/api/switch-market', (req, res) => {
    const { symbol } = req.body;
    if (botState.isRunning) return res.status(400).json({ success: false, error: 'Detén el bot primero' });

    botState.symbol = symbol;
    botState.marketStatus = 'SEARCHING';
    botState.lastTickPrice = 0;
    botState.tickAcceleration = 0;
    botState.tickBuffer = [];

    // Libera operaciones atrapadas del mercado anterior (para que puedas operar en el nuevo)
    botState.currentContractId = null;
    isBuying = false;
    botState.tradeProfit = 0;
    botState.tradeStartTime = null;
    botState.tradeSeconds = 0;

    GOLD_CONFIG = MARKET_CONFIGS[symbol]; // Cargar la config de ese mercado
    candleHistory = []; // Limpiar velas del mercado anterior
    saveState();

    // Reconectar con el nuevo símbolo y limpiar suscripciones previas
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: 'ticks' }));
        ws.send(JSON.stringify({ forget_all: 'candles' }));
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ authorize: process.env.DERIV_TOKEN || 'TSuD37g6G593Uis' }));
            }
        }, 500);
    } else {
        connectDeriv();
    }

    res.json({ success: true, symbol: botState.symbol, config: GOLD_CONFIG });
});

// --- LÓGICA DE TRADING ---
function connectDeriv() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        const marketName = botState.symbol === 'frxXAUUSD' ? 'ORO' : 'V100';
        console.log(`✅ Conectado a Deriv (Módulo ${marketName})`);
        // Priorizar token del entorno, luego token manual del estado si existiera, o el fallback
        const token = process.env.DERIV_TOKEN || 'TSuD37g6G593Uis';
        if (token === 'TSuD37g6G593Uis') {
            console.log("⚠️ ATENCIÓN: Usando token de respaldo. Asegúrate de configurar DERIV_TOKEN en Railway.");
        }
        ws.send(JSON.stringify({ authorize: token }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.msg_type === 'authorize') {
            console.log(`✅ Autenticado con éxito: ${msg.authorize.fullname || 'Usuario'}`);
            ws.send(JSON.stringify({ subscribe: 1, ticks: botState.symbol }));
            ws.send(JSON.stringify({
                ticks_history: botState.symbol,
                end: 'latest',
                count: 100,
                style: 'candles',
                granularity: GOLD_CONFIG.granularity,
                subscribe: 1
            }));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));

            // --- RECUPERACIÓN DE TRADES ---
            // 1. Si ya teníamos un ID guardado, intentamos retomarlo
            if (botState.currentContractId) {
                console.log(`🔍 Intentando recuperar contrato guardado: ${botState.currentContractId}`);
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: botState.currentContractId, subscribe: 1 }));
            }
            // 2. Pedimos el portafolio para ver si hay trades "huérfanos" (que se abrieron pero perdimos el ID)
            ws.send(JSON.stringify({ portfolio: 1 }));

            // --- SINCRONIZACIÓN PERIÓDICA ---
            // Revisar cada 15 segundos para asegurar que no perdemos trades
            if (global.syncInterval) clearInterval(global.syncInterval);
            global.syncInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ portfolio: 1 }));
                }
            }, 15000);

            console.log(`📡 Suscripciones enviadas para ${botState.symbol}`);
        }

        if (msg.error) {
            const errMsg = (msg.error.message || '').toLowerCase();
            // Ignorar errores benignos que ensucian los logs
            const isBenign = errMsg.includes('already subscribed') ||
                errMsg.includes('unrecognised request');

            if (!isBenign) {
                console.error(`⚠️ Error de Deriv [${msg.msg_type || 'N/A'}]: ${msg.error.message}`);
            }

            // Detectar mercado cerrado SOLAMENTE si es del símbolo activo
            const errorSymbol = msg.echo_req ? (msg.echo_req.ticks || msg.echo_req.ticks_history || msg.echo_req.subscribe) : null;

            if (msg.error.code === 'MarketIsClosed') {
                if (!errorSymbol || errorSymbol === botState.symbol) {
                    botState.marketStatus = 'CLOSED';
                    botState.lastTickPrice = 0;
                    console.log(`🚫 MERCADO CERRADO confirmado para ${botState.symbol}`);
                } else {
                    console.log(`ℹ️ Ignorando mensaje de mercado cerrado para símbolo secundario: ${errorSymbol}`);
                }
            }

            if (msg.msg_type === 'ticks' || msg.msg_type === 'tick') {
                if (botState.symbol === 'frxXAUUSD') {
                    console.log(`⚠️ Re-intentando con símbolo alternativo: XAUUSD`);
                    botState.symbol = 'XAUUSD';
                    ws.send(JSON.stringify({ subscribe: 1, ticks: 'XAUUSD' }));
                    ws.send(JSON.stringify({
                        ticks_history: 'XAUUSD',
                        end: 'latest',
                        count: 100,
                        style: 'candles',
                        granularity: GOLD_CONFIG.granularity,
                        subscribe: 1
                    }));
                }
            }
        }

        if (msg.msg_type === 'balance' && !msg.error && msg.balance) botState.balance = msg.balance.balance;

        if (msg.msg_type === 'candles') {
            candleHistory = msg.candles.map(c => ({
                epoch: c.epoch,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            }));
            console.log(`📡 Historial cargado: ${candleHistory.length} velas.`);
            processStrategy();
        }

        if (msg.msg_type === 'ohlc' && msg.ohlc) {
            const ohlc = msg.ohlc;
            // VERIFICACIÓN DE SÍMBOLO: Ignorar velas que no sean del mercado activo
            if (ohlc.symbol !== botState.symbol) return;

            const existing = candleHistory.find(c => c.epoch === ohlc.open_time);
            if (existing) {
                existing.close = ohlc.close;
                existing.high = ohlc.high;
                existing.low = ohlc.low;
            } else {
                candleHistory.push({ epoch: ohlc.open_time, open: ohlc.open, high: ohlc.high, low: ohlc.low, close: ohlc.close });
                if (candleHistory.length > 100) candleHistory.shift();
            }
            processStrategy();
        }

        if (msg.msg_type === 'tick' && msg.tick) {
            // VERIFICACIÓN DE SÍMBOLO: Ignorar ticks que no sean del mercado activo
            if (msg.tick.symbol !== botState.symbol) return;

            botState.marketStatus = 'OPEN';
            const quote = parseFloat(msg.tick.quote);
            if (!isNaN(quote)) {
                botState.lastTickPrice = quote;

                botState.tickBuffer.push(quote);
                if (botState.tickBuffer.length > 10) botState.tickBuffer.shift();

                // ─── MASTER TRAILING (TICK-BY-TICK) ───
                // Monitoreo ultra-rápido para asegurar ganancias
                if (botState.currentContractId && botState.isRunning) {
                    const contract = botState.activeContracts.find(c => c.id === botState.currentContractId);
                    if (contract && contract.entryPrice) {
                        // Calcular ganancia real-time
                        let diff = quote - contract.entryPrice;
                        if (contract.type === 'MULTDOWN') diff = -diff;
                        const liveProfit = diff * contract.multiplier * contract.stake;

                        botState.tradeProfit = liveProfit; // Actualizar UI

                        // Actualizar Profit Máximo Alcanzado
                        if (!contract.maxProfit || liveProfit > contract.maxProfit) {
                            contract.maxProfit = liveProfit;
                        }

                        // Lógica Refinada: Pasos de $0.50 para proteger más rápido
                        if (contract.maxProfit >= 1.50) {
                            // Escalón de $0.50. Ejemplo: $1.50 -> piso $0.75 | $2.00 -> piso $1.25
                            const currentStep = Math.floor(contract.maxProfit / 0.50) * 0.50;
                            const newFloor = currentStep - 0.75;

                            if (!contract.trailingFloor || newFloor > contract.trailingFloor) {
                                contract.trailingFloor = newFloor;
                                console.log(`🛡️ [ELITE TRAILING] Escalón $${currentStep.toFixed(2)} -> Piso: $${newFloor.toFixed(2)} (Máx: $${contract.maxProfit.toFixed(2)})`);
                            }
                        }

                        // Disparar Cierre de Emergencia
                        if (contract.trailingFloor && liveProfit <= contract.trailingFloor) {
                            console.log(`⚡ [TRAIL HIT] Cerrando en $${liveProfit.toFixed(2)} para asegurar $${contract.trailingFloor.toFixed(2)}`);
                            sellContract(contract.id);
                        }
                    }
                }

                // Calcular Momentum
                let accel = 0;
                if (botState.tickBuffer.length >= 5) {
                    accel = botState.tickBuffer[botState.tickBuffer.length - 1] - botState.tickBuffer[botState.tickBuffer.length - 5];
                }
                botState.tickAcceleration = accel;

                if (botState.currentContractId && botState.tradeStartTime) {
                    botState.tradeSeconds = Math.floor((Date.now() - botState.tradeStartTime) / 1000);
                }

                processStrategy();
            }
        }

        if (msg.msg_type === 'buy' && msg.buy) {
            botState.currentContractId = msg.buy.contract_id;
            botState.tradeStartTime = Date.now();
            isBuying = false;
            console.log(`🎯 POSICIÓN ABIERTA [${msg.buy.contract_id}]`);
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: msg.buy.contract_id,
                subscribe: 1
            }));
        } else if (msg.msg_type === 'buy' && msg.error) {
            isBuying = false;
            console.log(`⚠️ ERROR AL COMPRAR: ${msg.error.message}`);
        }

        if (msg.msg_type === 'proposal_open_contract') {
            const c = msg.proposal_open_contract;
            if (!c) return;

            // Actualizar contrato en la lista de activos
            const idx = botState.activeContracts.findIndex(x => x.id === c.contract_id);
            if (idx !== -1) {
                botState.activeContracts[idx].profit = c.profit;
                botState.activeContracts[idx].seconds = Math.floor((Date.now() - (c.purchase_time * 1000)) / 1000);

                // Capturar datos para el Trailing Stop ultra-rápido
                if (!botState.activeContracts[idx].entryPrice && c.entry_tick) {
                    botState.activeContracts[idx].entryPrice = parseFloat(c.entry_tick);
                    botState.activeContracts[idx].multiplier = c.multiplier;
                    botState.activeContracts[idx].stake = parseFloat(c.buy_price);
                    botState.activeContracts[idx].type = c.contract_type;
                }
            } else if (!c.is_sold) {
                // Si es un contrato nuevo
                botState.activeContracts.push({
                    id: c.contract_id,
                    type: c.contract_type,
                    profit: c.profit,
                    seconds: 0
                });
            }

            // Atajo para UI (último contrato activo)
            botState.tradeProfit = c.profit;
            botState.currentContractType = c.contract_type;

            if (c.is_sold) finalizeTrade(c);
        }

        if (msg.msg_type === 'portfolio') {
            const contracts = msg.portfolio.contracts || [];
            // Filtrar solo los contratos de nuestro símbolo activo
            const activeOnSymbol = contracts.filter(c => c.symbol === botState.symbol);

            activeOnSymbol.forEach(c => {
                // Si no lo tenemos registrado en activeContracts, lo agregamos y nos suscribimos
                const exists = botState.activeContracts.find(x => x.id === c.contract_id);
                if (!exists) {
                    console.log(`🎯 Recuperando contrato activo del broker: ${c.contract_id}`);
                    botState.activeContracts.push({
                        id: c.contract_id,
                        type: c.contract_type,
                        profit: 0,
                        seconds: 0
                    });
                    // Nos suscribimos a sus actualizaciones si no tenemos suscripción activa
                    ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: c.contract_id, subscribe: 1 }));
                }

                // Actualizar ID global para compatibilidad con código viejo
                if (!botState.currentContractId) {
                    botState.currentContractId = c.contract_id;
                    botState.tradeStartTime = (c.purchase_time * 1000);
                }
            });
        }
    });

    ws.on('close', () => setTimeout(connectDeriv, 5000));
}

function processStrategy() {
    if (candleHistory.length < 30) return;

    const currentPrice = botState.lastTickPrice || candleHistory[candleHistory.length - 1].close;

    // --- PIVOT DETECTION (ChoCh Logic) ---
    // PASO 1: Encontrar el Swing High más reciente y guardar su índice
    let lastSH = 0;
    let shIndex = -1;
    for (let i = candleHistory.length - 3; i > 5; i--) {
        const prev = candleHistory[i - 1];
        const cur = candleHistory[i];
        const next = candleHistory[i + 1];
        if (cur.high > prev.high && cur.high > next.high) {
            lastSH = cur.high;
            shIndex = i;
            break;
        }
    }

    // PASO 2: Buscar el Swing Low más reciente ANTES del SH (historia más antigua)
    // Arrancamos desde shIndex-1 hacia atrás: garantiza que el SL es estructuralmente
    // anterior al SH, es decir, el soporte real que precedió la ruptura alcista
    let lastSL = 0;
    if (lastSH > 0 && shIndex > 6) {
        for (let i = shIndex - 1; i > 5; i--) {
            const prev = candleHistory[i - 1];
            const cur = candleHistory[i];
            const next = candleHistory[i + 1];
            if (cur.low < prev.low && cur.low < next.low && cur.low < lastSH) {
                lastSL = cur.low;
                break;
            }
        }
    }

    // Si no encontramos un par válido, no operar
    if (!lastSH || !lastSL) return;


    // Detectar si el precio rompe la estructura (ChoCh)
    const isBreakUp = currentPrice > lastSH;
    const isBreakDown = currentPrice < lastSL;

    // --- MOMENTUM Y ACELERACIÓN ESTRUCTURAL ---
    const ticks = botState.tickBuffer;
    let momentumUp = 0;
    let momentumDown = 0;
    let trueAcceleration = 0;

    if (ticks.length >= 5) {
        // Velocidad direccional neta (Últimos 4 pasos de precio)
        momentumUp = ticks[ticks.length - 1] - ticks[ticks.length - 5];
        momentumDown = ticks[ticks.length - 5] - ticks[ticks.length - 1];

        // Aceleración Real (Rapidez actual vs Rapidez anterior)
        const v1 = ticks[ticks.length - 1] - ticks[ticks.length - 3];
        const v2 = ticks[ticks.length - 3] - ticks[ticks.length - 5];
        trueAcceleration = Math.abs(v1) - Math.abs(v2);
    }

    // Fuerza mínima exigida para confiar en la ruptura
    // 0.25 en V100 (balance entre capturar impulsos reales y evitar ruido normal del mercado)
    const minForce = botState.symbol === 'frxXAUUSD' ? 0.05 : 0.25;


    // --- COOLDOWN CHECK ---
    const now = Date.now();
    const secondsSinceLastTrade = (now - (botState.lastTradeTime || 0)) / 1000;
    const cooldownPeriod = 60; // 60 segundos de enfriamiento

    if (!botState.isRunning || botState.currentContractId || isBuying || secondsSinceLastTrade < cooldownPeriod) {
        let sig = 'WAIT';
        if (botState.isRunning) {
            const remaining = Math.max(0, Math.ceil(cooldownPeriod - secondsSinceLastTrade));
            if (botState.currentContractId) sig = 'OPERANDO...';
            else if (isBuying) sig = 'COMPRANDO...';
            else if (remaining > 0) sig = `ENFRIAMIENTO ${remaining}s`;
        } else {
            sig = 'APAGADO';
        }

        botState.lastV100Structure = { hh: lastSH, ll: lastSL, lastSignal: sig };
        return;
    }

    // 1. COMPRA (ChoCh alcista)
    if (isBreakUp && momentumUp > minForce) {
        if (trueAcceleration > 0) { // Exige aceleración POSITIVA real, no solo plana
            console.log(`🔥 [CHOCH UP] Breakout High: ${lastSH} | Price: ${currentPrice} | Momentum: +${momentumUp.toFixed(2)} | Accel Real: ${trueAcceleration.toFixed(2)}`);
            executeDynamicTrade('MULTUP', lastSL, currentPrice);
        } else {
            console.log(`⚠️ [RECHAZADO UP] Momentum (+${momentumUp.toFixed(2)}) OK pero Aceleración plana/negativa (${trueAcceleration.toFixed(2)}). Trampa evitada.`);
        }
    }
    // 2. VENTA (ChoCh bajista)
    else if (isBreakDown && momentumDown > minForce) {
        if (trueAcceleration > 0) { // Exige aceleración POSITIVA real, no solo plana
            console.log(`🔥 [CHOCH DOWN] Breakout Low: ${lastSL} | Price: ${currentPrice} | Momentum: -${momentumDown.toFixed(2)} | Accel Real: ${trueAcceleration.toFixed(2)}`);
            executeDynamicTrade('MULTDOWN', lastSH, currentPrice);
        } else {
            console.log(`⚠️ [RECHAZADO DOWN] Momentum (-${momentumDown.toFixed(2)}) OK pero Aceleración plana/negativa (${trueAcceleration.toFixed(2)}). Trampa evitada.`);
        }
    }


    botState.lastV100Structure = {
        hh: lastSH,
        ll: lastSL,
        lastSignal: isBreakUp ? 'UP' : (isBreakDown ? 'DOWN' : 'WAIT')
    };
}

function executeDynamicTrade(type, slPrice, entryPrice) {
    if (isBuying) return;

    isBuying = true;
    setTimeout(() => { isBuying = false; }, 10000); // 10s auto-reset failsafe

    // Calcular SL y TP dinámicos basados en estructura (2x Riesgo)
    const stake = GOLD_CONFIG.stake;
    const mult = GOLD_CONFIG.multiplier;

    // Distancia en porcentaje
    const distPct = Math.abs(entryPrice - slPrice) / entryPrice;

    // SL Amount = Stake * Mult * DistPct
    // Agregamos un pequeño margen para no cerrar justo en el nivel
    // SL Amount = Priorizar valor configurado manual, si no usar estructura
    let slAmount = GOLD_CONFIG.stopLoss > 0 ? GOLD_CONFIG.stopLoss : stake * mult * (distPct + 0.0001);
    let tpAmount = GOLD_CONFIG.takeProfit > 0 ? GOLD_CONFIG.takeProfit : slAmount * 2;

    // Limites de seguridad para Deriv
    // IMPORTANTE: Deriv exige mínimos (aprox 0.74 USD en algunos mercados)
    let finalSL = Math.max(0.80, parseFloat(slAmount.toFixed(2)));
    if (finalSL >= stake) finalSL = parseFloat((stake * 0.95).toFixed(2)); // Cap al 95% del stake

    let finalTP = Math.max(0.80, parseFloat(tpAmount.toFixed(2)));
    // Si el SL se capó, el TP debería ser al menos el doble del nuevo SL si es posible
    if (finalTP >= (stake * 2)) finalTP = parseFloat((stake * 1.9).toFixed(2));

    const req = {
        buy: 1,
        price: stake,
        parameters: {
            amount: stake,
            basis: 'stake',
            contract_type: type,
            currency: 'USD',
            symbol: botState.symbol,
            multiplier: mult,
            limit_order: {
                take_profit: finalTP,
                stop_loss: finalSL
            }
        }
    };

    console.log(`📡 V100 DUAL SNIPER SHOOT: ${type} | SL: $${finalSL} | TP: $${finalTP}`);
    ws.send(JSON.stringify(req));
}

function executeTrade(type) {
    if (isBuying) return;

    isBuying = true;
    setTimeout(() => { isBuying = false; }, 10000); // 10s auto-reset failsafe
    const roundedStake = parseFloat(Number(GOLD_CONFIG.stake).toFixed(2));
    // Asegurar un mínimo de 1.50 USD para TP y SL para evitar rechazos de Deriv en Oro
    const roundedTP = Math.max(1.50, parseFloat(Number(GOLD_CONFIG.takeProfit).toFixed(2)));
    const roundedSL = Math.max(1.50, parseFloat(Number(GOLD_CONFIG.stopLoss).toFixed(2)));

    const req = {
        buy: 1,
        price: roundedStake,
        parameters: {
            amount: roundedStake,
            basis: 'stake',
            contract_type: type,
            currency: 'USD',
            symbol: botState.symbol,
            multiplier: Math.round(GOLD_CONFIG.multiplier),
            limit_order: {
                take_profit: roundedTP,
                stop_loss: roundedSL
            }
        }
    };

    console.log(`📡 ENVIANDO COMPRA: ${JSON.stringify(req)}`);
    ws.send(JSON.stringify(req));
}

function sellContract(contractId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ sell: contractId, price: 0 }));
    }
}

function finalizeTrade(c) {
    const profit = parseFloat(c.profit);
    if (isNaN(profit)) return; // Seguridad

    botState.pnlSession += profit;
    botState.totalTradesSession++;
    if (profit > 0) botState.winsSession++; else botState.lossesSession++;

    // Guardar en historial con hora de Venezuela (aprox GMT-4)
    const timeVE = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    botState.tradeHistory.unshift({
        type: c.contract_type === 'MULTUP' ? 'BUY 📈' : 'SELL 📉',
        profit: profit,
        time: timeVE
    });
    if (botState.tradeHistory.length > 50) botState.tradeHistory.pop();

    // Remover de contratos activos
    botState.activeContracts = botState.activeContracts.filter(x => x.id !== c.contract_id);

    // Al cerrar una operación, actualizamos el tiempo para el enfriamiento
    botState.lastTradeTime = Date.now();

    // Si no quedan contratos, limpiar trackers globales
    if (botState.activeContracts.length === 0) {
        botState.currentContractId = null;
        botState.tradeStartTime = null;
    }

    // --- PERSISTENCIA EXTRA SEGURA ---
    try {
        const logEntry = `${timeVE} | ${c.contract_type} | ${profit.toFixed(2)} USD\n`;
        fs.appendFileSync(path.join(__dirname, 'TRADE_HISTORY_LOG.txt'), logEntry);
    } catch (e) {
        console.error("❌ Fallo appendFileSync:", e.message);
    }

    console.log(`✅ OPERACIÓN CERRADA: Beneficio ${profit.toFixed(2)} USD`);
    saveState();
}

function calculateRSI(prices, period) {
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let cg = diff > 0 ? diff : 0;
        let cl = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + cg) / period;
        avgLoss = (avgLoss * (period - 1) + cl) / period;
    }
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}

function saveState() {
    try {
        const data = {
            botState: botState,
            marketConfigs: MARKET_CONFIGS
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(data));
    } catch (e) { }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 V100 DUAL SNIPER ENGINE READY - V_0_0_5_FIX (Multi-Trade + Time-Fix)');
    connectDeriv();
});

// --- ANTI-CRASH SYSTEM PARA SERVIDORES DE PRODUCCIÓN ---
// Evita que el servidor Node.js se caiga por completo si hay un error no manejado
process.on('uncaughtException', (err) => {
    console.error('🔥 [CRÍTICO] Excepción no atrapada:', err);
    saveState(); // Intenta salvar el estado antes de continuar
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 [CRÍTICO] Promesa rechazada no manejada:', reason);
    saveState();
});
