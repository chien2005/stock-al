/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔄 VN30F v4.0 — LỚP 2: Test/Retest + Acceptance Engine   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Đếm test vùng giá, đánh giá rejection strength,            ║
 * ║  phân biệt Acceptance vs Excursion                           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');

/**
 * Phân tích Test/Retest cho các key levels
 * @param {Object} intradayData - Data intraday 1 phút F1M
 * @param {Array} keyLevels - Mảng { price, type, label } từ Market Structure
 * @returns {Array} testResults cho mỗi level
 */
function analyzeTests(intradayData, keyLevels) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 10 || !keyLevels || keyLevels.length === 0) {
    return [];
  }

  const { h, l, c, v, t } = intradayData;
  const highs = h || c;
  const lows = l || c;
  const todayStart = _getTodayStartTs(t);

  const results = [];
  const TOUCH_ZONE = 2.0; // ±2 điểm = 1 test
  const COOLDOWN_BARS = 5; // 5 nến (5 phút) giữa 2 test

  for (const level of keyLevels) {
    if (!level.price) continue;

    const tests = [];
    let lastTestBar = -COOLDOWN_BARS - 1;

    for (let i = 1; i < c.length; i++) {
      if (t && t[i] < todayStart) continue;
      if (i - lastTestBar < COOLDOWN_BARS) continue;

      const barHigh = highs[i];
      const barLow = lows[i];

      // Check xem bar này có chạm vào level không
      const touchesLevel = (barHigh >= level.price - TOUCH_ZONE && barLow <= level.price + TOUCH_ZONE);
      if (!touchesLevel) continue;

      lastTestBar = i;

      // Tính penetration (bao nhiêu điểm vượt qua level)
      let penetration = 0;
      if (level.type === 'RESISTANCE' || level.type === 'VAH') {
        penetration = Math.max(0, barHigh - level.price);
      } else {
        penetration = Math.max(0, level.price - barLow);
      }

      // Tính reaction: giá phản ứng bao xa sau khi test (xem 5 bar tiếp)
      let reactionPts = 0;
      let reactionBars = 0;
      const lookAhead = Math.min(i + 5, c.length);

      for (let j = i + 1; j < lookAhead; j++) {
        const move = level.type === 'RESISTANCE' || level.type === 'VAH'
          ? level.price - lows[j] // Giá chạy xuống bao xa
          : highs[j] - level.price; // Giá chạy lên bao xa

        if (move > reactionPts) {
          reactionPts = move;
          reactionBars = j - i;
        }
      }

      // Volume tại test
      const testVol = v ? v[i] : 0;
      const avgVol = v ? v.slice(Math.max(0, i - 20), i).reduce((s, x) => s + x, 0) / 20 : 0;
      const volLabel = testVol > avgVol * 1.5 ? 'HIGH' : testVol > avgVol * 0.7 ? 'MEDIUM' : 'LOW';

      // Phân loại kết quả test
      let result = 'WEAK_REJECT';
      if (penetration <= 0.5 && reactionPts >= 3) result = 'STRONG_REJECT';
      else if (penetration <= 1 && reactionPts >= 2) result = 'REJECT';
      else if (penetration >= 2 && reactionPts <= 1) result = 'ABSORBING';
      else if (penetration >= 1 && reactionPts <= 1.5) result = 'WEAKENING';

      tests.push({
        barIndex: i,
        time: t ? new Date(t[i] * 1000).toLocaleTimeString('vi-VN', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }) : null,
        penetration: parseFloat(penetration.toFixed(1)),
        reactionPts: parseFloat(reactionPts.toFixed(1)),
        reactionBars,
        volume: volLabel,
        result,
      });
    }

    if (tests.length === 0) continue;

    // Trend: So sánh rejection strength qua các lần test
    let trend = 'UNKNOWN';
    if (tests.length >= 2) {
      const lastTests = tests.slice(-3);
      const avgReaction = lastTests.reduce((s, t) => s + t.reactionPts, 0) / lastTests.length;
      const firstReaction = lastTests[0].reactionPts;
      const lastReaction = lastTests[lastTests.length - 1].reactionPts;

      if (lastReaction < firstReaction * 0.7) {
        trend = 'WEAKENING_REJECTION'; // Rejection yếu dần → breakout probability tăng
      } else if (lastReaction > firstReaction * 1.3) {
        trend = 'STRENGTHENING_REJECTION'; // Rejection mạnh dần → level vững
      } else {
        trend = 'CONSISTENT_REJECTION';
      }

      // Check absorption: penetration tăng dần nhưng price ko break
      const avgPenetration = lastTests.reduce((s, t) => s + t.penetration, 0) / lastTests.length;
      if (avgPenetration >= 1.5 && avgReaction <= 1.5) {
        trend = 'ABSORBING'; // Cung/cầu đang được hấp thụ
      }
    }

    // Breakout probability
    let breakoutProbability = 30; // base
    if (tests.length >= 3) breakoutProbability += 15;
    if (tests.length >= 5) breakoutProbability += 15;
    if (trend === 'WEAKENING_REJECTION') breakoutProbability += 20;
    if (trend === 'ABSORBING') breakoutProbability += 25;
    if (trend === 'STRENGTHENING_REJECTION') breakoutProbability -= 15;
    breakoutProbability = Math.max(10, Math.min(95, breakoutProbability));

    results.push({
      level: level.price,
      levelType: level.type,
      levelLabel: level.label,
      testCount: tests.length,
      tests: tests.slice(-5), // Giữ 5 test gần nhất
      trend,
      breakoutProbability,
    });
  }

  return results;
}

