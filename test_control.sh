curl -X POST http://localhost:8080/api/control \
-H "Content-Type: application/json" \
-d '{"action": "START", "stake": "20", "takeProfit": "50", "multiplier": "200", "timeStopTicks": "15", "stopLoss": "1"}'
