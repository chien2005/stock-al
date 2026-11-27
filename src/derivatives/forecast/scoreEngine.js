/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚖️ VN30F V10.0 — Score Engine (Section 9.4)                 ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Weighted direction score from G1-G6:                        ║
 * ║  G1 25%, G2 25%, G3 20%, G4 15%, G5 10%, G6 5%               ║
 * ║  Formula: candidateScore = clamp(50 + 50*evidence - pen, 0, 100)║
 * ║  CRITICAL INVARIANT: Heuristic score is NOT probability %    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class ScoreEngine {
  constructor() {
    this.weights = {
      g1: 0.25, // Structure
      g2: 0.25, // Pressure/Effort
      g3: 0.20, // Dynamics
      g4: 0.15, // Location
      g5: 0.10, // Cross-market
      g6: 0.05, // Context
    };
  }

  /**
   * Calculate direction score [-1, +1] where +1 is pure UP, -1 is pure DOWN.
   */
  evaluateSignedEvidence(featureBundle) {
    if (!featureBundle) return 0.0;
    const { g1Structure, g2Pressure, g3Dynamics, g4Location, g5CrossMarket } = featureBundle;

    let g1 = 0;
    if (g1Structure.trend === 'UPTREND') g1 = 0.8;
    else if (g1Structure.trend === 'DOWNTREND') g1 = -0.8;

    let g2 = 0;
    if (g2Pressure.pressureSide === 'BUY') g2 = 0.85;
    else if (g2Pressure.pressureSide === 'SELL') g2 = -0.85;

    let g3 = 0;
    if (g3Dynamics.velocity15s > 0.02) g3 = 0.75;
    else if (g3Dynamics.velocity15s < -0.02) g3 = -0.75;

    let g4 = 0;
    if (g4Location.distToResistance && g4Location.distToSupport) {
      if (g4Location.distToResistance < g4Location.distToSupport) g4 = 0.5;
      else g4 = -0.5;
    }

    let g5 = 0;
    if (g5CrossMarket.basisDivergence === 'F1_LEAD_BULLISH') g5 = 0.7;
    else if (g5CrossMarket.basisDivergence === 'F1_LEAD_BEARISH') g5 = -0.7;

    const weightedEvidence =
      this.weights.g1 * g1 +
      this.weights.g2 * g2 +
      this.weights.g3 * g3 +
      this.weights.g4 * g4 +
      this.weights.g5 * g5;

    return Math.max(-1.0, Math.min(1.0, weightedEvidence));
  }

  /**
   * Computes candidateScore in [0, 100].
   */
  calculateCandidateScore({
    direction = 'UP',
    signedEvidence = 0,
    conflictPenalty = 0,
    latenessPenalty = 0,
    qualityPenalty = 0,
  }) {
    const alignedEvidence = direction === 'UP' ? signedEvidence : -signedEvidence;
    const baseScore = 50 + 50 * alignedEvidence;
    const finalScore = baseScore - conflictPenalty - latenessPenalty - qualityPenalty;

    return Math.max(0, Math.min(100, Math.round(finalScore)));
  }
}

module.exports = {
  ScoreEngine,
};
