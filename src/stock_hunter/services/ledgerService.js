/**
 * AI STOCK HUNTER - Portfolio Ledger & T+2 Settlement Service
 * Tuân thủ Master Plan V2.0 Section 18:
 * - Tách bạch recommendation / fill / position_lot / cash_event
 * - Signal chưa fill KHÔNG tạo position hay thay đổi NAV (Test P09)
 * - Chống duplicate fill ID (Test P06)
 * - FIFO available quantity theo lot + ngày T+2 từ Calendar (Tests P01-P05)
 * - Cấm hạ stop thấp hơn mức cũ (Test R02)
 */

const fs = require('fs');
const path = require('path');
const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { getInstrumentMeta } = require('../config/universeSeed');
const { calculateSettlementDate, isLotSettledAt, toVnComponents } = require('../core/calendar');
const { calculateNetPnL } = require('../engines/riskEngine');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'sh_ledger.json');

function createInitialLedger(initialNavVnd = STOCK_HUNTER_CONFIG.risk.initialNavVnd) {
  const todayStr = toVnComponents(new Date()).dateStr;
  return {
    schemaVersion: '2.0',
    updatedAt: new Date().toISOString(),
    ledgerStale: false,
    availableCashVnd: initialNavVnd,
    pendingReceivableVnd: 0,
    payableVnd: 0,
    navPeakVnd: initialNavVnd,
    dailyStartNavVnd: initialNavVnd,
    dailyStartDate: todayStr,
    weeklyStartNavVnd: initialNavVnd,
    killSwitchActive: false,
    fills: [],         // Lịch sử khớp lệnh bất biến (dedup theo fillId)
    positionLots: [],  // Các lô đang mở (qty > 0)
    closedTrades: [],  // Lịch sử các lệnh đã đóng (PnL ròng thực tế)
    pendingSettlementCash: [], // Tiền bán chờ về T+2
  };
}

class LedgerService {
  constructor(filePath = LEDGER_FILE, initialNavVnd = STOCK_HUNTER_CONFIG.risk.initialNavVnd) {
    this.filePath = filePath;
    this.initialNavVnd = initialNavVnd;
    this.state = this.load();
  }

