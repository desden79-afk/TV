// ---- Compare tab ----
//
// Esegue N strategie indipendenti sulla stessa serie di candele e
// mostra una tabella metriche affiancata. Ogni slot ha un editor
// JSON libero. Lo stato è persistito in localStorage.

const cmpSymbolEl    = document.getElementById("cmp-symbol");
const cmpTimeframeEl = document.getElementById("cmp-timeframe");
const cmpLimitEl     = document.getElementById("cmp-limit");
const cmpCapitalEl   = document.getElementById("cmp-capital");
const cmpFeeEl       = document.getElementById("cmp-fee");
const cmpSlipEl      = document.getElementById("cmp-slip");
const cmpRunEl       = document.getElementById("cmp-run");
const cmpStatusEl    = document.getElementById("cmp-status");
const cmpAddSlotEl   = document.getElementById("cmp-add-slot");
const cmpSlotsEl     = document.getElementById("cmp-slots");
const cmpResultsWrapEl = document.getElementById("cmp-results-wrap");
const cmpResultsEl   = document.getElementById("cmp-results");

const CMP_STORAGE_KEY = "tv-compare-state-v1";
const CMP_MAX_SLOTS = 6;
const CMP_MIN_SLOTS = 2;

const CMP_DEFAULT_SLOTS = [
  {
    name: "RSI rebound",
    strategy: {
      indicators: [
        { id: "rsi", type: "rsi", params: { period: 14 } },
        { id: "ema_fast", type: "ema", params: { period: 20 } },
        { id: "ema_slow", type: "ema", params: { period: 50 } },
      ],
      long: { entry: "rsi < 30 AND ema_fast > ema_slow", exit: "rsi > 70", stop_loss_pct: 0.03, take_profit_pct: 0.06 },
    },
  },
  {
    name: "Golden cross",
    strategy: {
      indicators: [
        { id: "ema_fast", type: "ema", params: { period: 20 } },
        { id: "ema_slow", type: "ema", params: { period: 50 } },
      ],
      long: { entry: "cross_above(ema_fast, ema_slow)", exit: "cross_below(ema_fast, ema_slow)", stop_loss_pct: 0.05 },
    },
  },
];

// stato locale: lista di { name, json } (json come stringa, così edit grezzo)
let cmpState = {
  slots: CMP_DEFAULT_SLOTS.map((s) => ({
    name: s.name,
    json: JSON.stringify(s.strategy, null, 2),
  })),
};

// ---- persistenza ----

function cmpSaveState() {
  try {
    localStorage.setItem(CMP_STORAGE_KEY, JSON.stringify({
      symbol: cmpSymbolEl.value,
      timeframe: cmpTimeframeEl.value,
      limit: cmpLimitEl.value,
      capital: cmpCapitalEl.value,
      fee: cmpFeeEl.value,
      slip: cmpSlipEl.value,
      slots: cmpState.slots,
    }));
  } catch (e) { /* ignora */ }
}

function cmpLoadState() {
  try {
    const raw = localStorage.getItem(CMP_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p.timeframe) cmpTimeframeEl.value = p.timeframe;
    if (p.limit) cmpLimitEl.value = p.limit;
    if (p.capital) cmpCapitalEl.value = p.capital;
    if (p.fee) cmpFeeEl.value = p.fee;
    if (p.slip) cmpSlipEl.value = p.slip;
    if (Array.isArray(p.slots) && p.slots.length >= CMP_MIN_SLOTS) {
      cmpState.slots = p.slots.slice(0, CMP_MAX_SLOTS).map((s) => ({
        name: typeof s.name === "string" ? s.name : "strategia",
        json: typeof s.json === "string" ? s.json : "{}",
      }));
    }
    return p;
  } catch (e) { return null; }
}

// ---- rendering slot ----

