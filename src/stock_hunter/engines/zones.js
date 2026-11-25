/**
 * AI STOCK HUNTER - Price Zones & Swing Structure Engine
 * Tuân thủ Section 10.3:
 * - Swing Pivot chỉ có hiệu lực sau khi đủ bar xác nhận bên phải (Test F06: zero look-ahead)
 * - Gộp các vùng giá gần nhau theo cluster tolerance = max(2*tick, 0.3*ATR_D)
 * - Đếm số lần test ĐỘC LẬP (không đếm 10 nến chạm liên tiếp thành 10 lần test - Test F08)
 * - Phân loại cấu trúc: HH_HL | LH_LL | RANGE | TRANSITION | UNKNOWN
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { getTickSize } = require('../core/tickRules');

/**
 * Tìm các Swing High / Swing Low đã xác nhận
 * @param {Array} bars - Chuỗi nến đã đóng theo thứ tự thời gian
 * @param {number} leftBars
 * @param {number} rightBars
 */
function findConfirmedPivots(bars, leftBars = 2, rightBars = 2) {
  const highs = [];
  const lows = [];
  if (!Array.isArray(bars) || bars.length < leftBars + rightBars + 1) {
    return { highs, lows };
  }

  for (let i = leftBars; i < bars.length - rightBars; i++) {
    const center = bars[i];
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (bars[j].high >= center.high) isPivotHigh = false;
      if (bars[j].low <= center.low) isPivotLow = false;
    }

    const confirmedBar = bars[i + rightBars];
    if (isPivotHigh) {
      highs.push({
        type: 'HIGH',
        price: center.high,
        pivotIndex: i,
        pivotAt: center.dateStr || center.timestamp,
        confirmedAtIndex: i + rightBars,
        confirmedAt: confirmedBar.dateStr || confirmedBar.timestamp,
      });
    }
    if (isPivotLow) {
      lows.push({
        type: 'LOW',
        price: center.low,
        pivotIndex: i,
        pivotAt: center.dateStr || center.timestamp,
        confirmedAtIndex: i + rightBars,
        confirmedAt: confirmedBar.dateStr || confirmedBar.timestamp,
      });
    }
  }

  return { highs, lows };
}

/**
 * Gom nhóm các mức giá thành Zone và đếm số phản ứng độc lập (cách nhau >= minGapBars)
 */
function clusterPriceZones(levels, bars, tolerance, minGapBars = 3) {
  if (!Array.isArray(levels) || levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const clusters = [];

  for (const lvl of sorted) {
    let targetCluster = null;
    for (const c of clusters) {
      if (Math.abs(lvl.price - c.center) <= tolerance) {
        targetCluster = c;
        break;
      }
    }
    if (!targetCluster) {
      clusters.push({
        prices: [lvl.price],
        sources: [lvl],
        center: lvl.price,
        low: lvl.price - tolerance * 0.5,
        high: lvl.price + tolerance * 0.5,
      });
    } else {
      targetCluster.prices.push(lvl.price);
      targetCluster.sources.push(lvl);
      const avg = targetCluster.prices.reduce((s, p) => s + p, 0) / targetCluster.prices.length;
      targetCluster.center = Math.round(avg);
      targetCluster.low = Math.round(Math.min(...targetCluster.prices) - tolerance * 0.4);
      targetCluster.high = Math.round(Math.max(...targetCluster.prices) + tolerance * 0.4);
    }
  }

  // Đếm số lần test độc lập trên chuỗi nến (Test F08)
  return clusters.map((c) => {
    let independentTests = 0;
    let lastTouchIdx = -999;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const touches = b.low <= c.high && b.high >= c.low;
      if (touches && (i - lastTouchIdx) >= minGapBars) {
        independentTests += 1;
        lastTouchIdx = i;
      }
    }

    return {
      center: c.center,
      low: c.low,
      high: c.high,
      pivotCount: c.sources.length,
      independentTests,
      lastTestIndex: lastTouchIdx,
      freshnessBarsAgo: lastTouchIdx >= 0 ? (bars.length - 1 - lastTouchIdx) : 999,
    };
  });
}

/**
 * Phân tích cấu trúc xu hướng (HH_HL / LH_LL / RANGE / TRANSITION / UNKNOWN)
 * Cần ít nhất 2 cặp swing high & 2 cặp swing low đã xác nhận.
 */
