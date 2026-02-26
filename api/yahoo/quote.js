// /api/yahoo/quote.js — Yahoo Finance quote proxy
// Vercel Serverless Function

export default async function handler(req, res) {
  const { symbol = 'AAPL' } = req.query;

  const validSymbol = symbol.toUpperCase().replace(/[^A-Z0-9.\-^]/g, '').slice(0, 10);

  try {
    // Use the chart endpoint with a short range for current quote
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(validSymbol)}?range=5d&interval=1d&includePrePost=false`;

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
      return res.status(404).json({ error: 'Symbol not found' });
    }

    const meta = data.chart.result[0].meta;
    const timestamps = data.chart.result[0].timestamp || [];
    const quote = data.chart.result[0].indicators.quote[0];

    // Get the latest valid data point
    let latestIdx = timestamps.length - 1;
    while (latestIdx >= 0 && quote.close[latestIdx] == null) latestIdx--;

    const price = latestIdx >= 0 ? quote.close[latestIdx] : meta.regularMarketPrice;
    const prevClose = meta.previousClose || meta.chartPreviousClose || price;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      symbol: meta.symbol,
      currency: meta.currency,
      exchange: meta.exchangeName,
      instrumentType: meta.instrumentType,
      price: Math.round(price * 100) / 100,
      previousClose: Math.round(prevClose * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      regularMarketPrice: meta.regularMarketPrice,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    });
  } catch (err) {
    console.error('Yahoo Finance quote error:', err);
    return res.status(500).json({ error: 'Failed to fetch quote' });
  }
}
