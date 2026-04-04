/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║       🏢 VN STOCK BOT - Multi-AI Team v1.1.1 (ALL FREE)     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║                                                               ║
 * ║  🤖 AI 1: Trigger + Báo giá  (Gemini 2.5 Flash - Key 1)     ║
 * ║  📊 AI 2: Chuyên gia         (Gemini 2.5 Pro   - Key 2)     ║
 * ║  💬 AI 3: Chuyên gia Flash   (Gemini 2.5 Flash - Key 1)     ║
 * ║  ⚔️  AI 4: Phản biện + Cuối ngày (Gemini 2.5 Pro - Key 2)   ║
 * ║                                                               ║
 * ║  Anti-spam: Mỗi Key chờ 60s giữa 2 lần gọi liên tiếp       ║
 * ║  Key 1: AI 1 ↔ AI 3  |  Key 2: AI 2 ↔ AI 4                 ║
 * ║                                                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { config } = require('./config');

// ─── AI ENGINE INSTANCES ───────────────────────────────────

let geminiAI2 = null;   // AI 2: Gemini 2.5 Pro (Key 2)
let geminiAI3 = null;   // AI 3: Gemini 2.5 Flash (Key 1)
let geminiAI4 = null;   // AI 4: Gemini 2.5 Pro (Key 2)

// Anti-spam: Track last call time per key
const lastCallTime = {};
const ANTI_SPAM_DELAY = 60000; // 60 giây

function initAIEngines() {
  // AI 2 (Key 2 - Gemini 2.5 Pro)
  if (config.geminiAI2.apiKey) {
    const genAI2 = new GoogleGenerativeAI(config.geminiAI2.apiKey);
    geminiAI2 = genAI2.getGenerativeModel({ model: 'gemini-2.5-pro' });
    console.log('   ✅ AI 2 initialized (Gemini 2.5 Pro - Key 2)');
  } else {
    console.log('   ⚠️  Không có GEMINI_API_KEY_AI2!');
  }

  // AI 3 (Key 1 - Gemini 2.5 Flash)
  if (config.geminiAI3.apiKey) {
    const genAI3 = new GoogleGenerativeAI(config.geminiAI3.apiKey);
    geminiAI3 = genAI3.getGenerativeModel({ model: config.geminiAI3.model });
    console.log(`   ✅ AI 3 initialized (${config.geminiAI3.model} - Key 1)`);
  } else {
    console.log('   ⚠️  Không có GEMINI_API_KEY_AI3!');
  }

  // AI 4 (Key 2 - Gemini 2.5 Pro, dùng chung key với AI 2)
  if (config.geminiAI4.apiKey) {
    const genAI4 = new GoogleGenerativeAI(config.geminiAI4.apiKey);
    geminiAI4 = genAI4.getGenerativeModel({ model: config.geminiAI4.model });
    console.log(`   ✅ AI 4 initialized (${config.geminiAI4.model} - Key 2)`);
  } else {
    console.log('   ⚠️  Không có Key cho AI 4!');
  }

  // Log multi-bot status
  console.log(`   🤖 Bot AI 2: ${config.telegram.botTokenAI2 ? '✅ Riêng' : '⚠️ Dùng bot chính'}`);
  console.log(`   💬 Bot AI 3: ${config.telegram.botTokenAI3 ? '✅ Riêng' : '⚠️ Dùng bot chính'}`);
  console.log(`   ⚔️  Bot AI 4: ${config.telegram.botTokenAI4 ? '✅ Riêng' : '⚠️ Dùng bot chính'}`);
}

// ─── ANTI-SPAM: Chờ 60s nếu cùng key gọi liên tiếp ────────

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
// AI 1 gửi bảng giá tóm tắt → AI 4 (Gemini Pro Key 2) phân tích

