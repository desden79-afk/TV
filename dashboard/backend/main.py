from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from indicators import compute as compute_indicator

from .market_data import Timeframe, fetch_ohlcv

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
    indicators: list[IndicatorSpec]


@app.post("/api/indicators")
def indicators(req: IndicatorsRequest) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for spec in req.indicators:
        try:
            results[spec.id] = compute_indicator(spec.type, req.closes, spec.params)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Errore indicatore {spec.id}: {exc}")
    return {"indicators": results}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


@app.get("/{full_path:path}")
def spa_fallback(full_path: str) -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")
