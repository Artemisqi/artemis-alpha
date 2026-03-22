// Vercel Serverless Function — Yahoo Finance fundamentals proxy
// Endpoint: /api/fundamentals?ticker=AAPL

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();
  const modules = 'defaultKeyStatistics,financialData,summaryDetail,price,earningsTrend';
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  async function tryFetch(host) {
    const url = `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    const r = await fetch(url, { headers: { 'User-Agent': ua } });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }

  try {
    let data;
    try { data = await tryFetch('query1.finance.yahoo.com'); }
    catch { data = await tryFetch('query2.finance.yahoo.com'); }

    const result = data?.quoteSummary?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No data found for ' + symbol });

    const stats = result.defaultKeyStatistics || {};
    const fin = result.financialData || {};
    const detail = result.summaryDetail || {};
    const price = result.price || {};

    // Extract key fundamentals (use raw values where available)
    const extract = (obj) => obj?.raw ?? obj?.fmt ?? null;

    const fundamentals = {
      // Valuation
      marketCap: extract(price.marketCap),
      marketCapFmt: price.marketCap?.fmt || null,
      pe: extract(detail.trailingPE),
      forwardPE: extract(detail.forwardPE) || extract(stats.forwardPE),
      pegRatio: extract(stats.pegRatio),
      priceToBook: extract(stats.priceToBook),
      priceToSales: extract(detail.priceToSalesTrailing12Months) || extract(stats.priceToSalesTrailing12Months),
      enterpriseValue: extract(stats.enterpriseValue),
      evToRevenue: extract(stats.enterpriseToRevenue),
      evToEbitda: extract(stats.enterpriseToEbitda),

      // Profitability
      eps: extract(stats.trailingEps) || extract(price.epsTrailingTwelveMonths),
      revenueGrowth: extract(fin.revenueGrowth),
      earningsGrowth: extract(fin.earningsGrowth),
      profitMargin: extract(fin.profitMargins),
      operatingMargin: extract(fin.operatingMargins),
      grossMargin: extract(fin.grossMargins),
      returnOnEquity: extract(fin.returnOnEquity),
      returnOnAssets: extract(fin.returnOnAssets),

      // Financial health
      totalRevenue: extract(fin.totalRevenue),
      totalRevenueFmt: fin.totalRevenue?.fmt || null,
      debtToEquity: extract(fin.debtToEquity),
      currentRatio: extract(fin.currentRatio),
      quickRatio: extract(fin.quickRatio),
      freeCashflow: extract(fin.freeCashflow),
      freeCashflowFmt: fin.freeCashflow?.fmt || null,
      totalCash: extract(fin.totalCash),
      totalDebt: extract(fin.totalDebt),

      // Dividend
      dividendYield: extract(detail.dividendYield) || extract(detail.trailingAnnualDividendYield),
      payoutRatio: extract(detail.payoutRatio),

      // Other
      beta: extract(detail.beta) || extract(stats.beta3Year),
      fiftyTwoWeekHigh: extract(detail.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: extract(detail.fiftyTwoWeekLow),
      shortPercentOfFloat: extract(stats.shortPercentOfFloat),
      sharesOutstanding: extract(stats.sharesOutstanding),
      heldPercentInsiders: extract(stats.heldPercentInsiders),
      heldPercentInstitutions: extract(stats.heldPercentInstitutions),

      // Target price
      targetMeanPrice: extract(fin.targetMeanPrice),
      targetHighPrice: extract(fin.targetHighPrice),
      targetLowPrice: extract(fin.targetLowPrice),
      recommendationKey: fin.recommendationKey || null,
      numberOfAnalystOpinions: extract(fin.numberOfAnalystOpinions),
    };

    return res.status(200).json(fundamentals);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
