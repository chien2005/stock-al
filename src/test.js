/**
 * 🧪 Test script - Kiểm tra từng module
 * Usage: npm test
 */

const { config, validateConfig } = require('./config');
const { fetchAllStocks, fetchRealtimeData } = require('./stockService');
const { sendTelegramMessage, formatStockMessage } = require('./telegramService');

async function runTests() {
  console.log('🧪 BẮT ĐẦU TEST...\n');
  let passed = 0;
  let failed = 0;

  // Test 1: Config
  console.log('─── Test 1: Config ───');
  try {
    validateConfig();
    console.log(`   ✅ Bot Token: ${config.telegram.botToken ? '***' + config.telegram.botToken.slice(-6) : 'MISSING'}`);
    console.log(`   ✅ Chat ID: ${config.telegram.chatId}`);
    console.log(`   ✅ Symbols: ${config.stockSymbols.join(', ')}`);
    console.log(`   ✅ Schedule: ${config.cronSchedule}`);
    passed++;
  } catch (e) {
    console.log(`   ❌ Config error: ${e.message}`);
    failed++;
  }

  // Test 2: Fetch realtime (1 mã)
  console.log('\n─── Test 2: Fetch realtime FPT ───');
  try {
    const data = await fetchRealtimeData(['FPT']);
    if (data && data.length > 0) {
      console.log(`   ✅ Lấy được dữ liệu FPT từ VPS`);
      const d = data[0];
      console.log(`   📊 Giá: ${d.lastPrice}, KL: ${d.lot}, Trần: ${d.c}, Sàn: ${d.f}, TC: ${d.r}`);
      passed++;
    } else {
      console.log(`   ❌ Không lấy được dữ liệu FPT`);
      failed++;
    }
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
    failed++;
  }

  // Test 3: Fetch all stocks + format
  console.log('\n─── Test 3: Fetch tất cả mã + format message ───');
  try {
    const stocks = await fetchAllStocks();
    const successful = stocks.filter(s => !s.error).length;
    console.log(`   📊 Kết quả: ${successful}/${stocks.length} mã thành công`);

    if (successful > 0) {
      const message = formatStockMessage(stocks);
      console.log(`   ✅ Message length: ${message.length} chars`);
      passed++;
    } else {
      console.log('   ❌ Không có mã nào thành công');
      failed++;
    }
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
    failed++;
  }

  // Test 4: Send to Telegram
  console.log('\n─── Test 4: Gửi test message Telegram ───');
  try {
    const testMsg = `🧪 <b>VN Stock Bot - Test Message</b>\n\n✅ Bot đang hoạt động tốt!\n🕐 ${new Date().toLocaleString('vi-VN', { timeZone: config.timezone })}`;
    const sent = await sendTelegramMessage(testMsg);
    if (sent) {
      console.log('   ✅ Gửi Telegram thành công!');
      passed++;
    } else {
      console.log('   ❌ Gửi Telegram thất bại!');
      failed++;
    }
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
    failed++;
  }

  // Summary
  console.log('\n' + '═'.repeat(40));
  console.log(`🧪 KẾT QUẢ: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(40));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
