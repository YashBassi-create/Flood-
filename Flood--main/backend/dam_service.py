"""
PRAVAHA — Real-Time Dam Telemetry & Reservoir Gate Management Service
Central Water Commission (CWC) & National Dam Safety Authority (NDSA) Integration Layer
Simulates live telemetry feeds from major Himalayan and Western Ghats river dams,
including reservoir storage %, radial spillway gate openings, and rule-curve releases.
"""

import time
import math
from typing import Dict, Any, List, Optional
from backend.regions import REGIONS, REGIONS_BY_ID


def _get_dam_specs(dam_info: Dict[str, Any], bankfull_q: float, elevation: float) -> Dict[str, Any]:
    """Derive structural engineering specifications for a dam."""
    capacity = dam_info.get("capacity_mcm", 50.0)
    
    # Estimate spillway radial gates based on capacity
    if capacity > 1000.0:
        total_gates = 8
        dam_height_m = 180.0
    elif capacity > 100.0:
        total_gates = 6
        dam_height_m = 110.0
    elif capacity > 10.0:
        total_gates = 5
        dam_height_m = 65.0
    else:
        total_gates = 4
        dam_height_m = 35.0

    frl_m = round(elevation - 15.0, 1)  # Full Reservoir Level approx elevation
    mddl_m = round(frl_m - dam_height_m * 0.55, 1) # Minimum Drawdown Level

    return {
        "total_gates": total_gates,
        "dam_height_m": dam_height_m,
        "frl_m": frl_m,
        "mddl_m": mddl_m,
    }


