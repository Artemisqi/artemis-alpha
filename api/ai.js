// Vercel Serverless Function — AI Stock Analysis via Claude API
// Endpoint: POST /api/ai
// Body: { ticker, prices, dates, apiKey, model? }

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

你必须返回严格的 JSON 格式（不要包含 markdown 代码块标记），结构如下：
{
  "summary": "一句话总结当前走势",
  "trend": "bullish | bearish | neutral",
  "confidence": 0-100 的置信度数字,
  "predictions": [
    { "day": 1, "price": 预测价格, "reason": "简短理由" },
    { "day": 2, "price": 预测价格, "reason": "简短理由" },
    { "day": 3, "price": 预测价格, "reason": "简短理由" },
    { "day": 5, "price": 预测价格, "reason": "简短理由" },
    { "day": 10, "price": 预测价格, "reason": "简短理由" }
  ],
  "support": 支撑位价格,
  "resistance": 阻力位价格,
  "technicalSignals": [
    { "name": "指标名称", "signal": "buy | sell | neutral", "detail": "简短说明" }
  ],
  "riskLevel": "low | medium | high",
  "riskFactors": ["风险因素1", "风险因素2"],
  "analysis": "2-3段详细分析文字"
}`;

  // Build recent price summary
  const recentPrices = prices.slice(-60);
  const recentDates = dates ? dates.slice(-60) : [];
  const priceData = recentPrices.map((p, i) => {
    const date = recentDates[i] || `Day ${i + 1}`;
    return `${date}: $${p.toFixed(2)}`;
  }).join('\n');

  const lastPrice = recentPrices[recentPrices.length - 1];
  const firstPrice = recentPrices[0];
  const periodChange = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
  const high = Math.max(...recentPrices);
  const low = Math.min(...recentPrices);

  let indicatorText = '';
  if (indicators) {
    indicatorText = `\n\n技术指标:\n${JSON.stringify(indicators, null, 2)}`;
  }

  const userMessage = `请分析 ${ticker} 的股票走势并给出预测。

最近价格数据（最近 ${recentPrices.length} 个交易日）:
${priceData}

当前价格: $${lastPrice.toFixed(2)}
区间涨跌: ${periodChange}%
区间最高: $${high.toFixed(2)}
区间最低: $${low.toFixed(2)}${indicatorText}

请返回 JSON 格式的分析结果。`;

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
      return res.status(response.status).json({
        error: err.error?.message || `API returned ${response.status}`,
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from response
    let analysis;
    try {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
      analysis = JSON.parse(jsonMatch[1].trim());
    } catch {
      return res.status(200).json({ raw: text, parseError: true });
    }

    return res.status(200).json({ analysis, ticker, lastPrice });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
