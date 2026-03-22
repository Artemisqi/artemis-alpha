// NVDA Backtesting Script - Tests local technical analysis prediction accuracy
// Uses historical NVDA data to simulate predictions at each trading day

const validData = require('./nvda_prices.js');

function calcIndicators(closes) {
  const sma = (arr, n) => arr.length < n ? null : arr.slice(-n).reduce((a,b)=>a+b,0)/n;
  const last = closes[closes.length - 1];

  let gains = 0, losses = 0;
  const period = Math.min(14, closes.length - 1);
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - (100 / (1 + rs));

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);

  const recent20 = closes.slice(-20);
  const mean20 = recent20.reduce((a,b)=>a+b,0)/recent20.length;
  const variance = recent20.reduce((a,b)=>a+(b-mean20)**2,0)/recent20.length;
  const volatility = Math.sqrt(variance);

  return { rsi: rsi.toFixed(1), sma20: sma20?.toFixed(2), sma50: sma50?.toFixed(2), sma200: sma200?.toFixed(2), volatility: volatility.toFixed(2), lastPrice: last.toFixed(2) };
}

function generateLocalAnalysis(closes, indicators) {
  const last = closes[closes.length - 1];
  const rsi = parseFloat(indicators.rsi);
  const sma20 = parseFloat(indicators.sma20) || last;
  const sma50 = parseFloat(indicators.sma50) || last;
  const sma200 = parseFloat(indicators.sma200) || last;

  let bullSignals = 0;
  if (last > sma20) bullSignals++;
  if (last > sma50) bullSignals++;
  if (last > sma200) bullSignals++;
  if (sma20 > sma50) bullSignals++;
  if (rsi > 50 && rsi < 70) bullSignals++;
  if (rsi >= 70) bullSignals--;

  let bearSignals = 0;
  if (last < sma20) bearSignals++;
  if (last < sma50) bearSignals++;
  if (last < sma200) bearSignals++;
  if (sma20 < sma50) bearSignals++;
  if (rsi < 30) bearSignals--;

  const trend = bullSignals >= 3 ? 'bullish' : bearSignals >= 3 ? 'bearish' : 'neutral';
  const confidence = Math.min(85, Math.max(30, 50 + (bullSignals - bearSignals) * 8));

  const recent5 = closes.slice(-5);
  const momentum = (recent5[recent5.length - 1] - recent5[0]) / recent5[0];
  const dailyDrift = momentum / 5;

  const predictions = [1, 2, 3, 5, 10].map(day => {
    const drift = dailyDrift * day * (trend === 'bullish' ? 1.1 : trend === 'bearish' ? 0.9 : 1.0);
    const price = last * (1 + drift);
    return { day, price: Math.round(price * 100) / 100 };
  });

  return { trend, confidence, predictions };
}

