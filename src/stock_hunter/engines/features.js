/**
 * AI STOCK HUNTER - Multi-Timeframe Feature Engine
 * Tuân thủ nghiêm ngặt công thức Master Plan V2.0 Section 10.2:
 * - Zero divide-by-zero (flat bar -> null ratios, Test F01)
 * - Zero look-ahead (ATR_prior, RVOL baseline loại trừ bar hiện tại)
 * - No zero-fill when warmup insufficient (MA/RSI thiếu -> null, Test F04)
 * - Wilder smoothing cho ATR14 & RSI14 (flat series -> 50, Test F05)
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { getSessionElapsedWeight, toVnComponents } = require('../core/calendar');

function median(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeBarMetrics(bar, prevClose = null) {
  if (!bar) return null;
  const { open, high, low, close, volume } = bar;
  const range = high - low;
  const returnPct = prevClose && prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
  const direction = close > open ? 1 : close < open ? -1 : 0;

  if (range <= 1e-9) {
    return {
      range: 0,
      flatBar: true,
      bodyRatio: null,
      upperWickRatio: null,
      lowerWickRatio: null,
      clv: null,
      direction,
      returnPct: parseFloat(returnPct.toFixed(2)),
      volume,
    };
  }

  return {
    range,
    flatBar: false,
    bodyRatio: Math.abs(close - open) / range,
    upperWickRatio: (high - Math.max(open, close)) / range,
    lowerWickRatio: (Math.min(open, close) - low) / range,
    clv: (close - low) / range,
    direction,
    returnPct: parseFloat(returnPct.toFixed(2)),
    volume,
  };
}

function computeSMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  if (slice.some(v => !Number.isFinite(v))) return null;
  return slice.reduce((a, b) => a + b, 0) / period;
}

function computeEMASeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function computeSMASeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function computeMASlopePct(series, lookback = 5) {
  if (!Array.isArray(series) || series.length <= lookback) return null;
  const cur = series[series.length - 1];
  const prev = series[series.length - 1 - lookback];
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function computeWilderATR(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) {
    return { atr: null, atrPrior: null, atrSeries: [] };
  }
  const trs = new Array(bars.length).fill(0);
  trs[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  const atrSeries = new Array(bars.length).fill(null);
  let atr = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  atrSeries[period] = atr;
  for (let i = period + 1; i < bars.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
    atrSeries[i] = atr;
  }

  const last = atrSeries[atrSeries.length - 1];
  const prior = atrSeries[atrSeries.length - 2];
  return { atr: last, atrPrior: prior, atrSeries };
}

function computeWilderRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else if (diff < 0) lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = ((avgGain * (period - 1)) + g) / period;
    avgLoss = ((avgLoss * (period - 1)) + l) / period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50; // Test F05: flat series convention
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

/**
 * V2.1: Tính RVOL15 BẮT BUỘC tối thiểu 15 phiên cùng khung giờ (không fallback sang khung giờ khác)
 */
function computeRVOL15(bars15m, historySessions = 20, minSameSlot = STOCK_HUNTER_CONFIG.features.minSameSlot15mSessions || 15) {
  if (!Array.isArray(bars15m) || bars15m.length < minSameSlot) return null;
  const closed15m = bars15m.filter(b => b.final !== false);
  if (closed15m.length < minSameSlot) return null;

  const current = closed15m[closed15m.length - 1];
  const prior = closed15m.slice(0, -1);

  const sameSlot = prior
    .filter(b => b.timeLabel === current.timeLabel && b.dateStr !== current.dateStr && b.volume >= 0)
    .slice(-historySessions)
    .map(b => b.volume);

  if (sameSlot.length < minSameSlot) return null;
  const baseline = median(sameSlot);

  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  return parseFloat((current.volume / baseline).toFixed(2));
}

/**
 * Tính RVOL ngày đã đóng (loại trừ bar cuối nếu bar cuối là hôm nay)
 */
function computeDailyRVOL(closedDailyBars, currentDayVolume = null, timestamp = new Date(), minHistory = 15) {
  if (!Array.isArray(closedDailyBars) || closedDailyBars.length < minHistory) return null;
  const histVols = closedDailyBars.slice(-20).map(b => b.volume).filter(v => v >= 0);
  if (histVols.length < minHistory) return null;
  const med = median(histVols);
  if (!Number.isFinite(med) || med <= 0) return null;

  if (currentDayVolume !== null) {
    const weight = getSessionElapsedWeight(timestamp);
    const projected = currentDayVolume / Math.max(0.05, weight);
    return parseFloat((projected / med).toFixed(2));
  }
  const latest = closedDailyBars[closedDailyBars.length - 1];
  return parseFloat((latest.volume / med).toFixed(2));
}

/**
 * Tính Relative Strength (RS) = Return cổ phiếu - Return Benchmark (điểm %)
 */
