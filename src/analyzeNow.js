/**
 * 🤖 Script chạy AI phân tích 1 lần để test
 * Usage: npm run analyze
 */

const { validateConfig } = require('./config');
const { fetchAllStocks } = require('./stockService');
const { sendTelegramMessage } = require('./telegramService');
const { runAiAnalysis } = require('./aiAnalysis');

async function analyzeNow() {
  console.log('🤖 Chạy AI phân tích ngay...\n');

  validateConfig();

  try {
    // Lấy dữ liệu
    const stocks = await fetchAllStocks();

    if (stocks.length === 0) {
      console.log('❌ Không lấy được dữ liệu!');
      return;
    }

    // Chạy AI analysis
    const report = await runAiAnalysis(stocks);

    // Preview
    console.log('\n📋 Preview report:');
    console.log('─'.repeat(50));
    const plainText = report.replace(/<[^>]+>/g, '');
    console.log(plainText);
    console.log('─'.repeat(50));

    // Gửi Telegram
    console.log('\n📩 Đang gửi lên Telegram...');
    const sent = await sendTelegramMessage(report);

    if (sent) {
      console.log('✅ Đã gửi thành công!');
    } else {
      console.log('❌ Gửi thất bại!');
    }
  } catch (error) {
    console.error('💥 Lỗi:', error.message);
    console.error(error.stack);
  }
}

analyzeNow();
