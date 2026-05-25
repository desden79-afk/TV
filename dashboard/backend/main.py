from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backtesting import BacktestConfig, Strategy, run_backtest
from indicators import compute as compute_indicator

from .market_data import Timeframe, fetch_ohlcv, fetch_top_symbols

FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"

app = FastAPI(title="TV Dashboard", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/symbols")
def symbols(
    quote: str = Query("USDT"),
    limit: int = Query(30, ge=1, le=200),
) -> list[dict]:
    try:
        return fetch_top_symbols(quote=quote, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Errore caricamento simboli: {exc}")


@app.get("/api/candles")
def candles(
    symbol: str = Query("BTC/USDT"),
    timeframe: Timeframe = Query("1h"),
    limit: int = Query(500, ge=10, le=1000),
) -> list[dict]:
    try:
        data = fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Errore caricamento dati: {exc}")
    return [c.__dict__ for c in data]


class IndicatorSpec(BaseModel):
    id: str
    type: str
    params: dict[str, Any] = Field(default_factory=dict)


class IndicatorsRequest(BaseModel):
    closes: list[float]
    highs: list[float] = Field(default_factory=list)
    lows: list[float] = Field(default_factory=list)
    indicators: list[IndicatorSpec]


@app.post("/api/indicators")
def indicators(req: IndicatorsRequest) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for spec in req.indicators:
        try:
            results[spec.id] = compute_indicator(spec.type, req.closes, spec.params, req.highs, req.lows)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Errore indicatore {spec.id}: {exc}")
    return {"indicators": results}


class BacktestRequest(BaseModel):
    symbol: str = "BTC/USDT"
    timeframe: Timeframe = "1h"
    limit: int = Field(500, ge=10, le=1000)
    strategy: dict[str, Any]
    starting_capital: float = 10_000.0
    fee_pct: float = 0.001
    slippage_pct: float = 0.0005


@app.post("/api/backtest")
def backtest(req: BacktestRequest) -> dict[str, Any]:
    try:
        candles = fetch_ohlcv(symbol=req.symbol, timeframe=req.timeframe, limit=req.limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Errore caricamento dati: {exc}")
    try:
        strategy = Strategy.from_dict(req.strategy)
        config = BacktestConfig(
            starting_capital=req.starting_capital,
            fee_pct=req.fee_pct,
            slippage_pct=req.slippage_pct,
        )
        result = run_backtest(
            [c.__dict__ for c in candles],
            strategy,
            config,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=f"Strategia non valida: {exc}")
    return {
        "symbol": req.symbol,
        "timeframe": req.timeframe,
        "candles": [c.__dict__ for c in candles],
        **result,
    }


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


@app.get("/{full_path:path}")
def spa_fallback(full_path: str) -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")