function computeRelativeStrength(symbolDailyBars, benchmarkDailyBars, lookback = 20) {
  if (!Array.isArray(symbolDailyBars) || !Array.isArray(benchmarkDailyBars)) return null;
  if (symbolDailyBars.length <= lookback || benchmarkDailyBars.length <= lookback) return null;
  const sCur = symbolDailyBars[symbolDailyBars.length - 1].close;
  const sPrev = symbolDailyBars[symbolDailyBars.length - 1 - lookback].close;
  const bCur = benchmarkDailyBars[benchmarkDailyBars.length - 1].close;
  const bPrev = benchmarkDailyBars[benchmarkDailyBars.length - 1 - lookback].close;
  if (sPrev <= 0 || bPrev <= 0) return null;
  const sRet = ((sCur - sPrev) / sPrev) * 100;
  const bRet = ((bCur - bPrev) / bPrev) * 100;
  return parseFloat((sRet - bRet).toFixed(2));
}

/**
 * Tạo snapshot Feature tổng hợp cho 1 mã tại thời điểm asOf (Multi-timeframe: 15m, 1D, 1W, 1M)
 */
function computeSymbolFeatures({
  symbol,
  dailyBars = [],
  weeklyBars = [],
  monthlyBars = [],
  bars15m = [],
  benchmarkDailyBars = [],
  quote = null,
  asOf = new Date(),
}) {
  const cfg = STOCK_HUNTER_CONFIG.features;
  const vnNow = toVnComponents(asOf);

  // Tách nến ngày đã đóng hoàn toàn (< hôm nay) và nến tạm thời trong phiên
  const closedDaily = dailyBars.filter(b => b.dateStr < vnNow.dateStr);
  const todayBarFromHistory = dailyBars.find(b => b.dateStr === vnNow.dateStr) || null;

  const baseDaily = closedDaily.length >= 20 ? closedDaily : dailyBars;
  const closesD = baseDaily.map(b => b.close);
  const ma20SeriesD = computeSMASeries(closesD, 20);
  const ma50SeriesD = computeSMASeries(closesD, 50);

  const ma20D = ma20SeriesD.length > 0 ? ma20SeriesD[ma20SeriesD.length - 1] : null;
  const ma50D = ma50SeriesD.length > 0 ? ma50SeriesD[ma50SeriesD.length - 1] : null;
  const ma20SlopeD = computeMASlopePct(ma20SeriesD, 5);
  const ma50SlopeD = computeMASlopePct(ma50SeriesD, 5);
  const atrResultD = computeWilderATR(baseDaily, cfg.atrPeriod);
  const rsi14D = computeWilderRSI(closesD, cfg.rsiPeriod);

  // Xây dựng nến intraday tạm thời (current_partial) từ realtime quote nếu đang trong phiên
  let currentPrice = quote?.priceVnd || (dailyBars.length > 0 ? dailyBars[dailyBars.length - 1].close : null);
  let currentBarD = todayBarFromHistory;
  if (quote && quote.priceVnd > 0) {
    currentBarD = {
      symbol,
      dateStr: vnNow.dateStr,
      open: quote.openVnd || quote.priceVnd,
      high: quote.highVnd || quote.priceVnd,
      low: quote.lowVnd || quote.priceVnd,
      close: quote.priceVnd,
      volume: quote.volumeShares || 0,
      final: false,
      provisional: true,
    };
  }
  const prevCloseD = closedDaily.length > 0
    ? closedDaily[closedDaily.length - 1].close
    : (baseDaily.length > 1 ? baseDaily[baseDaily.length - 2].close : null);
  const currentBarMetricsD = currentBarD ? computeBarMetrics(currentBarD, prevCloseD) : null;

  // RVOL ngày dự phóng theo giờ
  const rvolDayPartial = quote
    ? computeDailyRVOL(closedDaily, quote.volumeShares, asOf, cfg.minRvolHistory)
    : computeDailyRVOL(closedDaily, null, asOf, cfg.minRvolHistory);

  // Median Volume 20 phiên gần nhất
  const volHist20 = closedDaily.slice(-20).map(b => b.volume);
  const medianVol20D = volHist20.length >= cfg.minRvolHistory ? median(volHist20) : null;

  // Drawdown từ đỉnh 60 phiên đã đóng trước đó
  const prior60 = closedDaily.slice(-60);
  const high60D = prior60.length > 0 ? Math.max(...prior60.map(b => b.high)) : null;
  const low20D = closedDaily.slice(-20).length > 0 ? Math.min(...closedDaily.slice(-20).map(b => b.low)) : null;
  const high20D = closedDaily.slice(-20).length > 0 ? Math.max(...closedDaily.slice(-20).map(b => b.high)) : null;
  const drawdown60D = high60D && currentPrice ? parseFloat((((currentPrice - high60D) / high60D) * 100).toFixed(2)) : null;
  const distMA20Atr = ma20D && atrResultD.atr && currentPrice ? parseFloat(((currentPrice - ma20D) / atrResultD.atr).toFixed(2)) : null;

  // Khung Tuần (chỉ tính trên các tuần đã đóng final để tránh look-ahead)
  const closedWeekly = weeklyBars.filter(b => b.final);
  const closesW = closedWeekly.map(b => b.close);
  const ma20W = computeSMA(closesW, 20);
  const ma50W = computeSMA(closesW, 50);
  const weeklyTrend = ma20W && closesW.length > 0
    ? (closesW[closesW.length - 1] > ma20W ? 'UP' : 'DOWN')
    : 'UNKNOWN';

  // Khung Tháng
  const closedMonthly = monthlyBars.filter(b => b.final);
  const closesM = closedMonthly.map(b => b.close);
  const ma12M = computeSMA(closesM, 12);
  const monthlyContext = ma12M && closesM.length > 0
    ? (closesM[closesM.length - 1] > ma12M ? 'ABOVE_MA12M' : 'BELOW_MA12M')
    : 'UNKNOWN';

  // Khung 15m (V2.1: chỉ dùng các nến đã đóng final !== false)
  let m15 = null;
  const closedBars15m = Array.isArray(bars15m) ? bars15m.filter(b => b.final !== false) : [];
  if (closedBars15m.length >= 10) {
    const last15 = closedBars15m[closedBars15m.length - 1];
    const prev15 = closedBars15m[closedBars15m.length - 2];
    const closes15 = closedBars15m.map(b => b.close);
    const ema5_15 = computeEMASeries(closes15, 5);
    const ma10_15 = computeSMASeries(closes15, 10);
    const atr15 = computeWilderATR(closedBars15m, 14);
    const metrics15 = computeBarMetrics(last15, prev15.close);
    const rvol15 = computeRVOL15(closedBars15m, 20);
    m15 = {
      barsCount: closedBars15m.length,
      lastBar: last15,
      metrics: metrics15,
      rvol15,
      ema5: ema5_15[ema5_15.length - 1],
      ma10: ma10_15[ma10_15.length - 1],
      atr15: atr15.atr,
      atr15Prior: atr15.atrPrior,
      recentHigh5: Math.max(...closedBars15m.slice(-6, -1).map(b => b.high)),
      recentLow5: Math.min(...closedBars15m.slice(-6, -1).map(b => b.low)),
    };
  }

  // Relative Strength vs Benchmark
  const seriesForRS = currentPrice && closedDaily.length > 0
    ? [...closedDaily, { close: currentPrice }]
    : closedDaily;
  const rs5 = computeRelativeStrength(seriesForRS, benchmarkDailyBars, 5);
  const rs20 = computeRelativeStrength(seriesForRS, benchmarkDailyBars, 20);

  return {
    symbol,
    asOf: asOf.toISOString(),
    currentPrice,
    prevCloseD,
    changePct: quote?.changePct ?? currentBarMetricsD?.returnPct ?? 0,
    daily: {
      closedCount: closedDaily.length,
      closedBars: closedDaily,
      currentBar: currentBarD,
      currentMetrics: currentBarMetricsD,
      ma20: ma20D ? Math.round(ma20D) : null,
      ma50: ma50D ? Math.round(ma50D) : null,
      ma20SlopePct: ma20SlopeD !== null ? parseFloat(ma20SlopeD.toFixed(2)) : null,
      ma50SlopePct: ma50SlopeD !== null ? parseFloat(ma50SlopeD.toFixed(2)) : null,
      atr14: atrResultD.atr ? Math.round(atrResultD.atr) : null,
      atr14Prior: atrResultD.atrPrior ? Math.round(atrResultD.atrPrior) : null,
      rsi14: rsi14D,
      rvolPartial: rvolDayPartial,
      medianVol20: medianVol20D,
      high60D,
      high20D,
      low20D,
      drawdown60D,
      distMA20Atr,
    },
    weekly: {
      closedCount: closedWeekly.length,
      closedBars: closedWeekly,
      ma20W: ma20W ? Math.round(ma20W) : null,
      ma50W: ma50W ? Math.round(ma50W) : null,
      trend: weeklyTrend,
      high20W: closedWeekly.length > 0 ? Math.max(...closedWeekly.slice(-20).map(b => b.high)) : null,
      low20W: closedWeekly.length > 0 ? Math.min(...closedWeekly.slice(-20).map(b => b.low)) : null,
    },
    monthly: {
      closedCount: closedMonthly.length,
      ma12M: ma12M ? Math.round(ma12M) : null,
      context: monthlyContext,
    },
    m15,
    rs5,
    rs20,
    foreignNetValueVnd: quote?.foreignNetValueVnd ?? null,
    spreadPct: quote?.spreadPct ?? null,
  };
}

module.exports = {
  median,
  computeBarMetrics,
  computeSMA,
  computeSMASeries,
  computeEMASeries,
  computeMASlopePct,
  computeWilderATR,
  computeWilderRSI,
  computeRVOL15,
  computeDailyRVOL,
  computeRelativeStrength,
  computeSymbolFeatures,
};
