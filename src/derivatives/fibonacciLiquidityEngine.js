/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📐 VN30F — Dynamic Fibonacci & Liquidity Hunt Engine        ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Kẻ Fibonacci động Realtime theo cấu trúc sóng & nến nổ vol    ║
 * ║  • Xác định Vùng Cung / Cầu mục tiêu sắp quét tới            ║
 * ║  • Cảnh báo vùng Sideway / Tụ tập đám đông (Tránh bẫy 50/50) ║
 * ║  • Phân tích VSA Volume vs Price Action vi mô:               ║
 * ║    - Đạp ép thiếu Vol / Kiệt bán (Cấm Short đuổi đáy)        ║
 * ║    - Kéo cố / Long giả / Bull Trap (Chỉ là hồi kỹ thuật)     ║
 * ║    - Nổ Vol liên tiếp phá cản (Xác nhận sóng thật)           ║
 * ║    - Vùng Quá bán / Quá mua kiệt sức                         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

/**
 * 1. TÍNH TOÁN FIBONACCI ĐỘNG REALTIME
 * Dựa trên Swing High, Swing Low và Nến Biến Động Lớn (Impulse Wave)
 */
function calculateDynamicFibonacci(m5Data, m1Data, currentPrice) {
  if (!m5Data || !m5Data.c || m5Data.c.length < 5) {
    const base = currentPrice || 1840;
    return _buildFallbackFibonacci(base);
  }

  const closes = m5Data.c;
  const highs = m5Data.h || closes;
  const lows = m5Data.l || closes;
  const volumes = m5Data.v || [];
  const len = closes.length;

  // 1.1. Xác định biên độ toàn phiên (Session Range)
  const sessionHigh = Math.max(...highs);
  const sessionLow = Math.min(...lows);

  // 1.2. Xác định nhịp sóng gần nhất (Recent 15-20 bars 5M = 1.5 - 2 tiếng gần nhất)
  const recentWindow = Math.min(20, len);
  const recentCloses = closes.slice(-recentWindow);
  const recentHighs = highs.slice(-recentWindow);
  const recentLows = lows.slice(-recentWindow);
  const recentVols = volumes.slice(-recentWindow);

  let swingHigh = Math.max(...recentHighs);
  let swingLow = Math.min(...recentLows);

  // Nếu biên nhịp gần quá hẹp (< 4đ), mở rộng ra theo biên độ phiên
  if (swingHigh - swingLow < 4.0) {
    swingHigh = sessionHigh;
    swingLow = sessionLow;
  }
  let range = +(swingHigh - swingLow).toFixed(1);
  if (range < 3.0) range = 4.0; // Bảo đảm range tối thiểu

  // 1.3. Xác định hướng sóng chủ đạo (Wave Direction)
  const idxHigh = recentHighs.lastIndexOf(Math.max(...recentHighs));
  const idxLow = recentLows.lastIndexOf(Math.min(...recentLows));
  const isDowntrendWave = idxHigh < idxLow; // Đỉnh xuất hiện trước, đáy xuất hiện sau -> Sóng đang rơi

  // 1.4. Tính toán các mốc Fibonacci Retracement & Extension
  // Retracement từ Swing High xuống Swing Low
  const f0 = swingLow;
  const f236 = +(swingHigh - 0.236 * range).toFixed(1);
  const f382 = +(swingHigh - 0.382 * range).toFixed(1);
  const f500 = +(swingHigh - 0.500 * range).toFixed(1); // Mốc cân bằng Equilibrium
  const f618 = +(swingHigh - 0.618 * range).toFixed(1); // Golden Pocket
  const f786 = +(swingHigh - 0.786 * range).toFixed(1);
  const f100 = swingHigh;

  // Extensions / Liquidity Expansion (Mở rộng quét cản / thủng đáy)
  const fExtHigh1272 = +(swingHigh + 0.272 * range).toFixed(1); // Quét SL Short
  const fExtHigh1618 = +(swingHigh + 0.618 * range).toFixed(1); // Golden Extension Up
  const fExtLow1272 = +(swingLow - 0.272 * range).toFixed(1);   // Quét SL Long
  const fExtLow1618 = +(swingLow - 0.618 * range).toFixed(1);   // Golden Extension Down

  return {
    swingHigh,
    swingLow,
    sessionHigh,
    sessionLow,
    range,
    isDowntrendWave,
    // Levels
    f0,
    f236,
    f382,
    f500,
    f618,
    f786,
    f100,
    // Extensions
    fExtHigh1272,
    fExtHigh1618,
    fExtLow1272,
    fExtLow1618,
  };
}

