/**
 * AI STOCK HUNTER - Trade Plan Builder
 * Tuân thủ Master Plan V2.0 Section 16:
 * - Entry zone & planned_entry_worst = entryMax (không lạc quan hóa R/R)
 * - Stop tính theo vùng vô hiệu cấu trúc + ATR buffer TRƯỚC khi phát hành tín hiệu
 * - Làm tròn đúng bước giá sàn HOSE/HNX, tính stopDistance thực tế sau làm tròn (Test R01)
 * - Tính Net Reward/Risk sau phí mua + phí bán + thuế bán + slippage thoát (Test R04, R12)
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { roundToTick, getTickSize } = require('../core/tickRules');

function buildTradePlan({
  symbol,
  exchange = 'HOSE',
  setup,
  feature,
  zones,
  asOf = new Date(),
}) {
  const cfgR = STOCK_HUNTER_CONFIG.risk;
  const cfgS = STOCK_HUNTER_CONFIG.strategies;
  const price = feature?.currentPrice;

  if (!price || price <= 0 || !setup) {
    return { valid: false, rejectReason: 'INVALID_INPUT' };
  }

  const tick = getTickSize(price, exchange);
  const atrD = feature?.daily?.atr14Prior || feature?.daily?.atr14 || (price * 0.025);

  // 1. Entry Zone: [price - 0.8%, price + 0.4%] làm tròn tick
  const entryMin = roundToTick(price * 0.992, exchange, 'floor');
  const entryMax = roundToTick(Math.max(price, price * 1.004), exchange, 'ceil');
  const entryWorst = entryMax;

  // Chặn mua đuổi nếu cây hiện tại đã tăng > +5.5% hoặc chạy quá xa trigger > 0.5 ATR (Test S03, S18)
  if ((feature.changePct || 0) > cfgS.maxSingleDayGainChase) {
    return { valid: false, rejectReason: 'PRICE_CHASE_SINGLE_DAY_GAIN' };
  }
  if (setup.triggerLevel && (price - setup.triggerLevel) > atrD * cfgS.maxEntryChaseAtr && setup.strategyId === 'S02') {
    return { valid: false, rejectReason: 'PRICE_TOO_FAR_FROM_TRIGGER' };
  }

  // 2. Structural Stop với buffer đặt TRƯỚC entry (Test R01, R03)
  const buffer = Math.max(2 * tick, 0.15 * atrD);
  const rawStructuralStop = (setup.invalidationLevel || price * 0.965) - buffer;
  const stopVnd = roundToTick(rawStructuralStop, exchange, 'floor');

  if (stopVnd <= 0 || stopVnd >= entryMin) {
    return { valid: false, rejectReason: 'INVALID_STOP_ABOVE_ENTRY' }; // Test R03
  }

  // Tính % stopDistance thực tế sau khi đã làm tròn tick (không che giấu số thập phân, Test R01)
  const stopDistancePct = parseFloat(((entryWorst - stopVnd) / entryWorst).toFixed(4));
  const maxStopAllowed = setup.isReversal ? 0.045 : cfgR.maxInitialStopPct;

  if (stopDistancePct > maxStopAllowed) {
    return {
      valid: false,
      rejectReason: `STOP_TOO_WIDE_${(stopDistancePct * 100).toFixed(2)}%`,
      stopVnd,
      stopDistancePct,
    };
  }
  if (stopDistancePct < cfgR.minInitialStopPct) {
    return {
      valid: false,
      rejectReason: `STOP_TOO_TIGHT_${(stopDistancePct * 100).toFixed(2)}%`,
      stopVnd,
      stopDistancePct,
    };
  }

  // 3. Xác định vùng Cung / TP tham khảo (TP_ref1, TP_ref2)
  const resZones = (zones?.resistanceZones || []).filter(z => z.center > entryWorst * 1.015);
  let tpRef1 = resZones[0] ? roundToTick(resZones[0].low, exchange, 'floor') : null;
  let tpRef2 = resZones[1] ? roundToTick(resZones[1].low, exchange, 'floor') : null;
  let isDynamicDiscovery = false;

  // Nếu đang vượt đỉnh lịch sử (không có cản trên rõ) -> dùng measured move 2.2 ATR làm TP tham khảo (dynamic)
  if (!tpRef1) {
    tpRef1 = roundToTick(entryWorst + atrD * 2.2, exchange, 'floor');
    tpRef2 = roundToTick(entryWorst + atrD * 3.5, exchange, 'floor');
    isDynamicDiscovery = true;
  }

  const roomPct = (tpRef1 - entryWorst) / entryWorst;
  if (roomPct < cfgS.minRoomPct) {
    return {
      valid: false,
      rejectReason: `NO_ROOM_TO_RESISTANCE_${(roomPct * 100).toFixed(2)}%`, // Test A09 / S08
      tpRef1,
      roomPct,
    };
  }

  // 4. Tính Net Reward & Net Risk sau toàn bộ phí + thuế + exit slippage (Test R04, R12)
  const buyCostRate = cfgR.buyFeeRate;
  const sellCostRate = cfgR.sellFeeRate + cfgR.sellTaxRate;
  const slippagePerShare = Math.round(stopVnd * cfgR.exitSlippageBuffer);

  const netEntryCost = entryWorst * (1 + buyCostRate);
  const netTpProceeds = tpRef1 * (1 - sellCostRate);
  const netStopProceeds = (stopVnd - slippagePerShare) * (1 - sellCostRate);

  const netRewardPerShare = Math.max(0, netTpProceeds - netEntryCost);
  const netRiskPerShare = Math.max(1, netEntryCost - netStopProceeds);
  const rrNet = parseFloat((netRewardPerShare / netRiskPerShare).toFixed(2));

  const minRrRequired = setup.isReversal ? cfgS.reversalMinRrNet : cfgS.minRrNet;
  if (rrNet < minRrRequired) {
    return {
      valid: false,
      rejectReason: `LOW_NET_RR_${rrNet}_REQ_${minRrRequired}`,
      rrNet,
      tpRef1,
      stopVnd,
    };
  }

  // 5. Tính T+2 Stress Loss per share (kịch bản xấu nhất trong 2 phiên khóa hàng)
  const stressPct = Math.max(stopDistancePct * 2, cfgR.tPlus2StressShockPct);
  const stressedLossPerShare = Math.round(entryWorst * stressPct + entryWorst * (buyCostRate + sellCostRate));

  const validUntil = new Date(asOf.getTime() + cfgS.signalTtlMinutes * 60 * 1000).toISOString();

  return {
    valid: true,
    symbol,
    exchange,
    strategyId: setup.strategyId,
    isReversal: !!setup.isReversal,
    entryZone: { min: entryMin, max: entryMax },
    entryWorst,
    stopVnd,
    stopDistancePct: parseFloat((stopDistancePct * 100).toFixed(2)),
    tpRef1,
    tpRef2,
    isDynamicDiscovery,
    roomPct: parseFloat((roomPct * 100).toFixed(2)),
    netRewardPerShare: Math.round(netRewardPerShare),
    netRiskPerShare: Math.round(netRiskPerShare),
    stressedLossPerShare,
    rrNet,
    validUntil,
  };
}

module.exports = { buildTradePlan };
