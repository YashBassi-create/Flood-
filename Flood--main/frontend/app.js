/**
 * PRAVAHA — Desktop Application Controller
 * Flash Flood Early Warning System | Smart India Hackathon 2026
 */

let map = null;
let markersLayer = null;
let tileLayerLight = null;
let tileLayerDark = null;
let markerMap = {}; // Map regionId -> L.marker
let weatherLayer = null;
let riverStreamersLayer = null;
let allRegions = [];
let selectedRegionId = null;
let hydrographChart = null;
let featureSpecs = {};
let currentTheme = localStorage.getItem("pravaha-theme") || "dark";
let riskColors = {
  Low: "#16a34a",
  Moderate: "#d97706",
  High: "#ea580c",
  Severe: "#dc2626",
};

// Simulation canvas state & Real-Time Dam API stream
let canvasAnimId = null;
let currentSimData = null;
let currentDamData = null;
let isSimStreaming = true;
let simStreamTimer = null;
let lastSimPingMs = 24;
let rainParticles = [];
let waterParticles = [];
let sprayMistParticles = [];

// Interpolated physics variables for smooth real-time rendering
let animStageDepth = 2.5;
let animVelocity = 1.8;
let animDamRelease = 0.0;
let animStoragePct = 75.0;

// Major River vectors for flow animation
const RIVER_PATHS = [
  // Ganga - Alaknanda
  [[30.73, 79.06], [30.55, 79.56], [30.14, 78.59], [30.10, 78.29], [29.94, 78.16], [29.0, 78.0], [25.43, 81.84], [25.31, 83.00]],
  // Beas River
  [[32.35, 77.18], [31.95, 77.10], [31.70, 76.93], [31.52, 75.91], [31.15, 74.96]],
  // Sutlej River
  [[31.58, 78.45], [31.45, 77.63], [31.25, 76.85], [30.96, 76.53], [30.90, 75.85], [31.15, 74.96], [30.40, 74.02]],
  // Jhelum River
  [[33.52, 75.25], [33.78, 75.09], [34.07, 74.82], [34.20, 74.34], [34.15, 73.80]],
  // Teesta River
  [[27.95, 88.65], [27.50, 88.52], [27.05, 88.42], [26.70, 88.60]],
];

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initDesktopShortcuts();
  initLiveClock();
  initNavTabs();
  initLeafletMap();
  initCanvas();
  fetchModelInfo();
  fetchMetrics();
  loadRegionsData();

  // Auto-refresh every 60 seconds
  setInterval(loadRegionsData, 60000);

  // Setup search and filter listeners
  document.getElementById("search-input").addEventListener("input", filterAndRenderNodes);
  document.getElementById("state-filter").addEventListener("change", filterAndRenderNodes);
  document.getElementById("risk-filter").addEventListener("change", filterAndRenderNodes);
  document.getElementById("toggle-weather").addEventListener("change", (e) => {
    if (weatherLayer) weatherLayer.setOpacity(e.target.checked ? 1 : 0);
  });
  document.getElementById("toggle-rivers").addEventListener("change", (e) => {
    if (riverStreamersLayer) {
      if (e.target.checked) map.addLayer(riverStreamersLayer);
      else map.removeLayer(riverStreamersLayer);
    }
  });

  document.getElementById("sim-regen-btn").addEventListener("click", () => {
    initRainParticles();
  });

  // Dark Mode Toggle Button Listener
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => toggleTheme());
  }
});

// ---- Theme & Desktop App Controls ----
function initTheme() {
  applyTheme();
}

function toggleTheme(forceTheme = null) {
  if (forceTheme) {
    currentTheme = forceTheme;
  } else {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
  }
  localStorage.setItem("pravaha-theme", currentTheme);
  applyTheme();
}

function applyTheme() {
  const isDark = currentTheme === "dark";
  document.body.classList.toggle("dark-mode", isDark);

  const iconEl = document.getElementById("theme-icon");
  const labelEl = document.getElementById("theme-label");
  if (iconEl) iconEl.innerText = isDark ? "☀️" : "🌙";
  if (labelEl) labelEl.innerText = isDark ? "Light Mode" : "Dark Mode";

  if (map && tileLayerLight && tileLayerDark) {
    if (isDark) {
      if (map.hasLayer(tileLayerLight)) map.removeLayer(tileLayerLight);
      if (!map.hasLayer(tileLayerDark)) map.addLayer(tileLayerDark);
    } else {
      if (map.hasLayer(tileLayerDark)) map.removeLayer(tileLayerDark);
      if (!map.hasLayer(tileLayerLight)) map.addLayer(tileLayerLight);
    }
  }

  // Refresh hydrograph chart colors if already rendered
  if (currentSimData && document.getElementById("hydrograph-canvas")) {
    renderHydrographChart(currentSimData.timeline_24h, currentSimData.hydrology.bankfull_discharge_m3s);
  }
}

// Native Desktop Keyboard Shortcuts (1-4 Tabs, D Dark Mode, / Search, ⌘S Save, E Export, C Copy, ? Shortcuts)
function initDesktopShortcuts() {
  window.addEventListener("keydown", (e) => {
    // If inside an input/select/textarea, allow Escape to blur, but don't intercept standard typing
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      if (e.key === "Escape") {
        document.activeElement.blur();
      }
      return;
    }

    // Save to file shortcut: ⌘S or Ctrl+S
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      saveReportToFile();
      return;
    }

    // Print shortcut: ⌘P or Ctrl+P
    if ((e.metaKey || e.ctrlKey) && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      window.print();
      return;
    }

    if (e.key === "1") {
      document.querySelector('.tab-btn[data-tab="map-tab"]')?.click();
    } else if (e.key === "2") {
      document.querySelector('.tab-btn[data-tab="cross-section-tab"]')?.click();
    } else if (e.key === "3") {
      document.querySelector('.tab-btn[data-tab="whatif-tab"]')?.click();
    } else if (e.key === "4") {
      document.querySelector('.tab-btn[data-tab="metrics-tab"]')?.click();
    } else if (e.key === "d" || e.key === "D") {
      toggleTheme();
    } else if (e.key === "/" || ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K"))) {
      e.preventDefault();
      const search = document.getElementById("search-input");
      if (search) {
        search.focus();
        search.select();
      }
    } else if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      const scModal = document.getElementById("shortcuts-modal");
      if (scModal && !scModal.classList.contains("hidden")) {
        closeShortcutsModal();
      } else {
        openShortcutsModal();
      }
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      saveReportToFile();
    } else if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      exportStationJson();
    } else if (e.key === "c" || e.key === "C") {
      copyReportText();
    } else if (e.key === "p" || e.key === "P") {
      const repModal = document.getElementById("report-modal");
      if (repModal && !repModal.classList.contains("hidden")) {
        e.preventDefault();
        window.print();
      }
    } else if (e.key === "Escape") {
      closeReportModal();
      closeShortcutsModal();
    }
  });
}

// ---- Clock & Status ----
function initLiveClock() {
  const clockEl = document.getElementById("live-clock");
  const update = () => {
    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";
  };
  update();
  setInterval(update, 1000);
}

// ---- Navigation Tabs ----
function initNavTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");

      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add("active");

      // Trigger map resize if switching to map tab
      if (targetId === "map-tab" && map) {
        setTimeout(() => map.invalidateSize(), 150);
      } else if (targetId === "cross-section-tab") {
        startSimRealTimeLoop();
        const regionId = selectedRegionId || (allRegions[0]?.id);
        if (regionId && (!currentDamData || currentDamData.region_id !== regionId)) {
          fetchDamTelemetry(regionId).then((damData) => {
            currentDamData = damData;
            renderDamTelemetryCard(damData);
            if (currentSimData) updateValleySimulationHUD(currentSimData, damData);
          });
        }
      }
    });
  });
}

