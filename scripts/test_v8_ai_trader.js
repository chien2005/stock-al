/**
 * 🧪 TEST SUITE: VN30F v8.0 AI TRADER & SMART MONEY UPGRADE
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const intradaySignalEngine = require('../src/derivatives/intradaySignalEngine');
const oiTracker = require('../src/derivatives/oiTracker');
const derivatives = require('../src/derivatives');

console.log('═'.repeat(60));
console.log('🧪 BẮT ĐẦU KIỂM THỬ HỆ THỐNG AI TRADING v8.0');
console.log('═'.repeat(60));

let passCount = 0;
let totalCount = 0;

function it(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (e) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${e.message}`);
  }
}

async function itAsync(name, fn) {
  totalCount++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (e) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${e.message}`);
  }
}

// ─── TEST 1: CẤU TRÚC THỊ TRƯỜNG (SWING HIGH / LOW) ───────────
console.log('\n📌 1. KIỂM THỬ CẤU TRÚC THỊ TRƯỜNG & ĐỈNH/ĐÁY');

it('Phát hiện HẠ ĐỈNH + HẠ ĐÁY (Swing Down / Downtrend)', () => {
  // 12 nến giả lập: Nửa đầu giá cao, nửa sau giá tụt thấp
  const mockM5 = {
    c: [1290, 1289, 1291, 1288, 1287, 1286, 1284, 1285, 1283, 1281, 1280, 1279],
    h: [1292, 1290, 1293, 1289, 1288, 1287, 1285, 1286, 1284, 1282, 1281, 1280],
    l: [1288, 1287, 1289, 1286, 1285, 1284, 1282, 1283, 1280, 1279, 1278, 1277],
    o: [1291, 1289, 1290, 1288, 1287, 1286, 1285, 1284, 1283, 1281, 1280, 1279],
    v: [2000, 2100, 2200, 2500, 2400, 2600, 3000, 2800, 3100, 3200, 3500, 3800],
  };

  const structure = intradaySignalEngine.analyzeMarketStructureFromCandles(mockM5, null);
  assert.strictEqual(structure.highLowStructure, 'DOWNTREND');
  assert.strictEqual(structure.isLowerHighs, true);
  assert.strictEqual(structure.isLowerLows, true);
  assert.ok(structure.structureTag.includes('THUẬN THẾ SHORT'));
  assert.ok(structure.swingHighDesc.includes('HẠ ĐỈNH'));
  assert.ok(structure.swingLowDesc.includes('HẠ ĐÁY'));
});

it('Phát hiện NÂNG ĐỈNH + NÂNG ĐÁY (Swing Up / Uptrend)', () => {
  // 12 nến giả lập: Nửa đầu giá thấp, nửa sau giá tăng cao
  const mockM5 = {
    c: [1270, 1271, 1272, 1273, 1274, 1275, 1277, 1278, 1280, 1282, 1283, 1285],
    h: [1271, 1272, 1274, 1275, 1276, 1277, 1279, 1280, 1282, 1284, 1285, 1287],
    l: [1269, 1270, 1271, 1272, 1273, 1274, 1276, 1277, 1279, 1281, 1282, 1284],
    o: [1269, 1271, 1272, 1273, 1274, 1275, 1276, 1278, 1279, 1281, 1282, 1284],
    v: [2000, 2100, 2200, 2500, 2400, 2600, 3000, 2800, 3100, 3200, 3500, 3800],
  };

  const structure = intradaySignalEngine.analyzeMarketStructureFromCandles(mockM5, null);
  assert.strictEqual(structure.highLowStructure, 'UPTREND');
  assert.strictEqual(structure.isHigherHighs, true);
  assert.strictEqual(structure.isHigherLows, true);
  assert.ok(structure.structureTag.includes('THUẬN THẾ LONG'));
  assert.ok(structure.swingHighDesc.includes('NÂNG ĐỈNH'));
  assert.ok(structure.swingLowDesc.includes('NÂNG ĐÁY'));
});

// ─── TEST 2: THANH KHOẢN & TỐC ĐỘ GIAO DỊCH ───────────────────
console.log('\n📌 2. KIỂM THỬ TÍNH TOÁN THANH KHOẢN & TỐC ĐỘ');

itAsync('Tính toán tốc độ thanh khoản và phân loại < 16k tỷ vs >= 16k tỷ', async () => {
  const result = await intradaySignalEngine.calculateMarketLiquiditySpeed();
  assert.ok(result.speed !== undefined);
  assert.ok(result.projectedTotal !== undefined);
  assert.ok(result.mode === 'SCALP' || result.mode === 'TREND');
  assert.ok(result.modeLabel.length > 0);
  console.log(`     Tốc độ: ${result.speed} tỷ/phút | Dự phóng: ${result.projectedTotal} tỷ | Chế độ: ${result.mode}`);
});

// ─── TEST 3: AI TRADER STATE MACHINE NHƯ NGƯỜI THẬT ───────────
console.log('\n📌 3. KIỂM THỬ BỘ NHỚ LỆNH & 11 TRẠNG THÁI AI TRADER');

it('Kịch bản chuỗi lệnh thực chiến theo yêu cầu User', () => {
  // Reset state về ban đầu
  intradaySignalEngine.resetIntradayState();
  let state = intradaySignalEngine.loadAIPositionState();
  assert.strictEqual(state.position, 'NONE');

  // Nến giảm mạnh & cấu trúc hạ đỉnh hạ đáy
  const mockH1 = { trend: 'DOWNTREND', description: 'EMA5 < EMA13 slope giảm' };
  const mockM15 = { signal: 'BEARISH', confidence: 80, description: 'Đồng thuận 1H giảm' };
  const mockM5 = { entrySignal: 'SHORT_ENTRY', entryConfidence: 80, currentPrice: 1285.0, description: 'Nến đỏ đặc vol lớn' };
  const mockStructure = {
    highLowStructure: 'DOWNTREND',
    structureTag: '🔴 HẠ ĐỈNH + HẠ ĐÁY ➔ THUẬN THẾ SHORT',
    isLowerHighs: true,
    isLowerLows: true,
  };
  const mockLiquidityLow = {
    totalVal: 4800,
    speed: 55,
    projectedTotal: 13500,
    isLowLiquidity: true,
    mode: 'SCALP',
    modeLabel: 'THANH KHOẢN THẤP (< 16k tỷ) ➔ SCALP 3-5-7Đ',
  };
  const mockSmartMoneyShort = {
    foreignNet: -1800,
    effectiveTD: -400,
    smartMoneyNet: -2200,
    crowdNet: 2200,
    foreignPct: '18.5',
    tdPct: '4.1',
    smartMoneyPct: '22.6',
  };

  // 1. 09h30: MỞ SHORT
  const decision1 = intradaySignalEngine.makeAITraderDecision(
    mockH1, mockM15, mockM5, mockStructure, mockLiquidityLow, mockSmartMoneyShort, { basis: { basis: -2.0, isBearish: true } }
  );
  assert.strictEqual(decision1.decision, 'OPEN_SHORT');
  assert.strictEqual(decision1.state.position, 'SHORT');
  assert.strictEqual(decision1.state.entryPrice, 1285.0);
  console.log(`     Step 1 (09h30): ${decision1.title}`);

  // 2. 09h45: GIỮ SHORT (+5.0đ khi giá xuống 1280.0)
  mockM5.currentPrice = 1280.0;
  mockM5.latestCandle = { isGreen: false, upperWick: 0.5, lowerWick: 0.5 };
  const decision2 = intradaySignalEngine.makeAITraderDecision(
    mockH1, mockM15, mockM5, mockStructure, mockLiquidityLow, mockSmartMoneyShort, { basis: { basis: -2.0 } }
  );
  assert.strictEqual(decision2.decision, 'HOLD_SHORT');
  assert.strictEqual(decision2.state.position, 'SHORT');
  assert.strictEqual(decision2.state.currentPnL, 5.0);
  console.log(`     Step 2 (09h45): ${decision2.title}`);

  // 3. 10h00: ĐÓNG SHORT BẢO TOÀN VỊ THẾ (khi giá giằng co, đi ngang cạn vol 4 bar)
  decision2.state.holdingBars = 4;
  intradaySignalEngine.saveAIPositionState(decision2.state);
  mockM5.currentPrice = 1284.5; // pnl thu hẹp về 0.5đ
  const mockBullishRecover = { highLowStructure: 'SIDEWAY', structureTag: 'Tam giác giằng co', isHigherLows: true };
  const decision3 = intradaySignalEngine.makeAITraderDecision(
    { trend: 'SIDEWAYS', description: 'Chững lại' },
    { signal: 'NEUTRAL', confidence: 40, description: 'Do dự' },
    { entrySignal: 'NEUTRAL', entryConfidence: 40, currentPrice: 1284.5, description: 'Do dự' },
    mockBullishRecover,
    mockLiquidityLow,
    { foreignNet: 100, effectiveTD: 0, smartMoneyNet: 100, crowdNet: -100, foreignPct: '1.0', tdPct: '0', smartMoneyPct: '1.0' },
    null
  );
  assert.strictEqual(decision3.decision, 'CLOSE_PRESERVE');
  assert.strictEqual(decision3.state.position, 'NONE');
  console.log(`     Step 3 (10h00): ${decision3.title}`);

  // 4. 10h15: MỞ SHORT LẠI khi có điểm gãy mới
  mockM5.currentPrice = 1283.0;
  const decision4 = intradaySignalEngine.makeAITraderDecision(
    mockH1, mockM15, { entrySignal: 'SHORT_ENTRY', entryConfidence: 80, currentPrice: 1283.0 }, mockStructure, mockLiquidityLow, mockSmartMoneyShort, null
  );
  assert.strictEqual(decision4.decision, 'OPEN_SHORT');
  assert.strictEqual(decision4.state.position, 'SHORT');
  assert.strictEqual(decision4.state.entryPrice, 1283.0);
  console.log(`     Step 4 (10h15): ${decision4.title}`);

  // 5. 10h30: CHỐT LỜI SHORT (+6.0đ khi giá về 1277.0, thanh khoản thấp chốt 3-5-7đ)
  mockM5.currentPrice = 1277.0;
  const decision5 = intradaySignalEngine.makeAITraderDecision(
    mockH1, mockM15, { entrySignal: 'NEUTRAL', currentPrice: 1277.0 }, mockStructure, mockLiquidityLow, mockSmartMoneyShort, null
  );
  assert.strictEqual(decision5.decision, 'TAKE_PROFIT_SHORT');
  assert.strictEqual(decision5.state.position, 'NONE');
  console.log(`     Step 5 (10h30): ${decision5.title}`);
  assert.ok(decision5.state.todayTrades.length >= 2);
});

it('Cắt lỗ ghi nhớ vào bộ nhớ là AI đang TRỐNG LỆNH', () => {
  intradaySignalEngine.resetIntradayState();
  const state = intradaySignalEngine.loadAIPositionState();
  state.position = 'SHORT';
  state.entryPrice = 1280.0;
  state.stopLoss = 1283.0; // SL +3đ
  intradaySignalEngine.saveAIPositionState(state);

  // Giá vọt lên 1283.5 dính SL
  const decision = intradaySignalEngine.makeAITraderDecision(
    { trend: 'SIDEWAYS', description: 'Ngang' },
    { signal: 'NEUTRAL', confidence: 40, description: 'Do dự' },
    { entrySignal: 'NEUTRAL', currentPrice: 1283.5 },
    { highLowStructure: 'SIDEWAY' },
    { isLowLiquidity: true, mode: 'SCALP' },
    null,
    null
  );

  assert.strictEqual(decision.decision, 'STOP_LOSS_SHORT');
  assert.strictEqual(decision.state.position, 'NONE');
  assert.strictEqual(decision.state.entryPrice, null);
  console.log(`     Cắt lỗ: ${decision.title} ➔ AI trở về TRỐNG LỆNH`);
});

it('Thanh khoản tốt + Lãi >= 10đ: CHO PHÉP GỒNG TREND + CHẶN LÃI TRAILING STOP', () => {
  intradaySignalEngine.resetIntradayState();
  const state = intradaySignalEngine.loadAIPositionState();
  state.position = 'LONG';
  state.entryPrice = 1270.0;
  state.stopLoss = 1267.0;
  intradaySignalEngine.saveAIPositionState(state);

  const mockLiquidityHigh = {
    totalVal: 18500,
    speed: 120,
    projectedTotal: 22000,
    isLowLiquidity: false,
    mode: 'TREND',
    modeLabel: 'THANH KHOẢN TỐT (≥ 16k tỷ) ➔ GỒNG TREND',
  };

  // Giá lên 1282.0 (+12đ lãi)
  const decision = intradaySignalEngine.makeAITraderDecision(
    { trend: 'UPTREND', description: 'Tăng mạnh' },
    { signal: 'BULLISH', confidence: 85, description: 'Uptrend' },
    { entrySignal: 'LONG_ENTRY', entryConfidence: 80, currentPrice: 1282.0 },
    { highLowStructure: 'UPTREND', structureTag: 'NÂNG ĐỈNH NÂNG ĐÁY', secondHalfLow: 1278.5 },
    mockLiquidityHigh,
    { foreignNet: 2500, effectiveTD: 500, smartMoneyNet: 3000, crowdNet: -3000, foreignPct: '20.0', tdPct: '4.0', smartMoneyPct: '24.0' },
    null
  );

  assert.strictEqual(decision.decision, 'HOLD_LONG');
  assert.strictEqual(decision.state.position, 'LONG');
  assert.ok(decision.state.trailingStop >= 1275.0); // Chặn lãi đã được dời lên
  assert.ok(decision.title.includes('GỒNG TREND'));
  console.log(`     Gồng Trend: ${decision.title} (Chặn lãi dời về: ${decision.state.trailingStop})`);
});

// ─── TEST 4: BÁO CÁO 14H25, 14H29, 14H44 ─────────────────────
console.log('\n📌 4. KIỂM THỬ NOTI 14H25 (MARGIN CUTOFF), 14H29 (PRE-ATC), 14H44 (POST-ATC)');

itAsync('14h25: buildMarginCutoffNotificationAsync tạo nội dung chuẩn Smart Money', async () => {
  const simulated = {
    realtimeOI: { foreignBuy: 4500, foreignSell: 2100, foreignNet: 2400, totalVolume: 180000, totalOI: 52000 },
    futuresPrice: { price: 1285.5, prevPrice: 1280.0 },
    vn30Price: { price: 1286.0 },
    vnindexPrice: { price: 1250.0 },
    realtimeVN30: { raw: [] },
    m5Data: { c: [1282, 1283, 1284, 1285.5], o: [1282, 1283, 1283.5, 1284] },
  };

  const msg = await oiTracker.buildMarginCutoffNotificationAsync(simulated);
  assert.ok(msg.includes('14h25'));
  assert.ok(msg.includes('XUNG LỰC THỊ TRƯỜNG SAU ĐỢT CẮT MARGIN'));
  assert.ok(msg.includes('SMART MONEY (KHỐI NGOẠI & TỰ DOANH)'));
  assert.ok(msg.includes('Tỷ trọng:'));
  assert.ok(msg.includes('ĐỊNH HƯỚNG MỞ LỆNH PHIÊN ATC'));
  console.log('     14h25 Notification Preview:');
  console.log('     ' + msg.split('\n').slice(0, 5).join('\n     '));
});

itAsync('14h29: buildPreATCNotificationAsync tích hợp Khối Ngoại + Tự Doanh + Tỷ trọng %', async () => {
  const simulated = {
    realtimeOI: { foreignBuy: 4500, foreignSell: 2100, foreignNet: 2400, totalVolume: 180000, totalOI: 52000 },
    futuresPrice: { price: 1285.5, prevPrice: 1280.0, high: 1290.0, low: 1275.0 },
    vn30Price: { price: 1286.0, prevPrice: 1282.0 },
    vnindexPrice: { price: 1250.0 },
    realtimeVN30: { raw: [] },
  };

  const msg = await oiTracker.buildPreATCNotificationAsync(simulated);
  assert.ok(msg.includes('14h29'));
  assert.ok(msg.includes('HỢP LỰC SMART MONEY'));
  assert.ok(msg.includes('Tỷ trọng:'));
  assert.ok(msg.includes('PHÁN QUYẾT: CÓ NÊN MỞ VỊ THẾ VÀO ATC?'));
  console.log('     14h29 Notification Preview:');
  console.log('     ' + msg.split('\n').slice(0, 5).join('\n     '));
});

itAsync('14h44: buildPostATCNotificationAsync phán quyết giữ qua đêm ATO hay đóng bảo toàn vốn', async () => {
  const simulated = {
    realtimeOI: { foreignBuy: 4800, foreignSell: 2000, foreignNet: 2800, totalVolume: 195000, totalOI: 55000 },
    futuresPrice: { price: 1288.0, prevPrice: 1280.0 },
    vn30Price: { price: 1287.5, prevPrice: 1282.0 },
    vnindexPrice: { price: 1252.0 },
    realtimeVN30: { raw: [] },
  };

  const msg = await oiTracker.buildPostATCNotificationAsync(simulated);
  assert.ok(msg.includes('14h44'));
  assert.ok(msg.includes('VỊ THẾ SMART MONEY CẦM QUA ĐÊM'));
  assert.ok(msg.includes('Tỷ trọng:'));
  assert.ok(msg.includes('PHÁN QUYẾT: CÓ NÊN GIỮ VỊ THẾ QUA ĐÊM VÀO ATO SÁNG MAI?'));
  console.log('     14h44 Notification Preview:');
  console.log('     ' + msg.split('\n').slice(0, 5).join('\n     '));
});

// ─── TEST 5: KIỂM TRA CRON SCHEDULE TRONG SRC/INDEX.JS ────────
console.log('\n📌 5. KIỂM THỬ CẤU TRÚC CRON SCHEDULE TRONG SRC/INDEX.JS');

it('Tất cả cron expressions của 5m intraday, 14h25, 14h29, 14h44 đều hợp lệ', () => {
  const indexContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

  // Trích xuất các cron schedule
  const cronRegex = /cron:\s*'([^']+)'/g;
  let match;
  let cronCount = 0;
  while ((match = cronRegex.exec(indexContent)) !== null) {
    const expr = match[1];
    assert.ok(cron.validate(expr), `Cron expression invalid: ${expr}`);
    cronCount++;
  }

  assert.ok(cronCount >= 45, `Expected >= 45 cron schedules, found ${cronCount}`);
  assert.ok(indexContent.includes("'25 14 * * 1-5'"), 'Missing 14h25 margin cutoff cron');
  assert.ok(indexContent.includes("'29 14 * * 1-5'"), 'Missing 14h29 pre-atc cron');
  assert.ok(indexContent.includes("'44 14 * * 1-5'"), 'Missing 14h44 post-atc cron');
  console.log(`     Đã validate thành công ${cronCount} cron expressions trong src/index.js!`);
});

// ─── TỔNG KẾT ─────────────────────────────────────────────────
setTimeout(() => {
  console.log('\n' + '═'.repeat(60));
  console.log(`🎉 KẾT QUẢ KIỂM THỬ: ${passCount}/${totalCount} TEST CASES THÀNH CÔNG!`);
  console.log('═'.repeat(60));
  if (passCount === totalCount) {
    console.log('🚀 TẤT CẢ TÍNH NĂNG ĐÃ SẴN SÀNG TRIỂN KHAI HOÀN HẢO!');
  } else {
    process.exit(1);
  }
}, 500);

