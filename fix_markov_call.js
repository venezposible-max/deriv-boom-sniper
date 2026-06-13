import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

// The block we want to replace or augment:
const targetBlock = `            // 🎯 MOTOR 6: CODY BARRIER SNIPER (Prioridad Absoluta si está encendido)
            if (botState.engineCodyBarrier) {
                signal = evaluateCodyBarrier(mState);
            }`;

const newBlock = `            // 🎯 MOTOR 6: CODY BARRIER SNIPER (Prioridad Absoluta si está encendido)
            if (botState.engineCodyBarrier) {
                signal = evaluateCodyBarrier(mState);
            }
            
            // 🎯 MOTOR MARKOV OMNISCIENTE
            if (!signal && botState.engineMarkovDiffers) {
                signal = evaluateMarkovDiffers();
                if (signal) {
                    signalSymbol = signal.symbol;
                    break; // Salir del loop porque Markov ya encontró una señal en algún mercado
                }
            }`;

serverContent = serverContent.replace(targetBlock, newBlock);

// Also make sure engineMarkovDiffers defaults to true since Cody is disabled
serverContent = serverContent.replace(
    'engineMarkovDiffers: false,',
    'engineMarkovDiffers: true,'
);

fs.writeFileSync('server-boom.js', serverContent);
console.log('Fixed Markov call injection!');
