/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║       🇻🇳 VN STOCK BOT - Configuration v2.1.0            ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

require('dotenv').config();

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
  geminiAI1: { apiKey: process.env.GEMINI_API_KEY_AI1 || '' },
  geminiAI2: {
    apiKey: process.env.GEMINI_API_KEY_AI2 || process.env.GEMINI_API_KEY_AI1 || '',
    model: 'gemini-2.5-flash',
  },
  geminiAI3: { 
    apiKey: process.env.GEMINI_API_KEY_AI3 || '',
    model: 'gemini-2.5-flash',
  },
  geminiAI4: {
    apiKey: process.env.GEMINI_API_KEY_AI4 || process.env.GEMINI_API_KEY_AI2 || process.env.GEMINI_API_KEY_AI1 || '',
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

  // Stock symbols
  stockSymbols: (() => {
    let symbols = (process.env.STOCK_SYMBOLS || 'VCB,FPT,VIC,HPG,MWG,MSN,VHM,TCB,ACB,VPB,MBB')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);
    
    // Always exclude VNM and index symbols (which are fetched separately)
    const excluded = ['VNM', 'VN30', 'VN30INDEX', 'VNINDEX'];
    symbols = symbols.filter(s => !excluded.includes(s));
    
    // Always guarantee TCB and ACB are included
    if (!symbols.includes('TCB')) symbols.push('TCB');
    if (!symbols.includes('ACB')) symbols.push('ACB');
    
    return symbols;
  })(),

  // Cron: báo giá (thứ 2-6, 10h/13h/16h)
  cronSchedule: process.env.CRON_SCHEDULE || '0 10,13,16 * * 1-5',

  // Cron: AI phân tích cuối phiên (thứ 2-6, 16h05 - ngay sau báo giá 16h)
  cronAfterCloseSchedule: process.env.CRON_AFTER_CLOSE_SCHEDULE || '5 16 * * 1-5',

  // Cron: AI phân tích đa chuyên gia (thứ 2-6, 20h30)
  cronAiSchedule: process.env.CRON_AI_SCHEDULE || '30 20 * * 1-5',

  // Cron: Báo cáo TTCK quốc tế + giá vàng (MỖI NGÀY, 21h00 - kể cả T7/CN)
  cronGlobalSchedule: process.env.CRON_GLOBAL_SCHEDULE || '0 21 * * *',

  // Cron: Phân tích đầu tuần (Thứ 2, 8h30)
  cronWeeklySchedule: process.env.CRON_WEEKLY_SCHEDULE || '30 8 * * 1',

  // Bật/tắt interactive bot (polling)
  enableInteractiveBot: (process.env.ENABLE_INTERACTIVE_BOT || 'true') === 'true',

  // Timezone
  timezone: process.env.TZ || 'Asia/Ho_Chi_Minh',

  // Version
  version: '2.4.0',
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
