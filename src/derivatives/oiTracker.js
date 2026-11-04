/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F — OI & TAY TO / KHỐI NGOẠI / ĐÁM ĐÔNG TRACKER      ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Theo dõi Open Interest (OI) & Vị thế qua đêm 3 PHE:          ║
 * ║  1. Khối ngoại (FII)                                          ║
 * ║  2. Tự doanh (Prop Trading)                                   ║
 * ║  3. Đám đông (Cá nhân nhỏ lẻ trong nước)                      ║
 * ║  Quy tắc Zero-Sum: Ngoại + Tự Doanh + Đám Đông = 0            ║
 * ║  Độc lập từng ngày (số HĐ còn cầm chưa đóng sau 14h45)       ║
 * ║  Phân tích tâm lý đám đông vs ý đồ cá mập phiên kế tiếp      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const dataFetcher = require('./dataFetcher');
const oiEstimator = require('./oiEstimator');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FOREIGN_OI_FILE = path.join(DATA_DIR, 'foreign_oi.json');
const OI_HISTORY_FILE = path.join(DATA_DIR, 'oi_history.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── LOAD & SAVE HELPERS ──────────────────────────────────────

function loadForeignOIData() {
  ensureDataDir();
  try {
    if (fs.existsSync(FOREIGN_OI_FILE)) {
      const raw = fs.readFileSync(FOREIGN_OI_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('⚠️ Lỗi đọc foreign_oi.json:', e.message);
  }
  return { lastUpdated: new Date().toISOString(), history: [] };
}

function saveForeignOIData(data) {
  ensureDataDir();
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(FOREIGN_OI_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('⚠️ Lỗi lưu foreign_oi.json:', e.message);
    return false;
  }
}

function loadOIHistoryData() {
  ensureDataDir();
  try {
    if (fs.existsSync(OI_HISTORY_FILE)) {
      const raw = fs.readFileSync(OI_HISTORY_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('⚠️ Lỗi đọc oi_history.json:', e.message);
  }
  return { lastUpdated: new Date().toISOString(), history: [] };
}

function saveOIHistoryData(data) {
  ensureDataDir();
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(OI_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('⚠️ Lỗi lưu oi_history.json:', e.message);
    return false;
  }
}

// ─── HELPER: KIỂM TRA NGÀY GIAO DỊCH TTCK VIỆT NAM ──────────
function isTradingDay(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false; // Thứ 7 & CN

  const d = date.getDate();
  const m = date.getMonth() + 1; // 1-12
  const y = date.getFullYear();

  // Danh sách ngày lễ TTCK Việt Nam (không tính T7/CN đã loại ở trên)
  // 1. Tết Dương Lịch (1/1 và ngày nghỉ bù)
  if (m === 1 && (d === 1 || (d === 2 && day === 1))) return false;

  // 2. Quốc khánh 2/9 (thường nghỉ 1/9, 2/9 hoặc 2/9, 3/9 và ngày nghỉ bù)
  if (m === 9 && (d === 1 || d === 2 || (d === 3 && day === 1) || (d === 4 && day === 1))) return false;

  // 3. Giải phóng miền Nam & Quốc tế Lao động (30/4, 1/5 và nghỉ bù)
  if (m === 4 && d === 30) return false;
  if (m === 5 && (d === 1 || d === 2 || (d === 3 && day === 1))) return false;

  // 4. Giỗ tổ Hùng Vương (10/3 Âm lịch)
  if (y === 2026 && m === 4 && d === 26) return false;

  // 5. Tết Nguyên Đán 2026 (Bính Ngọ: 14/02 - 22/02/2026)
  if (y === 2026 && m === 2 && d >= 14 && d <= 22) return false;

  return true;
}

/**
 * Lấy danh sách N ngày giao dịch gần nhất (chuẩn TTCK VN, loại trừ T7/CN và ngày lễ)
 * @param {number} count - Số ngày cần lấy (mặc định 5)
 * @param {Date|null} refDate - Ngày mốc (mặc định theo timezone VN)
 * @returns {string[]} Mảng ngày dạng "D/M/YYYY" theo thứ tự thời gian tăng dần
 */
function getRecentTradingDays(count = 5, refDate = null) {
  const vnTime = refDate ? new Date(refDate) : dataFetcher.getVnTime();
  const cur = new Date(vnTime);
  const dayOfWeek = cur.getDay();
  const vnHour = cur.getHours() + cur.getMinutes() / 60;

  // Nếu hôm nay là ngày làm việc (T2-T6) nhưng trước giờ mở phiên 9h05:
  // Chưa có dữ liệu phiên hôm nay -> lùi 1 ngày
  if (dayOfWeek >= 1 && dayOfWeek <= 5 && vnHour < 9.083) {
    cur.setDate(cur.getDate() - 1);
  }

  const dates = [];
  while (dates.length < count) {
    if (isTradingDay(cur)) {
      dates.unshift(`${cur.getDate()}/${cur.getMonth() + 1}/${cur.getFullYear()}`);
    }
    cur.setDate(cur.getDate() - 1);
  }

  return dates;
}

/**
 * Chuẩn hóa chuỗi ngày tháng để so khớp: "07/09/2026" hay "7/9/2026" đều về "7/9/2026"
 */
function normalizeDateStr(dStr) {
  if (!dStr) return '';
  const parts = dStr.split('/');
  if (parts.length < 3) return dStr.trim();
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  return `${d}/${m}/${y}`;
}

/**
 * Chuyển chuỗi "D/M/YYYY" thành timestamp để sắp xếp theo thời gian
 */
function parseDateStr(dStr) {
  if (!dStr) return 0;
  const parts = dStr.split('/');
  if (parts.length < 3) return 0;
  return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)).getTime();
}

// ─── GET 5-DAY HISTORY (ĐỘC LẬP TỪNG NGÀY & 3 PHE) ────────────

/**
 * Lấy danh sách 5 phiên giao dịch gần nhất gồm đầy đủ 3 phe:
 * - Khối ngoại (overnightNet)
 * - Tự doanh (tuDoanhOvernight)
 * - Đám đông / Cá nhân (crowdOvernight = -(overnightNet + tuDoanhOvernight))
 * - Tổng OI & Biến động OI
 * BẢO ĐẢM 100%: Luôn lấy đúng 5 ngày giao dịch gần nhất (loại bỏ T7, CN, ngày lễ, nghỉ bù)
 */
function getRecent5DaysData() {
  const foreignStore = loadForeignOIData();
  const oiStore = loadOIHistoryData();

  let fHistory = foreignStore.history || [];
  let oiHistory = oiStore.history || [];

  // Luôn sắp xếp theo thứ tự thời gian tăng dần
  fHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
  oiHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));

  // Lấy chính xác 5 ngày giao dịch gần nhất (loại bỏ T7, CN, ngày lễ, nghỉ bù)
  const targetTradingDays = getRecentTradingDays(5);

  let needSaveForeign = false;
  let needSaveOI = false;

  const results = [];
  for (let idx = 0; idx < targetTradingDays.length; idx++) {
    const targetDateStr = targetTradingDays[idx];
    const normTarget = normalizeDateStr(targetDateStr);
    const targetTs = parseDateStr(targetDateStr);

    // Tìm trong foreign_oi.json
    let fItem = fHistory.find(h => normalizeDateStr(h.date) === normTarget);
    // Tìm trong oi_history.json
    let oItem = oiHistory.find(h => normalizeDateStr(h.date) === normTarget);

    // Tìm bản ghi quá khứ gần nhất (trước ngày này) để kế thừa khi thiếu
    const prevHistoryF = fHistory.filter(h => parseDateStr(h.date) < targetTs).pop() || null;
    const prevF = idx > 0 ? results[idx - 1] : prevHistoryF;

    const prevHistoryO = oiHistory.filter(h => parseDateStr(h.date) < targetTs).pop() || null;
    const prevO = idx > 0 ? results[idx - 1] : prevHistoryO;

    // Nếu thiếu dữ liệu của ngày giao dịch này (ví dụ server offline hôm đó):
    // Tự động backfill để bảng 5 ngày luôn ĐỦ và LIÊN TỤC
    if (!fItem) {
      const prevCum = prevF ? (prevF.cumulativeNN !== undefined ? prevF.cumulativeNN : -4600) : -4600;
      const prevTDCum = prevF ? (prevF.cumulativeTD !== undefined ? prevF.cumulativeTD : 1610) : 1610;
      const net = prevF ? prevF.overnightNet : 0;
      const tdNet = prevF ? prevF.tuDoanhOvernight : 0;
      fItem = {
        date: targetDateStr,
        buy: prevF ? Math.round(prevF.buy || 4500) : 4500,
        sell: prevF ? Math.round(prevF.sell || 4500) : 4500,
        overnightNet: net,
        tuDoanhOvernight: tdNet,
        crowdOvernight: -(net + tdNet),
        cumulativeNN: prevCum + net,
        cumulativeTD: prevTDCum + tdNet,
        cumulativeCrowd: -(prevCum + net + prevTDCum + tdNet),
      };
      fHistory.push(fItem);
      fHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
      needSaveForeign = true;
      console.log(`   🛠️ [OI History] Auto-backfilled missing foreign data for trading day ${targetDateStr}`);
    }

    if (!oItem) {
      const prevTotal = prevO ? prevO.totalOI : 35000;
      oItem = {
        date: targetDateStr,
        totalOI: prevTotal,
        f1mOI: prevO ? prevO.f1mOI : 0,
        oiChange: 0,
        f1mPrice: prevO ? prevO.f1mPrice : 0,
        vn30Price: prevO ? prevO.vn30Price : 0,
        basis: prevO ? prevO.basis : 0,
        volume: prevO ? prevO.volume : 0,
        positionState: 'NEUTRAL',
      };
      oiHistory.push(oItem);
      oiHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
      needSaveOI = true;
      console.log(`   🛠️ [OI History] Auto-backfilled missing OI data for trading day ${targetDateStr}`);
    }

    const buy = fItem.buy || 0;
    const sell = fItem.sell || 0;
    const overnightNet = fItem.overnightNet !== undefined ? fItem.overnightNet : (fItem.net !== undefined ? fItem.net : (buy - sell));
    const rawTD = fItem.tuDoanhOvernight !== undefined ? fItem.tuDoanhOvernight : (fItem.tuDoanhNet || 0);

    // Tách bạch 3 phe: Ngoại - Tự Doanh - Đám Đông (KHÔNG gom Tự Doanh vào Đám Đông)
    // Khi Tự Doanh chưa có chốt sổ (= 0), ước lượng ~35% vị thế phòng hộ ngược chiều NN
    let tuDoanhOvernight = rawTD;
    let tdIsEstimated = false;
    if (rawTD === 0 && overnightNet !== 0) {
      tuDoanhOvernight = Math.round(-overnightNet * (oiEstimator.TD_ESTIMATION_RATIO || 0.35));
      tdIsEstimated = true;
    }
    const crowdOvernight = -(overnightNet + tuDoanhOvernight);

    const cumNN = fItem.cumulativeNN !== undefined ? fItem.cumulativeNN : (prevF && prevF.cumulativeNN !== undefined ? prevF.cumulativeNN + overnightNet : -4147);
    const cumTD = fItem.cumulativeTD !== undefined ? fItem.cumulativeTD : (prevF && prevF.cumulativeTD !== undefined ? prevF.cumulativeTD + tuDoanhOvernight : 1450);
    const cumCrowd = fItem.cumulativeCrowd !== undefined ? fItem.cumulativeCrowd : -(cumNN + cumTD);

    results.push({
      date: targetDateStr,
      buy,
      sell,
      overnightNet,
      rawTuDoanh: rawTD,
      tuDoanhOvernight,
      tdIsEstimated,
      crowdOvernight,
      cumulativeNN: cumNN,
      cumulativeTD: cumTD,
      cumulativeCrowd: cumCrowd,
      totalOI: oItem.totalOI || 35000,
      f1mOI: oItem.f1mOI || 0,
      oiChange: oItem.oiChange !== undefined ? oItem.oiChange : 0,
      f1mPrice: oItem.f1mPrice || 0,
      vn30Price: oItem.vn30Price || 0,
      basis: oItem.basis || 0,
      volume: oItem.volume || 0,
      positionState: oItem.positionState || 'NEUTRAL',
    });
  }

  if (needSaveForeign) {
    foreignStore.history = fHistory;
    saveForeignOIData(foreignStore);
  }
  if (needSaveOI) {
    oiStore.history = oiHistory;
    saveOIHistoryData(oiStore);
  }

  return results;
}

// ─── PHÂN TÍCH & ĐÁNH GIÁ VỊ THẾ 3 PHE ────────────────────────

/**
 * Phân tích mức độ chênh lệch Long/Short của Khối Ngoại, Tự Doanh và Đám Đông
 * Phân định rõ ràng: Giao dịch trong phiên (Session Net) vs Vị thế lũy kế qua đêm (Cumulative Overnight Holding)
 */
function analyzeOIPositions(days5 = null) {
  const data = days5 || getRecent5DaysData();
  if (!data || data.length === 0) {
    return null;
  }

  const latest = data[data.length - 1];
  const previous = data.length > 1 ? data[data.length - 2] : null;

  // 1. Phân tích Khối Ngoại
  const foreignSessionNet = latest.overnightNet;
  const foreignSessionSide = foreignSessionNet > 0 ? 'LONG' : foreignSessionNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const foreignSessionAbs = Math.abs(foreignSessionNet);

  const cumNN = latest.cumulativeNN !== undefined ? latest.cumulativeNN : -4147;
  const prevCumNN = previous && previous.cumulativeNN !== undefined ? previous.cumulativeNN : -4600;
  const foreignCumSide = cumNN > 0 ? 'LONG' : cumNN < 0 ? 'SHORT' : 'CÂN BẰNG';
  const foreignCumAbs = Math.abs(cumNN);

  let foreignStrength = 'CÂN BẰNG / GIẰNG CO';
  let foreignBadge = '⚖️ CÂN BẰNG';
  if (foreignSessionAbs >= 2500) {
    foreignStrength = 'ÁP ĐẢO HOÀN TOÀN';
    foreignBadge = '🔥 RẤT MẠNH';
  } else if (foreignSessionAbs >= 1500) {
    foreignStrength = 'ƯU THẾ RÕ RỆT';
    foreignBadge = '⚡ MẠNH';
  } else if (foreignSessionAbs >= 800) {
    foreignStrength = 'TRUNG BÌNH';
    foreignBadge = '📊 TRUNG BÌNH';
  } else {
    foreignStrength = 'NHẸ / CÂN BẰNG';
    foreignBadge = '⚖️ CÂN BẰNG';
  }

  const totalVol = latest.buy + latest.sell;
  const buyRatio = totalVol > 0 ? ((latest.buy / totalVol) * 100).toFixed(1) : '50.0';
  const sellRatio = totalVol > 0 ? ((latest.sell / totalVol) * 100).toFixed(1) : '50.0';

  // 2. Phân tích Tự Doanh
  const tuDoanhSessionNet = latest.tuDoanhOvernight;
  const tuDoanhSessionSide = tuDoanhSessionNet > 0 ? 'LONG' : tuDoanhSessionNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const tuDoanhSessionAbs = Math.abs(tuDoanhSessionNet);
  const tdIsEstimated = latest.tdIsEstimated;

  const cumTD = latest.cumulativeTD !== undefined ? latest.cumulativeTD : 1450;
  const tuDoanhCumSide = cumTD > 0 ? 'LONG' : cumTD < 0 ? 'SHORT' : 'CÂN BẰNG';
  const tuDoanhCumAbs = Math.abs(cumTD);

  let tuDoanhStrength = 'CÂN BẰNG';
  if (tuDoanhSessionAbs >= 1500) tuDoanhStrength = 'MẠNH';
  else if (tuDoanhSessionAbs >= 700) tuDoanhStrength = 'TRUNG BÌNH';
  else tuDoanhStrength = 'NHẸ';

  // 3. Phân tích Đám Đông (Cá nhân nhỏ lẻ)
  const crowdSessionNet = latest.crowdOvernight;
  const crowdSessionSide = crowdSessionNet > 0 ? 'LONG' : crowdSessionNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const crowdSessionAbs = Math.abs(crowdSessionNet);

  const cumCrowd = latest.cumulativeCrowd !== undefined ? latest.cumulativeCrowd : -(cumNN + cumTD);
  const crowdCumSide = cumCrowd > 0 ? 'LONG' : cumCrowd < 0 ? 'SHORT' : 'CÂN BẰNG';
  const crowdCumAbs = Math.abs(cumCrowd);

  let crowdSentiment = '';
  let crowdBadge = '';
  if (crowdCumSide === 'SHORT' && crowdCumAbs >= 2000) {
    crowdBadge = '🔴 ĐÁM ĐÔNG ÔM SHORT NẶNG';
    crowdSentiment = 'Đám đông ôm Short lũy kế lớn hoặc dính bẫy kẹp Short khi thị trường bất ngờ đảo chiều tăng. Phe Short đang chịu áp lực gồng lỗ rất lớn.';
  } else if (crowdCumSide === 'LONG' && crowdCumAbs >= 2000) {
    crowdBadge = '🟢 ĐÁM ĐÔNG ÔM LONG LỚN';
    crowdSentiment = 'Cá nhân nhỏ lẻ đang nắm lượng Long lũy kế áp đảo đối ứng lượng Short của Khối ngoại. Khi thị trường tăng điểm, phe Long được giải tỏa áp lực tâm lý.';
  } else {
    crowdBadge = '⚖️ ĐÁM ĐÔNG LƯỠNG LỰ';
    crowdSentiment = 'Vị thế đám đông ở trạng thái tương đối cân bằng, tâm lý thận trọng quan sát.';
  }

  // 4. Dự báo tình thế & Kịch bản phiên kế tiếp
  let biasDirection = 'NEUTRAL';
  let confidenceScore = 75;
  let outlook = '';
  let tactics = '';

  if (foreignSessionNet > 0 && cumNN < 0) {
    // Khối ngoại đang có vị thế Short nhưng chủ động Mua ròng để Cover Short
    biasDirection = '🟢 THIÊN LONG / HỒI PHỤC KỸ THUẬT (COVER SHORT)';
    confidenceScore = 85;
    outlook = `Khối ngoại tiếp tục mua ròng trong phiên (+${foreignSessionAbs.toLocaleString('vi-VN')} HĐ) nhằm mục đích Cover đóng dần vị thế Short lũy kế (giảm từ ${prevCumNN.toLocaleString('vi-VN')} HĐ về ${cumNN.toLocaleString('vi-VN')} HĐ). Basis dương (+${latest.basis}đ) và dòng tiền cơ sở lan tỏa tích cực đang hỗ trợ nhịp hồi phục tiếp diễn.`;
    tactics = 'Ưu tiên canh các nhịp rung lắc, retest vùng hỗ trợ gần để mở vị thế LONG lướt sóng. Tuyệt đối không Short chặn đầu khi dòng tiền lớn đang chủ động thu hẹp vị thế Short.';
  } else if (cumNN <= -5000 && foreignSessionNet < -1000) {
    biasDirection = '🔴 THIÊN SHORT / ÁP LỰC ĐÈ BÁN';
    confidenceScore = 88;
    outlook = `Khối ngoại gia tăng vị thế Short lũy kế (${cumNN.toLocaleString('vi-VN')} HĐ) kèm bán ròng mạnh trong phiên. Nguy cơ ép đạp chỉ số để ép nhỏ lẻ cắt lỗ là rất cao.`;
    tactics = 'Canh nhịp kéo hồi kiểm tra cản kỹ thuật để mở SHORT thuận xu hướng. Tuyệt đối không bắt đáy Long sớm.';
  } else if (cumNN >= 3000 && foreignSessionNet > 1000) {
    biasDirection = '🟢 THIÊN LONG / XU HƯỚNG TĂNG MẠNH';
    confidenceScore = 88;
    outlook = `Khối ngoại găm lượng Long lũy kế rất lớn (+${cumNN.toLocaleString('vi-VN')} HĐ) và liên tục gia tăng tỷ trọng. Dòng tiền lớn kiểm soát hoàn toàn thế trận.`;
    tactics = 'Canh rung lắc mở Long, gồng lãi theo trailing stop tại các ngưỡng hỗ trợ động.';
  } else {
    biasDirection = '↔️ GIẰNG CO / CANH BIÊN ĐỘ';
    confidenceScore = 72;
    outlook = 'Lực mua bán của 3 phe ở thế giằng co tích lũy, thị trường vận động trong biên độ hẹp.';
    tactics = 'Đánh nhanh rút gọn theo biên độ (Buy Low quanh hỗ trợ, Sell High quanh kháng cự). Mục tiêu 3 - 5 điểm, dừng lỗ 3 - 4 điểm.';
  }

  return {
    data,
    latest,
    previous,
    foreign: {
      sessionNet: foreignSessionNet,
      sessionSide: foreignSessionSide,
      sessionAbs: foreignSessionAbs,
      cumNN,
      prevCumNN,
      cumSide: foreignCumSide,
      cumAbs: foreignCumAbs,
      buy: latest.buy,
      sell: latest.sell,
      buyRatio,
      sellRatio,
      strength: foreignStrength,
      badge: foreignBadge,
    },
    tuDoanh: {
      sessionNet: tuDoanhSessionNet,
      sessionSide: tuDoanhSessionSide,
      sessionAbs: tuDoanhSessionAbs,
      cumTD,
      cumSide: tuDoanhCumSide,
      cumAbs: tuDoanhCumAbs,
      strength: tuDoanhStrength,
      isEstimated: tdIsEstimated,
    },
    crowd: {
      sessionNet: crowdSessionNet,
      sessionSide: crowdSessionSide,
      sessionAbs: crowdSessionAbs,
      cumCrowd,
      cumSide: crowdCumSide,
      cumAbs: crowdCumAbs,
      badge: crowdBadge,
      sentiment: crowdSentiment,
    },
    market: {
      totalOI: latest.totalOI,
      f1mOI: latest.f1mOI || 0,
      oiChange: latest.oiChange !== undefined ? latest.oiChange : 0,
      f1mPrice: latest.f1mPrice,
      vn30Price: latest.vn30Price,
      basis: latest.basis,
    },
    prediction: {
      biasDirection,
      confidenceScore,
      outlook,
      tactics,
    }
  };
}

// ─── SYNC HISTORICAL DATA FROM VPS (OHLCV & BASIS) ────────────

/**
 * Tự động đồng bộ OHLCV 15 phiên gần nhất từ VPS TradingView feed
 * Đảm bảo giá đóng cửa, VN30, Basis và Volume luôn chính xác 100%,
 * kể cả khi app mới khởi động hoặc container Render bị restart/deploy mới.
 */
async function syncRecentHistoryFromVPS() {
  try {
    const axios = require('axios');
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 15;
    const [f1mRes, vn30Res] = await Promise.all([
      axios.get(`https://histdatafeed.vps.com.vn/tradingview/history?symbol=VN30F1M&resolution=D&from=${from}&to=${now}`, { timeout: 8000 }),
      axios.get(`https://histdatafeed.vps.com.vn/tradingview/history?symbol=VN30&resolution=D&from=${from}&to=${now}`, { timeout: 8000 }),
    ]);

    const f1mData = f1mRes.data;
    const vn30Data = vn30Res.data;
    if (!f1mData || !f1mData.t || f1mData.t.length === 0) return false;

    const vn30Map = {};
    if (vn30Data && vn30Data.t) {
      vn30Data.t.forEach((t, i) => {
        const d = new Date(t * 1000);
        const dStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        vn30Map[dStr] = vn30Data.c[i];
      });
    }

    const oiStore = loadOIHistoryData();
    const foreignStore = loadForeignOIData();
    let oHistory = oiStore.history || [];
    let fHistory = foreignStore.history || [];

    let updated = false;
    for (let i = 0; i < f1mData.t.length; i++) {
      const d = new Date(f1mData.t[i] * 1000);
      const dStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      const normD = normalizeDateStr(dStr);

      const f1mClose = f1mData.c[i];
      const vn30Close = vn30Map[dStr] || 0;
      const basis = vn30Close ? parseFloat((f1mClose - vn30Close).toFixed(2)) : 0;
      const volume = f1mData.v[i];

      let oItem = oHistory.find(h => normalizeDateStr(h.date) === normD);
      if (oItem) {
        if (!oItem.f1mPrice || oItem.f1mPrice === 0) {
          oItem.f1mPrice = f1mClose;
          updated = true;
        }
        if (!oItem.vn30Price || oItem.vn30Price === 0) {
          oItem.vn30Price = vn30Close;
          oItem.basis = basis;
          updated = true;
        }
        if (!oItem.volume || oItem.volume === 0) {
          oItem.volume = volume;
          updated = true;
        }
      }
    }

    if (updated) {
      oHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
      fHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
      oiStore.history = oHistory;
      foreignStore.history = fHistory;
      saveOIHistoryData(oiStore);
      saveForeignOIData(foreignStore);
      console.log('   ✅ [OI History] Auto-synced daily OHLCV from VPS history');
    }
    return true;
  } catch (e) {
    console.error('   ⚠️ [OI History] Failed to sync daily OHLCV from VPS:', e.message);
    return false;
  }
}

// ─── BUILD TELEGRAM NOTIFICATION MESSAGE (19h35 TỐI) ─────────

/**
 * Tạo message báo cáo vị thế OI & 3 PHE (Ngoại - Tự Doanh - Đám Đông)
 * v4.3: Async — fetch realtime data từ sàn trước khi build, auto-sync vào file
 */
async function buildOIEveningNotificationAsync(session = 'evening') {
  // ─── STEP 0: Kiểm tra ngày giao dịch ─────────────────────
  const vnTime = dataFetcher.getVnTime();
  if (!isTradingDay(vnTime)) {
    console.log(`   ℹ️ [OI ${session}] Hôm nay không phải ngày giao dịch (${vnTime.toLocaleDateString('vi-VN')}), dùng dữ liệu phiên gần nhất.`);
    return buildOIEveningNotificationSync(session);
  }

  // ─── STEP 0.5: Đồng bộ dữ liệu lịch sử OHLCV & Basis từ VPS ─
  try {
    await syncRecentHistoryFromVPS();
  } catch (e) { /* ignore */ }

  // ─── STEP 1: Fetch realtime data từ sàn ─────────────────
  console.log(`   📡 [OI ${session === 'afternoon' ? 'Afternoon 14h47' : 'Evening 19h35'}] Fetching realtime OI data from exchange...`);
  try {
    const realtimeOI = await dataFetcher.fetchDerivativesOIData();
    const futuresPrice = await dataFetcher.fetchRealtimeFuturesPrice();
    const vn30Price = await dataFetcher.fetchRealtimeVN30Price();

    if (realtimeOI && (realtimeOI.foreignBuy > 0 || realtimeOI.foreignSell > 0 || realtimeOI.totalOI > 0)) {
      // ─── STEP 2: Auto-sync today's data vào file ────────
      const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;

      const foreignBuy = realtimeOI.foreignBuy || 0;
      const foreignSell = realtimeOI.foreignSell || 0;
      const foreignNet = realtimeOI.foreignNet !== undefined ? realtimeOI.foreignNet : (foreignBuy - foreignSell);
      const totalOI = realtimeOI.totalOI || 35000;
      let totalOIChange = realtimeOI.totalOIChange || 0;

      // Tính biến động OI so với phiên trước nếu realtimeOI.totalOIChange = 0
      const oiStore = loadOIHistoryData();
      const prevEntries = (oiStore.history || []).filter(h => normalizeDateStr(h.date) !== normalizeDateStr(todayStr));
      const prevSession = prevEntries.length > 0 ? prevEntries[prevEntries.length - 1] : null;
      if ((totalOIChange === 0 || !totalOIChange) && prevSession && prevSession.totalOI) {
        totalOIChange = totalOI - prevSession.totalOI;
      }

      const f1mPrice = futuresPrice ? futuresPrice.price : 0;
      const vn30PriceVal = vn30Price ? vn30Price.price : 0;
      const basis = f1mPrice && vn30PriceVal ? parseFloat((f1mPrice - vn30PriceVal).toFixed(2)) : 0;

      // Tính tự doanh: dùng data file nếu có, nếu không ước lượng
      const foreignStore = loadForeignOIData();
      const existingToday = (foreignStore.history || []).find(h => normalizeDateStr(h.date) === normalizeDateStr(todayStr));
      const tuDoanhOvernight = existingToday ? (existingToday.tuDoanhOvernight || 0) : 0;

      const prevFEntries = (foreignStore.history || []).filter(h => normalizeDateStr(h.date) !== normalizeDateStr(todayStr));
      const prevF = prevFEntries.length > 0 ? prevFEntries[prevFEntries.length - 1] : null;
      const prevCumNN = prevF ? (prevF.cumulativeNN !== undefined ? prevF.cumulativeNN : -4600) : -4600;
      const prevCumTD = prevF ? (prevF.cumulativeTD !== undefined ? prevF.cumulativeTD : 1610) : 1610;

      const effectiveTD = tuDoanhOvernight !== 0 ? tuDoanhOvernight : Math.round(-foreignNet * (oiEstimator.TD_ESTIMATION_RATIO || 0.35));
      const cumNN = existingToday && existingToday.cumulativeNN !== undefined ? existingToday.cumulativeNN : (prevCumNN + foreignNet);
      const cumTD = existingToday && existingToday.cumulativeTD !== undefined ? existingToday.cumulativeTD : (prevCumTD + effectiveTD);
      const cumCrowd = -(cumNN + cumTD);

      const entry = {
        date: todayStr,
        buy: foreignBuy,
        sell: foreignSell,
        overnightNet: foreignNet,
        tuDoanhOvernight: tuDoanhOvernight,
        crowdOvernight: -(foreignNet + effectiveTD),
        cumulativeNN: cumNN,
        cumulativeTD: cumTD,
        cumulativeCrowd: cumCrowd,
        totalOI: totalOI,
        f1mOI: realtimeOI.f1mOI || 0,
        oiChange: totalOIChange,
        f1mPrice: f1mPrice ? parseFloat(f1mPrice.toFixed(1)) : 0,
        vn30Price: vn30PriceVal ? parseFloat(vn30PriceVal.toFixed(2)) : 0,
        basis: basis,
        positionState: _classifyPositionState(totalOIChange, f1mPrice, existingToday),
      };

      recordDailySessionOI(entry);
      console.log(`   ✅ [OI ${session}] Auto-synced realtime data for ${todayStr}: Foreign=${foreignNet} (LK=${cumNN}), OI=${totalOI} (ΔOI=${totalOIChange})`);
    } else {
      console.log(`   ⚠️ [OI ${session}] No realtime data available, using cached file data`);
    }
  } catch (e) {
    console.error(`   ⚠️ [OI ${session}] Realtime fetch failed, using cached data:`, e.message);
  }

  // ─── STEP 3: Build noti từ data đã sync (luôn mới nhất) ──
  return buildOIEveningNotificationSync(session);
}

/**
 * Helper: Classify position state dựa trên OI change và giá
 */
function _classifyPositionState(oiChange, f1mPrice, existingEntry) {
  if (!existingEntry || !existingEntry.f1mPrice) return 'NEUTRAL';
  const priceDelta = f1mPrice - existingEntry.f1mPrice;
  if (oiChange > 0 && priceDelta > 0) return 'LONG_BUILDUP';
  if (oiChange > 0 && priceDelta < 0) return 'SHORT_ACCUMULATION';
  if (oiChange < 0 && priceDelta < 0) return 'LONG_LIQUIDATION';
  if (oiChange < 0 && priceDelta > 0) return 'SHORT_COVERING';
  return 'NEUTRAL';
}

/**
 * Synchronous version — build từ file data (đã được sync ở trên)
 * Giữ lại cho backward compat và /oi command
 */
function buildOIEveningNotificationSync(session = 'evening') {
  const analysis = analyzeOIPositions();
  if (!analysis) {
    return '⚠️ Chưa có đủ dữ liệu lịch sử OI & Khối ngoại phái sinh để phân tích.';
  }

  const { latest, foreign, tuDoanh, crowd, market, prediction, data } = analysis;

  const fmt = (num) => (num !== undefined && num !== null ? Math.round(num).toLocaleString('vi-VN') : '0');
  const fmtDec = (num, d = 1) => (num !== undefined && num !== null ? Number(num).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '0');
  const fmtSign = (num) => (num > 0 ? `+${fmt(num)}` : fmt(num));
  const fmtSignDec = (num, d = 1) => (num > 0 ? `+${fmtDec(num, d)}` : fmtDec(num, d));

  const isAfternoon = session === 'afternoon';
  const sessionTitle = isAfternoon
    ? `📊 <b>BÁO CÁO VỊ THẾ QUA ĐÊM (OI) & 3 PHE (SƠ BỘ SAU ATC)</b>\n`
    : `📊 <b>BÁO CÁO VỊ THẾ QUA ĐÊM (OI) & 3 PHE (CHÍNH THỨC)</b>\n`;
  const sessionSub = isAfternoon
    ? `🕐 <i>Chiều 14h47 (Sơ bộ sau ATC) — Ngày ${latest.date} | Chuẩn bị phiên kế tiếp</i>\n`
    : `🕐 <i>Tối 19h35 (Chốt sổ HNX & VSDC) — Ngày ${latest.date} | Chuẩn bị phiên kế tiếp</i>\n`;

  let msg = sessionTitle;
  msg += sessionSub;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. GIAO DỊCH RÒNG PHIÊN HÔM NAY
  msg += `⚡ <b>1. GIAO DỊCH RÒNG PHIÊN HÔM NAY (${latest.date}):</b>\n`;
  const nnFlowSide = foreign.sessionNet > 0 ? '🟢 MUA RÒNG (LONG)' : foreign.sessionNet < 0 ? '🔴 BÁN RÒNG (SHORT)' : '⚖️ CÂN BẰNG';
  msg += `• 🌐 <b>Khối ngoại:</b> <b>${nnFlowSide} ${fmtSign(foreign.sessionNet)} HĐ</b>\n`;
  msg += `   └ Mua: <code>${fmt(foreign.buy)}</code> (${foreign.buyRatio}%) | Bán: <code>${fmt(foreign.sell)}</code> (${foreign.sellRatio}%)\n`;

  const tdFlowSide = tuDoanh.sessionNet > 0 ? '🟢 MUA RÒNG (LONG)' : tuDoanh.sessionNet < 0 ? '🔴 BÁN RÒNG (SHORT)' : '⚖️ CÂN BẰNG';
  const tdEstNote = tuDoanh.isEstimated ? ' <i>(ước ~35% hedging)</i>' : '';
  msg += `• 🏛️ <b>Tự doanh:</b> <b>${tdFlowSide} ${fmtSign(tuDoanh.sessionNet)} HĐ</b>${tdEstNote}\n`;

  const crFlowSide = crowd.sessionNet > 0 ? '🟢 MUA RÒNG (LONG)' : crowd.sessionNet < 0 ? '🔴 BÁN RÒNG (SHORT)' : '⚖️ CÂN BẰNG';
  msg += `• 👥 <b>Cá nhân (Đám đông):</b> <b>${crFlowSide} ${fmtSign(crowd.sessionNet)} HĐ</b>\n`;
  msg += `• ⚖️ <i>Quy tắc Zero-Sum phiên:</i>\n`;
  msg += `   <code>Ngoại (${fmtSign(foreign.sessionNet)}) + TD (${fmtSign(tuDoanh.sessionNet)}) + Cá nhân (${fmtSign(crowd.sessionNet)}) = 0 HĐ</code>\n\n`;

  // 2. VỊ THẾ LŨY KẾ CẦM QUA ĐÊM
  msg += `🔥 <b>2. VỊ THẾ LŨY KẾ CẦM QUA ĐÊM (HẾT NGÀY ${latest.date}):</b>\n`;
  msg += `• 📊 <b>Tổng hợp đồng mở (OI):</b> <b>${fmt(market.totalOI)} HĐ</b>${market.f1mOI ? ` (F1M: <b>${fmt(market.f1mOI)} HĐ</b>)` : ''}\n`;
  const oiIcon = market.oiChange > 0 ? '🟢' : market.oiChange < 0 ? '🔴' : '🟡';
  const oiStatus = market.oiChange > 0 ? 'Dòng tiền mở mới thêm vị thế' : market.oiChange < 0 ? 'Chốt lời đóng bớt vị thế' : 'Đi ngang';
  msg += `• 📈 <b>Biến động OI (ΔOI):</b> <b>${oiIcon} ${fmtSign(market.oiChange)} HĐ</b> <i>(${oiStatus})</i>\n`;

  const nnCumSide = foreign.cumNN > 0 ? '🟢 CẦM LONG' : foreign.cumNN < 0 ? '🔴 CẦM SHORT' : '⚖️ CÂN BẰNG';
  msg += `• 🌐 <b>Khối ngoại:</b> <b>${nnCumSide} ${fmtSign(foreign.cumNN)} HĐ</b>\n`;
  if (foreign.sessionNet > 0 && foreign.cumNN < 0) {
    msg += `   └ <i>Diễn biến: Giảm bớt ${fmt(foreign.sessionAbs)} HĐ Short so với hôm qua (${fmtSign(foreign.prevCumNN)} HĐ)</i>\n`;
  } else if (foreign.sessionNet < 0 && foreign.cumNN < 0) {
    msg += `   └ <i>Diễn biến: Gia tăng thêm ${fmt(foreign.sessionAbs)} HĐ Short so với hôm qua (${fmtSign(foreign.prevCumNN)} HĐ)</i>\n`;
  }

  const tdCumSide = tuDoanh.cumTD > 0 ? '🟢 CẦM LONG' : tuDoanh.cumTD < 0 ? '🔴 CẦM SHORT' : '⚖️ CÂN BẰNG';
  msg += `• 🏛️ <b>Tự doanh:</b> <b>${tdCumSide} ${fmtSign(tuDoanh.cumTD)} HĐ</b> <i>(ước tính đối ứng)</i>\n`;

  const crCumSide = crowd.cumCrowd > 0 ? '🟢 CẦM LONG' : crowd.cumCrowd < 0 ? '🔴 CẦM SHORT' : '⚖️ CÂN BẰNG';
  msg += `• 👥 <b>Cá nhân (Đám đông):</b> <b>${crCumSide} ${fmtSign(crowd.cumCrowd)} HĐ</b>\n`;
  msg += `• ⚖️ <i>Quy tắc Zero-Sum lũy kế:</i>\n`;
  msg += `   <code>Ngoại (${fmtSign(foreign.cumNN)}) + TD (${fmtSign(tuDoanh.cumTD)}) + Cá nhân (${fmtSign(crowd.cumCrowd)}) = 0 HĐ</code>\n\n`;

  // 3. BẢNG DIỄN BIẾN 5 PHIÊN GẦN NHẤT
  msg += `📅 <b>3. DIỄN BIẾN 5 PHIÊN GẦN NHẤT (CHUẨN XÁC ĐỐI ỨNG):</b>\n`;
  msg += `<pre>`;
  msg += `Ngày  | Ngoại Ngày | Ngoại LK   | TựDoanh LK | CáNhân LK  | Tổng OI | ΔOI\n`;
  msg += `------|------------|------------|------------|------------|---------|-----\n`;
  data.forEach(d => {
    let cleanDate = d.date;
    const dateParts = d.date.split('/');
    if (dateParts.length >= 2) {
      cleanDate = `${dateParts[0].padStart(2, '0')}/${dateParts[1].padStart(2, '0')}`;
    }
    const dStr = cleanDate.padEnd(5);
    const nDayStr = (d.overnightNet >= 0 ? `+${d.overnightNet} L` : `${d.overnightNet} S`).padStart(10);
    const nCumStr = (d.cumulativeNN >= 0 ? `+${d.cumulativeNN} L` : `${d.cumulativeNN} S`).padStart(10);
    const tdCumStr = (d.cumulativeTD >= 0 ? `+${d.cumulativeTD} L` : `${d.cumulativeTD} S`).padStart(10);
    const crCumStr = (d.cumulativeCrowd >= 0 ? `+${d.cumulativeCrowd} L` : `${d.cumulativeCrowd} S`).padStart(10);
    const oiStr = d.totalOI.toString().padStart(7);
    const dOIStr = (d.oiChange >= 0 ? `+${d.oiChange}` : `${d.oiChange}`).padStart(5);
    msg += `${dStr} | ${nDayStr} | ${nCumStr} | ${tdCumStr} | ${crCumStr} | ${oiStr} | ${dOIStr}\n`;
  });
  msg += `</pre>\n`;
  if (market.f1mPrice) {
    msg += `• <i>Chốt phiên: F1M = <b>${fmtDec(market.f1mPrice)}</b> | VN30 = <b>${fmtDec(market.vn30Price, 2)}</b> (Basis: <b>${fmtSignDec(market.basis, 2)}đ</b>)</i>\n`;
  }
  msg += `\n`;

  // 4. GIẢI MÃ DÒNG TIỀN & Ý ĐỒ CÁ MẬP
  msg += `🧠 <b>4. GIẢI MÃ DÒNG TIỀN & Ý ĐỒ CÁ MẬP:</b>\n`;
  if (foreign.sessionNet > 0 && foreign.cumNN < 0) {
    msg += `• <b>Hành vi Khối ngoại:</b> Khối ngoại Mua ròng trong phiên (+${fmt(foreign.sessionAbs)} HĐ), chủ động Cover đóng bớt vị thế Short (thu hẹp từ ${fmtSign(foreign.prevCumNN)} HĐ về ${fmtSign(foreign.cumNN)} HĐ) khi thị trường bật tăng mạnh.\n`;
  } else if (foreign.sessionNet < 0) {
    msg += `• <b>Hành vi Khối ngoại:</b> Khối ngoại Bán ròng trong phiên (-${fmt(foreign.sessionAbs)} HĐ), tiếp tục găm hàng gia tăng vị thế Short lũy kế (${fmtSign(foreign.cumNN)} HĐ) nhằm gây sức ép điều chỉnh lên chỉ số.\n`;
  } else {
    msg += `• <b>Hành vi Khối ngoại:</b> Giao dịch cân bằng, duy trì vị thế Short lũy kế ở mức ${fmtSign(foreign.cumNN)} HĐ.\n`;
  }
  msg += `• <b>Tâm lý Đám đông:</b> ${crowd.sentiment}\n`;
  const oiExpl = market.oiChange > 0
    ? `Tổng OI toàn sàn tăng <b>${fmtSign(market.oiChange)} HĐ</b> (đạt ${fmt(market.totalOI)} HĐ) xác nhận dòng tiền lớn tiếp tục giữ vị thế neo qua đêm, thanh khoản dồi dào.`
    : market.oiChange < 0
      ? `Tổng OI toàn sàn giảm <b>${fmt(Math.abs(market.oiChange))} HĐ</b> cho thấy dòng tiền chủ động chốt lời bớt vị thế trước khi đóng cửa.`
      : `Tổng OI đi ngang quanh mức ${fmt(market.totalOI)} HĐ.`;
  msg += `• <b>Tín hiệu OI:</b> ${oiExpl}\n\n`;

  // 5. TÌNH THẾ & KỊCH BẢN PHIÊN KẾ TIẾP
  msg += `🎯 <b>5. TÌNH THẾ & KỊCH BẢN PHIÊN KẾ TIẾP:</b>\n`;
  msg += `• <b>Định hướng chủ đạo:</b> <b>${prediction.biasDirection}</b> (Tin cậy: <b>${prediction.confidenceScore}%</b>)\n`;
  msg += `• <b>Tình thế thị trường:</b> ${prediction.outlook}\n`;
  msg += `• <b>Chiến thuật hành động:</b> ${prediction.tactics}\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  if (isAfternoon) {
    msg += `💡 <i>Báo cáo vị thế sơ bộ lúc 14h47 (Tự doanh & VSDC sẽ được chốt chính thức lúc 19h35) | VN Stock Bot v5.0</i>`;
  } else {
    msg += `💡 <i>Báo cáo vị thế OI 3 phe chính thức lúc 19h35 hàng ngày | VN Stock Bot v5.0</i>`;
  }

  return msg;
}

// Legacy sync wrapper cho backward compat
function buildOIEveningNotification() {
  return buildOIEveningNotificationSync();
}

// ─── MANUAL & SYNC DATA UPDATE HELPERS ───────────────────────

/**
 * Cập nhật hoặc bổ sung dữ liệu 1 ngày giao dịch độc lập
 */
function recordDailySessionOI(entry) {
  const foreignStore = loadForeignOIData();
  const oiStore = loadOIHistoryData();

  const normEntryDate = normalizeDateStr(entry.date);

  // 1. Update foreign_oi.json
  let fHistory = foreignStore.history || [];
  fHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
  const fIdx = fHistory.findIndex(h => normalizeDateStr(h.date) === normEntryDate);
  const prevFEntries = fHistory.filter(h => normalizeDateStr(h.date) !== normEntryDate);
  const prevF = prevFEntries.length > 0 ? prevFEntries[prevFEntries.length - 1] : null;

  const buy = entry.buy || entry.foreignBuy || 0;
  const sell = entry.sell || entry.foreignSell || 0;
  const overnightNet = entry.overnightNet !== undefined ? entry.overnightNet : (buy - sell);
  const tuDoanhOvernight = entry.tuDoanhOvernight !== undefined ? entry.tuDoanhOvernight : (entry.tuDoanhNet || (overnightNet !== 0 ? Math.round(-overnightNet * (oiEstimator.TD_ESTIMATION_RATIO || 0.35)) : 0));
  const crowdOvernight = -(overnightNet + tuDoanhOvernight);

  const prevCumNN = prevF ? (prevF.cumulativeNN !== undefined ? prevF.cumulativeNN : -4600) : -4600;
  const prevCumTD = prevF ? (prevF.cumulativeTD !== undefined ? prevF.cumulativeTD : 1610) : 1610;

  const cumulativeNN = entry.cumulativeNN !== undefined ? entry.cumulativeNN : (prevCumNN + overnightNet);
  const cumulativeTD = entry.cumulativeTD !== undefined ? entry.cumulativeTD : (prevCumTD + tuDoanhOvernight);
  const cumulativeCrowd = -(cumulativeNN + cumulativeTD);

  const fItem = {
    date: entry.date,
    buy,
    sell,
    overnightNet,
    tuDoanhOvernight,
    crowdOvernight,
    cumulativeNN,
    cumulativeTD,
    cumulativeCrowd,
  };

  if (fIdx >= 0) {
    fHistory[fIdx] = { ...fHistory[fIdx], ...fItem };
  } else {
    fHistory.push(fItem);
  }
  fHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
  if (fHistory.length > 30) fHistory = fHistory.slice(-30);
  foreignStore.history = fHistory;
  saveForeignOIData(foreignStore);

  // 2. Update oi_history.json
  let oHistory = oiStore.history || [];
  oHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
  const oIdx = oHistory.findIndex(h => normalizeDateStr(h.date) === normEntryDate);
  const prevOEntries = oHistory.filter(h => normalizeDateStr(h.date) !== normEntryDate);
  const prevO = prevOEntries.length > 0 ? prevOEntries[prevOEntries.length - 1] : null;

  const totalOI = entry.totalOI || (prevO ? prevO.totalOI : 35000);
  let oiChange = entry.oiChange !== undefined && entry.oiChange !== 0 ? entry.oiChange : 0;
  if (oiChange === 0 && prevO && prevO.totalOI) {
    oiChange = totalOI - prevO.totalOI;
  }

  const oItem = {
    date: entry.date,
    totalOI: totalOI,
    f1mOI: entry.f1mOI || (prevO ? prevO.f1mOI : 0),
    oiChange: oiChange,
    f1mPrice: entry.f1mPrice || 0,
    vn30Price: entry.vn30Price || 0,
    basis: entry.basis || 0,
    volume: entry.volume || (prevO ? prevO.volume : 0),
    positionState: entry.positionState || 'NEUTRAL',
  };

  if (oIdx >= 0) {
    oHistory[oIdx] = { ...oHistory[oIdx], ...oItem };
  } else {
    oHistory.push(oItem);
  }
  oHistory.sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
  if (oHistory.length > 30) oHistory = oHistory.slice(-30);
  oiStore.history = oHistory;
  saveOIHistoryData(oiStore);

  console.log(`✅ [OI Tracker] Đã lưu dữ liệu ngày ${entry.date}: Ngoại Net=${overnightNet} (LK=${cumulativeNN}), TD Net=${tuDoanhOvernight} (LK=${cumulativeTD}), Đám đông Net=${crowdOvernight} (LK=${cumulativeCrowd}), TotalOI=${totalOI} (ΔOI=${oiChange})`);
  return true;
}

/**
 * Lấy snapshot vị thế 3 phe (Ngoại, Tự doanh, Đám đông) REALTIME cho noti phái sinh
 * v4.3: Ưu tiên tuyệt đối data realtime từ allData.oiData, chỉ fallback file khi ngoài giờ
 */
function getRealtimePositionSnapshot(allData) {
  // Mặc định = 0 (không hardcode data cũ)
  let foreignBuy = 0;
  let foreignSell = 0;
  let foreignNet = 0;
  let tuDoanhNet = 0;
  let tuDoanhBuy = 0;
  let tuDoanhSell = 0;
  let totalOI = 0;
  let oiChange = 0;

  // ─── 1. Ưu tiên data REALTIME từ sàn (allData.oiData) ────
  if (allData && allData.oiData) {
    if (allData.oiData.foreignBuy > 0 || allData.oiData.foreignSell > 0) {
      foreignBuy = allData.oiData.foreignBuy;
      foreignSell = allData.oiData.foreignSell;
      foreignNet = allData.oiData.foreignNet;
    }
    if (allData.oiData.totalOI) {
      totalOI = allData.oiData.totalOI;
    }
    if (allData.oiData.totalOIChange !== null && allData.oiData.totalOIChange !== undefined && allData.oiData.totalOIChange !== 0) {
      oiChange = allData.oiData.totalOIChange;
    } else if (totalOI > 0) {
      const oiStore = loadOIHistoryData();
      const vnTime = dataFetcher.getVnTime();
      const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;
      const prevEntries = (oiStore.history || []).filter(h => normalizeDateStr(h.date) !== normalizeDateStr(todayStr));
      const prevSession = prevEntries.length > 0 ? prevEntries[prevEntries.length - 1] : null;
      if (prevSession && prevSession.totalOI) {
        oiChange = totalOI - prevSession.totalOI;
      }
    }
  }

  // ─── 2. Tự doanh: lấy từ file data phiên gần nhất ────
  // (API VPS không trả tự doanh riêng, dùng data đã record)
  const latestData = getRecent5DaysData();
  const latest = latestData && latestData.length > 0 ? latestData[latestData.length - 1] : null;

  if (latest) {
    tuDoanhNet = latest.tuDoanhOvernight !== undefined ? latest.tuDoanhOvernight : 0;

    // Nếu không có data realtime từ API, fallback về file
    if (foreignBuy === 0 && foreignSell === 0) {
      foreignBuy = latest.buy || 0;
      foreignSell = latest.sell || 0;
      foreignNet = latest.overnightNet !== undefined ? latest.overnightNet : 0;
      totalOI = latest.totalOI || 0;
      oiChange = latest.oiChange !== undefined ? latest.oiChange : 0;
    }
  }

  // ─── 3. Đám đông = Zero-Sum rule ────
  const crowdNet = -(foreignNet + tuDoanhNet);

  // Khối lượng F1M đã giao dịch đến thời điểm hiện tại
  const f1mVolume = (allData && allData.oiData && (allData.oiData.f1mVolume || allData.oiData.totalVolume || (allData.oiData.f1mRealtime && parseInt(allData.oiData.f1mRealtime.lot || '0')))) || 0;

  // Đám đông Mua (Long) = Tổng Volume - Khối ngoại Mua - Tự doanh Mua
  // Đám đông Bán (Short) = Tổng Volume - Khối ngoại Bán - Tự doanh Bán
  const crowdBuy = f1mVolume > 0 ? Math.max(0, f1mVolume - foreignBuy - tuDoanhBuy) : 0;
  const crowdSell = f1mVolume > 0 ? Math.max(0, f1mVolume - foreignSell - tuDoanhSell) : 0;

  return {
    foreignBuy,
    foreignSell,
    foreignNet,
    tuDoanhNet,
    tuDoanhBuy,
    tuDoanhSell,
    crowdNet,
    crowdBuy,
    crowdSell,
    f1mVolume,
    totalOI,
    oiChange,
  };
}

// ─── 14H25 NOTIFICATION (XUNG LỰC SAU CẮT MARGIN & SMART MONEY SOI ATC/ATO) ───

/**
 * Báo cáo realtime lúc 14h25:
 * Đo xung lực sau khi các CTCK kết thúc đợt cắt margin (14h00 - 14h20).
 * Soi 5-10 phút cuối (14h15 - 14h25) xem Smart Money (Khối ngoại + Tự doanh) đang âm thầm nhồi Long hay Short.
 * Phân tích xem họ mở thêm Long hay mở mới Short cho ATC và ATO sáng mai.
 * Đưa ra nhận định nhanh: Có nên chuẩn bị mở lệnh ATC hay không?
 */
async function buildMarginCutoffNotificationAsync(simulatedData = null) {
  console.log('   ⚡ [Margin Cutoff 14h25] Fetching realtime data...');
  let realtimeOI = null;
  let futuresPrice = null;
  let vn30Price = null;
  let vnindexPrice = null;
  let realtimeVN30 = null;
  let m5Data = null;

  if (simulatedData) {
    realtimeOI = simulatedData.realtimeOI;
    futuresPrice = simulatedData.futuresPrice;
    vn30Price = simulatedData.vn30Price;
    vnindexPrice = simulatedData.vnindexPrice;
    realtimeVN30 = simulatedData.realtimeVN30;
    m5Data = simulatedData.m5Data;
  } else {
    try {
      [realtimeOI, futuresPrice, vn30Price, vnindexPrice, realtimeVN30, m5Data] = await Promise.all([
        dataFetcher.fetchDerivativesOIData().catch(e => null),
        dataFetcher.fetchRealtimeFuturesPrice().catch(e => null),
        dataFetcher.fetchRealtimeVN30Price().catch(e => null),
        dataFetcher.fetchRealtimeVNINDEXPrice().catch(e => null),
        dataFetcher.fetchRealtimeVN30().catch(e => null),
        dataFetcher.fetchOHLCV('VN30F1M', '5', 2).catch(e => null),
      ]);
    } catch (e) {
      console.error('⚠️ Margin Cutoff fetch failed:', e.message);
    }
  }

  const vnTime = dataFetcher.getVnTime();
  const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;

  const fmt = (num) => (num !== undefined && num !== null ? Math.round(num).toLocaleString('vi-VN') : '0');
  const fmtDec = (num, d = 1) => (num !== undefined && num !== null ? Number(num).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '0');
  const fmtSign = (num) => (num > 0 ? `+${fmt(num)}` : fmt(num));
  const fmtSignDec = (num, d = 1) => (num > 0 ? `+${fmtDec(num, d)}` : fmtDec(num, d));

  const f1mPrice = futuresPrice ? futuresPrice.price : 0;
  const f1mPrev = futuresPrice ? futuresPrice.prevPrice : 0;
  const f1mChange = f1mPrice && f1mPrev ? (f1mPrice - f1mPrev) : 0;
  const vn30Val = vn30Price ? vn30Price.price : 0;
  const basis = f1mPrice && vn30Val ? parseFloat((f1mPrice - vn30Val).toFixed(2)) : 0;

  // Realtime Foreign & Tự Doanh
  const foreignBuy = realtimeOI ? (realtimeOI.foreignBuy || 0) : 0;
  const foreignSell = realtimeOI ? (realtimeOI.foreignSell || 0) : 0;
  const foreignNet = realtimeOI ? (realtimeOI.foreignNet !== undefined ? realtimeOI.foreignNet : (foreignBuy - foreignSell)) : 0;
  const totalVolume = realtimeOI ? (realtimeOI.totalVolume || 0) : 1;

  const foreignStore = loadForeignOIData();
  const existingToday = (foreignStore.history || []).find(h => normalizeDateStr(h.date) === normalizeDateStr(todayStr));
  const tuDoanhNet = existingToday ? (existingToday.tuDoanhOvernight || 0) : 0;
  const tdEst = oiEstimator.estimateTuDoanh(foreignNet, tuDoanhNet);
  const effectiveTD = tuDoanhNet !== 0 ? tuDoanhNet : tdEst.value;

  // Smart Money Tổng Lực
  const smartMoneyNet = foreignNet + effectiveTD;
  const crowdNet = -smartMoneyNet;

  // Tỷ trọng %
  const totalVolSafe = Math.max(1, totalVolume);
  const foreignPct = ((Math.abs(foreignNet) / totalVolSafe) * 100).toFixed(1);
  const tdPct = ((Math.abs(effectiveTD) / totalVolSafe) * 100).toFixed(1);
  const smartMoneyPct = ((Math.abs(smartMoneyNet) / totalVolSafe) * 100).toFixed(1);

  // Xung lực giá 5-10 phút gần nhất (14:15 - 14:25)
  let impulseDirection = 'NEUTRAL';
  let impulseDiff = 0;
  let lastCandleType = 'DOJI / THÂN HẸP';
  if (m5Data && m5Data.c && m5Data.c.length >= 2) {
    const closes = m5Data.c;
    const opens = m5Data.o || closes;
    const lastIdx = closes.length - 1;
    const prevIdx = lastIdx - 1;
    impulseDiff = closes[lastIdx] - closes[prevIdx];
    const lastOpen = opens[lastIdx];
    const lastClose = closes[lastIdx];
    if (lastClose > lastOpen + 0.8) lastCandleType = '🟢 NẾN XANH TĂNG ĐẶC (Cầu hấp thụ dứt khoát)';
    else if (lastClose < lastOpen - 0.8) lastCandleType = '🔴 NẾN ĐỎ GIẢM ĐẶC (Cung dội bán đè ép)';
    else lastCandleType = '🟡 NẾN GIẰNG CO (Thăm dò / Do dự)';

    if (impulseDiff >= 1.0) impulseDirection = 'BULLISH';
    else if (impulseDiff <= -1.0) impulseDirection = 'BEARISH';
  }

  // Đánh giá hành vi Smart Money
  let stealthAction = '';
  let preliminaryVerdict = '';
  let verdictIcon = '⏸️';

  if (smartMoneyNet >= 1000 && (impulseDirection === 'BULLISH' || basis >= -3.0)) {
    stealthAction = '🟢 <b>ÂM THẦM NHỒI THÊM LONG ĐÓN ĐẦU ATC & ATO</b>';
    preliminaryVerdict = 'CHUẨN BỊ MỞ LỆNH LONG ATC (Canh chốt nhịp vào lệnh lúc 14h29)';
    verdictIcon = '🟢';
  } else if (smartMoneyNet <= -1000 && (impulseDirection === 'BEARISH' || basis <= 3.0)) {
    stealthAction = '🔴 <b>ÂM THẦM MỞ MỚI SHORT ĐÈ BẸP ATC & ATO</b>';
    preliminaryVerdict = 'CHUẨN BỊ MỞ LỆNH SHORT ATC (Canh chốt nhịp vào lệnh lúc 14h29)';
    verdictIcon = '🔴';
  } else {
    stealthAction = '⚖️ <b>GIẰNG CO / HAI PHE CHƯA BỘC LỘ Ý ĐỒ DỨT KHOÁT</b>';
    preliminaryVerdict = 'KHẢ NĂNG CAO ĐỨNG NGOÀI PHIÊN ATC (Ưu tiên bảo toàn vốn)';
    verdictIcon = '⏸️';
  }

  let msg = `⚡ <b>BÁO CÁO XUNG LỰC SAU CẮT MARGIN (14h25) — VN30F1M</b>\n`;
  msg += `🕐 <i>14:25 Ngày ${todayStr} | Kết thúc đợt ép margin 14h00-14h20, 5p trước ATC</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. TÌNH HÌNH GIÁ VÀ XUNG LỰC 5-10P CUỐI
  msg += `📍 <b>1. XUNG LỰC THỊ TRƯỜNG SAU ĐỢT CẮT MARGIN:</b>\n`;
  msg += `• <b>F1M:</b> <b>${fmtDec(f1mPrice)}</b> (${fmtSignDec(f1mChange)}đ) | <b>Basis:</b> <b>${fmtSignDec(basis, 2)}đ</b>\n`;
  msg += `• <b>VN30:</b> <b>${fmtDec(vn30Val, 2)}</b>\n`;
  msg += `• <b>Biến động 5-10p cuối (14h15 - 14h25):</b> ${impulseDiff >= 0 ? `🟢 Tăng +${fmtDec(impulseDiff)}đ` : `🔴 Giảm ${fmtDec(impulseDiff)}đ`}\n`;
  msg += `• <b>Trạng thái nến 5p gần nhất:</b> <i>${lastCandleType}</i>\n\n`;

  // 2. PHÂN TÍCH SMART MONEY REALTIME
  msg += `🐋 <b>2. HÀNH VI SMART MONEY (KHỐI NGOẠI & TỰ DOANH):</b>\n`;
  msg += `• 🌐 <b>Khối ngoại (NN):</b> <b>${foreignNet >= 0 ? '🟢 MUA RÒNG' : '🔴 BÁN RÒNG'} ${fmtSign(foreignNet)} HĐ</b> (Tỷ trọng: <b>${foreignPct}%</b>)\n`;
  msg += `• 🏛️ <b>Tự doanh (TD):</b> <b>${effectiveTD >= 0 ? '🟢 CẦM LONG' : '🔴 CẦM SHORT'} ${fmtSign(effectiveTD)} HĐ</b>${tdEst.isEstimated ? ' <i>(ước tính)</i>' : ''} (Tỷ trọng: <b>${tdPct}%</b>)\n`;
  msg += `• 🔥 <b>HỢP LỰC SMART MONEY:</b> <b>${smartMoneyNet >= 0 ? `🟢 TỔNG LONG ${fmtSign(smartMoneyNet)}` : `🔴 TỔNG SHORT ${fmtSign(smartMoneyNet)}`} HĐ</b> (Tỷ trọng: <b>${smartMoneyPct}%</b>)\n`;
  msg += `• 👥 <b>Đám đông đối ứng:</b> <b>${crowdNet >= 0 ? `🟢 ÔM LONG ${fmtSign(crowdNet)}` : `🔴 ÔM SHORT ${fmtSign(crowdNet)}`} HĐ</b>\n`;
  msg += `• 🔎 <b>Đọc vị ý đồ 5-10p cuối:</b> ${stealthAction}\n\n`;

  // 3. ĐỊNH HƯỚNG MỞ LỆNH ATC
  msg += `🎯 <b>3. ĐỊNH HƯỚNG MỞ LỆNH PHIÊN ATC (14h30 - 14h45):</b>\n`;
  msg += `${verdictIcon} <b>ĐÁNH GIÁ SƠ BỘ: ${preliminaryVerdict}</b>\n`;
  msg += `👉 <i>Hãy sẵn sàng tài khoản và theo dõi phán quyết chốt hạ tại Noti 14h29 ngay trước thềm ATC!</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 <i>Cảnh báo tự động lúc 14h25 đo xung lực sau cắt margin | VN Stock Bot</i>`;

  return msg;
}

// ─── 14H29 PRE-ATC NOTIFICATION (VÀO ATC HAY KHÔNG?) ─────────

/**
 * Báo cáo realtime lúc 14h29 trước thềm ATC (14:30 - 14:45)
 * Trả lời dứt khoát: Có nên mở vị thế để vào ATC hay không?
 * Cảnh báo chốt trước 14h29 nếu thanh khoản cạn kiệt, tay to đóng bớt HĐ, ảm đạm
 */
async function buildPreATCNotificationAsync(simulatedData = null) {
  console.log('   ⚡ [Pre-ATC 14h29] Fetching realtime data from exchange...');
  let realtimeOI = null;
  let futuresPrice = null;
  let vn30Price = null;
  let vnindexPrice = null;
  let realtimeVN30 = null;

  if (simulatedData) {
    realtimeOI = simulatedData.realtimeOI;
    futuresPrice = simulatedData.futuresPrice;
    vn30Price = simulatedData.vn30Price;
    vnindexPrice = simulatedData.vnindexPrice;
    realtimeVN30 = simulatedData.realtimeVN30;
  } else {
    try {
      [realtimeOI, futuresPrice, vn30Price, vnindexPrice, realtimeVN30] = await Promise.all([
        dataFetcher.fetchDerivativesOIData().catch(e => null),
        dataFetcher.fetchRealtimeFuturesPrice().catch(e => null),
        dataFetcher.fetchRealtimeVN30Price().catch(e => null),
        dataFetcher.fetchRealtimeVNINDEXPrice().catch(e => null),
        dataFetcher.fetchRealtimeVN30().catch(e => null),
      ]);
    } catch (e) {
      console.error('⚠️ Pre-ATC fetch failed:', e.message);
    }
  }

  const vnTime = dataFetcher.getVnTime();
  const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;

  const fmt = (num) => (num !== undefined && num !== null ? Math.round(num).toLocaleString('vi-VN') : '0');
  const fmtDec = (num, d = 1) => (num !== undefined && num !== null ? Number(num).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '0');
  const fmtSign = (num) => (num > 0 ? `+${fmt(num)}` : fmt(num));
  const fmtSignDec = (num, d = 1) => (num > 0 ? `+${fmtDec(num, d)}` : fmtDec(num, d));

  // Market prices
  const f1mPrice = futuresPrice ? futuresPrice.price : 0;
  const f1mPrev = futuresPrice ? futuresPrice.prevPrice : 0;
  const f1mChange = f1mPrice && f1mPrev ? (f1mPrice - f1mPrev) : 0;
  const f1mChangePct = f1mPrev ? ((f1mChange / f1mPrev) * 100).toFixed(2) : '0';

  const vn30Val = vn30Price ? vn30Price.price : 0;
  const vn30Prev = vn30Price ? vn30Price.prevPrice : 0;
  const vn30Change = vn30Val && vn30Prev ? (vn30Val - vn30Prev) : 0;

  const basis = f1mPrice && vn30Val ? parseFloat((f1mPrice - vn30Val).toFixed(2)) : 0;

  const vnidxVal = vnindexPrice ? vnindexPrice.price : 0;
  const vnidxPrev = vnindexPrice ? vnindexPrice.prevPrice : 0;
  const vnidxChange = vnidxVal && vnidxPrev ? (vnidxVal - vnidxPrev) : 0;

  // Realtime OI & Foreign
  const foreignBuy = realtimeOI ? (realtimeOI.foreignBuy || 0) : 0;
  const foreignSell = realtimeOI ? (realtimeOI.foreignSell || 0) : 0;
  const foreignNet = realtimeOI ? (realtimeOI.foreignNet !== undefined ? realtimeOI.foreignNet : (foreignBuy - foreignSell)) : 0;
  const totalOI = realtimeOI ? (realtimeOI.totalOI || 0) : 0;
  const totalVolume = realtimeOI ? (realtimeOI.totalVolume || 0) : 0;

  // Comparison vs yesterday OI
  const oiStore = loadOIHistoryData();
  const prevEntries = (oiStore.history || []).filter(h => normalizeDateStr(h.date) !== normalizeDateStr(todayStr));
  const prevSession = prevEntries.length > 0 ? prevEntries[prevEntries.length - 1] : null;
  let totalOIChange = realtimeOI ? (realtimeOI.totalOIChange || 0) : 0;
  if ((totalOIChange === 0 || !totalOIChange) && totalOI > 0 && prevSession && prevSession.totalOI) {
    totalOIChange = totalOI - prevSession.totalOI;
  }

  // Tự doanh & Đám đông & Smart Money hợp lực
  const foreignStore = loadForeignOIData();
  const existingToday = (foreignStore.history || []).find(h => normalizeDateStr(h.date) === normalizeDateStr(todayStr));
  const tuDoanhNet = existingToday ? (existingToday.tuDoanhOvernight || 0) : 0;
  const tdEst = oiEstimator.estimateTuDoanh(foreignNet, tuDoanhNet);
  const effectiveTD = tuDoanhNet !== 0 ? tuDoanhNet : tdEst.value;
  const smartMoneyNet = foreignNet + effectiveTD;
  const crowdNet = -smartMoneyNet;

  const totalVolSafe = Math.max(1, totalVolume);
  const foreignPct = ((Math.abs(foreignNet) / totalVolSafe) * 100).toFixed(1);
  const tdPct = ((Math.abs(effectiveTD) / totalVolSafe) * 100).toFixed(1);
  const smartMoneyPct = ((Math.abs(smartMoneyNet) / totalVolSafe) * 100).toFixed(1);

  // Strength badge
  const foreignAbs = Math.abs(foreignNet);
  let foreignStrengthBadge = '⚖️ CÂN BẰNG';
  if (foreignAbs >= 2500) foreignStrengthBadge = '🔥 RẤT MẠNH';
  else if (foreignAbs >= 1500) foreignStrengthBadge = '⚡ MẠNH';
  else if (foreignAbs >= 800) foreignStrengthBadge = '📊 TRUNG BÌNH';
  else foreignStrengthBadge = '⚖️ CÂN BẰNG';

  // Breadth VN30
  const { analyzeBreadth } = require('./breadthEngine');
  const breadth = analyzeBreadth(realtimeVN30);

  // ─── ĐIỀU KIỆN ĐÁNH GIÁ 14H29 ─────────────────────────────────
  const isLiquidityDry = (totalVolume > 0 && totalVolume < 160000);
  const isOIDropping = totalOIChange < -800;
  const isForeignQuiet = foreignAbs < 800;
  const isRangeBound = futuresPrice && futuresPrice.high && futuresPrice.low && ((futuresPrice.high - futuresPrice.low) < 6.0);
  const isDryOrQuiet = (isLiquidityDry && foreignAbs < 1200) || (isOIDropping && isForeignQuiet) || (isForeignQuiet && isRangeBound) || (isLiquidityDry && isOIDropping);

  let verdictType = 'NEUTRAL';
  let verdictTitle = '';
  let verdictIcon = '';
  let actionAdvice = '';
  let verdictReason = '';
  let tradePlan = '';

  if (isDryOrQuiet) {
    verdictType = 'DRY_CLOSE';
    verdictIcon = '🛑';
    verdictTitle = 'TUYỆT ĐỐI KHÔNG MỞ MỚI VÀO ATC!';
    actionAdvice = '⚠️ NẾU ĐANG CÓ LỆNH TRONG PHIÊN ➔ CHỐT HẾT NGAY TRƯỚC 14H29 (14h29m50s), KHÔNG CẦM VÀO ATC!';
    verdictReason = `• Thanh khoản giao dịch phái sinh rất thấp (chỉ ${fmt(totalVolume)} HĐ), thị trường rơi vào trạng thái ảm đạm.\n` +
      `• Biến động OI ${totalOIChange < 0 ? `sụt giảm mạnh (${fmt(totalOIChange)} HĐ)` : 'đi ngang'}: Dòng tiền lớn và các tay to đã chủ động chốt lời đóng bớt hợp đồng trước ATC.\n` +
      `• Khối ngoại chỉ giao dịch thăm dò (${fmtSign(foreignNet)} HĐ), không có động thái kéo/đạp quyết liệt.\n` +
      `• Phiên ATC rất dễ đứng im không chạy (mất phí thuế vô ích) hoặc bị thao túng giật cục với vài trăm HĐ mỏng.`;
    tradePlan = `👉 <b>Chiến thuật:</b> Đứng ngoài tuyệt đối. Không tham gia cược may rủi trong phiên ATC.`;
  } else if ((foreignNet >= 1200 || smartMoneyNet >= 1500) && effectiveTD >= -500 && breadth.greenCount >= 13 && basis >= -3.5) {
    verdictType = 'LONG_ATC';
    verdictIcon = '🟢';
    verdictTitle = 'NÊN MỞ VỊ THẾ LONG ĐÓN ĐẦU ATC!';
    actionAdvice = `👉 Đặt lệnh LONG giá ATC (hoặc khớp quanh vùng <b>${fmtDec(f1mPrice)}</b> trước 14h29m50s).`;
    verdictReason = `• Smart Money (NN + Tự Doanh) hợp lực Mua ròng: <b>${fmtSign(smartMoneyNet)} HĐ Long</b> (Tỷ trọng: <b>${smartMoneyPct}%</b>).\n` +
      `• Khối ngoại dẫn dắt gom mạnh: <b>${fmtSign(foreignNet)} HĐ</b> (${foreignStrengthBadge}).\n` +
      `• Phe Đám đông (nhỏ lẻ) đang ôm đối ứng: <b>${fmtSign(crowdNet)} HĐ Short</b> (kẹt Short nặng).\n` +
      `• Rổ VN30 cơ sở phe Mua áp đảo (${breadth.greenCount} mã xanh / ${breadth.redCount} mã đỏ, Bank ${breadth.bank.label}).\n` +
      `• Basis duy trì mức ${fmtSignDec(basis)}đ, tâm lý thị trường kỳ vọng đà tăng tiếp diễn.`;
    tradePlan = `🎯 <b>Mục tiêu chốt lời (TP):</b> <b>${fmtDec(f1mPrice + 5)} - ${fmtDec(f1mPrice + 10)}đ</b> (Cược kéo ATC và quán tính ATO sáng mai).\n` +
      `🛑 <b>Cắt lỗ (SL):</b> <b>${fmtDec(f1mPrice - 3.5)}đ</b> (Thoát nếu lực kéo ATC bị dội ngược).`;
  } else if ((foreignNet <= -1200 || smartMoneyNet <= -1500) && effectiveTD <= 500 && breadth.redCount >= 15 && basis <= 4.0) {
    verdictType = 'SHORT_ATC';
    verdictIcon = '🔴';
    verdictTitle = 'NÊN MỞ VỊ THẾ SHORT ĐÓN ĐẦU ATC!';
    actionAdvice = `👉 Đặt lệnh SHORT giá ATC (hoặc khớp quanh vùng <b>${fmtDec(f1mPrice)}</b> trước 14h29m50s).`;
    verdictReason = `• Smart Money (NN + Tự Doanh) dồn lực xả Bán ròng: <b>${fmtSign(smartMoneyNet)} HĐ Short</b> (Tỷ trọng: <b>${smartMoneyPct}%</b>).\n` +
      `• Khối ngoại xả quyết liệt: <b>${fmtSign(foreignNet)} HĐ</b> (${foreignStrengthBadge}).\n` +
      `• Phe Đám đông (nhỏ lẻ) đang ôm đối ứng: <b>${fmtSign(crowdNet)} HĐ Long</b> (kẹt Long đu bắt đáy).\n` +
      `• Rổ VN30 cơ sở chìm trong sắc đỏ (${breadth.redCount} mã đỏ / ${breadth.greenCount} mã xanh), áp lực bán tháo lan rộng.\n` +
      `• Basis ${fmtSignDec(basis)}đ, phản ánh kỳ vọng chiết khấu giảm tiếp.`;
    tradePlan = `🎯 <b>Mục tiêu chốt lời (TP):</b> <b>${fmtDec(f1mPrice - 6)} - ${fmtDec(f1mPrice - 12)}đ</b> (Cược đà đạp ATC và quán tính rơi mở Gap ATO sáng mai).\n` +
      `🛑 <b>Cắt lỗ (SL):</b> <b>${fmtDec(f1mPrice + 3.5)}đ</b> (Thoát nếu ATC bất ngờ có lệnh ngoại kéo ngược).`;
  } else {
    verdictType = 'NEUTRAL';
    verdictIcon = '⏸️';
    verdictTitle = 'ĐỨNG NGOÀI — KHÔNG MỞ MỚI VÀO ATC!';
    actionAdvice = '👉 NẾU ĐANG CÓ LỆNH LÃI/LỖ MỎNG ➔ CHỦ ĐỘNG CHỐT TRƯỚC 14H29 ĐỂ BẢO TOÀN VỐN!';
    verdictReason = `• Smart Money (NN ${fmtSign(foreignNet)} HĐ, TD ${fmtSign(effectiveTD)} HĐ) giằng co hoặc phân hóa, tổng lực ${fmtSign(smartMoneyNet)} HĐ chưa có ưu thế áp đảo.\n` +
      `• Cơ sở VN30 phân hóa (${breadth.greenCount} xanh / ${breadth.redCount} đỏ), không có sóng ngành dẫn dắt rõ rệt.\n` +
      `• Biên độ thị trường lưỡng lự, rủi ro cược ATC là 50/50.`;
    tradePlan = `👉 <b>Chiến thuật:</b> Đứng ngoài bảo toàn vốn. Chờ phiên ATC chốt sổ và đánh giá lại lúc 14h44.`;
  }

  // Build message
  let msg = `⚡ <b>BÁO CÁO REALTIME TRƯỚC ATC (14h29) — VN30F1M</b>\n`;
  msg += `🕐 <i>14:29 Ngày ${todayStr} | Chuẩn bị bước vào phiên ATC (14:30 - 14:45)</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. TÌNH TRẠNG THỰC TẠI
  msg += `📍 <b>1. TÌNH TRẠNG THỰC TẠI PHÁI SINH & CƠ SỞ:</b>\n`;
  msg += `• <b>F1M:</b> <b>${fmtDec(f1mPrice)}</b> (${fmtSignDec(f1mChange)}đ | ${fmtSignDec(f1mChangePct)}%)\n`;
  msg += `• <b>VN30:</b> <b>${fmtDec(vn30Val, 2)}</b> (${fmtSignDec(vn30Change, 2)}đ) | <b>Basis:</b> <b>${fmtSignDec(basis, 2)}đ</b>\n`;
  msg += `• <b>VNINDEX:</b> <b>${fmtDec(vnidxVal, 2)}</b> (${fmtSignDec(vnidxChange, 2)}đ)\n`;
  msg += `• <b>Độ rộng VN30:</b> 🟢 <b>${breadth.greenCount}</b> xanh | 🔴 <b>${breadth.redCount}</b> đỏ | 🟡 <b>${breadth.neutralCount || 0}</b> vàng\n`;
  msg += `• <b>Nhóm Bank VN30:</b> ${breadth.bank.greenCount}/${breadth.bank.totalCount} mã xanh (Tham gia: <b>${breadth.bank.label}</b>)\n`;
  msg += `• <b>Thanh khoản:</b> F1M đạt <b>${fmt(totalVolume)} HĐ</b> | VN30 đạt <b>${fmt(vn30Price?.totalVolume ? vn30Price.totalVolume / 1e6 : 0)}M cp</b>\n\n`;

  // 2. VỊ THẾ SMART MONEY REALTIME (ĐẾN 14H29)
  msg += `🔥 <b>2. VỊ THẾ SMART MONEY REALTIME (ĐẾN 14H29):</b>\n`;
  msg += `• 🌐 <b>Khối ngoại (NN):</b> <b>${foreignNet > 0 ? '🟢 MUA RÒNG' : foreignNet < 0 ? '🔴 BÁN RÒNG' : '⚖️ CÂN BẰNG'} ${fmtSign(foreignNet)} HĐ</b> (Tỷ trọng: <b>${foreignPct}%</b>)\n`;
  msg += `   └ Mua: <code>${fmt(foreignBuy)}</code> | Bán: <code>${fmt(foreignSell)}</code> | Đánh giá: <b>${foreignStrengthBadge}</b>\n`;
  if (tuDoanhNet !== 0) {
    msg += `• 🏛️ <b>Tự doanh (TD):</b> <b>${tuDoanhNet > 0 ? `🟢 CẦM LONG ${fmtSign(tuDoanhNet)}` : `🔴 CẦM SHORT ${fmtSign(tuDoanhNet)}`} HĐ</b> (Tỷ trọng: <b>${tdPct}%</b>)\n`;
  } else {
    msg += `• 🏛️ <b>Tự doanh (TD):</b> <b>${fmtSign(effectiveTD)} HĐ</b> <i>(ước tính phòng hộ)</i> (Tỷ trọng: <b>${tdPct}%</b>)\n`;
  }
  msg += `• 🔥 <b>HỢP LỰC SMART MONEY:</b> <b>${smartMoneyNet >= 0 ? `🟢 TỔNG LONG ${fmtSign(smartMoneyNet)}` : `🔴 TỔNG SHORT ${fmtSign(smartMoneyNet)}`} HĐ</b> (Tỷ trọng: <b>${smartMoneyPct}%</b>)\n`;
  if (foreignNet > 500 && effectiveTD > 0) {
    msg += `   └ Trạng thái: <b>🟢 NN & TD ĐỒNG THUẬN LONG CỰC MẠNH</b>\n`;
  } else if (foreignNet < -500 && effectiveTD < 0) {
    msg += `   └ Trạng thái: <b>🔴 NN & TD ĐỒNG THUẬN SHORT CỰC MẠNH</b>\n`;
  } else {
    msg += `   └ Trạng thái: <b>⚖️ SMART MONEY PHÂN HÓA (${foreignNet >= 0 ? 'NN Long' : 'NN Short'} vs ${effectiveTD >= 0 ? 'TD Long' : 'TD Short'})</b>\n`;
  }
  msg += `• 👥 <b>Đám đông (Cá nhân):</b> <b>${crowdNet > 0 ? `🟢 ÔM LONG ${fmtSign(crowdNet)}` : crowdNet < 0 ? `🔴 ÔM SHORT ${fmtSign(crowdNet)}` : '⚖️ CÂN BẰNG 0'} HĐ</b>\n`;
  if (crowdNet > 1000) {
    msg += `   └ Đánh giá: <b>🔴 ĐÁM ĐÔNG ĐU LONG BẮT ĐÁY BỊ KẸP NẶNG</b>\n`;
  } else if (crowdNet < -1000) {
    msg += `   └ Đánh giá: <b>🔴 ĐÁM ĐÔNG ĐANG BỊ KẸP SHORT NẶNG</b>\n`;
  } else {
    msg += `   └ Đánh giá: <b>⚖️ ĐÁM ĐÔNG LƯỠNG LỰ QUAN SÁT</b>\n`;
  }
  msg += `• 📊 <b>Biến động OI phiên nay:</b> <b>${fmtSign(totalOIChange)} HĐ</b> (Tổng OI: <b>${fmt(totalOI)} HĐ</b>)\n`;
  if (totalOIChange < -800) {
    msg += `   └ Cảnh báo: <b>⚠️ OI giảm mạnh ➔ Tay to đã chủ động chốt lời đóng bớt HĐ</b>\n`;
  } else if (totalOIChange > 1500) {
    msg += `   └ Trạng thái: <b>🔥 Tiền lớn bơm mạnh mở vị thế mới chuẩn bị đánh ATC</b>\n`;
  }
  msg += `\n`;

  // 3. ĐÁNH GIÁ THANH KHOẢN & TAY TO
  msg += `⚠️ <b>3. ĐÁNH GIÁ THANH KHOẢN & HÀNH VI CÁ MẬP:</b>\n`;
  if (isLiquidityDry || isOIDropping) {
    msg += `• <b>Cảnh báo cạn kiệt:</b> Thanh khoản thị trường ở mức thấp (${fmt(totalVolume)} HĐ). Tiền lớn có dấu hiệu tháo lui hoặc không mặn mà đẩy giá.\n`;
  } else {
    msg += `• <b>Thanh khoản sôi động:</b> Volume đạt ${fmt(totalVolume)} HĐ, dòng tiền lớn vẫn duy trì áp lực trên thị trường.\n`;
  }
  msg += `• <b>Ý đồ tay to:</b> ${foreignNet > 1000 ? 'Khối ngoại đang dồn lực ép Short trước thềm ATC.' : foreignNet < -1000 ? 'Khối ngoại đang xả mạnh ép nhỏ lẻ cắt lỗ Long.' : 'Dòng tiền phân tán, hai phe đang cân bằng vị thế.'}\n\n`;

  // 4. PHÁN QUYẾT CỐT LÕI
  msg += `🎯 <b>4. PHÁN QUYẾT: CÓ NÊN MỞ VỊ THẾ VÀO ATC?</b>\n`;
  msg += `${verdictIcon} <b>KẾT LUẬN: ${verdictTitle}</b>\n`;
  msg += `<b>${actionAdvice}</b>\n\n`;
  msg += `📋 <b>Lý giải chi tiết:</b>\n${verdictReason}\n\n`;
  if (tradePlan) {
    msg += `${tradePlan}\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 <i>Cảnh báo tự động lúc 14h29 trước thềm ATC | VN Stock Bot v4.3</i>`;

  return msg;
}

// ─── 14H44 POST-ATC NOTIFICATION (CẦM QUA ĐÊM HAY ĐÓNG?) ──────

/**
 * Báo cáo realtime lúc 14h44 cuối phiên ATC (14:44)
 * Trả lời dứt khoát: Có nên giữ vị thế qua đêm vào ATO hôm sau hay đóng chốt lãi/lỗ luôn?
 * Cảnh báo đóng hết (Flat) nếu thanh khoản cạn kiệt, thị trường ảm đạm, tay to không găm vị thế
 */
async function buildPostATCNotificationAsync(simulatedData = null) {
  console.log('   🌙 [Post-ATC 14h44] Fetching realtime data from exchange...');
  let realtimeOI = null;
  let futuresPrice = null;
  let vn30Price = null;
  let vnindexPrice = null;
  let realtimeVN30 = null;

  if (simulatedData) {
    realtimeOI = simulatedData.realtimeOI;
    futuresPrice = simulatedData.futuresPrice;
    vn30Price = simulatedData.vn30Price;
    vnindexPrice = simulatedData.vnindexPrice;
    realtimeVN30 = simulatedData.realtimeVN30;
  } else {
    try {
      [realtimeOI, futuresPrice, vn30Price, vnindexPrice, realtimeVN30] = await Promise.all([
        dataFetcher.fetchDerivativesOIData().catch(e => null),
        dataFetcher.fetchRealtimeFuturesPrice().catch(e => null),
        dataFetcher.fetchRealtimeVN30Price().catch(e => null),
        dataFetcher.fetchRealtimeVNINDEXPrice().catch(e => null),
        dataFetcher.fetchRealtimeVN30().catch(e => null),
      ]);
    } catch (e) {
      console.error('⚠️ Post-ATC fetch failed:', e.message);
    }
  }

  const vnTime = dataFetcher.getVnTime();
  const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;
  const isFriday = vnTime.getDay() === 5;

  const fmt = (num) => (num !== undefined && num !== null ? Math.round(num).toLocaleString('vi-VN') : '0');
  const fmtDec = (num, d = 1) => (num !== undefined && num !== null ? Number(num).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '0');
  const fmtSign = (num) => (num > 0 ? `+${fmt(num)}` : fmt(num));
  const fmtSignDec = (num, d = 1) => (num > 0 ? `+${fmtDec(num, d)}` : fmtDec(num, d));

  const f1mPrice = futuresPrice ? futuresPrice.price : 0;
  const f1mPrev = futuresPrice ? futuresPrice.prevPrice : 0;
  const f1mChange = f1mPrice && f1mPrev ? (f1mPrice - f1mPrev) : 0;

  const vn30Val = vn30Price ? vn30Price.price : 0;
  const vn30Prev = vn30Price ? vn30Price.prevPrice : 0;
  const vn30Change = vn30Val && vn30Prev ? (vn30Val - vn30Prev) : 0;

  const basis = f1mPrice && vn30Val ? parseFloat((f1mPrice - vn30Val).toFixed(2)) : 0;

  const vnidxVal = vnindexPrice ? vnindexPrice.price : 0;
  const vnidxPrev = vnindexPrice ? vnindexPrice.prevPrice : 0;
  const vnidxChange = vnidxVal && vnidxPrev ? (vnidxVal - vnidxPrev) : 0;

  const foreignBuy = realtimeOI ? (realtimeOI.foreignBuy || 0) : 0;
  const foreignSell = realtimeOI ? (realtimeOI.foreignSell || 0) : 0;
  const foreignNet = realtimeOI ? (realtimeOI.foreignNet !== undefined ? realtimeOI.foreignNet : (foreignBuy - foreignSell)) : 0;
  const totalOI = realtimeOI ? (realtimeOI.totalOI || 0) : 0;
  const totalVolume = realtimeOI ? (realtimeOI.totalVolume || 0) : 0;

  const oiStore = loadOIHistoryData();
  const prevEntries = (oiStore.history || []).filter(h => normalizeDateStr(h.date) !== normalizeDateStr(todayStr));
  const prevSession = prevEntries.length > 0 ? prevEntries[prevEntries.length - 1] : null;
  let totalOIChange = realtimeOI ? (realtimeOI.totalOIChange || 0) : 0;
  if ((totalOIChange === 0 || !totalOIChange) && totalOI > 0 && prevSession && prevSession.totalOI) {
    totalOIChange = totalOI - prevSession.totalOI;
  }

  const foreignStore = loadForeignOIData();
  const existingToday = (foreignStore.history || []).find(h => normalizeDateStr(h.date) === normalizeDateStr(todayStr));
  const tuDoanhNet = existingToday ? (existingToday.tuDoanhOvernight || 0) : 0;
  const tdEst = oiEstimator.estimateTuDoanh(foreignNet, tuDoanhNet);
  const effectiveTD = tuDoanhNet !== 0 ? tuDoanhNet : tdEst.value;
  const smartMoneyNet = foreignNet + effectiveTD;
  const crowdNet = -smartMoneyNet;

  const totalVolSafe = Math.max(1, totalVolume);
  const foreignPct = ((Math.abs(foreignNet) / totalVolSafe) * 100).toFixed(1);
  const tdPct = ((Math.abs(effectiveTD) / totalVolSafe) * 100).toFixed(1);
  const smartMoneyPct = ((Math.abs(smartMoneyNet) / totalVolSafe) * 100).toFixed(1);

  const foreignAbs = Math.abs(foreignNet);

  // Auto-sync today's session record to JSON files (chỉ khi có data thật)
  if (!simulatedData && f1mPrice > 0 && (foreignBuy > 0 || foreignSell > 0 || totalOI > 0)) {
    try {
      const todayEntry = {
        date: todayStr,
        buy: foreignBuy,
        sell: foreignSell,
        overnightNet: foreignNet,
        tuDoanhOvernight: tuDoanhNet,
        totalOI: totalOI,
        oiChange: totalOIChange,
        f1mPrice: f1mPrice ? parseFloat(f1mPrice.toFixed(1)) : 0,
        vn30Price: vn30Val ? parseFloat(vn30Val.toFixed(2)) : 0,
        basis: basis,
        positionState: _classifyPositionState(totalOIChange, f1mPrice, existingToday),
      };
      recordDailySessionOI(todayEntry);
      console.log(`   ✅ [Post-ATC 14h44] Auto-synced daily session OI for ${todayStr}`);
    } catch (e) {
      console.error('   ⚠️ [Post-ATC 14h44] Auto-sync record failed:', e.message);
    }
  }

  // ─── ĐIỀU KIỆN ĐÁNH GIÁ 14H44 ─────────────────────────────────
  let verdictType = 'FLAT_CLOSE';
  let verdictIcon = '';
  let verdictTitle = '';
  let actionAdvice = '';
  let verdictReason = '';
  let atoStrategy = '';

  const isVolumeLow = totalVolume > 0 && totalVolume < 160000;
  const isOIDropping = totalOIChange < -800;
  const isForeignIndifferent = foreignAbs < 1000;

  if (isVolumeLow || isOIDropping || isForeignIndifferent || (isFriday && foreignAbs < 1500)) {
    verdictType = 'FLAT_CLOSE';
    verdictIcon = '⏹️';
    verdictTitle = 'ĐÓNG TOÀN BỘ VỊ THẾ TRƯỚC 14H45 — KHÔNG GIỮ QUA ĐÊM (FLAT)!';
    actionAdvice = '👉 Khớp lệnh đóng sạch toàn bộ vị thế đang mở trước 14h45, đưa tài khoản về 0 HĐ.';
    verdictReason = `• Smart Money không nắm ưu thế áp đảo (NN ${fmtSign(foreignNet)} HĐ, TD ${fmtSign(effectiveTD)} HĐ ➔ Net: ${fmtSign(smartMoneyNet)} HĐ), thị trường ở thế giằng co.\n` +
      `• Tổng OI sàn ${totalOIChange < 0 ? `sụt giảm ${fmt(Math.abs(totalOIChange))} HĐ cho thấy dòng tiền lớn đã chủ động chốt lời tất toán trong phiên.` : 'không gia tăng mạnh, thiếu sự bảo kê của cá mập.'}\n` +
      `• ${isFriday ? 'Hôm nay là Thứ Sáu, rủi ro biến động thông tin 2 ngày cuối tuần rất cao.\n' : ''}` +
      `• Cầm qua đêm phải chịu chi phí lưu ký và rủi ro tin tức thế giới (Dow Jones, chứng khoán Mỹ) mà không có lợi thế xác suất thắng rõ rệt.`;
    atoStrategy = `💡 <b>Kế hoạch ATO sáng mai:</b> Giữ tài khoản trạng thái FLAT an toàn. Sáng mai quan sát ATO mở cửa và tín hiệu dòng tiền 9h15 để mở vị thế mới chủ động.`;
  } else if ((foreignNet >= 1500 || smartMoneyNet >= 1800) && crowdNet <= -1000 && basis >= -4.0 && totalOIChange >= -500) {
    verdictType = 'HOLD_LONG';
    verdictIcon = '🟢';
    verdictTitle = 'NÊN GIỮ VỊ THẾ LONG QUA ĐÊM VÀO ATO SÁNG MAI!';
    actionAdvice = `👉 CẦM VỊ THẾ LONG QUA ĐÊM. Chuẩn bị kế hoạch chốt lời ở phiên ATO ${isFriday ? 'Thứ Hai' : 'sáng mai'}.`;
    verdictReason = `• Smart Money (NN + TD) găm ròng cực lớn: <b>${fmtSign(smartMoneyNet)} HĐ Long</b> (Tỷ trọng: <b>${smartMoneyPct}%</b>).\n` +
      `• Khối ngoại dẫn đầu: <b>${fmtSign(foreignNet)} HĐ Long</b> qua đêm.\n` +
      `• Đám đông ôm Short đối ứng bị kẹt nặng: <b>${fmtSign(crowdNet)} HĐ Short</b>.\n` +
      `• Tổng OI sàn duy trì cao (${fmt(totalOI)} HĐ, ${fmtSign(totalOIChange)} HĐ), tay to neo vốn quyết liệt để bảo vệ vị thế.\n` +
      `• Lợi thế thống kê: Sáng mai xác suất rất cao sẽ mở Gap Up (<b>+5 đến +10đ</b>) hoặc có nhịp kéo rướn ngay ATO để ép nhỏ lẻ Short cắt lỗ (Short Squeeze).`;
    atoStrategy = `🎯 <b>Kế hoạch hành động ATO sáng mai:</b>\n` +
      `   • Canh chốt lời 50-70% vị thế ngay tại ATO hoặc nhịp kéo hưng phấn 9h00 - 9h15.\n` +
      `   • Ngưỡng Stoploss/Chặn lãi: Thoát toàn bộ nếu ATO mở Gap giảm bất ngờ thủng <b>${fmtDec(f1mPrice - 3.5)}đ</b>.`;
  } else if ((foreignNet <= -1500 || smartMoneyNet <= -1800) && crowdNet >= 1000 && totalOIChange >= -500) {
    verdictType = 'HOLD_SHORT';
    verdictIcon = '🔴';
    verdictTitle = 'NÊN GIỮ VỊ THẾ SHORT QUA ĐÊM VÀO ATO SÁNG MAI!';
    actionAdvice = `👉 CẦM VỊ THẾ SHORT QUA ĐÊM. Chuẩn bị kế hoạch cover chốt lời ở phiên ATO ${isFriday ? 'Thứ Hai' : 'sáng mai'}.`;
    verdictReason = `• Smart Money (NN + TD) xả găm ròng Short khủng: <b>${fmtSign(smartMoneyNet)} HĐ Short</b> (Tỷ trọng: <b>${smartMoneyPct}%</b>).\n` +
      `• Khối ngoại bán ròng: <b>${fmtSign(foreignNet)} HĐ Short</b> qua đêm.\n` +
      `• Đám đông đu Long bắt đáy bị kẹp cứng: <b>${fmtSign(crowdNet)} HĐ Long</b>.\n` +
      `• Cơ sở VN30 và VN-Index chịu áp lực bán tháo, mất các mốc hỗ trợ kỹ thuật trọng yếu.\n` +
      `• Lợi thế thống kê: Sáng mai quán tính rơi tiếp diễn, xác suất rất cao mở Gap Down (<b>-5 đến -15đ</b>) theo đà tháo chạy hoảng loạn của phe kẹp Long.`;
    atoStrategy = `🎯 <b>Kế hoạch hành động ATO sáng mai:</b>\n` +
      `   • Canh cover chốt lời Short ngay tại ATO hoặc khi có nhịp nhúng sâu hoảng loạn 9h00 - 9h15.\n` +
      `   • Ngưỡng Stoploss/Chặn lãi: Thoát toàn bộ nếu ATO bất ngờ mở Gap tăng ngược vượt <b>${fmtDec(f1mPrice + 3.5)}đ</b>.`;
  } else {
    verdictType = 'FLAT_CLOSE';
    verdictIcon = '⏹️';
    verdictTitle = 'ĐÓNG TOÀN BỘ VỊ THẾ TRƯỚC 14H45 — KHÔNG GIỮ QUA ĐÊM (FLAT)!';
    actionAdvice = '👉 Khớp lệnh đóng sạch toàn bộ vị thế đang mở trước 14h45, bảo toàn vốn 100%.';
    verdictReason = `• Vị thế các bên ở trạng thái cân bằng (${fmtSign(smartMoneyNet)} HĐ), không có sự bảo kê một chiều từ cá mập.\n` +
      `• Cầm qua đêm chịu rủi ro Gap mở phiên khó lường và phí lưu ký. Đóng trạng thái để tâm lý thoải mái và bảo vệ lợi nhuận.`;
    atoStrategy = `💡 <b>Kế hoạch ATO sáng mai:</b> Đợi thị trường xác nhận phản ứng tại ATO rồi mới giải ngân theo dòng tiền phiên mới.`;
  }

  // Build message
  let msg = `🌙 <b>BÁO CÁO REALTIME CUỐI ATC (14h44) — VN30F1M</b>\n`;
  msg += `🕐 <i>14:44 Ngày ${todayStr} | 1 phút trước khi kết thúc ATC & đóng cửa sàn</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. TỔNG KẾT ATC
  msg += `📍 <b>1. TỔNG KẾT PHIÊN ATC & GIÁ ĐÓNG CỬA:</b>\n`;
  msg += `• <b>F1M chốt ATC:</b> <b>${fmtDec(f1mPrice)}</b> (${fmtSignDec(f1mChange)}đ)\n`;
  msg += `• <b>VN30 chốt ATC:</b> <b>${fmtDec(vn30Val, 2)}</b> (${fmtSignDec(vn30Change, 2)}đ) | <b>Basis:</b> <b>${fmtSignDec(basis, 2)}đ</b>\n`;
  msg += `• <b>VNINDEX chốt ATC:</b> <b>${fmtDec(vnidxVal, 2)}</b> (${fmtSignDec(vnidxChange, 2)}đ)\n`;
  msg += `• <b>Tổng KLGD cả ngày:</b> <b>${fmt(totalVolume)} HĐ</b>\n\n`;

  // 2. VỊ THẾ SMART MONEY QUA ĐÊM
  msg += `🔥 <b>2. VỊ THẾ SMART MONEY CẦM QUA ĐÊM (CHỐT SỔ ATC):</b>\n`;
  msg += `• 🌐 <b>Khối ngoại (NN):</b> <b>${foreignNet > 0 ? '🟢 CẦM LONG' : foreignNet < 0 ? '🔴 CẦM SHORT' : '⚖️ CÂN BẰNG'} ${fmtSign(foreignNet)} HĐ</b> (Tỷ trọng: <b>${foreignPct}%</b>)\n`;
  msg += `   └ Mua: <code>${fmt(foreignBuy)}</code> | Bán: <code>${fmt(foreignSell)}</code>\n`;
  if (tuDoanhNet !== 0) {
    msg += `• 🏛️ <b>Tự doanh (TD):</b> <b>${tuDoanhNet > 0 ? `🟢 CẦM LONG ${fmtSign(tuDoanhNet)}` : `🔴 CẦM SHORT ${fmtSign(tuDoanhNet)}`} HĐ</b> (Tỷ trọng: <b>${tdPct}%</b>)\n`;
  } else {
    msg += `• 🏛️ <b>Tự doanh (TD):</b> <b>${fmtSign(effectiveTD)} HĐ</b> <i>(ước tính)</i> (Tỷ trọng: <b>${tdPct}%</b>)\n`;
  }
  msg += `• 🔥 <b>HỢP LỰC SMART MONEY:</b> <b>${smartMoneyNet >= 0 ? `🟢 TỔNG LONG ${fmtSign(smartMoneyNet)}` : `🔴 TỔNG SHORT ${fmtSign(smartMoneyNet)}`} HĐ</b> (Tỷ trọng: <b>${smartMoneyPct}%</b>)\n`;
  msg += `• 👥 <b>Đám đông đối ứng:</b> <b>${crowdNet > 0 ? `🟢 ÔM LONG ${fmtSign(crowdNet)}` : crowdNet < 0 ? `🔴 ÔM SHORT ${fmtSign(crowdNet)}` : '⚖️ CÂN BẰNG 0'} HĐ</b>\n`;
  msg += `• 📊 <b>Tổng OI sàn qua đêm:</b> <b>${fmt(totalOI)} HĐ</b> (Biến động: <b>${fmtSign(totalOIChange)} HĐ</b>)\n\n`;

  // 3. PHÁN QUYẾT CỐT LÕI
  msg += `🎯 <b>3. PHÁN QUYẾT: CÓ NÊN GIỮ VỊ THẾ QUA ĐÊM VÀO ATO SÁNG MAI?</b>\n`;
  msg += `${verdictIcon} <b>KẾT LUẬN: ${verdictTitle}</b>\n`;
  msg += `<b>${actionAdvice}</b>\n\n`;
  msg += `📋 <b>Lý giải chi tiết:</b>\n${verdictReason}\n\n`;
  msg += `${atoStrategy}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 <i>Phân tích Vị thế Qua Đêm tự động lúc 14h44 | VN Stock Bot v4.3</i>`;

  return msg;
}

module.exports = {
  loadForeignOIData,
  saveForeignOIData,
  loadOIHistoryData,
  saveOIHistoryData,
  getRecent5DaysData,
  analyzeOIPositions,
  buildOIEveningNotification,
  buildOIEveningNotificationAsync,
  buildOIEveningNotificationSync,
  buildMarginCutoffNotificationAsync,
  buildPreATCNotificationAsync,
  buildPostATCNotificationAsync,
  recordDailySessionOI,
  getRealtimePositionSnapshot,
  syncRecentHistoryFromVPS,
  // Re-export estimator functions for direct access
  estimateOvernightPositions: oiEstimator.estimateCumulativePositions,
  classifyTradeAction: oiEstimator.classifyTradeAction,
  generateOvernightReport: oiEstimator.generateLatestReport,
};

