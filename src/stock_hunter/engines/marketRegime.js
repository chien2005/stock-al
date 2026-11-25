/**
 * AI STOCK HUNTER - Market Regime & Breadth Engine
 * Tuân thủ Master Plan V2.0 Section 8:
 * - Tách rạch ròi Market Regime (8 trạng thái) và Liquidity Label (DRY/LOW/NORMAL/HIGH)
 * - Fail-closed -> UNKNOWN khi thiếu benchmark hoặc coverage < 90% (Test D07, M06)
 * - Phát hiện Index Concentration (trụ kéo xanh nhưng đa số mã đỏ, Test M01)
 * - Hysteresis: chống nhảy regime qua lại vì 1 nến nhiễu (Test M04), nhưng PANIC hạ ngay
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { getSessionElapsedWeight } = require('../core/calendar');
const { computeSMASeries, computeMASlopePct, computeWilderATR, median } = require('./features');

const REGIME_EXPOSURE_CAPS = {
  UPTREND_STRONG: 1.0,
  UPTREND_WEAK: 0.60,
  RANGE_WIDE: 0.60,
  RANGE_NARROW: 0.30,
  DOWNTREND: 0.20,
  RECOVERY: 0.40,
  PANIC: 0.0,
  UNKNOWN: 0.0,
};

function classifyLiquidityLabel(liquidityRatio) {
  if (!Number.isFinite(liquidityRatio)) return 'UNKNOWN';
  if (liquidityRatio < 0.75) return 'DRY';
  if (liquidityRatio < 0.90) return 'LOW';
  if (liquidityRatio <= 1.20) return 'NORMAL';
  return 'HIGH';
}

/**
 * Tính độ rộng (Breadth) trên tập Universe cố định
 */
function computeUniverseBreadth(featureList = [], expectedUniverseCount = 0) {
  const valid = featureList.filter(f => f && Number.isFinite(f.currentPrice) && f.currentPrice > 0);
  const validCount = valid.length;
  const expected = expectedUniverseCount > 0 ? expectedUniverseCount : validCount;
  const coverage = expected > 0 ? validCount / expected : 0;

  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let aboveMA20 = 0;
  let ma20ValidCount = 0;
  let aboveMA50 = 0;
  let ma50ValidCount = 0;
  let limitDownCount = 0;
  const returns = [];

  for (const f of valid) {
    const chg = f.changePct || 0;
    returns.push(chg);
    if (chg > 0.05) advancing++;
    else if (chg < -0.05) declining++;
    else unchanged++;

    if (f.daily?.ma20) {
      ma20ValidCount++;
      if (f.currentPrice >= f.daily.ma20) aboveMA20++;
    }
    if (f.daily?.ma50) {
      ma50ValidCount++;
      if (f.currentPrice >= f.daily.ma50) aboveMA50++;
    }
    if (chg <= -6.5) limitDownCount++;
  }

  const decPlusAdv = advancing + declining;
  const advanceRatio = decPlusAdv > 0 ? parseFloat((advancing / decPlusAdv).toFixed(3)) : null;
  const pctAboveMA20 = ma20ValidCount > 0 ? parseFloat(((aboveMA20 / ma20ValidCount) * 100).toFixed(1)) : null;
  const pctAboveMA50 = ma50ValidCount > 0 ? parseFloat(((aboveMA50 / ma50ValidCount) * 100).toFixed(1)) : null;
  const medianReturnPct = returns.length > 0 ? parseFloat((median(returns) || 0).toFixed(2)) : null;

  return {
    validCount,
    expectedCount: expected,
    coverage: parseFloat(coverage.toFixed(3)),
    advancing,
    declining,
    unchanged,
    advanceRatio,
    pctAboveMA20,
    pctAboveMA50,
    limitDownCount,
    medianReturnPct,
  };
}

/**
 * Phân loại Market Regime với rule resolution rõ ràng + Hysteresis
 */
