// portfolio.js — Portfolio management for AI and User

class Portfolio {
  constructor(name, cash = 10000) {
    this.name = name;
    this.startingCash = cash;
    this.cash = cash;
    this.holdings = {}; // { symbol: { qty, avgCost } }
    this.trades = [];   // { id, symbol, side, qty, price, time, day, pnl? }
    this.tradeId = 0;
    this.peakValue = cash;
    this.maxDrawdown = 0;
    this.dailyReturns = [];
    this._prevValue = cash;
  }

  reset(cash) {
    this.cash = cash || this.startingCash;
    this.holdings = {};
    this.trades = [];
    this.tradeId = 0;
    this.peakValue = this.cash;
    this.maxDrawdown = 0;
    this.dailyReturns = [];
    this._prevValue = this.cash;
  }

  buy(symbol, qty, price, day, tick) {
    const cost = qty * price;
    if (cost > this.cash) {
      qty = Math.floor(this.cash / price);
      if (qty <= 0) return null;
    }
    const totalCost = qty * price;
    this.cash -= totalCost;

    if (!this.holdings[symbol]) {
      this.holdings[symbol] = { qty: 0, avgCost: 0 };
    }
    const h = this.holdings[symbol];
    const newTotal = h.qty + qty;
    h.avgCost = (h.avgCost * h.qty + totalCost) / newTotal;
    h.qty = newTotal;

    const trade = {
      id: ++this.tradeId,
      symbol, side: 'BUY', qty, price,
      total: totalCost, day, tick, time: Date.now()
    };
    this.trades.push(trade);
    return trade;
  }

  sell(symbol, qty, price, day, tick) {
    const h = this.holdings[symbol];
    if (!h || h.qty <= 0) return null;
    qty = Math.min(qty, h.qty);
    if (qty <= 0) return null;

    const revenue = qty * price;
    const costBasis = qty * h.avgCost;
    const pnl = revenue - costBasis;

    this.cash += revenue;
    h.qty -= qty;
    if (h.qty <= 0) delete this.holdings[symbol];

    const trade = {
      id: ++this.tradeId,
      symbol, side: 'SELL', qty, price,
      total: revenue, pnl, day, tick, time: Date.now()
    };
    this.trades.push(trade);
    return trade;
  }

  getHolding(symbol) {
    return this.holdings[symbol] || null;
  }

  totalValue(marketPrices) {
    let val = this.cash;
    for (const sym in this.holdings) {
      const h = this.holdings[sym];
      const price = marketPrices[sym] || 0;
      val += h.qty * price;
    }
    return val;
  }

  unrealizedPnL(marketPrices) {
    let pnl = 0;
    for (const sym in this.holdings) {
      const h = this.holdings[sym];
      const price = marketPrices[sym] || 0;
      pnl += (price - h.avgCost) * h.qty;
    }
    return pnl;
  }

  realizedPnL() {
    return this.trades.filter(t => t.pnl !== undefined).reduce((s, t) => s + t.pnl, 0);
  }

  totalPnL(marketPrices) {
    return this.totalValue(marketPrices) - this.startingCash;
  }

  winRate() {
    const sells = this.trades.filter(t => t.side === 'SELL' && t.pnl !== undefined);
    if (sells.length === 0) return 0;
    const wins = sells.filter(t => t.pnl > 0).length;
    return (wins / sells.length) * 100;
  }

  updateMetrics(marketPrices) {
    const val = this.totalValue(marketPrices);
    if (val > this.peakValue) this.peakValue = val;
    const dd = this.peakValue > 0 ? ((this.peakValue - val) / this.peakValue) * 100 : 0;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;

    // daily return
    if (this._prevValue > 0) {
      this.dailyReturns.push((val - this._prevValue) / this._prevValue);
    }
    this._prevValue = val;
  }

  sharpeRatio() {
    if (this.dailyReturns.length < 2) return 0;
    const mean = this.dailyReturns.reduce((a, b) => a + b, 0) / this.dailyReturns.length;
    const variance = this.dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / this.dailyReturns.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return (mean / std) * Math.sqrt(252); // annualized
  }

  totalReturnPct(marketPrices) {
    return ((this.totalValue(marketPrices) - this.startingCash) / this.startingCash) * 100;
  }

  stats(marketPrices) {
    return {
      name: this.name,
      cash: this.cash,
      totalValue: this.totalValue(marketPrices),
      totalPnL: this.totalPnL(marketPrices),
      unrealizedPnL: this.unrealizedPnL(marketPrices),
      realizedPnL: this.realizedPnL(),
      totalReturnPct: this.totalReturnPct(marketPrices),
      winRate: this.winRate(),
      sharpe: this.sharpeRatio(),
      maxDrawdown: this.maxDrawdown,
      tradeCount: this.trades.length,
      holdings: { ...this.holdings }
    };
  }
}

if (typeof module !== 'undefined') module.exports = Portfolio;
