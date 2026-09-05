"""
PRAVAHA — FastAPI Backend Server & ML Inference Engine
Disaster Management Theme · Smart India Hackathon 2026
"""

import os
import sys
import time
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from model.features import FEATURE_NAMES, RISK_CLASSES, RISK_COLORS, FEATURE_SPECS
from backend.regions import REGIONS, REGIONS_BY_ID
from backend.data_sources import get_live_readings, get_region_readings
from backend.simulation import run_hydrological_simulation
from backend.dam_service import get_dam_telemetry, get_all_dams_telemetry

app = FastAPI(
    title="PRAVAHA — Flash Flood Prediction System",
    description="Multi-source data fusion and early warning system for hilly regions of India",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model state
MODEL = None
METRICS: Dict[str, Any] = {}


def load_model_if_needed():
    """Load or train PravahaNet-RF model."""
    global MODEL, METRICS
    artifacts_dir = PROJECT_ROOT / "model" / "artifacts"
    model_path = artifacts_dir / "model.joblib"
    metrics_path = artifacts_dir / "metrics.json"

    if not model_path.exists():
        print("⚡ PravahaNet-RF artifact not found. Initiating training...")
        from model.train import train_and_save_model
        train_and_save_model()

    try:
        MODEL = joblib.load(model_path)
        print(f"✔ Successfully loaded PravahaNet-RF from {model_path}")
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        MODEL = None

    if metrics_path.exists():
        try:
            with open(metrics_path, "r", encoding="utf-8") as f:
                METRICS = json.load(f)
        except Exception as e:
            print(f"⚠ Could not read metrics.json: {e}")
            METRICS = {}


@app.on_event("startup")
def on_startup():
    load_model_if_needed()


# Pydantic schema for What-If scenario prediction
class PredictionInput(BaseModel):
    rain_1h: float = Field(..., ge=0.0, le=250.0, description="1-hour rainfall in mm/h")
    rain_6h: float = Field(..., ge=0.0, le=500.0, description="6-hour rainfall in mm")
    rain_24h: float = Field(..., ge=0.0, le=1000.0, description="24-hour rainfall in mm")
    rain_72h: float = Field(..., ge=0.0, le=2000.0, description="72-hour rainfall in mm")
    soil_moisture: float = Field(..., ge=0.0, le=100.0, description="Soil saturation percentage")
    slope: float = Field(..., ge=0.0, le=70.0, description="Slope in degrees")
    elevation: float = Field(..., ge=0.0, le=6000.0, description="Elevation in meters")
    river_level: float = Field(..., ge=0.0, le=25.0, description="River gauge height in meters")
    drainage_density: float = Field(..., ge=0.1, le=10.0, description="Drainage density km/km2")
    forest_cover: float = Field(..., ge=0.0, le=100.0, description="Forest cover percentage")


def _predict_single(features: List[float]) -> tuple[str, Dict[str, float]]:
    """Helper for model inference."""
    global MODEL
    if MODEL is None:
        load_model_if_needed()
    if MODEL is None:
        return "Moderate", {c: 0.25 for c in RISK_CLASSES}

    x_arr = np.array([features], dtype=np.float32)
    pred_idx = int(MODEL.predict(x_arr)[0])
    pred_label = RISK_CLASSES[pred_idx]

    try:
        proba = MODEL.predict_proba(x_arr)[0]
        prob_dict = {
            RISK_CLASSES[i]: round(float(proba[i]), 3)
            for i in range(len(RISK_CLASSES))
        }
    except Exception:
        prob_dict = {c: (1.0 if c == pred_label else 0.0) for c in RISK_CLASSES}

    return pred_label, prob_dict


# ---- API Endpoints ----

@app.api_route("/api/health", methods=["GET", "HEAD"])
def get_health():
    """Liveness probe and model readiness status."""
    return {
        "status": "online",
        "app": "PRAVAHA Flash Flood Prediction System",
        "model_loaded": MODEL is not None,
        "nodes_monitored": len(REGIONS),
        "timestamp": time.time(),
        "time_ist": time.strftime("%d-%b-%Y %H:%M:%S IST"),
    }


@app.get("/api/regions")
def get_all_regions():
    """
    Returns all 49 river-basin monitoring nodes with live fused telemetry,
    model risk predictions, discharge ratios, and status.
    """
    telemetry_list = get_live_readings()
    results = []

    for item in telemetry_list:
        rid = item["region_id"]
        region = REGIONS_BY_ID[rid]
        readings = item["readings"]

        # Vector of 10 features
        feature_vec = [readings[name] for name in FEATURE_NAMES]
        pred_label, prob_dict = _predict_single(feature_vec)

        results.append({
            "id": rid,
            "name": region["name"],
            "state": region["state"],
            "river_basin": region["river_basin"],
            "river_name": region["river_name"],
            "lat": region["lat"],
            "lon": region["lon"],
            "catchment_area_km2": region["catchment_area_km2"],
            "slope_deg": region["slope_deg"],
            "mean_elevation_m": region["mean_elevation_m"],
            "glacier_fed": region["glacier_fed"],
            "dam_upstream": region["dam_upstream"],
            "readings": readings,
            "derived": item["derived"],
            "predicted_risk": pred_label,
            "risk_color": RISK_COLORS[pred_label],
            "risk_confidence": prob_dict[pred_label],
            "risk_probabilities": prob_dict,
            "provenance": item["provenance"],
        })

    # Summary statistics
    severe_count = sum(1 for r in results if r["predicted_risk"] == "Severe")
    high_count = sum(1 for r in results if r["predicted_risk"] == "High")
    mod_count = sum(1 for r in results if r["predicted_risk"] == "Moderate")
    low_count = sum(1 for r in results if r["predicted_risk"] == "Low")

    return {
        "regions": results,
        "summary": {
            "total_nodes": len(results),
            "severe": severe_count,
            "high": high_count,
            "moderate": mod_count,
            "low": low_count,
            "active_alerts": severe_count + high_count,
        },
        "monsoon_stage": "Active South-West Monsoon Season",
        "updated_at": time.time(),
    }


@app.get("/api/simulation/{region_id}")
def get_simulation(region_id: str):
    """
    Returns full physical hydrological simulation for the specified region.
    """
    if region_id not in REGIONS_BY_ID:
        raise HTTPException(status_code=404, detail=f"Region {region_id} not found")

    telemetry = get_region_readings(region_id)
    readings = telemetry["readings"]
    feature_vec = [readings[name] for name in FEATURE_NAMES]
    pred_label, prob_dict = _predict_single(feature_vec)

    sim_data = run_hydrological_simulation(
        region_id=region_id,
        readings=readings,
        predicted_risk=pred_label,
        risk_probabilities=prob_dict,
    )

    # Attach raw readings & provenance
    sim_data["readings"] = readings
    sim_data["provenance"] = telemetry["provenance"]

    return sim_data


@app.get("/api/dam/{region_id}")
def get_dam(region_id: str):
    """
    Returns real-time CWC / NDSA operational dam telemetry for the specified region,
    including reservoir level, current storage %, radial spillway gate openings, and discharge.
    """
    if region_id not in REGIONS_BY_ID:
        raise HTTPException(status_code=404, detail=f"Region {region_id} not found")

    telemetry = get_region_readings(region_id)
    rain_24h = telemetry["readings"].get("rain_24h", 45.0)
    return get_dam_telemetry(region_id, rain_24h=rain_24h)


@app.get("/api/dams")
def get_dams():
    """
    Returns live operational status across all monitored reservoir dams.
    """
    return get_all_dams_telemetry()


@app.post("/api/predict")
def predict_scenario(payload: PredictionInput):
    """
    Predict flash flood risk for custom What-If feature parameters.
    """
    data = payload.model_dump()
    feature_vec = [data[name] for name in FEATURE_NAMES]
    pred_label, prob_dict = _predict_single(feature_vec)

    return {
        "predicted_risk": pred_label,
        "risk_color": RISK_COLORS[pred_label],
        "risk_confidence": prob_dict[pred_label],
        "risk_probabilities": prob_dict,
        "inputs": data,
    }


@app.get("/api/metrics")
def get_metrics():
    """
    Returns PravahaNet-RF model performance metrics, accuracy,
    confusion matrix, and feature importances.
    """
    global METRICS
    if not METRICS:
        load_model_if_needed()
    return METRICS


@app.get("/api/model/info")
def get_model_info():
    """
    Returns feature specs, slider bounds, class names, and descriptions.
    """
    return {
        "features": FEATURE_SPECS,
        "classes": RISK_CLASSES,
        "colors": RISK_COLORS,
    }


# ---- Static Frontend Mounting ----
frontend_dir = PROJECT_ROOT / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

    @app.api_route("/", methods=["GET", "HEAD"])
    def serve_index():
        return FileResponse(frontend_dir / "index.html")
