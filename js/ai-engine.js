// ai-engine.js — AI Trading Brain with Chess-like Evaluation

class AIEngine {
  constructor(market, portfolio) {
    this.market = market;
    this.portfolio = portfolio;
    this.strategy = 'auto'; // momentum, meanReversion, breakout, value, scalping, auto
    this.thinkingLog = [];
    this.currentAnalysis = null;
    this.tradeFrequency = 8; // evaluate every N ticks
    this.lastEvalTick = 0;
    this.depth = 3; // lookahead depth
    this.confidence = 0;
    this.listeners = [];
  }

  on(fn) { this.listeners.push(fn); }
  emit(evt, data) { this.listeners.forEach(fn => fn(evt, data)); }

  setStrategy(s) { this.strategy = s; }

  evaluate(tick) {
    if (tick - this.lastEvalTick < this.tradeFrequency) return null;
    this.lastEvalTick = tick;

    const prices = {};
    this.market.getAllQuotes().forEach(q => { prices[q.symbol] = q.price; });

    const analysis = {
      tick,
      timestamp: Date.now(),
      positionScore: this._evaluatePosition(prices),
      candidates: [],
      chosen: null,
      reasoning: '',
      strategy: this.strategy,
      depth: this.depth,
      treeNodes: 0
    };

    // Generate candidate moves for each stock
    const symbols = this.market.getSymbols();
    symbols.forEach(sym => {
      const moves = this._generateMoves(sym, prices);
      moves.forEach(m => {
        const score = this._scoreMove(m, prices);
        m.score = score;
        analysis.candidates.push(m);
        analysis.treeNodes += m.lookahead ? m.lookahead.length : 1;
      });
    });

    // Sort by score
    analysis.candidates.sort((a, b) => b.score - a.score);

    // Pick best move
    const best = analysis.candidates[0];
    if (best && best.score > 0.1) {
      analysis.chosen = best;
      this.confidence = Math.min(99, Math.max(10, best.score * 20));
      analysis.reasoning = this._generateReasoning(best, prices);
      this._executeTrade(best, prices);
    } else {
      analysis.chosen = { action: 'HOLD', symbol: '-', reason: 'No high-conviction trades', score: 0 };
      this.confidence = Math.max(5, (best ? best.score : 0) * 10);
      analysis.reasoning = 'All evaluated positions show insufficient edge. Holding current positions. ' + this._holdReason(prices);
    }

    analysis.confidence = this.confidence;
    this.currentAnalysis = analysis;
    this.thinkingLog.unshift(analysis);
    if (this.thinkingLog.length > 50) this.thinkingLog.pop();

    this.emit('analysis', analysis);
    return analysis;
  }

  _evaluatePosition(prices) {
    const val = this.portfolio.totalValue(prices);
    const ret = ((val - this.portfolio.startingCash) / this.portfolio.startingCash) * 100;
    // score: 0 = flat, positive = good, negative = bad (like chess centipawns)
    let score = ret * 10; // 1% return = +10 centipawns

    // Bonus for diversification
    const holdingCount = Object.keys(this.portfolio.holdings).length;
    if (holdingCount >= 2 && holdingCount <= 5) score += 5;

    // Penalty for drawdown
    score -= this.portfolio.maxDrawdown * 2;

    return Math.round(score);
  }