function cmpRenderSlots() {
  cmpSlotsEl.innerHTML = "";
  cmpState.slots.forEach((slot, idx) => {
    const card = document.createElement("div");
    card.className = "cmp-slot";
    card.innerHTML = `
      <div class="cmp-slot-head">
        <span class="cmp-slot-num">#${idx + 1}</span>
        <input class="cmp-slot-name" type="text" value="" placeholder="Nome strategia" />
        <button class="btn-remove cmp-slot-remove" title="Rimuovi slot">×</button>
      </div>
      <textarea class="cmp-slot-json" rows="10" spellcheck="false"></textarea>
    `;
    const nameInput = card.querySelector(".cmp-slot-name");
    const jsonArea = card.querySelector(".cmp-slot-json");
    const removeBtn = card.querySelector(".cmp-slot-remove");

    nameInput.value = slot.name;
    jsonArea.value = slot.json;

    nameInput.addEventListener("input", () => {
      slot.name = nameInput.value;
      cmpSaveState();
    });
    jsonArea.addEventListener("input", () => {
      slot.json = jsonArea.value;
      cmpSaveState();
    });
    removeBtn.addEventListener("click", () => {
      if (cmpState.slots.length <= CMP_MIN_SLOTS) {
        cmpStatusEl.textContent = `Minimo ${CMP_MIN_SLOTS} strategie per il confronto.`;
        return;
      }
      cmpState.slots.splice(idx, 1);
      cmpSaveState();
      cmpRenderSlots();
    });

    cmpSlotsEl.appendChild(card);
  });
  cmpAddSlotEl.disabled = cmpState.slots.length >= CMP_MAX_SLOTS;
}

function cmpAddSlot() {
  if (cmpState.slots.length >= CMP_MAX_SLOTS) return;
  cmpState.slots.push({
    name: `Strategia ${cmpState.slots.length + 1}`,
    json: JSON.stringify({
      indicators: [],
      long: { entry: "", exit: "" },
    }, null, 2),
  });
  cmpSaveState();
  cmpRenderSlots();
}

cmpAddSlotEl.addEventListener("click", cmpAddSlot);

// ---- popolamento simboli ----

async function cmpPopulateSymbols(preferred) {
  try {
    const res = await fetch("/api/symbols?limit=30");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    cmpSymbolEl.innerHTML = "";
    list.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.symbol;
      opt.textContent = s.symbol;
      cmpSymbolEl.appendChild(opt);
    });
    if (preferred) {
      if (![...cmpSymbolEl.options].some((o) => o.value === preferred)) {
        const opt = document.createElement("option");
        opt.value = preferred;
        opt.textContent = `${preferred} (salvato)`;
        cmpSymbolEl.insertBefore(opt, cmpSymbolEl.firstChild);
      }
      cmpSymbolEl.value = preferred;
    }
  } catch (e) {
    const opt = document.createElement("option");
    opt.value = "BTC/USDT"; opt.textContent = "BTC/USDT";
    cmpSymbolEl.appendChild(opt);
  }
}

[cmpSymbolEl, cmpTimeframeEl, cmpLimitEl, cmpCapitalEl, cmpFeeEl, cmpSlipEl]
  .forEach((el) => el.addEventListener("change", cmpSaveState));

// ---- formatter (riusano stile di backtest.js, ma indipendenti) ----

