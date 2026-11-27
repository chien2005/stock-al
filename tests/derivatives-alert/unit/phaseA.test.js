/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧪 VN30F V10.0 — Phase A Unit Test Suite                    ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Verifies P0 fixes: FIX-01, 02, 05, 06, 07, 10, 12           ║
 * ║  Verifies Data Quality Gate, AlertConfig, CandleAggregator   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// Modules under test
const { ALERT_CONFIG, validateAlertConfig } = require('../../../src/derivatives/alertConfig');
const { DataQualityGate, QUALITY_STATES, PROFILES } = require('../../../src/derivatives/data/dataQualityGate');
const { MarketDataService } = require('../../../src/derivatives/data/marketDataService');
const { CandleAggregator } = require('../../../src/derivatives/data/candleAggregator');
const { resolveActiveContracts, resetContractCache } = require('../../../src/derivatives/data/contractResolver');
const flowEngine = require('../../../src/derivatives/flowEngine');
const fiboEngine = require('../../../src/derivatives/fibonacciLiquidityEngine');

test('AlertConfig: Invariant enforcement (ARC-05, NFR-07)', () => {
  assert.equal(ALERT_CONFIG.sendOrders, false);
  assert.equal(ALERT_CONFIG.alertOnly, true);

  // Must throw if sendOrders: true
  assert.throws(() => {
    validateAlertConfig({ ...ALERT_CONFIG, sendOrders: true });
  }, /CRITICAL INVARIANT VIOLATION/);

  // Must throw if alertOnly: false
  assert.throws(() => {
    validateAlertConfig({ ...ALERT_CONFIG, alertOnly: false });
  }, /alertOnly must be true/);
});

test('DataQualityGate: DQ-01 to DQ-12 state transitions', () => {
  const gate = new DataQualityGate({ staleThresholdMs: 15000, degradedThresholdMs: 5000 });
  const now = 1700000000000;

  // Fresh event
  const freshEvent = {
    price: 1800.5,
    cumulativeVolume: 50000,
    receivedTs: now - 1000,
    flags: {},
  };
  const resFresh = gate.validateEvent(freshEvent, null, now);
  assert.equal(resFresh.isValid, true);
  assert.equal(resFresh.state, QUALITY_STATES.FRESH);

  // Degraded event (cached or older than 5s)
  const degradedEvent = {
    price: 1800.5,
    cumulativeVolume: 50000,
    receivedTs: now - 6000,
    flags: { cached: true },
  };
  const resDegraded = gate.validateEvent(degradedEvent, freshEvent, now);
  assert.equal(resDegraded.isValid, true);
  assert.equal(resDegraded.state, QUALITY_STATES.DEGRADED);

  // Stale event (> 15s)
  const staleEvent = {
    price: 1800.5,
    cumulativeVolume: 50000,
    receivedTs: now - 16000,
    flags: {},
  };
  const resStale = gate.validateEvent(staleEvent, freshEvent, now);
  assert.equal(resStale.isValid, true);
  assert.equal(resStale.state, QUALITY_STATES.STALE);

  // Invalid event (price <= 0 or NaN)
  const invalidEvent = {
    price: -10,
    cumulativeVolume: 50000,
    receivedTs: now,
  };
  const resInvalid = gate.validateEvent(invalidEvent, freshEvent, now);
  assert.equal(resInvalid.isValid, false);
  assert.equal(resInvalid.state, QUALITY_STATES.INVALID);
});

