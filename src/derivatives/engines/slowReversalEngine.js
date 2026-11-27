/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🐢 VN30F V10.0 — Slow Reversal Engine (P03/P04 Precursor)   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Detects momentum deceleration, failing extensions,           ║
 * ║  weakening pullbacks (e.g. 62 -> 50 top drift without wicks) ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class SlowReversalEngine {
  /**
   * Detect momentum deceleration at swing extremes.
   * @param {object} params - { candles, currentPrice, swingHigh, swingLow, trend }
   * @returns {{ isDecelerating: boolean, side: 'BEARISH_DECELERATION'|'BULLISH_DECELERATION'|'NONE', score: number, reasons: string[] }}
   */
  detectDeceleration({
    candles = [],
    currentPrice,
    swingHigh,
    swingLow,
    trend = 'UPTREND',
  }) {
    const reasons = [];
    if (!candles || candles.length < 6) {
      return { isDecelerating: false, side: 'NONE', score: 0, reasons: ['INSUFFICIENT_CANDLES'] };
    }

    const recent = candles.slice(-6);
    const closes = recent.map(c => c.close);
    const highs = recent.map(c => c.high || c.close);
    const lows = recent.map(c => c.low || c.close);

    // 1. Bearish deceleration near Swing High (e.g. at 62: highs stop expanding, upward pushes shorten)
    if (trend === 'UPTREND' || (swingHigh && Math.abs(currentPrice - swingHigh) <= 2.5)) {
      const h0 = highs[highs.length - 1];
      const h1 = highs[highs.length - 2];
      const h2 = highs[highs.length - 3];

      // Wave expansion failed: current high not exceeding previous high + 0.3
      const isHighStagnant = h0 <= h1 + 0.3 && h1 <= h2 + 0.5;

      // Upward momentum decelerating: recent upward moves are smaller than earlier upward moves,
      // and downward displacement begins exceeding upward displacement in the tail
      const recentDiffs = [];
      for (let i = 1; i < closes.length; i++) {
        recentDiffs.push(closes[i] - closes[i - 1]);
      }

      const earlyUp = recentDiffs.slice(0, Math.floor(recentDiffs.length / 2)).filter(d => d > 0);
      const lateUp = recentDiffs.slice(Math.floor(recentDiffs.length / 2)).filter(d => d > 0);
      const lateDown = recentDiffs.slice(Math.floor(recentDiffs.length / 2)).filter(d => d < 0).map(d => Math.abs(d));

      const avgEarlyUp = earlyUp.length > 0 ? earlyUp.reduce((s, x) => s + x, 0) / earlyUp.length : 0;
      const avgLateUp = lateUp.length > 0 ? lateUp.reduce((s, x) => s + x, 0) / lateUp.length : 0;
      const avgLateDown = lateDown.length > 0 ? lateDown.reduce((s, x) => s + x, 0) / lateDown.length : 0;

      const isUpDecelerating = avgLateUp < avgEarlyUp;
      const isDownGaining = avgLateDown >= avgLateUp;

      if (isHighStagnant && (isUpDecelerating || isDownGaining)) {
        reasons.push('HIGH_EXPANSION_STAGNANT');
        if (isUpDecelerating) reasons.push(`UP_DECELERATING_FROM_${avgEarlyUp.toFixed(1)}_TO_${avgLateUp.toFixed(1)}`);
        if (isDownGaining) reasons.push(`LATE_DOWN_${avgLateDown.toFixed(1)}_EXCEEDS_LATE_UP_${avgLateUp.toFixed(1)}`);
        return {
          isDecelerating: true,
          side: 'BEARISH_DECELERATION',
          score: 75,
          reasons,
          description: `Động lượng tăng suy yếu quanh đỉnh ${swingHigh || h0}đ: đỉnh không mở rộng, nhịp hồi sau yếu dần`,
        };
      }
    }

    // 2. Bullish deceleration near Swing Low (e.g. at 41: lows stop dropping, downward pushes lose efficiency)
    if (trend === 'DOWNTREND' || (swingLow && Math.abs(currentPrice - swingLow) <= 2.5)) {
      const l0 = lows[lows.length - 1];
      const l1 = lows[lows.length - 2];
      const l2 = lows[lows.length - 3];

      const isLowStagnant = l0 >= l1 - 0.3 && l1 >= l2 - 0.5;

      const recentDiffs = [];
      for (let i = 1; i < closes.length; i++) {
        recentDiffs.push(closes[i] - closes[i - 1]);
      }

      const earlyDown = recentDiffs.slice(0, Math.floor(recentDiffs.length / 2)).filter(d => d < 0).map(d => Math.abs(d));
      const lateDown = recentDiffs.slice(Math.floor(recentDiffs.length / 2)).filter(d => d < 0).map(d => Math.abs(d));
      const lateUp = recentDiffs.slice(Math.floor(recentDiffs.length / 2)).filter(d => d > 0);

      const avgEarlyDown = earlyDown.length > 0 ? earlyDown.reduce((s, x) => s + x, 0) / earlyDown.length : 0;
      const avgLateDown = lateDown.length > 0 ? lateDown.reduce((s, x) => s + x, 0) / lateDown.length : 0;
      const avgLateUp = lateUp.length > 0 ? lateUp.reduce((s, x) => s + x, 0) / lateUp.length : 0;

      const isDownDecelerating = avgLateDown < avgEarlyDown;
      const isUpGaining = avgLateUp >= avgLateDown;

      if (isLowStagnant && (isDownDecelerating || isUpGaining)) {
        reasons.push('LOW_EXPANSION_STAGNANT');
        if (isDownDecelerating) reasons.push(`DOWN_DECELERATING_FROM_${avgEarlyDown.toFixed(1)}_TO_${avgLateDown.toFixed(1)}`);
        if (isUpGaining) reasons.push(`LATE_UP_${avgLateUp.toFixed(1)}_EXCEEDS_LATE_DOWN_${avgLateDown.toFixed(1)}`);
        return {
          isDecelerating: true,
          side: 'BULLISH_DECELERATION',
          score: 75,
          reasons,
          description: `Động lượng giảm suy yếu quanh đáy ${swingLow || l0}đ: bán không tạo đáy mới, lực hồi bắt đầu xuất hiện`,
        };
      }
    }

    return { isDecelerating: false, side: 'NONE', score: 0, reasons: [] };
  }
}

module.exports = {
  SlowReversalEngine,
};
