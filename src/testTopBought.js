/**
 * Test: Top Bought Stocks Scanner
 * Kiểm tra quét top CP mua nhiều nhất
 */

require('dotenv').config();

async function testTopBought() {
  console.log('═'.repeat(55));
  console.log('🏆 TEST: Top Bought Stocks Scanner');
  console.log('═'.repeat(55));

  const { fetchTopBoughtStocks } = require('./stockService');

  try {
    const startTime = Date.now();
    const data = await fetchTopBoughtStocks(5);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!data) {
      console.log('❌ Không có dữ liệu (ngoài giờ giao dịch?)');
      return;
    }

    console.log(`\n✅ Hoàn thành! (${elapsed}s)`);
    console.log(`   📊 Quét: ${data.stats.totalScanned} mã`);
    console.log(`   📈 Tăng: ${data.stats.gainers} | 📉 Giảm: ${data.stats.losers}`);
    console.log(`   TB thay đổi: ${data.stats.avgChange}%`);
    console.log(`   NN ròng tổng: ${data.stats.totalForeignNet.toLocaleString()}`);

    console.log(`\n🏆 TOP 5 CP MUA NHIỀU NHẤT:`);
    console.log('─'.repeat(50));

    for (let i = 0; i < data.topBought.length; i++) {
      const s = data.topBought[i];
      const sign = s.changePct >= 0 ? '+' : '';
      console.log(`   ${i + 1}. ${s.symbol}`);
      console.log(`      Giá: ${s.price.toLocaleString()}đ (${sign}${s.changePct}%)`);
      console.log(`      KLGD: ${s.volume.toLocaleString()}`);
      console.log(`      NN ròng: ${s.foreignNet.toLocaleString()} (Buy Pressure: ${s.buyPressure}%)`);
      console.log(`      Composite Score: ${s.compositeScore}/100`);
      if (s.signals.length > 0) {
        console.log(`      Signals: ${s.signals.join(', ')}`);
      }
      console.log('');
    }

  } catch (error) {
    console.error('💥 Error:', error);
  }
}

testTopBought();
