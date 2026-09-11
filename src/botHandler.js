/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     💬 VN STOCK BOT - Interactive Bot Handler v1.1.1          ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Xử lý tin nhắn từ user trong group Telegram                 ║
 * ║                                                               ║
 * ║  Flow: User msg → AI 2 (Gemini) + AI 3 (GPT) song song      ║
 * ║        → Gửi kết quả lên Tele                                ║
 * ║        → AI 4 phản biện → Gửi lên Tele                       ║
 * ║                                                               ║
 * ║  Commands:                                                    ║
 * ║  /gia <mã>      - Xem giá cổ phiếu                          ║
 * ║  /phantich <mã>  - AI phân tích nhanh                        ║
 * ║  /tuanmoi        - Phân tích đầu tuần                        ║
 * ║  /team           - Xem thông tin đội ngũ AI                  ║
 * ║  /help           - Trợ giúp                                  ║
 * ║  Text tự do      - AI Team trả lời                           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const TelegramBot = require('node-telegram-bot-api');
const { config } = require('./config');
const { fetchAllStocks, fetchRealtimeData } = require('./stockService');
const { handleInteractiveQuestion } = require('./aiTeam');

let bot = null;
let cachedStocks = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 phút

// Rate-limit: tối đa 1 câu hỏi mỗi 2 phút
const USER_COOLDOWN = 2 * 60 * 1000; // 2 phút
const lastUserQuestion = {};

// ─── INITIALIZE BOT ────────────────────────────────────────

function startBotHandler() {
  if (!config.telegram.botToken) {
    console.log('⚠️ Không có TELEGRAM_BOT_TOKEN, bỏ qua bot handler.');
    return null;
  }

  // Đã có bot đang chạy và đang polling thì GIỮ NGUYÊN, tuyệt đối không tạo lặp
  if (bot && bot.isPolling && bot.isPolling()) {
    return bot;
  }

  // Dọn dẹp an toàn bot cũ nếu có trước khi tạo mới
  if (bot) {
    try {
      bot.stopPolling();
    } catch (e) { /* ignore */ }
    bot = null;
  }

  try {
    bot = new TelegramBot(config.telegram.botToken, {
      polling: {
        interval: 2000,
        autoStart: true,
        params: { timeout: 10 },
      },
    });

    // Register command handlers
    bot.onText(/^\/start/, handleStartCommand);
    bot.onText(/^\/help/, handleHelpCommand);
    bot.onText(/^\/gia\s+(.+)/i, handlePriceCommand);
    bot.onText(/^\/phantich\s+(.+)/i, handleAnalyzeCommand);
    bot.onText(/^\/tuanmoi/i, handleWeeklyCommand);
    bot.onText(/^\/team/i, handleTeamCommand);
    bot.onText(/^\/(oi|vithe|ps)/i, handleOICommand);
    bot.onText(/^\/(atc|preatc|pre_atc)/i, handlePreATCCommand);
    bot.onText(/^\/(overnight|ato|postatc|post_atc|quadem)/i, handlePostATCCommand);

    // Free text handler (non-command messages)
    bot.on('message', handleFreeTextMessage);

    // Error handling
    bot.on('polling_error', (error) => {
      if (error.code !== 'ETELEGRAM') {
        console.error('❌ Bot polling error:', error.message);
      }
    });

    console.log('💬 Interactive Bot Handler đã khởi động (polling mode)');
    return bot;
  } catch (error) {
    console.error('❌ Không thể khởi động Bot Handler:', error.message);
    return null;
  }
}

// ─── COMMAND HANDLERS ──────────────────────────────────────

async function handleStartCommand(msg) {
  const chatId = msg.chat.id;
  const welcome = `🇻🇳 <b>Chào mừng đến VN Stock Bot v${config.version}!</b>\n\n` +
    `Tôi là trợ lý AI chứng khoán với đội ngũ <b>4 AI chuyên gia</b>:\n\n` +
    `🤖 <b>AI 1</b> - Bot thông báo (Gemini 2.5 Pro)\n` +
    `📊 <b>AI 2</b> - Chuyên gia Gemini (Gemini 2.5 Pro)\n` +
    `💬 <b>AI 3</b> - Chuyên gia Flash (Gemini 1.5 Flash)\n` +
    `⚔️ <b>AI 4</b> - Phản biện (Gemini 1.5 Pro)\n\n` +
    `<b>Cách dùng:</b>\n` +
    `• Hỏi giá: <code>/gia VCB</code>\n` +
    `• Phân tích: <code>/phantich MWG</code>\n` +
    `• Hoặc chat tự do, VD: "Nên mua FPT không?"\n\n` +
    `<b>Flow xử lý:</b>\n` +
    `📨 Bạn hỏi → 📊 AI 2 + 💬 AI 3 phân tích song song\n` +
    `→ ⚔️ AI 4 phản biện cả 2 → Kết quả cuối cùng\n\n` +
    `Gõ /help để xem chi tiết.`;

  await bot.sendMessage(chatId, welcome, { parse_mode: 'HTML' });
}

