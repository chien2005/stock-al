/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F — Google Sheets & Trading Journal Service (v8.2)   ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Ghi nhận nhật ký giao dịch tự động của AI Trader như người:  ║
 * ║  • Thời gian vào/ra chính xác đến từng Giờ:Phút:Giây (HH:mm:ss)║
 * ║  • Loại lệnh: LONG hoặc SHORT                                 ║
 * ║  • Giá vào, giá ra, lãi lỗ thô (Gross), phí (0.6đ), Net PnL   ║
 * ║  • Cột đánh giá: TP (+X.Xđ) hoặc SL (-X.Xđ)                   ║
 * ║  • Cột tổng ngày đến thời điểm đó (lũy kế điểm Net)          ║
 * ║  • Cuối ngày: Âm hay dương bao nhiêu điểm                     ║
 * ║  • Tỉ lệ Win Rate đa khung: Ngày, Tuần, Tháng, All-Time       ║
 * ║  • Tự động đồng bộ Webhook Google Apps Script + JSON/CSV      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { config } = require('../config');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TRADES_HISTORY_FILE = path.join(DATA_DIR, 'trades_history.json');
const TRADES_CSV_FILE = path.join(DATA_DIR, 'trades_history.csv');

// Phí giao dịch cố định 1 vòng lệnh (Mở + Đóng vị thế) = 0.6 điểm
const FEE_PER_TRADE = 0.6;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Đọc toàn bộ lịch sử lệnh từ local file
 */