// ---- Leaflet Map Setup with Dual Theme Tiles ----
function initLeafletMap() {
  map = L.map("leaflet-map", {
    center: [30.2, 77.8],
    zoom: 6.5,
    zoomControl: true,
  });

  tileLayerLight = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> | PRAVAHA SIH 2026',
    maxZoom: 18,
  });

  tileLayerDark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> | PRAVAHA SIH 2026',
    maxZoom: 18,
  });

  if (currentTheme === "dark") {
    tileLayerDark.addTo(map);
  } else {
    tileLayerLight.addTo(map);
  }

  markersLayer = L.layerGroup().addTo(map);
  initRiverStreamers();
}

// ---- River Flow Vectors ----
function initRiverStreamers() {
  riverStreamersLayer = L.layerGroup().addTo(map);
  RIVER_PATHS.forEach((path) => {
    L.polyline(path, {
      color: "#0284c7",
      weight: 3.5,
      opacity: 0.65,
      dashArray: "6, 8",
      lineCap: "round",
    }).addTo(riverStreamersLayer);
  });
}

// ---- Fetch & Render Data ----
async function loadRegionsData() {
  try {
    const res = await fetch("/api/regions");
    const data = await res.json();
    allRegions = data.regions || [];

    // Update summary metrics
    const summary = data.summary || {};
    document.getElementById("stat-total-nodes").innerText = summary.total_nodes || allRegions.length;
    document.getElementById("stat-severe").innerText = summary.severe || 0;
    document.getElementById("stat-high").innerText = summary.high || 0;
    document.getElementById("stat-mod").innerText = summary.moderate || 0;
    document.getElementById("stat-low").innerText = summary.low || 0;

    // Update 4-min bucket badge
    const bucketId = Math.floor(data.updated_at / 240);
    document.getElementById("bucket-badge").innerText = `Bucket #${bucketId} (4m cycle)`;

    // Emergency alert ticker
    const criticalNodes = allRegions.filter((r) => r.predicted_risk === "Severe" || r.predicted_risk === "High");
    const tickerEl = document.getElementById("alert-ticker");
    if (criticalNodes.length > 0) {
      const names = criticalNodes.map((n) => `${n.name} (${n.predicted_risk.toUpperCase()})`).join(" · ");
      document.getElementById("ticker-text").innerText = `Active Flash Flood Warning in ${criticalNodes.length} districts: ${names}. Emergency advisories active.`;
      tickerEl.classList.remove("hidden");
    } else {
      tickerEl.classList.add("hidden");
    }

    // Populate State dropdown and V-Valley station dropdown
    populateStateFilter(allRegions);
    populateStationDropdown();

    // Render list & markers
    filterAndRenderNodes();

    // If a node was already selected, refresh its details
    if (selectedRegionId) {
      selectRegion(selectedRegionId, false);
    } else if (allRegions.length > 0) {
      // Auto-select the highest risk node on start
      const topRisk = allRegions.find((r) => r.predicted_risk === "Severe") ||
                      allRegions.find((r) => r.predicted_risk === "High") ||
                      allRegions[0];
      selectRegion(topRisk.id, false);
    }
  } catch (err) {
    console.error("Error loading regional telemetry:", err);
  }
}

function populateStateFilter(regions) {
  const stateSelect = document.getElementById("state-filter");
  if (stateSelect.children.length > 1) return; // already populated

  const states = [...new Set(regions.map((r) => r.state))].sort();
  states.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.innerText = s;
    stateSelect.appendChild(opt);
  });
}

function populateStationDropdown() {
  const select = document.getElementById("sim-station-select");
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = "";

  const sorted = [...allRegions].sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  sorted.forEach((node) => {
    const opt = document.createElement("option");
    opt.value = node.id;
    const damPrefix = node.dam_upstream ? `🏗️ ${node.dam_upstream.name.split(' ')[0]} Dam` : `🏞️ Natural Basin`;
    opt.innerText = `${node.name} (${node.state}) [${damPrefix}] · ${node.predicted_risk}`;
    select.appendChild(opt);
  });

  if (selectedRegionId) {
    select.value = selectedRegionId;
  } else if (currentVal) {
    select.value = currentVal;
  }

  select.onchange = (e) => {
    if (e.target.value) {
      selectRegion(e.target.value, true);
    }
  };
}

function filterAndRenderNodes() {
  const search = document.getElementById("search-input").value.toLowerCase().trim();
  const stateFilter = document.getElementById("state-filter").value;
  const riskFilter = document.getElementById("risk-filter").value;

  const filtered = allRegions.filter((r) => {
    const matchSearch = r.name.toLowerCase().includes(search) ||
                        r.state.toLowerCase().includes(search) ||
                        r.river_name.toLowerCase().includes(search);
    const matchState = stateFilter === "all" || r.state === stateFilter;
    const matchRisk = riskFilter === "all" || r.predicted_risk === riskFilter;
    return matchSearch && matchState && matchRisk;
  });

  // Sort: Severe first, then High, Moderate, Low
  const order = { Severe: 0, High: 1, Moderate: 2, Low: 3 };
  filtered.sort((a, b) => order[a.predicted_risk] - order[b.predicted_risk]);

  document.getElementById("nodes-count").innerText = filtered.length;
  renderNodeList(filtered);
  renderMapMarkers(filtered);
}

