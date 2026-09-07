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

// ─── GET 5-DAY HISTORY (ĐỘC LẬP TỪNG NGÀY & 3 PHE) ────────────

/**
 * Lấy danh sách 5 phiên gần nhất gồm đầy đủ 3 phe:
 * - Khối ngoại (overnightNet)
 * - Tự doanh (tuDoanhOvernight)
 * - Đám đông / Cá nhân (crowdOvernight = -(overnightNet + tuDoanhOvernight))
 * - Tổng OI & Biến động OI
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

    // Quy tắc Zero-Sum: Đám đông đối ứng toàn bộ phần còn lại
    const crowdOvernight = -(overnightNet + tuDoanhOvernight);

    return {
      date: item.date,
      buy,
      sell,
      overnightNet,
      tuDoanhOvernight,
      crowdOvernight,
      totalOI: matchedOI ? matchedOI.totalOI : (item.totalOI || 30000),
      oiChange: matchedOI ? matchedOI.oiChange : (item.oiChange || 0),
      f1mPrice: matchedOI ? matchedOI.f1mPrice : (item.f1mPrice || 0),
      vn30Price: matchedOI ? matchedOI.vn30Price : (item.vn30Price || 0),
      basis: matchedOI ? matchedOI.basis : (item.basis || 0),
      positionState: matchedOI ? matchedOI.positionState : (item.positionState || 'NEUTRAL'),
    };
  });
}

// ─── PHÂN TÍCH & ĐÁNH GIÁ VỊ THẾ 3 PHE ────────────────────────

/**
 * Phân tích mức độ chênh lệch Long/Short của Khối Ngoại, Tự Doanh và Đám Đông
 */
