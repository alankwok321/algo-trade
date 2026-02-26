// app.js — Main app controller & UI

class App {
  constructor() {
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
  }

  init() {
    this.chart.init();
    this._buildWatchlist();
    this._buildControls();
    this._bindEvents();
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

  _bindEvents() {
    this.market.on((evt, data) => {
      if (evt === 'tick') this._onTick(data);
      if (evt === 'dayClose') this._onDayClose(data);
      if (evt === 'event') this._onMarketEvent(data);
      if (evt === 'reset') this._onReset();
    });

    this.ai.on((evt, data) => {
      if (evt === 'trade') this._onAITrade(data);
      if (evt === 'analysis') this._renderAIThinking();
    });

    // Control buttons
    document.getElementById('btn-play').addEventListener('click', () => this.market.play());
    document.getElementById('btn-pause').addEventListener('click', () => this.market.pause());
    document.getElementById('btn-reset').addEventListener('click', () => this._reset());

    // Speed
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.market.setSpeed(parseInt(e.target.dataset.speed));
      });
    });

    // Strategy
    document.getElementById('strategy-select').addEventListener('change', (e) => {
      this.selectedStrategy = e.target.value;
      this.ai.setStrategy(e.target.value);
    });

    // Scenario
    document.getElementById('scenario-select').addEventListener('change', (e) => {
      this.market.setScenario(e.target.value);
    });

    // User trade buttons
    document.getElementById('btn-user-buy').addEventListener('click', () => this._userTrade('BUY'));
    document.getElementById('btn-user-sell').addEventListener('click', () => this._userTrade('SELL'));

    // Indicator toggles
    document.querySelectorAll('.ind-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ind = e.target.dataset.ind;
        e.target.classList.toggle('active');
        this.chart.toggleIndicator(ind);
        this._updateChart();
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
    // Quantity input
    const qtyInput = document.getElementById('user-qty');
    if (qtyInput) qtyInput.value = 10;
  }

  selectSymbol(symbol) {
    this.selectedSymbol = symbol;
    this.chart.setSymbol(symbol);
    this._updateChart();

    // Highlight in watchlist
    document.querySelectorAll('.watchlist-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.symbol === symbol);
    });

    // Update header
    const q = this.market.getQuote(symbol);
    if (q) {
      document.getElementById('chart-symbol').textContent = `${q.symbol} — ${q.name}`;
      document.getElementById('chart-sector').textContent = q.sector;
    }
  }

  _onTick(data) {
    // AI evaluation
    this.ai.evaluate(data.tick);

    // Update UI at reasonable rate
    if (data.tick % 2 === 0) {
      this._updateWatchlist();
      this._updateChart();
      this._updateTickerBar();
      this._renderPortfolio('ai');
      this._renderPortfolio('user');
      this._renderPerformance();
    }

    // Day counter
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
    // Add marker to chart
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
    const pf = who === 'ai' ? this.aiPortfolio : this.userPortfolio;
    const prices = {};
    this.market.getAllQuotes().forEach(q => prices[q.symbol] = q.price);
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
    const prices = {};
    this.market.getAllQuotes().forEach(q => prices[q.symbol] = q.price);
    const aiStats = this.aiPortfolio.stats(prices);
    const userStats = this.userPortfolio.stats(prices);

    document.getElementById('perf-ai-sharpe').textContent = aiStats.sharpe.toFixed(2);
    document.getElementById('perf-ai-dd').textContent = `${aiStats.maxDrawdown.toFixed(2)}%`;
    document.getElementById('perf-user-sharpe').textContent = userStats.sharpe.toFixed(2);
    document.getElementById('perf-user-dd').textContent = `${userStats.maxDrawdown.toFixed(2)}%`;

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
    const allTrades = [
      ...this.aiPortfolio.trades.map(t => ({ ...t, who: 'AI' })),
      ...this.userPortfolio.trades.map(t => ({ ...t, who: 'YOU' }))
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
    const tree = this.ai.getThinkingTree();
    const container = document.getElementById('ai-thinking');
    if (!tree) {
      container.innerHTML = '<div class="thinking-idle">AI engine idle — press Play to start</div>';
      return;
    }

    // Position score (like chess eval)
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
    const sym = this.selectedSymbol;
    const qty = parseInt(document.getElementById('user-qty').value) || 10;
    const quote = this.market.getQuote(sym);
    if (!quote) return;
    const price = side === 'BUY' ? quote.ask : quote.bid;

    let result;
    if (side === 'BUY') {
      result = this.userPortfolio.buy(sym, qty, price, this.market.day, this.market.tick);
    } else {
      result = this.userPortfolio.sell(sym, qty, price, this.market.day, this.market.tick);
    }

    if (result) {
      // Add marker
      this.tradeMarkers.push({
        time: this.market.day,
        position: side === 'BUY' ? 'belowBar' : 'aboveBar',
        color: side === 'BUY' ? '#4caf50' : '#ff9800',
        shape: side === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: `YOU ${side} ${qty}`,
      });
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
      }
    } catch(e) {}
  }

  _saveSettings() {
    try {
      localStorage.setItem('algo-trade-settings', JSON.stringify({
        strategy: this.selectedStrategy
      }));
    } catch(e) {}
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});
