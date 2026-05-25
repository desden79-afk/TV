const symbolEl = document.getElementById("symbol");
const timeframeEl = document.getElementById("timeframe");
const reloadEl = document.getElementById("reload");
const statusEl = document.getElementById("status");
const chartEl = document.getElementById("chart");
const oscEl = document.getElementById("osc-chart");
const oscPaneEl = oscEl.parentElement; // wrapper .pane-wrap.osc-pane (gestisce visibilità)
const indicatorTypeEl = document.getElementById("indicator-type");
const addIndicatorEl = document.getElementById("add-indicator");
const indicatorListEl = document.getElementById("indicator-list");
const legendMainEl = document.getElementById("legend-main");
const legendOscEl = document.getElementById("legend-osc");
const liveToggleEl = document.getElementById("live-toggle");

const chartTheme = {
  layout: { background: { color: "#161b25" }, textColor: "#e6e9ef" },
  grid: { vertLines: { color: "#232a38" }, horzLines: { color: "#232a38" } },
  timeScale: { timeVisible: true, secondsVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
};

const chart = LightweightCharts.createChart(chartEl, chartTheme);
const candleSeries = chart.addCandlestickSeries({
  upColor: "#26a69a",
  downColor: "#ef5350",
  borderVisible: false,
  wickUpColor: "#26a69a",
  wickDownColor: "#ef5350",
});

const oscChart = LightweightCharts.createChart(oscEl, chartTheme);

// Sincronizza l'asse temporale tra i due grafici
let syncing = false;
function syncRange(source, target) {
  source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (syncing || !range) return;
    syncing = true;
    target.timeScale().setVisibleLogicalRange(range);
    syncing = false;
  });
}
syncRange(chart, oscChart);
syncRange(oscChart, chart);

const PALETTE = ["#4ea1ff", "#ffb74d", "#ba68c8", "#80cbc4", "#f06292", "#aed581"];

// state.indicators: [{id, type, params, color, primitives:[{remove}]}]
const state = {
  candles: [],
  timeIndex: new Map(),  // time -> index in candles
  indicators: [],
  indicatorResults: {},  // id -> {pane, series: {...}}
  nextId: 1,
  hoverTime: null,       // tempo correntemente sotto il crosshair
};

const STORAGE_KEY = "tv-dashboard-state-v1";

