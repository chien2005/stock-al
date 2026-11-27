/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🛤️ VN30F V10.0 — Path Builder (Section 9.3)                 ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Constructs ordered primary path with target zones,          ║
 * ║  conditional extensions, and invalidation criteria           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class PathBuilder {
  /**
   * Build complete path object.
   * @param {object} params
   * @returns {object} Path DTO
   */
  buildPath({
    direction = 'UP',
    pathType = 'COMPRESSION_BREAKOUT',
    currentPrice,
    primaryTargetZone,
    secondaryTargetZone = null,
    invalidationPrice,
    horizonSec = 300,
  }) {
    const waypoints = [];

    // Primary target
    const primaryTarget = {
      low: primaryTargetZone.low,
      high: primaryTargetZone.high,
      zoneId: primaryTargetZone.zoneId || 'T1',
    };

    // Conditional extension (Target 2 is conditional on breaking past Target 1)
    let conditionalExtension = null;
    if (secondaryTargetZone) {
      conditionalExtension = {
        low: secondaryTargetZone.low,
        high: secondaryTargetZone.high,
        requires: direction === 'UP' ? `ACCEPT_ABOVE_${primaryTarget.high}` : `ACCEPT_BELOW_${primaryTarget.low}`,
      };
    }

    // Invalidation condition
    const invalidation = {
      type: direction === 'UP' ? 'BELOW_SUPPORT_ACCEPTANCE' : 'ABOVE_RESISTANCE_ACCEPTANCE',
      level: +(invalidationPrice.toFixed(1)),
      observations: 2,
    };

    return {
      direction,
      pathType,
      originPrice: +(currentPrice.toFixed(1)),
      primaryTarget,
      waypoints,
      conditionalExtension,
      invalidation,
      horizonSec,
    };
  }
}

module.exports = {
  PathBuilder,
};
