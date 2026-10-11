/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🎯 VN30F v6.0 — Trade Decision Engine                      ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  • VSA Pattern Detection (Engulfing, Hammer, Star)            ║
 * ║  • Multi-Factor Scoring System (Confidence %)                 ║
 * ║  • Trade Plan Generator (Entry/SL/TP1/TP2)                   ║
 * ║  • Context-Aware Risk Assessment                              ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── VSA PATTERN DETECTION ──────────────────────────────────
/**
 * Nhận diện mẫu hình nến kết hợp Volume Spread Analysis
 * 
 * Nguyên tắc playbook:
 * - Pattern đẹp + Vol đạt chuẩn = tín hiệu MẠNH
 * - Pattern đẹp + Vol teo tóp = BẪY LÁI 100%
 */
function detectVSAPatterns(candles, volumeThresholds = { min: 2300, max: 2800, trap: 1300 }) {
  if (!candles || candles.length < 3) return [];

  const patterns = [];
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prevPrev = candles.length >= 3 ? candles[candles.length - 3] : null;

  // ─── 1. BULLISH ENGULFING (Nhấn chìm tăng) ──────────────
  if (!latest.isGreen === false && latest.isGreen && !prev.isGreen) {
    const engulfs = latest.body > prev.body && latest.close > prev.open && latest.open < prev.close;
    if (engulfs) {
      const volQuality = latest.volume >= volumeThresholds.min
        ? (latest.volume <= volumeThresholds.max ? 'OPTIMAL' : 'STRONG')
        : (latest.volume < volumeThresholds.trap ? 'TRAP' : 'WEAK');

      patterns.push({
        name: 'Bullish Engulfing',
        direction: 'LONG',
        emoji: '🟢',
        reliability: volQuality === 'TRAP' ? 'BẪY DỤ LONG' : (volQuality === 'WEAK' ? 'YẾU' : 'RẤT CAO'),
        isTrap: volQuality === 'TRAP',
        volQuality,
        description: volQuality === 'TRAP'
          ? `Nến xanh nhấn chìm ĐẸP nhưng Vol CHỈ ${latest.volume} HĐ — 100% BẪY DỤ LONG!`
          : `Nến xanh nhấn chìm kèm Vol ${latest.volume.toLocaleString()} HĐ — Cầu áp đảo nuốt trọn cung`,
      });
    }
  }

  // ─── 2. BEARISH ENGULFING (Nhấn chìm giảm) ──────────────
  if (!latest.isGreen && prev.isGreen) {
    const engulfs = latest.body > prev.body && latest.open > prev.close && latest.close < prev.open;
    if (engulfs) {
      const volQuality = latest.volume >= volumeThresholds.min
        ? (latest.volume <= volumeThresholds.max ? 'OPTIMAL' : 'STRONG')
        : (latest.volume < volumeThresholds.trap ? 'TRAP' : 'WEAK');

      patterns.push({
        name: 'Bearish Engulfing',
        direction: 'SHORT',
        emoji: '🔴',
        reliability: volQuality === 'TRAP' ? 'BẪY DỤ SHORT' : (volQuality === 'WEAK' ? 'YẾU' : 'RẤT CAO'),
        isTrap: volQuality === 'TRAP',
        volQuality,
        description: volQuality === 'TRAP'
          ? `Nến đỏ nhấn chìm ĐẸP nhưng Vol CHỈ ${latest.volume} HĐ — 100% BẪY DỤ SHORT!`
          : `Nến đỏ nhấn chìm kèm Vol ${latest.volume.toLocaleString()} HĐ — Lực bán áp đảo`,
      });
    }
  }

  // ─── 3. HAMMER (Nến búa — đáy) ──────────────────────────
  if (latest.lowerWick >= latest.body * 2 && latest.upperWick <= latest.body * 0.5 && latest.body > 0) {
    // Chỉ có giá trị ở vùng đáy (sau nhịp giảm)
    const recentDowntrend = candles.slice(-5, -1).filter(c => !c.isGreen).length >= 3;
    if (recentDowntrend) {
      const volQuality = latest.volume >= volumeThresholds.min ? 'STRONG' : (latest.volume < volumeThresholds.trap ? 'TRAP' : 'WEAK');

      patterns.push({
        name: 'Hammer',
        direction: 'LONG',
        emoji: '🔨',
        reliability: volQuality === 'TRAP' ? 'BẪY' : (volQuality === 'STRONG' ? 'CAO' : 'TRUNG BÌNH'),
        isTrap: volQuality === 'TRAP',
        volQuality,
        description: volQuality === 'STRONG'
          ? `Nến búa rút chân ${latest.lowerWick.toFixed(1)}đ + Vol ${latest.volume.toLocaleString()} HĐ — Smart Money quét cạn cung đáy`
          : `Nến búa rút chân nhưng Vol ${volQuality === 'TRAP' ? 'kiệt quệ' : 'yếu'} — ${volQuality === 'TRAP' ? 'BẪY!' : 'Cần xác nhận thêm'}`,
      });
    }
  }

  // ─── 4. HANGING MAN (Người treo cổ — đỉnh) ──────────────
  if (latest.lowerWick >= latest.body * 2 && latest.upperWick <= latest.body * 0.5 && latest.body > 0) {
    const recentUptrend = candles.slice(-5, -1).filter(c => c.isGreen).length >= 3;
    if (recentUptrend) {
      patterns.push({
        name: 'Hanging Man',
        direction: 'SHORT',
        emoji: '☠️',
        reliability: latest.volume >= volumeThresholds.min ? 'CAO' : 'TRUNG BÌNH',
        isTrap: false,
        volQuality: latest.volume >= volumeThresholds.min ? 'STRONG' : 'WEAK',
        description: `Nến treo cổ ở đỉnh — Phe bán thâm nhập sâu. Nến sau gãy giá → Đảo SHORT!`,
      });
    }
  }

  // ─── 5. MORNING STAR (Sao Mai — đáy, 3 nến) ─────────────
  if (prevPrev && !prevPrev.isGreen && prevPrev.body >= 1.5) {
    const isDoji = prev.body <= 0.5;
    const isBullClose = latest.isGreen && latest.body >= 1.5 && latest.close > (prevPrev.open + prevPrev.close) / 2;
    if (isDoji && isBullClose) {
      const volQuality = latest.volume >= volumeThresholds.min ? 'STRONG' : 'WEAK';
      patterns.push({
        name: 'Morning Star',
        direction: 'LONG',
        emoji: '⭐',
        reliability: volQuality === 'STRONG' ? 'RẤT CAO' : 'TRUNG BÌNH',
        isTrap: false,
        volQuality,
        description: volQuality === 'STRONG'
          ? `Sao Mai 3 nến + Vol bùng nổ ${latest.volume.toLocaleString()} HĐ — Tín hiệu đảo chiều đáy CỰC MẠNH!`
          : `Sao Mai 3 nến nhưng Vol cần mạnh hơn để xác nhận`,
      });
    }
  }

  // ─── 6. EVENING STAR (Sao Hôm — đỉnh, 3 nến) ────────────
  if (prevPrev && prevPrev.isGreen && prevPrev.body >= 1.5) {
    const isDoji = prev.body <= 0.5;
    const isBearClose = !latest.isGreen && latest.body >= 1.5 && latest.close < (prevPrev.open + prevPrev.close) / 2;
    if (isDoji && isBearClose) {
      const volQuality = latest.volume >= volumeThresholds.min ? 'STRONG' : 'WEAK';
      patterns.push({
        name: 'Evening Star',
        direction: 'SHORT',
        emoji: '🌑',
        reliability: volQuality === 'STRONG' ? 'RẤT CAO' : 'TRUNG BÌNH',
        isTrap: false,
        volQuality,
        description: volQuality === 'STRONG'
          ? `Sao Hôm 3 nến + Vol đạp gãy nền ${latest.volume.toLocaleString()} HĐ — Xác nhận đỉnh xu hướng!`
          : `Sao Hôm 3 nến nhưng Vol chưa đủ mạnh`,
      });
    }
  }

  return patterns;
}