  _generateMoves(symbol, prices) {
    const moves = [];
    const quote = this.market.getQuote(symbol);
    if (!quote) return moves;

    const candles = this.market.getCandles(symbol, 50);
    if (candles.length < 5) return moves;

    const closes = candles.map(c => c.close);
    const holding = this.portfolio.getHolding(symbol);
    const price = quote.price;
    const cash = this.portfolio.cash;

    // Calculate indicators
    const sma20 = Indicators.SMA(closes, Math.min(20, closes.length));
    const sma50 = Indicators.SMA(closes, Math.min(50, closes.length));
    const rsi = Indicators.RSI(closes, Math.min(14, closes.length - 1));
    const bb = Indicators.BollingerBands(closes, Math.min(20, closes.length));

    const lastSMA20 = sma20[sma20.length - 1];
    const lastSMA50 = sma50[sma50.length - 1];
    const lastRSI = rsi[rsi.length - 1];
    const lastBBUpper = bb.upper[bb.upper.length - 1];
    const lastBBLower = bb.lower[bb.lower.length - 1];

    const maxShares = Math.floor(cash * 0.25 / price); // max 25% of cash per trade
    const recentPrices = closes.slice(-10);
    const priceChange = recentPrices.length >= 2 ? (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0] : 0;

    // Strategy evaluation
    const strategies = this.strategy === 'auto'
      ? ['momentum', 'meanReversion', 'breakout', 'value', 'scalping']
      : [this.strategy];

    strategies.forEach(strat => {
      switch (strat) {
        case 'momentum':
          if (priceChange > 0.01 && lastRSI && lastRSI < 75 && maxShares > 0) {
            moves.push(this._makeMove('BUY', symbol, Math.min(maxShares, Math.ceil(maxShares * 0.5)), price, 'momentum',
              `Uptrend detected (+${(priceChange * 100).toFixed(1)}%), RSI ${lastRSI?.toFixed(0)} not overbought`, priceChange));
          }
          if (priceChange < -0.01 && holding && holding.qty > 0 && lastRSI && lastRSI > 25) {
            moves.push(this._makeMove('SELL', symbol, Math.ceil(holding.qty * 0.5), price, 'momentum',
              `Downtrend detected (${(priceChange * 100).toFixed(1)}%), cutting losses`, Math.abs(priceChange)));
          }
          break;

        case 'meanReversion':
          if (lastRSI && lastRSI < 30 && maxShares > 0) {
            moves.push(this._makeMove('BUY', symbol, Math.min(maxShares, Math.ceil(maxShares * 0.6)), price, 'meanReversion',
              `RSI oversold (${lastRSI.toFixed(0)}), expecting bounce`, (30 - lastRSI) / 30));
          }
          if (lastRSI && lastRSI > 70 && holding && holding.qty > 0) {
            moves.push(this._makeMove('SELL', symbol, Math.ceil(holding.qty * 0.6), price, 'meanReversion',
              `RSI overbought (${lastRSI.toFixed(0)}), expecting pullback`, (lastRSI - 70) / 30));
          }
          if (lastBBLower && price < lastBBLower && maxShares > 0) {
            moves.push(this._makeMove('BUY', symbol, Math.min(maxShares, Math.ceil(maxShares * 0.4)), price, 'meanReversion',
              `Price below lower Bollinger Band — oversold`, 0.5));
          }
          break;

        case 'breakout':
          if (candles.length >= 10) {
            const range = recentPrices.slice(0, -1);
            const rangeHigh = Math.max(...range);
            const rangeLow = Math.min(...range);
            if (price > rangeHigh * 1.01 && maxShares > 0) {
              moves.push(this._makeMove('BUY', symbol, Math.min(maxShares, Math.ceil(maxShares * 0.5)), price, 'breakout',
                `Price broke above range high $${rangeHigh.toFixed(2)}`, (price - rangeHigh) / rangeHigh));
            }
            if (price < rangeLow * 0.99 && holding && holding.qty > 0) {
              moves.push(this._makeMove('SELL', symbol, holding.qty, price, 'breakout',
                `Price broke below range low $${rangeLow.toFixed(2)}`, (rangeLow - price) / rangeLow));
            }
          }
          break;

        case 'value':
          if (lastSMA50 && price < lastSMA50 * 0.95 && maxShares > 0) {
            moves.push(this._makeMove('BUY', symbol, Math.min(maxShares, Math.ceil(maxShares * 0.5)), price, 'value',
              `Trading 5%+ below SMA50 ($${lastSMA50.toFixed(2)}) — undervalued`, (lastSMA50 - price) / lastSMA50));
          }
          if (lastSMA50 && price > lastSMA50 * 1.08 && holding && holding.qty > 0) {
            moves.push(this._makeMove('SELL', symbol, Math.ceil(holding.qty * 0.5), price, 'value',
              `Trading 8%+ above SMA50 ($${lastSMA50.toFixed(2)}) — overvalued`, (price - lastSMA50) / lastSMA50));
          }
          break;

        case 'scalping':
          if (candles.length >= 3) {
            const last3 = closes.slice(-3);
            const microDip = last3[2] < last3[1] && last3[1] < last3[0] && maxShares > 0;
            const microPop = last3[2] > last3[1] && last3[1] > last3[0] && holding && holding.qty > 0;
            if (microDip) {
              moves.push(this._makeMove('BUY', symbol, Math.min(maxShares, Math.ceil(maxShares * 0.3)), price, 'scalping',
                `3-bar dip — quick scalp entry`, 0.3));
            }
            if (microPop) {
              moves.push(this._makeMove('SELL', symbol, Math.min(holding.qty, Math.ceil(holding.qty * 0.3)), price, 'scalping',
                `3-bar pop — taking quick profit`, 0.3));
            }
          }
          break;
      }
    });

    // Lookahead: simulate each move's outcome
    moves.forEach(m => {
      m.lookahead = this._lookahead(m, closes, 3);
    });

    return moves;
  }

  _makeMove(action, symbol, qty, price, strategy, reason, edge) {
    return { action, symbol, qty, price, strategy, reason, edge: edge || 0, score: 0 };
  }

