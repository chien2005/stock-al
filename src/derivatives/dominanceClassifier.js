/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🏛️ VN30F v8.0 — Dominance Classifier Engine                ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Phân loại ngày: STRONG_BULL / STRONG_BEAR / MILD_BULL /      ║
 * ║  MILD_BEAR / SIDEWAY / CHOPPY                                 ║
 * ║                                                               ║
 * ║  Input: Flow data, 7 Pillars, Price vs VWAP/PDH/PDL,         ║
 * ║         CVD slope, OI data (foreign net flow)                 ║
 * ║                                                               ║
 * ║  Output: { dayType, dominantSide, lockDirection, confidence } ║
 * ║  CRITICAL: If STRONG_BULL → lock out ALL shorts               ║
 * ║            If STRONG_BEAR → lock out ALL longs                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');

// ─── DOMINANCE THRESHOLDS ────────────────────────────────────
const THRESHOLDS = {
  // Foreign net flow thresholds (HĐ)
  foreignNetStrong: 1000,    // ≥ +1000 HĐ foreign net buy = strong bull signal
  foreignNetMild: 300,       // ≥ +300 HĐ = mild bull signal
  
  // CVD slope (cumulative delta) — difference over last 20 candles
  cvdSlopeStrong: 3000,      // CVD tăng > 3000 trong 20 nến = strong trend
  cvdSlopeMild: 1000,        // CVD tăng > 1000 = mild trend
  
  // Price position relative to key levels
  vwapDistanceStrong: 4.0,   // > 4đ trên VWAP = strong bull positioning
  vwapDistanceMild: 1.5,     // > 1.5đ trên VWAP = mild bull  
  
  // Pillar alignment
  pillarStrongConsensus: 5,  // ≥ 5/7 trụ cùng chiều = strong
  pillarMildConsensus: 4,    // ≥ 4/7 trụ cùng chiều = mild
  
  // Aggression ratio (buyVol / sellVol)
  aggressionStrong: 1.5,     // Buy/Sell > 1.5 = strong buyer dominance
  aggressionMild: 1.2,       // Buy/Sell > 1.2 = mild buyer dominance
  
  // Min candles to classify (avoid premature classification)
  minCandlesForClassification: 15,  // ≥ 15 nến 1m (15 phút trading)
  
  // Reclassification cooldown (ms) — don't flip classification too fast
  reclassifyCooldownMs: 10 * 60 * 1000,  // 10 phút
};

// ─── DAY TYPE DEFINITIONS ────────────────────────────────────
const DAY_TYPES = {
  STRONG_BULL: {
    label: '🟢 XU HƯỚNG TĂNG MẠNH (Trend Day Bull)',
    lockDirection: 'LONG_ONLY',
    description: 'Khối ngoại mua ròng mạnh, CVD tăng liên tục, 7 trụ đồng thuận xanh. CẤM SHORT.',
  },
  STRONG_BEAR: {
    label: '🔴 XU HƯỚNG GIẢM MẠNH (Trend Day Bear)',
    lockDirection: 'SHORT_ONLY',
    description: 'Khối ngoại bán ròng mạnh, CVD giảm liên tục, 7 trụ đồng thuận đỏ. CẤM LONG.',
  },
  MILD_BULL: {
    label: '🟡 XU HƯỚNG TĂNG NHẸ (Mild Bull)',
    lockDirection: 'BOTH',
    description: 'Nghiêng phe mua nhưng chưa mạnh rõ rệt. Ưu tiên LONG, cẩn thận SHORT.',
  },
  MILD_BEAR: {
    label: '🟠 XU HƯỚNG GIẢM NHẸ (Mild Bear)',
    lockDirection: 'BOTH',
    description: 'Nghiêng phe bán nhưng chưa mạnh rõ rệt. Ưu tiên SHORT, cẩn thận LONG.',
  },
  SIDEWAY: {
    label: '⚪ ĐI NGANG (Sideway / Range)',
    lockDirection: 'BOTH',
    description: 'Giá dao động quanh VWAP/POC, cung cầu cân bằng. Chỉ đánh biên, KHÔNG breakout.',
  },
  CHOPPY: {
    label: '⚫ CHOP / KHÔNG RÕ RÀNG',
    lockDirection: 'NONE',
    description: 'Thị trường nhiễu, cung cầu xen kẽ, tín hiệu mâu thuẫn. CẤM VÀO LỆNH.',
  },
};

