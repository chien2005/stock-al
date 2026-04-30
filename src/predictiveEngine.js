/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN STOCK BOT - Predictive Engine v1.0                   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Tính toán Technical Indicators + Prediction Scores          ║
 * ║  Từ historical data (VPS 30 ngày) → dự đoán ngắn/trung hạn  ║
 * ║                                                               ║
 * ║  📊 RSI(14), MACD(12,26,9), Bollinger Bands(20,2)           ║
 * ║  📈 SMA5, SMA10, SMA20, SMA50                               ║
 * ║  💹 ROC, Volume Trend, Support/Resistance                   ║
 * ║  🎯 Short-term Score (1-5 ngày)                              ║
 * ║  🎯 Mid-term Score (1-3 tháng)                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── TECHNICAL INDICATORS ─────────────────────────────────

/**
 * Tính RSI (Relative Strength Index)
 * @param {number[]} closes - Mảng giá đóng cửa (cũ → mới)
 * @param {number} period - Chu kỳ (default 14)
 * @returns {number} RSI value (0-100)
 */
function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  const recent = closes.slice(-(period + 1));
  let gains = 0, losses = 0;

  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

/**
 * Tính EMA (Exponential Moving Average)
 */
function calcEMA(data, period) {
  if (!data || data.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [data.slice(0, period).reduce((s, v) => s + v, 0) / period];

  for (let i = period; i < data.length; i++) {
    ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

/**
 * Tính MACD (Moving Average Convergence Divergence)
 * @returns {{ macd: number, signal: number, histogram: number, trend: string }}
 */
function calcMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (!closes || closes.length < slow + signalPeriod) return null;

  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  // Align arrays (emaSlow starts later)
  const offset = fast - 1; // emaFast has more elements
  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + (slow - fast)] - emaSlow[i]);
  }

  if (macdLine.length < signalPeriod) return null;

  const signalLine = calcEMA(macdLine, signalPeriod);
  const lastMACD = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const histogram = lastMACD - lastSignal;

  // Check crossover (last 3 values)
  let trend = 'NEUTRAL';
  if (macdLine.length >= 3 && signalLine.length >= 2) {
    const prevMACD = macdLine[macdLine.length - 2];
    const prevSignal = signalLine[signalLine.length - 2];
    if (prevMACD <= prevSignal && lastMACD > lastSignal) trend = 'BULLISH_CROSS';
    else if (prevMACD >= prevSignal && lastMACD < lastSignal) trend = 'BEARISH_CROSS';
    else if (lastMACD > lastSignal) trend = 'BULLISH';
    else trend = 'BEARISH';
  }

  return {
    macd: parseFloat(lastMACD.toFixed(4)),
    signal: parseFloat(lastSignal.toFixed(4)),
    histogram: parseFloat(histogram.toFixed(4)),
    trend,
  };
}

/**
 * Tính Bollinger Bands
 * @returns {{ upper, middle, lower, width, percentB }}
 */
function calcBollingerBands(closes, period = 20, multiplier = 2) {
  if (!closes || closes.length < period) return null;

  const recent = closes.slice(-period);
  const sma = recent.reduce((s, v) => s + v, 0) / period;
  const variance = recent.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + multiplier * stdDev;
  const lower = sma - multiplier * stdDev;
  const currentPrice = closes[closes.length - 1];
  const percentB = stdDev > 0 ? ((currentPrice - lower) / (upper - lower)) : 0.5;
  const width = sma > 0 ? ((upper - lower) / sma * 100) : 0;

  return {
    upper: parseFloat(upper.toFixed(2)),
    middle: parseFloat(sma.toFixed(2)),
    lower: parseFloat(lower.toFixed(2)),
    width: parseFloat(width.toFixed(2)),
    percentB: parseFloat(percentB.toFixed(4)),
  };
}

/**
 * Tính SMA (Simple Moving Average)
 */
function calcSMA(data, period) {
  if (!data || data.length < period) return null;
  const slice = data.slice(-period);
  return parseFloat((slice.reduce((s, v) => s + v, 0) / period).toFixed(2));
}

/**
 * Tính ROC (Rate of Change) - %
 */
function calcROC(closes, period = 5) {
  if (!closes || closes.length < period + 1) return null;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  if (past === 0) return 0;
  return parseFloat(((current - past) / past * 100).toFixed(2));
}

/**
 * Tính Support / Resistance từ lịch sử
 */