function runBacktest() {
  console.log('='.repeat(70));
  console.log('NVDA 回测分析 — 本地技术分析引擎准确度测试');
  console.log('='.repeat(70));

  console.log(`\n总数据点: ${validData.length} 个交易日`);
  console.log(`日期范围: ${validData[0].date} → ${validData[validData.length-1].date}`);
  console.log(`价格范围: $${Math.min(...validData.map(d=>d.close)).toFixed(2)} - $${Math.max(...validData.map(d=>d.close)).toFixed(2)}`);

  // Need at least 200 days for SMA200 + buffer; we have ~300 days, start at 210
  const startIdx = Math.min(210, validData.length - 20);
  const endIdx = validData.length - 10;

  if (startIdx >= endIdx) {
    // Not enough data for SMA200, use what we have with SMA50 as max
    console.log('\n注意: 数据不足200天，SMA200将使用回退值');
  }

  const results = { 1: [], 2: [], 3: [], 5: [], 10: [] };
  const trendResults = { bullish: { correct: 0, total: 0 }, bearish: { correct: 0, total: 0 }, neutral: { correct: 0, total: 0 } };
  const directionResults = { 1: { correct: 0, total: 0 }, 2: { correct: 0, total: 0 }, 3: { correct: 0, total: 0 }, 5: { correct: 0, total: 0 }, 10: { correct: 0, total: 0 } };

  // Use minimum 50 days of history (for SMA50)
  const actualStart = Math.max(50, startIdx);

  console.log(`\n回测窗口: ${validData[actualStart].date} → ${validData[endIdx-1].date} (${endIdx - actualStart} 个测试点)\n`);

  for (let i = actualStart; i < endIdx; i++) {
    const historicalCloses = validData.slice(0, i + 1).map(d => d.close);
    const indicators = calcIndicators(historicalCloses);
    const analysis = generateLocalAnalysis(historicalCloses, indicators);

    const currentPrice = validData[i].close;

    for (const pred of analysis.predictions) {
      const futureIdx = i + pred.day;
      if (futureIdx < validData.length) {
        const actualPrice = validData[futureIdx].close;
        const predError = Math.abs(pred.price - actualPrice) / actualPrice * 100;
        const predDirection = pred.price > currentPrice ? 'up' : pred.price < currentPrice ? 'down' : 'flat';
        const actualDirection = actualPrice > currentPrice ? 'up' : actualPrice < currentPrice ? 'down' : 'flat';

        results[pred.day].push({
          date: validData[i].date,
          predicted: pred.price,
          actual: actualPrice,
          error: predError,
          directionCorrect: predDirection === actualDirection
        });

        directionResults[pred.day].total++;
        if (predDirection === actualDirection) directionResults[pred.day].correct++;
      }
    }

    // Trend accuracy over 5 days
    const future5Idx = i + 5;
    if (future5Idx < validData.length) {
      const future5Price = validData[future5Idx].close;
      const priceChange = (future5Price - currentPrice) / currentPrice;
      trendResults[analysis.trend].total++;

      if (analysis.trend === 'bullish' && priceChange > 0) trendResults[analysis.trend].correct++;
      else if (analysis.trend === 'bearish' && priceChange < 0) trendResults[analysis.trend].correct++;
      else if (analysis.trend === 'neutral' && Math.abs(priceChange) < 0.02) trendResults[analysis.trend].correct++;
    }
  }

  // === Print Results ===
  console.log('='.repeat(70));
  console.log(' 价格预测准确度 (MAPE - Mean Absolute Percentage Error)');
  console.log('='.repeat(70));

  for (const day of [1, 2, 3, 5, 10]) {
    const r = results[day];
    if (r.length === 0) { console.log(`\n--- 第 ${day} 天预测: 数据不足 ---`); continue; }
    const avgError = r.reduce((a,b) => a + b.error, 0) / r.length;
    const sorted = [...r].sort((a,b) => a.error - b.error);
    const medianError = sorted[Math.floor(sorted.length/2)].error;
    const maxError = Math.max(...r.map(x => x.error));
    const minError = Math.min(...r.map(x => x.error));
    const within1pct = r.filter(x => x.error <= 1).length / r.length * 100;
    const within2pct = r.filter(x => x.error <= 2).length / r.length * 100;
    const within5pct = r.filter(x => x.error <= 5).length / r.length * 100;

    console.log(`\n--- 第 ${day} 天预测 (${r.length} 个样本) ---`);
    console.log(`  平均误差 (MAPE):  ${avgError.toFixed(2)}%`);
    console.log(`  中位数误差:       ${medianError.toFixed(2)}%`);
    console.log(`  最小误差:         ${minError.toFixed(4)}%`);
    console.log(`  最大误差:         ${maxError.toFixed(2)}%`);
    console.log(`  误差 ≤ 1%:        ${within1pct.toFixed(1)}% 的预测`);
    console.log(`  误差 ≤ 2%:        ${within2pct.toFixed(1)}% 的预测`);
    console.log(`  误差 ≤ 5%:        ${within5pct.toFixed(1)}% 的预测`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(' 方向预测准确率 (涨/跌方向是否正确)');
  console.log('='.repeat(70));

  for (const day of [1, 2, 3, 5, 10]) {
    const d = directionResults[day];
    const accuracy = d.total > 0 ? (d.correct / d.total * 100).toFixed(1) : 'N/A';
    console.log(`  第 ${String(day).padStart(2)} 天方向准确率:  ${accuracy}%  (${d.correct}/${d.total})`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(' 趋势判断准确率 (bullish/bearish/neutral → 5天后验证)');
  console.log('='.repeat(70));

  for (const trend of ['bullish', 'bearish', 'neutral']) {
    const t = trendResults[trend];
    const accuracy = t.total > 0 ? (t.correct / t.total * 100).toFixed(1) : 'N/A';
    const label = trend === 'bullish' ? '看多' : trend === 'bearish' ? '看空' : '中性';
    console.log(`  ${label} (${trend}):  准确率 ${accuracy}%  (${t.correct}/${t.total})`);
  }

  // === Simulated Trading ===
  console.log('\n' + '='.repeat(70));
  console.log(' 模拟交易收益 (跟随趋势信号交易)');
  console.log('='.repeat(70));

  let capital = 10000;
  let position = 0;
  let trades = 0;
  let wins = 0;
  let entryPrice = 0;
  let maxDrawdown = 0;
  let peak = capital;
  const tradeLog = [];

  for (let i = actualStart; i < endIdx; i++) {
    const historicalCloses = validData.slice(0, i + 1).map(d => d.close);
    const indicators = calcIndicators(historicalCloses);
    const analysis = generateLocalAnalysis(historicalCloses, indicators);
    const currentPrice = validData[i].close;

    if (position === 0 && analysis.trend === 'bullish' && analysis.confidence >= 58) {
      position = 1;
      entryPrice = currentPrice;
    } else if (position === 1 && (analysis.trend === 'bearish' || analysis.trend === 'neutral')) {
      const returnPct = (currentPrice - entryPrice) / entryPrice;
      capital *= (1 + returnPct);
      trades++;
      if (returnPct > 0) wins++;
      tradeLog.push({ entry: entryPrice.toFixed(2), exit: currentPrice.toFixed(2), return: (returnPct*100).toFixed(2)+'%', date: validData[i].date });
      position = 0;

      if (capital > peak) peak = capital;
      const drawdown = (peak - capital) / peak * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  if (position === 1) {
    const lastPrice = validData[validData.length - 1].close;
    const returnPct = (lastPrice - entryPrice) / entryPrice;
    capital *= (1 + returnPct);
    trades++;
    if (returnPct > 0) wins++;
    tradeLog.push({ entry: entryPrice.toFixed(2), exit: lastPrice.toFixed(2), return: (returnPct*100).toFixed(2)+'%', date: validData[validData.length-1].date });
  }

  const totalReturn = ((capital - 10000) / 10000 * 100);
  const buyHoldReturn = ((validData[validData.length-1].close - validData[actualStart].close) / validData[actualStart].close * 100);

  console.log(`  初始资金:          $10,000`);
  console.log(`  最终资金:          $${capital.toFixed(2)}`);
  console.log(`  策略收益:          ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
  console.log(`  买入持有收益:      ${buyHoldReturn >= 0 ? '+' : ''}${buyHoldReturn.toFixed(2)}%`);
  console.log(`  ${totalReturn > buyHoldReturn ? '策略跑赢市场' : '策略跑输市场'}  (差异: ${(totalReturn - buyHoldReturn).toFixed(2)}%)`);
  console.log(`  总交易次数:        ${trades}`);
  console.log(`  胜率:              ${trades > 0 ? (wins/trades*100).toFixed(1) : 'N/A'}%`);
  console.log(`  最大回撤:          ${maxDrawdown.toFixed(2)}%`);

  if (tradeLog.length > 0) {
    console.log('\n  交易记录:');
    tradeLog.forEach((t, i) => {
      console.log(`    #${i+1}  入场$${t.entry} → 出场$${t.exit}  收益:${t.return}  (${t.date})`);
    });
  }

  // === Summary ===
  console.log('\n' + '='.repeat(70));
  console.log(' 总 结');
  console.log('='.repeat(70));

  const avgMAPE = [1,2,3,5,10].map(d => {
    const r = results[d];
    return r.length > 0 ? r.reduce((a,b) => a+b.error, 0) / r.length : 0;
  });
  const avgDirection = [1,2,3,5,10].map(d => {
    return directionResults[d].total > 0 ? directionResults[d].correct / directionResults[d].total * 100 : 0;
  });

  console.log(`\n  整体平均价格误差:    ${(avgMAPE.reduce((a,b)=>a+b,0)/5).toFixed(2)}%`);
  console.log(`  整体方向准确率:      ${(avgDirection.reduce((a,b)=>a+b,0)/5).toFixed(1)}%`);
  console.log(`  1天预测平均误差:     ${avgMAPE[0].toFixed(2)}%`);
  console.log(`  3天预测平均误差:     ${avgMAPE[2].toFixed(2)}%`);
  console.log(`  5天预测平均误差:     ${avgMAPE[3].toFixed(2)}%`);
  console.log(`  10天预测平均误差:    ${avgMAPE[4].toFixed(2)}%`);

  // Rating
  const overallDirection = avgDirection.reduce((a,b)=>a+b,0)/5;
  const overallMAPE = avgMAPE.reduce((a,b)=>a+b,0)/5;
  console.log('\n  评级:');
  if (overallDirection >= 60) console.log('    方向预测: 良好 (>60%)');
  else if (overallDirection >= 50) console.log('    方向预测: 一般 (50-60%, 略优于随机)');
  else console.log('    方向预测: 较差 (<50%, 不如随机)');

  if (overallMAPE <= 2) console.log('    价格精度: 优秀 (MAPE ≤ 2%)');
  else if (overallMAPE <= 5) console.log('    价格精度: 良好 (MAPE ≤ 5%)');
  else if (overallMAPE <= 10) console.log('    价格精度: 一般 (MAPE ≤ 10%)');
  else console.log('    价格精度: 较差 (MAPE > 10%)');

  console.log('\n' + '='.repeat(70));
}

runBacktest();
