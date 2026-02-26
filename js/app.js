// app.js — Main app controller & UI (supports Simulated + Real Market modes)

class App {
  constructor() {
    // Sim mode engines
    this.market = new MarketEngine();
    this.aiPortfolio = new Portfolio('AI Engine', 10000);
    this.userPortfolio = new Portfolio('You', 10000);
    this.ai = new AIEngine(this.market, this.aiPortfolio);
    this.chart = new ChartManager('chart-container');
    this.selectedSymbol = 'NOVA';
    this.selectedStrategy = 'auto';
    this.tradeMarkers = [];
    this._eventQueue = [];
    this._bound = {};

    // Real market mode
    this.mode = 'sim'; // 'sim' or 'real'
    this.realMarket = new RealMarketEngine();
    this.realAiPortfolio = new Portfolio('AI Engine', 10000);
    this.realUserPortfolio = new Portfolio('You', 10000);
    this.realTradeMarkers = [];
    this._realAiLastEval = -1;
    this._searchTimeout = null;
    this._buyAndHold = { startPrice: 0, shares: 0, peakValue: 10000, maxDD: 0 };
  }

  init() {
    this.chart.init();
    this._buildWatchlist();
    this._buildControls();
    this._bindEvents();
    this._bindModeToggle();
    this._bindRealMarketEvents();
    this._updateUI();
    this._loadSettings();
    this.selectSymbol('NOVA');

    // Show initial state
    this._renderPortfolio('ai');
    this._renderPortfolio('user');
    this._renderTradeHistory();
    this._renderAIThinking();
    this._renderPerformance();
  }

