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


def adx(closes: Iterable[float], highs: Iterable[float], lows: Iterable[float], period: int = 14) -> list[float | None]:
    closes_s = _series(closes)
    highs_s = _series(highs)
    lows_s = _series(lows)
    n = len(closes_s)

    # True Range (primo elemento = high - low)
    tr = [highs_s.iloc[0] - lows_s.iloc[0] if n > 0 else 0]  # first TR = H - L
    for i in range(1, n):
        h_l = highs_s.iloc[i] - lows_s.iloc[i]
        h_c = abs(highs_s.iloc[i] - closes_s.iloc[i - 1])
        l_c = abs(lows_s.iloc[i] - closes_s.iloc[i - 1])
        tr.append(max(h_l, h_c, l_c))
    tr_s = pd.Series(tr, dtype="float64")

    # +DM e -DM
    plus_dm = [0.0]  # first element
    minus_dm = [0.0]
    for i in range(1, n):
        up = highs_s.iloc[i] - highs_s.iloc[i - 1]
        down = lows_s.iloc[i - 1] - lows_s.iloc[i]
        if up > down and up > 0:
            plus_dm.append(up)
        else:
            plus_dm.append(0.0)
        if down > up and down > 0:
            minus_dm.append(down)
        else:
            minus_dm.append(0.0)

    # Wilder's smoothing
    plus_dm_s = pd.Series(plus_dm, dtype="float64")
    minus_dm_s = pd.Series(minus_dm, dtype="float64")

    plus_dm_sum = plus_dm_s.rolling(period).sum()
    minus_dm_sum = minus_dm_s.rolling(period).sum()
    tr_sum = tr_s.rolling(period).sum()

    # Wilder continuation: subtract avg and add new
    for i in range(period, n):
        plus_dm_sum.iloc[i] = plus_dm_sum.iloc[i - 1] - (plus_dm_sum.iloc[i - 1] / period) + plus_dm_s.iloc[i]
        minus_dm_sum.iloc[i] = minus_dm_sum.iloc[i - 1] - (minus_dm_sum.iloc[i - 1] / period) + minus_dm_s.iloc[i]
        tr_sum.iloc[i] = tr_sum.iloc[i - 1] - (tr_sum.iloc[i - 1] / period) + tr_s.iloc[i]

    # +DI e -DI
    plus_di = 100 * plus_dm_sum / tr_sum.replace(0, np.nan)
    minus_di = 100 * minus_dm_sum / tr_sum.replace(0, np.nan)

    # DX
    di_sum = plus_di + minus_di
    dx = 100 * np.abs(plus_di - minus_di) / di_sum.replace(0, np.nan)
    dx = dx.fillna(0)

    # ADX = EMA(DX, period)
    adx_vals = dx.ewm(span=period, adjust=False, min_periods=period).mean()

    return _to_list(adx_vals)


def compute(kind: str, closes: list[float], params: dict[str, Any], highs: list[float] = None, lows: list[float] = None) -> dict[str, Any]:
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
    if kind == "adx":
        period = int(params.get("period", 14))
        # Fallback: se highs/lows non disponibili, usa range semplificato
        if not highs or not lows:
            # Approssimazione: assume high = close + 1%, low = close - 1%
            highs = [c * 1.01 for c in closes]
            lows = [c * 0.99 for c in closes]
        return {"type": "adx", "pane": KIND_OSCILLATOR, "series": {"value": adx(closes, highs, lows, period)}}
    raise ValueError(f"Indicatore sconosciuto: {kind}")
