#!/usr/bin/env bash
# ==============================================================================
#  🌊 PRAVAHA — macOS Native Launcher (Finder Double-Clickable)
#  Flash Flood Early Warning System · Smart India Hackathon 2026
# ==============================================================================
set -e

# Change directory to the repository folder
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

echo "======================================================"
echo "   🌊  PRAVAHA — Flash Flood Prediction System"
echo "   macOS Native Deployment Launcher · SIH 2026"
echo "======================================================"
echo ""

# Ensure terminal window stays open if an unexpected error occurs
trap_error() {
  echo ""
  echo "❌ An error occurred during launch."
  echo "Press Enter to exit..."
  read -r _
}
trap 'trap_error' ERR

# ---- 1. Clear macOS Quarantine Flags ----
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$PROJECT_DIR" 2>/dev/null || true
fi

# ---- 2. Locate Compatible Python (>= 3.10) on macOS ----
# Finder launches scripts with a restricted PATH (/usr/bin:/bin:/usr/sbin:/sbin).
# We proactively search standard macOS Python install locations.
SEARCH_PATHS=(
  "$HOME/miniconda3/bin"
  "$HOME/anaconda3/bin"
  "$HOME/miniforge3/bin"
  "$HOME/.pyenv/shims"
  "/opt/homebrew/bin"
  "/usr/local/bin"
  "/Library/Frameworks/Python.framework/Versions/3.13/bin"
  "/Library/Frameworks/Python.framework/Versions/3.12/bin"
  "/Library/Frameworks/Python.framework/Versions/3.11/bin"
  "/Library/Frameworks/Python.framework/Versions/3.10/bin"
  "$PATH"
)

TARGET_PY=""

for p in "${SEARCH_PATHS[@]}"; do
  for cmd in "$p/python3" "$p/python3.13" "$p/python3.12" "$p/python3.11" "$p/python3.10"; do
    if [ -x "$cmd" ]; then
      VER_CHECK=$("$cmd" -c "import sys; print(sys.version_info >= (3, 10))" 2>/dev/null || echo "False")
      if [ "$VER_CHECK" = "True" ]; then
        TARGET_PY="$cmd"
        break 2
      fi
    fi
  done
done

if [ -z "$TARGET_PY" ]; then
  # Fallback to standard command lookup
  CANDIDATE="$(command -v python3 || command -v python || true)"
  if [ -n "$CANDIDATE" ]; then
    VER_CHECK=$("$CANDIDATE" -c "import sys; print(sys.version_info >= (3, 10))" 2>/dev/null || echo "False")
    if [ "$VER_CHECK" = "True" ]; then
      TARGET_PY="$CANDIDATE"
    fi
  fi
fi

if [ -z "$TARGET_PY" ]; then
  echo "❌ Error: Python 3.10 or higher is required."
  echo "   Installed macOS locations checked, but no suitable Python >= 3.10 was found."
  echo "   Please install Python via https://www.python.org/downloads/ or Homebrew (brew install python3)."
  echo ""
  read -r -p "Press Enter to exit..."; exit 1
fi

echo "✔ Detected macOS Python: $($TARGET_PY --version) ($TARGET_PY)"

# ---- 3. Virtual Environment Setup ----
VENV_DIR="$PROJECT_DIR/.venv"
VENV_PY="$VENV_DIR/bin/python"

if [ ! -d "$VENV_DIR" ] || [ ! -x "$VENV_PY" ]; then
  echo "⏳ Creating virtual environment at .venv..."
  "$TARGET_PY" -m venv "$VENV_DIR"
fi
echo "✔ Virtual environment ready: $VENV_DIR"

# ---- 4. Install / Verify Dependencies ----
DEPS_FLAG="$VENV_DIR/.deps_ok"
if [ ! -f "$DEPS_FLAG" ]; then
  echo "⏳ Installing dependencies from requirements.txt (first run only)..."
  "$VENV_PY" -m pip install --upgrade pip -q
  "$VENV_PY" -m pip install -q -r "$PROJECT_DIR/requirements.txt"
  touch "$DEPS_FLAG"
  echo "✔ Dependencies installed successfully"
else
  echo "✔ Dependencies ready (cached)"
fi

# ---- 5. Train PravahaNet-RF Model if Artifacts Missing ----
MODEL_ARTIFACT="$PROJECT_DIR/model/artifacts/model.joblib"
if [ ! -f "$MODEL_ARTIFACT" ]; then
  echo "⏳ Training PravahaNet-RF 400-tree model (first run only)..."
  PYTHONPATH="$PROJECT_DIR" "$VENV_PY" -m model.train
  echo "✔ Model trained and persisted to model/artifacts/"
else
  echo "✔ PravahaNet-RF model artifact verified"
fi

# ---- 6. Port Detection & Conflict Avoidance ----
PORT="${PORT:-8000}"
while lsof -i :"$PORT" >/dev/null 2>&1; do
  echo "ℹ Port $PORT is already in use. Trying port $((PORT + 1))..."
  PORT=$((PORT + 1))
done
URL="http://127.0.0.1:$PORT"

# ---- 7. Background Health Poller & Desktop Application Launcher ----
# Launches in standalone Desktop Application mode (windowed, no browser tabs/URL bar)
# if Chromium-based browser exists, giving a true native desktop application experience.
launch_desktop_app() {
  if [ -d "/Applications/Google Chrome.app" ]; then
    echo "✔ Launching PRAVAHA in macOS Desktop Application Mode (Chrome Window)..."
    open -na "Google Chrome" --args --app="$URL"
  elif [ -d "/Applications/Brave Browser.app" ]; then
    echo "✔ Launching PRAVAHA in macOS Desktop Application Mode (Brave Window)..."
    open -na "Brave Browser" --args --app="$URL"
  elif [ -d "/Applications/Microsoft Edge.app" ]; then
    echo "✔ Launching PRAVAHA in macOS Desktop Application Mode (Edge Window)..."
    open -na "Microsoft Edge" --args --app="$URL"
  elif [ -d "$HOME/Applications/Google Chrome.app" ]; then
    echo "✔ Launching PRAVAHA in macOS Desktop Application Mode (User Chrome Window)..."
    open -na "$HOME/Applications/Google Chrome.app" --args --app="$URL"
  else
    echo "✔ Opening PRAVAHA in default browser..."
    open "$URL"
  fi
}

(
  for i in {1..30}; do
    if curl -s -f "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      echo "✔ PRAVAHA server is online and operational!"
      launch_desktop_app
      exit 0
    fi
    sleep 0.5
  done
  launch_desktop_app
) &

echo ""
echo "🚀 PRAVAHA Desktop Application starting on $URL"
echo "   PID: $$ | Press Ctrl+C in this Terminal to shutdown the server."
echo ""

# ---- 8. Launch Uvicorn Server ----
PYTHONPATH="$PROJECT_DIR" exec "$VENV_PY" -m uvicorn backend.main:app --host 127.0.0.1 --port "$PORT"
