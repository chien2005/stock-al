/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🛡️ VN30F — Position & Risk Assistant (v9.0)                 ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Trợ lý vận hành vị thế & Quản trị rủi ro chuyên nghiệp:     ║
 * ║  • Quản lý vị thế: LONG / SHORT / NONE                       ║
 * ║  • Quy tắc Đệm lãi An Toàn (Graduation Rule): Lãi ≥ 15đ      ║
 * ║    cho phép hold qua đêm; Lãi mỏng ≤ 5đ bắt buộc FLAT trước ATC║
 * ║  • Trailing Stop tự động theo thang điểm bậc thang           ║
 * ║  • Giám sát rủi ro Gap ATO & Tuần đáo hạn phái sinh          ║
 * ║  • Tự động đồng bộ Google Sheets khi đóng vị thế             ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');
const googleSheetService = require('./googleSheetService');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'ai_position_state.json');

const FEE_PER_TRADE = 0.6; // Phí 1 vòng lệnh mở + đóng (0.6đ)

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Lấy ngày định dạng DD/MM/YYYY chuẩn giờ Việt Nam
 */
function getTodayVNString() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const vnTime = new Date(utc + (3600000 * 7));
  return `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;
}

/**
 * Lấy giờ HH:mm:ss chuẩn giờ Việt Nam
 */
function getNowVNTimeString() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const vnTime = new Date(utc + (3600000 * 7));
  const hh = String(vnTime.getHours()).padStart(2, '0');
  const mm = String(vnTime.getMinutes()).padStart(2, '0');
  const ss = String(vnTime.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Kiểm tra xem tuần hiện tại có phải Tuần Đáo Hạn Phái Sinh (Thứ 5 tuần thứ 3) hay không
 */
function checkExpiryInfo(dateObj = new Date()) {
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  const vnDate = new Date(utc + (3600000 * 7));
  
  const year = vnDate.getFullYear();
  const month = vnDate.getMonth(); // 0-based
  
  // Tìm thứ Năm tuần thứ 3 của tháng
  let thursdayCount = 0;
  let expiryDay = null;

  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day);
    if (d.getMonth() !== month) break;
    if (d.getDay() === 4) { // Thứ Năm = 4
      thursdayCount++;
      if (thursdayCount === 3) {
        expiryDay = day;
        break;
      }
    }
  }

  const currentDay = vnDate.getDate();
  const dayDiff = expiryDay ? expiryDay - currentDay : 99;
  const isExpiryWeek = Math.abs(dayDiff) <= 4 && (currentDay <= expiryDay + 1);
  const isExpiryDay = currentDay === expiryDay;

  return {
    expiryDateString: expiryDay ? `${expiryDay}/${month + 1}/${year}` : 'N/A',
    isExpiryWeek,
    isExpiryDay,
    daysUntilExpiry: dayDiff,
  };
}

/**
 * Đọc trạng thái vị thế từ file
 */
function loadState() {
  ensureDataDir();
  const todayStr = getTodayVNString();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(raw);
      // Nếu qua ngày mới thì reset các chỉ số hôm nay nhưng giữ vị thế nếu đang hold qua đêm
      if (state.date !== todayStr) {
        const isHoldingOvernight = state.position !== 'NONE' && state.graduatedOvernight;
        state.date = todayStr;
        state.todayTrades = [];
        state.totalPnLToday = 0;
        state.totalGrossPnLToday = 0;
        state.totalNetPnLToday = 0;
        state.totalFeeToday = 0;
        state.winTrades = 0;
        state.lossTrades = 0;
        state.lastExitTime = null;
        state.lastExitTimestamp = 0;
        if (!isHoldingOvernight && state.position !== 'NONE') {
          // Nếu không đăng ký qua đêm mà để sót vị thế, chuyển về NONE
          state.position = 'NONE';
          state.status = 'STAND_ASIDE';
          state.statusLabel = 'ĐỨNG NGOÀI QUAN SÁT';
          state.entryPrice = null;
        }
        saveState(state);
      }
      return state;
    }
  } catch (err) {
    console.error('⚠️ [PositionRiskAssistant] Lỗi đọc state file:', err.message);
  }

  // Khởi tạo mặc định
  const defaultState = {
    date: todayStr,
    position: 'NONE', // 'NONE' | 'LONG' | 'SHORT'
    status: 'STAND_ASIDE',
    statusLabel: 'ĐỨNG NGOÀI QUAN SÁT',
    entryPrice: null,
    entryTime: null,
    entryTimestamp: null,
    entryReason: '',
    stopLoss: null,
    trailingStop: null,
    takeProfit1: null,
    takeProfit2: null,
    currentPnL: 0,
    currentNetPnL: 0,
    maxPnL: 0,
    minPnL: 0,
    holdingBars: 0,
    breakevenActive: false,
    tp1Hit: false,
    graduatedOvernight: false,
    graduationReason: '',
    todayTrades: [],
    totalPnLToday: 0,
    totalGrossPnLToday: 0,
    totalNetPnLToday: 0,
    totalFeeToday: 0,
    winTrades: 0,
    lossTrades: 0,
    maxDailyTrades: 4,
    lastExitTime: null,
    lastExitTimestamp: 0,
    lastUpdated: new Date().toISOString(),
  };

  saveState(defaultState);
  return defaultState;
}

/**
 * Ghi trạng thái vị thế ra file
 */
function saveState(state) {
  ensureDataDir();
  try {
    state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('⚠️ [PositionRiskAssistant] Lỗi ghi state file:', err.message);
    return false;
  }
}

/**
 * Mở vị thế mới (LONG hoặc SHORT)
 */
function openPosition({ position, entryPrice, stopLoss, takeProfit1, takeProfit2, entryReason = '' }) {
  const state = loadState();
  if (state.position !== 'NONE') {
    return { success: false, message: `Đang có vị thế [${state.position}] mở tại ${state.entryPrice}. Cần đóng vị thế trước khi mở lệnh mới.` };
  }

  if (state.todayTrades.length >= state.maxDailyTrades) {
    return { success: false, message: `Đã chạm giới hạn tối đa ${state.maxDailyTrades} lệnh trong ngày. Kỷ luật đứng ngoài bảo toàn vốn!` };
  }

  const nowTime = getNowVNTimeString();
  state.position = position; // 'LONG' hoặc 'SHORT'
  state.status = 'HOLDING';
  state.statusLabel = position === 'LONG' ? 'ĐANG NẮM GIỮ LONG' : 'ĐANG NẮM GIỮ SHORT';
  state.entryPrice = +entryPrice.toFixed(1);
  state.entryTime = nowTime;
  state.entryTimestamp = Date.now();
  state.entryReason = entryReason;
  state.stopLoss = stopLoss ? +stopLoss.toFixed(1) : (position === 'LONG' ? +(entryPrice - 6.0).toFixed(1) : +(entryPrice + 6.0).toFixed(1));
  state.trailingStop = state.stopLoss;
  state.takeProfit1 = takeProfit1 ? +takeProfit1.toFixed(1) : (position === 'LONG' ? +(entryPrice + 10.0).toFixed(1) : +(entryPrice - 10.0).toFixed(1));
  state.takeProfit2 = takeProfit2 ? +takeProfit2.toFixed(1) : (position === 'LONG' ? +(entryPrice + 20.0).toFixed(1) : +(entryPrice - 20.0).toFixed(1));
  state.currentPnL = 0;
  state.currentNetPnL = -FEE_PER_TRADE;
  state.maxPnL = 0;
  state.minPnL = 0;
  state.breakevenActive = false;
  state.tp1Hit = false;
  state.graduatedOvernight = false;
  state.graduationReason = '';

  saveState(state);
  console.log(`   🛡️ [PositionAssistant] Đã mở vị thế ${position} @ ${entryPrice} (SL: ${state.stopLoss}, TP1: ${state.takeProfit1})`);
  return { success: true, state };
}

/**
 * Cập nhật Trailing Stop Loss theo bậc thang đệm lãi
 */
function updateTrailingStop(state, currentPrice) {
  if (state.position === 'NONE' || !state.entryPrice) return { trailingUpdated: false };

  let trailingUpdated = false;
  const isLong = state.position === 'LONG';
  const grossPnL = isLong
    ? +(currentPrice - state.entryPrice).toFixed(1)
    : +(state.entryPrice - currentPrice).toFixed(1);

  // Cập nhật max/min PnL
  if (grossPnL > state.maxPnL) state.maxPnL = grossPnL;
  if (grossPnL < state.minPnL) state.minPnL = grossPnL;
  state.currentPnL = grossPnL;
  state.currentNetPnL = +(grossPnL - FEE_PER_TRADE).toFixed(1);

  const prevTrailing = state.trailingStop;

  if (isLong) {
    // 1. Lãi >= +6đ ➔ Dời SL về Hòa vốn (Breakeven +0.5đ sau phí)
    if (grossPnL >= 6.0 && (!state.trailingStop || state.trailingStop < state.entryPrice + 0.5)) {
      state.trailingStop = +(state.entryPrice + 0.5).toFixed(1);
      state.breakevenActive = true;
      trailingUpdated = true;
    }
    // 2. Lãi >= +10đ ➔ Khóa lãi +5đ
    if (grossPnL >= 10.0 && state.trailingStop < state.entryPrice + 5.0) {
      state.trailingStop = +(state.entryPrice + 5.0).toFixed(1);
      state.tp1Hit = true;
      trailingUpdated = true;
    }
    // 3. Lãi >= +15đ ➔ Khóa lãi +8đ (Chuẩn bị Graduation qua đêm)
    if (grossPnL >= 15.0 && state.trailingStop < state.entryPrice + 8.0) {
      state.trailingStop = +(state.entryPrice + 8.0).toFixed(1);
      trailingUpdated = true;
    }
    // 4. Lãi >= +20đ ➔ Khóa lãi +13đ
    if (grossPnL >= 20.0 && state.trailingStop < state.entryPrice + 13.0) {
      state.trailingStop = +(state.entryPrice + 13.0).toFixed(1);
      trailingUpdated = true;
    }
    // 5. Lãi >= +30đ ➔ Khóa lãi +22đ
    if (grossPnL >= 30.0 && state.trailingStop < state.entryPrice + 22.0) {
      state.trailingStop = +(state.entryPrice + 22.0).toFixed(1);
      trailingUpdated = true;
    }
  } else {
    // SHORT: Trailing hạ dần xuống dưới
    // 1. Lãi >= +6đ ➔ Dời SL về Hòa vốn (Breakeven -0.5đ)
    if (grossPnL >= 6.0 && (!state.trailingStop || state.trailingStop > state.entryPrice - 0.5)) {
      state.trailingStop = +(state.entryPrice - 0.5).toFixed(1);
      state.breakevenActive = true;
      trailingUpdated = true;
    }
    // 2. Lãi >= +10đ ➔ Khóa lãi +5đ
    if (grossPnL >= 10.0 && state.trailingStop > state.entryPrice - 5.0) {
      state.trailingStop = +(state.entryPrice - 5.0).toFixed(1);
      state.tp1Hit = true;
      trailingUpdated = true;
    }
    // 3. Lãi >= +15đ ➔ Khóa lãi +8đ (Chuẩn bị Graduation qua đêm)
    if (grossPnL >= 15.0 && state.trailingStop > state.entryPrice - 8.0) {
      state.trailingStop = +(state.entryPrice - 8.0).toFixed(1);
      trailingUpdated = true;
    }
    // 4. Lãi >= +20đ ➔ Khóa lãi +13đ
    if (grossPnL >= 20.0 && state.trailingStop > state.entryPrice - 13.0) {
      state.trailingStop = +(state.entryPrice - 13.0).toFixed(1);
      trailingUpdated = true;
    }
    // 5. Lãi >= +30đ ➔ Khóa lãi +22đ
    if (grossPnL >= 30.0 && state.trailingStop > state.entryPrice - 22.0) {
      state.trailingStop = +(state.entryPrice - 22.0).toFixed(1);
      trailingUpdated = true;
    }
  }

  if (trailingUpdated) {
    console.log(`   🛡️ [PositionAssistant] Dời Trailing Stop: ${prevTrailing} ➔ ${state.trailingStop} (PnL: +${grossPnL}đ)`);
  }

  return { trailingUpdated, prevTrailing, newTrailing: state.trailingStop };
}

/**
 * Đóng vị thế hiện tại và ghi nhận nhật ký (Google Sheets + CSV)
 */
async function closePosition({ exitPrice, exitReason, exitTime = null }) {
  const state = loadState();
  if (state.position === 'NONE' || !state.entryPrice) {
    return { success: false, message: 'Không có vị thế mở để đóng.' };
  }

  const finalExitPrice = +exitPrice.toFixed(1);
  const finalExitTime = exitTime || getNowVNTimeString();
  const isLong = state.position === 'LONG';

  const grossPnL = isLong
    ? +(finalExitPrice - state.entryPrice).toFixed(1)
    : +(state.entryPrice - finalExitPrice).toFixed(1);

  const netPnL = +(grossPnL - FEE_PER_TRADE).toFixed(1);
  const resultLabel = netPnL > 0 ? `TP (+${netPnL}đ)` : `SL (${netPnL}đ)`;

  const orderNum = state.todayTrades.length + 1;
  const cumulativeDayNet = +(state.totalNetPnLToday + netPnL).toFixed(1);

  const tradeRecord = {
    id: `T${Date.now().toString().slice(-6)}`,
    orderNum,
    date: state.date,
    type: state.position,
    entryTime: state.entryTime,
    entryPrice: state.entryPrice,
    exitTime: finalExitTime,
    exitPrice: finalExitPrice,
    grossPnL,
    fee: FEE_PER_TRADE,
    netPnL,
    resultLabel,
    cumulativeDayNetPnL: cumulativeDayNet,
    reason: exitReason,
  };

  // Cập nhật State
  state.todayTrades.push(tradeRecord);
  state.totalGrossPnLToday = +(state.totalGrossPnLToday + grossPnL).toFixed(1);
  state.totalFeeToday = +(state.totalFeeToday + FEE_PER_TRADE).toFixed(1);
  state.totalNetPnLToday = cumulativeDayNet;
  state.totalPnLToday = cumulativeDayNet;

  if (netPnL > 0) {
    state.winTrades += 1;
  } else {
    state.lossTrades += 1;
  }

  state.lastExitTime = finalExitTime;
  state.lastExitTimestamp = Date.now();
  state.position = 'NONE';
  state.status = 'STAND_ASIDE';
  state.statusLabel = 'ĐỨNG NGOÀI QUAN SÁT';
  state.entryPrice = null;
  state.entryTime = null;
  state.entryTimestamp = null;
  state.stopLoss = null;
  state.trailingStop = null;
  state.takeProfit1 = null;
  state.takeProfit2 = null;
  state.currentPnL = 0;
  state.currentNetPnL = 0;
  state.graduatedOvernight = false;
  state.graduationReason = '';

  saveState(state);

  // Ghi nhật ký vào Google Sheets Service
  try {
    googleSheetService.logTrade({
      date: tradeRecord.date,
      orderNum: tradeRecord.orderNum,
      type: tradeRecord.type,
      entryTime: tradeRecord.entryTime,
      entryPrice: tradeRecord.entryPrice,
      exitTime: tradeRecord.exitTime,
      exitPrice: tradeRecord.exitPrice,
      grossPnL: tradeRecord.grossPnL,
      fee: tradeRecord.fee,
      netPnL: tradeRecord.netPnL,
      resultLabel: tradeRecord.resultLabel,
      cumulativeDayNetPnL: tradeRecord.cumulativeDayNetPnL,
      reason: tradeRecord.reason,
    });
    console.log(`   📝 [PositionAssistant] Đã lưu trade vào Google Sheets: Net ${netPnL >= 0 ? '+' : ''}${netPnL}đ (${exitReason})`);
  } catch (err) {
    console.error('   ⚠️ [PositionAssistant] Lỗi đồng bộ Google Sheets:', err.message);
  }

  return { success: true, trade: tradeRecord, state };
}

/**
 * Đánh giá vị thế realtime: Kiểm tra SL, Trailing, TP, và Quy tắc Đệm lãi Graduation
 * @param {number} currentPrice - Giá F1M realtime
 * @param {object} marketContext - Bối cảnh thị trường (Basis, Trụ, Ngoại)
 * @returns {object} { actionRequired, actionType, message, details }
 */
async function evaluatePosition(currentPrice, marketContext = {}) {
  const state = loadState();
  if (state.position === 'NONE' || !state.entryPrice) {
    return {
      hasPosition: false,
      position: 'NONE',
      statusText: 'Hiện không nắm giữ vị thế. Đang rình cơ hội tại Vùng Cực Trị.',
    };
  }

  const isLong = state.position === 'LONG';
  const grossPnL = isLong
    ? +(currentPrice - state.entryPrice).toFixed(1)
    : +(state.entryPrice - currentPrice).toFixed(1);

  // 1. Cập nhật Trailing Stop
  const { trailingUpdated, newTrailing } = updateTrailingStop(state, currentPrice);

  // 2. Kiểm tra Stop Loss / Trailing Stop Hit
  const effectiveStop = state.trailingStop || state.stopLoss;
  let isStopHit = false;

  if (effectiveStop) {
    if (isLong && currentPrice <= effectiveStop) isStopHit = true;
    if (!isLong && currentPrice >= effectiveStop) isStopHit = true;
  }

  if (isStopHit) {
    const isTrailing = state.trailingStop && ((isLong && state.trailingStop > state.entryPrice) || (!isLong && state.trailingStop < state.entryPrice));
    const reason = isTrailing
      ? `Khóa lãi Trailing Stop hit @ ${effectiveStop}`
      : `Cắt lỗ Stop Loss hit @ ${effectiveStop}`;

    const closeResult = await closePosition({
      exitPrice: currentPrice,
      exitReason: reason,
    });

    return {
      hasPosition: true,
      actionRequired: true,
      actionType: 'POSITION_CLOSED',
      message: `🚨 <b>VỊ THẾ ĐÃ ĐƯỢC ĐÓNG TỰ ĐỘNG</b>\n• Lý do: ${reason}\n• Giá đóng: <b>${currentPrice}</b>\n• Kết quả: <b>${closeResult.trade.resultLabel}</b>`,
      trade: closeResult.trade,
    };
  }

  // 3. Đánh giá Quy tắc Đệm Lãi An Toàn (Graduation Rule) vào khung giờ chiều (14h15 - 14h44)
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const vnDate = new Date(utc + (3600000 * 7));
  const currentMinutes = vnDate.getHours() * 60 + vnDate.getMinutes();

  let graduationAlert = null;

  // 14h20 - 14h44: Thời gian quyết định vị thế qua đêm
  if (currentMinutes >= 14 * 60 + 20 && currentMinutes <= 14 * 60 + 44) {
    const expiry = checkExpiryInfo(vnDate);

    if (grossPnL >= 15.0) {
      // Đủ đệm an toàn >= 15đ
      if (!state.graduatedOvernight) {
        state.graduatedOvernight = true;
        state.graduationReason = `Đệm lãi lớn +${grossPnL}đ. Khóa lãi Trailing Stop tại ${state.trailingStop}.`;
        saveState(state);

        graduationAlert = {
          type: 'GRADUATION_APPROVED',
          title: '🎓 VỊ THẾ ĐẠT CHUẨN GRADUATION — CHO PHÉP GIỮ QUA ĐÊM',
          content: [
            `• Vị thế: <b>${state.position} @ ${state.entryPrice}</b> (PnL hiện tại: <b>+${grossPnL}đ</b>)`,
            `• Đệm lãi an toàn: <b>≥ +15đ</b> (Đáp ứng điều kiện chống rung lắc mở Gap ATO).`,
            `• Đã khóa lãi Trailing Stop tại <b>${state.trailingStop}đ</b> (Đảm bảo bỏ túi tối thiểu +${Math.abs(state.trailingStop - state.entryPrice).toFixed(1)}đ).`,
            expiry.isExpiryWeek ? `⚠️ <i>Lưu ý: Tuần này là tuần đáo hạn (${expiry.expiryDateString}), cần bám sát diễn biến mở phiên ngày mai.</i>` : `• Chiến lược: <b>NẮM GIỮ ĂN SÓNG LỚN H1/DAILY</b>.`,
          ].join('\n'),
        };
      }
    } else if (currentMinutes >= 14 * 60 + 35) {
      // 14h35 trở đi mà lãi mỏng <= 5đ hoặc âm điểm
      if (grossPnL <= 5.0 && !state.graduatedOvernight) {
        graduationAlert = {
          type: 'GRADUATION_REJECTED',
          title: '⚠️ CẢNH BÁO: ĐỆM LÃI MỎNG — KHUYẾN NGHỊ FLAT TRƯỚC ATC',
          content: [
            `• Vị thế: <b>${state.position} @ ${state.entryPrice}</b> (PnL: <b>${grossPnL >= 0 ? '+' : ''}${grossPnL}đ</b>)`,
            `• Đệm lãi <b>< +15đ</b> ➔ KHÔNG ĐẠT TIÊU CHUẨN cầm qua đêm của Senior Trader.`,
            `• Rủi ro mở Gap ATO sáng mai có thể cuốn bay tài khoản hoặc biến lãi thành lỗ nặng.`,
            `• <b>HÀNH ĐỘNG: ĐÓNG VỊ THẾ TRƯỚC 14h44</b> để giữ tài khoản ở trạng thái 100% TIỀN MẶT an toàn!`,
          ].join('\n'),
        };
      }
    }
  }

  saveState(state);

  return {
    hasPosition: true,
    actionRequired: trailingUpdated || graduationAlert !== null,
    actionType: graduationAlert ? 'GRADUATION_UPDATE' : (trailingUpdated ? 'TRAILING_STOP_UPDATE' : 'NORMAL_HOLDING'),
    position: state.position,
    entryPrice: state.entryPrice,
    currentPrice,
    grossPnL,
    netPnL: state.currentNetPnL,
    stopLoss: state.stopLoss,
    trailingStop: state.trailingStop,
    trailingUpdated,
    graduationAlert,
    statusText: `${state.position} @ ${state.entryPrice} (Lãi/Lỗ: ${grossPnL >= 0 ? '+' : ''}${grossPnL}đ | Trailing: ${state.trailingStop})`,
  };
}

/**
 * Lấy tóm tắt trạng thái phục vụ hiển thị
 */
function getPositionSummary() {
  const state = loadState();
  if (state.position === 'NONE') {
    return {
      hasPosition: false,
      summaryText: 'Vị thế: TRỐNG (Đứng ngoài quan sát, sẵn sàng săn cơ hội sóng lớn)',
    };
  }

  return {
    hasPosition: true,
    position: state.position,
    entryPrice: state.entryPrice,
    entryTime: state.entryTime,
    stopLoss: state.stopLoss,
    trailingStop: state.trailingStop,
    currentPnL: state.currentPnL,
    graduatedOvernight: state.graduatedOvernight,
    summaryText: `Vị thế: ${state.position} @ ${state.entryPrice} (${state.entryTime}) | PnL: ${state.currentPnL >= 0 ? '+' : ''}${state.currentPnL}đ | Trailing: ${state.trailingStop}`,
  };
}

module.exports = {
  FEE_PER_TRADE,
  loadState,
  saveState,
  openPosition,
  closePosition,
  evaluatePosition,
  updateTrailingStop,
  getPositionSummary,
  checkExpiryInfo,
  getTodayVNString,
  getNowVNTimeString,
};