function _buildFallbackFibonacci(basePrice) {
  const range = 6.0;
  const swingHigh = basePrice + 3.0;
  const swingLow = basePrice - 3.0;
  return {
    swingHigh,
    swingLow,
    sessionHigh: swingHigh,
    sessionLow: swingLow,
    range,
    isDowntrendWave: false,
    f0: swingLow,
    f236: +(swingHigh - 0.236 * range).toFixed(1),
    f382: +(swingHigh - 0.382 * range).toFixed(1),
    f500: +(swingHigh - 0.500 * range).toFixed(1),
    f618: +(swingHigh - 0.618 * range).toFixed(1),
    f786: +(swingHigh - 0.786 * range).toFixed(1),
    f100: swingHigh,
    fExtHigh1272: +(swingHigh + 0.272 * range).toFixed(1),
    fExtHigh1618: +(swingHigh + 0.618 * range).toFixed(1),
    fExtLow1272: +(swingLow - 0.272 * range).toFixed(1),
    fExtLow1618: +(swingLow - 0.618 * range).toFixed(1),
  };
}

/**
 * 2. BẢN ĐỒ VÙNG CUNG / CẦU MỤC TIÊU SẮP QUÉT TỚI
 * Phân tích xác suất và sắp xếp các mốc giá theo khả năng cao nhất giá sẽ tiến tới
 */
