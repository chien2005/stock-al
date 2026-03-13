/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                                                               ║
 * ║     🇻🇳  VN STOCK TRACKER & TELEGRAM NOTIFIER  📊            ║
 * ║                                                               ║
 * ║     📊 Báo giá: 10:00, 13:00, 16:00 (Thứ 2 → Thứ 6)        ║
 * ║     🤖 AI Report: 20:30 hằng ngày (Thứ 2 → Thứ 6)          ║
 * ║                                                               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Source: VPS (VPBank Securities) Public API                   ║
 * ║  AI:     Google Gemini / Rule-based fallback                  ║
 * ║  Stack:  Node.js + node-cron + axios + @google/generative-ai ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const cron = require('node-cron');
const { config, validateConfig } = require('./config');
const { fetchAllStocks } = require('./stockService');
const { sendTelegramMessage, formatStockMessage } = require('./telegramService');
const { runAiAnalysis } = require('./aiAnalysis');

// ─── JOB 1: BÁO GIÁ (10h, 13h, 16h) ────────────────────

/**
 * Job báo giá: Lấy dữ liệu stock → Format → Gửi Telegram
 */
async function runStockJob() {
  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('📊 BÁO GIÁ CHỨNG KHOÁN...');
  console.log('═'.repeat(55));

  try {
    const stocks = await fetchAllStocks();

    if (stocks.length === 0) {
      console.error('❌ Không lấy được dữ liệu nào!');
      await sendTelegramMessage('⚠️ VN Stock Bot: Không lấy được dữ liệu chứng khoán.');
      return;
    }

    const message = formatStockMessage(stocks);
    const sent = await sendTelegramMessage(message);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (sent) {
      console.log(`\n✅ BÁO GIÁ HOÀN THÀNH! (${elapsed}s)`);
      console.log(`   📊 ${stocks.filter(s => !s.error).length}/${stocks.length} mã thành công`);
    } else {
      console.log(`\n⚠️ Lấy dữ liệu OK nhưng gửi Telegram thất bại (${elapsed}s)`);
    }
  } catch (error) {
    console.error('\n💥 LỖI:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi báo giá:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

// ─── JOB 2: AI PHÂN TÍCH (20h30) ─────────────────────────

/**
 * Job AI: Lấy dữ liệu cuối ngày → AI phân tích → Gửi report Telegram
 */
async function runAiJob() {
  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('🤖 AI PHÂN TÍCH CỔ PHIẾU CUỐI NGÀY...');
  console.log('═'.repeat(55));

  try {
    // Lấy dữ liệu cuối ngày
    const stocks = await fetchAllStocks();

    if (stocks.length === 0) {
      console.error('❌ Không lấy được dữ liệu!');
      await sendTelegramMessage('⚠️ VN Stock Bot: Không lấy được dữ liệu để phân tích AI.');
      return;
    }

    // Chạy AI analysis
    const report = await runAiAnalysis(stocks);
    const sent = await sendTelegramMessage(report);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (sent) {
      console.log(`\n✅ AI REPORT HOÀN THÀNH! (${elapsed}s)`);
    } else {
      console.log(`\n⚠️ Phân tích xong nhưng gửi Telegram thất bại (${elapsed}s)`);
    }
  } catch (error) {
    console.error('\n💥 LỖI AI:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi AI analysis:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

// ─── STARTUP ──────────────────────────────────────────────

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║                                                       ║
  ║   🇻🇳  VN STOCK TRACKER & TELEGRAM NOTIFIER  📊      ║
  ║                                                       ║
  ║   📊 Báo giá:  10:00 | 13:00 | 16:00  (T2-T6)       ║
  ║   🤖 AI Report: 20:30              (T2-T6)           ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
  `);

  // Validate config
  validateConfig();

  console.log('📋 Cấu hình:');
  console.log(`   📌 Mã theo dõi:  ${config.stockSymbols.join(', ')}`);
  console.log(`   ⏰ Báo giá:      ${config.cronSchedule}`);
  console.log(`   🤖 AI phân tích: ${config.cronAiSchedule}`);
  console.log(`   🌏 Timezone:     ${config.timezone}`);
  console.log(`   📩 Chat ID:      ${config.telegram.chatId}`);
  console.log(`   🧠 AI Engine:    ${config.gemini.apiKey ? 'Google Gemini 2.5 Flash ✅' : 'Rule-based (thêm GEMINI_API_KEY để dùng AI)'}`);
  console.log('');

  // Validate cron expressions
  if (!cron.validate(config.cronSchedule)) {
    console.error(`❌ Cron báo giá không hợp lệ: ${config.cronSchedule}`);
    process.exit(1);
  }
  if (!cron.validate(config.cronAiSchedule)) {
    console.error(`❌ Cron AI không hợp lệ: ${config.cronAiSchedule}`);
    process.exit(1);
  }

  // Chạy báo giá 1 lần khi khởi động (bỏ qua trên cloud để tránh spam)
  if (!process.env.RAILWAY_ENVIRONMENT && !process.env.RENDER) {
    console.log('🔄 Chạy báo giá lần đầu (local mode)...');
    await runStockJob();
  } else {
    console.log('☁️  Cloud mode - chờ đến giờ schedule...');
  }

  // ─── SCHEDULE JOB 1: BÁO GIÁ (T2-T6, 10h/13h/16h) ────
  cron.schedule(config.cronSchedule, () => {
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n⏰ [Báo giá] Cron triggered: ${now}`);
    runStockJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── SCHEDULE JOB 2: AI REPORT (T2-T6, 20h30) ─────────
  cron.schedule(config.cronAiSchedule, () => {
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n🤖 [AI Analysis] Cron triggered: ${now}`);
    runAiJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  console.log('\n' + '─'.repeat(55));
  console.log('🟢 Bot đang chạy! Schedule đã kích hoạt:');
  console.log(`   📊 Báo giá:  ${config.cronSchedule} (${config.timezone})`);
  console.log(`   🤖 AI Report: ${config.cronAiSchedule} (${config.timezone})`);
  console.log('   📅 Chỉ chạy Thứ 2 → Thứ 6');
  console.log('   💡 Nhấn Ctrl+C để dừng');
  console.log('─'.repeat(55) + '\n');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Bot đã dừng. Hẹn gặp lại!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Bot đã dừng (SIGTERM).');
  process.exit(0);
});

// Prevent crash on unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
});

// Run!
main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
