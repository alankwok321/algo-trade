// /api/yahoo/history.js — Yahoo Finance historical data proxy
// Vercel Serverless Function

export default async function handler(req, res) {
  const { symbol = 'AAPL', range = '1y', interval = '1d' } = req.query;

  // Validate inputs
  const validSymbol = symbol.toUpperCase().replace(/[^A-Z0-9.\-^]/g, '').slice(0, 10);
  const validRanges = ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'ytd', 'max'];
  const validIntervals = ['1d', '1wk', '1mo'];
  const safeRange = validRanges.includes(range) ? range : '1y';
  const safeInterval = validIntervals.includes(interval) ? interval : '1d';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(validSymbol)}?range=${safeRange}&interval=${safeInterval}&includePrePost=false`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance returned ${response.status}` });
    }

    const data = await response.json();

    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      return res.status(404).json({ error: 'No data found for symbol' });
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0];
    const meta = result.meta;

    // Build OHLCV array
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] == null || quote.close[i] == null) continue;
      candles.push({
        time: timestamps[i],
        date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
        open: Math.round(quote.open[i] * 100) / 100,
        high: Math.round(quote.high[i] * 100) / 100,
        low: Math.round(quote.low[i] * 100) / 100,
        close: Math.round(quote.close[i] * 100) / 100,
        volume: quote.volume[i] || 0,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      symbol: meta.symbol,
      currency: meta.currency,
      exchange: meta.exchangeName,
      instrumentType: meta.instrumentType,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose || meta.chartPreviousClose,
      range: safeRange,
      interval: safeInterval,
      candles,
    });
  } catch (err) {
    console.error('Yahoo Finance API error:', err);
    return res.status(500).json({ error: 'Failed to fetch data from Yahoo Finance' });
  }
}
