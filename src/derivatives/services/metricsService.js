/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F V10.0 — Metrics Service (Section 14.4)             ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Computes forecast metrics:                                   ║
 * ║  • Coverage                                                   ║
 * ║  • Direction hit-first rate                                   ║
 * ║  • Target hit-first rate                                      ║
 * ║  • Median lead time (seconds)                                 ║
 * ║  • Target outcome distribution (Hit / Invalid / Expired)      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class MetricsService {
  constructor() {
    this.records = []; // [{ forecastId, direction, outcome, hitFirst, leadTimeMs }]
  }

  recordEvaluation(evalRecord) {
    this.records.push({
      ...evalRecord,
      recordedAt: Date.now(),
    });
  }

  computeMetrics() {
    if (this.records.length === 0) {
      return {
        totalEvaluated: 0,
        targetHitFirstRate: 0,
        medianLeadTimeSec: 0,
        distribution: { hit: 0, invalidated: 0, expired: 0, ambiguous: 0 },
      };
    }

    let hitCount = 0;
    let invCount = 0;
    let expCount = 0;
    let ambCount = 0;
    const leadTimes = [];

    for (const r of this.records) {
      if (r.outcome === 'TARGET_BEFORE_INVALIDATION') {
        hitCount++;
        if (typeof r.leadTimeMs === 'number') {
          leadTimes.push(r.leadTimeMs / 1000);
        }
      } else if (r.outcome === 'INVALIDATION_FIRST') {
        invCount++;
      } else if (r.outcome === 'EXPIRED_WITHOUT_HIT') {
        expCount++;
      } else {
        ambCount++;
      }
    }

    const hitRate = +(hitCount / this.records.length).toFixed(2);

    // Median lead time
    let medianLeadSec = 0;
    if (leadTimes.length > 0) {
      leadTimes.sort((a, b) => a - b);
      const mid = Math.floor(leadTimes.length / 2);
      medianLeadSec = leadTimes.length % 2 !== 0 ? leadTimes[mid] : (leadTimes[mid - 1] + leadTimes[mid]) / 2;
      medianLeadSec = +(medianLeadSec.toFixed(1));
    }

    return {
      totalEvaluated: this.records.length,
      targetHitFirstRate: hitRate,
      medianLeadTimeSec: medianLeadSec,
      distribution: {
        hit: hitCount,
        invalidated: invCount,
        expired: expCount,
        ambiguous: ambCount,
      },
    };
  }

  reset() {
    this.records = [];
  }
}

module.exports = {
  MetricsService,
};
