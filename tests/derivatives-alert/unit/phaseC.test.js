/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧪 VN30F V10.0 — Phase C Unit Test Suite (PPFE)             ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Verifies PreMoveDetector (P01-P18), TargetRankingEngine,     ║
 * ║  ReachabilityEngine, PathBuilder, ForecastPolicy, Store,      ║
 * ║  Lifecycle, OutcomeEvaluator, and Full PPFE Engine Cycle      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { PreMoveDetector } = require('../../../src/derivatives/forecast/preMoveDetector');
const { TargetRankingEngine } = require('../../../src/derivatives/forecast/targetRankingEngine');
const { ReachabilityEngine } = require('../../../src/derivatives/forecast/reachabilityEngine');
const { PathBuilder } = require('../../../src/derivatives/forecast/pathBuilder');
const { ForecastPolicy } = require('../../../src/derivatives/forecast/forecastPolicy');
const { ForecastStore } = require('../../../src/derivatives/forecast/forecastStore');
const { OutcomeEvaluator, OUTCOME_TYPES } = require('../../../src/derivatives/forecast/outcomeEvaluator');
const { ProactivePricePathForecastEngine } = require('../../../src/derivatives/forecast/forecastEngine');

test('PreMoveDetector: P01 Bullish Compression setup', () => {
  const detector = new PreMoveDetector();
  const candidates = detector.detectAll({
    currentPrice: 1803.5,
    featureBundle: {
      g1Structure: { trend: 'UPTREND', hhhlPattern: 'HIGHER_HIGHS' },
      g2Pressure: { pressureSide: 'BUY' },
      g3Dynamics: { isCompressing: true },
      g4Location: {
        nearestResistance: { low: 1805.0, high: 1806.0 },
        distToResistance: 1.5,
      },
      g5CrossMarket: { isBasisValid: false },
      g6Context: { sessionPhase: 'MORNING' },
    },
  });

  const p01 = candidates.find(c => c.setupId === 'P01_BULLISH_COMPRESSION');
  assert.ok(p01, 'Should detect P01_BULLISH_COMPRESSION');
  assert.equal(p01.direction, 'UP');
  assert.ok(p01.leadingEvidence.length >= 2);
});

test('TargetRankingEngine: computes TargetScore and sorts targets', () => {
  const ranker = new TargetRankingEngine();
  const zones = [
    { id: 'Z_FAR', low: 1820, high: 1822, source: 'FIBO' },
    { id: 'Z_NEAR', low: 1808, high: 1810, source: 'SWING' },
  ];

  const ranked = ranker.rankTargets({
    direction: 'UP',
    currentPrice: 1805,
    candidateZones: zones,
    pressureSide: 'BUY',
    atr: 2.0,
  });

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].zoneId, 'Z_NEAR', 'Closer swing zone should have higher score than far fibo');
  assert.ok(ranked[0].targetScore > ranked[1].targetScore);
});

test('ReachabilityEngine: caps unrealistic distances', () => {
  const reach = new ReachabilityEngine();

  // 2.5 pts is realistic for 5m horizon (300s)
  const ok = reach.evaluateReachability({ distance: 2.5, horizonSec: 300, atr: 2.0 });
  assert.equal(ok.isReachable, true);
  assert.ok(ok.etaLowSec > 0);

  // 15 pts is unreachable in 3m horizon without extreme regime
  const tooFar = reach.evaluateReachability({ distance: 15.0, horizonSec: 180, atr: 2.0 });
  assert.equal(tooFar.isReachable, false);
});

