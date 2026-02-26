# AlgoTrade — AI Chess-Style Trading Simulator

A web-based AI algorithmic trading simulator that treats stock trading like a chess game. The AI evaluates positions, thinks ahead, and makes strategic moves.

## 🎯 Concept

Trading simulator where AI plays the "chess game" of the stock market:

- **Board = Market** — price charts, indicators, order book
- **Pieces = Positions** — buy/sell orders, portfolio holdings
- **Moves = Trades** — AI evaluates multiple strategies and picks the best "move"
- **Opponent = Market forces** — volatility, trends, news events

## ✨ Features

### Market Simulation Engine
- 8 simulated companies with different behaviors (tech growth, dividend, penny stock, pharma, etc.)
- Realistic price movements (random walk + trends + volatility events)
- Real-time candlestick charts with volume bars
- Market events (earnings, crashes, FDA approvals, analyst upgrades)
- Configurable speed (1x, 5x, 10x, 50x)
- Market scenarios: Normal, Bull, Bear, Sideways, Crash

### AI Trading Engine (Chess-like)
- **Position evaluation** — scores portfolio state like chess centipawns
- **Strategy tree** — evaluates moves with Monte Carlo lookahead
- **5 strategies:** Momentum, Mean Reversion, Breakout, Value, Scalping
- **Auto mode** — AI picks the best strategy per situation
- Shows decision tree, evaluated moves, confidence scores, and plain-text reasoning

### Dashboard
- Professional dark trading terminal theme
- Interactive candlestick charts (TradingView lightweight-charts)
- Technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands
- AI thinking panel with chess-style evaluation bar
- Trade history with P&L tracking
- Performance metrics: Sharpe ratio, max drawdown, win rate

### User vs AI
- Watch AI trade automatically
- Make manual trades to compete against AI
- Side-by-side portfolio comparison

## 🛠 Tech Stack

- Single page app: HTML + CSS + JS (no backend)
- TradingView lightweight-charts for chart rendering
- All simulation runs client-side
- LocalStorage for saving settings

## 🚀 Getting Started

Open `index.html` in a browser, or visit the deployed version.

## License

MIT
