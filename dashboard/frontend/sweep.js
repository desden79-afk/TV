// ---- Sweep tab ----
//
// Grid search di 1 o 2 parametri della stessa strategia.
// 1 variabile  → tabella (riga = valore, colonne = metriche)
// 2 variabili → heatmap (righe = var1, colonne = var2) sulla metrica scelta

const swSymbolEl    = document.getElementById("sw-symbol");
const swTimeframeEl = document.getElementById("sw-timeframe");
const swLimitEl     = document.getElementById("sw-limit");
const swCapitalEl   = document.getElementById("sw-capital");
const swFeeEl       = document.getElementById("sw-fee");
const swSlipEl      = document.getElementById("sw-slip");
const swRunEl       = document.getElementById("sw-run");
const swStatusEl    = document.getElementById("sw-status");
const swLoadEl      = document.getElementById("sw-load");
const swStrategyEl  = document.getElementById("sw-strategy");
const swVarsEl      = document.getElementById("sw-vars");
const swMetricEl    = document.getElementById("sw-metric");
const swBestEl      = document.getElementById("sw-best");
const swResultsWrapEl = document.getElementById("sw-results-wrap");
const swResultsEl   = document.getElementById("sw-results");

const SW_STORAGE_KEY = "tv-sweep-state-v1";

// Riusiamo i preset definiti in compare.js
const SW_BUILTIN_PRESETS = (typeof CMP_BUILTIN_PRESETS !== "undefined") ? CMP_BUILTIN_PRESETS : {};

// Stato locale: variabili sweep (1 o 2)
let swState = {
  variables: [{ path: "", spec: "" }],  // spec è la stringa grezza inserita dall'utente
  lastResults: null,
};

// ---- persistenza ----

function swSaveState() {
  try {
    localStorage.setItem(SW_STORAGE_KEY, JSON.stringify({
      symbol: swSymbolEl.value,
      timeframe: swTimeframeEl.value,
      limit: swLimitEl.value,
      capital: swCapitalEl.value,
      fee: swFeeEl.value,
      slip: swSlipEl.value,
      strategy: swStrategyEl.value,
      variables: swState.variables,
      metric: swMetricEl.value,
    }));
  } catch (e) { /* ignora */ }
}

function swLoadState() {
  try {
    const raw = localStorage.getItem(SW_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p.timeframe) swTimeframeEl.value = p.timeframe;
    if (p.limit) swLimitEl.value = p.limit;
    if (p.capital) swCapitalEl.value = p.capital;
    if (p.fee) swFeeEl.value = p.fee;
    if (p.slip) swSlipEl.value = p.slip;
    if (p.strategy) swStrategyEl.value = p.strategy;
    if (p.metric) swMetricEl.value = p.metric;
    if (Array.isArray(p.variables) && p.variables.length >= 1) {
      swState.variables = p.variables.slice(0, 2).map((v) => ({
        path: typeof v.path === "string" ? v.path : "",
        spec: typeof v.spec === "string" ? v.spec : "",
      }));
    }
    return p;
  } catch (e) { return null; }
}

// ---- escape helper ----
function swEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---- discovery dei parametri numerici della strategia ----

// Ritorna lista di { path, label, current } per ogni numero modificabile
// individuato nella strategia.
function swDiscoverParams(strategy) {
  const out = [];
  if (!strategy || typeof strategy !== "object") return out;
  // indicators
  if (Array.isArray(strategy.indicators)) {
    strategy.indicators.forEach((ind, i) => {
      if (ind && typeof ind === "object" && ind.params && typeof ind.params === "object") {
        Object.entries(ind.params).forEach(([k, v]) => {
          if (typeof v === "number" && Number.isFinite(v)) {
            const idLabel = ind.id || ind.type || `#${i}`;
            out.push({
              path: `indicators.${i}.params.${k}`,
              label: `${idLabel}.${k}`,
              current: v,
            });
          }
        });
      }
    });
  }
  // SL/TP long/short
  ["long", "short"].forEach((side) => {
    const s = strategy[side];
    if (s && typeof s === "object") {
      ["stop_loss_pct", "take_profit_pct"].forEach((k) => {
        if (typeof s[k] === "number" && Number.isFinite(s[k])) {
          out.push({
            path: `${side}.${k}`,
            label: `${side}.${k}`,
            current: s[k],
          });
        }
      });
    }
  });
  return out;
}

