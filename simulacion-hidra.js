/**
 * SIMULACIÓN: "LA HIDRA" vs MARTINGALA vs SIN RECUPERACIÓN
 * Stake base: $10 | 100 trades | 90% win rate
 * Payout Differs: ~10% de ganancia sobre el stake
 */

const SIMS = 5;           // 5 simulaciones para ver variabilidad
const TRADES = 100;
const BASE_STAKE = 10;
const WIN_RATE = 0.90;     // 90% probabilidad de ganar
const PAYOUT_RATIO = 0.10; // Ganas 10% del stake
const MIRROR_WIN_RATE = 0.99; // 99% en el espejo (digit no repite)

function randomWin(rate) {
    return Math.random() < rate;
}

// ═══════════════════════════════════════════════
// ESTRATEGIA 1: SIN RECUPERACIÓN (Stake fijo)
// ═══════════════════════════════════════════════
function simPlain() {
    let balance = 0;
    let wins = 0, losses = 0;
    
    for (let i = 0; i < TRADES; i++) {
        if (randomWin(WIN_RATE)) {
            balance += BASE_STAKE * PAYOUT_RATIO;
            wins++;
        } else {
            balance -= BASE_STAKE;
            losses++;
        }
    }
    return { balance, wins, losses };
}

// ═══════════════════════════════════════════════
// ESTRATEGIA 2: MARTINGALA CLÁSICA (Duplicar)
// ═══════════════════════════════════════════════
function simMartingale() {
    let balance = 0;
    let wins = 0, losses = 0;
    let currentStake = BASE_STAKE;
    let maxStakeUsed = BASE_STAKE;
    
    for (let i = 0; i < TRADES; i++) {
        if (randomWin(WIN_RATE)) {
            balance += currentStake * PAYOUT_RATIO;
            wins++;
            currentStake = BASE_STAKE; // Reset
        } else {
            balance -= currentStake;
            losses++;
            currentStake = currentStake * 2; // DUPLICAR
            if (currentStake > maxStakeUsed) maxStakeUsed = currentStake;
        }
    }
    return { balance, wins, losses, maxStakeUsed };
}

// ═══════════════════════════════════════════════
// ESTRATEGIA 3: LA HIDRA (Espejo + D'Alembert + Freno)
// ═══════════════════════════════════════════════
function simHidra() {
    let balance = 0;
    let wins = 0, losses = 0;
    let layer = 0;               // 0=Normal, 1=Espejo, 2=D'Alembert, 3=Freno
    let consecutiveLosses = 0;
    let dalembertStep = 0;
    let maxStakeUsed = BASE_STAKE;
    let emergencyWait = 0;
    let totalTrades = 0;
    let layerLog = { 0: 0, 1: 0, 2: 0, 3: 0 };
    
    let i = 0;
    while (totalTrades < TRADES) {
        // CAPA 3: Freno de emergencia
        if (layer === 3) {
            emergencyWait++;
            if (emergencyWait >= 50) {
                layer = 0;
                dalembertStep = 0;
                consecutiveLosses = 0;
                emergencyWait = 0;
            }
            i++;
            continue;
        }
        
        let stake, winRate;
        
        if (layer === 0) {
            // NORMAL
            stake = BASE_STAKE;
            winRate = WIN_RATE;
        } else if (layer === 1) {
            // ESPEJO: mismo dígito, 99% de que no repita
            stake = BASE_STAKE * 1.5;
            winRate = MIRROR_WIN_RATE;
        } else if (layer === 2) {
            // D'ALEMBERT: subida lineal + dígito frío
            stake = BASE_STAKE + (dalembertStep * (BASE_STAKE * 0.35));
            winRate = WIN_RATE; // Dígito frío, misma probabilidad base
        }
        
        if (stake > maxStakeUsed) maxStakeUsed = stake;
        layerLog[layer]++;
        
        if (randomWin(winRate)) {
            balance += stake * PAYOUT_RATIO;
            wins++;
            totalTrades++;
            
            if (layer === 1) {
                // Espejo ganó, volver a normal
                layer = 0;
                consecutiveLosses = 0;
            } else if (layer === 2) {
                // D'Alembert: bajar un nivel
                dalembertStep--;
                if (dalembertStep <= 0) {
                    dalembertStep = 0;
                    layer = 0;
                    consecutiveLosses = 0;
                }
            } else {
                consecutiveLosses = 0;
            }
        } else {
            balance -= stake;
            losses++;
            totalTrades++;
            consecutiveLosses++;
            
            if (layer === 0) {
                // Primera pérdida → Espejo
                layer = 1;
            } else if (layer === 1) {
                // Espejo falló → D'Alembert
                layer = 2;
                dalembertStep = 1;
            } else if (layer === 2) {
                dalembertStep++;
                if (consecutiveLosses >= 3) {
                    // 3 pérdidas seguidas → Freno
                    layer = 3;
                    emergencyWait = 0;
                }
            }
        }
        
        i++;
        if (i > 500) break; // Seguridad anti-loop
    }
    
    return { balance, wins, losses, maxStakeUsed, layerLog };
}

