"""Test del motore: scenari deterministici per verificare next-open, fees,
slippage, stop loss/take profit e calcolo metriche."""
from __future__ import annotations

from backtesting import BacktestConfig, Strategy, run_backtest


def candle(t: int, o: float, h: float, l: float, c: float, v: float = 1.0) -> dict:
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v}


def test_basic_long_trade_no_costs():
    # 4 candele. close[0]=100 → segnale entry vero al bar 0 (close<200), eseguito al
    # OPEN del bar 1 = 110. close[2]=300 → segnale exit, eseguito al OPEN bar 3 = 320.
    candles = [
        candle(1, 100, 105,  95, 100),
        candle(2, 110, 115, 108, 200),
        candle(3, 210, 310, 205, 300),
        candle(4, 320, 330, 318, 325),
    ]
    strat = Strategy.from_dict({
        "name": "test",
        "long":  {"entry": "close < 200", "exit": "close > 250"},
    })
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    assert len(res["trades"]) == 1
    t = res["trades"][0]
    assert t["direction"] == "long"
    assert t["entry_price"] == 110.0
    assert t["exit_price"] == 320.0
    # qty = 1000 / 110, pnl = qty * (320 - 110) = 1000 * (210/110) ≈ 1909.09
    assert abs(t["pnl"] - 1000 * 210 / 110) < 1e-6
    assert res["metrics"]["num_trades"] == 1
    assert res["metrics"]["win_rate"] == 1.0


def test_fees_and_slippage_reduce_pnl():
    candles = [
        candle(1, 100, 100, 100, 100),
        candle(2, 100, 100, 100, 200),  # entry signal vero
        candle(3, 100, 100, 100, 200),  # eseguito qui (open=100), exit signal vero
        candle(4, 100, 100, 100, 200),  # exit eseguito qui (open=100)
    ]
    strat = Strategy.from_dict({
        "long": {"entry": "close < 150", "exit": "close > 150"},
    })
    cfg_no_cost = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    cfg_costs   = BacktestConfig(starting_capital=1000.0, fee_pct=0.001, slippage_pct=0.0005)
    r0 = run_backtest(candles, strat, cfg_no_cost)
    r1 = run_backtest(candles, strat, cfg_costs)
    # prezzo flat → senza costi pnl ≈ 0; con costi pnl < 0
    assert abs(r0["trades"][0]["pnl"]) < 1e-6
    assert r1["trades"][0]["pnl"] < 0


def test_stop_loss_triggers_intra_bar():
    # Entry signal vero solo al bar 0; nessun re-entry successivo.
    candles = [
        candle(1, 100, 100, 100, 100),   # close=100: entry vero
        candle(2, 100, 100, 100, 200),   # exec entry @ open=100; SL a 97. close=200 → no re-entry
        candle(3, 100, 100, 95, 96),     # low=95 → SL=97 colpito
        candle(4, 100, 100, 100, 100),
    ]
    strat = Strategy.from_dict({
        "long": {"entry": "close < 150", "exit": "close > 999"},  # exit mai vero
        "stop_loss_pct": 0.03,
    })
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    sl_trades = [t for t in res["trades"] if t["exit_reason"] == "stop_loss"]
    assert len(sl_trades) == 1
    assert sl_trades[0]["exit_price"] == 97.0


def test_take_profit_triggers_intra_bar():
    candles = [
        candle(1, 100, 100, 100, 100),
        candle(2, 100, 100, 100, 200),   # exec entry @ open=100; TP a 106. close=200 → no re-entry
        candle(3, 100, 110, 100, 105),   # high=110 → TP=106 colpito
        candle(4, 100, 100, 100, 100),
    ]
    strat = Strategy.from_dict({
        "long": {"entry": "close < 150", "exit": "close > 999"},
        "take_profit_pct": 0.06,
    })
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    tp_trades = [t for t in res["trades"] if t["exit_reason"] == "take_profit"]
    assert len(tp_trades) == 1
    assert tp_trades[0]["exit_price"] == 106.0


