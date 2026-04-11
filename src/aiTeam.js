/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║       🏢 VN STOCK BOT - Multi-AI Team v1.2.0 (ALL FREE)     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║                                                               ║
 * ║  🤖 AI 1: Trigger + Báo giá  (Gemini 2.5 Flash - Key 1)     ║
 * ║  📊 AI 2: Chuyên gia         (Gemini 2.5 Flash - Key 2→1)   ║
 * ║  💬 AI 3: Chuyên gia Flash   (Gemini 2.5 Flash - Key 1)     ║
 * ║  ⚔️  AI 4: Phản biện + Cuối ngày (Gemini 2.5 Flash - Key 2→1)║
 * ║                                                               ║
 * ║  Anti-spam: Mỗi Key chờ 15s giữa 2 lần gọi liên tiếp       ║
 * ║  Key 1: AI 1 ↔ AI 3  |  Key 2: AI 2 ↔ AI 4                 ║
 * ║                                                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { config } = require('./config');

// ─── AI ENGINE INSTANCES ───────────────────────────────────

let geminiAI2 = null;   // AI 2: Gemini 2.5 Flash (Key 2→1)
let geminiAI3 = null;   // AI 3: Gemini 2.5 Flash (Key 1)
let geminiAI4 = null;   // AI 4: Gemini 2.5 Flash (Key 2→1)

// Anti-spam: Track last call time per key
const lastCallTime = {};
const ANTI_SPAM_DELAY = 15000; // 15 giây (flash model cho phép nhanh hơn)