function swParseStrategy() {
  try { return JSON.parse(swStrategyEl.value || "{}"); }
  catch (e) { return null; }
}

// Parsa la spec "v1,v2,v3" oppure "min:max:step"
function swParseValues(spec) {
  const s = String(spec || "").trim();
  if (!s) return [];
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => parseFloat(x.trim()));
    if (parts.length < 2 || parts.some((x) => !Number.isFinite(x))) {
      throw new Error(`Range non valido: "${spec}"`);
    }
    const [min, max, stepRaw] = parts;
    const step = parts.length >= 3 ? stepRaw : 1;
    if (step <= 0) throw new Error(`Step deve essere positivo: "${spec}"`);
    if (max < min) throw new Error(`max < min: "${spec}"`);
    const out = [];
    // protezione: niente esplosioni
    let v = min;
    let i = 0;
    while (v <= max + 1e-9 && i < 1000) {
      out.push(parseFloat(v.toFixed(10)));
      v += step;
      i++;
    }
    return out;
  }
  return s.split(",").map((x) => {
    const n = parseFloat(x.trim());
    if (!Number.isFinite(n)) throw new Error(`Valore non numerico: "${x}"`);
    return n;
  });
}

// ---- rendering della sezione variabili ----

function swRenderVarsUI() {
  const params = swDiscoverParams(swParseStrategy());
  const opts = ['<option value="">— scegli parametro —</option>']
    .concat(params.map((p) =>
      `<option value="${swEscape(p.path)}">${swEscape(p.label)} (attuale: ${p.current})</option>`
    )).join("");

  swVarsEl.innerHTML = "";
  swState.variables.forEach((v, idx) => {
    const row = document.createElement("div");
    row.className = "sw-var-row";
    row.innerHTML = `
      <div class="sw-var-head">
        <span class="sw-var-num">Var #${idx + 1}</span>
        <select class="sw-var-path">${opts}</select>
        <button class="btn-remove sw-var-remove" title="Rimuovi variabile">×</button>
      </div>
      <input class="sw-var-spec" type="text" placeholder="es: 10,14,20,30  oppure  10:30:5" />
    `;
    const pathSel = row.querySelector(".sw-var-path");
    const specInp = row.querySelector(".sw-var-spec");
    const removeBtn = row.querySelector(".sw-var-remove");
    pathSel.value = v.path;
    specInp.value = v.spec;
    pathSel.addEventListener("change", () => { v.path = pathSel.value; swSaveState(); });
    specInp.addEventListener("input", () => { v.spec = specInp.value; swSaveState(); });
    removeBtn.addEventListener("click", () => {
      if (swState.variables.length === 1) {
        swStatusEl.textContent = "Almeno una variabile è obbligatoria.";
        return;
      }
      swState.variables.splice(idx, 1);
      swSaveState();
      swRenderVarsUI();
    });
    swVarsEl.appendChild(row);
  });

  if (swState.variables.length < 2) {
    const addBtn = document.createElement("button");
    addBtn.className = "btn-secondary sw-var-add";
    addBtn.textContent = "+ Aggiungi seconda variabile (heatmap)";
    addBtn.addEventListener("click", () => {
      swState.variables.push({ path: "", spec: "" });
      swSaveState();
      swRenderVarsUI();
    });
    swVarsEl.appendChild(addBtn);
  }
}

swStrategyEl.addEventListener("input", () => {
  swSaveState();
  // re-discover quando il JSON cambia
  swRenderVarsUI();
});

// ---- "Carica da" (preset + libreria) ----