function classifyStructure(pivotHighs, pivotLows, currentPrice, atrD) {
  if (pivotHighs.length < 2 || pivotLows.length < 2) {
    return {
      structure: 'UNKNOWN',
      latestHigh: pivotHighs[pivotHighs.length - 1] || null,
      latestLow: pivotLows[pivotLows.length - 1] || null,
    };
  }

  const h2 = pivotHighs[pivotHighs.length - 1];
  const h1 = pivotHighs[pivotHighs.length - 2];
  const l2 = pivotLows[pivotLows.length - 1];
  const l1 = pivotLows[pivotLows.length - 2];

  const tol = atrD ? atrD * 0.25 : h2.price * 0.008;
  const hh = h2.price > h1.price + tol;
  const lh = h2.price < h1.price - tol;
  const hl = l2.price > l1.price + tol;
  const ll = l2.price < l1.price - tol;

  let structure = 'TRANSITION';
  if (hh && hl) {
    structure = currentPrice && currentPrice < l2.price ? 'TRANSITION' : 'HH_HL';
  } else if (lh && ll) {
    structure = currentPrice && currentPrice > h2.price ? 'TRANSITION' : 'LH_LL';
  } else if (!hh && !lh && !hl && !ll) {
    structure = 'RANGE';
  } else if ((hh && !ll) || (hl && !lh)) {
    // Một chân tăng + chân kia đi ngang -> nghiêng về tích lũy nâng đáy hoặc mở rộng
    structure = currentPrice && currentPrice > l2.price ? 'TRANSITION' : 'RANGE';
  }

  return {
    structure,
    latestHigh: h2,
    prevHigh: h1,
    latestLow: l2,
    prevLow: l1,
  };
}

/**
 * Xây dựng bản đồ vùng Hỗ trợ & Kháng cự đầy đủ cho mã cổ phiếu
 */
function buildPriceZones(featureSnapshot, exchange = 'HOSE') {
  const closedDaily = featureSnapshot?.daily?.closedBars || [];
  const currentPrice = featureSnapshot?.currentPrice || 0;
  const atrD = featureSnapshot?.daily?.atr14 || (currentPrice * 0.025);
  const cfg = STOCK_HUNTER_CONFIG.features;

  const { highs, lows } = findConfirmedPivots(closedDaily, cfg.pivotLeftBars, cfg.pivotRightBars);
  const tick = getTickSize(currentPrice || 20000, exchange);
  const tolerance = Math.max(2 * tick, cfg.zoneClusterAtrFactor * atrD);

  const supportLevels = [...lows];
  const resistanceLevels = [...highs];

  // Bổ sung MA20/MA50 và đỉnh/đáy tuần đã đóng vào tập ứng viên mức giá
  const ma20 = featureSnapshot?.daily?.ma20;
  const ma50 = featureSnapshot?.daily?.ma50;
  if (ma20 && currentPrice) {
    if (currentPrice >= ma20) supportLevels.push({ price: ma20, type: 'MA20' });
    else resistanceLevels.push({ price: ma20, type: 'MA20' });
  }
  if (ma50 && currentPrice) {
    if (currentPrice >= ma50) supportLevels.push({ price: ma50, type: 'MA50' });
    else resistanceLevels.push({ price: ma50, type: 'MA50' });
  }
  if (featureSnapshot?.weekly?.high20W) {
    resistanceLevels.push({ price: featureSnapshot.weekly.high20W, type: 'WEEKLY_HIGH' });
  }
  if (featureSnapshot?.weekly?.low20W) {
    supportLevels.push({ price: featureSnapshot.weekly.low20W, type: 'WEEKLY_LOW' });
  }

  const supportZones = clusterPriceZones(supportLevels, closedDaily, tolerance, 3)
    .filter(z => !currentPrice || z.low <= currentPrice * 1.01)
    .sort((a, b) => b.center - a.center); // Gần giá hiện tại nhất lên trước

  const resistanceZones = clusterPriceZones(resistanceLevels, closedDaily, tolerance, 3)
    .filter(z => !currentPrice || z.high >= currentPrice * 0.99)
    .sort((a, b) => a.center - b.center); // Gần giá hiện tại nhất lên trước

  const structureInfo = classifyStructure(highs, lows, currentPrice, atrD);

  const nearestSupport = supportZones.find(z => z.center <= currentPrice * 1.005) || supportZones[0] || null;
  const nearestResistance = resistanceZones.find(z => z.center > currentPrice * 1.008) || resistanceZones[0] || null;

  return {
    structure: structureInfo.structure,
    pivotHighs: highs,
    pivotLows: lows,
    latestSwingHigh: structureInfo.latestHigh,
    latestSwingLow: structureInfo.latestLow,
    supportZones,
    resistanceZones,
    nearestSupport,
    nearestResistance,
    tolerance: Math.round(tolerance),
  };
}

module.exports = {
  findConfirmedPivots,
  clusterPriceZones,
  classifyStructure,
  buildPriceZones,
};