function cmpFmtPct(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return (v * 100).toFixed(digits) + "%";
}
function cmpFmtMoney(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function cmpFmtNum(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

// ---- rendering tabella metriche ----

// Definizione metriche: chiave, label, formatter, "miglior valore" (max|min)
const CMP_METRICS = [
  { key: "total_return_pct", label: "Return totale", fmt: cmpFmtPct, best: "max" },
  { key: "final_equity",     label: "Equity finale", fmt: cmpFmtMoney, best: "max" },
  { key: "num_trades",       label: "N. trade", fmt: (v) => v ?? "—", best: null },
  { key: "win_rate",         label: "Win rate", fmt: (v) => cmpFmtPct(v, 1), best: "max" },
  { key: "profit_factor",    label: "Profit factor", fmt: (v) => v == null ? "∞" : cmpFmtNum(v), best: "max" },
  { key: "max_drawdown_pct", label: "Max drawdown", fmt: cmpFmtPct, best: "max" }, // dd è negativo: max è il meno peggio
  { key: "avg_win_pct",      label: "Avg win", fmt: cmpFmtPct, best: "max" },
  { key: "avg_loss_pct",     label: "Avg loss", fmt: cmpFmtPct, best: "max" }, // loss è negativo: max = meno peggio
];

function cmpBestIndex(values, mode) {
  if (!mode) return -1;
  let bestIdx = -1;
  let bestVal = null;
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) return;
    if (bestVal == null || (mode === "max" ? v > bestVal : v < bestVal)) {
      bestVal = v;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function cmpRenderResults(results) {
  // results: [{ name, metrics?, num_trades?, error? }]
  cmpResultsWrapEl.classList.remove("hidden");

  const headerCells = ["<th>Metrica</th>"].concat(
    results.map((r, i) => `<th class="cmp-col-head">#${i + 1} ${escapeHtml(r.name || "—")}</th>`)
  ).join("");

  const errorRow = results.some((r) => r.error)
    ? `<tr class="cmp-error-row"><td>Errore</td>${
        results.map((r) => `<td>${r.error ? `<span class="cmp-err">${escapeHtml(r.error)}</span>` : "ok"}</td>`).join("")
      }</tr>`
    : "";

  const metricRows = CMP_METRICS.map((m) => {
    const values = results.map((r) => (r.metrics ? r.metrics[m.key] : null));
    const bestIdx = cmpBestIndex(values, m.best);
    const cells = values.map((v, i) => {
      const isBest = i === bestIdx && results.length > 1;
      const cls = isBest ? " class=\"cmp-best\"" : "";
      return `<td${cls}>${m.fmt(v)}</td>`;
    }).join("");
    return `<tr><th class="cmp-row-head">${m.label}</th>${cells}</tr>`;
  }).join("");

  cmpResultsEl.innerHTML = `
    <table class="cmp-table">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${errorRow}${metricRows}</tbody>
    </table>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---- esecuzione ----

async function cmpRun() {
  // Valida ogni slot localmente prima di inviare
  const strategies = [];
  for (let i = 0; i < cmpState.slots.length; i++) {
    const slot = cmpState.slots[i];
    let strategy;
    try {
      strategy = JSON.parse(slot.json || "{}");
    } catch (e) {
      cmpStatusEl.textContent = `Slot #${i + 1} (${slot.name}): JSON non valido — ${e.message}`;
      return;
    }
    if (!strategy.long && !strategy.short) {
      cmpStatusEl.textContent = `Slot #${i + 1} (${slot.name}): manca 'long' o 'short'.`;
      return;
    }
    strategies.push({ name: slot.name || `Strategia ${i + 1}`, strategy });
  }

  const payload = {
    symbol: cmpSymbolEl.value,
    timeframe: cmpTimeframeEl.value,
    limit: parseInt(cmpLimitEl.value, 10) || 500,
    starting_capital: parseFloat(cmpCapitalEl.value) || 10000,
    fee_pct: (parseFloat(cmpFeeEl.value) || 0) / 100,
    slippage_pct: (parseFloat(cmpSlipEl.value) || 0) / 100,
    strategies,
  };

  cmpStatusEl.textContent = `Eseguo ${strategies.length} strategie…`;
  cmpRunEl.disabled = true;
  try {
    const res = await fetch("/api/backtest/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    cmpRenderResults(data.results);
    const okCount = data.results.filter((r) => !r.error).length;
    cmpStatusEl.textContent = `Completato: ${okCount}/${data.results.length} ok su ${data.candles_count} candele.`;
  } catch (err) {
    cmpStatusEl.textContent = `Errore: ${err.message}`;
  } finally {
    cmpRunEl.disabled = false;
  }
}

cmpRunEl.addEventListener("click", cmpRun);

// Hook chiamato da backtest.js quando si attiva il tab Confronto
// eslint-disable-next-line no-unused-vars
function cmpOnTabActivate() {
  // se l'utente non ha mai impostato un simbolo nel tab confronto,
  // eredita quello del tab Grafico
  if (cmpSymbolEl.value === "" && typeof symbolEl !== "undefined" && symbolEl.value) {
    if ([...cmpSymbolEl.options].some((o) => o.value === symbolEl.value)) {
      cmpSymbolEl.value = symbolEl.value;
    }
  }
}

// ---- init ----

(async function cmpInit() {
  const saved = cmpLoadState();
  cmpRenderSlots();
  await cmpPopulateSymbols(saved && saved.symbol);
  cmpSaveState();
})();
