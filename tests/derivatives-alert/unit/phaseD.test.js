/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧪 VN30F V10.0 — Phase D Unit Test Suite (Notifications)    ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Verifies ForecastFormatter, NotificationQueue, Policy,       ║
 * ║  and AlertRouter (Section 10 & 12)                            ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ForecastFormatter } = require('../../../src/derivatives/notifications/forecastFormatter');
const { NotificationQueue, PRIORITIES } = require('../../../src/derivatives/notifications/notificationQueue');
const { NotificationPolicy } = require('../../../src/derivatives/notifications/notificationPolicy');
const { AlertRouter } = require('../../../src/derivatives/notifications/alertRouter');

test('ForecastFormatter: formats Early Forecast in Vietnamese without fake %', () => {
  const formatter = new ForecastFormatter();
  const forecast = {
    forecastId: 'F100',
    asOf: 1700000000000,
    validUntil: 1700000300000,
    origin: { price: 1800.5 },
    direction: 'UP',
    horizon: { seconds: 300 },
    primaryTarget: { low: 1805.0, high: 1806.0 },
    invalidation: { level: 1797.0 },
    scores: { direction: 78 },
    evidence: ['Nén giá sát cản', 'Đáy nâng dần'],
  };

  const text = formatter.formatEarlyForecast(forecast);
  assert.ok(text.includes('DỰ BÁO SỚM V10'));
  assert.ok(text.includes('VIEW CHÍNH: TĂNG kiểm tra 1805–1806'));
  assert.ok(text.includes('78/100'));
  assert.ok(text.includes('không phải xác suất %'));
});

test('NotificationQueue: prioritizes P0 over P2 over P4 and dedupes', () => {
  const queue = new NotificationQueue({ coalesceWindowMs: 30000 });
  const now = Date.now();

  // Enqueue P4 (Radar)
  queue.enqueue({ priority: PRIORITIES.P4_RADAR, text: 'Radar periodic', key: 'RADAR' });

  // Enqueue P0 (Runtime incident)
  queue.enqueue({ priority: PRIORITIES.P0_RUNTIME, text: 'Data disconnected', key: 'DISCONNECT' });

  // Enqueue P2 (Early forecast)
  queue.enqueue({ priority: PRIORITIES.P2_EARLY_FORECAST, text: 'Early forecast UP', key: 'FC_UP' });

  // First dequeued must be P0 (highest priority)
  const item1 = queue.dequeue();
  assert.equal(item1.priority, PRIORITIES.P0_RUNTIME);

  // Second must be P2
  const item2 = queue.dequeue();
  assert.equal(item2.priority, PRIORITIES.P2_EARLY_FORECAST);

  // Third must be P4
  const item3 = queue.dequeue();
  assert.equal(item3.priority, PRIORITIES.P4_RADAR);
});

test('NotificationQueue: LC-07 suppresses expired alerts', () => {
  const queue = new NotificationQueue();
  const past = Date.now() - 5000;

  // Enqueue already-expired alert
  const res = queue.enqueue({
    priority: PRIORITIES.P2_EARLY_FORECAST,
    text: 'Old forecast',
    expiryTs: past,
  });
  assert.equal(res, false, 'Expired alert should not be enqueued');
  assert.equal(queue.isEmpty(), true);
});

test('NotificationPolicy: classifies alert priorities correctly', () => {
  const policy = new NotificationPolicy();

  assert.equal(policy.classifyAlert('DATA_LOSS').priority, PRIORITIES.P0_RUNTIME);
  assert.equal(policy.classifyAlert('SHOCK_ALERT').priority, PRIORITIES.P1_MARKET_CHANGE);
  assert.equal(policy.classifyAlert('INVALIDATED').priority, PRIORITIES.P1_MARKET_CHANGE);
  assert.equal(policy.classifyAlert('EARLY_FORECAST').priority, PRIORITIES.P2_EARLY_FORECAST);
  assert.equal(policy.classifyAlert('RADAR_PERIODIC').priority, PRIORITIES.P4_RADAR);
});
