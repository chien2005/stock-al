/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🌊 VN30F V10.0 — Supply Demand Lifecycle Engine (Sec 5.4)   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  FORMING -> EXPANDING -> DOMINANT -> DECELERATING ->          ║
 * ║  EXHAUSTION_CANDIDATE -> TRANSITION -> REVERSING / RESUMING    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const SD_LIFECYCLE_STATES = {
  FORMING: 'FORMING',
  EXPANDING: 'EXPANDING',
  DOMINANT: 'DOMINANT',
  DECELERATING: 'DECELERATING',
  EXHAUSTION_CANDIDATE: 'EXHAUSTION_CANDIDATE',
  TRANSITION: 'TRANSITION',
  REVERSING: 'REVERSING',
  RESUMING: 'RESUMING',
  EXPIRED: 'EXPIRED',
};

class SupplyDemandLifecycleEngine {
  constructor() {
    this.currentState = SD_LIFECYCLE_STATES.FORMING;
    this.dominantSide = 'BALANCED'; // 'BUYERS' | 'SELLERS' | 'BALANCED'
    this.stateHistory = [];
    this.consecutiveObservations = 0;
  }

  /**
   * Update lifecycle state based on pressure and deceleration evidence.
   */
  update({
    pressureSide,
    pressureIntensity,
    isDecelerating,
    effortResultState,
  }) {
    const prevState = this.currentState;

    if (pressureIntensity >= 60) {
      if (pressureSide === 'BUY' || pressureSide === 'SELL') {
        this.dominantSide = pressureSide === 'BUY' ? 'BUYERS' : 'SELLERS';
        this.currentState = SD_LIFECYCLE_STATES.DOMINANT;
      }
    } else if (this.currentState === SD_LIFECYCLE_STATES.DOMINANT) {
      if (isDecelerating) {
        // SD-02: Emit warning when DOMINANT -> DECELERATING before opposing party confirms
        this.currentState = SD_LIFECYCLE_STATES.DECELERATING;
      }
    } else if (this.currentState === SD_LIFECYCLE_STATES.DECELERATING) {
      if (effortResultState?.includes('EXHAUSTION') || effortResultState?.includes('ABSORPTION')) {
        this.currentState = SD_LIFECYCLE_STATES.EXHAUSTION_CANDIDATE;
      } else if (pressureIntensity < 20) {
        this.currentState = SD_LIFECYCLE_STATES.TRANSITION;
      }
    } else if (this.currentState === SD_LIFECYCLE_STATES.EXHAUSTION_CANDIDATE || this.currentState === SD_LIFECYCLE_STATES.TRANSITION) {
      // Reversal or Resumption check
      if ((this.dominantSide === 'BUYERS' && pressureSide === 'SELL' && pressureIntensity >= 40) ||
          (this.dominantSide === 'SELLERS' && pressureSide === 'BUY' && pressureIntensity >= 40)) {
        this.currentState = SD_LIFECYCLE_STATES.REVERSING;
      } else if (pressureSide === (this.dominantSide === 'BUYERS' ? 'BUY' : 'SELL') && pressureIntensity >= 40) {
        this.currentState = SD_LIFECYCLE_STATES.RESUMING;
      }
    }

    if (this.currentState !== prevState) {
      this.stateHistory.push({
        from: prevState,
        to: this.currentState,
        ts: Date.now(),
        side: this.dominantSide,
      });
      if (this.stateHistory.length > 50) this.stateHistory.shift();
    }

    return {
      currentState: this.currentState,
      dominantSide: this.dominantSide,
      hasStateChanged: this.currentState !== prevState,
      isWeakening: this.currentState === SD_LIFECYCLE_STATES.DECELERATING || this.currentState === SD_LIFECYCLE_STATES.EXHAUSTION_CANDIDATE,
    };
  }

  reset() {
    this.currentState = SD_LIFECYCLE_STATES.FORMING;
    this.dominantSide = 'BALANCED';
    this.stateHistory = [];
  }
}

module.exports = {
  SupplyDemandLifecycleEngine,
  SD_LIFECYCLE_STATES,
};