function renderNodeList(nodes) {
  const container = document.getElementById("node-list");
  container.innerHTML = "";

  if (nodes.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--ink-muted); font-size: 0.8rem;">No stations match the selected filters.</div>';
    return;
  }

  nodes.forEach((node) => {
    const card = document.createElement("div");
    card.dataset.regionId = node.id;
    card.className = `node-card ${node.id === selectedRegionId ? "active" : ""}`;
    card.onclick = () => selectRegion(node.id, true);

    const tagClass = `tag-${node.predicted_risk.toLowerCase()}`;
    const dischargeRatio = node.derived.stage_ratio;

    card.innerHTML = `
      <div class="node-card-top">
        <span class="node-name">${node.name}</span>
        <span class="risk-tag ${tagClass}">${node.predicted_risk}</span>
      </div>
      <div class="node-sub">${node.state} · ${node.river_name}</div>
      <div class="node-stats-row">
        <span>Rain 1h: <b>${node.readings.rain_1h} mm</b></span>
        <span>Soil: <b>${node.readings.soil_moisture}%</b></span>
        <span>Stage: <b>${dischargeRatio}x</b></span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderMapMarkers(nodes) {
  markersLayer.clearLayers();
  markerMap = {};

  nodes.forEach((node) => {
    const risk = node.predicted_risk;
    const isSelected = node.id === selectedRegionId;
    const pulseClass = risk === "Severe" ? "pulse-pin-severe" : (risk === "High" ? "pulse-pin-high" : "");
    const activeClass = isSelected ? "active-pin" : "";
    const color = riskColors[risk] || "#78716c";

    const iconHtml = `
      <div class="custom-pin ${pulseClass} ${activeClass}" id="pin-${node.id}" style="background-color: ${color};">
        ${risk[0]}
      </div>
    `;

    const icon = L.divIcon({
      html: iconHtml,
      className: "",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const marker = L.marker([node.lat, node.lon], {
      icon,
      zIndexOffset: isSelected ? 1000 : 100,
    }).addTo(markersLayer);

    markerMap[node.id] = marker;

    const popupHtml = `
      <div style="font-family: var(--font-sans); min-width: 170px; padding: 4px;">
        <div style="font-weight: 700; font-size: 0.92rem; color: var(--ink-primary); margin-bottom: 2px;">${node.name}</div>
        <div style="font-size: 0.75rem; color: var(--ink-muted); margin-bottom: 6px;">${node.state} · ${node.river_name}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span class="risk-tag tag-${risk.toLowerCase()}">${risk} RISK</span>
          <span style="font-size: 0.72rem; font-weight: 600;">Rain: ${node.readings.rain_1h} mm/h</span>
        </div>
        <button class="btn btn-outline" style="font-size: 0.72rem; padding: 4px 8px; width: 100%;" onclick="openValleySimTab()">🏔️ Focus in V-Valley Sim</button>
      </div>
    `;

    marker.bindTooltip(`<b>${node.name}</b><br>${node.river_name}<br><b>Risk: ${risk}</b>`, {
      direction: "top",
      offset: [0, -12],
    });
    marker.bindPopup(popupHtml, { offset: [0, -10] });

    marker.on("click", () => {
      selectRegion(node.id, true);
    });
  });
}

// ---- Select & Inspect Region ----
async function selectRegion(regionId, panTo = true) {
  selectedRegionId = regionId;

  // 1. Highlight active card in sidebar list and scroll into view
  document.querySelectorAll(".node-card").forEach((c) => {
    const isActive = c.dataset.regionId === regionId;
    c.classList.toggle("active", isActive);
    if (isActive) {
      c.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  // 2. Synchronize focused station in V-Valley dropdown
  const simSelect = document.getElementById("sim-station-select");
  if (simSelect && simSelect.value !== regionId) {
    simSelect.value = regionId;
  }

  // 3. Highlight focused marker on Leaflet map
  document.querySelectorAll(".custom-pin").forEach((el) => el.classList.remove("active-pin"));
  const targetPin = document.getElementById(`pin-${regionId}`);
  if (targetPin) {
    targetPin.classList.add("active-pin");
  }
  const marker = markerMap[regionId];
  if (marker) {
    marker.setZIndexOffset(1200);
    if (panTo && map) {
      marker.openPopup();
    }
  }

  const node = allRegions.find((r) => r.id === regionId);
  if (!node) return;

  if (panTo && map) {
    map.flyTo([node.lat, node.lon], 9, { duration: 0.8 });
  }

  // 4. Load physical simulation & live Dam API telemetry for THIS focused city
  try {
    const [simRes, damRes] = await Promise.all([
      fetch(`/api/simulation/${regionId}`).then((r) => r.json()),
      fetchDamTelemetry(regionId),
    ]);
    currentSimData = simRes;
    currentDamData = damRes;
    renderInspectionPanel(simRes, node);
    updateValleySimulationHUD(simRes, damRes);
    renderDamTelemetryCard(damRes);
  } catch (err) {
    console.error("Simulation / Dam load error:", err);
  }
}

function renderInspectionPanel(sim, node) {
  document.getElementById("panel-empty-state").classList.add("hidden");
  const detailsEl = document.getElementById("panel-details");
  detailsEl.classList.remove("hidden");

  const risk = sim.predicted_risk;
  const hydro = sim.hydrology;
  const impact = sim.impact;
  const tagClass = `tag-${risk.toLowerCase()}`;
  const capPct = Math.min(180, Math.round(hydro.discharge_ratio * 100));

  let capBarColor = "var(--risk-low)";
  if (risk === "Severe") capBarColor = "var(--risk-severe)";
  else if (risk === "High") capBarColor = "var(--risk-high)";
  else if (risk === "Moderate") capBarColor = "var(--risk-moderate)";

  detailsEl.innerHTML = `
    <div class="panel-header-section">
      <h2 class="panel-header-title">${sim.region_name}</h2>
      <p class="panel-river-meta">${sim.state} · ${sim.river_basin} (${sim.river_name})</p>
      <div class="panel-risk-badge-box" style="background: var(--risk-${risk.toLowerCase()}-bg); border: 1px solid var(--risk-${risk.toLowerCase()}-border);">
        <div>
          <span style="font-size: 0.72rem; font-weight: 700; color: var(--ink-secondary); text-transform: uppercase;">Predicted Threat</span>
          <div style="font-family: var(--font-serif); font-size: 1.4rem; font-weight: 700; color: var(--risk-${risk.toLowerCase()});">${risk} RISK</div>
        </div>
        <div style="text-align: right; font-size: 0.75rem;">
          <div>Confidence: <b>${Math.round(sim.risk_probabilities[risk] * 100)}%</b></div>
          <div style="color: var(--ink-muted); font-size: 0.7rem;">Dominant: ${sim.dominant_driver}</div>
        </div>
      </div>
    </div>

    <!-- Bankfull Discharge Ratio -->
    <div class="capacity-box">
      <div class="cap-label-row">
        <span>Current Inflow: ${hydro.total_discharge_m3s.toLocaleString()} m³/s</span>
        <span>Bankfull: ${hydro.bankfull_discharge_m3s.toLocaleString()} m³/s (${capPct}%)</span>
      </div>
      <div class="cap-bar-bg">
        <div class="cap-bar-fill" style="width: ${Math.min(100, capPct)}%; background: ${capBarColor};"></div>
      </div>
    </div>

    <!-- Hydraulic Gauges -->
    <div class="gauges-row">
      <div class="gauge-box">
        <span class="gauge-label">Water Velocity</span>
        <span class="gauge-val">${hydro.velocity_mps} <small>m/s</small></span>
      </div>
      <div class="gauge-box">
        <span class="gauge-label">Hydraulic Depth</span>
        <span class="gauge-val">${hydro.water_depth_m} <small>m</small></span>
      </div>
      <div class="gauge-box">
        <span class="gauge-label">Submersion Area</span>
        <span class="gauge-val">${hydro.inundation_km2} <small>km²</small></span>
      </div>
    </div>

    <!-- Inflow Breakdown -->
    <div class="inflow-breakdown">
      <h4>Inflow Composition Analysis</h4>
      <div class="inflow-item">
        <span>Surface Runoff (SCS Model):</span>
        <b>${hydro.surface_runoff_m3s} m³/s</b>
      </div>
      <div class="inflow-item">
        <span>Glacier / Rain-on-Ice Melt:</span>
        <b>${hydro.glacier_melt_m3s} m³/s</b>
      </div>
      <div class="inflow-item">
        <span>Upstream Dam Release:</span>
        <b>${hydro.dam_release_m3s} m³/s</b>
      </div>
      <div class="inflow-item">
        <span>Baseflow:</span>
        <b>${hydro.baseflow_m3s} m³/s</b>
      </div>
    </div>

    <!-- 24-Hour Hydrograph Chart -->
    <div class="chart-container">
      <div class="chart-title">24-Hour Discharge Hydrograph (12h Hindcast + 12h Forecast)</div>
      <canvas id="hydrograph-canvas" height="150"></canvas>
    </div>

    <!-- Evacuation & Impact -->
    <div class="action-box" style="background: var(--risk-${risk.toLowerCase()}-bg); border-color: var(--risk-${risk.toLowerCase()}-border);">
      <div style="font-weight: 700; font-size: 0.82rem; margin-bottom: 4px; color: var(--risk-${risk.toLowerCase()});">
        ${impact.evacuation_status}
      </div>
      <div style="font-size: 0.75rem; line-height: 1.4; color: var(--ink-secondary);">
        • Population at Risk: <b>${impact.population_affected.toLocaleString()}</b> people<br>
        • Vulnerable Settlements: <b>${impact.villages_at_risk}</b> of ${impact.total_villages} villages<br>
        • Emergency Relief Camps: <b>${impact.relief_camps_needed}</b> required
      </div>
    </div>

    <!-- Directives & Report Modal Trigger -->
    <div style="display: flex; gap: 8px;">
      <button class="btn btn-outline" style="flex: 1;" onclick="openValleySimTab()">🏔️ Cross-Section</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="openReportModal()">📄 District Report</button>
    </div>

    <!-- Quick File Action Shortcuts -->
    <div style="display: flex; gap: 8px; margin-top: 8px;">
      <button class="btn btn-outline" style="flex: 1; font-size: 0.78rem;" onclick="saveReportToFile()" title="Save Advisory to text file (Hotkey: ⌘S or S)">💾 Save File (⌘S)</button>
      <button class="btn btn-outline" style="flex: 1; font-size: 0.78rem;" onclick="exportStationJson()" title="Export Station Telemetry to JSON (Hotkey: E)">📥 Export JSON (E)</button>
    </div>
  `;

  // Render Hydrograph
  renderHydrographChart(sim.timeline_24h, hydro.bankfull_discharge_m3s);
}

function openValleySimTab() {
  document.querySelector('.tab-btn[data-tab="cross-section-tab"]').click();
}

function renderHydrographChart(timeline, bankfull) {
  const ctx = document.getElementById("hydrograph-canvas");
  if (!ctx) return;

  if (hydrographChart) {
    try {
      hydrographChart.destroy();
    } catch (e) {}
    hydrographChart = null;
  }

  const isDark = document.body.classList.contains("dark-mode");
  const tickColor = isDark ? "#94a3b8" : "#78716c";
  const gridColor = isDark ? "rgba(51, 65, 85, 0.4)" : "rgba(231, 229, 228, 0.7)";

  const labels = timeline.map((t) => {
    const d = new Date(t.timestamp * 1000);
    return `${d.getHours()}:00`;
  });
  const dataVals = timeline.map((t) => t.discharge_m3s);

  hydrographChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Modeled Discharge (m³/s)",
          data: dataVals,
          borderColor: "#0284c7",
          backgroundColor: isDark ? "rgba(2, 132, 199, 0.22)" : "rgba(2, 132, 199, 0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 2,
        },
        {
          label: "Bankfull Capacity",
          data: Array(timeline.length).fill(bankfull),
          borderColor: "#dc2626",
          borderDash: [5, 5],
          borderWidth: 1.5,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 150,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${item.raw.toLocaleString()} m³/s`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9 }, color: tickColor, maxTicksLimit: 8 },
        },
        y: {
          grid: { color: gridColor },
          ticks: { font: { size: 9 }, color: tickColor },
        },
      },
    },
  });
}

