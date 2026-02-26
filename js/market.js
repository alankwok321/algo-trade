// market.js — Market Simulation Engine

const COMPANIES = [
  { symbol: 'NOVA', name: 'Nova Technologies', sector: 'Tech Growth', basePrice: 185, volatility: 0.025, trend: 0.0004, color: '#00d4ff' },
  { symbol: 'STBL', name: 'Stable Energy Corp', sector: 'Dividend', basePrice: 72, volatility: 0.008, trend: 0.0001, color: '#4caf50' },
  { symbol: 'QBIT', name: 'Qbit Quantum', sector: 'Speculative Tech', basePrice: 42, volatility: 0.04, trend: 0.0006, color: '#e040fb' },
  { symbol: 'RXMD', name: 'RxMed Pharma', sector: 'Healthcare', basePrice: 128, volatility: 0.018, trend: 0.0002, color: '#ff9800' },
  { symbol: 'MFIN', name: 'MetaFinance', sector: 'Fintech', basePrice: 95, volatility: 0.022, trend: 0.0003, color: '#00e676' },
  { symbol: 'PNYX', name: 'Pynx Minerals', sector: 'Penny / Mining', basePrice: 8.5, volatility: 0.055, trend: -0.0001, color: '#ff5252' },
  { symbol: 'AERO', name: 'AeroDefense Sys', sector: 'Defense', basePrice: 210, volatility: 0.012, trend: 0.00015, color: '#7c8aff' },
  { symbol: 'GLBX', name: 'Globex Logistics', sector: 'Industrial', basePrice: 55, volatility: 0.015, trend: 0.00012, color: '#ffab40' }
];

const MARKET_EVENTS = [
  { type: 'earnings_beat', text: '{symbol} smashes earnings — EPS +22% vs expectations', priceEffect: [0.03, 0.08], volEffect: 1.8, duration: [5, 15] },
  { type: 'earnings_miss', text: '{symbol} misses earnings badly — revenue down 15%', priceEffect: [-0.08, -0.03], volEffect: 2.0, duration: [5, 15] },
  { type: 'fda_approval', text: '{symbol} receives FDA approval for key drug', priceEffect: [0.05, 0.15], volEffect: 2.5, duration: [3, 10] },
  { type: 'scandal', text: 'CEO of {symbol} under investigation — shares plummet', priceEffect: [-0.15, -0.06], volEffect: 3.0, duration: [8, 20] },
  { type: 'partnership', text: '{symbol} announces major partnership deal', priceEffect: [0.02, 0.06], volEffect: 1.5, duration: [3, 8] },
  { type: 'sector_rally', text: 'Sector-wide rally lifts {symbol} and peers', priceEffect: [0.01, 0.04], volEffect: 1.3, duration: [5, 12] },
  { type: 'market_crash', text: '⚠️ Flash crash — broad market selloff hits {symbol}', priceEffect: [-0.10, -0.04], volEffect: 3.5, duration: [10, 25] },
  { type: 'buyback', text: '{symbol} announces $2B share buyback program', priceEffect: [0.02, 0.05], volEffect: 1.2, duration: [5, 10] },
  { type: 'downgrade', text: 'Analyst downgrades {symbol} to Sell — price target cut 30%', priceEffect: [-0.06, -0.02], volEffect: 1.8, duration: [4, 10] },
  { type: 'upgrade', text: 'Goldman upgrades {symbol} to Strong Buy', priceEffect: [0.02, 0.06], volEffect: 1.5, duration: [4, 10] },
  { type: 'fed_rate', text: '🏦 Fed holds rates steady — market reacts', priceEffect: [-0.02, 0.03], volEffect: 1.8, duration: [8, 20] },
  { type: 'war_tension', text: '🌐 Geopolitical tensions escalate — defense stocks surge', priceEffect: [-0.03, 0.05], volEffect: 2.0, duration: [10, 20] },
];

const SCENARIOS = {
  normal: { trendMult: 1, volMult: 1, eventFreq: 1, label: 'Normal Market' },
  bull: { trendMult: 3, volMult: 0.7, eventFreq: 0.8, label: 'Bull Market 🐂' },
  bear: { trendMult: -2, volMult: 1.5, eventFreq: 1.3, label: 'Bear Market 🐻' },
  sideways: { trendMult: 0.1, volMult: 0.5, eventFreq: 0.6, label: 'Sideways ➡️' },
  crash: { trendMult: -5, volMult: 3, eventFreq: 2.5, label: 'Market Crash 💥' }
};

class MarketEngine {
  constructor() {
    this.stocks = {};
    this.tick = 0;
    this.day = 0;
    this.ticksPerDay = 78; // ~6.5 hours of trading in ticks
    this.scenario = SCENARIOS.normal;
    this.activeEvents = [];
    this.eventLog = [];
    this.listeners = [];
    this.paused = true;
    this.speed = 1;
    this.intervalId = null;
    this.baseInterval = 385; // ms per tick at 1x = ~30s per day
    this._initStocks();
  }

  _initStocks() {
    COMPANIES.forEach(c => {
      this.stocks[c.symbol] = {
        ...c,
        price: c.basePrice,
        open: c.basePrice,
        high: c.basePrice,
        low: c.basePrice,
        close: c.basePrice,
        volume: 0,
        history: [], // array of { time, open, high, low, close, volume }
        tickHistory: [], // raw price every tick for intraday
        dayPrices: [],
        prevClose: c.basePrice,
        bid: c.basePrice - 0.01,
        ask: c.basePrice + 0.01,
        change: 0,
        changePct: 0,
        dayHigh: c.basePrice,
        dayLow: c.basePrice,
        _vol: c.volatility,
        _trend: c.trend,
        _eventEffect: 0,
        _eventVol: 1,
        _eventTicks: 0
      };
    });
  }

