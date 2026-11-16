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

async function runAll() {
  // ─── TEST 1: CẤU TRÚC THỊ TRƯỜNG (SWING HIGH / LOW) ───────────
  console.log('\n📌 1. KIỂM THỬ CẤU TRÚC THỊ TRƯỜNG & ĐỈNH/ĐÁY');

  it('Phát hiện HẠ ĐỈNH + HẠ ĐÁY (Swing Down / Downtrend)', () => {
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

  await itAsync('Tính toán tốc độ thanh khoản và phân loại < 16k tỷ vs >= 16k tỷ', async () => {
    const result = await intradaySignalEngine.calculateMarketLiquiditySpeed();
    assert.ok(result.speed !== undefined);
    assert.ok(result.projectedTotal !== undefined);
    assert.ok(result.mode === 'SCALP' || result.mode === 'TREND');
    assert.ok(result.modeLabel.length > 0);
    console.log(`     Tốc độ: ${result.speed} tỷ/phút | Dự phóng: ${result.projectedTotal} tỷ | Chế độ: ${result.mode}`);
  });

  // ─── TEST 3: STOP LOSS LINH ĐỘNG (3.5-4.5Đ, MAX 5Đ) ───────────
  console.log('\n📌 3. KIỂM THỬ STOP LOSS LINH ĐỘNG (3.5-4.5Đ, MAX 5Đ)');

  it('Tính toán Adaptive Stop Loss: Vùng tối ưu 3.5-4.5đ, tối đa 5.0đ', () => {
    // Test Long với hỗ trợ gần
    const mockStructureLong = {
      recentLow: 1281.0, // Cách 1285 là 4.0đ
      secondHalfLow: 1281.2,
    };
    const slLong = intradaySignalEngine.calculateAdaptiveStopLoss('LONG', 1285.0, mockStructureLong, null, null);
    assert.ok(slLong.slDistance >= 3.5 && slLong.slDistance <= 4.5, `SL Long distance ${slLong.slDistance} phải trong khoảng 3.5-4.5đ`);
    assert.ok(slLong.slDistance <= 5.0, 'SL Long không được vượt quá 5.0đ');
    assert.strictEqual(slLong.slPrice, +(1285.0 - slLong.slDistance).toFixed(1));

    // Test Short với cản gần
    const mockStructureShort = {
      recentHigh: 1289.0, // Cách 1285 là 4.0đ
      secondHalfHigh: 1288.8,
    };
    const slShort = intradaySignalEngine.calculateAdaptiveStopLoss('SHORT', 1285.0, mockStructureShort, null, null);
    assert.ok(slShort.slDistance >= 3.5 && slShort.slDistance <= 4.5, `SL Short distance ${slShort.slDistance} phải trong khoảng 3.5-4.5đ`);
    assert.ok(slShort.slDistance <= 5.0, 'SL Short không được vượt quá 5.0đ');
    assert.strictEqual(slShort.slPrice, +(1285.0 + slShort.slDistance).toFixed(1));

    // Test Hard Cap khi cản ở quá xa (ví dụ cản cách 7.0đ)
    const farStructure = { recentHigh: 1292.0 };
    const slFar = intradaySignalEngine.calculateAdaptiveStopLoss('SHORT', 1285.0, farStructure, null, null);
    assert.strictEqual(slFar.slDistance, 5.0, 'SL phải bị giới hạn cứng tại 5.0đ (Hard Cap)');
    assert.strictEqual(slFar.slPrice, 1290.0);
  });

  console.log('\n📌 3.1. KIỂM THỬ HỆ THỐNG GIỮ LÃI & BẢO VỆ VỐN (TRAILING STOP LADDER)');

  it('Kiểm thử từng nấc chặn lãi Trailing Stop theo đúng yêu cầu', () => {
    const ladder = intradaySignalEngine.evaluateProfitProtectionLadder;
    const entry = 1280.0;

    // 1. Tiệm cận +3đ (VD: 2.8đ) -> Chặn lãi +1.0đ
    const step1 = ladder('LONG', entry, 1282.8, 1276.0, 2.8, false);
    assert.strictEqual(step1.targetLockedPts, 1.0);
    assert.strictEqual(step1.trailingStop, 1281.0);

    // 2. Lãi 3-4đ (VD: 3.5đ) -> Chặn lãi +1.5đ
    const step2 = ladder('LONG', entry, 1283.5, 1281.0, 3.5, false);
    assert.strictEqual(step2.targetLockedPts, 1.5);
    assert.strictEqual(step2.trailingStop, 1281.5);

    // 3. Lãi 4-5đ (VD: 4.5đ) -> Chặn lãi +3.0đ
    const step3 = ladder('LONG', entry, 1284.5, 1281.5, 4.5, false);
    assert.strictEqual(step3.targetLockedPts, 3.0);
    assert.strictEqual(step3.trailingStop, 1283.0);

    // 4. Lãi 5-7đ (VD: 6.0đ) -> Chặn lãi +4.0đ
    const step4 = ladder('LONG', entry, 1286.0, 1283.0, 6.0, false);
    assert.strictEqual(step4.targetLockedPts, 4.0);
    assert.strictEqual(step4.trailingStop, 1284.0);

    // 5. Lãi 7-8đ (VD: 7.5đ) -> Chặn lãi +5.0đ
    const step5 = ladder('LONG', entry, 1287.5, 1284.0, 7.5, false);
    assert.strictEqual(step5.targetLockedPts, 5.0);
    assert.strictEqual(step5.trailingStop, 1285.0);

    // 6. Lãi 8-10đ (VD: 9.0đ) -> Chặn lãi +7.0đ
    const step6 = ladder('LONG', entry, 1289.0, 1285.0, 9.0, false);
    assert.strictEqual(step6.targetLockedPts, 7.0);
    assert.strictEqual(step6.trailingStop, 1287.0);

    // 7. Lãi >10đ (VD: 11.0đ) -> Chặn lãi +8.0đ
    const step7 = ladder('LONG', entry, 1291.0, 1287.0, 11.0, false);
    assert.strictEqual(step7.targetLockedPts, 8.0);
    assert.strictEqual(step7.trailingStop, 1288.0);

    // 8. Lãi >12đ (VD: 13.0đ) bình thường -> Chặn lãi +10.0đ
    const step8 = ladder('LONG', entry, 1293.0, 1288.0, 13.0, false);
    assert.strictEqual(step8.targetLockedPts, 10.0);
    assert.strictEqual(step8.trailingStop, 1290.0);

    // 9. Lãi >12-15đ khi đảo chiều -> Chặn lãi tối đa, min 12.0đ & chốt lãi
    const step9 = ladder('LONG', entry, 1293.0, 1290.0, 13.0, true);
    assert.ok(step9.targetLockedPts >= 12.0);
    assert.strictEqual(step9.shouldTakeProfitNow, true);

    // 10. Lãi 15-20đ khi đảo chiều -> Chốt lãi ngay!
    const step10 = ladder('LONG', entry, 1297.0, 1292.0, 17.0, true);
    assert.strictEqual(step10.shouldTakeProfitNow, true);

    // 11. Lãi >20đ -> Khóa mốc +20đ, quay đầu chạm 20đ thì đóng lệnh
    const step11 = ladder('LONG', entry, 1303.0, 1292.0, 23.0, false);
    assert.strictEqual(step11.targetLockedPts, 20.0);
    assert.strictEqual(step11.trailingStop, 1300.0);

    // Quay đầu về đúng 20đ (1300.0) -> Đóng lệnh
    const step11Exit = ladder('LONG', entry, 1300.0, 1300.0, 23.0, false);
    assert.strictEqual(step11Exit.shouldTakeProfitNow, true);
  });

  console.log('\n📌 3.2. KIỂM THỬ THỰC CHIẾN STATE MACHINE & QUY TẮC ATC');

  await itAsync('Kịch bản chuỗi lệnh thực chiến và mở vị thế với SL linh động', async () => {
    // Reset state về ban đầu
    intradaySignalEngine.resetIntradayState();
    let state = intradaySignalEngine.loadAIPositionState();
    assert.strictEqual(state.position, 'NONE');

    const mockM15 = { signal: 'BEARISH', confidence: 80, description: 'Đồng thuận 15p giảm' };
    const mockM5 = {
      entrySignal: 'SHORT_ENTRY',
      entryConfidence: 80,
      currentPrice: 1285.0,
      description: 'Nến đỏ đặc vol lớn',
      latestCandle: { isGreen: false, open: 1289.0, high: 1289.5, low: 1284.5, close: 1285.0 }
    };
    const mockM1 = { signal: 'BEARISH', confidence: 75, momentum: -0.8, description: 'Xung lực bán ép giá' };
    const mockStructure = {
      highLowStructure: 'DOWNTREND',
      structureTag: '🔴 HẠ ĐỈNH + HẠ ĐÁY ➔ THUẬN THẾ SHORT',
      isLowerHighs: true,
      isLowerLows: true,
      recentHigh: 1289.0,
      recentLow: 1280.0,
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

    // 1. MỞ SHORT
    const decision1 = await intradaySignalEngine.makeAITraderDecision(
      mockM15, mockM5, mockM1, mockStructure, mockLiquidityLow, mockSmartMoneyShort, { basis: { basis: -2.0, isBearish: true } }
    );
    assert.strictEqual(decision1.decision, 'OPEN_SHORT');
    assert.strictEqual(decision1.state.position, 'SHORT');
    assert.strictEqual(decision1.state.entryPrice, 1285.0);
    assert.ok(decision1.state.stopLoss > 1285.0);
    const slDist = +(decision1.state.stopLoss - 1285.0).toFixed(1);
    assert.ok(slDist >= 3.5 && slDist <= 5.0, `SL Distance ${slDist} phải trong dải 3.5-5.0đ`);
    console.log(`     Step 1: ${decision1.title} (SL: ${decision1.state.stopLoss}đ, +${slDist}đ)`);

    // 2. GIỮ SHORT & KÍCH HOẠT CHẶN LÃI LADDER (+4.0đ khi giá xuống 1281.0)
    mockM5.currentPrice = 1281.0;
    mockM5.latestCandle = { isGreen: false, upperWick: 0.5, lowerWick: 0.5 };
    const decision2 = await intradaySignalEngine.makeAITraderDecision(
      mockM15, mockM5, mockM1, mockStructure, mockLiquidityLow, mockSmartMoneyShort, { basis: { basis: -2.0 } }
    );
    assert.strictEqual(decision2.decision, 'HOLD_SHORT');
    assert.strictEqual(decision2.state.position, 'SHORT');
    assert.strictEqual(decision2.state.currentPnL, 4.0);
    assert.ok(decision2.state.trailingStop <= 1282.0, `Trailing stop phải khóa lãi ít nhất 3.0đ`);
    console.log(`     Step 2: ${decision2.title} (Trailing: ${decision2.state.trailingStop}đ)`);

    // 3. ĐÓNG SHORT CHẶN LÃI (khi giá giật ngược chạm Trailing Stop)
    mockM5.currentPrice = decision2.state.trailingStop + 0.1;
    const decision3 = await intradaySignalEngine.makeAITraderDecision(
      mockM15, mockM5, mockM1, mockStructure, mockLiquidityLow, mockSmartMoneyShort, null
    );
    assert.strictEqual(decision3.decision, 'CLOSE_PRESERVE');
    assert.strictEqual(decision3.state.position, 'NONE');
    console.log(`     Step 3: ${decision3.title}`);
  });

  await itAsync('Cắt lỗ ghi nhớ vào bộ nhớ là AI đang TRỐNG LỆNH', async () => {
    intradaySignalEngine.resetIntradayState();
    const state = intradaySignalEngine.loadAIPositionState();
    state.position = 'SHORT';
    state.entryPrice = 1280.0;
    state.stopLoss = 1284.0; // SL +4.0đ
    intradaySignalEngine.saveAIPositionState(state);

    // Giá vọt lên 1284.5 dính SL
    const decision = await intradaySignalEngine.makeAITraderDecision(
      { signal: 'NEUTRAL', confidence: 40, description: 'Do dự' },
      { entrySignal: 'NEUTRAL', currentPrice: 1284.5 },
      { signal: 'NEUTRAL', confidence: 40, description: 'Do dự' },
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

  await itAsync('Lãi lớn >= 20đ được phép hold qua ATC nếu cung cầu 14h25-14h29 duy trì đúng hướng', async () => {
    intradaySignalEngine.resetIntradayState();
    const state = intradaySignalEngine.loadAIPositionState();
    state.position = 'LONG';
    state.entryPrice = 1260.0;
    state.stopLoss = 1256.0;
    intradaySignalEngine.saveAIPositionState(state);

    // Đánh giá với PnL = 22đ
    const ladderRes = intradaySignalEngine.evaluateProfitProtectionLadder('LONG', 1260.0, 1282.0, null, 22.0, false);
    assert.strictEqual(ladderRes.targetLockedPts, 20.0);
    assert.strictEqual(ladderRes.trailingStop, 1280.0);
    console.log(`     Lãi 22đ (>20đ): ${ladderRes.ladderDesc} (Trailing Stop: ${ladderRes.trailingStop})`);
  });

  // ─── TEST 4: BÁO CÁO 14H25, 14H29, 14H44 ─────────────────────
  console.log('\n📌 4. KIỂM THỬ NOTI 14H25 (MARGIN CUTOFF), 14H29 (PRE-ATC), 14H44 (POST-ATC)');

  await itAsync('14h25: buildMarginCutoffNotificationAsync tạo nội dung chuẩn Smart Money', async () => {
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
    console.log('     ' + msg.split('\n').slice(0, 3).join('\n     '));
  });

  await itAsync('14h29: buildPreATCNotificationAsync tích hợp Khối Ngoại + Tự Doanh + Tỷ trọng %', async () => {
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
    console.log('     ' + msg.split('\n').slice(0, 3).join('\n     '));
  });

  await itAsync('14h44: buildPostATCNotificationAsync phán quyết giữ qua đêm ATO hay đóng bảo toàn vốn', async () => {
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
    console.log('     ' + msg.split('\n').slice(0, 3).join('\n     '));
  });

  // ─── TEST 5: KIỂM TRA CRON SCHEDULE TRONG SRC/INDEX.JS ────────
  console.log('\n📌 5. KIỂM THỬ CẤU TRÚC CRON SCHEDULE TRONG SRC/INDEX.JS');

  it('Tất cả cron expressions của 5m intraday, 14h25, 14h29, 14h44 đều hợp lệ', () => {
    const indexContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

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
  console.log('\n' + '═'.repeat(60));
  console.log(`🎉 KẾT QUẢ KIỂM THỬ: ${passCount}/${totalCount} TEST CASES THÀNH CÔNG!`);
  console.log('═'.repeat(60));
  if (passCount === totalCount) {
    console.log('🚀 TẤT CẢ TÍNH NĂNG ĐÃ SẴN SÀNG TRIỂN KHAI HOÀN HẢO!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
