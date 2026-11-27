/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚡ VN30F V10.0 — Shock Detector (Section 5.5)                ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Two-sided rapid price shock detector:                        ║
 * ║  PRE_SHOCK_PRESSURE -> SHOCK_UP / SHOCK_DOWN -> COOLDOWN     ║
 * ║  Thresholds: 5pts in 15s or 7pts in 60s (symmetric)          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const SHOCK_STATES = {
  NORMAL: 'NORMAL',
  PRE_SHOCK_PRESSURE: 'PRE_SHOCK_PRESSURE',
  SHOCK_UP: 'SHOCK_UP',
  SHOCK_DOWN: 'SHOCK_DOWN',
  COOLDOWN: 'COOLDOWN',
};

class ShockDetector {
  constructor(options = {}) {
    this.fastDropThreshold = options.fastDropThreshold || 5.0;  // 5pts in 15s
    this.slowDropThreshold = options.slowDropThreshold || 7.0;  // 7pts in 60s
    this.cooldownMs = options.cooldownMs || 90000;              // 90s cooldown
    this.lastShockTime = 0;
    this.lastShockType = null;
  }

  /**
   * Check for shocks or precursor pressure from rolling window metrics
   * @param {object} metrics - { w15s, w60s }
   * @param {number} asOfMs
   * @returns {{ state: string, pts: number, direction: 'UP'|'DOWN'|null, isShock: boolean }}
   */
  evaluate(metrics = {}, asOfMs = Date.now()) {
    const { w15s, w60s } = metrics;

    // Check cooldown
    if (this.lastShockTime > 0 && asOfMs - this.lastShockTime < this.cooldownMs) {
      return {
        state: SHOCK_STATES.COOLDOWN,
        pts: 0,
        direction: null,
        isShock: false,
        lastShockType: this.lastShockType,
      };
    }

    // 1. Shock 15s evaluation
    if (w15s && w15s.isReady) {
      if (w15s.priceDelta >= this.fastDropThreshold) {
        this.lastShockTime = asOfMs;
        this.lastShockType = SHOCK_STATES.SHOCK_UP;
        return {
          state: SHOCK_STATES.SHOCK_UP,
          pts: w15s.priceDelta,
          direction: 'UP',
          isShock: true,
          window: '15s',
        };
      } else if (w15s.priceDelta <= -this.fastDropThreshold) {
        this.lastShockTime = asOfMs;
        this.lastShockType = SHOCK_STATES.SHOCK_DOWN;
        return {
          state: SHOCK_STATES.SHOCK_DOWN,
          pts: Math.abs(w15s.priceDelta),
          direction: 'DOWN',
          isShock: true,
          window: '15s',
        };
      }
    }

    // 2. Shock 60s evaluation
    if (w60s && w60s.isReady) {
      if (w60s.priceDelta >= this.slowDropThreshold) {
        this.lastShockTime = asOfMs;
        this.lastShockType = SHOCK_STATES.SHOCK_UP;
        return {
          state: SHOCK_STATES.SHOCK_UP,
          pts: w60s.priceDelta,
          direction: 'UP',
          isShock: true,
          window: '60s',
        };
      } else if (w60s.priceDelta <= -this.slowDropThreshold) {
        this.lastShockTime = asOfMs;
        this.lastShockType = SHOCK_STATES.SHOCK_DOWN;
        return {
          state: SHOCK_STATES.SHOCK_DOWN,
          pts: Math.abs(w60s.priceDelta),
          direction: 'DOWN',
          isShock: true,
          window: '60s',
        };
      }

      // 3. Pre-shock pressure (price moving fast, e.g. >= 3.5pts in 15s)
      if (w15s && w15s.isReady) {
        if (w15s.priceDelta >= 3.5 || w15s.priceDelta <= -3.5) {
          return {
            state: SHOCK_STATES.PRE_SHOCK_PRESSURE,
            pts: Math.abs(w15s.priceDelta),
            direction: w15s.priceDelta > 0 ? 'UP' : 'DOWN',
            isShock: false,
            description: `Áp lực giật giá cực mạnh: ${w15s.priceDelta >= 0 ? '+' : ''}${w15s.priceDelta}đ trong 15s`,
          };
        }
      }
    }

    return {
      state: SHOCK_STATES.NORMAL,
      pts: 0,
      direction: null,
      isShock: false,
    };
  }
}

module.exports = {
  ShockDetector,
  SHOCK_STATES,
};
