/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║       🇻🇳 VN STOCK BOT - Configuration v1.1.1            ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

require('dotenv').config();

const config = {
  // Telegram - Multi-Bot (mỗi AI 1 bot riêng)
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,        // AI 1: Bot thông báo (main)
    botTokenAI2: process.env.TELEGRAM_BOT_TOKEN_AI2, // AI 2: Chuyên gia Gemini
    botTokenAI3: process.env.TELEGRAM_BOT_TOKEN_AI3, // AI 3: Chuyên gia GPT
    botTokenAI4: process.env.TELEGRAM_BOT_TOKEN_AI4, // AI 4: AI Phản biện
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  // Google Gemini Keys - ALL FREE (2 keys luân phiên chống spam)
  // Key 1: AI 1 (báo giá) + AI 3 (flash) — luân phiên 60s
  // Key 2: AI 2 (expert) + AI 4 (phản biện) — luân phiên 60s
  geminiAI1: { apiKey: process.env.GEMINI_API_KEY_AI1 || '' },
  geminiAI2: { apiKey: process.env.GEMINI_API_KEY_AI2 || '' },
  geminiAI3: { 
    apiKey: process.env.GEMINI_API_KEY_AI3 || '',
    model: 'gemini-2.5-flash',
  },
  geminiAI4: {
    apiKey: process.env.GEMINI_API_KEY_AI4 || process.env.GEMINI_API_KEY_AI2 || '',
    model: 'gemini-2.5-pro',
  },

  // Stock symbols
  stockSymbols: (process.env.STOCK_SYMBOLS || 'VNM,FPT,VIC,HPG,MWG,MSN,VHM,TCB,VPB,MBB')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length > 0),

  // Cron: báo giá (thứ 2-6, 10h/13h/16h)
  cronSchedule: process.env.CRON_SCHEDULE || '0 10,13,16 * * 1-5',

  // Cron: AI phân tích đa chuyên gia (thứ 2-6, 20h30)
  cronAiSchedule: process.env.CRON_AI_SCHEDULE || '30 20 * * 1-5',

  // Cron: Phân tích đầu tuần (Thứ 2, 8h30)
  cronWeeklySchedule: process.env.CRON_WEEKLY_SCHEDULE || '30 8 * * 1',

  // Bật/tắt interactive bot (polling)
  enableInteractiveBot: (process.env.ENABLE_INTERACTIVE_BOT || 'true') === 'true',

  // Timezone
  timezone: process.env.TZ || 'Asia/Ho_Chi_Minh',

  // Version
  version: '1.1.1',
};

// Validate required config
function validateConfig() {
  const errors = [];
  if (!config.telegram.botToken) errors.push('❌ Missing TELEGRAM_BOT_TOKEN in .env');
  if (!config.telegram.chatId) errors.push('❌ Missing TELEGRAM_CHAT_ID in .env');
  if (config.stockSymbols.length === 0) errors.push('❌ No stock symbols configured');

  // Warnings (non-fatal)
  const warnings = [];
  if (!config.geminiAI1.apiKey) warnings.push('⚠️  Missing GEMINI_API_KEY_AI1');
  if (!config.geminiAI2.apiKey) warnings.push('⚠️  Missing GEMINI_API_KEY_AI2');
  if (!config.geminiAI3.apiKey) warnings.push('⚠️  Missing GEMINI_API_KEY_AI3');
  if (!config.telegram.botTokenAI2) warnings.push('⚠️  Missing TELEGRAM_BOT_TOKEN_AI2 - AI 2 dùng bot chính');
  if (!config.telegram.botTokenAI3) warnings.push('⚠️  Missing TELEGRAM_BOT_TOKEN_AI3 - AI 3 dùng bot chính');
  if (!config.telegram.botTokenAI4) warnings.push('⚠️  Missing TELEGRAM_BOT_TOKEN_AI4 - AI 4 dùng bot chính');

  if (errors.length > 0) {
    console.error('\n🚨 Configuration Errors:');
    errors.forEach(e => console.error(`   ${e}`));
    console.error('\n📝 Please check your .env file\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  Configuration Warnings:');
    warnings.forEach(w => console.log(`   ${w}`));
  }
}

module.exports = { config, validateConfig };
