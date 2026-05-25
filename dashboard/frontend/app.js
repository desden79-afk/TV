const symbolEl = document.getElementById("symbol");
const timeframeEl = document.getElementById("timeframe");
const reloadEl = document.getElementById("reload");
const statusEl = document.getElementById("status");
const chartEl = document.getElementById("chart");

const chart = LightweightCharts.createChart(chartEl, {
  layout: { background: { color: "#161b25" }, textColor: "#e6e9ef" },
  grid: {
    vertLines: { color: "#232a38" },
    horzLines: { color: "#232a38" },
  },
  timeScale: { timeVisible: true, secondsVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: "#26a69a",
  downColor: "#ef5350",
  borderVisible: false,
  wickUpColor: "#26a69a",
  wickDownColor: "#ef5350",
});

const resize = () => chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
window.addEventListener("resize", resize);
resize();

async function loadCandles() {
  const symbol = symbolEl.value;
  const timeframe = timeframeEl.value;
  statusEl.textContent = `Carico ${symbol} (${timeframe})…`;
  try {
    const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    candleSeries.setData(data);
    chart.timeScale().fitContent();
    statusEl.textContent = `${data.length} candele caricate.`;
  } catch (err) {
    statusEl.textContent = `Errore: ${err.message}`;
  }
}

reloadEl.addEventListener("click", loadCandles);
symbolEl.addEventListener("change", loadCandles);
timeframeEl.addEventListener("change", loadCandles);

loadCandles();
