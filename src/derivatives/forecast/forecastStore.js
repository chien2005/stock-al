/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   💾 VN30F V10.0 — Forecast Store (Section 10.1 & 14.1)       ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Append-only, immutable original forecast records.            ║
 * ║  Never modifies original target, asOf, or deadline.           ║
 * ║  Stores revisions and outcomes independently.                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.keys(obj).forEach(prop => {
    if (typeof obj[prop] === 'object' && obj[prop] !== null) {
      deepFreeze(obj[prop]);
    }
  });
  return Object.freeze(obj);
}

class ForecastStore {
  constructor() {
    this.forecasts = new Map(); // forecastId -> originalForecast (Immutable)
    this.revisions = new Map(); // forecastId -> revision[]
    this.outcomes = new Map();  // forecastId -> outcome
    this.activeForecastId = null;
  }

  /**
   * Save a newly emitted forecast (Immutable Original Record).
   */
  saveOriginal(forecast) {
    if (!forecast || !forecast.forecastId) {
      throw new Error('Forecast must have a unique forecastId');
    }
    // Deep clone and deep freeze to ensure immutability
    const frozen = deepFreeze(JSON.parse(JSON.stringify(forecast)));
    this.forecasts.set(forecast.forecastId, frozen);
    this.revisions.set(forecast.forecastId, []);
    this.activeForecastId = forecast.forecastId;
    return frozen;
  }

  /**
   * Add a state revision to an existing forecast without mutating original.
   */
  addRevision(forecastId, revision) {
    if (!this.forecasts.has(forecastId)) {
      throw new Error(`Forecast ${forecastId} not found`);
    }
    const revs = this.revisions.get(forecastId);
    const revObj = {
      revisionId: revs.length + 1,
      ts: Date.now(),
      ...revision,
    };
    revs.push(Object.freeze(revObj));
    return revObj;
  }

  /**
   * Record outcome once evaluated.
   */
  saveOutcome(forecastId, outcome) {
    this.outcomes.set(forecastId, Object.freeze({ ...outcome, evaluatedAt: Date.now() }));
    if (this.activeForecastId === forecastId) {
      this.activeForecastId = null;
    }
  }

  getOriginal(forecastId) {
    return this.forecasts.get(forecastId) || null;
  }

  getRevisions(forecastId) {
    return this.revisions.get(forecastId) || [];
  }

  getOutcome(forecastId) {
    return this.outcomes.get(forecastId) || null;
  }

  getActiveForecast() {
    if (!this.activeForecastId) return null;
    return this.getOriginal(this.activeForecastId);
  }

  getAllOriginals() {
    return Array.from(this.forecasts.values());
  }

  reset() {
    this.forecasts.clear();
    this.revisions.clear();
    this.outcomes.clear();
    this.activeForecastId = null;
  }
}

module.exports = {
  ForecastStore,
};
