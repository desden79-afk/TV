# Progetto TV — Sistema di trading personalizzato

Questo documento riassume il piano del progetto concordato all'inizio.
Lo terremo aggiornato man mano che avanziamo.

---

## Obiettivo finale

Costruire un sistema personale di trading che permetta di:
1. Visualizzare grafici e indicatori personalizzabili in una dashboard
2. Fare backtesting automatico di strategie su titoli/asset
3. Testare le strategie promettenti in paper trading (soldi finti, prezzi reali)
4. Eseguire le strategie validate in trading manuale (segnali via notifica)
5. Automatizzare l'esecuzione con capitale reale e limiti di rischio

## Mercato pilota

**Criptovalute** (es. BTC, ETH su Binance). Una volta consolidato il sistema,
si estenderà ad azioni USA (Alpaca), forex e altri mercati.

## Architettura (in parole semplici)

Tre componenti che lavorano insieme:

- **Dashboard** (browser) → cosa vedi e con cui interagisci
- **Cervello** (Python sul server) → calcola indicatori, backtest, segnali
- **Mani** (connessione al broker) → esegue gli ordini (prima finti, poi veri)

TradingView verrà usato solo per visualizzare i grafici (libreria gratuita
*Lightweight Charts*), mentre il resto è costruito su misura.

---

## Le 6 fasi del progetto

### Fase 0 — Fondamenta
- Creazione account (GitHub, Binance Testnet, TradingView free)
- Setup repository e ambiente di sviluppo
- **Stato:** completata

### Fase 1 — Dashboard con indicatori personalizzabili
- Grafico candlestick (TradingView Lightweight Charts) ✓
- Lista simboli dinamica (top 30 USDT per volume 24h) ✓
- Pannello indicatori: SMA, EMA, RSI, MACD configurabili, add/remove ✓
- Overlay SMA/EMA sul pane candele, RSI/MACD su pane oscillator separato
  con asse tempi sincronizzato ✓
- Legenda con OHLCV e valori indicatori al passaggio del mouse ✓
- Persistenza stato (simbolo, timeframe, indicatori, live) su localStorage ✓
- Aggiornamento live con polling adattivo al timeframe, pausa quando la
  tab non è visibile ✓
- **Stato:** completata

#### Nota sull'exchange usato per i dati
Il container di sviluppo è geo-bloccato da `binance.com` (HTTP 451) e da
`testnet.binance.vision`. Per la dashboard usiamo `binance.us` (variabile
`TV_EXCHANGE`, default `binanceus`) che restituisce gli stessi OHLCV per
i pair principali. Quando arriveremo al paper trading (Fase 3) valuteremo
una venue testnet raggiungibile (es. Bybit testnet) oppure un proxy.

### Fase 2 — Motore di backtesting
- Definizione strategie (regole di entry/exit)
- Simulazione su dati storici
- Report: profitto, % vincenti, drawdown, equity curve
- Confronto di N strategie sulla stessa serie di candele (tab "Confronto"):
  slot indipendenti con JSON libero, tabella metriche affiancate e
  highlight automatico della migliore per ogni metrica

### Fase 3 — Paper trading live
- Esecuzione strategie su Binance Testnet (soldi finti, prezzi reali)
- Durata minima consigliata: 4-8 settimane

### Fase 4 — Trading manuale assistito
- Notifiche (Telegram/email) sui segnali
- Esecuzione manuale da parte dell'utente

### Fase 5 — Trading automatico
- Esecuzione automatica con capitale piccolo
- Stop loss obbligatori, kill switch, limiti giornalieri
- Scaling solo se i risultati reali confermano quelli del paper trading

### Fase 6 — Estensione altri mercati
- Replica dell'infrastruttura su azioni, forex, ecc.

---

## Principi guida

- **Sicurezza prima di tutto**: nessun soldo vero finché il paper trading non
  dà conferme stabili nel tempo
- **Niente promesse di profitto**: il backtesting positivo non garantisce nulla
- **Trasparenza**: ogni passaggio viene spiegato in modo comprensibile
- **Modularità**: ogni fase produce un sistema funzionante, non un cantiere aperto

---

## Struttura del repository

```
TV/
├── dashboard/      → interfaccia web (grafici, pannelli)
├── indicators/     → calcolo indicatori tecnici (MA, RSI, MACD, ecc.)
├── backtesting/    → motore di simulazione strategie
├── data/           → dati storici e cache prezzi
├── broker/         → connessioni a Binance e altri broker
└── docs/           → documentazione e note di progetto
```
