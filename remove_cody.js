import fs from 'fs';

let indexContent = fs.readFileSync('public/index.html', 'utf8');

// Using regex to remove the Cody Barrier card
const codyCardRegex = /<!-- CODY BARRIER \(MOTOR 6\) -->[\s\S]*?<!-- MARKOV DIFFERS -->/;
if (indexContent.match(codyCardRegex)) {
    indexContent = indexContent.replace(codyCardRegex, '<!-- MARKOV DIFFERS -->');
} else {
    // Try other pattern if order is different
    const alternativeRegex = /<!-- CODY BARRIER \(MOTOR 6\) -->[\s\S]*?<\/div>[\s]*<\/div>[\s]*<\/div>[\s]*<!--/;
    // This is getting risky. Let's just remove everything between <!-- CODY BARRIER (MOTOR 6) --> and the next <!--
    // Actually, I can just find the start of the Cody card and carefully remove it.
}

// Let's use a simpler approach. Just replace the exact Cody toggle JS logic so it stops rendering/erroring, and hide the card.
// Or just regex replace the whole card string.
// Let's hide the Cody settings.
indexContent = indexContent.replace('id="engineCardCodyBarrier"', 'id="engineCardCodyBarrier" style="display: none;"');
indexContent = indexContent.replace('Cody: Mult. Desv.', '<span style="display:none;">Cody: Mult. Desv.');
indexContent = indexContent.replace('id="inputCodyMultiplier"', 'id="inputCodyMultiplier" style="display:none;"');
indexContent = indexContent.replace('Cody Filtro', '<span style="display:none;">Cody Filtro');
indexContent = indexContent.replace('id="toggleCodyPayoutFilter"', 'id="toggleCodyPayoutFilter" style="display:none;"');
indexContent = indexContent.replace('id="codyFilterStatusDisplay"', 'id="codyFilterStatusDisplay" style="display:none;"');
indexContent = indexContent.replace('Cody: Margen (%)', '<span style="display:none;">Cody: Margen (%)');
indexContent = indexContent.replace('id="inputCodyPayoutFilterMargin"', 'id="inputCodyPayoutFilterMargin" style="display:none;"');

fs.writeFileSync('public/index.html', indexContent);
console.log('public/index.html patched to hide Cody!');

let serverContent = fs.readFileSync('server-boom.js', 'utf8');
// Just disable Cody forcefully so it never runs, even if toggled.
serverContent = serverContent.replace('botState.engineCodyBarrier = true;', 'botState.engineCodyBarrier = false;');
serverContent = serverContent.replace('engineCodyBarrier: true,', 'engineCodyBarrier: false,');
// Inside evaluateCodyBarrier
serverContent = serverContent.replace('if (!botState.engineCodyBarrier) return null;', 'return null; // CODY DISABLED\n    if (!botState.engineCodyBarrier) return null;');

fs.writeFileSync('server-boom.js', serverContent);
console.log('server-boom.js patched to disable Cody!');