function mapSupplyDemandTargets(fibo, currentPrice, m5Data, m1Data, oiData) {
  const p = currentPrice || fibo.f500;

  // 2.1. Tập hợp các mức Cản / Cung phía trên (Resistances / Supply targets)
  const upperCandidates = [
    { price: fibo.f786, levelName: 'Fibo 78.6%', role: 'Cản hồi quy sâu' },
    { price: fibo.f618, levelName: 'Fibo 61.8% (Golden Pocket)', role: 'Vùng Cung chốt chặn vàng' },
    { price: fibo.f500, levelName: 'Fibo 50.0% (Equilibrium)', role: 'Mốc cân bằng cung cầu' },
    { price: fibo.f382, levelName: 'Fibo 38.2%', role: 'Cản hồi quy nông' },
    { price: fibo.f236, levelName: 'Fibo 23.6%', role: 'Cản áp sát đỉnh' },
    { price: fibo.f100, levelName: 'Đỉnh cũ Fibo 100%', role: 'Test đỉnh cũ' },
    { price: fibo.fExtHigh1272, levelName: 'Fibo Ext 127.2%', role: 'Quét râu vượt đỉnh / Quét SL phe Short' },
    { price: fibo.fExtHigh1618, levelName: 'Fibo Ext 161.8%', role: 'Mở rộng sóng tăng Golden Extension' },
  ].filter(c => c.price > p + 0.2);

  // Sắp xếp mức cản gần nhất lên đầu
  upperCandidates.sort((a, b) => a.price - b.price);

  // 2.2. Tập hợp các mức Hỗ trợ / Cầu phía dưới (Supports / Demand targets)
  const lowerCandidates = [
    { price: fibo.f500, levelName: 'Fibo 50.0% (Equilibrium)', role: 'Mốc cân bằng cung cầu' },
    { price: fibo.f618, levelName: 'Fibo 61.8% (Golden Pocket)', role: 'Vùng Cầu đỡ giá vàng' },
    { price: fibo.f786, levelName: 'Fibo 78.6%', role: 'Hỗ trợ phòng thủ cuối' },
    { price: fibo.f0, levelName: 'Đáy cũ Fibo 0%', role: 'Test đáy cũ' },
    { price: fibo.fExtLow1272, levelName: 'Fibo Ext 127.2%', role: 'Nhúng xuyên đáy / Quét SL phe Long' },
    { price: fibo.fExtLow1618, levelName: 'Fibo Ext 161.8%', role: 'Mở rộng sóng giảm Climax' },
  ].filter(c => c.price < p - 0.2);

  // Sắp xếp mức hỗ trợ gần nhất lên đầu
  lowerCandidates.sort((a, b) => b.price - a.price);

  // 2.3. Đánh giá mục tiêu Kháng cự / Quét cản
  let nextSupplyTarget = null;
  let huntSupplyTarget = null;
  if (upperCandidates.length > 0) {
    nextSupplyTarget = upperCandidates[0];
    nextSupplyTarget.dist = +(nextSupplyTarget.price - p).toFixed(1);
    // Tìm mốc quét đỉnh nếu giá đang áp sát đỉnh
    huntSupplyTarget = upperCandidates.find(c => c.price >= fibo.f100) || upperCandidates[upperCandidates.length - 1];
    huntSupplyTarget.dist = +(huntSupplyTarget.price - p).toFixed(1);
  }

  // 2.4. Đánh giá mục tiêu Hỗ trợ / Quét đáy
  let nextDemandTarget = null;
  let huntDemandTarget = null;
  if (lowerCandidates.length > 0) {
    nextDemandTarget = lowerCandidates[0];
    nextDemandTarget.dist = +(p - nextDemandTarget.price).toFixed(1);
    // Tìm mốc quét đáy nếu giá đang áp sát đáy
    huntDemandTarget = lowerCandidates.find(c => c.price <= fibo.f0) || lowerCandidates[lowerCandidates.length - 1];
    huntDemandTarget.dist = +(p - huntDemandTarget.price).toFixed(1);
  }

  // 2.5. Xác định hướng ưu tiên (Primary Magnetic Target)
  let primaryTargetRole = 'NEUTRAL';
  let primaryTarget = null;
  if (nextSupplyTarget && (!nextDemandTarget || nextSupplyTarget.dist <= nextDemandTarget.dist)) {
    primaryTargetRole = 'UPPER_HUNT';
    primaryTarget = nextSupplyTarget;
  } else if (nextDemandTarget) {
    primaryTargetRole = 'LOWER_HUNT';
    primaryTarget = nextDemandTarget;
  }

  return {
    currentPrice: p,
    equilibrium: fibo.f500,
    upperCandidates,
    lowerCandidates,
    nextSupplyTarget,
    huntSupplyTarget,
    nextDemandTarget,
    huntDemandTarget,
    primaryTargetRole,
    primaryTarget,
  };
}

/**
 * 3. NHẬN DIỆN VÙNG TỤ TẬP ĐÁM ĐÔNG / SIDEWAY (TRÁNH BẪY 50/50 TÀI XỈU)
 */
