// real-market.js — Real Yahoo Finance Market Data Module

class RealMarketEngine {
  constructor() {
    this.symbol = 'AAPL';
    this.symbolInfo = null;
    this.candles = [];      // full historical OHLCV data
    this.replayIndex = 0;   // current replay position
    this.replayCandles = []; // candles revealed so far
    this.paused = true;
    this.speed = 1;
    this.intervalId = null;
    this.baseInterval = 800; // ms per candle at 1x
    this.listeners = [];
    this.loading = false;
    this.error = null;
    this.range = '1y';
    this.day = 0;
    this.tick = 0;
    this.ticksPerDay = 1; // 1 tick = 1 day in real mode
  }

  on(fn) { this.listeners.push(fn); }
  emit(evt, data) { this.listeners.forEach(fn => fn(evt, data)); }

  setSpeed(s) {
    this.speed = s;
    if (!this.paused) { this.pause(); this.play(); }
  }

  async loadSymbol(symbol, range = '1y') {
    this.pause();
    this.loading = true;
    this.error = null;
    this.symbol = symbol.toUpperCase();
    this.range = range;
    this.emit('loading', { symbol: this.symbol });

    try {
      const res = await fetch(`/api/yahoo/history?symbol=${encodeURIComponent(this.symbol)}&range=${range}&interval=1d`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();

      if (!data.candles || data.candles.length === 0) {
        throw new Error('No historical data available');
      }

      this.symbolInfo = {
        symbol: data.symbol,
        currency: data.currency,
        exchange: data.exchange,
        type: data.instrumentType,
        regularMarketPrice: data.regularMarketPrice,
        previousClose: data.previousClose,
      };

      this.candles = data.candles;
      this.replayIndex = 0;
      this.replayCandles = [];
      this.day = 0;
      this.tick = 0;
      this.loading = false;

      this.emit('loaded', {
        symbol: this.symbol,
        info: this.symbolInfo,
        totalCandles: this.candles.length,
      });

      // Show first candle
      this._advanceReplay();

      return data;
    } catch (err) {
      this.loading = false;
      this.error = err.message;
      this.emit('error', { error: err.message });
      throw err;
    }
  }

  play() {
    if (!this.paused) return;
    if (this.candles.length === 0) return;
    if (this.replayIndex >= this.candles.length) return;
    this.paused = false;
    this._schedule();
    this.emit('play');
  }

  pause() {
    this.paused = true;
    if (this.intervalId) { clearTimeout(this.intervalId); this.intervalId = null; }
    this.emit('pause');
  }

  reset() {
    this.pause();
    this.replayIndex = 0;
    this.replayCandles = [];
    this.day = 0;
    this.tick = 0;
    if (this.candles.length > 0) {
      this._advanceReplay();
    }
    this.emit('reset');
  }

  _schedule() {
    if (this.paused) return;
    const delay = Math.max(10, this.baseInterval / this.speed);
    this.intervalId = setTimeout(() => {
      if (this.replayIndex < this.candles.length) {
        this._advanceReplay();
        this._schedule();
      } else {
        this.paused = true;
        this.emit('complete', { totalDays: this.candles.length });
      }
    }, delay);
  }

  _advanceReplay() {
    if (this.replayIndex >= this.candles.length) return;

    const candle = this.candles[this.replayIndex];
    this.replayCandles.push(candle);
    this.day = this.replayIndex;
    this.tick++;

    this.emit('tick', {
      tick: this.tick,
      day: this.day,
      intraIndex: 0,
      candle,
      symbol: this.symbol,
      progress: (this.replayIndex + 1) / this.candles.length,
    });

    this.emit('dayClose', { day: this.day });

    this.replayIndex++;
  }

  getCandles(symbol, count = 500) {
    if (symbol && symbol !== this.symbol) return [];
    return this.replayCandles.slice(-count);
  }

  getQuote(symbol) {
    if (symbol && symbol !== this.symbol) return null;
    if (this.replayCandles.length === 0) return null;
    const last = this.replayCandles[this.replayCandles.length - 1];
    const first = this.replayCandles[0];
    const prev = this.replayCandles.length > 1 ? this.replayCandles[this.replayCandles.length - 2] : first;
    return {
      symbol: this.symbol,
      name: this.symbolInfo ? this.symbolInfo.symbol : this.symbol,
      sector: this.symbolInfo ? `${this.symbolInfo.exchange} · ${this.symbolInfo.currency}` : '',
      price: last.close,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
      dayHigh: last.high,
      dayLow: last.low,
      prevClose: prev.close,
      change: last.close - prev.close,
      changePct: prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
      bid: last.close * 0.999,
      ask: last.close * 1.001,
      date: last.date,
      color: '#00d4ff',
      basePrice: first.open,
    };
  }

  getAllQuotes() {
    const q = this.getQuote(this.symbol);
    return q ? [q] : [];
  }

  getSymbols() {
    return this.symbol ? [this.symbol] : [];
  }

  getIntradayPrices() { return []; }

  // Backtest: return all candles up to current replay position
  getBacktestData() {
    return this.replayCandles.slice();
  }

  // Get full historical data (for AI pre-analysis)
  getFullHistory() {
    return this.candles.slice();
  }

  isComplete() {
    return this.replayIndex >= this.candles.length;
  }

  getProgress() {
    if (this.candles.length === 0) return 0;
    return this.replayIndex / this.candles.length;
  }

  getCurrentDate() {
    if (this.replayCandles.length === 0) return '';
    return this.replayCandles[this.replayCandles.length - 1].date;
  }

  getStartDate() {
    return this.candles.length > 0 ? this.candles[0].date : '';
  }

  getEndDate() {
    return this.candles.length > 0 ? this.candles[this.candles.length - 1].date : '';
  }
}

// Static: search symbols
RealMarketEngine.searchSymbols = async function(query) {
  if (!query || query.length < 1) return [];
  try {
    const res = await fetch(`/api/yahoo/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    return [];
  }
};

// Static: get quote
RealMarketEngine.getQuote = async function(symbol) {
  try {
    const res = await fetch(`/api/yahoo/quote?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
};

if (typeof module !== 'undefined') module.exports = RealMarketEngine;