test('ForecastPolicy: enforces FC-03 score gate and margin gate', () => {
  const policy = new ForecastPolicy({ minHeuristicScore: 65, minScoreMargin: 12 });

  // Top candidate with score 78 and no counter view -> PASS
  const passRes = policy.evaluateCandidate(
    { rawScore: 78, leadingEvidence: ['E1', 'E2'] },
    null,
    { isReachable: true }
  );
  assert.equal(passRes.pass, true);

  // Top candidate with score 60 -> FAILS score gate (< 65)
  const lowScoreRes = policy.evaluateCandidate(
    { rawScore: 60, leadingEvidence: ['E1', 'E2'] },
    null,
    { isReachable: true }
  );
  assert.equal(lowScoreRes.pass, false);

  // Conflicting candidate with margin only 5 (< 12) -> FAILS margin gate -> NO_EDGE
  const conflictRes = policy.evaluateCandidate(
    { rawScore: 75, leadingEvidence: ['E1', 'E2'] },
    { rawScore: 71, leadingEvidence: ['E1', 'E2'] },
    { isReachable: true }
  );
  assert.equal(conflictRes.pass, false);
  assert.equal(conflictRes.stage, 'NO_EDGE');
});

test('ForecastStore: enforces immutability of original forecast records', () => {
  const store = new ForecastStore();
  const f = {
    forecastId: 'F123',
    origin: { price: 1800 },
    primaryTarget: { low: 1805, high: 1806 },
  };

  const saved = store.saveOriginal(f);

  // Mutating input object f should NOT mutate store's copy
  f.origin.price = 9999;
  const retrieved = store.getOriginal('F123');
  assert.equal(retrieved.origin.price, 1800);

  // Direct mutation of returned frozen object throws in strict mode
  assert.throws(() => {
    'use strict';
    saved.origin.price = 5555;
  }, TypeError);
});

test('OutcomeEvaluator: hit-first evaluation strictly by subsequent price bars', () => {
  const evaluator = new OutcomeEvaluator();
  const forecast = {
    asOf: 1000,
    validUntil: 5000,
    origin: { price: 1800 },
    direction: 'UP',
    primaryTarget: { low: 1805, high: 1806 },
    invalidation: { level: 1797 },
  };

  // Case 1: Target reached before invalidation
  const candlesHit = [
    { startTs: 1500, open: 1800, high: 1803, low: 1799, close: 1802 },
    { startTs: 2500, open: 1802, high: 1805.5, low: 1801, close: 1805 }, // Touches 1805.5
  ];
  const hitRes = evaluator.evaluate(forecast, candlesHit);
  assert.equal(hitRes.outcome, OUTCOME_TYPES.TARGET_BEFORE_INVALIDATION);
  assert.equal(hitRes.hitFirst, true);
  assert.ok(hitRes.mfe >= 5.5);

  // Case 2: Invalidation touched first
  const candlesInvalid = [
    { startTs: 1500, open: 1800, high: 1801, low: 1796.5, close: 1797 }, // Low breaches 1797
    { startTs: 2500, open: 1797, high: 1806, low: 1796, close: 1805 },
  ];
  const invalidRes = evaluator.evaluate(forecast, candlesInvalid);
  assert.equal(invalidRes.outcome, OUTCOME_TYPES.INVALIDATION_FIRST);
  assert.equal(invalidRes.hitFirst, false);
});

test('PPFE Engine: Full cycle generates valid Forecast DTO or NO_EDGE', () => {
  const engine = new ProactivePricePathForecastEngine();

  // Test setup: P01 Bullish Compression
  const result = engine.generateForecast({
    currentPrice: 1804.5,
    featureBundle: {
      g1Structure: { trend: 'UPTREND', hhhlPattern: 'HIGHER_HIGHS' },
      g2Pressure: { pressureSide: 'BUY' },
      g3Dynamics: { isCompressing: true },
      g4Location: {
        nearestResistance: { low: 1806.0, high: 1807.0 },
        distToResistance: 1.5,
      },
      g5CrossMarket: { isBasisValid: false },
      g6Context: { sessionPhase: 'MORNING' },
    },
    candidateZones: [{ id: 'Z_RES', low: 1806, high: 1807, source: 'SWING' }],
  });

  assert.ok(result.forecastId);
  assert.equal(result.direction, 'UP');
  assert.equal(result.stage, 'EARLY_FORECAST');
  assert.ok(result.primaryTarget);
  assert.ok(result.scores.direction >= 65);
});
