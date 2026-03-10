// Probablemente el webhook evalúa los ticks más rápido de lo que creemos.
// Si `tickHistory.push(quote)` recibe respuestas cada fracción de segundo o varias por segundo,
// el contador `ticksInTrade` (15 Ticks) llega en 3-5 segundos, no en 15 segundos reales.
// ¡Y 5 segundos en Boom 1000 apenas alcanzan a bajar muy poco!