// ═══════════════════════════════════════════════
// EJECUTAR SIMULACIONES
// ═══════════════════════════════════════════════
console.log('');
console.log('═'.repeat(70));
console.log('  🧪 SIMULACIÓN: 100 TRADES | STAKE BASE: $10 | WIN RATE: 90%');
console.log('═'.repeat(70));

for (let sim = 1; sim <= SIMS; sim++) {
    // Usar la misma semilla de "suerte" para las 3 estrategias
    const seed = Math.random();
    
    console.log('');
    console.log(`─── SIMULACIÓN #${sim} ──────────────────────────────────────────`);
    
    // 1. Sin recuperación
    const plain = simPlain();
    console.log(`  📋 SIN RECUPERACIÓN:`);
    console.log(`     Balance: ${plain.balance >= 0 ? '+' : ''}$${plain.balance.toFixed(2)} | W:${plain.wins} L:${plain.losses} | Stake Max: $${BASE_STAKE}`);
    
    // 2. Martingala
    const mart = simMartingale();
    console.log(`  🔴 MARTINGALA:`);
    console.log(`     Balance: ${mart.balance >= 0 ? '+' : ''}$${mart.balance.toFixed(2)} | W:${mart.wins} L:${mart.losses} | Stake Max: $${mart.maxStakeUsed}`);
    
    // 3. La Hidra
    const hidra = simHidra();
    console.log(`  🐍 LA HIDRA:`);
    console.log(`     Balance: ${hidra.balance >= 0 ? '+' : ''}$${hidra.balance.toFixed(2)} | W:${hidra.wins} L:${hidra.losses} | Stake Max: $${hidra.maxStakeUsed.toFixed(2)}`);
    console.log(`     Capas usadas → Normal:${hidra.layerLog[0]} | Espejo:${hidra.layerLog[1]} | D'Alembert:${hidra.layerLog[2]} | Freno:${hidra.layerLog[3]}`);
}

// RESUMEN ESTADÍSTICO (1000 simulaciones)
console.log('');
console.log('═'.repeat(70));
console.log('  📊 RESUMEN ESTADÍSTICO (1,000 simulaciones de 100 trades cada una)');
console.log('═'.repeat(70));

let plainResults = [], martResults = [], hidraResults = [];
let martBlowups = 0, hidraBlowups = 0;

for (let s = 0; s < 1000; s++) {
    const p = simPlain();
    const m = simMartingale();
    const h = simHidra();
    
    plainResults.push(p.balance);
    martResults.push(m.balance);
    hidraResults.push(h.balance);
    
    if (m.maxStakeUsed > 160) martBlowups++; // Stake > $160 = peligroso
    if (h.maxStakeUsed > 160) hidraBlowups++;
}

const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const min = arr => Math.min(...arr);
const max = arr => Math.max(...arr);
const positives = arr => arr.filter(x => x > 0).length;

console.log('');
console.log(`  📋 SIN RECUPERACIÓN:`);
console.log(`     Promedio: ${avg(plainResults) >= 0 ? '+' : ''}$${avg(plainResults).toFixed(2)}`);
console.log(`     Mejor caso: +$${max(plainResults).toFixed(2)} | Peor caso: $${min(plainResults).toFixed(2)}`);
console.log(`     Sesiones positivas: ${positives(plainResults)}/1000 (${(positives(plainResults)/10).toFixed(1)}%)`);

console.log('');
console.log(`  🔴 MARTINGALA:`);
console.log(`     Promedio: ${avg(martResults) >= 0 ? '+' : ''}$${avg(martResults).toFixed(2)}`);
console.log(`     Mejor caso: +$${max(martResults).toFixed(2)} | Peor caso: $${min(martResults).toFixed(2)}`);
console.log(`     Sesiones positivas: ${positives(martResults)}/1000 (${(positives(martResults)/10).toFixed(1)}%)`);
console.log(`     ⚠️  Veces con stake peligroso (>$160): ${martBlowups}/1000`);

console.log('');
console.log(`  🐍 LA HIDRA:`);
console.log(`     Promedio: ${avg(hidraResults) >= 0 ? '+' : ''}$${avg(hidraResults).toFixed(2)}`);
console.log(`     Mejor caso: +$${max(hidraResults).toFixed(2)} | Peor caso: $${min(hidraResults).toFixed(2)}`);
console.log(`     Sesiones positivas: ${positives(hidraResults)}/1000 (${(positives(hidraResults)/10).toFixed(1)}%)`);
console.log(`     ⚠️  Veces con stake peligroso (>$160): ${hidraBlowups}/1000`);

console.log('');
console.log('═'.repeat(70));
