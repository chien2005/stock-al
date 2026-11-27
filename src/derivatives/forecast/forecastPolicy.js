/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🛡️ VN30F V10.0 — Forecast Policy & Hard Gates (Sec 7.6)     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Enforces FC-01 to FC-08:                                     ║
 * ║  FC-01: Valid data profile & reachability                     ║
 * ║  FC-02: At least 2 independent evidence groups                ║
 * ║  FC-03: Score >= 65 and margin >= 12 against counter view     ║
 * ║  FC-06: Abstention -> NO_EDGE when evidence insufficient      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class ForecastPolicy {
  constructor(config = {}) {
    this.minHeuristicScore = config.minHeuristicScore || 65;
    this.minScoreMargin = config.minScoreMargin || 12;
    this.minIndependentEvidenceGroups = config.minIndependentEvidenceGroups || 2;
  }

  /**
   * Evaluate whether top candidate passes hard gates or must abstain to NO_EDGE.
   * @param {object} topCandidate
   * @param {object} opposingCandidate
   * @param {object} reachability
   * @param {object} dataQuality
   * @returns {{ pass: boolean, reason?: string, stage: string }}
   */
  evaluateCandidate(topCandidate, opposingCandidate, reachability, dataQuality = {}) {
    // FC-01: Data quality check
    if (dataQuality.state === 'INVALID' || dataQuality.state === 'DISCONNECTED' || dataQuality.state === 'STALE') {
      return { pass: false, stage: 'NO_EDGE', reason: `DATA_QUALITY_${dataQuality.state}` };
    }

    if (!topCandidate) {
      return { pass: false, stage: 'NO_EDGE', reason: 'NO_CANDIDATE_FOUND' };
    }

    // FC-04: Reachability check
    if (!reachability || !reachability.isReachable) {
      return { pass: false, stage: 'NO_EDGE', reason: reachability?.reason || 'TARGET_UNREACHABLE' };
    }

    // FC-02: Min independent evidence groups
    const leadingCount = topCandidate.leadingEvidence?.length || 0;
    if (leadingCount < this.minIndependentEvidenceGroups) {
      return {
        pass: false,
        stage: 'WATCHING',
        reason: `INSUFFICIENT_EVIDENCE_GROUPS_${leadingCount}_LESS_THAN_${this.minIndependentEvidenceGroups}`,
      };
    }

    // FC-03: Score gate (score >= 65)
    if (topCandidate.rawScore < this.minHeuristicScore) {
      return {
        pass: false,
        stage: 'WATCHING',
        reason: `SCORE_${topCandidate.rawScore}_BELOW_MIN_${this.minHeuristicScore}`,
      };
    }

    // FC-03: Margin gate (score difference against counter view >= 12)
    if (opposingCandidate) {
      const margin = topCandidate.rawScore - opposingCandidate.rawScore;
      if (margin < this.minScoreMargin) {
        return {
          pass: false,
          stage: 'NO_EDGE',
          reason: `CONFLICTING_VIEWS_MARGIN_${margin}_BELOW_${this.minScoreMargin}`,
        };
      }
    }

    return {
      pass: true,
      stage: 'EARLY_FORECAST',
    };
  }
}

module.exports = {
  ForecastPolicy,
};
