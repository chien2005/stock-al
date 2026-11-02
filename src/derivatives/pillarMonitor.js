/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🏛️ VN30F — Pillar Stock Monitor (Giám sát 7 Trụ Điều Tiết)  ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Chuyên sâu điều tiết thị trường Phái Sinh VN30F:            ║
 * ║  Giám sát realtime 7 cổ phiếu trụ ảnh hưởng lớn nhất:        ║
 * ║  VIC, VPL, VHM, MCH, VCB, GAS, VJC                          ║
 * ║                                                               ║
 * ║  Phát hiện:                                                  ║
 * ║  • Kéo trụ ảo / Xả trụ đè chỉ số (Single pillar manipulation)║
 * ║  • Đồng thuận trụ (Consensus Long/Short)                      ║
 * ║  • Phân kỳ trụ vs F1M (Bull/Bear Trap)                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { fetchRealtimeData } = require('../stockService');

// 7 mã trụ trọng yếu chi phối VN30 và VNINDEX theo yêu cầu hệ thống
const TRACKED_PILLARS = ['VIC', 'VPL', 'VHM', 'MCH', 'VCB', 'GAS', 'VJC'];

// Cache chống spam API
let _pillarCache = {
  timestamp: 0,
  data: null,
};
const CACHE_TTL_MS = 20 * 1000; // 20 giây

/**
 * Lấy dữ liệu realtime 7 mã trụ kèm cache
 */
async function fetchPillarData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _pillarCache.data && (now - _pillarCache.timestamp < CACHE_TTL_MS)) {
    return _pillarCache.data;
  }

  try {
    const rawList = await fetchRealtimeData(TRACKED_PILLARS);
    if (rawList && rawList.length > 0) {
      _pillarCache = {
        timestamp: now,
        data: rawList,
      };
      return rawList;
    }
  } catch (err) {
    console.error('   ⚠️ [PillarMonitor] Lỗi fetch dữ liệu trụ:', err.message);
  }

  return _pillarCache.data || [];
}

/**
 * Phân tích trạng thái chi tiết của 7 mã trụ
 * @param {string|null} f1mDirection - Hướng F1 đang xét ('LONG' | 'SHORT' | null)
 * @param {boolean} forceRefresh - Buộc làm mới dữ liệu
 */
