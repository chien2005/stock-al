/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🎯 VN30F v4.0 — LỚP 8: Target & Risk Engine             ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Target Map dựa trên cấu trúc (không phải khoảng cách)     ║
 * ║  Structural Invalidation thay vì fixed SL                   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

/**
 * Tạo Target Map dựa trên cấu trúc thị trường
 * Entry, TP1-TP4, Invalidation, No-Trade Zone — tất cả từ structure
 */
function buildTargetMap({ direction, priceMap, basisResult, absorptionResult, dailyF1M }) {
  if (!direction || direction === 'NO_TRADE' || direction === 'NEUTRAL' || !priceMap) {
    return _emptyTargetMap(direction);
  }

  const currentPrice = priceMap.currentPrice;
  if (!currentPrice) return _emptyTargetMap(direction);

  const levels = priceMap.levels || [];

  // v4.2: Dynamic hardStop dựa trên ATR20
  const atr20 = _calculateATR(dailyF1M, 20);
  const hardStop = atr20 > 0 ? Math.max(5, Math.min(10, Math.round(atr20 * 0.8))) : 8;

  if (direction === 'SHORT') {
    return _buildShortTargets(currentPrice, levels, priceMap, absorptionResult, hardStop);
  } else {
    return _buildLongTargets(currentPrice, levels, priceMap, absorptionResult, hardStop);
  }
}

function _buildShortTargets(currentPrice, levels, priceMap, absorptionResult, hardStop) {
  // Entry: tại hoặc gần resistance
  const resistances = levels.filter(l =>
    (l.type === 'RESISTANCE' || l.type === 'VAH') && l.price >= currentPrice - 2
  ).sort((a, b) => a.price - b.price);

  let entryZone = [currentPrice - 1, currentPrice + 3];
  let entryReason = 'Vùng giá hiện tại';
  if (resistances.length > 0) {
    const nearestRes = resistances[0];
    entryZone = [nearestRes.price - 2, nearestRes.price + 2];
    entryReason = nearestRes.label || 'Vùng kháng cự';
  }

  // Targets: tìm supports bên dưới currentPrice
  const supports = levels.filter(l =>
    (l.type === 'SUPPORT' || l.type === 'POC' || l.type === 'VWAP' || l.type === 'VAL' || l.type === 'REFERENCE')
    && l.price < currentPrice - 1
  ).sort((a, b) => b.price - a.price); // Gần nhất trước

  const targets = [];
  for (let i = 0; i < Math.min(4, supports.length); i++) {
    targets.push({
      price: supports[i].price,
      reason: supports[i].label || supports[i].type,
      type: `TP${i + 1}`,
    });
  }

  // Nếu không đủ targets từ levels → thêm dựa trên range
  if (targets.length < 2) {
    const range = priceMap.todayRange;
    if (range && range.low && !targets.find(t => Math.abs(t.price - range.low) < 2)) {
      targets.push({ price: range.low, reason: 'Đáy phiên', type: `TP${targets.length + 1}` });
    }
    if (priceMap.previousDay.low && !targets.find(t => Math.abs(t.price - priceMap.previousDay.low) < 2)) {
      targets.push({ price: priceMap.previousDay.low, reason: 'Đáy ngày trước', type: `TP${targets.length + 1}` });
    }
  }

  // Invalidation: acceptance trên resistance gần nhất
  const invalidationLevel = resistances.length > 0 ? resistances[resistances.length - 1].price + 3 : currentPrice + 8;
  const invalidation = {
    price: parseFloat(invalidationLevel.toFixed(1)),
    condition: `Giá chấp nhận trên ${invalidationLevel.toFixed(1)} + test lại giữ được`,
    type: 'STRUCTURAL',
  };

  // No-Trade Zone
  let noTradeZone = null;
  if (priceMap.poc && priceMap.vwap) {
    const mid = (priceMap.poc + priceMap.vwap) / 2;
    const halfRange = Math.abs(priceMap.poc - priceMap.vwap) / 2 + 2;
    if (Math.abs(currentPrice - mid) < halfRange) {
      noTradeZone = {
        from: parseFloat((mid - halfRange).toFixed(1)),
        to: parseFloat((mid + halfRange).toFixed(1)),
        reason: 'Vùng cân bằng (POC/VWAP) — đấu giá 2 chiều',
      };
    }
  }

  // Absorption override: nếu sell absorption tại target → warn
  if (absorptionResult && absorptionResult.detected === 'SELL_ABSORPTION') {
    const absLevel = absorptionResult.level;
    const matchTarget = targets.find(t => Math.abs(t.price - absLevel) < 2);
    if (matchTarget) {
      matchTarget.reason += ' ⚠️ CẦU ĐANG HẤP THỤ';
    }
  }

  return {
    direction: 'SHORT',
    entry: { zone: entryZone.map(p => parseFloat(p.toFixed(1))), reason: entryReason },
    targets: targets.slice(0, 4),
    invalidation,
    hardStop,
    noTradeZone,
  };
}

