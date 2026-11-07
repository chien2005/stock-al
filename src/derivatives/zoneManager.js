/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🛡️ VN30F v9.0 — Dynamic Support & Resistance Zone Manager   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Quản lý vòng đời Hỗ Trợ / Kháng Cự Động:                     ║
 * ║  • Zone Lifecycle: ACTIVE -> TESTING -> WEAKENED -> BROKEN   ║
 * ║  • Reclaim Engine: Bắt bẫy Bear Trap (Long) & Bull Trap (Short)║
 * ║  • Touch Counter: Test >= 3 lần -> Báo động vùng bị suy yếu  ║
 * ║  • Vùng Cực Trị: Nhận diện điểm đảo chiều khung lớn D1/H1     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ZONES_FILE = path.join(DATA_DIR, 'dynamic_zones.json');

// Memory store các vùng
let _zonesStore = {
  lastUpdated: 0,
  zones: [],
  activeEvents: [],
};

// ─── TÌM PIVOT SWING HIGHS & LOWS ─────────────────────────────
function findPivots(candles, left = 3, right = 3) {
  const pivots = [];
  if (!candles || candles.length < left + right + 1) return pivots;

  for (let i = left; i < candles.length - right; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= left; j++) {
      if (candles[i - j].high >= currentHigh) isHigh = false;
      if (candles[i - j].low <= currentLow) isLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (candles[i + j].high > currentHigh) isHigh = false;
      if (candles[i + j].low < currentLow) isLow = false;
    }

    if (isHigh) {
      pivots.push({
        type: 'HIGH',
        price: currentHigh,
        time: candles[i].time,
        index: i,
        volume: candles[i].volume,
      });
    }
    if (isLow) {
      pivots.push({
        type: 'LOW',
        price: currentLow,
        time: candles[i].time,
        index: i,
        volume: candles[i].volume,
      });
    }
  }

  return pivots;
}

// ─── CLUSTER CÁC MỐC GIÁ THÀNH VÙNG ĐỆM (ZONE) ────────────────
function clusterToZones(pivots, tolerance = 3.0, tf = 'H1') {
  const zones = [];
  const highPivots = pivots.filter(p => p.type === 'HIGH').sort((a, b) => b.price - a.price);
  const lowPivots = pivots.filter(p => p.type === 'LOW').sort((a, b) => a.price - b.price);

  // 1. Gom các Swing Highs thành Kháng Cự
  for (const p of highPivots) {
    const existing = zones.find(z => z.type === 'RESISTANCE' && Math.abs(z.midPrice - p.price) <= tolerance);
    if (!existing) {
      zones.push({
        id: `RES_${tf}_${Math.round(p.price)}`,
        type: 'RESISTANCE',
        timeframe: tf,
        low: parseFloat((p.price - tolerance / 2).toFixed(1)),
        high: parseFloat((p.price + tolerance / 2).toFixed(1)),
        midPrice: parseFloat(p.price.toFixed(1)),
        touchCount: 1,
        status: 'ACTIVE',
        createdTime: p.time,
        lastTestedTime: p.time,
      });
    } else {
      existing.touchCount += 1;
      existing.low = parseFloat(Math.min(existing.low, p.price - 1.0).toFixed(1));
      existing.high = parseFloat(Math.max(existing.high, p.price + 1.0).toFixed(1));
      existing.midPrice = parseFloat(((existing.low + existing.high) / 2).toFixed(1));
      existing.lastTestedTime = Math.max(existing.lastTestedTime, p.time);
    }
  }

  // 2. Gom các Swing Lows thành Hỗ Trợ
  for (const p of lowPivots) {
    const existing = zones.find(z => z.type === 'SUPPORT' && Math.abs(z.midPrice - p.price) <= tolerance);
    if (!existing) {
      zones.push({
        id: `SUP_${tf}_${Math.round(p.price)}`,
        type: 'SUPPORT',
        timeframe: tf,
        low: parseFloat((p.price - tolerance / 2).toFixed(1)),
        high: parseFloat((p.price + tolerance / 2).toFixed(1)),
        midPrice: parseFloat(p.price.toFixed(1)),
        touchCount: 1,
        status: 'ACTIVE',
        createdTime: p.time,
        lastTestedTime: p.time,
      });
    } else {
      existing.touchCount += 1;
      existing.low = parseFloat(Math.min(existing.low, p.price - 1.0).toFixed(1));
      existing.high = parseFloat(Math.max(existing.high, p.price + 1.0).toFixed(1));
      existing.midPrice = parseFloat(((existing.low + existing.high) / 2).toFixed(1));
      existing.lastTestedTime = Math.max(existing.lastTestedTime, p.time);
    }
  }

  return zones;
}

