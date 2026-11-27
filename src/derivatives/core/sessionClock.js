/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⏰ VN30F V10.0 — Session Clock (TIME-01 to TIME-03)         ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Injectable clock supporting live execution and virtual replay║
 * ║  Defines exact session profiles and boundaries                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const SESSION_PHASES = {
  PRE_OPEN: 'PRE_OPEN',     // Before 08:45
  ATO: 'ATO',               // 08:45 - 09:00
  OPEN_WARMUP: 'OPEN_WARMUP', // 09:00 - 09:15
  MORNING: 'MORNING',       // 09:15 - 11:15
  PRE_LUNCH: 'PRE_LUNCH',   // 11:15 - 11:30
  LUNCH: 'LUNCH',           // 11:30 - 13:00 (Break)
  REOPEN: 'REOPEN',         // 13:00 - 13:10 (Warmup)
  AFTERNOON: 'AFTERNOON',   // 13:10 - 14:15
  PRE_ATC: 'PRE_ATC',       // 14:15 - 14:30
  ATC: 'ATC',               // 14:30 - 14:45
  CLOSED: 'CLOSED',         // After 14:45 or Weekends
};

class SessionClock {
  constructor(options = {}) {
    this.virtualNowMs = options.virtualNowMs || null;
    this.timezone = options.timezone || 'Asia/Ho_Chi_Minh';
  }

  /**
   * Get current timestamp in UTC ms (supports virtual time injection)
   */
  now() {
    return this.virtualNowMs !== null ? this.virtualNowMs : Date.now();
  }

  setVirtualTime(ms) {
    this.virtualNowMs = ms;
  }

  clearVirtualTime() {
    this.virtualNowMs = null;
  }

  /**
   * Get VN time details
   */
  getVnDate(ts = this.now()) {
    const d = new Date(ts);
    return new Date(d.toLocaleString('en-US', { timeZone: this.timezone }));
  }

  /**
   * Get current phase
   */
  getPhase(ts = this.now()) {
    const vn = this.getVnDate(ts);
    const day = vn.getDay();
    if (day < 1 || day > 5) return SESSION_PHASES.CLOSED;

    const t = vn.getHours() * 100 + vn.getMinutes();

    if (t < 845) return SESSION_PHASES.PRE_OPEN;
    if (t < 900) return SESSION_PHASES.ATO;
    if (t < 915) return SESSION_PHASES.OPEN_WARMUP;
    if (t < 1115) return SESSION_PHASES.MORNING;
    if (t < 1130) return SESSION_PHASES.PRE_LUNCH;
    if (t < 1300) return SESSION_PHASES.LUNCH;
    if (t < 1310) return SESSION_PHASES.REOPEN;
    if (t < 1415) return SESSION_PHASES.AFTERNOON;
    if (t < 1430) return SESSION_PHASES.PRE_ATC;
    if (t < 1445) return SESSION_PHASES.ATC;
    return SESSION_PHASES.CLOSED;
  }

  isTradingContinuous(ts = this.now()) {
    const phase = this.getPhase(ts);
    return phase === SESSION_PHASES.OPEN_WARMUP ||
      phase === SESSION_PHASES.MORNING ||
      phase === SESSION_PHASES.PRE_LUNCH ||
      phase === SESSION_PHASES.REOPEN ||
      phase === SESSION_PHASES.AFTERNOON ||
      phase === SESSION_PHASES.PRE_ATC;
  }

  /**
   * Milliseconds remaining until end of current segment (morning 11:30 or afternoon 14:30)
   */
  getRemainingSegmentMs(ts = this.now()) {
    const vn = this.getVnDate(ts);
    const h = vn.getHours();
    const m = vn.getMinutes();
    const s = vn.getSeconds();
    const totalSec = h * 3600 + m * 60 + s;

    if (totalSec >= 9 * 3600 && totalSec < 11.5 * 3600) {
      // Morning segment ends at 11:30:00 (41400s)
      return Math.max(0, (41400 - totalSec) * 1000);
    } else if (totalSec >= 13 * 3600 && totalSec < 14.5 * 3600) {
      // Afternoon segment ends at 14:30:00 (52200s)
      return Math.max(0, (52200 - totalSec) * 1000);
    }
    return 0;
  }
}

module.exports = {
  SessionClock,
  SESSION_PHASES,
};
