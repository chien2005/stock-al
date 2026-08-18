/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📍 VN30F v4.0 — LỚP 1: Market Structure Engine            ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Xây dựng Price Map — trả lời "giá đang ở đâu?"             ║
 * ║  Key Levels, VWAP, Volume Profile (POC/VAH/VAL),             ║
 * ║  Swing H/L, Gap, Support/Resistance                          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');

/**
 * Tính VWAP từ dữ liệu intraday
 * VWAP = Σ(TP × Volume) / Σ(Volume) với TP = (High + Low + Close) / 3
 */
function calculateVWAP(intradayData) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 2) return null;

  const { h, l, c, v, t } = intradayData;
  const todayStart = _getTodayStartTs(t);

  let cumTPV = 0;
  let cumVol = 0;

  for (let i = 0; i < c.length; i++) {
    if (t && t[i] < todayStart) continue;
    const tp = ((h ? h[i] : c[i]) + (l ? l[i] : c[i]) + c[i]) / 3;
    const vol = v ? v[i] : 1;
    cumTPV += tp * vol;
    cumVol += vol;
  }

  return cumVol > 0 ? parseFloat((cumTPV / cumVol).toFixed(2)) : null;
}

/**
 * Tính Volume Profile → POC, VAH, VAL
 * Phân bổ volume theo mức giá (bins 1 điểm)
 */
function calculateVolumeProfile(intradayData) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 10) {
    return { poc: null, vah: null, val: null, nodes: [] };
  }

  const { h, l, c, v, t } = intradayData;
  const todayStart = _getTodayStartTs(t);
  const BIN_SIZE = 1; // 1 điểm mỗi bin

  // Tạo histogram giá → volume
  const volumeMap = {};

  for (let i = 0; i < c.length; i++) {
    if (t && t[i] < todayStart) continue;
    const vol = v ? v[i] : 1;
    const high = h ? h[i] : c[i];
    const low = l ? l[i] : c[i];

    // Phân bổ volume đều cho range [low, high]
    const lowBin = Math.floor(low / BIN_SIZE) * BIN_SIZE;
    const highBin = Math.floor(high / BIN_SIZE) * BIN_SIZE;
    const numBins = Math.max(1, (highBin - lowBin) / BIN_SIZE + 1);
    const volPerBin = vol / numBins;

    for (let price = lowBin; price <= highBin; price += BIN_SIZE) {
      volumeMap[price] = (volumeMap[price] || 0) + volPerBin;
    }
  }

  // Tìm POC (mức giá volume cao nhất)
  const entries = Object.entries(volumeMap).map(([p, v]) => ({ price: parseFloat(p), volume: v }));
  if (entries.length === 0) return { poc: null, vah: null, val: null, nodes: [] };

  entries.sort((a, b) => b.volume - a.volume);
  const poc = entries[0].price;

  // Tính Value Area (70% tổng volume)
  const totalVol = entries.reduce((s, e) => s + e.volume, 0);
  const targetVol = totalVol * 0.70;

  // Mở rộng từ POC ra 2 bên cho đến khi đạt 70%
  entries.sort((a, b) => a.price - b.price);
  const pocIdx = entries.findIndex(e => e.price === poc);

  let vaVol = entries[pocIdx].volume;
  let lowIdx = pocIdx;
  let highIdx = pocIdx;

  while (vaVol < targetVol && (lowIdx > 0 || highIdx < entries.length - 1)) {
    const addLow = lowIdx > 0 ? entries[lowIdx - 1].volume : 0;
    const addHigh = highIdx < entries.length - 1 ? entries[highIdx + 1].volume : 0;

    if (addLow >= addHigh && lowIdx > 0) {
      lowIdx--;
      vaVol += entries[lowIdx].volume;
    } else if (highIdx < entries.length - 1) {
      highIdx++;
      vaVol += entries[highIdx].volume;
    } else {
      break;
    }
  }

  const val = entries[lowIdx].price;
  const vah = entries[highIdx].price;

  // Volume nodes (top 5 mức giá volume cao nhất, ngoài POC)
  const nodes = entries
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5)
    .map(e => ({ price: e.price, volume: Math.round(e.volume) }));

  return {
    poc: parseFloat(poc.toFixed(1)),
    vah: parseFloat(vah.toFixed(1)),
    val: parseFloat(val.toFixed(1)),
    nodes,
  };
}

/**
 * Phát hiện Swing High/Low trên data (tìm local peaks/troughs)
 */
