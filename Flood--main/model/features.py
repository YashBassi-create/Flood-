"""
PRAVAHA — Feature Specification
Single source of truth for the 10 hydrological & geospatial features
and 4 flood risk severity classes.
"""

from typing import Dict, List, Any

# The 10 core features used by PravahaNet-RF
FEATURE_NAMES: List[str] = [
    "rain_1h",           # 1-hour rainfall rate (mm/h)
    "rain_6h",           # 6-hour accumulated rainfall (mm)
    "rain_24h",          # 24-hour accumulated rainfall (mm)
    "rain_72h",          # 72-hour antecedent rainfall (mm)
    "soil_moisture",     # Volumetric soil saturation (0 - 100%)
    "slope",             # Basin average slope (degrees)
    "elevation",         # Mean catchment elevation (meters a.s.l.)
    "river_level",       # River gauge height above baseline (meters)
    "drainage_density",  # Stream length per catchment area (km/km²)
    "forest_cover",      # Forest canopy coverage percentage (0 - 100%)
]

# 4 Risk Classes
RISK_CLASSES: List[str] = [
    "Low",
    "Moderate",
    "High",
    "Severe",
]

RISK_COLORS: Dict[str, str] = {
    "Low": "#16a34a",       # Forest green
    "Moderate": "#d97706",  # Amber/Ochre
    "High": "#ea580c",      # Vivid Orange
    "Severe": "#dc2626",    # Crimson Red
}

RISK_DESCRIPTIONS: Dict[str, str] = {
    "Low": "Normal baseflow conditions. River levels within safe margins. Infiltration capacity intact.",
    "Moderate": "Elevated runoff. Catchment soils approaching saturation. River gauge near warning mark.",
    "High": "Flash flood warning. Critical discharge levels. Localized bank overtopping expected in low-lying areas.",
    "Severe": "Extreme flash flood emergency / GLOF event. Severe inundation, debris flows, immediate evacuation required.",
}

# UI Slider & Simulator Metadata
FEATURE_SPECS: Dict[str, Dict[str, Any]] = {
    "rain_1h": {
        "label": "1-Hour Rainfall",
        "unit": "mm/h",
        "min": 0.0,
        "max": 160.0,
        "step": 1.0,
        "default": 18.0,
        "description": "Short-duration cloudburst intensity. Over 100 mm/h represents an active cloudburst.",
    },
    "rain_6h": {
        "label": "6-Hour Rainfall",
        "unit": "mm",
        "min": 0.0,
        "max": 320.0,
        "step": 2.0,
        "default": 45.0,
        "description": "Short-term cumulative storm rainfall.",
    },
    "rain_24h": {
        "label": "24-Hour Rainfall",
        "unit": "mm",
        "min": 0.0,
        "max": 650.0,
        "step": 5.0,
        "default": 90.0,
        "description": "Daily monsoon precipitation total.",
    },
    "rain_72h": {
        "label": "72-Hour Antecedent Rain",
        "unit": "mm",
        "min": 0.0,
        "max": 1200.0,
        "step": 10.0,
        "default": 160.0,
        "description": "Three-day cumulative precipitation driving soil pre-saturation.",
    },
    "soil_moisture": {
        "label": "Soil Moisture Saturation",
        "unit": "%",
        "min": 0.0,
        "max": 100.0,
        "step": 1.0,
        "default": 65.0,
        "description": "Satellite-derived volumetric moisture. Above 80% severely limits infiltration.",
    },
    "slope": {
        "label": "Catchment Slope",
        "unit": "°",
        "min": 1.0,
        "max": 65.0,
        "step": 1.0,
        "default": 32.0,
        "description": "Average terrain gradient. Steep gradients accelerate hydrograph time to peak.",
    },
    "elevation": {
        "label": "Mean Elevation",
        "unit": "m",
        "min": 50.0,
        "max": 5200.0,
        "step": 50.0,
        "default": 1850.0,
        "description": "Catchment altitude. High altitudes (>2500m) feature glacial lakes and rain-on-ice snowmelt.",
    },
    "river_level": {
        "label": "River Level Above Baseline",
        "unit": "m",
        "min": 0.0,
        "max": 16.0,
        "step": 0.1,
        "default": 3.8,
        "description": "Current water stage relative to normal dry-season baseline.",
    },
    "drainage_density": {
        "label": "Drainage Density",
        "unit": "km/km²",
        "min": 0.5,
        "max": 5.5,
        "step": 0.1,
        "default": 2.8,
        "description": "Stream channel density. High density channels rapid runoff directly to master stream.",
    },
    "forest_cover": {
        "label": "Forest Canopy Cover",
        "unit": "%",
        "min": 0.0,
        "max": 100.0,
        "step": 1.0,
        "default": 52.0,
        "description": "Vegetation buffer. Canopy intercept and root systems retard surface runoff and prevent slope failure.",
    },
}
