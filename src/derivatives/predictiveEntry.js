/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🎯 VN30F v8.0 — Predictive Entry Engine                     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  VÀO LỆNH ĐÓN ĐẦU — TRƯỚC KHI VOL NỔ, KHÔNG PHẢI SAU ĐÓ    ║
 * ║                                                               ║
 * ║  4 Signals:                                                   ║
 * ║  1. Spring Detection (Bullish) — Quét đáy + Absorption        ║
 * ║  2. Upthrust Detection (Bearish) — Quét đỉnh + Absorption    ║
 * ║  3. Quiet Accumulation — Vol cạn + Delta shift                ║
 * ║  4. Exhaustion Detection — Diminishing vol + Reversal candle  ║
 * ║                                                               ║
 * ║  Anti-Climax Chasing: CẤM vào khi vol > 2.5x MA20            ║
 * ║  Key Liquidity Pool Filter: Chỉ PP4 tại PDH/PDL/Fibo/Session ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const flowEngine = require('./flowEngine');

// ─── SIGNAL THRESHOLDS ───────────────────────────────────────
const PREDICTIVE_THRESHOLDS = {
  // Spring/Upthrust
  springWickMin: 1.2,            // Râu dưới tối thiểu 1.2đ cho Spring
  upthrustWickMin: 1.2,          // Râu trên tối thiểu 1.2đ cho Upthrust
  sweepTolerance: 2.0,           // Giá quét qua key level tối đa 2.0đ
  confirmationCandles: 1,        // Số nến xác nhận sau signal (1 = nến kế)
  
  // Quiet Accumulation
  quietVolRatioMax: 0.70,        // Vol < 70% MA20 = "yên lặng"
  quietMinCandles: 5,            // Ít nhất 5 nến yên lặng liên tiếp
  deltaShiftThreshold: 500,      // Delta shift > 500 = tín hiệu accumulation
  
  // Exhaustion
  exhaustionConsecutive: 3,      // 3+ nến cùng màu liên tiếp
  exhaustionVolDecline: 0.75,    // Vol mỗi nến giảm ≥ 25% so với nến trước
  
  // Anti-Climax Chasing
  antiClimaxVolRatio: 2.5,       // Vol > 2.5x MA20 = CẤM vào mới
  
  // Key Liquidity Pool proximity
  keyLevelProximity: 2.5,        // Giá phải nằm trong 2.5đ của key level
  
  // SL/TP
  defaultSLPoints: 1.2,          // SL mặc định 1.2đ
  maxSLPoints: 1.8,              // SL tối đa 1.8đ (cam kết PLAN)
  tpMinRatio: 2.0,               // R:R tối thiểu 1:2
};

/**
 * CORE: Phân tích và sinh tín hiệu Predictive Entry
 * 
 * @param {Object} params
 * @param {Object} params.candle - Nến 1m mới nhất đã đóng
 * @param {Array} params.allCandles - Tất cả nến 1m đã đóng hôm nay
 * @param {Object} params.flowData - Output từ flowEngine (delta, cvd, absorption)
 * @param {Object} params.marketStructureData - Price map (VWAP, POC, key levels, swing points)
 * @param {Object} params.dominanceResult - Output từ dominanceClassifier
 * @param {number} params.volMA20 - Volume MA20 hiện tại
 * @returns {Object|null} Predictive signal hoặc null nếu không có
 */
