/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║       🤖 VN STOCK TRACKER - AI Analysis Service          ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║  Phân tích cổ phiếu cuối ngày bằng Google Gemini AI     ║
 * ║  + Rule-based Technical Analysis (fallback)              ║
 * ║                                                           ║
 * ║  Khuyến nghị: MUA / BÁN / NẮM GIỮ / THEO DÕI           ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { config } = require('./config');

// ─── GEMINI AI ANALYSIS ────────────────────────────────────

/**
 * Phân tích cổ phiếu bằng Google Gemini AI
 * @param {Array} stocks - Danh sách stock data đã format
 * @returns {string} AI analysis report (HTML format cho Telegram)
 */
async function analyzeWithGemini(stocks) {
  if (!config.geminiAI1.apiKey) {
    console.log('⚠️  Không có GEMINI_API_KEY_AI1, dùng phân tích rule-based...');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(config.geminiAI1.apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Chuẩn bị dữ liệu cho AI
    const stockDataText = stocks
      .filter(s => !s.error)
      .map(s => {
        const parts = [
          `${s.symbol}:`,
          `Giá=${s.price}đ`,
          `ThayĐổi=${s.changePct}%`,
          `TC=${s.refPrice}đ`,
          `Trần=${s.ceilingPrice}đ`,
          `Sàn=${s.floorPrice}đ`,
          `Mở=${s.openPrice}đ`,
          `Cao=${s.highPrice}đ`,
          `Thấp=${s.lowPrice}đ`,
          `KLGD=${s.volume}`,
          `KLTB20=${s.avgVolume}`,
          `NNMua=${s.foreignBuy}`,
          `NNBán=${s.foreignSell}`,
          `NNRòng=${s.foreignNet}`,
          `SMA20=${s.sma20}đ`,
          `Sàn=${s.exchange}`,
        ];
        // Thêm lịch sử giá nếu có
        if (s.historyPrices) {
          parts.push(`LịchSử5Ngày=[${s.historyPrices.join(',')}]`);
        }
        return parts.join(' | ');
      })
      .join('\n');

    const prompt = `Bạn là chuyên gia phân tích chứng khoán Việt Nam. Dựa vào dữ liệu SAU PHIÊN GIAO DỊCH hôm nay, hãy phân tích NGẮN GỌN từng mã cổ phiếu và đưa ra khuyến nghị.

DỮ LIỆU:
${stockDataText}

YÊU CẦU:
1. Phân tích NGẮN GỌN cho TỪNG mã (2-3 dòng/mã)
2. Đánh giá: [MUA] [BÁN] [NẮM GIỮ] [THEO DÕI]
3. Đặc biệt cảnh báo nếu:
   - Giá thay đổi bất thường (>3% hoặc <-3%)
   - Khối lượng GD cao bất thường so với trung bình
   - Khối ngoại mua/bán ròng mạnh
   - Giá dưới SMA20 (xu hướng giảm)
   - Giá gần trần hoặc sàn
4. Cuối cùng tổng kết xu hướng thị trường chung (2-3 dòng)

FORMAT RESPONSE:
- Dùng emoji phù hợp
- Viết bằng tiếng Việt
- Mỗi mã bắt đầu bằng mã CP in đậm (dùng ** để bold)
- Khuyến nghị đặt trong dấu [ ]
- Ngắn gọn, đi thẳng vào vấn đề, KHÔNG dài dòng`;

    console.log('🤖 Đang gọi Gemini AI phân tích...');
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    if (!text || text.trim().length === 0) {
      console.error('⚠️  Gemini trả về kết quả rỗng');
      return null;
    }

    console.log(`✅ Gemini phân tích xong (${text.length} chars)`);

    // Convert markdown bold to HTML bold cho Telegram
    const htmlText = text
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .trim();

    return htmlText;
  } catch (error) {
    console.error('❌ Lỗi Gemini AI:', error.message);
    return null;
  }
}

// ─── RULE-BASED ANALYSIS (FALLBACK) ───────────────────────

/**
 * Phân tích cổ phiếu bằng rules kỹ thuật (khi không có Gemini)
 * @param {Array} stocks - Danh sách stock data
 * @returns {string} HTML formatted analysis
 */
function analyzeWithRules(stocks) {
  const validStocks = stocks.filter(s => !s.error);
  const analyses = [];

  for (const s of validStocks) {
    const signals = [];
    let recommendation = 'NẮM GIỮ';
    let urgency = 0; // -3 (bán mạnh) → +3 (mua mạnh)

    // 1. Biến động giá bất thường
    if (s.changePct >= 5) {
      signals.push('🚀 Tăng rất mạnh - có thể chốt lời 1 phần');
      urgency -= 1;
    } else if (s.changePct >= 3) {
      signals.push('📈 Tăng mạnh - momentum tốt');
      urgency += 1;
    } else if (s.changePct <= -5) {
      signals.push('💥 Giảm sâu - CẢNH BÁO! Xem xét cắt lỗ');
      urgency -= 2;
    } else if (s.changePct <= -3) {
      signals.push('📉 Giảm mạnh - theo dõi sát');
      urgency -= 1;
    }

    // 2. Khối lượng vs trung bình
    if (s.avgVolume > 0) {
      const volRatio = s.volume / s.avgVolume;
      if (volRatio > 2.5) {
        signals.push(`🔥 KL đột biến (${(volRatio).toFixed(1)}x TB) - tín hiệu mạnh`);
        if (s.changePct > 0) urgency += 1;
        else urgency -= 1;
      } else if (volRatio > 1.5) {
        signals.push(`📊 KL cao hơn TB (${(volRatio).toFixed(1)}x)`);
      } else if (volRatio < 0.5) {
        signals.push('📉 KL thấp bất thường - thanh khoản kém');
      }
    }

    // 3. Khối ngoại
    if (s.foreignNet > 100000) {
      signals.push(`💚 NN mua ròng mạnh (+${fmtVol(s.foreignNet)}) - tín hiệu tích cực`);
      urgency += 1;
    } else if (s.foreignNet < -100000) {
      signals.push(`💔 NN bán ròng mạnh (${fmtVol(s.foreignNet)}) - cảnh báo`);
      urgency -= 1;
    }

    // 4. SMA20 (xu hướng)
    if (s.sma20 > 0) {
      if (s.price > s.sma20 * 1.05) {
        signals.push('⬆️ Vượt SMA20 xa - xu hướng tăng mạnh');
        urgency += 1;
      } else if (s.price > s.sma20) {
        signals.push('⬆️ Trên SMA20 - xu hướng tăng');
      } else if (s.price < s.sma20 * 0.95) {
        signals.push('⬇️ Dưới SMA20 xa - xu hướng giảm mạnh');
        urgency -= 1;
      } else if (s.price < s.sma20) {
        signals.push('⬇️ Dưới SMA20 - xu hướng giảm');
        urgency -= 1;
      }
    }

    // 5. Giá gần trần/sàn
    if (s.ceilingPrice > 0 && s.price >= s.ceilingPrice * 0.99) {
      signals.push('🟣 Giá gần TRẦN - áp lực chốt lời cao');
    }
    if (s.floorPrice > 0 && s.price <= s.floorPrice * 1.01) {
      signals.push('🔵 Giá gần SÀN - hoảng loạn bán tháo?');
      urgency -= 1;
    }

    // 6. Spread (High - Low) rộng
    if (s.highPrice > 0 && s.lowPrice > 0) {
      const range = ((s.highPrice - s.lowPrice) / s.lowPrice * 100).toFixed(1);
      if (range > 5) {
        signals.push(`⚡ Biên độ rộng (${range}%) - volatility cao`);
      }
    }

    // Xác định khuyến nghị
    if (urgency >= 2) recommendation = 'MUA';
    else if (urgency === 1) recommendation = 'THEO DÕI MUA';
    else if (urgency <= -2) recommendation = 'BÁN';
    else if (urgency === -1) recommendation = 'THEO DÕI';

    const recIcon = {
      'MUA': '🟢',
      'THEO DÕI MUA': '🔵',
      'NẮM GIỮ': '🟡',
      'THEO DÕI': '🟠',
      'BÁN': '🔴',
    };

    analyses.push({
      symbol: s.symbol,
      recommendation,
      urgency,
      icon: recIcon[recommendation] || '🟡',
      signals,
      changePct: s.changePct,
      price: s.price,
    });
  }

  return formatAnalysisReport(analyses);
}

/**
 * Format rule-based analysis thành HTML report
 */
function formatAnalysisReport(analyses) {
  let msg = '';

  for (const a of analyses) {
    const sign = a.changePct >= 0 ? '+' : '';
    msg += `${a.icon} <b>${a.symbol}</b> [${a.recommendation}]`;
    msg += ` ${sign}${a.changePct}%\n`;

    if (a.signals.length > 0) {
      for (const sig of a.signals) {
        msg += `   ${sig}\n`;
      }
    } else {
      msg += `   Không có tín hiệu đặc biệt\n`;
    }
    msg += `\n`;
  }

  // Tổng kết
  const buy = analyses.filter(a => a.recommendation === 'MUA' || a.recommendation === 'THEO DÕI MUA');
  const sell = analyses.filter(a => a.recommendation === 'BÁN');
  const hold = analyses.filter(a => a.recommendation === 'NẮM GIỮ');

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 <b>TỔNG KẾT KHUYẾN NGHỊ:</b>\n`;
  if (buy.length > 0) msg += `🟢 Mua: ${buy.map(b => b.symbol).join(', ')}\n`;
  if (sell.length > 0) msg += `🔴 Bán: ${sell.map(b => b.symbol).join(', ')}\n`;
  if (hold.length > 0) msg += `🟡 Giữ: ${hold.map(b => b.symbol).join(', ')}\n`;

  // Đánh giá thị trường
  const avgChange = analyses.reduce((sum, a) => sum + a.changePct, 0) / analyses.length;
  const bullish = analyses.filter(a => a.changePct > 0).length;
  const bearish = analyses.filter(a => a.changePct < 0).length;

  msg += `\n📈 <b>XU HƯỚNG THỊ TRƯỜNG:</b>\n`;
  if (avgChange > 1) {
    msg += `🟢 Thị trường TÍCH CỰC (TB: +${avgChange.toFixed(2)}%)\n`;
    msg += `   ${bullish}/${analyses.length} mã tăng giá\n`;
  } else if (avgChange < -1) {
    msg += `🔴 Thị trường TIÊU CỰC (TB: ${avgChange.toFixed(2)}%)\n`;
    msg += `   ${bearish}/${analyses.length} mã giảm giá\n`;
  } else {
    msg += `🟡 Thị trường SIDEWAY (TB: ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%)\n`;
    msg += `   Tăng: ${bullish} | Giảm: ${bearish}\n`;
  }

  return msg;
}

// ─── MAIN FUNCTION ─────────────────────────────────────────

/**
 * Chạy toàn bộ AI analysis pipeline
 * @param {Array} stocks - Stock data từ fetchAllStocks()
 * @returns {string} Full HTML report cho Telegram
 */
async function runAiAnalysis(stocks) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  let header = '';
  header += `🤖 <b>PHÂN TÍCH CỔ PHIẾU CUỐI NGÀY</b>\n`;
  header += `🕐 <i>${now}</i>\n`;
  header += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Thử Gemini AI trước, fallback sang rule-based
  let analysisText = await analyzeWithGemini(stocks);

  if (!analysisText) {
    console.log('🔄 Sử dụng phân tích rule-based...');
    analysisText = analyzeWithRules(stocks);
  }

  let footer = `\n<i>⚠️ Khuyến nghị chỉ mang tính tham khảo, không phải lời khuyên đầu tư.</i>\n`;
  footer += `<i>📡 Dữ liệu: VPS | 🤖 AI: ${config.geminiAI1.apiKey ? 'Gemini 2.5 Flash' : 'Rule-based'}</i>`;

  return header + analysisText + footer;
}

// Helper
function fmtVol(vol) {
  if (!vol) return '0';
  const absVol = Math.abs(vol);
  const sign = vol < 0 ? '-' : '';
  if (absVol >= 1000000) return sign + (absVol / 1000000).toFixed(2) + 'M';
  if (absVol >= 1000) return sign + (absVol / 1000).toFixed(1) + 'K';
  return sign + vol.toLocaleString('vi-VN');
}

module.exports = { runAiAnalysis, analyzeWithGemini, analyzeWithRules };