function saveState() {
  try {
    const payload = {
      symbol: symbolEl.value,
      timeframe: timeframeEl.value,
      live: !!liveToggleEl.checked,
      indicators: state.indicators.map((i) => ({
        type: i.type,
        params: { ...i.params },
        color: i.color,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // localStorage può fallire (quota, modalità privata): non blocchiamo l'app
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload.symbol && [...symbolEl.options].some((o) => o.value === payload.symbol)) {
      symbolEl.value = payload.symbol;
    }
    if (payload.timeframe && [...timeframeEl.options].some((o) => o.value === payload.timeframe)) {
      timeframeEl.value = payload.timeframe;
    }
    if (typeof payload.live === "boolean") {
      liveToggleEl.checked = payload.live;
    }
    if (Array.isArray(payload.indicators)) {
      payload.indicators.forEach((saved) => {
        const defaults = defaultParams(saved.type);
        if (!defaults) return; // tipo non più supportato
        const params = { ...defaults, ...(saved.params || {}) };
        // tieni solo le chiavi che il tipo conosce, sanitizza interi
        Object.keys(params).forEach((k) => {
          if (!(k in defaults)) delete params[k];
          else {
            const v = parseInt(params[k], 10);
            params[k] = Number.isFinite(v) && v > 0 ? v : defaults[k];
          }
        });
        state.indicators.push({
          id: `ind-${state.nextId++}`,
          type: saved.type,
          params,
          color: saved.color || PALETTE[(state.nextId - 2) % PALETTE.length],
          primitives: [],
        });
      });
    }
  } catch (e) {
    // payload corrotto: ignora e riparti pulito
  }
}

function resize() {
  const w = chartEl.clientWidth;
  chart.applyOptions({ width: w, height: chartEl.clientHeight });
  oscChart.applyOptions({ width: w, height: oscEl.clientHeight });
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(chartEl);

// ---- Legend ----

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(digits);
  if (abs >= 1) return value.toFixed(Math.max(digits, 2));
  return value.toFixed(Math.max(digits, 4));
}

function indicatorLabel(ind) {
  switch (ind.type) {
    case "sma": return `SMA(${ind.params.period})`;
    case "ema": return `EMA(${ind.params.period})`;
    case "rsi": return `RSI(${ind.params.period})`;
    case "macd": return `MACD(${ind.params.fast},${ind.params.slow},${ind.params.signal})`;
    default: return ind.type.toUpperCase();
  }
}

function valueAtIndex(series, idx) {
  if (idx < 0 || idx >= series.length) return null;
  const v = series[idx];
  return v === null || v === undefined ? null : v;
}

function renderLegends() {
  const idx = state.hoverTime != null
    ? state.timeIndex.get(state.hoverTime)
    : state.candles.length - 1;

  if (idx == null || idx < 0 || !state.candles[idx]) {
    legendMainEl.innerHTML = "";
    legendOscEl.innerHTML = "";
    return;
  }

  const c = state.candles[idx];
  const up = c.close >= c.open;
  const dirClass = up ? "legend-up" : "legend-down";
  const date = new Date(c.time * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const mainRows = [];
  mainRows.push(`<div class="legend-row"><span class="legend-label">${symbolEl.value}</span><span>${date}</span></div>`);
  mainRows.push(
    `<div class="legend-row ${dirClass}">` +
    `<span><span class="legend-label">O</span> ${fmt(c.open)}</span>` +
    `<span><span class="legend-label">H</span> ${fmt(c.high)}</span>` +
    `<span><span class="legend-label">L</span> ${fmt(c.low)}</span>` +
    `<span><span class="legend-label">C</span> ${fmt(c.close)}</span>` +
    `<span><span class="legend-label">V</span> ${fmt(c.volume, 4)}</span>` +
    `</div>`
  );

  const oscRows = [];
  state.indicators.forEach((ind) => {
    const result = state.indicatorResults[ind.id];
    if (!result) return;
    const dot = `<span class="legend-dot" style="background:${ind.color}"></span>`;
    const label = indicatorLabel(ind);
    if (result.pane === "overlay") {
      const v = valueAtIndex(result.series.value, idx);
      mainRows.push(`<div class="legend-row">${dot}<span>${label}: ${fmt(v)}</span></div>`);
    } else if (ind.type === "rsi") {
      const v = valueAtIndex(result.series.value, idx);
      oscRows.push(`<div class="legend-row">${dot}<span>${label}: ${fmt(v)}</span></div>`);
    } else if (ind.type === "macd") {
      const m = valueAtIndex(result.series.macd, idx);
      const s = valueAtIndex(result.series.signal, idx);
      const h = valueAtIndex(result.series.hist, idx);
      oscRows.push(
        `<div class="legend-row">${dot}<span>${label}</span>` +
        `<span><span class="legend-label">M</span> ${fmt(m, 3)}</span>` +
        `<span><span class="legend-label">S</span> ${fmt(s, 3)}</span>` +
        `<span><span class="legend-label">H</span> ${fmt(h, 3)}</span>` +
        `</div>`
      );
    }
  });

  legendMainEl.innerHTML = mainRows.join("");
  legendOscEl.innerHTML = oscRows.join("");
}

function attachCrosshair(targetChart) {
  targetChart.subscribeCrosshairMove((param) => {
    state.hoverTime = param && param.time != null ? param.time : null;
    renderLegends();
  });
}
attachCrosshair(chart);
attachCrosshair(oscChart);

function hasOscillator() {
  return state.indicators.some((i) => i.type === "rsi" || i.type === "macd");
}

function toggleOscPane() {
  oscPaneEl.classList.toggle("hidden", !hasOscillator());
  resize();
}

function defaultParams(type) {
  switch (type) {
    case "sma": return { period: 20 };
    case "ema": return { period: 20 };
    case "rsi": return { period: 14 };
    case "macd": return { fast: 12, slow: 26, signal: 9 };
  }
}

function paramsLabel(ind) {
  switch (ind.type) {
    case "sma":
    case "ema":
    case "rsi":
      return `period: ${ind.params.period}`;
    case "macd":
      return `${ind.params.fast}/${ind.params.slow}/${ind.params.signal}`;
  }
}

function renderIndicatorList() {
  indicatorListEl.innerHTML = "";
  state.indicators.forEach((ind) => {
    const li = document.createElement("li");
    li.className = "indicator-item";
    li.innerHTML = `
      <div class="indicator-head">
        <span class="indicator-dot" style="background:${ind.color}"></span>
        <span class="indicator-name">${ind.type.toUpperCase()}</span>
        <span class="indicator-params">${paramsLabel(ind)}</span>
        <button class="btn-remove" title="Rimuovi">×</button>
      </div>
      <div class="indicator-controls"></div>
    `;
    const controls = li.querySelector(".indicator-controls");
    Object.entries(ind.params).forEach(([key, value]) => {
      const wrap = document.createElement("label");
      wrap.className = "param-input";
      wrap.innerHTML = `<span>${key}</span>`;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.value = value;
      input.addEventListener("change", () => {
        const v = parseInt(input.value, 10);
        if (!Number.isFinite(v) || v < 1) return;
        ind.params[key] = v;
        saveState();
        recomputeIndicators();
      });
      wrap.appendChild(input);
      controls.appendChild(wrap);
    });
    li.querySelector(".btn-remove").addEventListener("click", () => {
      removeIndicator(ind.id);
    });
    indicatorListEl.appendChild(li);
  });
}

function clearIndicatorPrimitives(ind) {
  if (!ind.primitives) return;
  ind.primitives.forEach(({ chart: targetChart, series }) => {
    try { targetChart.removeSeries(series); } catch (e) { /* già rimosso */ }
  });
  ind.primitives = [];
}

function addIndicator() {
  const type = indicatorTypeEl.value;
  const color = PALETTE[(state.nextId - 1) % PALETTE.length];
  const ind = {
    id: `ind-${state.nextId++}`,
    type,
    params: defaultParams(type),
    color,
    primitives: [],
  };
  state.indicators.push(ind);
  renderIndicatorList();
  toggleOscPane();
  saveState();
  recomputeIndicators();
}

function removeIndicator(id) {
  const idx = state.indicators.findIndex((i) => i.id === id);
  if (idx === -1) return;
  clearIndicatorPrimitives(state.indicators[idx]);
  delete state.indicatorResults[id];
  state.indicators.splice(idx, 1);
  renderIndicatorList();
  toggleOscPane();
  saveState();
  renderLegends();
}

function buildLineData(times, values) {
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (values[i] !== null && values[i] !== undefined) {
      out.push({ time: times[i], value: values[i] });
    }
  }
  return out;
}

function buildHistData(times, values, baseColor) {
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (values[i] !== null && values[i] !== undefined) {
      const color = values[i] >= 0 ? "#26a69a" : "#ef5350";
      out.push({ time: times[i], value: values[i], color });
    }
  }
  return out;
}

function renderIndicator(ind, result) {
  clearIndicatorPrimitives(ind);
  const times = state.candles.map((c) => c.time);
  if (result.pane === "overlay") {
    const series = chart.addLineSeries({ color: ind.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    series.setData(buildLineData(times, result.series.value));
    ind.primitives.push({ chart, series });
  } else if (ind.type === "rsi") {
    const series = oscChart.addLineSeries({ color: ind.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    series.setData(buildLineData(times, result.series.value));
    ind.primitives.push({ chart: oscChart, series });
  } else if (ind.type === "macd") {
    const macdLine = oscChart.addLineSeries({ color: ind.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    macdLine.setData(buildLineData(times, result.series.macd));
    const signalLine = oscChart.addLineSeries({ color: "#ffb74d", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    signalLine.setData(buildLineData(times, result.series.signal));
    const hist = oscChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    hist.setData(buildHistData(times, result.series.hist));
    ind.primitives.push({ chart: oscChart, series: macdLine });
    ind.primitives.push({ chart: oscChart, series: signalLine });
    ind.primitives.push({ chart: oscChart, series: hist });
  }
}

let recomputeToken = 0;
async function recomputeIndicators() {
  if (state.indicators.length === 0 || state.candles.length === 0) {
    state.indicators.forEach(clearIndicatorPrimitives);
    return;
  }
  const token = ++recomputeToken;
  const body = {
    closes: state.candles.map((c) => c.close),
    highs: state.candles.map((c) => c.high),
    lows: state.candles.map((c) => c.low),
    indicators: state.indicators.map((i) => ({ id: i.id, type: i.type, params: i.params })),
  };
  try {
    const res = await fetch("/api/indicators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (token !== recomputeToken) return; // risultato obsoleto
    state.indicatorResults = {};
    state.indicators.forEach((ind) => {
      const result = data.indicators[ind.id];
      if (result) {
        renderIndicator(ind, result);
        state.indicatorResults[ind.id] = result;
      }
    });
    renderIndicatorList();
    renderLegends();
  } catch (err) {
    statusEl.textContent = `Errore indicatori: ${err.message}`;
  }
}

async function loadCandles({ silent = false } = {}) {
  const symbol = symbolEl.value;
  const timeframe = timeframeEl.value;
  if (!silent) statusEl.textContent = `Carico ${symbol} (${timeframe})…`;
  try {
    const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.candles = data;
    state.timeIndex = new Map(data.map((c, i) => [c.time, i]));
    if (!silent) state.hoverTime = null;
    candleSeries.setData(data);
    if (!silent) chart.timeScale().fitContent();
    if (silent) {
      const now = new Date().toLocaleTimeString();
      statusEl.innerHTML = `<span class="live-on">● LIVE</span> · ${data.length} candele · agg. ${now}`;
    } else {
      statusEl.textContent = `${data.length} candele caricate.`;
    }
    renderLegends();
    await recomputeIndicators();
  } catch (err) {
    statusEl.textContent = `Errore: ${err.message}`;
  }
}

// ---- Auto-refresh ----

// intervallo (ms) calibrato sul timeframe: scala con la durata della candela
const POLL_INTERVALS_MS = {
  "1m":  15_000,
  "5m":  20_000,
  "15m": 30_000,
  "1h":  60_000,
  "4h":  120_000,
  "1d":  300_000,
};

let pollTimer = null;

function pollIntervalMs() {
  return POLL_INTERVALS_MS[timeframeEl.value] || 60_000;
}

function stopPolling() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  if (!liveToggleEl.checked) return;
  pollTimer = setInterval(() => {
    if (document.hidden) return;  // skip tick se la tab non è visibile
    loadCandles({ silent: true });
  }, pollIntervalMs());
}

function onLiveToggle() {
  saveState();
  if (liveToggleEl.checked) {
    startPolling();
  } else {
    stopPolling();
    statusEl.textContent = `${state.candles.length} candele caricate.`;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!liveToggleEl.checked) return;
  if (document.hidden) {
    stopPolling();
  } else {
    // refresh immediato al ritorno + ricomincia polling
    loadCandles({ silent: true });
    startPolling();
  }
});

reloadEl.addEventListener("click", () => loadCandles());
symbolEl.addEventListener("change", () => { saveState(); loadCandles(); startPolling(); });
timeframeEl.addEventListener("change", () => { saveState(); loadCandles(); startPolling(); });
addIndicatorEl.addEventListener("click", addIndicator);
liveToggleEl.addEventListener("change", onLiveToggle);

function savedSymbol() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return typeof payload.symbol === "string" ? payload.symbol : null;
  } catch (e) { return null; }
}

async function populateSymbols() {
  try {
    const res = await fetch("/api/symbols?limit=30");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return;
    symbolEl.innerHTML = "";
    list.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.symbol;
      opt.textContent = s.symbol;
      symbolEl.appendChild(opt);
    });
    // Se il simbolo salvato non è nella top N, lo aggiungiamo come opzione
    // extra così resta selezionabile (es. pair meno liquido scelto in passato).
    const saved = savedSymbol();
    if (saved && ![...symbolEl.options].some((o) => o.value === saved)) {
      const opt = document.createElement("option");
      opt.value = saved;
      opt.textContent = `${saved} (salvato)`;
      symbolEl.insertBefore(opt, symbolEl.firstChild);
    }
  } catch (err) {
    statusEl.textContent = `Lista simboli non disponibile (${err.message}). Uso default.`;
  }
}

async function init() {
  await populateSymbols();
  loadState();
  renderIndicatorList();
  toggleOscPane();
  resize();
  await loadCandles();
  if (liveToggleEl.checked) startPolling();
}

init();
