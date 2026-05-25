// ---- Tab switcher ----

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    tabPanels.forEach((p) => p.classList.toggle("hidden", p.dataset.tab !== target));
    // dopo lo switch, ridimensiona i grafici del tab che diventa visibile
    if (target === "backtest") {
      // eredita simbolo e timeframe dal tab Grafico
      if (btSymbolEl && symbolEl) btSymbolEl.value = symbolEl.value;
      if (btTimeframeEl && timeframeEl) btTimeframeEl.value = timeframeEl.value;
      if (btChart) requestAnimationFrame(btResize);
    } else if (target === "compare") {
      if (typeof cmpOnTabActivate === "function") cmpOnTabActivate();
    } else if (target === "chart") {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  });
});

// ---- Backtest UI ----

const btPresetEl    = document.getElementById("bt-preset");
const btStrategyEl  = document.getElementById("bt-strategy");
const btModeEl      = document.getElementById("bt-mode");
const btSymbolEl    = document.getElementById("bt-symbol");
const btTimeframeEl = document.getElementById("bt-timeframe");
const btLimitEl     = document.getElementById("bt-limit");
const btCapitalEl   = document.getElementById("bt-capital");
const btFeeEl       = document.getElementById("bt-fee");
const btSlipEl      = document.getElementById("bt-slip");
const btSlLongEl    = document.getElementById("bt-sl-long");
const btTpLongEl    = document.getElementById("bt-tp-long");
const btSlShortEl   = document.getElementById("bt-sl-short");
const btTpShortEl   = document.getElementById("bt-tp-short");
const btRunEl       = document.getElementById("bt-run");
const btStatusEl    = document.getElementById("bt-status");
const btMetricsEl   = document.getElementById("bt-metrics");
const btChartEl     = document.getElementById("bt-chart");
const btEquityEl    = document.getElementById("bt-equity-chart");
const btTradesEl    = document.getElementById("bt-trades-table");

const BT_STORAGE_KEY = "tv-backtest-state-v1";

const PRESETS = {
  rsi_rebound: {
    name: "RSI rebound + EMA trend filter",
    indicators: [
      { id: "rsi", type: "rsi", params: { period: 14 } },
      { id: "ema_fast", type: "ema", params: { period: 20 } },
      { id: "ema_slow", type: "ema", params: { period: 50 } },
    ],
    long:  { entry: "rsi < 30 AND ema_fast > ema_slow", exit: "rsi > 70" },
    short: { entry: "rsi > 70 AND ema_fast < ema_slow", exit: "rsi < 30" },
    stop_loss_pct: 0.03,
    take_profit_pct: 0.06,
  },
  golden_cross: {
    name: "EMA golden cross",
    indicators: [
      { id: "ema_fast", type: "ema", params: { period: 20 } },
      { id: "ema_slow", type: "ema", params: { period: 50 } },
    ],
    long:  { entry: "cross_above(ema_fast, ema_slow)", exit: "cross_below(ema_fast, ema_slow)" },
    stop_loss_pct: 0.05,
  },
  macd_signal: {
    name: "MACD signal cross",
    indicators: [
      { id: "macd", type: "macd", params: { fast: 12, slow: 26, signal: 9 } },
    ],
    long:  { entry: "cross_above(macd.macd, macd.signal)", exit: "cross_below(macd.macd, macd.signal)" },
    short: { entry: "cross_below(macd.macd, macd.signal)", exit: "cross_above(macd.macd, macd.signal)" },
  },
  ema_short: {
    name: "EMA death cross (short only)",
    indicators: [
      { id: "ema_fast", type: "ema", params: { period: 20 } },
      { id: "ema_slow", type: "ema", params: { period: 50 } },
    ],
    short: { entry: "cross_below(ema_fast, ema_slow)", exit: "cross_above(ema_fast, ema_slow)" },
    stop_loss_pct: 0.05,
  },
  rsi_short: {
    name: "RSI overbought short",
    indicators: [
      { id: "rsi",     type: "rsi", params: { period: 14 } },
      { id: "ema_slow", type: "ema", params: { period: 50 } },
    ],
    short: { entry: "rsi > 70 AND close < ema_slow", exit: "rsi < 40" },
    stop_loss_pct: 0.03,
    take_profit_pct: 0.06,
  },
};