async function handleHelpCommand(msg) {
  const chatId = msg.chat.id;
  const help = `📖 <b>HƯỚNG DẪN SỬ DỤNG v${config.version}</b>\n\n` +
    `<b>📝 Lệnh có sẵn:</b>\n` +
    `<code>/gia VCB</code> - Xem giá cổ phiếu\n` +
    `<code>/gia VCB,FPT,MWG</code> - Xem nhiều mã\n` +
    `<code>/phantich MWG</code> - AI Team phân tích CP\n` +
    `<code>/tuanmoi</code> - Phân tích đầu tuần\n` +
    `<code>/team</code> - Xem đội ngũ AI\n` +
    `<code>/oi</code> - Vị thế qua đêm OI & Khối ngoại 5 phiên\n` +
    `<code>/atc</code> - Tình trạng realtime 14h29 (Nên vào ATC không?)\n` +
    `<code>/overnight</code> - Tình trạng realtime 14h44 (Cầm qua đêm hay Đóng?)\n` +
    `<code>/help</code> - Trợ giúp\n\n` +
    `<b>💬 Chat tự do:</b>\n` +
    `Bạn có thể hỏi bất cứ gì về chứng khoán:\n` +
    `• "Giá VCB bao nhiêu?"\n` +
    `• "Nên mua HPG không?"\n` +
    `• "Thị trường hôm nay thế nào?"\n` +
    `• "So sánh FPT với MWG"\n\n` +
    `<b>🤖 Flow AI Team:</b>\n` +
    `1️⃣ AI 2 (Gemini) + AI 3 (GPT) phân tích song song\n` +
    `2️⃣ Kết quả gửi lên group\n` +
    `3️⃣ AI 4 phản biện cả 2 → kết luận cuối\n\n` +
    `<b>⏰ Lịch thông báo tự động:</b>\n` +
    `📊 Báo giá: 10h, 13h, 16h (T2-T6)\n` +
    `🤖 AI Report: 20h30 (T2-T6)\n` +
    `📅 Đầu tuần: 8h30 (Thứ 2)\n\n` +
    `<i>🤖 VN Stock Bot v${config.version} | Multi-AI Team</i>`;

  await bot.sendMessage(chatId, help, { parse_mode: 'HTML' });
}

async function handlePriceCommand(msg, match) {
  const chatId = msg.chat.id;
  const symbols = match[1].toUpperCase().split(/[,\s]+/).filter(s => s.length > 0);

  if (symbols.length === 0) {
    await bot.sendMessage(chatId, '⚠️ Vui lòng nhập mã CP.\nVD: <code>/gia VCB</code>', { parse_mode: 'HTML' });
    return;
  }

  await bot.sendMessage(chatId, `⏳ Đang lấy giá ${symbols.join(', ')}...`);

  try {
    const realtimeData = await fetchRealtimeData(symbols);

    if (!realtimeData || realtimeData.length === 0) {
      await bot.sendMessage(chatId, '❌ Không lấy được dữ liệu. Vui lòng thử lại.');
      return;
    }

    let response = `💰 <b>GIÁ CỔ PHIẾU</b>\n━━━━━━━━━━━━━\n\n`;

    for (const sym of symbols) {
      const data = realtimeData.find(s => s.sym === sym);
      if (data) {
        const price = parseFloat(data.lastPrice || 0) * 1000;
        const changePct = parseFloat(data.changePc || 0);
        const volume = parseInt(data.lot || 0);
        const sign = changePct > 0 ? '+' : '';
        const trend = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        const arrow = changePct > 0 ? '▲' : changePct < 0 ? '▼' : '▬';

        response += `${trend} <b>${sym}</b> ${arrow}\n`;
        response += `   💰 ${price.toLocaleString('vi-VN')} đ (${sign}${changePct}%)\n`;
        response += `   📦 KLGD: ${(volume / 1000).toFixed(1)}K\n\n`;
      } else {
        response += `⚠️ <b>${sym}</b> - Không tìm thấy\n\n`;
      }
    }

    response += `<i>📡 Nguồn: VPS | 🤖 VN Stock Bot</i>`;
    await bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
  }
}

