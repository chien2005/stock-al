/**
 * Test: Trigger cả 2 report mới (21h + 21h30)
 * Bắn thật qua Telegram
 */

require('dotenv').config();
const { config } = require('./config');
const { initAIEngines, runGlobalMarketAnalysis, runTopBoughtAnalysis } = require('./aiTeam');
const { fetchAllGlobalData } = require('./globalMarketService');
const { fetchTopBoughtStocks } = require('./stockService');

async function testBothReports() {
  console.log('═'.repeat(55));
  console.log('🚀 TEST: Bắn 2 report mới qua Telegram');
  console.log('═'.repeat(55));
  console.log(`   Chat ID: ${config.telegram.chatId}`);
  console.log('');

  // Init AI
  initAIEngines();

  // ─── REPORT 1: TTCK Quốc tế (21h00) ───
  console.log('\n' + '═'.repeat(55));
  console.log('🌍 REPORT 1: TTCK QUỐC TẾ (21h00)');
  console.log('═'.repeat(55));

  let globalData = null;
  try {
    globalData = await fetchAllGlobalData();
    await runGlobalMarketAnalysis(globalData);
    console.log('\n✅ Report 1 đã bắn xong!');
  } catch (error) {
    console.error('💥 Report 1 lỗi:', error.message);
  }

  // Chờ 5s giữa 2 report
  console.log('\n⏳ Chờ 5s trước report 2...');
  await new Promise(r => setTimeout(r, 5000));

  // ─── REPORT 2: Top 5 CP Mua Nhiều (21h30) ───
  console.log('\n' + '═'.repeat(55));
  console.log('🏆 REPORT 2: TOP 5 CP MUA NHIỀU (21h30)');
  console.log('═'.repeat(55));

  try {
    const topBoughtData = await fetchTopBoughtStocks(5);
    if (topBoughtData && topBoughtData.topBought.length > 0) {
      await runTopBoughtAnalysis(topBoughtData, globalData);
      console.log('\n✅ Report 2 đã bắn xong!');
    } else {
      console.log('⚠️ Không có data top bought');
    }
  } catch (error) {
    console.error('💥 Report 2 lỗi:', error.message);
  }

  console.log('\n' + '═'.repeat(55));
  console.log('🎉 HOÀN THÀNH! Kiểm tra Telegram nhé!');
  console.log('═'.repeat(55));
}

testBothReports();