function calcSupportResistance(highs, lows, closes) {
  if (!highs || !lows || highs.length < 5) return null;

  const recent20H = highs.slice(-20);
  const recent20L = lows.slice(-20);
  const recent5H = highs.slice(-5);
  const recent5L = lows.slice(-5);

  return {
    resistance20: parseFloat(Math.max(...recent20H).toFixed(2)),
    support20: parseFloat(Math.min(...recent20L).toFixed(2)),
    resistance5: parseFloat(Math.max(...recent5H).toFixed(2)),
    support5: parseFloat(Math.min(...recent5L).toFixed(2)),
  };
}

/**
 * Tính Volume Trend (KL 5 phiên gần nhất vs TB 20 phiên)
 */
function calcVolumeTrend(volumes) {
  if (!volumes || volumes.length < 20) return null;

  const avg20 = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const avg5 = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
  const ratio = avg20 > 0 ? parseFloat((avg5 / avg20).toFixed(2)) : 1;

  let trend = 'NORMAL';
  if (ratio > 2) trend = 'SPIKE';
  else if (ratio > 1.5) trend = 'HIGH';
  else if (ratio > 1.1) trend = 'ABOVE_AVG';
  else if (ratio < 0.5) trend = 'VERY_LOW';
  else if (ratio < 0.8) trend = 'LOW';

  return { ratio, trend, avg5: Math.round(avg5), avg20: Math.round(avg20) };
}

// ─── ALL INDICATORS ─────────────────────────────────────

/**
 * Tính tất cả technical indicators từ historical data
 * @param {Object} history - VPS history data { c: [], o: [], h: [], l: [], v: [], t: [] }
 * @param {number} currentPrice - Giá hiện tại
 * @returns {Object} Tất cả indicators
 */
function calculateAllIndicators(history, currentPrice) {
  if (!history || !history.c || history.c.length < 14) {
    return { error: 'Không đủ dữ liệu lịch sử' };
  }

  const closes = history.c;
  const highs = history.h || closes;
  const lows = history.l || closes;
  const volumes = history.v || [];

  return {
    // Moving Averages
    sma5: calcSMA(closes, 5),
    sma10: calcSMA(closes, 10),
    sma20: calcSMA(closes, 20),
    sma50: closes.length >= 50 ? calcSMA(closes, 50) : null,

    // Oscillators
    rsi14: calcRSI(closes, 14),
    macd: calcMACD(closes),

    // Volatility
    bollingerBands: calcBollingerBands(closes),

    // Momentum
    roc5: calcROC(closes, 5),
    roc10: calcROC(closes, 10),

    // Price levels
    supportResistance: calcSupportResistance(highs, lows, closes),

    // Volume
    volumeTrend: calcVolumeTrend(volumes),

    // SMA Crossovers
    smaCross: detectSMACrossover(closes),
  };
}

/**
 * Detect SMA crossover signals
 */
function detectSMACrossover(closes) {
  if (!closes || closes.length < 20) return null;

  const sma5_now = calcSMA(closes, 5);
  const sma20_now = calcSMA(closes, 20);

  // Check with data shifted by 1
  const prevCloses = closes.slice(0, -1);
  const sma5_prev = calcSMA(prevCloses, 5);
  const sma20_prev = calcSMA(prevCloses, 20);

  if (!sma5_now || !sma20_now || !sma5_prev || !sma20_prev) return null;

  let signal = 'NONE';
  if (sma5_prev <= sma20_prev && sma5_now > sma20_now) signal = 'GOLDEN_CROSS';
  else if (sma5_prev >= sma20_prev && sma5_now < sma20_now) signal = 'DEATH_CROSS';
  else if (sma5_now > sma20_now) signal = 'ABOVE';
  else signal = 'BELOW';

  return { signal, sma5: sma5_now, sma20: sma20_now };
}

// ─── PREDICTION SCORING ─────────────────────────────────

/**
 * Tính SHORT-TERM Score (1-5 ngày)
 * 
 * 30% Technical Signal (RSI, MACD, Bollinger)
 * 25% Money Flow (NN ròng + KL)
 * 20% Price Momentum (ROC, SMA crossover)
 * 15% Volume Confirmation
 * 10% Global Sentiment
 */
