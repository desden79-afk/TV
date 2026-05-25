from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import ccxt
import pandas as pd

Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1d"]

SYSTEM_CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt"


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
