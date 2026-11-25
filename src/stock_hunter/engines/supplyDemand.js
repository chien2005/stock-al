/**
 * AI STOCK HUNTER - Supply-Demand Engine & State Machine
 * Tuân thủ Master Plan V2.0 Section 11:
 * - OHLCV chỉ đọc hành vi giá & khối lượng (không suy diễn danh tính "tổ chức/cá mập")
 * - 15 mẫu hình cung cầu với ngưỡng seed định lượng
 * - Chống cộng trùng bằng chứng trên cùng 1 cây nến (evidence clustering & cap)
 * - State machine: UNKNOWN | BALANCED | DEMAND_CANDIDATE | DEMAND_CONFIRMED | SUPPLY_WARNING | SUPPLY_PRESSURE | ABSORPTION_WATCH
 */

const { computeBarMetrics } = require('./features');

/**
 * Đánh giá chuỗi nến 15m & nến Ngày để tạo bằng chứng Cung-Cầu khách quan
 */
function analyzeSupplyDemand({ feature, zones, bars15m = [], priorState = null }) {
  if (!feature || !feature.daily || feature.daily.closedCount < 15) {
    return {
      state: 'UNKNOWN',
      cues: [],
      evidenceIds: [],
      confidence: 'LOW',
      demandScore: 0,
      supplyRiskScore: 0,
    };
  }

  const d = feature.daily;
  const curBar = d.currentBar;
  const curM = d.currentMetrics;
  const closed = d.closedBars;
  const prevBar = closed[closed.length - 1];
  const prev2Bar = closed[closed.length - 2];
  const prevM = prevBar && prev2Bar ? computeBarMetrics(prevBar, prev2Bar.close) : null;

  const rvolD = d.rvolPartial;
  const atrD = d.atr14Prior || d.atr14 || (feature.currentPrice * 0.025);
  const cues = [];

  // ── 1. Kiểm tra trên khung 15m (nếu có dữ liệu intraday) ──
  const m15 = feature.m15;
  const m15M = m15?.metrics;
  const rvol15 = m15?.rvol15;
  let m15DemandImpulse = false;
  let m15FollowThrough = false;
  let m15SupplyPressure = false;

  if (m15 && m15M && !m15M.flatBar) {
    // Demand impulse 15m: RVOL15 >= 1.5, CLV >= 0.72, body >= 0.48, đóng trên đỉnh 5 nến gần nhất
    if (rvol15 !== null && rvol15 >= 1.5 && m15M.clv >= 0.72 && m15M.bodyRatio >= 0.48 && m15.lastBar.close >= m15.recentHigh5) {
      m15DemandImpulse = true;
      cues.push('DEMAND_IMPULSE_15M');
    }

    // Follow-through 15m: 2 nến gần nhất giữ được trên EMA5_15m & không mất low nến trước
    if (bars15m.length >= 4) {
      const b1 = bars15m[bars15m.length - 2];
      const b2 = bars15m[bars15m.length - 1];
      const m1 = computeBarMetrics(b1, bars15m[bars15m.length - 3].close);
      if (m1 && !m1.flatBar && m1.clv >= 0.65 && b2.low >= b1.low && m15M.clv >= 0.55 && b2.close >= (m15.ema5 || b1.close)) {
        m15FollowThrough = true;
        cues.push('DEMAND_FOLLOW_THROUGH_15M');
      }
    }

    // Supply pressure 15m: RVOL15 >= 1.5, CLV <= 0.25, đóng dưới đáy 5 nến gần nhất hoặc gãy EMA5/MA10
    if (rvol15 !== null && rvol15 >= 1.5 && m15M.clv <= 0.25 && m15M.returnPct < -0.3) {
      m15SupplyPressure = true;
      cues.push('SUPPLY_PRESSURE_15M');
    }
  }

  // ── 2. Kiểm tra trên khung Ngày (1D) ──
  // Cạn cung lành mạnh (Healthy pullback / Supply test trước khi bật)
  const medVol = d.medianVol20 || 0;
  const last2ClosedLowVol = medVol > 0 && closed.slice(-2).every(b => b.volume <= medVol * 0.85);
  if (last2ClosedLowVol && zones?.nearestSupport && feature.currentPrice <= zones.nearestSupport.high * 1.02) {
    cues.push('HEALTHY_PULLBACK_LOW_VOL');
  }

  // Test cung thành công tại hỗ trợ (Test S01)
  if (curM && !curM.flatBar && zones?.nearestSupport) {
    const touchedSupport = curBar.low <= zones.nearestSupport.high * 1.008;
    if (touchedSupport && curM.clv >= 0.65 && (rvolD === null || rvolD <= 1.35 || curM.lowerWickRatio >= 0.35)) {
      cues.push('SUCCESSFUL_SUPPLY_TEST');
    }
  }

  // Spring / Failed breakdown reclaim (giá xuyên hỗ trợ nhưng đóng lại trên hỗ trợ kèm rút chân)
  if (curM && !curM.flatBar && zones?.nearestSupport) {
    const piercedSupport = curBar.low < zones.nearestSupport.low;
    const reclaimedSupport = curBar.close >= zones.nearestSupport.low;
    if (piercedSupport && reclaimedSupport && curM.lowerWickRatio >= 0.40 && curM.clv >= 0.60) {
      cues.push('FAILED_BREAKDOWN_SPRING');
    }
  }

  // Áp lực bán mạnh ngày (Supply pressure D)
  if (curM && !curM.flatBar && curM.clv <= 0.25 && curM.returnPct <= -1.2 && rvolD !== null && rvolD >= 1.3) {
    cues.push('SUPPLY_PRESSURE_D');
  }

  // Weak rebound (hồi với vol thấp, close yếu)
  if (curM && !curM.flatBar && curM.returnPct > 0.2 && curM.returnPct < 1.2 && rvolD !== null && rvolD < 0.70 && curM.clv < 0.45) {
    cues.push('WEAK_REBOUND');
  }

  // Selling Climax Candidate (giảm sâu + biên rộng >= 1.4 ATR + RVOL >= 2.0 + tạo đáy mới/rút chân)
  if (curM && !curM.flatBar && rvolD !== null && rvolD >= 2.0 && curM.range >= atrD * 1.4) {
    const isNear20Low = d.low20D && curBar.low <= d.low20D * 1.01;
    if (isNear20Low && (curM.lowerWickRatio >= 0.35 || curM.returnPct <= -3.0)) {
      cues.push('SELLING_CLIMAX_CANDIDATE');
    }
  }

  // Buying Climax / Supply at Resistance / Failed Breakout (Test S17)
  if (curM && !curM.flatBar && zones?.nearestResistance) {
    const nearOrAboveRes = curBar.high >= zones.nearestResistance.low * 0.995;
    if (nearOrAboveRes && curM.upperWickRatio >= 0.35 && curM.clv <= 0.45 && (rvolD === null || rvolD >= 1.3)) {
      cues.push('SUPPLY_AT_RESISTANCE');
    }
    if (curBar.high > zones.nearestResistance.high && curBar.close < zones.nearestResistance.center && curM.clv <= 0.40) {
      cues.push('FAILED_BREAKOUT');
    }
  }

  // Effort vs Result (Vol cao đột biến >= 1.8x nhưng giá tiến không tương xứng hoặc đóng yếu)
  if (curM && !curM.flatBar && rvolD !== null && rvolD >= 1.8 && Math.abs(curM.returnPct) < 1.0 && curM.clv < 0.50) {
    cues.push('EFFORT_NO_RESULT_STALL');
  }

  // Dry liquidity (RVOL < 0.55 + spread rộng)
  if (rvolD !== null && rvolD < 0.55 && (feature.spreadPct === null || feature.spreadPct > 0.8)) {
    cues.push('DRY_LIQUIDITY');
  }

  // ── 3. Chấm điểm chống double-counting & cập nhật State Machine ──
  const hasStrongSupply = cues.includes('SUPPLY_PRESSURE_D') || cues.includes('FAILED_BREAKOUT') || (m15SupplyPressure && (curM?.clv ?? 0.5) < 0.4);
  const hasSupplyWarn = cues.includes('SUPPLY_AT_RESISTANCE') || cues.includes('EFFORT_NO_RESULT_STALL') || m15SupplyPressure;
  const hasDemandConfirm = (m15DemandImpulse && m15FollowThrough) || (cues.includes('SUCCESSFUL_SUPPLY_TEST') && (curM?.returnPct ?? 0) >= 1.2 && (rvolD ?? 1) >= 1.1);
  const hasDemandCandidate = m15DemandImpulse || cues.includes('SUCCESSFUL_SUPPLY_TEST') || cues.includes('FAILED_BREAKDOWN_SPRING');
  const hasAbsorption = cues.includes('SELLING_CLIMAX_CANDIDATE') || (cues.includes('FAILED_BREAKDOWN_SPRING') && (d.rsi14 ?? 50) <= 38);

  let state = 'BALANCED';
  if (hasStrongSupply) {
    state = hasAbsorption ? 'ABSORPTION_WATCH' : 'SUPPLY_PRESSURE';
  } else if (hasSupplyWarn) {
    state = 'SUPPLY_WARNING';
  } else if (hasDemandConfirm && !hasSupplyWarn) {
    state = 'DEMAND_CONFIRMED';
  } else if (hasDemandCandidate) {
    state = 'DEMAND_CANDIDATE';
  } else if (hasAbsorption) {
    state = 'ABSORPTION_WATCH';
  }

  // Tính điểm demandScore (0-30 điểm cho Decision Engine) có cap chống trùng lặp tín hiệu trên 1 nến
  let rawDemandPts = 0;
  if (m15DemandImpulse) rawDemandPts += 12;
  if (m15FollowThrough) rawDemandPts += 8;
  if (cues.includes('SUCCESSFUL_SUPPLY_TEST')) rawDemandPts += 10;
  if (cues.includes('HEALTHY_PULLBACK_LOW_VOL')) rawDemandPts += 6;
  if (cues.includes('FAILED_BREAKDOWN_SPRING')) rawDemandPts += 10;
  if (prevM && prevM.clv !== null && prevM.clv >= 0.65 && (curM?.clv ?? 0) >= 0.65) rawDemandPts += 4;
  const demandScore = Math.min(30, rawDemandPts);

  let supplyRiskScore = 0;
  if (cues.includes('SUPPLY_PRESSURE_D')) supplyRiskScore += 18;
  if (cues.includes('FAILED_BREAKOUT')) supplyRiskScore += 16;
  if (cues.includes('SUPPLY_AT_RESISTANCE')) supplyRiskScore += 10;
  if (m15SupplyPressure) supplyRiskScore += 10;
  if (cues.includes('EFFORT_NO_RESULT_STALL')) supplyRiskScore += 8;

  return {
    state,
    priorState: priorState?.state || null,
    cues,
    evidenceIds: cues.map((c, idx) => `sd_${feature.symbol}_${idx}_${c}`),
    demandScore,
    supplyRiskScore: Math.min(30, supplyRiskScore),
    rvolD,
    rvol15,
    clvD: curM?.clv !== null && curM?.clv !== undefined ? parseFloat(curM.clv.toFixed(2)) : null,
    clv15: m15M?.clv !== null && m15M?.clv !== undefined ? parseFloat(m15M.clv.toFixed(2)) : null,
    confidence: m15 ? 'HIGH' : 'MEDIUM',
  };
}

module.exports = { analyzeSupplyDemand };