// ─── KHỞI TẠO & PHÁT HIỆN VÙNG TỪ NẾN ĐA KHUNG ─────────────────
function extractDynamicZones(mtfData) {
  const d1Candles = mtfData.daily || [];
  const h1Candles = mtfData.h1 || [];

  // Tìm pivots trên D1 (vùng trọng yếu)
  const d1Pivots = findPivots(d1Candles, 2, 2);
  const d1Zones = clusterToZones(d1Pivots, 4.0, 'D1');

  // Tìm pivots trên H1 (vùng chiến thuật)
  const h1Pivots = findPivots(h1Candles, 3, 3);
  const h1Zones = clusterToZones(h1Pivots, 2.5, 'H1');

  // Hợp nhất và loại trùng lặp
  const allZones = [];

  for (const z of d1Zones) {
    z.importance = 'MAJOR';
    allZones.push(z);
  }

  for (const z of h1Zones) {
    const overlaps = allZones.find(az => az.type === z.type && Math.abs(az.midPrice - z.midPrice) <= 3.5);
    if (!overlaps) {
      z.importance = 'MINOR';
      allZones.push(z);
    } else {
      overlaps.touchCount += z.touchCount;
    }
  }

  return allZones.sort((a, b) => b.midPrice - a.midPrice);
}

// ─── CẬP NHẬT VÒNG ĐỜI VÙNG (LIFECYCLE & RECLAIM ENGINE) ────────
/**
 * Thẩm định trạng thái các vùng so với hành động giá M15/M5:
 * 1. Testing: Giá chạm vào vùng đệm
 * 2. Weakened: Đã test >= 3 lần (thanh khoản cạn kiệt, dễ vỡ)
 * 3. Broken: Giá đóng nến vượt dứt khoát ra ngoài vùng
 * 4. Reclaimed (BẪY GIÁ LÁI): Thủng hỗ trợ nhưng nến M15 ngay sau đó rút chân đóng ngược lên trên!
 */
function evaluateZonesAgainstPrice(zones, currentPrice, m15Input = []) {
  const m15Candles = Array.isArray(m15Input) ? m15Input : (m15Input?.m15 || []);
  const lastM15 = m15Candles.slice(-1)[0];
  const prevM15 = m15Candles.slice(-2)[0];

  const events = [];
  const evaluatedZones = zones.map(z => {
    const updated = { ...z };

    // Kiểm tra giá hiện tại có đang nằm trong vùng không
    const insideZone = currentPrice >= updated.low && currentPrice <= updated.high;

    // 1. Phân loại độ bền vùng theo số lần test
    if (updated.touchCount >= 4) {
      updated.status = 'WEAKENED';
      updated.statusDesc = '⚠️ Vùng đã test nhiều lần (≥ 4 lần). Cực kỳ mỏng, dễ bị xuyên thủng!';
    } else if (insideZone) {
      updated.status = 'TESTING';
      updated.statusDesc = '🎯 Giá đang phản ứng kiểm tra vùng (Retest in progress)';
    } else {
      updated.status = 'ACTIVE';
      updated.statusDesc = 'Khả dụng';
    }

    // 2. Phát hiện Breakout / Breakdown
    if (updated.type === 'SUPPORT' && currentPrice < updated.low - 2.0) {
      updated.status = 'BROKEN';
      updated.statusDesc = 'Đã bị thủng (Breakdown)';
    } else if (updated.type === 'RESISTANCE' && currentPrice > updated.high + 2.0) {
      updated.status = 'BROKEN';
      updated.statusDesc = 'Đã bị vượt qua (Breakout)';
    }

    // 3. TUYỆT CHIÊU: PHÁT HIỆN BẪY GIÁ RECLAIM (BEAR TRAP / BULL TRAP)
    if (lastM15 && prevM15) {
      // Bear Trap Reclaim: Nến trước nhúng thủng hỗ trợ (đám đông Short đuổi), nến này rút chân đóng trên hỗ trợ!
      if (updated.type === 'SUPPORT' && prevM15.low < updated.low && lastM15.close >= updated.low) {
        updated.status = 'RECLAIMED';
        updated.statusDesc = '🔥 BEAR TRAP RECLAIM (Bẫy Gấu ép Short): Nhúng thủng giả rồi rút chân lấy lại hỗ trợ!';
        events.push({
          type: 'BEAR_TRAP_RECLAIM',
          zone: updated,
          price: currentPrice,
          time: lastM15.time,
          actionSignal: 'SWING_LONG_OPPORTUNITY',
          message: `🔥 CẢNH BÁO BẪY GẤU (BEAR TRAP RECLAIM): Giá nhúng thủng vùng ${updated.midPrice} (${updated.low} - ${updated.high}) nhưng đã rút chân lấy lại vùng. Cơ hội mở LONG SWING cực mạnh!`,
        });
      }

      // Bull Trap Reject: Nến trước rướn vượt kháng cự (fomo Long đua đỉnh), nến này tụt dội ngược đóng dưới cản!
      if (updated.type === 'RESISTANCE' && prevM15.high > updated.high && lastM15.close <= updated.high) {
        updated.status = 'RECLAIMED';
        updated.statusDesc = '🚨 BULL TRAP REJECT (Bẫy Bò đu đỉnh): Rướn vượt cản giả rồi bị bán xả dội ngược!';
        events.push({
          type: 'BULL_TRAP_REJECT',
          zone: updated,
          price: currentPrice,
          time: lastM15.time,
          actionSignal: 'SWING_SHORT_OPPORTUNITY',
          message: `🚨 CẢNH BÁO BẪY BÒ (BULL TRAP REJECT): Giá rướn vượt cản ${updated.midPrice} (${updated.low} - ${updated.high}) nhưng bị dội ngược trở lại. Cơ hội mở SHORT SWING cực mạnh!`,
        });
      }
    }

    return updated;
  });

  return {
    evaluatedZones,
    events,
  };
}

