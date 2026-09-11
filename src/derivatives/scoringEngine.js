/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚖️ VN30F v4.2 — LỚP 7: Scoring Engine                   ║
 * ║   "Thiên Hạ Ngũ Tuyệt"                                      ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  1. R:R Veto Gatekeeper — Chặn vào lệnh sát cản             ║
 * ║  2. Liquidity Sweep Hunter — Vào lệnh sau bẫy giá            ║
 * ║  3. OI Anchor Bias — Xu hướng từ vị thế phái sinh            ║
 * ║  4. Anti-Whipsaw — Chống đảo chiều liên tục                  ║
 * ║  5. Macro Bias — Xu hướng lớn EMA50 / override               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');
const { findNearestLevels } = require('./marketStructure');

/**
 * Tính toán score tổng hợp v4.2 — "Thiên Hạ Ngũ Tuyệt"
 */
function calculateScore({
  priceMap,
  testResults,
  acceptanceResult,
  flowResult,
  absorptionResult,
  sweepResult,
  velocityResult,
  efficiencyResult,
  basisResult,
  oiState,
  leadLag,
  breadthResult,
  leaderResult,
  liquidityResult,
  regimeResult,
  // ─── v4.2 NEW PARAMS ─────────────────────────────────
  lastSignalDirection,   // 'LONG' | 'SHORT' | null
  lastSignalTime,        // timestamp (ms)
  dailyVN30,             // daily data cho EMA50 auto macro bias
}) {
  let longScore = 0;
  let shortScore = 0;
  const breakdown = {
    structure: { long: 0, short: 0 },
    flow: { long: 0, short: 0 },
    crossMarket: { long: 0, short: 0 },
    regime: { long: 0, short: 0 },
  };

  const currentPrice = priceMap ? priceMap.currentPrice : null;
  const vwap = priceMap ? priceMap.vwap : null;
  const ema20 = priceMap ? priceMap.ema20 : null;
  const waveStructure = priceMap ? priceMap.waveStructure : 'NEUTRAL';
  const trendBias = priceMap ? priceMap.trendBias : 'NEUTRAL';
  const structuralBreak = priceMap ? priceMap.structuralBreak : null;

  // ─── 1. CẤU TRÚC ĐỒ THỊ (Max 35 điểm) ─────────────
  if (currentPrice && vwap) {
    const diffVWAP = currentPrice - vwap;
    if (diffVWAP <= -2.0) {
      shortScore += 15;
      breakdown.structure.short += 15;
    } else if (diffVWAP >= 2.0) {
      longScore += 15;
      breakdown.structure.long += 15;
    } else if (diffVWAP < 0) {
      shortScore += 6;
      breakdown.structure.short += 6;
    } else {
      longScore += 6;
      breakdown.structure.long += 6;
    }
  }

  // EMA20 alignment
  if (currentPrice && ema20) {
    if (currentPrice < ema20) {
      shortScore += 8;
      breakdown.structure.short += 8;
    } else {
      longScore += 8;
      breakdown.structure.long += 8;
    }
  }

  // Sóng Lower Highs / Lower Lows
  if (waveStructure === 'LOWER_HIGHS_LOWER_LOWS') {
    shortScore += 12;
    breakdown.structure.short += 12;
  } else if (waveStructure === 'HIGHER_HIGHS_HIGHER_LOWS') {
    longScore += 12;
    breakdown.structure.long += 12;
  }

  // Bẫy vượt đỉnh thất bại
  if (structuralBreak === 'FAILED_BREAKOUT_BEARISH') {
    shortScore += 12;
    breakdown.structure.short += 12;
  }

  // ─── 2. DÒNG TIỀN & XUNG LỰC (Max 35 điểm) ────────
  if (flowResult) {
    // CVD direction
    if (flowResult.cvd.direction === 'FALLING') {
      shortScore += 12;
      breakdown.flow.short += 12;
    } else if (flowResult.cvd.direction === 'RISING') {
      longScore += 12;
      breakdown.flow.long += 12;
    }

    // CVD Divergence
    if (flowResult.cvd.divergence === 'BEARISH_DIVERGENCE') {
      shortScore += 12;
      breakdown.flow.short += 12;
    } else if (flowResult.cvd.divergence === 'BULLISH_DIVERGENCE') {
      longScore += 12;
      breakdown.flow.long += 12;
    }

    // Aggression
    if (flowResult.aggression.dominant === 'SELLERS') {
      shortScore += 10;
      breakdown.flow.short += 10;
    } else if (flowResult.aggression.dominant === 'BUYERS') {
      longScore += 10;
      breakdown.flow.long += 10;
    }
  }

  // Quét thanh khoản (Sweep) — v4.0 basic
  if (sweepResult && sweepResult.detected) {
    if (sweepResult.signal === 'BEARISH') {
      shortScore += 12;
      breakdown.flow.short += 12;
    } else if (sweepResult.signal === 'BULLISH') {
      longScore += 12;
      breakdown.flow.long += 12;
    }
  }

  // ─── 3. ĐỘ RỘNG & CHẾ ĐỘ THỊ TRƯỜNG (Max 30 điểm) ──
  if (regimeResult) {
    if (regimeResult.regime === 'TREND_DOWN') {
      shortScore += 20;
      breakdown.regime.short += 20;
    } else if (regimeResult.regime === 'TREND_UP') {
      longScore += 20;
      breakdown.regime.long += 20;
    } else if (regimeResult.regime === 'RANGE' || regimeResult.regime === 'RANGE_DAY') {
      shortScore += 5;
      longScore += 5;
      breakdown.regime.short += 5;
      breakdown.regime.long += 5;
    }
  }

  // Trụ kiệt sức
  if (leaderResult && leaderResult.exhaustion.length > 0) {
    shortScore += 8;
    breakdown.crossMarket.short += 8;
  }

  // Bẫy độ rộng
  if (breadthResult && breadthResult.trap.detected === 'TRAP_LONG') {
    shortScore += 12;
    breakdown.crossMarket.short += 12;
  } else if (breadthResult && breadthResult.trap.detected === 'TRAP_SHORT') {
    longScore += 12;
    breakdown.crossMarket.long += 12;
  }

  // ══════════════════════════════════════════════════════════
  //  v4.2 — "THIÊN HẠ NGŨ TUYỆT" UPGRADES
  // ══════════════════════════════════════════════════════════

  // ─── NGŨ TUYỆT 1: LIQUIDITY SWEEP HUNTER ─────────────
  // Phát hiện bẫy quét thanh khoản → vào lệnh ngược chiều (combo mạnh)
  let sweepHunterActive = false;
  if (sweepResult && sweepResult.detected) {
    if (sweepResult.direction === 'DOWN_THEN_UP' && flowResult && flowResult.cvd.direction === 'RISING') {
      // Quét đáy + CVD tăng → LONG mạnh (combo sweep + flow)
      longScore += 15;
      breakdown.flow.long += 15;
      sweepHunterActive = true;
    } else if (sweepResult.direction === 'UP_THEN_DOWN' && flowResult && flowResult.cvd.direction === 'FALLING') {
      // Quét đỉnh + CVD giảm → SHORT mạnh
      shortScore += 15;
      breakdown.flow.short += 15;
      sweepHunterActive = true;
    }
  }

  // ─── NGŨ TUYỆT 2: OI ANCHOR BIAS ────────────────────
  // Dùng OI state để xác nhận xu hướng từ vị thế phái sinh
  if (oiState && oiState.state) {
    if (oiState.state === 'LONG_BUILDUP') {
      longScore += 8;
      breakdown.crossMarket.long += 8;
    } else if (oiState.state === 'SHORT_BUILDUP') {
      shortScore += 8;
      breakdown.crossMarket.short += 8;
    } else if (oiState.state === 'LONG_LIQUIDATION') {
      shortScore += 5;
      breakdown.crossMarket.short += 5;
    } else if (oiState.state === 'SHORT_COVERING') {
      longScore += 3;
      breakdown.crossMarket.long += 3;
    }
  }

  // ─── NGŨ TUYỆT 3: MACRO BIAS ────────────────────────
  // Xu hướng lớn: auto-detect từ EMA50 hoặc override từ config
  const macroBias = _resolveMacroBias(dailyVN30, currentPrice);
  if (macroBias === 'BULLISH') {
    longScore += 5;
    breakdown.regime.long += 5;
  } else if (macroBias === 'BEARISH') {
    shortScore += 5;
    breakdown.regime.short += 5;
  }

  // ─── TỔNG HỢP & PHÁN QUYẾT QUYẾT ĐOÁN ────────────
  const scoreDiff = Math.abs(longScore - shortScore);
  const leadingScore = Math.max(longScore, shortScore);

  let finalDirection = 'NO_TRADE';
  let tradeConfidence = 0;
  let setupQuality = 'N/A';
  let vetoReason = null;
  let vetoType = null;

  // Base threshold — nâng cao nếu RANGE_DAY
  let minLeadingScore = 30;
  let minScoreDiff = 8;

  // ─── NGŨ TUYỆT 4: RANGE DAY SUPPRESSION ─────────────
  if (regimeResult && regimeResult.regime === 'RANGE_DAY') {
    minLeadingScore = 45;
    minScoreDiff = 12;
  }

  // ─── NGŨ TUYỆT 5: MACRO BIAS ASYMMETRY ──────────────
  // Khi có Macro Bias, đòi hỏi ngược chiều phải mạnh hơn
  if (macroBias === 'BULLISH' && shortScore > longScore) {
    minScoreDiff = Math.max(minScoreDiff, 12); // Short ngược trend cần scoreDiff >= 12
  } else if (macroBias === 'BEARISH' && longScore > shortScore) {
    minScoreDiff = Math.max(minScoreDiff, 12); // Long ngược trend cần scoreDiff >= 12
  }

  // Cần ít nhất minLeadingScore điểm và cách biệt >= minScoreDiff để ra khuyến nghị
  if (leadingScore >= minLeadingScore && scoreDiff >= minScoreDiff) {
    finalDirection = longScore > shortScore ? 'LONG' : 'SHORT';
    // Tỷ lệ tin cậy từ 65% đến 95%
    tradeConfidence = Math.min(95, Math.max(65, Math.round(50 + leadingScore * 0.4 + scoreDiff * 0.8)));

    // Sweep Hunter bonus confidence
    if (sweepHunterActive) {
      tradeConfidence = Math.min(95, tradeConfidence + 5);
    }
    
    if (tradeConfidence >= 85) setupQuality = 'A+';
    else if (tradeConfidence >= 78) setupQuality = 'A';
    else if (tradeConfidence >= 72) setupQuality = 'A-';
    else if (tradeConfidence >= 68) setupQuality = 'B+';
    else setupQuality = 'B';
  } else {
    finalDirection = 'NO_TRADE';
    tradeConfidence = 0;
    setupQuality = 'N/A';

    if (regimeResult && regimeResult.regime === 'RANGE_DAY') {
      vetoReason = `Ngày SIDEWAY — Thanh khoản yếu + sóng giằng co (Long ${Math.round(longScore)}đ / Short ${Math.round(shortScore)}đ). Hạn chế giao dịch.`;
      vetoType = 'RANGE_DAY';
    } else {
      vetoReason = `Hai phe Mua-Bán đang giằng co cân bằng (Long ${Math.round(longScore)}đ / Short ${Math.round(shortScore)}đ) → Đứng ngoài quan sát, chờ tín hiệu bứt phá.`;
    }
  }

  // ─── R:R VETO GATEKEEPER ─────────────────────────────
  // Chặn signal nếu giá quá gần cản → R:R tệ
  if (finalDirection !== 'NO_TRADE' && currentPrice && priceMap) {
    const rrThreshold = (config.derivatives && config.derivatives.rrVetoThreshold) || 4;
    const nearest = findNearestLevels(priceMap, currentPrice);

    if (finalDirection === 'LONG' && nearest.resistance) {
      const distToResistance = nearest.resistance.price - currentPrice;
      if (distToResistance < rrThreshold && distToResistance > 0) {
        vetoReason = `Giá cách cản trên (${nearest.resistance.price.toFixed(1)}) chỉ ${distToResistance.toFixed(1)} điểm — R:R &lt; 1:1 → Chờ giá test lại vùng hỗ trợ rồi Long.`;
        vetoType = 'RR_VETO';
        finalDirection = 'NO_TRADE';
        tradeConfidence = 0;
        setupQuality = 'N/A';
      }
    } else if (finalDirection === 'SHORT' && nearest.support) {
      const distToSupport = currentPrice - nearest.support.price;
      if (distToSupport < rrThreshold && distToSupport > 0) {
        vetoReason = `Giá cách hỗ trợ (${nearest.support.price.toFixed(1)}) chỉ ${distToSupport.toFixed(1)} điểm — R:R &lt; 1:1 → Chờ giá hồi lên kháng cự rồi Short.`;
        vetoType = 'RR_VETO';
        finalDirection = 'NO_TRADE';
        tradeConfidence = 0;
        setupQuality = 'N/A';
      }
    }
  }

  // ─── ANTI-WHIPSAW COOLDOWN ───────────────────────────
  // Nếu đảo chiều trong vòng 30 phút → đòi hỏi scoreDiff cao hơn
  if (finalDirection !== 'NO_TRADE' && lastSignalDirection && lastSignalTime) {
    const cooldownMs = ((config.derivatives && config.derivatives.whipsawCooldownMin) || 30) * 60 * 1000;
    const timeSinceLastSignal = Date.now() - lastSignalTime;

    if (finalDirection !== lastSignalDirection && timeSinceLastSignal < cooldownMs) {
      // Đang đảo chiều trong cooldown → cần scoreDiff >= 15
      if (scoreDiff < 15) {
        const minutesAgo = Math.round(timeSinceLastSignal / 60000);
        vetoReason = `Đảo chiều từ ${lastSignalDirection} → ${finalDirection} chỉ sau ${minutesAgo} phút (Long ${Math.round(longScore)}đ / Short ${Math.round(shortScore)}đ, chênh ${Math.round(scoreDiff)}đ &lt; 15đ). Chờ xác nhận rõ hơn.`;
        vetoType = 'ANTI_WHIPSAW';
        finalDirection = 'NO_TRADE';
        tradeConfidence = 0;
        setupQuality = 'N/A';
      }
    }
  }

  // Layer summaries
  let structureSummary = 'Cân bằng / Đang kiểm định vùng giá';
  if (shortScore >= longScore + 8) structureSummary = 'Nghiêng Bán (Giá dưới VWAP, cản trên đè)';
  else if (longScore >= shortScore + 8) structureSummary = 'Nghiêng Mua (Giá trên VWAP, giữ vững hỗ trợ)';

  let flowSummary = 'Cân bằng (Chưa có phe áp đảo)';
  if (flowResult) {
    if (flowResult.cvd.direction === 'FALLING' || (sweepResult && sweepResult.signal === 'BEARISH')) {
      flowSummary = 'Phe Bán chiếm ưu thế / CVD dốc xuống';
    } else if (flowResult.cvd.direction === 'RISING') {
      flowSummary = 'Phe Mua chiếm ưu thế / CVD dốc lên';
    }
  }

  let breadthSummary = 'Phân hóa giằng co';
  if (breadthResult) {
    if (breadthResult.greenCount >= 18) breadthSummary = `Đồng thuận Tăng (${breadthResult.greenCount} xanh / ${breadthResult.redCount} đỏ)`;
    else if (breadthResult.redCount >= 18) breadthSummary = `Đồng thuận Giảm (${breadthResult.redCount} đỏ / ${breadthResult.greenCount} xanh)`;
    else breadthSummary = `Phân hóa (${breadthResult.greenCount} xanh / ${breadthResult.redCount} đỏ)`;
  }

  let regimeSummary = regimeResult ? regimeResult.description : 'Bình thường';

  // OI summary (v4.2)
  let oiSummary = null;
  if (oiState && oiState.state && oiState.state !== 'NEUTRAL') {
    const oiLabels = {
      'LONG_BUILDUP': '📈 Long mở thêm (Giá ↑ + OI ↑)',
      'SHORT_BUILDUP': '📉 Short mở thêm (Giá ↓ + OI ↑)',
      'LONG_LIQUIDATION': '🟠 Long đang thanh lý',
      'SHORT_COVERING': '🟡 Short đóng vị thế',
    };
    oiSummary = oiLabels[oiState.state] || oiState.state;
  }

  let risk = 'VỪA PHẢI';
  if (tradeConfidence >= 78) risk = 'THẤP';
  else if (tradeConfidence < 65) risk = 'CAO';

  return {
    direction: finalDirection,
    confidence: tradeConfidence,
    setupQuality,
    risk,
    longScore: Math.round(longScore),
    shortScore: Math.round(shortScore),
    totalScore: Math.round(leadingScore),
    breakdown,
    layerSummaries: {
      structure: structureSummary,
      flow: flowSummary,
      breadth: breadthSummary,
      regime: regimeSummary,
      oi: oiSummary,            // v4.2
      macroBias,                // v4.2
    },
    vetoed: finalDirection === 'NO_TRADE',
    vetoReason: finalDirection === 'NO_TRADE' ? vetoReason : null,
    vetoType,                   // v4.2: 'RR_VETO' | 'ANTI_WHIPSAW' | 'RANGE_DAY' | null
    biasDirection: longScore > shortScore ? 'LONG' : 'SHORT',
    sweepHunterActive,          // v4.2
  };
}

/**
 * Resolve Macro Bias — AUTO detect từ EMA50 daily hoặc override từ config
 */
function _resolveMacroBias(dailyVN30, currentPrice) {
  const configBias = config.derivatives && config.derivatives.macroBias;

  // Nếu user đã set cứng → dùng luôn
  if (configBias && configBias !== 'AUTO') {
    return configBias; // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  }

  // AUTO: Detect từ EMA50 daily VN30
  if (dailyVN30 && dailyVN30.c && dailyVN30.c.length >= 50) {
    const closes = dailyVN30.c;
    // Tính EMA50
    const period = 50;
    const k = 2 / (period + 1);
    let ema50 = closes.slice(0, period).reduce((s, p) => s + p, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema50 = closes[i] * k + ema50 * (1 - k);
    }

    const latestPrice = currentPrice || closes[closes.length - 1];
    const diffPct = ((latestPrice - ema50) / ema50) * 100;

    if (diffPct > 1.0) return 'BULLISH';
    if (diffPct < -1.0) return 'BEARISH';
  }

  return 'NEUTRAL';
}

module.exports = {
  calculateScore,
};