async function runScheduledAnalysis(stocks) {
  const stockData = formatStockDataForAI(stocks);
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
  const chatId = config.telegram.chatId;

  console.log('\n🏢 BÁO CÁO CUỐI NGÀY...');

  // Bước 1: AI 1 gửi bảng giá tóm tắt
  const summaryMsg = buildQuickSummary(stocks, now);
  await sendViaBot(config.telegram.botToken, chatId, summaryMsg);
  console.log('   📊 AI 1 đã gửi bảng giá tóm tắt');

  // Bước 2: Chờ anti-spam, rồi AI 4 phân tích
  let analysisReport = null;

  if (geminiAI4) {
    try {
      await waitForAntiSpam('key2'); // AI 4 dùng Key 2
      console.log('   ⚔️ AI 4 (Gemini Pro) đang phân tích cuối ngày...');

      const prompt = `Bạn là CHIẾN LƯỢC GIA CHỨNG KHOÁN cao cấp Việt Nam. Phiên giao dịch hôm nay đã kết thúc.

DỮ LIỆU THỊ TRƯỜNG HÔM NAY:
${stockData}

YÊU CẦU PHÂN TÍCH CUỐI NGÀY:
1. 📊 **TỔNG QUAN THỊ TRƯỜNG**: Xu hướng chung, thanh khoản, tâm lý
2. 🟢 **TOP MÃ TÍCH CỰC**: Mã tăng mạnh + lý do
3. 🔴 **TOP MÃ CẢNH BÁO**: Mã giảm/rủi ro
4. 💰 **DÒNG TIỀN NGOẠI**: Xu hướng khối ngoại
5. ⚠️ **RỦI RO ẨN**: Điều nhà đầu tư dễ bỏ qua
6. 🎯 **KHUYẾN NGHỊ NGÀY MAI**: Chiến lược phiên tới

Mỗi mã gán nhãn: [🟢MUA] [🔴BÁN] [🟡GIỮ] [🔵THEO DÕI]
FORMAT: Tiếng Việt, emoji, rõ ràng (~500 chữ). Dùng ** để bold. Không code block.
Luôn nhắc: "Tham khảo, không phải lời khuyên đầu tư."`;

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
    const ai4Msg = `⚔️ <b>PHÂN TÍCH CUỐI NGÀY</b>\n` +
      `<i>🧠 Gemini 2.5 Pro - Chiến lược gia</i>\n` +
      `🕐 <i>${now}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${analysisReport}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>⚠️ Khuyến nghị tham khảo, không phải lời khuyên đầu tư.</i>\n` +
      `<i>🤖 VN Stock Bot v${config.version} | Multi-AI Team (FREE)</i>`;
    await sendViaBot(getAI4BotToken(), chatId, ai4Msg);
    console.log('   ⚔️ AI 4 đã gửi báo cáo cuối ngày');
  } else {
    const fallbackReport = buildRuleBasedReport(stocks, now);
    await sendViaBot(config.telegram.botToken, chatId, fallbackReport);
  }

  return null;
}

function buildQuickSummary(stocks, now) {
  const valid = stocks.filter(s => !s.error);
  const gainers = valid.filter(s => s.changePct > 0).length;
  const losers = valid.filter(s => s.changePct < 0).length;
  const unchanged = valid.length - gainers - losers;

  let msg = `📊 <b>TỔNG HỢP CUỐI NGÀY</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🟢 Tăng: ${gainers} | 🔴 Giảm: ${losers} | 🟡 Đứng: ${unchanged}\n\n`;

  for (const s of valid) {
    const sign = s.changePct >= 0 ? '+' : '';
    const icon = s.changePct > 0 ? '🟢' : s.changePct < 0 ? '🔴' : '🟡';
    msg += `${icon} <b>${s.symbol}</b>: ${s.price}đ (${sign}${s.changePct}%)\n`;
  }

  msg += `\n<i>⏳ AI 4 đang phân tích chuyên sâu...</i>`;
  return msg;
}

// ─── INTERACTIVE FLOW: AI 2 + AI 3 → AI 4 ─────────────────
// KEY RULE: AI 2 (Key2) → chờ 60s → AI 4 (Key2)
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
    const ai2Msg = `📊 <b>CHUYÊN GIA GEMINI PRO</b>\n` +
      `<i>🤖 Gemini 2.5 Pro</i>\n` +
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

  // ─── STEP 2: AI 4 phản biện (Key2, chờ 60s sau AI 2) ───
  if (ai2Response || ai3Response) {
    console.log('🔄 Step 2: AI 4 phản biện (chờ anti-spam Key2)...');
    await waitForAntiSpam('key2'); // Chờ 60s sau AI 2

    const ai4Result = await callAI4_Contrarian(userMessage, ai2Response, ai3Response, stockContext);

    if (ai4Result) {
      const ai4Msg = `⚔️ <b>AI PHẢN BIỆN</b>\n` +
        `<i>🧠 Gemini 2.5 Pro - Devil's Advocate</i>\n` +
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

// ─── AI 2: CHUYÊN GIA (Gemini 2.5 Pro - Key 2) ────────────

async function callAI2(prompt) {
  if (!geminiAI2) { console.log('   ⚠️ AI 2 chưa khởi tạo'); return null; }
  try {
    console.log('   📊 AI 2 (Gemini 2.5 Pro) đang phân tích...');
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

// ─── AI 4: PHẢN BIỆN (Gemini 2.5 Pro - Key 2) ─────────────

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

function buildRuleBasedReport(stocks, now) {
  const validStocks = stocks.filter(s => !s.error);
  let msg = `🤖 <b>PHÂN TÍCH CỔ PHIẾU CUỐI NGÀY</b>\n`;
  msg += `🕐 <i>${now}</i>\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const s of validStocks) {
    const sign = s.changePct >= 0 ? '+' : '';
    const icon = s.changePct > 0 ? '🟢' : s.changePct < 0 ? '🔴' : '🟡';
    let rec = 'GIỮ';
    if (s.changePct > 3) rec = 'CHỐT LỜI?';
    else if (s.changePct < -3) rec = 'CẢNH BÁO';
    else if (s.price > s.sma20 && s.sma20 > 0) rec = 'TÍCH CỰC';
    else if (s.price < s.sma20 && s.sma20 > 0) rec = 'THEO DÕI';
    msg += `${icon} <b>${s.symbol}</b> [${rec}] ${sign}${s.changePct}%\n`;
  }

  msg += `\n<i>⚠️ Phân tích rule-based (AI đang nghỉ).</i>\n`;
  msg += `<i>📡 VN Stock Bot v${config.version}</i>`;
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
