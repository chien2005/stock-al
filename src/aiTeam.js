/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║       🏢 VN STOCK BOT - Multi-AI Team v2.1.0 (ALL FREE)     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║                                                               ║
 * ║  🤖 AI 1: Trigger + Báo giá  (Gemini 2.5 Flash)              ║
 * ║  📊 AI 2: Chuyên gia         (Gemma 4 31B FREE → Gemini)    ║
 * ║  💬 AI 3: Flash expert      (Nemotron 3 FREE → Gemini)     ║
 * ║  ⚔️  AI 4: Phản biện         (OpenRouter Auto → Gemini)     ║
 * ║                                                               ║
 * ║  OpenRouter: 1 key, 3 model khác nhau = đa góc nhìn         ║
 * ║  Fallback: Gemini Flash (2 keys) khi OpenRouter lỗi          ║
 * ║                                                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const axios = require('axios');
const { config } = require('./config');
const { calculateAllIndicators, calcShortTermScore, calcMidTermScore, formatIndicatorsForAI, getScoreEmoji } = require('./predictiveEngine');

// ─── AI ENGINE INSTANCES ───────────────────────────────────

let geminiAI2 = null;   // AI 2: Gemini fallback
let geminiAI3 = null;   // AI 3: Gemini 2.5 Flash (Key 1)
let geminiAI4 = null;   // AI 4: Gemini 2.5 Flash (Key 2→1)
let openRouterClient = null; // AI 2: OpenRouter FREE (primary)

// Anti-spam: Track last call time per key
const lastCallTime = {};
const ANTI_SPAM_DELAY = 15000; // 15 giây (Gemini free rate-limit: ~15 req/min)
const AI_CALL_TIMEOUT = 60000; // 60 giây timeout (gemini-2.5-flash cần thời gian suy nghĩ)
const MAX_RETRIES = 3; // Retry tối đa 3 lần khi rate-limited

function initAIEngines() {
  // OpenRouter FREE client (1 key, dùng cho AI 2 + AI 3 + AI 4)
  if (config.openRouter.apiKey) {
    openRouterClient = new OpenAI({
      baseURL: config.openRouter.baseURL,
      apiKey: config.openRouter.apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/vn-stock-bot',
        'X-OpenRouter-Title': 'VN Stock Bot',
      },
    });
    console.log(`   ✅ OpenRouter initialized (1 key, 3 models)`);
    console.log(`      📊 AI 2: ${config.openRouter.modelAI2}`);
    console.log(`      💬 AI 3: ${config.openRouter.modelAI3}`);
    console.log(`      ⚔️  AI 4: ${config.openRouter.modelAI4}`);
  } else {
    console.log('   ⚠️  Không có OPENROUTER_API_KEY - tất cả AI dùng Gemini');
  }

  // Gemini fallback engines
  if (config.geminiAI2.apiKey) {
    const genAI2 = new GoogleGenerativeAI(config.geminiAI2.apiKey);
    geminiAI2 = genAI2.getGenerativeModel({ model: config.geminiAI2.model });
    console.log(`   💾 AI 2 Gemini fallback ready (${config.geminiAI2.model})`);
  }

  if (config.geminiAI3.apiKey) {
    const genAI3 = new GoogleGenerativeAI(config.geminiAI3.apiKey);
    geminiAI3 = genAI3.getGenerativeModel({ model: config.geminiAI3.model });
    console.log(`   💾 AI 3 Gemini fallback ready (${config.geminiAI3.model})`);
  }

  if (config.geminiAI4.apiKey) {
    const genAI4 = new GoogleGenerativeAI(config.geminiAI4.apiKey);
    geminiAI4 = genAI4.getGenerativeModel({ model: config.geminiAI4.model });
    console.log(`   💾 AI 4 Gemini fallback ready (${config.geminiAI4.model})`);
  }

  // Log multi-bot status
  console.log(`   🤖 Bot AI 2: ${config.telegram.botTokenAI2 ? '✅ Riêng' : '⚠️ Dùng bot chính'}`);
  console.log(`   💬 Bot AI 3: ${config.telegram.botTokenAI3 ? '✅ Riêng' : '⚠️ Dùng bot chính'}`);
  console.log(`   ⚔️  Bot AI 4: ${config.telegram.botTokenAI4 ? '✅ Riêng' : '⚠️ Dùng bot chính'}`);
}

// ─── ANTI-SPAM: Chờ 15s nếu cùng key gọi liên tiếp ────────

async function waitForAntiSpam(keyId) {
  const now = Date.now();
  const lastCall = lastCallTime[keyId] || 0;
  const elapsed = now - lastCall;

  if (elapsed < ANTI_SPAM_DELAY) {
    const waitTime = ANTI_SPAM_DELAY - elapsed;
    console.log(`   🔒 Anti-spam: Key ${keyId} chờ ${Math.ceil(waitTime / 1000)}s...`);
    await sleep(waitTime);
  }

  lastCallTime[keyId] = Date.now();
}

// ─── MULTI-BOT TELEGRAM SENDER ─────────────────────────────

async function sendViaBot(botToken, chatId, message) {
  try {
    const chunks = splitMessage(message, 4000);
    for (const chunk of chunks) {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      if (chunks.length > 1) await sleep(500);
    }
    return true;
  } catch (error) {
    console.error('❌ Lỗi gửi qua bot:', error.response?.data?.description || error.message);
    return false;
  }
}

function getAI2BotToken() { return config.telegram.botTokenAI2 || config.telegram.botToken; }
function getAI3BotToken() { return config.telegram.botTokenAI3 || config.telegram.botToken; }
function getAI4BotToken() { return config.telegram.botTokenAI4 || config.telegram.botToken; }

function splitMessage(msg, maxLen) {
  if (msg.length <= maxLen) return [msg];
  const chunks = [];
  let remaining = msg;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let idx = remaining.lastIndexOf('\n\n', maxLen);
    if (idx === -1 || idx < maxLen * 0.3) idx = remaining.lastIndexOf('\n', maxLen);
    if (idx === -1 || idx < maxLen * 0.3) idx = maxLen;
    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).trimStart();
  }
  return chunks;
}

// ─── BÁO CÁO CUỐI NGÀY 20h30 ──────────────────────────────
// AI 1 gửi bảng giá tóm tắt → AI 4 (Gemini Flash) phân tích chuyên sâu
// Dữ liệu lấy từ cache 16h00 (giá cuối phiên chính xác)

async function runScheduledAnalysis(stocks, extraData = {}) {
  const { marketScan, vn30Index } = extraData;
  const stockData = formatStockDataForAI(stocks);
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
  const chatId = config.telegram.chatId;

  console.log('\n🏢 BÁO CÁO CUỐI NGÀY...');

  // Bước 1: AI 1 gửi bảng giá tóm tắt (dữ liệu từ cache 16h00)
  const summaryMsg = buildQuickSummary(stocks, now, vn30Index);
  await sendViaBot(config.telegram.botToken, chatId, summaryMsg);
  console.log('   📊 AI 1 đã gửi bảng giá tóm tắt');

  // Bước 2: Chờ anti-spam, rồi AI 4 phân tích chuyên sâu
  let analysisReport = null;

  if (geminiAI4) {
    try {
      await waitForAntiSpam('key2'); // AI 4 dùng Key 2
      console.log('   ⚔️ AI 4 (Gemini Flash) đang phân tích cuối ngày...');

      const prompt = buildEndOfDayPrompt(stockData, stocks, { marketScan, vn30Index });

      const result = await geminiAI4.generateContent(prompt);
      const text = result.response.text();
      if (text && text.trim().length > 0) {
        analysisReport = convertToHTML(text);
        console.log(`   ✅ AI 4 hoàn thành (${text.length} chars)`);
      }
    } catch (error) {
      console.error('   ❌ AI 4 lỗi:', error.message);
    }
  }

  // Bước 3: Gửi báo cáo qua Bot AI 4
  if (analysisReport) {
    const ai4Msg = `⚔️ <b>PHÂN TÍCH CHUYÊN SÂU CUỐI NGÀY</b>\n` +
      `<i>🧠 AI 4 - Chiến lược gia</i>\n` +
      `🕐 <i>${now}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${analysisReport}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>⚠️ Khuyến nghị tham khảo, không phải lời khuyên đầu tư.</i>\n` +
      `<i>🤖 VN Stock Bot v${config.version} | Multi-AI Team (FREE)</i>`;
    await sendViaBot(getAI4BotToken(), chatId, ai4Msg);
    console.log('   ⚔️ AI 4 đã gửi báo cáo cuối ngày');
  } else {
    // Fallback: rule-based nhưng chi tiết hơn
    const fallbackReport = buildDetailedRuleBasedReport(stocks, now);
    await sendViaBot(getAI4BotToken(), chatId, fallbackReport);
    console.log('   📋 Đã gửi báo cáo rule-based (chi tiết)');
  }

  return null;
}

