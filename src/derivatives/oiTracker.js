/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F — OI & TAY TO / KHỐI NGOẠI TRACKER v4.2           ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Theo dõi Open Interest (OI) & Vị thế qua đêm Khối ngoại /    ║
 * ║  Tự doanh 5 ngày gần nhất.                                    ║
 * ║  Phân tích mức độ chênh lệch Long/Short, mạnh/yếu/cân bằng    ║
 * ║  Đánh giá tình thế & kịch bản phiên kế tiếp (19h35 tối)       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');
const { config } = require('../config');

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
  return { cumulativeForeignNet: -4280, lastUpdated: new Date().toISOString(), history: [] };
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

// ─── GET 5-DAY HISTORY (TÍNH TỪ NGÀY HIỆN TẠI) ────────────────

/**
 * Lấy danh sách 5 phiên gần nhất kết hợp cả dữ liệu Khối ngoại, Tự doanh, Tổng OI, Giá, Basis
 */
function getRecent5DaysData() {
  const foreignStore = loadForeignOIData();
  const oiStore = loadOIHistoryData();

  const history = foreignStore.history || [];
  // Lấy 5 phiên gần nhất
  const last5 = history.slice(-5);

  // Ghép nối thông tin OI nếu có
  return last5.map(item => {
    const matchedOI = (oiStore.history || []).find(h => h.date === item.date);
    return {
      date: item.date,
      foreignBuy: item.buy || item.foreignBuy || 0,
      foreignSell: item.sell || item.foreignSell || 0,
      foreignNet: item.net !== undefined ? item.net : (item.foreignNet || 0),
      foreignCumulative: item.cumulative !== undefined ? item.cumulative : (item.foreignCumulative || 0),
      tuDoanhNet: item.tuDoanhNet || 0,
      tuDoanhCumulative: item.tuDoanhCumulative || 0,
      totalOI: matchedOI ? matchedOI.totalOI : (item.totalOI || 30000),
      oiChange: matchedOI ? matchedOI.oiChange : (item.oiChange || 0),
      f1mPrice: matchedOI ? matchedOI.f1mPrice : (item.f1mPrice || 0),
      vn30Price: matchedOI ? matchedOI.vn30Price : (item.vn30Price || 0),
      basis: matchedOI ? matchedOI.basis : (item.basis || 0),
      positionState: matchedOI ? matchedOI.positionState : (item.positionState || 'NEUTRAL'),
    };
  });
}

// ─── PHÂN TÍCH & ĐÁNH GIÁ CHÊNH LỆCH VỊ THẾ ──────────────────

/**
 * Phân tích mức độ chênh lệch Long/Short của Khối Ngoại & Tay To
 * và Đánh giá tình thế phiên kế tiếp
 */