function swBuildLoadOptions() {
  const opts = ['<option value="">— carica da… —</option>'];
  const presets = Object.entries(SW_BUILTIN_PRESETS);
  if (presets.length) {
    opts.push('<optgroup label="Preset">');
    presets.forEach(([k, v]) => {
      opts.push(`<option value="preset:${k}">${swEscape(v.name)}</option>`);
    });
    opts.push("</optgroup>");
  }
  const saved = window.strategyLibrary ? window.strategyLibrary.list() : [];
  if (saved.length) {
    opts.push('<optgroup label="Le mie strategie">');
    saved.forEach((n) => opts.push(`<option value="saved:${swEscape(n)}">${swEscape(n)}</option>`));
    opts.push("</optgroup>");
  }
  return opts.join("");
}

function swRefreshLoadDropdown() {
  const cur = swLoadEl.value;
  swLoadEl.innerHTML = swBuildLoadOptions();
  swLoadEl.value = cur;
}

swLoadEl.addEventListener("change", () => {
  const v = swLoadEl.value;
  if (!v) return;
  let strategy = null;
  if (v.startsWith("preset:")) {
    const p = SW_BUILTIN_PRESETS[v.slice(7)];
    if (p) strategy = p.strategy;
  } else if (v.startsWith("saved:")) {
    const name = v.slice(6);
    strategy = window.strategyLibrary ? window.strategyLibrary.get(name) : null;
  }
  if (!strategy) return;
  swStrategyEl.value = JSON.stringify(strategy, null, 2);
  // reset variabili al cambio strategia (i path discoverati cambiano)
  swState.variables = [{ path: "", spec: "" }];
  swSaveState();
  swRenderVarsUI();
});

if (window.strategyLibrary) {
  window.strategyLibrary.subscribe(swRefreshLoadDropdown);
}

// ---- simboli ----

async function swPopulateSymbols(preferred) {
  try {
    const res = await fetch("/api/symbols?limit=30");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    swSymbolEl.innerHTML = "";
    list.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.symbol;
      opt.textContent = s.symbol;
      swSymbolEl.appendChild(opt);
    });
    if (preferred) {
      if (![...swSymbolEl.options].some((o) => o.value === preferred)) {
        const opt = document.createElement("option");
        opt.value = preferred;
        opt.textContent = `${preferred} (salvato)`;
        swSymbolEl.insertBefore(opt, swSymbolEl.firstChild);
      }
      swSymbolEl.value = preferred;
    }
  } catch (e) {
    const opt = document.createElement("option");
    opt.value = "BTC/USDT"; opt.textContent = "BTC/USDT";
    swSymbolEl.appendChild(opt);
  }
}

[swSymbolEl, swTimeframeEl, swLimitEl, swCapitalEl, swFeeEl, swSlipEl, swMetricEl]
  .forEach((el) => el.addEventListener("change", () => {
    swSaveState();
    if (el === swMetricEl && swState.lastResults) {
      swRenderResults(swState.lastResults);
    }
  }));

// ---- formatter ----

function swFmtMetric(key, v) {
  if (v == null || Number.isNaN(v)) return "—";
  if (key === "total_return_pct" || key === "win_rate" || key === "max_drawdown_pct"
      || key === "avg_win_pct" || key === "avg_loss_pct") {
    return (v * 100).toFixed(2) + "%";
  }
  if (key === "num_trades") return String(v);
  if (key === "profit_factor") return v.toFixed(2);
  return v.toFixed(2);
}

function swFmtVal(v) {
  if (Number.isInteger(v)) return String(v);
  return Number(v).toFixed(4).replace(/\.?0+$/, "");
}

// ---- rendering risultati ----

const SW_TABLE_METRICS = [
  ["total_return_pct", "Return"],
  ["final_equity", "Equity"],
  ["num_trades", "Trade"],
  ["win_rate", "Win %"],
  ["profit_factor", "PF"],
  ["max_drawdown_pct", "Max DD"],
  ["sharpe", "Sharpe"],
  ["sortino", "Sortino"],
];

function swMetricValue(res, key) {
  if (!res.metrics) return null;
  return res.metrics[key];
}

function swBestRow(results, key) {
  // ritorna l'indice del risultato con il valore "migliore" (massimo, drawdown
  // incluso perché è negativo: max = meno peggio); ignora errori e null
  let bestIdx = -1;
  let bestVal = null;
  results.forEach((r, i) => {
    if (r.error) return;
    const v = swMetricValue(r, key);
    if (v == null || Number.isNaN(v)) return;
    if (bestVal == null || v > bestVal) { bestVal = v; bestIdx = i; }
  });
  return bestIdx;
}