// ─── INTERNAL STATE ──────────────────────────────────────────
let _classificationState = {
  currentDayType: 'SIDEWAY',
  lastClassifiedAt: 0,
  confidence: 0,
  scoreBreakdown: null,
  lockDirection: 'BOTH',
  dominantSide: 'NEUTRAL',
  history: [],  // Array of { timestamp, dayType, confidence }
};

/**
 * CORE: Phân loại Dominance của phiên giao dịch hiện tại
 * 
 * @param {Object} params
 * @param {Object} params.flowData - Output từ flowEngine.analyzeFlow()
 * @param {Object} params.pillarAnalysis - Output từ pillarMonitor.analyzePillars()
 * @param {Object} params.oiData - OI data với foreignBuy, foreignSell, foreignNet
 * @param {Object} params.marketStructureData - Output từ marketStructure.buildPriceMap()
 * @param {number} params.currentPrice - Giá VN30F1M hiện tại
 * @param {Array} params.allCandles - Tất cả nến 1m đã đóng hôm nay
 * @returns {Object} { dayType, label, lockDirection, dominantSide, confidence, scores, description }
 */
function classifyDominance({
  flowData,
  pillarAnalysis,
  oiData,
  marketStructureData,
  currentPrice,
  allCandles,
}) {
  const now = Date.now();
  
  // Guard: Chưa đủ data → giữ nguyên classification trước đó
  if (!allCandles || allCandles.length < THRESHOLDS.minCandlesForClassification) {
    return _buildResult('SIDEWAY', 30, {
      reason: `Chưa đủ ${THRESHOLDS.minCandlesForClassification} nến để phân loại (hiện có ${allCandles?.length || 0})`,
    });
  }
  
  // Cooldown check: Không phân loại lại quá nhanh
  if (now - _classificationState.lastClassifiedAt < THRESHOLDS.reclassifyCooldownMs) {
    return _buildResult(
      _classificationState.currentDayType,
      _classificationState.confidence,
      _classificationState.scoreBreakdown
    );
  }

  // ═══════════════════════════════════════════════════════════
  // TÍNH ĐIỂM 5 CHIỀU (mỗi chiều -100 đến +100)
  // Dương = Bull, Âm = Bear
  // ═══════════════════════════════════════════════════════════
  
  const scores = {
    foreignFlow: _scoreForeignFlow(oiData),
    cvdSlope: _scoreCVDSlope(flowData),
    pricePosition: _scorePricePosition(currentPrice, marketStructureData),
    pillarAlignment: _scorePillarAlignment(pillarAnalysis),
    aggressionRatio: _scoreAggressionRatio(flowData),
  };

  // Trọng số cho mỗi chiều
  const weights = {
    foreignFlow: 0.20,     // 20% — Khối ngoại & tự doanh
    cvdSlope: 0.25,        // 25% — CVD slope = DNA dòng lệnh
    pricePosition: 0.20,   // 20% — Vị trí giá vs VWAP/PDH/PDL
    pillarAlignment: 0.20, // 20% — 7 trụ điều tiết
    aggressionRatio: 0.15, // 15% — Tỷ lệ Buy/Sell aggression
  };

  // Tổng điểm trọng số (-100 đến +100)
  let compositeScore = 0;
  for (const key in scores) {
    compositeScore += scores[key].score * (weights[key] || 0);
  }
  compositeScore = Math.round(compositeScore);

  // ═══════════════════════════════════════════════════════════
  // PHÂN LOẠI DỰA TRÊN COMPOSITE SCORE
  // ═══════════════════════════════════════════════════════════
  
  let dayType;
  let confidence;

  // Consistency check: Có bao nhiêu chiều đồng thuận?
  const bullDimensions = Object.values(scores).filter(s => s.score > 20).length;
  const bearDimensions = Object.values(scores).filter(s => s.score < -20).length;
  const isConsistent = bullDimensions >= 4 || bearDimensions >= 4;

  if (compositeScore >= 60 && isConsistent) {
    dayType = 'STRONG_BULL';
    confidence = Math.min(95, 60 + compositeScore * 0.35);
  } else if (compositeScore <= -60 && isConsistent) {
    dayType = 'STRONG_BEAR';
    confidence = Math.min(95, 60 + Math.abs(compositeScore) * 0.35);
  } else if (compositeScore >= 25) {
    dayType = 'MILD_BULL';
    confidence = Math.min(80, 40 + compositeScore * 0.5);
  } else if (compositeScore <= -25) {
    dayType = 'MILD_BEAR';
    confidence = Math.min(80, 40 + Math.abs(compositeScore) * 0.5);
  } else if (Math.abs(compositeScore) <= 10 && bullDimensions <= 2 && bearDimensions <= 2) {
    dayType = 'SIDEWAY';
    confidence = 50;
  } else {
    dayType = 'CHOPPY';
    confidence = 35;
  }

  // ═══════════════════════════════════════════════════════════
  // UPGRADE/DOWNGRADE logic: Trend Day Lock override
  // Nếu giá vượt PDH kèm CVD + foreign mạnh → ép STRONG_BULL
  // ═══════════════════════════════════════════════════════════
  
  const priceAbovePDH = scores.pricePosition.detail?.abovePDH;
  const priceBelowPDL = scores.pricePosition.detail?.belowPDL;
  
  if (priceAbovePDH && scores.foreignFlow.score > 40 && scores.cvdSlope.score > 40) {
    if (dayType !== 'STRONG_BULL') {
      dayType = 'STRONG_BULL';
      confidence = Math.max(confidence, 75);
      scores._override = 'UPGRADE → STRONG_BULL: Giá vượt PDH + Foreign mua ròng + CVD tăng';
    }
  }
  
  if (priceBelowPDL && scores.foreignFlow.score < -40 && scores.cvdSlope.score < -40) {
    if (dayType !== 'STRONG_BEAR') {
      dayType = 'STRONG_BEAR';
      confidence = Math.max(confidence, 75);
      scores._override = 'UPGRADE → STRONG_BEAR: Giá thủng PDL + Foreign bán ròng + CVD giảm';
    }
  }

  // Update state
  const result = _buildResult(dayType, confidence, scores);
  _classificationState = {
    currentDayType: dayType,
    lastClassifiedAt: now,
    confidence,
    scoreBreakdown: scores,
    lockDirection: result.lockDirection,
    dominantSide: result.dominantSide,
    history: [
      ..._classificationState.history.slice(-20),
      { timestamp: now, dayType, confidence, compositeScore },
    ],
  };

  return result;
}

