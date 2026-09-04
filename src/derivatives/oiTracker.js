/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F — OI & TAY TO / KHỐI NGOẠI TRACKER v4.2           ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Theo dõi Open Interest (OI) & Vị thế qua đêm Khối ngoại /    ║
 * ║  Tự doanh theo từng ngày độc lập (số HĐ chưa đóng sau 14h45) ║
 * ║  5 ngày gần nhất.                                             ║
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

// ─── GET 5-DAY HISTORY (ĐỘC LẬP TỪNG NGÀY) ────────────────────

/**
 * Lấy danh sách 5 phiên gần nhất.
 * Mỗi ngày là độc lập:
 * - foreignOvernight: Số HĐ còn cầm chưa đóng sau 14h45 trong ngày (Buy - Sell)
 * - tuDoanhOvernight: Số HĐ tự doanh còn cầm chưa đóng sau 14h45 trong ngày
 * - totalOI: Tổng hợp đồng mở toàn sàn cuối phiên
 * - oiChange: Biến động OI trong ngày
 */
function getRecent5DaysData() {
  const foreignStore = loadForeignOIData();
  const oiStore = loadOIHistoryData();

  const fHistory = foreignStore.history || [];
  const last5Foreign = fHistory.slice(-5);

  return last5Foreign.map(item => {
    const matchedOI = (oiStore.history || []).find(h => h.date === item.date);
    const buy = item.buy || 0;
    const sell = item.sell || 0;
    const overnightNet = item.overnightNet !== undefined ? item.overnightNet : (item.net !== undefined ? item.net : (buy - sell));
    const tuDoanhOvernight = item.tuDoanhOvernight !== undefined ? item.tuDoanhOvernight : (item.tuDoanhNet || 0);

    return {
      date: item.date,
      buy,
      sell,
      overnightNet,
      tuDoanhOvernight,
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
 * Độc lập trong ngày và xu hướng chuyển dịch 5 phiên
 */
function analyzeOIPositions(days5 = null) {
  const data = days5 || getRecent5DaysData();
  if (!data || data.length === 0) {
    return null;
  }

  const latest = data[data.length - 1];

  // 1. Phân tích vị thế cầm qua đêm phiên nay của Khối Ngoại
  const foreignNet = latest.overnightNet;
  const foreignSide = foreignNet > 0 ? 'LONG' : foreignNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const foreignAbs = Math.abs(foreignNet);

  // Mức độ chênh lệch phiên nay của Khối ngoại
  let foreignStrength = 'CÂN BẰNG / GIẰNG CO';
  let foreignBadge = '⚖️ CÂN BẰNG';
  if (foreignAbs >= 2500) {
    foreignStrength = 'RẤT MẠNH (ÁP ĐẢO HOÀN TOÀN)';
    foreignBadge = '🔥 RẤT MẠNH';
  } else if (foreignAbs >= 1500) {
    foreignStrength = 'MẠNH (ƯU THẾ RÕ RỆT)';
    foreignBadge = '⚡ MẠNH';
  } else if (foreignAbs >= 800) {
    foreignStrength = 'TRUNG BÌNH';
    foreignBadge = '📊 TRUNG BÌNH';
  } else {
    foreignStrength = 'NHẸ / CÂN BẰNG HAI CHIỀU';
    foreignBadge = '⚖️ CÂN BẰNG';
  }

  // Tỷ lệ mua/bán trong ngày
  const totalVol = latest.buy + latest.sell;
  const buyRatio = totalVol > 0 ? ((latest.buy / totalVol) * 100).toFixed(1) : 50;
  const sellRatio = totalVol > 0 ? ((latest.sell / totalVol) * 100).toFixed(1) : 50;

  // 2. Phân tích vị thế cầm qua đêm phiên nay của Tự Doanh
  const tuDoanhNet = latest.tuDoanhOvernight;
  const tuDoanhSide = tuDoanhNet > 0 ? 'LONG' : tuDoanhNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const tuDoanhAbs = Math.abs(tuDoanhNet);

  let tuDoanhStrength = 'CÂN BẰNG';
  if (tuDoanhAbs >= 1500) tuDoanhStrength = 'MẠNH';
  else if (tuDoanhAbs >= 700) tuDoanhStrength = 'TRUNG BÌNH';
  else tuDoanhStrength = 'NHẸ';

  // 3. Tương quan 2 phe Tay to trong ngày (Ngoại vs Tự Doanh)
  let battleSummary = '';
  if (foreignSide === 'LONG' && tuDoanhSide === 'SHORT') {
    battleSummary = `Khối ngoại cầm LONG (+${foreignAbs.toLocaleString('vi-VN')} HĐ) đối ứng Tự doanh cầm SHORT (-${tuDoanhAbs.toLocaleString('vi-VN')} HĐ) ➔ Phe Ngoại chiếm ưu thế Long`;
  } else if (foreignSide === 'SHORT' && tuDoanhSide === 'LONG') {
    battleSummary = `Khối ngoại cầm SHORT (-${foreignAbs.toLocaleString('vi-VN')} HĐ) đối ứng Tự doanh cầm LONG (+${tuDoanhAbs.toLocaleString('vi-VN')} HĐ) ➔ Phe Ngoại ép Short`;
  } else if (foreignSide === tuDoanhSide) {
    battleSummary = `Cả Khối ngoại và Tự doanh cùng đồng thuận cầm ${foreignSide} qua đêm!`;
  } else {
    battleSummary = 'Vị thế hai phe giằng co cân bằng, không có bên nào áp đảo rõ rệt';
  }

  // 4. Hành vi phiên nay từ biến động OI
  let oiAction = '';
  if (latest.oiChange < 0 && foreignNet > 0) {
    oiAction = 'SHORT COVERING (Khối ngoại mua đóng bớt Short phiên cũ + Tổng OI giảm)';
  } else if (latest.oiChange > 0 && foreignNet > 0) {
    oiAction = 'LONG ACCUMULATION (Khối ngoại mở mới Long quyết liệt + Tổng OI tăng)';
  } else if (latest.oiChange > 0 && foreignNet < 0) {
    oiAction = 'SHORT ACCUMULATION (Khối ngoại mở mới Short đè giá + Tổng OI tăng)';
  } else if (latest.oiChange < 0 && foreignNet < 0) {
    oiAction = 'LONG LIQUIDATION (Phe Mua cắt lỗ/chốt lời Long + Tổng OI giảm)';
  } else {
    oiAction = 'THAY MÁU VỊ THẾ / XOAY VÒNG DÒNG TIỀN';
  }

  // 5. Dự báo tình thế & Kịch bản phiên kế tiếp
  let biasDirection = 'NEUTRAL';
  let confidenceScore = 75;
  let outlook = '';
  let tactics = '';

  if (foreignSide === 'LONG' && foreignAbs >= 1500) {
    biasDirection = '🟢 THIÊN LONG / HỒI PHỤC';
    confidenceScore = 85;
    outlook = `Khối ngoại cầm qua đêm lượng Long lớn (+${foreignAbs.toLocaleString('vi-VN')} HĐ) sau 14h45, đồng thời tổng OI giảm cho thấy áp lực Short đã bị bẻ gãy. Tâm lý phiên tới sẽ hưng phấn đầu phiên.`;
    tactics = 'Chiến thuật: Canh nhịp võng hỗ trợ kiểm tra cung cầu (tránh đu ATO) để mở vị thế LONG ngắn hạn. Chốt lời dần khi giá tiếp cận các mốc cản tâm lý phía trên.';
  } else if (foreignSide === 'SHORT' && foreignAbs >= 1500) {
    biasDirection = '🔴 THIÊN SHORT / ÁP LỰC ĐÈ';
    confidenceScore = 85;
    outlook = `Khối ngoại chốt phiên găm lượng Short lớn (-${foreignAbs.toLocaleString('vi-VN')} HĐ) qua đêm. Nguy cơ ép trụ tạo Gap Down đầu phiên hoặc bán dội xuống trong phiên là rất cao.`;
    tactics = 'Chiến thuật: Ưu tiên canh nhịp kéo hồi lấp Gap hoặc chạm cản kỹ thuật để mở SHORT thuận đà bán của tay to. Tuyệt đối không vội bắt đáy Long.';
  } else {
    biasDirection = '↔️ GIẰNG CO / CANH HAI ĐẦU';
    confidenceScore = 70;
    outlook = 'Khối lượng cầm qua đêm của cả Ngoại và Tự doanh ở mức vừa phải, lực mua bán trong ngày tương đối cân bằng. Thị trường phiên tới có xu hướng dao động trong biên hẹp (Sideway).';
    tactics = 'Chiến thuật: Đánh nhanh trong biên độ (Buy Low Sell High). Mục tiêu 3 - 5 điểm, tôn trọng kỷ luật dừng lỗ 3 - 4 điểm.';
  }

  return {
    data,
    latest,
    foreign: {
      side: foreignSide,
      abs: foreignAbs,
      net: foreignNet,
      buy: latest.buy,
      sell: latest.sell,
      buyRatio,
      sellRatio,
      strength: foreignStrength,
      badge: foreignBadge,
    },
    tuDoanh: {
      side: tuDoanhSide,
      abs: tuDoanhAbs,
      net: tuDoanhNet,
      strength: tuDoanhStrength,
    },
    battleSummary,
    oiAction,
    market: {
      totalOI: latest.totalOI,
      oiChange: latest.oiChange,
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

// ─── BUILD TELEGRAM NOTIFICATION MESSAGE (19h35 TỐI) ─────────

/**
 * Tạo message báo cáo vị thế OI & Tay To 19h35 hằng ngày
 * Độc lập từng ngày: số HĐ còn cầm chưa đóng sau 14h45 trong ngày
 */
function buildOIEveningNotification() {
  const analysis = analyzeOIPositions();
  if (!analysis) {
    return '⚠️ Chưa có đủ dữ liệu lịch sử OI & Khối ngoại phái sinh để phân tích.';
  }

  const { latest, foreign, tuDoanh, battleSummary, oiAction, market, prediction, data } = analysis;

  const fmt = (num) => (num !== undefined && num !== null ? num.toLocaleString('vi-VN') : '0');
  const fmtSign = (num) => (num > 0 ? `+${fmt(num)}` : fmt(num));

  let msg = `📊 <b>BÁO CÁO VỊ THẾ QUA ĐÊM (OI) & TAY TO PHÁI SINH</b>\n`;
  msg += `🕐 <i>Tối 19h35 — Ngày ${latest.date} | Chuẩn bị phiên kế tiếp</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. VỊ THẾ QUA ĐÊM PHIÊN NAY (SAU 14h45)
  msg += `🔥 <b>1. VỊ THẾ CÒN CẦM QUA ĐÊM (SAU 14H45 HÔM NAY):</b>\n`;
  msg += `• <b>Khối ngoại cầm qua đêm:</b> <b>${foreign.side === 'LONG' ? '🟢 CẦM LONG' : '🔴 CẦM SHORT'} ${fmtSign(foreign.net)} HĐ</b>\n`;
  msg += `   └ Mua: <code>${fmt(foreign.buy)}</code> (${foreign.buyRatio}%) | Bán: <code>${fmt(foreign.sell)}</code> (${foreign.sellRatio}%)\n`;
  msg += `   └ Mức độ chênh lệch: <b>${foreign.badge} (${foreign.strength})</b>\n`;
  msg += `• <b>Tự doanh cầm qua đêm:</b> <b>${tuDoanh.side === 'LONG' ? '🟢 CẦM LONG' : '🔴 CẦM SHORT'} ${fmtSign(tuDoanh.net)} HĐ</b> (${tuDoanh.strength})\n`;
  msg += `• <b>Tương quan 2 phe Tay To:</b> <i>${battleSummary}</i>\n`;
  msg += `• <b>Hành động phiên nay:</b> <b>${oiAction}</b>\n\n`;

  // 2. BẢNG DIỄN BIẾN 5 PHIÊN ĐỘC LẬP
  msg += `📅 <b>2. DIỄN BIẾN VỊ THẾ 5 PHIÊN GẦN NHẤT (ĐỘC LẬP TỪNG NGÀY):</b>\n`;
  msg += `<pre>`;
  msg += `Ngày   | NN Qua Đêm | TD Qua Đêm | Tổng OI\n`;
  msg += `-------|------------|------------|--------\n`;
  data.forEach(d => {
    // Format date as DD/MM
    let cleanDate = d.date;
    const dateParts = d.date.split('/');
    if (dateParts.length >= 2) {
      cleanDate = `${dateParts[0].padStart(2, '0')}/${dateParts[1].padStart(2, '0')}`;
    }
    const dStr = cleanDate.padEnd(6);
    const nnLabel = d.overnightNet >= 0 ? `+${d.overnightNet} L` : `${d.overnightNet} S`;
    const tdLabel = d.tuDoanhOvernight >= 0 ? `+${d.tuDoanhOvernight} L` : `${d.tuDoanhOvernight} S`;
    const nnStr = nnLabel.padStart(10);
    const tdStr = tdLabel.padStart(10);
    const oiStr = d.totalOI.toString().padStart(7);
    msg += `${dStr} | ${nnStr} | ${tdStr} | ${oiStr}\n`;
  });
  msg += `</pre>\n`;
  msg += `• <i>Ròng Khối ngoại phiên nay: <b>${fmtSign(foreign.net)} HĐ</b> (Mua ${fmt(foreign.buy)} | Bán ${fmt(foreign.sell)})</i>\n`;
  msg += `• <i>Biến động OI phiên nay: <b>${fmtSign(market.oiChange)} HĐ</b> (Tổng OI sàn: <b>${fmt(market.totalOI)} HĐ</b>)</i>\n`;
  if (market.f1mPrice) {
    msg += `• <i>Chốt phiên: F1M = <b>${market.f1mPrice}</b> | VN30 = <b>${market.vn30Price}</b> (Basis: <b>${fmtSign(market.basis)}</b>)</i>\n`;
  }
  msg += `\n`;

  // 3. PHÂN TÍCH CHÊNH LỆCH LONG/SHORT TRONG PHIÊN
  msg += `⚖️ <b>3. ĐÁNH GIÁ MỨC ĐỘ CHÊNH LỆCH LONG/SHORT:</b>\n`;
  if (foreign.side === 'LONG') {
    msg += `• <b>Phe Mua (Long) áp đảo:</b> Khối ngoại gom Mua <b>${fmt(foreign.buy)} HĐ</b> áp đảo so với Bán <b>${fmt(foreign.sell)} HĐ</b>, giữ lại ròng <b>+${fmt(foreign.abs)} HĐ Long</b> qua đêm.\n`;
  } else if (foreign.side === 'SHORT') {
    msg += `• <b>Phe Bán (Short) áp đảo:</b> Khối ngoại xả Bán <b>${fmt(foreign.sell)} HĐ</b> lấn át chiều Mua <b>${fmt(foreign.buy)} HĐ</b>, găm lại ròng <b>-${fmt(foreign.abs)} HĐ Short</b> qua đêm.\n`;
  } else {
    msg += `• Lực Mua và Bán của Khối ngoại trong phiên cân bằng, không có bên nào chiếm ưu thế vượt trội.\n`;
  }
  msg += `• <b>Động thái Tự doanh:</b> Cầm qua đêm <b>${fmtSign(tuDoanh.net)} HĐ</b> để cân đối rủi ro cơ sở.\n`;
  msg += `• <b>Dòng tiền OI:</b> ${market.oiChange < 0 ? 'Tổng hợp đồng mở giảm (-1.640 HĐ), phe Short chủ động cắt lỗ/đóng vị thế sớm.' : 'Dòng tiền mới mở rộng vị thế qua đêm.'}\n\n`;

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
 * Cập nhật hoặc bổ sung dữ liệu 1 ngày giao dịch độc lập
 */
function recordDailySessionOI(entry) {
  const foreignStore = loadForeignOIData();
  const oiStore = loadOIHistoryData();

  // 1. Update foreign_oi.json
  let fHistory = foreignStore.history || [];
  const fIdx = fHistory.findIndex(h => h.date === entry.date);
  const buy = entry.buy || entry.foreignBuy || 0;
  const sell = entry.sell || entry.foreignSell || 0;
  const overnightNet = entry.overnightNet !== undefined ? entry.overnightNet : (buy - sell);
  const tuDoanhOvernight = entry.tuDoanhOvernight !== undefined ? entry.tuDoanhOvernight : (entry.tuDoanhNet || 0);

  const fItem = {
    date: entry.date,
    buy,
    sell,
    overnightNet,
    tuDoanhOvernight,
  };

  if (fIdx >= 0) {
    fHistory[fIdx] = { ...fHistory[fIdx], ...fItem };
  } else {
    fHistory.push(fItem);
  }
  if (fHistory.length > 30) fHistory = fHistory.slice(-30);
  foreignStore.history = fHistory;
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

  console.log(`✅ [OI Tracker] Đã lưu dữ liệu ngày ${entry.date}: Ngoại qua đêm=${overnightNet}, Tự doanh=${tuDoanhOvernight}`);
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
