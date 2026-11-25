/**
 * AI STOCK HUNTER - Exit & Position Guardian Engine
 * Tuân thủ Master Plan V2.0 Section 19:
 * - Chạy độc lập với Universe/Entry (kể cả mã bị loại khỏi Universe vẫn giám sát, Test P10, E10)
 * - Priority P0 -> P6:
 *   P0: Data stale / halted -> DATA_RISK_ALERT
 *   P1: Hard Stop Hit (intrabar hoặc close) -> EXIT / EXIT_PENDING_LOCKED / EXIT_UNFILLED_LIMIT_DOWN
 *   P2: Thesis Invalidation (Failed breakout / Gãy cấu trúc ngay cả khi mới lãi +1%, Test E05)
 *   P3: Time-stop (19 phiên / <1 tháng hoặc hết hạn setup) -> EXIT / TIME_STOP_BLOCKED
 *   P4: Supply warning (Buying climax / Upper wick tại cản nhưng giữ HL -> PROTECT, Test E07)
 *   P5/P6: Trailing Stop tăng đơn điệu (chỉ tăng hoặc giữ) & HOLD gồng lãi (+5..15%+) (Test E06, E08)
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { countTradingSessionsBetween, isLotSettledAt, toVnComponents } = require('../core/calendar');
const { roundToTick, getTickSize } = require('../core/tickRules');

function evaluateExitForSymbol({
  symbol,
  lots = [],
  quote = null,
  feature = null,
  zones = null,
  supplyDemand = null,
  marketRegime = null,
  dataStatus = 'VALID',
  asOf = new Date(),
}) {
  if (!Array.isArray(lots) || lots.length === 0) return null;

  const activeLots = lots.filter(l => l.qty > 0);
  if (activeLots.length === 0) return null;

  const totalQty = activeLots.reduce((s, l) => s + l.qty, 0);
  const availableQty = activeLots.reduce((s, l) => (
    isLotSettledAt(l, asOf) ? s + Math.max(0, l.qty - (l.reservedSellQty || 0)) : s
  ), 0);
  const lockedQty = totalQty - availableQty;

  // P0: Mất dữ liệu vị thế hoặc dữ liệu cũ -> Không được phát HOLD giả! (Case H, Test P11)
  if (dataStatus !== 'VALID' || !quote || !Number.isFinite(quote.priceVnd) || quote.priceVnd <= 0) {
    return {
      symbol,
      priority: 'P0',
      action: 'DATA_RISK_ALERT',
      totalQty,
      availableQty,
      lockedQty,
      reasonCodes: ['POSITION_DATA_UNAVAILABLE'],
      note: 'Thiếu dữ liệu giá realtime hợp lệ cho vị thế đang giữ — kiểm tra trực tiếp trên bảng điện/broker.',
    };
  }

  const price = quote.priceVnd;
  const lowIntrabar = quote.lowVnd > 0 ? Math.min(quote.lowVnd, price) : price;
  const avgEntry = activeLots.reduce((s, l) => s + l.entryPriceVnd * l.qty, 0) / totalQty;
  const grossPnlPct = parseFloat((((price - avgEntry) / avgEntry) * 100).toFixed(2));
  const highestStop = Math.max(...activeLots.map(l => l.stopVnd || 0));

  // Kiểm tra P1: Hard Stop Hit (Intrabar low chạm/thủng stop cũng ghi nhận event SL! Test E01)
  const isHardStopHit = price <= highestStop || lowIntrabar <= highestStop;
  if (isHardStopHit) {
    if (quote.isLimitDownLocked) {
      return {
        symbol,
        priority: 'P1',
        action: 'EXIT_UNFILLED_LIMIT_DOWN',
        totalQty,
        availableQty,
        lockedQty,
        avgEntryVnd: Math.round(avgEntry),
        observedPriceVnd: price,
        plannedStopVnd: highestStop,
        grossPnlPct,
        reasonCodes: ['HARD_STOP_HIT', 'LIMIT_DOWN_NO_BID'],
        note: `Chạm SL ${highestStop.toLocaleString('vi-VN')}đ nhưng đang giảm sàn mất thanh khoản bên mua.`,
      };
    }

    if (availableQty <= 0) {
      return {
        symbol,
        priority: 'P1',
        action: 'EXIT_PENDING_LOCKED',
        totalQty,
        availableQty,
        lockedQty,
        avgEntryVnd: Math.round(avgEntry),
        observedPriceVnd: price,
        plannedStopVnd: highestStop,
        grossPnlPct,
        reasonCodes: ['HARD_STOP_HIT', 'TPLUS2_LOCKED'],
        note: `Giá ${price.toLocaleString('vi-VN')}đ chạm/thủng SL ${highestStop.toLocaleString('vi-VN')}đ (${grossPnlPct}%), hàng T+2 chưa về (${lockedQty} cp). Chờ phiên chiều hàng về xử lý ngay!`,
      };
    }

    return {
      symbol,
      priority: 'P1',
      action: 'EXIT',
      totalQty,
      availableQty,
      lockedQty,
      avgEntryVnd: Math.round(avgEntry),
      observedPriceVnd: price,
      plannedStopVnd: highestStop,
      grossPnlPct,
      reasonCodes: ['HARD_STOP_HIT'],
      note: `CẮT LỖ KỶ LUẬT: Giá chạm/thủng SL ${highestStop.toLocaleString('vi-VN')}đ (${grossPnlPct}%). Thoát ${availableQty} cp khả dụng.`,
    };
  }

  // P2: Thesis Invalidation (Failed breakout xác nhận / Gãy cấu trúc / Áp lực bán mạnh ngay vùng vô hiệu)
  // Test E05 / Case F: dù đang lời 1% nhưng luận điểm mua gãy -> EXIT!
  const cues = supplyDemand?.cues || [];
  const thesisBroken =
    cues.includes('FAILED_BREAKOUT') ||
    (supplyDemand?.state === 'SUPPLY_PRESSURE' && cues.includes('SUPPLY_PRESSURE_15M')) ||
    (feature?.daily?.ma20 && price < feature.daily.ma20 * 0.985 && supplyDemand?.state === 'SUPPLY_PRESSURE') ||
    (marketRegime?.regime === 'PANIC' && supplyDemand?.state === 'SUPPLY_PRESSURE');

  if (thesisBroken) {
    return {
      symbol,
      priority: 'P2',
      action: availableQty > 0 ? 'EXIT' : 'EXIT_PENDING_LOCKED',
      totalQty,
      availableQty,
      lockedQty,
      avgEntryVnd: Math.round(avgEntry),
      observedPriceVnd: price,
      plannedStopVnd: highestStop,
      grossPnlPct,
      reasonCodes: ['THESIS_INVALIDATION', ...(cues.length ? cues : ['SUPPLY_PRESSURE'])],
      note: `Luận điểm mua bị phá vỡ (${cues.join(', ') || 'Áp lực bán lớn'}). ${availableQty > 0 ? `Thoát ${availableQty} cp` : 'Chờ hàng T+2 về để thoát'}.`,
    };
  }

  // P3: Time-Stop (19 phiên / < 1 tháng, Test E09)
  const oldestBuyDate = activeLots.map(l => l.buyDate).sort()[0];
  const currentVnDate = toVnComponents(asOf).dateStr;
  const sessionsHeld = oldestBuyDate ? countTradingSessionsBetween(oldestBuyDate, currentVnDate) : 0;
  const maxSessions = STOCK_HUNTER_CONFIG.risk.maxHoldSessions;
  const isReversalTimeout = activeLots.some(l => l.strategyId === 'S05' || l.strategyId === 'S06') && sessionsHeld >= 5 && grossPnlPct < 1.5;

  if (sessionsHeld >= maxSessions || isReversalTimeout) {
    if (quote.isLimitDownLocked) {
      return {
        symbol,
        priority: 'P3',
        action: 'TIME_STOP_BLOCKED',
        totalQty,
        availableQty,
        lockedQty,
        avgEntryVnd: Math.round(avgEntry),
        observedPriceVnd: price,
        plannedStopVnd: highestStop,
        grossPnlPct,
        sessionsHeld,
        reasonCodes: ['TIME_STOP_REACHED', 'LIMIT_DOWN_BLOCKED'],
        note: `Đã giữ ${sessionsHeld} phiên (chạm giới hạn T+), đang kẹt sàn chưa thoát được.`,
      };
    }
    return {
      symbol,
      priority: 'P3',
      action: availableQty > 0 ? 'EXIT' : 'EXIT_PENDING_LOCKED',
      totalQty,
      availableQty,
      lockedQty,
      avgEntryVnd: Math.round(avgEntry),
      observedPriceVnd: price,
      plannedStopVnd: highestStop,
      grossPnlPct,
      sessionsHeld,
      reasonCodes: [sessionsHeld >= maxSessions ? 'MAX_HOLD_19_SESSIONS' : 'REVERSAL_STAGNATION_TIMEOUT'],
      note: `Chạm Time-Stop (${sessionsHeld} phiên, lãi/lỗ ${grossPnlPct}%). Đóng vị thế, không biến T+ thành kẹp dài hạn.`,
    };
  }

  // Tính Trailing Stop đề xuất (CHỈ TĂNG HOẶC GIỮ, KHÔNG BAO GIỜ GIẢM - Test E08)
  const atrD = feature?.daily?.atr14 || (price * 0.025);
  const exchange = activeLots[0].exchange || 'HOSE';
  const tick = getTickSize(price, exchange);
  let proposedTrailStop = highestStop;

  // 1) Theo confirmed higher low gần nhất
  if (zones?.latestSwingLow?.price && zones.latestSwingLow.price > avgEntry) {
    const hlTrail = roundToTick(zones.latestSwingLow.price - 2 * tick, exchange, 'floor');
    if (hlTrail < price && hlTrail > proposedTrailStop) {
      proposedTrailStop = hlTrail;
    }
  }
  // 2) Khi lãi >= +4.5%: khóa tối thiểu hòa vốn + 0.5% chi phí
  if (grossPnlPct >= 4.5) {
    const beLock = roundToTick(avgEntry * 1.005, exchange, 'ceil');
    if (beLock < price && beLock > proposedTrailStop) {
      proposedTrailStop = beLock;
    }
  }
  // 3) Khi lãi >= +8%: ATR trail từ high watermark
  const highestHigh = Math.max(price, ...activeLots.map(l => l.highWatermarkVnd || price));
  if (grossPnlPct >= 8.0) {
    const atrTrail = roundToTick(highestHigh - 2.2 * atrD, exchange, 'floor');
    if (atrTrail < price && atrTrail > proposedTrailStop) {
      proposedTrailStop = atrTrail;
    }
  }

  // P4: Supply Warning tại vùng cản / Buying Climax nhưng cấu trúc chính chưa gãy -> PROTECT (Test E07)
  if (
    supplyDemand?.state === 'SUPPLY_WARNING' ||
    cues.includes('SUPPLY_AT_RESISTANCE') ||
    cues.includes('EFFORT_NO_RESULT_STALL') ||
    cues.includes('SUPPLY_PRESSURE_15M')
  ) {
    return {
      symbol,
      priority: 'P4',
      action: 'PROTECT',
      totalQty,
      availableQty,
      lockedQty,
      avgEntryVnd: Math.round(avgEntry),
      observedPriceVnd: price,
      plannedStopVnd: highestStop,
      proposedTrailStopVnd: proposedTrailStop > highestStop ? proposedTrailStop : null,
      grossPnlPct,
      sessionsHeld,
      reasonCodes: ['SUPPLY_WARNING_PROTECT', ...cues.filter(c => c.includes('SUPPLY') || c.includes('STALL'))],
      note: `Xuất hiện áp lực cung (${cues.join(', ')}) khi đang ${grossPnlPct >= 0 ? '+' : ''}${grossPnlPct}%. Siết chặn lãi tại ${proposedTrailStop.toLocaleString('vi-VN')}đ, không mua thêm.`,
    };
  }

  // P5 / P6: Cầu còn khỏe, giữ gồng lãi không giới hạn % cứng (Test E06)
  return {
    symbol,
    priority: 'P6',
    action: 'HOLD',
    totalQty,
    availableQty,
    lockedQty,
    avgEntryVnd: Math.round(avgEntry),
    observedPriceVnd: price,
    plannedStopVnd: highestStop,
    proposedTrailStopVnd: proposedTrailStop > highestStop ? proposedTrailStop : null,
    grossPnlPct,
    sessionsHeld,
    reasonCodes: ['STRUCTURE_INTACT_HOLD'],
    note: `Giữ vị thế (${grossPnlPct >= 0 ? '+' : ''}${grossPnlPct}%, ${sessionsHeld} phiên). SL/Trail hiện tại: ${proposedTrailStop.toLocaleString('vi-VN')}đ.`,
  };
}

module.exports = { evaluateExitForSymbol };
