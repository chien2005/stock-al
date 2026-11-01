/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🎯 VN30F v7.0 — Hybrid 5-Layer Trade Decision Engine        ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Theo triết lý Trading Playbook VN30F1M Hybrid:              ║
 * ║  "Không có tín hiệu nào được phép đứng riêng lẻ"              ║
 * ║                                                               ║
 * ║  5 Lớp Xác Nhận Toàn Diện:                                   ║
 * ║  Lớp 1: Cấu Trúc Thị Trường (Market Structure) — 25%          ║
 * ║  Lớp 2: Vùng Giá Quan Trọng (Key Levels)       — 15%          ║
 * ║  Lớp 3: Hành Động Giá & Dòng Lệnh (PA + Flow)  — 25%          ║
 * ║  Lớp 4: Khối Lượng Tương Đối (Relative Vol)    — 15%          ║
 * ║  Lớp 5: Bối Cảnh Phiên & 7 Trụ Điều Tiết       — 20%          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── VSA PATTERN DETECTION (Hỗ trợ Dynamic & Tương đối) ───────
/**
 * Nhận diện mẫu hình nến kết hợp Volume Spread Analysis
 * Hỗ trợ so sánh Volume tương đối (vs MA20 hoặc volThresholds linh hoạt)
 */
function detectVSAPatterns(candles, volumeThresholds = { min: 2000, max: 3200, trap: 1200 }, volRatio = null) {
  if (!candles || candles.length < 3) return [];

  const patterns = [];
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prevPrev = candles.length >= 3 ? candles[candles.length - 3] : null;

  // Đánh giá chất lượng Vol linh hoạt
  const isOptimalVol = volRatio ? (volRatio >= 1.15 && volRatio <= 2.2) : (latest.volume >= volumeThresholds.min && latest.volume <= volumeThresholds.max);
  const isTrapVol = volRatio ? (volRatio < 0.75) : (latest.volume < volumeThresholds.trap);
  const volQuality = isTrapVol ? 'TRAP' : (isOptimalVol ? 'OPTIMAL' : (latest.volume >= volumeThresholds.min ? 'STRONG' : 'WEAK'));

  // 1. BULLISH ENGULFING (Nhấn chìm tăng)
  if (latest.isGreen && !prev.isGreen) {
    const engulfs = latest.body > prev.body && latest.close > prev.open && latest.open < prev.close;
    if (engulfs) {
      patterns.push({
        name: 'Bullish Engulfing',
        direction: 'LONG',
        emoji: '🟢',
        reliability: volQuality === 'TRAP' ? 'BẪY DỤ LONG' : (volQuality === 'WEAK' ? 'YẾU' : 'RẤT CAO'),
        isTrap: volQuality === 'TRAP',
        volQuality,
        description: volQuality === 'TRAP'
          ? `Nến xanh nhấn chìm nhưng Vol kiệt (${latest.volume} HĐ) — Cảnh báo BẪY DỤ LONG!`
          : `Nến xanh nhấn chìm kèm Vol tốt ${latest.volume.toLocaleString()} HĐ — Cầu áp đảo nuốt trọn cung`,
      });
    }
  }

  // 2. BEARISH ENGULFING (Nhấn chìm giảm)
  if (!latest.isGreen && prev.isGreen) {
    const engulfs = latest.body > prev.body && latest.open > prev.close && latest.close < prev.open;
    if (engulfs) {
      patterns.push({
        name: 'Bearish Engulfing',
        direction: 'SHORT',
        emoji: '🔴',
        reliability: volQuality === 'TRAP' ? 'BẪY DỤ SHORT' : (volQuality === 'WEAK' ? 'YẾU' : 'RẤT CAO'),
        isTrap: volQuality === 'TRAP',
        volQuality,
        description: volQuality === 'TRAP'
          ? `Nến đỏ nhấn chìm nhưng Vol kiệt (${latest.volume} HĐ) — Cảnh báo BẪY DỤ SHORT!`
          : `Nến đỏ nhấn chìm kèm Vol ${latest.volume.toLocaleString()} HĐ — Lực bán áp đảo`,
      });
    }
  }

  // 3. HAMMER (Nến búa rút chân ở hỗ trợ / đáy)
  if (latest.lowerWick >= latest.body * 1.8 && latest.upperWick <= latest.body * 0.6 && latest.body > 0) {
    const recentDown = candles.slice(-5, -1).filter(c => !c.isGreen).length >= 2;
    if (recentDown) {
      patterns.push({
        name: 'Hammer',
        direction: 'LONG',
        emoji: '🔨',
        reliability: volQuality === 'TRAP' ? 'BẪY RÚT CHÂN ẢO' : (volQuality === 'STRONG' || volQuality === 'OPTIMAL' ? 'CAO' : 'TRUNG BÌNH'),
        isTrap: volQuality === 'TRAP',
        volQuality,
        description: volQuality === 'TRAP'
          ? `Nến búa rút chân nhưng Vol teo tóp (${latest.volume} HĐ) — Dễ là kê lệnh ảo đỡ giá!`
          : `Nến búa rút chân ${latest.lowerWick.toFixed(1)}đ + Vol ${latest.volume.toLocaleString()} HĐ — Smart Money quét cạn cung đáy`,
      });
    }
  }

  // 4. SHOOTING STAR (Bắn sao râu trên ở cản / đỉnh)
  if (latest.upperWick >= latest.body * 1.8 && latest.lowerWick <= latest.body * 0.6 && latest.body > 0) {
    const recentUp = candles.slice(-5, -1).filter(c => c.isGreen).length >= 2;
    if (recentUp) {
      patterns.push({
        name: 'Shooting Star',
        direction: 'SHORT',
        emoji: '🌠',
        reliability: volQuality === 'TRAP' ? 'BẪY TIẾT CUNG' : 'CAO',
        isTrap: volQuality === 'TRAP',
        volQuality,
        description: `Bắn sao râu trên ${latest.upperWick.toFixed(1)}đ — Cung đè ép đỉnh mạnh, phe mua kiệt sức`,
      });
    }
  }

  // 5. MORNING STAR (Sao Mai — Đáy 3 nến)
  if (prevPrev && !prevPrev.isGreen && prevPrev.body >= 1.2) {
    const isDoji = prev.body <= 0.6;
    const isBullClose = latest.isGreen && latest.body >= 1.2 && latest.close > (prevPrev.open + prevPrev.close) / 2;
    if (isDoji && isBullClose) {
      patterns.push({
        name: 'Morning Star',
        direction: 'LONG',
        emoji: '⭐',
        reliability: volQuality === 'STRONG' || volQuality === 'OPTIMAL' ? 'RẤT CAO' : 'TRUNG BÌNH',
        isTrap: false,
        volQuality,
        description: `Bộ 3 nến Sao Mai đảo chiều đáy vững chắc kèm Vol ${latest.volume.toLocaleString()} HĐ`,
      });
    }
  }

  // 6. EVENING STAR (Sao Hôm — Đỉnh 3 nến)
  if (prevPrev && prevPrev.isGreen && prevPrev.body >= 1.2) {
    const isDoji = prev.body <= 0.6;
    const isBearClose = !latest.isGreen && latest.body >= 1.2 && latest.close < (prevPrev.open + prevPrev.close) / 2;
    if (isDoji && isBearClose) {
      patterns.push({
        name: 'Evening Star',
        direction: 'SHORT',
        emoji: '🌑',
        reliability: volQuality === 'STRONG' || volQuality === 'OPTIMAL' ? 'RẤT CAO' : 'TRUNG BÌNH',
        isTrap: false,
        volQuality,
        description: `Bộ 3 nến Sao Hôm gãy nền đỉnh kèm Vol ${latest.volume.toLocaleString()} HĐ`,
      });
    }
  }

  return patterns;
}

