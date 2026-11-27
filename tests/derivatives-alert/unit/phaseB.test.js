/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧪 VN30F V10.0 — Phase B Unit Test Suite                    ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Verifies SessionClock, RollingWindowStore, SessionMemory,   ║
 * ║  FeatureStore, AdaptiveBaseline, EffortResult, Pressure,     ║
 * ║  SlowReversal, ShockDetector, Lifecycle, Zone, BasisVelocity ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { SessionClock, SESSION_PHASES } = require('../../../src/derivatives/core/sessionClock');
const { RollingWindowStore } = require('../../../src/derivatives/core/rollingWindowStore');
const { SessionMemory } = require('../../../src/derivatives/core/sessionMemory');
const { FeatureStore } = require('../../../src/derivatives/core/featureStore');
const { AdaptiveBaselineEngine } = require('../../../src/derivatives/engines/adaptiveBaseline');
const { EffortResultEngine, EFFORT_STATES } = require('../../../src/derivatives/engines/effortResultEngine');
const { PressureEngine, PRESSURE_SIDES } = require('../../../src/derivatives/engines/pressureEngine');
const { SlowReversalEngine } = require('../../../src/derivatives/engines/slowReversalEngine');
const { ShockDetector, SHOCK_STATES } = require('../../../src/derivatives/engines/shockDetector');
const { SupplyDemandLifecycleEngine, SD_LIFECYCLE_STATES } = require('../../../src/derivatives/engines/supplyDemandLifecycle');
const { ZoneEngine, ZONE_STATUSES } = require('../../../src/derivatives/engines/zoneEngine');
const { BasisVelocityEngine } = require('../../../src/derivatives/engines/basisVelocityEngine');

test('SessionClock: virtual time injection & phase mapping (TIME-01 to TIME-03)', () => {
  const clock = new SessionClock();

  // Test Tuesday 10:15 VN time -> MORNING phase
  // 2026-11-24 is Tuesday. 10:15 VN time = 03:15 UTC
  const morningUtc = Date.UTC(2026, 10, 24, 3, 15, 0);
  clock.setVirtualTime(morningUtc);

  assert.equal(clock.getPhase(), SESSION_PHASES.MORNING);
  assert.equal(clock.isTradingContinuous(), true);
  assert.ok(clock.getRemainingSegmentMs() > 0);

  // Test 11:45 VN time -> LUNCH phase
  const lunchUtc = Date.UTC(2026, 10, 24, 4, 45, 0);
  clock.setVirtualTime(lunchUtc);
  assert.equal(clock.getPhase(), SESSION_PHASES.LUNCH);
  assert.equal(clock.isTradingContinuous(), false);
});

test('RollingWindowStore: multi-window velocity & price efficiency', () => {
  const store = new RollingWindowStore({ windows: [5, 15, 60] });
  const base = 1000000;

  store.ingest({ receivedTs: base, price: 1800.0, cumulativeVolume: 1000 });
  store.ingest({ receivedTs: base + 2000, price: 1801.0, cumulativeVolume: 1200 });
  store.ingest({ receivedTs: base + 5000, price: 1802.5, cumulativeVolume: 1500 });

  const m5s = store.getWindowMetrics(5, base + 5000);
  assert.equal(m5s.isReady, true);
  assert.equal(m5s.priceDelta, 2.5);
  assert.equal(m5s.volumeDelta, 500);
  assert.ok(m5s.priceEfficiency > 0.8);
});

test('SessionMemory: tracks OR15, AM session, intraday high/low', () => {
  const mem = new SessionMemory();
  mem.setPriorDay(1810, 1795, 1805, '2026-11-26');

  const morningTs = Date.UTC(2026, 10, 27, 2, 5, 0); // 09:05 VN time
  mem.updateIntradayPrice(1800, morningTs);
  mem.updateIntradayPrice(1806, morningTs + 60000);
  mem.updateIntradayPrice(1798, morningTs + 120000);

  const snap = mem.getSnapshot();
  assert.equal(snap.intraday.high, 1806);
  assert.equal(snap.intraday.low, 1798);
  assert.equal(snap.openingRange15.high, 1806);
  assert.equal(snap.priorDay.close, 1805);
});

test('AdaptiveBaseline: robustZ & MAD computation', () => {
  const engine = new AdaptiveBaselineEngine();
  const history = [1000, 1050, 950, 1020, 980, 1010, 1030, 990, 1005, 995];

  // Ingest samples into MORNING phase
  history.forEach(v => engine.ingestSample('MORNING', v, 0.5));

  const zNormal = engine.robustZ(1005, history);
  assert.ok(Math.abs(zNormal) < 1.0, 'Normal value should have Z < 1.0');

  const zSpike = engine.robustZ(3000, history);
  assert.ok(zSpike > 3.0, 'Large spike should have Z > 3.0');
});

