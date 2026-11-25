/**
 * AI STOCK HUNTER - Exchange Calendar & T+2 Settlement Rules
 * Quản lý lịch HOSE/HNX, ngày nghỉ lễ, session theo thời gian thực Asia/Ho_Chi_Minh,
 * và tính toán ngày hàng về T+2 chuẩn xác (không cộng 48h máy móc).
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');

function toVnComponents(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: STOCK_HUNTER_CONFIG.market.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const hour = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[parts.weekday];
  return {
    dateStr,
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    dayOfWeek,
    hour,
    minute,
    second,
    hhmm: hour * 100 + minute,
    timeLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function isHoliday(dateStr, holidays = STOCK_HUNTER_CONFIG.market.holidays) {
  return Array.isArray(holidays) && holidays.includes(dateStr);
}

function isTradingDay(dateInput = new Date(), holidays = STOCK_HUNTER_CONFIG.market.holidays) {
  const vn = typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? toVnComponents(new Date(`${dateInput}T10:00:00+07:00`))
    : toVnComponents(dateInput);
  if (vn.dayOfWeek === 0 || vn.dayOfWeek === 6) return false;
  return !isHoliday(vn.dateStr, holidays);
}

/**
 * Xác định trạng thái phiên giao dịch tại thời điểm timestamp trên sàn HOSE/HNX
 */
function sessionAt(timestamp = new Date(), exchange = 'HOSE', holidays = STOCK_HUNTER_CONFIG.market.holidays) {
  const vn = toVnComponents(timestamp);
  if (vn.dayOfWeek === 0 || vn.dayOfWeek === 6 || isHoliday(vn.dateStr, holidays)) {
    return 'CLOSED_HOLIDAY';
  }
  const ex = (exchange || 'HOSE').toUpperCase();
  const t = vn.hhmm;

  if (ex === 'HNX') {
    if (t >= 900 && t < 1130) return 'CONTINUOUS_AM';
    if (t >= 1130 && t < 1300) return 'LUNCH_BREAK';
    if (t >= 1300 && t < 1430) return 'CONTINUOUS_PM';
    if (t >= 1430 && t < 1445) return 'ATC';
    if (t >= 1445 && t <= 1500) return 'PLO';
    return 'CLOSED';
  }

  // HOSE (mặc định)
  if (t >= 900 && t < 915) return 'ATO';
  if (t >= 915 && t < 1130) return 'CONTINUOUS_AM';
  if (t >= 1130 && t < 1300) return 'LUNCH_BREAK';
  if (t >= 1300 && t < 1430) return 'CONTINUOUS_PM';
  if (t >= 1430 && t < 1445) return 'ATC';
  if (t >= 1445 && t <= 1500) return 'PUT_THROUGH_ONLY';
  return 'CLOSED';
}

function isContinuousSession(session) {
  return session === 'CONTINUOUS_AM' || session === 'CONTINUOUS_PM';
}

function isMarketOpenForOrder(session) {
  return isContinuousSession(session) || session === 'ATO' || session === 'ATC';
}

/**
 * Cộng n ngày giao dịch (bỏ T7, CN và ngày nghỉ lễ)
 */
function addTradingDays(dateInput, tradingDaysCount, holidays = STOCK_HUNTER_CONFIG.market.holidays) {
  const baseStr = typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? dateInput
    : toVnComponents(dateInput).dateStr;

  let cursor = new Date(`${baseStr}T12:00:00+07:00`);
  let remaining = tradingDaysCount;
  const step = remaining >= 0 ? 1 : -1;
  remaining = Math.abs(remaining);

  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + step * 86400 * 1000);
    const str = toVnComponents(cursor).dateStr;
    if (isTradingDay(str, holidays)) {
      remaining -= 1;
    }
  }
  return toVnComponents(cursor).dateStr;
}

/**
 * Tính ngày hàng về T+2 theo quy chế VSDC 39/QĐ-HĐTV
 */
function calculateSettlementDate(tradeDate, holidays = STOCK_HUNTER_CONFIG.market.holidays) {
  return addTradingDays(tradeDate, 2, holidays);
}

/**
 * Đếm số phiên giao dịch đã trôi qua từ tradeDate đến currentDate (phục vụ Time-stop 19 phiên)
 */
function countTradingSessionsBetween(fromDateInput, toDateInput, holidays = STOCK_HUNTER_CONFIG.market.holidays) {
  const fromStr = typeof fromDateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fromDateInput)
    ? fromDateInput
    : toVnComponents(fromDateInput).dateStr;
  const toStr = typeof toDateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(toDateInput)
    ? toDateInput
    : toVnComponents(toDateInput).dateStr;

  if (toStr <= fromStr) return 0;
  let cursor = new Date(`${fromStr}T12:00:00+07:00`);
  let count = 0;
  for (let guard = 0; guard < 120; guard++) {
    cursor = new Date(cursor.getTime() + 86400 * 1000);
    const curStr = toVnComponents(cursor).dateStr;
    if (isTradingDay(curStr, holidays)) count += 1;
    if (curStr >= toStr) break;
  }
  return count;
}

/**
 * Kiểm tra xem 1 lô cổ phiếu (lot) đã đủ điều kiện khả dụng để bán hay chưa.
 * Hàng T+2 thông thường về chiều ngày T+2 (>= 13:00 VN) hoặc khi brokerConfirmedAvailable = true.
 */
function isLotSettledAt(lot, nowInput = new Date(), holidays = STOCK_HUNTER_CONFIG.market.holidays) {
  if (!lot) return false;
  if (lot.brokerConfirmedAvailable === true) return true;
  if (lot.brokerConfirmedAvailable === false && lot.explicitManualLock === true) return false;

  const settleDate = lot.settleDate || calculateSettlementDate(lot.buyDate, holidays);
  const vnNow = toVnComponents(nowInput);
  if (vnNow.dateStr > settleDate) return true;
  if (vnNow.dateStr === settleDate) {
    // Theo hướng dẫn T+2: nếu cấu hình yêu cầu broker confirm thì kiểm tra thêm cờ hoặc từ 13:00 phiên chiều T+2
    if (lot.requireBrokerConfirm === true) return lot.brokerConfirmedAvailable === true;
    return vnNow.hhmm >= 1300;
  }
  return false;
}

/**
 * Tỷ trọng thời gian giao dịch trong ngày (dùng khi thiếu slot median cùng giờ)
 */
function getSessionElapsedWeight(timestamp = new Date()) {
  const vn = toVnComponents(timestamp);
  const t = vn.hhmm;
  if (t < 915) return 0.04;
  if (t <= 1130) {
    const mins = (vn.hour - 9) * 60 + (vn.minute - 15);
    return Math.max(0.06, Math.min(0.52, 0.05 + (mins / 135) * 0.47));
  }
  if (t < 1300) return 0.52;
  if (t <= 1430) {
    const mins = (vn.hour - 13) * 60 + vn.minute;
    return Math.max(0.52, Math.min(0.92, 0.52 + (mins / 90) * 0.40));
  }
  return 1.0;
}

module.exports = {
  toVnComponents,
  isHoliday,
  isTradingDay,
  sessionAt,
  isContinuousSession,
  isMarketOpenForOrder,
  addTradingDays,
  calculateSettlementDate,
  countTradingSessionsBetween,
  isLotSettledAt,
  getSessionElapsedWeight,
};