// ─── NHẬN DIỆN THIẾT LẬP VÀO LỆNH CHUẨN PLAYBOOK ───────────────
/**
 * Xác định mẫu thiết lập giao dịch theo Playbook VN30F:
 * 1. TREND_CONTINUATION: Thuận xu hướng khi giá pullback về VWAP/EMA
 * 2. BREAKOUT_RETEST: Phá cản/hỗ trợ và test thành công
 * 3. FAILED_BREAKOUT: Bẫy breakout giả, đảo chiều
 * 4. RANGE_REVERSAL: Bật từ biên hộp Sideway
 */
function detectPlaybookSetup(params) {
  const {
    candle,
    direction,
    marketStructureData,
    flowData,
    vsaPatterns = [],
  } = params;

  if (!marketStructureData || !candle) {
    return { type: 'STANDARD_MOMENTUM', label: 'Xung lực thông thường', quality: 'NORMAL' };
  }

  const { vwap, ema20, currentZone, waveStructure, structuralBreak } = marketStructureData;
  const isLong = direction === 'LONG';

  // 1. FAILED BREAKOUT (Cực kỳ giá trị trên VN30F do lái hay vẽ bẫy quét SL)
  if (structuralBreak === 'FAILED_BREAKOUT_BEARISH' && !isLong) {
    return {
      type: 'FAILED_BREAKOUT',
      label: '⚡ FAILED BREAKOUT (Bẫy vượt đỉnh xả ngược)',
      quality: 'HIGH',
      description: 'Giá vượt đỉnh/VAH ảo nhưng bị đạp ngược ngay lập tức, khối ngoại hoặc lái xả hàng',
    };
  }

  if (flowData && flowData.absorption && flowData.absorption.detected) {
    if (isLong && flowData.absorption.type === 'BOTTOM_ABSORPTION') {
      return {
        type: 'FAILED_BREAKOUT',
        label: '⚡ SPRING / FAILED BREAKDOWN (Quét đáy gom hàng)',
        quality: 'HIGH',
        description: 'Giá nhúng thủng hỗ trợ nhưng bị tay to hấp thụ toàn bộ cung và rút chân',
      };
    }
    if (!isLong && flowData.absorption.type === 'TOP_ABSORPTION') {
      return {
        type: 'FAILED_BREAKOUT',
        label: '⚡ UPTHRUST / FAILED BREAKOUT (Quét đỉnh xả hàng)',
        quality: 'HIGH',
        description: 'Giá rướn vượt đỉnh nhưng gặp lệnh bán đối ứng chặn đứng hoàn toàn',
      };
    }
  }

  // 2. BREAKOUT & RETEST
  if (currentZone === 'AT_SUPPORT' && isLong && waveStructure === 'HIGHER_HIGHS_HIGHER_LOWS') {
    return {
      type: 'BREAKOUT_RETEST',
      label: '🎯 BREAKOUT & RETEST (Test thành công hỗ trợ mới)',
      quality: 'HIGH',
      description: 'Giá vượt kháng cự cũ, quay lại kiểm định thành công và bật tăng tiếp',
    };
  }
  if (currentZone === 'AT_RESISTANCE' && !isLong && waveStructure === 'LOWER_HIGHS_LOWER_LOWS') {
    return {
      type: 'BREAKOUT_RETEST',
      label: '🎯 BREAKDOWN & RETEST (Test thành công cản mới)',
      quality: 'HIGH',
      description: 'Giá thủng hỗ trợ cũ, hồi lên test lại cản và bị ép bán tiếp',
    };
  }

  // 3. TREND CONTINUATION (Hồi về VWAP / EMA20 trong xu hướng mạnh)
  if (vwap && ema20) {
    const nearVWAP = Math.abs(candle.close - vwap) <= 1.5;
    const nearEMA20 = Math.abs(candle.close - ema20) <= 1.2;

    if (isLong && waveStructure === 'HIGHER_HIGHS_HIGHER_LOWS' && (nearVWAP || nearEMA20) && candle.close >= vwap) {
      return {
        type: 'TREND_CONTINUATION',
        label: '🌊 TREND CONTINUATION (Hồi về VWAP/EMA20 bật tiếp)',
        quality: 'HIGH',
        description: 'Xu hướng tăng rõ ràng (Nâng đỉnh nâng đáy), giá retest VWAP/EMA20 an toàn',
      };
    }
    if (!isLong && waveStructure === 'LOWER_HIGHS_LOWER_LOWS' && (nearVWAP || nearEMA20) && candle.close <= vwap) {
      return {
        type: 'TREND_CONTINUATION',
        label: '🌊 TREND CONTINUATION (Hồi về VWAP/EMA20 dội xuống)',
        quality: 'HIGH',
        description: 'Xu hướng giảm rõ ràng (Hạ đỉnh hạ đáy), giá hồi chạm cản VWAP/EMA20 bị ép bán',
      };
    }
  }

  // 4. RANGE REVERSAL (Đánh trong biên đi ngang)
  if (currentZone === 'AT_SUPPORT' && isLong) {
    return {
      type: 'RANGE_REVERSAL',
      label: '↔️ RANGE REVERSAL (Bật lại từ biên dưới hộp)',
      quality: 'NORMAL',
      description: 'Thị trường sideway, giá chạm cận dưới hỗ trợ/VAL có phản ứng gom',
    };
  }
  if (currentZone === 'AT_RESISTANCE' && !isLong) {
    return {
      type: 'RANGE_REVERSAL',
      label: '↔️ RANGE REVERSAL (Dội lại từ biên trên hộp)',
      quality: 'NORMAL',
      description: 'Thị trường sideway, giá chạm cận trên kháng cự/VAH có phản ứng bán',
    };
  }

  return {
    type: 'TREND_FOLLOWING',
    label: '📈 BÁM THEO XUNG LỰC (Trend Following)',
    quality: 'NORMAL',
  };
}

