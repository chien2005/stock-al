/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📍 VN30F v4.0 — LỚP 1: Market Structure Engine            ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Xây dựng Price Map — trả lời "giá đang ở đâu?"             ║
 * ║  Key Levels, VWAP, Volume Profile (POC/VAH/VAL),             ║
 * ║  EMA9/20/50, Cấu trúc Sóng LH/LL - HH/HL, Breakdown/Breakout║
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
 * Tính EMA
 */
function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(2));
}

/**
 * Tính Volume Profile → POC, VAH, VAL
 */
function calculateVolumeProfile(intradayData) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 10) {
    return { poc: null, vah: null, val: null, nodes: [] };
  }

  const { h, l, c, v, t } = intradayData;
  const todayStart = _getTodayStartTs(t);
  const BIN_SIZE = 1;

  const volumeMap = {};

  for (let i = 0; i < c.length; i++) {
    if (t && t[i] < todayStart) continue;
    const vol = v ? v[i] : 1;
    const high = h ? h[i] : c[i];
    const low = l ? l[i] : c[i];

    const lowBin = Math.floor(low / BIN_SIZE) * BIN_SIZE;
    const highBin = Math.floor(high / BIN_SIZE) * BIN_SIZE;
    const numBins = Math.max(1, (highBin - lowBin) / BIN_SIZE + 1);
    const volPerBin = vol / numBins;

    for (let price = lowBin; price <= highBin; price += BIN_SIZE) {
      volumeMap[price] = (volumeMap[price] || 0) + volPerBin;
    }
  }

  const entries = Object.entries(volumeMap).map(([p, v]) => ({ price: parseFloat(p), volume: v }));
  if (entries.length === 0) return { poc: null, vah: null, val: null, nodes: [] };

  entries.sort((a, b) => b.volume - a.volume);
  const poc = entries[0].price;

  const totalVol = entries.reduce((s, e) => s + e.volume, 0);
  const targetVol = totalVol * 0.70;

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
 * Phát hiện Swing High/Low
 */
function findSwingPoints(intradayData, lookback = 4) {
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

  // ─── VWAP & EMAs ──────────────────────────────────
  const vwap = calculateVWAP(intradayF1M);
  if (vwap) {
    levels.push({ price: vwap, type: 'VWAP', label: 'Giá trung bình phiên (VWAP)', strength: 'MEDIUM' });
  }

  const ema9 = intradayF1M && intradayF1M.c ? calculateEMA(intradayF1M.c, 9) : null;
  const ema20 = intradayF1M && intradayF1M.c ? calculateEMA(intradayF1M.c, 20) : null;

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
  const swings = findSwingPoints(intradayF1M, 4);
  for (const sh of swings.swingHighs.slice(-3)) {
    if (!levels.find(l => Math.abs(l.price - sh.price) < 1.5)) {
      levels.push({ price: sh.price, type: 'RESISTANCE', label: 'Đỉnh ngắn hạn', strength: 'WEAK' });
    }
  }
  for (const sl of swings.swingLows.slice(-3)) {
    if (!levels.find(l => Math.abs(l.price - sl.price) < 1.5)) {
      levels.push({ price: sl.price, type: 'SUPPORT', label: 'Đáy ngắn hạn', strength: 'WEAK' });
    }
  }

  levels.sort((a, b) => b.price - a.price);

  const deduped = [];
  for (const level of levels) {
    const existing = deduped.find(l => Math.abs(l.price - level.price) < 1.5);
    if (existing) {
      if (_strengthRank(level.strength) > _strengthRank(existing.strength)) {
        Object.assign(existing, level);
      }
    } else {
      deduped.push({ ...level, price: parseFloat(level.price.toFixed(1)) });
    }
  }

  const currentPrice = intradayF1M && intradayF1M.c ? intradayF1M.c[intradayF1M.c.length - 1] : null;

  // ─── CẤU TRÚC SÓNG & ĐỘ DỐC (LH/LL vs HH/HL) ─────
  let waveStructure = 'NEUTRAL';
  if (swings.swingHighs.length >= 2 && swings.swingLows.length >= 2) {
    const last2Highs = swings.swingHighs.slice(-2);
    const last2Lows = swings.swingLows.slice(-2);

    const isLowerHighs = last2Highs[1].price < last2Highs[0].price;
    const isLowerLows = last2Lows[1].price < last2Lows[0].price;

    const isHigherHighs = last2Highs[1].price > last2Highs[0].price;
    const isHigherLows = last2Lows[1].price > last2Lows[0].price;

    if (isLowerHighs && isLowerLows) waveStructure = 'LOWER_HIGHS_LOWER_LOWS'; // Downtrend
    else if (isHigherHighs && isHigherLows) waveStructure = 'HIGHER_HIGHS_HIGHER_LOWS'; // Uptrend
  }

  // ─── XÁC ĐỊNH TREND RÕ RÀNG ──────────────────────
  let trendBias = 'NEUTRAL';
  let trendStrength = 0;

  if (currentPrice && vwap) {
    const diffVWAP = currentPrice - vwap;

    if (diffVWAP <= -2.0) {
      trendBias = 'BEARISH';
      trendStrength = Math.min(90, Math.round(50 + Math.abs(diffVWAP) * 6));
    } else if (diffVWAP >= 2.0) {
      trendBias = 'BULLISH';
      trendStrength = Math.min(90, Math.round(50 + diffVWAP * 6));
    } else if (diffVWAP < 0) {
      trendBias = 'MILD_BEARISH';
      trendStrength = 40;
    } else {
      trendBias = 'MILD_BULLISH';
      trendStrength = 40;
    }

    // Kết hợp EMA20
    if (ema20 && currentPrice < ema20 && trendBias.includes('BEARISH')) {
      trendStrength += 15;
    } else if (ema20 && currentPrice > ema20 && trendBias.includes('BULLISH')) {
      trendStrength += 15;
    }
  }

  // Breakdown detection (thủng VAH sau khi vượt đỉnh)
  let structuralBreak = null;
  if (todayRange.high && volumeProfile.vah && currentPrice) {
    if (todayRange.high >= volumeProfile.vah + 3 && currentPrice <= volumeProfile.vah - 1) {
      structuralBreak = 'FAILED_BREAKOUT_BEARISH';
    }
  }

  let currentZone = 'UNKNOWN';
  if (currentPrice) {
    const supports = deduped.filter(l => (l.type === 'SUPPORT' || l.type === 'VAL') && l.price <= currentPrice);
    const resistances = deduped.filter(l => (l.type === 'RESISTANCE' || l.type === 'VAH') && l.price >= currentPrice);
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
    ema9,
    ema20,
    poc: volumeProfile.poc,
    vah: volumeProfile.vah,
    val: volumeProfile.val,
    todayRange,
    previousDay,
    gap,
    swingHighs: swings.swingHighs.map(s => s.price),
    swingLows: swings.swingLows.map(s => s.price),
    waveStructure,
    trendBias,
    trendStrength,
    structuralBreak,
  };
}

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

function _getTodayStartTs(timestamps) {
  if (!timestamps || timestamps.length === 0) return 0;
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
  calculateEMA,
  calculateVolumeProfile,
  findSwingPoints,
  findNearestLevels,
};
