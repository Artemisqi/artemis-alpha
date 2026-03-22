// NVDA Backtesting Script v2 - Tests improved technical analysis engine
const validData = require('./nvda_prices.js');

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcIndicators(closes) {
  const sma = (arr, n) => arr.length < n ? null : arr.slice(-n).reduce((a,b)=>a+b,0)/n;
  const last = closes[closes.length - 1];

  let avgGain = 0, avgLoss = 0;
  const rsiPeriod = Math.min(14, closes.length - 1);
  for (let i = closes.length - rsiPeriod; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= rsiPeriod; avgLoss /= rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  const sma20 = sma(closes, 20), sma50 = sma(closes, 50), sma200 = sma(closes, 200);
  const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26), ema20 = calcEMA(closes, 20);

  let macdLine = null, signalLine = null, macdHist = null;
  if (ema12 !== null && ema26 !== null && closes.length >= 35) {
    const k12 = 2/13, k26 = 2/27, k9 = 2/10;
    let e12 = closes.slice(0,12).reduce((a,b)=>a+b,0)/12;
    let e26 = closes.slice(0,26).reduce((a,b)=>a+b,0)/26;
    const macdSeries = [];
    for (let i = 12; i < closes.length; i++) {
      e12 = closes[i]*k12 + e12*(1-k12);
      if (i >= 26) { e26 = closes[i]*k26 + e26*(1-k26); macdSeries.push(e12 - e26); }
      else { e26 = closes.slice(0,i+1).reduce((a,b)=>a+b,0)/(i+1); }
    }
    macdLine = macdSeries[macdSeries.length - 1];
    if (macdSeries.length >= 9) {
      let sig = macdSeries.slice(0,9).reduce((a,b)=>a+b,0)/9;
      for (let i = 9; i < macdSeries.length; i++) sig = macdSeries[i]*k9 + sig*(1-k9);
      signalLine = sig; macdHist = macdLine - signalLine;
    }
  }

  const recent20 = closes.slice(-20);
  const mean20 = recent20.reduce((a,b)=>a+b,0)/recent20.length;
  const variance = recent20.reduce((a,b)=>a+(b-mean20)**2,0)/recent20.length;
  const volatility = Math.sqrt(variance);
  const bbUpper = mean20 + 2 * volatility, bbLower = mean20 - 2 * volatility;
  const bbWidth = (bbUpper - bbLower) / mean20;
  const bbPosition = volatility > 0 ? (last - bbLower) / (bbUpper - bbLower) : 0.5;

  let atr = 0;
  const atrPeriod = Math.min(14, closes.length - 1);
  for (let i = closes.length - atrPeriod; i < closes.length; i++) atr += Math.abs(closes[i] - closes[i-1]);
  atr /= atrPeriod;

  const roc5 = closes.length > 5 ? (last - closes[closes.length-6]) / closes[closes.length-6] * 100 : 0;
  const roc10 = closes.length > 10 ? (last - closes[closes.length-11]) / closes[closes.length-11] * 100 : 0;
  const roc20 = closes.length > 20 ? (last - closes[closes.length-21]) / closes[closes.length-21] * 100 : 0;

  return {
    rsi: rsi.toFixed(1), sma20: sma20?.toFixed(2), sma50: sma50?.toFixed(2), sma200: sma200?.toFixed(2),
    ema12: ema12?.toFixed(2), ema26: ema26?.toFixed(2), ema20: ema20?.toFixed(2),
    macdLine: macdLine?.toFixed(3), signalLine: signalLine?.toFixed(3), macdHist: macdHist?.toFixed(3),
    bbUpper: bbUpper.toFixed(2), bbLower: bbLower.toFixed(2), bbWidth: bbWidth.toFixed(4), bbPosition: bbPosition.toFixed(3),
    volatility: volatility.toFixed(2), atr: atr.toFixed(2),
    roc5: roc5.toFixed(2), roc10: roc10.toFixed(2), roc20: roc20.toFixed(2),
    lastPrice: last.toFixed(2)
  };
}

