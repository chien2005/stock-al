/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🌡️ VN30F v4.0 — LỚP 6: Regime Engine                    ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  8 Regime types + Expiry Mode tự động                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');

/**
 * Phân loại Regime thị trường
 * 8 trạng thái:
 *   TREND_UP, TREND_DOWN, RANGE, TREND_FROM_OPEN,
 *   TRAP_THEN_TREND, TWO_SIDED_CHOP, LIQUIDITY_VACUUM, EXPIRY_DISTORTION
 */
function classifyRegime({ priceMap, flowResult, breadthResult, efficiencyResult, velocityResult, liquidityResult }) {
  let regime = 'RANGE';
  let confidence = 50;
  let description = '';

  const efficiency = efficiencyResult ? efficiencyResult.value : 0.5;
  const velocity = velocityResult ? velocityResult.current : 0;
  const isImpulse = velocityResult ? velocityResult.isImpulse : false;
  const breadthTrend = breadthResult ? breadthResult.acceleration.trend : 'STABLE';
  const liqRegime = liquidityResult ? liquidityResult.regime : 'NORMAL';
  const trapDetected = breadthResult ? breadthResult.trap.detected : null;
  const syncMove = breadthResult ? breadthResult.synchronizedMove : null;

  // Current price vs VWAP
  const currentPrice = priceMap ? priceMap.currentPrice : null;
  const vwap = priceMap ? priceMap.vwap : null;
  const aboveVWAP = currentPrice && vwap ? currentPrice > vwap : null;

  // ─── EXPIRY CHECK (ưu tiên cao nhất) ──────────────
  const expiryMode = detectExpiryMode();
  if (expiryMode.isExpiry || expiryMode.mode === 'T-1' || expiryMode.mode === 'EXPIRY') {
    regime = 'EXPIRY_DISTORTION';
    confidence = 75;
    description = `Ngày đáo hạn / cận đáo hạn (${expiryMode.mode}) — Tín hiệu dễ nhiễu`;
    return { regime, confidence, description, expiryMode };
  }

  // ─── LIQUIDITY VACUUM ─────────────────────────────
  if (liqRegime === 'CẠN' && velocity < 0.5) {
    regime = 'LIQUIDITY_VACUUM';
    confidence = 70;
    description = 'Thanh khoản cạn, biến động thấp — Tín hiệu không đáng tin';
    return { regime, confidence, description, expiryMode };
  }

  // ─── TWO-SIDED CHOP ───────────────────────────────
  if (efficiency < 0.25 && velocity > 0.5) {
    regime = 'TWO_SIDED_CHOP';
    confidence = 65;
    description = 'Đấu giá 2 chiều mạnh — Không có hướng rõ ràng, tránh giao dịch';
    return { regime, confidence, description, expiryMode };
  }

  // ─── TRAP THEN TREND ──────────────────────────────
  if (trapDetected && syncMove) {
    regime = 'TRAP_THEN_TREND';
    confidence = 72;
    description = `Bẫy ${trapDetected === 'TRAP_LONG' ? 'Long' : 'Short'} → Trend thật theo chiều ngược lại`;
    return { regime, confidence, description, expiryMode };
  }

  // ─── TREND FROM OPEN ──────────────────────────────
  if (efficiency >= 0.7 && isImpulse && priceMap && priceMap.todayRange.open) {
    const moveFromOpen = currentPrice - priceMap.todayRange.open;
    if (Math.abs(moveFromOpen) >= 8) {
      regime = moveFromOpen > 0 ? 'TREND_UP' : 'TREND_DOWN';
      confidence = 80;
      description = `Trend mạnh từ mở cửa (${moveFromOpen > 0 ? '+' : ''}${moveFromOpen.toFixed(1)} điểm)`;
      // Kiểm tra thêm: nếu CHƯA có pullback lớn
      if (efficiency >= 0.8) {
        regime = moveFromOpen > 0 ? 'TREND_UP' : 'TREND_DOWN';
        description = `TREND FROM OPEN — ${moveFromOpen > 0 ? 'Tăng' : 'Giảm'} mạnh liên tục không hồi`;
      }
      return { regime, confidence, description, expiryMode };
    }
  }

  // ─── TREND UP ─────────────────────────────────────
  if (aboveVWAP && efficiency >= 0.5 && breadthTrend === 'IMPROVING') {
    regime = 'TREND_UP';
    confidence = 70;
    description = 'Xu hướng TĂNG — Giá trên VWAP, breadth đang cải thiện';
    return { regime, confidence, description, expiryMode };
  }

  // ─── TREND DOWN ───────────────────────────────────
  if (aboveVWAP === false && efficiency >= 0.5 && breadthTrend === 'DETERIORATING') {
    regime = 'TREND_DOWN';
    confidence = 70;
    description = 'Xu hướng GIẢM — Giá dưới VWAP, breadth đang xấu đi';
    return { regime, confidence, description, expiryMode };
  }

  // ─── SYNCHRONIZED MOVES ───────────────────────────
  if (syncMove === 'SYNC_BULL') {
    regime = 'TREND_UP';
    confidence = 75;
    description = 'Toàn thị trường đồng loạt TĂNG MẠNH — Uptrend thật';
    return { regime, confidence, description, expiryMode };
  }
  if (syncMove === 'SYNC_BEAR') {
    regime = 'TREND_DOWN';
    confidence = 75;
    description = 'Toàn thị trường đồng loạt GIẢM MẠNH — Downtrend thật';
    return { regime, confidence, description, expiryMode };
  }

  // ─── RANGE (default) ──────────────────────────────
  regime = 'RANGE';
  confidence = 55;
  description = 'Dao động vùng giá — Chưa có trend rõ ràng';

  return { regime, confidence, description, expiryMode };
}

/**
 * Phát hiện ngày đáo hạn phái sinh VN30F
 * Đáo hạn: Thứ 5 tuần thứ 3 hàng tháng
 * Trả về: NORMAL, T-5, T-3, T-2, T-1, EXPIRY
 */
function detectExpiryMode() {
  const vnTime = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const year = vnTime.getFullYear();
  const month = vnTime.getMonth(); // 0-indexed

  // Tìm thứ 5 tuần thứ 3
  const expiryDate = _getThirdThursday(year, month);
  const today = new Date(year, month, vnTime.getDate());
  const diffDays = Math.round((expiryDate - today) / (86400 * 1000));

  let mode = 'NORMAL';
  let isExpiry = false;
  let confidenceModifier = 0;

  if (diffDays === 0) { mode = 'EXPIRY'; isExpiry = true; confidenceModifier = -20; }
  else if (diffDays === 1) { mode = 'T-1'; isExpiry = false; confidenceModifier = -15; }
  else if (diffDays === 2) { mode = 'T-2'; confidenceModifier = -10; }
  else if (diffDays === 3) { mode = 'T-3'; confidenceModifier = -5; }
  else if (diffDays <= 5 && diffDays > 0) { mode = 'T-5'; confidenceModifier = -3; }

  return {
    mode,
    isExpiry,
    daysToExpiry: diffDays,
    expiryDate: expiryDate.toLocaleDateString('vi-VN'),
    confidenceModifier,
  };
}

function _getThirdThursday(year, month) {
  // Tìm ngày 1 của tháng
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay(); // 0=CN, 4=Thứ 5

  // Thứ 5 đầu tiên
  let firstThursday = 1 + ((4 - dayOfWeek + 7) % 7);
  // Thứ 5 tuần thứ 3
  const thirdThursday = firstThursday + 14;

  return new Date(year, month, thirdThursday);
}

module.exports = {
  classifyRegime,
  detectExpiryMode,
};
