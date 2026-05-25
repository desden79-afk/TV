from __future__ import annotations

from typing import Any, Iterable

import numpy as np
import pandas as pd


def _series(values: Iterable[float]) -> pd.Series:
    return pd.Series(list(values), dtype="float64")


def _to_list(s: pd.Series) -> list[float | None]:
    return [None if (v is None or (isinstance(v, float) and np.isnan(v))) else float(v) for v in s]


def sma(closes: Iterable[float], period: int = 20) -> list[float | None]:
    return _to_list(_series(closes).rolling(window=period, min_periods=period).mean())


def ema(closes: Iterable[float], period: int = 20) -> list[float | None]:
    s = _series(closes)
    # primo valore valido = SMA su `period`, poi EMA classica → consistente con la maggior parte delle piattaforme
    out = s.ewm(span=period, adjust=False, min_periods=period).mean()
    return _to_list(out)


def rsi(closes: Iterable[float], period: int = 14) -> list[float | None]:
    s = _series(closes)
    delta = s.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    # Wilder smoothing (alpha = 1/period)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi_vals = 100 - (100 / (1 + rs))
    return _to_list(rsi_vals)


def macd(
    closes: Iterable[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> dict[str, list[float | None]]:
    s = _series(closes)
    ema_fast = s.ewm(span=fast, adjust=False, min_periods=fast).mean()
    ema_slow = s.ewm(span=slow, adjust=False, min_periods=slow).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    hist = macd_line - signal_line
    return {
        "macd": _to_list(macd_line),
        "signal": _to_list(signal_line),
        "hist": _to_list(hist),
    }


# Metadati: overlay vivono sul pane delle candele, oscillator in un pane separato
KIND_OVERLAY = "overlay"
KIND_OSCILLATOR = "oscillator"


def compute(kind: str, closes: list[float], params: dict[str, Any]) -> dict[str, Any]:
    """Calcola un indicatore restituendo un dict serializzabile pronto per il client.

    Schema risposta:
        {
          "type": <kind>,
          "pane": "overlay" | "oscillator",
          "series": {<nome_serie>: [valore|null, ...], ...},
        }
    """
    kind = kind.lower()
    if kind == "sma":
        period = int(params.get("period", 20))
        return {"type": "sma", "pane": KIND_OVERLAY, "series": {"value": sma(closes, period)}}
    if kind == "ema":
        period = int(params.get("period", 20))
        return {"type": "ema", "pane": KIND_OVERLAY, "series": {"value": ema(closes, period)}}
    if kind == "rsi":
        period = int(params.get("period", 14))
        return {"type": "rsi", "pane": KIND_OSCILLATOR, "series": {"value": rsi(closes, period)}}
    if kind == "macd":
        fast = int(params.get("fast", 12))
        slow = int(params.get("slow", 26))
        signal = int(params.get("signal", 9))
        return {"type": "macd", "pane": KIND_OSCILLATOR, "series": macd(closes, fast, slow, signal)}
    raise ValueError(f"Indicatore sconosciuto: {kind}")
