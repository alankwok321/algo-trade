// /api/yahoo/search.js — Yahoo Finance symbol search proxy
// Vercel Serverless Function

export default async function handler(req, res) {
  const { q = '' } = req.query;

  if (!q || q.length < 1) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  const query = q.slice(0, 30);

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance returned ${response.status}` });
    }

    const data = await response.json();
    const results = (data.quotes || [])
      .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type: q.quoteType,
      }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({ results });
  } catch (err) {
    console.error('Yahoo Finance search error:', err);
    return res.status(500).json({ error: 'Failed to search symbols' });
  }
}
