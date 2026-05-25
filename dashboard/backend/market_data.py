from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import ccxt
import pandas as pd

Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1d"]

SYSTEM_CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt"
SYMBOLS_CACHE_TTL_S = 300  # 5 minuti


def _build_exchange() -> ccxt.Exchange:
    name = os.environ.get("TV_EXCHANGE", "binanceus")
    if not hasattr(ccxt, name):
        raise ValueError(f"Exchange ccxt sconosciuto: {name}")
    ex = getattr(ccxt, name)({"enableRateLimit": True})

    ca = os.environ.get("TV_CA_BUNDLE")
    if not ca and Path(SYSTEM_CA_BUNDLE).is_file():
        ca = SYSTEM_CA_BUNDLE
    if ca:
        # ccxt usa `verify=self.verify and self.validateServerSsl`: per via dello
        # short-circuit di `and`, se entrambi sono truthy vince l'ultimo. Quindi
        # impostiamo entrambi al path del CA bundle per farlo arrivare a requests.
        ex.verify = ca
        ex.validateServerSsl = ca
    return ex


_exchange = _build_exchange()


@dataclass
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


_symbols_cache: dict[str, tuple[float, list[dict]]] = {}


def fetch_top_symbols(quote: str = "USDT", limit: int = 30) -> list[dict]:
    """Restituisce i top N spot pair con la `quote` indicata, ordinati per
    volume 24h espresso nella quote currency."""
    key = f"{quote}:{limit}"
    cached = _symbols_cache.get(key)
    if cached and (time.time() - cached[0]) < SYMBOLS_CACHE_TTL_S:
        return cached[1]

    _exchange.load_markets()
    tickers = _exchange.fetch_tickers()
    rows: list[tuple[float, str, str]] = []
    for symbol, t in tickers.items():
        market = _exchange.markets.get(symbol)
        if not market or not market.get("active", True):
            continue
        if not market.get("spot", True):
            continue
        if market.get("quote") != quote:
            continue
        qv = t.get("quoteVolume") or 0.0
        try:
            qv = float(qv)
        except (TypeError, ValueError):
            qv = 0.0
        rows.append((qv, symbol, market.get("base", "")))

    rows.sort(reverse=True)
    result = [
        {"symbol": symbol, "base": base, "quote": quote, "quoteVolume": qv}
        for qv, symbol, base in rows[:limit]
    ]
    _symbols_cache[key] = (time.time(), result)
    return result


def fetch_ohlcv(
    symbol: str = "BTC/USDT",
    timeframe: Timeframe = "1h",
    limit: int = 500,
) -> list[Candle]:
    raw = _exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["time"] = (df["timestamp"] // 1000).astype(int)
    return [
        Candle(
            time=int(row.time),
            open=float(row.open),
            high=float(row.high),
            low=float(row.low),
            close=float(row.close),
            volume=float(row.volume),
        )
        for row in df.itertuples(index=False)
    ]
