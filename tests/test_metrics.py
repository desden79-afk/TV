"""Test Sharpe e Sortino calcolati su equity curve sintetiche."""
from __future__ import annotations

import math

from backtesting.engine import compute_metrics


def test_metrics_empty_returns_none_for_risk():
    m = compute_metrics([], [], 1000.0)
    assert m["sharpe"] is None
    assert m["sortino"] is None


def test_metrics_constant_equity_returns_none_for_risk():
    eq = [{"time": i, "equity": 1000.0} for i in range(50)]
    m = compute_metrics(eq, [], 1000.0)
    assert m["sharpe"] is None  # varianza nulla → non definito
    assert m["sortino"] is None


def test_metrics_positive_drift_gives_positive_sharpe():
    # Equity in crescita costante con rumore: Sharpe deve essere positivo
    eq = []
    val = 1000.0
    # 3 bars su 4 in salita (+0.2%), 1 bar in discesa (-0.1%) → drift positivo
    for i in range(200):
        val *= 1.002 if i % 4 != 0 else 0.999
        eq.append({"time": i, "equity": val})
    m = compute_metrics(eq, [], 1000.0, bars_per_year=8760.0)
    assert m["sharpe"] is not None
    assert m["sharpe"] > 0
    assert m["sortino"] is not None
    assert m["sortino"] > 0


def test_metrics_negative_drift_gives_negative_sharpe():
    eq = []
    val = 1000.0
    for i in range(200):
        val *= 0.999 + (0.0003 if i % 3 == 0 else -0.0004)
        eq.append({"time": i, "equity": val})
    m = compute_metrics(eq, [], 1000.0, bars_per_year=8760.0)
    assert m["sharpe"] is not None
    assert m["sharpe"] < 0


def test_sharpe_annualization_factor_scales():
    # Stessa serie di ritorni, due bars_per_year diversi: sharpe deve scalare
    # esattamente con sqrt(bars_per_year)
    eq = []
    val = 1000.0
    for i in range(100):
        val *= 1.001 if i % 2 == 0 else 0.9995
        eq.append({"time": i, "equity": val})
    m_hourly = compute_metrics(eq, [], 1000.0, bars_per_year=8760.0)
    m_daily  = compute_metrics(eq, [], 1000.0, bars_per_year=365.0)
    ratio = m_hourly["sharpe"] / m_daily["sharpe"]
    expected = math.sqrt(8760.0 / 365.0)
    assert math.isclose(ratio, expected, rel_tol=1e-6)
