const fs = require('fs');

let content = fs.readFileSync('backtest-boom-current.js', 'utf8');
content = content.replace('if (rsi >= 0 && rsi <= 25) {', `
    const tStr = new Date(currentTime * 1000).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    if (tStr.includes('11:38:') || tStr.includes('11:39:')) {
        console.log('DEBUG 11:38-39: ', tStr, '| RSI:', rsi.toFixed(2), '| InTrade:', state.inTrade, '| Cooldown:', state.cooldownExpiryTime - currentTime, 's left');
    }
    if (rsi >= 0 && rsi <= 25) {
`);
fs.writeFileSync('backtest_debug.js', content);
