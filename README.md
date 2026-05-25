# TV — Sistema personale di trading

Progetto in costruzione. Vedi [PIANO.md](PIANO.md) per la roadmap completa.

## Stato attuale

**Fase 0 — Fondamenta** (in corso)

## Stack tecnologico (provvisorio)

- **Linguaggio principale**: Python 3.11+
- **Dashboard**: web app (framework da definire in Fase 1: Streamlit / FastAPI + frontend)
- **Grafici**: TradingView Lightweight Charts (libreria gratuita)
- **Indicatori**: pandas-ta o TA-Lib
- **Backtesting**: vectorbt o backtesting.py
- **Broker**: Binance (via libreria `ccxt`)

## Convenzioni

- I file con credenziali (`.env`, chiavi API) **non vanno mai committati**
- Il file `.env.example` mostrerà i nomi delle variabili, senza i valori reali
- Ogni cartella avrà un proprio README quando inizia a contenere codice