// ═══════════════════════════════════════════════════════════════
// SCORING FUNCTIONS — Mỗi hàm trả về { score: -100..+100, detail }
// ═══════════════════════════════════════════════════════════════

function _scoreForeignFlow(oiData) {
  if (!oiData || oiData.foreignNet === undefined || oiData.foreignNet === null) {
    return { score: 0, detail: { raw: null, label: 'N/A' } };
  }

  const net = oiData.foreignNet;
  let score = 0;

  if (net >= THRESHOLDS.foreignNetStrong) {
    score = Math.min(100, 50 + (net / THRESHOLDS.foreignNetStrong) * 50);
  } else if (net >= THRESHOLDS.foreignNetMild) {
    score = 20 + ((net - THRESHOLDS.foreignNetMild) / (THRESHOLDS.foreignNetStrong - THRESHOLDS.foreignNetMild)) * 30;
  } else if (net <= -THRESHOLDS.foreignNetStrong) {
    score = Math.max(-100, -50 + (net / THRESHOLDS.foreignNetStrong) * 50);
  } else if (net <= -THRESHOLDS.foreignNetMild) {
    score = -20 + ((net + THRESHOLDS.foreignNetMild) / (THRESHOLDS.foreignNetStrong - THRESHOLDS.foreignNetMild)) * 30;
  } else {
    score = (net / THRESHOLDS.foreignNetMild) * 20;
  }

  return {
    score: Math.round(score),
    detail: {
      raw: net,
      label: net >= THRESHOLDS.foreignNetStrong ? 'STRONG BUY'
        : net >= THRESHOLDS.foreignNetMild ? 'MILD BUY'
        : net <= -THRESHOLDS.foreignNetStrong ? 'STRONG SELL'
        : net <= -THRESHOLDS.foreignNetMild ? 'MILD SELL'
        : 'NEUTRAL',
    },
  };
}