/**
 * Phân tích Acceptance vs Excursion
 * Giá ở lại vùng lâu + volume = ACCEPTANCE
 * Giá chạy qua nhanh = EXCURSION
 */
function analyzeAcceptance(intradayData, priceMap) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 20 || !priceMap) {
    return { type: 'UNKNOWN', details: {} };
  }

  const { c, v, t } = intradayData;
  const todayStart = _getTodayStartTs(t);

  // Lấy 20 bars gần nhất
  const recentStart = Math.max(0, c.length - 20);
  const recentCloses = c.slice(recentStart);
  const recentVols = v ? v.slice(recentStart) : [];

  if (recentCloses.length < 5) return { type: 'UNKNOWN', details: {} };

  const currentPrice = recentCloses[recentCloses.length - 1];
  const highRecent = Math.max(...recentCloses);
  const lowRecent = Math.min(...recentCloses);
  const range = highRecent - lowRecent;

  // Net move vs total movement
  const netMove = Math.abs(recentCloses[recentCloses.length - 1] - recentCloses[0]);
  let totalMove = 0;
  for (let i = 1; i < recentCloses.length; i++) {
    totalMove += Math.abs(recentCloses[i] - recentCloses[i - 1]);
  }
  const efficiency = totalMove > 0 ? netMove / totalMove : 0;

  // Time at price: bao nhiêu bars giá ở gần mức hiện tại (±2 điểm)
  const barsAtPrice = recentCloses.filter(p => Math.abs(p - currentPrice) <= 2).length;
  const timeAtPriceRatio = barsAtPrice / recentCloses.length;

  // Volume distribution
  const avgVol = recentVols.length > 0 ? recentVols.reduce((s, x) => s + x, 0) / recentVols.length : 0;
  const recentVolRatio = recentVols.length > 0 && avgVol > 0
    ? recentVols.slice(-5).reduce((s, x) => s + x, 0) / (avgVol * 5) : 1;

  let type = 'NEUTRAL';
  let confidence = 50;

  if (timeAtPriceRatio >= 0.4 && recentVolRatio >= 0.8 && range <= 5) {
    type = 'ACCEPTANCE'; // Giá ở lại + volume = chấp nhận vùng giá
    confidence = Math.min(90, 50 + timeAtPriceRatio * 50);
  } else if (efficiency >= 0.6 && range >= 5 && barsAtPrice <= 3) {
    type = 'EXCURSION'; // Giá chạy qua nhanh, không ở lại
    confidence = Math.min(85, 40 + efficiency * 50);
  } else if (efficiency < 0.3 && range >= 6) {
    type = 'CHOP'; // Giật qua lại nhiều
    confidence = 60;
  }

  return {
    type,
    confidence: Math.round(confidence),
    details: {
      efficiency: parseFloat(efficiency.toFixed(2)),
      range: parseFloat(range.toFixed(1)),
      barsAtPrice,
      timeAtPriceRatio: parseFloat(timeAtPriceRatio.toFixed(2)),
      recentVolRatio: parseFloat(recentVolRatio.toFixed(2)),
      netMove: parseFloat(netMove.toFixed(1)),
    },
  };
}

// ─── HELPER ──────────────────────────────────────────────────
function _getTodayStartTs(timestamps) {
  if (!timestamps || timestamps.length === 0) return 0;
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  vnTime.setHours(0, 0, 0, 0);
  return Math.floor(vnTime.getTime() / 1000);
}

module.exports = {
  analyzeTests,
  analyzeAcceptance,
};