function analyzeOIPositions(days5 = null) {
  const data = days5 || getRecent5DaysData();
  if (!data || data.length === 0) {
    return null;
  }

  const latest = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : null;

  // 1. Vị thế khối ngoại qua đêm
  const foreignCum = latest.foreignCumulative;
  const foreignSide = foreignCum > 0 ? 'LONG' : foreignCum < 0 ? 'SHORT' : 'NEUTRAL';
  const foreignAbs = Math.abs(foreignCum);

  // Mức độ chênh lệch của Khối ngoại
  let foreignStrength = 'CÂN BẰNG / YẾU';
  let foreignLevelBadge = '⚖️ CÂN BẰNG';
  if (foreignAbs >= 8000) {
    foreignStrength = 'RẤT MẠNH (CỰC ĐOAN)';
    foreignLevelBadge = '🔥 RẤT MẠNH';
  } else if (foreignAbs >= 5000) {
    foreignStrength = 'MẠNH (ÁP ĐẢO)';
    foreignLevelBadge = '⚡ MẠNH';
  } else if (foreignAbs >= 2500) {
    foreignStrength = 'TRUNG BÌNH';
    foreignLevelBadge = '📊 TRUNG BÌNH';
  }

  // 2. Vị thế Tự doanh / Tay to trong nước
  const tuDoanhCum = latest.tuDoanhCumulative;
  const tuDoanhSide = tuDoanhCum > 0 ? 'LONG' : tuDoanhCum < 0 ? 'SHORT' : 'NEUTRAL';
  const tuDoanhAbs = Math.abs(tuDoanhCum);

  let tuDoanhStrength = 'CÂN BẰNG';
  if (tuDoanhAbs >= 6000) tuDoanhStrength = 'RẤT MẠNH';
  else if (tuDoanhAbs >= 3500) tuDoanhStrength = 'MẠNH';
  else if (tuDoanhAbs >= 1500) tuDoanhStrength = 'TRUNG BÌNH';

  // 3. Tương quan đối trọng giữa Khối Ngoại vs Tự Doanh (Smart Money Battle)
  // Ví dụ: Ngoại Short -4280 vs Tự doanh Long +3850 -> Chênh lệch ròng của 2 phe lớn
  const smartMoneyNet = foreignCum + tuDoanhCum;
  let smartMoneyBalance = 'GIẰNG CO ĐỐI ỨNG';
  if (Math.abs(smartMoneyNet) < 1500) {
    smartMoneyBalance = 'CÂN BẰNG ĐỐI TRỌNG (Ngoại và Tự doanh cầm ngược chiều cân nhau)';
  } else if (smartMoneyNet > 1500) {
    smartMoneyBalance = 'NGHIÊNG VỀ PHE LONG (Tự doanh & phe Mua áp đảo)';
  } else {
    smartMoneyBalance = 'NGHIÊNG VỀ PHE SHORT (Khối ngoại & phe Bán áp đảo)';
  }

  // 4. Biến động 5 phiên gần nhất (5-day Flow Momentum)
  const total5DayForeignNet = data.reduce((sum, d) => sum + (d.foreignNet || 0), 0);
  const total5DayOIChange = data[data.length - 1].totalOI - data[0].totalOI;
  const latestOI = latest.totalOI;
  const latestOIChange = latest.oiChange;

  // Xác định hành vi phiên gần nhất
  let recentAction = 'GIỮ VỊ THẾ';
  if (latest.foreignNet > 1500 && latestOIChange < 0) {
    recentAction = 'SHORT COVERING (Khối ngoại mua đóng bớt vị thế Short, giảm phòng hộ)';
  } else if (latest.foreignNet > 1500 && latestOIChange > 0) {
    recentAction = 'LONG ACCUMULATION (Khối ngoại gom mở mới Long quy mô lớn)';
  } else if (latest.foreignNet < -1500 && latestOIChange > 0) {
    recentAction = 'SHORT ACCUMULATION (Khối ngoại gom mở mới Short, đè chỉ số)';
  } else if (latest.foreignNet < -1500 && latestOIChange < 0) {
    recentAction = 'LONG LIQUIDATION (Khối ngoại chốt lời / cắt lỗ vị thế Long)';
  } else if (latest.foreignNet > 0) {
    recentAction = 'LONG NHẸ / COVER RẢI RÁC';
  } else if (latest.foreignNet < 0) {
    recentAction = 'SHORT NHẸ / BÁN THĂM DÒ';
  }

  // 5. Đánh giá Tình thế & Kịch bản Phiên kế tiếp (Next Session Outlook)
  let nextSessionOutlook = '';
  let biasDirection = 'NEUTRAL';
  let confidenceScore = 75;
  let tactics = '';

  if (foreignSide === 'SHORT' && latest.foreignNet > 1000) {
    // Ngoại đang cầm Short nhưng phiên gần nhất cover mạnh
    biasDirection = 'HỒI PHỤC KỸ THUẬT / LONG NGẮN';
    confidenceScore = 82;
    nextSessionOutlook = 'Áp lực đè Short của khối ngoại đã hạ nhiệt rõ rệt sau phiên cover mạnh. Thị trường có động lực quán tính tiếp tục nhịp hồi, nhưng cản trên vẫn sẽ có phản ứng do lượng Short lũy kế còn tồn đọng.';
    tactics = 'Ưu tiên canh võng hỗ trợ kiểm tra cầu để mở Long ngắn hạn. KHÔNG mua đuổi ATO khi hưng phấn. Canh chốt lời từng phần khi giá chạm cản trên.';
  } else if (foreignSide === 'SHORT' && foreignAbs >= 5000 && latest.foreignNet <= 0) {
    // Ngoại cầm Short lớn và tiếp tục Short
    biasDirection = '🔴 SHORT ÁP ĐẢO';
    confidenceScore = 88;
    nextSessionOutlook = 'Khối ngoại đang giữ vị thế SHORT MẠNH và duy trì bán ròng qua đêm. Nguy cơ ép trụ tạo Gap Down đầu phiên hoặc đạp xả cuối phiên là rất cao.';
    tactics = 'Chiến lược chủ đạo: Canh các nhịp kéo hồi lấp Gap hoặc giật lên cản để mở vị thế SHORT. Tuyệt đối không bắt đáy Long khi chưa có tín hiệu kiệt bán.';
  } else if (foreignSide === 'LONG' && foreignAbs >= 5000) {
    // Ngoại cầm Long lớn
    biasDirection = '🟢 LONG ÁP ĐẢO';
    confidenceScore = 88;
    nextSessionOutlook = 'Khối ngoại đang bảo vệ vị thế LONG quy mô lớn qua đêm. Các nhịp rung lắc trong phiên thường có lực cầu của tay to hấp thụ kéo ngược.';
    tactics = 'Ưu tiên LONG khi giá điều chỉnh về vùng hỗ trợ/VWAP. Nắm giữ theo trend, nâng chặn lãi trailing stop.';
  } else {
    biasDirection = '↔️ GIẰNG CO / PHÂN HÓA';
    confidenceScore = 70;
    nextSessionOutlook = 'Vị thế hai phe Khối ngoại và Tự doanh đang ở trạng thái giằng co cân bằng, không có bên nào vượt trội hoàn toàn. Thị trường dự kiến dao động trong biên độ (Sideway Range).';
    tactics = 'Đánh ngắn hai đầu biên độ (Buy Low Sell High). Ăn non 3 - 5 điểm, tôn trọng tuyệt đối mốc stoploss 4 điểm.';
  }

  return {
    data,
    latest,
    prev,
    foreign: {
      cumulative: foreignCum,
      side: foreignSide,
      abs: foreignAbs,
      strength: foreignStrength,
      badge: foreignLevelBadge,
      todayNet: latest.foreignNet,
      todayBuy: latest.foreignBuy,
      todaySell: latest.foreignSell,
      total5DayNet: total5DayForeignNet,
    },
    tuDoanh: {
      cumulative: tuDoanhCum,
      side: tuDoanhSide,
      abs: tuDoanhAbs,
      strength: tuDoanhStrength,
      todayNet: latest.tuDoanhNet,
    },
    smartMoneyBalance,
    oi: {
      totalOI: latestOI,
      oiChange: latestOIChange,
      total5DayChange: total5DayOIChange,
      recentAction,
    },
    market: {
      f1mPrice: latest.f1mPrice,
      vn30Price: latest.vn30Price,
      basis: latest.basis,
    },
    prediction: {
      biasDirection,
      confidenceScore,
      outlook: nextSessionOutlook,
      tactics,
    }
  };
}

