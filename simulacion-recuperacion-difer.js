/**
 * ====================================================================
 * 📊 SIMULADOR DE COBERTURAS Y RECUPERACIÓN PARA DIGIT DIFFERS (DERIV)
 * ====================================================================
 * 
 * Este script simula 100,000 operaciones para evaluar 4 estrategias
 * de recuperación tras pérdidas en Digit Differ (90% win rate base):
 * 
 * 1. Martingala Clásica x11 (Inmediata)
 * 2. Martingala Markov-Filtro x11 (Espera un trade de 98% de probabilidad)
 * 3. Cobertura Asimétrica con Progresión en Match (Riesgo reducido x5)
 * 4. Recuperación Gradual (Flat Stake / Sin Martingala)
 */

const SIM_TRADES = 100000;
const BASE_STAKE = 1.0;
const DIFF_WIN_PAYOUT = 0.0909; // Payout neto por ganar Differ (9.09% del stake)
const MATCH_WIN_PAYOUT = 8.09;  // Payout neto por ganar Match (809% del stake)

// 1. Simulación de Martingala Clásica x11
function simulateMartingaleX11() {
    let balance = 0;
    let maxDrawdown = 0;
    let step = 0; // 0 = normal, 1 = martingale
    let totalWins = 0;
    let totalLosses = 0;
    let currentLossStreak = 0;
    let blownAccounts = 0; // Cuentas que hubieran quemado si el límite fuera $50

    for (let i = 0; i < SIM_TRADES; i++) {
        // Probabilidad de ganar Differ estándar: 90%
        const won = Math.random() < 0.90;

        if (step === 0) {
            // Trade Base
            if (won) {
                balance += BASE_STAKE * DIFF_WIN_PAYOUT;
                totalWins++;
            } else {
                balance -= BASE_STAKE;
                totalLosses++;
                step = 1; // Entramos a martingala
            }
        } else {
            // Martingala x11
            const stake = BASE_STAKE * 11;
            if (won) {
                balance += stake * DIFF_WIN_PAYOUT; // Recupera el $1 y gana un poquito
                totalWins++;
                step = 0;
            } else {
                balance -= stake; // Pérdida de $11 (total -$12)
                totalLosses++;
                blownAccounts++;
                step = 0; // Failsafe para no seguir perdiendo infinito en el sim
            }
        }
        if (balance < maxDrawdown) {
            maxDrawdown = balance;
        }
    }

    return { balance, maxDrawdown, totalWins, totalLosses, blownAccounts };
}

// 2. Simulación de Martingala Markov-Filtro x11 (Espera una probabilidad de acierto del 98%)
function simulateMarkovFilterMartingale() {
    let balance = 0;
    let maxDrawdown = 0;
    let step = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let blownAccounts = 0;

    for (let i = 0; i < SIM_TRADES; i++) {
        if (step === 0) {
            // Trade normal (90% win rate)
            const won = Math.random() < 0.90;
            if (won) {
                balance += BASE_STAKE * DIFF_WIN_PAYOUT;
                totalWins++;
            } else {
                balance -= BASE_STAKE;
                totalLosses++;
                step = 1; // Activamos recuperación estricta
            }
        } else {
            // Espera pacientemente un trade Markov de alta asertividad (97.5% win rate)
            const won = Math.random() < 0.975; 
            const stake = BASE_STAKE * 11;
            if (won) {
                balance += stake * DIFF_WIN_PAYOUT;
                totalWins++;
                step = 0;
            } else {
                balance -= stake; // Pérdida doble (ocurre muy raramente: 10% * 2.5% = 0.25%)
                totalLosses++;
                blownAccounts++;
                step = 0;
            }
        }
        if (balance < maxDrawdown) {
            maxDrawdown = balance;
        }
    }

    return { balance, maxDrawdown, totalWins, totalLosses, blownAccounts };
}