async function analyzePillars(f1mDirection = null, forceRefresh = false) {
  const rawList = await fetchPillarData(forceRefresh);

  const pillars = {};
  let totalPctChange = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let strongBullCount = 0;
  let strongBearCount = 0;

  for (const sym of TRACKED_PILLARS) {
    const item = rawList.find(d => d.sym === sym) || null;
    if (!item) {
      pillars[sym] = {
        sym,
        price: 0,
        refPrice: 0,
        changePct: 0,
        volume: 0,
        status: 'UNKNOWN',
        emoji: '⚪',
        isGreen: false,
        isRed: false,
      };
      neutralCount++;
      continue;
    }

    const price = parseFloat(item.lastPrice) || parseFloat(item.r) || 0;
    const ref = parseFloat(item.r) || price;
    const ceil = parseFloat(item.c) || (ref * 1.07);
    const floor = parseFloat(item.f) || (ref * 0.93);

    // Tính chính xác % thay đổi realtime từ giá hiện tại so với tham chiếu
    // (TUYỆT ĐỐI KHÔNG dùng item.changePc vì VPS API trả về số dương không mang dấu âm khi giảm)
    let changePct = 0;
    if (ref > 0 && price > 0) {
      changePct = parseFloat((((price - ref) / ref) * 100).toFixed(2));
    }

    const vol = parseInt(item.lot, 10) || 0;
    totalPctChange += changePct;

    let status = 'NEUTRAL';
    let emoji = '⚪';

    // Nhận diện tím trần / xanh lơ sàn
    if (price >= ceil - 0.05 && price > 0) {
      status = 'CEILING';
      emoji = '🟣';
      strongBullCount++;
      bullishCount++;
    } else if (price <= floor + 0.05 && price > 0) {
      status = 'FLOOR';
      emoji = '🔵';
      strongBearCount++;
      bearishCount++;
    } else if (changePct >= 1.5) {
      status = 'STRONG_BULL';
      emoji = '🚀';
      strongBullCount++;
      bullishCount++;
    } else if (changePct >= 0.5) {
      status = 'BULLISH';
      emoji = '🟢';
      bullishCount++;
    } else if (changePct <= -1.5) {
      status = 'STRONG_BEAR';
      emoji = '🔻';
      strongBearCount++;
      bearishCount++;
    } else if (changePct <= -0.5) {
      status = 'BEARISH';
      emoji = '🔴';
      bearishCount++;
    } else {
      neutralCount++;
    }

    pillars[sym] = {
      sym,
      price,
      refPrice: ref,
      changePct,
      volume: vol,
      status,
      emoji,
      isGreen: changePct > 0,
      isRed: changePct < 0,
    };
  }

  const validCount = TRACKED_PILLARS.length;
  const avgChangePct = validCount > 0 ? parseFloat((totalPctChange / validCount).toFixed(2)) : 0;

  // Tính điểm đồng thuận pillarScore (-100 đến +100)
  // Mỗi trụ bull +15, strong bull +20, bear -15, strong bear -20
  let rawScore = 0;
  for (const sym of TRACKED_PILLARS) {
    const p = pillars[sym];
    if (p.status === 'STRONG_BULL') rawScore += 20;
    else if (p.status === 'BULLISH') rawScore += 12;
    else if (p.status === 'STRONG_BEAR') rawScore -= 20;
    else if (p.status === 'BEARISH') rawScore -= 12;
  }
  const pillarScore = Math.max(-100, Math.min(100, rawScore));

  // Nhận diện trạng thái đồng thuận
  let consensus = 'NEUTRAL';
  let consensusLabel = 'PHÂN HÓA (Không đồng thuận)';

  if (bullishCount >= 5 && bearishCount === 0) {
    consensus = 'STRONG_LONG';
    consensusLabel = '🟢 ĐỒNG THUẬN TĂNG RẤT MẠNH';
  } else if (bullishCount >= 4 && bearishCount <= 1) {
    consensus = 'LONG';
    consensusLabel = '🟢 ĐỒNG THUẬN TĂNG';
  } else if (bearishCount >= 5 && bullishCount === 0) {
    consensus = 'STRONG_SHORT';
    consensusLabel = '🔴 ĐỒNG THUẬN GIẢM RẤT MẠNH';
  } else if (bearishCount >= 4 && bullishCount <= 1) {
    consensus = 'SHORT';
    consensusLabel = '🔴 ĐỒNG THUẬN GIẢM';
  } else if (bullishCount >= 3 && bearishCount >= 3) {
    consensus = 'CONFLICT';
    consensusLabel = '⚡ GIẰNG CO TRỤ (Kéo con này xả con kia)';
  }

  // Phát hiện bẫy kéo trụ đơn lẻ (Single Pillar Manipulation)
  // Điển hình: 1 mã như VIC hoặc VHM kéo > 2.5%, các mã khác đứng yên hoặc đỏ
  const manipulationWarnings = [];
  const singlePillarPump = TRACKED_PILLARS.find(s => pillars[s].changePct >= 2.5);
  const singlePillarDump = TRACKED_PILLARS.find(s => pillars[s].changePct <= -2.5);

  if (singlePillarPump && bearishCount >= 2) {
    manipulationWarnings.push(
      `🚨 BẪY KÉO TRỤ ĐIỀU TIẾT: Kéo thốc ${singlePillarPump} (+${pillars[singlePillarPump].changePct}%) để giữ chỉ số ảo trong khi ${bearishCount} trụ khác đỏ!`
    );
  } else if (singlePillarDump && bullishCount >= 2) {
    manipulationWarnings.push(
      `🚨 BẪY ĐẠP TRỤ ÉP PHÁI SINH: Đạp thốc ${singlePillarDump} (${pillars[singlePillarDump].changePct}%) trong khi ${bullishCount} trụ khác xanh!`
    );
  }

  // Phát hiện phân kỳ F1 vs Trụ
  let divergenceWithF1 = null;
  if (f1mDirection === 'LONG') {
    if (bearishCount >= 4) {
      divergenceWithF1 = 'BEARISH_DIVERGENCE';
      manipulationWarnings.push(
        `🚨 PHÂN KỲ NGUY HIỂM: F1 muốn Long nhưng 4/7 trụ đang ĐỎ (${bearishCount} mã giảm) → Khả năng Bull Trap rất cao!`
      );
    }
  } else if (f1mDirection === 'SHORT') {
    if (bullishCount >= 4) {
      divergenceWithF1 = 'BULLISH_DIVERGENCE';
      manipulationWarnings.push(
        `🚨 PHÂN KỲ NGUY HIỂM: F1 muốn Short nhưng 4/7 trụ đang XANH (${bullishCount} mã tăng) → Khả năng Bear Trap rất cao!`
      );
    }
  }

  return {
    pillars,
    avgChangePct,
    bullishCount,
    bearishCount,
    neutralCount,
    strongBullCount,
    strongBearCount,
    pillarScore,
    consensus,
    consensusLabel,
    manipulationWarnings,
    divergenceWithF1,
    isAlignedWithLong: (consensus === 'LONG' || consensus === 'STRONG_LONG') && manipulationWarnings.length === 0,
    isAlignedWithShort: (consensus === 'SHORT' || consensus === 'STRONG_SHORT') && manipulationWarnings.length === 0,
  };
}

/**
 * Format chuỗi tóm tắt 7 trụ cho thông báo Telegram
 * Súc tích, trực quan, đọc 2 giây nắm được bản chất dòng tiền trụ
 */
function formatPillarsForNotification(analysis) {
  if (!analysis || !analysis.pillars) return '';

  const { pillars, consensusLabel, manipulationWarnings } = analysis;

  const parts = TRACKED_PILLARS.map(s => {
    const p = pillars[s];
    if (!p) return `${s}: N/A`;
    const sign = p.changePct > 0 ? '+' : '';
    return `${s}: ${sign}${p.changePct.toFixed(1)}% ${p.emoji}`;
  });

  // Chia 2 dòng cho dễ đọc trên điện thoại
  const line1 = parts.slice(0, 4).join(' | ');
  const line2 = parts.slice(4).join(' | ');

  let result = `🏛️ <b>7 TRỤ ĐIỀU TIẾT (VN30/VNINDEX):</b>\n`;
  result += `• ${line1}\n`;
  result += `• ${line2}\n`;
  result += `👉 <i>Trạng thái: ${consensusLabel}</i>\n`;

  if (manipulationWarnings && manipulationWarnings.length > 0) {
    for (const w of manipulationWarnings) {
      result += `${w}\n`;
    }
  }

  return result;
}

module.exports = {
  TRACKED_PILLARS,
  fetchPillarData,
  analyzePillars,
  formatPillarsForNotification,
};

