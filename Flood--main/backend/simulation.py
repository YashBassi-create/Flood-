"""
PRAVAHA — Hydrological Simulation Engine
Simulates catchment rainfall runoff, glacier melt (solar + rain-on-ice GLOF),
dam rule-curve releases, Manning's equation channel hydraulics, inundation extent,
population impact, 24h hydrograph timeline, and auto-generated flood advisories.
"""

import math
import time
from typing import Dict, Any, List
from backend.regions import REGIONS_BY_ID
from backend.dam_service import get_dam_telemetry


def run_hydrological_simulation(
    region_id: str,
    readings: Dict[str, Any],
    predicted_risk: str,
    risk_probabilities: Dict[str, float]
) -> Dict[str, Any]:
    """
    Executes a high-fidelity physical simulation for a catchment node.
    """
    region = REGIONS_BY_ID.get(region_id)
    if not region:
        raise ValueError(f"Unknown region: {region_id}")

    area_km2 = region["catchment_area_km2"]
    slope_deg = region["slope_deg"]
    slope_rad = math.radians(slope_deg)
    slope_gradient = math.tan(slope_rad)
    forest_pct = region["forest_cover_pct"]
    soil_sat = readings.get("soil_moisture", 60.0)
    rain_1h = readings.get("rain_1h", 10.0)
    rain_6h = readings.get("rain_6h", 30.0)
    rain_24h = readings.get("rain_24h", 70.0)
    river_stage = readings.get("river_level", 3.0)
    bankfull_q = region["bankfull_discharge_m3s"]

    # ---- 1. Rainfall Runoff Inflow (Rational / SCS Hydrology) ----
    # Runoff coefficient C increases with soil saturation and slope, reduced by forest canopy
    c_base = 0.15 + 0.65 * ((soil_sat / 100.0) ** 1.8)
    c_slope = min(0.20, slope_gradient * 0.25)
    c_forest = -0.22 * (forest_pct / 100.0)
    c_runoff = max(0.12, min(0.94, c_base + c_slope + c_forest))

    # Rainfall intensity (effective peak mm/h considering cloudburst surge)
    intensity_mm_hr = rain_1h + 0.25 * (rain_6h / 6.0)
    # Q = (C * I * A) / 3.6  in m³/s
    q_runoff = round((c_runoff * intensity_mm_hr * area_km2) / 3.6 * 0.25, 1)

    # ---- 2. Baseflow ----
    q_base = round(bankfull_q * 0.12, 1)

    # ---- 3. Glacier Melt (Solar + Rain-on-Ice GLOF Amplification) ----
    q_glacier = 0.0
    glof_risk_status = "Inactive"
    if region.get("glacier_fed", False):
        # Diurnal solar cycle peak (12:00 - 17:00)
        curr_hour = time.localtime().tm_hour
        solar_factor = max(0.1, math.sin(math.radians(max(0, (curr_hour - 7) * 15))))
        base_melt = (area_km2 * 0.08) * solar_factor

        # Rain-on-ice thermodynamic amplification: warm rainwater accelerates ice melt
        # If cloudburst (>30 mm/h) occurs above 2500m elevation, trigger GLOF surge
        if rain_1h > 25.0 and region["mean_elevation_m"] > 2200.0:
            rain_on_ice_mult = 1.0 + (rain_1h / 20.0) * 1.6
            q_glacier = round(base_melt * rain_on_ice_mult, 1)
            glof_risk_status = "Active GLOF Alert — Rain-on-Ice Surge"
        else:
            q_glacier = round(base_melt, 1)

    # ---- 4. Dam Rule-Curve Release Spillway Simulation ----
    dam_telemetry = get_dam_telemetry(region_id, rain_24h=rain_24h)
    if dam_telemetry.get("has_dam"):
        dam_data = dam_telemetry["dam_info"]
        q_dam = dam_data["spillway_release_m3s"]
        dam_status = dam_data["status_message"]
    else:
        q_dam = 0.0
        dam_status = "No Dam Upstream (Natural Alpine Channel)"
        dam_data = None

    # ---- 5. Total Inflow & Discharge ----
    q_total = round(q_base + q_runoff + q_glacier + q_dam, 1)
    discharge_ratio = round(q_total / max(bankfull_q, 1.0), 2)

    # ---- 6. Channel Hydraulics (Manning's Equation) ----
    # Manning's roughness coefficient n (mountain boulder bed ~0.045, alluvial ~0.030)
    manning_n = 0.045 if slope_deg > 20.0 else 0.032
    # Approximate trapezoidal channel width B
    b_width = max(15.0, math.sqrt(bankfull_q) * 2.8)
    side_slope = 1.5  # 1.5H:1V

    # Iterative hydraulic stage depth y: Q = (1/n) * A * R^(2/3) * S^(1/2)
    # Target discharge is q_total
    s_bed = max(0.0004, slope_gradient * 0.06)
    y_guess = max(0.5, river_stage)
    # Newton approximation for stage depth y
    for _ in range(5):
        area_w = (b_width + side_slope * y_guess) * y_guess
        p_perim = b_width + 2.0 * y_guess * math.sqrt(1.0 + side_slope ** 2)
        r_hyd = area_w / p_perim
        q_calc = (1.0 / manning_n) * area_w * (r_hyd ** (2.0 / 3.0)) * math.sqrt(s_bed)
        diff = q_calc - q_total
        if abs(diff) < 5.0:
            break
        y_guess = max(0.4, y_guess - diff / (max(q_calc, 1.0) * 1.2))

    water_depth_m = round(y_guess, 2)
    water_area_m2 = round((b_width + side_slope * water_depth_m) * water_depth_m, 1)
    velocity_mps = round(min(12.0, max(0.4, q_total / max(water_area_m2, 1.0))), 2)

    # Inundation Extent
    inundation_km2 = 0.0
    if discharge_ratio > 1.0:
        overtop_factor = discharge_ratio - 1.0
        inundation_km2 = round(overtop_factor * (area_km2 * 0.015) + (overtop_factor ** 1.3) * 4.2, 2)

    # ---- 7. Population & Vulnerability Impact ----
    pop_risk = region["population_at_risk"]
    villages_total = region["vulnerable_villages"]

    if discharge_ratio >= 1.35 or predicted_risk == "Severe":
        evac_status = "CRITICAL: Immediate Evacuation Mandatory"
        villages_at_risk = int(villages_total * 0.85)
        affected_people = int(pop_risk * 0.72)
        relief_camps = max(4, int(affected_people / 1200))
        ndrf_action = "Deploy 3 NDRF Battalions with inflatable boats, establish helipad airlifts"
    elif discharge_ratio >= 1.05 or predicted_risk == "High":
        evac_status = "HIGH ALERT: Pre-emptive Lowland Evacuation Advised"
        villages_at_risk = int(villages_total * 0.55)
        affected_people = int(pop_risk * 0.38)
        relief_camps = max(2, int(affected_people / 1500))
        ndrf_action = "Stage 1 NDRF Company on standby, sound riverbank siren sirens"
    elif discharge_ratio >= 0.85 or predicted_risk == "Moderate":
        evac_status = "WATCH: High River Discharge Standby"
        villages_at_risk = int(villages_total * 0.20)
        affected_people = int(pop_risk * 0.10)
        relief_camps = 1
        ndrf_action = "Local administration monitoring; restrict ghat access and bridge crossings"
    else:
        evac_status = "NORMAL: Baseflow River Conditions"
        villages_at_risk = 0
        affected_people = 0
        relief_camps = 0
        ndrf_action = "Routine hydrometric logging; standard vigilance"

    # ---- 8. 24-Hour Hydrograph Timeline (12h Hindcast + 12h Forecast) ----
    timeline = []
    curr_t = time.time()
    for h in range(-12, 13):
        t_stamp = curr_t + h * 3600
        # Diurnal pulse + storm curve
        storm_phase = math.exp(-((h - 2) ** 2) / 18.0)
        hist_decay = math.exp(-((h + 4) ** 2) / 25.0)

        if h < 0:
            # Hindcast: approaching the current state
            q_step = q_base + (q_total - q_base) * (0.35 + 0.65 * hist_decay)
        elif h == 0:
            q_step = q_total
        else:
            # Forecast: peak storm surge peaking in +2 to +4 hours, then receding
            q_step = q_base + (q_total - q_base) * (0.75 * storm_phase + 0.25 * math.exp(-h / 8.0))

        # Add noise
        noise_var = math.sin(h * 1.5) * (q_total * 0.03)
        timeline.append({
            "hour_offset": h,
            "timestamp": t_stamp,
            "discharge_m3s": round(max(q_base * 0.5, q_step + noise_var), 1),
            "bankfull_threshold": bankfull_q,
            "warning_threshold": round(bankfull_q * 0.85, 1),
            "type": "hindcast" if h < 0 else ("current" if h == 0 else "forecast"),
        })

    # Dominant flood driver calculation
    drivers = [
        ("Cloudburst Rainfall", q_runoff),
        ("Glacial Snowmelt / GLOF", q_glacier),
        ("Dam Surcharge Release", q_dam),
        ("High Baseflow Saturation", q_base),
    ]
    drivers.sort(key=lambda x: x[1], reverse=True)
    dominant_driver = drivers[0][0]

    # ---- 9. Auto-Generated District Administration Flood Report ----
    report_text = f"""================================================================================
PRAVAHA — FLASH FLOOD EARLY WARNING ADVISORY
National Disaster Management Authority (NDMA) / State Disaster Management
Station: {region['name']} ({region['state']})
River Basin: {region['river_basin']} — {region['river_name']}
Issued: {time.strftime('%d %b %Y, %H:%M:%S IST')}
================================================================================

1. HYDROLOGICAL THREAT ASSESSMENT:
   • Predicted Flash Flood Risk: {predicted_risk.upper()} (Model Confidence: {risk_probabilities.get(predicted_risk, 0.9):.1%})
   • Modeled Peak Discharge:     {q_total:,.1f} m³/s  (Bankfull Capacity: {bankfull_q:,.1f} m³/s)
   • Capacity Exceedance:        {discharge_ratio * 100:.1f}% of Bankfull
   • Dominant Flood Driver:      {dominant_driver}
   • Inundation Extent:          {inundation_km2:.2f} km² estimated riverbank submersion
   • Channel Hydraulics:         Stage Depth: {water_depth_m} m | Flow Velocity: {velocity_mps} m/s

2. INFLOW COMPOSITION BREAKDOWN:
   • Catchment Surface Runoff:   {q_runoff:,.1f} m³/s ({q_runoff/max(q_total,1)*100:.1f}%)
   • Upstream Dam Release:       {q_dam:,.1f} m³/s ({q_dam/max(q_total,1)*100:.1f}%) [{dam_status}]
   • Glacier / Snowmelt:         {q_glacier:,.1f} m³/s ({q_glacier/max(q_total,1)*100:.1f}%) [{glof_risk_status}]
   • Baseflow Contribution:      {q_base:,.1f} m³/s ({q_base/max(q_total,1)*100:.1f}%)

3. VULNERABILITY & POPULATION IMPACT:
   • Evacuation Status:          {evac_status}
   • Estimated Population at Risk:{affected_people:,} individuals
   • Vulnerable Villages/Wards:  {villages_at_risk} of {villages_total} settlements
   • Designated Relief Camps:    {relief_camps} emergency shelters required

4. DIRECTIVES FOR DISTRICT MAGISTRATE & DISASTER FORCES:
   • {ndrf_action}
   • Immediate suspension of all river rafting, mining, and riverside pilgrimage activities.
   • Alert downstream district emergency operation centres (DEOCs) along the {region['river_name']}.
   • Maintain 15-minute wireless reporting intervals between hydrological telemetry nodes.

Official Disclaimer: PRAVAHA hydro-meteorological model inference synthesized for Smart India Hackathon.
"""

    return {
        "region_id": region_id,
        "region_name": region["name"],
        "state": region["state"],
        "river_basin": region["river_basin"],
        "river_name": region["river_name"],
        "predicted_risk": predicted_risk,
        "risk_probabilities": risk_probabilities,
        "dominant_driver": dominant_driver,
        "hydrology": {
            "total_discharge_m3s": q_total,
            "bankfull_discharge_m3s": bankfull_q,
            "discharge_ratio": discharge_ratio,
            "surface_runoff_m3s": q_runoff,
            "glacier_melt_m3s": q_glacier,
            "dam_release_m3s": q_dam,
            "baseflow_m3s": q_base,
            "runoff_coefficient": round(c_runoff, 2),
            "water_depth_m": water_depth_m,
            "velocity_mps": velocity_mps,
            "inundation_km2": inundation_km2,
            "dam_status": dam_status,
            "dam_open_gates": dam_data["open_spillway_gates"] if dam_data else 0,
            "dam_total_gates": dam_data["total_spillway_gates"] if dam_data else 0,
            "dam_storage_pct": dam_data["current_storage_pct"] if dam_data else 0.0,
            "glof_status": glof_risk_status,
        },
        "dam": dam_telemetry,
        "impact": {
            "evacuation_status": evac_status,
            "population_affected": affected_people,
            "villages_at_risk": villages_at_risk,
            "total_villages": villages_total,
            "relief_camps_needed": relief_camps,
            "ndrf_directive": ndrf_action,
        },
        "timeline_24h": timeline,
        "flood_report": report_text,
    }
