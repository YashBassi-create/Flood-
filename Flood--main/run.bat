@echo off
REM ============================================================
REM  PRAVAHA - Flash Flood Prediction System (one-click launcher)
REM  Windows - just double-click run.bat
REM ============================================================
cd /d "%~dp0"
echo ======================================================
echo    PRAVAHA - Flash Flood Prediction System
echo    Hilly Regions of India - SIH 2026
echo ======================================================

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10+ not found. Install from https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist .venv (
  echo Creating virtual environment (first run only)...
  python -m venv .venv
)

if not exist .venv\.deps_ok (
  echo Installing dependencies (first run only)...
  .venv\Scripts\python.exe -m pip install --upgrade pip -q
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt
  echo ok > .venv\.deps_ok
)
echo Dependencies ready

if not exist model\artifacts\model.joblib (
  echo Training PravahaNet-RF model (first run only)...
  .venv\Scripts\python.exe -m model.train
)
echo Model ready

start "" "http://127.0.0.1:8000"
echo.
echo Dashboard starting at http://127.0.0.1:8000
echo Close this window to stop.
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
