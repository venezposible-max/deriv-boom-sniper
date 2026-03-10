const fs = require('fs');

let content = fs.readFileSync('backtest-boom-current.js', 'utf8');

content = content.replace('// 2. Revisar si disparamos', `
    // 2. Revisar si disparamos
    const timeStr = new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    if (timeStr.includes('11:38:2') || timeStr.includes('11:38:3')) {
        let m1c = downsampleTicksToCandles(tickHistory, 60);
        let currentRsi = calculateRSI(m1c, 14);
        console.log(\`[TICK DEBUG] \${timeStr} | RSI: \${currentRsi.toFixed(2)} | InTrade: \${state.inTrade} | CooldownExpira: \${state.cooldownExpiryTime - currentTime}\`);
    }
`);

fs.writeFileSync('backtest_debug3.js', content);
