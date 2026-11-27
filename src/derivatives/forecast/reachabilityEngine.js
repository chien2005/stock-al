/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📏 VN30F V10.0 — Reachability Engine (Section 9.2)          ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Validates distance feasibility against remaining horizon,   ║
 * ║  volatility (ATR), and intermediary price hurdles            ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class ReachabilityEngine {
  /**
   * Check if a proposed target is reachable within horizonSec given current volatility.
   * @param {object} params
   * @returns {{ isReachable: boolean, etaLowSec: number|null, etaHighSec: number|null, reason?: string }}
   */
  evaluateReachability({
    distance,
    horizonSec = 300,
    atr = 2.0,
    remainingSegmentMs = 3600000,
  }) {
    if (typeof distance !== 'number' || distance <= 0) {
      return { isReachable: false, etaLowSec: null, etaHighSec: null, reason: 'INVALID_DISTANCE' };
    }

    // Check if horizon exceeds remaining session segment
    if (horizonSec * 1000 > remainingSegmentMs) {
      return {
        isReachable: false,
        etaLowSec: null,
        etaHighSec: null,
        reason: 'HORIZON_EXCEEDS_REMAINING_SESSION_TIME',
      };
    }

    // Typical max realistic move in H seconds:
    // H=180s (3m): ~1.5 * ATR
    // H=300s (5m): ~2.2 * ATR
    // H=900s (15m): ~3.8 * ATR
    const maxMultipliers = { 180: 1.8, 300: 2.8, 900: 4.5 };
    const mult = maxMultipliers[horizonSec] || 2.5;
    const maxFeasibleDistance = atr * mult;

    if (distance > maxFeasibleDistance) {
      return {
        isReachable: false,
        etaLowSec: null,
        etaHighSec: null,
        reason: `DISTANCE_${distance.toFixed(1)}_EXCEEDS_MAX_CAP_${maxFeasibleDistance.toFixed(1)}`,
      };
    }

    // Estimate ETA range
    const speedEstimate = (atr * 0.8) / 60; // pts per second
    const centralEtaSec = Math.round(distance / Math.max(0.01, speedEstimate));
    const etaLowSec = Math.max(30, Math.round(centralEtaSec * 0.6));
    const etaHighSec = Math.min(horizonSec, Math.round(centralEtaSec * 1.4));

    return {
      isReachable: true,
      etaLowSec,
      etaHighSec,
    };
  }
}

module.exports = {
  ReachabilityEngine,
};
