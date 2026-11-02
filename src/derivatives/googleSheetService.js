/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F — Google Sheets & Trading Journal Service          ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Ghi nhận nhật ký giao dịch tự động của AI Trader như người:  ║
 * ║  • Lưu trữ từng lệnh: Ngày, giờ vào/ra, điểm vào/ra,          ║
 * ║    Gross PnL, Phí (0.6đ/lệnh), Net PnL (thực tế sau phí),      ║
 * ║    Lý do vào/ra, Kết quả (Thắng/Thua).                         ║
 * ║  • Tổng kết cuối ngày: Tỉ lệ thắng (Win Rate), Tổng điểm thực ║
 * ║  • Hỗ trợ Webhook Google Apps Script (1-click deploy)         ║
 * ║  • Lưu trữ bền vững song song tại data/trades_history.json    ║
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
        'Hợp Đồng',
        'Lệnh #',
        'Vị Thế',
        'Giờ Vào',
        'Giá Vào',
        'Giờ Ra',
        'Giá Ra',
        'Điểm Thô (Gross)',
        'Phí Thuế (Fee)',
        'Điểm Thực (Net)',
        'Kết Quả',
        'Lý Do',
        'Tích Lũy Ngày',
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
 * Đồng bộ lệnh sang Google Sheets qua Webhook URL (Google Apps Script)
 * @param {object} payload - { action: 'appendTrade'|'appendSummary', data: object }
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
 * Ghi nhận một lệnh đã đóng hoàn chỉnh
 * @param {object} trade
 * {
 *   date: '02/11/2026',
 *   orderNum: 1,
 *   type: 'SHORT',
 *   entryPrice: 1865.6,
 *   exitPrice: 1858.9,
 *   entryTime: '09:30',
 *   exitTime: '10:15',
 *   grossPnL: 6.7,
 *   reason: 'Chốt lời TP2',
 *   cumulativeDayNetPnL: 6.1
 * }
 */
