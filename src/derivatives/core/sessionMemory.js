/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧠 VN30F V10.0 — Session Memory (Section 6.2)               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Maintains PDL, PDH, PDC, Opening Range (OR15), AM High/Low,  ║
 * ║  Intraday High/Low, Session key reaction zones               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class SessionMemory {
  constructor() {
    this.reset();
  }

  reset() {
    this.priorDay = { high: null, low: null, close: null, date: null };
    this.openingRange15 = { high: null, low: null, set: false };
    this.amSession = { high: null, low: null };
    this.intraday = { high: null, low: null, lastPrice: null };
    this.swings = []; // [{ type: 'HIGH'|'LOW', price, ts, confirmedAt }]
    this.keyZones = []; // [{ id, low, high, type, testCount, status }]
  }

  setPriorDay(high, low, close, dateStr = null) {
    this.priorDay = { high, low, close, date: dateStr };
  }

  updateIntradayPrice(price, ts = Date.now()) {
    if (typeof price !== 'number' || isNaN(price)) return;
    this.intraday.lastPrice = price;

    if (this.intraday.high === null || price > this.intraday.high) {
      this.intraday.high = price;
    }
    if (this.intraday.low === null || price < this.intraday.low) {
      this.intraday.low = price;
    }

    // Check opening range (first 15 min of session, 09:00 - 09:15)
    const d = new Date(ts);
    const vnTime = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const t = vnTime.getHours() * 100 + vnTime.getMinutes();

    if (t >= 900 && t <= 915) {
      if (this.openingRange15.high === null || price > this.openingRange15.high) {
        this.openingRange15.high = price;
      }
      if (this.openingRange15.low === null || price < this.openingRange15.low) {
        this.openingRange15.low = price;
      }
    } else if (t > 915) {
      this.openingRange15.set = true;
    }

    // Track AM high/low (until 11:30)
    if (t <= 1130) {
      if (this.amSession.high === null || price > this.amSession.high) {
        this.amSession.high = price;
      }
      if (this.amSession.low === null || price < this.amSession.low) {
        this.amSession.low = price;
      }
    }
  }

  addCausalSwing(type, price, ts, confirmedAt) {
    this.swings.push({ type, price, ts, confirmedAt });
    if (this.swings.length > 50) this.swings.shift();
  }

  getSnapshot() {
    return {
      priorDay: { ...this.priorDay },
      openingRange15: { ...this.openingRange15 },
      amSession: { ...this.amSession },
      intraday: { ...this.intraday },
      recentSwings: this.swings.slice(-6),
    };
  }
}

module.exports = {
  SessionMemory,
};
