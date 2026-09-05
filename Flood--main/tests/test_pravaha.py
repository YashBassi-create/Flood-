"""
PRAVAHA Test Suite
Verifies feature specs, regional monitoring nodes, telemetry fusion,
simulation hydraulics, model inference, and launcher scripts.
"""

import os
import sys
import unittest
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from model.features import FEATURE_NAMES, RISK_CLASSES, RISK_COLORS, FEATURE_SPECS
from backend.regions import REGIONS, REGIONS_BY_ID
from backend.data_sources import get_live_readings, get_region_readings, simulate_regional_telemetry
from backend.simulation import run_hydrological_simulation


class TestPravahaSystem(unittest.TestCase):

    def test_feature_specifications(self):
        """Verify the 10 features and 4 risk classes."""
        self.assertEqual(len(FEATURE_NAMES), 10)
        self.assertIn("rain_1h", FEATURE_NAMES)
        self.assertIn("rain_72h", FEATURE_NAMES)
        self.assertIn("soil_moisture", FEATURE_NAMES)
        self.assertIn("river_level", FEATURE_NAMES)

        self.assertEqual(len(RISK_CLASSES), 4)
        self.assertEqual(RISK_CLASSES, ["Low", "Moderate", "High", "Severe"])

        for cls in RISK_CLASSES:
            self.assertIn(cls, RISK_COLORS)

        self.assertEqual(len(FEATURE_SPECS), 10)
        for fname in FEATURE_NAMES:
            self.assertIn(fname, FEATURE_SPECS)
            spec = FEATURE_SPECS[fname]
            self.assertIn("min", spec)
            self.assertIn("max", spec)
            self.assertIn("unit", spec)
            self.assertLess(spec["min"], spec["max"])

    def test_regional_monitoring_nodes(self):
        """Verify 49+ river-basin monitoring nodes across India."""
        self.assertGreaterEqual(len(REGIONS), 49, f"Expected at least 49 nodes, got {len(REGIONS)}")

        # Verify key states are represented
        states = {r["state"] for r in REGIONS}
        expected_states = {
            "Uttarakhand", "Himachal Pradesh", "Jammu & Kashmir", "Ladakh",
            "Punjab", "Haryana", "Chandigarh", "Delhi", "Uttar Pradesh", "Rajasthan"
        }
        for s in expected_states:
            self.assertIn(s, states, f"State {s} missing from monitored nodes")

        # Check node data integrity
        for r in REGIONS:
            self.assertIn("id", r)
            self.assertIn("name", r)
            self.assertIn("river_basin", r)
            self.assertIn("lat", r)
            self.assertIn("lon", r)
            self.assertGreater(r["catchment_area_km2"], 0)
            self.assertGreater(r["slope_deg"], 0)
            self.assertGreater(r["bankfull_discharge_m3s"], 0)
            # Geographic bounds check for India
            self.assertGreaterEqual(r["lat"], 8.0)
            self.assertLessEqual(r["lat"], 37.0)
            self.assertGreaterEqual(r["lon"], 68.0)
            self.assertLessEqual(r["lon"], 98.0)

    def test_telemetry_generation(self):
        """Verify 4-minute bucketed multi-source telemetry."""
        readings = get_live_readings()
        self.assertEqual(len(readings), len(REGIONS))

        for item in readings:
            self.assertIn("region_id", item)
            self.assertIn("bucket_id", item)
            r_data = item["readings"]
            for fname in FEATURE_NAMES:
                self.assertIn(fname, r_data)
                self.assertGreaterEqual(r_data[fname], 0.0)

            derived = item["derived"]
            self.assertIn("current_discharge_m3s", derived)
            self.assertGreater(derived["current_discharge_m3s"], 0.0)

            prov = item["provenance"]
            self.assertIn("rain", prov)
            self.assertIn("soil_moisture", prov)
            self.assertIn("river_gauge", prov)

    def test_hydrological_simulation_engine(self):
        """Verify physical hydrology: Manning hydraulics, inundation, timeline, flood report."""
        test_region_id = "kedarnath-rudraprayag"
        telemetry = get_region_readings(test_region_id)
        readings = telemetry["readings"]

        sim = run_hydrological_simulation(
            region_id=test_region_id,
            readings=readings,
            predicted_risk="Severe",
            risk_probabilities={"Low": 0.01, "Moderate": 0.03, "High": 0.12, "Severe": 0.84}
        )

        self.assertEqual(sim["region_id"], test_region_id)
        self.assertEqual(sim["predicted_risk"], "Severe")

        hydro = sim["hydrology"]
        self.assertGreater(hydro["total_discharge_m3s"], 0.0)
        self.assertGreater(hydro["velocity_mps"], 0.0)
        self.assertGreater(hydro["water_depth_m"], 0.0)
        self.assertGreaterEqual(hydro["inundation_km2"], 0.0)

        # 24-hour timeline check
        timeline = sim["timeline_24h"]
        self.assertEqual(len(timeline), 25, "Expected 25 hourly steps (-12h to +12h)")
        self.assertEqual(timeline[0]["hour_offset"], -12)
        self.assertEqual(timeline[12]["hour_offset"], 0)
        self.assertEqual(timeline[24]["hour_offset"], 12)

        # Impact check
        impact = sim["impact"]
        self.assertIn("Immediate Evacuation", impact["evacuation_status"])
        self.assertGreater(impact["population_affected"], 0)

        # Flood report check
        report = sim["flood_report"]
        self.assertIn("PRAVAHA — FLASH FLOOD EARLY WARNING ADVISORY", report)
        self.assertIn("Kedarnath / Rudraprayag", report)

    def test_launch_scripts(self):
        """Verify launcher files exist, have proper permissions, and correct configurations."""
        mac_cmd = PROJECT_ROOT / "run_mac.command"
        start_cmd = PROJECT_ROOT / "Start App.command"
        mac_sh = PROJECT_ROOT / "run_mac.sh"
        run_sh = PROJECT_ROOT / "run.sh"
        run_bat = PROJECT_ROOT / "run.bat"

        self.assertTrue(mac_cmd.exists(), "run_mac.command must exist")
        self.assertTrue(start_cmd.exists(), "Start App.command must exist")
        self.assertTrue(mac_sh.exists(), "run_mac.sh must exist")
        self.assertTrue(run_sh.exists(), "run.sh must exist")
        self.assertTrue(run_bat.exists(), "run.bat must exist")

        # Check executable permissions on POSIX scripts
        self.assertTrue(os.access(mac_cmd, os.X_OK), "run_mac.command must be executable (chmod +x)")
        self.assertTrue(os.access(start_cmd, os.X_OK), "Start App.command must be executable (chmod +x)")
        self.assertTrue(os.access(mac_sh, os.X_OK), "run_mac.sh must be executable (chmod +x)")
        self.assertTrue(os.access(run_sh, os.X_OK), "run.sh must be executable (chmod +x)")

        # Verify run_mac.command content
        content = mac_cmd.read_text(encoding="utf-8")
        self.assertIn("SEARCH_PATHS", content)
        self.assertIn("uvicorn backend.main:app", content)
        self.assertIn("api/health", content)


if __name__ == "__main__":
    unittest.main()
