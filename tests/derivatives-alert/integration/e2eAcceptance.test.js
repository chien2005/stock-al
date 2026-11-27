/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧪 VN30F V10.0 — E2E Acceptance Test Suite (Section 16.1)   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  E2E-01: Difficult session replay (30 -> 40 -> 62 -> 50 -> 41) ║
 * ║  E2E-02: Counter scenario / Invalidation                      ║
 * ║  E2E-03: Data loss / Stale / Unresolved contract abstention   ║
 * ║  E2E-04: Measurable early forecast (Positive lead time)       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ReplayService } = require('../../../src/derivatives/services/replayService');
const { ProactivePricePathForecastEngine } = require('../../../src/derivatives/forecast/forecastEngine');
const { OutcomeEvaluator, OUTCOME_TYPES } = require('../../../src/derivatives/forecast/outcomeEvaluator');

test('E2E-01: Difficult Session Replay (Low supply drift & top deceleration)', () => {
  const replay = new ReplayService();

  // Synthetic price path simulating:
  // 1. Bars 0-5: Crawling up on low volume (30 -> 40)
  // 2. Bars 6-10: Pushing to 62 then decelerating
  // 3. Bars 11-15: Dropping towards 50
  // 4. Bars 16-20: Hitting support at 41 and stabilizing
  const fixtureBars = [
    { timestamp: 100, open: 30, high: 32, low: 29.5, close: 32, volume: 800 },
    { timestamp: 160, open: 32, high: 34, low: 31.8, close: 34, volume: 850 },
    { timestamp: 220, open: 34, high: 37, low: 33.9, close: 37, volume: 900 },
    { timestamp: 280, open: 37, high: 39, low: 36.8, close: 39, volume: 800 },
    { timestamp: 340, open: 39, high: 40.5, low: 38.8, close: 40, volume: 850 },
    { timestamp: 400, open: 40, high: 43, low: 39.8, close: 43, volume: 900 },
    { timestamp: 460, open: 43, high: 52, low: 42.5, close: 52, volume: 1500 },
    { timestamp: 520, open: 52, high: 59, low: 51.5, close: 59, volume: 1600 },
    { timestamp: 580, open: 59, high: 62, low: 58.5, close: 61.8, volume: 1700 }, // Peak 62
    { timestamp: 640, open: 61.8, high: 62.1, low: 61.0, close: 61.2, volume: 1200 }, // Deceleration
    { timestamp: 700, open: 61.2, high: 61.5, low: 56.0, close: 56.5, volume: 2200 }, // Drop
    { timestamp: 760, open: 56.5, high: 57.0, low: 51.0, close: 51.5, volume: 2100 },
    { timestamp: 820, open: 51.5, high: 52.0, low: 48.0, close: 49.0, volume: 2000 },
    { timestamp: 880, open: 49.0, high: 49.5, low: 44.0, close: 45.0, volume: 1800 },
    { timestamp: 940, open: 45.0, high: 45.5, low: 41.0, close: 41.5, volume: 1500 }, // Support 41
    { timestamp: 1000, open: 41.5, high: 43.0, low: 41.0, close: 42.8, volume: 1100 }, // Stabilize
  ];

  const result = replay.runReplay(fixtureBars);
  assert.equal(result.totalBars, 16);
  assert.ok(result.journalEntriesCount > 0);
  assert.ok(result.metrics);
});

test('E2E-02: Counter Scenario / Invalidation Handling', () => {
  const ppfe = new ProactivePricePathForecastEngine();
  const evaluator = new OutcomeEvaluator();

  // Emits early forecast UP with target 1810, invalidation 1800
  const forecast = {
    forecastId: 'F_INV_TEST',
    asOf: 1000,
    validUntil: 6000,
    origin: { price: 1804.0 },
    direction: 'UP',
    primaryTarget: { low: 1809.5, high: 1810.5 },
    invalidation: { level: 1800.0 },
  };

  // Subsequent market breaks down below 1800
  const futureCandles = [
    { startTs: 1500, open: 1804, high: 1804.5, low: 1802, close: 1802.5 },
    { startTs: 2500, open: 1802.5, high: 1803, low: 1798.0, close: 1798.5 }, // Breaches 1800
  ];

  const outcome = evaluator.evaluate(forecast, futureCandles);
  assert.equal(outcome.outcome, OUTCOME_TYPES.INVALIDATION_FIRST);
  assert.equal(outcome.hitFirst, false);
});

test('E2E-03: Missing Data & Degraded Quality Abstention to NO_EDGE', () => {
  const ppfe = new ProactivePricePathForecastEngine();

  // Feed with data quality STALE / DISCONNECTED
  const result = ppfe.generateForecast({
    currentPrice: 1800.0,
    featureBundle: {
      g1Structure: {},
      g2Pressure: {},
      g3Dynamics: {},
      g4Location: {},
      g5CrossMarket: {},
      g6Context: {},
    },
    dataQuality: { state: 'STALE' },
  });

  assert.equal(result.stage, 'NO_EDGE');
  assert.equal(result.forecastId, null);
  assert.ok(result.reason.includes('DATA_QUALITY_STALE'));
});

test('E2E-04: Measurable Early Forecast with Positive Lead Time', () => {
  const evaluator = new OutcomeEvaluator();

  const asOf = 1000;
  const forecast = {
    forecastId: 'F_LEAD_TEST',
    asOf,
    validUntil: 10000,
    origin: { price: 1800.0 },
    direction: 'UP',
    primaryTarget: { low: 1805.0, high: 1806.0 },
    invalidation: { level: 1796.0 },
  };

  // Candle touches target 120s after forecast emission
  const futureCandles = [
    { startTs: 1060, open: 1800, high: 1802, low: 1799, close: 1802 },
    { startTs: 1120, open: 1802, high: 1805.5, low: 1801, close: 1805 }, // Hits target at 1120 (+120s)
  ];

  const outcome = evaluator.evaluate(forecast, futureCandles);
  assert.equal(outcome.outcome, OUTCOME_TYPES.TARGET_BEFORE_INVALIDATION);
  assert.equal(outcome.hitFirst, true);
  assert.equal(outcome.leadTimeMs, 120); // 120ms (in fixture timestamps)
});
