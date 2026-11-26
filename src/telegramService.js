/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║         📩 VN STOCK TRACKER - Telegram Transport          ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║  Kênh gửi tin nhắn Telegram an toàn (HTML + Chunking)     ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function splitMessage(msg, maxLen = 4000) {
  if (!msg || msg.length <= maxLen) return [msg || ''];

  const chunks = [];
  let remaining = msg;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }

  return chunks;
}

async function sendMessageSafe(chatId, text) {
  if (!config.telegram.botToken || !chatId) {
    throw new Error('Thiếu TELEGRAM_BOT_TOKEN hoặc chatId');
  }
  try {
    return await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (error) {
    const data = error.response?.data;
    const desc = data?.description || error.message;

    const migrateTo = data?.parameters?.migrate_to_chat_id;
    if (migrateTo) {
      console.warn(`🔄 Telegram group chat migrated to supergroup: ${chatId} -> ${migrateTo}`);
      if (config.telegram.chatIdDerivatives == chatId) {
        config.telegram.chatIdDerivatives = migrateTo;
      }
      if (config.telegram.chatId == chatId) {
        config.telegram.chatId = migrateTo;
      }
      return await sendMessageSafe(migrateTo, text);
    }

    if (desc && (desc.includes("can't parse entities") || desc.includes("Bad Request: can't parse"))) {
      console.warn(`⚠️ Telegram HTML entity parse error, retrying as plain text... (${desc})`);
      const plainText = text.replace(/<[^>]+>/g, '');
      return await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: plainText,
        disable_web_page_preview: true,
      });
    }
    throw error;
  }
}

async function sendToChat(chatId, message) {
  const chunks = splitMessage(message, 4000);
  for (const chunk of chunks) {
    await sendMessageSafe(chatId, chunk);
    if (chunks.length > 1) {
      await sleep(500);
    }
  }
}

async function sendTelegramMessage(message) {
  try {
    await sendToChat(config.telegram.chatId, message);
    return true;
  } catch (error) {
    console.error('❌ Lỗi gửi Telegram:', error.response?.data?.description || error.message);
    return false;
  }
}

async function sendDerivativesMessage(message) {
  try {
    const chatId = config.telegram.chatIdDerivatives || config.telegram.chatId;
    await sendToChat(chatId, message);
    return true;
  } catch (error) {
    console.error('❌ Lỗi gửi Telegram (Ps):', error.response?.data?.description || error.message);
    return false;
  }
}

async function sendTradingDemoMessage(message) {
  try {
    const chatId = config.telegram.chatIdTradingDemo || '-5509642518';
    await sendToChat(chatId, message);
    return true;
  } catch (error) {
    console.error('❌ Lỗi gửi Telegram (Trading Demo):', error.response?.data?.description || error.message);
    return false;
  }
}

module.exports = {
  sendMessageSafe,
  sendToChat,
  sendTelegramMessage,
  sendDerivativesMessage,
  sendTradingDemoMessage,
  splitMessage,
};