function detectSidewayCrowdZone(fibo, currentPrice, m5Data, m1Data) {
  if (!m5Data || !m5Data.c || m5Data.c.length < 6) {
    return { isSidewayChop: false, chopSpan: 0, warning: '' };
  }

  const closes = m5Data.c;
  const highs = m5Data.h || closes;
  const lows = m5Data.l || closes;
  const volumes = m5Data.v || [];

  // Lấy 6 cây nến 5p gần nhất (= 30 phút giao dịch gần đây)
  const recent6Closes = closes.slice(-6);
  const recent6Highs = highs.slice(-6);
  const recent6Lows = lows.slice(-6);
  const recent6Vols = volumes.slice(-6);

  const chopHigh = Math.max(...recent6Highs);
  const chopLow = Math.min(...recent6Lows);
  const chopSpan = +(chopHigh - chopLow).toFixed(1);

  const avgVol = recent6Vols.length > 0 ? (recent6Vols.reduce((s, v) => s + v, 0) / recent6Vols.length) : 1000;
  const lastVol = recent6Vols[recent6Vols.length - 1] || 1000;
  const isDryVolume = lastVol <= avgVol * 1.15 || lastVol < 1500;

  // Tiêu chí vùng tụ tập đám đông:
  // 1. Biên độ 30 phút gần nhất rất hẹp (< 2.8đ)
  // 2. Hoặc giá đang kẹt giữa Fibo 38.2% và Fibo 61.8% mà không bứt phá được
  const isInsideEquilibriumBand = Math.abs(currentPrice - fibo.f500) <= 1.6;
  const isTightCompression = chopSpan <= 2.8;

  const isSidewayChop = (isTightCompression || (isInsideEquilibriumBand && chopSpan <= 3.6)) && isDryVolume;

  let warning = '';
  if (isSidewayChop) {
    warning = `⚠️ <b>VÙNG TỤ TẬP ĐÁM ĐÔNG / SIDEWAY KẸT NỀN (${chopLow} - ${chopHigh}, biên ${chopSpan}đ)</b>\n` +
      `👉 <i>Khuyến nghị: CHƯA RÕ THẾ LONG/SHORT (Rủi ro 50/50 tài xỉu). TUYỆT ĐỐI HẠN CHẾ VÀO LỆNH, chờ nổ Vol dứt khoát thoát nền!</i>`;
  }

  return {
    isSidewayChop,
    chopHigh,
    chopLow,
    chopSpan,
    warning,
  };
}

/**
 * 4. PHÂN TÍCH VSA VOLUME & PRICE ACTION VI MÔ (THẬT VS BẪY GIẢ)
 * Giải quyết bài toán:
 * - Giá giật -2.2đ nhưng chỉ 900 HĐ -> Đạp thiếu vol / kiệt bán, cấm short đuổi
 * - 3 cây long liên tiếp phá MA -> Xác nhận sóng thật
 * - Kéo cố / Long giả -> Chỉ là hồi kỹ thuật, chưa phải trend
 * - Quá bán / Quá mua
 */
