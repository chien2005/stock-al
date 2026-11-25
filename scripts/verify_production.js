/**
 * Production Verification Test Suite
 * Kiểm tra toàn diện mọi module phái sinh, kết nối Entrade, Telegram và logic tính toán
 */

require('dotenv').config();
const path = require('path');
const EntradeClient = require('../src/entrade/entradeClient');
const entradeConfig = require('../src/entrade/entradeConfig');
const ProfitLockGuard = require('../src/entrade/profitLockGuard');
const AutonomousDayManager = require('../src/entrade/autonomousDayManager');
const predictiveEntry = require('../src/derivatives/predictiveEntry');
const dominanceClassifier = require('../src/derivatives/dominanceClassifier');
const marketStructure = require('../src/derivatives/marketStructure');
const tradeDecision = require('../src/derivatives/tradeDecision');
const { config } = require('../src/config');

async function runProductionTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 BẮT ĐẦU CHẠY PRODUCTION TEST SUITE CHO VN-STOCK-BOT v8.2');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = '') {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}: ${detail}`);
      failed++;
    }
  }

  // 1. Kiểm tra Cấu hình & Telegram
  console.log('--- 1. CẤU HÌNH & TELEGRAM ROUTING ---');
  assert(config.telegram.chatIdTradingDemo === '-5509642518', 'Chat ID Trading Demo chuẩn (-5509642518)');
  assert(config.telegram.disableLegacyPsNoti === false, 'Thông báo tín hiệu nhóm PS bật mặc định (disableLegacyPsNoti: false)');

  // 2. Kiểm tra Entrade Client & Fallback Authentication
  console.log('\n--- 2. ENTRADE CLIENT & KẾT NỐI SÀN ---');
  const client = new EntradeClient();
  const loginRes = await client.login();
  assert(loginRes.success === true && !!client.token, 'Đăng nhập Entrade Demo thành công (Token được cấp)');
  
  if (loginRes.success) {
    const bal = await client.getAccountBalance();
    assert(bal.success === true && bal.totalCash >= 0, `Đồng bộ số dư Entrade thành công (Số dư: ${bal.totalCash.toLocaleString('vi-VN')} đ)`);
    assert(client.bankMarginPortfolioId === 34, `Đồng bộ gói ký quỹ 18.48% thành công (Package ID: ${client.bankMarginPortfolioId})`);
  }

  // 3. Kiểm tra ProfitLockGuard (Kỷ luật thép +1.0đ -> +0.6đ)
  console.log('\n--- 3. PROFIT LOCK GUARD ---');
  const mockPosition = {
    id: 'TEST-001',
    side: 'LONG',
    entryPrice: 1780.0,
    initialSL: 1778.5, // SL 1.5đ
    currentSL: 1778.5,
    maxProfitReached: 0,
    openTime: new Date()
  };
  const guard = new ProfitLockGuard(mockPosition);
  
  // Test giá lên +1.0đ (1781.0) -> SL phải khóa tại 1780.6 (+0.6đ)
  const lock1 = guard.evaluatePriceTick(1781.0);
  assert(lock1.action === 'UPDATE_SL' && lock1.newSL === 1780.6, 'Khóa lợi nhuận bậc 1: Lãi +1.0đ -> Dời SL chặn +0.6đ');

  // Áp dụng newSL
  if (lock1.newSL) guard.pos.currentSL = lock1.newSL;

  // Test giá lên +2.0đ (1782.0) -> SL phải nâng lên 1781.4 (+1.4đ)
  const lock2 = guard.evaluatePriceTick(1782.0);
  assert(lock2.action === 'UPDATE_SL' && lock2.newSL === 1781.4, 'Khóa lợi nhuận bậc 2: Lãi +2.0đ -> Dời SL chặn +1.4đ');

  // 4. Kiểm tra AutonomousDayManager (Cầu dao ngắt sau 2 lệnh thua)
  console.log('\n--- 4. AUTONOMOUS DAY MANAGER ---');
  const dayMgr = new AutonomousDayManager({ client });
  assert(dayMgr.maxConsecutiveLosses === 2, 'Cầu dao an toàn: Ngưỡng tối đa 2 lệnh thua liên tiếp');
  assert(dayMgr.haltDurationMs === 30 * 60 * 1000, 'Thời gian cúp cầu dao dừng nghỉ: 30 phút');

  // 5. Kiểm tra PredictiveEntry Wyckoff & Anti-Climax
  console.log('\n--- 5. PREDICTIVE ENTRY (WYCKOFF & ANTI-CLIMAX) ---');
  // Sample spring candle
  const springCandle = {
    timestamp: 1732520000,
    time: '10:15:00',
    open: 1785.0,
    high: 1785.5,
    low: 1782.0,
    close: 1784.8,
    volume: 2400,
    isGreen: false,
    body: 0.2,
    upperWick: 0.5,
    lowerWick: 2.8 // Râu dưới dài 2.8đ
  };
  const mockHistorical = [
    { open: 1789, close: 1787, isGreen: false, volume: 800 },
    { open: 1787, close: 1785, isGreen: false, volume: 850 },
    springCandle
  ];
  const mockPriceMap = {
    levels: [
      { price: 1782.5, type: 'SUPPORT', label: 'Key Support 1782.5' }
    ],
    vwap: 1786.0
  };

  const predRes = predictiveEntry.analyzePredictiveEntry({
    candle: springCandle,
    allCandles: Array(15).fill(mockHistorical[0]).concat([mockHistorical[1], springCandle]),
    flowData: null,
    marketStructureData: mockPriceMap,
    dominanceResult: null,
    volMA20: 900 // VolRatio = 2.66x MA20
  });

  assert(predRes && predRes.signal && predRes.signal.type === 'SPRING', 'Nhận diện SPRING thành công dù Vol > 2.5x MA20 (không bị Anti-Climax chặn sai)');
  assert(predRes.signal.slDistance <= 1.8, `Stoploss Spring tuân thủ kỷ luật thép Plan v4.0 (SL Distance: ${predRes?.signal?.slDistance}đ <= 1.8đ)`);

  // 6. Kiểm tra Cắt lỗ chặt Plan v4.0 trong Trade Decision
  console.log('\n--- 6. TRADE DECISION PLAN GENERATOR ---');
  const plan = tradeDecision.generateTradePlan(1785.0, 'LONG', '1M', {
    atr: 2.0,
    setupType: 'SPRING',
    slDistance: 1.5
  });
  assert(plan.slDistance <= 1.8, `Kế hoạch lệnh khống chế SL tối đa 1.8đ (SL: ${plan.sl}, Khoảng cách: ${plan.slDistance}đ)`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🏁 KẾT QUẢ TEST: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runProductionTests().catch(e => {
  console.error('Lỗi nghiêm trọng trong quá trình test:', e);
  process.exit(1);
});
