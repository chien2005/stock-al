/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📢 VN30F V10.0 — Event Bus                                  ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Lightweight event router between FAST, MICRO, SWING pipelines║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { EventEmitter } = require('events');

class DerivativesEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish(topic, payload) {
    this.emit(topic, payload);
  }

  subscribe(topic, handler) {
    this.on(topic, handler);
    return () => this.off(topic, handler);
  }
}

const TOPICS = {
  SNAPSHOT_RECEIVED: 'SNAPSHOT_RECEIVED',
  BAR_UPDATED: 'BAR_UPDATED',
  BAR_CLOSED: 'BAR_CLOSED',
  SHOCK_DETECTED: 'SHOCK_DETECTED',
  PRE_MOVE_CANDIDATE: 'PRE_MOVE_CANDIDATE',
  FORECAST_EMITTED: 'FORECAST_EMITTED',
  FORECAST_UPDATED: 'FORECAST_UPDATED',
  FORECAST_INVALIDATED: 'FORECAST_INVALIDATED',
  FORECAST_TARGET_HIT: 'FORECAST_TARGET_HIT',
  FORECAST_EXPIRED: 'FORECAST_EXPIRED',
};

module.exports = {
  DerivativesEventBus,
  TOPICS,
};