// ─── HYBRID 5-LAYER CONFIDENCE SCORING (0 - 100) ──────────────
/**
 * Chấm điểm toàn diện 5 lớp theo chuẩn Playbook VN30F:
 * Layer 1 (25%): Market Structure (Trend bias, Wave structure, Multi-TF alignment)
 * Layer 2 (15%): Key Levels (VWAP, POC, VAH, VAL, Support/Resistance distance)
 * Layer 3 (25%): Price Action & Order Flow (VSA patterns, Delta/CVD, Absorption, Sweep)
 * Layer 4 (15%): Relative Volume Quality (Dynamic thresholds, Vol MA ratio)
 * Layer 5 (20%): Context & 7 Pillar Stocks (Session gold hours, Basis, Foreign, 7 Trụ)
 */
function calculateConfidence(params) {
  const {
    candle,
    direction,            // 'LONG' or 'SHORT'
    indicators,           // { ma9, ma26, ma20, ma50, bb, ma9_26Analysis, macdAnalysis, rsiAnalysis }
    vsaPatterns = [],
    marketContext,
    volumeThresholds,
    volRatio = null,      // Tỷ lệ Vol nến so với Vol MA20
    marketStructureData,  // Từ marketStructure.buildPriceMap()
    flowData,             // Từ flowEngine.analyzeFlow() + detectAbsorption()
    pillarAnalysis,       // Từ pillarMonitor.analyzePillars()
    setupInfo,            // Từ detectPlaybookSetup()
  } = params;

  let score = 0;
  const reasons = [];
  const warnings = [];
  const isLong = direction === 'LONG';

  // ═════════════════════════════════════════════════════════════
  // LỚP 1: CẤU TRÚC THỊ TRƯỜNG (MARKET STRUCTURE) — TỐI ĐA 25 ĐIỂM
  // ═════════════════════════════════════════════════════════════
  let layer1Score = 0;
  if (marketStructureData) {
    const { waveStructure, trendBias } = marketStructureData;

    // A. Sóng đỉnh đáy (HH/HL vs LH/LL)
    if (isLong && waveStructure === 'HIGHER_HIGHS_HIGHER_LOWS') {
      layer1Score += 14;
      reasons.push('Cấu trúc nến: Nâng đỉnh - Nâng đáy (Higher Highs / Higher Lows)');
    } else if (!isLong && waveStructure === 'LOWER_HIGHS_LOWER_LOWS') {
      layer1Score += 14;
      reasons.push('Cấu trúc nến: Hạ đỉnh - Hạ đáy (Lower Highs / Lower Lows)');
    } else if (waveStructure === 'NEUTRAL') {
      layer1Score += 6;
      reasons.push('Cấu trúc nến: Biên độ dao động tích lũy (Sideway)');
    } else {
      // Đánh ngược cấu trúc sóng
      layer1Score -= 8;
      warnings.push(`⚠️ Đánh ngược cấu trúc sóng đỉnh/đáy (${waveStructure})`);
    }

    // B. Xu hướng tổng thể (trendBias)
    if (isLong && (trendBias === 'BULLISH' || trendBias === 'MILD_BULLISH')) {
      layer1Score += 11;
      reasons.push(`Trend Bias: Thuận chiều TĂNG (${trendBias})`);
    } else if (!isLong && (trendBias === 'BEARISH' || trendBias === 'MILD_BEARISH')) {
      layer1Score += 11;
      reasons.push(`Trend Bias: Thuận chiều GIẢM (${trendBias})`);
    } else if (trendBias === 'NEUTRAL') {
      layer1Score += 5;
    } else {
      layer1Score -= 7;
      warnings.push(`⚠️ Ngược Trend Bias tổng thể (${trendBias})`);
    }
  } else if (indicators && indicators.ma9_26Analysis) {
    // Fallback nếu thiếu marketStructureData
    const ma = indicators.ma9_26Analysis;
    if (isLong && ma.isUptrend) {
      layer1Score += 20;
      reasons.push('MA9 > MA26 — Cấu trúc Uptrend');
    } else if (!isLong && ma.isDowntrend) {
      layer1Score += 20;
      reasons.push('MA9 < MA26 — Cấu trúc Downtrend');
    } else {
      layer1Score -= 8;
      warnings.push('⚠️ Ngược xu hướng MA ngắn hạn');
    }
  }
  score += Math.max(0, Math.min(25, layer1Score));

  // ═════════════════════════════════════════════════════════════
  // LỚP 2: VÙNG GIÁ QUAN TRỌNG (KEY LEVELS & VWAP) — TỐI ĐA 15 ĐIỂM
  // ═════════════════════════════════════════════════════════════
  let layer2Score = 0;
  if (marketStructureData) {
    const { vwap, poc, vah, val, currentZone } = marketStructureData;
    const price = candle.close;

    // A. Vị trí so với VWAP (Neo giá tổ chức)
    if (vwap) {
      if (isLong && price >= vwap) {
        layer2Score += 8;
        reasons.push(`Giá ${price.toFixed(1)} nằm TRÊN VWAP (${vwap.toFixed(1)}) — Phe Mua kiểm soát sân chơi`);
      } else if (!isLong && price <= vwap) {
        layer2Score += 8;
        reasons.push(`Giá ${price.toFixed(1)} nằm DƯỚI VWAP (${vwap.toFixed(1)}) — Phe Bán kiểm soát sân chơi`);
      } else {
        layer2Score -= 4;
        warnings.push(`⚠️ Mở lệnh ngược phía VWAP (${vwap.toFixed(1)})`);
      }
    }

    // B. Vị trí so với Volume Profile (VAH / VAL / POC)
    if (vah && val) {
      if (isLong && currentZone === 'AT_SUPPORT') {
        layer2Score += 7;
        reasons.push(`Vị thế tại vùng Hỗ trợ / VAL (${val.toFixed(1)}) — Điểm vào an toàn`);
      } else if (!isLong && currentZone === 'AT_RESISTANCE') {
        layer2Score += 7;
        reasons.push(`Vị thế tại vùng Kháng cự / VAH (${vah.toFixed(1)}) — Điểm vào an toàn`);
      } else if (isLong && currentZone === 'AT_RESISTANCE') {
        layer2Score -= 6;
        warnings.push(`🚨 Mở LONG ngay sát Cản / VAH (${vah.toFixed(1)}) — Dễ dính cản dội lại!`);
      } else if (!isLong && currentZone === 'AT_SUPPORT') {
        layer2Score -= 6;
        warnings.push(`🚨 Mở SHORT ngay sát Hỗ trợ / VAL (${val.toFixed(1)}) — Dễ dính hỗ trợ bật lên!`);
      } else {
        layer2Score += 4;
      }
    }
  }
  score += Math.max(0, Math.min(15, layer2Score));

  // ═════════════════════════════════════════════════════════════
  // LỚP 3: HÀNH ĐỘNG GIÁ & DÒNG LỆNH (PA & FLOW) — TỐI ĐA 25 ĐIỂM
  // ═════════════════════════════════════════════════════════════
  let layer3Score = 0;

  // A. VSA Candlestick Patterns
  if (vsaPatterns && vsaPatterns.length > 0) {
    const matching = vsaPatterns.filter(p => p.direction === direction);
    const trap = vsaPatterns.filter(p => p.direction === direction && p.isTrap);
    const opposite = vsaPatterns.filter(p => p.direction !== direction && !p.isTrap);

    for (const p of matching) {
      if (p.isTrap) {
        layer3Score -= 12;
        warnings.push(`🚨 ${p.name}: ${p.description}`);
      } else if (p.volQuality === 'OPTIMAL' || p.volQuality === 'STRONG') {
        layer3Score += 10;
        reasons.push(`${p.emoji} ${p.name}: ${p.description}`);
      } else {
        layer3Score += 5;
        reasons.push(`${p.emoji} ${p.name}: ${p.description}`);
      }
    }

    for (const p of opposite) {
      layer3Score -= 8;
      warnings.push(`⚠️ Mẫu hình nến ngược chiều: ${p.name}`);
    }
  }

  // B. Flow Engine (Delta / CVD / Absorption)
  if (flowData) {
    const { delta, cvd, absorption } = flowData;

    // Delta & CVD
    if (delta) {
      if (isLong && delta.trend === 'BULLISH') {
        layer3Score += 8;
        reasons.push('Dòng lệnh Flow: Delta mua chủ động áp đảo');
      } else if (!isLong && delta.trend === 'BEARISH') {
        layer3Score += 8;
        reasons.push('Dòng lệnh Flow: Delta bán chủ động áp đảo');
      } else if ((isLong && delta.trend === 'BEARISH') || (!isLong && delta.trend === 'BULLISH')) {
        layer3Score -= 5;
        warnings.push(`⚠️ Delta dòng lệnh đang đi ngược chiều tín hiệu (${delta.trend})`);
      }
    }

    // Absorption (Hấp thụ)
    if (absorption && absorption.detected) {
      if (isLong && absorption.type === 'BOTTOM_ABSORPTION') {
        layer3Score += 7;
        reasons.push('⚡ Tín hiệu HẤP THỤ ĐÁY: Tay to nuốt sạch lệnh bán hoảng loạn');
      } else if (!isLong && absorption.type === 'TOP_ABSORPTION') {
        layer3Score += 7;
        reasons.push('⚡ Tín hiệu HẤP THỤ ĐỈNH: Tay to chặn gom/xả trần dập tắt lực mua');
      }
    }
  }

  // C. Chất lượng thân nến và râu nến
  if (candle.body >= 1.5) {
    if (candle.isGreen && candle.upperWick <= candle.body * 0.4 && isLong) {
      layer3Score += 5;
      reasons.push(`Nến đặc tăng ${candle.body.toFixed(1)}đ, râu trên ngắn — Dứt khoát`);
    } else if (!candle.isGreen && candle.lowerWick <= candle.body * 0.4 && !isLong) {
      layer3Score += 5;
      reasons.push(`Nến đặc giảm ${candle.body.toFixed(1)}đ, râu dưới ngắn — Lực bán dứt khoát`);
    }
  }
  score += Math.max(0, Math.min(25, layer3Score));

  // ═════════════════════════════════════════════════════════════
  // LỚP 4: KHỐI LƯỢNG TƯƠNG ĐỐI (RELATIVE VOLUME) — TỐI ĐA 15 ĐIỂM
  // ═════════════════════════════════════════════════════════════
  let layer4Score = 0;
  const vol = candle.volume;
  const vt = volumeThresholds || { min: 2000, max: 2800, fomo: 2800, climax: 3200, trap: 1200 };

  // Ưu tiên tỷ lệ Vol Ratio nếu có
  if (volRatio !== null && volRatio !== undefined) {
    if (volRatio >= 1.2 && volRatio <= 2.2) {
      layer4Score += 15;
      reasons.push(`Vol tương đối đạt chuẩn: ${(volRatio * 100).toFixed(0)}% MA20 Vol — Dòng tiền đẩy thực`);
    } else if (volRatio > 2.2 && volRatio <= 3.0) {
      layer4Score += 9;
      warnings.push(`Vol tăng đột biến ${(volRatio * 100).toFixed(0)}% MA20 Vol — Cẩn trọng FOMO`);
    } else if (volRatio > 3.0) {
      layer4Score -= 5;
      warnings.push('🚨 Vol Climax quá mức (>300% MA20) — Dễ tạo đỉnh/đáy cao trào!');
    } else if (volRatio < 0.7) {
      layer4Score -= 8;
      warnings.push(`⚠️ Vol cạn chỉ ${(volRatio * 100).toFixed(0)}% MA20 — Tránh bẫy kéo/xả thanh khoản thấp`);
    } else {
      layer4Score += 7;
    }
  } else {
    // Ngưỡng dynamic thresholds
    if (vol >= vt.min && vol <= vt.max) {
      layer4Score += 15;
      reasons.push(`Vol ${vol.toLocaleString()} HĐ — Vùng chuẩn đẩy giá`);
    } else if (vol > vt.max && vol <= vt.climax) {
      layer4Score += 9;
      warnings.push(`Vol ${vol.toLocaleString()} HĐ — Biên độ lớn, cẩn trọng đuổi giá`);
    } else if (vol < vt.trap) {
      layer4Score -= 10;
      warnings.push(`🚨 Vol chỉ ${vol.toLocaleString()} HĐ — THANH KHOẢN RẤT THẤP, NGUY CƠ BẪY LÁI!`);
    } else {
      layer4Score += 6;
    }
  }
  score += Math.max(0, Math.min(15, layer4Score));

  // ═════════════════════════════════════════════════════════════
  // LỚP 5: BỐI CẢNH & 7 TRỤ ĐIỀU TIẾT — TỐI ĐA 20 ĐIỂM
  // (10đ Bối cảnh + 10đ Đồng thuận Trụ & Chống Kéo Trụ Ảo)
  // ═════════════════════════════════════════════════════════════
  let layer5Score = 0;

  // A. Khung Giờ & Bối Cảnh Phiên (10đ)
  if (marketContext) {
    if (marketContext.isOptimalTime) {
      layer5Score += 6;
      reasons.push('Khung giờ vàng thanh thoát (09:15-11:30) — Sóng mượt, biên chuẩn');
    } else if (marketContext.isAfternoonTrapZone) {
      layer5Score -= 4;
      warnings.push('⚠️ Phiên chiều nhạy cảm bẫy giật hai đầu — Đòi hỏi xác nhận đa khung');
    } else if (marketContext.shouldMaxProtection) {
      layer5Score -= 15;
      warnings.push('💀 VÙNG NGUY HIỂM (14h-14h25): Tránh vị thế mới, ưu tiên quản trị vốn');
    }

    // Basis F1 vs VN30
    if (marketContext.basis) {
      if (isLong && marketContext.basis.isBullish) {
        layer5Score += 4;
        reasons.push(`Basis thuận Long: ${marketContext.basis.text}`);
      } else if (!isLong && marketContext.basis.isBearish) {
        layer5Score += 4;
        reasons.push(`Basis thuận Short: ${marketContext.basis.text}`);
      }
    }
  }

  // B. Giám Sát 7 Mã Trụ: VIC, VPL, VHM, MCH, VCB, GAS, VJC (10đ)
  if (pillarAnalysis) {
    const { consensus, manipulationWarnings, divergenceWithF1 } = pillarAnalysis;

    if (isLong && (consensus === 'LONG' || consensus === 'STRONG_LONG')) {
      layer5Score += 10;
      reasons.push(`🏛️ 7 Trụ đồng thuận XANH (${pillarAnalysis.bullishCount}/7 mã) — Hậu thuẫn Long vững`);
    } else if (!isLong && (consensus === 'SHORT' || consensus === 'STRONG_SHORT')) {
      layer5Score += 10;
      reasons.push(`🏛️ 7 Trụ đồng thuận ĐỎ (${pillarAnalysis.bearishCount}/7 mã) — Hậu thuẫn Short vững`);
    } else if (consensus === 'CONFLICT') {
      layer5Score -= 3;
      warnings.push('⚡ Nhóm trụ điều tiết giằng co — Thị trường có hiện tượng giữ con này đạp con kia');
    }

    // Phạt nặng nếu phát hiện bẫy kéo trụ ảo hoặc phân kỳ với F1
    if (manipulationWarnings && manipulationWarnings.length > 0) {
      layer5Score -= 12;
      for (const mw of manipulationWarnings.slice(0, 2)) {
        warnings.push(mw);
      }
    }

    if (divergenceWithF1) {
      layer5Score -= 15;
      warnings.push('🚨 CẢNH BÁO BẪY: F1 đang chạy ngược chiều với phần lớn 7 mã trụ!');
    }
  }

  score += Math.max(0, Math.min(20, layer5Score));

  // ═════════════════════════════════════════════════════════════
  // CHUẨN HÓA ĐIỂM TIN CẬY & QUYẾT ĐỊNH
  // ═════════════════════════════════════════════════════════════
  const confidence = Math.max(0, Math.min(100, Math.round(score)));

  let level = 'LOW';
  let levelEmoji = '⚪';
  if (confidence >= 80) { level = 'HIGH'; levelEmoji = '🔥'; }
  else if (confidence >= 65) { level = 'MEDIUM'; levelEmoji = '⚡'; }
  else if (confidence >= 45) { level = 'LOW'; levelEmoji = '⚠️'; }
  else { level = 'VERY_LOW'; levelEmoji = '🚫'; }

  const criticalWarnings = warnings.filter(w => w.includes('🚨') || w.includes('💀'));
  const shouldTrade = confidence >= 60 && criticalWarnings.length === 0;
  const shouldAvoid = confidence < 50 || criticalWarnings.length > 0;

  return {
    confidence,
    level,
    levelEmoji,
    direction,
    setupType: setupInfo ? setupInfo.type : 'STANDARD',
    setupLabel: setupInfo ? setupInfo.label : 'Xung lực chuẩn',
    reasons: reasons.slice(0, 5),
    warnings: warnings.slice(0, 3),
    shouldTrade,
    shouldAvoid,
    criticalWarnings,
  };
}

