"""
PRAVAHA — Backend API Functions Integration Test Suite
Tests all endpoints without external HTTP client dependencies.
"""

import sys
from pathlib import Path
import unittest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.main import (
    get_health,
    get_all_regions,
    get_simulation,
    predict_scenario,
    get_metrics,
    get_model_info,
    get_dam,
    get_dams,
    serve_index,
    PredictionInput,
    load_model_if_needed,
)
from fastapi import HTTPException


class TestAPIEndpoints(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        load_model_if_needed()

    def test_health_endpoint(self):
        data = get_health()
        self.assertEqual(data["status"], "online")
        self.assertTrue(data["model_loaded"])
        self.assertGreaterEqual(data["nodes_monitored"], 49)

    def test_regions_endpoint(self):
        data = get_all_regions()
        self.assertIn("regions", data)
        self.assertIn("summary", data)
        regions = data["regions"]
        self.assertGreaterEqual(len(regions), 49)

        sample = regions[0]
        self.assertIn("id", sample)
        self.assertIn("predicted_risk", sample)
        self.assertIn("risk_confidence", sample)
        self.assertIn("readings", sample)
        self.assertIn("derived", sample)

        summary = data["summary"]
        self.assertEqual(summary["total_nodes"], len(regions))
        self.assertGreaterEqual(summary["active_alerts"], 0)

    def test_simulation_endpoint(self):
        data = get_simulation("kedarnath-rudraprayag")
        self.assertEqual(data["region_id"], "kedarnath-rudraprayag")
        self.assertIn("hydrology", data)
        self.assertIn("impact", data)
        self.assertIn("timeline_24h", data)
        self.assertIn("flood_report", data)
        self.assertIn("dominant_driver", data)

    def test_simulation_404(self):
        with self.assertRaises(HTTPException) as ctx:
            get_simulation("non-existent-region-id")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_predict_endpoint(self):
        payload = PredictionInput(
            rain_1h=85.0,
            rain_6h=140.0,
            rain_24h=240.0,
            rain_72h=380.0,
            soil_moisture=88.0,
            slope=38.0,
            elevation=3200.0,
            river_level=6.8,
            drainage_density=3.4,
            forest_cover=32.0,
        )
        data = predict_scenario(payload)
        self.assertIn(data["predicted_risk"], ["Low", "Moderate", "High", "Severe"])
        self.assertIn("risk_probabilities", data)
        self.assertIn("risk_confidence", data)
        self.assertGreaterEqual(data["risk_confidence"], 0.0)
        self.assertLessEqual(data["risk_confidence"], 1.0)

    def test_metrics_endpoint(self):
        data = get_metrics()
        self.assertIn("accuracy", data)
        self.assertIn("confusion_matrix", data)
        self.assertIn("feature_importances", data)
        self.assertEqual(len(data["confusion_matrix"]), 4)

    def test_model_info_endpoint(self):
        data = get_model_info()
        self.assertIn("features", data)
        self.assertIn("classes", data)
        self.assertEqual(len(data["features"]), 10)
        self.assertEqual(len(data["classes"]), 4)

    def test_static_index_serving(self):
        resp = serve_index()
        self.assertTrue(Path(resp.path).exists())
        self.assertTrue(str(resp.path).endswith("index.html"))

    def test_dam_endpoint(self):
        data = get_dam("mandi-beas")
        self.assertTrue(data["has_dam"])
        self.assertIn("dam_info", data)
        self.assertEqual(data["dam_info"]["name"], "Pandoh Dam")
        self.assertGreaterEqual(data["dam_info"]["total_spillway_gates"], 4)
        self.assertIn("spillway_release_m3s", data["dam_info"])

        data_no_dam = get_dam("kedarnath-rudraprayag")
        self.assertFalse(data_no_dam["has_dam"])

    def test_dams_list_endpoint(self):
        data = get_dams()
        self.assertIn("total_dams_monitored", data)
        self.assertGreaterEqual(data["total_dams_monitored"], 30)
        self.assertIn("dams", data)


if __name__ == "__main__":
    unittest.main()