function analyzeVSAIntradayAction(m5Data, m1Data, currentPrice, oiData, contextInfo) {
  if (!m5Data || !m5Data.c || m5Data.c.length < 3) {
    return {
      alertType: 'NORMAL',
      headline: 'Thị trường vận động bình thường',
      detail: '',
      isTrap: false,
      isNoSupply: false,
      isNoDemand: false,
      isTrueBreakout: false,
      isExhaustion: false,
    };
  }

  const closes = m5Data.c;
  const opens = m5Data.o || closes;
  const highs = m5Data.h || closes;
  const lows = m5Data.l || closes;
  const vols = m5Data.v || [];
  const len = closes.length;

  const c0 = closes[len - 1];
  const o0 = opens[len - 1];
  const h0 = highs[len - 1];
  const l0 = lows[len - 1];
  const v0 = vols[len - 1] || 0;

  const c1 = len > 1 ? closes[len - 2] : c0;
  const o1 = len > 1 ? opens[len - 2] : o0;
  const v1 = len > 1 ? vols[len - 2] : v0;

  const c2 = len > 2 ? closes[len - 3] : c1;

  // Tính mức thay đổi giá nến 5p gần nhất
  const candleChange = +(c0 - o0).toFixed(1);
  const candleMove = +(c0 - c1).toFixed(1);
  const candleRange = +(h0 - l0).toFixed(1);
  const upperWick = +(h0 - Math.max(c0, o0)).toFixed(1);
  const lowerWick = +(Math.min(c0, o0) - l0).toFixed(1);

  // Trung bình vol 10 nến 5p
  const lookbackVols = vols.slice(-10);
  const avgVol = lookbackVols.length > 0 ? (lookbackVols.reduce((s, v) => s + v, 0) / lookbackVols.length) : 1500;
  const volRatio = avgVol > 0 ? +(v0 / avgVol).toFixed(2) : 1.0;

  // Dữ liệu nến 1p (nếu có để check micro timing 3 cây nến)
  let m1ConsecutiveLongs = 0;
  let m1ConsecutiveShorts = 0;
  let m1Last3Vol = 0;
  if (m1Data && m1Data.c && m1Data.c.length >= 3) {
    const m1c = m1Data.c;
    const m1o = m1Data.o || m1c;
    const m1v = m1Data.v || [];
    const m1len = m1c.length;

    for (let i = m1len - 1; i >= Math.max(0, m1len - 4); i--) {
      if (m1c[i] > m1o[i]) m1ConsecutiveLongs++;
      else break;
    }
    for (let i = m1len - 1; i >= Math.max(0, m1len - 4); i--) {
      if (m1c[i] < m1o[i]) m1ConsecutiveShorts++;
      else break;
    }
    m1Last3Vol = m1v.slice(-3).reduce((s, v) => s + v, 0);
  }

  // ─── CASE 1: ĐẠP ÉP THIẾU VOL / KIỆT BÁN (NO SUPPLY / BEAR TRAP) ────────
  // Giá giật giảm >= 1.5đ nhưng Volume < 1.200 HĐ hoặc volRatio < 0.65
  if (candleMove <= -1.5 && (v0 < 1200 || volRatio < 0.65)) {
    return {
      alertType: 'NO_SUPPLY',
      isTrap: true,
      isNoSupply: true,
      headline: `🔴 <b>GIÁ GIẬT GIẢM ${candleMove}đ NHƯNG CHỈ ${v0.toLocaleString('vi-VN')} HĐ ➔ ĐẠP THIẾU VOL / KIỆT BÁN!</b>`,
      detail: `⚠️ <i>Lực ép bán không có thanh khoản tổ chức (Vol x${volRatio} TB). Đây là bẫy đạp gom / quét Stop Loss hoảng loạn. <b>CẤM SHORT ĐUỔI VÙNG ĐÁY!</b></i>`,
      actionSignal: 'CANNOT_SHORT',
    };
  }

  // ─── CASE 2: KÉO CỐ / LONG GIẢ / BULL TRAP (NO DEMAND) ─────────────────
  // Giá tăng thốc lên cản nhưng Vol yếu (< 1.200 HĐ) hoặc râu trên rất dài (>= 40% range)
  if (candleMove >= 1.5 && (v0 < 1200 || (upperWick >= 1.0 && upperWick >= candleRange * 0.4))) {
    return {
      alertType: 'NO_DEMAND',
      isTrap: true,
      isNoDemand: true,
      headline: `🟢 <b>KÉO THỐC ${candleMove >= 0 ? '+' : ''}${candleMove}đ NHƯNG THIẾU CẦU / RÂU TRÊN DÀI ➔ KÉO CỐ / LONG GIẢ!</b>`,
      detail: `⚠️ <i>Nến rướn vol thấp (${v0.toLocaleString('vi-VN')} HĐ) hoặc bị đè râu trên (${upperWick}đ). Đây chỉ là nhịp hồi kỹ thuật, chưa phải trend. <b>CẤM ĐUA LONG GIÁ CAO!</b></i>`,
      actionSignal: 'CANNOT_LONG',
    };
  }

  // ─── CASE 3: NỔ VOL LIÊN TIẾP PHÁ CẢN ➔ SÓNG THẬT (TRUE EXPANSION) ─────
  // 3 cây 1p hoặc 2 cây 5p cùng hướng với Vol lớn (> 2.000 HĐ hoặc volRatio >= 1.6)
  if ((m1ConsecutiveLongs >= 3 && m1Last3Vol >= 2500) || (candleChange >= 2.0 && v0 >= 2200 && volRatio >= 1.5)) {
    return {
      alertType: 'TRUE_LONG_BREAKOUT',
      isTrueBreakout: true,
      headline: `🔥 <b>3 CÂY NẾN NỔ VOL LIÊN TIẾP (${v0.toLocaleString('vi-VN')} HĐ | x${volRatio} TB) ➔ XÁC NHẬN SÓNG LONG THẬT!</b>`,
      detail: `🟢 <i>Dòng tiền lớn dứt khoát giải phóng cản, phá vỡ cấu trúc tích lũy. Thuận thế Long mở rộng hướng lên các mốc Fibo Extension phía trên!</i>`,
      actionSignal: 'CONFIRMED_LONG_TREND',
    };
  }

  if ((m1ConsecutiveShorts >= 3 && m1Last3Vol >= 2500) || (candleChange <= -2.0 && v0 >= 2200 && volRatio >= 1.5)) {
    return {
      alertType: 'TRUE_SHORT_BREAKDOWN',
      isTrueBreakout: true,
      headline: `⚡ <b>XẢ VOL LỚN DỨT KHOÁT (${v0.toLocaleString('vi-VN')} HĐ | x${volRatio} TB) ➔ XÁC NHẬN SÓNG SHORT THẬT!</b>`,
      detail: `🔴 <i>Áp lực bán tháo chủ động xuyên thủng hỗ trợ. Phe Short nắm hoàn toàn thế trận, target mở rộng xuống các mốc Fibo Extension dưới!</i>`,
      actionSignal: 'CONFIRMED_SHORT_TREND',
    };
  }

  // ─── CASE 4: QUÁ BÁN / RÚT CHÂN V (SELLING CLIMAX EXHAUSTION) ───────────
  if (lowerWick >= 1.8 && v0 >= 1800 && c0 > l0 + 1.2) {
    return {
      alertType: 'SELLING_EXHAUSTION',
      isExhaustion: true,
      headline: `🟢 <b>VÙNG QUÁ BÁN + RÚT CHÂN MẠNH (${lowerWick}đ | Vol ${v0.toLocaleString('vi-VN')} HĐ) ➔ BẮT ĐÁY HỒI PHỤC!</b>`,
      detail: `💡 <i>Cung bán đã bị hấp thụ hoàn toàn ở vùng hỗ trợ Fibo. Không còn dư địa để Short, ưu tiên canh nhịp hồi!</i>`,
      actionSignal: 'RECOVERY_LONG',
    };
  }

  // ─── CASE 5: QUÁ MUA / BỊ ÉP ĐỈNH (BUYING CLIMAX EXHAUSTION) ────────────
  if (upperWick >= 1.8 && v0 >= 1800 && c0 < h0 - 1.2) {
    return {
      alertType: 'BUYING_EXHAUSTION',
      isExhaustion: true,
      headline: `🔴 <b>VÙNG QUÁ MUA + ĐÈ RÂU TRÊN DÀI (${upperWick}đ | Vol ${v0.toLocaleString('vi-VN')} HĐ) ➔ ÁP LỰC CHỐT LỜI CỰC LỚN!</b>`,
      detail: `💡 <i>Lực cầu cạn kiệt khi chạm vùng cản Fibo, rủi ro quay đầu đảo chiều cao. Cấm fomo Long!</i>`,
      actionSignal: 'REVERSAL_SHORT',
    };
  }

  // Trạng thái bình thường
  return {
    alertType: 'NORMAL',
    headline: `📊 Biến động 5p: ${candleChange >= 0 ? '+' : ''}${candleChange}đ | Vol: ${v0.toLocaleString('vi-VN')} HĐ (x${volRatio} TB)`,
    detail: `Nhịp dao động trong biên kỹ thuật thông thường.`,
    actionSignal: 'OBSERVE',
  };
}