function generateLocalAnalysis(closes, indicators) {
  const last = closes[closes.length - 1];
  const rsi = parseFloat(indicators.rsi);
  const sma20 = parseFloat(indicators.sma20) || last;
  const sma50 = parseFloat(indicators.sma50) || last;
  const sma200 = parseFloat(indicators.sma200) || last;
  const ema20 = parseFloat(indicators.ema20) || sma20;
  const vol = parseFloat(indicators.volatility) || 1;
  const atr = parseFloat(indicators.atr) || vol;
  const macdHist = parseFloat(indicators.macdHist) || 0;
  const macdLine = parseFloat(indicators.macdLine) || 0;
  const signalLine = parseFloat(indicators.signalLine) || 0;
  const bbPosition = parseFloat(indicators.bbPosition) || 0.5;
  const roc5 = parseFloat(indicators.roc5) || 0;
  const roc10 = parseFloat(indicators.roc10) || 0;
  const roc20 = parseFloat(indicators.roc20) || 0;
  const volFactor = vol / last;

  let score = 0;
  if (last > sma20) score += 5; else score -= 5;
  if (last > sma50) score += 7; else score -= 7;
  if (last > sma200) score += 8; else score -= 8;
  if (sma20 > sma50) score += 5; else score -= 5;
  if (macdHist > 0) score += 8; else score -= 8;
  if (macdLine > signalLine) score += 6; else score -= 6;
  if (macdHist > 0 && roc5 > 0) score += 6;
  else if (macdHist < 0 && roc5 < 0) score -= 6;
  if (rsi >= 70) score -= 10;
  else if (rsi <= 30) score += 10;
  else if (rsi > 55) score += 4;
  else if (rsi < 45) score -= 4;
  if (bbPosition > 0.95) score -= 8;
  else if (bbPosition < 0.05) score += 8;
  else if (bbPosition > 0.8) score -= 3;
  else if (bbPosition < 0.2) score += 3;
  if (roc5 > 0 && roc10 > 0 && roc20 > 0) score += 10;
  else if (roc5 < 0 && roc10 < 0 && roc20 < 0) score -= 10;
  else if (roc5 > 0 && roc10 > 0) score += 5;
  else if (roc5 < 0 && roc10 < 0) score -= 5;
  if (roc5 > 2 && roc20 < -5) score -= 3;
  if (roc5 < -2 && roc20 > 5) score += 3;
  if (Math.abs(roc5) > Math.abs(roc10/2)) score += roc5 > 0 ? 4 : -4;
  const distSma200 = (last - sma200) / sma200;
  if (distSma200 > 0.15) score += 3; else if (distSma200 < -0.15) score -= 3;
  if (volFactor > 0.04) score *= 0.7;

  const trend = score >= 12 ? 'bullish' : score <= -12 ? 'bearish' : 'neutral';
  const confidence = Math.min(85, Math.max(25, 50 + Math.abs(score) * 0.5));

  const meanRevTarget = ema20;
  const recent5 = closes.slice(-5);
  const recent10 = closes.slice(-10);
  const mom5 = (recent5[recent5.length - 1] - recent5[0]) / recent5[0];
  const mom10 = recent10.length >= 10 ? (recent10[recent10.length - 1] - recent10[0]) / recent10[0] : mom5;
  const dailyMomentum = mom5 / 5;
  const absScore = Math.abs(score);
  const trendStrength = Math.min(1, absScore / 50);
  const trendDir = score > 0 ? 1 : score < 0 ? -1 : 0;
  const wMeanRev = 0.5 * (1 - trendStrength);
  const wMomentum = 0.3 + 0.2 * trendStrength;
  const wTrend = 0.2 + 0.3 * trendStrength;

  const predictions = [1, 2, 3, 5, 10].map(day => {
    const reversionGap = (meanRevTarget - last) / last;
    const reversionDrift = reversionGap * 0.3 * Math.min(day, 5) / 5;
    const decay = Math.pow(0.9, day);
    const blendedMom = (dailyMomentum * 0.6 + (mom10 / 10) * 0.4);
    const momentumDrift = blendedMom * day * decay;
    const trendDrift = trendDir * trendStrength * 0.003 * day;
    let rsiOverride = 0;
    if (rsi > 75) rsiOverride = -0.003 * day * Math.min(day, 5) / 5;
    else if (rsi < 25) rsiOverride = 0.003 * day * Math.min(day, 5) / 5;
    const rawDrift = reversionDrift * wMeanRev + momentumDrift * wMomentum + trendDrift * wTrend + rsiOverride;
    const volDamping = 1 / (1 + volFactor * day * 0.3);
    const totalDrift = rawDrift * volDamping;
    const maxMove = (atr * 2.5 * Math.sqrt(day)) / last;
    const clampedDrift = Math.max(-maxMove, Math.min(maxMove, totalDrift));
    const price = last * (1 + clampedDrift);
    return { day, price: Math.round(price * 100) / 100 };
  });

  return { trend, confidence, predictions, score };
}