// ─── BUILD TELEGRAM NOTIFICATION MESSAGE (19h35 TỐI) ─────────

/**
 * Tạo message báo cáo vị thế OI & Tay To 19h35 hằng ngày
 */
function buildOIEveningNotification() {
  const analysis = analyzeOIPositions();
  if (!analysis) {
    return '⚠️ Chưa có đủ dữ liệu lịch sử OI & Khối ngoại phái sinh để phân tích.';
  }

  const { latest, foreign, tuDoanh, smartMoneyBalance, oi, market, prediction, data } = analysis;

  const fmt = (num) => (num !== undefined && num !== null ? num.toLocaleString('vi-VN') : '0');
  const fmtSign = (num) => (num > 0 ? `+${fmt(num)}` : fmt(num));

  let msg = `📊 <b>BÁO CÁO VỊ THẾ QUA ĐÊM (OI) & TAY TO PHÁI SINH</b>\n`;
  msg += `🕐 <i>Tối 19h35 — Ngày ${latest.date} | Phiên kế tiếp</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. TỔNG HỢP VỊ THẾ QUA ĐÊM HIỆN TẠI
  msg += `🔥 <b>1. TRẠNG THÁI VỊ THẾ LŨY KẾ QUA ĐÊM:</b>\n`;
  msg += `• <b>Tổng OI toàn thị trường:</b> <code>${fmt(oi.totalOI)} HĐ</code> (${fmtSign(oi.oiChange)} HĐ)\n`;
  msg += `• <b>Khối ngoại qua đêm:</b> <b>${foreign.side === 'LONG' ? '🟢 LONG RÒNG' : '🔴 SHORT RÒNG'} ${fmtSign(foreign.cumulative)} HĐ</b>\n`;
  msg += `   └ Đánh giá mức độ: <b>${foreign.badge} (${foreign.strength})</b>\n`;
  msg += `• <b>Tự doanh qua đêm:</b> <b>${tuDoanh.side === 'LONG' ? '🟢 LONG RÒNG' : '🔴 SHORT RÒNG'} ${fmtSign(tuDoanh.cumulative)} HĐ</b>\n`;
  msg += `• <b>Tương quan 2 phe Tay To:</b> <i>${smartMoneyBalance}</i>\n`;
  msg += `• <b>Hành động phiên nay:</b> <b>${oi.recentAction}</b>\n\n`;

  // 2. BẢNG DỮ LIỆU 5 NGÀY GẦN NHẤT
  msg += `📅 <b>2. DIỄN BIẾN 5 PHIÊN GẦN NHẤT (TÍNH ĐẾN NAY):</b>\n`;
  msg += `<pre>`;
  msg += `Ngày   | NN Net | NN Lũy Kế | Tổng OI  | F1M \n`;
  msg += `-------|--------|-----------|----------|------\n`;
  data.forEach(d => {
    // Format date as DD/MM
    let cleanDate = d.date;
    const dateParts = d.date.split('/');
    if (dateParts.length >= 2) {
      cleanDate = `${dateParts[0].padStart(2, '0')}/${dateParts[1].padStart(2, '0')}`;
    }
    const dStr = cleanDate.padEnd(6);
    const netStr = (d.foreignNet >= 0 ? `+${d.foreignNet}` : `${d.foreignNet}`).padStart(6);
    const cumStr = (d.foreignCumulative >= 0 ? `+${d.foreignCumulative}` : `${d.foreignCumulative}`).padStart(9);
    const oiStr = d.totalOI.toString().padStart(8);
    const f1Str = (d.f1mPrice ? d.f1mPrice.toFixed(0) : '---').padStart(5);
    msg += `${dStr} | ${netStr} | ${cumStr} | ${oiStr} | ${f1Str}\n`;
  });
  msg += `</pre>\n`;
  msg += `• <i>Ròng Khối ngoại trong ngày: <b>${fmtSign(foreign.todayNet)} HĐ</b>${foreign.todayBuy ? ` (Mua ${fmt(foreign.todayBuy)} | Bán ${fmt(foreign.todaySell)})` : ''}</i>\n`;
  msg += `• <i>Biến động OI trong ngày: <b>${fmtSign(oi.oiChange)} HĐ</b> (Tổng OI: <b>${fmt(oi.totalOI)} HĐ</b>)</i>\n`;
  if (market.f1mPrice) {
    msg += `• <i>Chốt phiên: F1M = <b>${market.f1mPrice}</b> | VN30 = <b>${market.vn30Price}</b> (Basis: <b>${fmtSign(market.basis)}</b>)</i>\n`;
  }
  msg += `\n`;

  // 3. PHÂN TÍCH CHÊNH LỆCH & Ý ĐỒ DÒNG TIỀN
  msg += `⚖️ <b>3. PHÂN TÍCH MỨC ĐỘ CHÊNH LỆCH LONG/SHORT:</b>\n`;
  if (foreign.side === 'SHORT') {
    msg += `• Khối ngoại đang nắm vị thế Short <b>${fmt(foreign.abs)} HĐ</b>. Tuy nhiên phiên hôm nay đã có động thái mua cover <b>${fmtSign(foreign.todayNet)} HĐ</b>.\n`;
  } else {
    msg += `• Khối ngoại đang giữ vị thế Long áp đảo <b>${fmt(foreign.abs)} HĐ</b>, tạo bệ đỡ tâm lý vững chắc.\n`;
  }
  msg += `• Tự doanh duy trì vị thế đối ứng <b>${fmtSign(tuDoanh.cumulative)} HĐ</b> để cân bằng rủi ro với thị trường cơ sở.\n`;
  msg += `• Tỷ lệ mở hợp đồng mới (OI): ${oi.oiChange > 0 ? 'Dòng tiền mở vị thế mới' : 'Dòng tiền chủ động đóng chốt lời/cắt lỗ trước phiên mới'}.\n\n`;

  // 4. ĐÁNH GIÁ TÌNH THẾ & KỊCH BẢN PHIÊN KẾ TIẾP
  msg += `🎯 <b>4. TÌNH THẾ & KỊCH BẢN PHIÊN KẾ TIẾP:</b>\n`;
  msg += `• <b>Định hướng chủ đạo:</b> <b>${prediction.biasDirection}</b> (Tin cậy: <b>${prediction.confidenceScore}%</b>)\n`;
  msg += `• <b>Tình thế thị trường:</b> ${prediction.outlook}\n`;
  msg += `• <b>Chiến thuật hành động:</b> ${prediction.tactics}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 <i>Báo cáo vị thế OI tự động lúc 19h35 hàng ngày | VN Stock Bot v4.2</i>`;

  return msg;
}

// ─── MANUAL & SYNC DATA UPDATE HELPERS ───────────────────────

/**
 * Cập nhật hoặc bổ sung dữ liệu 1 ngày giao dịch vào lịch sử
 */
function recordDailySessionOI(entry) {
  const foreignStore = loadForeignOIData();
  const oiStore = loadOIHistoryData();

  // 1. Update foreign_oi.json
  let fHistory = foreignStore.history || [];
  const fIdx = fHistory.findIndex(h => h.date === entry.date);
  const fItem = {
    date: entry.date,
    buy: entry.foreignBuy || 0,
    sell: entry.foreignSell || 0,
    net: entry.foreignNet !== undefined ? entry.foreignNet : ((entry.foreignBuy || 0) - (entry.foreignSell || 0)),
    cumulative: entry.foreignCumulative !== undefined ? entry.foreignCumulative : foreignStore.cumulativeForeignNet,
    tuDoanhNet: entry.tuDoanhNet || 0,
    tuDoanhCumulative: entry.tuDoanhCumulative || 0,
  };

  if (fIdx >= 0) {
    fHistory[fIdx] = { ...fHistory[fIdx], ...fItem };
  } else {
    fHistory.push(fItem);
  }
  if (fHistory.length > 30) fHistory = fHistory.slice(-30);
  foreignStore.history = fHistory;
  foreignStore.cumulativeForeignNet = fItem.cumulative;
  saveForeignOIData(foreignStore);

  // 2. Update oi_history.json
  let oHistory = oiStore.history || [];
  const oIdx = oHistory.findIndex(h => h.date === entry.date);
  const oItem = {
    date: entry.date,
    totalOI: entry.totalOI || 30000,
    oiChange: entry.oiChange || 0,
    f1mPrice: entry.f1mPrice || 0,
    vn30Price: entry.vn30Price || 0,
    basis: entry.basis || 0,
    positionState: entry.positionState || 'NEUTRAL',
  };

  if (oIdx >= 0) {
    oHistory[oIdx] = { ...oHistory[oIdx], ...oItem };
  } else {
    oHistory.push(oItem);
  }
  if (oHistory.length > 30) oHistory = oHistory.slice(-30);
  oiStore.history = oHistory;
  saveOIHistoryData(oiStore);

  console.log(`✅ [OI Tracker] Đã lưu thành công dữ liệu ngày ${entry.date}`);
  return true;
}

module.exports = {
  loadForeignOIData,
  saveForeignOIData,
  loadOIHistoryData,
  saveOIHistoryData,
  getRecent5DaysData,
  analyzeOIPositions,
  buildOIEveningNotification,
  recordDailySessionOI,
};
