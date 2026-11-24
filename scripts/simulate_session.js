/**
 * ═══════════════════════════════════════════════════════════════
 *  OFF-MARKET SESSION SIMULATOR (CHẠY THỬ NGHIỆM TRONG KỲ NGHỈ)
 * ═══════════════════════════════════════════════════════════════
 * Chạy mô phỏng diễn biến 1 ngày giao dịch hoàn chỉnh để kiểm tra:
 *  - 8h59: Đăng nhập Entrade, lấy vốn đầu ngày, gửi Telegram.
 *  - 9h20: Vào lệnh Long theo Fibo 0.618 ➔ Giá tăng +1.0đ ➔ Tự động khóa +0.6đ ➔ Chốt lãi.
 *  - 10h45: Vào lệnh Short theo Quá Mua RSI > 75 ➔ SL kỹ thuật.
 *  - 13h30: Vào lệnh Short quét đỉnh PDH ➔ Giá rơi +2.5đ ➔ Chốt lãi lớn.
 *  - 14h30: Tổng kết toàn phiên, tính lãi/lỗ ròng sau phí và gửi Telegram.
 * 
 * Lệnh chạy:
 *   node scripts/simulate_session.js
 */

const AutonomousDayManager = require('../src/entrade/autonomousDayManager');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOffMarketSimulation() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 BẮT ĐẦU MÔ PHỎNG PHIÊN GIAO DỊCH PHÁI SINH THỰC CHIẾN');
  console.log('   (Dành cho trader kiểm tra luồng lệnh khi thị trường nghỉ lễ)');
  console.log('════════════════════════════════════════════════════════════════\n');

  const manager = new AutonomousDayManager({ isSimulation: true });

  // 1. [08:59] Quy trình đầu ngày
  await manager.startMorningRoutine();
  await sleep(2000);

  // 2. [09:20] Lệnh 1: LONG theo Fibonacci 0.618 Golden Pocket
  console.log('\n--- PHIÊN SÁNG (09:20): PHÁT HIỆN TÍN HIỆU LONG ---');
  await manager.openPosition({
    side: 'LONG',
    entryPrice: 1282.0,
    slPrice: 1280.5,
    tpTarget: '1285.0 (Cản 1 ngày PDC)',
    reason: 'Giá hồi về Fibo 0.618 cạn Vol + Nến Pinbar 1m bật tăng xác nhận'
  });
  await sleep(1500);

  // Giả lập giá nhảy từng tick
  console.log('📈 Giá tăng lên 1282.5 (+0.5đ)...');
  await manager.onPriceTick(1282.5);
  await sleep(1000);

  console.log('📈 Giá tăng chạm 1283.0 (+1.0đ) ➔ TRIGGER PROFIT LOCK!');
  await manager.onPriceTick(1283.0);
  await sleep(1500);

  console.log('📈 Giá tăng tiếp lên 1283.5 (+1.5đ)...');
  await manager.onPriceTick(1283.5);
  await sleep(1000);

  console.log('📈 Giá đạt đỉnh 1284.2 (+2.2đ)...');
  await manager.onPriceTick(1284.2);
  await sleep(1500);

  console.log('📉 Giá quay đầu quét về 1283.4 ➔ CHẠM TRAILING SL ĐÃ KHÓA!');
  await manager.onPriceTick(1283.4);
  await sleep(2000);

  // 3. [10:45] Lệnh 2: SHORT cản Quá Mua RSI 78
  console.log('\n--- PHIÊN SÁNG (10:45): PHÁT HIỆN TÍN HIỆU SHORT QUÁ MUA ---');
  await manager.openPosition({
    side: 'SHORT',
    entryPrice: 1286.0,
    slPrice: 1287.5,
    tpTarget: '1282.0',
    reason: 'RSI(14) chạm 78 + Nến đâm thủng Upper Bollinger Bands'
  });
  await sleep(1500);

  console.log('📈 Lái kéo bất ngờ qua 1287.5 ➔ CHẠM SL KỸ THUẬT (CẮT LỖ AN TOÀN)');
  await manager.onPriceTick(1287.5);
  await sleep(2000);

  // 4. [13:30] Lệnh 3: SHORT quét thanh khoản PDH
  console.log('\n--- PHIÊN CHIỀU (13:30): SHORT FADE QUÉT ĐỈNH PDH ---');
  await manager.openPosition({
    side: 'SHORT',
    entryPrice: 1288.0,
    slPrice: 1289.5,
    tpTarget: '1284.0 (VWAP phiên)',
    reason: 'Quét giả qua đỉnh hôm qua PDH 1288.2 rồi tụt lại + Vol xả lớn'
  });
  await sleep(1500);

  console.log('📉 Giá rơi về 1287.0 (+1.0đ) ➔ TRIGGER PROFIT LOCK KHÓA 1287.4!');
  await manager.onPriceTick(1287.0);
  await sleep(1000);

  console.log('📉 Giá rơi mạnh về 1285.5 (+2.5đ)...');
  await manager.onPriceTick(1285.5);
  await sleep(1000);

  console.log('🎯 Chạm mục tiêu 1284.5 (+3.5đ) ➔ Chủ động chốt lời!');
  await manager.closePosition(1284.5, 'Chạm cản VWAP phiên chiều +3.5đ gross');
  await sleep(2000);

  // 5. [14:30] Tổng kết ngày
  await manager.endOfDayReport();
  console.log('\n✅ HOÀN TẤT MÔ PHỎNG TOÀN BỘ PHIÊN!');
}

runOffMarketSimulation();
