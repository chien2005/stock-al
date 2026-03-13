/**
 * 🔄 Script chạy nhanh 1 lần để test
 * Usage: npm run fetch
 * 
 * Lấy dữ liệu stock và gửi Telegram ngay lập tức
 * (không cần chờ schedule)
 */

const { validateConfig } = require('./config');
const { fetchAllStocks } = require('./stockService');
const { sendTelegramMessage, formatStockMessage } = require('./telegramService');

async function fetchNow() {
  console.log('🔄 Chạy fetch ngay lập tức...\n');

  validateConfig();

  try {
    const stocks = await fetchAllStocks();

    if (stocks.length === 0) {
      console.log('❌ Không lấy được dữ liệu nào!');
      return;
    }

    const message = formatStockMessage(stocks);

    // In ra console trước
    console.log('\n📋 Preview message:');
    console.log('─'.repeat(50));
    // Strip HTML tags cho console
    const plainText = message.replace(/<[^>]+>/g, '');
    console.log(plainText);
    console.log('─'.repeat(50));

    // Hỏi có muốn gửi Telegram không
    console.log('\n📩 Đang gửi lên Telegram...');
    const sent = await sendTelegramMessage(message);

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

fetchNow();