function analyzeOIPositions(days5 = null) {
  const data = days5 || getRecent5DaysData();
  if (!data || data.length === 0) {
    return null;
  }

  const latest = data[data.length - 1];

  // 1. Phân tích Khối Ngoại
  const foreignNet = latest.overnightNet;
  const foreignSide = foreignNet > 0 ? 'LONG' : foreignNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const foreignAbs = Math.abs(foreignNet);

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

  const totalVol = latest.buy + latest.sell;
  const buyRatio = totalVol > 0 ? ((latest.buy / totalVol) * 100).toFixed(1) : 50;
  const sellRatio = totalVol > 0 ? ((latest.sell / totalVol) * 100).toFixed(1) : 50;

  // 2. Phân tích Tự Doanh
  const tuDoanhNet = latest.tuDoanhOvernight;
  const tuDoanhSide = tuDoanhNet > 0 ? 'LONG' : tuDoanhNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const tuDoanhAbs = Math.abs(tuDoanhNet);

  let tuDoanhStrength = 'CÂN BẰNG';
  if (tuDoanhAbs >= 1500) tuDoanhStrength = 'MẠNH';
  else if (tuDoanhAbs >= 700) tuDoanhStrength = 'TRUNG BÌNH';
  else tuDoanhStrength = 'NHẸ';

  // 3. Phân tích Đám Đông (Cá nhân nhỏ lẻ)
  const crowdNet = latest.crowdOvernight;
  const crowdSide = crowdNet > 0 ? 'LONG' : crowdNet < 0 ? 'SHORT' : 'CÂN BẰNG';
  const crowdAbs = Math.abs(crowdNet);

  let crowdSentiment = '';
  let crowdBadge = '';
  if (crowdSide === 'SHORT' && crowdAbs >= 1000) {
    crowdBadge = '🔴 ĐÁM ĐÔNG ÔM SHORT NẶNG';
    crowdSentiment = 'Thấy giá tăng mạnh +30đ nên nhảy vào Short chặn đầu hoặc dính bẫy kẹp Short chưa kịp đóng. Đám đông đang ở thế bất lợi, dễ bị tay to ép cắt lỗ phiên tới (Short Squeeze).';
  } else if (crowdSide === 'LONG' && crowdAbs >= 1000) {
    crowdBadge = '🟢 ĐÁM ĐÔNG FOMO LONG';
    crowdSentiment = 'Đám đông hưng phấn đu Long giá cao. Nguy cơ bị tay to xả hàng chốt lời ép nhỏ lẻ cắt lỗ.';
  } else {
    crowdBadge = '⚖️ ĐÁM ĐÔNG LƯỠNG LỰ';
    crowdSentiment = 'Vị thế đám đông tương đối cân bằng, tâm lý dè dặt quan sát.';
  }

  // 4. Tương quan 3 phe & Hành vi dòng tiền
  let battleSummary = '';
  if (foreignSide === 'LONG' && crowdSide === 'SHORT') {
    battleSummary = `Khối ngoại cầm LONG (+${foreignAbs.toLocaleString('vi-VN')} HĐ) áp đảo ➔ Đang "úp sọt" phe Đám đông ôm SHORT (-${crowdAbs.toLocaleString('vi-VN')} HĐ) và Tự doanh phòng hộ (-${tuDoanhAbs.toLocaleString('vi-VN')} HĐ)`;
  } else if (foreignSide === 'SHORT' && crowdSide === 'LONG') {
    battleSummary = `Khối ngoại cầm SHORT (-${foreignAbs.toLocaleString('vi-VN')} HĐ) ➔ Đang ép phe Đám đông đu LONG (+${crowdAbs.toLocaleString('vi-VN')} HĐ) rơi vào thế kẹt`;
  } else {
    battleSummary = `Thế giằng co đa chiều giữa Khối ngoại (${foreignNet >= 0 ? '+' : ''}${foreignNet}), Tự doanh (${tuDoanhNet >= 0 ? '+' : ''}${tuDoanhNet}), Đám đông (${crowdNet >= 0 ? '+' : ''}${crowdNet})`;
  }

  // 5. Dự báo tình thế & Kịch bản phiên kế tiếp
  let biasDirection = 'NEUTRAL';
  let confidenceScore = 75;
  let outlook = '';
  let tactics = '';

  if (foreignSide === 'LONG' && crowdSide === 'SHORT' && foreignAbs >= 1500) {
    biasDirection = '🟢 THIÊN LONG / KÉO RƯỚN ÉP SHORT';
    confidenceScore = 88;
    outlook = `Khối ngoại cầm qua đêm lượng Long lớn (+${foreignAbs.toLocaleString('vi-VN')} HĐ) trong khi Đám đông bị kẹp Short nặng (-${crowdAbs.toLocaleString('vi-VN')} HĐ). Tay to thường lợi dụng lượng Short kẹt này để kéo rướn đầu phiên ép đám đông phải cắt lỗ hàng loạt (Short Squeeze).`;
    tactics = 'Tuyệt đối không nhảy vào Short chặn đầu khi đám đông đang bị kẹp Short. Canh nhịp võng rung lắc kiểm tra cầu quanh hỗ trợ để mở vị thế LONG ngắn hạn. Chốt lời dần khi tiếp cận cản 1.990 - 1.995.';
  } else if (foreignSide === 'SHORT' && crowdSide === 'LONG' && foreignAbs >= 1500) {
    biasDirection = '🔴 THIÊN SHORT / ĐÈ BẮT ĐÁY';
    confidenceScore = 88;
    outlook = `Khối ngoại chốt phiên găm lượng Short lớn (-${foreignAbs.toLocaleString('vi-VN')} HĐ) qua đêm, còn Đám đông đu Long. Nguy cơ ép đạp đầu phiên để ép nhỏ lẻ cắt lỗ Long là rất cao.`;
    tactics = 'Canh nhịp kéo hồi lấp Gap để mở SHORT. Tuyệt đối không bắt đáy Long.';
  } else {
    biasDirection = '↔️ GIẰNG CO / CANH HAI ĐẦU';
    confidenceScore = 70;
    outlook = 'Lực mua bán của 3 phe ở mức vừa phải, thị trường có xu hướng đi trong biên độ tích lũy (Sideway).';
    tactics = 'Đánh nhanh trong biên độ (Buy Low Sell High). Mục tiêu 3 - 5 điểm, dừng lỗ 3 - 4 điểm.';
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
    crowd: {
      side: crowdSide,
      abs: crowdAbs,
      net: crowdNet,
      badge: crowdBadge,
      sentiment: crowdSentiment,
    },
    battleSummary,
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
 * Tạo message báo cáo vị thế OI & 3 PHE (Ngoại - Tự Doanh - Đám Đông)
 * v4.3: Async — fetch realtime data từ sàn trước khi build, auto-sync vào file
 */
async function buildOIEveningNotificationAsync() {
  // ─── STEP 1: Fetch realtime data từ sàn ─────────────────
  console.log('   📡 [OI Evening] Fetching realtime OI data from exchange...');
  try {
    const realtimeOI = await dataFetcher.fetchDerivativesOIData();
    const futuresPrice = await dataFetcher.fetchRealtimeFuturesPrice();
    const vn30Price = await dataFetcher.fetchRealtimeVN30Price();

    if (realtimeOI && (realtimeOI.foreignBuy > 0 || realtimeOI.foreignSell > 0 || realtimeOI.totalOI > 0)) {
      // ─── STEP 2: Auto-sync today's data vào file ────────
      const vnTime = dataFetcher.getVnTime();
      const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;

      const foreignBuy = realtimeOI.foreignBuy || 0;
      const foreignSell = realtimeOI.foreignSell || 0;
      const foreignNet = realtimeOI.foreignNet || (foreignBuy - foreignSell);
      const totalOI = realtimeOI.totalOI || 30000;
      const totalOIChange = realtimeOI.totalOIChange || 0;
      const f1mPrice = futuresPrice ? futuresPrice.price : 0;
      const vn30PriceVal = vn30Price ? vn30Price.price : 0;
      const basis = f1mPrice && vn30PriceVal ? parseFloat((f1mPrice - vn30PriceVal).toFixed(2)) : 0;

      // Tính tự doanh: dùng data file nếu có, nếu không ước lượng
      const foreignStore = loadForeignOIData();
      const existingToday = (foreignStore.history || []).find(h => h.date === todayStr);
      const tuDoanhOvernight = existingToday ? (existingToday.tuDoanhOvernight || 0) : 0;

      const entry = {
        date: todayStr,
        buy: foreignBuy,
        sell: foreignSell,
        overnightNet: foreignNet,
        tuDoanhOvernight: tuDoanhOvernight,
        totalOI: totalOI,
        oiChange: totalOIChange,
        f1mPrice: f1mPrice ? parseFloat(f1mPrice.toFixed(1)) : 0,
        vn30Price: vn30PriceVal ? parseFloat(vn30PriceVal.toFixed(2)) : 0,
        basis: basis,
        positionState: _classifyPositionState(totalOIChange, f1mPrice, existingToday),
      };

      recordDailySessionOI(entry);
      console.log(`   ✅ [OI Evening] Auto-synced realtime data for ${todayStr}: Foreign=${foreignNet}, OI=${totalOI}`);
    } else {
      console.log('   ⚠️ [OI Evening] No realtime data available, using cached file data');
    }
  } catch (e) {
    console.error('   ⚠️ [OI Evening] Realtime fetch failed, using cached data:', e.message);
  }

  // ─── STEP 3: Build noti từ data đã sync (luôn mới nhất) ──
  return buildOIEveningNotificationSync();
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
function buildOIEveningNotificationSync() {
  const analysis = analyzeOIPositions();
  if (!analysis) {
    return '⚠️ Chưa có đủ dữ liệu lịch sử OI & Khối ngoại phái sinh để phân tích.';
  }

  const { latest, foreign, tuDoanh, crowd, battleSummary, market, prediction, data } = analysis;

  const fmt = (num) => (num !== undefined && num !== null ? num.toLocaleString('vi-VN') : '0');
  const fmtSign = (num) => (num > 0 ? `+${fmt(num)}` : fmt(num));

  let msg = `📊 <b>BÁO CÁO VỊ THẾ QUA ĐÊM (OI) & 3 PHE PHÁI SINH</b>\n`;
  msg += `🕐 <i>Tối 19h35 — Ngày ${latest.date} | Chuẩn bị phiên kế tiếp</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. VỊ THẾ QUA ĐÊM 3 PHE SAU 14H45 HÔM NAY
  msg += `🔥 <b>1. VỊ THẾ CÒN CẦM QUA ĐÊM (SAU 14H45 HÔM NAY):</b>\n`;
  msg += `• 🌐 <b>Khối ngoại:</b> <b>${foreign.side === 'LONG' ? '🟢 CẦM LONG' : '🔴 CẦM SHORT'} ${fmtSign(foreign.net)} HĐ</b>\n`;
  msg += `   └ Mua: <code>${fmt(foreign.buy)}</code> (${foreign.buyRatio}%) | Bán: <code>${fmt(foreign.sell)}</code> (${foreign.sellRatio}%)\n`;
  msg += `   └ Mức độ: <b>${foreign.badge} (${foreign.strength})</b>\n`;
  msg += `• 🏛️ <b>Tự doanh:</b> <b>${tuDoanh.side === 'LONG' ? '🟢 CẦM LONG' : '🔴 CẦM SHORT'} ${fmtSign(tuDoanh.net)} HĐ</b> (${tuDoanh.strength})\n`;
  msg += `• 👥 <b>Đám đông (Cá nhân):</b> <b>${crowd.side === 'LONG' ? '🟢 CẦM LONG' : '🔴 CẦM SHORT'} ${fmtSign(crowd.net)} HĐ</b>\n`;
  msg += `   └ Đánh giá: <b>${crowd.badge}</b>\n`;
  msg += `• ⚖️ <i>Quy tắc bù trừ Zero-Sum:</i>\n`;
  msg += `   <code>Ngoại (${fmtSign(foreign.net)}) + TD (${fmtSign(tuDoanh.net)}) + Đám đông (${fmtSign(crowd.net)}) = 0 HĐ</code>\n`;
  msg += `• 🥊 <b>Tương quan 3 phe:</b> <i>${battleSummary}</i>\n\n`;

  // 2. BẢNG DIỄN BIẾN 5 PHIÊN GẦN NHẤT (3 PHE ĐỘC LẬP)
  msg += `📅 <b>2. DIỄN BIẾN VỊ THẾ 5 PHIÊN GẦN NHẤT (3 PHE ĐỘC LẬP):</b>\n`;
  msg += `<pre>`;
  msg += `Ngày  | Khối Ngoại | Tự Doanh   | Đám Đông   | Tổng OI\n`;
  msg += `------|------------|------------|------------|--------\n`;
  data.forEach(d => {
    let cleanDate = d.date;
    const dateParts = d.date.split('/');
    if (dateParts.length >= 2) {
      cleanDate = `${dateParts[0].padStart(2, '0')}/${dateParts[1].padStart(2, '0')}`;
    }
    const dStr = cleanDate.padEnd(5);
    const nnLabel = d.overnightNet >= 0 ? `+${d.overnightNet} L` : `${d.overnightNet} S`;
    const tdLabel = d.tuDoanhOvernight >= 0 ? `+${d.tuDoanhOvernight} L` : `${d.tuDoanhOvernight} S`;
    const crLabel = d.crowdOvernight >= 0 ? `+${d.crowdOvernight} L` : `${d.crowdOvernight} S`;
    const nnStr = nnLabel.padStart(10);
    const tdStr = tdLabel.padStart(10);
    const crStr = crLabel.padStart(10);
    const oiStr = d.totalOI.toString().padStart(7);
    msg += `${dStr} | ${nnStr} | ${tdStr} | ${crStr} | ${oiStr}\n`;
  });
  msg += `</pre>\n`;
  msg += `• <i>Ròng Khối ngoại phiên nay: <b>${fmtSign(foreign.net)} HĐ</b> (Mua ${fmt(foreign.buy)} | Bán ${fmt(foreign.sell)})</i>\n`;
  msg += `• <i>Ròng Đám đông phiên nay: <b>${fmtSign(crowd.net)} HĐ</b> (Nhỏ lẻ ôm ${crowd.side} đối ứng)</i>\n`;
  msg += `• <i>Biến động OI phiên nay: <b>${fmtSign(market.oiChange)} HĐ</b> (Tổng OI sàn: <b>${fmt(market.totalOI)} HĐ</b>)</i>\n`;
  if (market.f1mPrice) {
    msg += `• <i>Chốt phiên: F1M = <b>${market.f1mPrice}</b> | VN30 = <b>${market.vn30Price}</b> (Basis: <b>${fmtSign(market.basis)}</b>)</i>\n`;
  }
  msg += `\n`;

  // 3. GIẢI MÃ TÂM LÝ ĐÁM ĐÔNG & Ý ĐỒ CÁ MẬP
  msg += `🧠 <b>3. GIẢI MÃ TÂM LÝ ĐÁM ĐÔNG & Ý ĐỒ CÁ MẬP:</b>\n`;
  msg += `• <b>Tâm lý Đám đông:</b> ${crowd.sentiment}\n`;

  // Dynamic foreign intent based on side
  if (foreign.side === 'LONG') {
    msg += `• <b>Ý đồ Khối ngoại:</b> Gom Mua <b>${fmt(foreign.buy)} HĐ</b> áp đảo Bán <b>${fmt(foreign.sell)} HĐ</b>, găm <b>${fmtSign(foreign.net)} HĐ Long</b> qua đêm nhằm nắm quyền chủ động tạo sóng.\n`;
  } else {
    msg += `• <b>Ý đồ Khối ngoại:</b> Xả Bán <b>${fmt(foreign.sell)} HĐ</b> áp đảo Mua <b>${fmt(foreign.buy)} HĐ</b>, găm <b>${fmtSign(foreign.net)} HĐ Short</b> qua đêm nhằm ép giá phiên kế tiếp.\n`;
  }

  // Dynamic tuDoanh intent
  if (tuDoanh.side === 'SHORT') {
    msg += `• <b>Ý đồ Tự doanh:</b> Cầm <b>${fmtSign(tuDoanh.net)} HĐ Short</b> mang tính chất thuần phòng hộ cơ sở và ăn chênh lệch Basis.\n\n`;
  } else {
    msg += `• <b>Ý đồ Tự doanh:</b> Cầm <b>${fmtSign(tuDoanh.net)} HĐ Long</b> cho thấy tự doanh đang kỳ vọng xu hướng tăng hoặc phòng hộ ngược.\n\n`;
  }

  // 4. ĐÁNH GIÁ TÌNH THẾ & KỊCH BẢN PHIÊN KẾ TIẾP
  msg += `🎯 <b>4. TÌNH THẾ & KỊCH BẢN PHIÊN KẾ TIẾP:</b>\n`;
  msg += `• <b>Định hướng chủ đạo:</b> <b>${prediction.biasDirection}</b> (Tin cậy: <b>${prediction.confidenceScore}%</b>)\n`;
  msg += `• <b>Tình thế thị trường:</b> ${prediction.outlook}\n`;
  msg += `• <b>Chiến thuật hành động:</b> ${prediction.tactics}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 <i>Báo cáo vị thế OI 3 phe tự động lúc 19h35 hàng ngày | VN Stock Bot v4.3</i>`;

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

  console.log(`✅ [OI Tracker] Đã lưu dữ liệu ngày ${entry.date}: Ngoại=${overnightNet}, TD=${tuDoanhOvernight}, Đám đông=${-(overnightNet + tuDoanhOvernight)}`);
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
    if (allData.oiData.totalOIChange !== null && allData.oiData.totalOIChange !== undefined) {
      oiChange = allData.oiData.totalOIChange;
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

  return {
    foreignBuy,
    foreignSell,
    foreignNet,
    tuDoanhNet,
    tuDoanhBuy,
    tuDoanhSell,
    crowdNet,
    totalOI,
    oiChange,
  };
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
  recordDailySessionOI,
  getRealtimePositionSnapshot,
};
