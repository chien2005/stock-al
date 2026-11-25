/**
 * AI STOCK HUNTER - Strategy Library (S01 - S07)
 * Triển khai theo Master Plan V2.0 Section 12:
 * - S01: Trend Pullback / Test cung trong xu hướng tăng
 * - S02: Breakout có cầu xác nhận
 * - S03: Breakout Retest
 * - S04: Wide Range Rebound (biên dưới range rộng)
 * - S05: Confirmed Reversal (chỉ chạy khi Special Watch đạt B5_CONFIRMED)
 * - S06: Spring / Failed Breakdown Reclaim
 * - S07: Compression (nền hẹp - chỉ WATCH, không mua trước khi phá vỡ)
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { computeBarMetrics } = require('./features');

function evaluateStrategies({
  symbol,
  feature,
  zones,
  supplyDemand,
  marketRegime,
  sectorState,
  specialWatchEpisode = null,
}) {
  const candidates = [];
  if (!feature || !feature.daily || !zones || !supplyDemand || !marketRegime) {
    return candidates;
  }

  const d = feature.daily;
  const price = feature.currentPrice;
  const curBar = d.currentBar;
  const curM = d.currentMetrics;
  const ma20 = d.ma20;
  const ma50 = d.ma50;
  const atrD = d.atr14Prior || d.atr14 || (price * 0.025);
  const cues = supplyDemand.cues || [];
  const regime = marketRegime.regime;
  const liqLabel = marketRegime.liquidityLabel;

  const isUptrendDaily =
    zones.structure === 'HH_HL' &&
    ma20 && price >= ma20 * 0.985 &&
    (d.ma20SlopePct === null || d.ma20SlopePct > 0);

  const isDowntrendDaily = zones.structure === 'LH_LL' || (ma20 && ma50 && price < ma20 && ma20 < ma50);

  // ── S01: TREND PULLBACK / TEST CUNG TRONG XU HƯỚNG TĂNG ──
  // Test S02: Không bao giờ kích hoạt S01 nếu cổ phiếu đang LH_LL (chỉ vì giá chạm MA20)
  if (
    isUptrendDaily &&
    !isDowntrendDaily &&
    ['UPTREND_STRONG', 'UPTREND_WEAK', 'RECOVERY', 'RANGE_WIDE'].includes(regime) &&
    ma20
  ) {
    const distToSupport = zones.nearestSupport
      ? Math.abs(price - zones.nearestSupport.center) / price
      : Math.abs(price - ma20) / price;
    const nearSupportOrMA20 = distToSupport <= 0.035 || (curBar && curBar.low <= ma20 * 1.015);
    const hasSupplyTest = cues.includes('SUCCESSFUL_SUPPLY_TEST') || cues.includes('HEALTHY_PULLBACK_LOW_VOL');
    const hasDemandTrigger = supplyDemand.state === 'DEMAND_CONFIRMED' || supplyDemand.state === 'DEMAND_CANDIDATE';

    if (nearSupportOrMA20 && hasSupplyTest && hasDemandTrigger && (curM?.clv ?? 0) >= 0.58) {
      const invalidationLevel = Math.min(
        zones.nearestSupport?.low || ma20 * 0.98,
        curBar?.low || price * 0.97
      );
      candidates.push({
        strategyId: 'S01',
        name: 'Trend Pullback (Test Cung)',
        status: 'CONFIRMED',
        triggerLevel: price,
        invalidationLevel,
        reasonCodes: ['DAILY_HH_HL', 'NEAR_SUPPORT_OR_MA20', ...cues.filter(c => c.includes('SUPPLY_TEST') || c.includes('DEMAND') || c.includes('PULLBACK'))],
      });
    } else if (nearSupportOrMA20 && cues.includes('HEALTHY_PULLBACK_LOW_VOL')) {
      candidates.push({
        strategyId: 'S01',
        name: 'Trend Pullback (Chờ xác nhận)',
        status: 'WATCH',
        triggerLevel: curBar?.high || price,
        invalidationLevel: ma20 * 0.97,
        reasonCodes: ['PULLBACK_LOW_VOL_WAIT_RECLAIM'],
      });
    }
  }

  // ── S02: BREAKOUT CÓ CẦU XÁC NHẬN ──
  const priorHigh15 = d.closedBars.length >= 15
    ? Math.max(...d.closedBars.slice(-15).map(b => b.high))
    : d.high20D;
  if (
    priorHigh15 &&
    ['UPTREND_STRONG', 'UPTREND_WEAK', 'RECOVERY'].includes(regime) &&
    sectorState?.state !== 'DISTRIBUTION_RISK' &&
    !isDowntrendDaily
  ) {
    const brokeOut = price > priorHigh15;
    const goodClose = (curM?.clv ?? 0) >= 0.68 && (curM?.upperWickRatio ?? 1) <= 0.32;
    const volConfirmed = (d.rvolPartial ?? 0) >= 1.4 || (feature.m15?.rvol15 ?? 0) >= 1.5;
    const tooFarFromBase = (price - priorHigh15) > atrD * STOCK_HUNTER_CONFIG.strategies.maxEntryChaseAtr;

    if (brokeOut && goodClose && volConfirmed) {
      // Test S04: Thanh khoản thị trường LOW/DRY hoặc UPTREND_WEAK -> Không blanket mua vượt đỉnh, chuyển WATCH_RETEST
      if (liqLabel === 'LOW' || liqLabel === 'DRY' || regime === 'UPTREND_WEAK') {
        candidates.push({
          strategyId: 'S02',
          name: 'Breakout (Chờ Retest do TT thanh khoản yếu)',
          status: 'WATCH',
          triggerLevel: priorHigh15,
          invalidationLevel: priorHigh15 * 0.97,
          reasonCodes: ['BREAKOUT_WEAK_LIQ_WAIT_RETEST'],
        });
      } else if (tooFarFromBase) {
        // Test S03: Đuổi quá xa nền -> WATCH / NO CHASE
        candidates.push({
          strategyId: 'S02',
          name: 'Breakout (Đã chạy xa nền - Không đuổi)',
          status: 'WATCH',
          triggerLevel: priorHigh15,
          invalidationLevel: priorHigh15 * 0.97,
          reasonCodes: ['BREAKOUT_OVEREXTENDED_NO_CHASE'],
        });
      } else {
        candidates.push({
          strategyId: 'S02',
          name: 'Breakout Xác Nhận Cầu',
          status: 'CONFIRMED',
          triggerLevel: priorHigh15,
          invalidationLevel: Math.max(priorHigh15 - atrD * 0.6, curBar?.low || priorHigh15 * 0.97),
          reasonCodes: ['BREAK_15D_HIGH', 'CLV_STRONG', 'RVOL_CONFIRMED'],
        });
      }
    }
  }

  // ── S03: BREAKOUT RETEST ──
  // Đã vượt đỉnh 15 phiên trong 1-5 phiên gần đây, nay quay lại test đỉnh cũ không gãy và có cầu bật
  if (d.closedBars.length >= 20 && !isDowntrendDaily && ['UPTREND_STRONG', 'UPTREND_WEAK', 'RECOVERY', 'RANGE_WIDE'].includes(regime)) {
    const baseWindow = d.closedBars.slice(-20, -5);
    const recent5 = d.closedBars.slice(-5);
    if (baseWindow.length >= 10) {
      const oldResistance = Math.max(...baseWindow.map(b => b.high));
      const didBreakRecently = recent5.some(b => b.close > oldResistance * 1.005);
      const isRetestingZone =
        curBar &&
        curBar.low <= oldResistance * 1.015 &&
        price >= oldResistance * 0.992 &&
        (price - oldResistance) <= atrD * 0.6;
      const demandBack = supplyDemand.state === 'DEMAND_CONFIRMED' || supplyDemand.state === 'DEMAND_CANDIDATE';

      if (didBreakRecently && isRetestingZone && demandBack && (curM?.clv ?? 0) >= 0.60) {
        candidates.push({
          strategyId: 'S03',
          name: 'Breakout Retest',
          status: 'CONFIRMED',
          triggerLevel: oldResistance,
          invalidationLevel: Math.min(oldResistance * 0.98, curBar.low),
          reasonCodes: ['RETEST_OLD_RESISTANCE', 'DEMAND_RECLAIM'],
        });
      }
    }
  }

  // ── S04: WIDE RANGE REBOUND (MUA BIÊN DƯỚI) ──
  if (
    ['RANGE_WIDE', 'UPTREND_WEAK', 'UPTREND_STRONG'].includes(regime) &&
    (zones.structure === 'RANGE' || zones.structure === 'TRANSITION') &&
    zones.nearestSupport && zones.nearestResistance
  ) {
    const rangeLow = zones.nearestSupport.center;
    const rangeHigh = zones.nearestResistance.center;
    const rangeWidthPct = rangeLow > 0 ? (rangeHigh - rangeLow) / rangeLow : 0;
    const posInRange = rangeHigh > rangeLow ? (price - rangeLow) / (rangeHigh - rangeLow) : 0.5;
    const hasDemand = supplyDemand.state === 'DEMAND_CONFIRMED' || supplyDemand.state === 'DEMAND_CANDIDATE';

    if (rangeWidthPct >= 0.06 && posInRange >= -0.05 && posInRange <= 0.35 && hasDemand && (curM?.clv ?? 0) >= 0.60) {
      candidates.push({
        strategyId: 'S04',
        name: 'Wide Range Rebound (Biên Dưới)',
        status: 'CONFIRMED',
        triggerLevel: rangeLow,
        invalidationLevel: Math.min(zones.nearestSupport.low, curBar?.low || rangeLow * 0.97),
        reasonCodes: ['LOWER_RANGE_ZONE', 'DEMAND_CONFIRMATION'],
      });
    }
  }

  // ── S05: CONFIRMED REVERSAL (SĂN ĐÁY ĐÃ XÁC NHẬN B5) ──
  if (
    specialWatchEpisode &&
    specialWatchEpisode.state === 'B5_CONFIRMED' &&
    regime !== 'PANIC' &&
    regime !== 'UNKNOWN' &&
    sectorState?.state !== 'DISTRIBUTION_RISK'
  ) {
    candidates.push({
      strategyId: 'S05',
      name: 'Confirmed Reversal (Đáy 2 B5)',
      status: STOCK_HUNTER_CONFIG.strategies.reversalLiveEnabled ? 'CONFIRMED' : 'RESEARCH_ONLY',
      isReversal: true,
      triggerLevel: specialWatchEpisode.reclaimLevel || price,
      invalidationLevel: specialWatchEpisode.climaxLow || (price * 0.96),
      reasonCodes: ['SPECIAL_WATCH_B5_CONFIRMED', 'HIGHER_LOW_RECLAIM'],
    });
  }

  // ── S06: SPRING / FAILED BREAKDOWN RECLAIM ──
  if (
    cues.includes('FAILED_BREAKDOWN_SPRING') &&
    zones.nearestSupport &&
    regime !== 'PANIC' &&
    regime !== 'UNKNOWN' &&
    (specialWatchEpisode?.state === 'B5_CONFIRMED' || !isDowntrendDaily)
  ) {
    const isBottomSpring = isDowntrendDaily || (d.rsi14 !== null && d.rsi14 <= 38);
    const allowed = !isBottomSpring || specialWatchEpisode?.state === 'B5_CONFIRMED';
    if (allowed) {
      candidates.push({
        strategyId: 'S06',
        name: 'Spring Reclaim (Rũ Nền Thành Công)',
        status: (isBottomSpring && !STOCK_HUNTER_CONFIG.strategies.reversalLiveEnabled) ? 'RESEARCH_ONLY' : 'CONFIRMED',
        isReversal: isBottomSpring,
        triggerLevel: zones.nearestSupport.low,
        invalidationLevel: curBar?.low || zones.nearestSupport.low * 0.97,
        reasonCodes: ['FAILED_BREAKDOWN_SPRING', 'RECLAIM_SUPPORT'],
      });
    }
  }

  // ── S07: COMPRESSION (NỀN HẸP - CHỈ WATCH) ──
  if (candidates.length === 0 && d.closedBars.length >= 10 && !isDowntrendDaily && atrD > 0) {
    const last5 = d.closedBars.slice(-5);
    const avgRange5 = last5.reduce((s, b) => s + (b.high - b.low), 0) / last5.length;
    const avgVol5 = last5.reduce((s, b) => s + b.volume, 0) / last5.length;
    if (avgRange5 <= atrD * 0.72 && (!d.medianVol20 || avgVol5 <= d.medianVol20 * 0.85)) {
      candidates.push({
        strategyId: 'S07',
        name: 'Compression (Nền Siết Chặt - Chờ Break)',
        status: 'WATCH',
        triggerLevel: Math.max(...last5.map(b => b.high)),
        invalidationLevel: Math.min(...last5.map(b => b.low)),
        reasonCodes: ['VOLATILITY_COMPRESSION', 'LOW_VOLUME_BASE'],
      });
    }
  }

  return candidates;
}

module.exports = { evaluateStrategies };