function _buildLongTargets(currentPrice, levels, priceMap, absorptionResult, hardStop) {
  // Entry: tại hoặc gần support
  const supports = levels.filter(l =>
    (l.type === 'SUPPORT' || l.type === 'VAL') && l.price <= currentPrice + 2
  ).sort((a, b) => b.price - a.price);

  let entryZone = [currentPrice - 3, currentPrice + 1];
  let entryReason = 'Vùng giá hiện tại';
  if (supports.length > 0) {
    const nearestSup = supports[0];
    entryZone = [nearestSup.price - 2, nearestSup.price + 2];
    entryReason = nearestSup.label || 'Vùng hỗ trợ';
  }

  // Targets: tìm resistances bên trên
  const resistances = levels.filter(l =>
    (l.type === 'RESISTANCE' || l.type === 'POC' || l.type === 'VWAP' || l.type === 'VAH' || l.type === 'REFERENCE')
    && l.price > currentPrice + 1
  ).sort((a, b) => a.price - b.price);

  const targets = [];
  for (let i = 0; i < Math.min(4, resistances.length); i++) {
    targets.push({
      price: resistances[i].price,
      reason: resistances[i].label || resistances[i].type,
      type: `TP${i + 1}`,
    });
  }

  if (targets.length < 2) {
    const range = priceMap.todayRange;
    if (range && range.high && !targets.find(t => Math.abs(t.price - range.high) < 2)) {
      targets.push({ price: range.high, reason: 'Đỉnh phiên', type: `TP${targets.length + 1}` });
    }
    if (priceMap.previousDay.high && !targets.find(t => Math.abs(t.price - priceMap.previousDay.high) < 2)) {
      targets.push({ price: priceMap.previousDay.high, reason: 'Đỉnh ngày trước', type: `TP${targets.length + 1}` });
    }
  }

  // Invalidation: giá phá dưới support gần nhất
  const invalidationLevel = supports.length > 0 ? supports[supports.length - 1].price - 3 : currentPrice - 8;
  const invalidation = {
    price: parseFloat(invalidationLevel.toFixed(1)),
    condition: `Giá phá dưới ${invalidationLevel.toFixed(1)} + không hồi lại`,
    type: 'STRUCTURAL',
  };

  // No-Trade Zone
  let noTradeZone = null;
  if (priceMap.poc && priceMap.vwap) {
    const mid = (priceMap.poc + priceMap.vwap) / 2;
    const halfRange = Math.abs(priceMap.poc - priceMap.vwap) / 2 + 2;
    if (Math.abs(currentPrice - mid) < halfRange) {
      noTradeZone = {
        from: parseFloat((mid - halfRange).toFixed(1)),
        to: parseFloat((mid + halfRange).toFixed(1)),
        reason: 'Vùng cân bằng (POC/VWAP) — đấu giá 2 chiều',
      };
    }
  }

  return {
    direction: 'LONG',
    entry: { zone: entryZone.map(p => parseFloat(p.toFixed(1))), reason: entryReason },
    targets: targets.slice(0, 4),
    invalidation,
    hardStop,
    noTradeZone,
  };
}

/**
 * Tính Average True Range (ATR)
 */
function _calculateATR(dailyData, period) {
  if (!dailyData || !dailyData.c || dailyData.c.length < period + 1) return 0;

  const { h, l, c } = dailyData;
  const highs = h || c;
  const lows = l || c;
  const trValues = [];

  for (let i = c.length - period; i < c.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - c[i - 1]),
      Math.abs(lows[i] - c[i - 1])
    );
    trValues.push(tr);
  }

  return trValues.length > 0 ? trValues.reduce((s, v) => s + v, 0) / trValues.length : 0;
}

function _emptyTargetMap(direction) {
  return {
    direction: direction || 'NO_TRADE',
    entry: { zone: [0, 0], reason: 'Không có tín hiệu' },
    targets: [],
    invalidation: { price: 0, condition: 'N/A', type: 'NONE' },
    hardStop: 8,
    noTradeZone: null,
  };
}

module.exports = {
  buildTargetMap,
};
