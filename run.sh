#!/usr/bin/env bash
# ============================================================
#  PRAVAHA — Flash Flood Prediction System (one-click launcher)
#  macOS / Linux — just double-click "Start App.command" or run ./run.sh
# ============================================================
set -e
cd "$(dirname "$0")"

echo "======================================================"
echo "   🌊  PRAVAHA — Flash Flood Prediction System"
echo "   Hilly Regions of India · SIH 2026"
echo "======================================================"

# ---- 1. Find Python ----
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "❌ Python 3.10+ not found. Install from https://www.python.org/downloads/"
  read -r -p "Press Enter to exit..."; exit 1
fi
echo "✔ Python: $($PY --version)"

# ---- 2. Virtual environment ----
if [ ! -d ".venv" ]; then
  echo "⏳ Creating virtual environment (first run only)..."
  "$PY" -m venv .venv
fi
VENV_PY=".venv/bin/python"

# ---- 3. Dependencies ----
if [ ! -f ".venv/.deps_ok" ]; then
  echo "⏳ Installing dependencies (first run only)..."
  "$VENV_PY" -m pip install --upgrade pip -q
  "$VENV_PY" -m pip install -q -r requirements.txt
  touch .venv/.deps_ok
fi
echo "✔ Dependencies ready"

# ---- 4. Model ----
if [ ! -f "model/artifacts/model.joblib" ]; then
  echo "⏳ Training PravahaNet-RF model (first run only)..."
  "$VENV_PY" -m model.train
fi
echo "✔ Model ready"

# ---- 5. Serve ----
PORT="${PORT:-8000}"
URL="http://127.0.0.1:$PORT"
( sleep 2
  if command -v open >/dev/null; then open "$URL"
  elif command -v xdg-open >/dev/null; then xdg-open "$URL"; fi
) &

echo ""
echo "🚀 Dashboard starting at  $URL"
echo "   Press Ctrl+C to stop."
echo ""
exec "$VENV_PY" -m uvicorn backend.main:app --host 127.0.0.1 --port "$PORT"
