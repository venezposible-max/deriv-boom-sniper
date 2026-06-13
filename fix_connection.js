import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

// 1. Stagger the initial history requests to avoid Deriv disconnects
const loopRegex = /Object\.keys\(botState\.markets\)\.forEach\((sym) => {/g;
if (serverContent.match(/Object\.keys\(botState\.markets\)\.forEach\(sym => {/)) {
    serverContent = serverContent.replace(
        /Object\.keys\(botState\.markets\)\.forEach\(sym => {/g,
        'let delayMs = 0;\n            Object.keys(botState.markets).forEach(sym => {'
    );
    
    serverContent = serverContent.replace(
        "ws.send(JSON.stringify({",
        "setTimeout(() => {\n                                    ws.send(JSON.stringify({"
    );
    
    serverContent = serverContent.replace(
        "adjust_start_time: 1\n                                    }));",
        "adjust_start_time: 1\n                                    }));\n                                }, delayMs);\n                                delayMs += 500; // 500ms stagger"
    );
}

// 2. We need 2000 ticks for R_50. So when it requests R_50, ask for 2000, others 300.
serverContent = serverContent.replace(
    "count: 300,",
    "count: sym === 'R_50' ? 2000 : 300,"
);

// 3. We need digitHistory to hold at least 2000 items.
serverContent = serverContent.replace(
    "if (mState.digitHistory.length > 300) mState.digitHistory.shift();",
    "if (mState.digitHistory.length > 2500) mState.digitHistory.shift();"
);

// 4. Update evaluateMarkovDiffers to use mState.digitHistory instead of botState.markovHistory
serverContent = serverContent.replace(
    "botState.markovHistory = {}; // Store ticks for markov",
    "// Using mState.digitHistory instead"
);
serverContent = serverContent.replace(
    "if (!botState.markovHistory[sym]) return null;\n    const hist = botState.markovHistory[sym];",
    "if (!botState.markets[sym] || !botState.markets[sym].digitHistory) return null;\n    const hist = botState.markets[sym].digitHistory;"
);

fs.writeFileSync('server-boom.js', serverContent);
console.log('Fixed Rate Limits and Markov History!');