// ---- District Flood Report Modal ----
function openReportModal() {
  if (!currentSimData) return;
  document.getElementById("report-text-pre").innerText = currentSimData.flood_report;
  document.getElementById("report-modal").classList.remove("hidden");
}

function closeReportModal() {
  document.getElementById("report-modal").classList.add("hidden");
}

function copyReportText() {
  let text = document.getElementById("report-text-pre")?.innerText;
  if (!text && currentSimData?.flood_report) {
    text = currentSimData.flood_report;
  }
  if (!text) {
    showToast("⚠️ No advisory report available to copy.");
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast("📋 Advisory report copied to clipboard!");
  }).catch(() => {
    showToast("📋 Advisory report copied!");
  });
}

// ---- File Download & Data Export Shortcuts ----
function triggerFileDownload(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 250);
}

function saveReportToFile() {
  if (!currentSimData || !currentSimData.flood_report) {
    if (allRegions.length > 0 && !selectedRegionId) {
      selectRegion(allRegions[0].id).then(() => {
        if (currentSimData?.flood_report) {
          saveReportToFile();
        }
      });
      return;
    }
    showToast("⚠️ Select a station to generate its advisory report first.");
    return;
  }

  const regionClean = (currentSimData.region_name || currentSimData.region_id || "Station")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `PRAVAHA_Advisory_${regionClean}_${timestamp}.txt`;

  triggerFileDownload(filename, currentSimData.flood_report, "text/plain;charset=utf-8");
  showToast(`💾 Saved advisory for ${currentSimData.region_name} to file!`);
}

function exportStationJson() {
  if (!currentSimData) {
    if (allRegions.length > 0 && !selectedRegionId) {
      selectRegion(allRegions[0].id).then(() => {
        if (currentSimData) {
          exportStationJson();
        }
      });
      return;
    }
    showToast("⚠️ Select a station to export telemetry data.");
    return;
  }

  const regionClean = (currentSimData.region_name || currentSimData.region_id || "Station")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `PRAVAHA_Telemetry_${regionClean}_${timestamp}.json`;
  const jsonContent = JSON.stringify(currentSimData, null, 2);

  triggerFileDownload(filename, jsonContent, "application/json;charset=utf-8");
  showToast(`📥 Exported ${currentSimData.region_name} telemetry to JSON!`);
}

// ---- Shortcuts Modal Handlers ----
function openShortcutsModal() {
  const modal = document.getElementById("shortcuts-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeShortcutsModal() {
  const modal = document.getElementById("shortcuts-modal");
  if (modal) modal.classList.add("hidden");
}

// ---- Desktop Toast Notification System ----
function showToast(message, duration = 3200) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}

// ---- Tab 2: V-Valley HTML5 Canvas Hydrology & Real-Time Dam Simulation ----

async function fetchDamTelemetry(regionId) {
  const t0 = performance.now();
  try {
    const res = await fetch(`/api/dam/${regionId}`);
    if (!res.ok) return null;
    const data = await res.json();
    lastSimPingMs = Math.max(12, Math.round(performance.now() - t0));
    return data;
  } catch (err) {
    console.error("Dam API fetch error:", err);
    return null;
  }
}

function startSimRealTimeLoop() {
  stopSimRealTimeLoop();
  if (!isSimStreaming) return;

  simStreamTimer = setInterval(async () => {
    const activeTab = document.querySelector(".tab-btn.active")?.dataset?.tab;
    if (activeTab !== "cross-section-tab" || !isSimStreaming) return;

    const regionId = selectedRegionId || (allRegions[0]?.id);
    if (!regionId) return;

    try {
      const [damData, simRes] = await Promise.all([
        fetchDamTelemetry(regionId),
        fetch(`/api/simulation/${regionId}`).then((r) => r.json()).catch(() => null),
      ]);

      if (simRes) {
        currentSimData = simRes;
        updateValleySimulationHUD(simRes, damData);
      }
      if (damData) {
        currentDamData = damData;
        renderDamTelemetryCard(damData);
      }

      const pingEl = document.getElementById("realtime-ping-time");
      if (pingEl) {
        pingEl.innerText = `${lastSimPingMs || 22}ms sync`;
      }
    } catch (e) {
      console.warn("Real-time loop error:", e);
    }
  }, 3000);
}

function stopSimRealTimeLoop() {
  if (simStreamTimer) {
    clearInterval(simStreamTimer);
    simStreamTimer = null;
  }
}

function toggleSimLiveStream() {
  isSimStreaming = !isSimStreaming;
  const btn = document.getElementById("sim-stream-toggle-btn");
  const label = document.getElementById("realtime-feed-label");
  const pulse = document.querySelector(".live-dot-pulse");

  if (isSimStreaming) {
    if (btn) btn.innerText = "⏸️ Pause Live Feed";
    if (label) label.innerText = "LIVE DAM API";
    if (pulse) pulse.style.animationPlayState = "running";
    startSimRealTimeLoop();
    showToast("🔴 Real-time Dam & River telemetry streaming active! (3s sync)");
  } else {
    if (btn) btn.innerText = "▶️ Resume Live Feed";
    if (label) label.innerText = "FEED PAUSED";
    if (pulse) pulse.style.animationPlayState = "paused";
    stopSimRealTimeLoop();
    showToast("⏸️ Real-time telemetry feed paused.");
  }
}

function initCanvas() {
  const canvas = document.getElementById("valley-canvas");
  if (!canvas) return;

  initRainParticles();
  initWaterParticles();
  initMistParticles();

  function renderLoop() {
    drawValleySimulation(canvas);
    canvasAnimId = requestAnimationFrame(renderLoop);
  }
  renderLoop();
}

function initRainParticles() {
  rainParticles = [];
  for (let i = 0; i < 240; i++) {
    rainParticles.push({
      x: Math.random() * 900,
      y: Math.random() * 520,
      len: 8 + Math.random() * 16,
      speed: 14 + Math.random() * 9,
      opacity: 0.35 + Math.random() * 0.5,
    });
  }
}

function initWaterParticles() {
  waterParticles = [];
  for (let i = 0; i < 80; i++) {
    waterParticles.push({
      x: 350 + Math.random() * 550,
      y: 430 + Math.random() * 50,
      radius: 1.5 + Math.random() * 2.8,
      speed: 2 + Math.random() * 3.5,
    });
  }
}

