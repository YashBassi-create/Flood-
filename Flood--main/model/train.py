"""
PRAVAHA — Model Training Engine (PravahaNet-RF)
Generates 20,000 physically-informed hydrological samples, trains a 400-tree
Random Forest classifier, and evaluates performance metrics.
"""

import json
import os
import sys
from pathlib import Path
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score
from sklearn.model_selection import train_test_split
import joblib

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from model.features import FEATURE_NAMES, RISK_CLASSES


def generate_hydrological_dataset(n_samples: int = 20000, random_state: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate physically realistic training samples across Indian mountainous and riverine catchments.
    Features:
      0: rain_1h (0-150 mm/h)
      1: rain_6h (0-300 mm)
      2: rain_24h (0-600 mm)
      3: rain_72h (0-1000 mm)
      4: soil_moisture (10-100 %)
      5: slope (2-55 deg)
      6: elevation (150-4800 m)
      7: river_level (0.5-14.0 m)
      8: drainage_density (0.8-5.0 km/km²)
      9: forest_cover (5-90 %)
    """
    rng = np.random.default_rng(random_state)

    # 1. Rainfall distributions: mixture of low-intensity days and extreme cloudburst events
    is_extreme = rng.random(n_samples) < 0.22
    is_moderate = (rng.random(n_samples) < 0.35) & (~is_extreme)

    rain_1h = np.where(
        is_extreme,
        rng.uniform(50.0, 150.0, n_samples),
        np.where(is_moderate, rng.uniform(15.0, 50.0, n_samples), rng.exponential(scale=5.0, size=n_samples))
    )
    rain_1h = np.clip(rain_1h, 0.0, 155.0)

    # Correlated multi-hour rainfall
    rain_6h = np.clip(rain_1h * rng.uniform(1.3, 2.5, n_samples) + rng.exponential(scale=10.0, size=n_samples), 0.0, 310.0)
    rain_24h = np.clip(rain_6h * rng.uniform(1.4, 2.8, n_samples) + rng.exponential(scale=20.0, size=n_samples), 0.0, 620.0)
    rain_72h = np.clip(rain_24h * rng.uniform(1.2, 2.2, n_samples) + rng.exponential(scale=35.0, size=n_samples), 0.0, 1100.0)

    # Catchment terrain attributes
    soil_moisture = np.clip(
        np.where(is_extreme, rng.uniform(65.0, 98.0, n_samples), rng.uniform(15.0, 85.0, n_samples)),
        10.0,
        100.0
    )
    slope = rng.uniform(3.0, 55.0, n_samples)
    elevation = rng.uniform(150.0, 4800.0, n_samples)
    drainage_density = rng.uniform(0.8, 5.0, n_samples)
    forest_cover = rng.uniform(5.0, 90.0, n_samples)

    # River level loosely correlated with 24h/72h rainfall & soil moisture
    river_baseline = rng.uniform(1.0, 4.0, n_samples)
    river_rise = (rain_24h / 120.0) * (soil_moisture / 70.0) + (rain_1h / 40.0)
    river_level = np.clip(river_baseline + river_rise * rng.uniform(0.7, 1.2, n_samples), 0.5, 14.5)

    X = np.column_stack([
        rain_1h,
        rain_6h,
        rain_24h,
        rain_72h,
        soil_moisture,
        slope,
        elevation,
        river_level,
        drainage_density,
        forest_cover
    ])

    # ---- Physical Hydrology Composite Score Calculation ----
    # 1. Cloudburst shock dominance
    cloudburst_term = 0.50 * (rain_1h / 55.0) + 0.25 * (rain_6h / 130.0)

    # 2. Antecedent saturation non-linear penalty
    sat_factor = (soil_moisture / 100.0) ** 2.2

    # 3. Topographic and drainage acceleration
    topo_factor = (slope / 40.0) * (drainage_density / 3.0)

    # 4. Forest canopy buffering & root infiltration attenuation
    forest_mitigation = np.maximum(0.45, 1.0 - 0.40 * (forest_cover / 100.0))

    # 5. Rain-on-ice / high-altitude GLOF surge trigger
    glof_surge = np.where((elevation > 2400.0) & (rain_1h > 18.0), 0.22 * (rain_1h / 40.0), 0.0)

    # 6. Channel stage contribution
    river_factor = (river_level / 8.5)

    # Cumulative composite score + stochastic physical variation (measurement uncertainty)
    raw_score = (
        (cloudburst_term * (1.0 + 1.35 * sat_factor) * topo_factor * forest_mitigation)
        + 0.38 * river_factor
        + glof_surge
        + rng.normal(0.0, 0.07, n_samples)
    )

    # Discretize into 4 classes
    # 0: Low (< 0.30), 1: Moderate (0.30 - 0.65), 2: High (0.65 - 1.05), 3: Severe (>= 1.05)
    y = np.zeros(n_samples, dtype=int)
    y[(raw_score >= 0.30) & (raw_score < 0.65)] = 1
    y[(raw_score >= 0.65) & (raw_score < 1.05)] = 2
    y[raw_score >= 1.05] = 3

    return X, y


def train_and_save_model() -> dict:
    """Train PravahaNet-RF model, evaluate metrics, and persist artifacts."""
    artifacts_dir = PROJECT_ROOT / "model" / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    print("🌊 PRAVAHA — Synthesizing 20,000 physically-informed hydrological samples...")
    X, y = generate_hydrological_dataset(n_samples=20000, random_state=42)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    print(f"🌲 Training PravahaNet-RF (400 trees, balanced weights)...")
    clf = RandomForestClassifier(
        n_estimators=400,
        max_depth=16,
        min_samples_split=4,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    acc = float(accuracy_score(y_test, y_pred))
    macro_f1 = float(f1_score(y_test, y_pred, average="macro"))

    report_dict = classification_report(y_test, y_pred, target_names=RISK_CLASSES, output_dict=True)
    conf_matrix = confusion_matrix(y_test, y_pred).tolist()

    importances = {
        name: round(float(imp), 4)
        for name, imp in zip(FEATURE_NAMES, clf.feature_importances_)
    }
    # Sort importances descending
    importances = dict(sorted(importances.items(), key=lambda item: item[1], reverse=True))

    severe_precision = float(report_dict["Severe"]["precision"])
    severe_recall = float(report_dict["Severe"]["recall"])

    print(f"✔ Training Complete!")
    print(f"  • Overall Test Accuracy: {acc * 100:.1f}%")
    print(f"  • Macro F1-Score:        {macro_f1:.3f}")
    print(f"  • Severe Class Precision:{severe_precision * 100:.1f}%")
    print(f"  • Severe Class Recall:   {severe_recall * 100:.1f}%")

    # Save artifacts
    model_path = artifacts_dir / "model.joblib"
    metrics_path = artifacts_dir / "metrics.json"

    joblib.dump(clf, model_path, compress=3)
    print(f"✔ Saved model artifact: {model_path}")

    metrics_data = {
        "model_name": "PravahaNet-RF",
        "architecture": "RandomForestClassifier (400 trees)",
        "samples_trained": len(X_train),
        "samples_tested": len(X_test),
        "accuracy": round(acc, 4),
        "macro_f1": round(macro_f1, 4),
        "severe_precision": round(severe_precision, 4),
        "severe_recall": round(severe_recall, 4),
        "classification_report": report_dict,
        "confusion_matrix": conf_matrix,
        "feature_importances": importances,
        "classes": RISK_CLASSES,
    }

    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics_data, f, indent=2)
    print(f"✔ Saved metrics artifact: {metrics_path}")

    return metrics_data


if __name__ == "__main__":
    train_and_save_model()
