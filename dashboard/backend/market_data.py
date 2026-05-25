from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import ccxt
import pandas as pd

Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1d"]

_exchange = ccxt.binance({"enableRateLimit": True})


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