function initMistParticles() {
  sprayMistParticles = [];
  for (let i = 0; i < 50; i++) {
    sprayMistParticles.push({
      x: 330 + Math.random() * 50,
      y: 440 + Math.random() * 25,
      vx: (Math.random() - 0.2) * 3,
      vy: -1.8 - Math.random() * 3.8,
      radius: 2 + Math.random() * 5.5,
      alpha: 0.3 + Math.random() * 0.5,
      life: Math.random() * 35,
      maxLife: 35 + Math.random() * 35,
    });
  }
}

function renderDamTelemetryCard(damData) {
  const card = document.getElementById("dam-telemetry-card");
  if (!card) return;

  if (!damData || !damData.has_dam) {
    document.getElementById("dam-name").innerText = "No Upstream Dam";
    document.getElementById("dam-sub").innerText = `${damData?.river_name || "Mountain Basin"} · Free-flowing Alpine Channel`;
    const tag = document.getElementById("dam-status-tag");
    tag.className = "dam-status-tag tag-normal";
    tag.innerText = "NATURAL";
    document.getElementById("dam-storage-label").innerHTML = "Reservoir Storage: <b>N/A</b>";
    document.getElementById("dam-threshold-label").innerHTML = "Rule Curve: <b>N/A</b>";
    document.getElementById("dam-storage-bar-fill").style.width = "0%";
    document.getElementById("dam-water-level").innerHTML = "Water Level: <b>Natural Stream</b>";
    document.getElementById("dam-frl-level").innerHTML = "FRL: <b>None</b>";
    document.getElementById("dam-gates-count").innerText = "0 Gates (Free Flow)";
    document.getElementById("dam-spillway-val").innerText = "0 m³/s";
    document.getElementById("dam-inflow-val").innerText = "Catchment Runoff";
    document.getElementById("dam-gate-opening").innerText = "0.00 m";
    document.getElementById("dam-directive-text").innerText =
      "This alpine basin has no concrete retention dam upstream. Flood risks are determined by direct SCS surface runoff, cloudburst intensity, and glacial melt surges.";
    document.getElementById("dam-api-timestamp").innerText = `CWC Gauge Station · ${new Date().toLocaleTimeString()} IST`;
    return;
  }

  const info = damData.dam_info;
  document.getElementById("dam-name").innerText = info.name;
  document.getElementById("dam-sub").innerText = `${damData.river_name} · ${damData.state}`;

  const tag = document.getElementById("dam-status-tag");
  if (info.open_spillway_gates > 0) {
    tag.className = "dam-status-tag tag-danger";
    tag.innerText = "DISCHARGING";
  } else if (info.current_storage_pct >= info.rule_curve_threshold_pct - 4.0) {
    tag.className = "dam-status-tag tag-warning";
    tag.innerText = "HIGH BUFFER";
  } else {
    tag.className = "dam-status-tag tag-normal";
    tag.innerText = "NORMAL";
  }

  document.getElementById("dam-storage-label").innerHTML = `Storage: <b>${info.current_storage_pct.toFixed(1)}%</b>`;
  document.getElementById("dam-threshold-label").innerHTML = `Rule Curve: <b>${info.rule_curve_threshold_pct.toFixed(1)}%</b>`;
  document.getElementById("dam-storage-bar-fill").style.width = `${Math.min(100, Math.max(5, info.current_storage_pct))}%`;
  document.getElementById("dam-rule-curve-marker").style.left = `${Math.min(100, info.rule_curve_threshold_pct)}%`;

  document.getElementById("dam-water-level").innerHTML = `Level: <b>${info.current_water_level_m.toFixed(1)}m</b>`;
  document.getElementById("dam-frl-level").innerHTML = `FRL: <b>${info.full_reservoir_level_m.toFixed(1)}m</b>`;

  document.getElementById("dam-gates-count").innerText = `${info.open_spillway_gates} of ${info.total_spillway_gates} Gates`;
  document.getElementById("dam-spillway-val").innerText = `${info.spillway_release_m3s.toLocaleString()} m³/s`;
  document.getElementById("dam-inflow-val").innerText = `${info.reservoir_inflow_m3s.toLocaleString()} m³/s`;
  document.getElementById("dam-gate-opening").innerText = `${info.gate_opening_meters.toFixed(2)} m`;
  document.getElementById("dam-directive-text").innerText = info.status_message;
  document.getElementById("dam-api-timestamp").innerText = `CWC & NDSA Live API · ${new Date().toLocaleTimeString()} IST`;
}

function updateValleySimulationHUD(sim, damData = null) {
  const node = allRegions.find((r) => r.id === sim.region_id);
  const elev = node ? `${node.mean_elevation_m}m` : "2400m";
  const slope = node ? `${node.slope_deg}°` : "30°";
  const glacierTxt = node && node.glacier_fed ? "Glacier Fed · " : "";
  const damTxt = node && node.dam_upstream ? "Dam Spillway · " : "";

  const titleEl = document.getElementById("sim-region-title");
  if (titleEl) {
    titleEl.innerHTML = `📍 <span style="color: #0284c7;">${sim.region_name}</span> — V-Valley Cross-Section`;
  }
  const subEl = document.getElementById("sim-region-sub");
  if (subEl) {
    subEl.innerText = `${sim.state} · ${sim.river_basin} (${sim.river_name}) · Elev: ${elev} · Slope: ${slope} · ${glacierTxt}${damTxt}Risk: ${sim.predicted_risk.toUpperCase()} (${Math.round((sim.risk_probabilities[sim.predicted_risk] || 0.8) * 100)}% conf)`;
  }

  // Update unobstructed telemetry deck below canvas
  document.getElementById("hud-velocity").innerText = `${sim.hydrology.velocity_mps} m/s`;
  const velSub = document.getElementById("hud-velocity-sub");
  if (velSub) velSub.innerText = `Bed n: ${slope > 20 ? "0.045" : "0.032"}`;

  document.getElementById("hud-depth").innerText = `${sim.hydrology.water_depth_m} m`;
  const stageSub = document.getElementById("hud-stage-sub");
  if (stageSub) stageSub.innerText = `Discharge ratio: ${(sim.hydrology.discharge_ratio * 100).toFixed(0)}%`;

  document.getElementById("hud-discharge").innerText = `${sim.hydrology.total_discharge_m3s.toLocaleString()} m³/s`;
  const disSub = document.getElementById("hud-discharge-sub");
  if (disSub) disSub.innerText = `Bankfull: ${sim.hydrology.bankfull_discharge_m3s.toLocaleString()} m³/s`;

  const damBadge = document.getElementById("hud-dam-badge");
  const damReleaseEl = document.getElementById("hud-dam-release");
  const damMsgEl = document.getElementById("hud-dam");

  const dam = damData?.has_dam ? damData.dam_info : (sim.dam?.has_dam ? sim.dam.dam_info : null);
  if (dam) {
    if (damReleaseEl) damReleaseEl.innerText = `${dam.spillway_release_m3s.toLocaleString()} m³/s`;
    if (damMsgEl) damMsgEl.innerText = `${dam.name} (${dam.open_spillway_gates}/${dam.total_spillway_gates} gates open · ${dam.current_storage_pct}% storage)`;
    if (damBadge) {
      if (dam.open_spillway_gates > 0) {
        damBadge.className = "badge-pill badge-danger";
        damBadge.innerText = "SPILLWAY DISCHARGE";
      } else {
        damBadge.className = "badge-pill badge-normal";
        damBadge.innerText = "NORMAL BUFFER";
      }
    }
  } else {
    if (damReleaseEl) damReleaseEl.innerText = "0.0 m³/s";
    if (damMsgEl) damMsgEl.innerText = "Natural Alpine Basin (No Upstream Concrete Dam)";
    if (damBadge) {
      damBadge.className = "badge-pill badge-normal";
      damBadge.innerText = "FREE FLOW";
    }
  }

  const select = document.getElementById("sim-station-select");
  if (select && select.value !== sim.region_id) {
    select.value = sim.region_id;
  }
}

