/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🎯 VN30F V10.0 — Target Ranking Engine (Section 9.1)         ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  TargetScore = 0.25*structureQuality + 0.20*pathAccessibility ║
 * ║              + 0.20*reachability + 0.15*pressureAlignment    ║
 * ║              + 0.10*independentConfluence + 0.10*zoneFreshness║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class TargetRankingEngine {
  /**
   * Rank target zone candidates based on structural accessibility and reachability.
   * @param {object} params
   * @returns {object[]} Ranked array of target zones
   */
  rankTargets({
    direction = 'UP',
    currentPrice,
    candidateZones = [],
    pressureSide = 'BALANCED',
    atr = 2.0,
  }) {
    if (!Array.isArray(candidateZones) || candidateZones.length === 0) {
      return [];
    }

    const validZones = candidateZones.filter(z => {
      if (direction === 'UP') return z.low >= currentPrice - 0.2;
      return z.high <= currentPrice + 0.2;
    });

    const scored = validZones.map(zone => {
      const distance = direction === 'UP' ? Math.max(0.1, zone.low - currentPrice) : Math.max(0.1, currentPrice - zone.high);

      // 1. Structure Quality (0 - 100)
      const structureQuality = zone.source === 'SWING' ? 85 : (zone.source === 'FIBO' ? 75 : 65);

      // 2. Path Accessibility (closer zones have higher accessibility without hurdles)
      const pathAccessibility = Math.max(20, Math.min(100, Math.round(100 - distance * 10)));

      // 3. Reachability (is distance realistic within ATR envelope: distance <= 2 * ATR)
      const reachability = distance <= atr * 2.5 ? 90 : (distance <= atr * 4.0 ? 60 : 30);

      // 4. Pressure Alignment
      const pressureAlignment = (direction === 'UP' && pressureSide === 'BUY') || (direction === 'DOWN' && pressureSide === 'SELL') ? 85 : 50;

      // 5. Independent Confluence
      const independentConfluence = zone.confluenceCount ? Math.min(100, zone.confluenceCount * 35) : 70;

      // 6. Zone Freshness (tested < 2 times is fresher)
      const zoneFreshness = zone.testCount <= 1 ? 90 : (zone.testCount <= 3 ? 60 : 35);

      // TargetScore Formula (Section 9.1)
      const targetScore = Math.round(
        0.25 * structureQuality +
        0.20 * pathAccessibility +
        0.20 * reachability +
        0.15 * pressureAlignment +
        0.10 * independentConfluence +
        0.10 * zoneFreshness
      );

      return {
        zoneId: zone.id || `Z_${Math.round(zone.low)}`,
        low: zone.low,
        high: zone.high,
        distance: +(distance.toFixed(1)),
        targetScore,
        components: {
          structureQuality,
          pathAccessibility,
          reachability,
          pressureAlignment,
          independentConfluence,
          zoneFreshness,
        },
      };
    });

    // Sort by highest score first
    return scored.sort((a, b) => b.targetScore - a.targetScore);
  }
}

module.exports = {
  TargetRankingEngine,
};