async function logTrade(trade) {
  const dateStr = trade.date || new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const grossPnL = +(trade.grossPnL !== undefined ? trade.grossPnL : (trade.type === 'LONG' ? (trade.exitPrice - trade.entryPrice) : (trade.entryPrice - trade.exitPrice))).toFixed(1);
  const fee = FEE_PER_TRADE;
  const netPnL = +(grossPnL - fee).toFixed(1);
  const isWin = netPnL > 0;
  const resultLabel = isWin ? 'THẮNG 🟢' : (netPnL === 0 ? 'HÒA 🟡' : 'THUA 🔴');

  const tradeRecord = {
    id: trade.id || trade.orderNum || 1,
    date: dateStr,
    contract: 'VN30F1M',
    orderNum: trade.orderNum || trade.id || 1,
    type: trade.type, // 'LONG' | 'SHORT'
    entryTime: trade.entryTime || 'N/A',
    entryPrice: parseFloat(Number(trade.entryPrice).toFixed(1)),
    exitTime: trade.exitTime || 'N/A',
    exitPrice: parseFloat(Number(trade.exitPrice).toFixed(1)),
    grossPnL,
    fee,
    netPnL,
    isWin,
    resultLabel,
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
    tradeRecord.contract,
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
    tradeRecord.reason,
    `${tradeRecord.cumulativeDayNetPnL >= 0 ? '+' : ''}${tradeRecord.cumulativeDayNetPnL.toFixed(1)}đ`,
  ];
  appendToCSV(csvRow);

  // 3. Đồng bộ sang Google Sheets Webhook
  const sheetResult = await syncToGoogleSheets({
    action: 'appendTrade',
    data: tradeRecord,
  });

  console.log(`   📊 [Trade Journal] Đã lưu Lệnh #${tradeRecord.orderNum} ${tradeRecord.type} @ ${tradeRecord.entryPrice} ➔ ${tradeRecord.exitPrice} | Net: ${tradeRecord.netPnL >= 0 ? '+' : ''}${tradeRecord.netPnL}đ (${tradeRecord.resultLabel}) [GoogleSheets: ${sheetResult.success ? 'OK' : 'Local Backup'}]`);

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
  const winRate = totalTrades > 0 ? +((winTrades / totalTrades) * 100).toFixed(1) : 0;
  const totalGrossPnL = +(summary.totalGrossPnL || 0).toFixed(1);
  const totalFees = +(totalTrades * FEE_PER_TRADE).toFixed(1);
  const totalNetPnL = +(totalGrossPnL - totalFees).toFixed(1);

  let evaluation = 'BẢO TOÀN VỐN 🛡️';
  if (totalNetPnL >= 6.0) evaluation = 'XUẤT SẮC 🔥';
  else if (totalNetPnL >= 3.0) evaluation = 'ĐẠT CHỈ TIÊU 🎯';
  else if (totalNetPnL < 0) evaluation = 'CẮT LỖ BẢO VỆ TÀI KHOẢN 🛑';

  const dailyRecord = {
    date: dateStr,
    totalTrades,
    winTrades,
    lossTrades,
    winRate: `${winRate}%`,
    totalGrossPnL,
    totalFees,
    totalNetPnL,
    evaluation,
    timestamp: Date.now(),
  };

  const history = loadTradeHistory();
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
  const { date, totalTrades, winTrades, lossTrades, winRate, totalGrossPnL, totalFees, totalNetPnL, evaluation } = summary;

  let msg = `📊 <b>BÁO CÁO NHẬT KÝ GIAO DỊCH VN30F1M</b>\n`;
  msg += `📅 <b>Ngày: ${date}</b> | Đánh giá: <b>${evaluation}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📈 <b>TỔNG QUAN HIỆU SUẤT TRONG NGÀY:</b>\n`;
  msg += `• Tổng số lệnh: <b>${totalTrades} lệnh</b> (Chuẩn: ≤ 4 lệnh/ngày)\n`;
  msg += `• Tỉ lệ thắng: <b>${winRate}</b> (<b>${winTrades}W</b> / <b>${lossTrades}L</b>)\n`;
  msg += `• Điểm thô (Gross): <b>${totalGrossPnL >= 0 ? '+' : ''}${totalGrossPnL.toFixed(1)}đ</b>\n`;
  msg += `• Phí & Thuế (0.6đ/lệnh): <b>-${totalFees.toFixed(1)}đ</b>\n`;
  msg += `• <b>LÃI/LỖ THỰC TẾ (NET PnL):</b> <b>${totalNetPnL >= 0 ? '🟢 +' : '🔴 '}${totalNetPnL.toFixed(1)}đ</b>\n\n`;

  if (trades.length > 0) {
    msg += `📝 <b>CHI TIẾT TỪNG LỆNH GIAO DỊCH:</b>\n`;
    trades.forEach(t => {
      const emoji = t.netPnL > 0 ? '🟢' : (t.netPnL === 0 ? '🟡' : '🔴');
      msg += `${emoji} <b>Lệnh #${t.orderNum || t.id}:</b> <b>${t.type}</b> @ <b>${t.entryPrice}</b> (${t.entryTime}) ➔ <b>${t.exitPrice}</b> (${t.exitTime})\n`;
      msg += `   └ Điểm thô: <b>${t.grossPnL >= 0 ? '+' : ''}${t.grossPnL}đ</b> | Thực nhận sau phí: <b>${t.netPnL >= 0 ? '+' : ''}${t.netPnL}đ</b> (${t.reason})\n`;
    });
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 <i>Dữ liệu tự động đồng bộ Google Sheets & Lưu trữ phục vụ backtest 1T - 3T - 6T.</i>`;

  return msg;
}

module.exports = {
  FEE_PER_TRADE,
  logTrade,
  logDailySummary,
  formatDailyTradingReport,
  loadTradeHistory,
  syncToGoogleSheets,
};
