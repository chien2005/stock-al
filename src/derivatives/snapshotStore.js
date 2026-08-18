/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   💾 VN30F v4.0 — Snapshot Store                             ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Lưu snapshot mỗi signal để backtest sau                     ║
 * ║  + OI history persistent storage                              ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'signal_snapshots.json');
const OI_HISTORY_FILE = path.join(DATA_DIR, 'oi_history.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── SIGNAL SNAPSHOTS (cho backtest) ─────────────────────────
function saveSignalSnapshot(snapshot) {
  try {
    ensureDataDir();
    let store = { snapshots: [] };
    if (fs.existsSync(SNAPSHOT_FILE)) {
      store = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    }

    store.snapshots.push({
      ...snapshot,
      savedAt: new Date().toISOString(),
    });

    // Giữ tối đa 2000 snapshots (~100 ngày × 20 signals/ngày)
    if (store.snapshots.length > 2000) {
      store.snapshots = store.snapshots.slice(-2000);
    }

    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('   ⚠️ Snapshot save error:', e.message);
  }
}

function updateSnapshotOutcome(timestamp, outcome) {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const store = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    const idx = store.snapshots.findIndex(s => s.timestamp === timestamp);
    if (idx >= 0) {
      store.snapshots[idx] = { ...store.snapshots[idx], ...outcome };
      fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(store, null, 2), 'utf8');
    }
  } catch (e) { /* fail silently */ }
}

function loadSnapshots(limit = 100) {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return [];
    const store = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    return store.snapshots.slice(-limit);
  } catch (e) {
    return [];
  }
}

// ─── OI HISTORY (persistent) ────────────────────────────────
function loadOIHistory() {
  try {
    if (fs.existsSync(OI_HISTORY_FILE)) {
      const raw = fs.readFileSync(OI_HISTORY_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.log(`   ⚠️ Lỗi đọc oi_history.json: ${e.message}`);
  }
  return { lastUpdated: new Date().toISOString(), history: [] };
}

function saveOIHistory(item) {
  try {
    ensureDataDir();
    const store = loadOIHistory();
    const existingIdx = store.history.findIndex(h => h.date === item.date);

    if (existingIdx >= 0) {
      store.history[existingIdx] = { ...store.history[existingIdx], ...item };
    } else {
      store.history.push(item);
    }

    if (store.history.length > 30) {
      store.history = store.history.slice(-30);
    }

    store.lastUpdated = new Date().toISOString();
    fs.writeFileSync(OI_HISTORY_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.log(`   ⚠️ Lỗi ghi oi_history.json: ${e.message}`);
  }
}

module.exports = {
  saveSignalSnapshot,
  updateSnapshotOutcome,
  loadSnapshots,
  loadOIHistory,
  saveOIHistory,
};