// ─── MULTI-FACTOR SCORING SYSTEM ────────────────────────────
/**
 * Tính điểm tin cậy (Confidence %) cho quyết định giao dịch
 * 
 * Components:
 * 1. Volume Score (0-30): Vol trong vùng chuẩn = cao, FOMO/kiệt = thấp
 * 2. Trend Score (0-25): MA9>MA26 + giá sát dải = cao
 * 3. Momentum Score (0-20): MACD + RSI đồng thuận = cao
 * 4. VSA Score (0-15): Pattern + Vol match = cao
 * 5. Context Score (0-10): Session tối ưu, Basis thuận = cao
 * Penalties: Trap Shield, BB block, ngược trend = trừ điểm
 */
function calculateConfidence(params) {
  const {
    candle,
    direction,        // 'LONG' or 'SHORT'
    indicators,       // { ma9, ma26, ma20, ma50, bb, ma9_26Analysis, macdAnalysis, rsiAnalysis }
    vsaPatterns,      // from detectVSAPatterns()
    marketContext,    // from buildMarketContext()
    volumeThresholds, // { min: 2300, max: 2800, fomo: 2800, climax: 3000, trap: 1300 }
  } = params;

  let score = 0;
  const reasons = [];
  const warnings = [];
  const isLong = direction === 'LONG';

  // ─── 1. VOLUME SCORE (0-30) ──────────────────────────────
  const vol = candle.volume;
  const vt = volumeThresholds || { min: 2300, max: 2800, fomo: 2800, climax: 3000, trap: 1300 };

  if (vol >= vt.min && vol <= vt.max) {
    score += 28;
    reasons.push(`Vol ${vol.toLocaleString()} HĐ — vùng chuẩn cá mập đẩy giá`);
  } else if (vol >= vt.max && vol <= vt.climax) {
    score += 18;
    reasons.push(`Vol ${vol.toLocaleString()} HĐ — mạnh nhưng gần vùng FOMO`);
  } else if (vol >= vt.trap && vol < vt.min) {
    score += 8;
    warnings.push(`Vol ${vol.toLocaleString()} HĐ — dưới chuẩn, có thể đang bẫy`);
  } else if (vol < vt.trap) {
    score -= 15;
    warnings.push(`⚠️ Vol CHỈ ${vol.toLocaleString()} HĐ — VOL KIỆT QUỆ, RẤT CÓ THỂ LÀ BẪY LÁI!`);
  }

  // ─── 2. TREND SCORE (0-25) ───────────────────────────────
  if (indicators) {
    const ma = indicators.ma9_26Analysis;
    if (ma) {
      if (isLong && ma.isUptrend) {
        score += 20;
        reasons.push('MA9 > MA26 — Cấu trúc Uptrend');
        if (ma.bandPos === 'upper_sat') {
          score += 5;
          reasons.push('Giá sát dải trên — Vị thế thuận trend tối ưu');
        }
      } else if (!isLong && ma.isDowntrend) {
        score += 20;
        reasons.push('MA9 < MA26 — Cấu trúc Downtrend');
        if (ma.bandPos === 'lower_sat') {
          score += 5;
          reasons.push('Giá sát dải dưới — Vị thế thuận trend tối ưu');
        }
      } else if (isLong && ma.isDowntrend) {
        score -= 10;
        warnings.push('⚠️ Mở LONG ngược Downtrend MA9 < MA26');
      } else if (!isLong && ma.isUptrend) {
        score -= 10;
        warnings.push('⚠️ Mở SHORT ngược Uptrend MA9 > MA26');
      }
    }
  }

  // ─── 3. MOMENTUM SCORE (0-20) ────────────────────────────
  if (indicators && indicators.macdAnalysis && indicators.rsiAnalysis) {
    const macd = indicators.macdAnalysis;
    const rsi = indicators.rsiAnalysis;

    // Đồng thuận MACD + RSI
    const macdBull = macd.isSlopeUp;
    const rsiBull = rsi.isSlopeUp;

    if (isLong && macdBull && rsiBull) {
      score += 18;
      reasons.push('MACD + RSI đồng thuận hướng lên → Xung lực MẠNH');
    } else if (!isLong && !macdBull && !rsiBull) {
      score += 18;
      reasons.push('MACD + RSI đồng thuận hướng xuống → Xung lực BÁN mạnh');
    } else if ((isLong && macdBull) || (!isLong && !macdBull)) {
      score += 8;
      warnings.push('Xung lực phân hóa (MACD thuận, RSI chưa)');
    } else {
      score -= 5;
      warnings.push('⚠️ Xung lực PHÂN KỲ — MACD và RSI không đồng thuận');
    }

    // Phân kỳ MACD
    if (isLong && macd.hasBullishDiv) {
      score += 5;
      reasons.push('⚡ Phân kỳ dương MACD — Đáy nâng, sắp bật!');
    }
    if (!isLong && macd.hasBearishDiv) {
      score += 5;
      reasons.push('⚡ Phân kỳ âm MACD — Đỉnh hạ, sắp sập!');
    }
    if (isLong && macd.hasBearishDiv) {
      score -= 10;
      warnings.push('🚨 Phân kỳ ÂM MACD khi mở LONG — Đỉnh giá tăng nhưng MACD giảm!');
    }

    // RSI quá mua/quá bán
    if (isLong && rsi.curRSI >= 70) {
      score -= 12;
      warnings.push('🚨 RSI QUÁ MUA (≥70) — CẤM mở LONG mới!');
    }
    if (!isLong && rsi.curRSI <= 30) {
      score -= 12;
      warnings.push('🚨 RSI QUÁ BÁN (≤30) — CẤM đuổi SHORT!');
    }
  }

  // ─── 4. VSA PATTERN SCORE (0-15) ─────────────────────────
  if (vsaPatterns && vsaPatterns.length > 0) {
    const matchingPatterns = vsaPatterns.filter(p => p.direction === direction);
    const trapPatterns = vsaPatterns.filter(p => p.direction === direction && p.isTrap);
    const oppositePatterns = vsaPatterns.filter(p => p.direction !== direction && !p.isTrap);

    for (const p of matchingPatterns) {
      if (p.isTrap) {
        score -= 20;
        warnings.push(`🚨 ${p.name}: ${p.description}`);
      } else if (p.volQuality === 'STRONG' || p.volQuality === 'OPTIMAL') {
        score += 12;
        reasons.push(`${p.emoji} ${p.name}: ${p.description}`);
      } else {
        score += 5;
        reasons.push(`${p.emoji} ${p.name} (yếu): ${p.description}`);
      }
    }

    for (const p of oppositePatterns) {
      score -= 8;
      warnings.push(`⚠️ Mẫu hình ngược chiều: ${p.name} (${p.direction})`);
    }
  }

  // ─── 5. CONTEXT SCORE (0-10) ─────────────────────────────
  if (marketContext) {
    // Session bonus & warnings
    if (marketContext.isOptimalTime) {
      score += 8;
      reasons.push('🎯 Khung giờ vàng sáng (09:15-11:30) — Tập trung tối đa, xu hướng mượt ăn điểm biên lớn');
    } else if (marketContext.isAfternoonTrapZone) {
      score -= 10;
      warnings.push('⚠️ Phiên chiều rất dễ Bull Trap / đạp bẫy — Kỷ luật Vol tuyệt đối!');
    } else if (marketContext.shouldMaxProtection) {
      score -= 20;
      warnings.push('💀 VÙNG TỬ THẦN (14h-14h25) — Dễ đạp thủng 15-20đ trong vài giây, bảo vệ vốn số 1!');
    } else if (marketContext.shouldBlockEntry) {
      score -= 25;
      warnings.push('🚫 Khung giờ CẤM mở vị thế (ATO/Nghỉ trưa/Extreme Risk)');
    }

    // Basis alignment
    if (marketContext.basis) {
      if (isLong && marketContext.basis.isBullish) {
        score += 5;
        reasons.push(`Basis thuận Long: ${marketContext.basis.text}`);
      } else if (!isLong && marketContext.basis.isBearish) {
        score += 5;
        reasons.push(`Basis thuận Short: ${marketContext.basis.text}`);
      }
    }

    // NN alignment
    if (marketContext.supplyDemand) {
      if (isLong && marketContext.supplyDemand.isNNBullish) {
        score += 5;
        reasons.push('NN Long ròng — Smart Money cùng chiều');
      } else if (!isLong && marketContext.supplyDemand.isNNBearish) {
        score += 5;
        reasons.push('NN Short ròng — Smart Money cùng chiều');
      }
    }
  }

  // ─── 6. CANDLE QUALITY ───────────────────────────────────
  // Thân nến đặc, ít râu = tín hiệu mạnh
  if (candle.body >= 2.0 && candle.upperWick < candle.body && candle.lowerWick < candle.body) {
    score += 5;
    reasons.push(`Nến thân đặc ${candle.body}đ, ít râu — Dòng tiền dứt khoát`);
  }

  // ─── NORMALIZE ───────────────────────────────────────────
  const confidence = Math.max(0, Math.min(100, score));

  let level = 'LOW';
  let levelEmoji = '⚪';
  if (confidence >= 80) { level = 'HIGH'; levelEmoji = '🔥'; }
  else if (confidence >= 60) { level = 'MEDIUM'; levelEmoji = '⚡'; }
  else if (confidence >= 40) { level = 'LOW'; levelEmoji = '⚠️'; }
  else { level = 'VERY_LOW'; levelEmoji = '🚫'; }

  return {
    confidence,
    level,
    levelEmoji,
    direction,
    reasons: reasons.slice(0, 5), // Top 5 lý do
    warnings: warnings.slice(0, 3), // Top 3 cảnh báo
    shouldTrade: confidence >= 55 && warnings.filter(w => w.includes('🚨')).length === 0,
    shouldAvoid: confidence < 40 || warnings.filter(w => w.includes('🚨')).length > 0,
  };
}

