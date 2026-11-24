/**
 * Profit Lock Guard Engine
 * Quản trị vị thế phái sinh theo nguyên tắc thép:
 * - Thuế phí: ~0.6đ
 * - Khi lãi đạt +1.0đ: NGAY LẬP TỨC dời SL lên chặn lãi tối thiểu +0.6đ
 *   -> Đảm bảo lệnh đóng lại LUÔN DƯƠNG TIỀN sau thuế phí, tuyệt đối không bị lỗ phí!
 */

const config = require('./entradeConfig');

class ProfitLockGuard {
  constructor(position) {
    /**
     * position: {
     *   id: string,
     *   side: 'LONG' | 'SHORT',
     *   entryPrice: number,
     *   quantity: number,
     *   initialSL: number,
     *   currentSL: number,
     *   maxProfitReached: number,
     *   isLocked: boolean
     * }
     */
    this.pos = position;
    this.rules = config.riskRules;
    this.history = [];
  }

  /**
   * Cập nhật theo từng tick giá thời gian thực
   * @param {number} currentPrice - Giá thị trường VN30F hiện tại
   * @returns {object} { action: 'HOLD' | 'UPDATE_SL' | 'STOP_OUT', newSL: number, reason: string }
   */
  evaluatePriceTick(currentPrice) {
    const isLong = this.pos.side === 'LONG';
    const rawPoints = isLong 
      ? (currentPrice - this.pos.entryPrice)
      : (this.pos.entryPrice - currentPrice);

    // Cập nhật đỉnh lãi cao nhất từng đạt được
    if (rawPoints > this.pos.maxProfitReached) {
      this.pos.maxProfitReached = rawPoints;
    }

    // 1. Kiểm tra vi phạm Stoploss hiện tại
    const isStopHit = isLong 
      ? (currentPrice <= this.pos.currentSL)
      : (currentPrice >= this.pos.currentSL);

    if (isStopHit) {
      const netPoints = isLong ? (this.pos.currentSL - this.pos.entryPrice) : (this.pos.entryPrice - this.pos.currentSL);
      const netAfterFee = netPoints - this.rules.taxFeePerContract;
      return {
        action: 'STOP_OUT',
        exitPrice: currentPrice,
        netPoints,
        netAfterFee,
        reason: `Chạm SL tại ${this.pos.currentSL.toFixed(1)} (Lãi/lỗ ròng sau phí: ${netAfterFee > 0 ? '+' : ''}${netAfterFee.toFixed(1)}đ)`
      };
    }

    // 2. Thuật toán dời SL khóa lợi nhuận (Profit Lock Guard)
    let candidateSL = this.pos.currentSL;
    let lockReason = '';

    // Nấc 1: Khi lãi chạm +1.0đ -> Khóa tối thiểu +0.6đ (Bảo vệ phí)
    if (this.pos.maxProfitReached >= this.rules.lockTriggerPoint && this.pos.maxProfitReached < this.rules.step1_profit) {
      const lockPrice = isLong 
        ? (this.pos.entryPrice + this.rules.lockGuaranteedProfit)
        : (this.pos.entryPrice - this.rules.lockGuaranteedProfit);

      if (isLong ? (lockPrice > candidateSL) : (lockPrice < candidateSL)) {
        candidateSL = lockPrice;
        lockReason = `Lãi chạm +${this.pos.maxProfitReached.toFixed(1)}đ -> Dời SL khóa chắc +${this.rules.lockGuaranteedProfit}đ (Bảo vệ thuế phí)`;
      }
    }

    // Nấc 2: Khi lãi chạm +1.5đ -> Khóa +1.0đ
    else if (this.pos.maxProfitReached >= this.rules.step1_profit && this.pos.maxProfitReached < this.rules.step2_profit) {
      const lockPrice = isLong 
        ? (this.pos.entryPrice + this.rules.step1_lock)
        : (this.pos.entryPrice - this.rules.step1_lock);

      if (isLong ? (lockPrice > candidateSL) : (lockPrice < candidateSL)) {
        candidateSL = lockPrice;
        lockReason = `Lãi chạm +${this.pos.maxProfitReached.toFixed(1)}đ -> Nâng SL khóa +${this.rules.step1_lock}đ`;
      }
    }

    // Nấc 3: Khi lãi chạm +2.0đ -> Khóa +1.4đ
    else if (this.pos.maxProfitReached >= this.rules.step2_profit && this.pos.maxProfitReached < this.rules.step3_profit) {
      const lockPrice = isLong 
        ? (this.pos.entryPrice + this.rules.step2_lock)
        : (this.pos.entryPrice - this.rules.step2_lock);

      if (isLong ? (lockPrice > candidateSL) : (lockPrice < candidateSL)) {
        candidateSL = lockPrice;
        lockReason = `Lãi chạm +${this.pos.maxProfitReached.toFixed(1)}đ -> Nâng SL khóa +${this.rules.step2_lock}đ`;
      }
    }

    // Nấc 4: Khi lãi chạm +3.0đ -> Khóa +2.2đ
    else if (this.pos.maxProfitReached >= this.rules.step3_profit && this.pos.maxProfitReached < 4.0) {
      const lockPrice = isLong 
        ? (this.pos.entryPrice + this.rules.step3_lock)
        : (this.pos.entryPrice - this.rules.step3_lock);

      if (isLong ? (lockPrice > candidateSL) : (lockPrice < candidateSL)) {
        candidateSL = lockPrice;
        lockReason = `Lãi chạm +${this.pos.maxProfitReached.toFixed(1)}đ -> Nâng SL khóa +${this.rules.step3_lock}đ`;
      }
    }

    // Nấc 5: Lãi > 4.0đ -> Trailing Stop linh hoạt cách đỉnh lãi 1.2đ
    else if (this.pos.maxProfitReached >= 4.0) {
      const trailingSL = isLong 
        ? (currentPrice - this.rules.trailingDistance)
        : (currentPrice + this.rules.trailingDistance);

      if (isLong ? (trailingSL > candidateSL) : (trailingSL < candidateSL)) {
        candidateSL = trailingSL;
        lockReason = `Sóng lớn +${this.pos.maxProfitReached.toFixed(1)}đ -> Trailing SL theo giá ${candidateSL.toFixed(1)}`;
      }
    }

    // Nếu có dời SL mới
    if (candidateSL !== this.pos.currentSL) {
      const oldSL = this.pos.currentSL;
      this.pos.currentSL = candidateSL;
      this.pos.isLocked = true;
      this.history.push({ time: new Date(), oldSL, newSL: candidateSL, reason: lockReason });

      return {
        action: 'UPDATE_SL',
        newSL: candidateSL,
        reason: lockReason
      };
    }

    return { action: 'HOLD', currentProfit: rawPoints };
  }
}

module.exports = ProfitLockGuard;
