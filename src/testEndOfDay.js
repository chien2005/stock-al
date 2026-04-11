/**
 * TEST: Báo cáo cuối ngày v1.2.0 với market scan + VN30 index
 */
require('dotenv').config();
const { config, validateConfig } = require('./config');
const { fetchAllStocks, fetchVN30Index, fetchMarketScan } = require('./stockService');
const { initAIEngines, runScheduledAnalysis } = require('./aiTeam');

async function testEndOfDay() {
  console.log('═'.repeat(55));
  console.log(`🧪 TEST v${config.version} - Market Scan + VN30 Index`);
  console.log('═'.repeat(55));

  validateConfig();
  console.log('\n🧠 Khởi tạo AI Engines...');
  initAIEngines();

  // Fetch tất cả song song
  console.log('\n📡 Fetching data...');
  const [stocks, vn30Index] = await Promise.all([
    fetchAllStocks(),
    fetchVN30Index(),
  ]);

  if (!stocks || stocks.length === 0) {
    console.error('❌ Không lấy được dữ liệu!');
    process.exit(1);
  }

  // Market scan
  console.log('\n🔍 Quét dòng tiền toàn thị trường...');
  const marketScan = await fetchMarketScan(config.stockSymbols);

  // Chạy báo cáo cuối ngày
  console.log('\n🏢 Chạy báo cáo cuối ngày...');
  const startTime = Date.now();
  await runScheduledAnalysis(stocks, { marketScan, vn30Index });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✅ TEST HOÀN THÀNH! (${elapsed}s)`);
  console.log('📲 Kiểm tra Telegram group.');
  process.exit(0);
}

testEndOfDay().catch(err => {
  console.error('💥 Lỗi:', err);
  process.exit(1);
});
