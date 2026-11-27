/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🚀 VN30F V10.0 — Proactive Price Path Forecast Engine (PPFE)║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Orchestrates the 12-step Algorithm (SRS Section 7.3):       ║
 * ║  1. Ingests snapshot & feature bundle                         ║
 * ║  2. Checks session, contract, data quality                    ║
 * ║  3. Detects leading setups (P01-P18)                          ║
 * ║  4. Scores direction & evaluates reachability                 ║
 * ║  5. Ranks targets & selects single primary path               ║
 * ║  6. Enforces hard gates (ForecastPolicy) or abstains (NO_EDGE)║
 * ║  7. Stores immutable record & tracks lifecycle                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { PreMoveDetector } = require('./preMoveDetector');
const { TargetRankingEngine } = require('./targetRankingEngine');
const { ReachabilityEngine } = require('./reachabilityEngine');
const { PathBuilder } = require('./pathBuilder');
const { ScoreEngine } = require('./scoreEngine');
const { ForecastPolicy } = require('./forecastPolicy');
const { ForecastStore } = require('./forecastStore');
const { ForecastLifecycle, FORECAST_STATES } = require('./forecastLifecycle');

class ProactivePricePathForecastEngine {
  constructor(options = {}) {
    this.preMoveDetector = options.preMoveDetector || new PreMoveDetector();
    this.targetRankingEngine = options.targetRankingEngine || new TargetRankingEngine();
    this.reachabilityEngine = options.reachabilityEngine || new ReachabilityEngine();
    this.pathBuilder = options.pathBuilder || new PathBuilder();
    this.scoreEngine = options.scoreEngine || new ScoreEngine();
    this.forecastPolicy = options.forecastPolicy || new ForecastPolicy(options.config);
    this.forecastStore = options.forecastStore || new ForecastStore();
    this.lifecycle = options.lifecycle || new ForecastLifecycle();
    this.clock = options.clock || { now: () => Date.now() };
  }