  load() {
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) { /* fallback */ }
    return createInitialLedger(this.initialNavVnd);
  }

  save() {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.state.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.error('⚠️ LedgerService.save error:', e.message);
    }
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Đồng bộ trạng thái T+2 hàng về & tiền bán về tại thời điểm asOf
   */
  reconcileAt(asOf = new Date()) {
    const vn = toVnComponents(asOf);
    let changed = false;

    for (const lot of this.state.positionLots) {
      if (lot.qty <= 0) continue;
      const settled = isLotSettledAt(lot, asOf);
      const nextAvail = settled ? Math.max(0, lot.qty - (lot.reservedSellQty || 0)) : 0;
      if (lot.availableQty !== nextAvail) {
        lot.availableQty = nextAvail;
        changed = true;
      }
    }

    // Tiền bán T+2 về tài khoản
    const remainingPending = [];
    for (const item of this.state.pendingSettlementCash || []) {
      if (vn.dateStr > item.settleDate || (vn.dateStr === item.settleDate && vn.hhmm >= 1300)) {
        this.state.availableCashVnd += item.amountVnd;
        this.state.pendingReceivableVnd = Math.max(0, (this.state.pendingReceivableVnd || 0) - item.amountVnd);
        changed = true;
      } else {
        remainingPending.push(item);
      }
    }
    this.state.pendingSettlementCash = remainingPending;

    if (changed) this.save();
    return this.getSnapshot();
  }

  /**
   * Ghi nhận khớp lệnh MUA (chống trùng fillId, tạo lot T+2 mới, trừ tiền mặt)
   */
  recordBuyFill({
    fillId,
    symbol,
    qty,
    priceVnd,
    stopVnd,
    tpRef1 = null,
    strategyId = 'MANUAL',
    invalidationLevel = null,
    buyTimestamp = new Date(),
    feeRate = STOCK_HUNTER_CONFIG.risk.buyFeeRate,
    requireBrokerConfirm = false,
  }) {
    const sym = String(symbol).toUpperCase().trim();
    const id = fillId || `BUY_${sym}_${Date.now()}`;
    if (this.state.fills.some(f => f.fillId === id)) {
      return { ok: false, reason: 'DUPLICATE_FILL_ID', fillId: id }; // Test P06
    }
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(priceVnd) || priceVnd <= 0) {
      return { ok: false, reason: 'INVALID_QTY_OR_PRICE' };
    }

    const gross = qty * priceVnd;
    const fee = Math.round(gross * feeRate);
    const totalCash = gross + fee;
    if (totalCash > this.state.availableCashVnd) {
      return { ok: false, reason: 'INSUFFICIENT_AVAILABLE_CASH', required: totalCash, available: this.state.availableCashVnd };
    }

    const buyDate = toVnComponents(buyTimestamp).dateStr;
    const settleDate = calculateSettlementDate(buyDate);
    const initialStop = stopVnd && stopVnd < priceVnd
      ? stopVnd
      : Math.round(priceVnd * (1 - STOCK_HUNTER_CONFIG.risk.maxInitialStopPct));

    this.state.availableCashVnd -= totalCash;
    const meta = getInstrumentMeta(sym);
    const lot = {
      lotId: `LOT_${id}`,
      fillId: id,
      symbol: sym,
      exchange: meta.exchange,
      riskCluster: meta.riskCluster,
      strategyId,
      qty,
      originalQty: qty,
      availableQty: 0, // T+0 luôn bị khóa (locked) cho tới chiều T+2 (Test P01)
      reservedSellQty: 0,
      entryPriceVnd: priceVnd,
      lastPriceVnd: priceVnd,
      highWatermarkVnd: priceVnd,
      buyFeeVnd: fee,
      initialStopVnd: initialStop,
      stopVnd: initialStop,
      invalidationLevel: invalidationLevel || initialStop,
      tpRef1,
      buyDate,
      settleDate,
      requireBrokerConfirm,
      brokerConfirmedAvailable: null,
      status: 'FILLED_LOCKED',
    };

    this.state.fills.push({
      fillId: id,
      side: 'BUY',
      symbol: sym,
      qty,
      priceVnd,
      feeVnd: fee,
      date: buyDate,
      timestamp: new Date(buyTimestamp).toISOString(),
    });
    this.state.positionLots.push(lot);
    this.reconcileAt(buyTimestamp);
    this.save();
    return { ok: true, lot };
  }

  /**
   * Ghi nhận khớp lệnh BÁN theo FIFO trên các lô đã available (Test P04, P05, P07, P08)
   */
  recordSellFill({
    fillId,
    symbol,
    qty,
    priceVnd,
    sellTimestamp = new Date(),
    reason = 'MANUAL_SELL',
    buyFeeRate = STOCK_HUNTER_CONFIG.risk.buyFeeRate,
    sellFeeRate = STOCK_HUNTER_CONFIG.risk.sellFeeRate,
    sellTaxRate = STOCK_HUNTER_CONFIG.risk.sellTaxRate,
  }) {
    const sym = String(symbol).toUpperCase().trim();
    const id = fillId || `SELL_${sym}_${Date.now()}`;
    if (this.state.fills.some(f => f.fillId === id)) {
      return { ok: false, reason: 'DUPLICATE_FILL_ID', fillId: id };
    }

    this.reconcileAt(sellTimestamp);
    const eligibleLots = this.state.positionLots.filter(l => l.symbol === sym && l.qty > 0 && l.availableQty > 0);
    const totalAvailable = eligibleLots.reduce((s, l) => s + l.availableQty, 0);

    if (qty > totalAvailable) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_AVAILABLE_TPLUS2_QTY',
        requested: qty,
        available: totalAvailable,
      };
    }

    let remaining = qty;
    const sellDate = toVnComponents(sellTimestamp).dateStr;
    const settleDate = calculateSettlementDate(sellDate);
    let totalProceedsNet = 0;
    let totalNetPnl = 0;

    for (const lot of eligibleLots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.availableQty);
      const pnl = calculateNetPnL({
        buyPriceVnd: lot.entryPriceVnd,
        sellPriceVnd: priceVnd,
        qty: take,
        buyFeeRate,
        sellFeeRate,
        sellTaxRate,
      });

      lot.qty -= take;
      lot.availableQty -= take;
      if (lot.qty === 0) lot.status = 'CLOSED';
      remaining -= take;

      totalProceedsNet += pnl.sellNetCash;
      totalNetPnl += pnl.netPnlVnd;

      this.state.closedTrades.push({
        lotId: lot.lotId,
        symbol: sym,
        strategyId: lot.strategyId,
        qty: take,
        buyDate: lot.buyDate,
        sellDate,
        entryPriceVnd: lot.entryPriceVnd,
        exitPriceVnd: priceVnd,
        netPnlVnd: pnl.netPnlVnd,
        netPnlPct: pnl.netPnlPct,
        reason,
      });
    }

    // Dọn lot đã bán hết
    this.state.positionLots = this.state.positionLots.filter(l => l.qty > 0);

    // Tiền bán T+2 chưa về ngay vào availableCashVnd (Test P08: tách pendingReceivableVnd!)
    this.state.pendingReceivableVnd = (this.state.pendingReceivableVnd || 0) + totalProceedsNet;
    this.state.pendingSettlementCash.push({
      fillId: id,
      symbol: sym,
      amountVnd: totalProceedsNet,
      sellDate,
      settleDate,
    });

    this.state.fills.push({
      fillId: id,
      side: 'SELL',
      symbol: sym,
      qty,
      priceVnd,
      netProceedsVnd: totalProceedsNet,
      netPnlVnd: totalNetPnl,
      date: sellDate,
      timestamp: new Date(sellTimestamp).toISOString(),
    });

    this.save();
    return { ok: true, qtySold: qty, totalProceedsNet, totalNetPnl, settleDate };
  }

  /**
   * Cập nhật Stop Loss — KỶ LUẬT THÉP: KHÔNG BAO GIỜ HẠ STOP THẤP HƠN MỨC CŨ (Test R02, E08)
   */
  updateLotStop(lotId, proposedStopVnd) {
    const lot = this.state.positionLots.find(l => l.lotId === lotId);
    if (!lot) return { ok: false, reason: 'LOT_NOT_FOUND' };
    if (!Number.isFinite(proposedStopVnd) || proposedStopVnd <= lot.stopVnd) {
      return { ok: false, reason: 'NEVER_LOWER_STOP_POLICY', currentStop: lot.stopVnd, proposed: proposedStopVnd };
    }
    if (proposedStopVnd >= (lot.lastPriceVnd || lot.entryPriceVnd)) {
      return { ok: false, reason: 'PROPOSED_STOP_ABOVE_CURRENT_PRICE' };
    }
    lot.stopVnd = proposedStopVnd;
    this.save();
    return { ok: true, newStopVnd: proposedStopVnd };
  }

  confirmBrokerAvailable(symbol, availableFlag = true) {
    const sym = String(symbol).toUpperCase().trim();
    for (const lot of this.state.positionLots) {
      if (lot.symbol === sym) {
        lot.brokerConfirmedAvailable = availableFlag;
      }
    }
    this.reconcileAt(new Date());
    this.save();
  }
}

module.exports = { LedgerService, createInitialLedger };
