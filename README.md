# 🌊 PRAVAHA — Flash Flood Prediction System for Hilly Regions of India

**Smart India Hackathon 2026 · Disaster Management Theme**
*Multi-source data fusion + machine learning for early flash-flood warning across the Himalaya, North-East hills and Western Ghats.*

---

## 🚨 Problem Statement

Flash floods in India's hilly regions (Kedarnath 2013, Himachal 2023, Wayanad 2024, Teesta/Sikkim 2023) strike with little warning because risk depends on the **interaction** of intense short-duration rainfall, saturated soil, steep terrain and rising rivers — no single data source captures it.

**PRAVAHA** (संस्कृत: *flow/current*) fuses multi-source telemetry and predicts flash-flood risk in near-real-time for 49 river-basin monitoring nodes, including Punjab and the core North Indian flood corridors.

## ✨ Features

| Pillar | What you get |
|---|---|
| **Accuracy** | `PravahaNet-RF` Random-Forest classifier — **87.6% test accuracy**, macro-F1 0.865, 96%+ precision on the Severe class, trained on 20,000 physically-informed samples |
| **Performance** | <5 ms inference per region, gzip API, 4-minute feed buckets, canvas-based weather renderer, static-asset caching |
| **Aesthetics** | Editorial light theme (paper/ink palette, Fraunces display type), data-first map with river-gauge markers, live weather layer, responsive layout |

* 🗺️ **Live risk map** — 49 monitored nodes across Punjab, Haryana, Chandigarh, Delhi, J&K, Ladakh, Himachal Pradesh, Uttarakhand, Uttar Pradesh, Rajasthan and the original high-vulnerability regions. River-gauge pins show the modelled risk; High/Severe pins pulse.
* 🏔️ **Flood simulation** — hydrological engine per district: rainfall runoff over the catchment, **glacier melt** (season + solar-cycle driven, rain-on-ice GLOF amplification), **dam rule-curve releases** (Tehri, Pandoh, Nathpa Jhakri, Chamera, Idukki, Teesta III…), **Manning's-equation water velocity**, inundation extent and **population impact** (people affected, villages at risk, evacuation advised, relief camps)
* 🎬 **Animated terrain cross-section** — V-valley with dam spillway jet, glacier melt trickles, rain shafts and velocity-scaled channel flow, all live
* 📄 **Flood reports** — auto-generated district-administration advisories per region (discharge vs bankfull, dominant driver, inundation, evacuation instructions, NDRF pre-positioning)
* 🌧️ **Weather layer** — storm clouds + rain shafts per district and **velocity-scaled flow pulses streaming along the river courses** (Ganga, Alaknanda, Beas, Sutlej, Jhelum, Teesta, Periyar, Indus), with a toggle
* 🛰️ **Multi-source fusion** — IMD-style rainfall AWS, ISRO-Bhuvan-style satellite soil moisture, CWC-style river gauges, SRTM terrain
* ⚠️ **Alert engine** — automatic advisory strip for High/Severe regions (NDRF/district-admin framing)
* 📊 **Analytics** — 12h hindcast + 12h forecast discharge timeline, inflow composition, rainfall leaderboard, risk distribution, per-region telemetry drill-down

## ▶️ Run it — literally one click

| OS | Action |
|---|---|
| **macOS** | Double-click **`Start App.command`** |
| **Linux** | Double-click / run **`./run.sh`** |
| **Windows** | Double-click **`run.bat`** |

The launcher creates a virtualenv, installs dependencies, trains the model if needed, starts the server and opens the dashboard at **http://127.0.0.1:8000**. First run takes ~2 min (install + training); every run after is instant.

> Requirements: Python 3.10+ and internet (first run, for pip + map tiles).