function loadBtStrategyFromPreset(key) {
  if (!key || !PRESETS[key]) return;
  const preset = { ...PRESETS[key] };

  // Estrai SL/TP dai blocchi long/short, con fallback ai globali
  let slLong = "", tpLong = "", slShort = "", tpShort = "";

  if (preset.long?.stop_loss_pct != null) {
    slLong = (preset.long.stop_loss_pct * 100).toString();
    delete preset.long.stop_loss_pct;
  }
  if (preset.long?.take_profit_pct != null) {
    tpLong = (preset.long.take_profit_pct * 100).toString();
    delete preset.long.take_profit_pct;
  }
  if (preset.short?.stop_loss_pct != null) {
    slShort = (preset.short.stop_loss_pct * 100).toString();
    delete preset.short.stop_loss_pct;
  }
  if (preset.short?.take_profit_pct != null) {
    tpShort = (preset.short.take_profit_pct * 100).toString();
    delete preset.short.take_profit_pct;
  }

  // Fallback: se ci sono SL/TP globali, applica a entrambi
  if (preset.stop_loss_pct != null) {
    if (!slLong) slLong = (preset.stop_loss_pct * 100).toString();
    if (!slShort) slShort = (preset.stop_loss_pct * 100).toString();
    delete preset.stop_loss_pct;
  }
  if (preset.take_profit_pct != null) {
    if (!tpLong) tpLong = (preset.take_profit_pct * 100).toString();
    if (!tpShort) tpShort = (preset.take_profit_pct * 100).toString();
    delete preset.take_profit_pct;
  }

  btSlLongEl.value = slLong;
  btTpLongEl.value = tpLong;
  btSlShortEl.value = slShort;
  btTpShortEl.value = tpShort;
  btStrategyEl.value = JSON.stringify(preset, null, 2);
  saveBtState();
}

btPresetEl.addEventListener("change", () => loadBtStrategyFromPreset(btPresetEl.value));

// ---- Charts (lazy) ----

const btChartTheme = {
  layout: { background: { color: "#161b25" }, textColor: "#e6e9ef" },
  grid: { vertLines: { color: "#232a38" }, horzLines: { color: "#232a38" } },
  timeScale: { timeVisible: true, secondsVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
};

let btChart = null;
let btCandleSeries = null;
let btEquityChart = null;
let btEquitySeries = null;

function ensureCharts() {
  if (btChart) return;
  btChart = LightweightCharts.createChart(btChartEl, btChartTheme);
  btCandleSeries = btChart.addCandlestickSeries({
    upColor: "#26a69a", downColor: "#ef5350",
    borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350",
  });
  btEquityChart = LightweightCharts.createChart(btEquityEl, btChartTheme);
  btEquitySeries = btEquityChart.addAreaSeries({
    lineColor: "#4ea1ff",
    topColor: "rgba(78,161,255,0.4)",
    bottomColor: "rgba(78,161,255,0.02)",
    lineWidth: 2,
    priceLineVisible: false,
  });
  // sincronizza time scale
  let syncing = false;
  function syncRange(src, dst) {
    src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true; dst.timeScale().setVisibleLogicalRange(range); syncing = false;
    });
  }
  syncRange(btChart, btEquityChart);
  syncRange(btEquityChart, btChart);
}

function btResize() {
  if (!btChart) return;
  btChart.applyOptions({ width: btChartEl.clientWidth, height: btChartEl.clientHeight });
  btEquityChart.applyOptions({ width: btEquityEl.clientWidth, height: btEquityEl.clientHeight });
}
window.addEventListener("resize", btResize);

// ---- Stato persistito ----