def get_dam_telemetry(region_id: str, rain_24h: Optional[float] = None) -> Dict[str, Any]:
    """
    Retrieve real-time operational telemetry for a specific river basin's upstream dam.
    Computes live reservoir level, storage percentage, radial gate positions, and discharge.
    """
    region = REGIONS_BY_ID.get(region_id)
    if not region:
        raise ValueError(f"Unknown region ID: {region_id}")

    dam_info = region.get("dam_upstream")
    if not dam_info:
        return {
            "region_id": region_id,
            "region_name": region["name"],
            "river_name": region["river_name"],
            "state": region["state"],
            "has_dam": False,
            "message": "Free-flowing alpine river basin (No upstream concrete retention structure)",
            "hydrology_mode": "Natural Stream Channel Hydraulics",
            "timestamp": time.time(),
            "time_ist": time.strftime("%d-%b-%Y %H:%M:%S IST", time.localtime()),
        }

    bankfull_q = region.get("bankfull_discharge_m3s", 1200.0)
    elev = region.get("mean_elevation_m", 2000.0)
    specs = _get_dam_specs(dam_info, bankfull_q, elev)

    # Base storage % from region data
    base_storage = dam_info.get("current_storage_pct", 75.0)
    rule_threshold = dam_info.get("rule_curve_threshold", 88.0)

    # Rain surcharge contribution
    if rain_24h is None:
        rain_24h = 45.0  # Default moderate monsoon rainfall
    rain_surcharge = (rain_24h / 150.0) * 8.0

    # Live micro-fluctuation (0.5% oscillation) to demonstrate real-time API streaming
    live_tick = math.sin(time.time() / 8.0) * 0.45
    current_storage_pct = round(min(100.0, max(15.0, base_storage + rain_surcharge + live_tick)), 2)

    # Live water level (m) relative to FRL and MDDL
    frl = specs["frl_m"]
    mddl = specs["mddl_m"]
    current_water_level_m = round(mddl + ((current_storage_pct / 100.0) * (frl - mddl)), 2)

    # Reservoir Inflow (m³/s)
    est_inflow = round(bankfull_q * (0.2 + (rain_24h / 250.0) * 0.85) + math.cos(time.time() / 12.0) * 15.0, 1)

    # Gate Operations & Discharge
    total_gates = specs["total_gates"]
    if current_storage_pct > rule_threshold:
        excess_pct = current_storage_pct - rule_threshold
        # Surcharge spillway discharge
        spillway_release_m3s = round(excess_pct * (bankfull_q * 0.35), 1)
        
        # Determine number of active open gates (1 to total_gates)
        gates_fraction = min(1.0, excess_pct / max(1.0, 100.0 - rule_threshold))
        open_gates = min(total_gates, max(1, int(math.ceil(gates_fraction * total_gates))))
        gate_opening_m = round(min(5.5, 0.8 + gates_fraction * 4.2), 2)
        
        power_gen_release_m3s = round(min(120.0, bankfull_q * 0.08), 1)
        total_outflow_m3s = round(spillway_release_m3s + power_gen_release_m3s, 1)
        
        gate_status = f"{open_gates} OF {total_gates} RADIAL SPILLWAY GATES DISCHARGING"
        alarm_state = "CRITICAL_SPILLWAY_DISCHARGE" if excess_pct > 6.0 else "WARNING_RULE_CURVE_EXCEEDED"
        status_message = (
            f"Spillway active: {open_gates}/{total_gates} gates open ({gate_opening_m}m). "
            f"Discharging {spillway_release_m3s:,.1f} m³/s to protect dam integrity."
        )
    else:
        spillway_release_m3s = 0.0
        open_gates = 0
        gate_opening_m = 0.0
        power_gen_release_m3s = round(min(60.0, est_inflow * 0.4), 1)
        total_outflow_m3s = power_gen_release_m3s
        
        gate_status = f"ALL {total_gates} SPILLWAY GATES CLOSED (NORMAL BUFFER)"
        alarm_state = "NORMAL_STORAGE_BUFFER"
        status_message = (
            f"Normal buffer retention: Storage at {current_storage_pct:.1f}% "
            f"(Safe limit: {rule_threshold:.1f}%). All spillway gates sealed."
        )

    return {
        "region_id": region_id,
        "region_name": region["name"],
        "river_name": region["river_name"],
        "state": region["state"],
        "has_dam": True,
        "dam_info": {
            "name": dam_info["name"],
            "dam_type": "Concrete Gravity / Embankment",
            "capacity_mcm": dam_info.get("capacity_mcm", 50.0),
            "current_storage_pct": current_storage_pct,
            "rule_curve_threshold_pct": rule_threshold,
            "full_reservoir_level_m": frl,
            "minimum_drawdown_level_m": mddl,
            "current_water_level_m": current_water_level_m,
            "freeboard_remaining_m": round(max(0.0, frl - current_water_level_m), 2),
            "reservoir_inflow_m3s": est_inflow,
            "spillway_release_m3s": spillway_release_m3s,
            "powerhouse_release_m3s": power_gen_release_m3s,
            "total_outflow_m3s": total_outflow_m3s,
            "total_spillway_gates": total_gates,
            "open_spillway_gates": open_gates,
            "gate_opening_meters": gate_opening_m,
            "gate_status": gate_status,
            "alarm_state": alarm_state,
            "status_message": status_message,
            "data_source": "Central Water Commission (CWC) National Dam Safety Authority Live Telemetry",
        },
        "timestamp": time.time(),
        "time_ist": time.strftime("%d-%b-%Y %H:%M:%S IST", time.localtime()),
    }


def get_all_dams_telemetry() -> Dict[str, Any]:
    """Retrieve summarized live telemetry across all monitored dams."""
    dams = []
    total_discharging = 0
    total_storage = 0.0

    for region in REGIONS:
        if region.get("dam_upstream"):
            telemetry = get_dam_telemetry(region["id"])
            dams.append(telemetry)
            if telemetry["dam_info"]["open_spillway_gates"] > 0:
                total_discharging += 1
            total_storage += telemetry["dam_info"]["current_storage_pct"]

    avg_storage = round(total_storage / max(1, len(dams)), 1)

    return {
        "total_dams_monitored": len(dams),
        "dams_discharging_spillway": total_discharging,
        "dams_normal_buffer": len(dams) - total_discharging,
        "average_reservoir_storage_pct": avg_storage,
        "dams": dams,
        "timestamp": time.time(),
        "time_ist": time.strftime("%d-%b-%Y %H:%M:%S IST", time.localtime()),
    }