## 🏗️ Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  IMD AWS     │   │ ISRO Bhuvan  │   │  CWC Gauges  │   (simulated live feeds,
│  rainfall    │   │ soil moisture│   │ river levels │    swappable for real APIs)
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       └──────────────────┼──────────────────┘
                          ▼
              backend/data_sources.py   ← 4-min refresh buckets, monsoon + diurnal aware
                          ▼
   SRTM terrain ──►  model/  PravahaNet-RF (scikit-learn, 400 trees)
                          ▼
        backend/simulation.py  water budget → Manning velocity → inundation
                               → population impact → flood report
                          ▼
              backend/main.py  FastAPI  /api/regions · /api/simulation · /api/predict · /api/metrics
                          ▼
              frontend/  Leaflet map + terrain-sim canvas + river flows · Chart.js
```

```
flashflood-sih/
├── Start App.command      # macOS double-click launcher
├── run.sh / run.bat       # Linux / Windows launchers
├── requirements.txt
├── backend/
│   ├── main.py            # FastAPI app + inference
│   ├── data_sources.py    # multi-source feed simulation (IMD/ISRO/CWC)
│   └── regions.py         # 49 river-basin monitoring nodes + terrain constants
├── model/
│   ├── train.py           # dataset generation + training + metrics
│   ├── features.py        # feature spec (single source of truth)
│   └── artifacts/         # model.joblib + metrics.json (committed)
└── frontend/
    ├── index.html  styles.css  app.js
```

## 📡 Live tracking setup

PRAVAHA works immediately with live public Open-Meteo weather and GloFAS river-discharge data. For operational tracking, configure approved IMD AWS and CWC/NWIC feeds:

1. Copy `.env.example` to `.env` and replace the placeholder station and gauge IDs.
2. Have IMD allow-list the public IP of the deployed server, then set the IMD URL template and a station ID for each monitored district.
3. Obtain the approved CWC/NWIC gauge endpoint and token, then set the gauge mapping and `CWC_BEARER_TOKEN`.

The app labels every value as `live_official`, `live_public`, `derived`, or `simulated`. It never relabels Open-Meteo or GloFAS data as IMD, ISRO, or CWC. MOSDAC/ISRO satellite rainfall should be ingested by a scheduled pipeline rather than fetched during a dashboard request.

## 🔌 API

| Endpoint | Method | Description |
|---|---|---|
| `/api/regions` | GET | All regions: fused readings + risk prediction + flow/impact summary |
| `/api/simulation/{id}` | GET | Full hydrological simulation: inflows, velocity/depth, inundation, population impact, 24h timeline, flood report |
| `/api/predict` | POST | What-if prediction from 10 feature values (JSON) |
| `/api/metrics` | GET | Model accuracy, per-class report, confusion matrix, importances |
| `/api/model/info` | GET | Feature ranges/labels (drives the simulator UI) |
| `/api/health` | GET | Liveness probe |

## 🧠 Model

10 features: `rain_1h, rain_6h, rain_24h, rain_72h, soil_moisture, slope, elevation, river_level, drainage_density, forest_cover` → 4 risk classes (**Low / Moderate / High / Severe**).

Labels come from a physically-inspired composite score (cloudburst rainfall dominance, antecedent saturation amplification, slope/drainage contribution, forest-cover protection) with measurement noise — giving the forest realistic, learnable structure. Retrain anytime:

```bash
.venv/bin/python -m model.train
```

## 🌐 Going to production

The feed layer is deliberately isolated: replace `live_readings()` in `backend/data_sources.py` with calls to the real **IMD API**, **ISRO Bhuvan**, **CWC flood-forecast** and **SRTM DEM** services — no other code changes needed. Suggested next steps: district/ward-scale grids, SMS/IVRS alerting via SACHET/NDMA integration, LSTM on gauge time-series, and on-site LoRa rain gauges for last-mile telemetry.

## 🌿 Branches

* `main` — stable, demo-ready release
* `dev` — active development

---
*Built for Smart India Hackathon 2026 — Disaster Management theme. Feeds are simulated for demonstration; predictions are research-grade, not a substitute for official NDMA/IMD warnings.*
