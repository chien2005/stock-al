/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📡 VN30F V10.0 — Alert Router                                ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Routes priority notifications to Telegram with SHADOW mode  ║
 * ║  check and fail-safe error handling                          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { ALERT_CONFIG } = require('../alertConfig');
const { ForecastFormatter } = require('./forecastFormatter');
const { NotificationQueue, PRIORITIES } = require('./notificationQueue');
const { NotificationPolicy } = require('./notificationPolicy');
const { sendDerivativesMessage } = require('../../telegramService');

class AlertRouter {
  constructor(options = {}) {
    this.config = options.config || ALERT_CONFIG;
    this.formatter = options.formatter || new ForecastFormatter();
    this.queue = options.queue || new NotificationQueue();
    this.policy = options.policy || new NotificationPolicy();
    this.isDispatching = false;
  }

  /**
   * Route an Early Forecast
   */
  async routeForecast(forecast) {
    if (!forecast || forecast.stage === 'NO_EDGE') return false;

    const classification = this.policy.classifyAlert('EARLY_FORECAST', forecast);
    const text = this.formatter.formatEarlyForecast(forecast);

    this.queue.enqueue({
      priority: classification.priority,
      key: classification.key,
      text,
      expiryTs: forecast.validUntil,
      asOf: forecast.asOf,
    });

    return this.dispatch();
  }

  /**
   * Route a Weakening Alert
   */
  async routeWeakening(params) {
    const classification = this.policy.classifyAlert('WEAKENING', params);
    const text = this.formatter.formatWeakening(params);

    this.queue.enqueue({
      priority: classification.priority,
      key: classification.key,
      text,
      asOf: Date.now(),
    });

    return this.dispatch();
  }

  /**
   * Route Shock Alert
   */
  async routeShock(shockEvent) {
    const classification = this.policy.classifyAlert('SHOCK_ALERT', shockEvent);
    const text = this.formatter.formatShock(shockEvent);

    this.queue.enqueue({
      priority: classification.priority,
      key: classification.key,
      text,
      asOf: Date.now(),
    });

    return this.dispatch();
  }

  /**
   * Route Invalidation
   */
  async routeInvalidation(forecast, currentPrice) {
    const classification = this.policy.classifyAlert('INVALIDATED', forecast);
    const text = this.formatter.formatInvalidated(forecast, currentPrice);

    this.queue.enqueue({
      priority: classification.priority,
      key: classification.key,
      text,
      asOf: Date.now(),
    });

    return this.dispatch();
  }

  /**
   * Route Target Hit
   */
  async routeTargetHit(forecast, currentPrice) {
    const classification = this.policy.classifyAlert('TARGET_HIT', forecast);
    const text = this.formatter.formatTargetHit(forecast, currentPrice);

    this.queue.enqueue({
      priority: classification.priority,
      key: classification.key,
      text,
      asOf: Date.now(),
    });

    return this.dispatch();
  }

  /**
   * Dispatch queue to Telegram if in LIVE mode, or log if in SHADOW mode.
   */
  async dispatch() {
    if (this.isDispatching) return;
    this.isDispatching = true;

    try {
      while (!this.queue.isEmpty()) {
        const item = this.queue.dequeue();
        if (!item) break;

        if (this.config.mode === 'SHADOW') {
          console.log(`\n👻 [V10 SHADOW ALERT P${item.priority}]:\n${item.text.replace(/<[^>]+>/g, '')}\n`);
          continue;
        }

        if (this.config.mode === 'LIVE') {
          try {
            await sendDerivativesMessage(item.text);
          } catch (err) {
            console.error('   ❌ [AlertRouter Telegram Error]:', err.message);
          }
        }
      }
    } finally {
      this.isDispatching = false;
    }
  }

  getQueue() {
    return this.queue;
  }
}

module.exports = {
  AlertRouter,
};
