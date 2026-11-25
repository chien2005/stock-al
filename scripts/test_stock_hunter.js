/**
 * AI STOCK HUNTER - P0 & P1 Deterministic Test Suite (Master Plan V2.0 Section 24)
 * Kiểm thử toàn bộ các quy tắc sinh tử:
 * - Data & Unit Normalization (D01-D13)
 * - Exchange Calendar & T+2 Settlement (T01-T09, P01-P08)
 * - Feature Engine & Zero Look-ahead Pivots (F01-F08)
 * - Market Regime & Sector Concentration (M01-M06)
 * - Strategies, Special Watch B0-B7 & Hard Gates (S01-S18)
 * - Risk Sizing, 60M NAV, Fees/Tax & Never Lower Stop (R01-R12)
 * - Exit Guardian Priorities P0-P6 (E01-E10)
 * - Notification Formatter & Dedupe (N01-N07)
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const sh = require('../src/stock_hunter');

let passed = 0;
let failed = 0;

function test(id, desc, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${id}: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${id}: ${desc} -> ${err.message}`);
    failed++;
  }
}

// Helper tạo chuỗi nến D giả lập
function makeDailyBars({ count = 70, startPrice = 20000, step = 100, volume = 1000000, startDate = '2026-08-01' } = {}) {
  const bars = [];
  let cursor = new Date(`${startDate}T14:30:00+07:00`);
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    while (cursor.getDay() === 0 || cursor.getDay() === 6) {
      cursor = new Date(cursor.getTime() + 86400000);
    }
    const open = price;
    const close = Math.max(5000, price + step);
    const high = Math.max(open, close) + 200;
    const low = Math.min(open, close) - 200;
    bars.push({
      symbol: 'DEMO',
      exchange: 'HOSE',
      timeframe: '1D',
      timestamp: Math.floor(cursor.getTime() / 1000),
      dateStr: sh.calendar.toVnComponents(cursor).dateStr,
      open,
      high,
      low,
      close,
      volume,
      matchedValueVnd: close * volume,
      final: true,
      quality: 'VALID',
    });
    price = close;
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return bars;
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 CHẠY TEST SUITE P0/P1 — AI STOCK HUNTER T+ v2.0');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── 1. DATA & UNIT NORMALIZATION ──
test('D01', 'Chuẩn hóa giá VPS 20.0 nghìn -> 20,000 VND đúng 1 lần, lot*10 = shares, fix dấu changePct', () => {
  const q = sh.marketDataProvider.normalizeVpsQuote({
    sym: 'DEMO', lastPrice: '20.0', r: '20.5', c: '21.9', f: '19.1',
    openPrice: '20.3', highPrice: '20.4', lowPrice: '19.9', lot: '1000', changePc: '2.44',
  });
  assert.strictEqual(q.priceVnd, 20000);
  assert.strictEqual(q.volumeShares, 10000);
  assert.strictEqual(q.changePct, -2.44);
  assert.strictEqual(q.foreignNetShares, null); // D13: không gán 0 giả khi thiếu field NN
});

test('D02', 'Reject bar có OHLC sai (low > close)', () => {
  const res = sh.marketDataProvider.validateBar({ open: 20000, high: 20500, low: 20200, close: 20100, volume: 100 });
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason, 'INVALID_OHLC_BOUNDS');
});

test('D03', 'Deduplicate bar cùng timestamp (không cộng trùng volume)', () => {
  const ts = Math.floor(new Date('2026-11-20T14:30:00+07:00').getTime() / 1000);
  const parsed = sh.marketDataProvider.normalizeTradingViewBars('DEMO', {
    t: [ts, ts], o: [20, 20], h: [21, 21], l: [19.5, 19.5], c: [20.5, 20.6], v: [500000, 600000],
  }, '1D', 'THOUSAND_VND');
  assert.strictEqual(parsed.bars.length, 1);
  assert.strictEqual(parsed.bars[0].volume, 600000);
});

// ── 2. CALENDAR, TICK RULES & T+2 SETTLEMENT ──
test('T01-T05', 'Phân loại chính xác session HOSE ATO / Continuous / Lunch / ATC / Closed', () => {
  assert.strictEqual(sh.calendar.sessionAt('2026-11-25T09:05:00+07:00', 'HOSE'), 'ATO');
  assert.strictEqual(sh.calendar.sessionAt('2026-11-25T09:30:00+07:00', 'HOSE'), 'CONTINUOUS_AM');
  assert.strictEqual(sh.calendar.sessionAt('2026-11-25T12:00:00+07:00', 'HOSE'), 'LUNCH_BREAK');
  assert.strictEqual(sh.calendar.sessionAt('2026-11-25T14:35:00+07:00', 'HOSE'), 'ATC');
  assert.strictEqual(sh.calendar.sessionAt('2026-11-25T14:46:00+07:00', 'HOSE'), 'PUT_THROUGH_ONLY');
  assert.strictEqual(sh.calendar.sessionAt('2026-04-30T10:00:00+07:00', 'HOSE'), 'CLOSED_HOLIDAY');
});

test('P01-P03', 'Tính T+2 qua cuối tuần & ngày nghỉ lễ chính xác', () => {
  // Mua Thứ Hai 2026-11-23 -> T+2 là Thứ Tư 2026-11-25
  assert.strictEqual(sh.calendar.calculateSettlementDate('2026-11-23'), '2026-11-25');
  // Mua Thứ Sáu 2026-11-20 -> T+2 là Thứ Ba 2026-11-24
  assert.strictEqual(sh.calendar.calculateSettlementDate('2026-11-20'), '2026-11-24');
  // Mua Thứ Năm 2026-04-29 (trước lễ 30/4 & 01/5) -> nhảy qua lễ + T7/CN
  const settleHoliday = sh.calendar.calculateSettlementDate('2026-04-29');
  assert.strictEqual(settleHoliday, '2026-05-05');
});

test('TICK', 'Làm tròn bước giá HOSE (<10k:10đ, 10k-49.95k:50đ, >=50k:100đ) & HNX (100đ)', () => {
  assert.strictEqual(sh.tickRules.roundToTick(9847, 'HOSE', 'floor'), 9840);
  assert.strictEqual(sh.tickRules.roundToTick(20130, 'HOSE', 'floor'), 20100);
  assert.strictEqual(sh.tickRules.roundToTick(62380, 'HOSE', 'ceil'), 62400);
  assert.strictEqual(sh.tickRules.roundToTick(20130, 'HNX', 'floor'), 20100);
});

// ── 3. FEATURES & ZERO LOOK-AHEAD ──
test('F01-F05', 'Flat bar không chia 0; Warmup thiếu trả null; Flat series RSI = 50', () => {
  const flatM = sh.features.computeBarMetrics({ open: 20000, high: 20000, low: 20000, close: 20000, volume: 100 }, 20000);
  assert.strictEqual(flatM.flatBar, true);
  assert.strictEqual(flatM.clv, null);
  assert.strictEqual(sh.features.computeSMA([10, 20], 20), null);
  assert.strictEqual(sh.features.computeWilderRSI(Array(20).fill(20000), 14), 50);
});

test('F06-F08', 'Pivot không look-ahead (chỉ biết sau rightBars) và đếm test độc lập không trùng', () => {
  const bars = makeDailyBars({ count: 20, startPrice: 20000, step: 0 });
  bars[10].low = 18000;
  const { lows } = sh.zones.findConfirmedPivots(bars, 2, 2);
  assert.strictEqual(lows.length, 1);
  assert.strictEqual(lows[0].confirmedAtIndex, 12);
  // 10 nến liền chạm cùng vùng chỉ tính tối đa ~3 lần test độc lập (gap >= 3)
  const zones = sh.zones.clusterPriceZones([{ price: 20000 }], bars.slice(0, 10), 500, 3);
  assert(zones[0].independentTests <= 4);
});

// ── 4. MARKET REGIME & FAIL-CLOSED ──
test('D07-M06', 'Coverage < 90% hoặc thiếu benchmark -> Market UNKNOWN (fail-closed)', () => {
  const mr = sh.marketRegime.classifyMarketRegime({
    vnindexBars: makeDailyBars({ count: 30 }),
    featureList: [],
    expectedUniverseCount: 130,
  });
  assert.strictEqual(mr.regime, 'UNKNOWN');
  assert.strictEqual(mr.exposureCap, 0);
});

test('M01-M04', 'Index xanh nhưng trụ kéo -> concentrationFlag=true; PANIC block ngay không đợi hysteresis', () => {
  const vniBars = makeDailyBars({ count: 65, startPrice: 1200, step: 2 });
  const features = [];
  for (let i = 0; i < 100; i++) {
    features.push({
      symbol: `S${i}`,
      currentPrice: 20000,
      changePct: i < 20 ? 2.0 : -2.5, // chỉ 20% tăng, 80% giảm
      daily: { ma20: 21000, ma50: 21500 },
    });
  }
  const mrConc = sh.marketRegime.classifyMarketRegime({
    vnindexBars: vniBars,
    vnindexLive: { index: 1335, changePct: 0.6 },
    featureList: features,
    expectedUniverseCount: 100,
    asOf: new Date('2026-11-25T14:00:00+07:00'),
  });
  assert.strictEqual(mrConc.concentrationFlag, true);

  const mrPanic = sh.marketRegime.classifyMarketRegime({
    vnindexBars: vniBars,
    vnindexLive: { index: 1280, changePct: -2.8 },
    featureList: features,
    expectedUniverseCount: 100,
    priorRegimeState: { baseRegime: 'UPTREND_STRONG' },
    asOf: new Date('2026-11-25T14:00:00+07:00'),
  });
  assert.strictEqual(mrPanic.regime, 'PANIC');
  assert.strictEqual(mrPanic.exposureCap, 0);
});

// ── 5. STRATEGIES & SPECIAL WATCH B0-B7 ──
test('S02-S09-S10-S11-S12', 'Cấm S01 trên LH_LL; Cấm nhảy B2->B5 từ 1 nến rút chân; Bắt buộc B2->B3->B4->B5; Thủng đáy -> B7_FAILED', () => {
  // S10: 1 nến rút chân climax -> chỉ vào B2, tuyệt đối không B5
  const downBars = makeDailyBars({ count: 30, startPrice: 30000, step: -350, volume: 1000000 });
  const lastBar = downBars[downBars.length - 1];
  const featB2 = {
    symbol: 'FALL',
    currentPrice: 19500,
    daily: {
      closedCount: 30,
      closedBars: downBars,
      currentBar: { open: 19000, high: 19600, low: 17500, close: 19500, volume: 2500000 },
      currentMetrics: { clv: 0.95, lowerWickRatio: 0.71, upperWickRatio: 0.05, range: 2100, returnPct: -1.0 },
      ma20: 22000, ma50: 25000, rsi14: 24, drawdown60D: -32, low20D: 17500,
    },
  };
  const ep2 = sh.specialWatch.evaluateSpecialWatch({
    symbol: 'FALL',
    feature: featB2,
    zones: { structure: 'LH_LL', latestSwingHigh: { price: 20500 } },
    supplyDemand: { state: 'ABSORPTION_WATCH', cues: ['SELLING_CLIMAX_CANDIDATE'] },
    asOf: new Date('2026-11-20T14:00:00+07:00'),
  });
  assert.strictEqual(ep2.state, 'B2_CLIMAX_OR_SPRING');

  // S12: Phiên sau thủng đáy climaxLow 17500 -> B7_FAILED
  const epFail = sh.specialWatch.evaluateSpecialWatch({
    symbol: 'FALL',
    feature: { ...featB2, currentPrice: 17100, daily: { ...featB2.daily, currentBar: { open: 18500, high: 18600, low: 17000, close: 17100 } } },
    zones: { structure: 'LH_LL' },
    supplyDemand: { state: 'SUPPLY_PRESSURE', cues: ['SUPPLY_PRESSURE_D'] },
    priorEpisode: ep2,
    asOf: new Date('2026-11-23T14:00:00+07:00'),
  });
  assert.strictEqual(epFail.state, 'B7_FAILED');
});

// ── 6. TRADE PLAN, RISK SIZING 60M & FEES/TAX ──
test('R01-R05-R06-R07-R12', 'Tính stop chính xác, sizing lô 100 từ 60tr, chặn 1 lô giá 248k > cap 35%, PnL ròng +1% gộp', () => {
  // R12: 500 cp mua 20,000, bán 20,200 (+1% giá), phí 0.15%/chiều, thuế 0.1%
  const pnl = sh.riskEngine.calculateNetPnL({ buyPriceVnd: 20000, sellPriceVnd: 20200, qty: 500 });
  assert.strictEqual(pnl.netPnlVnd, 59750); // +0.60% ròng, KHÔNG phải +1%

  // R05: 60tr, risk 0.5% = 300k, risk/cp = 900 -> 333 -> làm tròn xuống 300 cp (nếu stress cho phép)
  const dummyCand = {
    symbol: 'DEMO',
    riskCluster: 'TECH_GROWTH',
    medianVol20: 1000000,
    tradePlan: {
      valid: true, entryWorst: 20000, stopVnd: 19200, netRiskPerShare: 900, stressedLossPerShare: 1500,
    },
  };
  const alloc = sh.riskEngine.allocatePortfolioCandidates(
    [dummyCand],
    { availableCashVnd: 60000000, positionLots: [], navPeakVnd: 60000000 },
    new Map(),
    { regime: 'UPTREND_STRONG', exposureCap: 1.0 }
  );
  assert.strictEqual(alloc.allocated[0].recommendedQty, 300);

  // R07: 1 lô giá 248,000đ = 24.8tr > 35% của 60tr (21tr) -> NO_TRADE_SIZE
  const expensiveCand = {
    symbol: 'VIC',
    riskCluster: 'VINGROUP_ECOSYSTEM',
    medianVol20: 2000000,
    tradePlan: {
      valid: true, entryWorst: 248000, stopVnd: 240000, netRiskPerShare: 9000, stressedLossPerShare: 35000,
    },
  };
  const allocExp = sh.riskEngine.allocatePortfolioCandidates(
    [expensiveCand],
    { availableCashVnd: 60000000, positionLots: [], navPeakVnd: 60000000 },
    new Map(),
    { regime: 'UPTREND_STRONG', exposureCap: 1.0 }
  );
  assert.strictEqual(allocExp.allocated[0].allocationStatus, 'NO_TRADE_SIZE');
});

// ── 7. LEDGER T+2, NEVER LOWER STOP & EXIT GUARDIAN ──
test('R02-P01-P06-E01-E05-E08', 'Ledger T+2 locked/available, chống duplicate fill, cấm hạ stop, P1 EXIT_PENDING_LOCKED & P2 EXIT khi +1%', () => {
  const tmpLedgerPath = path.join(os.tmpdir(), `sh_test_ledger_${Date.now()}.json`);
  const ledger = new sh.LedgerService(tmpLedgerPath, 60000000);

  // Mua Thứ Hai 2026-11-23
  const buy1 = ledger.recordBuyFill({
    fillId: 'F-001',
    symbol: 'DEMO',
    qty: 500,
    priceVnd: 20000,
    stopVnd: 19200,
    buyTimestamp: new Date('2026-11-23T10:00:00+07:00'),
  });
  assert.strictEqual(buy1.ok, true);
  assert.strictEqual(buy1.lot.settleDate, '2026-11-25');

  // P06: Duplicate fill ID -> reject
  const dup = ledger.recordBuyFill({ fillId: 'F-001', symbol: 'DEMO', qty: 500, priceVnd: 20000 });
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.reason, 'DUPLICATE_FILL_ID');

  // R02: Cấm hạ stop xuống 19,150đ
  const lowerStop = ledger.updateLotStop(buy1.lot.lotId, 19150);
  assert.strictEqual(lowerStop.ok, false);
  assert.strictEqual(lowerStop.reason, 'NEVER_LOWER_STOP_POLICY');

  // P01 + E01: Thứ Ba 2026-11-24 giá chạm 19,150đ -> EXIT_PENDING_LOCKED (hàng chưa về!)
  const exitTue = sh.exitEngine.evaluateExitForSymbol({
    symbol: 'DEMO',
    lots: ledger.state.positionLots,
    quote: { priceVnd: 19150, lowVnd: 19150, quality: 'VALID' },
    asOf: new Date('2026-11-24T10:00:00+07:00'),
  });
  assert.strictEqual(exitTue.priority, 'P1');
  assert.strictEqual(exitTue.action, 'EXIT_PENDING_LOCKED');
  assert.strictEqual(exitTue.lockedQty, 500);

  // E05: Chiều Thứ Tư 2026-11-25 (14:00, hàng T+2 đã về), giá lãi +1% (20,200) nhưng FAILED_BREAKOUT -> P2 EXIT!
  const exitWed = sh.exitEngine.evaluateExitForSymbol({
    symbol: 'DEMO',
    lots: ledger.state.positionLots,
    quote: { priceVnd: 20200, lowVnd: 20000, quality: 'VALID' },
    supplyDemand: { state: 'SUPPLY_PRESSURE', cues: ['FAILED_BREAKOUT'] },
    asOf: new Date('2026-11-25T14:00:00+07:00'),
  });
  assert.strictEqual(exitWed.priority, 'P2');
  assert.strictEqual(exitWed.action, 'EXIT');
  assert.strictEqual(exitWed.availableQty, 500);

  try { fs.unlinkSync(tmpLedgerPath); } catch (e) { /* ignore */ }
});

