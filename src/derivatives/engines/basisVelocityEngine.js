/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🌐 VN30F V10.0 — Basis Velocity Engine (Section 6.4)         ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Synchronized F1 - VN30 basis, basis velocity (15s/60s),       ║
 * ║  and basis divergence detection (DQ-11 timestamp gate)       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class BasisVelocityEngine {
  constructor(maxTimestampDiffMs = 10000) {
    this.maxTimestampDiffMs = maxTimestampDiffMs;
    this.basisHistory = []; // [{ ts, basis, f1Price, vn30Price }]
  }

  /**
   * Ingest synchronized F1 and VN30 prices
   */
  ingest(f1Price, f1Ts, vn30Price, vn30Ts) {
    if (typeof f1Price !== 'number' || typeof vn30Price !== 'number' || f1Price <= 0 || vn30Price <= 0) {
      return { isBasisValid: false, basis: null, basisVelocity: 0, divergence: 'NONE' };
    }

    // DQ-11: Basis features unavailable if timestamp discrepancy exceeds threshold
    const diff = Math.abs(f1Ts - vn30Ts);
    if (diff > this.maxTimestampDiffMs) {
      return {
        isBasisValid: false,
        basis: null,
        basisVelocity: 0,
        divergence: 'UNAVAILABLE_TIMESTAMP_MISMATCH',
      };
    }

    const basis = +(f1Price - vn30Price).toFixed(2);
    const now = Math.max(f1Ts, vn30Ts);

    this.basisHistory.push({
      ts: now,
      basis,
      f1Price,
      vn30Price,
    });

    // Keep last 10 minutes
    const cutoff = now - 600000;
    while (this.basisHistory.length > 0 && this.basisHistory[0].ts < cutoff) {
      this.basisHistory.shift();
    }

    // Calculate basis velocity over 60s
    let basisVelocity = 0;
    const startSample = this.basisHistory.find(b => b.ts >= now - 60000);
    if (startSample && startSample !== this.basisHistory[this.basisHistory.length - 1]) {
      const dtSec = Math.max(1, (now - startSample.ts) / 1000);
      basisVelocity = +((basis - startSample.basis) / dtSec).toFixed(3);
    }

    // Check divergence: F1 surging while VN30 flat/down, or F1 dropping while VN30 flat/up
    let divergence = 'NONE';
    if (startSample) {
      const f1Move = f1Price - startSample.f1Price;
      const vn30Move = vn30Price - startSample.vn30Price;

      if (f1Move >= 2.0 && vn30Move <= 0.5) {
        divergence = 'F1_LEAD_BULLISH';
      } else if (f1Move <= -2.0 && vn30Move >= -0.5) {
        divergence = 'F1_LEAD_BEARISH';
      }
    }

    return {
      isBasisValid: true,
      basis,
      basisVelocity,
      divergence,
    };
  }

  reset() {
    this.basisHistory = [];
  }
}

module.exports = {
  BasisVelocityEngine,
};