// ─── TRADE PLAN GENERATOR ───────────────────────────────────
/**
 * Tạo plan giao dịch chi tiết
 */
function generateTradePlan(entry, direction, timeframe = '1M') {
  const isLong = direction === 'LONG';

  if (timeframe === '5M') {
    return {
      entry,
      sl: isLong ? entry - 2.8 : entry + 2.8,
      tp1: isLong ? entry + 5.0 : entry - 5.0,
      tp2: isLong ? entry + 10.0 : entry - 10.0,
      slDistance: 2.8,
      tp1Distance: 5.0,
      tp2Distance: 10.0,
      rr1: '1:1.8',
      rr2: '1:3.6',
      scaleOutPct: 50,
      note: 'Chốt 50% tại TP1, dời SL về hòa vốn, gồng 50% còn lại tới TP2',
    };
  }

  // 1M Scalping
  return {
    entry,
    sl: isLong ? entry - 2.0 : entry + 2.0,
    tp1: isLong ? entry + 2.5 : entry - 2.5,
    tp2: isLong ? entry + 5.0 : entry - 5.0,
    slDistance: 2.0,
    tp1Distance: 2.5,
    tp2Distance: 5.0,
    rr1: '1:1.25',
    rr2: '1:2.5',
    scaleOutPct: 50,
    note: 'Chốt nhanh TP1 scalp, nếu sóng mạnh gồng tiếp TP2',
  };
}