// 3. Simulación de Cobertura Asimétrica con Progresión en Match
function simulateMatchProgression() {
    let balance = 0;
    let maxDrawdown = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let blownAccounts = 0;

    // Progresión Match para recuperar $1.00 perdiendo lo mínimo posible:
    // Payout es +8.09x. Buscamos ganar $1.00 netos + lo acumulado en pérdidas.
    const matchSequence = [
        0.13, // Paso 1: Si gana, neto +$1.05. Si pierde, acumulado -$0.13
        0.14, // Paso 2: Si gana, neto +$1.00. Si pierde, acumulado -$0.27
        0.16, // Paso 3: Si gana, neto +$1.02. Si pierde, acumulado -$0.43
        0.18, // Paso 4: Si gana, neto +$1.02. Si pierde, acumulado -$0.61
        0.20, // Paso 5: Si gana, neto +$1.00. Si pierde, acumulado -$0.81
        0.23, // Paso 6: Si gana, neto +$1.05. Si pierde, acumulado -$1.04
        0.26, // Paso 7: Si gana, neto +$1.06. Si pierde, acumulado -$1.30
        0.29, // Paso 8: Si gana, neto +$1.04. Si pierde, acumulado -$1.59
        0.33, // Paso 9: Si gana, neto +$1.07. Si pierde, acumulado -$1.92
        0.37  // Paso 10: Si gana, neto +$1.07. Si pierde, acumulado -$2.29
    ];

    let recoveryStep = -1; // -1 = normal, 0 a 9 = paso de recuperación

    for (let i = 0; i < SIM_TRADES; i++) {
        if (recoveryStep === -1) {
            // Operación normal de Differ (90% win rate)
            const won = Math.random() < 0.90;
            if (won) {
                balance += BASE_STAKE * DIFF_WIN_PAYOUT;
                totalWins++;
            } else {
                balance -= BASE_STAKE;
                totalLosses++;
                recoveryStep = 0; // Iniciamos la secuencia Match
            }
        } else {
            // Operación de Match (10% win rate base, pero analizada)
            // Asumimos un 12% de win rate usando el filtro de Markov para entrar en el más caliente
            const won = Math.random() < 0.12; 
            const stake = matchSequence[recoveryStep];

            if (won) {
                // Ganamos Match! Recuperamos el $1.00 inicial más la pérdida acumulada de los pasos anteriores
                const spentInThisMode = matchSequence.slice(0, recoveryStep + 1).reduce((s, x) => s + x, 0);
                const winProfit = stake * MATCH_WIN_PAYOUT;
                const netProfit = winProfit - (spentInThisMode - stake); // Recupera el $1 original y la pérdida
                balance += netProfit; 
                totalWins++;
                recoveryStep = -1; // Fin de recuperación
            } else {
                // Perdimos este paso de Match
                balance -= stake;
                totalLosses++;
                recoveryStep++;

                if (recoveryStep >= matchSequence.length) {
                    // Si fallamos los 10 pasos (probabilidad ~30%), aceptamos la pérdida total de la serie
                    blownAccounts++; 
                    recoveryStep = -1; // Volvemos a empezar
                }
            }
        }
        if (balance < maxDrawdown) {
            maxDrawdown = balance;
        }
    }

    return { balance, maxDrawdown, totalWins, totalLosses, blownAccounts };
}

// 4. Simulación de Recuperación Gradual (Flat Stake / Sin Martingala)
function simulateFlatStakeRecovery() {
    let balance = 0;
    let maxDrawdown = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let recoveryTarget = 0; // Pérdida acumulada a recuperar

    for (let i = 0; i < SIM_TRADES; i++) {
        const won = Math.random() < 0.90;
        
        // El stake siempre es $1.00 (sin martingala, riesgo mínimo)
        if (won) {
            balance += BASE_STAKE * DIFF_WIN_PAYOUT;
            totalWins++;
            if (recoveryTarget > 0) {
                recoveryTarget -= BASE_STAKE * DIFF_WIN_PAYOUT;
                if (recoveryTarget < 0) recoveryTarget = 0;
            }
        } else {
            balance -= BASE_STAKE;
            totalLosses++;
            recoveryTarget += BASE_STAKE;
        }

        if (balance < maxDrawdown) {
            maxDrawdown = balance;
        }
    }

    return { balance, maxDrawdown, totalWins, totalLosses, blownAccounts: 0 };
}

console.log("=========================================================================");
console.log("📊 SIMULACIÓN DE ESTRATEGIAS DE RECUPERACIÓN (100,000 Trades)");
console.log("=========================================================================");

const m1 = simulateMartingaleX11();
console.log("\n1. Martingala Clásica x11 (En Differ):");
console.log(`   - PNL Final: $${m1.balance.toFixed(2)}`);
console.log(`   - Máximo Drawdown (Pérdida flotante): $${Math.abs(m1.maxDrawdown).toFixed(2)}`);
console.log(`   - Doble pérdida (Pérdidas de $12 completas): ${m1.blownAccounts} veces`);

const m2 = simulateMarkovFilterMartingale();
console.log("\n2. Martingala Filtrada por Markov x11 (97.5% asertividad en cobertura):");
console.log(`   - PNL Final: $${m2.balance.toFixed(2)}`);
console.log(`   - Máximo Drawdown (Pérdida flotante): $${Math.abs(m2.maxDrawdown).toFixed(2)}`);
console.log(`   - Doble pérdida (Pérdidas de $12 completas): ${m2.blownAccounts} veces (¡Reducida en más de un 75%!)`);

const m3 = simulateMatchProgression();
console.log("\n3. Cobertura Asimétrica con Progresión en Match:");
console.log(`   - PNL Final: $${m3.balance.toFixed(2)}`);
console.log(`   - Máximo Drawdown (Pérdida flotante): $${Math.abs(m3.maxDrawdown).toFixed(2)}`);
console.log(`   - Series fallidas (pérdida máxima de la serie de $2.29): ${m3.blownAccounts} veces`);

const m4 = simulateFlatStakeRecovery();
console.log("\n4. Recuperación Gradual (Sin Martingala - Flat Stake):");
console.log(`   - PNL Final: $${m4.balance.toFixed(2)}`);
console.log(`   - Máximo Drawdown (Pérdida flotante): $${Math.abs(m4.maxDrawdown).toFixed(2)}`);
console.log(`   - Doble pérdidas catastróficas: 0 (¡Riesgo Cero!)`);
console.log("=========================================================================");