  _scoreMove(move, prices) {
    let score = move.edge * 5;

    // Weight by strategy confidence
    const stratWeights = { momentum: 1.2, meanReversion: 1.1, breakout: 1.3, value: 1.0, scalping: 0.8 };
    score *= (stratWeights[move.strategy] || 1);

    // Lookahead bonus
    if (move.lookahead && move.lookahead.length > 0) {
      const avgOutcome = move.lookahead.reduce((s, l) => s + l.expectedReturn, 0) / move.lookahead.length;
      score += avgOutcome * 10;
    }

    // Position sizing sanity
    if (move.action === 'BUY') {
      const cost = move.qty * move.price;
      if (cost > this.portfolio.cash * 0.5) score *= 0.5; // penalize oversized
    }

    // Risk management: don't over-concentrate
    const holding = this.portfolio.getHolding(move.symbol);
    if (move.action === 'BUY' && holding) {
      const currentVal = holding.qty * move.price;
      const totalVal = this.portfolio.totalValue(prices);
      if (currentVal / totalVal > 0.3) score *= 0.3; // too concentrated
    }

    return Math.max(0, score);
  }

  _lookahead(move, historicalCloses, depth) {
    const scenarios = [];
    const lastPrice = move.price;
    const returns = [];

    // Calculate historical volatility for projection
    for (let i = 1; i < historicalCloses.length; i++) {
      returns.push((historicalCloses[i] - historicalCloses[i - 1]) / historicalCloses[i - 1]);
    }
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const volatility = returns.length > 0 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length) : 0.02;

    // Monte Carlo-lite: 5 scenarios
    for (let s = 0; s < 5; s++) {
      let price = lastPrice;
      for (let d = 0; d < depth; d++) {
        const shock = (Math.random() - 0.5) * 2 * volatility * 2;
        price *= (1 + avgReturn + shock);
      }
      const expectedReturn = (price - lastPrice) / lastPrice;
      scenarios.push({
        scenarioPrice: price,
        expectedReturn: move.action === 'BUY' ? expectedReturn : -expectedReturn,
        label: expectedReturn > 0.02 ? 'bullish' : expectedReturn < -0.02 ? 'bearish' : 'neutral'
      });
    }

    return scenarios;
  }

  _executeTrade(move, prices) {
    const day = this.market.day;
    const tick = this.market.tick;
    let result;

    if (move.action === 'BUY') {
      result = this.portfolio.buy(move.symbol, move.qty, move.price, day, tick);
    } else if (move.action === 'SELL') {
      result = this.portfolio.sell(move.symbol, move.qty, move.price, day, tick);
    }

    if (result) {
      this.emit('trade', { ...result, strategy: move.strategy, reason: move.reason, confidence: this.confidence });
    }
  }

  _generateReasoning(move, prices) {
    const val = this.portfolio.totalValue(prices);
    const parts = [];

    parts.push(`[${move.strategy.toUpperCase()}] ${move.action} ${move.qty} ${move.symbol} @ $${move.price.toFixed(2)}`);
    parts.push(`Signal: ${move.reason}`);
    parts.push(`Edge score: ${move.edge.toFixed(2)} | Overall: ${move.score.toFixed(2)}`);

    if (move.lookahead && move.lookahead.length > 0) {
      const bullish = move.lookahead.filter(l => l.label === 'bullish').length;
      const bearish = move.lookahead.filter(l => l.label === 'bearish').length;
      parts.push(`Lookahead (depth ${this.depth}): ${bullish}/5 bullish, ${bearish}/5 bearish`);
    }

    parts.push(`Portfolio: $${val.toFixed(2)} | Cash: $${this.portfolio.cash.toFixed(2)}`);

    return parts.join('\n');
  }

  _holdReason(prices) {
    const val = this.portfolio.totalValue(prices);
    const holdingCount = Object.keys(this.portfolio.holdings).length;
    if (holdingCount === 0) return 'Waiting for better entry signals. Cash deployed: 0%.';
    const investedPct = ((val - this.portfolio.cash) / val * 100).toFixed(0);
    return `Currently ${investedPct}% invested across ${holdingCount} positions.`;
  }

  getThinkingTree() {
    if (!this.currentAnalysis) return null;
    const a = this.currentAnalysis;
    return {
      positionScore: a.positionScore,
      candidates: a.candidates.slice(0, 12),
      chosen: a.chosen,
      reasoning: a.reasoning,
      confidence: a.confidence,
      treeNodes: a.treeNodes,
      depth: a.depth,
      strategy: a.strategy === 'auto' ? 'AUTO' : a.strategy.toUpperCase(),
      timestamp: a.timestamp
    };
  }
}

if (typeof module !== 'undefined') module.exports = AIEngine;