function calcShortTermScore(indicators, stockData, globalSentiment = 50) {
  let techScore = 50;    // 0-100
  let moneyScore = 50;
  let momentumScore = 50;
  let volumeScore = 50;
  let globalScore = globalSentiment;

  // ── Technical (30%) ──
  if (indicators.rsi14 !== null) {
    if (indicators.rsi14 < 30) techScore += 25;       // Oversold → buy signal
    else if (indicators.rsi14 < 40) techScore += 10;
    else if (indicators.rsi14 > 70) techScore -= 25;   // Overbought → sell signal
    else if (indicators.rsi14 > 60) techScore -= 5;
  }
  if (indicators.macd) {
    if (indicators.macd.trend === 'BULLISH_CROSS') techScore += 20;
    else if (indicators.macd.trend === 'BULLISH') techScore += 10;
    else if (indicators.macd.trend === 'BEARISH_CROSS') techScore -= 20;
    else if (indicators.macd.trend === 'BEARISH') techScore -= 10;
  }
  if (indicators.bollingerBands) {
    if (indicators.bollingerBands.percentB < 0.1) techScore += 15;  // Near lower band
    else if (indicators.bollingerBands.percentB > 0.9) techScore -= 15; // Near upper band
  }
  techScore = clamp(techScore, 0, 100);

  // ── Money Flow (25%) ──
  if (stockData) {
    const fn = stockData.foreignNet || 0;
    if (fn > 200000) moneyScore += 30;
    else if (fn > 100000) moneyScore += 20;
    else if (fn > 50000) moneyScore += 10;
    else if (fn < -200000) moneyScore -= 30;
    else if (fn < -100000) moneyScore -= 20;
    else if (fn < -50000) moneyScore -= 10;
  }
  moneyScore = clamp(moneyScore, 0, 100);

  // ── Momentum (20%) ──
  if (indicators.roc5 !== null) {
    if (indicators.roc5 > 5) momentumScore += 20;
    else if (indicators.roc5 > 2) momentumScore += 10;
    else if (indicators.roc5 < -5) momentumScore -= 20;
    else if (indicators.roc5 < -2) momentumScore -= 10;
  }
  if (indicators.smaCross) {
    if (indicators.smaCross.signal === 'GOLDEN_CROSS') momentumScore += 25;
    else if (indicators.smaCross.signal === 'ABOVE') momentumScore += 10;
    else if (indicators.smaCross.signal === 'DEATH_CROSS') momentumScore -= 25;
    else if (indicators.smaCross.signal === 'BELOW') momentumScore -= 10;
  }
  momentumScore = clamp(momentumScore, 0, 100);

  // ── Volume (15%) ──
  if (indicators.volumeTrend) {
    const vt = indicators.volumeTrend;
    const priceUp = stockData && stockData.changePct > 0;
    if (vt.trend === 'SPIKE' && priceUp) volumeScore += 30;      // KL đột biến + giá tăng = xác nhận
    else if (vt.trend === 'SPIKE' && !priceUp) volumeScore -= 10; // KL đột biến + giá giảm = xả
    else if (vt.trend === 'HIGH' && priceUp) volumeScore += 15;
    else if (vt.trend === 'VERY_LOW') volumeScore -= 15;
  }
  volumeScore = clamp(volumeScore, 0, 100);

  // Weighted score
  const score = Math.round(
    techScore * 0.30 +
    moneyScore * 0.25 +
    momentumScore * 0.20 +
    volumeScore * 0.15 +
    globalScore * 0.10
  );

  return {
    score: clamp(score, 0, 100),
    label: getScoreLabel(score),
    breakdown: {
      technical: Math.round(techScore),
      moneyFlow: Math.round(moneyScore),
      momentum: Math.round(momentumScore),
      volume: Math.round(volumeScore),
      global: Math.round(globalScore),
    },
  };
}

/**
 * Tính MID-TERM Score (1-3 tháng)
 * 
 * 35% Trend Strength (SMA alignment)
 * 25% Institutional Flow
 * 20% Sector Momentum
 * 10% Price Range Position
 * 10% Market Regime
 */
