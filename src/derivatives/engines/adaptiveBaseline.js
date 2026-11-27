/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📈 VN30F V10.0 — Adaptive Baseline Engine                   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Phase-aware baseline, Median & MAD (Median Absolute Deviation)║
 * ║  Computes robust Z-scores for volume & velocity anomalies     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class AdaptiveBaselineEngine {
  constructor() {
    // History by session phase
    this.phaseHistories = {
      MORNING: { volumeSamples: [], velocitySamples: [] },
      AFTERNOON: { volumeSamples: [], velocitySamples: [] },
    };
  }

  /**
   * Calculate median of an array of numbers
   */
  calcMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Calculate Median Absolute Deviation (MAD)
   */
  calcMAD(arr, median = null) {
    if (!arr || arr.length === 0) return 1.0;
    const m = median !== null ? median : this.calcMedian(arr);
    const deviations = arr.map(x => Math.abs(x - m));
    return Math.max(0.001, this.calcMedian(deviations));
  }

  /**
   * Robust Z-score: (x - median) / max(1.4826 * MAD, epsilon)
   */
  robustZ(x, history) {
    if (!history || history.length < 5) return 0.0;
    const med = this.calcMedian(history);
    const mad = this.calcMAD(history, med);
    const denom = Math.max(0.001, 1.4826 * mad);
    return +((x - med) / denom).toFixed(2);
  }

  ingestSample(phase, volume, velocity) {
    const key = phase === 'AFTERNOON' ? 'AFTERNOON' : 'MORNING';
    const h = this.phaseHistories[key];

    if (typeof volume === 'number' && !isNaN(volume)) {
      h.volumeSamples.push(volume);
      if (h.volumeSamples.length > 300) h.volumeSamples.shift();
    }
    if (typeof velocity === 'number' && !isNaN(velocity)) {
      h.velocitySamples.push(Math.abs(velocity));
      if (h.velocitySamples.length > 300) h.velocitySamples.shift();
    }
  }

  getBaseline(phase) {
    const key = phase === 'AFTERNOON' ? 'AFTERNOON' : 'MORNING';
    const h = this.phaseHistories[key];
    const medVol = this.calcMedian(h.volumeSamples) || 1500;
    const medVel = this.calcMedian(h.velocitySamples) || 0.5;

    return {
      medianVolume: medVol,
      medianVelocity: medVel,
      samplesCount: h.volumeSamples.length,
      isWarm: h.volumeSamples.length >= 20,
    };
  }
}

module.exports = {
  AdaptiveBaselineEngine,
};
