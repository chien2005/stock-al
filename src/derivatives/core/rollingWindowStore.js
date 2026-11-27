/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔄 VN30F V10.0 — Rolling Window Store (Section 5.2)         ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Ring buffers by event time for 5s, 15s, 30s, 60s, 180s, 300s  ║
 * ║  Calculates price velocity, volume delta, price efficiency     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class RollingWindowStore {
  constructor(options = {}) {
    this.windows = options.windows || [5, 15, 30, 60, 180, 300]; // seconds
    this.history = []; // [{ ts, price, cumulativeVolume }]
    this.maxHistoryMs = Math.max(...this.windows) * 1000 + 10000;
  }

  /**
   * Ingest normalized event { receivedTs, price, cumulativeVolume }
   */
  ingest(event) {
    if (!event || typeof event.price !== 'number') return;
    const item = {
      ts: event.receivedTs || Date.now(),
      price: event.price,
      vol: event.cumulativeVolume || 0,
    };

    this.history.push(item);

    // Prune history older than max window
    const cutoff = item.ts - this.maxHistoryMs;
    while (this.history.length > 0 && this.history[0].ts < cutoff) {
      this.history.shift();
    }
  }

  /**
   * Get metrics for a specific window in seconds
   * @param {number} windowSec
   * @param {number} asOfMs
   * @returns {object} { priceDelta, priceVelocity, volumeDelta, volumeVelocity, priceEfficiency, isReady }
   */
  getWindowMetrics(windowSec, asOfMs = null) {
    if (this.history.length < 2) {
      return { isReady: false, windowSec };
    }

    const latest = this.history[this.history.length - 1];
    const targetAsOf = asOfMs || latest.ts;
    const targetStart = targetAsOf - windowSec * 1000;

    // Find sample closest to or just before targetStart
    let startSample = null;
    let pathSum = 0;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const cur = this.history[i];
      if (cur.ts <= targetAsOf) {
        if (!startSample || cur.ts >= targetStart) {
          startSample = cur;
        }
        if (i < this.history.length - 1) {
          const next = this.history[i + 1];
          pathSum += Math.abs(next.price - cur.price);
        }
      }
    }

    if (!startSample) {
      return { isReady: false, windowSec };
    }

    const observedSpanMs = Math.max(500, targetAsOf - startSample.ts);
    const observedSeconds = observedSpanMs / 1000;
    const priceDelta = +(latest.price - startSample.price).toFixed(2);
    const priceVelocity = +(priceDelta / observedSeconds).toFixed(3);
    const volumeDelta = Math.max(0, latest.vol - startSample.vol);
    const volumeVelocity = +(volumeDelta / observedSeconds).toFixed(1);

    // Price efficiency = abs(netMove) / max(pathSum, 0.1)
    const priceEfficiency = pathSum > 0 ? +(Math.abs(priceDelta) / pathSum).toFixed(2) : 1.0;

    return {
      isReady: observedSeconds >= windowSec * 0.7, // ready if at least 70% of window covered
      windowSec,
      observedSeconds: parseFloat(observedSeconds.toFixed(1)),
      priceDelta,
      priceVelocity,
      volumeDelta,
      volumeVelocity,
      priceEfficiency,
      startPrice: startSample.price,
      latestPrice: latest.price,
    };
  }

  getAllMetrics(asOfMs = null) {
    const res = {};
    for (const w of this.windows) {
      res[`w${w}s`] = this.getWindowMetrics(w, asOfMs);
    }
    return res;
  }

  reset() {
    this.history = [];
  }
}

module.exports = {
  RollingWindowStore,
};