function analyzePredictiveEntry({
  candle,
  allCandles,
  flowData,
  marketStructureData,
  dominanceResult,
  volMA20,
}) {
  if (!candle || !allCandles || allCandles.length < 10) return null;
  
  const safeVolMA20 = volMA20 || 2000;
  const volRatio = candle.volume / safeVolMA20;
  
  // ═══════════════════════════════════════════════════════════
  // ANTI-CLIMAX CHASING FILTER — Hard block
  // ═══════════════════════════════════════════════════════════
  if (volRatio > PREDICTIVE_THRESHOLDS.antiClimaxVolRatio) {
    return {
      signal: null,
      antiClimaxBlock: true,
      reason: `🚫 ANTI-CLIMAX: Vol ${candle.volume.toLocaleString()} HĐ = ${(volRatio * 100).toFixed(0)}% MA20 (>${(PREDICTIVE_THRESHOLDS.antiClimaxVolRatio * 100)}%). CẤM vào mới — Smart Money đã ăn xong.`,
    };
  }

  // Collect key levels
  const keyLevels = _extractKeyLevels(marketStructureData);
  
  // Run all 4 signal detectors
  const signals = [];
  
  const spring = _detectSpring(candle, allCandles, flowData, keyLevels, safeVolMA20);
  if (spring) signals.push(spring);
  
  const upthrust = _detectUpthrust(candle, allCandles, flowData, keyLevels, safeVolMA20);
  if (upthrust) signals.push(upthrust);
  
  const quietAccum = _detectQuietAccumulation(candle, allCandles, flowData, keyLevels, safeVolMA20);
  if (quietAccum) signals.push(quietAccum);
  
  const exhaustion = _detectExhaustion(candle, allCandles, flowData, safeVolMA20);
  if (exhaustion) signals.push(exhaustion);
  
  if (signals.length === 0) return null;
  
  // Pick highest confidence signal
  signals.sort((a, b) => b.confidence - a.confidence);
  const bestSignal = signals[0];
  
  // Dominance direction check
  if (dominanceResult) {
    const dirCheck = _checkDominanceAlignment(bestSignal.direction, dominanceResult);
    if (!dirCheck.allowed) {
      return {
        signal: null,
        dominanceBlock: true,
        reason: dirCheck.reason,
        rejectedSignal: bestSignal,
      };
    }
    // Bonus confidence if aligned with dominance
    if (dirCheck.aligned) {
      bestSignal.confidence = Math.min(95, bestSignal.confidence + 10);
      bestSignal.alignmentBonus = true;
    }
  }

  return {
    signal: bestSignal,
    antiClimaxBlock: false,
    dominanceBlock: false,
    allSignals: signals,
  };
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL 1: SPRING DETECTION (Bullish Reversal at Support)
// Giá quét dưới PDL/Session Low → Sell Absorption → Pin bar
// ═══════════════════════════════════════════════════════════════
function _detectSpring(candle, allCandles, flowData, keyLevels, volMA20) {
  // Chỉ xét nến có râu dưới dài (pin bar bullish)
  if (candle.lowerWick < PREDICTIVE_THRESHOLDS.springWickMin) return null;
  
  // Nến phải đóng ở nửa trên body (buying pressure)
  const totalRange = candle.high - candle.low;
  if (totalRange < 1.0) return null;
  const closePosition = (candle.close - candle.low) / totalRange;
  if (closePosition < 0.4) return null; // Close phải nằm trên 40% range
  
  // Check proximity to key support levels
  const nearbySupport = keyLevels.filter(l => 
    (l.type === 'SUPPORT' || l.type === 'PDL' || l.type === 'SESSION_LOW' || l.type === 'VAL' || l.type === 'FIBO_SUPPORT') &&
    l.price && Math.abs(candle.low - l.price) <= PREDICTIVE_THRESHOLDS.keyLevelProximity
  );
  
  if (nearbySupport.length === 0) return null; // Không gần key level = skip (PP4 filter)
  
  // Check Sell Absorption (optional boost)
  let absorptionBoost = 0;
  if (flowData?.absorption?.detected === 'SELL_ABSORPTION') {
    absorptionBoost = 15;
  }
  
  // Check Delta: should be recovering (delta positive or turning positive)
  let deltaBoost = 0;
  if (flowData?.delta?.trend === 'POSITIVE') {
    deltaBoost = 10;
  }
  
  // Check 3-5 nến trước phải có nhịp giảm (selling pressure preceding the spring)
  const preceding = allCandles.slice(-6, -1);
  const redCandles = preceding.filter(c => !c.isGreen).length;
  if (redCandles < 2) return null; // Cần ít nhất 2 nến đỏ trước đó
  
  // SL ngay dưới râu, nhưng nếu râu dài thì kẹp chặt SL tối đa 1.8đ (Kỷ luật thép Plan v4.0)
  let rawSlDistance = candle.close - (candle.low - 0.3);
  let slDistance = Math.min(PREDICTIVE_THRESHOLDS.maxSLPoints, Math.max(1.0, parseFloat(rawSlDistance.toFixed(1))));
  const sl = parseFloat((candle.close - slDistance).toFixed(1));
  
  const tp1 = parseFloat((candle.close + slDistance * PREDICTIVE_THRESHOLDS.tpMinRatio).toFixed(1));
  const tp2 = parseFloat((candle.close + slDistance * 3.5).toFixed(1));
  
  const baseConfidence = 55;
  const wickBonus = Math.min(15, (candle.lowerWick - PREDICTIVE_THRESHOLDS.springWickMin) * 10);
  const levelBonus = nearbySupport.length * 5;
  
  return {
    type: 'SPRING',
    direction: 'LONG',
    confidence: Math.min(90, baseConfidence + wickBonus + levelBonus + absorptionBoost + deltaBoost),
    entryPrice: candle.close,
    sl,
    tp1,
    tp2,
    slDistance: parseFloat(slDistance.toFixed(1)),
    keyLevel: nearbySupport[0],
    description: `🔨 SPRING: Quét đáy ${candle.low.toFixed(1)} (râu ${candle.lowerWick.toFixed(1)}đ) gần ${nearbySupport[0].label || nearbySupport[0].type} ${nearbySupport[0].price.toFixed(1)}${absorptionBoost ? ' + Sell Absorption' : ''}`,
    reason: `Rút râu dưới ${candle.lowerWick.toFixed(1)}đ tại vùng hỗ trợ cực trị → Phe mua hấp thụ cung`,
    riskReward: parseFloat((tp1 - candle.close) / slDistance).toFixed(1) + ':1',
  };
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL 2: UPTHRUST DETECTION (Bearish Reversal at Resistance)
// Giá quét trên PDH/Session High → Buy Absorption → Shooting star
// ═══════════════════════════════════════════════════════════════
function _detectUpthrust(candle, allCandles, flowData, keyLevels, volMA20) {
  // Nến phải có râu trên dài (shooting star bearish)
  if (candle.upperWick < PREDICTIVE_THRESHOLDS.upthrustWickMin) return null;
  
  // Nến phải đóng ở nửa dưới body (selling pressure)
  const totalRange = candle.high - candle.low;
  if (totalRange < 1.0) return null;
  const closePosition = (candle.close - candle.low) / totalRange;
  if (closePosition > 0.6) return null; // Close phải nằm dưới 60% range
  
  // Check proximity to key resistance levels
  const nearbyResistance = keyLevels.filter(l =>
    (l.type === 'RESISTANCE' || l.type === 'PDH' || l.type === 'SESSION_HIGH' || l.type === 'VAH' || l.type === 'FIBO_RESISTANCE') &&
    l.price && Math.abs(candle.high - l.price) <= PREDICTIVE_THRESHOLDS.keyLevelProximity
  );
  
  if (nearbyResistance.length === 0) return null;
  
  // Check Buy Absorption
  let absorptionBoost = 0;
  if (flowData?.absorption?.detected === 'BUY_ABSORPTION') {
    absorptionBoost = 15;
  }
  
  // Check Delta: should be deteriorating
  let deltaBoost = 0;
  if (flowData?.delta?.trend === 'NEGATIVE') {
    deltaBoost = 10;
  }
  
  // Check 3-5 nến trước phải có nhịp tăng
  const preceding = allCandles.slice(-6, -1);
  const greenCandles = preceding.filter(c => c.isGreen).length;
  if (greenCandles < 2) return null;
  
  // SL ngay trên râu, nhưng nếu râu dài thì kẹp chặt SL tối đa 1.8đ (Kỷ luật thép Plan v4.0)
  let rawSlDistance = (candle.high + 0.3) - candle.close;
  let slDistance = Math.min(PREDICTIVE_THRESHOLDS.maxSLPoints, Math.max(1.0, parseFloat(rawSlDistance.toFixed(1))));
  const sl = parseFloat((candle.close + slDistance).toFixed(1));
  
  const tp1 = parseFloat((candle.close - slDistance * PREDICTIVE_THRESHOLDS.tpMinRatio).toFixed(1));
  const tp2 = parseFloat((candle.close - slDistance * 3.5).toFixed(1));
  
  const baseConfidence = 55;
  const wickBonus = Math.min(15, (candle.upperWick - PREDICTIVE_THRESHOLDS.upthrustWickMin) * 10);
  const levelBonus = nearbyResistance.length * 5;
  
  return {
    type: 'UPTHRUST',
    direction: 'SHORT',
    confidence: Math.min(90, baseConfidence + wickBonus + levelBonus + absorptionBoost + deltaBoost),
    entryPrice: candle.close,
    sl,
    tp1,
    tp2,
    slDistance: parseFloat(slDistance.toFixed(1)),
    keyLevel: nearbyResistance[0],
    description: `🌠 UPTHRUST: Quét đỉnh ${candle.high.toFixed(1)} (râu ${candle.upperWick.toFixed(1)}đ) gần ${nearbyResistance[0].label || nearbyResistance[0].type} ${nearbyResistance[0].price.toFixed(1)}${absorptionBoost ? ' + Buy Absorption' : ''}`,
    reason: `Rút râu trên ${candle.upperWick.toFixed(1)}đ tại vùng kháng cự cực trị → Phe bán chặn cầu`,
    riskReward: parseFloat((candle.close - tp1) / slDistance).toFixed(1) + ':1',
  };
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL 3: QUIET ACCUMULATION (Stealth positioning before breakout)
// Vol < 70% MA20 cho 5+ nến → Sudden delta shift → Anticipatory entry
// ═══════════════════════════════════════════════════════════════
function _detectQuietAccumulation(candle, allCandles, flowData, keyLevels, volMA20) {
  if (allCandles.length < PREDICTIVE_THRESHOLDS.quietMinCandles + 2) return null;
  
  // Count quiet candles
  const recentCandles = allCandles.slice(-(PREDICTIVE_THRESHOLDS.quietMinCandles + 1), -1);
  const quietCandles = recentCandles.filter(c => c.volume < volMA20 * PREDICTIVE_THRESHOLDS.quietVolRatioMax);
  
  if (quietCandles.length < PREDICTIVE_THRESHOLDS.quietMinCandles) return null;
  
  // Check delta shift on current candle
  if (!flowData?.delta) return null;
  const deltaShift = flowData.delta.current;
  
  if (Math.abs(deltaShift) < PREDICTIVE_THRESHOLDS.deltaShiftThreshold) return null;
  
  // Direction from delta shift
  const direction = deltaShift > 0 ? 'LONG' : 'SHORT';
  
  // Check if near key level for support
  const relevantLevels = keyLevels.filter(l => {
    if (direction === 'LONG') {
      return (l.type === 'SUPPORT' || l.type === 'VAL' || l.type === 'PDL' || l.type === 'FIBO_SUPPORT') &&
             l.price && candle.close - l.price >= 0 && candle.close - l.price <= 5;
    } else {
      return (l.type === 'RESISTANCE' || l.type === 'VAH' || l.type === 'PDH' || l.type === 'FIBO_RESISTANCE') &&
             l.price && l.price - candle.close >= 0 && l.price - candle.close <= 5;
    }
  });
  
  // SL below/above quiet range
  const quietLows = recentCandles.map(c => c.low);
  const quietHighs = recentCandles.map(c => c.high);
  
  let sl, slDistance;
  if (direction === 'LONG') {
    sl = parseFloat((Math.min(...quietLows) - 0.3).toFixed(1));
    slDistance = candle.close - sl;
  } else {
    sl = parseFloat((Math.max(...quietHighs) + 0.3).toFixed(1));
    slDistance = sl - candle.close;
  }
  
  if (slDistance > PREDICTIVE_THRESHOLDS.maxSLPoints || slDistance < 0.5) return null;
  
  const tp1 = direction === 'LONG'
    ? parseFloat((candle.close + slDistance * 2).toFixed(1))
    : parseFloat((candle.close - slDistance * 2).toFixed(1));
  
  return {
    type: 'QUIET_ACCUMULATION',
    direction,
    confidence: Math.min(75, 45 + (quietCandles.length - PREDICTIVE_THRESHOLDS.quietMinCandles) * 5 + (relevantLevels.length > 0 ? 10 : 0)),
    entryPrice: candle.close,
    sl,
    tp1,
    tp2: null,
    slDistance: parseFloat(slDistance.toFixed(1)),
    keyLevel: relevantLevels[0] || null,
    description: `🤫 QUIET ACCUMULATION: ${quietCandles.length} nến yên lặng (Vol <70% MA20) → Delta shift ${deltaShift > 0 ? '+' : ''}${deltaShift} → ${direction}`,
    reason: `Vol cạn ${quietCandles.length} nến liên tiếp gần hỗ trợ → Smart Money đang gom/xả lặng lẽ`,
    riskReward: '2.0:1',
  };
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL 4: EXHAUSTION DETECTION (Trend weakening)
// 3+ nến cùng màu với vol giảm dần → Reversal candle → Counter-entry
// ═══════════════════════════════════════════════════════════════
function _detectExhaustion(candle, allCandles, flowData, volMA20) {
  if (allCandles.length < PREDICTIVE_THRESHOLDS.exhaustionConsecutive + 2) return null;
  
  // Find consecutive same-color candles preceding current
  const precedingCandles = allCandles.slice(-(PREDICTIVE_THRESHOLDS.exhaustionConsecutive + 1), -1);
  
  // Check green consecutive (bullish exhaustion → potential SHORT)
  const allGreen = precedingCandles.every(c => c.isGreen);
  const allRed = precedingCandles.every(c => !c.isGreen);
  
  if (!allGreen && !allRed) return null;
  
  // Check diminishing volume
  let volDeclining = true;
  for (let i = 1; i < precedingCandles.length; i++) {
    if (precedingCandles[i].volume > precedingCandles[i - 1].volume * (1 / PREDICTIVE_THRESHOLDS.exhaustionVolDecline)) {
      volDeclining = false;
      break;
    }
  }
  
  if (!volDeclining) return null;
  
  // Current candle must be a REVERSAL candle (opposite color)
  if (allGreen && candle.isGreen) return null;  // No reversal yet
  if (allRed && !candle.isGreen) return null;    // No reversal yet
  
  // Current candle body must be meaningful
  if (candle.body < 0.5) return null;
  
  const direction = allGreen ? 'SHORT' : 'LONG'; // Reverse the exhausted trend
  
  // SL behind the extreme of the exhaustion move
  let sl, slDistance;
  if (direction === 'SHORT') {
    // Exhausted bull → SL above highest high
    const exhaustionHigh = Math.max(...precedingCandles.map(c => c.high), candle.high);
    sl = parseFloat((exhaustionHigh + 0.3).toFixed(1));
    slDistance = sl - candle.close;
  } else {
    // Exhausted bear → SL below lowest low
    const exhaustionLow = Math.min(...precedingCandles.map(c => c.low), candle.low);
    sl = parseFloat((exhaustionLow - 0.3).toFixed(1));
    slDistance = candle.close - sl;
  }
  
  if (slDistance > PREDICTIVE_THRESHOLDS.maxSLPoints || slDistance < 0.3) return null;
  
  const tp1 = direction === 'LONG'
    ? parseFloat((candle.close + slDistance * 2).toFixed(1))
    : parseFloat((candle.close - slDistance * 2).toFixed(1));
  
  // CVD divergence bonus
  let divergenceBonus = 0;
  if (flowData?.cvd?.divergence) {
    if ((direction === 'LONG' && flowData.cvd.divergence === 'BULLISH_DIVERGENCE') ||
        (direction === 'SHORT' && flowData.cvd.divergence === 'BEARISH_DIVERGENCE')) {
      divergenceBonus = 15;
    }
  }
  
  return {
    type: 'EXHAUSTION',
    direction,
    confidence: Math.min(80, 45 + (precedingCandles.length - PREDICTIVE_THRESHOLDS.exhaustionConsecutive) * 5 + divergenceBonus),
    entryPrice: candle.close,
    sl,
    tp1,
    tp2: null,
    slDistance: parseFloat(slDistance.toFixed(1)),
    keyLevel: null,
    description: `💨 EXHAUSTION: ${precedingCandles.length} nến ${allGreen ? 'XANH' : 'ĐỎ'} liên tiếp vol giảm dần → Nến đảo chiều ${direction}${divergenceBonus ? ' + CVD Divergence' : ''}`,
    reason: `Xu hướng kiệt sức: Vol giảm ${precedingCandles.length} nến liên tiếp → Nến lật chiều xác nhận`,
    riskReward: '2.0:1',
  };
}

// ─── HELPER: Extract all key levels ──────────────────────────
function _extractKeyLevels(marketStructureData) {
  if (!marketStructureData) return [];
  
  const levels = [];
  
  // From marketStructure.levels array
  if (marketStructureData.levels && Array.isArray(marketStructureData.levels)) {
    for (const l of marketStructureData.levels) {
      if (l.price) {
        levels.push({
          price: l.price,
          type: l.type,
          label: l.label || l.source || l.type,
          source: l.source || 'marketStructure',
        });
      }
    }
  }
  
  // VWAP
  if (marketStructureData.vwap) {
    levels.push({ price: marketStructureData.vwap, type: 'VWAP', label: 'VWAP', source: 'vwap' });
  }
  
  // Volume Profile
  if (marketStructureData.volumeProfile) {
    const vp = marketStructureData.volumeProfile;
    if (vp.poc) levels.push({ price: vp.poc, type: 'POC', label: 'POC', source: 'volumeProfile' });
    if (vp.vah) levels.push({ price: vp.vah, type: 'VAH', label: 'VAH', source: 'volumeProfile' });
    if (vp.val) levels.push({ price: vp.val, type: 'VAL', label: 'VAL', source: 'volumeProfile' });
  }
  
  // Swing Points
  if (marketStructureData.swings) {
    if (marketStructureData.swings.swingHighs) {
      for (const sh of marketStructureData.swings.swingHighs.slice(-3)) {
        levels.push({ price: sh.price, type: 'RESISTANCE', label: `SwingHigh ${sh.price.toFixed(1)}`, source: 'swing' });
      }
    }
    if (marketStructureData.swings.swingLows) {
      for (const sl of marketStructureData.swings.swingLows.slice(-3)) {
        levels.push({ price: sl.price, type: 'SUPPORT', label: `SwingLow ${sl.price.toFixed(1)}`, source: 'swing' });
      }
    }
  }
  
  // Session High/Low from candles
  if (marketStructureData.sessionHigh) {
    levels.push({ price: marketStructureData.sessionHigh, type: 'SESSION_HIGH', label: 'Session High', source: 'session' });
  }
  if (marketStructureData.sessionLow) {
    levels.push({ price: marketStructureData.sessionLow, type: 'SESSION_LOW', label: 'Session Low', source: 'session' });
  }
  if (marketStructureData.todayRange) {
    if (marketStructureData.todayRange.high) {
      levels.push({ price: marketStructureData.todayRange.high, type: 'RESISTANCE', label: 'Đỉnh hôm nay', source: 'todayRange' });
    }
    if (marketStructureData.todayRange.low) {
      levels.push({ price: marketStructureData.todayRange.low, type: 'SUPPORT', label: 'Đáy hôm nay', source: 'todayRange' });
    }
  }
  
  return levels;
}

// ─── HELPER: Check dominance alignment ───────────────────────
function _checkDominanceAlignment(proposedDirection, dominanceResult) {
  if (!dominanceResult || !dominanceResult.lockDirection) {
    return { allowed: true, aligned: false };
  }
  
  const lock = dominanceResult.lockDirection;
  
  if (lock === 'NONE') {
    return { allowed: false, aligned: false, reason: '🚫 CHOPPY — Thị trường nhiễu, CẤM MỌI LỆNH.' };
  }
  
  if (lock === 'LONG_ONLY' && proposedDirection === 'SHORT') {
    return { allowed: false, aligned: false, reason: `🚫 TREND DAY BULL — CẤM SHORT (${dominanceResult.label})` };
  }
  
  if (lock === 'SHORT_ONLY' && proposedDirection === 'LONG') {
    return { allowed: false, aligned: false, reason: `🚫 TREND DAY BEAR — CẤM LONG (${dominanceResult.label})` };
  }
  
  // Check alignment bonus
  const aligned = (
    (proposedDirection === 'LONG' && dominanceResult.dominantSide === 'BULL') ||
    (proposedDirection === 'SHORT' && dominanceResult.dominantSide === 'BEAR')
  );
  
  return { allowed: true, aligned };
}

/**
 * Quick utility: Is this candle's vol in climax territory?
 */
function isClimaxVolume(candleVol, volMA20) {
  return candleVol > (volMA20 || 2000) * PREDICTIVE_THRESHOLDS.antiClimaxVolRatio;
}

module.exports = {
  analyzePredictiveEntry,
  isClimaxVolume,
  PREDICTIVE_THRESHOLDS,
};
