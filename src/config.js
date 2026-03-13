/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║           🇻🇳 VN STOCK TRACKER - Configuration           ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

require('dotenv').config();

const config = {
  // Telegram
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  // Google Gemini AI
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  // Stock symbols
  stockSymbols: (process.env.STOCK_SYMBOLS || 'VNM,FPT,VIC,HPG,MWG,MSN,VHM,TCB,VPB,MBB')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length > 0),

  // Cron: báo giá (thứ 2-6, 10h/13h/16h)
  cronSchedule: process.env.CRON_SCHEDULE || '0 10,13,16 * * 1-5',

  // Cron: AI phân tích (thứ 2-6, 20h30)
  cronAiSchedule: process.env.CRON_AI_SCHEDULE || '30 20 * * 1-5',

  // Timezone
  timezone: process.env.TZ || 'Asia/Ho_Chi_Minh',
};

// Validate required config
function validateConfig() {
  const errors = [];
  if (!config.telegram.botToken) errors.push('❌ Missing TELEGRAM_BOT_TOKEN in .env');
  if (!config.telegram.chatId) errors.push('❌ Missing TELEGRAM_CHAT_ID in .env');
  if (config.stockSymbols.length === 0) errors.push('❌ No stock symbols configured');

  if (errors.length > 0) {
    console.error('\n🚨 Configuration Errors:');
    errors.forEach(e => console.error(`   ${e}`));
    console.error('\n📝 Please check your .env file\n');
    process.exit(1);
  }
}

module.exports = { config, validateConfig };
