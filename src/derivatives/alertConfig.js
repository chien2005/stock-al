/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚙️ VN30F V10.0 — Alert Configuration & Validation         ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Configuration seed values for Proactive Price Path Forecast  ║
 * ║  Strict validation: alert-only, sendOrders MUST be false      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config: globalConfig } = require('../config');

const ALERT_CONFIG_SEED = {
  enabled: process.env.DERIVATIVE_ALERT_V10_ENABLED === 'true' || true,
  mode: process.env.DERIVATIVE_ALERT_MODE || 'SHADOW', // 'SHADOW' | 'LIVE' | 'OFF'
  alertOnly: true,
  sendOrders: false, // HARD INVARIANT: must NEVER be true
  timezone: process.env.TZ || 'Asia/Ho_Chi_Minh',

  // Cadence & polling
  snapshotIntervalMs: 5000,
  windowSec: [5, 15, 30, 60, 180, 300],
  horizonSec: [180, 300, 900], // H_MICRO=180s, H_SWING=300s, H_PATH=900s
  baselineLookbackSessions: 20,

  // Evidence & scoring seeds
  absorptionRelativeVolumeSeed: 1.5,
  minIndependentEvidenceGroups: 2,
  minHeuristicScore: 65,
  minScoreMargin: 12,

  // Calibration seeds (M1/M2)
  enableCalibratedProbability: false,
  minCalibratedDirectionProbabilitySeed: 0.60,
  minProbabilityMarginSeed: 0.15,
  latePathFractionSeed: 0.60,
  maxActivePrimaryPerHorizon: 1,

  // Safety & Data quality
  requireKnownContract: true,
  allowCacheForFastForecast: false,
  allowUnverifiedSnapshotProfile: false,
  forecastAcrossLunch: false,
  allowAuctionForecast: false,

  // Flags & Integrations
  legacyAlertsEnabled: (process.env.LEGACY_ALERTS_ENABLED || 'true') === 'true',
  enableManualPositionContext: false,
  llmInFastPath: false,

  // Telegram routing
  telegramChatId: globalConfig.telegram?.chatIdDerivatives || globalConfig.telegram?.chatId,
  coalesceWindowMs: 30000,
  radarIntervalMs: 300000, // 5 min
};

/**
 * Validate configuration object. Rejects any attempt to enable trading or violate safety invariants.
 */
function validateAlertConfig(cfg = ALERT_CONFIG_SEED) {
  const errors = [];

  if (cfg.sendOrders === true) {
    errors.push('CRITICAL INVARIANT VIOLATION: sendOrders must NEVER be true in alert runtime (ARC-05, NFR-07)');
  }
  if (cfg.alertOnly !== true) {
    errors.push('alertOnly must be true');
  }
  if (!Array.isArray(cfg.horizonSec) || cfg.horizonSec.length === 0) {
    errors.push('horizonSec must be a non-empty array of seconds');
  }
  if (cfg.minHeuristicScore < 0 || cfg.minHeuristicScore > 100) {
    errors.push('minHeuristicScore must be between 0 and 100');
  }

  if (errors.length > 0) {
    throw new Error(`[AlertConfig Validation Error] ${errors.join('; ')}`);
  }
  return true;
}

// Validate immediately on module load
validateAlertConfig(ALERT_CONFIG_SEED);

module.exports = {
  ALERT_CONFIG: Object.freeze({ ...ALERT_CONFIG_SEED }),
  validateAlertConfig,
};
