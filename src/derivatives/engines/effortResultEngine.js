/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚖️ VN30F V10.0 — Effort vs Result Engine (Section 5.3)       ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Measures volume effort vs net price displacement result       ║
 * ║  8 Observation States:                                        ║
 * ║  SELL_ABSORPTION_CANDIDATE, BUY_ABSORPTION_CANDIDATE,         ║
 * ║  SUPPLY_EXHAUSTION_CANDIDATE, DEMAND_EXHAUSTION_CANDIDATE,    ║
 * ║  LOW_VOLUME_RALLY, LOW_VOLUME_DECLINE,                        ║
 * ║  UP_EXPANSION, DOWN_EXPANSION                                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const EFFORT_STATES = {
  SELL_ABSORPTION_CANDIDATE: 'SELL_ABSORPTION_CANDIDATE',
  BUY_ABSORPTION_CANDIDATE: 'BUY_ABSORPTION_CANDIDATE',
  SUPPLY_EXHAUSTION_CANDIDATE: 'SUPPLY_EXHAUSTION_CANDIDATE',
  DEMAND_EXHAUSTION_CANDIDATE: 'DEMAND_EXHAUSTION_CANDIDATE',
  LOW_VOLUME_RALLY: 'LOW_VOLUME_RALLY',
  LOW_VOLUME_DECLINE: 'LOW_VOLUME_DECLINE',
  UP_EXPANSION: 'UP_EXPANSION',
  DOWN_EXPANSION: 'DOWN_EXPANSION',
  BALANCED: 'BALANCED',
};

class EffortResultEngine {
  /**
   * Evaluate effort vs result across rolling window or candle sequence.
   * @param {object} params
   * @returns {{ state: string, effort: number, result: number, score: number, description: string }}
   */
  evaluate({
    priceDelta,          // Net points moved
    volumeDelta,         // Contracts traded
    baselineVolume,      // Expected volume for timeframe
    priceEfficiency,     // abs(net) / total path
    isNearSupport = false,
    isNearResistance = false,
  }) {
    const volRatio = baselineVolume > 0 ? volumeDelta / baselineVolume : 1.0;
    const absMove = Math.abs(priceDelta);

    // 1. High effort (Vol >= 1.5x) + Low result (price moved < 1.0pt)
    if (volRatio >= 1.5 && absMove < 1.0) {
      if (priceDelta <= 0 || isNearSupport) {
        return {
          state: EFFORT_STATES.SELL_ABSORPTION_CANDIDATE,
          effort: volRatio,
          result: absMove,
          score: Math.min(85, Math.round(50 + volRatio * 15)),
          description: `Nỗ lực bán cao (x${volRatio.toFixed(1)}) nhưng giá không giảm sâu (${absMove.toFixed(1)}đ) → Hấp thụ cầu tiềm năng`,
        };
      } else {
        return {
          state: EFFORT_STATES.BUY_ABSORPTION_CANDIDATE,
          effort: volRatio,
          result: absMove,
          score: Math.min(85, Math.round(50 + volRatio * 15)),
          description: `Nỗ lực mua cao (x${volRatio.toFixed(1)}) nhưng giá không tăng được (${absMove.toFixed(1)}đ) → Cung đè chặn tiềm năng`,
        };
      }
    }

    // 2. High effort (Vol >= 1.5x) + High result (price moved >= 2.0pt) -> Expansion
    if (volRatio >= 1.5 && absMove >= 2.0) {
      if (priceDelta > 0) {
        return {
          state: EFFORT_STATES.UP_EXPANSION,
          effort: volRatio,
          result: absMove,
          score: Math.min(90, Math.round(60 + volRatio * 12)),
          description: `Bùng nổ cầu dứt khoát (x${volRatio.toFixed(1)} vol, +${priceDelta.toFixed(1)}đ) → Xung lực tăng mở rộng`,
        };
      } else {
        return {
          state: EFFORT_STATES.DOWN_EXPANSION,
          effort: volRatio,
          result: absMove,
          score: Math.min(90, Math.round(60 + volRatio * 12)),
          description: `Xả bán dứt khoát (x${volRatio.toFixed(1)} vol, ${priceDelta.toFixed(1)}đ) → Xung lực giảm mở rộng`,
        };
      }
    }

    // 3. Low effort (Vol < 0.7x) + Price moving steadily -> Low volume drift
    if (volRatio < 0.7 && absMove >= 1.2) {
      if (priceDelta > 0) {
        return {
          state: EFFORT_STATES.LOW_VOLUME_RALLY,
          effort: volRatio,
          result: absMove,
          score: 60,
          description: `Giá leo dần +${priceDelta.toFixed(1)}đ với volume thấp (x${volRatio.toFixed(1)}) → Tăng do thiếu cung, chưa phải bull trap`,
        };
      } else {
        return {
          state: EFFORT_STATES.LOW_VOLUME_DECLINE,
          effort: volRatio,
          result: absMove,
          score: 60,
          description: `Giá trôi dần ${priceDelta.toFixed(1)}đ với volume thấp (x${volRatio.toFixed(1)}) → Giảm do thiếu cầu, chưa có lực đảo chiều`,
        };
      }
    }

    // 4. Low effort near key boundaries -> Exhaustion candidate
    if (volRatio < 0.65 && absMove < 1.0) {
      if (isNearSupport) {
        return {
          state: EFFORT_STATES.SUPPLY_EXHAUSTION_CANDIDATE,
          effort: volRatio,
          result: absMove,
          score: 65,
          description: `Kiệt lực bán quanh hỗ trợ (Vol x${volRatio.toFixed(1)} cạn kiệt) → Nguy cơ bẫy Short đuổi đáy`,
        };
      } else if (isNearResistance) {
        return {
          state: EFFORT_STATES.DEMAND_EXHAUSTION_CANDIDATE,
          effort: volRatio,
          result: absMove,
          score: 65,
          description: `Kiệt lực mua quanh kháng cự (Vol x${volRatio.toFixed(1)} cạn kiệt) → Nguy cơ bẫy Long đua đỉnh`,
        };
      }
    }

    return {
      state: EFFORT_STATES.BALANCED,
      effort: volRatio,
      result: absMove,
      score: 50,
      description: 'Cung cầu cân bằng tương đối',
    };
  }
}

module.exports = {
  EffortResultEngine,
  EFFORT_STATES,
};