function saveBtState() {
  try {
    localStorage.setItem(BT_STORAGE_KEY, JSON.stringify({
      strategy: btStrategyEl.value,
      mode: btModeEl.value,
      symbol: btSymbolEl.value,
      timeframe: btTimeframeEl.value,
      limit: btLimitEl.value,
      capital: btCapitalEl.value,
      fee: btFeeEl.value,
      slip: btSlipEl.value,
      sl_long: btSlLongEl.value,
      tp_long: btTpLongEl.value,
      sl_short: btSlShortEl.value,
      tp_short: btTpShortEl.value,
    }));
  } catch (e) { /* ignora */ }
}

function loadBtState() {
  try {
    const raw = localStorage.getItem(BT_STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.strategy) btStrategyEl.value = p.strategy;
    if (p.mode) btModeEl.value = p.mode;
    if (p.timeframe) btTimeframeEl.value = p.timeframe;
    if (p.limit) btLimitEl.value = p.limit;
    if (p.capital) btCapitalEl.value = p.capital;
    if (p.fee) btFeeEl.value = p.fee;
    if (p.slip) btSlipEl.value = p.slip;
    if (p.sl_long != null) btSlLongEl.value = p.sl_long;
    if (p.tp_long != null) btTpLongEl.value = p.tp_long;
    if (p.sl_short != null) btSlShortEl.value = p.sl_short;
    if (p.tp_short != null) btTpShortEl.value = p.tp_short;
    // symbol viene applicato dopo populateBtSymbols
    return p;
  } catch (e) { return null; }
}

// Allinea la lista simboli del tab Backtest a quella del tab Grafico
async function populateBtSymbols(preferredSymbol) {
  try {
    const res = await fetch("/api/symbols?limit=30");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    btSymbolEl.innerHTML = "";
    list.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.symbol;
      opt.textContent = s.symbol;
      btSymbolEl.appendChild(opt);
    });
    if (preferredSymbol) {
      if (![...btSymbolEl.options].some((o) => o.value === preferredSymbol)) {
        const opt = document.createElement("option");
        opt.value = preferredSymbol;
        opt.textContent = `${preferredSymbol} (salvato)`;
        btSymbolEl.insertBefore(opt, btSymbolEl.firstChild);
      }
      btSymbolEl.value = preferredSymbol;
    }
  } catch (e) {
    const opt = document.createElement("option");
    opt.value = "BTC/USDT"; opt.textContent = "BTC/USDT";
    btSymbolEl.appendChild(opt);
  }
}

[btStrategyEl, btModeEl, btSymbolEl, btTimeframeEl, btLimitEl, btCapitalEl, btFeeEl, btSlipEl, btSlLongEl, btTpLongEl, btSlShortEl, btTpShortEl]
  .forEach((el) => el.addEventListener("change", saveBtState));

// ---- Run backtest ----