/**
 * Prompt chuyên sâu cho AI 4 phân tích cuối ngày
 * Bao gồm cả data từ market scan (dòng tiền toàn thị trường)
 */
function buildEndOfDayPrompt(stockData, stocks, extraData = {}) {
  const { marketScan, vn30Index } = extraData;

  // Tính toán thêm context cho AI
  const validStocks = stocks.filter(s => !s.error);
  const gainers = validStocks.filter(s => s.changePct > 0);
  const losers = validStocks.filter(s => s.changePct < 0);
  const avgChange = validStocks.reduce((sum, s) => sum + s.changePct, 0) / validStocks.length;
  const totalVolume = validStocks.reduce((sum, s) => sum + s.volume, 0);
  const totalForeignNet = validStocks.reduce((sum, s) => sum + (s.foreignNet || 0), 0);

  // Mã có biến động mạnh
  const bigMovers = validStocks.filter(s => Math.abs(s.changePct) >= 3)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  // Mã có KL đột biến
  const volSpikes = validStocks.filter(s => s.avgVolume > 0 && s.volume / s.avgVolume > 1.5)
    .sort((a, b) => (b.volume / b.avgVolume) - (a.volume / a.avgVolume));

  // Mã khối ngoại mua/bán ròng mạnh
  const foreignBuyers = validStocks.filter(s => s.foreignNet > 50000).sort((a, b) => b.foreignNet - a.foreignNet);
  const foreignSellers = validStocks.filter(s => s.foreignNet < -50000).sort((a, b) => a.foreignNet - b.foreignNet);

  // VN30 Index context
  let vn30Context = '';
  if (vn30Index) {
    if (vn30Index.vn30) {
      const v = vn30Index.vn30;
      vn30Context += `\nCHỈ SỐ VN30: ${v.close} (đóng) | Mở: ${v.open} | Cao: ${v.high} | Thấp: ${v.low} | Thayđổi: ${v.changePct >= 0 ? '+' : ''}${v.changePct}% | KL: ${formatVolume(v.volume)}`;
    }
    if (vn30Index.vnindex) {
      const v = vn30Index.vnindex;
      vn30Context += `\nCHỈ SỐ VNINDEX: ${v.close} (đóng) | Mở: ${v.open} | Cao: ${v.high} | Thấp: ${v.low} | Thayđổi: ${v.changePct >= 0 ? '+' : ''}${v.changePct}% | KL: ${formatVolume(v.volume)}`;
    }
  }

  // Market scan context (dòng tiền toàn thị trường)
  let marketScanContext = '';
  if (marketScan) {
    marketScanContext += '\n\nQUÉT DÒNG TIỀN TOÀN THỊ TRƯỜNG (ngoài danh mục theo dõi):';
    if (marketScan.leaders && marketScan.leaders.length > 0) {
      marketScanContext += '\n🟢 TOP DÒNG TIỀN VÀO MẠNH NHẤT (Khối ngoại mua ròng):';
      for (const s of marketScan.leaders) {
        marketScanContext += `\n  ${s.symbol}: Giá=${s.price}đ | ThayĐổi=${s.changePct >= 0 ? '+' : ''}${s.changePct}% | NNRòng=+${formatVolume(s.foreignNet)} | KL=${formatVolume(s.volume)}`;
      }
    }
    if (marketScan.laggards && marketScan.laggards.length > 0) {
      marketScanContext += '\n🔴 TOP DÒNG TIỀN RA MẠNH NHẤT (Khối ngoại bán ròng):';
      for (const s of marketScan.laggards) {
        marketScanContext += `\n  ${s.symbol}: Giá=${s.price}đ | ThayĐổi=${s.changePct >= 0 ? '+' : ''}${s.changePct}% | NNRòng=${formatVolume(s.foreignNet)} | KL=${formatVolume(s.volume)}`;
      }
    }
    if (marketScan.topMovers && marketScan.topMovers.length > 0) {
      marketScanContext += '\n⚡ TOP BIẾN ĐỘNG MẠNH (toàn thị trường):';
      for (const s of marketScan.topMovers) {
        marketScanContext += `\n  ${s.symbol}: Giá=${s.price}đ | ${s.changePct >= 0 ? '+' : ''}${s.changePct}% | KL=${formatVolume(s.volume)}`;
      }
    }
  }

  return `Bạn là CHIẾN LƯỢC GIA CHỨNG KHOÁN VIỆT NAM chuyên nghiệp. Phiên giao dịch hôm nay đã kết thúc.

DỮ LIỆU DANH MỤC THEO DÕI (giá cuối phiên 16h00):
${stockData}
${vn30Context}

THỐNG KÊ NHANH:
- Tăng: ${gainers.length} mã | Giảm: ${losers.length} mã
- Biến động TB: ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%
- Tổng KLGD: ${formatVolume(totalVolume)}
- Khối ngoại ròng tổng: ${totalForeignNet >= 0 ? '+' : ''}${formatVolume(totalForeignNet)}
${bigMovers.length > 0 ? `- Biến động mạnh (>3%): ${bigMovers.map(s => `${s.symbol}(${s.changePct >= 0 ? '+' : ''}${s.changePct}%)`).join(', ')}` : ''}
${volSpikes.length > 0 ? `- KL đột biến: ${volSpikes.map(s => `${s.symbol}(${(s.volume / s.avgVolume).toFixed(1)}x TB)`).join(', ')}` : ''}
${foreignBuyers.length > 0 ? `- NN mua ròng mạnh: ${foreignBuyers.map(s => `${s.symbol}(+${formatVolume(s.foreignNet)})`).join(', ')}` : ''}
${foreignSellers.length > 0 ? `- NN bán ròng mạnh: ${foreignSellers.map(s => `${s.symbol}(${formatVolume(s.foreignNet)})`).join(', ')}` : ''}
${marketScanContext}

YÊU CẦU PHÂN TÍCH CHUYÊN SÂU (viết dạng bài phân tích, KHÔNG gán nhãn đơn giản):

1. 📊 **NHẬN ĐỊNH THỊ TRƯỜNG HÔM NAY** (~150 chữ):
   - Chỉ số VN30/VNINDEX hôm nay thế nào? Thị trường tăng/giảm vì sao?
   - Đánh giá thanh khoản phiên hôm nay, tâm lý nhà đầu tư
   - So sánh với xu hướng gần đây (dựa trên giá lịch sử 5 phiên)

2. 💰 **PHÂN TÍCH DÒNG TIỀN** (~150 chữ):
   - Dòng tiền khối ngoại: đang vào hay rút ra? Tập trung ở nhóm nào?
   - Thanh khoản: KL giao dịch so với trung bình, ý nghĩa?
   - Mã nào có KL đột biến bất thường? Có dấu hiệu tích/xả không?

3. 📈 **PHÂN TÍCH DANH MỤC THEO DÕI** (~200 chữ):
   - Chỉ phân tích mã có biến động đáng chú ý (>2% hoặc KL bất thường)
   - Mỗi mã: giá so với SMA20, xu hướng ngắn hạn, vùng hỗ trợ/kháng cự
   - Có nên MUA THÊM / CHỐT LỜI / CẮT LỖ? Giá mục tiêu nếu có

4. 🔥 **LEADER DÒNG TIỀN TOÀN THỊ TRƯỜNG** (~200 chữ):
   - Dựa trên dữ liệu quét toàn thị trường ở trên, phân tích:
   - TOP 3-5 mã đang LÀ LEADER DÒNG TIỀN (khối ngoại mua ròng mạnh nhất): phân tích tại sao, có nên mua không?
   - TOP 3-5 mã DÒNG TIỀN THÁO CHẠY (khối ngoại bán ròng): cảnh báo không nên mua
   - Mã nào có dòng tiền vào bất ngờ (ngành điện, bất động sản, ...)? Nhận định ngắn
   - Khủyên nghị: NÊN MUA / GIỮ / TRÁNH cho từng mã leader

5. 🔮 **DỰ BÁO NGẮN HẠN (1-5 NGÀY)** (~200 chữ):
   QUAN TRỌNG: Dựa trên SHORT_SCORE và MID_SCORE của mỗi mã, hãy DỰ ĐOÁN:
   - Mã nào có SHORT_SCORE >= 70? → Khả năng TĂNG GIÁ trong 1-5 phiên tới là BAO NHIÊU %?
   - Mã nào RSI < 30 (quá bán)? → Có phải cơ hội bắt đáy?
   - Mã nào MACD = BULLISH_CROSS? → Tín hiệu đảo chiều tăng?
   - Mã nào GOLDEN_CROSS (SMA5 cắt lên SMA20)? → Xu hướng tăng trung hạn?
   - Cho từng mã đáng chú ý: Giá mục tiêu ngắn hạn + Giá cắt lỗ

6. 📅 **DỰ BÁO TRUNG HẠN (1-3 THÁNG)** (~150 chữ):
   - Mã nào có MID_SCORE >= 65? → Triển vọng trung hạn tốt?
   - Xu hướng SMA alignment (giá > SMA5 > SMA10 > SMA20)? 
   - Mã nào đang tích lũy (NN mua ròng liên tục + giá sideway)?
   - Khuyến nghị phân bổ vốn cho danh mục trung hạn

7. ⚠️ **RỦI RO & CẢNH BÁO** (~100 chữ):
   - Mã nào RSI > 70 (quá mua)? → Cảnh báo chốt lời
   - Mã nào DEATH_CROSS? → Cảnh báo xu hướng giảm
   - Mã nào đang có rủi ro? (giảm sâu, dưới SMA20, NN bán ròng)

8. 🎯 **CHIẾN LƯỢC NGÀY MAI** (~150 chữ):
   - NÊN MUA mã nào? (ưu tiên mã có SHORT_SCORE cao) Vùng giá vào hợp lý?
   - NÊN BÁN/CHỐT LỜI mã nào?
   - NÊN THEO DÕI thêm mã nào?
   - Nhà đầu tư mới nên làm gì? Nên vào thị trường không?

FORMAT: Tiếng Việt, emoji, phân tích chi tiết (~1200 chữ). Dùng ** để bold điểm quan trọng. Không code block. Không gán nhãn đơn giản kiểu [CHỐT LỜI?].
Viết như một chuyên gia tài chính đang tư vấn cho khách hàng VIP, nhưng luôn nhắc "Đây là phân tích tham khảo, không phải lời khuyên đầu tư."`;
}

