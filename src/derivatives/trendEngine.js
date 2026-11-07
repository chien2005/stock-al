/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📈 VN30F v9.0 — Multi-Timeframe Trend Engine                ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Phân tích cấu trúc xu hướng đa tầng (Monthly -> M1)          ║
 * ║  • EMA Ribbon: EMA20, EMA50, EMA200                         ║
 * ║  • Market Structure: Higher Highs/Lows vs Lower Highs/Lows     ║
 * ║  • HTF Dominance: Daily (40%) + H1 (30%) + M15 (20%) + M5/M1   ║
 * ║  • Master Regime: STRONG_BULL, STRONG_BEAR, RANGE_BOUND       ║
 * ║  • Ban List: CẤM SHORT CẢN TÀU, CẤM BẮT ĐÁY RƠI TỰ DO        ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── HELPER: TÍNH EMA ─────────────────────────────────────────
function calculateEMA(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [];

  // Khởi tạo SMA cho period đầu tiên
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  ema[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }

  return ema;
}

// ─── HELPER: TÍNH RSI(14) ────────────────────────────────────
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(1));
}

// ─── HELPER: TÍNH ATR(14) (BIÊN ĐỘ DAO ĐỘNG THỰC TẾ) ─────────
function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 5.0;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  let atr = sum / period;

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return parseFloat(atr.toFixed(2));
}

// ─── PHÂN TÍCH SWING HIGH / SWING LOW (CẤU TRÚC ĐỈNH ĐÁY) ────
function analyzeSwingStructure(candles) {
  if (!candles || candles.length < 10) {
    return {
      structureType: 'SIDEWAY',
      higherHighs: false,
      higherLows: false,
      lowerHighs: false,
      lowerLows: false,
      swingHigh: 0,
      swingLow: 0,
      label: 'Đang hình thành cấu trúc',
    };
  }

  const len = candles.length;
  const half = Math.floor(len / 2);

  const firstHalf = candles.slice(0, half);
  const secondHalf = candles.slice(half);

  const firstHigh = Math.max(...firstHalf.map(c => c.high));
  const firstLow = Math.min(...firstHalf.map(c => c.low));

  const secondHigh = Math.max(...secondHalf.map(c => c.high));
  const secondLow = Math.min(...secondHalf.map(c => c.low));

  const higherHighs = secondHigh > firstHigh + 0.8;
  const lowerHighs  = secondHigh < firstHigh - 0.8;
  const higherLows  = secondLow  > firstLow  + 0.8;
  const lowerLows   = secondLow  < firstLow  - 0.8;

  let structureType = 'SIDEWAY';
  let label = 'Sideway giằng co';

  if (higherHighs && higherLows) {
    structureType = 'UPTREND';
    label = `Nâng đỉnh nâng đáy (Swing Up: ${secondHigh.toFixed(1)} > ${firstHigh.toFixed(1)})`;
  } else if (lowerHighs && lowerLows) {
    structureType = 'DOWNTREND';
    label = `Hạ đỉnh hạ đáy (Swing Down: ${secondLow.toFixed(1)} < ${firstLow.toFixed(1)})`;
  } else if (higherHighs && lowerLows) {
    structureType = 'EXPANDING';
    label = 'Biên độ loe rộng (Kéo xả 2 đầu / Bẫy thanh khoản)';
  } else if (lowerHighs && higherLows) {
    structureType = 'TRIANGLE';
    label = 'Thu hẹp biên độ tam giác (Nén chờ bung nổ)';
  }

  return {
    structureType,
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    swingHigh: secondHigh,
    swingLow: secondLow,
    label,
  };
}