function fmtPct(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return (v * 100).toFixed(digits) + "%";
}
function fmtMoney(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtPrice(v) { return v == null ? "—" : v.toFixed(2); }

function renderMetrics(m) {
  const cards = [
    { label: "Return totale", value: fmtPct(m.total_return_pct), cls: m.total_return_pct >= 0 ? "metric-up" : "metric-down" },
    { label: "Equity finale", value: fmtMoney(m.final_equity), cls: "" },
    { label: "Trade", value: m.num_trades, cls: "" },
    { label: "Win rate", value: fmtPct(m.win_rate, 1), cls: "" },
    { label: "Profit factor", value: m.profit_factor == null ? "∞" : m.profit_factor.toFixed(2), cls: "" },
    { label: "Max drawdown", value: fmtPct(m.max_drawdown_pct), cls: "metric-down" },
    { label: "Avg win", value: fmtPct(m.avg_win_pct), cls: "metric-up" },
    { label: "Avg loss", value: fmtPct(m.avg_loss_pct), cls: "metric-down" },
  ];
  btMetricsEl.innerHTML = cards.map((c) =>
    `<div class="metric-card">
       <div class="metric-label">${c.label}</div>
       <div class="metric-value ${c.cls}">${c.value}</div>
     </div>`
  ).join("");
}

function tradeMarkers(trades) {
  // Long entry = freccia in alto verde; Long exit = freccia in basso rossa
  // Short entry = freccia in basso rossa; Short exit = freccia in alto verde
  const markers = [];
  trades.forEach((t) => {
    const isLong = t.direction === "long";
    const entryMark = {
      time: t.entry_time,
      position: isLong ? "belowBar" : "aboveBar",
      color: isLong ? "#26a69a" : "#ef5350",
      shape: isLong ? "arrowUp" : "arrowDown",
      text: isLong ? "L+" : "S+",
    };
    const exitMark = {
      time: t.exit_time,
      position: isLong ? "aboveBar" : "belowBar",
      color: t.pnl >= 0 ? "#26a69a" : "#ef5350",
      shape: isLong ? "arrowDown" : "arrowUp",
      text: t.exit_reason === "stop_loss" ? "SL" :
            t.exit_reason === "take_profit" ? "TP" :
            (isLong ? "L-" : "S-"),
    };
    markers.push(entryMark, exitMark);
  });
  // Lightweight-charts richiede markers ordinati per time crescente
  markers.sort((a, b) => a.time - b.time);
  return markers;
}

function renderTradesTable(trades) {
  if (trades.length === 0) {
    btTradesEl.innerHTML = "<p style='padding:12px;color:var(--muted);font-size:12px;'>Nessun trade.</p>";
    return;
  }
  const rows = trades.map((t) => {
    const winCls = t.pnl >= 0 ? "trade-win" : "trade-loss";
    const sideCls = t.direction === "long" ? "trade-side-long" : "trade-side-short";
    const entryDate = new Date(t.entry_time * 1000).toISOString().replace("T", " ").slice(0, 16);
    const exitDate = new Date(t.exit_time * 1000).toISOString().replace("T", " ").slice(0, 16);
    return `<tr>
      <td class="${sideCls}">${t.direction.toUpperCase()}</td>
      <td>${entryDate}</td>
      <td>${fmtPrice(t.entry_price)}</td>
      <td>${exitDate}</td>
      <td>${fmtPrice(t.exit_price)}</td>
      <td>${t.exit_reason}</td>
      <td class="${winCls}">${fmtMoney(t.pnl)}</td>
      <td class="${winCls}">${fmtPct(t.return_pct)}</td>
    </tr>`;
  }).join("");
  btTradesEl.innerHTML = `<table>
    <thead><tr>
      <th>Lato</th><th>Entry</th><th>Prezzo</th><th>Exit</th><th>Prezzo</th>
      <th>Motivo</th><th>PnL</th><th>%</th>
    </tr></thead>
    <tbody>${rows}</tbody></table>`;
}

async function runBacktest() {
  let strategy;
  try {
    strategy = JSON.parse(btStrategyEl.value || "{}");
  } catch (e) {
    btStatusEl.textContent = `JSON non valido: ${e.message}`;
    return;
  }
  // Applica la modalità operativa scelta
  const mode = btModeEl.value;
  if (mode === "long") {
    delete strategy.short;
  } else if (mode === "short") {
    delete strategy.long;
  }
  // "both" mantiene sia long che short se presenti
  if (!strategy.long && !strategy.short) {
    btStatusEl.textContent = "La strategia deve avere almeno una sezione 'long' o 'short'.";
    return;
  }

  // Rimuovi SL/TP globali se presenti
  delete strategy.stop_loss_pct;
  delete strategy.take_profit_pct;

  // Applica SL/TP specifici per long
  if (strategy.long) {
    if (!strategy.long) strategy.long = {};
    const slRaw = btSlLongEl.value.trim();
    const tpRaw = btTpLongEl.value.trim();
    if (slRaw !== "") strategy.long.stop_loss_pct = (parseFloat(slRaw) || 0) / 100;
    else delete strategy.long.stop_loss_pct;
    if (tpRaw !== "") strategy.long.take_profit_pct = (parseFloat(tpRaw) || 0) / 100;
    else delete strategy.long.take_profit_pct;
  }

  // Applica SL/TP specifici per short
  if (strategy.short) {
    if (!strategy.short) strategy.short = {};
    const slRaw = btSlShortEl.value.trim();
    const tpRaw = btTpShortEl.value.trim();
    if (slRaw !== "") strategy.short.stop_loss_pct = (parseFloat(slRaw) || 0) / 100;
    else delete strategy.short.stop_loss_pct;
    if (tpRaw !== "") strategy.short.take_profit_pct = (parseFloat(tpRaw) || 0) / 100;
    else delete strategy.short.take_profit_pct;
  }

  ensureCharts();
  btResize();

  const payload = {
    symbol: btSymbolEl.value,
    timeframe: btTimeframeEl.value,
    limit: parseInt(btLimitEl.value, 10) || 500,
    strategy,
    starting_capital: parseFloat(btCapitalEl.value) || 10000,
    fee_pct: (parseFloat(btFeeEl.value) || 0) / 100,
    slippage_pct: (parseFloat(btSlipEl.value) || 0) / 100,
  };

  btStatusEl.textContent = "Eseguo backtest…";
  btRunEl.disabled = true;
  try {
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderMetrics(data.metrics);
    btCandleSeries.setData(data.candles);
    btCandleSeries.setMarkers(tradeMarkers(data.trades));
    btEquitySeries.setData(data.equity_curve.map((p) => ({ time: p.time, value: p.equity })));
    btChart.timeScale().fitContent();
    btEquityChart.timeScale().fitContent();
    renderTradesTable(data.trades);
    btStatusEl.textContent = `Completato: ${data.trades.length} trade su ${data.candles.length} candele.`;
  } catch (err) {
    btStatusEl.textContent = `Errore: ${err.message}`;
  } finally {
    btRunEl.disabled = false;
  }
}

btRunEl.addEventListener("click", runBacktest);

// ---- Init ----

function migrateStrategyJsonIntoFields() {
  // Migra SL/TP dal JSON ai campi dedicati (per compatibility con state salvato)
  try {
    const obj = JSON.parse(btStrategyEl.value);
    let changed = false;
    let didMigrate = false;

    // Estrai SL/TP dai blocchi long/short
    if (obj.long?.stop_loss_pct != null && btSlLongEl.value === "") {
      btSlLongEl.value = obj.long.stop_loss_pct * 100;
      delete obj.long.stop_loss_pct;
      changed = true;
      didMigrate = true;
    }
    if (obj.long?.take_profit_pct != null && btTpLongEl.value === "") {
      btTpLongEl.value = obj.long.take_profit_pct * 100;
      delete obj.long.take_profit_pct;
      changed = true;
      didMigrate = true;
    }
    if (obj.short?.stop_loss_pct != null && btSlShortEl.value === "") {
      btSlShortEl.value = obj.short.stop_loss_pct * 100;
      delete obj.short.stop_loss_pct;
      changed = true;
      didMigrate = true;
    }
    if (obj.short?.take_profit_pct != null && btTpShortEl.value === "") {
      btTpShortEl.value = obj.short.take_profit_pct * 100;
      delete obj.short.take_profit_pct;
      changed = true;
      didMigrate = true;
    }

    // Fallback: SL/TP globali → applica a entrambi
    if (obj.stop_loss_pct != null && !didMigrate) {
      if (btSlLongEl.value === "") btSlLongEl.value = obj.stop_loss_pct * 100;
      if (btSlShortEl.value === "") btSlShortEl.value = obj.stop_loss_pct * 100;
      delete obj.stop_loss_pct;
      changed = true;
    }
    if (obj.take_profit_pct != null && !didMigrate) {
      if (btTpLongEl.value === "") btTpLongEl.value = obj.take_profit_pct * 100;
      if (btTpShortEl.value === "") btTpShortEl.value = obj.take_profit_pct * 100;
      delete obj.take_profit_pct;
      changed = true;
    }

    if (changed) btStrategyEl.value = JSON.stringify(obj, null, 2);
  } catch (e) { /* JSON non parsabile: ignora */ }
}

(async function btInit() {
  const saved = loadBtState();
  if (!btStrategyEl.value) {
    loadBtStrategyFromPreset("rsi_rebound");
  } else {
    migrateStrategyJsonIntoFields();
  }
  await populateBtSymbols(saved && saved.symbol);
  saveBtState();
})();
