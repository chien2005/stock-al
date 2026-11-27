/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🌪️ VN30F V10.0 — Pressure Engine                            ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Classifies market pressure: BUY, SELL, BALANCED, UNKNOWN      ║
 * ║  Synthesizes multi-window velocity, signed volume proxy,      ║
 * ║  and price impact into a single directional pressure score    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const PRESSURE_SIDES = {
  BUY: 'BUY',
  SELL: 'SELL',
  BALANCED: 'BALANCED',
  UNKNOWN: 'UNKNOWN',
};

class PressureEngine {
  /**
   * Classify pressure side and intensity from rolling window metrics
   * @param {object} rollingMetrics - { w5s, w15s, w60s }
   * @returns {{ side: string, intensity: number, reasons: string[] }}
   */
  classifyPressure(rollingMetrics = {}) {
    const { w5s, w15s, w60s } = rollingMetrics;
    const reasons = [];

    if (!w15s || !w15s.isReady) {
      return { side: PRESSURE_SIDES.UNKNOWN, intensity: 0, reasons: ['INSUFFICIENT_WINDOW_DATA'] };
    }

    let buyScore = 0;
    let sellScore = 0;

    // Fast 5s pulse
    if (w5s && w5s.isReady) {
      if (w5s.priceDelta >= 0.8) {
        buyScore += 25;
        reasons.push(`PULSE_5S_UP_+${w5s.priceDelta}D`);
      } else if (w5s.priceDelta <= -0.8) {
        sellScore += 25;
        reasons.push(`PULSE_5S_DOWN_${w5s.priceDelta}D`);
      }
    }

    // Medium 15s pressure
    if (w15s.priceDelta >= 1.2) {
      buyScore += 35;
      reasons.push(`MOVE_15S_UP_+${w15s.priceDelta}D`);
    } else if (w15s.priceDelta <= -1.2) {
      sellScore += 35;
      reasons.push(`MOVE_15S_DOWN_${w15s.priceDelta}D`);
    }

    // 60s micro trend
    if (w60s && w60s.isReady) {
      if (w60s.priceDelta >= 1.8 && w60s.priceEfficiency >= 0.5) {
        buyScore += 40;
        reasons.push(`MICRO_60S_UP_+${w60s.priceDelta}D_EFF_${w60s.priceEfficiency}`);
      } else if (w60s.priceDelta <= -1.8 && w60s.priceEfficiency >= 0.5) {
        sellScore += 40;
        reasons.push(`MICRO_60S_DOWN_${w60s.priceDelta}D_EFF_${w60s.priceEfficiency}`);
      }
    }

    const netScore = buyScore - sellScore;
    let side = PRESSURE_SIDES.BALANCED;
    let intensity = Math.abs(netScore);

    if (netScore >= 35) {
      side = PRESSURE_SIDES.BUY;
    } else if (netScore <= -35) {
      side = PRESSURE_SIDES.SELL;
    }

    return {
      side,
      intensity, // 0 - 100
      buyScore,
      sellScore,
      reasons,
    };
  }
}

module.exports = {
  PressureEngine,
  PRESSURE_SIDES,
};
