/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🕯️ VN30F V10.0 — Candle Aggregator (BAR-01 to BAR-05)       ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Aggregates snapshots into M1, M3, M5, M15 candles by         ║
 * ║  calendar timestamp boundaries. Never crosses lunch/segment.  ║
 * ║  Emits BAR_UPDATED (during candle) and BAR_CLOSED (at end).   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class CandleAggregator {
  constructor(options = {}) {
    this.timeframeMinutes = options.timeframeMinutes || 1; // 1, 3, 5, 15
    this.currentBar = null;
    this.completedBars = [];
    this.maxBarsStored = options.maxBarsStored || 300;
  }

  /**
   * Ingest a MarketDataEnvelope or tick.
   * @param {object} event - MarketDataEnvelope
   * @returns {{ type: 'BAR_UPDATED'|'BAR_CLOSED'|'NOOP', bar: object, closedBar?: object }}
   */
  ingest(event) {
    if (!event || !event.price || event.price <= 0) return { type: 'NOOP' };

    const ts = event.receivedTs || Date.now();
    const barStartTs = this._getBarStartTimestamp(ts, this.timeframeMinutes);

    // If currentBar exists and we crossed to a new bar boundary
    if (this.currentBar && this.currentBar.startTs !== barStartTs) {
      const closedBar = {
        ...this.currentBar,
        isClosed: true,
        closedAt: ts,
      };

      this.completedBars.push(closedBar);
      if (this.completedBars.length > this.maxBarsStored) {
        this.completedBars.shift();
      }

      // Initialize new bar with current event
      this.currentBar = this._createNewBar(event, barStartTs);

      return {
        type: 'BAR_CLOSED',
        closedBar,
        bar: this.currentBar,
      };
    }

    // If no currentBar, initialize it
    if (!this.currentBar) {
      this.currentBar = this._createNewBar(event, barStartTs);
      return {
        type: 'BAR_UPDATED',
        bar: this.currentBar,
      };
    }

    // Otherwise, update existing bar
    this.currentBar.high = Math.max(this.currentBar.high, event.price);
    this.currentBar.low = Math.min(this.currentBar.low, event.price);
    this.currentBar.close = event.price;
    this.currentBar.lastTs = ts;
    this.currentBar.sampleCount++;

    // Delta volume in this bar if available
    if (event.lastTradeVolume) {
      this.currentBar.volume += event.lastTradeVolume;
    }

    return {
      type: 'BAR_UPDATED',
      bar: this.currentBar,
    };
  }

  _createNewBar(event, startTs) {
    const d = new Date(startTs);
    const timeLabel = d.toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      timeframe: `${this.timeframeMinutes}m`,
      startTs,
      time: timeLabel,
      open: event.price,
      high: event.price,
      low: event.price,
      close: event.price,
      volume: event.lastTradeVolume || 0,
      cumulativeVolumeStart: event.cumulativeVolume || 0,
      isClosed: false,
      sampleCount: 1,
      lastTs: event.receivedTs || Date.now(),
    };
  }

  _getBarStartTimestamp(ts, periodMinutes) {
    const periodMs = periodMinutes * 60 * 1000;
    return Math.floor(ts / periodMs) * periodMs;
  }

  getCompletedBars(count = 50) {
    return this.completedBars.slice(-count);
  }

  getCurrentBar() {
    return this.currentBar;
  }

  reset() {
    this.currentBar = null;
    this.completedBars = [];
  }
}

module.exports = {
  CandleAggregator,
};
