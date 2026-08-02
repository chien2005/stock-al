/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║       🇻🇳 VN STOCK BOT - Configuration v2.1.0            ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

require('dotenv').config();
const userConfig = require('./userConfig');

function cleanApiKey(key) {
  if (!key || typeof key !== 'string' || key.trim() === '' || key.includes('PASTE_')) {
    return null;
  }
  return key.trim();
}

const geminiKey1 = cleanApiKey(process.env.GEMINI_API_KEY_AI1) || '';
const geminiKey2 = cleanApiKey(process.env.GEMINI_API_KEY_AI2) || geminiKey1;
const geminiKey3 = cleanApiKey(process.env.GEMINI_API_KEY_AI3) || geminiKey1;
const geminiKey4 = cleanApiKey(process.env.GEMINI_API_KEY_AI4) || geminiKey2 || geminiKey1;

const config = {
  // Telegram - Multi-Bot (mỗi AI 1 bot riêng)
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,        // AI 1: Bot thông báo (main)
    botTokenAI2: process.env.TELEGRAM_BOT_TOKEN_AI2, // AI 2: Chuyên gia
    botTokenAI3: process.env.TELEGRAM_BOT_TOKEN_AI3, // AI 3: Chuyên gia Flash
    botTokenAI4: process.env.TELEGRAM_BOT_TOKEN_AI4, // AI 4: AI Phản biện
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  // Google Gemini Keys - ALL FREE (fallback khi OpenRouter lỗi)
  geminiAI1: { apiKey: geminiKey1 },
  geminiAI2: {
    apiKey: geminiKey2,
    model: 'gemini-2.5-flash',
  },
  geminiAI3: { 
    apiKey: geminiKey3,
    model: 'gemini-2.5-flash',
  },
  geminiAI4: {
    apiKey: geminiKey4,
    model: 'gemini-2.5-flash',
  },

  // ═══════════════════════════════════════════════════════════
  // OpenRouter (FREE models) - 1 API key, mỗi AI dùng model khác nhau
  // Đăng ký miễn phí: https://openrouter.ai/keys
  // Rate limit: ~20 req/min, ~200 req/day
  // ═══════════════════════════════════════════════════════════
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseURL: 'https://openrouter.ai/api/v1',

    // AI 2: Chuyên gia phân tích - Google Gemma 4 31B (FREE, kiểm tra OK)
    modelAI2: process.env.OPENROUTER_MODEL_AI2 || 'google/gemma-4-31b-it:free',

    // AI 3: Flash expert - LLaMA 3.3 70B (FREE, kiểm tra OK)
    modelAI3: process.env.OPENROUTER_MODEL_AI3 || 'meta-llama/llama-3.3-70b-instruct:free',

    // AI 4: Phản biện - GPT-OSS 120B (FREE, kiểm tra OK)
    modelAI4: process.env.OPENROUTER_MODEL_AI4 || 'openai/gpt-oss-120b:free',
  },

  // Stock symbols (đọc từ .env hoặc userConfig.js)
  stockSymbols: (() => {
    let raw = process.env.STOCK_SYMBOLS 
      ? process.env.STOCK_SYMBOLS.split(',').map(s => s.trim())
      : (userConfig.stockSymbols || []);
    
    // Always exclude VNM and index symbols (which are fetched separately)
    const excluded = ['VNM', 'VN30', 'VN30INDEX', 'VNINDEX'];
    let symbols = raw.filter(s => s && !excluded.includes(s));
    
    return symbols;
  })(),

  // Cron: báo giá (đọc trực tiếp từ userConfig.js)
  cronSchedule: userConfig.cronSchedule,

  // Cron: AI phân tích cuối phiên (thứ 2-6, 16h05) - mặc định giữ nguyên nhưng không chạy
  cronAfterCloseSchedule: '5 16 * * 1-5',

  // Cron: báo giá kết phiên (đọc trực tiếp từ userConfig.js)
  cronCloseSchedule: userConfig.cronCloseSchedule,

  // Cron: AI phân tích đa chuyên gia (đọc trực tiếp từ userConfig.js)
  cronAiSchedule: userConfig.cronAiSchedule,

  // Cron: Báo cáo TTCK quốc tế + giá vàng (đọc trực tiếp từ userConfig.js)
  cronGlobalSchedule: userConfig.cronGlobalSchedule,

  // Cron: Phân tích đầu tuần (đọc trực tiếp từ userConfig.js)
  cronWeeklySchedule: userConfig.cronWeeklySchedule,

  // Bật/tắt interactive bot (polling)
  enableInteractiveBot: (process.env.ENABLE_INTERACTIVE_BOT || 'true') === 'true',

  // Timezone
  timezone: process.env.TZ || 'Asia/Ho_Chi_Minh',

  // Version
  version: '2.5.0',
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
  if (!config.openRouter.apiKey) warnings.push('⚠️  Missing OPENROUTER_API_KEY - AI 2/3/4 dùng Gemini fallback');
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
