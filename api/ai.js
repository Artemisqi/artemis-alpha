// Vercel Serverless Function — AI Stock Analysis via Claude API
// Endpoint: POST /api/ai
// Body: { ticker, prices, dates, indicators, apiKey, model? }

export const config = {
  maxDuration: 60, // allow up to 60s for Claude API response
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ticker, prices, dates, indicators, apiKey, model } = req.body || {};

  if (!ticker || !prices || !apiKey) {
    return res.status(400).json({ error: 'Missing required fields: ticker, prices, apiKey' });
  }

  const systemPrompt = `你是一位专业的量化金融分析师，精通技术分析和基本面分析。请基于提供的历史价格数据和技术指标，对股票进行深度分析。

你必须只返回一个合法的 JSON 对象，不要包含任何 markdown 代码块标记、注释或额外文字。

JSON 结构示例：
{"summary":"近期震荡上行，短线多头占优","trend":"bullish","confidence":72,"predictions":[{"day":1,"price":185.50,"reason":"短线支撑有效"},{"day":2,"price":186.20,"reason":"动能延续"},{"day":3,"price":185.80,"reason":"小幅回调"},{"day":5,"price":187.00,"reason":"趋势延续"},{"day":10,"price":189.50,"reason":"中期看涨"}],"support":180.00,"resistance":192.00,"technicalSignals":[{"name":"RSI","signal":"neutral","detail":"RSI 55，中性区间"},{"name":"MACD","signal":"buy","detail":"金叉形成"},{"name":"MA20","signal":"buy","detail":"股价站上20日均线"}],"riskLevel":"medium","riskFactors":["市场整体波动性增加","短期涨幅过大存在回调风险"],"analysis":"详细分析文字，包含技术面和趋势判断。"}

字段说明：
- trend: 只能是 "bullish"、"bearish" 或 "neutral"
- confidence: 0-100 的整数
- predictions: 必须包含 day 1,2,3,5,10 的预测价格
- signal: 只能是 "buy"、"sell" 或 "neutral"
- riskLevel: 只能是 "low"、"medium" 或 "high"
- support/resistance: 数字类型的价格
- analysis: 2-3段详细分析`;

  // Build recent price summary (send last 60 data points to save tokens)
  const recentPrices = prices.slice(-60).map(p => Number(p));
  const recentDates = dates ? dates.slice(-60) : [];
  const priceLines = recentPrices.map((p, i) => {
    const date = recentDates[i] || `Day${i + 1}`;
    return `${date}: ${p.toFixed(2)}`;
  }).join(', ');

  const lastPrice = recentPrices[recentPrices.length - 1];
  const firstPrice = recentPrices[0];
  const periodChange = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
  const high = Math.max(...recentPrices);
  const low = Math.min(...recentPrices);

  let indicatorText = '';
  if (indicators) {
    indicatorText = `\n技术指标: RSI=${indicators.rsi}, SMA20=${indicators.sma20}, SMA50=${indicators.sma50}, SMA200=${indicators.sma200}, 波动率=${indicators.volatility}`;
  }

  const userMessage = `分析 ${ticker}。

价格数据（最近${recentPrices.length}个交易日）:
${priceLines}

当前价格: $${lastPrice.toFixed(2)} | 区间涨跌: ${periodChange}% | 最高: $${high.toFixed(2)} | 最低: $${low.toFixed(2)}${indicatorText}

请返回 JSON。`;

  try {
    const apiModel = model || 'claude-sonnet-4-20250514';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: apiModel,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.error?.message || err.message || `API returned ${response.status}`;
      return res.status(response.status).json({ error: msg });
    }

    const data = await response.json();
    const text = (data.content?.[0]?.text || '').trim();

    if (!text) {
      return res.status(500).json({ error: 'AI returned empty response' });
    }

    // Parse JSON — try multiple extraction strategies
    let analysis;
    try {
      // Strategy 1: direct parse
      analysis = JSON.parse(text);
    } catch {
      try {
        // Strategy 2: extract from markdown code block
        const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
          analysis = JSON.parse(codeBlock[1].trim());
        } else {
          // Strategy 3: find first { ... } block
          const braceMatch = text.match(/\{[\s\S]*\}/);
          if (braceMatch) {
            analysis = JSON.parse(braceMatch[0]);
          } else {
            throw new Error('No JSON found');
          }
        }
      } catch {
        return res.status(200).json({ raw: text, parseError: true, error: 'Failed to parse AI response as JSON' });
      }
    }

    // Validate essential fields with defaults
    analysis.trend = ['bullish', 'bearish', 'neutral'].includes(analysis.trend) ? analysis.trend : 'neutral';
    analysis.confidence = Number(analysis.confidence) || 50;
    analysis.support = Number(analysis.support) || 0;
    analysis.resistance = Number(analysis.resistance) || 0;
    analysis.riskLevel = ['low', 'medium', 'high'].includes(analysis.riskLevel) ? analysis.riskLevel : 'medium';
    analysis.predictions = Array.isArray(analysis.predictions) ? analysis.predictions.map(p => ({
      day: Number(p.day) || 1,
      price: Number(p.price) || lastPrice,
      reason: String(p.reason || ''),
    })) : [];
    analysis.technicalSignals = Array.isArray(analysis.technicalSignals) ? analysis.technicalSignals : [];
    analysis.riskFactors = Array.isArray(analysis.riskFactors) ? analysis.riskFactors : [];
    analysis.summary = String(analysis.summary || '');
    analysis.analysis = String(analysis.analysis || '');

    return res.status(200).json({ analysis, ticker, lastPrice });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
