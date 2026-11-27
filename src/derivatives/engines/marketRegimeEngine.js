/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🗺️ VN30F V10.0 — Market Regime Engine (Section 6.1)          ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  5-Tier Market Hierarchy:                                     ║
 * ║  1. Day Bias: UP / DOWN / NEUTRAL                             ║
 * ║  2. Swing Regime: TREND_UP / TREND_DOWN / RANGE / CHOPPY     ║
 * ║  3. Micro Direction: UP / DOWN / FLAT                         ║
 * ║  4. Pressure: BUY / SELL / BALANCED / UNKNOWN                 ║
 * ║  5. Volatility: LOW / NORMAL / HIGH / SHOCK                   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class MarketRegimeEngine {
  constructor() {
    this.lastRegime = null;
  }

  /**
   * Classify market regime across the 5 tiers with hysteresis.
   */
  classify({
    currentPrice,
    vwap = null,
    ma20 = null,
    swingHigh = null,
    swingLow = null,
    pressureSide = 'BALANCED',
    rollingVelocity60s = 0,
    atr = 2.0,
  }) {
    // 1. Day Bias
    let dayBias = 'NEUTRAL';
    if (vwap) {
      if (currentPrice >= vwap + 1.5) dayBias = 'UP';
      else if (currentPrice <= vwap - 1.5) dayBias = 'DOWN';
    }

    // 2. Swing Regime
    let swingRegime = 'CHOPPY';
    if (swingHigh && swingLow) {
      const span = swingHigh - swingLow;
      if (span <= 3.0) {
        swingRegime = 'RANGE';
      } else if (ma20) {
        if (currentPrice > ma20 + 1.0) swingRegime = 'TREND_UP';
        else if (currentPrice < ma20 - 1.0) swingRegime = 'TREND_DOWN';
        else swingRegime = 'TRANSITION';
      }
    }

    // 3. Micro Direction (from 60s rolling velocity)
    let microDirection = 'FLAT';
    if (rollingVelocity60s >= 0.03) microDirection = 'UP';
    else if (rollingVelocity60s <= -0.03) microDirection = 'DOWN';

    // 4. Pressure
    const pressure = pressureSide || 'BALANCED';

    // 5. Volatility
    let volatility = 'NORMAL';
    if (atr < 1.5) volatility = 'LOW';
    else if (atr >= 3.5) volatility = 'HIGH';

    const regime = {
      dayBias,
      swingRegime,
      microDirection,
      pressure,
      volatility,
      summary: `${dayBias}_DAY | ${swingRegime} | MICRO_${microDirection}`,
    };

    this.lastRegime = regime;
    return regime;
  }

  getLastRegime() {
    return this.lastRegime;
  }
}

module.exports = {
  MarketRegimeEngine,
};