  // ===== MODE TOGGLE =====
  _bindModeToggle() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const newMode = e.target.dataset.mode;
        if (newMode === this.mode) return;
        this._switchMode(newMode);
      });
    });

    // Mode selector cards (overlay)
    const overlay = document.getElementById('mode-selector-overlay');
    document.getElementById('mode-card-sim')?.addEventListener('click', () => {
      overlay.style.display = 'none';
      this._switchMode('sim');
    });
    document.getElementById('mode-card-real')?.addEventListener('click', () => {
      overlay.style.display = 'none';
      this._switchMode('real');
    });
  }

  _switchMode(mode) {
    // Pause both
    this.market.pause();
    this.realMarket.pause();

    this.mode = mode;

    // Update toggle buttons
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mode-btn[data-mode="${mode}"]`)?.classList.add('active');

    // Show/hide mode-specific elements
    document.querySelectorAll('.sim-only').forEach(el => el.style.display = mode === 'sim' ? '' : 'none');
    document.querySelectorAll('.real-only').forEach(el => el.style.display = mode === 'real' ? '' : 'none');

    if (mode === 'sim') {
      this.selectSymbol(this.selectedSymbol || 'NOVA');
      this._updateUI();
    } else {
      // Real market mode
      this.chart.setSymbol(this.realMarket.symbol);
      this._updateRealUI();
      // If no data loaded yet, show a prompt
      if (this.realMarket.candles.length === 0) {
        document.getElementById('ai-thinking').innerHTML =
          '<div class="thinking-idle">Select a stock ticker to load real market data</div>';
      }
    }

    this._saveSettings();
  }

  // ===== REAL MARKET EVENTS =====
  _bindRealMarketEvents() {
    // Replay tick events
    this.realMarket.on((evt, data) => {
      if (evt === 'tick') this._onRealTick(data);
      if (evt === 'dayClose') this._onRealDayClose(data);
      if (evt === 'loaded') this._onRealDataLoaded(data);
      if (evt === 'loading') this._onRealLoading(data);
      if (evt === 'error') this._onRealError(data);
      if (evt === 'reset') this._onRealReset();
      if (evt === 'complete') this._onRealComplete(data);
    });

    // Stock search input
    const searchInput = document.getElementById('stock-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this._searchTimeout);
        this._searchTimeout = setTimeout(() => this._doSearch(e.target.value), 300);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = searchInput.value.trim();
          if (val) this._loadRealSymbol(val);
        }
      });
    }

    // Search button
    document.getElementById('stock-search-btn')?.addEventListener('click', () => {
      const val = document.getElementById('stock-search-input').value.trim();
      if (val) this._loadRealSymbol(val);
    });

    // Popular ticker chips
    document.querySelectorAll('.ticker-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const sym = chip.dataset.symbol;
        document.getElementById('stock-search-input').value = sym;
        this._loadRealSymbol(sym);
      });
    });

    // Range selector
    document.getElementById('range-select')?.addEventListener('change', (e) => {
      if (this.realMarket.symbol) {
        this._loadRealSymbol(this.realMarket.symbol, e.target.value);
      }
    });
  }

  async _doSearch(query) {
    const resultsEl = document.getElementById('search-results');
    if (!resultsEl) return;
    if (!query || query.length < 1) {
      resultsEl.innerHTML = '';
      return;
    }
    try {
      const results = await RealMarketEngine.searchSymbols(query);
      resultsEl.innerHTML = results.slice(0, 6).map(r =>
        `<div class="search-result-row" data-symbol="${r.symbol}">
          <span class="sr-symbol">${r.symbol}</span>
          <span class="sr-name">${r.name}</span>
          <span class="sr-exchange">${r.exchange}</span>
        </div>`
      ).join('');
      resultsEl.querySelectorAll('.search-result-row').forEach(row => {
        row.addEventListener('click', () => {
          const sym = row.dataset.symbol;
          document.getElementById('stock-search-input').value = sym;
          resultsEl.innerHTML = '';
          this._loadRealSymbol(sym);
        });
      });
    } catch (e) {
      resultsEl.innerHTML = '';
    }
  }

  async _loadRealSymbol(symbol, range) {
    if (!range) range = document.getElementById('range-select')?.value || '1y';
    document.getElementById('search-results').innerHTML = '';

    // Reset portfolios
    this.realAiPortfolio.reset();
    this.realUserPortfolio.reset();
    this.realTradeMarkers = [];
    this._realAiLastEval = -1;
    this._buyAndHold = { startPrice: 0, shares: 0, peakValue: 10000, maxDD: 0 };

    try {
      await this.realMarket.loadSymbol(symbol, range);
    } catch (e) {
      // Error handled by event
    }
  }

  _onRealLoading(data) {
    if (this.mode !== 'real') return;
    document.getElementById('ai-thinking').innerHTML =
      `<div class="thinking-idle">⏳ Loading ${data.symbol} data from Yahoo Finance...</div>`;
    document.getElementById('chart-symbol').textContent = `${data.symbol} — Loading...`;
    document.getElementById('chart-sector').textContent = '';
  }

  _onRealDataLoaded(data) {
    if (this.mode !== 'real') return;

    // Update chart
    this.chart.setSymbol(data.symbol);
    document.getElementById('chart-symbol').textContent = `${data.symbol}`;
    document.getElementById('chart-sector').textContent =
      this.realMarket.symbolInfo ? `${this.realMarket.symbolInfo.exchange} · Real Data` : 'Real Data';

    // Show stock info
    const infoEl = document.getElementById('real-stock-info');
    if (infoEl && this.realMarket.symbolInfo) {
      const i = this.realMarket.symbolInfo;
      infoEl.style.display = 'block';
      infoEl.innerHTML = `
        <div class="rsi-row"><span>Symbol</span><span class="rsi-val">${i.symbol}</span></div>
        <div class="rsi-row"><span>Exchange</span><span class="rsi-val">${i.exchange}</span></div>
        <div class="rsi-row"><span>Data Points</span><span class="rsi-val">${data.totalCandles} days</span></div>
        <div class="rsi-row"><span>Period</span><span class="rsi-val">${this.realMarket.getStartDate()} → ${this.realMarket.getEndDate()}</span></div>
      `;
    }

    // Initialize buy & hold
    if (this.realMarket.candles.length > 0) {
      const firstPrice = this.realMarket.candles[0].open;
      this._buyAndHold.startPrice = firstPrice;
      this._buyAndHold.shares = Math.floor(10000 / firstPrice);
      this._buyAndHold.peakValue = 10000;
      this._buyAndHold.maxDD = 0;
    }

    // Update chart with first candle
    this._updateRealChart();

    document.getElementById('day-counter').textContent = `Day 1 / ${data.totalCandles}`;
    document.getElementById('tick-counter').textContent = this.realMarket.getCurrentDate();

    this._renderRealAIThinking('Ready to replay. Press ▶ Play to start.');
    this._renderPortfolio('ai');
    this._renderPortfolio('user');
    this._renderPerformance();

    // Highlight active chip
    document.querySelectorAll('.ticker-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.symbol === data.symbol);
    });
  }

  _onRealError(data) {
    if (this.mode !== 'real') return;
    document.getElementById('ai-thinking').innerHTML =
      `<div class="thinking-idle" style="color:var(--red);">❌ Error: ${data.error}</div>`;
  }

  _onRealReset() {
    if (this.mode !== 'real') return;
    this.realAiPortfolio.reset();
    this.realUserPortfolio.reset();
    this.realTradeMarkers = [];
    this._realAiLastEval = -1;
    this._buyAndHold.peakValue = 10000;
    this._buyAndHold.maxDD = 0;
    this._updateRealUI();
  }

  _onRealTick(data) {
    if (this.mode !== 'real') return;

    // AI evaluation on real data
    this._evaluateRealAI(data);

    // Update buy & hold
    if (this._buyAndHold.shares > 0) {
      const bnhVal = this._buyAndHold.shares * data.candle.close +
        (10000 - this._buyAndHold.shares * this._buyAndHold.startPrice);
      if (bnhVal > this._buyAndHold.peakValue) this._buyAndHold.peakValue = bnhVal;
      const dd = ((this._buyAndHold.peakValue - bnhVal) / this._buyAndHold.peakValue) * 100;
      if (dd > this._buyAndHold.maxDD) this._buyAndHold.maxDD = dd;
    }

    // Update UI
    this._updateRealChart();
    this._updateRealTickerBar();

    document.getElementById('day-counter').textContent =
      `Day ${data.day + 1} / ${this.realMarket.candles.length}`;
    document.getElementById('tick-counter').textContent = data.candle.date;

    // Update portfolios
    const prices = {};
    prices[this.realMarket.symbol] = data.candle.close;
    this.realAiPortfolio.updateMetrics(prices);
    this.realUserPortfolio.updateMetrics(prices);

    this._renderPortfolio('ai');
    this._renderPortfolio('user');
    this._renderPerformance();

    // Progress bar in backtest section
    const pct = (data.progress * 100).toFixed(1);
    const btEl = document.getElementById('backtest-results');
    if (btEl && data.progress < 1) {
      this._renderBacktestProgress(data);
    }
  }

  _onRealDayClose(data) {
    // Handled in _onRealTick
  }

  _onRealComplete(data) {
    if (this.mode !== 'real') return;
    this._renderRealAIThinking('Replay complete! Review the results below.');
    this._renderBacktestFinal();
  }

  // ===== REAL AI EVALUATION =====
  _evaluateRealAI(data) {
    const candles = this.realMarket.getCandles(this.realMarket.symbol);
    if (candles.length < 5) return;

    // Evaluate every 2 candles (days)
    if (data.day - this._realAiLastEval < 2) return;
    this._realAiLastEval = data.day;

    const closes = candles.map(c => c.close);
    const price = data.candle.close;
    const symbol = this.realMarket.symbol;
    const cash = this.realAiPortfolio.cash;
    const holding = this.realAiPortfolio.getHolding(symbol);

    // Calculate indicators
    const sma20 = Indicators.SMA(closes, Math.min(20, closes.length));
    const sma50 = Indicators.SMA(closes, Math.min(50, closes.length));
    const rsi = Indicators.RSI(closes, Math.min(14, closes.length - 1));
    const bb = Indicators.BollingerBands(closes, Math.min(20, closes.length));

    const lastSMA20 = sma20[sma20.length - 1];
    const lastSMA50 = sma50[sma50.length - 1];
    const lastRSI = rsi[rsi.length - 1];
    const lastBBLower = bb.lower[bb.lower.length - 1];
    const lastBBUpper = bb.upper[bb.upper.length - 1];

    const maxShares = Math.floor(cash * 0.3 / price);
    const recentPrices = closes.slice(-10);
    const priceChange = recentPrices.length >= 2
      ? (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0] : 0;

    let action = null;
    let qty = 0;
    let reason = '';
    let strategy = 'AUTO';
    let confidence = 50;
    let score = 0;

    // Multi-strategy evaluation (simplified for real data)
    const candidates = [];

    // Momentum
    if (priceChange > 0.02 && lastRSI && lastRSI < 72 && maxShares > 0) {
      candidates.push({
        action: 'BUY', qty: Math.ceil(maxShares * 0.5), strategy: 'Momentum',
        reason: `Uptrend +${(priceChange * 100).toFixed(1)}%, RSI ${lastRSI?.toFixed(0)}`,
        score: priceChange * 3 + 0.5
      });
    }
    if (priceChange < -0.02 && holding && holding.qty > 0) {
      candidates.push({
        action: 'SELL', qty: Math.ceil(holding.qty * 0.5), strategy: 'Momentum',
        reason: `Downtrend ${(priceChange * 100).toFixed(1)}%, cutting losses`,
        score: Math.abs(priceChange) * 3 + 0.3
      });
    }

    // Mean reversion
    if (lastRSI && lastRSI < 30 && maxShares > 0) {
      candidates.push({
        action: 'BUY', qty: Math.ceil(maxShares * 0.6), strategy: 'Mean Reversion',
        reason: `RSI oversold at ${lastRSI.toFixed(0)}, expecting bounce`,
        score: (30 - lastRSI) / 15 + 0.5
      });
    }
    if (lastRSI && lastRSI > 70 && holding && holding.qty > 0) {
      candidates.push({
        action: 'SELL', qty: Math.ceil(holding.qty * 0.6), strategy: 'Mean Reversion',
        reason: `RSI overbought at ${lastRSI.toFixed(0)}, expecting pullback`,
        score: (lastRSI - 70) / 15 + 0.5
      });
    }

    // Bollinger Band
    if (lastBBLower && price < lastBBLower && maxShares > 0) {
      candidates.push({
        action: 'BUY', qty: Math.ceil(maxShares * 0.4), strategy: 'BB Bounce',
        reason: `Price below lower BB ($${lastBBLower.toFixed(2)})`,
        score: 1.2
      });
    }
    if (lastBBUpper && price > lastBBUpper && holding && holding.qty > 0) {
      candidates.push({
        action: 'SELL', qty: Math.ceil(holding.qty * 0.4), strategy: 'BB Sell',
        reason: `Price above upper BB ($${lastBBUpper.toFixed(2)})`,
        score: 1.0
      });
    }

    // Value: SMA50 deviation
    if (lastSMA50 && price < lastSMA50 * 0.94 && maxShares > 0) {
      candidates.push({
        action: 'BUY', qty: Math.ceil(maxShares * 0.5), strategy: 'Value',
        reason: `6%+ below SMA50 ($${lastSMA50.toFixed(2)}) — undervalued`,
        score: ((lastSMA50 - price) / lastSMA50) * 5 + 0.5
      });
    }

    // Breakout
    if (candles.length >= 15) {
      const range = closes.slice(-15, -1);
      const rangeHigh = Math.max(...range);
      if (price > rangeHigh * 1.01 && maxShares > 0) {
        candidates.push({
          action: 'BUY', qty: Math.ceil(maxShares * 0.5), strategy: 'Breakout',
          reason: `Broke above 15-day high $${rangeHigh.toFixed(2)}`,
          score: ((price - rangeHigh) / rangeHigh) * 5 + 0.8
        });
      }
    }

    // Sort by score
    candidates.sort((a, b) => b.score - a.score);

    // Execute best candidate if score > 0.5
    if (candidates.length > 0 && candidates[0].score > 0.5) {
      const best = candidates[0];
      action = best.action;
      qty = best.qty;
      reason = best.reason;
      strategy = best.strategy;
      score = best.score;
      confidence = Math.min(95, Math.max(20, best.score * 25));

      let result;
      if (action === 'BUY') {
        result = this.realAiPortfolio.buy(symbol, qty, price, data.day, data.tick);
      } else {
        result = this.realAiPortfolio.sell(symbol, qty, price, data.day, data.tick);
      }

      if (result) {
        this.realTradeMarkers.push({
          time: data.candle.date,
          position: action === 'BUY' ? 'belowBar' : 'aboveBar',
          color: action === 'BUY' ? '#00c176' : '#ff3b69',
          shape: action === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `AI ${action} ${result.qty}`,
        });
        this._renderTradeHistory();
      }
    }

    // Update AI thinking panel
    this._renderRealAIAnalysis(data, candidates, strategy, confidence, score, reason);
  }

  _renderRealAIAnalysis(data, candidates, strategy, confidence, score, reason) {
    const container = document.getElementById('ai-thinking');
    const prices = {};
    prices[this.realMarket.symbol] = data.candle.close;
    const aiVal = this.realAiPortfolio.totalValue(prices);
    const aiRet = this.realAiPortfolio.totalReturnPct(prices);

    const candles = this.realMarket.getCandles(this.realMarket.symbol);
    const closes = candles.map(c => c.close);
    const lastRSI = Indicators.RSI(closes, Math.min(14, closes.length - 1));
    const rsiVal = lastRSI[lastRSI.length - 1];

    const evalScore = Math.round(aiRet * 10);
    const evalBar = Math.max(0, Math.min(100, 50 + evalScore * 0.5));

    let html = `
      <div class="think-header">
        <div class="think-strat">Strategy: <strong>${strategy}</strong></div>
        <div class="think-confidence">Confidence: <strong>${confidence.toFixed(0)}%</strong></div>
      </div>
      <div class="eval-bar-container">
        <div class="eval-bar">
          <div class="eval-bar-fill" style="width:${evalBar}%"></div>
        </div>
        <div class="eval-score">${evalScore >= 0 ? '+' : ''}${evalScore} cp</div>
      </div>
      <div class="think-reasoning">
        📊 ${this.realMarket.symbol} @ $${data.candle.close.toFixed(2)} | ${data.candle.date}<br>
        RSI: ${rsiVal ? rsiVal.toFixed(1) : 'N/A'}<br>
        Portfolio: $${aiVal.toFixed(2)} (${aiRet >= 0 ? '+' : ''}${aiRet.toFixed(2)}%)<br>
        ${reason ? `Signal: ${reason}` : 'No high-conviction trade. Holding.'}
      </div>
      <div class="think-tree-header">
        <span>Evaluated Moves (${candidates.length} candidates)</span>
      </div>
      <div class="think-candidates">
    `;

    candidates.slice(0, 8).forEach((c, i) => {
      const isChosen = i === 0 && c.score > 0.5;
      const cls = isChosen ? 'candidate chosen' : 'candidate';
      const actionCls = c.action === 'BUY' ? 'cand-buy' : 'cand-sell';
      const bar = Math.min(100, c.score * 25);

      html += `<div class="${cls}">
        <div class="cand-rank">${i + 1}</div>
        <div class="cand-info">
          <span class="cand-action ${actionCls}">${c.action}</span>
          <span class="cand-sym">${this.realMarket.symbol}</span>
          <span class="cand-strat">${c.strategy}</span>
        </div>
        <div class="cand-bar"><div class="cand-bar-fill" style="width:${bar}%"></div></div>
        <div class="cand-score">${c.score.toFixed(2)}</div>
        <div class="cand-reason">${c.reason}</div>
      </div>`;
    });

    if (candidates.length === 0) {
      html += '<div style="color:var(--text-muted);font-size:11px;padding:8px;">No actionable signals detected. Holding positions.</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  _renderRealAIThinking(message) {
    document.getElementById('ai-thinking').innerHTML =
      `<div class="thinking-idle">${message}</div>`;
  }

  _renderBacktestProgress(data) {
    const prices = {};
    prices[this.realMarket.symbol] = data.candle.close;
    const aiRet = this.realAiPortfolio.totalReturnPct(prices);
    const userRet = this.realUserPortfolio.totalReturnPct(prices);
    const bnhRet = this._buyAndHoldReturn(data.candle.close);

    const btEl = document.getElementById('backtest-results');
    btEl.innerHTML = `
      <div class="bt-progress">
        <div class="bt-progress-bar" style="width:${(data.progress * 100).toFixed(1)}%"></div>
      </div>
      <div class="stat-row"><span class="stat-label">Progress</span><span class="stat-value">${(data.progress * 100).toFixed(0)}%</span></div>
      <div class="stat-row"><span class="stat-label">AI Return</span><span class="stat-value ${aiRet >= 0 ? 'positive' : 'negative'}">${aiRet >= 0 ? '+' : ''}${aiRet.toFixed(2)}%</span></div>
      <div class="stat-row"><span class="stat-label">Your Return</span><span class="stat-value ${userRet >= 0 ? 'positive' : 'negative'}">${userRet >= 0 ? '+' : ''}${userRet.toFixed(2)}%</span></div>
      <div class="stat-row"><span class="stat-label">Buy & Hold</span><span class="stat-value ${bnhRet >= 0 ? 'positive' : 'negative'}">${bnhRet >= 0 ? '+' : ''}${bnhRet.toFixed(2)}%</span></div>
    `;
  }

  _renderBacktestFinal() {
    const lastCandle = this.realMarket.replayCandles[this.realMarket.replayCandles.length - 1];
    if (!lastCandle) return;
    const prices = {};
    prices[this.realMarket.symbol] = lastCandle.close;
    const aiStats = this.realAiPortfolio.stats(prices);
    const userStats = this.realUserPortfolio.stats(prices);
    const bnhRet = this._buyAndHoldReturn(lastCandle.close);

    const btEl = document.getElementById('backtest-results');
    btEl.innerHTML = `
      <div class="bt-complete">✅ Backtest Complete</div>
      <div class="stat-row"><span class="stat-label">Period</span><span class="stat-value">${this.realMarket.getStartDate()} → ${this.realMarket.getEndDate()}</span></div>
      <div class="stat-row"><span class="stat-label">AI Return</span><span class="stat-value ${aiStats.totalReturnPct >= 0 ? 'positive' : 'negative'}">${aiStats.totalReturnPct >= 0 ? '+' : ''}${aiStats.totalReturnPct.toFixed(2)}%</span></div>
      <div class="stat-row"><span class="stat-label">AI Sharpe</span><span class="stat-value">${aiStats.sharpe.toFixed(2)}</span></div>
      <div class="stat-row"><span class="stat-label">AI Max DD</span><span class="stat-value">${aiStats.maxDrawdown.toFixed(2)}%</span></div>
      <div class="stat-row"><span class="stat-label">AI Trades</span><span class="stat-value">${aiStats.tradeCount}</span></div>
      <hr style="border-color:var(--border);margin:6px 0;">
      <div class="stat-row"><span class="stat-label">Your Return</span><span class="stat-value ${userStats.totalReturnPct >= 0 ? 'positive' : 'negative'}">${userStats.totalReturnPct >= 0 ? '+' : ''}${userStats.totalReturnPct.toFixed(2)}%</span></div>
      <div class="stat-row"><span class="stat-label">Your Trades</span><span class="stat-value">${userStats.tradeCount}</span></div>
      <hr style="border-color:var(--border);margin:6px 0;">
      <div class="stat-row"><span class="stat-label">Buy & Hold</span><span class="stat-value ${bnhRet >= 0 ? 'positive' : 'negative'}">${bnhRet >= 0 ? '+' : ''}${bnhRet.toFixed(2)}%</span></div>
      <div class="stat-row"><span class="stat-label">B&H Max DD</span><span class="stat-value">${this._buyAndHold.maxDD.toFixed(2)}%</span></div>
    `;
  }

  _buyAndHoldReturn(currentPrice) {
    if (!this._buyAndHold.startPrice || this._buyAndHold.startPrice === 0) return 0;
    const bnhValue = this._buyAndHold.shares * currentPrice +
      (10000 - this._buyAndHold.shares * this._buyAndHold.startPrice);
    return ((bnhValue - 10000) / 10000) * 100;
  }

  _updateRealChart() {
    const candles = this.realMarket.getCandles(this.realMarket.symbol);
    if (candles.length === 0) return;

    // Convert dates to proper format for lightweight-charts
    const chartCandles = candles.map(c => ({
      time: c.date, // YYYY-MM-DD string
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    this.chart.updateData(chartCandles, true);

    // Set trade markers
    if (this.realTradeMarkers.length > 0) {
      this.chart.setMarkers(this.realTradeMarkers);
    }
  }

  _updateRealTickerBar() {
    const quote = this.realMarket.getQuote(this.realMarket.symbol);
    if (!quote) return;
    const el = document.getElementById('ticker-info');
    if (el) {
      const cls = quote.changePct >= 0 ? 'positive' : 'negative';
      el.innerHTML = `
        <span class="ticker-price">$${quote.price.toFixed(2)}</span>
        <span class="ticker-change ${cls}">${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%</span>
        <span class="ticker-detail">O: $${quote.open.toFixed(2)} H: $${quote.dayHigh.toFixed(2)} L: $${quote.dayLow.toFixed(2)} V: ${this._fmtVol(quote.volume)}</span>
      `;
    }
  }

  _updateRealUI() {
    this._updateRealChart();
    this._updateRealTickerBar();
    this._renderPortfolio('ai');
    this._renderPortfolio('user');
    this._renderPerformance();
    this._renderTradeHistory();
  }

  // ===== ORIGINAL SIM METHODS (unchanged) =====
  _bindEvents() {
    this.market.on((evt, data) => {
      if (this.mode !== 'sim') return;
      if (evt === 'tick') this._onTick(data);
      if (evt === 'dayClose') this._onDayClose(data);
      if (evt === 'event') this._onMarketEvent(data);
      if (evt === 'reset') this._onReset();
    });

    this.ai.on((evt, data) => {
      if (this.mode !== 'sim') return;
      if (evt === 'trade') this._onAITrade(data);
      if (evt === 'analysis') this._renderAIThinking();
    });

    // Control buttons — handle both modes
    document.getElementById('btn-play').addEventListener('click', () => {
      if (this.mode === 'sim') this.market.play();
      else this.realMarket.play();
    });
    document.getElementById('btn-pause').addEventListener('click', () => {
      if (this.mode === 'sim') this.market.pause();
      else this.realMarket.pause();
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (this.mode === 'sim') this._reset();
      else this.realMarket.reset();
    });

    // Speed — handle both modes
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const speed = parseInt(e.target.dataset.speed);
        this.market.setSpeed(speed);
        this.realMarket.setSpeed(speed);
      });
    });

    // Strategy (sim only)
    document.getElementById('strategy-select').addEventListener('change', (e) => {
      this.selectedStrategy = e.target.value;
      this.ai.setStrategy(e.target.value);
    });

    // Scenario (sim only)
    document.getElementById('scenario-select').addEventListener('change', (e) => {
      this.market.setScenario(e.target.value);
    });

    // User trade buttons — handle both modes
    document.getElementById('btn-user-buy').addEventListener('click', () => this._userTrade('BUY'));
    document.getElementById('btn-user-sell').addEventListener('click', () => this._userTrade('SELL'));

    // Indicator toggles
    document.querySelectorAll('.ind-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ind = e.target.dataset.ind;
        e.target.classList.toggle('active');
        this.chart.toggleIndicator(ind);
        if (this.mode === 'sim') this._updateChart();
        else this._updateRealChart();
      });
    });
  }

  _buildWatchlist() {
    const list = document.getElementById('watchlist-body');
    list.innerHTML = '';
    COMPANIES.forEach(c => {
      const row = document.createElement('div');
      row.className = 'watchlist-row';
      row.dataset.symbol = c.symbol;
      row.innerHTML = `
        <span class="wl-symbol" style="color:${c.color}">${c.symbol}</span>
        <span class="wl-price" id="wl-price-${c.symbol}">$${c.basePrice.toFixed(2)}</span>
        <span class="wl-change" id="wl-change-${c.symbol}">0.00%</span>
      `;
      row.addEventListener('click', () => this.selectSymbol(c.symbol));
      list.appendChild(row);
    });
  }

  _buildControls() {
    const qtyInput = document.getElementById('user-qty');
    if (qtyInput) qtyInput.value = 10;
  }

  selectSymbol(symbol) {
    if (this.mode !== 'sim') return;
    this.selectedSymbol = symbol;
    this.chart.setSymbol(symbol);
    this._updateChart();

    document.querySelectorAll('.watchlist-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.symbol === symbol);
    });

    const q = this.market.getQuote(symbol);
    if (q) {
      document.getElementById('chart-symbol').textContent = `${q.symbol} — ${q.name}`;
      document.getElementById('chart-sector').textContent = q.sector;
    }
  }

  _onTick(data) {
    this.ai.evaluate(data.tick);
    if (data.tick % 2 === 0) {
      this._updateWatchlist();
      this._updateChart();
      this._updateTickerBar();
      this._renderPortfolio('ai');
      this._renderPortfolio('user');
      this._renderPerformance();
    }
    document.getElementById('day-counter').textContent = `Day ${this.market.day + 1}`;
    document.getElementById('tick-counter').textContent = `Tick ${data.intraIndex + 1}/${this.market.ticksPerDay}`;
  }

  _onDayClose() {
    const prices = {};
    this.market.getAllQuotes().forEach(q => prices[q.symbol] = q.price);
    this.aiPortfolio.updateMetrics(prices);
    this.userPortfolio.updateMetrics(prices);
    this._renderPerformance();
  }

  _onMarketEvent(evt) {
    this._eventQueue.unshift(evt);
    if (this._eventQueue.length > 20) this._eventQueue.pop();
    this._renderEvents();
  }

  _onAITrade(trade) {
    if (trade.symbol === this.selectedSymbol) {
      this.tradeMarkers.push({
        time: this.market.day,
        position: trade.side === 'BUY' ? 'belowBar' : 'aboveBar',
        color: trade.side === 'BUY' ? '#00c176' : '#ff3b69',
        shape: trade.side === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: `AI ${trade.side} ${trade.qty}`,
      });
    }
    this._renderTradeHistory();
    this._renderAIThinking();
  }

  _onReset() {
    this.aiPortfolio.reset();
    this.userPortfolio.reset();
    this.tradeMarkers = [];
    this._eventQueue = [];
    this._updateUI();
  }

  _reset() {
    this.market.reset();
    this.selectSymbol(this.selectedSymbol);
  }

  _updateChart() {
    const candles = this.market.getCandles(this.selectedSymbol);
    this.chart.updateData(candles, true);
    if (this.tradeMarkers.length > 0) {
      this.chart.setMarkers(this.tradeMarkers.filter(m => true));
    }
  }

  _updateWatchlist() {
    this.market.getAllQuotes().forEach(q => {
      const priceEl = document.getElementById(`wl-price-${q.symbol}`);
      const changeEl = document.getElementById(`wl-change-${q.symbol}`);
      if (priceEl) priceEl.textContent = `$${q.price.toFixed(2)}`;
      if (changeEl) {
        const pct = q.changePct;
        changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        changeEl.className = `wl-change ${pct >= 0 ? 'positive' : 'negative'}`;
      }
    });
  }

  _updateTickerBar() {
    const quote = this.market.getQuote(this.selectedSymbol);
    if (!quote) return;
    const el = document.getElementById('ticker-info');
    if (el) {
      const cls = quote.changePct >= 0 ? 'positive' : 'negative';
      el.innerHTML = `
        <span class="ticker-price">$${quote.price.toFixed(2)}</span>
        <span class="ticker-change ${cls}">${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%</span>
        <span class="ticker-detail">O: $${quote.open.toFixed(2)} H: $${quote.dayHigh.toFixed(2)} L: $${quote.dayLow.toFixed(2)} V: ${this._fmtVol(quote.volume)}</span>
      `;
    }
  }

  _renderPortfolio(who) {
    const isReal = this.mode === 'real';
    const pf = who === 'ai'
      ? (isReal ? this.realAiPortfolio : this.aiPortfolio)
      : (isReal ? this.realUserPortfolio : this.userPortfolio);

    const prices = {};
    if (isReal) {
      const q = this.realMarket.getQuote(this.realMarket.symbol);
      if (q) prices[this.realMarket.symbol] = q.price;
    } else {
      this.market.getAllQuotes().forEach(q => prices[q.symbol] = q.price);
    }

    const stats = pf.stats(prices);
    const prefix = who === 'ai' ? 'ai' : 'user';

    document.getElementById(`${prefix}-cash`).textContent = `$${stats.cash.toFixed(2)}`;
    document.getElementById(`${prefix}-value`).textContent = `$${stats.totalValue.toFixed(2)}`;

    const pnlEl = document.getElementById(`${prefix}-pnl`);
    pnlEl.textContent = `${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}`;
    pnlEl.className = `stat-value ${stats.totalPnL >= 0 ? 'positive' : 'negative'}`;

    const retEl = document.getElementById(`${prefix}-return`);
    retEl.textContent = `${stats.totalReturnPct >= 0 ? '+' : ''}${stats.totalReturnPct.toFixed(2)}%`;
    retEl.className = `stat-value ${stats.totalReturnPct >= 0 ? 'positive' : 'negative'}`;

    document.getElementById(`${prefix}-trades`).textContent = stats.tradeCount;
    document.getElementById(`${prefix}-winrate`).textContent = `${stats.winRate.toFixed(0)}%`;

    // Holdings
    const holdingsEl = document.getElementById(`${prefix}-holdings`);
    const holdingKeys = Object.keys(stats.holdings);
    if (holdingKeys.length === 0) {
      holdingsEl.innerHTML = '<div class="holding-empty">No positions</div>';
    } else {
      holdingsEl.innerHTML = holdingKeys.map(sym => {
        const h = stats.holdings[sym];
        const curPrice = prices[sym] || 0;
        const pnl = (curPrice - h.avgCost) * h.qty;
        const cls = pnl >= 0 ? 'positive' : 'negative';
        return `<div class="holding-row">
          <span class="h-sym">${sym}</span>
          <span class="h-qty">${h.qty} @ $${h.avgCost.toFixed(2)}</span>
          <span class="h-pnl ${cls}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span>
        </div>`;
      }).join('');
    }
  }

  _renderPerformance() {
    const isReal = this.mode === 'real';
    const prices = {};

    if (isReal) {
      const q = this.realMarket.getQuote(this.realMarket.symbol);
      if (q) prices[this.realMarket.symbol] = q.price;
    } else {
      this.market.getAllQuotes().forEach(q => prices[q.symbol] = q.price);
    }

    const aiPf = isReal ? this.realAiPortfolio : this.aiPortfolio;
    const userPf = isReal ? this.realUserPortfolio : this.userPortfolio;
    const aiStats = aiPf.stats(prices);
    const userStats = userPf.stats(prices);

    document.getElementById('perf-ai-sharpe').textContent = aiStats.sharpe.toFixed(2);
    document.getElementById('perf-ai-dd').textContent = `${aiStats.maxDrawdown.toFixed(2)}%`;
    document.getElementById('perf-user-sharpe').textContent = userStats.sharpe.toFixed(2);
    document.getElementById('perf-user-dd').textContent = `${userStats.maxDrawdown.toFixed(2)}%`;

    // Real mode: return columns + buy & hold
    const aiRetEl = document.getElementById('perf-ai-return');
    const userRetEl = document.getElementById('perf-user-return');
    const bnhRetEl = document.getElementById('perf-bnh-return');
    const bnhDDEl = document.getElementById('perf-bnh-dd');

    if (isReal) {
      if (aiRetEl) aiRetEl.textContent = `${aiStats.totalReturnPct >= 0 ? '+' : ''}${aiStats.totalReturnPct.toFixed(2)}%`;
      if (userRetEl) userRetEl.textContent = `${userStats.totalReturnPct >= 0 ? '+' : ''}${userStats.totalReturnPct.toFixed(2)}%`;

      const lastPrice = this.realMarket.replayCandles.length > 0
        ? this.realMarket.replayCandles[this.realMarket.replayCandles.length - 1].close : 0;
      const bnhRet = this._buyAndHoldReturn(lastPrice);
      if (bnhRetEl) {
        bnhRetEl.textContent = `${bnhRet >= 0 ? '+' : ''}${bnhRet.toFixed(2)}%`;
        bnhRetEl.className = `perf-val ${bnhRet >= 0 ? 'positive' : 'negative'}`;
      }
      if (bnhDDEl) bnhDDEl.textContent = `${this._buyAndHold.maxDD.toFixed(2)}%`;
    }

    // Score comparison bar
    const aiVal = aiStats.totalValue;
    const userVal = userStats.totalValue;
    const total = aiVal + userVal;
    const aiPct = total > 0 ? (aiVal / total * 100) : 50;
    const bar = document.getElementById('score-bar-fill');
    if (bar) bar.style.width = `${aiPct}%`;

    const label = document.getElementById('score-label');
    if (label) {
      if (aiVal > userVal * 1.001) label.textContent = `AI leads by $${(aiVal - userVal).toFixed(2)}`;
      else if (userVal > aiVal * 1.001) label.textContent = `You lead by $${(userVal - aiVal).toFixed(2)}`;
      else label.textContent = 'Tied';
    }
  }

  _renderTradeHistory() {
    const container = document.getElementById('trade-log');
    const isReal = this.mode === 'real';
    const aiPf = isReal ? this.realAiPortfolio : this.aiPortfolio;
    const userPf = isReal ? this.realUserPortfolio : this.userPortfolio;

    const allTrades = [
      ...aiPf.trades.map(t => ({ ...t, who: 'AI' })),
      ...userPf.trades.map(t => ({ ...t, who: 'YOU' }))
    ].sort((a, b) => (b.tick || b.id) - (a.tick || a.id)).slice(0, 50);

    container.innerHTML = allTrades.map(t => {
      const cls = t.side === 'BUY' ? 'trade-buy' : 'trade-sell';
      const pnlStr = t.pnl !== undefined ? ` | P&L: <span class="${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>` : '';
      return `<div class="trade-row ${cls}">
        <span class="trade-who">${t.who}</span>
        <span class="trade-action">${t.side}</span>
        <span class="trade-detail">${t.qty} ${t.symbol} @ $${t.price.toFixed(2)}${pnlStr}</span>
        <span class="trade-day">D${t.day || 0}</span>
      </div>`;
    }).join('');
  }

  _renderAIThinking() {
    if (this.mode !== 'sim') return;
    const tree = this.ai.getThinkingTree();
    const container = document.getElementById('ai-thinking');
    if (!tree) {
      container.innerHTML = '<div class="thinking-idle">AI engine idle — press Play to start</div>';
      return;
    }

    const evalScore = tree.positionScore;
    const evalBar = Math.max(0, Math.min(100, 50 + evalScore * 0.5));

    let html = `
      <div class="think-header">
        <div class="think-strat">Strategy: <strong>${tree.strategy}</strong></div>
        <div class="think-confidence">Confidence: <strong>${tree.confidence.toFixed(0)}%</strong></div>
      </div>
      <div class="eval-bar-container">
        <div class="eval-bar">
          <div class="eval-bar-fill" style="width:${evalBar}%"></div>
        </div>
        <div class="eval-score">${evalScore >= 0 ? '+' : ''}${evalScore} cp</div>
      </div>
      <div class="think-chosen">
        ${tree.chosen ? `<div class="chosen-move">
          <span class="move-icon">${tree.chosen.action === 'BUY' ? '▲' : tree.chosen.action === 'SELL' ? '▼' : '■'}</span>
          <span class="move-text">${tree.chosen.action} ${tree.chosen.qty || ''} ${tree.chosen.symbol} ${tree.chosen.price ? '@ $' + tree.chosen.price.toFixed(2) : ''}</span>
          <span class="move-score">Score: ${(tree.chosen.score || 0).toFixed(2)}</span>
        </div>` : ''}
      </div>
      <div class="think-reasoning">${(tree.reasoning || '').replace(/\n/g, '<br>')}</div>
      <div class="think-tree-header">
        <span>Evaluated Moves (${tree.treeNodes} nodes, depth ${tree.depth})</span>
      </div>
      <div class="think-candidates">
    `;

    (tree.candidates || []).slice(0, 8).forEach((c, i) => {
      const isChosen = tree.chosen && c.symbol === tree.chosen.symbol && c.action === tree.chosen.action && c.strategy === tree.chosen.strategy;
      const cls = isChosen ? 'candidate chosen' : 'candidate';
      const actionCls = c.action === 'BUY' ? 'cand-buy' : 'cand-sell';
      const bar = Math.min(100, c.score * 15);

      html += `<div class="${cls}">
        <div class="cand-rank">${i + 1}</div>
        <div class="cand-info">
          <span class="cand-action ${actionCls}">${c.action}</span>
          <span class="cand-sym">${c.symbol}</span>
          <span class="cand-strat">${c.strategy}</span>
        </div>
        <div class="cand-bar"><div class="cand-bar-fill" style="width:${bar}%"></div></div>
        <div class="cand-score">${c.score.toFixed(2)}</div>
        <div class="cand-reason">${c.reason || ''}</div>
      </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  _renderEvents() {
    const container = document.getElementById('event-log');
    container.innerHTML = this._eventQueue.slice(0, 10).map(e => {
      return `<div class="event-row">
        <span class="event-day">D${e.day}</span>
        <span class="event-text">${e.text}</span>
      </div>`;
    }).join('');
  }

  _userTrade(side) {
    const isReal = this.mode === 'real';
    const sym = isReal ? this.realMarket.symbol : this.selectedSymbol;
    const qty = parseInt(document.getElementById('user-qty').value) || 10;
    const pf = isReal ? this.realUserPortfolio : this.userPortfolio;

    let price, day, tick;
    if (isReal) {
      const q = this.realMarket.getQuote(sym);
      if (!q) return;
      price = side === 'BUY' ? q.ask : q.bid;
      day = this.realMarket.day;
      tick = this.realMarket.tick;
    } else {
      const q = this.market.getQuote(sym);
      if (!q) return;
      price = side === 'BUY' ? q.ask : q.bid;
      day = this.market.day;
      tick = this.market.tick;
    }

    let result;
    if (side === 'BUY') {
      result = pf.buy(sym, qty, price, day, tick);
    } else {
      result = pf.sell(sym, qty, price, day, tick);
    }

    if (result) {
      if (isReal) {
        const currentDate = this.realMarket.getCurrentDate();
        this.realTradeMarkers.push({
          time: currentDate,
          position: side === 'BUY' ? 'belowBar' : 'aboveBar',
          color: side === 'BUY' ? '#4caf50' : '#ff9800',
          shape: side === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `YOU ${side} ${qty}`,
        });
        this._updateRealChart();
      } else {
        this.tradeMarkers.push({
          time: day,
          position: side === 'BUY' ? 'belowBar' : 'aboveBar',
          color: side === 'BUY' ? '#4caf50' : '#ff9800',
          shape: side === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `YOU ${side} ${qty}`,
        });
      }
      this._renderTradeHistory();
      this._renderPortfolio('user');
    }
  }

  _updateUI() {
    this._updateWatchlist();
    this._renderPortfolio('ai');
    this._renderPortfolio('user');
    this._renderTradeHistory();
    this._renderAIThinking();
    this._renderPerformance();
    this._renderEvents();
  }

  _fmtVol(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v.toString();
  }

  _loadSettings() {
    try {
      const saved = localStorage.getItem('algo-trade-settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.strategy) {
          this.selectedStrategy = s.strategy;
          this.ai.setStrategy(s.strategy);
          document.getElementById('strategy-select').value = s.strategy;
        }
        if (s.mode === 'real') {
          // Auto-switch to real mode on load if previously used
          setTimeout(() => this._switchMode('real'), 100);
        }
      }
    } catch(e) {}
  }

  _saveSettings() {
    try {
      localStorage.setItem('algo-trade-settings', JSON.stringify({
        strategy: this.selectedStrategy,
        mode: this.mode,
      }));
    } catch(e) {}
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});
