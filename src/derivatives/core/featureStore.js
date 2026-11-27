/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F V10.0 — Feature Store (Section 7.4)                ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  G1 Structure, G2 Pressure/Effort, G3 Dynamics, G4 Location,   ║
 * ║  G5 Cross-Market, G6 Context. Tracks evidence & reliability    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class FeatureStore {
  constructor() {
    this.latestBundle = null;
  }

  /**
   * Build unified feature bundle from all sub-engines at given asOfMs.
   */
  buildFeatureBundle({
    asOfMs = Date.now(),
    structure = {},
    pressure = {},
    dynamics = {},
    location = {},
    crossMarket = {},
    context = {},
  }) {
    const bundle = {
      featureSnapshotId: `FS_${asOfMs}_${Math.random().toString(36).substring(2, 7)}`,
      asOf: asOfMs,

      // G1: Structure (HH/HL/LH/LL causal, distance to zone, failed extensions)
      g1Structure: {
        trend: structure.trend || 'NEUTRAL',
        swingHigh: structure.swingHigh || null,
        swingLow: structure.swingLow || null,
        hhhlPattern: structure.hhhlPattern || null, // 'HIGHER_HIGHS' | 'LOWER_HIGHS' | 'COMPRESSION'
        distToHigh: structure.distToHigh || null,
        distToLow: structure.distToLow || null,
        pullbackBars: structure.pullbackBars || 0,
        coverage: structure.coverage || 1.0,
      },

      // G2: Pressure / Effort (RVOL, price efficiency, impact proxy, absorption candidate)
      g2Pressure: {
        pressureSide: pressure.side || 'BALANCED', // 'BUY' | 'SELL' | 'BALANCED' | 'UNKNOWN'
        rvol: pressure.rvol || 1.0,
        priceEfficiency: pressure.priceEfficiency || 0.5,
        effortResultState: pressure.effortResultState || 'BALANCED',
        absorptionState: pressure.absorptionState || null,
        signedVolumeProxy: pressure.signedVolumeProxy || 0,
      },

      // G3: Dynamics (Velocity 5/15/60s, acceleration, deceleration, range compression)
      g3Dynamics: {
        velocity5s: dynamics.velocity5s || 0,
        velocity15s: dynamics.velocity15s || 0,
        velocity60s: dynamics.velocity60s || 0,
        isCompressing: Boolean(dynamics.isCompressing),
        compressionSpan: dynamics.compressionSpan || null,
        isDecelerating: Boolean(dynamics.isDecelerating),
        shockState: dynamics.shockState || 'NORMAL',
      },

      // G4: Location (Zone strength, distance, VWAP, Fibo confluence)
      g4Location: {
        nearestResistance: location.nearestResistance || null,
        distToResistance: location.distToResistance || null,
        nearestSupport: location.nearestSupport || null,
        distToSupport: location.distToSupport || null,
        vwap: location.vwap || null,
        distToVwap: location.distToVwap || null,
        fiboEquilibrium: location.fiboEquilibrium || null,
      },

      // G5: Cross-market (Synchronized basis, basis velocity, VN30 divergence)
      g5CrossMarket: {
        basis: crossMarket.basis !== undefined ? crossMarket.basis : null,
        basisVelocity: crossMarket.basisVelocity || 0,
        basisDivergence: crossMarket.basisDivergence || 'NONE',
        isBasisValid: Boolean(crossMarket.isBasisValid),
      },

      // G6: Context (Session phase, regime age, remaining segment time)
      g6Context: {
        sessionPhase: context.sessionPhase || 'MORNING',
        remainingSegmentMs: context.remainingSegmentMs || 0,
        marketRegime: context.marketRegime || 'CHOPPY',
      },
    };

    this.latestBundle = bundle;
    return bundle;
  }

  getLatest() {
    return this.latestBundle;
  }
}

module.exports = {
  FeatureStore,
};
