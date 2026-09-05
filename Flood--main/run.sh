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
# Search well-known paths if standard command -v fails or returns old system python
SEARCH_PY=(
  "$(command -v python3 || true)"
  "$HOME/.pyenv/shims/python3"
  "$HOME/miniconda3/bin/python3"
  "/opt/homebrew/bin/python3"
  "/usr/local/bin/python3"
  "$(command -v python || true)"
)

PY=""
for cand in "${SEARCH_PY[@]}"; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then
    IS_OK=$("$cand" -c "import sys; print(sys.version_info >= (3, 10))" 2>/dev/null || echo "False")
    if [ "$IS_OK" = "True" ]; then
      PY="$cand"
      break
    fi
  fi
done

if [ -z "$PY" ]; then
  echo "❌ Python 3.10+ not found. Install from https://www.python.org/downloads/"
  read -r -p "Press Enter to exit..."; exit 1
fi
echo "✔ Python: $($PY --version) ($PY)"

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
  PYTHONPATH="." "$VENV_PY" -m model.train
fi
echo "✔ Model ready"

# ---- 5. Serve ----
PORT="${PORT:-8000}"
while lsof -i :"$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done
URL="http://127.0.0.1:$PORT"

(
  for i in {1..20}; do
    if curl -s -f "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      if [ "$(uname -s)" = "Darwin" ] && [ -d "/Applications/Google Chrome.app" ]; then
        open -na "Google Chrome" --args --app="$URL"
      elif command -v open >/dev/null 2>&1; then
        open "$URL"
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" 2>/dev/null || true
      fi
      exit 0
    fi
    sleep 0.5
  done
  if [ "$(uname -s)" = "Darwin" ] && [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$URL"
  elif command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" 2>/dev/null || true
  fi
) &

echo ""
echo "🚀 PRAVAHA Desktop starting at $URL"
echo "   Press Ctrl+C to stop."
echo ""
PYTHONPATH="." exec "$VENV_PY" -m uvicorn backend.main:app --host 127.0.0.1 --port "$PORT"
