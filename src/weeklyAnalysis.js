/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     📅 VN STOCK TRACKER - Weekly Market Analysis              ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Phân tích tình hình TTCK đầu tuần (Thứ 2, 8h30)             ║
 * ║  - Tổng quan thị trường tuần trước                            ║
 * ║  - Dự đoán xu hướng tuần mới                                 ║
 * ║  - Kế hoạch mua/bán                                          ║
 * ║  - Cảnh báo sóng, bán tháo, thanh khoản                      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { config } = require('./config');
const { fetchAllStocks } = require('./stockService');

/**
 * Chạy phân tích thị trường đầu tuần
 * @returns {string} HTML report cho Telegram
 */
async function runWeeklyAnalysis() {
  console.log('\n📅 PHÂN TÍCH THỊ TRƯỜNG ĐẦU TUẦN...');

  // Lấy dữ liệu hiện tại (giá cuối phiên thứ 6 tuần trước)
  const stocks = await fetchAllStocks();

  if (stocks.length === 0 || stocks.every(s => s.error)) {
    return '⚠️ Không lấy được dữ liệu thị trường để phân tích tuần mới.';
  }

  const validStocks = stocks.filter(s => !s.error);
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  // Chuẩn bị dữ liệu tổng quan
  const stockSummary = validStocks.map(s => {
    const parts = [
      `${s.symbol}:`,
      `Giá=${s.price}đ`,
      `ThayĐổi=${s.changePct}%`,
      `KLGD=${s.volume}`,
      `KLTB20=${s.avgVolume}`,
      `NNRòng=${s.foreignNet}`,
      `SMA20=${s.sma20}đ`,
    ];
    if (s.historyPrices && s.historyPrices.length > 0) {
      parts.push(`Giá5phiên=[${s.historyPrices.join(',')}]`);
    }
    return parts.join(' | ');
  }).join('\n');

  // Tính metrics tổng quan
  const avgChange = validStocks.reduce((sum, s) => sum + s.changePct, 0) / validStocks.length;
  const totalVolume = validStocks.reduce((sum, s) => sum + s.volume, 0);
  const totalAvgVolume = validStocks.reduce((sum, s) => sum + s.avgVolume, 0);
  const totalForeignNet = validStocks.reduce((sum, s) => sum + (s.foreignNet || 0), 0);
  const gainers = validStocks.filter(s => s.changePct > 0).length;
  const losers = validStocks.filter(s => s.changePct < 0).length;

  if (!config.geminiAI1.apiKey) {
    console.log('⚠️ Không có GEMINI_API_KEY_AI1, dùng báo cáo chung chung...');
    return buildBasicWeeklyReport(validStocks, now, avgChange, totalVolume, totalAvgVolume, totalForeignNet, gainers, losers);
  }

  try {
    const genAI = new GoogleGenerativeAI(config.geminiAI1.apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Bạn là CHIẾN LƯỢC GIA THỊ TRƯỜNG chứng khoán Việt Nam. Đây là sáng THỨ HAI, đầu tuần mới. 
Nhiệm vụ: Phân tích tổng quan và lên kế hoạch giao dịch cho tuần mới.

DỮ LIỆU CUỐI PHIÊN THỨ 6 TUẦN TRƯỚC:
${stockSummary}

TỔNG QUAN:
- TB thayĐổi: ${avgChange.toFixed(2)}%
- Tổng KLGD: ${totalVolume.toLocaleString()}
- Tổng KLTB20: ${totalAvgVolume.toLocaleString()}  
- Tỷ lệ KL/KLTB: ${totalAvgVolume > 0 ? (totalVolume / totalAvgVolume * 100).toFixed(0) : 'N/A'}%
- Khối ngoại ròng tổng: ${totalForeignNet.toLocaleString()}
- Tăng: ${gainers}/${validStocks.length} | Giảm: ${losers}/${validStocks.length}

YÊU CẦU PHÂN TÍCH:
1. 📊 TỔNG QUAN THỊ TRƯỜNG TUẦN TRƯỚC (3-4 dòng)
   - Xu hướng chung, tâm lý thị trường
   - Thanh khoản cao/thấp so với TB?
   - Khối ngoại mua/bán ròng → xu hướng gì?

2. 🔮 DỰ ĐOÁN TUẦN MỚI (3-4 dòng)  
   - Có sóng nào không? Sóng ngành nào?
   - Thị trường có đang bán tháo hay tích lu?
   - Penny hay blue-chip đang dẫn dắt?

3. 📋 KẾ HOẠCH GIAO DỊCH TUẦN NÀY
   - Top 3-5 mã NÊN MUA (lý do ngắn)
   - Top 3-5 mã NÊN BÁN / CHỐT LỜI (lý do ngắn)
   - Mã NÊN THEO DÕI sát

4. ⚠️ CẢNH BÁO (nếu có)
   - Rủi ro bán tháo?
   - Thanh khoản cạn?
   - Tin vĩ mô cần chú ý?

FORMAT: Tiếng Việt, emoji, rõ ràng. Dùng ** để bold. Ngắn gọn nhưng đầy đủ. Tối đa 800 chữ.`;

    console.log('🤖 Đang gọi Gemini phân tích tuần mới...');
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    if (!text || text.trim().length === 0) {
      return buildBasicWeeklyReport(validStocks, now, avgChange, totalVolume, totalAvgVolume, totalForeignNet, gainers, losers);
    }

    const htmlText = text
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/```[\s\S]*?```/g, '')
      .trim();

    let report = '';
    report += `📅 <b>PHÂN TÍCH THỊ TRƯỜNG ĐẦU TUẦN</b>\n`;
    report += `🗓 <i>${now}</i>\n`;
    report += `🤖 <i>AI Market Strategist</i>\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    report += htmlText;
    report += `\n\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `<i>⚠️ Khuyến nghị tham khảo, không phải lời khuyên đầu tư.</i>\n`;
    report += `<i>📡 VN Stock Bot v1.1.1 | 🤖 Gemini AI</i>`;

    return report;
  } catch (error) {
    console.error('❌ Lỗi phân tích tuần:', error.message);
    return buildBasicWeeklyReport(validStocks, now, avgChange, totalVolume, totalAvgVolume, totalForeignNet, gainers, losers);
  }
}

/**
 * Report đầu tuần cơ bản (fallback khi không có Gemini)
 */
function buildBasicWeeklyReport(stocks, now, avgChange, totalVolume, totalAvgVolume, totalForeignNet, gainers, losers) {
  let msg = '';
  msg += `📅 <b>BÁO CÁO ĐẦU TUẦN</b>\n`;
  msg += `🗓 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 <b>TỔNG QUAN:</b>\n`;
  msg += `   TB thay đổi: ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%\n`;
  msg += `   Tăng: ${gainers} | Giảm: ${losers}\n`;
  msg += `   Tổng KLGD: ${(totalVolume / 1000000).toFixed(2)}M\n`;
  if (totalAvgVolume > 0) {
    msg += `   KL vs TB: ${(totalVolume / totalAvgVolume * 100).toFixed(0)}%\n`;
  }
  msg += `   NN ròng: ${totalForeignNet > 0 ? '+' : ''}${(totalForeignNet / 1000).toFixed(1)}K\n`;
  msg += `\n`;

  // Top tăng/giảm
  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
  const top3 = sorted.slice(0, 3);
  const bottom3 = sorted.slice(-3).reverse();

  msg += `🟢 <b>Top tăng tuần trước:</b>\n`;
  for (const s of top3) {
    msg += `   ${s.symbol}: +${s.changePct}%\n`;
  }

  msg += `🔴 <b>Top giảm tuần trước:</b>\n`;
  for (const s of bottom3) {
    msg += `   ${s.symbol}: ${s.changePct}%\n`;
  }

  msg += `\n<i>💡 Thêm GEMINI_API_KEY để có phân tích AI chi tiết hơn.</i>\n`;
  msg += `<i>📡 VN Stock Bot v1.1.1</i>`;

  return msg;
}

module.exports = { runWeeklyAnalysis };