def test_short_trade_makes_profit_on_downtrend():
    candles = [
        candle(1, 100, 100, 100, 100),
        candle(2, 100, 100, 100, 100),  # entry short al open=100
        candle(3, 100, 100, 100, 100),  # exit short al open=100 (flat → pnl=0)
        candle(4, 60,  60,  60,  60),
    ]
    # Segnale entry sempre vero, exit sempre vero al bar successivo
    # Per fare uno short reale: entry vero solo al bar 1 (close=100), exit al bar 3 (close<70)
    candles = [
        candle(1, 100, 100, 100, 100),  # close=100 → entry vero (close>=100)
        candle(2, 100, 100, 100, 90),   # exec entry @ open=100; exit signal NO (close=90 non <70)
        candle(3, 80,  80,  80,  60),   # exit signal vero (close<70)
        candle(4, 50,  50,  50,  50),   # exec exit @ open=50
    ]
    strat = Strategy.from_dict({
        "short": {"entry": "close >= 100", "exit": "close < 70"},
    })
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    assert len(res["trades"]) == 1
    t = res["trades"][0]
    assert t["direction"] == "short"
    assert t["entry_price"] == 100.0
    assert t["exit_price"] == 50.0
    # qty = 1000/100 = 10; pnl = 10*(100-50) = 500
    assert abs(t["pnl"] - 500.0) < 1e-6


def test_no_signals_no_trades():
    candles = [candle(i, 100, 100, 100, 100) for i in range(1, 6)]
    strat = Strategy.from_dict({"long": {"entry": "close > 999", "exit": "close < 0"}})
    cfg = BacktestConfig(starting_capital=1000.0)
    res = run_backtest(candles, strat, cfg)
    assert res["trades"] == []
    assert res["metrics"]["num_trades"] == 0
    assert res["metrics"]["final_equity"] == 1000.0


def test_end_of_data_force_closes_position():
    candles = [
        candle(1, 100, 100, 100, 100),
        candle(2, 100, 100, 100, 100),  # entry al open=100
        candle(3, 100, 100, 100, 100),
    ]
    strat = Strategy.from_dict({"long": {"entry": "close < 200", "exit": "close > 999"}})
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    assert len(res["trades"]) == 1
    assert res["trades"][0]["exit_reason"] == "end_of_data"


def test_short_stop_loss_triggers_intra_bar():
    candles = [
        candle(1, 100, 100, 100, 100),  # close=100 → entry short vero
        candle(2, 100, 100, 100, 90),   # exec entry @ open=100; SL a 103. close=90 → no re-entry
        candle(3, 100, 105, 95, 95),    # high=105 → SL=103 colpito
        candle(4, 100, 100, 100, 100),
    ]
    strat = Strategy.from_dict({
        "short": {"entry": "close >= 100", "exit": "close < 50"},
        "stop_loss_pct": 0.03,
    })
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    sl_trades = [t for t in res["trades"] if t["exit_reason"] == "stop_loss"]
    assert len(sl_trades) == 1
    assert sl_trades[0]["exit_price"] == 103.0


def test_short_take_profit_triggers_intra_bar():
    candles = [
        candle(1, 100, 100, 100, 100),  # close=100 → entry short vero
        candle(2, 100, 100, 100, 90),   # exec entry @ open=100; TP a 94. close=90 → no re-entry
        candle(3, 100, 100, 92, 95),    # low=92 → TP=94 colpito
        candle(4, 100, 100, 100, 100),
    ]
    strat = Strategy.from_dict({
        "short": {"entry": "close >= 100", "exit": "close < 50"},
        "take_profit_pct": 0.06,
    })
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    tp_trades = [t for t in res["trades"] if t["exit_reason"] == "take_profit"]
    assert len(tp_trades) == 1
    assert tp_trades[0]["exit_price"] == 94.0


def test_indicators_referenced_in_strategy():
    # Prezzi che salgono → SMA segue. Usa una SMA come filtro di trend.
    candles = [candle(i, 100+i, 100+i+1, 100+i-1, 100+i) for i in range(1, 30)]
    strat = Strategy.from_dict({
        "indicators": [{"id": "ma", "type": "sma", "params": {"period": 5}}],
        "long": {"entry": "close > ma", "exit": "close < ma"},
    })
    cfg = BacktestConfig(starting_capital=1000.0, fee_pct=0.0, slippage_pct=0.0)
    res = run_backtest(candles, strat, cfg)
    # nessun crash; trend monotono → almeno un trade aperto e chiuso o forzato a fine dati
    assert res["metrics"]["num_trades"] >= 1