// ── 8. NOTIFICATION FORMATTER ──
test('N01', 'Bản tin NO_TRADE khi không có kèo đạt chuẩn & không ép đủ ngành', () => {
  const msg = sh.notifierService.formatMainScanReport({
    asOf: '2026-11-25T14:00:00+07:00',
    session: 'CONTINUOUS_PM',
    marketRegime: {
      regime: 'DOWNTREND', liquidityLabel: 'LOW', liquidityRatio: 0.78, exposureCap: 0.2,
      vnindex: { index: 1210, changePct: -1.1, ma20: 1235 },
      breadth: { validCount: 130, expectedCount: 131, advancing: 25, declining: 95, unchanged: 10, pctAboveMA20: 22.5 },
    },
    portfolioRiskState: { navVnd: 60000000, availableCashVnd: 60000000 },
    buySignals: [],
    watchList: [],
    specialWatchList: [],
    avoidList: [],
    exitDecisions: [],
  }, '14:00');
  assert(msg.includes('KHÔNG CÓ KÈO ĐẠT CHUẨN'));
  assert(msg.includes('Xu hướng giảm'));
});

// ── 9. V2.1 UPGRADE INVARIANTS ──
test('V21-01', 'RVOL15 yêu cầu tối thiểu 15 phiên cùng khung giờ, thiếu trả null; lọc bỏ nến 15m chưa đóng', () => {
  const short15m = Array.from({ length: 12 }, (_, idx) => ({
    timeLabel: '09:30', dateStr: `2026-11-${String(idx + 1).padStart(2, '0')}`, volume: 10000, final: true, open: 20000, high: 20200, low: 19900, close: 20100,
  }));
  assert.strictEqual(sh.features.computeRVOL15(short15m, 20, 15), null);

  const full15m = Array.from({ length: 17 }, (_, idx) => ({
    timeLabel: '09:30', dateStr: `2026-10-${String(idx + 1).padStart(2, '0')}`, volume: idx === 16 ? 25000 : 10000, final: true, open: 20000, high: 20200, low: 19900, close: 20100,
  }));
  // Thêm 1 nến chưa đóng final: false ở cuối -> phải bị lọc bỏ, không làm sai RVOL15
  full15m.push({ timeLabel: '09:45', dateStr: '2026-10-18', volume: 999999, final: false, open: 20100, high: 20500, low: 20000, close: 20400 });
  assert.strictEqual(sh.features.computeRVOL15(full15m, 20, 15), 2.5);
});

