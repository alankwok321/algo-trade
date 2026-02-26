// chart.js — Chart rendering with TradingView lightweight-charts

class ChartManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.chart = null;
    this.candleSeries = null;
    this.volumeSeries = null;
    this.indicatorSeries = {};
    this.currentSymbol = null;
    this.activeIndicators = new Set(['sma20', 'ema9']);
    this._resizeObserver = null;
  }

  init() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    this.chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: '#0a0e17' },
        textColor: '#8a8f9c',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1e2e' },
        horzLines: { color: '#1a1e2e' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#3a3f4e', width: 1, style: 2 },
        horzLine: { color: '#3a3f4e', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#1a1e2e',
        scaleMargins: { top: 0.05, bottom: 0.25 }
      },
      timeScale: {
        borderColor: '#1a1e2e',
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: false },
    });

    // Candle series
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#00c176',
      downColor: '#ff3b69',
      borderUpColor: '#00c176',
      borderDownColor: '#ff3b69',
      wickUpColor: '#00c176',
      wickDownColor: '#ff3b69',
    });

    // Volume series
    this.volumeSeries = this.chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    this.chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Resize
    this._resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      this.chart.applyOptions({ width: rect.width, height: rect.height });
    });
    this._resizeObserver.observe(container);
    const rect = container.getBoundingClientRect();
    this.chart.applyOptions({ width: rect.width, height: rect.height });
  }

  setSymbol(symbol) {
    this.currentSymbol = symbol;
    // Clear indicators
    Object.values(this.indicatorSeries).forEach(s => {
      try { this.chart.removeSeries(s); } catch(e) {}
    });
    this.indicatorSeries = {};
  }

  updateData(candles, indicators) {
    if (!this.candleSeries || !candles || candles.length === 0) return;

    const candleData = candles.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));

    const volumeData = candles.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0,193,118,0.3)' : 'rgba(255,59,105,0.3)'
    }));

    this.candleSeries.setData(candleData);
    this.volumeSeries.setData(volumeData);

    // Update indicator overlays
    if (indicators) {
      this._updateIndicators(candles, indicators);
    }

    this.chart.timeScale().scrollToRealTime();
  }

  _updateIndicators(candles, ind) {
    const closes = candles.map(c => c.close);
    const times = candles.map(c => c.time);

    // SMA 20
    if (this.activeIndicators.has('sma20')) {
      const sma = Indicators.SMA(closes, 20);
      this._setLineSeries('sma20', times, sma, '#f5a623', 1);
    }

    // EMA 9
    if (this.activeIndicators.has('ema9')) {
      const ema = Indicators.EMA(closes, 9);
      this._setLineSeries('ema9', times, ema, '#00d4ff', 1);
    }

    // SMA 50
    if (this.activeIndicators.has('sma50')) {
      const sma = Indicators.SMA(closes, 50);
      this._setLineSeries('sma50', times, sma, '#e040fb', 1);
    }

    // Bollinger Bands
    if (this.activeIndicators.has('bb')) {
      const bb = Indicators.BollingerBands(closes, 20);
      this._setLineSeries('bb_upper', times, bb.upper, 'rgba(100,181,246,0.5)', 1);
      this._setLineSeries('bb_lower', times, bb.lower, 'rgba(100,181,246,0.5)', 1);
    }
  }

  _setLineSeries(key, times, values, color, width) {
    if (!this.indicatorSeries[key]) {
      this.indicatorSeries[key] = this.chart.addLineSeries({
        color, lineWidth: width, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }
    const data = [];
    for (let i = 0; i < times.length; i++) {
      if (values[i] !== null && values[i] !== undefined) {
        data.push({ time: times[i], value: values[i] });
      }
    }
    this.indicatorSeries[key].setData(data);
  }

  toggleIndicator(name) {
    if (this.activeIndicators.has(name)) {
      this.activeIndicators.delete(name);
      // remove series
      const keys = name === 'bb' ? ['bb_upper', 'bb_lower'] : [name];
      keys.forEach(k => {
        if (this.indicatorSeries[k]) {
          try { this.chart.removeSeries(this.indicatorSeries[k]); } catch(e) {}
          delete this.indicatorSeries[k];
        }
      });
    } else {
      this.activeIndicators.add(name);
    }
  }

  addTradeMarker(time, side, price) {
    // This can be used to overlay trade markers
    // lightweight-charts supports markers on candlestick series
    // We'll batch these
  }

  setMarkers(markers) {
    if (this.candleSeries && markers.length > 0) {
      try {
        this.candleSeries.setMarkers(markers.sort((a, b) => a.time - b.time));
      } catch(e) {}
    }
  }

  destroy() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.chart) this.chart.remove();
  }
}

if (typeof module !== 'undefined') module.exports = ChartManager;