function classifyMarketRegime({
  vnindexBars = [],
  vnindexLive = null,
  marketLiquidity = null,
  featureList = [],
  expectedUniverseCount = 0,
  priorRegimeState = null,
  asOf = new Date(),
}) {
  const cfg = STOCK_HUNTER_CONFIG.market;
  const breadth = computeUniverseBreadth(featureList, expectedUniverseCount);

  // Check D07 / M06: thiếu dữ liệu benchmark hoặc coverage breadth < 90% -> UNKNOWN (Fail-closed)
  if (!Array.isArray(vnindexBars) || vnindexBars.length < 50 || breadth.coverage < cfg.minMarketCoverage) {
    return {
      asOf: asOf.toISOString(),
      regime: 'UNKNOWN',
      baseRegime: 'UNKNOWN',
      liquidityLabel: 'UNKNOWN',
      exposureCap: 0,
      confidence: 'LOW',
      concentrationFlag: false,
      breadth,
      vnindex: vnindexLive || null,
      liquidityRatio: null,
      reasonCodes: [
        !Array.isArray(vnindexBars) || vnindexBars.length < 50 ? 'BENCHMARK_HISTORY_INSUFFICIENT' : null,
        breadth.coverage < cfg.minMarketCoverage ? `BREADTH_COVERAGE_LOW_${(breadth.coverage * 100).toFixed(1)}%` : null,
      ].filter(Boolean),
      pendingTransition: null,
    };
  }

  const closes = vnindexBars.map(b => b.close);
  const ma20Series = computeSMASeries(closes, 20);
  const ma50Series = computeSMASeries(closes, 50);
  const ma20 = ma20Series[ma20Series.length - 1];
  const ma50 = ma50Series[ma50Series.length - 1];
  const slopeMA20 = computeMASlopePct(ma20Series, 5);
  const atrVni = computeWilderATR(vnindexBars, 14);

  const lastClosedVni = vnindexBars[vnindexBars.length - 1];
  const currentIndex = vnindexLive?.index > 0 ? vnindexLive.index : lastClosedVni.close;
  const indexChangePct = vnindexLive?.changePct ?? (
    vnindexBars.length >= 2
      ? parseFloat((((currentIndex - vnindexBars[vnindexBars.length - 2].close) / vnindexBars[vnindexBars.length - 2].close) * 100).toFixed(2))
      : 0
  );

  // Tính Liquidity Ratio theo cùng thời điểm (Time-of-day normalized, Test F03)
  // Lưu ý: VNINDEX history có `close` là điểm số (không phải VND), nên phải so khớp `volumeShares` với median `volume` của VNINDEX!
  const histVols = vnindexBars.slice(-21, -1).map(b => b.volume).filter(v => v > 0);
  const medVniVol = median(histVols);
  const elapsedWeight = getSessionElapsedWeight(asOf);
  let liquidityRatio = null;
  if (medVniVol && medVniVol > 0) {
    const currentVniVol = (vnindexLive && Number.isFinite(vnindexLive.volumeShares) && vnindexLive.volumeShares > 0)
      ? vnindexLive.volumeShares
      : lastClosedVni.volume;
    if (currentVniVol > 0) {
      const expectedAtTime = medVniVol * elapsedWeight;
      liquidityRatio = parseFloat((currentVniVol / expectedAtTime).toFixed(2));
    }
  }
  const liquidityLabel = classifyLiquidityLabel(liquidityRatio);

  // Phát hiện Index Concentration (trụ kéo xanh nhưng đa số mã đỏ, Test M01)
  const concentrationFlag = indexChangePct >= 0.25 && breadth.advanceRatio !== null && breadth.advanceRatio < 0.42;

  // Biên độ dao động 20 phiên của VN-Index (phân biệt RANGE_WIDE vs RANGE_NARROW)
  const last20 = vnindexBars.slice(-20);
  const max20 = Math.max(...last20.map(b => b.high));
  const min20 = Math.min(...last20.map(b => b.low));
  const range20Pct = min20 > 0 ? ((max20 - min20) / min20) * 100 : 0;

  // ── RULE RESOLUTION ORDER (Section 8.4) ──
  const reasonCodes = [];
  let candidateRegime = 'RANGE_NARROW';

  // 1. PANIC check (Test M02, M03)
  const isPanic =
    (indexChangePct <= -2.0 && breadth.advanceRatio !== null && breadth.advanceRatio <= 0.20) ||
    (breadth.limitDownCount >= Math.max(8, Math.round(breadth.validCount * 0.08))) ||
    (indexChangePct <= -2.5 && liquidityLabel === 'HIGH');

  if (isPanic) {
    candidateRegime = 'PANIC';
    reasonCodes.push('SYSTEMIC_SELLOFF_PANIC');
  } else if (
    // 2. RECOVERY check
    (priorRegimeState?.baseRegime === 'DOWNTREND' || priorRegimeState?.baseRegime === 'PANIC') &&
    currentIndex > ma20 &&
    breadth.advanceRatio !== null && breadth.advanceRatio >= 0.58 &&
    indexChangePct >= 0.8
  ) {
    candidateRegime = 'RECOVERY';
    reasonCodes.push('RECLAIM_AFTER_DOWNTREND');
  } else if (
    // 3. UPTREND_STRONG
    currentIndex > ma20 &&
    ma20 > ma50 &&
    slopeMA20 !== null && slopeMA20 > 0.15 &&
    breadth.pctAboveMA20 !== null && breadth.pctAboveMA20 >= 58 &&
    !concentrationFlag &&
    (liquidityRatio === null || liquidityRatio >= 0.95)
  ) {
    candidateRegime = 'UPTREND_STRONG';
    reasonCodes.push('TREND_AND_BREADTH_ALIGNED');
  } else if (
    // 4. UPTREND_WEAK
    currentIndex > ma20 &&
    (ma20 >= ma50 * 0.99) &&
    (breadth.pctAboveMA20 === null || breadth.pctAboveMA20 >= 42)
  ) {
    candidateRegime = 'UPTREND_WEAK';
    if (concentrationFlag) reasonCodes.push('INDEX_CONCENTRATION_PILLARS_PULL');
    if (liquidityLabel === 'DRY' || liquidityLabel === 'LOW') reasonCodes.push(`LIQUIDITY_${liquidityLabel}`);
  } else if (
    // 5. DOWNTREND
    currentIndex < ma20 &&
    (slopeMA20 !== null && slopeMA20 < -0.25) &&
    (breadth.pctAboveMA20 === null || breadth.pctAboveMA20 < 45)
  ) {
    candidateRegime = 'DOWNTREND';
    reasonCodes.push('INDEX_BELOW_FALLING_MA20');
  } else {
    // 6. RANGE_WIDE vs RANGE_NARROW (phải có dao động quanh MA20)
    candidateRegime = range20Pct >= 4.0 ? 'RANGE_WIDE' : 'RANGE_NARROW';
    reasonCodes.push(range20Pct >= 4.0 ? 'SIDEWAY_WIDE_BAND' : 'SIDEWAY_COMPRESSED');
  }

  // ── HYSTERESIS (Chống giật regime vì 1 bar nhiễu, Test M04) ──
  // PANIC hạ ngay lập tức; các chuyển đổi khác cần xác nhận 2 chu kỳ liên tiếp nếu prior khác candidate
  let finalRegime = candidateRegime;
  let pendingTransition = null;

  if (priorRegimeState && priorRegimeState.baseRegime && priorRegimeState.baseRegime !== 'UNKNOWN') {
    const prev = priorRegimeState.baseRegime;
    if (candidateRegime !== prev && candidateRegime !== 'PANIC') {
      const prevPending = priorRegimeState.pendingTransition;
      if (prevPending && prevPending.target === candidateRegime && prevPending.count >= 1) {
        finalRegime = candidateRegime;
      } else {
        finalRegime = prev;
        pendingTransition = { target: candidateRegime, count: 1 };
        reasonCodes.push(`HYSTERESIS_HOLD_${prev}_PENDING_${candidateRegime}`);
      }
    }
  }

  const confidence = breadth.coverage >= 0.97 && liquidityRatio !== null
    ? (concentrationFlag ? 'MEDIUM' : 'HIGH')
    : 'MEDIUM';

  return {
    asOf: asOf.toISOString(),
    regime: finalRegime,
    baseRegime: finalRegime,
    candidateRegime,
    liquidityLabel,
    liquidityRatio,
    exposureCap: REGIME_EXPOSURE_CAPS[finalRegime] ?? 0,
    confidence,
    concentrationFlag,
    breadth,
    vnindex: {
      index: currentIndex,
      changePct: indexChangePct,
      ma20: Math.round(ma20 * 100) / 100,
      ma50: Math.round(ma50 * 100) / 100,
      slopeMA20: slopeMA20 !== null ? parseFloat(slopeMA20.toFixed(2)) : null,
      atr14: atrVni.atr ? parseFloat(atrVni.atr.toFixed(2)) : null,
      range20Pct: parseFloat(range20Pct.toFixed(2)),
    },
    marketLiquidity,
    reasonCodes,
    pendingTransition,
  };
}

module.exports = {
  REGIME_EXPOSURE_CAPS,
  classifyLiquidityLabel,
  computeUniverseBreadth,
  classifyMarketRegime,
};