function initAIEngines() {
  // AI 2 (Key 2 → fallback Key 1 — Gemini 2.5 Flash)
  if (config.geminiAI2.apiKey) {
    const genAI2 = new GoogleGenerativeAI(config.geminiAI2.apiKey);
    geminiAI2 = genAI2.getGenerativeModel({ model: config.geminiAI2.model });
    console.log(`   ✅ AI 2 initialized (${config.geminiAI2.model})`);
  } else {
    console.log('   ⚠️  Không có API Key cho AI 2!');
  }

  // AI 3 (Key 1 - Gemini 2.5 Flash)
  if (config.geminiAI3.apiKey) {
    const genAI3 = new GoogleGenerativeAI(config.geminiAI3.apiKey);
    geminiAI3 = genAI3.getGenerativeModel({ model: config.geminiAI3.model });
    console.log(`   ✅ AI 3 initialized (${config.geminiAI3.model})`);
  } else {
    console.log('   ⚠️  Không có GEMINI_API_KEY_AI3!');
  }

  // AI 4 (Key 2 → fallback Key 1 — Gemini 2.5 Flash)
  if (config.geminiAI4.apiKey) {
    const genAI4 = new GoogleGenerativeAI(config.geminiAI4.apiKey);
    geminiAI4 = genAI4.getGenerativeModel({ model: config.geminiAI4.model });
    console.log(`   ✅ AI 4 initialized (${config.geminiAI4.model})`);
  } else {
    console.log('   ⚠️  Không có Key cho AI 4!');
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

5. ⚠️ **RỦI RO & CẢNH BÁO** (~100 chữ):
   - Mã nào đang có rủi ro? (giảm sâu, dưới SMA20, NN bán ròng)
   - Thị trường có tín hiệu đảo chiều không?

6. 🎯 **CHIẾN LƯỢC NGÀY MAI** (~150 chữ):
   - NÊN MUA mã nào? (cả trong danh mục lẫn leader dòng tiền) Vùng giá vào hợp lý?
   - NÊN BÁN/CHỐT LỜI mã nào?
   - NÊN THEO DÕI thêm mã nào?
   - Nhà đầu tư mới nên làm gì? Nên vào thị trường không?

FORMAT: Tiếng Việt, emoji, phân tích chi tiết (~1000 chữ). Dùng ** để bold điểm quan trọng. Không code block. Không gán nhãn đơn giản kiểu [CHỐT LỜI?].
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

  // ─── STEP 1: AI 2 (Key2) + AI 3 (Key1) song song ───
  // Khác key nên gọi đồng thời OK, không spam
  console.log('🔄 Step 1: AI 2 (Key2) + AI 3 (Key1) phân tích song song...');

  await Promise.all([
    waitForAntiSpam('key2'),
    waitForAntiSpam('key1'),
  ]);

  const [ai2Result, ai3Result] = await Promise.allSettled([
    callAI2(expertPrompt),
    callAI3(expertPrompt),
  ]);

  const ai2Response = ai2Result.status === 'fulfilled' ? ai2Result.value : null;
  const ai3Response = ai3Result.status === 'fulfilled' ? ai3Result.value : null;

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
    await sendViaBot(getAI2BotToken(), chatId, '⚠️ AI 2 không thể phân tích lúc này.');
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
    await sendViaBot(getAI3BotToken(), chatId, '⚠️ AI 3 không thể phân tích lúc này.');
  }

  // ─── STEP 2: AI 4 phản biện (Key2, chờ 15s sau AI 2) ───
  if (ai2Response || ai3Response) {
    console.log('🔄 Step 2: AI 4 phản biện (chờ anti-spam Key2)...');
    await waitForAntiSpam('key2'); // Chờ 15s sau AI 2

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

// ─── AI 2: CHUYÊN GIA (Gemini 2.5 Flash - Key 2) ──────────

async function callAI2(prompt) {
  if (!geminiAI2) { console.log('   ⚠️ AI 2 chưa khởi tạo'); return null; }
  try {
    console.log(`   📊 AI 2 (${config.geminiAI2.model}) đang phân tích...`);
    const result = await geminiAI2.generateContent(prompt);
    const text = result.response.text();
    if (!text || text.trim().length === 0) return null;
    console.log(`   ✅ AI 2 hoàn thành (${text.length} chars)`);
    return convertToHTML(text);
  } catch (error) {
    console.error('   ❌ AI 2 lỗi:', error.message);
    return null;
  }
}

// ─── AI 3: CHUYÊN GIA FLASH (Gemini 2.5 Flash - Key 1) ────

async function callAI3(prompt) {
  if (!geminiAI3) { console.log('   ⚠️ AI 3 chưa khởi tạo'); return null; }
  try {
    console.log(`   💬 AI 3 (${config.geminiAI3.model}) đang phân tích...`);
    const finalPrompt = `Bạn là chuyên gia phân tích chứng khoán Việt Nam. Trả lời ngắn gọn, nhanh, có emoji. Dùng ** để bold. Không code block.\n\n${prompt}`;
    const result = await geminiAI3.generateContent(finalPrompt);
    const text = result.response.text();
    if (!text || text.trim().length === 0) return null;
    console.log(`   ✅ AI 3 hoàn thành (${text.length} chars)`);
    return convertToHTML(text);
  } catch (error) {
    console.error('   ❌ AI 3 lỗi:', error.message);
    return null;
  }
}

// ─── AI 4: PHẢN BIỆN (Gemini 2.5 Flash - Key 2) ───────────

async function callAI4_Contrarian(userQuestion, ai2Analysis, ai3Analysis, stockContext) {
  if (!geminiAI4) { console.log('   ⚠️ AI 4 chưa khởi tạo'); return null; }
  try {
    console.log(`   ⚔️ AI 4 (${config.geminiAI4.model}) đang phản biện...`);
    const prompt = `Bạn là AI PHẢN BIỆN (Devil's Advocate) chứng khoán Việt Nam. Suy luận logic, tìm rủi ro ẩn.

CÂU HỎI NHÀ ĐẦU TƯ: "${userQuestion}"
${stockContext}

CHUYÊN GIA 1 (Gemini Pro): ${ai2Analysis || 'Không có'}
CHUYÊN GIA 2 (Gemini Flash): ${ai3Analysis || 'Không có'}

YÊU CẦU:
1. 🔍 Điểm ĐỒNG THUẬN
2. ⚔️ Điểm MÂU THUẪN / SAI LẦM
3. 🚨 Rủi ro ẩn CẢ 2 BỎ QUA
4. 💡 Góc nhìn phản biện SÂU SẮC
5. 🎯 KẾT LUẬN

FORMAT: Tiếng Việt, emoji, ~400 chữ. Dùng ** bold. Không code block. Nhắc "Tham khảo, không phải lời khuyên đầu tư."`;

    const result = await geminiAI4.generateContent(prompt);
    const text = result.response.text();
    if (!text || text.trim().length === 0) return null;
    console.log(`   ✅ AI 4 hoàn thành (${text.length} chars)`);
    return convertToHTML(text);
  } catch (error) {
    console.error('   ❌ AI 4 lỗi:', error.message);
    return null;
  }
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

function formatStockDataForAI(stocks) {
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

module.exports = {
  initAIEngines,
  runScheduledAnalysis,
  handleInteractiveQuestion,
  formatStockDataForAI,
};
