/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚖️ VN30F v4.0 — LỚP 7: Scoring Engine                   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Weighted Decisive Scoring Pipeline                         ║
 * ║  Quyết đoán, chuẩn xác, không mông lung                     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

/**
 * Tính toán score tổng hợp v4.0
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
}) {
  let longScore = 0;
  let shortScore = 0;
  const breakdown = { structure: { long: 0, short: 0 }, flow: { long: 0, short: 0 }, crossMarket: { long: 0, short: 0 }, regime: { long: 0, short: 0 } };

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

  // Quét thanh khoản (Sweep)
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
    } else if (regimeResult.regime === 'RANGE') {
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

  // ─── TỔNG HỢP & PHÁN QUYẾT QUYẾT ĐOÁN ────────────
  const scoreDiff = Math.abs(longScore - shortScore);
  const leadingScore = Math.max(longScore, shortScore);

  let finalDirection = 'NO_TRADE';
  let tradeConfidence = 0;
  let setupQuality = 'N/A';
  let vetoReason = null;

  // Cần ít nhất 30 điểm và cách biệt >= 8 điểm để ra khuyến nghị dứt khoát
  if (leadingScore >= 30 && scoreDiff >= 8) {
    finalDirection = longScore > shortScore ? 'LONG' : 'SHORT';
    // Tỷ lệ tin cậy từ 65% đến 92%
    tradeConfidence = Math.min(92, Math.max(65, Math.round(50 + leadingScore * 0.4 + scoreDiff * 0.8)));
    
    if (tradeConfidence >= 82) setupQuality = 'A+';
    else if (tradeConfidence >= 74) setupQuality = 'A';
    else if (tradeConfidence >= 68) setupQuality = 'A-';
    else setupQuality = 'B+';
  } else {
    finalDirection = 'NO_TRADE';
    tradeConfidence = 0;
    setupQuality = 'N/A';
    vetoReason = `Hai phe Mua-Bán đang giằng co cân bằng (Long ${Math.round(longScore)}đ / Short ${Math.round(shortScore)}đ) → Đứng ngoài quan sát, chờ tín hiệu bứt phá.`;
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
    },
    vetoed: finalDirection === 'NO_TRADE',
    vetoReason: finalDirection === 'NO_TRADE' ? vetoReason : null,
    biasDirection: longScore > shortScore ? 'LONG' : 'SHORT',
  };
}

module.exports = {
  calculateScore,
};