function calcMidTermScore(indicators, stockData, globalSentiment = 50) {
  let trendScore = 50;
  let flowScore = 50;
  let sectorScore = 50;   // Will use global data later
  let priceRangeScore = 50;
  let regimeScore = globalSentiment;

  // ── Trend (35%) ──
  // SMA alignment: price > SMA5 > SMA10 > SMA20 = strong uptrend
  if (indicators.sma5 && indicators.sma10 && indicators.sma20 && stockData) {
    const price = stockData.price / 1000; // Convert to history scale
    if (price > indicators.sma5 && indicators.sma5 > indicators.sma10 && indicators.sma10 > indicators.sma20) {
      trendScore += 30; // Perfect alignment
    } else if (price > indicators.sma20) {
      trendScore += 15;
    } else if (price < indicators.sma5 && indicators.sma5 < indicators.sma10 && indicators.sma10 < indicators.sma20) {
      trendScore -= 30; // Perfect downtrend
    } else if (price < indicators.sma20) {
      trendScore -= 15;
    }
  }
  if (indicators.roc10 !== null) {
    if (indicators.roc10 > 5) trendScore += 15;
    else if (indicators.roc10 > 0) trendScore += 5;
    else if (indicators.roc10 < -5) trendScore -= 15;
    else if (indicators.roc10 < 0) trendScore -= 5;
  }
  trendScore = clamp(trendScore, 0, 100);

  // ── Institutional Flow (25%) ──
  if (stockData) {
    const fn = stockData.foreignNet || 0;
    if (fn > 100000) flowScore += 25;
    else if (fn > 0) flowScore += 10;
    else if (fn < -100000) flowScore -= 25;
    else if (fn < 0) flowScore -= 10;
  }
  flowScore = clamp(flowScore, 0, 100);

  // ── Price Range (10%) ──
  if (indicators.supportResistance && stockData) {
    const price = stockData.price / 1000;
    const sr = indicators.supportResistance;
    const range = sr.resistance20 - sr.support20;
    if (range > 0) {
      const position = (price - sr.support20) / range;
      if (position < 0.3) priceRangeScore += 15;   // Near support = potential bounce
      else if (position > 0.8) priceRangeScore -= 10; // Near resistance
    }
  }
  priceRangeScore = clamp(priceRangeScore, 0, 100);

  const score = Math.round(
    trendScore * 0.35 +
    flowScore * 0.25 +
    sectorScore * 0.20 +
    priceRangeScore * 0.10 +
    regimeScore * 0.10
  );

  return {
    score: clamp(score, 0, 100),
    label: getScoreLabel(score),
    breakdown: {
      trend: Math.round(trendScore),
      institutionalFlow: Math.round(flowScore),
      sector: Math.round(sectorScore),
      priceRange: Math.round(priceRangeScore),
      regime: Math.round(regimeScore),
    },
  };
}

// ─── HELPERS ───────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function getScoreLabel(score) {
  if (score >= 80) return 'RẤT TÍCH CỰC';
  if (score >= 65) return 'TÍCH CỰC';
  if (score >= 50) return 'TRUNG TÍNH';
  if (score >= 35) return 'TIÊU CỰC';
  return 'RẤT TIÊU CỰC';
}

function getScoreEmoji(score) {
  if (score >= 80) return '🟢🟢';
  if (score >= 65) return '🟢';
  if (score >= 50) return '🟡';
  if (score >= 35) return '🔴';
  return '🔴🔴';
}

/**
 * Format indicators thành text cho AI prompt
 */
function formatIndicatorsForAI(symbol, indicators, shortScore, midScore) {
  if (indicators.error) return `${symbol}: Không đủ dữ liệu kỹ thuật`;

  const parts = [`${symbol}:`];

  if (indicators.rsi14 !== null) {
    const rsiLabel = indicators.rsi14 > 70 ? 'QUÁ MUA' : indicators.rsi14 < 30 ? 'QUÁ BÁN' : 'TRUNG TÍNH';
    parts.push(`RSI=${indicators.rsi14}(${rsiLabel})`);
  }
  if (indicators.macd) {
    parts.push(`MACD=${indicators.macd.trend}`);
  }
  if (indicators.bollingerBands) {
    const bb = indicators.bollingerBands;
    parts.push(`BB[${bb.lower}-${bb.upper}](%B=${bb.percentB.toFixed(2)})`);
  }
  if (indicators.smaCross) {
    parts.push(`SMA_Cross=${indicators.smaCross.signal}`);
  }
  if (indicators.roc5 !== null) parts.push(`ROC5=${indicators.roc5}%`);
  if (indicators.roc10 !== null) parts.push(`ROC10=${indicators.roc10}%`);
  if (indicators.volumeTrend) {
    parts.push(`Vol_Trend=${indicators.volumeTrend.trend}(${indicators.volumeTrend.ratio}x)`);
  }
  if (indicators.supportResistance) {
    const sr = indicators.supportResistance;
    parts.push(`Support=${sr.support20}|Resist=${sr.resistance20}`);
  }

  // Scores
  parts.push(`SHORT_SCORE=${shortScore.score}/100(${shortScore.label})`);
  parts.push(`MID_SCORE=${midScore.score}/100(${midScore.label})`);

  return parts.join(' | ');
}

module.exports = {
  calculateAllIndicators,
  calcShortTermScore,
  calcMidTermScore,
  formatIndicatorsForAI,
  getScoreEmoji,
  getScoreLabel,
  // Export individual for testing
  calcRSI,
  calcMACD,
  calcBollingerBands,
  calcSMA,
  calcROC,
};