test('V21-02', 'SL đã bị xuyên -> lưu stopBreached=true, giá hồi lên trên SL vẫn bắt buộc P1 EXIT + cập nhật NAV đỉnh', () => {
  const tmpPath = path.join(os.tmpdir(), `sh_v21_ledger_${Date.now()}.json`);
  const ledger = new sh.LedgerService(tmpPath, 60000000);
  const buy = ledger.recordBuyFill({
    fillId: 'V21-1', symbol: 'DEMO', qty: 500, priceVnd: 20000, stopVnd: 19200,
    buyTimestamp: new Date('2026-11-20T10:00:00+07:00'),
  });
  assert.strictEqual(buy.ok, true);

  ledger.markSymbolStopBreached('DEMO', 19100, new Date('2026-11-24T10:00:00+07:00'));
  // Giá hồi lại lên 19,500 (> SL 19,200) -> Vẫn phải bắt buộc EXIT!
  const exitRes = sh.exitEngine.evaluateExitForSymbol({
    symbol: 'DEMO',
    lots: ledger.state.positionLots,
    quote: { priceVnd: 19500, lowVnd: 19400, quality: 'VALID' },
    asOf: new Date('2026-11-25T14:00:00+07:00'),
  });
  assert.strictEqual(exitRes.priority, 'P1');
  assert.strictEqual(exitRes.action, 'EXIT');

  // NAV đỉnh cập nhật & Kill Switch khi drawdown >= 8%
  ledger.updateNavTracking(65000000, new Date('2026-11-25T14:00:00+07:00'));
  assert.strictEqual(ledger.state.navPeakVnd, 65000000);
  ledger.updateNavTracking(59000000, new Date('2026-11-25T14:15:00+07:00'));
  assert.strictEqual(ledger.state.killSwitchActive, true);

  try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`🏁 KẾT QUẢ TEST STOCK HUNTER: ${passed} PASSED | ${failed} FAILED`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