function buildQuickSummary(stocks, now, vn30Index) {
  const valid = stocks.filter(s => !s.error);
  const gainers = valid.filter(s => s.changePct > 0).length;
  const losers = valid.filter(s => s.changePct < 0).length;
  const unchanged = valid.length - gainers - losers;

  let msg = `📊 <b>TỔNG HỢP CUỐI NGÀY</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  // Chỉ số thị trường
  if (vn30Index) {
    if (vn30Index.vn30) {
      const v = vn30Index.vn30;
      const icon = v.changePct > 0 ? '🟢' : v.changePct < 0 ? '🔴' : '🟡';
      const sign = v.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>VN30</b>: ${v.close} (${sign}${v.changePct}%) | O:${v.open} H:${v.high} L:${v.low}\n`;
    }
    if (vn30Index.vnindex) {
      const v = vn30Index.vnindex;
      const icon = v.changePct > 0 ? '🟢' : v.changePct < 0 ? '🔴' : '🟡';
      const sign = v.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>VNINDEX</b>: ${v.close} (${sign}${v.changePct}%) | O:${v.open} H:${v.high} L:${v.low}\n`;
    }
    msg += `\n`;
  }

  msg += `🟢 Tăng: ${gainers} | 🔴 Giảm: ${losers} | 🟡 Đứng: ${unchanged}\n\n`;

  // Tổng KLGD & NN ròng
  const totalVol = valid.reduce((sum, s) => sum + (s.volume || 0), 0);
  const totalFN = valid.reduce((sum, s) => sum + (s.foreignNet || 0), 0);
  msg += `📦 Tổng KLGD: <b>${formatVolume(totalVol)}</b>\n`;
  msg += `${totalFN >= 0 ? '💚' : '💔'} NN ròng tổng: <b>${totalFN >= 0 ? '+' : ''}${formatVolume(totalFN)}</b>\n\n`;

  for (const s of valid) {
    const sign = s.changePct >= 0 ? '+' : '';
    const icon = s.changePct > 0 ? '🟢' : s.changePct < 0 ? '🔴' : '🟡';
    const arrow = s.changePct > 0 ? '▲' : s.changePct < 0 ? '▼' : '▬';

    // Tên + Giá + Thay đổi
    msg += `${icon} <b>${s.symbol}</b> ${arrow} ${(s.price || 0).toLocaleString('vi-VN')}đ (${sign}${s.changePct}%)\n`;

    // OHLC
    msg += `   📈 O:${(s.openPrice || 0).toLocaleString('vi-VN')} H:${(s.highPrice || 0).toLocaleString('vi-VN')} L:${(s.lowPrice || 0).toLocaleString('vi-VN')}\n`;

    // KLGD so với TB
    if (s.avgVolume > 0) {
      const volRatio = Math.round(s.volume / s.avgVolume * 100);
      msg += `   📦 KL: ${formatVolume(s.volume)} (${volRatio}% TB)\n`;
    } else {
      msg += `   📦 KL: ${formatVolume(s.volume)}\n`;
    }

    // Khối ngoại ròng
    if (s.foreignBuy > 0 || s.foreignSell > 0) {
      const fIcon = s.foreignNet > 0 ? '💚' : s.foreignNet < 0 ? '💔' : '💛';
      msg += `   ${fIcon} NN ròng: ${s.foreignNet >= 0 ? '+' : ''}${formatVolume(s.foreignNet)}\n`;
    }

    // SMA20
    if (s.sma20 > 0) {
      const smaStatus = s.price > s.sma20 ? '⬆️ Trên' : '⬇️ Dưới';
      msg += `   📋 SMA20: ${(s.sma20 || 0).toLocaleString('vi-VN')}đ ${smaStatus}\n`;
    }

    msg += `\n`;
  }

  msg += `<i>⏳ AI 4 đang phân tích chuyên sâu...</i>`;
  return msg;
}

// ─── INTERACTIVE FLOW: AI 2 + AI 3 → AI 4 ─────────────────
// KEY RULE: AI 2 (Key2) → chờ 15s → AI 4 (Key2)
//           AI 3 (Key1) chạy song song với AI 2

async function handleInteractiveQuestion(chatId, userMessage, currentStocks) {
  const stockContext = currentStocks && currentStocks.length > 0
    ? `\nDỮ LIỆU THỊ TRƯỜNG HIỆN TẠI:\n${formatStockDataForAI(currentStocks)}`
    : '';

  const expertPrompt = buildExpertPrompt(userMessage, stockContext);
  const hasOpenRouter = !!openRouterClient;

  let ai2Response = null;
  let ai3Response = null;

  if (hasOpenRouter) {
    // ─── CÓ OpenRouter → song song (khác engine, không bị rate-limit) ───
    console.log('🔄 Step 1: AI 2 + AI 3 song song (OpenRouter)...');

    const [ai2Result, ai3Result] = await Promise.allSettled([
      callAI2(expertPrompt),
      callAI3(expertPrompt),
    ]);

    ai2Response = ai2Result.status === 'fulfilled' ? ai2Result.value : null;
    ai3Response = ai3Result.status === 'fulfilled' ? ai3Result.value : null;
  } else {
    // ─── KHÔNG có OpenRouter → TUẦN TỰ để tránh rate-limit Gemini free ───
    console.log('🔄 Step 1: AI 2 → AI 3 tuần tự (Gemini-only, tránh rate-limit)...');

    // AI 2 trước (Key 2)
    await waitForAntiSpam('key2');
    try {
      ai2Response = await callAI2(expertPrompt);
    } catch (e) {
      console.error('   ❌ AI 2 exception:', e.message);
    }

    // Chờ 10s giữa 2 call Gemini để tránh rate-limit free tier
    await sleep(10000);

    // AI 3 sau (Key 1 - khác key nhưng vẫn cần chờ)
    await waitForAntiSpam('key1');
    try {
      ai3Response = await callAI3(expertPrompt);
    } catch (e) {
      console.error('   ❌ AI 3 exception:', e.message);
    }
  }

  // ─── Gửi kết quả AI 2 ──────
  if (ai2Response) {
    const ai2Msg = `📊 <b>CHUYÊN GIA GEMINI</b>\n` +
      `<i>🤖 ${config.geminiAI2.model}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${ai2Response}\n\n` +
      `<i>━ Gemini Expert Analysis ━</i>`;
    await sendViaBot(getAI2BotToken(), chatId, ai2Msg);
    console.log('   📊 AI 2 đã gửi');
  } else {
    const reason = hasOpenRouter ? 'OpenRouter + Gemini đều lỗi' : 'Gemini rate-limited, thử lại sau 1 phút';
    await sendViaBot(getAI2BotToken(), chatId, `⚠️ AI 2 không thể phân tích lúc này. (${reason})`);
  }

  await sleep(800);

  // ─── Gửi kết quả AI 3 ──────
  if (ai3Response) {
    const ai3Msg = `💬 <b>CHUYÊN GIA GEMINI FLASH</b>\n` +
      `<i>🤖 ${config.geminiAI3.model}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${ai3Response}\n\n` +
      `<i>━ Flash Expert Analysis ━</i>`;
    await sendViaBot(getAI3BotToken(), chatId, ai3Msg);
    console.log('   💬 AI 3 đã gửi');
  } else {
    const reason = hasOpenRouter ? 'OpenRouter + Gemini đều lỗi' : 'Gemini rate-limited, thử lại sau 1 phút';
    await sendViaBot(getAI3BotToken(), chatId, `⚠️ AI 3 không thể phân tích lúc này. (${reason})`);
  }

  // ─── STEP 2: AI 4 phản biện ───
  if (ai2Response || ai3Response) {
    console.log('🔄 Step 2: AI 4 phản biện (chờ anti-spam Key2)...');
    await waitForAntiSpam('key2');

    const ai4Result = await callAI4_Contrarian(userMessage, ai2Response, ai3Response, stockContext);

    if (ai4Result) {
      const ai4Msg = `⚔️ <b>AI PHẢN BIỆN</b>\n` +
        `<i>🧠 ${config.geminiAI4.model} - Devil's Advocate</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${ai4Result}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>⚠️ Tất cả khuyến nghị chỉ mang tính tham khảo.</i>\n` +
        `<i>🤖 VN Stock Bot v${config.version} | Multi-AI Team (FREE)</i>`;
      await sendViaBot(getAI4BotToken(), chatId, ai4Msg);
      console.log('   ⚔️ AI 4 đã gửi phản biện');
    }
  }
}