function findSwingPoints(intradayData, lookback = 5) {
  if (!intradayData || !intradayData.c || intradayData.c.length < lookback * 2 + 1) {
    return { swingHighs: [], swingLows: [] };
  }

  const { h, l, c, t } = intradayData;
  const highs = h || c;
  const lows = l || c;
  const todayStart = _getTodayStartTs(t);

  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < c.length - lookback; i++) {
    if (t && t[i] < todayStart) continue;

    // Swing High: cao nhất trong window
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isSwingHigh = false;
      if (lows[j] <= lows[i]) isSwingLow = false;
    }

    if (isSwingHigh) {
      swingHighs.push({ price: parseFloat(highs[i].toFixed(1)), index: i, time: t ? t[i] : null });
    }
    if (isSwingLow) {
      swingLows.push({ price: parseFloat(lows[i].toFixed(1)), index: i, time: t ? t[i] : null });
    }
  }

  return { swingHighs, swingLows };
}

/**
 * Build complete Price Map
 * @param {Object} params - { intradayF1M, dailyF1M, dailyVN30 }
 */
function buildPriceMap({ intradayF1M, dailyF1M, dailyVN30 }) {
  const levels = [];

  // ─── Previous Day Levels ──────────────────────────
  let previousDay = { high: null, low: null, close: null };
  if (dailyF1M && dailyF1M.c && dailyF1M.c.length >= 2) {
    const len = dailyF1M.c.length;
    previousDay = {
      high: dailyF1M.h ? dailyF1M.h[len - 2] : null,
      low: dailyF1M.l ? dailyF1M.l[len - 2] : null,
      close: dailyF1M.c[len - 2],
    };

    if (previousDay.high) levels.push({ price: previousDay.high, type: 'RESISTANCE', label: 'Đỉnh ngày trước', strength: 'STRONG' });
    if (previousDay.low) levels.push({ price: previousDay.low, type: 'SUPPORT', label: 'Đáy ngày trước', strength: 'STRONG' });
    if (previousDay.close) levels.push({ price: previousDay.close, type: 'REFERENCE', label: 'Đóng cửa hôm trước', strength: 'MEDIUM' });
  }

  // ─── Today Range ──────────────────────────────────
  let todayRange = { high: null, low: null, open: null };
  if (intradayF1M && intradayF1M.c && intradayF1M.c.length > 0) {
    const todayStart = _getTodayStartTs(intradayF1M.t);
    const todayBars = [];

    for (let i = 0; i < intradayF1M.c.length; i++) {
      if (intradayF1M.t && intradayF1M.t[i] >= todayStart) {
        todayBars.push(i);
      }
    }

    if (todayBars.length > 0) {
      const first = todayBars[0];
      const highs = todayBars.map(i => intradayF1M.h ? intradayF1M.h[i] : intradayF1M.c[i]);
      const lows = todayBars.map(i => intradayF1M.l ? intradayF1M.l[i] : intradayF1M.c[i]);

      todayRange = {
        high: Math.max(...highs),
        low: Math.min(...lows),
        open: intradayF1M.o ? intradayF1M.o[first] : intradayF1M.c[first],
      };

      levels.push({ price: todayRange.high, type: 'RESISTANCE', label: 'Đỉnh hôm nay', strength: 'MEDIUM' });
      levels.push({ price: todayRange.low, type: 'SUPPORT', label: 'Đáy hôm nay', strength: 'MEDIUM' });
    }
  }

  // ─── Gap ──────────────────────────────────────────
  let gap = { points: 0, type: 'NO_GAP' };
  if (todayRange.open && previousDay.close) {
    gap.points = parseFloat((todayRange.open - previousDay.close).toFixed(1));
    if (gap.points > 1) gap.type = 'GAP_UP';
    else if (gap.points < -1) gap.type = 'GAP_DOWN';
  }

  // ─── VWAP ─────────────────────────────────────────
  const vwap = calculateVWAP(intradayF1M);
  if (vwap) {
    levels.push({ price: vwap, type: 'VWAP', label: 'Giá trung bình phiên (VWAP)', strength: 'MEDIUM' });
  }

  // ─── Volume Profile ───────────────────────────────
  const volumeProfile = calculateVolumeProfile(intradayF1M);
  if (volumeProfile.poc) {
    levels.push({ price: volumeProfile.poc, type: 'POC', label: 'Vùng khớp nhiều nhất (POC)', strength: 'STRONG' });
  }
  if (volumeProfile.vah) {
    levels.push({ price: volumeProfile.vah, type: 'VAH', label: 'Cản trên vùng giá trị (VAH)', strength: 'MEDIUM' });
  }
  if (volumeProfile.val) {
    levels.push({ price: volumeProfile.val, type: 'VAL', label: 'Hỗ trợ dưới vùng giá trị (VAL)', strength: 'MEDIUM' });
  }

  // ─── Swing Points ─────────────────────────────────
  const swings = findSwingPoints(intradayF1M, 5);
  for (const sh of swings.swingHighs.slice(-3)) {
    // Tránh trùng với levels đã có
    if (!levels.find(l => Math.abs(l.price - sh.price) < 1.5)) {
      levels.push({ price: sh.price, type: 'RESISTANCE', label: 'Đỉnh ngắn hạn', strength: 'WEAK' });
    }
  }
  for (const sl of swings.swingLows.slice(-3)) {
    if (!levels.find(l => Math.abs(l.price - sl.price) < 1.5)) {
      levels.push({ price: sl.price, type: 'SUPPORT', label: 'Đáy ngắn hạn', strength: 'WEAK' });
    }
  }

  // ─── Sort levels và xác định current zone ─────────
  levels.sort((a, b) => b.price - a.price);

  // Deduplicate: merge levels gần nhau (< 1.5 điểm)
  const deduped = [];
  for (const level of levels) {
    const existing = deduped.find(l => Math.abs(l.price - level.price) < 1.5);
    if (existing) {
      // Giữ level mạnh hơn
      if (_strengthRank(level.strength) > _strengthRank(existing.strength)) {
        Object.assign(existing, level);
      }
    } else {
      deduped.push({ ...level, price: parseFloat(level.price.toFixed(1)) });
    }
  }

  // Current price position
  const currentPrice = intradayF1M && intradayF1M.c ? intradayF1M.c[intradayF1M.c.length - 1] : null;
  let currentZone = 'UNKNOWN';
  if (currentPrice) {
    const supports = deduped.filter(l => l.type === 'SUPPORT' && l.price <= currentPrice);
    const resistances = deduped.filter(l => l.type === 'RESISTANCE' && l.price >= currentPrice);
    const nearestSupport = supports.length > 0 ? supports[0] : null;
    const nearestResistance = resistances.length > 0 ? resistances[resistances.length - 1] : null;

    if (nearestSupport && Math.abs(currentPrice - nearestSupport.price) <= 2) {
      currentZone = 'AT_SUPPORT';
    } else if (nearestResistance && Math.abs(currentPrice - nearestResistance.price) <= 2) {
      currentZone = 'AT_RESISTANCE';
    } else {
      currentZone = 'BETWEEN';
    }
  }

  return {
    levels: deduped,
    currentZone,
    currentPrice: currentPrice ? parseFloat(currentPrice.toFixed(1)) : null,
    vwap,
    poc: volumeProfile.poc,
    vah: volumeProfile.vah,
    val: volumeProfile.val,
    todayRange,
    previousDay,
    gap,
    swingHighs: swings.swingHighs.map(s => s.price),
    swingLows: swings.swingLows.map(s => s.price),
  };
}

