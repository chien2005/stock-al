/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧠 VN30F v6.0 — Market Context Engine                      ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Phân tích bối cảnh thị trường — Trader thật luôn đọc bối   ║
 * ║  cảnh trước khi vào lệnh!                                   ║
 * ║                                                                ║
 * ║  • 6 Khung giờ vàng (Session Intelligence)                   ║
 * ║  • Basis Analysis (Premium/Discount vs VN30 Index)           ║
 * ║  • Cung cầu NN/Tự Doanh/Đám đông (Supply-Demand)            ║
 * ║  • Session Risk Level (tự động nâng cảnh giác)               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');

// ─── 6 KHUNG GIỜ VÀNG TRONG PHIÊN ──────────────────────────
const SESSIONS = [
  {
    id: 'ATO',
    start: '08:45', end: '09:00',
    name: 'ATO — Khớp lệnh mở cửa',
    riskLevel: 'EXTREME',
    strategy: 'ĐỨNG NGOÀI QUAN SÁT. CẤM mở vị thế.',
    description: '99% volume là kỹ thuật. GAP ảo dụ Long/Short.',
    emoji: '🚫',
  },
  {
    id: 'EARLY_OPEN',
    start: '09:00', end: '09:15',
    name: '09:00-09:15 — Thăm dò sau ATO',
    riskLevel: 'HIGH',
    strategy: 'QUAN SÁT, CHỜ ĐẾN 09:15. Lái đang test cung cầu, kiểm tra GAP.',
    description: 'Biên độ co giật, tránh vào lệnh sớm để không bị quét SL.',
    emoji: '⏳',
  },
  {
    id: 'MORNING_PRIME',
    start: '09:15', end: '11:30',
    name: '09:15-11:30 — SÓNG SÁNG VÀNG (TẬP TRUNG CAO ĐỘ)',
    riskLevel: 'LOW',
    strategy: '🎯 KHUNG GIỜ CẦN TẬP TRUNG NHẤT! Đoán đúng xu hướng ăn điểm không khó như chiều. Sóng mượt, thanh khoản tổ chức thật.',
    description: 'Xu hướng chính hình thành rõ ràng, ít bẫy nhiễu, cơ hội ăn biên lớn tốt nhất ngày.',
    emoji: '🔥',
    isOptimal: true,
  },
  {
    id: 'AFTERNOON_SESSION',
    start: '13:00', end: '14:00',
    name: '13:00-14:00 — Phiên chiều (CẢNH GIÁC BẪY LÁI / BULL TRAP)',
    riskLevel: 'HIGH',
    strategy: '⚠️ CẢNH GIÁC CAO ĐỘ! Chiều rất dễ tạo Bull Trap dụ Long hoặc đạp bất ngờ. Chỉ vào lệnh khi Volume thực sự đạt chuẩn!',
    description: 'Biến động giật cục, lái hay vẽ nến dụ đám đông, cạm bẫy nhiều hơn phiên sáng.',
    emoji: '⚡',
  },
  {
    id: 'DEATH_ZONE',
    start: '14:00', end: '14:25',
    name: '14:00-14:25 — VÙNG TỬ THẦN (ĐẠP THỦNG 15-20Đ / CALL MARGIN)',
    riskLevel: 'EXTREME',
    strategy: '💀 BẢO VỆ TỐI ĐA! Chiều rất dễ đạp thủng 15-20đ hoặc hơn trong vài giây. Fast Tick 5s trực chiến bắt Flash Crash!',
    description: 'Call Margin 14h15-14h17 và xả kho khốc liệt. Tuyệt đối không gồng lỗ dao rơi!',
    emoji: '💀',
    isCallMarginZone: true,
  },
  {
    id: 'ATC',
    start: '14:25', end: '14:45',
    name: 'ATC — Đóng cửa',
    riskLevel: 'HIGH',
    strategy: 'Đóng sạch vị thế trước 14h28 nếu đánh intraday. Cầm qua đêm chỉ khi có lãi đệm dày.',
    description: 'Lái định hình điểm đóng nến ngày.',
    emoji: '🌙',
  },
];

