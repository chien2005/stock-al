/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🌡️ VN30F v4.0 — LỚP 6: Regime Engine                    ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  8 Regime types: Nhận diện Xu hướng rõ ràng & quyết đoán     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');

/**
 * Phân loại Regime thị trường
 */
function classifyRegime({ priceMap, flowResult, breadthResult, efficiencyResult, velocityResult, liquidityResult }) {
  const expiryMode = detectExpiryMode();

  const currentPrice = priceMap ? priceMap.currentPrice : null;
  const vwap = priceMap ? priceMap.vwap : null;
  const ema20 = priceMap ? priceMap.ema20 : null;
  const waveStructure = priceMap ? priceMap.waveStructure : 'NEUTRAL';
  const trendBias = priceMap ? priceMap.trendBias : 'NEUTRAL';
  const structuralBreak = priceMap ? priceMap.structuralBreak : null;

  const cvdDirection = flowResult ? flowResult.cvd.direction : 'FLAT';
  const cvdDivergence = flowResult ? flowResult.cvd.divergence : null;
  const dominant = flowResult && flowResult.aggression ? flowResult.aggression.dominant : 'BALANCED';

  // ─── 1. BẪY GIÁ RỒI XẢ HÀNG (TRAP THEN TREND DOWN) ────────
  if (structuralBreak === 'FAILED_BREAKOUT_BEARISH' || (cvdDivergence === 'BEARISH_DIVERGENCE' && currentPrice < (vwap || 9999))) {
    return {
      regime: 'TREND_DOWN',
      confidence: 82,
      description: 'BẪY VƯỢT ĐỈNH THẤT BẠI → Xu hướng GIẢM (Phe Bán kiểm soát)',
      expiryMode,
    };
  }

  // ─── 2. DOWNTREND RÕ RÀNG (TREND_DOWN) ────────────────────
  if (
    (trendBias === 'BEARISH') ||
    (currentPrice && vwap && currentPrice < vwap - 1.5 && cvdDirection === 'FALLING') ||
    (currentPrice && vwap && currentPrice < vwap && waveStructure === 'LOWER_HIGHS_LOWER_LOWS') ||
    (currentPrice && ema20 && currentPrice < ema20 - 1.0 && dominant === 'SELLERS')
  ) {
    let desc = 'Xu hướng GIẢM RÕ RỆT — Giá dưới VWAP, phe Bán ép cản';
    if (waveStructure === 'LOWER_HIGHS_LOWER_LOWS') desc += ' (Cấu trúc Đỉnh/Đáy thấp dần)';
    return {
      regime: 'TREND_DOWN',
      confidence: 80,
      description: desc,
      expiryMode,
    };
  }

  // ─── 3. UPTREND RÕ RÀNG (TREND_UP) ────────────────────────
  if (
    (trendBias === 'BULLISH') ||
    (currentPrice && vwap && currentPrice > vwap + 1.5 && cvdDirection === 'RISING') ||
    (currentPrice && vwap && currentPrice > vwap && waveStructure === 'HIGHER_HIGHS_HIGHER_LOWS') ||
    (currentPrice && ema20 && currentPrice > ema20 + 1.0 && dominant === 'BUYERS')
  ) {
    let desc = 'Xu hướng TĂNG RÕ RỆT — Giá trên VWAP, phe Mua kiểm soát';
    if (waveStructure === 'HIGHER_HIGHS_HIGHER_LOWS') desc += ' (Cấu trúc Đỉnh/Đáy cao dần)';
    return {
      regime: 'TREND_UP',
      confidence: 80,
      description: desc,
      expiryMode,
    };
  }

  // ─── 4. ĐỒNG THUẬN TĂNG/GIẢM TOÀN BỘ VN30 ─────────────────
  if (breadthResult && breadthResult.synchronizedMove === 'SYNC_BEAR') {
    return {
      regime: 'TREND_DOWN',
      confidence: 85,
      description: 'Toàn bộ rổ VN30 đồng loạt Giảm mạnh (Sóng xả toàn thị trường)',
      expiryMode,
    };
  }
  if (breadthResult && breadthResult.synchronizedMove === 'SYNC_BULL') {
    return {
      regime: 'TREND_UP',
      confidence: 85,
      description: 'Toàn bộ rổ VN30 đồng loạt Tăng mạnh (Sóng kéo toàn thị trường)',
      expiryMode,
    };
  }

  // ─── 5. THANH KHOẢN CẠN ───────────────────────────────────
  if (liquidityResult && liquidityResult.regime === 'CẠN') {
    return {
      regime: 'LIQUIDITY_VACUUM',
      confidence: 65,
      description: 'Thanh khoản thị trường cạn kiệt — Biến động thấp, chờ dòng tiền',
      expiryMode,
    };
  }

  // ─── 6. RANGE (DAO ĐỘNG TRONG BIÊN) ───────────────────────
  return {
    regime: 'RANGE',
    confidence: 60,
    description: 'Thị trường đi ngang trong biên — Giá dao động quanh trục cân bằng',
    expiryMode,
  };
}

/**
 * Phát hiện ngày đáo hạn phái sinh VN30F
 */
function detectExpiryMode() {
  const vnTime = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const year = vnTime.getFullYear();
  const month = vnTime.getMonth();

  const expiryDate = _getThirdThursday(year, month);
  const today = new Date(year, month, vnTime.getDate());
  const diffDays = Math.round((expiryDate - today) / (86400 * 1000));

  let mode = 'NORMAL';
  let isExpiry = false;

  if (diffDays === 0) { mode = 'EXPIRY'; isExpiry = true; }
  else if (diffDays === 1) { mode = 'T-1'; isExpiry = false; }
  else if (diffDays === 2) { mode = 'T-2'; }
  else if (diffDays === 3) { mode = 'T-3'; }
  else if (diffDays <= 5 && diffDays > 0) { mode = 'T-5'; }

  return {
    mode,
    isExpiry,
    daysToExpiry: diffDays,
    expiryDate: expiryDate.toLocaleDateString('vi-VN'),
  };
}

function _getThirdThursday(year, month) {
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay();
  let firstThursday = 1 + ((4 - dayOfWeek + 7) % 7);
  const thirdThursday = firstThursday + 14;
  return new Date(year, month, thirdThursday);
}

module.exports = {
  classifyRegime,
  detectExpiryMode,
};