// ─── HELPER: Gọi AI với timeout + retry ────────────────────

async function callAIWithRetry(aiInstance, prompt, aiName, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const result = await Promise.race([
        aiInstance.generateContent(prompt),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT: AI không phản hồi sau 60s')), AI_CALL_TIMEOUT)
        ),
      ]);
      const text = result.response.text();
      if (!text || text.trim().length === 0) {
        console.log(`   ⚠️ ${aiName} trả về rỗng (attempt ${attempt})`);
        if (attempt <= retries) { await sleep(3000); continue; }
        return null;
      }
      console.log(`   ✅ ${aiName} hoàn thành (${text.length} chars, attempt ${attempt})`);
      return convertToHTML(text);
    } catch (error) {
      const isRateLimit = error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('quota');
      const isTimeout = error.message?.includes('TIMEOUT');
      console.error(`   ❌ ${aiName} lỗi (attempt ${attempt}/${retries + 1}): ${error.message?.substring(0, 150)}`);
      if ((isRateLimit || isTimeout) && attempt <= retries) {
        const waitTime = isRateLimit ? 20000 * attempt : 8000;
        console.log(`   🔄 ${aiName} retry ${attempt}/${retries} sau ${waitTime / 1000}s...`);
        await sleep(waitTime);
        continue;
      }
      return null;
    }
  }
  return null;
}

// ─── HELPER: Gọi OpenRouter (OpenAI-compatible) ────────────

async function callOpenRouter(prompt, modelId, aiName) {
  if (!openRouterClient) return null;
  try {
    console.log(`   🌐 ${aiName} (OpenRouter: ${modelId}) đang xử lý...`);
    const completion = await Promise.race([
      openRouterClient.chat.completions.create({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), AI_CALL_TIMEOUT)
      ),
    ]);
    const text = completion.choices?.[0]?.message?.content;
    if (text && text.trim().length > 0) {
      console.log(`   ✅ ${aiName} hoàn thành via OpenRouter (${text.length} chars)`);
      return convertToHTML(text);
    }
    console.log(`   ⚠️ ${aiName} OpenRouter trả về rỗng`);
    return null;
  } catch (error) {
    console.error(`   ⚠️ ${aiName} OpenRouter lỗi: ${error.message?.substring(0, 150)}`);
    return null;
  }
}

// ─── AI 2: CHUYÊN GIA (Gemma 4 31B FREE → Gemini fallback) ──

async function callAI2(prompt) {
  const orResult = await callOpenRouter(prompt, config.openRouter.modelAI2, 'AI 2');
  if (orResult) return orResult;

  if (!geminiAI2) { console.log('   ⚠️ AI 2 chưa khởi tạo'); return null; }
  console.log(`   🔄 AI 2 fallback → Gemini (${config.geminiAI2.model})...`);
  return callAIWithRetry(geminiAI2, prompt, 'AI 2');
}

// ─── AI 3: FLASH EXPERT (Nemotron 3 FREE → Gemini fallback) ──