async function handleAnalyzeCommand(msg, match) {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase().trim();

  // TẤT CẢ AIs LUÔN TRẢ LỜI VÀO NHÓM CHÍNH CHO DÙ NHẮN Ở ĐÂU
  const targetGroupChatId = config.telegram.chatId;

  await bot.sendMessage(targetGroupChatId,
    `🤖 Đang phân tích <b>${symbol}</b>...\n` +
    `📊 AI 2 (Gemini Pro) + 💬 AI 3 (Flash) + ⚔️ AI 4\n` +
    `⏳ Chờ khoảng 10-20 giây...`,
    { parse_mode: 'HTML' }
  );

  try {
    const stocks = await getCachedStocks();
    const question = `Phân tích chi tiết cổ phiếu ${symbol}. Nên mua, bán hay giữ? Lý do kỹ thuật và cơ bản?`;

    // Gọi AI Team flow (AI 2 + AI 3 → AI 4)
    await handleInteractiveQuestion(targetGroupChatId, question, stocks);

  } catch (error) {
    await bot.sendMessage(chatId, `❌ Lỗi phân tích: ${error.message}`);
  }
}

async function handleWeeklyCommand(msg) {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, '📅 Đang phân tích tình hình thị trường đầu tuần...');

  try {
    const { runWeeklyAnalysis } = require('./weeklyAnalysis');
    const report = await runWeeklyAnalysis();
    await sendSafeTelegramMessage(chatId, report);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
  }
}

async function handleTeamCommand(msg) {
  const chatId = msg.chat.id;
  const team = `🏢 <b>ĐỘI NGŨ AI CHUYÊN GIA v${config.version}</b>\n\n` +
    `🤖 <b>AI 1 - Bot Thông Báo</b>\n` +
    `   Engine: Gemini 2.5 Pro\n` +
    `   Nhiệm vụ: Báo giá tự động, AI report cuối ngày\n\n` +
    `📊 <b>AI 2 - Chuyên gia Gemini</b>\n` +
    `   Engine: Gemini 2.5 Pro (Google)\n` +
    `   Nhiệm vụ: Phân tích kỹ thuật + cơ bản\n\n` +
    `💬 <b>AI 3 - Chuyên gia Flash</b>\n` +
    `   Engine: Gemini 1.5 Flash\n` +
    `   Nhiệm vụ: Phân tích độc lập, góc nhìn khác, tốc độ xử lý nhanh\n` +
    `   Trạng thái: ✅ Hoạt động\n\n` +
    `⚔️ <b>AI 4 - Phản biện</b>\n` +
    `   Engine: Gemini 1.5 Pro\n` +
    `   Nhiệm vụ: Phản biện kết quả AI 2+3, chỉ ra rủi ro ẩn\n` +
    `   Trạng thái: ✅ Hoạt động\n\n` +
    `<b>🔄 Flow xử lý:</b>\n` +
    `User hỏi → AI 2 + AI 3 (song song) → Gửi Tele\n` +
    `→ AI 4 phản biện cả 2 → Gửi kết luận cuối\n\n` +
    `<i>🤖 VN Stock Bot v${config.version}</i>`;

  await bot.sendMessage(chatId, team, { parse_mode: 'HTML' });
}

async function handleOICommand(msg) {
  const chatId = msg.chat.id;
  try {
    const { buildOIEveningNotification } = require('./derivatives/oiTracker');
    const reply = buildOIEveningNotification();
    await bot.sendMessage(chatId, reply, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    console.error('❌ Lỗi handleOICommand:', error.message);
    await bot.sendMessage(chatId, '❌ Không thể lấy báo cáo OI & Vị thế lúc này.');
  }
}

async function handlePreATCCommand(msg) {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, '⏳ Đang phân tích Realtime trước ATC (NN, Tay to, Đám đông)...');
    const { buildPreATCNotificationAsync } = require('./derivatives/oiTracker');
    const reply = await buildPreATCNotificationAsync();
    await bot.sendMessage(chatId, reply, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    console.error('❌ Lỗi handlePreATCCommand:', error.message);
    await bot.sendMessage(chatId, '❌ Không thể lấy báo cáo Pre-ATC lúc này.');
  }
}

async function handlePostATCCommand(msg) {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, '⏳ Đang phân tích Realtime chốt ATC & Vị thế qua đêm...');
    const { buildPostATCNotificationAsync } = require('./derivatives/oiTracker');
    const reply = await buildPostATCNotificationAsync();
    await bot.sendMessage(chatId, reply, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    console.error('❌ Lỗi handlePostATCCommand:', error.message);
    await bot.sendMessage(chatId, '❌ Không thể lấy báo cáo Post-ATC lúc này.');
  }
}