// ─── TÌM HỖ TRỢ & KHÁNG CỰ GẦN NHẤT ĐỂ ĐO R:R ──────────────────
function findNearestLevels(evaluatedZones, currentPrice) {
  // Lọc các vùng còn hiệu lực (không tính vùng đã vỡ hoàn toàn)
  const validZones = evaluatedZones.filter(z => z.status !== 'BROKEN');

  const supports = validZones
    .filter(z => z.type === 'SUPPORT' && z.high <= currentPrice + 0.5)
    .sort((a, b) => b.midPrice - a.midPrice);

  const resistances = validZones
    .filter(z => z.type === 'RESISTANCE' && z.low >= currentPrice - 0.5)
    .sort((a, b) => a.midPrice - b.midPrice);

  const nearestSupport = supports[0] || null;
  const nearestResistance = resistances[0] || null;

  const distToSupport = nearestSupport ? parseFloat((currentPrice - nearestSupport.midPrice).toFixed(1)) : 999;
  const distToResistance = nearestResistance ? parseFloat((nearestResistance.midPrice - currentPrice).toFixed(1)) : 999;

  // Tính tỷ lệ Risk : Reward
  let rrRatio = 1.0;
  if (distToSupport > 0 && distToResistance > 0) {
    rrRatio = parseFloat((distToResistance / distToSupport).toFixed(2));
  }

  // Định vị trạng thái giá hiện tại
  let locationCategory = 'MIDDLE_OF_RANGE';
  let locationLabel = 'Lơ lửng giữa biên độ (Không vào lệnh)';
  let isAtExtremeZone = false;

  if (distToSupport <= 3.0) {
    locationCategory = 'AT_SUPPORT_ZONE';
    locationLabel = `Sát Vùng Hỗ Trợ (${nearestSupport.midPrice}đ) ➔ VÙNG CỰC TRỊ SĂN LONG`;
    isAtExtremeZone = true;
  } else if (distToResistance <= 3.0) {
    locationCategory = 'AT_RESISTANCE_ZONE';
    locationLabel = `Sát Vùng Kháng Cự (${nearestResistance.midPrice}đ) ➔ VÙNG CỰC TRỊ SĂN SHORT`;
    isAtExtremeZone = true;
  } else if (distToSupport > 10.0 && distToResistance > 10.0) {
    locationCategory = 'NO_MANS_LAND';
    locationLabel = 'Vùng chân không rủi ro cao (Tuyệt đối không fomo mở mới)';
  }

  return {
    currentPrice,
    nearestSupport,
    nearestResistance,
    distToSupport,
    distToResistance,
    rrRatio,
    locationCategory,
    locationLabel,
    isAtExtremeZone,
  };
}

// ─── MASTER WRAPPER: TÌM & ĐÁNH GIÁ VÙNG CHO AI SUPERVISOR ──────
function findDynamicZones(mtfData, currentPrice) {
  const rawZones = extractDynamicZones(mtfData);
  const evalResult = evaluateZonesAgainstPrice(rawZones, currentPrice, mtfData);
  const nearest = findNearestLevels(evalResult.evaluatedZones, currentPrice);

  return {
    zones: evalResult.evaluatedZones,
    trapSignals: evalResult.events,
    relativePosition: {
      status: nearest.locationCategory === 'AT_SUPPORT_ZONE' ? 'AT_SUPPORT' : (nearest.locationCategory === 'AT_RESISTANCE_ZONE' ? 'AT_RESISTANCE' : 'MIDDLE'),
      locationDescription: nearest.locationLabel,
      nearestSupport: nearest.nearestSupport,
      nearestResistance: nearest.nearestResistance,
      distanceToSupport: nearest.distToSupport,
      distanceToResistance: nearest.distToResistance,
      rrRatio: nearest.rrRatio,
      isAtExtremeZone: nearest.isAtExtremeZone,
      zone: nearest.locationCategory === 'AT_SUPPORT_ZONE' ? nearest.nearestSupport : (nearest.locationCategory === 'AT_RESISTANCE_ZONE' ? nearest.nearestResistance : (nearest.nearestSupport || nearest.nearestResistance)),
    },
  };
}

module.exports = {
  findPivots,
  clusterToZones,
  extractDynamicZones,
  evaluateZonesAgainstPrice,
  findNearestLevels,
  findDynamicZones,
};