function loadTradeHistory() {
  ensureDataDir();
  try {
    if (fs.existsSync(TRADES_HISTORY_FILE)) {
      const raw = fs.readFileSync(TRADES_HISTORY_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('⚠️ [GoogleSheetService] Lỗi đọc trades_history.json:', err.message);
  }
  return { trades: [], dailySummaries: [] };
}

/**
 * Lưu lịch sử lệnh ra local file
 */
function saveTradeHistory(history) {
  ensureDataDir();
  try {
    fs.writeFileSync(TRADES_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('⚠️ [GoogleSheetService] Lỗi ghi trades_history.json:', err.message);
    return false;
  }
}

/**
 * Ghi 1 dòng vào file CSV backup
 */
function appendToCSV(rowArray) {
  ensureDataDir();
  try {
    const isNew = !fs.existsSync(TRADES_CSV_FILE);
    const line = rowArray.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
    if (isNew) {
      const header = [
        'Ngày',
        'Lệnh #',
        'Loại lệnh',
        'Giờ vào (HH:mm:ss)',
        'Giá vào',
        'Giờ ra (HH:mm:ss)',
        'Giá ra',
        'Lãi/Lỗ thô',
        'Phí (0.6đ)',
        'LÃI/LỖ THỰC (Net)',
        'Đánh giá (TP/SL)',
        'Tổng ngày đến lúc này',
        'Lý do đóng lệnh',
      ].join(',') + '\n';
      fs.writeFileSync(TRADES_CSV_FILE, '\uFEFF' + header + line, 'utf8'); // UTF-8 BOM cho Excel mở tiếng Việt chuẩn
    } else {
      fs.appendFileSync(TRADES_CSV_FILE, line, 'utf8');
    }
  } catch (err) {
    console.error('⚠️ [GoogleSheetService] Lỗi ghi CSV:', err.message);
  }
}

/**
 * Đồng bộ sang Google Sheets qua Webhook URL (Google Apps Script)
 * @param {object} payload - { action: 'appendTrade'|'appendDailySummary', data: object }
 */
async function syncToGoogleSheets(payload) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL || config.googleSheetWebhookUrl;
  if (!webhookUrl) {
    return { success: false, reason: 'Chưa cấu hình GOOGLE_SHEET_WEBHOOK_URL' };
  }

  try {
    const res = await axios.post(webhookUrl, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
    return { success: true, response: res.data };
  } catch (err) {
    console.error('⚠️ [GoogleSheetService] Lỗi gửi Webhook Google Sheets:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Chuẩn hóa chuỗi ngày tháng về dạng chuẩn DD/MM/YYYY (2 chữ số ngày và tháng)
 */
function normalizeDateStr(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const parts = dateInput.split('/');
    if (parts.length === 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
  }
  const d = new Date(dateInput);
  if (!isNaN(d.getTime())) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  return String(dateInput);
}

/**
 * Tính toán Win Rate đa khung thời gian:
 * 1. Win Rate Hôm Nay (Ngày)
 * 2. Win Rate Tuần Này (Thứ 2 đến Chủ Nhật)
 * 3. Win Rate Tháng Này
 * 4. Win Rate Đến Thời Điểm Hiện Tại (All-Time)
 */
function calculateMultiTimeframeWinRates(allTrades = [], currentDateStr = null) {
  const todayStr = normalizeDateStr(currentDateStr || new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

  function parseDate(str, ts) {
    if (ts && typeof ts === 'number') return new Date(ts);
    if (!str) return new Date();
    const parts = str.split('/');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
    return new Date();
  }

  const now = parseDate(todayStr);

  function isSameWeek(d1, d2) {
    const getMonday = (d) => {
      const date = new Date(d);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const m = new Date(date.setDate(diff));
      m.setHours(0, 0, 0, 0);
      return m.getTime();
    };
    return getMonday(d1) === getMonday(d2);
  }

  function isSameMonth(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
  }

  let dayWins = 0, dayTotal = 0;
  let weekWins = 0, weekTotal = 0;
  let monthWins = 0, monthTotal = 0;
  let allWins = 0, allTotal = 0;

  for (const t of allTrades) {
    const tNormDate = normalizeDateStr(t.date);
    const tDate = parseDate(tNormDate, t.timestamp);
    const isWin = (t.netPnL !== undefined ? t.netPnL : (t.grossPnL - FEE_PER_TRADE)) > 0;

    // All-time
    allTotal++;
    if (isWin) allWins++;

    // Month
    if (isSameMonth(tDate, now)) {
      monthTotal++;
      if (isWin) monthWins++;
    }

    // Week
    if (isSameWeek(tDate, now)) {
      weekTotal++;
      if (isWin) weekWins++;
    }

    // Day
    if (tNormDate === todayStr) {
      dayTotal++;
      if (isWin) dayWins++;
    }
  }

  return {
    day: {
      wins: dayWins,
      losses: dayTotal - dayWins,
      total: dayTotal,
      rate: dayTotal > 0 ? +((dayWins / dayTotal) * 100).toFixed(1) : 0,
      rateStr: dayTotal > 0 ? `${((dayWins / dayTotal) * 100).toFixed(1)}%` : '0%',
    },
    week: {
      wins: weekWins,
      losses: weekTotal - weekWins,
      total: weekTotal,
      rate: weekTotal > 0 ? +((weekWins / weekTotal) * 100).toFixed(1) : 0,
      rateStr: weekTotal > 0 ? `${((weekWins / weekTotal) * 100).toFixed(1)}%` : '0%',
    },
    month: {
      wins: monthWins,
      losses: monthTotal - monthWins,
      total: monthTotal,
      rate: monthTotal > 0 ? +((monthWins / monthTotal) * 100).toFixed(1) : 0,
      rateStr: monthTotal > 0 ? `${((monthWins / monthTotal) * 100).toFixed(1)}%` : '0%',
    },
    allTime: {
      wins: allWins,
      losses: allTotal - allWins,
      total: allTotal,
      rate: allTotal > 0 ? +((allWins / allTotal) * 100).toFixed(1) : 0,
      rateStr: allTotal > 0 ? `${((allWins / allTotal) * 100).toFixed(1)}%` : '0%',
    },
  };
}

/**
 * Ghi nhận một lệnh đã đóng hoàn chỉnh
 * @param {object} trade
 */
async function logTrade(trade) {
  const dateStr = normalizeDateStr(trade.date || new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const grossPnL = +(trade.grossPnL !== undefined ? trade.grossPnL : (trade.type === 'LONG' ? (trade.exitPrice - trade.entryPrice) : (trade.entryPrice - trade.exitPrice))).toFixed(1);
  const fee = FEE_PER_TRADE;
  const netPnL = +(grossPnL - fee).toFixed(1);
  const isWin = netPnL > 0;

  // Cột đánh giá chỉ ghi là TP hay SL bao nhiêu điểm: ví dụ TP (+6.4đ) hoặc SL (-3.1đ)
  let resultLabel = 'HÒA (0.0đ)';
  if (netPnL > 0) {
    resultLabel = `TP (+${netPnL.toFixed(1)}đ)`;
  } else if (netPnL < 0) {
    resultLabel = `SL (${netPnL.toFixed(1)}đ)`;
  }

  const tradeRecord = {
    id: trade.id || trade.orderNum || 1,
    orderNum: trade.orderNum || trade.id || 1,
    date: dateStr,
    contract: 'VN30F1M',
    type: trade.type, // 'LONG' | 'SHORT'
    entryTime: trade.entryTime || 'N/A', // HH:mm:ss
    entryPrice: parseFloat(Number(trade.entryPrice).toFixed(1)),
    exitTime: trade.exitTime || 'N/A',   // HH:mm:ss
    exitPrice: parseFloat(Number(trade.exitPrice).toFixed(1)),
    grossPnL,
    fee,
    netPnL,
    isWin,
    resultLabel, // 'TP (+6.4đ)' hoặc 'SL (-3.1đ)'
    reason: trade.reason || 'Đóng lệnh theo tín hiệu hệ thống',
    cumulativeDayNetPnL: +(trade.cumulativeDayNetPnL !== undefined ? trade.cumulativeDayNetPnL : netPnL).toFixed(1),
    timestamp: Date.now(),
  };

  // 1. Lưu vào file JSON local
  const history = loadTradeHistory();
  history.trades.push(tradeRecord);
  saveTradeHistory(history);

  // 2. Ghi vào file CSV local
  const csvRow = [
    tradeRecord.date,
    `Lệnh #${tradeRecord.orderNum}`,
    tradeRecord.type,
    tradeRecord.entryTime,
    tradeRecord.entryPrice.toFixed(1),
    tradeRecord.exitTime,
    tradeRecord.exitPrice.toFixed(1),
    `${tradeRecord.grossPnL >= 0 ? '+' : ''}${tradeRecord.grossPnL.toFixed(1)}đ`,
    `-${tradeRecord.fee.toFixed(1)}đ`,
    `${tradeRecord.netPnL >= 0 ? '+' : ''}${tradeRecord.netPnL.toFixed(1)}đ`,
    tradeRecord.resultLabel,
    `${tradeRecord.cumulativeDayNetPnL >= 0 ? '+' : ''}${tradeRecord.cumulativeDayNetPnL.toFixed(1)}đ`,
    tradeRecord.reason,
  ];
  appendToCSV(csvRow);

  // 3. Đồng bộ sang Google Sheets Webhook
  const sheetResult = await syncToGoogleSheets({
    action: 'appendTrade',
    data: tradeRecord,
  });

  console.log(`   📊 [Trade Journal] Đã lưu Lệnh #${tradeRecord.orderNum} ${tradeRecord.type} @ ${tradeRecord.entryPrice} (${tradeRecord.entryTime}) ➔ ${tradeRecord.exitPrice} (${tradeRecord.exitTime}) | Net: ${tradeRecord.netPnL >= 0 ? '+' : ''}${tradeRecord.netPnL}đ [${tradeRecord.resultLabel}] [GoogleSheets: ${sheetResult.success ? 'OK' : 'Local Backup'}]`);

  return tradeRecord;
}

/**
 * Ghi nhận tổng kết ngày (Daily Summary)
 */
async function logDailySummary(summary) {
  const dateStr = summary.date || new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const totalTrades = summary.totalTrades || 0;
  const winTrades = summary.winTrades || 0;
  const lossTrades = summary.lossTrades || 0;
  const totalGrossPnL = +(summary.totalGrossPnL || 0).toFixed(1);
  const totalFees = +(totalTrades * FEE_PER_TRADE).toFixed(1);
  const totalNetPnL = +(totalGrossPnL - totalFees).toFixed(1);

  // Tính Win Rate đa khung: ngày, tuần, tháng, all-time
  const history = loadTradeHistory();
  const multiWinRates = calculateMultiTimeframeWinRates(history.trades, dateStr);

  // Cột đánh giá chỉ ghi là TP hay SL bao nhiêu điểm cuối ngày
  let evaluation = 'HÒA (0.0đ)';
  if (totalNetPnL > 0) {
    evaluation = `TP (+${totalNetPnL.toFixed(1)}đ)`;
  } else if (totalNetPnL < 0) {
    evaluation = `SL (${totalNetPnL.toFixed(1)}đ)`;
  }

  // Lũy kế Net toàn bộ lịch sử từ trước tới nay
  const cumulativeAllTimeNetPnL = +(history.trades.reduce((s, t) => s + (t.netPnL || 0), 0)).toFixed(1);

  const dailyRecord = {
    date: dateStr,
    totalTrades,
    winTrades,
    lossTrades,
    winRate: multiWinRates.day.rateStr,
    winRateDay: multiWinRates.day.rateStr,
    winRateWeek: multiWinRates.week.rateStr,
    winRateMonth: multiWinRates.month.rateStr,
    winRateAllTime: multiWinRates.allTime.rateStr,
    totalGrossPnL,
    totalFees,
    totalNetPnL,
    cumulativeAllTimeNetPnL,
    evaluation,
    timestamp: Date.now(),
  };

  const existingIdx = history.dailySummaries.findIndex(d => d.date === dateStr);
  if (existingIdx >= 0) {
    history.dailySummaries[existingIdx] = dailyRecord;
  } else {
    history.dailySummaries.push(dailyRecord);
  }
  saveTradeHistory(history);

  // Đồng bộ sang Google Sheets
  await syncToGoogleSheets({
    action: 'appendDailySummary',
    data: dailyRecord,
  });

  return dailyRecord;
}

/**
 * Format tin nhắn báo cáo tổng kết cuối ngày gửi Telegram
 */
function formatDailyTradingReport(summary, trades = []) {
  const {
    date,
    totalTrades,
    winTrades,
    lossTrades,
    winRateDay,
    winRateWeek,
    winRateMonth,
    winRateAllTime,
    totalGrossPnL,
    totalFees,
    totalNetPnL,
    evaluation,
  } = summary;

  const netEmoji = totalNetPnL >= 0 ? '🟢' : '🔴';

  let msg = `📊 <b>BÁO CÁO NHẬT KÝ GIAO DỊCH VN30F1M</b>\n`;
  msg += `📅 <b>Ngày: ${date}</b> | Đánh giá ngày: <b>${evaluation}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📈 <b>TỔNG QUAN HIỆU SUẤT TRONG NGÀY:</b>\n`;
  msg += `• Tổng số lệnh: <b>${totalTrades} lệnh</b> (Chuẩn: ≤ 4 lệnh/ngày)\n`;
  msg += `• Điểm thô (Gross): <b>${totalGrossPnL >= 0 ? '+' : ''}${Number(totalGrossPnL).toFixed(1)}đ</b>\n`;
  msg += `• Phí & Thuế (0.6đ/lệnh): <b>-${Number(totalFees).toFixed(1)}đ</b>\n`;
  msg += `• <b>LÃI/LỖ THỰC TẾ (NET):</b> <b>${netEmoji} ${totalNetPnL >= 0 ? '+' : ''}${Number(totalNetPnL).toFixed(1)}đ</b>\n\n`;

  msg += `🎯 <b>TỈ LỆ THẮNG (WIN RATE ĐA KHUNG):</b>\n`;
  msg += `• 📅 <b>Hôm nay:</b> <b>${winRateDay || summary.winRate || '0%'}</b> (<b>${winTrades}W</b> / <b>${lossTrades}L</b>)\n`;
  if (winRateWeek) msg += `• 📆 <b>Tuần này:</b> <b>${winRateWeek}</b>\n`;
  if (winRateMonth) msg += `• 🗓️ <b>Tháng này:</b> <b>${winRateMonth}</b>\n`;
  if (winRateAllTime) msg += `• 🏆 <b>Đến hiện tại (All-time):</b> <b>${winRateAllTime}</b>\n`;
  msg += `\n`;

  if (trades.length > 0) {
    msg += `📝 <b>CHI TIẾT TỪNG LỆNH GIAO DỊCH:</b>\n`;
    trades.forEach(t => {
      const emoji = t.netPnL > 0 ? '🟢' : (t.netPnL === 0 ? '🟡' : '🔴');
      msg += `${emoji} <b>Lệnh #${t.orderNum || t.id}:</b> <b>${t.type}</b>\n`;
      msg += `   • Vào: <b>${t.entryPrice}</b> (${t.entryTime}) ➔ Ra: <b>${t.exitPrice}</b> (${t.exitTime})\n`;
      msg += `   • Thô: <b>${t.grossPnL >= 0 ? '+' : ''}${t.grossPnL}đ</b> | Phí: <b>-${t.fee}đ</b> | Thực nhận: <b>${t.netPnL >= 0 ? '+' : ''}${t.netPnL}đ</b>\n`;
      msg += `   • Đánh giá: <b>${t.resultLabel}</b> | Tổng ngày: <b>${t.cumulativeDayNetPnL >= 0 ? '+' : ''}${t.cumulativeDayNetPnL}đ</b> (${t.reason})\n`;
    });
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 <i>Dữ liệu tự động đồng bộ Google Sheets phục vụ backtest 1T - 3T - 6T.</i>`;

  return msg;
}

module.exports = {
  FEE_PER_TRADE,
  logTrade,
  logDailySummary,
  calculateMultiTimeframeWinRates,
  formatDailyTradingReport,
  loadTradeHistory,
  saveTradeHistory,
  syncToGoogleSheets,
};