function swRenderTable1D(data) {
  const variable = data.variables[0];
  const results = data.results;
  const bestIdx = swBestRow(results, swMetricEl.value);

  const head = `<tr>
    <th class="sw-row-head">${swEscape(variable.path)}</th>
    ${SW_TABLE_METRICS.map(([k, label]) => `<th>${label}</th>`).join("")}
  </tr>`;

  const rows = results.map((r, i) => {
    if (r.error) {
      return `<tr class="sw-err-row">
        <td>${swFmtVal(r.combo[variable.path])}</td>
        <td colspan="${SW_TABLE_METRICS.length}" class="cmp-err">${swEscape(r.error)}</td>
      </tr>`;
    }
    const cells = SW_TABLE_METRICS.map(([k]) => {
      const cls = (k === swMetricEl.value) ? " sw-metric-col" : "";
      return `<td class="${cls.trim()}">${swFmtMetric(k, swMetricValue(r, k))}</td>`;
    }).join("");
    const trCls = (i === bestIdx) ? " class=\"sw-best-row\"" : "";
    return `<tr${trCls}><td class="sw-row-head">${swFmtVal(r.combo[variable.path])}</td>${cells}</tr>`;
  }).join("");

  swResultsEl.innerHTML = `<table class="sw-table sw-table-1d">
    <thead>${head}</thead>
    <tbody>${rows}</tbody>
  </table>`;

  if (bestIdx >= 0) {
    const best = results[bestIdx];
    swBestEl.textContent = `Migliore: ${variable.path} = ${swFmtVal(best.combo[variable.path])} (${swFmtMetric(swMetricEl.value, swMetricValue(best, swMetricEl.value))})`;
  } else {
    swBestEl.textContent = "";
  }
}

function swColorScale(v, min, max) {
  // gradient rosso → giallo → verde
  if (v == null || Number.isNaN(v) || max === min) return "#1d2330";
  const t = (v - min) / (max - min); // 0..1
  // interpolazione lineare via HSL: hue 0 (rosso) → 60 (giallo) → 120 (verde)
  const hue = t * 120;
  return `hsl(${hue.toFixed(0)}, 55%, 32%)`;
}

function swRenderHeatmap2D(data) {
  const v1 = data.variables[0];
  const v2 = data.variables[1];
  const metricKey = swMetricEl.value;
  const results = data.results;

  // mappa { val1 -> { val2 -> result } }
  const map = new Map();
  results.forEach((r) => {
    const a = r.combo[v1.path];
    const b = r.combo[v2.path];
    if (!map.has(a)) map.set(a, new Map());
    map.get(a).set(b, r);
  });

  const xs = v2.values;
  const ys = v1.values;

  // calcola min/max della metrica per la scala colori
  let mn = null, mx = null;
  let bestVal = null, bestY = null, bestX = null;
  results.forEach((r) => {
    if (r.error) return;
    const v = swMetricValue(r, metricKey);
    if (v == null || Number.isNaN(v)) return;
    if (mn == null || v < mn) mn = v;
    if (mx == null || v > mx) mx = v;
    if (bestVal == null || v > bestVal) {
      bestVal = v; bestY = r.combo[v1.path]; bestX = r.combo[v2.path];
    }
  });

  const head = `<tr>
    <th class="sw-row-head">${swEscape(v1.path)} \\ ${swEscape(v2.path)}</th>
    ${xs.map((x) => `<th>${swFmtVal(x)}</th>`).join("")}
  </tr>`;

  const rows = ys.map((y) => {
    const cells = xs.map((x) => {
      const r = map.get(y)?.get(x);
      if (!r || r.error) {
        const title = r && r.error ? swEscape(r.error) : "n/d";
        return `<td class="sw-cell sw-cell-err" title="${title}">—</td>`;
      }
      const v = swMetricValue(r, metricKey);
      const bg = swColorScale(v, mn, mx);
      const isBest = (bestVal != null && y === bestY && x === bestX);
      const cls = isBest ? "sw-cell sw-best-cell" : "sw-cell";
      return `<td class="${cls}" style="background:${bg}" title="${swEscape(v1.path)}=${swFmtVal(y)}, ${swEscape(v2.path)}=${swFmtVal(x)}">${swFmtMetric(metricKey, v)}</td>`;
    }).join("");
    return `<tr><td class="sw-row-head">${swFmtVal(y)}</td>${cells}</tr>`;
  }).join("");

  swResultsEl.innerHTML = `<table class="sw-table sw-table-2d">
    <thead>${head}</thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sw-heatmap-scale">
    <span>min: ${swFmtMetric(metricKey, mn)}</span>
    <span class="sw-grad"></span>
    <span>max: ${swFmtMetric(metricKey, mx)}</span>
  </div>`;

  if (bestVal != null) {
    swBestEl.textContent = `Migliore: ${v1.path}=${swFmtVal(bestY)}, ${v2.path}=${swFmtVal(bestX)} (${swFmtMetric(metricKey, bestVal)})`;
  } else {
    swBestEl.textContent = "";
  }
}

