const fs = require('fs');

let content = fs.readFileSync('backtest-boom-current.js', 'utf8');

content = content.replace('if (!isNaN(rsi)) {', `
    const timeStr = new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    if (timeStr.includes('11:38:2') || timeStr.includes('11:38:3') || timeStr.includes('11:38:4')) {
        console.log(\`[TICK DEBUG] Hora: \${timeStr} | RSI: \${rsi.toFixed(2)} | InTrade: \${state.inTrade} | CooldownExpira: \${new Date(state.cooldownExpiryTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' })}\`);
    }
    if (!isNaN(rsi)) {
`);

fs.writeFileSync('backtest_debug2.js', content);
