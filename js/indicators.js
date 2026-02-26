// indicators.js — Technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands)

const Indicators = {

  SMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
    return result;
  },

  EMA(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    let ema = null;
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      if (ema === null) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j];
        ema = sum / period;
      } else {
        ema = data[i] * k + ema * (1 - k);
      }
      result.push(ema);
    }
    return result;
  },

  RSI(closes, period = 14) {
    const result = [];
    let gains = 0, losses = 0;
    for (let i = 0; i < closes.length; i++) {
      if (i === 0) { result.push(null); continue; }
      const change = closes[i] - closes[i - 1];
      if (i <= period) {
        if (change > 0) gains += change; else losses -= change;
        if (i < period) { result.push(null); continue; }
        gains /= period;
        losses /= period;
      } else {
        const chg = change;
        gains = (gains * (period - 1) + (chg > 0 ? chg : 0)) / period;
        losses = (losses * (period - 1) + (chg < 0 ? -chg : 0)) / period;
      }
      const rs = losses === 0 ? 100 : gains / losses;
      result.push(100 - 100 / (1 + rs));
    }
    return result;
  },

  MACD(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = this.EMA(closes, fast);
    const emaSlow = this.EMA(closes, slow);
    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
      if (emaFast[i] === null || emaSlow[i] === null) { macdLine.push(null); continue; }
      macdLine.push(emaFast[i] - emaSlow[i]);
    }
    const validMacd = macdLine.filter(v => v !== null);
    const signalLine = this.EMA(validMacd, signal);
    const result = { macd: [], signal: [], histogram: [] };
    let vi = 0;
    for (let i = 0; i < closes.length; i++) {
      if (macdLine[i] === null) {
        result.macd.push(null);
        result.signal.push(null);
        result.histogram.push(null);
      } else {
        result.macd.push(macdLine[i]);
        const s = signalLine[vi] || null;
        result.signal.push(s);
        result.histogram.push(s !== null ? macdLine[i] - s : null);
        vi++;
      }
    }
    return result;
  },

  BollingerBands(closes, period = 20, mult = 2) {
    const sma = this.SMA(closes, period);
    const upper = [], lower = [], middle = [];
    for (let i = 0; i < closes.length; i++) {
      if (sma[i] === null) { upper.push(null); lower.push(null); middle.push(null); continue; }
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - sma[i]) ** 2;
      const std = Math.sqrt(variance / period);
      middle.push(sma[i]);
      upper.push(sma[i] + mult * std);
      lower.push(sma[i] - mult * std);
    }
    return { upper, middle, lower };
  },

  ATR(highs, lows, closes, period = 14) {
    const tr = [];
    for (let i = 0; i < closes.length; i++) {
      if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    return this.SMA(tr, period);
  },

  VWAP(highs, lows, closes, volumes) {
    const result = [];
    let cumVol = 0, cumTP = 0;
    for (let i = 0; i < closes.length; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      cumVol += volumes[i];
      cumTP += tp * volumes[i];
      result.push(cumVol > 0 ? cumTP / cumVol : tp);
    }
    return result;
  },

  StochRSI(closes, rsiPeriod = 14, stochPeriod = 14) {
    const rsi = this.RSI(closes, rsiPeriod);
    const result = [];
    for (let i = 0; i < rsi.length; i++) {
      if (rsi[i] === null || i < stochPeriod - 1) { result.push(null); continue; }
      let min = Infinity, max = -Infinity;
      for (let j = i - stochPeriod + 1; j <= i; j++) {
        if (rsi[j] === null) { min = null; break; }
        min = Math.min(min, rsi[j]);
        max = Math.max(max, rsi[j]);
      }
      if (min === null || max === min) { result.push(50); continue; }
      result.push(((rsi[i] - min) / (max - min)) * 100);
    }
    return result;
  }
};

if (typeof module !== 'undefined') module.exports = Indicators;