/**
 * 5. TẠO BANNER THẾ VÀ CẤU TRÚC THỊ TRƯỜNG CHO ĐẦU DÒNG NOTI
 * Giúp Trader quan sát trong 0.5s nhận diện ngay:
 * - Thế Short / Downtrend / Swing Down
 * - Thế Long / Uptrend / Swing Up
 * - Thế Sideway / Tụ tập đám đông (Tránh 50/50 tài xỉu)
 */
function generateMarketBiasBanner(structureInfo, m15Analysis, sidewayInfo, vsaAction) {
  const structure = structureInfo?.highLowStructure || 'SIDEWAY';
  const m15Signal = m15Analysis?.signal || 'NEUTRAL';

  // 1. Nếu đang kẹt nền sideway hoặc tụ tập đám đông
  if (sidewayInfo && sidewayInfo.isSidewayChop) {
    return `⚪ <b>THẾ SIDEWAY: TỤ TẬP ĐÁM ĐÔNG — CẤM VÀO LỆNH (TRÁNH 50/50 TÀI XỈU)</b>`;
  }

  // 2. Thế Short rõ rệt (Swing Down hoặc Hạ Đỉnh + Hạ Đáy)
  if (structure === 'DOWNTREND' || (m15Signal === 'BEARISH' && structure !== 'UPTREND')) {
    const detail = structureInfo?.swingHighDesc && structureInfo?.swingLowDesc
      ? `(HẠ ĐỈNH + HẠ ĐÁY)`
      : `(SWING DOWN)`;
    return `🔴 <b>THẾ SHORT — DOWNTREND ${detail} ➔ ƯU TIÊN CANH SHORT</b>`;
  }

  // 3. Thế Long rõ rệt (Swing Up hoặc Nâng Đỉnh + Nâng Đáy)
  if (structure === 'UPTREND' || (m15Signal === 'BULLISH' && structure !== 'DOWNTREND')) {
    const detail = structureInfo?.swingHighDesc && structureInfo?.swingLowDesc
      ? `(NÂNG ĐỈNH + NÂNG ĐÁY)`
      : `(SWING UP)`;
    return `🟢 <b>THẾ LONG — UPTREND ${detail} ➔ ƯU TIÊN CANH LONG</b>`;
  }

  // 4. Thế tam giác co hẹp
  if (structure === 'TRIANGLE') {
    return `🟡 <b>THẾ TAM GIÁC CO HẸP (HẠ ĐỈNH + NÂNG ĐÁY) ➔ CHỜ BỨT PHÁ</b>`;
  }

  // 5. Thế giằng co sideway biên rộng
  return `⚪ <b>THẾ GIẰNG CO PHÂN HÓA — CHƯA RÕ LONG/SHORT ➔ ĐỨNG NGOÀI QUAN SÁT</b>`;
}