  /**
   * Run full PPFE cycle for current market state.
   * @param {object} params
   * @returns {object} Forecast DTO or NO_EDGE decision
   */
  generateForecast({
    currentPrice,
    featureBundle,
    candidateZones = [],
    candles = [],
    dataQuality = {},
  }) {
    const asOfMs = this.clock.now();

    // FC-01: Immediate data quality gate check
    if (dataQuality.state === 'INVALID' || dataQuality.state === 'DISCONNECTED' || dataQuality.state === 'STALE') {
      return this._buildNoEdgeResponse(currentPrice, asOfMs, `DATA_QUALITY_${dataQuality.state}`);
    }

    // Step 1: Detect pre-move setup candidates (P01 to P18)
    const candidates = this.preMoveDetector.detectAll({
      currentPrice,
      featureBundle,
      candles,
      zones: candidateZones,
      clock: this.clock,
    });

    if (candidates.length === 0) {
      return this._buildNoEdgeResponse(currentPrice, asOfMs, 'NO_PRE_MOVE_SETUP_DETECTED');
    }

    // Step 2: Separate into UP and DOWN candidates
    const upCandidates = candidates.filter(c => c.direction === 'UP').sort((a, b) => b.rawScore - a.rawScore);
    const downCandidates = candidates.filter(c => c.direction === 'DOWN').sort((a, b) => b.rawScore - a.rawScore);

    const bestUp = upCandidates[0] || null;
    const bestDown = downCandidates[0] || null;

    // Pick leading candidate
    let topCandidate = null;
    let opposingCandidate = null;

    if (bestUp && (!bestDown || bestUp.rawScore >= bestDown.rawScore)) {
      topCandidate = bestUp;
      opposingCandidate = bestDown;
    } else if (bestDown) {
      topCandidate = bestDown;
      opposingCandidate = bestUp;
    }

    // Step 3: Rank targets and check reachability
    const rankedTargets = this.targetRankingEngine.rankTargets({
      direction: topCandidate.direction,
      currentPrice,
      candidateZones,
      pressureSide: featureBundle.g2Pressure?.pressureSide,
      atr: 2.0,
    });

    const primaryTargetZone = rankedTargets[0] || {
      low: topCandidate.direction === 'UP' ? topCandidate.targetHint - 0.5 : topCandidate.targetHint - 1.0,
      high: topCandidate.direction === 'UP' ? topCandidate.targetHint + 1.0 : topCandidate.targetHint + 0.5,
      zoneId: 'T1_DYNAMIC',
      distance: Math.abs(currentPrice - topCandidate.targetHint),
    };

    const reachability = this.reachabilityEngine.evaluateReachability({
      distance: primaryTargetZone.distance || Math.abs(currentPrice - topCandidate.targetHint),
      horizonSec: 300, // 5m default
      atr: 2.0,
      remainingSegmentMs: featureBundle.g6Context?.remainingSegmentMs || 3600000,
    });

    // Step 4: Enforce Hard Gates (ForecastPolicy)
    const gateResult = this.forecastPolicy.evaluateCandidate(
      topCandidate,
      opposingCandidate,
      reachability,
      dataQuality
    );

    if (!gateResult.pass) {
      return this._buildNoEdgeResponse(currentPrice, asOfMs, gateResult.reason);
    }

    // Step 5: Build primary path
    const horizonSec = 300;
    const path = this.pathBuilder.buildPath({
      direction: topCandidate.direction,
      pathType: topCandidate.setupId,
      currentPrice,
      primaryTargetZone,
      secondaryTargetZone: rankedTargets[1] || null,
      invalidationPrice: topCandidate.invalidationHint,
      horizonSec,
    });

    // Step 6: Construct Forecast DTO (SRS Section 13.1)
    const forecastId = `F_${asOfMs}_${Math.random().toString(36).substring(2, 7)}`;
    const forecast = {
      schemaVersion: 1,
      modelVersion: 'heuristic-v10.0.0',
      configVersion: 'research-001',
      forecastId,
      revision: 0,
      instrument: { chartCode: 'VN30F1M' },
      sessionId: featureBundle.g6Context?.sessionPhase || 'MORNING',
      asOf: asOfMs,
      generatedAt: asOfMs,
      validUntil: asOfMs + horizonSec * 1000,
      origin: {
        price: currentPrice,
        setupObservedAt: asOfMs,
      },
      horizon: { id: 'H_SWING', seconds: horizonSec },
      direction: topCandidate.direction,
      pathType: topCandidate.setupId,
      stage: FORECAST_STATES.EARLY_FORECAST,
      primaryTarget: path.primaryTarget,
      conditionalExtension: path.conditionalExtension,
      invalidation: path.invalidation,
      scores: {
        direction: topCandidate.rawScore,
        setup: topCandidate.rawScore,
        target: primaryTargetZone.targetScore || 75,
        margin: opposingCandidate ? topCandidate.rawScore - opposingCandidate.rawScore : 25,
      },
      probability: { calibrated: false, value: null }, // Never claim % on heuristic
      eta: { lowSec: reachability.etaLowSec, highSec: reachability.etaHighSec },
      evidence: topCandidate.leadingEvidence,
      counterEvidence: topCandidate.counterEvidence,
      quality: { mode: 'L1_SNAPSHOT', state: dataQuality.state || 'FRESH' },
    };

    // Save to immutable store
    this.forecastStore.saveOriginal(forecast);
    return forecast;
  }

  _buildNoEdgeResponse(currentPrice, asOfMs, reason) {
    return {
      forecastId: null,
      asOf: asOfMs,
      stage: 'NO_EDGE',
      direction: 'NO_EDGE',
      originPrice: currentPrice,
      primaryTarget: null,
      invalidation: null,
      reason,
      summaryText: '⚪ CHƯA ĐỦ LỢI THẾ DỰ BÁO — Thị trường đang giằng co / thiếu bằng chứng dẫn dắt rõ ràng',
    };
  }

  getStore() {
    return this.forecastStore;
  }
}

module.exports = {
  ProactivePricePathForecastEngine,
};
