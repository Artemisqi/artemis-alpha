// Vercel Serverless Function — Yahoo Finance proxy
// Endpoint: /api/stock?ticker=AAPL&range=1y&interval=1d

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { ticker, range = '1mo', interval = '1d' } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker parameter' });
  }

  const symbol = ticker.toUpperCase().trim();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      // Try query2 as fallback
      const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
      const response2 = await fetch(url2, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response2.ok) {
        return res.status(response2.status).json({ error: `Yahoo Finance returned ${response2.status}` });
      }

      const data2 = await response2.json();
      return res.status(200).json(data2);
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