/**
 * 6. TẠO LỜI KHUYÊN HÀNH ĐỘNG THỰC CHIẾN (PRACTICAL ADVICE)
 * Giải đáp chính xác:
 * - Lúc nào Short tiếp được? Lúc nào Quá bán kiệt sức rồi không Short được nữa?
 * - Kéo cố, Long giả hay chỉ là Long hồi kỹ thuật chưa phải trend?
 * - Tránh đi lệnh vùng sideway 50/50 tài xỉu.
 */
function generatePracticalTradingAdvice(structureInfo, fibo, sdTargets, sidewayInfo, vsaAction, currentPrice) {
  // Ưu tiên 1: Cảnh báo vùng Sideway đám đông
  if (sidewayInfo && sidewayInfo.isSidewayChop) {
    return `⚠️ <b>KHUYẾN NGHỊ:</b> Giá đang tụ tập nén biên hẹp (${sidewayInfo.chopLow} - ${sidewayInfo.chopHigh}đ). Phe Long/Short đang 50/50 tài xỉu. <b>TUYỆT ĐỐI KHÔNG ĐI LỆNH VÙNG KẸT NỀN</b>, kiên nhẫn chờ nổ Vol bứt phá!`;
  }

  // Ưu tiên 2: Cảnh báo Đạp ép thiếu Vol / Kiệt Bán (Không được Short đuổi đáy)
  if (vsaAction && vsaAction.isNoSupply) {
    return `⚠️ <b>KHUYẾN NGHỊ:</b> Giá giật giảm nhưng kiệt Vol. Đây là bẫy đè rũ quét Stop Loss, <b>CẤM SHORT ĐUỔI VÙNG ĐÁY</b> (rủi ro dính đáy cực cao). Nếu muốn Short, phải kiên nhẫn chờ nhịp hồi phục kiểm tra lại vùng Cung Fibo <b>${sdTargets.nextSupplyTarget?.price || fibo.f618}đ</b>!`;
  }

  // Ưu tiên 3: Cảnh báo Kéo cố / Long giả / Bull Trap (Không được đua Long)
  if (vsaAction && vsaAction.isNoDemand) {
    return `⚠️ <b>KHUYẾN NGHỊ:</b> Giá rướn thốc nhưng thiếu cầu hoặc bị đè râu trên. <b>CẤM ĐUA LONG GIÁ CAO</b> (chỉ là nhịp hồi kỹ thuật, chưa hình thành trend). Canh chốt bớt Long hoặc chờ chỉnh về vùng Cầu Fibo <b>${sdTargets.nextDemandTarget?.price || fibo.f618}đ</b> để đỡ!`;
  }

  // Ưu tiên 4: Quá bán / Bắt đáy rút chân
  if (vsaAction && vsaAction.alertType === 'SELLING_EXHAUSTION') {
    return `💡 <b>KHUYẾN NGHỊ:</b> Vùng Quá Bán xuất hiện nến rút chân mạnh tại hỗ trợ Fibo. Lực bán đã cạn kiệt, <b>KHÔNG THỂ SHORT TIẾP</b>, sẵn sàng cho nhịp hồi phục chữ V!`;
  }

  // Ưu tiên 5: Quá mua / Đè râu đỉnh
  if (vsaAction && vsaAction.alertType === 'BUYING_EXHAUSTION') {
    return `💡 <b>KHUYẾN NGHỊ:</b> Vùng Quá Mua gặp áp lực xả đỉnh tại cản Fibo. Lực Mua suy yếu, <b>CẤM MỞ LONG MỚI</b>, ưu tiên chốt lời chặn lãi!`;
  }

  // Ưu tiên 6: Sóng thật xác nhận
  if (vsaAction && vsaAction.isTrueBreakout) {
    if (vsaAction.alertType === 'TRUE_LONG_BREAKOUT') {
      return `🔥 <b>KHUYẾN NGHỊ:</b> Nổ Vol lớn phá cản xác nhận sóng Long thật! Thuận thế Long mở rộng, mục tiêu hướng lên Fibo Extension <b>${sdTargets.huntSupplyTarget?.price || fibo.fExtHigh1272}đ</b>.`;
    } else {
      return `⚡ <b>KHUYẾN NGHỊ:</b> Áp lực xả Vol lớn thủng hỗ trợ xác nhận sóng Short thật! Thuận thế Short tiếp diễn, mục tiêu mở rộng xuống Fibo Extension <b>${sdTargets.huntDemandTarget?.price || fibo.fExtLow1272}đ</b>.`;
    }
  }

  // Ưu tiên 7: Theo xu hướng Swing High/Low
  const structure = structureInfo?.highLowStructure;
  if (structure === 'DOWNTREND') {
    return `🔴 <b>KHUYẾN NGHỊ:</b> Xu hướng thuận Short (Hạ đỉnh + Hạ đáy). Có thể canh Short ở các nhịp hồi chạm Cung Fibo <b>${sdTargets.nextSupplyTarget?.price || fibo.f618}đ</b>, chốt lời dần khi nhúng sát Cầu Fibo <b>${sdTargets.nextDemandTarget?.price || fibo.f0}đ</b>.`;
  } else if (structure === 'UPTREND') {
    return `🟢 <b>KHUYẾN NGHỊ:</b> Xu hướng thuận Long (Nâng đỉnh + Nâng đáy). Canh Long ở các nhịp rung lắc về Cầu Fibo <b>${sdTargets.nextDemandTarget?.price || fibo.f618}đ</b>, chốt lời khi rướn sát Cung Fibo <b>${sdTargets.nextSupplyTarget?.price || fibo.f100}đ</b>.`;
  }

  return `⚪ <b>KHUYẾN NGHỊ:</b> Biên độ giằng co kỹ thuật giữa Cầu <b>${sdTargets.nextDemandTarget?.price || fibo.f0}đ</b> và Cung <b>${sdTargets.nextSupplyTarget?.price || fibo.f100}đ</b>. Hạn chế đi lệnh lưng chừng.`;
}

module.exports = {
  calculateDynamicFibonacci,
  mapSupplyDemandTargets,
  detectSidewayCrowdZone,
  analyzeVSAIntradayAction,
  generateMarketBiasBanner,
  generatePracticalTradingAdvice,
};