// ─── DYNAMIC TRADE PLAN GENERATOR (ATR & Key Levels) ──────────
/**
 * Tạo kế hoạch vào lệnh / SL / TP thích ứng theo biên dao động thực tế
 * Không bao giờ dùng SL cố định phi lý
 */
function generateTradePlan(entry, direction, timeframe = '1M', options = {}) {
  const {
    atr = 2.0,
    keyLevels = [],
    liquidityMode = 'SCALP', // 'SCALP' (< 16k tỷ) hoặc 'TREND' (>= 16k tỷ)
    setupType = 'STANDARD',
  } = options;

  const isLong = direction === 'LONG';

  // 1. Tính toán khoảng cách SL dựa trên Key Level gần nhất hoặc ATR
  // Giới hạn an toàn: SL tối thiểu 1.8đ, tối đa 2.8đ MTL (chuẩn Playbook phái sinh VN)
  let slDistance = Math.max(1.8, Math.min(2.8, parseFloat((atr * 1.1).toFixed(1))));

  // Nếu có Key Level gần đó, đặt SL ngoài mức đó 0.6đ buffer
  if (keyLevels && keyLevels.length > 0) {
    if (isLong) {
      const nearestSupport = keyLevels.filter(l => l.price < entry).sort((a, b) => b.price - a.price)[0];
      if (nearestSupport && (entry - nearestSupport.price) <= 2.8) {
        slDistance = Math.max(1.8, Math.min(2.8, parseFloat((entry - nearestSupport.price + 0.6).toFixed(1))));
      }
    } else {
      const nearestResist = keyLevels.filter(l => l.price > entry).sort((a, b) => a.price - b.price)[0];
      if (nearestResist && (nearestResist.price - entry) <= 2.8) {
        slDistance = Math.max(1.8, Math.min(2.8, parseFloat((nearestResist.price - entry + 0.6).toFixed(1))));
      }
    }
  }

  // 2. Tính toán TP1 và TP2 theo chế độ thanh khoản
  let tp1Distance = 0;
  let tp2Distance = 0;

  if (liquidityMode === 'SCALP') {
    // Thị trường thanh khoản thấp (< 16k tỷ) → Ăn nhanh 3 - 5 điểm, bảo toàn vốn
    tp1Distance = parseFloat(Math.max(2.5, slDistance * 1.25).toFixed(1));
    tp2Distance = parseFloat(Math.max(4.5, slDistance * 2.2).toFixed(1));
  } else {
    // Thị trường thanh khoản tốt (>= 16k tỷ) → Cho phép gồng trend với Trailing Stop
    tp1Distance = parseFloat(Math.max(3.5, slDistance * 1.5).toFixed(1));
    tp2Distance = parseFloat(Math.max(7.0, slDistance * 3.0).toFixed(1));
  }

  const sl = isLong ? parseFloat((entry - slDistance).toFixed(1)) : parseFloat((entry + slDistance).toFixed(1));
  const tp1 = isLong ? parseFloat((entry + tp1Distance).toFixed(1)) : parseFloat((entry - tp1Distance).toFixed(1));
  const tp2 = isLong ? parseFloat((entry + tp2Distance).toFixed(1)) : parseFloat((entry - tp2Distance).toFixed(1));

  return {
    entry: parseFloat(entry.toFixed(1)),
    sl,
    tp1,
    tp2,
    slDistance,
    tp1Distance,
    tp2Distance,
    rr1: `1:${(tp1Distance / slDistance).toFixed(1)}`,
    rr2: `1:${(tp2Distance / slDistance).toFixed(1)}`,
    liquidityMode,
    scaleOutPct: 50,
    note: liquidityMode === 'SCALP'
      ? 'Thanh khoản thấp: Đạt TP1 dời SL về hòa vốn ngay, chủ động chốt hết tại TP2'
      : 'Thanh khoản tốt: Chốt 50% tại TP1, dời SL hòa vốn, gồng 50% còn lại theo Trailing Stop',
  };
}

// ─── SENIOR TRADER REASONING ────────────────────────────────
function buildSeniorReasoning(decision, candle, indicators, marketStructureData) {
  const reasons = [];

  if (marketStructureData && marketStructureData.trendBias) {
    reasons.push(`Cấu trúc thị trường: ${marketStructureData.trendBias} | Nến bám sát dải biên`);
  }

  if (decision && decision.reasons && decision.reasons.length > 0) {
    for (const r of decision.reasons) {
      if (!reasons.includes(r)) reasons.push(r);
    }
  }

  return reasons.slice(0, 3);
}

module.exports = {
  detectVSAPatterns,
  detectPlaybookSetup,
  calculateConfidence,
  generateTradePlan,
  buildSeniorReasoning,
};
