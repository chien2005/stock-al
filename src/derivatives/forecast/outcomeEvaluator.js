/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🏁 VN30F V10.0 — Outcome Evaluator (Section 7.3 & 14.2)     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Hit-first evaluation: TARGET_BEFORE_INVALIDATION,             ║
 * ║  INVALIDATION_FIRST, EXPIRED_WITHOUT_HIT, AMBIGUOUS          ║
 * ║  CRITICAL: Evaluated strictly by subsequent observed events. ║
 * ║  Never feeds outcome back into original forecast record.     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const OUTCOME_TYPES = {
  TARGET_BEFORE_INVALIDATION: 'TARGET_BEFORE_INVALIDATION',
  INVALIDATION_FIRST: 'INVALIDATION_FIRST',
  EXPIRED_WITHOUT_HIT: 'EXPIRED_WITHOUT_HIT',
  AMBIGUOUS: 'AMBIGUOUS',
};

class OutcomeEvaluator {
  /**
   * Evaluate outcome of an original forecast given subsequent observed price bars.
   * @param {object} originalForecast
   * @param {object[]} futureCandles
   * @returns {object} Outcome record
   */
  evaluate(originalForecast, futureCandles = []) {
    if (!originalForecast || !originalForecast.primaryTarget) {
      return { outcome: OUTCOME_TYPES.EXPIRED_WITHOUT_HIT, hitFirst: false };
    }

    const { direction, primaryTarget, invalidation, validUntil, asOf } = originalForecast;

    let hitTargetTs = null;
    let hitInvalidationTs = null;
    let maxFavorableExcursion = 0;
    let maxAdverseExcursion = 0;

    for (const c of futureCandles) {
      const ts = c.timestamp ? c.timestamp * 1000 : c.startTs;
      if (ts < asOf) continue; // Only evaluate strictly future events

      const high = c.high !== undefined ? c.high : c.close;
      const low = c.low !== undefined ? c.low : c.close;

      // Track excursions
      if (direction === 'UP') {
        const fav = high - originalForecast.origin.price;
        const adv = originalForecast.origin.price - low;
        if (fav > maxFavorableExcursion) maxFavorableExcursion = fav;
        if (adv > maxAdverseExcursion) maxAdverseExcursion = adv;
      } else {
        const fav = originalForecast.origin.price - low;
        const adv = high - originalForecast.origin.price;
        if (fav > maxFavorableExcursion) maxFavorableExcursion = fav;
        if (adv > maxAdverseExcursion) maxAdverseExcursion = adv;
      }

      // Check target touch
      if (hitTargetTs === null) {
        if (direction === 'UP' && high >= primaryTarget.low) hitTargetTs = ts;
        else if (direction === 'DOWN' && low <= primaryTarget.high) hitTargetTs = ts;
      }

      // Check invalidation touch
      if (hitInvalidationTs === null && invalidation && invalidation.level) {
        if (direction === 'UP' && low <= invalidation.level) hitInvalidationTs = ts;
        else if (direction === 'DOWN' && high >= invalidation.level) hitInvalidationTs = ts;
      }

      if (ts >= validUntil) break; // Reached horizon
    }

    // Determine hit-first
    if (hitTargetTs !== null && hitInvalidationTs === null) {
      return {
        outcome: OUTCOME_TYPES.TARGET_BEFORE_INVALIDATION,
        hitFirst: true,
        hitTs: hitTargetTs,
        leadTimeMs: hitTargetTs - asOf,
        mfe: +(maxFavorableExcursion.toFixed(1)),
        mae: +(maxAdverseExcursion.toFixed(1)),
      };
    }

    if (hitInvalidationTs !== null && hitTargetTs === null) {
      return {
        outcome: OUTCOME_TYPES.INVALIDATION_FIRST,
        hitFirst: false,
        invalidatedTs: hitInvalidationTs,
        mfe: +(maxFavorableExcursion.toFixed(1)),
        mae: +(maxAdverseExcursion.toFixed(1)),
      };
    }

    if (hitTargetTs !== null && hitInvalidationTs !== null) {
      if (hitTargetTs < hitInvalidationTs) {
        return {
          outcome: OUTCOME_TYPES.TARGET_BEFORE_INVALIDATION,
          hitFirst: true,
          hitTs: hitTargetTs,
          leadTimeMs: hitTargetTs - asOf,
          mfe: +(maxFavorableExcursion.toFixed(1)),
          mae: +(maxAdverseExcursion.toFixed(1)),
        };
      } else if (hitInvalidationTs < hitTargetTs) {
        return {
          outcome: OUTCOME_TYPES.INVALIDATION_FIRST,
          hitFirst: false,
          invalidatedTs: hitInvalidationTs,
          mfe: +(maxFavorableExcursion.toFixed(1)),
          mae: +(maxAdverseExcursion.toFixed(1)),
        };
      } else {
        // Both hit in same candle without granular ordering
        return {
          outcome: OUTCOME_TYPES.AMBIGUOUS,
          hitFirst: false,
          mfe: +(maxFavorableExcursion.toFixed(1)),
          mae: +(maxAdverseExcursion.toFixed(1)),
        };
      }
    }

    return {
      outcome: OUTCOME_TYPES.EXPIRED_WITHOUT_HIT,
      hitFirst: false,
      mfe: +(maxFavorableExcursion.toFixed(1)),
      mae: +(maxAdverseExcursion.toFixed(1)),
    };
  }
}

module.exports = {
  OutcomeEvaluator,
  OUTCOME_TYPES,
};