// ─── FREE TEXT HANDLER ─────────────────────────────────────

async function handleFreeTextMessage(msg) {
  // Skip commands
  if (!msg.text || msg.text.startsWith('/')) return;

  // Skip old messages (> 30s)
  const msgAge = Date.now() / 1000 - msg.date;
  if (msgAge > 30) return;

  const chatId = msg.chat.id;
  const userText = msg.text.trim();

  // Skip too short
  if (userText.length < 3) return;

  // Rate-limit: chờ 2 phút giữa các câu hỏi
  const userId = msg.from?.id || chatId;
  const now = Date.now();
  const lastTime = lastUserQuestion[userId] || 0;
  if (now - lastTime < USER_COOLDOWN) {
    const remaining = Math.ceil((USER_COOLDOWN - (now - lastTime)) / 1000);
    await bot.sendMessage(chatId,
      `⏳ Vui lòng chờ ${remaining}s trước khi hỏi tiếp (tránh quá tải AI miễn phí).`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }
  lastUserQuestion[userId] = now;

  console.log(`\n💬 User [${msg.from?.first_name || 'Unknown'}]: "${userText}"`);

  // Typing indicator
  try { await bot.sendChatAction(chatId, 'typing'); } catch (e) { /* */ }

  // TẤT CẢ PHẢN HỒI GỬI VÀO NHÓM CHÍNH
  const targetGroupChatId = config.telegram.chatId;

  // Thông báo đang xử lý
  const statusMsg = await bot.sendMessage(targetGroupChatId,
    `⏳ Đang gửi cho đội ngũ AI phân tích...\n` +
    `📊 Gemini Pro + 💬 Gemini Flash + ⚔️ AI Phản biện`,
    { reply_to_message_id: msg.chat.id.toString() === targetGroupChatId.toString() ? msg.message_id : undefined }
  );

  try {
    const stocks = await getCachedStocks();

    // Gọi full AI Team flow
    await handleInteractiveQuestion(targetGroupChatId, userText, stocks);

    // Xoá thông báo "đang chờ"
    await bot.deleteMessage(targetGroupChatId, statusMsg.message_id).catch(() => {});

  } catch (error) {
    console.error('❌ Lỗi xử lý tin nhắn:', error.message);
    try {
      await bot.deleteMessage(chatId, statusMsg.message_id);
    } catch (e) { /* ignore */ }
    await bot.sendMessage(chatId, '⚠️ Đã xảy ra lỗi. Vui lòng thử lại sau.', {
      reply_to_message_id: msg.message_id,
    });
  }
}

// ─── HELPERS ───────────────────────────────────────────────

async function getCachedStocks() {
  const now = Date.now();
  if (cachedStocks && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedStocks;
  }
  try {
    cachedStocks = await fetchAllStocks();
    cacheTimestamp = now;
    return cachedStocks;
  } catch (error) {
    console.error('❌ Lỗi fetch stocks cho cache:', error.message);
    return cachedStocks || [];
  }
}

/**
 * Gửi message lên Telegram, tự split nếu quá dài
 */
async function sendSafeTelegramMessage(chatId, message) {
  if (!message || message.length === 0) return;

  const parts = splitLongMessage(message);
  for (const part of parts) {
    try {
      await bot.sendMessage(chatId, part, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      if (parts.length > 1) await sleep(500);
    } catch (error) {
      // Retry without HTML if parse fails
      if (error.response?.body?.description?.includes('parse')) {
        const plainText = part.replace(/<[^>]+>/g, '');
        await bot.sendMessage(chatId, plainText);
      } else {
        throw error;
      }
    }
  }
}

function splitLongMessage(msg, maxLen = 4000) {
  if (msg.length <= maxLen) return [msg];
  const parts = [];
  let remaining = msg;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { parts.push(remaining); break; }
    let idx = remaining.lastIndexOf('\n\n', maxLen);
    if (idx === -1 || idx < maxLen * 0.3) idx = remaining.lastIndexOf('\n', maxLen);
    if (idx === -1 || idx < maxLen * 0.3) idx = maxLen;
    parts.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).trimStart();
  }
  return parts;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stopBotHandler() {
  if (bot) {
    try {
      bot.stopPolling();
    } catch (e) { /* ignore */ }
    bot = null;
    console.log('💬 Bot Handler đã dừng (standby mode)');
  }
}

module.exports = { startBotHandler, stopBotHandler };
