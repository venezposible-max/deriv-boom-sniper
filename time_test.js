const tickHistory = [5394.01, 5393.17, 5391.24, 5390.1, 5388.9, 5387.8];
// Explicación: 1.56e-13 es esencialmente CERO en javascript. Cuando esto entra al .toFixed(1) se redondea a "0.0".
// El problema persiste: Calcular un RSI de periodo 14 sobre Ticks SIEMPRE dará ceros porque si en los ultimos 14 segundos (15 a 45 ticks) el precio solo ha bajado micro-centavos, el Welles Wilder no tiene "Velos de Ganancia" contra los qué promediar. Y como el multiplicador "X" se vuelve cada vez más y más pequeño con cada vela roja, literalmente alcanza un asintoto cercano al Cero matemático. 
// Para Boom, no hay escapatoria a usar Ticks grandes, OH DEBEMOS ESCALAR EL PERIODO DE RSI DE NUEVO PERO CALIBRADO!