function runBacktest() {
  console.log('='.repeat(70));
  console.log('NVDA 回测分析 — 增强版技术分析引擎 v2 准确度测试');
  console.log('='.repeat(70));

  console.log(`\n总数据点: ${validData.length} 个交易日`);
  console.log(`日期范围: ${validData[0].date} → ${validData[validData.length-1].date}`);
  console.log(`价格范围: $${Math.min(...validData.map(d=>d.close)).toFixed(2)} - $${Math.max(...validData.map(d=>d.close)).toFixed(2)}`);

  const actualStart = 50;
  const endIdx = validData.length - 10;

  const results = { 1: [], 2: [], 3: [], 5: [], 10: [] };
  const trendResults = { bullish: { correct: 0, total: 0 }, bearish: { correct: 0, total: 0 }, neutral: { correct: 0, total: 0 } };
  const directionResults = { 1: { correct: 0, total: 0 }, 2: { correct: 0, total: 0 }, 3: { correct: 0, total: 0 }, 5: { correct: 0, total: 0 }, 10: { correct: 0, total: 0 } };

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
        results[pred.day].push({ date: validData[i].date, predicted: pred.price, actual: actualPrice, error: predError, directionCorrect: predDirection === actualDirection });
        directionResults[pred.day].total++;
        if (predDirection === actualDirection) directionResults[pred.day].correct++;
      }
    }

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

  // Print results
  console.log('='.repeat(70));
  console.log(' 价格预测准确度 (MAPE)');
  console.log('='.repeat(70));

  for (const day of [1, 2, 3, 5, 10]) {
    const r = results[day];
    if (r.length === 0) continue;
    const avgError = r.reduce((a,b) => a + b.error, 0) / r.length;
    const sorted = [...r].sort((a,b) => a.error - b.error);
    const medianError = sorted[Math.floor(sorted.length/2)].error;
    const maxError = Math.max(...r.map(x => x.error));
    const within1pct = r.filter(x => x.error <= 1).length / r.length * 100;
    const within2pct = r.filter(x => x.error <= 2).length / r.length * 100;
    const within5pct = r.filter(x => x.error <= 5).length / r.length * 100;

    console.log(`\n--- 第 ${day} 天预测 (${r.length} 个样本) ---`);
    console.log(`  平均误差 (MAPE):  ${avgError.toFixed(2)}%`);
    console.log(`  中位数误差:       ${medianError.toFixed(2)}%`);
    console.log(`  最大误差:         ${maxError.toFixed(2)}%`);
    console.log(`  误差 ≤ 1%:        ${within1pct.toFixed(1)}%`);
    console.log(`  误差 ≤ 2%:        ${within2pct.toFixed(1)}%`);
    console.log(`  误差 ≤ 5%:        ${within5pct.toFixed(1)}%`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(' 方向预测准确率');
  console.log('='.repeat(70));
  for (const day of [1, 2, 3, 5, 10]) {
    const d = directionResults[day];
    const accuracy = d.total > 0 ? (d.correct / d.total * 100).toFixed(1) : 'N/A';
    console.log(`  第 ${String(day).padStart(2)} 天:  ${accuracy}%  (${d.correct}/${d.total})`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(' 趋势判断准确率 (5天验证)');
  console.log('='.repeat(70));
  for (const trend of ['bullish', 'bearish', 'neutral']) {
    const t = trendResults[trend];
    const accuracy = t.total > 0 ? (t.correct / t.total * 100).toFixed(1) : 'N/A';
    const label = trend === 'bullish' ? '看多' : trend === 'bearish' ? '看空' : '中性';
    console.log(`  ${label}: ${accuracy}%  (${t.correct}/${t.total})`);
  }

  // Trading simulation
  console.log('\n' + '='.repeat(70));
  console.log(' 模拟交易');
  console.log('='.repeat(70));

  let capital = 10000, position = 0, trades = 0, wins = 0, entryPrice = 0;
  let maxDrawdown = 0, peak = capital;
  const tradeLog = [];

  for (let i = actualStart; i < endIdx; i++) {
    const historicalCloses = validData.slice(0, i + 1).map(d => d.close);
    const indicators = calcIndicators(historicalCloses);
    const analysis = generateLocalAnalysis(historicalCloses, indicators);
    const currentPrice = validData[i].close;

    if (position === 0 && analysis.trend === 'bullish' && analysis.confidence >= 58) {
      position = 1; entryPrice = currentPrice;
    } else if (position === 1 && (analysis.trend === 'bearish' || (analysis.trend === 'neutral' && analysis.score < -5))) {
      const returnPct = (currentPrice - entryPrice) / entryPrice;
      capital *= (1 + returnPct);
      trades++; if (returnPct > 0) wins++;
      tradeLog.push({ entry: entryPrice.toFixed(2), exit: currentPrice.toFixed(2), ret: (returnPct*100).toFixed(2)+'%', date: validData[i].date });
      position = 0;
      if (capital > peak) peak = capital;
      const dd = (peak - capital) / peak * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }
  if (position === 1) {
    const lastPrice = validData[validData.length - 1].close;
    const returnPct = (lastPrice - entryPrice) / entryPrice;
    capital *= (1 + returnPct);
    trades++; if (returnPct > 0) wins++;
    tradeLog.push({ entry: entryPrice.toFixed(2), exit: lastPrice.toFixed(2), ret: (returnPct*100).toFixed(2)+'%', date: 'end' });
  }

  const totalReturn = ((capital - 10000) / 10000 * 100);
  const buyHoldReturn = ((validData[validData.length-1].close - validData[actualStart].close) / validData[actualStart].close * 100);

  console.log(`  初始资金:     $10,000`);
  console.log(`  最终资金:     $${capital.toFixed(2)}`);
  console.log(`  策略收益:     ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
  console.log(`  买入持有:     ${buyHoldReturn >= 0 ? '+' : ''}${buyHoldReturn.toFixed(2)}%`);
  console.log(`  ${totalReturn > buyHoldReturn ? '策略跑赢' : '策略跑输'}  (差异: ${(totalReturn - buyHoldReturn).toFixed(2)}%)`);
  console.log(`  交易次数:     ${trades}   胜率: ${trades > 0 ? (wins/trades*100).toFixed(1) : 'N/A'}%`);
  console.log(`  最大回撤:     ${maxDrawdown.toFixed(2)}%`);

  if (tradeLog.length > 0) {
    console.log('\n  交易记录:');
    tradeLog.forEach((t, i) => console.log(`    #${i+1}  $${t.entry} → $${t.exit}  ${t.ret}  (${t.date})`));
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log(' 总 结');
  console.log('='.repeat(70));
  const avgMAPE = [1,2,3,5,10].map(d => results[d].length > 0 ? results[d].reduce((a,b) => a+b.error, 0) / results[d].length : 0);
  const avgDir = [1,2,3,5,10].map(d => directionResults[d].total > 0 ? directionResults[d].correct / directionResults[d].total * 100 : 0);

  console.log(`\n  整体平均误差:    ${(avgMAPE.reduce((a,b)=>a+b,0)/5).toFixed(2)}%`);
  console.log(`  整体方向准确率:  ${(avgDir.reduce((a,b)=>a+b,0)/5).toFixed(1)}%`);
  for (const [i,d] of [1,2,3,5,10].entries()) {
    console.log(`  ${d}天: MAPE ${avgMAPE[i].toFixed(2)}%  方向 ${avgDir[i].toFixed(1)}%`);
  }

  const overallDir = avgDir.reduce((a,b)=>a+b,0)/5;
  const overallMAPE = avgMAPE.reduce((a,b)=>a+b,0)/5;
  console.log('\n  评级:');
  if (overallDir >= 60) console.log('    方向: 良好 (>60%)');
  else if (overallDir >= 50) console.log('    方向: 一般 (50-60%)');
  else console.log('    方向: 较差 (<50%)');
  if (overallMAPE <= 2) console.log('    精度: 优秀 (MAPE ≤ 2%)');
  else if (overallMAPE <= 5) console.log('    精度: 良好 (MAPE ≤ 5%)');
  else if (overallMAPE <= 10) console.log('    精度: 一般 (MAPE ≤ 10%)');
  else console.log('    精度: 较差 (MAPE > 10%)');
  console.log('\n' + '='.repeat(70));
}

runBacktest();
