/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📬 VN30F V10.0 — Notification Queue (Section 10.2 & 10.3)   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Priority Queue:                                              ║
 * ║  P0: DATA/RUNTIME incidents                                   ║
 * ║  P1: MARKET CHANGE (Invalidation, Shock, Weakening)           ║
 * ║  P2: EARLY FORECAST (New high-evidence path)                  ║
 * ║  P3: CONFIRMATION / WATCH (Coalesced 30-60s)                  ║
 * ║  P4: RADAR (Periodic 5m)                                      ║
 * ║  Enforces dedupe (LC-08) & expiry suppression (LC-07)         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const PRIORITIES = {
  P0_RUNTIME: 0,
  P1_MARKET_CHANGE: 1,
  P2_EARLY_FORECAST: 2,
  P3_WATCH: 3,
  P4_RADAR: 4,
};

class NotificationQueue {
  constructor(options = {}) {
    this.queue = [];
    this.maxQueueSize = options.maxQueueSize || 50;
    this.sentLog = []; // [{ key, ts, priority }]
    this.coalesceWindowMs = options.coalesceWindowMs || 30000;
  }

  /**
   * Enqueue a notification item.
   * @param {object} item - { priority, key, text, expiryTs, asOf }
   * @returns {boolean} Whether item was queued
   */
  enqueue(item) {
    if (!item || !item.text) return false;
    const now = Date.now();

    // LC-07: Do not enqueue if already expired
    if (item.expiryTs && now >= item.expiryTs) {
      return false;
    }

    // LC-08: Deduplicate by key within coalesce window
    if (item.key) {
      const recentSend = this.sentLog.find(l => l.key === item.key && (now - l.ts < this.coalesceWindowMs));
      if (recentSend) {
        // If higher priority than previous, allow through
        if (item.priority >= recentSend.priority) {
          return false;
        }
      }
    }

    // Bounded queue enforcement
    if (this.queue.length >= this.maxQueueSize) {
      // Drop lowest priority item
      this.queue.sort((a, b) => a.priority - b.priority);
      this.queue.pop();
    }

    this.queue.push({
      ...item,
      enqueuedAt: now,
    });

    // Keep sorted by highest priority (P0=0 lowest number = highest priority)
    this.queue.sort((a, b) => a.priority - b.priority);
    return true;
  }

  /**
   * Dequeue next highest-priority notification ready to send.
   */
  dequeue() {
    const now = Date.now();

    while (this.queue.length > 0) {
      const item = this.queue.shift();

      // Check expiry before delivery (LC-07)
      if (item.expiryTs && now >= item.expiryTs) {
        continue; // Discard expired item
      }

      // Record in sent log
      this.sentLog.push({
        key: item.key || 'NO_KEY',
        ts: now,
        priority: item.priority,
      });

      if (this.sentLog.length > 100) this.sentLog.shift();
      return item;
    }

    return null;
  }

  isEmpty() {
    return this.queue.length === 0;
  }

  clear() {
    this.queue = [];
  }
}

module.exports = {
  NotificationQueue,
  PRIORITIES,
};