  setScenario(name) {
    this.scenario = SCENARIOS[name] || SCENARIOS.normal;
  }

  setSpeed(s) {
    this.speed = s;
    if (!this.paused) { this.pause(); this.play(); }
  }

  on(fn) { this.listeners.push(fn); }
  emit(evt, data) { this.listeners.forEach(fn => fn(evt, data)); }

  play() {
    if (!this.paused) return;
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
    this.tick = 0;
    this.day = 0;
    this.activeEvents = [];
    this.eventLog = [];
    this._initStocks();
    this.emit('reset');
  }

  _schedule() {
    if (this.paused) return;
    const delay = Math.max(10, this.baseInterval / this.speed);
    this.intervalId = setTimeout(() => {
      this._tick();
      this._schedule();
    }, delay);
  }

  _tick() {
    const intraIndex = this.tick % this.ticksPerDay;
    const isNewDay = intraIndex === 0 && this.tick > 0;

    if (isNewDay) {
      this._closeDay();
      this.day++;
    }

    if (intraIndex === 0) this._openDay();

    // Maybe generate event
    this._maybeEvent();

    // Update each stock
    Object.values(this.stocks).forEach(s => this._updatePrice(s));

    this.tick++;
    this.emit('tick', { tick: this.tick, day: this.day, intraIndex });
  }

  _openDay() {
    Object.values(this.stocks).forEach(s => {
      // Gap open
      const gap = (Math.random() - 0.48) * s._vol * s.price * 0.5 * this.scenario.volMult;
      s.price = Math.max(0.01, s.price + gap);
      s.open = s.price;
      s.high = s.price;
      s.low = s.price;
      s.volume = 0;
      s.dayPrices = [s.price];
    });
  }

  _closeDay() {
    Object.values(this.stocks).forEach(s => {
      s.close = s.price;
      s.history.push({
        time: this.day,
        open: s.open,
        high: s.high,
        low: s.low,
        close: s.close,
        volume: s.volume
      });
      s.prevClose = s.close;
      s.change = s.close - s.open;
      s.changePct = s.open > 0 ? (s.change / s.open) * 100 : 0;
    });
    this.emit('dayClose', { day: this.day });
  }

  _updatePrice(s) {
    const sc = this.scenario;
    const trend = s._trend * sc.trendMult;
    const vol = s._vol * sc.volMult * s._eventVol;

    // Random walk + trend + mean reversion to base
    const reversion = (s.basePrice - s.price) * 0.0001;
    const noise = (Math.random() - 0.5) * 2 * vol * s.price;
    const eventDrift = s._eventEffect * s.price * 0.01;
    const trendDrift = trend * s.price;

    s.price = Math.max(0.01, s.price + noise + trendDrift + reversion + eventDrift);

    // Decrement event
    if (s._eventTicks > 0) {
      s._eventTicks--;
      if (s._eventTicks <= 0) {
        s._eventEffect = 0;
        s._eventVol = 1;
      }
    }

    s.high = Math.max(s.high, s.price);
    s.low = Math.min(s.low, s.price);
    s.dayHigh = s.high;
    s.dayLow = s.low;

    const vol_tick = Math.floor(Math.random() * 50000 + 5000);
    s.volume += vol_tick;

    s.bid = s.price * (1 - Math.random() * 0.001);
    s.ask = s.price * (1 + Math.random() * 0.001);

    s.close = s.price;
    s.change = s.price - s.open;
    s.changePct = s.open > 0 ? (s.change / s.open) * 100 : 0;

    s.dayPrices.push(s.price);
    s.tickHistory.push({ tick: this.tick, price: s.price, volume: vol_tick });
  }

  _maybeEvent() {
    const freq = this.scenario.eventFreq;
    if (Math.random() > 0.003 * freq) return;

    const tmpl = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
    const symbols = Object.keys(this.stocks);
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const s = this.stocks[symbol];

    const [minE, maxE] = tmpl.priceEffect;
    const effect = minE + Math.random() * (maxE - minE);
    const [minD, maxD] = tmpl.duration;
    const dur = Math.floor(minD + Math.random() * (maxD - minD));

    s._eventEffect = effect / dur;
    s._eventVol = tmpl.volEffect;
    s._eventTicks = dur;

    const text = tmpl.text.replace('{symbol}', symbol);
    const evt = { type: tmpl.type, symbol, text, tick: this.tick, day: this.day, effect };
    this.activeEvents.push(evt);
    this.eventLog.push(evt);
    if (this.eventLog.length > 100) this.eventLog.shift();
    this.emit('event', evt);
  }

  getCandles(symbol, count = 200) {
    const s = this.stocks[symbol];
    if (!s) return [];
    const hist = s.history.slice(-count);
    // add current partial day
    if (s.dayPrices && s.dayPrices.length > 0) {
      hist.push({ time: this.day, open: s.open, high: s.high, low: s.low, close: s.price, volume: s.volume });
    }
    return hist;
  }

  getIntradayPrices(symbol, count = 200) {
    const s = this.stocks[symbol];
    if (!s) return [];
    return s.tickHistory.slice(-count);
  }

  getQuote(symbol) {
    return this.stocks[symbol] || null;
  }

  getAllQuotes() {
    return Object.values(this.stocks);
  }

  getSymbols() {
    return Object.keys(this.stocks);
  }
}

if (typeof module !== 'undefined') module.exports = { MarketEngine, COMPANIES, SCENARIOS };
