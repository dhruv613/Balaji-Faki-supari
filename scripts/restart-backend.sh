#!/usr/bin/env bash
# Local helper: restart the FastAPI backend on :8000 (local development only).
PID=$(netstat -ano | grep -E "127.0.0.1:8000 .*LISTENING" | awk '{print $5}' | head -1)
[ -n "$PID" ] && taskkill //F //PID "$PID" >/dev/null 2>&1
cd "$(dirname "$0")/../backend" && (python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > ../backend-run.log 2>&1 &)
sleep 7
curl -s -o /dev/null -w "backend %{http_code}\n" --max-time 5 http://127.0.0.1:8000/api/products
