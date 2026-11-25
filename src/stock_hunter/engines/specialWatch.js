/**
 * AI STOCK HUNTER - Special Watchlist Engine (Bottom Fishing & Spring State Machine)
 * Tuân thủ Master Plan V2.0 Section 13:
 * B0 FALLING_KNIFE -> B1 OVERSOLD_WATCH -> B2 CLIMAX_OR_SPRING -> B3 STABILIZING
 * -> B4 RECLAIM -> B5 CONFIRMED -> (B7 FAILED / EXPIRED)
 *
 * Quy tắc P0 bất di bất dịch:
 * - CẤM nhảy từ B0/B1 lên B5 chỉ vì RSI thấp hay 1 nến rút chân (Tests S09, S10)
 * - Chỉ chuyển B5 khi đã qua B2 + giữ được vùng thấp (higher low / retest) + Reclaim + Demand confirmation (Test S11)
 * - Thủng climaxLow hoặc bán tháo tiếp -> B7 FAILED + Cooldown (Test S12)
 */

const { countTradingSessionsBetween, toVnComponents } = require('../core/calendar');

function evaluateSpecialWatch({
  symbol,
  feature,
  zones,
  supplyDemand,
  universeGate,
  quote = null,
  priorEpisode = null,
  asOf = new Date(),
}) {
  const vnDate = toVnComponents(asOf).dateStr;
  const d = feature?.daily;
  const m15 = feature?.m15;

  if (!d || !feature.currentPrice || (universeGate && !universeGate.eligibleForBuy && universeGate.failReasons.some(r => r.startsWith('U01') || r.startsWith('U02') || r.startsWith('U07')))) {
    return null;
  }

  // Nếu đang trong thời gian cooldown sau B7 FAILED -> không tạo episode mới ngay
  if (priorEpisode && priorEpisode.state === 'B7_FAILED' && priorEpisode.cooldownUntilDate && vnDate <= priorEpisode.cooldownUntilDate) {
    return priorEpisode;
  }

  const price = feature.currentPrice;
  const curBar = d.currentBar;
  const curM = d.currentMetrics;
  const rsi14 = d.rsi14;
  const drawdown = d.drawdown60D;
  const cues = supplyDemand?.cues || [];

  const isOversold = (drawdown !== null && drawdown <= -15) || (rsi14 !== null && rsi14 <= 30);
  const hasClimaxOrSpring = cues.includes('SELLING_CLIMAX_CANDIDATE') || cues.includes('FAILED_BREAKDOWN_SPRING');
  const isFallingKnife =
    zones?.structure === 'LH_LL' &&
    d.ma20 && price < d.ma20 &&
    supplyDemand?.state === 'SUPPLY_PRESSURE' &&
    !hasClimaxOrSpring;

  // Chưa có episode cũ
  if (!priorEpisode || priorEpisode.state === 'B7_FAILED' || priorEpisode.state === 'B7_EXPIRED') {
    if (hasClimaxOrSpring && (drawdown === null || drawdown <= -10 || (rsi14 !== null && rsi14 <= 38))) {
      const climaxLow = Math.min(curBar?.low || price, d.low20D || price);
      const reclaimLevel = Math.max(
        zones?.latestSwingHigh?.price || 0,
        d.closedBars.length > 0 ? d.closedBars[d.closedBars.length - 1].high : price * 1.02,
        curBar?.open || price
      );
      return {
        symbol,
        state: 'B2_CLIMAX_OR_SPRING',
        detectedDate: vnDate,
        b2EnteredDate: vnDate,
        climaxLow,
        reclaimLevel: Math.round(reclaimLevel),
        stabilizeBarsCount: 0,
        higherLowPrice: null,
        drawdown60D: drawdown,
        rsi14,
        cues,
        historyLog: [{ date: vnDate, state: 'B2_CLIMAX_OR_SPRING', price, note: cues.join(',') }],
        cooldownUntilDate: null,
      };
    }

    if (isOversold && !isFallingKnife) {
      return {
        symbol,
        state: 'B1_OVERSOLD_WATCH',
        detectedDate: vnDate,
        b2EnteredDate: null,
        climaxLow: curBar?.low || price,
        reclaimLevel: d.ma20 || Math.round(price * 1.03),
        stabilizeBarsCount: 0,
        higherLowPrice: null,
        drawdown60D: drawdown,
        rsi14,
        cues,
        historyLog: [{ date: vnDate, state: 'B1_OVERSOLD_WATCH', price, note: `DD=${drawdown}% RSI=${rsi14}` }],
        cooldownUntilDate: null,
      };
    }

    if (isFallingKnife && isOversold) {
      return {
        symbol,
        state: 'B0_FALLING_KNIFE',
        detectedDate: vnDate,
        b2EnteredDate: null,
        climaxLow: curBar?.low || price,
        reclaimLevel: null,
        stabilizeBarsCount: 0,
        higherLowPrice: null,
        drawdown60D: drawdown,
        rsi14,
        cues,
        historyLog: [{ date: vnDate, state: 'B0_FALLING_KNIFE', price, note: 'Đang rơi tự do, cấm mua' }],
        cooldownUntilDate: null,
      };
    }

    return null;
  }

  // Đã có episode active (B0..B5) -> Đánh giá chuyển trạng thái theo tuần tự nghiêm ngặt
  const ep = { ...priorEpisode, historyLog: [...(priorEpisode.historyLog || [])], cues };
  const sessionsSinceDetected = countTradingSessionsBetween(ep.detectedDate, vnDate);
  const sessionsSinceB2 = ep.b2EnteredDate ? countTradingSessionsBetween(ep.b2EnteredDate, vnDate) : 0;

  // Check thất bại (Test S12): Thủng đáy climax hoặc gãy áp lực bán mới hoặc sàn khóa thanh khoản
  if (
    quote?.isLimitDownLocked ||
    (ep.climaxLow && price < ep.climaxLow * 0.992 && supplyDemand?.state === 'SUPPLY_PRESSURE') ||
    (ep.state !== 'B0_FALLING_KNIFE' && ep.climaxLow && (curBar?.close || price) < ep.climaxLow * 0.985)
  ) {
    ep.state = 'B7_FAILED';
    ep.failedReason = quote?.isLimitDownLocked ? 'LIMIT_DOWN_LOCKED' : 'BROKE_CLIMAX_LOW';
    ep.cooldownUntilDate = vnDate; // Tối thiểu hết phiên này (hoặc cộng thêm ngày ở service)
    ep.historyLog.push({ date: vnDate, state: 'B7_FAILED', price, note: ep.failedReason });
    return ep;
  }

  // Check hết hạn (B1 tối đa 10 phiên, B2->B5 tối đa 3 phiên sau B2)
  if (ep.state === 'B1_OVERSOLD_WATCH' && sessionsSinceDetected > 10) {
    ep.state = 'B7_EXPIRED';
    ep.failedReason = 'B1_TIMEOUT_10_SESSIONS';
    ep.historyLog.push({ date: vnDate, state: 'B7_EXPIRED', price, note: ep.failedReason });
    return ep;
  }
  if ((ep.state === 'B2_CLIMAX_OR_SPRING' || ep.state === 'B3_STABILIZING' || ep.state === 'B4_RECLAIM') && sessionsSinceB2 > 3) {
    ep.state = 'B7_EXPIRED';
    ep.failedReason = 'B2_TO_B5_TIMEOUT_3_SESSIONS';
    ep.historyLog.push({ date: vnDate, state: 'B7_EXPIRED', price, note: ep.failedReason });
    return ep;
  }

  // Tiến trình chuyển trạng thái tuần tự: B0 -> B1 -> B2 -> B3 -> B4 -> B5
  if (ep.state === 'B0_FALLING_KNIFE') {
    if (hasClimaxOrSpring) {
      ep.state = 'B2_CLIMAX_OR_SPRING';
      ep.b2EnteredDate = vnDate;
      ep.climaxLow = Math.min(ep.climaxLow || price, curBar?.low || price);
      ep.historyLog.push({ date: vnDate, state: 'B2_CLIMAX_OR_SPRING', price, note: 'Climax/Spring xuất hiện' });
    } else if (!isFallingKnife && isOversold) {
      ep.state = 'B1_OVERSOLD_WATCH';
      ep.historyLog.push({ date: vnDate, state: 'B1_OVERSOLD_WATCH', price, note: 'Giảm áp lực rơi tự do' });
    }
    return ep;
  }

  if (ep.state === 'B1_OVERSOLD_WATCH') {
    if (hasClimaxOrSpring) {
      ep.state = 'B2_CLIMAX_OR_SPRING';
      ep.b2EnteredDate = vnDate;
      ep.climaxLow = Math.min(ep.climaxLow || price, curBar?.low || price);
      ep.historyLog.push({ date: vnDate, state: 'B2_CLIMAX_OR_SPRING', price, note: cues.join(',') });
    }
    return ep;
  }

  // Từ B2: kiểm tra B3 STABILIZING (giữ trên climaxLow, không tạo đáy mới sâu hơn)
  const holdsAboveClimax = ep.climaxLow && (curBar?.low || price) >= ep.climaxLow * 0.995;
  const m15NoNewLow = m15 ? (m15.lastBar.low >= ep.climaxLow * 0.995) : holdsAboveClimax;
  const isStabilizing = holdsAboveClimax && m15NoNewLow && supplyDemand?.state !== 'SUPPLY_PRESSURE';

  if (ep.state === 'B2_CLIMAX_OR_SPRING') {
    // Phải khác nến phát hiện B2 hoặc có tiến triển rõ trên 15m sau B2 (tránh nhảy cóc trên cùng 1 nến, Test S10)
    if (isStabilizing && (sessionsSinceB2 >= 1 || (m15 && m15.metrics && m15.metrics.clv >= 0.55))) {
      ep.state = 'B3_STABILIZING';
      ep.stabilizeBarsCount += 1;
      ep.higherLowPrice = Math.max(ep.climaxLow, curBar?.low || ep.climaxLow);
      ep.historyLog.push({ date: vnDate, state: 'B3_STABILIZING', price, note: 'Ngừng tạo đáy mới' });
    }
    return ep;
  }

  const reclaimed = ep.reclaimLevel && price >= ep.reclaimLevel && (curM?.clv ?? 0.5) >= 0.55;
  if (ep.state === 'B3_STABILIZING') {
    if (reclaimed && (supplyDemand?.state === 'DEMAND_CANDIDATE' || supplyDemand?.state === 'DEMAND_CONFIRMED')) {
      ep.state = 'B4_RECLAIM';
      ep.higherLowPrice = Math.max(ep.higherLowPrice || ep.climaxLow, curBar?.low || ep.climaxLow);
      ep.historyLog.push({ date: vnDate, state: 'B4_RECLAIM', price, note: `Reclaim >= ${ep.reclaimLevel}` });
    } else if (isStabilizing) {
      ep.stabilizeBarsCount += 1;
    }
    return ep;
  }

  // Từ B4 -> B5 CONFIRMED: cần higher low / retest thành công + demand confirmation (Test S11)
  if (ep.state === 'B4_RECLAIM') {
    const hasHigherLow = ep.higherLowPrice && ep.climaxLow && ep.higherLowPrice > ep.climaxLow;
    const demandConfirmed = supplyDemand?.state === 'DEMAND_CONFIRMED' || (
      supplyDemand?.state === 'DEMAND_CANDIDATE' &&
      (curM?.clv ?? 0) >= 0.65 &&
      price >= ep.reclaimLevel
    );
    if ((hasHigherLow || sessionsSinceB2 >= 1) && demandConfirmed && !quote?.isLimitDownLocked) {
      ep.state = 'B5_CONFIRMED';
      ep.confirmedDate = vnDate;
      ep.historyLog.push({ date: vnDate, state: 'B5_CONFIRMED', price, note: 'Xác nhận Đáy 2 + Reclaim + Cầu vào' });
    }
    return ep;
  }

  return ep;
}

module.exports = { evaluateSpecialWatch };
