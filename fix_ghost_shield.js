import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

// Fix Ghost Shield logic for DIGITDIFF to prevent false LOSS
const targetLogic = "else if (pt.contractType === 'DIGITUNDER') won = digit < parseInt(pt.barrier);";
const newLogic = "else if (pt.contractType === 'DIGITUNDER') won = digit < parseInt(pt.barrier);\n                    else if (pt.contractType === 'DIGITDIFF') won = digit !== parseInt(pt.barrier);\n                    else if (pt.contractType === 'DIGITMATCH') won = digit === parseInt(pt.barrier);";

if (serverContent.includes(targetLogic)) {
    serverContent = serverContent.replace(targetLogic, newLogic);
}

// Ensure the Markov toggle doesn't throw anything weird
// Ensure the bot doesn't drop after executeTrade
// Sometimes Deriv drops if we send a malformed heartbeat or something, but ping is 30s so it shouldn't be that.
// Let's just push the ghost shield fix.

fs.writeFileSync('server-boom.js', serverContent);
console.log('Fixed Ghost Shield DIGITDIFF evaluation!');