// ─── PHÂN TÍCH TỪNG KHUNG THỜI GIAN ĐỘC LẬP ──────────────────
function analyzeSingleTimeframe(candles, tfLabel = 'D1') {
  if (!candles || candles.length === 0) {
    return {
      tf: tfLabel,
      trend: 'NEUTRAL',
      score: 0,
      rsi: 50,
      atr: 5.0,
      close: 0,
      description: 'Chưa đủ nến dữ liệu',
    };
  }

  const closes = candles.map(c => c.close);
  const len = closes.length;
  const lastClose = closes[len - 1];

  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, 200);

  const ema20 = ema20Arr.length > 0 ? ema20Arr[ema20Arr.length - 1] : lastClose;
  const ema50 = ema50Arr.length > 0 ? ema50Arr[ema50Arr.length - 1] : lastClose;
  const ema200 = ema200Arr.length > 0 ? ema200Arr[ema200Arr.length - 1] : null;

  const rsi = calculateRSI(closes, 14);
  const atr = calculateATR(candles, 14);
  const structure = analyzeSwingStructure(candles);

  // Chấm điểm xu hướng từ -100 (Cực gấu) đến +100 (Cực bò)
  let score = 0;

  // 1. Vị trí giá so với EMA20 và EMA50
  if (lastClose > ema20) score += 25;
  else if (lastClose < ema20) score -= 25;

  if (lastClose > ema50) score += 20;
  else if (lastClose < ema50) score -= 20;

  // 2. Độ dốc và sắp xếp EMA (Golden Cross / Death Cross)
  if (ema20 > ema50) score += 20;
  else if (ema20 < ema50) score -= 20;

  if (ema200) {
    if (lastClose > ema200) score += 15;
    else if (lastClose < ema200) score -= 15;
  }

  // 3. Cấu trúc đỉnh đáy (Swing)
  if (structure.structureType === 'UPTREND') score += 20;
  else if (structure.structureType === 'DOWNTREND') score -= 20;

  // Phân loại xu hướng
  let trend = 'NEUTRAL';
  let badge = '⚪';
  if (score >= 60) {
    trend = 'STRONG_BULL';
    badge = '🟢🟢';
  } else if (score >= 20) {
    trend = 'WEAK_BULL';
    badge = '🟢';
  } else if (score <= -60) {
    trend = 'STRONG_BEAR';
    badge = '🔴🔴';
  } else if (score <= -20) {
    trend = 'WEAK_BEAR';
    badge = '🔴';
  } else {
    trend = 'RANGE_BOUND';
    badge = '🟡';
  }

  // Đo độ quá mua / quá bán (Mean Reversion Risk)
  const distEma20 = parseFloat((lastClose - ema20).toFixed(1));
  let stretchWarning = null;
  if (distEma20 > atr * 2.0) {
    stretchWarning = `Giá rướn quá xa EMA20 (+${distEma20}đ > 2*ATR). Dễ có nhịp giũ võng điều chỉnh.`;
  } else if (distEma20 < -atr * 2.0) {
    stretchWarning = `Giá chiết khấu quá xa EMA20 (${distEma20}đ < -2*ATR). Dễ có nhịp kéo hồi kỹ thuật.`;
  }

  return {
    tf: tfLabel,
    trend,
    badge,
    score,
    close: lastClose,
    ema20: parseFloat(ema20.toFixed(1)),
    ema50: parseFloat(ema50.toFixed(1)),
    ema200: ema200 ? parseFloat(ema200.toFixed(1)) : null,
    distEma20,
    rsi,
    atr,
    structure,
    stretchWarning,
    description: `${badge} ${trend} | Giá ${lastClose} (EMA20: ${ema20.toFixed(1)} | RSI: ${rsi}) | ${structure.label}`,
  };
}

// ─── TỔNG HỢP REGIME ĐA KHUNG THEO NGUYÊN TẮC QUỸ ĐẦU TƯ ─────
/**
 * Phân cấp trọng số:
 * • Daily (40%): Định vị xu hướng lớn của chu kỳ
 * • H1 (30%): Khung cấu trúc lệnh chiến lược
 * • M15 (20%): Khung kích hoạt vị thế / bẫy giá
 * • M5 / M1 (10%): Khung tối ưu giá khớp
 */