/**
 * Tìm nearest support/resistance từ một mức giá
 */
function findNearestLevels(priceMap, fromPrice) {
  if (!priceMap || !priceMap.levels || !fromPrice) return { support: null, resistance: null };

  const supports = priceMap.levels
    .filter(l => (l.type === 'SUPPORT' || l.type === 'POC' || l.type === 'VAL') && l.price < fromPrice)
    .sort((a, b) => b.price - a.price);

  const resistances = priceMap.levels
    .filter(l => (l.type === 'RESISTANCE' || l.type === 'VAH') && l.price > fromPrice)
    .sort((a, b) => a.price - b.price);

  return {
    support: supports[0] || null,
    resistance: resistances[0] || null,
  };
}

// ─── INTERNAL HELPERS ────────────────────────────────────────
function _getTodayStartTs(timestamps) {
  if (!timestamps || timestamps.length === 0) return 0;
  // Tìm timestamp bắt đầu ngày hôm nay (0h00 VN)
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  vnTime.setHours(0, 0, 0, 0);
  return Math.floor(vnTime.getTime() / 1000);
}

function _strengthRank(strength) {
  return { 'STRONG': 3, 'MEDIUM': 2, 'WEAK': 1 }[strength] || 0;
}

module.exports = {
  buildPriceMap,
  calculateVWAP,
  calculateVolumeProfile,
  findSwingPoints,
  findNearestLevels,
};