function _scoreCVDSlope(flowData) {
  if (!flowData || !flowData.delta) {
    return { score: 0, detail: { cvd: 0, direction: 'N/A' } };
  }

  const cvdValue = flowData.cvd?.value || 0;
  const cvdDirection = flowData.cvd?.direction || 'FLAT';
  const recentDeltaSum = flowData.delta?.recentSum || 0;
  
  // Combine CVD value và recent delta sum
  const combined = cvdValue * 0.6 + recentDeltaSum * 0.4;
  let score = 0;

  if (combined >= THRESHOLDS.cvdSlopeStrong) {
    score = Math.min(100, 60 + (combined / THRESHOLDS.cvdSlopeStrong) * 40);
  } else if (combined >= THRESHOLDS.cvdSlopeMild) {
    score = 20 + ((combined - THRESHOLDS.cvdSlopeMild) / (THRESHOLDS.cvdSlopeStrong - THRESHOLDS.cvdSlopeMild)) * 40;
  } else if (combined <= -THRESHOLDS.cvdSlopeStrong) {
    score = Math.max(-100, -60 + (combined / THRESHOLDS.cvdSlopeStrong) * 40);
  } else if (combined <= -THRESHOLDS.cvdSlopeMild) {
    score = -20 + ((combined + THRESHOLDS.cvdSlopeMild) / (THRESHOLDS.cvdSlopeStrong - THRESHOLDS.cvdSlopeMild)) * 40;
  } else {
    score = (combined / THRESHOLDS.cvdSlopeMild) * 20;
  }

  // Divergence bonus/penalty
  const divergence = flowData.cvd?.divergence;
  if (divergence === 'BEARISH_DIVERGENCE' && score > 0) {
    score = Math.round(score * 0.5); // Halve bullish score on bearish divergence
  } else if (divergence === 'BULLISH_DIVERGENCE' && score < 0) {
    score = Math.round(score * 0.5); // Halve bearish score on bullish divergence
  }

  return {
    score: Math.round(score),
    detail: {
      cvd: cvdValue,
      direction: cvdDirection,
      divergence: divergence || 'NONE',
      recentDeltaSum,
    },
  };
}

function _scorePricePosition(currentPrice, marketStructureData) {
  if (!currentPrice || !marketStructureData) {
    return { score: 0, detail: { vwap: null, poc: null, label: 'N/A' } };
  }

  const vwap = marketStructureData.vwap;
  const poc = marketStructureData.volumeProfile?.poc;
  const levels = marketStructureData.levels || [];
  
  let score = 0;
  let abovePDH = false;
  let belowPDL = false;

  // 1. Price vs VWAP
  if (vwap) {
    const vwapDist = currentPrice - vwap;
    if (vwapDist > THRESHOLDS.vwapDistanceStrong) {
      score += 50;
    } else if (vwapDist > THRESHOLDS.vwapDistanceMild) {
      score += 25;
    } else if (vwapDist < -THRESHOLDS.vwapDistanceStrong) {
      score -= 50;
    } else if (vwapDist < -THRESHOLDS.vwapDistanceMild) {
      score -= 25;
    }
  }

  // 2. Price vs PDH/PDL (Previous Day High/Low)
  const pdh = levels.find(l => l.type === 'RESISTANCE' && l.source === 'PDH');
  const pdl = levels.find(l => l.type === 'SUPPORT' && l.source === 'PDL');
  
  if (pdh && currentPrice > pdh.price + 1.0) {
    score += 30;
    abovePDH = true;
  }
  if (pdl && currentPrice < pdl.price - 1.0) {
    score -= 30;
    belowPDL = true;
  }

  // 3. Price vs POC (Point of Control)
  if (poc) {
    const pocDist = currentPrice - poc;
    if (pocDist > 3.0) score += 15;
    else if (pocDist < -3.0) score -= 15;
  }

  score = Math.max(-100, Math.min(100, score));

  return {
    score: Math.round(score),
    detail: { vwap, poc, abovePDH, belowPDL },
  };
}

function _scorePillarAlignment(pillarAnalysis) {
  if (!pillarAnalysis) {
    return { score: 0, detail: { bullish: 0, bearish: 0, label: 'N/A' } };
  }

  const bullishCount = pillarAnalysis.bullishCount || 0;
  const bearishCount = pillarAnalysis.bearishCount || 0;
  let score = 0;

  if (bullishCount >= THRESHOLDS.pillarStrongConsensus) {
    score = 60 + (bullishCount - THRESHOLDS.pillarStrongConsensus) * 20;
  } else if (bullishCount >= THRESHOLDS.pillarMildConsensus) {
    score = 30;
  } else if (bearishCount >= THRESHOLDS.pillarStrongConsensus) {
    score = -(60 + (bearishCount - THRESHOLDS.pillarStrongConsensus) * 20);
  } else if (bearishCount >= THRESHOLDS.pillarMildConsensus) {
    score = -30;
  }

  score = Math.max(-100, Math.min(100, score));

  return {
    score: Math.round(score),
    detail: {
      bullish: bullishCount,
      bearish: bearishCount,
      label: pillarAnalysis.consensusLabel || 'N/A',
    },
  };
}

