/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🎯 VN30F V10.0 — Zone Engine (Section 6.2)                   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Maintains support & resistance zones with full lifecycle:    ║
 * ║  ACTIVE -> TESTING -> WEAKENED -> BROKEN -> RETESTED -> EXPIRED║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const ZONE_STATUSES = {
  ACTIVE: 'ACTIVE',
  TESTING: 'TESTING',
  WEAKENED: 'WEAKENED',
  BROKEN: 'BROKEN',
  RETESTED: 'RETESTED',
  EXPIRED: 'EXPIRED',
};

class ZoneEngine {
  constructor() {
    this.zones = []; // [{ id, low, high, type: 'SUPPORT'|'RESISTANCE', testCount, status, createdAt, lastTouchTs }]
  }

  addZone({ low, high, type = 'SUPPORT', source = 'SWING' }) {
    const id = `Z_${type[0]}_${Math.round(low)}_${Math.round(high)}`;
    // Deduplicate existing overlapping zone
    const existing = this.zones.find(z => z.type === type && Math.abs(z.low - low) <= 1.0 && Math.abs(z.high - high) <= 1.0);
    if (existing) {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      return existing;
    }

    const zone = {
      id,
      low: +(low.toFixed(1)),
      high: +(high.toFixed(1)),
      type,
      source,
      testCount: 0,
      failedBreakCount: 0,
      status: ZONE_STATUSES.ACTIVE,
      createdAt: Date.now(),
      lastTouchTs: Date.now(),
    };

    this.zones.push(zone);
    return zone;
  }

  /**
   * Update zone interaction on new price tick
   */
  updateZones(price, ts = Date.now()) {
    for (const z of this.zones) {
      if (z.status === ZONE_STATUSES.EXPIRED || z.status === ZONE_STATUSES.BROKEN) continue;

      const isInside = price >= z.low - 0.2 && price <= z.high + 0.2;
      if (isInside) {
        z.lastTouchTs = ts;
        z.testCount++;
        z.status = z.testCount >= 3 ? ZONE_STATUSES.WEAKENED : ZONE_STATUSES.TESTING;
      } else if (z.type === 'SUPPORT' && price < z.low - 1.5) {
        // Broken support
        z.status = ZONE_STATUSES.BROKEN;
      } else if (z.type === 'RESISTANCE' && price > z.high + 1.5) {
        // Broken resistance
        z.status = ZONE_STATUSES.BROKEN;
      }
    }
  }

  getActiveZones() {
    return this.zones.filter(z => z.status === ZONE_STATUSES.ACTIVE || z.status === ZONE_STATUSES.TESTING || z.status === ZONE_STATUSES.WEAKENED);
  }

  getNearestZones(currentPrice) {
    const active = this.getActiveZones();
    const supports = active.filter(z => z.high <= currentPrice + 0.5).sort((a, b) => b.high - a.high);
    const resistances = active.filter(z => z.low >= currentPrice - 0.5).sort((a, b) => a.low - b.low);

    return {
      nearestSupport: supports.length > 0 ? supports[0] : null,
      nearestResistance: resistances.length > 0 ? resistances[0] : null,
    };
  }

  reset() {
    this.zones = [];
  }
}

module.exports = {
  ZoneEngine,
  ZONE_STATUSES,
};
