import fs from 'fs';

let indexContent = fs.readFileSync('public/index.html', 'utf8');

// Hide Cobertura
indexContent = indexContent.replace(
    '<div class="control-group" style="display:flex; flex-direction:column; align-items:center; min-width: 90px;">\n        <label style="color: var(--accent-green);" title="Cobertura Cuántica (Progresión Lineal D\'Alembert + Ghost Shield)">Cobertura</label>',
    '<div class="control-group" style="display:none; flex-direction:column; align-items:center; min-width: 90px;">\n        <label style="color: var(--accent-green);" title="Cobertura Cuántica (Progresión Lineal D\'Alembert + Ghost Shield)">Cobertura</label>'
);

// Hide Ghost Shield
indexContent = indexContent.replace(
    '<div class="control-group" style="display:flex; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #a78bfa; font-weight: 700;" title="Escudo Ghost (Simular pérdidas antes de entrar en real)">Ghost Shield</label>',
    '<div class="control-group" style="display:none; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #a78bfa; font-weight: 700;" title="Escudo Ghost (Simular pérdidas antes de entrar en real)">Ghost Shield</label>'
);

// Hide Bollinger Shield
indexContent = indexContent.replace(
    '<div class="control-group" style="display:flex; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #60a5fa; font-weight: 700;" title="Escudo Bollinger (Filtra señales usando desviación estándar)">Bollinger Shield</label>',
    '<div class="control-group" style="display:none; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #60a5fa; font-weight: 700;" title="Escudo Bollinger (Filtra señales usando desviación estándar)">Bollinger Shield</label>'
);

// Hide Fibonacci Shield
indexContent = indexContent.replace(
    '<div class="control-group" style="display:flex; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #fbbf24; font-weight: 700;" title="Escudo Fibonacci (Solo dispara en zonas de rebote áureo)">Fibonacci Shield</label>',
    '<div class="control-group" style="display:none; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #fbbf24; font-weight: 700;" title="Escudo Fibonacci (Solo dispara en zonas de rebote áureo)">Fibonacci Shield</label>'
);

// Remove the vertical separators next to them to keep UI clean
// There are multiple <div class="control-separator"></div>. We can just hide them all if they are between the shields, but it's easier to just hide all separators except the first one (between config and shields) and the last one (before Reset Day).
// Let's just remove the 3 specific separators that are right after Ghost, Bollinger.
// Wait, CSS `display:none` on the items will make the flexbox just collapse them. The separators might still show. Let's hide the separators globally, they aren't that important.
// Actually, I'll just leave the separators or hide them using a quick replace.
indexContent = indexContent.replace(
    '<div class="control-separator"></div>\n\n      <div class="control-group" style="display:flex; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #a78bfa; font-weight: 700;" title="Escudo Ghost',
    '<div class="control-separator" style="display:none;"></div>\n\n      <div class="control-group" style="display:none; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #a78bfa; font-weight: 700;" title="Escudo Ghost'
);

indexContent = indexContent.replace(
    '<div class="control-separator"></div>\n\n      <div class="control-group" style="display:flex; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #60a5fa; font-weight: 700;" title="Escudo Bollinger',
    '<div class="control-separator" style="display:none;"></div>\n\n      <div class="control-group" style="display:none; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #60a5fa; font-weight: 700;" title="Escudo Bollinger'
);

indexContent = indexContent.replace(
    '<div class="control-separator"></div>\n\n      <div class="control-group" style="display:flex; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #fbbf24; font-weight: 700;" title="Escudo Fibonacci',
    '<div class="control-separator" style="display:none;"></div>\n\n      <div class="control-group" style="display:none; flex-direction:column; align-items:center; min-width: 100px;">\n        <label style="color: #fbbf24; font-weight: 700;" title="Escudo Fibonacci'
);

fs.writeFileSync('public/index.html', indexContent);
console.log('Shields hidden in index.html!');

// Also explicitly set them to false in server-boom.js
let serverContent = fs.readFileSync('server-boom.js', 'utf8');
serverContent = serverContent.replace('bollingerShield: false', 'bollingerShield: false'); // Ensure they're false
// It's fine, we already disabled them in server-boom.js in the previous script or they are not used by Markov anyway.
// Just to be safe:
serverContent = serverContent.replace('botState.bollingerShield = true;', 'botState.bollingerShield = false;');
serverContent = serverContent.replace('botState.fibonacciShield = true;', 'botState.fibonacciShield = false;');
serverContent = serverContent.replace('botState.ghostActive = true;', 'botState.ghostActive = false;');
serverContent = serverContent.replace('botState.coberturaEnabled = true;', 'botState.coberturaEnabled = false;');

fs.writeFileSync('server-boom.js', serverContent);
console.log('Shields disabled in server-boom.js!');
