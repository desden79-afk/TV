"""Test della rotta /api/backtest/sweep."""
from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from dashboard.backend.main import app
from dashboard.backend.market_data import Candle


def _fake_candles(n: int = 200) -> list[Candle]:
    out = []
    for i in range(n):
        base = 100.0 + i * 0.4
        # alterna salita/discesa per generare un po' di volatilità
        oscill = 5.0 if i % 5 == 0 else (-3.0 if i % 7 == 0 else 0.0)
        c = base + oscill
        out.append(Candle(time=1700000000 + i * 3600, open=base, high=base + 2.0,
                          low=base - 2.0, close=c, volume=10.0))
    return out


def test_sweep_1d_varies_indicator_param():
    strategy = {
        "indicators": [{"id": "rsi", "type": "rsi", "params": {"period": 14}}],
        "long": {"entry": "rsi < 40", "exit": "rsi > 60"},
    }
    with patch("dashboard.backend.main.fetch_ohlcv", return_value=_fake_candles(200)):
        client = TestClient(app)
        r = client.post("/api/backtest/sweep", json={
            "strategy": strategy,
            "variables": [{"path": "indicators.0.params.period", "values": [7, 14, 21]}],
        })
    assert r.status_code == 200
    data = r.json()
    assert len(data["results"]) == 3
    for res in data["results"]:
        assert "error" not in res
        assert "metrics" in res
        assert "sharpe" in res["metrics"]
        # combo deve contenere il path → valore
        assert "indicators.0.params.period" in res["combo"]


def test_sweep_2d_cartesian_product():
    strategy = {
        "indicators": [
            {"id": "ema_fast", "type": "ema", "params": {"period": 10}},
            {"id": "ema_slow", "type": "ema", "params": {"period": 30}},
        ],
        "long": {"entry": "cross_above(ema_fast, ema_slow)",
                 "exit": "cross_below(ema_fast, ema_slow)"},
    }
    with patch("dashboard.backend.main.fetch_ohlcv", return_value=_fake_candles(200)):
        client = TestClient(app)
        r = client.post("/api/backtest/sweep", json={
            "strategy": strategy,
            "variables": [
                {"path": "indicators.0.params.period", "values": [5, 10, 15]},
                {"path": "indicators.1.params.period", "values": [25, 35]},
            ],
        })
    assert r.status_code == 200
    data = r.json()
    assert len(data["results"]) == 3 * 2
    combos = {tuple(sorted(r["combo"].items())) for r in data["results"]}
    assert len(combos) == 6  # tutte distinte


def test_sweep_sl_path():
    strategy = {
        "indicators": [],
        "long": {"entry": "close > 0", "exit": "close < 0", "stop_loss_pct": 0.05},
    }
    with patch("dashboard.backend.main.fetch_ohlcv", return_value=_fake_candles(100)):
        client = TestClient(app)
        r = client.post("/api/backtest/sweep", json={
            "strategy": strategy,
            "variables": [{"path": "long.stop_loss_pct", "values": [0.02, 0.05, 0.10]}],
        })
    assert r.status_code == 200
    data = r.json()
    assert len(data["results"]) == 3
    for res in data["results"]:
        assert "long.stop_loss_pct" in res["combo"]


def test_sweep_invalid_path_isolated_per_combo():
    strategy = {"indicators": [], "long": {"entry": "close > 0", "exit": "close < 0"}}
    with patch("dashboard.backend.main.fetch_ohlcv", return_value=_fake_candles(60)):
        client = TestClient(app)
        r = client.post("/api/backtest/sweep", json={
            "strategy": strategy,
            "variables": [{"path": "indicators.0.params.period", "values": [10, 20]}],
        })
    # nessun indicators[0] → tutti i risultati devono essere errori controllati
    assert r.status_code == 200
    data = r.json()
    assert all("error" in r for r in data["results"])


def test_sweep_too_many_combinations_400():
    with patch("dashboard.backend.main.fetch_ohlcv", return_value=_fake_candles(50)):
        client = TestClient(app)
        r = client.post("/api/backtest/sweep", json={
            "strategy": {"long": {"entry": "close>0", "exit": "close<0"}},
            "variables": [
                {"path": "x", "values": list(range(15))},
                {"path": "y", "values": list(range(15))},
            ],
        })
    # 15*15 = 225 > 200 → 400
    assert r.status_code == 400