async function callAI3(prompt) {
  const finalPrompt = `Bạn là chuyên gia phân tích chứng khoán Việt Nam. Trả lời ngắn gọn, nhanh, có emoji. Dùng ** để bold. Không code block.\n\n${prompt}`;

  const orResult = await callOpenRouter(finalPrompt, config.openRouter.modelAI3, 'AI 3');
  if (orResult) return orResult;

  if (!geminiAI3) { console.log('   ⚠️ AI 3 chưa khởi tạo'); return null; }
  console.log(`   🔄 AI 3 fallback → Gemini (${config.geminiAI3.model})...`);
  return callAIWithRetry(geminiAI3, finalPrompt, 'AI 3');
}

// ─── AI 4: PHẢN BIỆN (OpenRouter Auto FREE → Gemini fallback) ──

async function callAI4_Contrarian(userQuestion, ai2Analysis, ai3Analysis, stockContext) {
  const prompt = `Bạn là AI PHẢN BIỆN (Devil's Advocate) chứng khoán Việt Nam. Suy luận logic, tìm rủi ro ẩn.

CÂU HỎI NHÀ ĐẦU TƯ: "${userQuestion}"
${stockContext}

CHUYÊN GIA 1: ${ai2Analysis || 'Không có'}
CHUYÊN GIA 2: ${ai3Analysis || 'Không có'}

YÊU CẦU:
1. 🔍 Điểm ĐỒNG THUẬN
2. ⚔️ Điểm MÂU THUẪN / SAI LẦM
3. 🚨 Rủi ro ẩn CẢ 2 BỎ QUA
4. 💡 Góc nhìn phản biện SÂU SẮC
5. 🎯 KẾT LUẬN

FORMAT: Tiếng Việt, emoji, ~400 chữ. Dùng ** bold. Không code block. Nhắc "Tham khảo, không phải lời khuyên đầu tư."`;

  const orResult = await callOpenRouter(prompt, config.openRouter.modelAI4, 'AI 4');
  if (orResult) return orResult;

  if (!geminiAI4) { console.log('   ⚠️ AI 4 chưa khởi tạo'); return null; }
  console.log(`   🔄 AI 4 fallback → Gemini (${config.geminiAI4.model})...`);
  return callAIWithRetry(geminiAI4, prompt, 'AI 4');
}


// ─── PROMPT BUILDERS ───────────────────────────────────────

function buildExpertPrompt(userMessage, stockContext) {
  return `Bạn là chuyên gia phân tích chứng khoán Việt Nam cao cấp.
${stockContext}

CÂU HỎI CỦA NHÀ ĐẦU TƯ: "${userMessage}"

YÊU CẦU:
1. Nếu hỏi giá CP → trả lời chính xác
2. Nếu hỏi nên mua/bán → phân tích kỹ thuật + cơ bản + rủi ro
3. Nếu hỏi tổng quan → đánh giá xu hướng chung
4. Luôn nhắc "khuyến nghị tham khảo, không phải lời khuyên đầu tư"

FORMAT: Tiếng Việt, emoji, ngắn gọn (tối đa 300 chữ). Dùng ** để bold. Không code block.`;
}

function buildTechnicalPrompt(stockData) {
  return `Bạn là CHUYÊN GIA KỸ THUẬT chứng khoán VN. Phân tích NGẮN GỌN.
DỮ LIỆU: ${stockData}
Phân tích: xu hướng giá, SMA20, KL bất thường, hỗ trợ/kháng cự. Mỗi mã 1-2 dòng.
FORMAT: Tiếng Việt, emoji, ngắn gọn. Dùng ** để bold tên mã.`;
}

function buildFundamentalPrompt(stockData) {
  return `Bạn là CHUYÊN GIA CƠ BẢN chứng khoán VN. Đánh giá NGẮN GỌN.
DỮ LIỆU: ${stockData}
Đánh giá: dòng tiền khối ngoại, biến động bất thường, thanh khoản. Mỗi mã 1-2 dòng.
FORMAT: Tiếng Việt, emoji, ngắn gọn. Dùng ** để bold tên mã.`;
}

function buildRiskPrompt(stockData) {
  return `Bạn là QUẢN LÝ RỦI RO chứng khoán VN. Cảnh báo NGẮN GỌN.
DỮ LIỆU: ${stockData}
Cảnh báo: biến động >3%, KL đột biến, NN bán ròng mạnh, giá gần sàn, dưới SMA20.
Chỉ liệt kê mã CÓ RỦI RO. FORMAT: Tiếng Việt, emoji. Dùng ** để bold tên mã.`;
}

function buildStrategyPrompt(stockData, techReport, fundReport, riskReport) {
  return `Bạn là CHIẾN LƯỢC GIA chứng khoán VN.
DỮ LIỆU: ${stockData}
📊 KỸ THUẬT: ${techReport || 'N/A'}
💰 CƠ BẢN: ${fundReport || 'N/A'}
⚠️ RỦI RO: ${riskReport || 'N/A'}
Tổng hợp KHUYẾN NGHỊ: [🟢MUA] [🔴BÁN] [🟡GIỮ] [🔵THEO DÕI]. Tóm tắt 2-3 dòng.
FORMAT: Tiếng Việt, emoji, ngắn gọn. Dùng ** để bold.`;
}

// ─── HELPER FUNCTIONS ──────────────────────────────────────

function convertToHTML(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<(?!\/?(?:b|i|code|pre|a)\b)[^>]+>/g, '')
    .trim();
}

function formatStockDataForAI(stocks, globalSentiment = 50) {
  return stocks
    .filter(s => !s.error)
    .map(s => {
      const parts = [
        `${s.symbol}:`, `Giá=${s.price}đ`, `ThayĐổi=${s.changePct}%`,
        `TC=${s.refPrice}đ`, `Trần=${s.ceilingPrice}đ`, `Sàn=${s.floorPrice}đ`,
        `Mở=${s.openPrice}đ`, `Cao=${s.highPrice}đ`, `Thấp=${s.lowPrice}đ`,
        `KLGD=${s.volume}`, `KLTB20=${s.avgVolume}`,
        `NNMua=${s.foreignBuy}`, `NNBán=${s.foreignSell}`, `NNRòng=${s.foreignNet}`,
        `SMA20=${s.sma20}đ`, `Sàn=${s.exchange}`,
      ];
      if (s.historyPrices) parts.push(`LịchSử5Ngày=[${s.historyPrices.join(',')}]`);

      // Tính Technical Indicators + Prediction Scores
      if (s.historyData) {
        const indicators = calculateAllIndicators(s.historyData, s.price);
        if (!indicators.error) {
          const shortScore = calcShortTermScore(indicators, s, globalSentiment);
          const midScore = calcMidTermScore(indicators, s, globalSentiment);
          // Store scores on stock object for later use
          s._indicators = indicators;
          s._shortScore = shortScore;
          s._midScore = midScore;
          parts.push(`\n   📊 ${formatIndicatorsForAI(s.symbol, indicators, shortScore, midScore)}`);
        }
      }

      return parts.join(' | ');
    })
    .join('\n');
}

function formatVolume(vol) {
  if (!vol) return '0';
  const absVol = Math.abs(vol);
  const sign = vol < 0 ? '-' : '';
  if (absVol >= 1000000) return sign + (absVol / 1000000).toFixed(2) + 'M';
  if (absVol >= 1000) return sign + (absVol / 1000).toFixed(1) + 'K';
  return sign + vol.toLocaleString('vi-VN');
}

/**
 * Báo cáo rule-based CHI TIẾT (fallback khi AI lỗi)
 * Phân tích kỹ từng mã thay vì chỉ gán nhãn đơn giản
 */