// ─── SESSION INTELLIGENCE ───────────────────────────────────
function getCurrentSession(timeHHMM) {
  if (!timeHHMM) {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
    timeHHMM = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  for (const session of SESSIONS) {
    if (timeHHMM >= session.start && timeHHMM < session.end) {
      return session;
    }
  }

  // Giữa trưa
  if (timeHHMM >= '11:30' && timeHHMM < '13:00') {
    return {
      id: 'LUNCH_BREAK',
      start: '11:30', end: '13:00',
      name: 'Nghỉ trưa',
      riskLevel: 'EXTREME',
      strategy: 'ĐỨNG NGOÀI. Không giao dịch khi không có volume.',
      description: 'Thanh khoản kiệt quệ. Lái quay tay vẽ nến.',
      emoji: '🍜',
    };
  }

  return null;
}

/**
 * Kiểm tra có đang trong vùng Call Margin nguy hiểm nhất (14h15-14h17)
 */
function isCallMarginPeak(timeHHMM) {
  return timeHHMM >= '14:15' && timeHHMM <= '14:17';
}

/**
 * Kiểm tra có đang trong Death Zone (14h00-14h25)
 */
function isDeathZone(timeHHMM) {
  return timeHHMM >= '14:00' && timeHHMM <= '14:25';
}

/**
 * Lấy Risk Level adjustment cho thời điểm hiện tại
 * Trả về hệ số nhân risk: 1.0 = bình thường, 1.5 = cảnh giác, 2.0 = cực cao
 */
function getSessionRiskMultiplier(timeHHMM) {
  if (isCallMarginPeak(timeHHMM)) return 2.5;
  if (isDeathZone(timeHHMM)) return 2.0;

  const session = getCurrentSession(timeHHMM);
  if (!session) return 1.0;

  const riskMap = {
    'LOW': 0.8,
    'MEDIUM': 1.0,
    'HIGH': 1.3,
    'EXTREME': 2.0,
  };
  return riskMap[session.riskLevel] || 1.0;
}

// ─── BASIS ANALYSIS ─────────────────────────────────────────
/**
 * Phân tích độ lệch Basis giữa F1M và VN30 Index
 * 
 * Basis = F1M - VN30 Index
 * Premium (Basis > 0): Thị trường kỳ vọng tăng
 * Discount (Basis < 0): Thị trường kỳ vọng giảm
 * 
 * Ngưỡng:
 * - |Basis| < 1.0: Cân bằng
 * - |Basis| 1.0-3.0: Nghiêng nhẹ
 * - |Basis| > 3.0: Lệch mạnh → Cảnh báo mean reversion
 */
function analyzeBasis(f1mPrice, vn30Price) {
  if (!f1mPrice || !vn30Price) return null;

  const basis = f1mPrice - vn30Price;
  const absBasis = Math.abs(basis);
  const basisPct = (basis / vn30Price * 100);

  let description = '';
  let sentiment = 'NEUTRAL';
  let warning = '';

  if (absBasis < 1.0) {
    description = 'Cân bằng (thị trường giằng co)';
    sentiment = 'NEUTRAL';
  } else if (basis > 0 && basis <= 3.0) {
    description = `Premium +${basis.toFixed(1)}đ (kỳ vọng tăng nhẹ)`;
    sentiment = 'BULLISH';
  } else if (basis > 3.0) {
    description = `Premium cao +${basis.toFixed(1)}đ`;
    sentiment = 'BULLISH_EXTREME';
    warning = '⚠️ Basis Premium quá cao → Risk mean reversion đạp về!';
  } else if (basis < 0 && basis >= -3.0) {
    description = `Discount ${basis.toFixed(1)}đ (kỳ vọng giảm nhẹ)`;
    sentiment = 'BEARISH';
  } else if (basis < -3.0) {
    description = `Discount sâu ${basis.toFixed(1)}đ`;
    sentiment = 'BEARISH_EXTREME';
    warning = '⚠️ Basis Discount quá sâu → Risk bật ngược hồi phục!';
  }

  return {
    basis: Number(basis.toFixed(1)),
    basisPct: Number(basisPct.toFixed(2)),
    description,
    sentiment,
    warning,
    isBullish: sentiment.startsWith('BULLISH'),
    isBearish: sentiment.startsWith('BEARISH'),
    isExtreme: sentiment.includes('EXTREME'),
    text: `Basis: ${basis >= 0 ? '+' : ''}${basis.toFixed(1)}đ (${basisPct >= 0 ? '+' : ''}${basisPct.toFixed(2)}%) — ${description}`,
  };
}

// ─── SUPPLY-DEMAND ANALYZER ─────────────────────────────────
/**
 * Phân tích cung cầu từ dữ liệu OI
 * 
 * NN Long ròng → Smart Money đặt cược LONG
 * NN Short ròng → Smart Money đặt cược SHORT
 * TD đối ứng NN → Hedging (bình thường)
 * Đám đông ngược NN → Đám đông thường sai
 */
function analyzeSupplyDemand(oiData) {
  if (!oiData) return null;

  const nnNet = (oiData.foreignBuy || 0) - (oiData.foreignSell || 0);
  const nnBuy = oiData.foreignBuy || 0;
  const nnSell = oiData.foreignSell || 0;
  const totalVol = oiData.totalVolume || 0;
  const totalOI = oiData.totalOI || 0;

  // NN Sentiment
  let nnSentiment = 'NEUTRAL';
  let nnDesc = '';
  if (nnNet > 500) {
    nnSentiment = 'STRONG_LONG';
    nnDesc = `NN Long ròng mạnh +${nnNet.toLocaleString()} HĐ — Smart Money đặt cược TĂNG`;
  } else if (nnNet > 200) {
    nnSentiment = 'LONG';
    nnDesc = `NN Long ròng +${nnNet.toLocaleString()} HĐ — Nghiêng về phe Mua`;
  } else if (nnNet < -500) {
    nnSentiment = 'STRONG_SHORT';
    nnDesc = `NN Short ròng mạnh ${nnNet.toLocaleString()} HĐ — Smart Money đặt cược GIẢM`;
  } else if (nnNet < -200) {
    nnSentiment = 'SHORT';
    nnDesc = `NN Short ròng ${nnNet.toLocaleString()} HĐ — Nghiêng về phe Bán`;
  } else {
    nnDesc = `NN cân bằng (${nnNet >= 0 ? '+' : ''}${nnNet.toLocaleString()} HĐ) — Chưa rõ ý đồ`;
  }

  // Thanh khoản mỏng hay dày
  let liquidityLevel = 'NORMAL';
  let liquidityDesc = '';
  if (totalVol > 0) {
    if (totalVol < 30000) {
      liquidityLevel = 'THIN';
      liquidityDesc = 'Thanh khoản MỎNG — Cẩn trọng bẫy lái!';
    } else if (totalVol < 60000) {
      liquidityLevel = 'NORMAL';
      liquidityDesc = 'Thanh khoản bình thường';
    } else {
      liquidityLevel = 'THICK';
      liquidityDesc = 'Thanh khoản DÀY — Sóng lớn đang hình thành';
    }
  }

  return {
    nnNet,
    nnBuy,
    nnSell,
    nnSentiment,
    nnDesc,
    totalVol,
    totalOI,
    liquidityLevel,
    liquidityDesc,
    isNNBullish: nnSentiment.includes('LONG'),
    isNNBearish: nnSentiment.includes('SHORT'),
  };
}

// ─── COMPREHENSIVE MARKET CONTEXT ───────────────────────────
/**
 * Xây dựng bối cảnh thị trường toàn diện
 * Gọi hàm này trước MỌI quyết định giao dịch
 */
function buildMarketContext(f1mPrice, vn30Price, oiData, timeHHMM) {
  const session = getCurrentSession(timeHHMM);
  const basis = analyzeBasis(f1mPrice, vn30Price);
  const supplyDemand = analyzeSupplyDemand(oiData);
  const riskMultiplier = getSessionRiskMultiplier(timeHHMM);
  const isCallMargin = isCallMarginPeak(timeHHMM);
  const isDeath = isDeathZone(timeHHMM);

  // Tổng hợp sentiment
  let overallSentiment = 'NEUTRAL';
  let sentimentScore = 0; // -100 to +100

  if (basis) {
    if (basis.isBullish) sentimentScore += basis.isExtreme ? 25 : 15;
    if (basis.isBearish) sentimentScore -= basis.isExtreme ? 25 : 15;
  }

  if (supplyDemand) {
    if (supplyDemand.isNNBullish) sentimentScore += supplyDemand.nnSentiment === 'STRONG_LONG' ? 30 : 15;
    if (supplyDemand.isNNBearish) sentimentScore -= supplyDemand.nnSentiment === 'STRONG_SHORT' ? 30 : 15;
  }

  if (sentimentScore >= 25) overallSentiment = 'BULLISH';
  else if (sentimentScore >= 10) overallSentiment = 'LEAN_BULLISH';
  else if (sentimentScore <= -25) overallSentiment = 'BEARISH';
  else if (sentimentScore <= -10) overallSentiment = 'LEAN_BEARISH';

  return {
    session,
    basis,
    supplyDemand,
    riskMultiplier,
    isCallMargin,
    isDeath,
    overallSentiment,
    sentimentScore,
    // Helper flags
    shouldBlockEntry: !session || session.riskLevel === 'EXTREME',
    shouldMaxProtection: isDeath || isCallMargin,
    isOptimalTime: session && (session.id === 'MORNING_PRIME' || session.id === 'MORNING_WAVE'),
    isAfternoonTrapZone: session && session.id === 'AFTERNOON_SESSION',
  };
}

// ─── TEXT BUILDERS ──────────────────────────────────────────
/**
 * Build context text ngắn gọn cho notification (2-3 dòng)
 */
function buildContextSummary(context) {
  if (!context) return '';

  const lines = [];

  // Session
  if (context.session) {
    lines.push(`${context.session.emoji} ${context.session.name}`);
  }

  // Basis
  if (context.basis) {
    lines.push(`📐 ${context.basis.text}`);
    if (context.basis.warning) lines.push(context.basis.warning);
  }

  // NN
  if (context.supplyDemand) {
    lines.push(`🌐 ${context.supplyDemand.nnDesc}`);
    if (context.supplyDemand.liquidityLevel === 'THIN') {
      lines.push(`⚠️ ${context.supplyDemand.liquidityDesc}`);
    }
  }

  // Afternoon trap warning
  if (context.session && context.session.id === 'AFTERNOON_SESSION') {
    lines.push(`⚠️ PHIÊN CHIỀU: Cực kỳ dễ Bull Trap / Đạp bẫy! Cần Vol chuẩn.`);
  }

  // Call Margin & Death Zone
  if (context.isCallMargin) {
    lines.push(`💀 ĐẶC BIỆT NGUY HIỂM: ĐÚNG GIỜ CALL MARGIN 14h15-14h17!`);
  } else if (context.isDeath) {
    lines.push(`💀 VÙNG TỬ THẦN 14h-14h25 — Dễ đạp thủng 15-20đ trong vài giây!`);
  }

  return lines.join('\n');
}

module.exports = {
  SESSIONS,
  getCurrentSession,
  isCallMarginPeak,
  isDeathZone,
  getSessionRiskMultiplier,
  analyzeBasis,
  analyzeSupplyDemand,
  buildMarketContext,
  buildContextSummary,
};
