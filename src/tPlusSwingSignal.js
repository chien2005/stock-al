/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  🇻🇳 VN STOCK BOT — T+ Swing Investment & Kiệt Bán Scanner   ║
 * ║  Phân tích Đầu tư Ngắn hạn (T+ 1-4 tuần) cho Rổ VN30 Quality  ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('./config');
const { fetchAllStocks, fetchVN30Index, fetchProprietaryTrading } = require('./stockService');
const { sendTelegramMessage } = require('./telegramService');
const { fetchOHLCV } = require('./derivativesOI');

/**
 * Danh sách cổ phiếu loại trừ (CP rủi ro, vướng vòng lao lý, không có trend/thanh khoản nát)
 */
const EXCLUDED_STOCKS = ['VNM', 'PNJ', 'NVL', 'FLC', 'ROS', 'SJ1', 'HQC'];

/**
 * Tính RSI (14 phiên)
 */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length <= period) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return parseFloat((100 - (100 / (1 + rs))).toFixed(1));
}

/**
 * Quét tín hiệu Kiệt Bán (Selling Exhaustion) & T+ Swing Signals cho 1 cổ phiếu
 */
async function scanTPlusSignal(stock, vnindexData) {
  const symbol = stock.symbol;
  if (EXCLUDED_STOCKS.includes(symbol)) return null;

  try {
    const ohlcv = await fetchOHLCV(symbol, 30);
    if (!ohlcv || !ohlcv.c || ohlcv.c.length < 15) return null;

    const len = ohlcv.c.length;
    const prices = ohlcv.c;
    const volumes = ohlcv.v;

    const currentPrice = prices[len - 1];
    const prevPrice = prices[len - 2];
    const dayChangePct = stock.changePct !== undefined ? stock.changePct : ((currentPrice - prevPrice) / prevPrice * 100);

    // Tính SMA20 Volume
    const volSub = volumes.slice(-20);
    const avgVol20 = volSub.reduce((a, b) => a + b, 0) / volSub.length;
    const currentVol = volumes[len - 1];
    const prevVol = volumes[len - 2];

    // Tính Relative Strength (RS) 1-4 tuần so với VN-Index
    const p1M = prices[0];
    const stockChange1M = ((currentPrice - p1M) / p1M * 100);
    
    let vn1M = -3.5;
    if (vnindexData && vnindexData.c && vnindexData.c.length > 0) {
      const vnLen = vnindexData.c.length;
      vn1M = ((vnindexData.c[vnLen - 1] - vnindexData.c[0]) / vnindexData.c[0] * 100);
    }
    const rsRating = stockChange1M - vn1M;

    // RSI
    const rsi = calculateRSI(prices);

    // ── 1. TÍN HIỆU KIỆT BÁN TÍCH CỰC (SELLING EXHAUSTION SURGE) ──
    // Định nghĩa: Phiên trước cạn vol (<85% avgVol20), phiên này giá giật tăng +1.8% -> +6.5%
    // chứng tỏ lực cung đã kiệt, chỉ cần lực mua nhỏ giá đã tăng mạnh.
    const isVolDriedBefore = prevVol < (avgVol20 * 0.85);
    const isPriceSurge = dayChangePct >= 1.8 && dayChangePct <= 6.5;
    const isSellingExhaustion = isVolDriedBefore && isPriceSurge;

    // ── 2. TÍN HIỆU POCKET PIVOT / BREAKOUT NỀN ──
    // Định nghĩa: Giá vượt đỉnh 5 phiên + Vol nổ > 130% avgVol20
    const highest5 = Math.max(...prices.slice(-6, -1));
    const isBreakout5 = currentPrice > highest5 && currentVol > (avgVol20 * 1.3);

    // ── 3. TÍN HIỆU GOM ÂM THẦM SMART MONEY (KHỐI NGOẠI & TỰ DOANH) ──
    const foreignNet = stock.foreignBuy - stock.foreignSell;
    const isForeignAccumulating = foreignNet > 500000; // Mua ròng > 500k cp

    // ── 4. TÍN HIỆU RSI OVERSOLD REBOUND ──
    const isRSIRebound = rsi < 42 && dayChangePct > 0.8;

    // Tổng hợp điểm tin cậy T+ (Score 1-10)
    let score = 5;
    const signals = [];

    if (isSellingExhaustion) {
      score += 2.5;
      signals.push('🔴 KIỆT BÁN TÍCH CỰC (Cạn cung bật tăng)');
    }
    if (isBreakout5) {
      score += 2.0;
      signals.push('⚡ POCKET PIVOT (Nổ Vol bứt cản 5 phiên)');
    }
    if (isForeignAccumulating) {
      score += 1.5;
      signals.push(`🟢 TÂY GOM ÂM THẦM (+${(foreignNet/1000).toFixed(0)}K cp)`);
    }
    if (rsRating > 2.0) {
      score += 1.0;
      signals.push(`💪 KHỎE HƠN VN-INDEX (RS +${rsRating.toFixed(1)}%)`);
    }
    if (isRSIRebound) {
      score += 1.0;
      signals.push(`🔵 RSI TỪ VÙNG THẤP NGÓC ĐẦU (${rsi})`);
    }

    return {
      symbol,
      price: currentPrice,
      changePct: parseFloat(dayChangePct.toFixed(2)),
      volume: currentVol,
      avgVol20: Math.round(avgVol20),
      rsi,
      rsRating: parseFloat(rsRating.toFixed(2)),
      foreignNet,
      isSellingExhaustion,
      isBreakout5,
      isForeignAccumulating,
      score: Math.min(10, parseFloat(score.toFixed(1))),
      signals,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Chạy Báo cáo Đầu tư Ngắn hạn T+ (20h30)
 */
async function runTPlusSwingReport() {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 ĐANG TẠO BÁO CÁO ĐẦU TƯ NGẮN HẠN T+ (20:30)...');
  console.log('═'.repeat(60));

  try {
    const [stocks, vnindexData] = await Promise.all([
      fetchAllStocks(),
      fetchOHLCV('VNINDEX', 30),
    ]);

    if (!stocks || stocks.length === 0) {
      console.error('❌ Không lấy được dữ liệu cổ phiếu!');
      return;
    }

    // Quét tín hiệu T+ cho tất cả mã danh mục
    const scanPromises = stocks.map(s => scanTPlusSignal(s, vnindexData));
    const scanResults = (await Promise.all(scanPromises)).filter(Boolean);

    // Sắp xếp theo Score T+ giảm dần
    scanResults.sort((a, b) => b.score - a.score);

    // Lọc nhóm Kiệt bán tích cực
    const exhaustionList = scanResults.filter(r => r.isSellingExhaustion);
    // Lọc nhóm Breakout / Smart Money gom
    const breakoutList = scanResults.filter(r => r.isBreakout5 || r.isForeignAccumulating);
    // Top 5 mã tiềm năng T+ nhất
    const topTPlus = scanResults.slice(0, 5);

    // Build Telegram HTML Report
    const todayStr = new Date().toLocaleDateString('vi-VN', { timeZone: config.timezone });
    let msg = `🎯 <b>BÁO CÁO ĐẦU TƯ NGẮN HẠN T+ (1 - 4 TUẦN)</b>\n`;
    msg += `📅 <i>Phiên ngày ${todayStr} | Khung thời gian nắm giữ T+</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

function formatVNDPrice(price) {
  if (!price || isNaN(price)) return '0 vnđ';
  const fullPrice = price < 1000 ? Math.round(price * 1000) : Math.round(price);
  return fullPrice.toLocaleString('vi-VN') + ' vnđ';
}

    // ── PHẦN 1: TÍNH HIỆU KIỆT BÁN TÍCH CỰC (SELLING EXHAUSTION) ──
    msg += `🔥 <b>1. PHÁT HIỆN CP KIỆT BÁN TÍCH CỰC (CẠN CUNG):</b>\n`;
    if (exhaustionList.length > 0) {
      for (const item of exhaustionList) {
        msg += `   • <b>${item.symbol}</b> (${formatVNDPrice(item.price)} | ${item.changePct >= 0 ? '+' : ''}${item.changePct}%)\n`;
        msg += `     <i>💡 Cạn cung phiên trước, lực mua nhỏ đẩy giá giật mạnh +${item.changePct}%. Khuyến nghị T+: Gom nền ngắn hạn.</i>\n`;
      }
    } else {
      msg += `   • <i>Hôm nay chưa có mã VN30 xuất hiện kiệt bán biến động giật cục. Danh mục giữ nền ổn định.</i>\n`;
    }
    msg += `\n`;

    // ── PHẦN 2: BẢNG XẾP HẠNG TIỀM NĂNG T+ (1-4 TUẦN) ──
    msg += `⭐ <b>2. TOP CỔ PHIẾU TIỀM NĂNG T+ (SCORE CAO NHẤT):</b>\n`;
    for (let i = 0; i < topTPlus.length; i++) {
      const item = topTPlus[i];
      const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🔹';
      msg += `${rankIcon} <b>${item.symbol}</b> | Giá: <b>${formatVNDPrice(item.price)}</b> (${item.changePct >= 0 ? '+' : ''}${item.changePct}%)\n`;
      msg += `   • <b>Điểm T+:</b> ${item.score}/10 | <b>RS vs VNINDEX:</b> ${item.rsRating >= 0 ? '+' : ''}${item.rsRating}%\n`;
      if (item.signals.length > 0) {
        msg += `   • <b>Tín hiệu:</b> ${item.signals.join(' | ')}\n`;
      }
      msg += `\n`;
    }

    // ── PHẦN 3: KHUYẾN NGHỊ CHIẾN LƯỢC TÁC CHIẾN T+ ──
    msg += `💡 <b>3. KHUYẾN NGHỊ CHIẾN LƯỢC TÁC CHIẾN T+:</b>\n`;
    msg += `   • <b>Khung nắm giữ:</b> Ưu tiên vị thế T+ 1 tuần đến 3-4 tuần.\n`;
    msg += `   • <b>Tỷ trọng đề xuất:</b> 50% Tiền mặt - 50% Cổ phiếu nòng cốt.\n`;
    msg += `   • <b>Quy tắc chốt lời / cắt lỗ T+:</b> Target kỳ vọng +7% đến +12%, Stoploss khi vi phạm -4%.\n`;
    msg += `   • <b>Mã ưu tiên hàng đầu:</b> ${topTPlus.slice(0, 3).map(t => t.symbol).join(', ')}\n\n`;

    msg += `<i>Báo cáo quét tự động 20:30 dựa trên Dữ liệu dòng tiền & Mô hình Cạn cung VN30.</i>`;

    // Gửi Telegram
    const sent = await sendTelegramMessage(msg);
    if (sent) {
      console.log('✅ Đã gửi Báo cáo Đầu tư Ngắn hạn T+ 20h30 thành công!');
    }
    return { scanResults, message: msg };
  } catch (err) {
    console.error('💥 Lỗi Báo cáo T+ Swing:', err.message);
    return null;
  }
}

module.exports = {
  scanTPlusSignal,
  runTPlusSwingReport,
};
