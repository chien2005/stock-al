/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🛡️ VN30F V10.0 — Data Quality Gate (DQ-01 to DQ-12)        ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Validates incoming market events, tracks freshness,          ║
 * ║  enforces quality states: FRESH, DEGRADED, STALE, DISCONNECTED║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const QUALITY_STATES = {
  FRESH: 'FRESH',
  DEGRADED: 'DEGRADED',
  STALE: 'STALE',
  DISCONNECTED: 'DISCONNECTED',
  INVALID: 'INVALID',
  CONTRACT_MISMATCH: 'CONTRACT_MISMATCH',
};

const PROFILES = {
  L0_OHLCV: 'L0_OHLCV',
  L1_SNAPSHOT: 'L1_SNAPSHOT',
  L2_TAPE: 'L2_TAPE',
  L3_BOOK: 'L3_BOOK',
};

class DataQualityGate {
  constructor(config = {}) {
    this.staleThresholdMs = config.staleThresholdMs || 15000;      // > 15s = STALE
    this.degradedThresholdMs = config.degradedThresholdMs || 8000; // > 8s = DEGRADED
    this.maxBasisTimestampDiffMs = config.maxBasisDiffMs || 10000; // > 10s = basis unavailable
    this.lastValidEvent = null;
    this.consecutiveErrors = 0;
  }

  /**
   * Validate raw event and assign quality state according to DQ-01 to DQ-12.
   * @param {object} event - MarketDataEnvelope
   * @param {object} previousEvent
   * @param {number} asOfMs
   * @returns {{ isValid: boolean, state: string, reasons: string[], profile: string }}
   */
  validateEvent(event, previousEvent = this.lastValidEvent, asOfMs = Date.now()) {
    const reasons = [];
    let state = QUALITY_STATES.FRESH;

    if (!event || typeof event !== 'object') {
      return { isValid: false, state: QUALITY_STATES.INVALID, reasons: ['EVENT_NULL_OR_INVALID'], profile: PROFILES.L1_SNAPSHOT };
    }

    // DQ-10: Data validation: finite, non-negative, price > 0
    if (typeof event.price !== 'number' || isNaN(event.price) || !isFinite(event.price) || event.price <= 0) {
      reasons.push('PRICE_INVALID');
      state = QUALITY_STATES.INVALID;
    }

    if (typeof event.cumulativeVolume !== 'number' || isNaN(event.cumulativeVolume) || event.cumulativeVolume < 0) {
      reasons.push('VOLUME_NEGATIVE_OR_NAN');
      state = QUALITY_STATES.INVALID;
    }

    // DQ-01 / DQ-03: Freshness check
    const receivedAge = asOfMs - (event.receivedTs || asOfMs);
    if (receivedAge > this.staleThresholdMs) {
      state = QUALITY_STATES.STALE;
      reasons.push(`STALE_DATA_AGE_${receivedAge}MS`);
    } else if (receivedAge > this.degradedThresholdMs || event.flags?.cached || event.flags?.fallback) {
      if (state !== QUALITY_STATES.INVALID) state = QUALITY_STATES.DEGRADED;
      if (event.flags?.cached) reasons.push('USING_IN_MEMORY_CACHE');
      if (event.flags?.fallback) reasons.push('USING_FALLBACK_SOURCE');
    }

    // DQ-05: Cumulative volume drop check
    if (previousEvent && typeof previousEvent.cumulativeVolume === 'number') {
      if (event.cumulativeVolume < previousEvent.cumulativeVolume) {
        reasons.push('VOLUME_CUMULATIVE_DECREASE_RESET_REQUIRED');
        state = QUALITY_STATES.DEGRADED;
      }
    }

    // DQ-04: Repetitive price and volume (normal when market is quiet, but note)
    const isRepetitive = previousEvent &&
      previousEvent.price === event.price &&
      previousEvent.cumulativeVolume === event.cumulativeVolume;
    if (isRepetitive) {
      // Not an error, just non-active tick
      event.flags = event.flags || {};
      event.flags.noTradeSinceLast = true;
    }

    const isValid = state !== QUALITY_STATES.INVALID;
    if (isValid) {
      this.lastValidEvent = event;
      this.consecutiveErrors = 0;
    } else {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= 3) {
        state = QUALITY_STATES.DISCONNECTED;
      }
    }

    return {
      isValid,
      state,
      reasons,
      profile: event.quality?.mode || PROFILES.L1_SNAPSHOT,
      ageMs: receivedAge,
    };
  }

  /**
   * Check if basis (F1 vs VN30) is valid given their timestamps (DQ-11)
   */
  isBasisValid(f1Ts, vn30Ts) {
    if (!f1Ts || !vn30Ts) return false;
    const diff = Math.abs(f1Ts - vn30Ts);
    return diff <= this.maxBasisTimestampDiffMs;
  }
}

module.exports = {
  DataQualityGate,
  QUALITY_STATES,
  PROFILES,
};
