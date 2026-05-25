"""Motore di backtest event-driven.

Modello:
- una sola posizione aperta alla volta (no piramidale)
- entry/exit eseguiti all'apertura della candela SUCCESSIVA al segnale
  (evita il look-ahead bias)
- fees e slippage applicati su entrambi i lati
- stop loss / take profit (opzionali) controllati intra-bar usando high/low

Risultato: lista trade, equity curve e metriche.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from indicators import compute as compute_indicator

from .dsl import compile_expr


# ---------- Strategy data model ----------

@dataclass
class Side:
    entry: str
    exit: str
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None


@dataclass
class Strategy:
    name: str = "unnamed"
    indicators: list[dict] = field(default_factory=list)
    long: Side | None = None
    short: Side | None = None
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "Strategy":
        long_d = d.get("long")
        short_d = d.get("short")
        return cls(
            name=d.get("name", "unnamed"),
            indicators=d.get("indicators", []),
            long=Side(**long_d) if long_d else None,
            short=Side(**short_d) if short_d else None,
            stop_loss_pct=d.get("stop_loss_pct"),
            take_profit_pct=d.get("take_profit_pct"),
        )


@dataclass
class BacktestConfig:
    starting_capital: float = 10_000.0
    fee_pct: float = 0.001       # 0.10% per lato
    slippage_pct: float = 0.0005  # 0.05% per lato
    # Numero di barre in un anno: usato per annualizzare Sharpe/Sortino.
    # Default 8760 = candele orarie (24*365). Le rotte API lo derivano dal
    # timeframe della richiesta.
    bars_per_year: float = 8760.0


@dataclass
class Trade:
    direction: str         # "long" | "short"
    entry_time: int        # unix seconds
    exit_time: int
    entry_price: float
    exit_price: float
    qty: float
    pnl: float             # in unità di quote (es. USDT), netto fees+slippage
    return_pct: float
    exit_reason: str       # "signal" | "stop_loss" | "take_profit" | "end_of_data"


# ---------- Helpers ----------

def _build_context(candles: pd.DataFrame, strategy: Strategy) -> dict[str, pd.Series]:
    closes = candles["close"].tolist()
    ctx: dict[str, pd.Series] = {
        "open":   candles["open"].astype(float),
        "high":   candles["high"].astype(float),
        "low":    candles["low"].astype(float),
        "close":  candles["close"].astype(float),
        "volume": candles["volume"].astype(float),
    }
    for spec in strategy.indicators:
        ind_id = spec["id"]
        ind_type = spec["type"]
        params = spec.get("params", {})
        result = compute_indicator(ind_type, closes, params)
        series = result["series"]
        if "value" in series:
            ctx[ind_id] = pd.Series(series["value"], dtype="float64")
        else:
            # multi-serie (es. MACD): esposta sia come ind_id.sub_name che con
            # un alias di default sulla serie principale
            for sub, values in series.items():
                ctx[f"{ind_id}.{sub}"] = pd.Series(values, dtype="float64")
    return ctx


def _apply_buy(price: float, fee: float, slip: float) -> float:
    """Prezzo effettivo pagato in entry long o exit short."""
    return price * (1 + slip) * (1 + fee)


def _apply_sell(price: float, fee: float, slip: float) -> float:
    """Prezzo effettivo incassato in exit long o entry short."""
    return price * (1 - slip) * (1 - fee)


# ---------- Core loop ----------

def run_backtest(candles: list[dict], strategy: Strategy, config: BacktestConfig) -> dict[str, Any]:
    if len(candles) < 2:
        raise ValueError("Servono almeno 2 candele per fare un backtest.")

    df = pd.DataFrame(candles).sort_values("time").reset_index(drop=True)
    n = len(df)
    ctx = _build_context(df, strategy)

    # pre-compila ed evaluata le condizioni una volta sola
    def signal(side: str, kind: str) -> pd.Series:
        s: Side | None = getattr(strategy, side)
        if not s:
            return pd.Series([False] * n)
        src = s.entry if kind == "entry" else s.exit
        ser = compile_expr(src)(ctx).astype(bool)
        return ser.fillna(False)

    long_entry  = signal("long",  "entry").to_numpy()
    long_exit   = signal("long",  "exit").to_numpy()
    short_entry = signal("short", "entry").to_numpy()
    short_exit  = signal("short", "exit").to_numpy()

    opens  = df["open"].to_numpy(dtype=float)
    highs  = df["high"].to_numpy(dtype=float)
    lows   = df["low"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    times  = df["time"].to_numpy(dtype=np.int64)

    fee = config.fee_pct
    slip = config.slippage_pct

    cash = config.starting_capital
    position: dict | None = None  # {direction, entry_idx, entry_price, qty, sl, tp}
    trades: list[Trade] = []
    equity_curve: list[dict] = []

    def equity_at(i: int) -> float:
        if position is None:
            return cash
        if position["direction"] == "long":
            return cash + position["qty"] * closes[i]
        # short: cash include il ricavo, debito = qty * prezzo corrente
        return cash - position["qty"] * closes[i]

    def open_long(i: int, ref_price: float) -> None:
        nonlocal cash, position
        eff = _apply_buy(ref_price, fee, slip)
        qty = cash / eff
        sl_pct = strategy.long.stop_loss_pct if strategy.long and strategy.long.stop_loss_pct else strategy.stop_loss_pct
        tp_pct = strategy.long.take_profit_pct if strategy.long and strategy.long.take_profit_pct else strategy.take_profit_pct
        position = {
            "direction": "long",
            "entry_idx": i,
            "entry_price": eff,
            "qty": qty,
            "sl": ref_price * (1 - sl_pct) if sl_pct else None,
            "tp": ref_price * (1 + tp_pct) if tp_pct else None,
        }
        cash = 0.0

    def open_short(i: int, ref_price: float) -> None:
        nonlocal cash, position
        eff = _apply_sell(ref_price, fee, slip)  # vendi short: incassi a prezzo netto
        qty = cash / eff
        sl_pct = strategy.short.stop_loss_pct if strategy.short and strategy.short.stop_loss_pct else strategy.stop_loss_pct
        tp_pct = strategy.short.take_profit_pct if strategy.short and strategy.short.take_profit_pct else strategy.take_profit_pct
        position = {
            "direction": "short",
            "entry_idx": i,
            "entry_price": eff,
            "qty": qty,
            "sl": ref_price * (1 + sl_pct) if sl_pct else None,
            "tp": ref_price * (1 - tp_pct) if tp_pct else None,
        }
        cash += qty * eff  # incassa il ricavo della vendita short

    def close_position(i: int, exec_price: float, reason: str) -> None:
        nonlocal cash, position
        assert position is not None
        if position["direction"] == "long":
            eff = _apply_sell(exec_price, fee, slip)
            proceeds = position["qty"] * eff
            cost = position["qty"] * position["entry_price"]
            pnl = proceeds - cost
            cash = proceeds  # tutto torna in cassa
        else:
            eff = _apply_buy(exec_price, fee, slip)
            buyback_cost = position["qty"] * eff
            short_proceeds = position["qty"] * position["entry_price"]
            pnl = short_proceeds - buyback_cost
            cash -= buyback_cost  # ricompri la posizione
        ret_pct = pnl / (position["qty"] * position["entry_price"])
        trades.append(Trade(
            direction=position["direction"],
            entry_time=int(times[position["entry_idx"]]),
            exit_time=int(times[i]),
            entry_price=position["entry_price"],
            exit_price=eff,
            qty=position["qty"],
            pnl=pnl,
            return_pct=ret_pct,
            exit_reason=reason,
        ))
        position = None

    # Loop: parte da i=1 perché i segnali al bar 0 non hanno una bar successiva
    # su cui eseguire — usiamo sempre il segnale di i-1 per agire al bar i.
    for i in range(1, n):
        # 1) Se c'è una posizione aperta, controlla SL/TP intra-bar
        if position is not None:
            sl = position["sl"]
            tp = position["tp"]
            if position["direction"] == "long":
                if sl is not None and lows[i] <= sl:
                    close_position(i, sl, "stop_loss")
                elif tp is not None and highs[i] >= tp:
                    close_position(i, tp, "take_profit")
            else:  # short
                if sl is not None and highs[i] >= sl:
                    close_position(i, sl, "stop_loss")
                elif tp is not None and lows[i] <= tp:
                    close_position(i, tp, "take_profit")

        # 2) Se ancora aperta, valuta exit signal dato al bar precedente
        if position is not None:
            if position["direction"] == "long" and long_exit[i - 1]:
                close_position(i, opens[i], "signal")
            elif position["direction"] == "short" and short_exit[i - 1]:
                close_position(i, opens[i], "signal")

        # 3) Se flat, valuta entry signal dato al bar precedente
        if position is None:
            if long_entry[i - 1]:
                open_long(i, opens[i])
            elif short_entry[i - 1]:
                open_short(i, opens[i])

        equity_curve.append({"time": int(times[i]), "equity": equity_at(i)})

    # Chiusura forzata a fine dati (al close dell'ultima candela)
    if position is not None:
        close_position(n - 1, closes[n - 1], "end_of_data")
        # aggiorna ultimo punto equity con cash reale post-chiusura
        if equity_curve:
            equity_curve[-1] = {"time": equity_curve[-1]["time"], "equity": cash}

    metrics = compute_metrics(equity_curve, trades, config.starting_capital, config.bars_per_year)
    return {
        "metrics": metrics,
        "equity_curve": equity_curve,
        "trades": [asdict(t) for t in trades],
    }


# ---------- Metrics ----------

def compute_metrics(
    equity_curve: list[dict],
    trades: list[Trade],
    starting_capital: float,
    bars_per_year: float = 8760.0,
) -> dict[str, Any]:
    if not equity_curve:
        return {
            "starting_capital": starting_capital,
            "final_equity": starting_capital,
            "total_return_pct": 0.0,
            "num_trades": 0,
            "win_rate": 0.0,
            "profit_factor": None,
            "max_drawdown_pct": 0.0,
            "avg_win_pct": 0.0,
            "avg_loss_pct": 0.0,
            "sharpe": None,
            "sortino": None,
        }
    eq = np.array([p["equity"] for p in equity_curve], dtype=float)
    final = float(eq[-1])
    total_return = (final / starting_capital) - 1.0

    # max drawdown
    running_max = np.maximum.accumulate(eq)
    drawdowns = (eq - running_max) / running_max
    max_dd = float(drawdowns.min()) if len(drawdowns) else 0.0

    # Sharpe / Sortino sui rendimenti per-barra dell'equity curve.
    # Annualizzati con sqrt(bars_per_year). Risk-free assunto = 0.
    sharpe: float | None = None
    sortino: float | None = None
    if len(eq) >= 2:
        # Considera solo equity positivo per evitare log/divisioni problematiche
        rets = np.diff(eq) / eq[:-1]
        # rimuovi NaN/inf dovuti a equity = 0 (caso limite)
        rets = rets[np.isfinite(rets)]
        if len(rets) >= 2:
            mean = float(rets.mean())
            std = float(rets.std(ddof=1))
            if std > 0:
                sharpe = mean / std * float(np.sqrt(bars_per_year))
            downside = rets[rets < 0]
            if len(downside) >= 2:
                dstd = float(downside.std(ddof=1))
                if dstd > 0:
                    sortino = mean / dstd * float(np.sqrt(bars_per_year))

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    sum_wins = sum(t.pnl for t in wins)
    sum_losses_abs = abs(sum(t.pnl for t in losses))
    profit_factor = (sum_wins / sum_losses_abs) if sum_losses_abs > 0 else None

    return {
        "starting_capital": starting_capital,
        "final_equity": final,
        "total_return_pct": total_return,
        "num_trades": len(trades),
        "num_winning": len(wins),
        "num_losing": len(losses),
        "win_rate": (len(wins) / len(trades)) if trades else 0.0,
        "profit_factor": profit_factor,
        "max_drawdown_pct": max_dd,  # negativo
        "avg_win_pct": (sum(t.return_pct for t in wins) / len(wins)) if wins else 0.0,
        "avg_loss_pct": (sum(t.return_pct for t in losses) / len(losses)) if losses else 0.0,
        "sharpe": sharpe,
        "sortino": sortino,
    }
