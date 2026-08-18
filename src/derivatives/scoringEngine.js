/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚖️ VN30F v4.0 — LỚP 7: Scoring Engine                   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Weighted, dependency-aware scoring với Gating Conditions    ║
 * ║  4 nhóm × 100 điểm + Veto rules                            ║
 * ║  Confidence ≠ Direction                                     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

/**
 * Tính toán score tổng hợp v4.0
 * 4 nhóm: STRUCTURE(30) + FLOW(30) + CROSS_MARKET(20) + REGIME(20) = 100
 * 
 * @param {Object} params - Kết quả từ tất cả 6 engine trước
 * @returns {Object} { direction, confidence, setupQuality, risk, scores, vetoed, vetoReason }
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
  // ═══ LONG score (0-100) vs SHORT score (0-100) ═══
  let longScore = 0;
  let shortScore = 0;
  const breakdown = { structure: { long: 0, short: 0 }, flow: { long: 0, short: 0 }, crossMarket: { long: 0, short: 0 }, regime: { long: 0, short: 0 } };

  // ─── 🟥 STRUCTURE (max 30 điểm mỗi bên) ──────────

  // 1. Price Zone (0-8)
  if (priceMap) {
    if (priceMap.currentZone === 'AT_SUPPORT') { longScore += 8; breakdown.structure.long += 8; }
    else if (priceMap.currentZone === 'AT_RESISTANCE') { shortScore += 8; breakdown.structure.short += 8; }
    else {
      // Giữa: tính khoảng cách tới S/R
      if (priceMap.vwap && priceMap.currentPrice) {
        if (priceMap.currentPrice > priceMap.vwap + 2) { shortScore += 3; breakdown.structure.short += 3; }
        else if (priceMap.currentPrice < priceMap.vwap - 2) { longScore += 3; breakdown.structure.long += 3; }
      }
    }
  }

  // 2. Test/Retest (0-7)
  if (testResults && testResults.length > 0) {
    for (const test of testResults) {
      if (test.testCount >= 3 && test.trend === 'WEAKENING_REJECTION') {
        // Rejection yếu dần → breakout probability tăng
        if (test.levelType === 'RESISTANCE') { longScore += 5; breakdown.structure.long += 5; }
        else if (test.levelType === 'SUPPORT') { shortScore += 5; breakdown.structure.short += 5; }
      } else if (test.testCount >= 2 && test.trend === 'STRENGTHENING_REJECTION') {
        // Rejection mạnh → level vững, trade ngược lại
        if (test.levelType === 'RESISTANCE') { shortScore += 5; breakdown.structure.short += 5; }
        else if (test.levelType === 'SUPPORT') { longScore += 5; breakdown.structure.long += 5; }
      }
    }
    // Cap structure subscores
    breakdown.structure.long = Math.min(15, breakdown.structure.long);
    breakdown.structure.short = Math.min(15, breakdown.structure.short);
  }

  // 3. Acceptance/Rejection (0-8)
  if (acceptanceResult) {
    if (acceptanceResult.type === 'ACCEPTANCE') {
      // Giá được chấp nhận tại vùng hiện tại
      if (priceMap && priceMap.currentPrice > (priceMap.vwap || 0)) {
        longScore += 6; breakdown.structure.long += 6;
      } else {
        shortScore += 6; breakdown.structure.short += 6;
      }
    } else if (acceptanceResult.type === 'EXCURSION') {
      // Giá chạy qua nhanh, không được chấp nhận → possible reversal
      if (priceMap && priceMap.currentPrice > (priceMap.vwap || 0)) {
        shortScore += 5; breakdown.structure.short += 5; // Rally không acceptance → bearish
      } else {
        longScore += 5; breakdown.structure.long += 5; // Sell-off không acceptance → bullish
      }
    }
  }

  // 4. Gap (0-7)
  if (priceMap && priceMap.gap) {
    if (priceMap.gap.points >= 5) { longScore += 5; breakdown.structure.long += 5; }
    else if (priceMap.gap.points >= 2) { longScore += 3; breakdown.structure.long += 3; }
    else if (priceMap.gap.points <= -5) { shortScore += 5; breakdown.structure.short += 5; }
    else if (priceMap.gap.points <= -2) { shortScore += 3; breakdown.structure.short += 3; }
  }

  // Cap STRUCTURE at 30
  breakdown.structure.long = Math.min(30, breakdown.structure.long);
  breakdown.structure.short = Math.min(30, breakdown.structure.short);
  longScore = Math.min(longScore, 30);
  shortScore = Math.min(shortScore, 30);

  // ─── 🟦 FLOW (max 30 điểm mỗi bên) ──────────────

  // 5. Delta/CVD (0-10)
  if (flowResult) {
    if (flowResult.aggression.dominant === 'BUYERS') { longScore += 6; breakdown.flow.long += 6; }
    else if (flowResult.aggression.dominant === 'SELLERS') { shortScore += 6; breakdown.flow.short += 6; }

    if (flowResult.cvd.direction === 'RISING') { longScore += 4; breakdown.flow.long += 4; }
    else if (flowResult.cvd.direction === 'FALLING') { shortScore += 4; breakdown.flow.short += 4; }

    // Divergence (rất quan trọng)
    if (flowResult.cvd.divergence === 'BEARISH_DIVERGENCE') { shortScore += 6; breakdown.flow.short += 6; }
    else if (flowResult.cvd.divergence === 'BULLISH_DIVERGENCE') { longScore += 6; breakdown.flow.long += 6; }
  }

  // 6. Absorption (0-8)
  if (absorptionResult && absorptionResult.detected) {
    if (absorptionResult.detected === 'SELL_ABSORPTION') { longScore += 8; breakdown.flow.long += 8; }
    else if (absorptionResult.detected === 'BUY_ABSORPTION') { shortScore += 8; breakdown.flow.short += 8; }
  }

  // 7. Liquidity Sweep (0-6)
  if (sweepResult && sweepResult.detected) {
    if (sweepResult.signal === 'BULLISH') { longScore += 6; breakdown.flow.long += 6; }
    else if (sweepResult.signal === 'BEARISH') { shortScore += 6; breakdown.flow.short += 6; }
  }

  // 8. Velocity/Efficiency (0-6)
  if (velocityResult && velocityResult.isImpulse) {
    if (velocityResult.direction === 'UP') { longScore += 4; breakdown.flow.long += 4; }
    else { shortScore += 4; breakdown.flow.short += 4; }
  }

  // Cap FLOW at 30
  breakdown.flow.long = Math.min(30, breakdown.flow.long);
  breakdown.flow.short = Math.min(30, breakdown.flow.short);

  // ─── 🟨 CROSS-MARKET (max 20 điểm) ───────────────

  // 9. Basis dynamics (0-6)
  if (basisResult) {
    if (basisResult.regime === 'PREMIUM_HIGH' || basisResult.regime === 'PREMIUM') {
      longScore += 4; breakdown.crossMarket.long += 4;
    } else if (basisResult.regime === 'DISCOUNT_DEEP' || basisResult.regime === 'DISCOUNT') {
      shortScore += 4; breakdown.crossMarket.short += 4;
    }

    if (basisResult.interaction === 'FUTURES_LEADING_UP') { longScore += 2; breakdown.crossMarket.long += 2; }
    else if (basisResult.interaction === 'FUTURES_LEADING_DOWN') { shortScore += 2; breakdown.crossMarket.short += 2; }
  }

  // 10. OI State (0-5)
  if (oiState) {
    if (oiState.state === 'LONG_BUILDUP') { longScore += 5; breakdown.crossMarket.long += 5; }
    else if (oiState.state === 'SHORT_BUILDUP') { shortScore += 5; breakdown.crossMarket.short += 5; }
    else if (oiState.state === 'SHORT_COVERING') { longScore += 3; breakdown.crossMarket.long += 3; }
    else if (oiState.state === 'LONG_LIQUIDATION') { shortScore += 3; breakdown.crossMarket.short += 3; }
  }

  // 11. Breadth + Leaders (0-6)
  if (breadthResult) {
    if (breadthResult.acceleration.trend === 'IMPROVING') { longScore += 3; breakdown.crossMarket.long += 3; }
    else if (breadthResult.acceleration.trend === 'DETERIORATING') { shortScore += 3; breakdown.crossMarket.short += 3; }

    if (breadthResult.concentration.level === 'HIGH') {
      // Index tập trung = rally/sell-off ảo → giảm confidence chiều đó
      // Không cộng thêm điểm cho chiều kéo
    }

    if (breadthResult.synchronizedMove === 'SYNC_BULL') { longScore += 3; breakdown.crossMarket.long += 3; }
    else if (breadthResult.synchronizedMove === 'SYNC_BEAR') { shortScore += 3; breakdown.crossMarket.short += 3; }
  }

  // 12. Lead-Lag (0-3)
  if (leadLag) {
    // Lead-lag chỉ là context, trọng số nhỏ
  }

  // Cap CROSS-MARKET at 20
  breakdown.crossMarket.long = Math.min(20, breakdown.crossMarket.long);
  breakdown.crossMarket.short = Math.min(20, breakdown.crossMarket.short);

  // ─── 🟩 REGIME/RISK (max 20 điểm) ────────────────

  // 13. Regime (0-10)
  if (regimeResult) {
    if (regimeResult.regime === 'TREND_UP') { longScore += 10; breakdown.regime.long += 10; }
    else if (regimeResult.regime === 'TREND_DOWN') { shortScore += 10; breakdown.regime.short += 10; }
    else if (regimeResult.regime === 'RANGE') {
      // Range: cả 2 bên cộng ít
      longScore += 3; shortScore += 3;
      breakdown.regime.long += 3; breakdown.regime.short += 3;
    }
  }

  // 14. Expiry modifier (0-5)
  if (regimeResult && regimeResult.expiryMode) {
    const mod = regimeResult.expiryMode.confidenceModifier;
    if (mod < 0) {
      // Giảm cả 2 bên proportionally
      longScore = Math.max(0, longScore + mod);
      shortScore = Math.max(0, shortScore + mod);
    }
  }

  // 15. Liquidity risk modifier
  if (liquidityResult) {
    const mod = liquidityResult.riskModifier;
    if (mod < 0) {
      longScore = Math.max(0, longScore + mod);
      shortScore = Math.max(0, shortScore + mod);
    }
  }

  // 16. Bank participation (0-5)
  if (breadthResult && breadthResult.bank.label === 'CAO') {
    if (breadthResult.greenCount > breadthResult.redCount) { longScore += 5; breakdown.regime.long += 5; }
    else { shortScore += 5; breakdown.regime.short += 5; }
  }

  // Cap REGIME at 20
  breakdown.regime.long = Math.min(20, breakdown.regime.long);
  breakdown.regime.short = Math.min(20, breakdown.regime.short);

  // ═══ GATING CONDITIONS (Veto Rules) ═══
  let vetoed = false;
  let vetoReason = null;

  // ❌ KHÔNG Short nếu: đang ở strong demand + sell absorption
  if (priceMap && priceMap.currentZone === 'AT_SUPPORT' &&
      absorptionResult && absorptionResult.detected === 'SELL_ABSORPTION') {
    if (shortScore > longScore) {
      vetoed = true;
      vetoReason = `Không Short — Giá tại vùng cầu ${absorptionResult.level} + lực bán đang bị hấp thụ`;
    }
  }

  // ❌ KHÔNG Long nếu: đang ở strong resistance + buy absorption
  if (priceMap && priceMap.currentZone === 'AT_RESISTANCE' &&
      absorptionResult && absorptionResult.detected === 'BUY_ABSORPTION') {
    if (longScore > shortScore) {
      vetoed = true;
      vetoReason = `Không Long — Giá tại vùng kháng cự ${absorptionResult.level} + lực mua đang bị đè`;
    }
  }

  // ❌ NO TRADE nếu: TWO_SIDED_CHOP
  if (regimeResult && regimeResult.regime === 'TWO_SIDED_CHOP') {
    vetoed = true;
    vetoReason = 'Không giao dịch — Thị trường đấu giá 2 chiều, không có hướng rõ ràng';
  }

  // ❌ Trap detection override
  if (breadthResult && breadthResult.trap.detected && breadthResult.trap.confidence >= 70) {
    if (breadthResult.trap.detected === 'TRAP_LONG' && longScore > shortScore) {
      // Bẫy Long: override sang Short
      shortScore += 15;
    } else if (breadthResult.trap.detected === 'TRAP_SHORT' && shortScore > longScore) {
      longScore += 15;
    }
  }

  // ─── TỔNG KẾT TỪNG LỚP BẰNG TIẾNG VIỆT RÕ RÀNG ───
  let structureSummary = 'Cân bằng / Đang kiểm định vùng giá';
  if (breakdown.structure.short > breakdown.structure.long + 3) structureSummary = 'Nghiêng Bán (Áp lực cản trên đè)';
  else if (breakdown.structure.long > breakdown.structure.short + 3) structureSummary = 'Nghiêng Mua (Giữ vững vùng hỗ trợ)';

  let flowSummary = 'Cân bằng (Chưa có phe áp đảo)';
  if (flowResult && flowResult.aggression) {
    if (flowResult.aggression.dominant === 'SELLERS' || flowResult.cvd.direction === 'FALLING') {
      flowSummary = 'Phe Bán chủ động / CVD dốc xuống';
    } else if (flowResult.aggression.dominant === 'BUYERS' && flowResult.cvd.direction === 'RISING') {
      flowSummary = 'Phe Mua chiếm ưu thế / CVD tăng';
    } else if (flowResult.aggression.dominant === 'BUYERS') {
      flowSummary = 'Phe Mua nhiều hơn nhưng đà tăng chững lại';
    }
  }

  let breadthSummary = 'Phân hóa giằng co';
  if (breadthResult) {
    if (breadthResult.greenCount >= 20) breadthSummary = `Đồng thuận Tăng (${breadthResult.greenCount} xanh / ${breadthResult.redCount} đỏ)`;
    else if (breadthResult.redCount >= 20) breadthSummary = `Đồng thuận Giảm (${breadthResult.redCount} đỏ / ${breadthResult.greenCount} xanh)`;
    else breadthSummary = `Phân hóa (${breadthResult.greenCount} xanh / ${breadthResult.redCount} đỏ)`;
  }

  let regimeSummary = regimeResult ? regimeResult.description : 'Bình thường';

  // ═══ ĐIỀU KIỆN KÍCH HOẠT LỆNH DỨT KHOÁT (Tránh tín hiệu mông lung) ═══
  const scoreDiff = Math.abs(longScore - shortScore);
  const leadingScore = Math.max(longScore, shortScore);

  let finalDirection = 'NO_TRADE';
  let tradeConfidence = 0;
  let setupQuality = 'N/A';

  // Chỉ mở vị thế khi:
  // 1. Không bị Veto
  // 2. Điểm phe dẫn đầu >= 35
  // 3. Cách biệt giữa 2 phe >= 6 điểm
  const isTradeable = !vetoed && leadingScore >= 35 && scoreDiff >= 6;

  if (isTradeable) {
    finalDirection = longScore > shortScore ? 'LONG' : 'SHORT';
    tradeConfidence = Math.min(92, Math.round(55 + leadingScore * 0.4 + scoreDiff * 1.5));
    if (tradeConfidence >= 80) setupQuality = 'A+';
    else if (tradeConfidence >= 72) setupQuality = 'A';
    else if (tradeConfidence >= 65) setupQuality = 'A-';
    else setupQuality = 'B+';
  } else {
    finalDirection = 'NO_TRADE';
    tradeConfidence = 0;
    setupQuality = 'N/A';
    if (!vetoReason) {
      if (leadingScore < 30) {
        vetoReason = 'Tín hiệu chưa đủ mạnh → Đứng ngoài quan sát';
      } else {
        vetoReason = `Hai phe giằng co cân bằng (Long ${Math.round(longScore)}đ / Short ${Math.round(shortScore)}đ) → Chưa có ưu thế rõ ràng`;
      }
    }
  }

  // Risk level
  let risk = 'VỪA PHẢI';
  if (regimeResult && (regimeResult.regime === 'TWO_SIDED_CHOP' || regimeResult.regime === 'EXPIRY_DISTORTION')) risk = 'CAO';
  else if (liquidityResult && liquidityResult.regime === 'CẠN') risk = 'CAO';
  else if (tradeConfidence >= 75 && efficiencyResult && efficiencyResult.value >= 0.5) risk = 'THẤP';

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
    vetoed: !isTradeable,
    vetoReason: isTradeable ? null : vetoReason,
    biasDirection: longScore > shortScore ? 'LONG' : longScore < shortScore ? 'SHORT' : 'NEUTRAL',
  };
}

module.exports = {
  calculateScore,
};