function analyzeMultiTimeframeTrend(mtfData) {
  const monthly = analyzeSingleTimeframe(mtfData.monthly, 'Monthly');
  const weekly  = analyzeSingleTimeframe(mtfData.weekly, 'Weekly');
  const daily   = analyzeSingleTimeframe(mtfData.daily, 'Daily');
  const h4      = analyzeSingleTimeframe(mtfData.h4, 'H4');
  const h1      = analyzeSingleTimeframe(mtfData.h1, 'H1');
  const m15     = analyzeSingleTimeframe(mtfData.m15, 'M15');
  const m5      = analyzeSingleTimeframe(mtfData.m5, 'M5');
  const m1      = analyzeSingleTimeframe(mtfData.m1, 'M1');

  // Điểm composite có trọng số
  const compositeScore = Math.round(
    daily.score * 0.40 +
    h1.score    * 0.30 +
    m15.score   * 0.20 +
    m5.score    * 0.10
  );

  let masterRegime = 'SIDEWAY_NEUTRAL';
  let primaryDirective = 'QUAN SÁT CHỜ VÙNG CỰC TRỊ';
  let allowedOperations = ['RANGE_SCALP'];
  let forbiddenAction = 'CẤM MỞ LỆNH Ở VÙNG GIỮA RANGE';

  if (compositeScore >= 45) {
    masterRegime = 'BULLISH_SWING_REGIME';
    primaryDirective = '🟢 ƯU TIÊN SĂN SETUP SWING LONG (R:R ≥ 1:3)';
    allowedOperations = ['SWING_LONG', 'PULLBACK_LONG'];
    forbiddenAction = '🛑 TUYỆT ĐỐI CẤM SHORT CẢN TÀU KHI KHUNG LỚN ĐANG UPTREND';
  } else if (compositeScore <= -45) {
    masterRegime = 'BEARISH_SWING_REGIME';
    primaryDirective = '🔴 ƯU TIÊN SĂN SETUP SWING SHORT (R:R ≥ 1:3)';
    allowedOperations = ['SWING_SHORT', 'BOUNCE_SHORT'];
    forbiddenAction = '🛑 TUYỆT ĐỐI CẤM BẮT ĐÁY LONG KHI KHUNG LỚN ĐANG DOWNTREND';
  } else {
    masterRegime = 'RANGE_BOUND_REGIME';
    primaryDirective = '↔️ THỊ TRƯỜNG TÍCH LŨY BIÊN ĐỘ (CANH 2 ĐẦU)';
    allowedOperations = ['BUY_LOW_AT_SUPPORT', 'SELL_HIGH_AT_RESISTANCE'];
    forbiddenAction = '🛑 CẤM FOMO ĐUA LỆNH BREAKOUT TRONG VÙNG SIDEWAY';
  }

  // Khuyến nghị hành động của Trưởng phòng Phân tích
  let executiveSummary = '';
  if (masterRegime === 'BULLISH_SWING_REGIME') {
    executiveSummary = `Cấu trúc Daily (+${daily.score}) và H1 (+${h1.score}) đồng thuận UPTREND. Chỉ canh các nhịp võng retest hỗ trợ để mở vị thế Long lớn. Giữ lệnh gồng theo sóng, không chốt non vài điểm.`;
  } else if (masterRegime === 'BEARISH_SWING_REGIME') {
    executiveSummary = `Cấu trúc Daily (${daily.score}) và H1 (${h1.score}) đồng thuận DOWNTREND. Áp lực bán chi phối. Mọi nhịp kéo hồi chỉ là cơ hội để mở Short thuận xu hướng lớn.`;
  } else {
    executiveSummary = `Thị trường đang trong biên độ giằng co tích lũy (Composite: ${compositeScore}). Kiên nhẫn chờ giá chạm hẳn Biên Dưới hoặc Biên Trên của khung H1 mới hành động. Không đánh ở vùng lơ lửng.`;
  }

  return {
    symbol: mtfData.symbol,
    currentPrice: mtfData.currentPrice,
    compositeScore,
    masterRegime,
    regime: masterRegime,
    primaryDirective,
    allowedOperations,
    forbiddenAction,
    executiveSummary,
    details: {
      monthly,
      weekly,
      daily,
      h4,
      h1,
      m15,
      m5,
      m1,
    },
    lastUpdated: Date.now(),
  };
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateATR,
  analyzeSwingStructure,
  analyzeSingleTimeframe,
  analyzeMultiTimeframeTrend,
  analyzeMultiTimeframe: analyzeMultiTimeframeTrend,
};
