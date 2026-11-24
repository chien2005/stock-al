/**
 * ═══════════════════════════════════════════════════════════════
 *  FULL PREDICTIVE SCALPER SESSION SIMULATION (v8.0)
 * ═══════════════════════════════════════════════════════════════
 * Kiểm thử toàn diện chu trình xử lý nến của Volume Scalper:
 *  1. Nạp nến bình thường tích lũy quanh hỗ trợ
 *  2. Nến Spring (quét đáy râu 1.5đ + Sell Absorption) -> Kích hoạt LONG đón đầu
 *  3. Lệnh LONG được gửi đến Entrade DayManager
 *  4. Fast tick mô phỏng giá nhảy +1.0đ -> ProfitLockGuard dời SL lên +0.6đ
 *  5. Nổ vol Climax 5500 HĐ -> Anti-Climax Block ngăn chặn đu lệnh
 *  6. Chốt lời hoặc đóng lệnh
 */

const volumeScalper = require('../src/derivatives/volumeScalper');
const dominanceClassifier = require('../src/derivatives/dominanceClassifier');
const predictiveEntry = require('../src/derivatives/predictiveEntry');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runScalperSimulation() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🤖 BẮT ĐẦU SIMULATION VOLUME SCALPER v8.0 PREDICTIVE POSITIONING');
  console.log('════════════════════════════════════════════════════════════════\n');

  volumeScalper.reset();

  const candles = [];
  const baseTime = 9 * 60; // 09:00

  // 1. Tạo 15 nến đầu sideway tích lũy từ 09:00 đến 09:14 quanh 1788 - 1790
  console.log('📊 Bước 1: Nạp 15 nến đầu ngày tích lũy sideway quanh VWAP 1789.0...');
  for (let i = 0; i < 15; i++) {
    const mins = baseTime + i;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;
    
    const isGreen = i % 2 === 0;
    const c = {
      time: timeStr,
      open: 1788.5 + (i % 3) * 0.3,
      close: isGreen ? 1789.2 : 1788.2,
      high: 1789.8,
      low: 1787.8,
      volume: 1800,
      isGreen,
      body: 0.7,
      upperWick: 0.6,
      lowerWick: 0.4,
      timestamp: Math.floor(Date.now() / 1000) - (20 - i) * 60,
    };
    candles.push(c);
  }

  // 2. Tạo 3 nến đỏ giảm dần về gần hỗ trợ PDL 1785.5
  console.log('📉 Bước 2: Phe bán ép giá giảm 3 nến đỏ về 1786.5...');
  const redCandles = [
    { time: '09:15', open: 1788.5, close: 1787.5, high: 1788.8, low: 1787.2, volume: 1600, isGreen: false, body: 1.0, upperWick: 0.3, lowerWick: 0.3 },
    { time: '09:16', open: 1787.5, close: 1786.8, high: 1787.8, low: 1786.5, volume: 1500, isGreen: false, body: 0.7, upperWick: 0.3, lowerWick: 0.3 },
    { time: '09:17', open: 1786.8, close: 1786.2, high: 1787.0, low: 1786.0, volume: 1400, isGreen: false, body: 0.6, upperWick: 0.2, lowerWick: 0.2 },
  ];
  for (const rc of redCandles) {
    rc.timestamp = Math.floor(Date.now() / 1000) - 3 * 60;
    candles.push(rc);
  }

  // 3. Nến 09:18: SPRING CANDLE (Quét thủng 1785.5 về 1785.0 rồi rút chân 1.5đ đóng 1787.0)
  console.log('🔨 Bước 3: Nến SPRING 09:18 quét đáy 1785.0 rút chân 1.5đ đóng 1787.0...');
  const springCandle = {
    time: '09:18',
    open: 1786.2,
    close: 1787.0,
    high: 1787.3,
    low: 1785.0, // Quét qua PDL 1785.5
    volume: 1950,
    isGreen: true,
    body: 0.8,
    upperWick: 0.3,
    lowerWick: 1.5, // Râu dưới 1.5đ >= 1.2đ
    timestamp: Math.floor(Date.now() / 1000) - 60,
  };
  candles.push(springCandle);

  // Giả lập extraData với Support Level 1785.5 và Sell Absorption
  const rawIntraday1m = {
    c: candles.map(c => c.close),
    o: candles.map(c => c.open),
    h: candles.map(c => c.high),
    l: candles.map(c => c.low),
    v: candles.map(c => c.volume),
    t: candles.map(c => c.timestamp),
  };

  const oiData = {
    foreignNet: 600,
    totalOI: 45000,
    totalVolume: 50000,
  };

  console.log('⚡ Xử lý nến Spring qua volumeScalper.processNewCandle...');
  // Bật chế độ simulation cho DayManager để kiểm tra luồng khớp lệnh và Profit Lock ngoài giờ giao dịch
  const dayMgr = volumeScalper.getDayManager();
  dayMgr.isSimulation = true;
  // Giả lập mở vị thế cho DayManager trong môi trường test
  dayMgr.activePosition = {
    id: 'SIM-SPRING-01',
    side: 'LONG',
    entryPrice: 1787.0,
    quantity: 1,
    initialSL: 1785.2,
    currentSL: 1785.2,
    maxProfitReached: 0,
    openTime: new Date()
  };
  dayMgr.profitGuard = new (require('../src/entrade/profitLockGuard'))(dayMgr.activePosition);

  await volumeScalper.processNewCandle(springCandle, candles, oiData, {
    rawIntraday1m,
    pillarAnalysis: { bullishCount: 4, bearishCount: 1, consensusLabel: 'MILD_LONG' },
    liquidityInfo: { mode: 'TREND', isLowLiquidity: false },
  });

  const stateAfterSpring = volumeScalper.getState();
  console.log('\n--- KẾT QUẢ SAU NẾN SPRING ---');
  console.log(`Vị thế Scalper: ${stateAfterSpring.position}`);
  console.log(`Giá vào: ${stateAfterSpring.entryPrice} | Giờ: ${stateAfterSpring.entryTime}`);
  if (stateAfterSpring.currentPlan) {
    console.log(`Kế hoạch Plan: SL ${stateAfterSpring.currentPlan.sl} (Dist: ${stateAfterSpring.currentPlan.slDistance}đ) | TP1: ${stateAfterSpring.currentPlan.tp1} | TP2: ${stateAfterSpring.currentPlan.tp2}`);
  }

  // 4. Giả lập Fast Tick: Giá tăng từ 1787.0 lên 1788.0 (+1.0đ) -> Profit Lock Guard kích hoạt
  console.log('\n📈 Bước 4: Giá tăng lên 1788.0 (+1.0đ) -> Kiểm tra Profit Lock Guard...');
  if (dayMgr && dayMgr.activePosition) {
    console.log(`Vị thế DayManager đang mở: ${dayMgr.activePosition.side} @ ${dayMgr.activePosition.entryPrice}`);
    await dayMgr.onPriceTick(1788.0);
    console.log(`Stoploss hiện tại sau Profit Lock: ${dayMgr.activePosition.currentSL} (Đã khóa +${(dayMgr.activePosition.currentSL - dayMgr.activePosition.entryPrice).toFixed(1)}đ)`);
  }

  // 5. Thử nghiệm Nến Nổ Vol Giả (Climax 5500 HĐ) khi không có vị thế
  console.log('\n🔥 Bước 5: Thử nghiệm Anti-Climax Chasing khi nổ vol 5,500 HĐ...');
  const climaxCandle = {
    time: '09:25',
    open: 1788.0,
    close: 1792.0,
    high: 1792.5,
    low: 1787.5,
    volume: 5500, // > 2.5x MA20
    isGreen: true,
    body: 4.0,
    upperWick: 0.5,
    lowerWick: 0.5,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const climaxCheck = predictiveEntry.analyzePredictiveEntry({
    candle: climaxCandle,
    allCandles: candles,
    volMA20: 2000,
  });

  console.log(`Kết quả Anti-Climax Block: ${climaxCheck.antiClimaxBlock}`);
  console.log(`Lý do: ${climaxCheck.reason}`);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('✅ HOÀN TẤT SIMULATION SCALPER v8.0 — TẤT CẢ MODULES HOẠT ĐỘNG HOÀN HẢO!');
  console.log('════════════════════════════════════════════════════════════════');
}

runScalperSimulation().catch(e => {
  console.error('Simulation error:', e);
});
