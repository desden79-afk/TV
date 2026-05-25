"""Test della rotta /api/backtest/compare."""
from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from dashboard.backend.main import app
from dashboard.backend.market_data import Candle


def _fake_candles(n: int = 100) -> list[Candle]:
    out = []
    for i in range(n):
        # serie con un trend crescente lineare semplice
        base = 100.0 + i * 0.5
        out.append(Candle(time=1700000000 + i * 3600, open=base, high=base + 1.0,
                          low=base - 1.0, close=base + 0.2, volume=10.0))
    return out


def test_compare_runs_each_strategy_independently():
    with patch("dashboard.backend.main.fetch_ohlcv", return_value=_fake_candles(120)):
        client = TestClient(app)
        r = client.post("/api/backtest/compare", json={
            "symbol": "BTC/USDT", "timeframe": "1h", "limit": 120,
            "starting_capital": 10000.0, "fee_pct": 0.0, "slippage_pct": 0.0,
            "strategies": [
                {"name": "buy_all", "strategy": {
                    "long": {"entry": "close > 0", "exit": "close < 0"},
                }},
                {"name": "never", "strategy": {
                    "long": {"entry": "close < 0", "exit": "close > 99999"},
                }},
            ],
        })
    assert r.status_code == 200
    data = r.json()
    assert data["candles_count"] == 120
    assert len(data["results"]) == 2

    buy_all = data["results"][0]
    assert buy_all["name"] == "buy_all"
    assert "error" not in buy_all
    assert buy_all["num_trades"] == 1  # apre subito, chiude solo a fine dati
    assert buy_all["metrics"]["total_return_pct"] > 0

    never = data["results"][1]
    assert never["num_trades"] == 0
    assert never["metrics"]["total_return_pct"] == 0.0


def test_compare_isolates_errors():
    with patch("dashboard.backend.main.fetch_ohlcv", return_value=_fake_candles(50)):
        client = TestClient(app)
        r = client.post("/api/backtest/compare", json={
            "strategies": [
                {"name": "ok", "strategy": {
                    "long": {"entry": "close > 0", "exit": "close < 0"},
                }},
                {"name": "broken", "strategy": {
                    "long": {"entry": "unknown_indicator > 0", "exit": "close < 0"},
                }},
            ],
        })
    assert r.status_code == 200
    data = r.json()
    assert "error" not in data["results"][0]
    assert "error" in data["results"][1]


def test_compare_validates_strategy_count():
    client = TestClient(app)
    r = client.post("/api/backtest/compare", json={"strategies": []})
    assert r.status_code == 422
