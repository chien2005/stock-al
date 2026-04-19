/**
 * Test: Global Market Service
 * Kiểm tra fetch data TTCK quốc tế
 */

require('dotenv').config();

async function testGlobalMarket() {
  console.log('═'.repeat(55));
  console.log('🌍 TEST: Global Market Service');
  console.log('═'.repeat(55));

  const { fetchAllGlobalData, buildGlobalMarketTelegramMessage } = require('./globalMarketService');

  try {
    const startTime = Date.now();
    const data = await fetchAllGlobalData();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n✅ Hoàn thành! (${elapsed}s)`);
    console.log(`   📊 Indices: ${data.indices.filter(i => !i.error).length}/${data.indices.length}`);
    console.log(`   🏦 ETFs: ${data.sectorETFs.length}`);
    console.log(`   💱 Currencies: ${data.currencies.filter(c => !c.error).length}/${data.currencies.length}`);
    console.log(`   🎯 Fear/Greed: ${data.fearGreed.score}/100 (${data.fearGreed.label})`);
    console.log(`\n   Factors:`);
    for (const f of data.fearGreed.factors) {
      console.log(`     ${f}`);
    }

    // Build Telegram message
    const msg = buildGlobalMarketTelegramMessage(data);
    console.log(`\n📩 Telegram message (${msg.length} chars):`);
    console.log('─'.repeat(40));
    // Strip HTML for console preview
    const preview = msg.replace(/<[^>]+>/g, '').substring(0, 500);
    console.log(preview + '...');

  } catch (error) {
    console.error('💥 Error:', error);
  }
}

testGlobalMarket();
