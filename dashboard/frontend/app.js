const symbolEl = document.getElementById("symbol");
const timeframeEl = document.getElementById("timeframe");
const reloadEl = document.getElementById("reload");
const statusEl = document.getElementById("status");
const chartEl = document.getElementById("chart");
const oscEl = document.getElementById("osc-chart");
const indicatorTypeEl = document.getElementById("indicator-type");
const addIndicatorEl = document.getElementById("add-indicator");
const indicatorListEl = document.getElementById("indicator-list");

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
  indicators: [],
  nextId: 1,
};

function resize() {
  const w = chartEl.clientWidth;
  chart.applyOptions({ width: w, height: chartEl.clientHeight });
  oscChart.applyOptions({ width: w, height: oscEl.clientHeight });
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(chartEl);

function hasOscillator() {
  return state.indicators.some((i) => i.type === "rsi" || i.type === "macd");
}

function toggleOscPane() {
  oscEl.classList.toggle("hidden", !hasOscillator());
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
  recomputeIndicators();
}

function removeIndicator(id) {
  const idx = state.indicators.findIndex((i) => i.id === id);
  if (idx === -1) return;
  clearIndicatorPrimitives(state.indicators[idx]);
  state.indicators.splice(idx, 1);
  renderIndicatorList();
  toggleOscPane();
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
    state.indicators.forEach((ind) => {
      const result = data.indicators[ind.id];
      if (result) renderIndicator(ind, result);
    });
    renderIndicatorList();
  } catch (err) {
    statusEl.textContent = `Errore indicatori: ${err.message}`;
  }
}

async function loadCandles() {
  const symbol = symbolEl.value;
  const timeframe = timeframeEl.value;
  statusEl.textContent = `Carico ${symbol} (${timeframe})…`;
  try {
    const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.candles = data;
    candleSeries.setData(data);
    chart.timeScale().fitContent();
    statusEl.textContent = `${data.length} candele caricate.`;
    await recomputeIndicators();
  } catch (err) {
    statusEl.textContent = `Errore: ${err.message}`;
  }
}

reloadEl.addEventListener("click", loadCandles);
symbolEl.addEventListener("change", loadCandles);
timeframeEl.addEventListener("change", loadCandles);
addIndicatorEl.addEventListener("click", addIndicator);

resize();
loadCandles();
