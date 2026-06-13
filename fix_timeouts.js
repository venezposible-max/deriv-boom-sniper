import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

// Increase the timeouts for live tick subscriptions and balance subscriptions
serverContent = serverContent.replace(
    /}, 6000\); \/\/ Iniciado tras terminar la carga de historiales/g,
    '}, 15000); // Iniciado tras terminar la carga de historiales (Aumentado para evitar colisión con historiales)'
);

serverContent = serverContent.replace(
    /}, 9000\);/g,
    '}, 18000);'
);

// We should also make sure the stagger delay is enough but not too long. 1000ms is perfectly safe.
serverContent = serverContent.replace(
    /delayMs \+= 1200;/g,
    'delayMs += 1000;'
);

fs.writeFileSync('server-boom.js', serverContent);
console.log('Fixed overlapping subscription timeouts!');
