/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔄 VN30F V10.0 — Forecast Lifecycle (Section 10.1)          ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Lifecycle states:                                            ║
 * ║  WATCHING -> EARLY_FORECAST -> CONFIRMED -> WEAKENING ->     ║
 * ║  TARGET_HIT / INVALIDATED / EXPIRED / DATA_LOST              ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const FORECAST_STATES = {
  WATCHING: 'WATCHING',
  EARLY_FORECAST: 'EARLY_FORECAST',
  CONFIRMED: 'CONFIRMED',
  WEAKENING: 'WEAKENING',
  TARGET_HIT: 'TARGET_HIT',
  INVALIDATED: 'INVALIDATED',
  EXPIRED: 'EXPIRED',
  DATA_LOST: 'DATA_LOST',
};

class ForecastLifecycle {
  /**
   * Determine updated state for an active forecast against a new market tick.
   * @param {object} forecast - Original forecast
   * @param {number} currentPrice
   * @param {number} currentTs
   * @param {object} dataQuality
   * @returns {{ nextState: string, isTerminal: boolean, reason?: string }}
   */
  evaluateTransition(forecast, currentPrice, currentTs, dataQuality = {}) {
    if (!forecast || !forecast.primaryTarget) {
      return { nextState: FORECAST_STATES.EXPIRED, isTerminal: true };
    }

    // 1. Data loss check
    if (dataQuality.state === 'DISCONNECTED' || dataQuality.state === 'INVALID') {
      return { nextState: FORECAST_STATES.DATA_LOST, isTerminal: true, reason: 'DATA_FEED_LOST' };
    }

    // 2. Deadline expiration check
    if (currentTs >= forecast.validUntil) {
      return { nextState: FORECAST_STATES.EXPIRED, isTerminal: true, reason: 'HORIZON_DEADLINE_EXPIRED' };
    }

    const { direction, primaryTarget, invalidation } = forecast;

    // 3. Invalidation check
    if (invalidation && invalidation.level) {
      if (direction === 'UP' && currentPrice <= invalidation.level) {
        return {
          nextState: FORECAST_STATES.INVALIDATED,
          isTerminal: true,
          reason: `PRICE_${currentPrice}_BREACHED_INVALIDATION_${invalidation.level}`,
        };
      } else if (direction === 'DOWN' && currentPrice >= invalidation.level) {
        return {
          nextState: FORECAST_STATES.INVALIDATED,
          isTerminal: true,
          reason: `PRICE_${currentPrice}_BREACHED_INVALIDATION_${invalidation.level}`,
        };
      }
    }

    // 4. Target Hit check
    if (direction === 'UP' && currentPrice >= primaryTarget.low) {
      return {
        nextState: FORECAST_STATES.TARGET_HIT,
        isTerminal: true,
        reason: `PRICE_${currentPrice}_REACHED_TARGET_ZONE_${primaryTarget.low}_${primaryTarget.high}`,
      };
    } else if (direction === 'DOWN' && currentPrice <= primaryTarget.high) {
      return {
        nextState: FORECAST_STATES.TARGET_HIT,
        isTerminal: true,
        reason: `PRICE_${currentPrice}_REACHED_TARGET_ZONE_${primaryTarget.low}_${primaryTarget.high}`,
      };
    }

    // Remains in flight
    return {
      nextState: forecast.stage || FORECAST_STATES.EARLY_FORECAST,
      isTerminal: false,
    };
  }
}

module.exports = {
  ForecastLifecycle,
  FORECAST_STATES,
};
