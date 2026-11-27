/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🚀 VN30F V10.0 — Independent Alert Runtime                 ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Strictly Alert-Only. Zero dependencies on Entrade client.   ║
 * ║  Single subscriber/poll owner for alerts (ARC-01, ARC-02)     ║
 * ║  Manages FAST, MICRO, SWING pipelines without race conditions║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { ALERT_CONFIG, validateAlertConfig } = require('./alertConfig');
const { MarketDataService } = require('./data/marketDataService');
const { SnapshotAdapter } = require('./data/snapshotAdapter');
const { CandleAggregator } = require('./data/candleAggregator');
const { resolveActiveContracts } = require('./data/contractResolver');

class AlertRuntime {
  constructor(config = ALERT_CONFIG) {
    validateAlertConfig(config);
    this.config = config;
    this.isRunning = false;
    this.pollTimer = null;

    // Services
    this.marketDataService = new MarketDataService();
    this.snapshotAdapter = new SnapshotAdapter(this.marketDataService);

    // Candle aggregators
    this.aggregator1m = new CandleAggregator({ timeframeMinutes: 1 });
    this.aggregator5m = new CandleAggregator({ timeframeMinutes: 5 });

    // Ingest lock to ensure serialized processing (no concurrent tick overlaps)
    this.isIngesting = false;
    this.lastTickTime = 0;
  }

  /**
   * Start independent alert loop
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`\n🔮 [AlertRuntime V10.0] Khởi động chế độ: ${this.config.mode.toUpperCase()}`);
    console.log(`   🛡️ Alert-Only: ${this.config.alertOnly} | SendOrders: ${this.config.sendOrders}`);

    // Pre-resolve contracts
    try {
      const contracts = await resolveActiveContracts(true);
      if (contracts.resolved) {
        console.log(`   ✅ Active F1M: ${contracts.f1m?.symbol} (${contracts.f1m?.chartCode}) | F2M: ${contracts.f2m?.symbol || 'N/A'}`);
      } else {
        console.warn(`   ⚠️ Không resolve được hợp đồng: ${contracts.error}`);
      }
    } catch (e) {
      console.warn(`   ⚠️ [AlertRuntime] Lỗi resolve contracts:`, e.message);
    }

    // Schedule regular polling
    this.pollTimer = setInterval(() => {
      this.pollCycle().catch(err => {
        console.error('   ❌ [AlertRuntime Poll Error]:', err.message);
      });
    }, this.config.snapshotIntervalMs);

    // Run first cycle immediately
    this.pollCycle().catch(() => {});
  }

  /**
   * Stop independent alert loop
   */
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('   🛑 [AlertRuntime V10.0] Đã dừng');
  }

  /**
   * Single serialized polling cycle
   */
  async pollCycle() {
    if (!this.isRunning || this.isIngesting) return;
    this.isIngesting = true;

    try {
      // 1. Fetch live futures envelope
      const envelope = await this.snapshotAdapter.fetchFuturesEnvelope('VN30F1M');
      this.lastTickTime = envelope.receivedTs;

      // 2. Feed into candle aggregators
      const m1Event = this.aggregator1m.ingest(envelope);
      const m5Event = this.aggregator5m.ingest(envelope);

      // Future engines (PPFE, rolling windows, forecast store) will receive envelope here
    } finally {
      this.isIngesting = false;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      mode: this.config.mode,
      lastTickTime: this.lastTickTime,
      lastEnvelope: this.marketDataService.getLastEnvelope(),
      m1CompletedBars: this.aggregator1m.getCompletedBars(5).length,
      m5CompletedBars: this.aggregator5m.getCompletedBars(5).length,
    };
  }
}

// Singleton instance
let _runtimeInstance = null;

function getAlertRuntime(config = ALERT_CONFIG) {
  if (!_runtimeInstance) {
    _runtimeInstance = new AlertRuntime(config);
  }
  return _runtimeInstance;
}

function startDerivativeAlerts() {
  const runtime = getAlertRuntime();
  runtime.start();
  return runtime;
}

function stopDerivativeAlerts() {
  if (_runtimeInstance) {
    _runtimeInstance.stop();
  }
}

module.exports = {
  AlertRuntime,
  getAlertRuntime,
  startDerivativeAlerts,
  stopDerivativeAlerts,
};