function drawValleySimulation(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const isDark = document.body.classList.contains("dark-mode");

  const regionId = currentSimData ? currentSimData.region_id : selectedRegionId;
  const node = allRegions.find((r) => r.id === regionId);
  const hasGlacier = node ? node.glacier_fed : (currentSimData?.hydrology?.glacier_melt_m3s > 0);
  const hasDam = Boolean(currentDamData?.has_dam || (node && node.dam_upstream));
  const damInfo = currentDamData?.dam_info || currentSimData?.dam?.dam_info || null;
  const slopeDeg = node ? node.slope_deg : 32.0;
  const hydro = currentSimData ? currentSimData.hydrology : null;

  // Smooth lerp physics variables toward live API targets
  const targetDepth = hydro ? hydro.water_depth_m : 2.5;
  const targetVel = hydro ? hydro.velocity_mps : 1.8;
  const targetDamQ = damInfo ? damInfo.spillway_release_m3s : (hydro?.dam_release_m3s || 0.0);
  const targetStorage = damInfo ? damInfo.current_storage_pct : (hydro?.dam_storage_pct || 75.0);

  animStageDepth += (targetDepth - animStageDepth) * 0.08;
  animVelocity += (targetVel - animVelocity) * 0.08;
  animDamRelease += (targetDamQ - animDamRelease) * 0.08;
  animStoragePct += (targetStorage - animStoragePct) * 0.08;

  // 1. Sky & Atmospheric Background
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
  const isCloudburst = currentSimData && currentSimData.readings.rain_1h > 35.0;

  if (isDark) {
    if (isCloudburst) {
      skyGrad.addColorStop(0, "#080c16");
      skyGrad.addColorStop(1, "#141d2e");
    } else {
      skyGrad.addColorStop(0, "#070c1a");
      skyGrad.addColorStop(1, "#1a2538");
    }
  } else {
    if (isCloudburst) {
      skyGrad.addColorStop(0, "#475569");
      skyGrad.addColorStop(1, "#94a3b8");
    } else {
      skyGrad.addColorStop(0, "#cbd5e1");
      skyGrad.addColorStop(1, "#e2e8f0");
    }
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  // Luminous Alpine Moon in Dark Mode
  if (isDark) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.shadowColor = "rgba(255, 255, 255, 0.45)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(w - 120, 65, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. High Himalayan Peaks (Background)
  ctx.fillStyle = isDark ? "#141e2e" : "#64748b";
  ctx.beginPath();
  ctx.moveTo(0, 300);
  ctx.lineTo(150, 105);
  ctx.lineTo(280, 230);
  ctx.lineTo(440, 130);
  ctx.lineTo(620, 290);
  ctx.lineTo(w, 200);
  ctx.lineTo(w, 440);
  ctx.lineTo(0, 440);
  ctx.fill();

  // 3. Glacier Ice Cap & Melt Cascade
  if (hasGlacier) {
    // Ice cap on high summit
    ctx.fillStyle = isDark ? "#f1f5f9" : "#ffffff";
    ctx.beginPath();
    ctx.moveTo(110, 135);
    ctx.lineTo(150, 105);
    ctx.lineTo(185, 132);
    ctx.lineTo(150, 145);
    ctx.fill();

    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.fillStyle = isDark ? "#93c5fd" : "#0369a1";
    ctx.fillText("GLACIER CIRQUE", 116, 96);

    // Cascading melt stream down the rock wall into reservoir/valley
    if (hydro && hydro.glacier_melt_m3s > 0) {
      ctx.strokeStyle = isDark ? "rgba(56, 189, 248, 0.85)" : "rgba(186, 230, 253, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(150, 145);
      ctx.quadraticCurveTo(180, 200, 210, 290);
      ctx.stroke();
    }
  }

  // 4. Fore Mountain Slope (Left valley flank with dynamic slope gradient)
  const slopeFactor = Math.min(1.3, Math.max(0.7, slopeDeg / 30.0));
  const flankY = Math.round(220 - (slopeFactor - 1.0) * 40);

  ctx.fillStyle = isDark ? "#1a2536" : "#334155";
  ctx.beginPath();
  ctx.moveTo(0, 520);
  ctx.lineTo(0, flankY);
  ctx.lineTo(230, 280);
  ctx.lineTo(340, 440);
  ctx.lineTo(0, 520);
  ctx.fill();

  // Alpine Fir Trees on mountain flank
  ctx.fillStyle = isDark ? "#0d1522" : "#1e293b";
  ctx.beginPath();
  ctx.arc(50, 260, 20, 0, Math.PI * 2);
  ctx.arc(100, 285, 24, 0, Math.PI * 2);
  ctx.arc(160, 325, 26, 0, Math.PI * 2);
  ctx.fill();

  // 5. Upstream Dam & Reservoir Architecture
  if (hasDam) {
    // --- 5A. Reservoir Lake Behind Dam (x: 130 to 240) ---
    const resTopY = Math.round(300 - (animStoragePct / 100) * 105); // Dynamic reservoir stage
    const resGrad = ctx.createLinearGradient(130, resTopY, 240, 440);
    resGrad.addColorStop(0, isDark ? "#0284c7" : "#0284c7");
    resGrad.addColorStop(1, isDark ? "#082f49" : "#0369a1");

    ctx.fillStyle = resGrad;
    ctx.beginPath();
    ctx.moveTo(130, 440);
    ctx.lineTo(130, resTopY + 15);
    ctx.lineTo(240, resTopY);
    ctx.lineTo(240, 440);
    ctx.fill();

    // Reservoir Water Surface Ripples
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const timeR = Date.now() / 400;
    for (let rx = 130; rx <= 240; rx += 8) {
      const ry = resTopY + Math.sin(rx * 0.08 + timeR) * 2;
      if (rx === 130) ctx.moveTo(rx, ry);
      else ctx.lineTo(rx, ry);
    }
    ctx.stroke();

    // Reservoir Lake Label
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.fillStyle = isDark ? "#bae6fd" : "#0c4a6e";
    ctx.fillText("UPSTREAM RESERVOIR", 125, resTopY - 8);

    // --- 5B. Massive Concrete Gravity Dam Structure (x: 240 to 340) ---
    // Dam Face & Spillway Chute
    const damGrad = ctx.createLinearGradient(240, 185, 340, 440);
    damGrad.addColorStop(0, isDark ? "#475569" : "#94a3b8");
    damGrad.addColorStop(1, isDark ? "#334155" : "#64748b");

    ctx.fillStyle = damGrad;
    ctx.beginPath();
    ctx.moveTo(240, 185); // Crest upstream lip
    ctx.lineTo(335, 185); // Crest downstream lip
    ctx.lineTo(340, 440); // Toe at stilling basin
    ctx.lineTo(240, 440); // Base at reservoir bed
    ctx.fill();

    // Dam Crest Roadway Deck
    ctx.fillStyle = isDark ? "#1e293b" : "#475569";
    ctx.fillRect(238, 175, 100, 12);

    // Flashing Dam Safety Beacon on Crest Roadway
    const beaconColor = animDamRelease > 50 ? "#ef4444" : (animStoragePct >= 85 ? "#f59e0b" : "#22c55e");
    const beaconGlow = animDamRelease > 50 ? "rgba(239, 68, 68, 0.8)" : "rgba(34, 197, 94, 0.6)";
    const flash = Math.sin(Date.now() / 250) > 0 ? 1 : 0.4;

    ctx.save();
    ctx.fillStyle = beaconColor;
    ctx.globalAlpha = flash;
    ctx.shadowColor = beaconGlow;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(288, 170, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- 5C. Radial Tainter Spillway Gates (5 Bays) ---
    const totalGates = damInfo?.total_spillway_gates || 5;
    const openGates = damInfo?.open_spillway_gates || (animDamRelease > 10 ? 4 : 0);
    const bayWidth = 14;

    for (let g = 0; g < totalGates; g++) {
      const gx = 250 + g * 16;
      const isOpen = g < openGates;

      if (isOpen) {
        // Raised radial gate bay
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(gx, 184, bayWidth, 6);
        // Golden indicator dot
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(gx + bayWidth / 2, 180, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Closed steel radial gate
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(gx, 185, bayWidth, 12);
        // Red sealed indicator dot
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(gx + bayWidth / 2, 180, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- 5D. High-Velocity Cascading Spillway Chute Torrent ---
    if (animDamRelease > 10) {
      // Roaring white-water chute torrent shooting down curved ogee face
      ctx.save();
      const waterSheet = ctx.createLinearGradient(250, 188, 340, 445);
      waterSheet.addColorStop(0, "rgba(255, 255, 255, 0.96)");
      waterSheet.addColorStop(0.5, isDark ? "rgba(186, 230, 253, 0.9)" : "rgba(224, 242, 254, 0.95)");
      waterSheet.addColorStop(1, "rgba(255, 255, 255, 0.98)");

      ctx.fillStyle = waterSheet;
      ctx.beginPath();
      ctx.moveTo(250, 190);
      ctx.lineTo(326, 190);
      ctx.quadraticCurveTo(348, 280, 362, 440);
      ctx.lineTo(320, 440);
      ctx.fill();

      // Torrential white-water flow streaks
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2.5;
      const tChute = Date.now() / 60;
      for (let s = 0; s < 4; s++) {
        ctx.beginPath();
        const startX = 260 + s * 16;
        ctx.moveTo(startX, 190);
        ctx.quadraticCurveTo(startX + 30, 280, startX + 45, 440);
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -tChute * 3;
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Flip Bucket / Stilling Basin Plunge Pool Boiling Foam
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(348, 442, 18, 0, Math.PI * 2);
      ctx.arc(366, 440, 14, 0, Math.PI * 2);
      ctx.arc(334, 444, 12, 0, Math.PI * 2);
      ctx.fill();

      // Churning water spray mist particles erupting upwards
      sprayMistParticles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life += 1;
        if (p.life > p.maxLife || p.y < 360) {
          p.x = 330 + Math.random() * 45;
          p.y = 440 + Math.random() * 20;
          p.life = 0;
        }
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * (1 - p.life / p.maxLife)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    } else {
      // Gentle Powerhouse Tailrace Discharge Exit (Normal Buffer)
      ctx.fillStyle = isDark ? "rgba(56, 189, 248, 0.8)" : "rgba(2, 132, 199, 0.8)";
      ctx.beginPath();
      ctx.arc(332, 440, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- 5E. On-Dam Real-Time Telemetry Readout Badge ---
    const damName = (damInfo?.name || "Upstream Dam").toUpperCase();
    const tagText = `🏗️ ${damName} · ${damInfo?.gate_status || "NORMAL BUFFER"}`;
    ctx.save();
    ctx.font = "bold 10px JetBrains Mono, monospace";
    const tagW = ctx.measureText(tagText).width;
    ctx.fillStyle = isDark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.94)";
    ctx.strokeStyle = animDamRelease > 10 ? "#ef4444" : "#0284c7";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(228, 144, tagW + 18, 22, [5]);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isDark ? "#f8fafc" : "#0f172a";
    ctx.fillText(tagText, 237, 159);
    ctx.restore();
  } else {
    // Natural Alpine Canyon without Dam (Rocks & Trees)
    ctx.fillStyle = isDark ? "#0f172a" : "#1e293b";
    ctx.beginPath();
    ctx.arc(260, 390, 24, 0, Math.PI * 2);
    ctx.arc(295, 410, 28, 0, Math.PI * 2);
    ctx.arc(330, 430, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.fillStyle = isDark ? "#94a3b8" : "#475569";
    ctx.fillText("🏞️ FREE-FLOWING CANYON", 230, 365);
  }

  // 6. River Channel Bed & Bedrock Substrate (x: 340 to 900)
  ctx.fillStyle = isDark ? "#0f172a" : "#1e293b";
  ctx.beginPath();
  ctx.moveTo(340, 440);
  ctx.lineTo(w, 420);
  ctx.lineTo(w, 520);
  ctx.lineTo(340, 520);
  ctx.fill();

  // Boulder sediment texture on river bed
  ctx.fillStyle = isDark ? "#1e293b" : "#334155";
  for (let bx = 370; bx < w; bx += 55) {
    ctx.beginPath();
    ctx.arc(bx, 480 + (bx % 20), 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Dynamic Flowing Water in Channel (Driven by Manning's Equation)
  const depthM = animStageDepth;
  const velocityMps = animVelocity;
  const waterY = Math.max(345, 472 - depthM * 16);

  const waterGrad = ctx.createLinearGradient(0, waterY, 0, 520);
  if (hydro && hydro.discharge_ratio >= 1.0) {
    // Torrential mud/silt flash flood water
    waterGrad.addColorStop(0, isDark ? "#92400e" : "#78350f");
    waterGrad.addColorStop(1, isDark ? "#451a03" : "#3b1704");
  } else {
    // Alpine turquoise mountain stream
    waterGrad.addColorStop(0, isDark ? "#0284c7" : "#0ea5e9");
    waterGrad.addColorStop(1, isDark ? "#034870" : "#0284c7");
  }
  ctx.fillStyle = waterGrad;
  ctx.beginPath();
  ctx.moveTo(340, 440);
  ctx.lineTo(340, waterY);
  ctx.lineTo(w, waterY - 8);
  ctx.lineTo(w, 520);
  ctx.lineTo(340, 520);
  ctx.fill();

  // 8. Turbulent Surface Water Waves (Doppler velocity scaled)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  const timeSec = Date.now() / 180;
  for (let x = 340; x <= w; x += 12) {
    const yWave = waterY + Math.sin(x * 0.04 + timeSec * (velocityMps * 0.85)) * 4.5;
    if (x === 340) ctx.moveTo(x, yWave);
    else ctx.lineTo(x, yWave);
  }
  ctx.stroke();

  // 9. Moving Channel Water Particles
  ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0.7)";
  waterParticles.forEach((p) => {
    p.x += p.speed * (velocityMps * 0.65);
    if (p.x > w) p.x = 340;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  });

  // 10. Atmospheric Rain Particles (Wind drift & rainfall intensity)
  const rainIntensity = currentSimData ? currentSimData.readings.rain_1h : 15.0;
  ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 1.3;

  rainParticles.forEach((p) => {
    p.y += p.speed * (1 + rainIntensity / 35.0);
    p.x += 2.8; // Wind drift
    if (p.y > h) {
      p.y = -10;
      p.x = Math.random() * w;
    }
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 5, p.y + p.len);
    ctx.stroke();
  });

  // 11. Prominent Top-Left Station Watermark & Real-Time Status Badge
  if (currentSimData) {
    const stName = (currentSimData.region_name || "Himalayan Station").toUpperCase();
    const stState = (currentSimData.state || "India").toUpperCase();
    const stRisk = (currentSimData.predicted_risk || "Low").toUpperCase();
    const liveTag = isSimStreaming ? "🔴 LIVE REAL-TIME API" : "⏸️ FEED PAUSED";
    const badgeText = `📍 FOCUSED CITY: ${stName} (${stState}) · ${stRisk} RISK · ${liveTag}`;

    ctx.save();
    ctx.font = "bold 11px Inter, sans-serif";
    const textWidth = ctx.measureText(badgeText).width;
    ctx.fillStyle = isDark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = riskColors[currentSimData.predicted_risk] || "#0284c7";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.roundRect(16, 16, textWidth + 24, 30, [6]);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isDark ? "#f8fafc" : "#0f172a";
    ctx.fillText(badgeText, 28, 35);
    ctx.restore();
  }
}

// ---- Tab 3: What-If Scenario Lab ----
async function fetchModelInfo() {
  try {
    const res = await fetch("/api/model/info");
    const data = await res.json();
    featureSpecs = data.features || {};
    renderWhatIfSliders();
    runWhatIfInference();
  } catch (err) {
    console.error("Model info fetch error:", err);
  }
}

function renderWhatIfSliders() {
  const form = document.getElementById("whatif-form");
  form.innerHTML = "";

  Object.entries(featureSpecs).forEach(([key, spec]) => {
    const group = document.createElement("div");
    group.className = "slider-group";

    group.innerHTML = `
      <div class="slider-label-row">
        <span>${spec.label}</span>
        <span id="val-${key}" style="font-family: var(--font-mono);">${spec.default} ${spec.unit}</span>
      </div>
      <input type="range" id="slider-${key}" class="slider-input"
             min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.default}" />
      <div class="slider-meta">${spec.description}</div>
    `;

    form.appendChild(group);

    const input = group.querySelector(`#slider-${key}`);
    input.addEventListener("input", (e) => {
      document.getElementById(`val-${key}`).innerText = `${e.target.value} ${spec.unit}`;
      debounceWhatIf();
    });
  });
}

let whatIfTimer = null;
function debounceWhatIf() {
  clearTimeout(whatIfTimer);
  whatIfTimer = setTimeout(runWhatIfInference, 120);
}

async function runWhatIfInference() {
  const payload = {};
  Object.keys(featureSpecs).forEach((k) => {
    const input = document.getElementById(`slider-${k}`);
    if (input) payload[k] = parseFloat(input.value);
  });

  if (Object.keys(payload).length < 10) return;

  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    renderWhatIfOutput(result);
  } catch (err) {
    console.error("Prediction error:", err);
  }
}

function renderWhatIfOutput(result) {
  const risk = result.predicted_risk;
  const tagEl = document.getElementById("whatif-risk-tag");
  const cardEl = document.getElementById("whatif-result-card");
  const confEl = document.getElementById("whatif-confidence");

  tagEl.innerText = `${risk.toUpperCase()} RISK`;
  tagEl.style.color = riskColors[risk];
  cardEl.style.borderColor = riskColors[risk];
  cardEl.style.backgroundColor = `var(--risk-${risk.toLowerCase()}-bg)`;

  const confPct = Math.round(result.risk_confidence * 100);
  confEl.innerText = `Model Confidence: ${confPct}%`;

  // Render Probability Distribution Bars
  const barsContainer = document.getElementById("prob-bars");
  barsContainer.innerHTML = "";

  Object.entries(result.risk_probabilities).forEach(([cls, prob]) => {
    const pct = Math.round(prob * 100);
    const row = document.createElement("div");
    row.className = "prob-row";
    row.innerHTML = `
      <span class="prob-label">${cls}</span>
      <div class="prob-bar-container">
        <div class="prob-bar" style="width: ${pct}%; background: ${riskColors[cls]};"></div>
      </div>
      <span class="prob-pct">${pct}%</span>
    `;
    barsContainer.appendChild(row);
  });

  // Advisory note
  const advText = document.getElementById("whatif-advisory-text");
  if (risk === "Severe") {
    advText.innerText = "Severe flash flood / GLOF emergency. Inundation depth exceeds 5 meters. Immediate mass evacuation and NDRF airlift pre-positioning required.";
  } else if (risk === "High") {
    advText.innerText = "Bankfull overflow imminent. Low-lying villages and riverside settlements should be moved to designated cyclone/flood shelters.";
  } else if (risk === "Moderate") {
    advText.innerText = "Catchment soils saturated; river stage rising near warning level. Restrict bridge transit and monitor telemetry every 15 minutes.";
  } else {
    advText.innerText = "Normal baseflow conditions. River channel possesses sufficient margin to absorb incoming catchment discharge.";
  }
}

function loadPreset(presetKey) {
  const presets = {
    kedarnath_cloudburst: {
      rain_1h: 115.0,
      rain_6h: 210.0,
      rain_24h: 340.0,
      rain_72h: 480.0,
      soil_moisture: 92.0,
      slope: 42.0,
      elevation: 3584.0,
      river_level: 8.5,
      drainage_density: 3.8,
      forest_cover: 28.0,
    },
    wayanad_saturation: {
      rain_1h: 45.0,
      rain_6h: 135.0,
      rain_24h: 280.0,
      rain_72h: 520.0,
      soil_moisture: 98.0,
      slope: 39.0,
      elevation: 980.0,
      river_level: 6.8,
      drainage_density: 3.6,
      forest_cover: 62.0,
    },
    punjab_dam_release: {
      rain_1h: 18.0,
      rain_6h: 65.0,
      rain_24h: 140.0,
      rain_72h: 260.0,
      soil_moisture: 84.0,
      slope: 6.0,
      elevation: 275.0,
      river_level: 8.2,
      drainage_density: 1.8,
      forest_cover: 12.0,
    },
    normal_baseline: {
      rain_1h: 2.0,
      rain_6h: 8.0,
      rain_24h: 22.0,
      rain_72h: 45.0,
      soil_moisture: 42.0,
      slope: 28.0,
      elevation: 1800.0,
      river_level: 2.1,
      drainage_density: 2.5,
      forest_cover: 55.0,
    },
  };

  const p = presets[presetKey];
  if (!p) return;

  Object.entries(p).forEach(([k, v]) => {
    const input = document.getElementById(`slider-${k}`);
    if (input) {
      input.value = v;
      const unit = featureSpecs[k] ? featureSpecs[k].unit : "";
      document.getElementById(`val-${k}`).innerText = `${v} ${unit}`;
    }
  });

  runWhatIfInference();
}

// ---- Tab 4: Model Diagnostics ----
async function fetchMetrics() {
  try {
    const res = await fetch("/api/metrics");
    const data = await res.json();
    renderDiagnostics(data);
  } catch (err) {
    console.error("Metrics load error:", err);
  }
}

function renderDiagnostics(data) {
  if (!data.accuracy) return;

  document.getElementById("diag-accuracy").innerText = `${(data.accuracy * 100).toFixed(1)}%`;
  document.getElementById("diag-f1").innerText = data.macro_f1.toFixed(3);
  document.getElementById("diag-severe-prec").innerText = `${(data.severe_precision * 100).toFixed(1)}%`;

  // Feature Importances
  const impList = document.getElementById("feature-importance-list");
  impList.innerHTML = "";

  const imps = data.feature_importances || {};
  const maxImp = Math.max(...Object.values(imps), 0.01);

  Object.entries(imps).forEach(([name, val]) => {
    const pct = Math.round((val / maxImp) * 100);
    const row = document.createElement("div");
    row.className = "f-imp-row";
    row.innerHTML = `
      <span class="f-imp-name">${name}</span>
      <div class="f-imp-bar-box">
        <div class="f-imp-bar" style="width: ${pct}%;"></div>
      </div>
      <span class="f-imp-val">${(val * 100).toFixed(1)}%</span>
    `;
    impList.appendChild(row);
  });

  // Confusion Matrix Table
  const table = document.getElementById("confusion-table");
  table.innerHTML = "";

  const classes = data.classes || ["Low", "Moderate", "High", "Severe"];
  const matrix = data.confusion_matrix || [];

  let headerHtml = "<tr><th>True \\ Pred</th>";
  classes.forEach((c) => (headerHtml += `<th>${c}</th>`));
  headerHtml += "</tr>";
  table.innerHTML = headerHtml;

  matrix.forEach((rowVals, i) => {
    const tr = document.createElement("tr");
    let rowHtml = `<th>${classes[i]}</th>`;
    rowVals.forEach((val, j) => {
      const isDiag = i === j;
      rowHtml += `<td class="conf-cell ${isDiag ? "conf-diag" : ""}">${val}</td>`;
    });
    tr.innerHTML = rowHtml;
    table.appendChild(tr);
  });
}
