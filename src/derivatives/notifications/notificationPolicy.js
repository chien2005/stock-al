/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🛡️ VN30F V10.0 — Notification Policy (FIX-18)                ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Single unified policy for all derivative alerts.             ║
 * ║  Eliminates scattered duplicate formatters across engines.    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { PRIORITIES } = require('./notificationQueue');

class NotificationPolicy {
  /**
   * Determine priority and dedupe key for an alert payload.
   */
  classifyAlert(type, payload = {}) {
    switch (type) {
      case 'DATA_LOSS':
      case 'CONTRACT_MISMATCH':
        return {
          priority: PRIORITIES.P0_RUNTIME,
          key: `P0_${type}`,
        };

      case 'SHOCK_ALERT':
        return {
          priority: PRIORITIES.P1_MARKET_CHANGE,
          key: `P1_SHOCK_${payload.direction}`,
        };

      case 'INVALIDATED':
        return {
          priority: PRIORITIES.P1_MARKET_CHANGE,
          key: `P1_INV_${payload.forecastId}`,
        };

      case 'TARGET_HIT':
        return {
          priority: PRIORITIES.P1_MARKET_CHANGE,
          key: `P1_HIT_${payload.forecastId}`,
        };

      case 'WEAKENING':
        return {
          priority: PRIORITIES.P1_MARKET_CHANGE,
          key: `P1_WEAK_${payload.side}`,
        };

      case 'EARLY_FORECAST':
        return {
          priority: PRIORITIES.P2_EARLY_FORECAST,
          key: `P2_FC_${payload.forecastId}_${payload.direction}`,
        };

      case 'WATCH':
        return {
          priority: PRIORITIES.P3_WATCH,
          key: `P3_WATCH_${payload.side}`,
        };

      case 'RADAR_PERIODIC':
      default:
        return {
          priority: PRIORITIES.P4_RADAR,
          key: 'P4_RADAR',
        };
    }
  }
}

module.exports = {
  NotificationPolicy,
};