test('CandleAggregator: BAR-01 to BAR-05 aggregations', () => {
  const agg = new CandleAggregator({ timeframeMinutes: 1 });
  const baseTs = 1700000000000; // Even boundary alignment

  // Event 1 at start of minute
  const r1 = agg.ingest({
    price: 1800,
    receivedTs: baseTs + 5000,
    lastTradeVolume: 100,
  });
  assert.equal(r1.type, 'BAR_UPDATED');
  assert.equal(r1.bar.open, 1800);
  assert.equal(r1.bar.high, 1800);

  // Event 2 higher price
  const r2 = agg.ingest({
    price: 1805,
    receivedTs: baseTs + 20000,
    lastTradeVolume: 150,
  });
  assert.equal(r2.type, 'BAR_UPDATED');
  assert.equal(r2.bar.high, 1805);
  assert.equal(r2.bar.close, 1805);

  // Event 3 crosses into next minute -> BAR_CLOSED
  const r3 = agg.ingest({
    price: 1803,
    receivedTs: baseTs + 65000, // +65s
    lastTradeVolume: 50,
  });
  assert.equal(r3.type, 'BAR_CLOSED');
  assert.ok(r3.closedBar);
  assert.equal(r3.closedBar.open, 1800);
  assert.equal(r3.closedBar.high, 1805);
  assert.equal(r3.closedBar.close, 1805);
  assert.equal(r3.closedBar.isClosed, true);
  assert.equal(r3.bar.open, 1803);
});

test('FlowEngine FIX-05: Delta labeled as signedVolumeProxy', () => {
  const fakeData = {
    c: [1800, 1802, 1801, 1804, 1805],
    o: [1799, 1800, 1803, 1802, 1803],
    v: [1000, 1200, 800, 1500, 2000],
    t: [100, 200, 300, 400, 500],
  };
  const flow = flowEngine.analyzeFlow(fakeData);
  assert.equal(flow.isProxy, true);
  assert.ok(flow.delta);
  assert.ok(flow.cvd);
});

test('FlowEngine FIX-06: detectAbsorption compares 3-bar sum vs 3-bar baseline', () => {
  // Construct 15 bars where first 12 bars have baseline vol = 1000
  // and last 3 bars have vol = 1000 (ratio 1.0, NOT absorption)
  const normalBars = {
    c: Array(15).fill(1800),
    o: Array(15).fill(1801),
    v: Array(15).fill(1000),
    h: Array(15).fill(1802),
    l: Array(15).fill(1799),
  };
  const normalRes = flowEngine.detectAbsorption(normalBars);
  assert.equal(normalRes.detected, null, 'Normal volume should NOT trigger absorption');

  // Now make last 3 bars sell with high volume = 2500 each (ratio 2.5x) but price holds
  const absorbBars = {
    c: [...Array(12).fill(1800), 1800, 1800, 1800],
    o: [...Array(12).fill(1801), 1800.5, 1800.5, 1800.5],
    v: [...Array(12).fill(1000), 2500, 2500, 2500],
    h: [...Array(12).fill(1802), 1801, 1801, 1801],
    l: [...Array(12).fill(1799), 1799.5, 1799.5, 1799.5],
  };
  const absorbRes = flowEngine.detectAbsorption(absorbBars);
  assert.equal(absorbRes.detected, 'SELL_ABSORPTION_CANDIDATE');
  assert.ok(absorbRes.volRatio >= 1.5);
});

test('FibonacciLiquidityEngine FIX-10: returns isAvailable: false when no swings', () => {
  const emptyData = { c: [1800, 1800] };
  const fibo = fiboEngine.calculateDynamicFibonacci(emptyData, null, 1800);
  assert.equal(fibo.isAvailable, false);
  assert.equal(fibo.f500, null, 'Must NOT invent fake ±3 price levels');
});

test('FibonacciLiquidityEngine FIX-12: Separates LOW_VOLUME_DECLINE / RALLY from TRAP', () => {
  // Low volume decline without long lower wick -> LOW_VOLUME_DECLINE (not fake trap)
  const lowVolDecline = {
    c: [1800, 1799, 1797],
    o: [1800, 1800, 1799],
    h: [1801, 1800, 1799.5],
    l: [1799, 1798.5, 1796.8],
    v: [800, 900, 700], // Low volume
  };
  const vsaRes = fiboEngine.analyzeVSAIntradayAction(lowVolDecline, null, 1797);
  assert.equal(vsaRes.alertType, 'LOW_VOLUME_DECLINE');
  assert.equal(vsaRes.isTrap, false);
});
