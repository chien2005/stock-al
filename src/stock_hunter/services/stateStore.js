/**
 * AI STOCK HUNTER - Persistent State & Audit Store
 * Lưu trữ trạng thái Regime (hysteresis), Special Watch Episodes (B0-B7),
 * Notification Dedupe Outbox và Audit Log quyết định tại data/sh_state.json.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'sh_state.json');

function createDefaultState() {
  return {
    schemaVersion: '2.0',
    updatedAt: null,
    marketRegime: null,
    specialWatchBySymbol: {},
    supplyDemandBySymbol: {},
    sentOutbox: {}, // { dedupeKey: timestampMs }
    recentDecisions: [], // Tối đa 50 bản ghi audit gần nhất
  };
}

class StateStore {
  constructor(filePath = STATE_FILE) {
    this.filePath = filePath;
    this.state = this.load();
  }

  load() {
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          return { ...createDefaultState(), ...parsed };
        }
      }
    } catch (e) { /* fallback */ }
    return createDefaultState();
  }

  save() {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.state.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.error('⚠️ StateStore.save error:', e.message);
    }
  }

  getState() {
    return this.state;
  }

  updateFromPipeline(pipelineResult) {
    if (!pipelineResult) return;
    if (pipelineResult.nextStateUpdates) {
      this.state.marketRegime = pipelineResult.nextStateUpdates.marketRegime;
      this.state.specialWatchBySymbol = pipelineResult.nextStateUpdates.specialWatchBySymbol;
    }

    const auditEntry = {
      asOf: pipelineResult.asOf,
      session: pipelineResult.session,
      overallAction: pipelineResult.overallAction,
      regime: pipelineResult.marketRegime?.regime,
      buyCount: pipelineResult.buySignals?.length || 0,
      buySymbols: (pipelineResult.buySignals || []).map(b => `${b.symbol}:${b.strategyId}:${b.score}`),
      exitAlerts: (pipelineResult.exitDecisions || []).filter(e => e.action !== 'HOLD').map(e => `${e.symbol}:${e.action}`),
    };
    this.state.recentDecisions.unshift(auditEntry);
    if (this.state.recentDecisions.length > 50) {
      this.state.recentDecisions = this.state.recentDecisions.slice(0, 50);
    }
    this.save();
  }

  shouldSend(dedupeKey, cooldownMs, nowMs = Date.now()) {
    const lastSent = this.state.sentOutbox[dedupeKey];
    if (!lastSent) return true;
    return (nowMs - lastSent) >= cooldownMs;
  }

  markSent(dedupeKey, nowMs = Date.now()) {
    this.state.sentOutbox[dedupeKey] = nowMs;
    // Dọn outbox cũ quá 3 ngày
    const cutoff = nowMs - 3 * 86400 * 1000;
    for (const [k, ts] of Object.entries(this.state.sentOutbox)) {
      if (ts < cutoff) delete this.state.sentOutbox[k];
    }
    this.save();
  }
}

module.exports = { StateStore };