function buildDetailedRuleBasedReport(stocks, now) {
  const validStocks = stocks.filter(s => !s.error);
  const avgChange = validStocks.reduce((sum, s) => sum + s.changePct, 0) / validStocks.length;
  const totalVolume = validStocks.reduce((sum, s) => sum + s.volume, 0);
  const totalForeignNet = validStocks.reduce((sum, s) => sum + (s.foreignNet || 0), 0);
  const gainers = validStocks.filter(s => s.changePct > 0);
  const losers = validStocks.filter(s => s.changePct < 0);

  let msg = `⚔️ <b>PHÂN TÍCH CUỐI NGÀY</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Tổng quan thị trường
  msg += `📊 <b>TỔNG QUAN THỊ TRƯỜNG</b>\n`;
  if (avgChange > 1) {
    msg += `🟢 Thị trường <b>TÍCH CỰC</b> (TB: +${avgChange.toFixed(2)}%)\n`;
  } else if (avgChange > 0) {
    msg += `🟢 Thị trường <b>NHÍCH TĂNG NHẸ</b> (TB: +${avgChange.toFixed(2)}%)\n`;
  } else if (avgChange > -1) {
    msg += `🔴 Thị trường <b>GIẢM NHẸ</b> (TB: ${avgChange.toFixed(2)}%)\n`;
  } else {
    msg += `🔴 Thị trường <b>TIÊU CỰC</b> (TB: ${avgChange.toFixed(2)}%)\n`;
  }
  msg += `📈 Tăng: ${gainers.length} | 📉 Giảm: ${losers.length}\n`;
  msg += `📦 Tổng KLGD: <b>${formatVolume(totalVolume)}</b>\n`;
  msg += `${totalForeignNet >= 0 ? '💚' : '💔'} NN ròng: <b>${totalForeignNet >= 0 ? '+' : ''}${formatVolume(totalForeignNet)}</b>\n\n`;

  // Phân tích từng mã
  msg += `📈 <b>PHÂN TÍCH TỪNG MÃ</b>\n\n`;

  for (const s of validStocks) {
    const sign = s.changePct >= 0 ? '+' : '';
    const icon = s.changePct > 0 ? '🟢' : s.changePct < 0 ? '🔴' : '🟡';

    msg += `${icon} <b>${s.symbol}</b>: ${s.price?.toLocaleString('vi-VN')}đ (${sign}${s.changePct}%)\n`;

    // Phân tích chi tiết
    const signals = [];

    // Biến động giá
    if (s.changePct >= 6.5) signals.push('🟣 Tăng trần - áp lực chốt lời rất cao');
    else if (s.changePct >= 5) signals.push('🚀 Tăng rất mạnh - cân nhắc chốt lời 1 phần');
    else if (s.changePct >= 3) signals.push('📈 Tăng tốt - momentum tích cực');
    else if (s.changePct <= -6.5) signals.push('🔵 Giảm sàn - NGUY HIỂM');
    else if (s.changePct <= -5) signals.push('💥 Giảm rất mạnh - xem xét cắt lỗ');
    else if (s.changePct <= -3) signals.push('📉 Giảm mạnh - theo dõi sát');

    // KL so với trung bình
    if (s.avgVolume > 0) {
      const volRatio = s.volume / s.avgVolume;
      if (volRatio > 2.5) {
        signals.push(`🔥 KL đột biến ${volRatio.toFixed(1)}x TB → ${s.changePct > 0 ? 'dòng tiền vào mạnh' : 'tín hiệu xả hàng'}`);
      } else if (volRatio > 1.5) {
        signals.push(`📊 KL cao hơn TB (${volRatio.toFixed(1)}x)`);
      } else if (volRatio < 0.5) {
        signals.push('⚠️ KL thấp bất thường - thanh khoản kém');
      }
    }

    // Khối ngoại
    if (s.foreignNet > 100000) {
      signals.push(`💚 NN mua ròng +${formatVolume(s.foreignNet)} → tín hiệu tích cực`);
    } else if (s.foreignNet < -100000) {
      signals.push(`💔 NN bán ròng ${formatVolume(s.foreignNet)} → cảnh báo`);
    }

    // SMA20
    if (s.sma20 > 0) {
      const smaDiff = ((s.price - s.sma20) / s.sma20 * 100).toFixed(1);
      if (s.price > s.sma20 * 1.05) {
        signals.push(`⬆️ Vượt xa SMA20 (+${smaDiff}%) → xu hướng tăng mạnh`);
      } else if (s.price > s.sma20) {
        signals.push(`⬆️ Trên SMA20 (+${smaDiff}%) → xu hướng tăng`);
      } else if (s.price < s.sma20 * 0.95) {
        signals.push(`⬇️ Dưới xa SMA20 (${smaDiff}%) → xu hướng giảm mạnh, RỦI RO`);
      } else {
        signals.push(`⬇️ Dưới SMA20 (${smaDiff}%) → xu hướng giảm`);
      }
    }

    // Giá gần trần/sàn
    if (s.ceilingPrice > 0 && s.price >= s.ceilingPrice * 0.99) {
      signals.push('🟣 Gần TRẦN → chốt lời hoặc chờ phiên sau');
    }
    if (s.floorPrice > 0 && s.price <= s.floorPrice * 1.01) {
      signals.push('🔵 Gần SÀN → có thể bắt đáy nhưng rất rủi ro');
    }

    // Hiển thị tín hiệu
    if (signals.length > 0) {
      for (const sig of signals) {
        msg += `   ${sig}\n`;
      }
    } else {
      msg += `   Giao dịch bình thường, không có tín hiệu đặc biệt\n`;
    }

    // Khuyến nghị ngắn
    let rec = '🟡 GIỮ';
    if (s.changePct >= 5 || (s.changePct >= 3 && s.price > s.sma20 * 1.05)) rec = '🟠 CÂN NHẮC CHỐT LỜI';
    else if (s.changePct <= -5) rec = '🔴 XEM XÉT CẮT LỖ';
    else if (s.changePct <= -3 && s.price < s.sma20) rec = '🔴 CẢNH BÁO';
    else if (s.changePct > 0 && s.price > s.sma20 && s.foreignNet > 0) rec = '🟢 TÍCH CỰC';
    else if (s.changePct < 0 && s.price < s.sma20 && s.foreignNet < 0) rec = '🔴 TIÊU CỰC';
    else if (s.price > s.sma20) rec = '🟢 XU HƯỚNG TĂNG';
    else if (s.price < s.sma20 && s.sma20 > 0) rec = '🟠 THEO DÕI';

    msg += `   → <b>${rec}</b>\n\n`;
  }

  // Chiến lược
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🎯 <b>GỢI Ý CHIẾN LƯỢC</b>\n`;

  if (avgChange > 2) {
    msg += `Thị trường tăng mạnh. Cân nhắc chốt lời 1 phần các mã tăng >5%. Không FOMO đuổi giá.\n`;
  } else if (avgChange > 0) {
    msg += `Thị trường tích cực. Giữ danh mục hiện tại, theo dõi kỹ các mã có KL đột biến.\n`;
  } else if (avgChange > -2) {
    msg += `Thị trường điều chỉnh nhẹ. Giữ bình tĩnh, theo dõi hỗ trợ. Có thể tích lũy dần nếu có tín hiệu đảo chiều.\n`;
  } else {
    msg += `Thị trường giảm mạnh. Hạn chế mua mới, ưu tiên bảo toàn vốn. Cắt lỗ các mã yếu.\n`;
  }

  msg += `\n<i>⚠️ Phân tích rule-based tự động (AI tạm nghỉ).</i>\n`;
  msg += `<i>Khuyến nghị chỉ mang tính tham khảo.</i>\n`;
  msg += `<i>🤖 VN Stock Bot v${config.version}</i>`;
  return msg;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── JOB 4: PHÂN TÍCH TTCK QUỐC TẾ (21h00) ────────────────

/**
 * Phân tích thị trường quốc tế → ảnh hưởng VN
 * @param {Object} globalData - từ fetchAllGlobalData()
 */
async function runGlobalMarketAnalysis(globalData) {
  const chatId = config.telegram.chatId;
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  console.log('\n🌍 PHÂN TÍCH TTCK QUỐC TẾ...');

  // Bước 1: Gửi bảng data tổng hợp qua Bot chính
  const { buildGlobalMarketTelegramMessage } = require('./globalMarketService');
  const dataMsg = buildGlobalMarketTelegramMessage(globalData);
  await sendViaBot(config.telegram.botToken, chatId, dataMsg);
  console.log('   📊 Đã gửi bảng data TTCK quốc tế');

  // Bước 2: AI phân tích chi tiết ảnh hưởng VN
  if (geminiAI4) {
    try {
      await waitForAntiSpam('key2');
      console.log('   🌍 AI 4 đang phân tích ảnh hưởng TTCK quốc tế → VN...');

      const prompt = buildGlobalAnalysisPrompt(globalData);
      const result = await geminiAI4.generateContent(prompt);
      const text = result.response.text();

      if (text && text.trim().length > 0) {
        const htmlReport = convertToHTML(text);
        const aiMsg = `🌍 <b>PHÂN TÍCH TTCK QUỐC TẾ → ẢNH HƯỞNG VN</b>\n` +
          `<i>🧠 AI 4 - Chiến lược gia toàn cầu</i>\n` +
          `🕐 <i>${now}</i>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `${htmlReport}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>⚠️ Phân tích tham khảo, không phải lời khuyên đầu tư.</i>\n` +
          `<i>🤖 VN Stock Bot v${config.version} | Global Analysis</i>`;
        await sendViaBot(getAI4BotToken(), chatId, aiMsg);
        console.log(`   ✅ AI 4 đã gửi phân tích TTCK quốc tế (${text.length} chars)`);
      }
    } catch (error) {
      console.error('   ❌ AI 4 lỗi phân tích quốc tế:', error.message);
    }
  }
}

/**
 * Prompt cho AI phân tích TTCK quốc tế → VN
 */
function buildGlobalAnalysisPrompt(globalData) {
  const { summary, fearGreed } = globalData;

  return `Bạn là CHIẾN LƯỢC GIA THỊ TRƯỜNG TOÀN CẦU, chuyên gia về mối liên hệ giữa TTCK quốc tế và TTCK Việt Nam.

Thời điểm: 21:00 tối Việt Nam. Phiên giao dịch VN đã kết thúc, nhưng thị trường Mỹ đang/sắp mở cửa.

DỮ LIỆU TTCK QUỐC TẾ HÔM NAY:
${summary}

YÊU CẦU PHÂN TÍCH (viết chi tiết, chuyên sâu):

1. 🌍 **TỔNG QUAN THỊ TRƯỜNG THẾ GIỚI** (~200 chữ):
   - Thị trường Mỹ (S&P 500, NASDAQ, Dow): xu hướng gì? Nguyên nhân?
   - Châu Á (Nikkei, Shanghai, Hang Seng, KOSPI): có tương đồng Mỹ không?
   - Châu Âu: theo Mỹ hay đi riêng?
   - Tâm lý chung: Risk-on hay Risk-off?

2. 🏦 **PHÂN TÍCH NGÀNH & SECTOR ROTATION** (~200 chữ):
   - ETF ngành nào tăng/giảm mạnh nhất? Vì sao?
   - Dòng tiền đang chảy vào ngành nào trên thế giới?
   - Mapping sang VN: ngành nào sẽ hưởng lợi/chịu thiệt?
   - VD: XLF +2% → bank VN (VCB, MBB, TCB) có thể khởi sắc

3. 💱 **TỶ GIÁ & HÀNG HÓA** (~100 chữ):
   - DXY (Dollar Index): USD mạnh/yếu ảnh hưởng VN thế nào?
   - Vàng, Dầu: tín hiệu gì cho nền kinh tế?
   - VIX: mức độ lo ngại thị trường?

4. 🔮 **DỰ BÁO TTCK VN NGÀY MAI** (~250 chữ):
   - Dựa trên tất cả dữ liệu trên, DỰ BÁO cụ thể:
     • VN mở cửa GAP UP hay GAP DOWN? Bao nhiêu điểm?
     • Khả năng VNINDEX tăng/giảm: X% (ước tính)
     • Nhóm cổ phiếu nào sẽ HƯỞNG LỢI nhất? (dựa trên sector rotation)
     • Nhóm nào nên TRÁNH?
   - Fear/Greed Score hiện tại: ${fearGreed.score}/100 (${fearGreed.label}) → ý nghĩa?
   - Chiến lược: Nên MUA / BÁN / GIỮ / CHỜ?

5. ⚠️ **RỦI RO CẦN CHÚ Ý** (~100 chữ):
   - Sự kiện kinh tế/chính trị quốc tế sắp tới?
   - Fed, lãi suất, địa chính trị?
   - Black swan risk?

FORMAT: Tiếng Việt, emoji, chuyên sâu (~900 chữ). Dùng ** để bold điểm quan trọng.
Viết như chuyên gia tài chính quốc tế đang brief cho team đầu tư VN.
Luôn nhắc "Đây là phân tích tham khảo, không phải lời khuyên đầu tư."`;
}

// ─── JOB 5: TOP 5 CP MUA NHIỀU NHẤT (21h30) ────────────────

/**
 * Phân tích Top 5 CP được mua nhiều nhất + dự báo
 * @param {Object} topBoughtData - từ fetchTopBoughtStocks()
 * @param {Object} globalData - context từ TTCK quốc tế (nếu có)
 */
async function runTopBoughtAnalysis(topBoughtData, globalData = null) {
  const chatId = config.telegram.chatId;
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  console.log('\n🏆 PHÂN TÍCH TOP CP MUA NHIỀU NHẤT...');

  const { topBought, stats } = topBoughtData;

  // Bước 1: Gửi bảng tổng hợp Top 5
  const dataMsg = buildTopBoughtTelegramMessage(topBought, stats, now);
  await sendViaBot(config.telegram.botToken, chatId, dataMsg);
  console.log('   📊 Đã gửi bảng Top 5 CP mua nhiều nhất');

  // Bước 2: AI phân tích + dự báo
  if (geminiAI4) {
    try {
      await waitForAntiSpam('key2');
      console.log('   🏆 AI 4 đang phân tích Top 5 CP...');

      const prompt = buildTopBoughtPrompt(topBought, stats, globalData);
      const result = await geminiAI4.generateContent(prompt);
      const text = result.response.text();

      if (text && text.trim().length > 0) {
        const htmlReport = convertToHTML(text);
        const aiMsg = `🏆 <b>PHÂN TÍCH TOP 5 CP MUA NHIỀU NHẤT</b>\n` +
          `<i>🧠 AI 4 - Smart Money Tracker</i>\n` +
          `🕐 <i>${now}</i>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `${htmlReport}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>⚠️ Phân tích tham khảo, không phải lời khuyên đầu tư.</i>\n` +
          `<i>🤖 VN Stock Bot v${config.version} | Smart Money Analysis</i>`;
        await sendViaBot(getAI4BotToken(), chatId, aiMsg);
        console.log(`   ✅ AI 4 đã gửi phân tích Top 5 (${text.length} chars)`);
      }
    } catch (error) {
      console.error('   ❌ AI 4 lỗi phân tích Top 5:', error.message);
    }
  }
}

/**
 * Build Telegram message cho Top 5 CP mua nhiều nhất
 */
function buildTopBoughtTelegramMessage(topBought, stats, now) {
  let msg = `🏆 <b>TOP 5 CP MUA NHIỀU NHẤT HÔM NAY</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `📊 <i>Quét ${stats.totalScanned} mã | Composite Score Analysis</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Thống kê chung
  msg += `📈 Tăng: ${stats.gainers} | 📉 Giảm: ${stats.losers} | TB: ${stats.avgChange >= 0 ? '+' : ''}${stats.avgChange}%\n`;
  msg += `${stats.totalForeignNet >= 0 ? '💚' : '💔'} NN ròng tổng: <b>${stats.totalForeignNet >= 0 ? '+' : ''}${formatVolume(stats.totalForeignNet)}</b>\n\n`;

  // Top 5
  for (let i = 0; i < topBought.length; i++) {
    const s = topBought[i];
    const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
    const sign = s.changePct >= 0 ? '+' : '';
    const icon = s.changePct > 0 ? '🟢' : s.changePct < 0 ? '🔴' : '🟡';

    msg += `${medal} <b>${s.symbol}</b> ${icon}\n`;
    msg += `   💰 Giá: <b>${s.price.toLocaleString('vi-VN')}đ</b> (${sign}${s.changePct}%)\n`;
    msg += `   📦 KLGD: ${formatVolume(s.volume)}\n`;

    // Khối ngoại
    const fIcon = s.foreignNet > 0 ? '💚' : s.foreignNet < 0 ? '💔' : '💛';
    msg += `   ${fIcon} NN ròng: ${s.foreignNet >= 0 ? '+' : ''}${formatVolume(s.foreignNet)}`;
    if (s.foreignNetValue > 0) {
      msg += ` (~${formatBigValue(s.foreignNetValue)}đ)`;
    }
    msg += `\n`;

    // Buy pressure
    msg += `   💪 Buy Pressure: ${s.buyPressure}%\n`;

    // Composite Score (progress bar)
    const scoreBar = buildScoreBar(s.compositeScore);
    msg += `   🎯 Score: ${scoreBar} <b>${s.compositeScore}</b>/100\n`;

    // Signals
    if (s.signals && s.signals.length > 0) {
      msg += `   📡 ${s.signals.join(' | ')}\n`;
    }

    msg += `\n`;
  }

  msg += `<i>⏳ AI đang phân tích dự báo...</i>`;
  return msg;
}

/**
 * Build score progress bar
 */
function buildScoreBar(score) {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/**
 * Format giá trị lớn (tỷ VND)
 */
function formatBigValue(value) {
  const abs = Math.abs(value);
  if (abs >= 1000000000000) return (value / 1000000000000).toFixed(1) + ' nghìn tỷ';
  if (abs >= 1000000000) return (value / 1000000000).toFixed(1) + ' tỷ';
  if (abs >= 1000000) return (value / 1000000).toFixed(0) + ' triệu';
  return value.toLocaleString('vi-VN');
}

/**
 * Prompt cho AI phân tích Top 5 CP mua nhiều nhất
 */
function buildTopBoughtPrompt(topBought, stats, globalData = null) {
  let topData = 'TOP 5 CP ĐƯỢC MUA NHIỀU NHẤT HÔM NAY (theo Composite Score):\n\n';
  for (let i = 0; i < topBought.length; i++) {
    const s = topBought[i];
    topData += `${i + 1}. ${s.symbol}:\n`;
    topData += `   Giá=${s.price}đ | ThayĐổi=${s.changePct >= 0 ? '+' : ''}${s.changePct}%\n`;
    topData += `   KLGD=${s.volume} | NNMua=${s.foreignBuy} | NNBán=${s.foreignSell} | NNRòng=${s.foreignNet}\n`;
    topData += `   GiáTrịNNRòng=${s.foreignNetValue}đ | BuyPressure=${s.buyPressure}%\n`;
    topData += `   CompositeScore=${s.compositeScore}/100\n`;
    if (s.signals && s.signals.length > 0) {
      topData += `   Signals: ${s.signals.join(', ')}\n`;
    }
    topData += `\n`;
  }

  topData += `THỐNG KÊ THỊ TRƯỜNG:\n`;
  topData += `- Tổng quét: ${stats.totalScanned} mã\n`;
  topData += `- Tăng: ${stats.gainers} | Giảm: ${stats.losers}\n`;
  topData += `- TB thay đổi: ${stats.avgChange}%\n`;
  topData += `- NN ròng tổng: ${stats.totalForeignNet}\n`;

  let globalContext = '';
  if (globalData && globalData.summary) {
    globalContext = `\nCONTEXT TTCK QUỐC TẾ (đã phân tích lúc 21h):\n${globalData.summary}\n`;
  }

  return `Bạn là CHUYÊN GIA SMART MONEY TRACKING chứng khoán Việt Nam. Bạn phân tích hành vi của "tay to", "cá mập", khối ngoại để tìm cơ hội đầu tư.

${topData}
${globalContext}

YÊU CẦU PHÂN TÍCH CHI TIẾT (cho NHÀ ĐẦU TƯ hành động):

1. 🏆 **PHÂN TÍCH TỪNG MÃ TOP 5** (~400 chữ):
   Với MỖI mã, trả lời:
   - Tại sao 'tay to' gom mã này? Có tin tức/sự kiện gì đặc biệt?
   - Phân tích kỹ thuật: giá so với đỉnh/đáy gần đây, hỗ trợ/kháng cự
   - Dự báo: Khả năng tăng bao nhiêu % trong 1-5 phiên tới?
   - Mức giá mục tiêu (target price) ngắn hạn?
   - Rủi ro: có phải "bull trap" (bẫy tăng giá) không?
   - Khuyến nghị: 🟢 MUA NGAY / 🟡 MUA DẦN / 🟠 CHỜ PULLBACK / 🔴 TRÁNH

2. 💰 **PHÂN TÍCH DÒNG TIỀN THÔNG MINH** (~200 chữ):
   - "Cá mập" đang gom ở nhóm ngành nào?
   - Có sự kiện sector rotation không? (VD: tiền chuyển từ bank sang tech)
   - Nếu NN mua ròng + giá sideway = DẤU HIỆU TÍCH LŨY → sắp bùng nổ?
   - Nếu NN mua ròng + giá tăng mạnh = MOMENTUM → cẩn thận chốt lời?

3. 🎯 **CHIẾN LƯỢC ĐẦU TƯ NGÀY MAI** (~200 chữ):
   - Mã nào nên MUA ở ATO (mở cửa)?
   - Vùng giá vào hợp lý cho từng mã?
   - Tỷ lệ phân bổ vốn gợi ý (VD: 30% VCB, 20% FPT...)?
   - Stop loss đặt ở đâu?
   - Take profit ở đâu?

4. ⚠️ **CẢNH BÁO RỦI RO** (~100 chữ):
   - Mã nào trong top 5 có khả năng là "bull trap"?
   - NN gom để xả ngay hôm sau?
   - Rủi ro macro nào ảnh hưởng?

FORMAT: Tiếng Việt, emoji, chuyên sâu (~900 chữ). Dùng ** để bold điểm quan trọng. Không code block.
Viết như chuyên gia đang tư vấn cho khách hàng VIP, TỰ TIN nhưng THẬN TRỌNG.
Luôn nhắc "Đây là phân tích tham khảo, không phải lời khuyên đầu tư."`;
}

module.exports = {
  initAIEngines,
  runScheduledAnalysis,
  handleInteractiveQuestion,
  formatStockDataForAI,
  runGlobalMarketAnalysis,
  runTopBoughtAnalysis,
};
