import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

const target1 = "barrier: bestTarget,\n                            prob: lowestProb\n                        };";
const target2 = "barrier: bestTarget,\r\n                            prob: lowestProb\r\n                        };";

const replace = "barrier: bestTarget,\n                            prob: lowestProb,\n                            stakeMultiplier: 1.0\n                        };";

if (serverContent.includes(target1)) {
    serverContent = serverContent.replace(target1, replace);
} else if (serverContent.includes(target2)) {
    serverContent = serverContent.replace(target2, replace.replace(/\n/g, '\r\n'));
}

// Fallback logic for getAdjustedStake just in case stake is undefined somehow
serverContent = serverContent.replace(
    "let adjusted = baseStake * engineMultiplier;",
    "let adjusted = (baseStake || 1) * (engineMultiplier || 1.0);"
);

fs.writeFileSync('server-boom.js', serverContent);
console.log('Fixed stake multipliers!');