test('EffortResultEngine: detects absorption and expansion', () => {
  const engine = new EffortResultEngine();

  // High volume (2.0x) but small price move (0.5pt) near support -> SELL_ABSORPTION_CANDIDATE
  const absorb = engine.evaluate({
    priceDelta: -0.5,
    volumeDelta: 3000,
    baselineVolume: 1500,
    priceEfficiency: 0.2,
    isNearSupport: true,
  });
  assert.equal(absorb.state, EFFORT_STATES.SELL_ABSORPTION_CANDIDATE);
  assert.ok(absorb.score >= 70);

  // High volume (2.0x) and strong price move (+3.0pt) -> UP_EXPANSION
  const expand = engine.evaluate({
    priceDelta: 3.0,
    volumeDelta: 3000,
    baselineVolume: 1500,
    priceEfficiency: 0.8,
  });
  assert.equal(expand.state, EFFORT_STATES.UP_EXPANSION);
});

test('ShockDetector: detects fast drop shock and pre-shock pressure', () => {
  const detector = new ShockDetector({ fastDropThreshold: 5.0, slowDropThreshold: 7.0 });

  // 15s drop of 5.5 points -> SHOCK_DOWN
  const shockRes = detector.evaluate({
    w15s: { isReady: true, priceDelta: -5.5 },
    w60s: { isReady: true, priceDelta: -6.0 },
  }, 1000000);

  assert.equal(shockRes.isShock, true);
  assert.equal(shockRes.state, SHOCK_STATES.SHOCK_DOWN);

  // During cooldown, should not fire again
  const cooldownRes = detector.evaluate({
    w15s: { isReady: true, priceDelta: -6.0 },
  }, 1020000);
  assert.equal(cooldownRes.state, SHOCK_STATES.COOLDOWN);
});

test('SlowReversalEngine: detects deceleration at swing high (P03/P04 precursor)', () => {
  const engine = new SlowReversalEngine();

  // 6 candles reaching near 62 where highs stop expanding and downward pushes increase
  const candles = [
    { close: 60.5, high: 61.0, low: 60.0 },
    { close: 61.5, high: 61.8, low: 60.8 },
    { close: 61.9, high: 62.0, low: 61.2 },
    { close: 61.6, high: 62.0, low: 61.3 },
    { close: 61.8, high: 62.1, low: 61.4 },
    { close: 61.2, high: 61.9, low: 61.0 },
  ];

  const res = engine.detectDeceleration({
    candles,
    currentPrice: 61.5,
    swingHigh: 62.0,
    trend: 'UPTREND',
  });

  assert.equal(res.isDecelerating, true);
  assert.equal(res.side, 'BEARISH_DECELERATION');
  assert.ok(res.score >= 70);
});

test('SupplyDemandLifecycle: DOMINANT -> DECELERATING warning (SD-02)', () => {
  const engine = new SupplyDemandLifecycleEngine();

  // Strong buyers dominant
  const r1 = engine.update({ pressureSide: 'BUY', pressureIntensity: 75, isDecelerating: false });
  assert.equal(r1.currentState, SD_LIFECYCLE_STATES.DOMINANT);
  assert.equal(r1.dominantSide, 'BUYERS');

  // Buyers momentum decelerating -> DECELERATING warning before sellers take over
  const r2 = engine.update({ pressureSide: 'BUY', pressureIntensity: 40, isDecelerating: true });
  assert.equal(r2.currentState, SD_LIFECYCLE_STATES.DECELERATING);
  assert.equal(r2.isWeakening, true);
});

test('ZoneEngine: lifecycle transitions ACTIVE -> TESTING -> WEAKENED -> BROKEN', () => {
  const engine = new ZoneEngine();
  const z = engine.addZone({ low: 1800, high: 1802, type: 'SUPPORT' });

  assert.equal(z.status, ZONE_STATUSES.ACTIVE);

  // Price tests zone 3 times -> WEAKENED
  engine.updateZones(1801);
  engine.updateZones(1801);
  engine.updateZones(1801);
  assert.equal(z.status, ZONE_STATUSES.WEAKENED);

  // Price breaks through zone below 1798.5 -> BROKEN
  engine.updateZones(1797);
  assert.equal(z.status, ZONE_STATUSES.BROKEN);
});

test('BasisVelocityEngine: synchronized basis and DQ-11 timestamp gate', () => {
  const engine = new BasisVelocityEngine(10000);
  const now = 1700000000000;

  // Timestamps in sync (within 10s)
  const syncRes = engine.ingest(1805.0, now, 1800.0, now - 1000);
  assert.equal(syncRes.isBasisValid, true);
  assert.equal(syncRes.basis, 5.0);

  // Timestamps out of sync (> 10s) -> DQ-11 gate reject
  const desyncRes = engine.ingest(1805.0, now, 1800.0, now - 15000);
  assert.equal(desyncRes.isBasisValid, false);
  assert.equal(desyncRes.divergence, 'UNAVAILABLE_TIMESTAMP_MISMATCH');
});
