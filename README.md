# TV — Sistema personale di trading

Progetto in costruzione. Vedi [PIANO.md](PIANO.md) per la roadmap completa.

## Stato attuale

**Fase 1 — Dashboard** (in corso)

Scheletro pronto: backend FastAPI (`/api/candles`) + frontend con grafico
candlestick TradingView Lightweight Charts. Dati di mercato via `ccxt`.

## Avvio rapido

```bash
pip install -r requirements.txt
python -m uvicorn dashboard.backend.main:app --reload
# poi apri http://127.0.0.1:8000
```

### Configurazione exchange (env)

- `TV_EXCHANGE` — id ccxt dell'exchange (default: `binanceus`).
  Su ambienti dove `binance.com` è raggiungibile usa `binance`.
- `TV_CA_BUNDLE` — path a un CA bundle alternativo. In ambienti con un proxy
  TLS-inspecting (es. sandbox Anthropic) il bundle di sistema
  `/etc/ssl/certs/ca-certificates.crt` viene usato automaticamente.

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
