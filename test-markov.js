const history = [];
for(let i=0; i<200; i++) history.push(Math.floor(Math.random() * 10));

let triggers = 0;
for(let tick=0; tick<1000; tick++) {
    const currentDigit = Math.floor(Math.random() * 10);
    history.push(currentDigit);
    if(history.length > 1000) history.shift();
    
    let countUnder = 0;
    let countOver = 0;
    let totalSamples = 0;
    
    for (let i = 0; i < history.length - 1; i++) {
        if (history[i] === currentDigit) {
            totalSamples++;
            const nextDigit = history[i+1];
            if (nextDigit < 7) countUnder++;
            if (nextDigit > 2) countOver++;
        }
    }
    
    if (totalSamples >= 8) {
        const probUnder = countUnder / totalSamples;
        const probOver = countOver / totalSamples;
        if (probUnder >= 0.75) {
            triggers++;
        } else if (probOver >= 0.75) {
            triggers++;
        }
    }
}
console.log(`Ticks: 1000 | Triggers: ${triggers}`);