// ─── SENIOR TRADER REASONING ────────────────────────────────
/**
 * Tạo lý do phân tích như senior trader giải thích
 * (Ngắn gọn, dứt khoát, không dài dòng)
 */
function buildSeniorReasoning(decision, candle, indicators) {
  const reasons = [];

  // Lý do chính dựa trên volume
  if (candle.volume >= 2300 && candle.volume <= 2800) {
    reasons.push(`Vol ${candle.volume.toLocaleString()} HĐ — vùng chuẩn cá mập, không phải FOMO đám đông`);
  } else if (candle.volume > 2800) {
    reasons.push(`Vol ${candle.volume.toLocaleString()} HĐ — bùng nổ mạnh, cẩn trọng FOMO`);
  }

  // Lý do từ cấu trúc giá
  if (indicators && indicators.ma9_26Analysis) {
    const ma = indicators.ma9_26Analysis;
    if (ma.isUptrend && decision.direction === 'LONG') {
      reasons.push(`Giá bám sát MA9 (${indicators.ma9?.toFixed(1)}) > MA26 (${indicators.ma26?.toFixed(1)}) — Uptrend vững chắc`);
    } else if (ma.isDowntrend && decision.direction === 'SHORT') {
      reasons.push(`Giá dưới MA9 (${indicators.ma9?.toFixed(1)}) < MA26 (${indicators.ma26?.toFixed(1)}) — Downtrend rõ ràng`);
    }
  }

  // Nến quality
  if (candle.body >= 2.0) {
    reasons.push(`Thân nến đặc ${candle.body}đ — dòng tiền dứt khoát, không giằng co`);
  }

  return reasons.slice(0, 3);
}

module.exports = {
  detectVSAPatterns,
  calculateConfidence,
  generateTradePlan,
  buildSeniorReasoning,
};