function _scoreAggressionRatio(flowData) {
  if (!flowData || !flowData.aggression) {
    return { score: 0, detail: { ratio: 1.0, dominant: 'N/A' } };
  }

  const ratio = flowData.aggression.ratio || 1.0;
  const dominant = flowData.aggression.dominant || 'BALANCED';
  let score = 0;

  if (ratio >= THRESHOLDS.aggressionStrong) {
    score = Math.min(80, 40 + (ratio - THRESHOLDS.aggressionStrong) * 40);
  } else if (ratio >= THRESHOLDS.aggressionMild) {
    score = 20 + ((ratio - THRESHOLDS.aggressionMild) / (THRESHOLDS.aggressionStrong - THRESHOLDS.aggressionMild)) * 20;
  } else if (ratio <= 1 / THRESHOLDS.aggressionStrong) {
    score = Math.max(-80, -40 - (1 / ratio - THRESHOLDS.aggressionStrong) * 40);
  } else if (ratio <= 1 / THRESHOLDS.aggressionMild) {
    score = -20 - ((1 / ratio - THRESHOLDS.aggressionMild) / (THRESHOLDS.aggressionStrong - THRESHOLDS.aggressionMild)) * 20;
  }

  return {
    score: Math.round(score),
    detail: { ratio, dominant },
  };
}

// ─── HELPER: Build result object ─────────────────────────────
function _buildResult(dayType, confidence, scores) {
  const def = DAY_TYPES[dayType] || DAY_TYPES.SIDEWAY;
  
  let dominantSide = 'NEUTRAL';
  if (dayType === 'STRONG_BULL' || dayType === 'MILD_BULL') dominantSide = 'BULL';
  else if (dayType === 'STRONG_BEAR' || dayType === 'MILD_BEAR') dominantSide = 'BEAR';

  return {
    dayType,
    label: def.label,
    lockDirection: def.lockDirection,
    dominantSide,
    confidence: Math.round(confidence),
    scores,
    description: def.description,
  };
}

/**
 * Quick check: Hướng được phép vào lệnh không?
 * @param {string} proposedDirection - 'LONG' | 'SHORT'
 * @returns {Object} { allowed, reason }
 */
function isDirectionAllowed(proposedDirection) {
  const lock = _classificationState.lockDirection;
  
  if (lock === 'NONE') {
    return {
      allowed: false,
      reason: `🚫 CHOPPY — Thị trường nhiễu, CẤM MỌI LỆNH. Đứng ngoài quan sát.`,
    };
  }
  
  if (lock === 'LONG_ONLY' && proposedDirection === 'SHORT') {
    return {
      allowed: false,
      reason: `🚫 TREND DAY BULL — CẤM SHORT. Chỉ được vào LONG (${_classificationState.currentDayType}, conf: ${_classificationState.confidence}%)`,
    };
  }
  
  if (lock === 'SHORT_ONLY' && proposedDirection === 'LONG') {
    return {
      allowed: false,
      reason: `🚫 TREND DAY BEAR — CẤM LONG. Chỉ được vào SHORT (${_classificationState.currentDayType}, conf: ${_classificationState.confidence}%)`,
    };
  }
  
  return { allowed: true, reason: null };
}

/**
 * Get current classification state (for monitoring/notification)
 */
function getClassification() {
  return {
    ..._classificationState,
    definition: DAY_TYPES[_classificationState.currentDayType],
  };
}

/**
 * Force reclassification (bypass cooldown) — dùng khi có biến động lớn
 */
function forceReclassify() {
  _classificationState.lastClassifiedAt = 0;
}

/**
 * Reset state (new trading day)
 */
function resetClassification() {
  _classificationState = {
    currentDayType: 'SIDEWAY',
    lastClassifiedAt: 0,
    confidence: 0,
    scoreBreakdown: null,
    lockDirection: 'BOTH',
    dominantSide: 'NEUTRAL',
    history: [],
  };
}

module.exports = {
  classifyDominance,
  isDirectionAllowed,
  getClassification,
  forceReclassify,
  resetClassification,
  DAY_TYPES,
  THRESHOLDS,
};