function swRenderResults(data) {
  swState.lastResults = data;
  swResultsWrapEl.classList.remove("hidden");
  if (data.variables.length === 1) swRenderTable1D(data);
  else swRenderHeatmap2D(data);
}

// ---- esecuzione ----

async function swRun() {
  // 1) Strategia
  let strategy;
  try { strategy = JSON.parse(swStrategyEl.value || "{}"); }
  catch (e) { swStatusEl.textContent = `JSON strategia non valido: ${e.message}`; return; }

  // 2) Variabili
  const vars = [];
  for (let i = 0; i < swState.variables.length; i++) {
    const v = swState.variables[i];
    if (!v.path) { swStatusEl.textContent = `Var #${i + 1}: scegli un parametro.`; return; }
    let values;
    try { values = swParseValues(v.spec); }
    catch (e) { swStatusEl.textContent = `Var #${i + 1}: ${e.message}`; return; }
    if (values.length === 0) { swStatusEl.textContent = `Var #${i + 1}: nessun valore.`; return; }
    vars.push({ path: v.path, values });
  }

  const combos = vars.reduce((acc, v) => acc * v.values.length, 1);
  if (combos > 200) {
    swStatusEl.textContent = `Troppe combinazioni (${combos}): massimo 200.`;
    return;
  }

  const payload = {
    symbol: swSymbolEl.value,
    timeframe: swTimeframeEl.value,
    limit: parseInt(swLimitEl.value, 10) || 500,
    starting_capital: parseFloat(swCapitalEl.value) || 10000,
    fee_pct: (parseFloat(swFeeEl.value) || 0) / 100,
    slippage_pct: (parseFloat(swSlipEl.value) || 0) / 100,
    strategy,
    variables: vars,
  };

  swStatusEl.textContent = `Eseguo sweep su ${combos} combinazioni…`;
  swRunEl.disabled = true;
  try {
    const res = await fetch("/api/backtest/sweep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(window.formatApiError(err, res.status));
    }
    const data = await res.json();
    swRenderResults(data);
    const okCount = data.results.filter((r) => !r.error).length;
    swStatusEl.textContent = `Completato: ${okCount}/${data.results.length} ok su ${data.candles_count} candele.`;
  } catch (err) {
    swStatusEl.textContent = `Errore: ${err.message}`;
  } finally {
    swRunEl.disabled = false;
  }
}

swRunEl.addEventListener("click", swRun);

// hook chiamato dal tab switcher (non-essenziale ma utile per estensioni)
// eslint-disable-next-line no-unused-vars
function swOnTabActivate() { /* no-op */ }

// ---- init ----

(async function swInit() {
  const saved = swLoadState();
  if (!swStrategyEl.value) {
    // strategia iniziale di esempio
    const p = SW_BUILTIN_PRESETS.rsi_rebound;
    if (p) swStrategyEl.value = JSON.stringify(p.strategy, null, 2);
  }
  swRefreshLoadDropdown();
  swRenderVarsUI();
  await swPopulateSymbols(saved && saved.symbol);
  swSaveState();
})();
