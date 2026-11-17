/**
 * 🧪 TEST SUITE: VN30F v9.0 — DYNAMIC FIBONACCI & LIQUIDITY RADAR ENGINE
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const fibonacciLiquidityEngine = require('../src/derivatives/fibonacciLiquidityEngine');
const intradaySignalEngine = require('../src/derivatives/intradaySignalEngine');
const oiTracker = require('../src/derivatives/oiTracker');
const dataFetcher = require('../src/derivatives/dataFetcher');

console.log('═'.repeat(60));
console.log('🧪 BẮT ĐẦU KIỂM THỬ HỆ THỐNG RADAR FIBONACCI & CUNG CẦU v9.0');
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
  // ─── TEST 1: KẺ FIBONACCI ĐỘNG REALTIME ────────────────────────
  console.log('\n📌 1. KIỂM THỬ TÍNH TOÁN FIBONACCI ĐỘNG REALTIME');

  it('Tính chính xác các mốc Fibo Retracement và Extension từ Swing High/Low', () => {
    const mockM5 = {
      c: [1840, 1842, 1845, 1848, 1850, 1846, 1842, 1840, 1838, 1836, 1838],
      h: [1841, 1843, 1846, 1849, 1850, 1847, 1843, 1841, 1839, 1837, 1839],
      l: [1839, 1841, 1844, 1847, 1849, 1845, 1841, 1839, 1837, 1835, 1837],
      v: [1500, 1800, 2100, 2500, 3000, 2000, 1600, 1400, 1200, 900, 1100],
    };
    const fibo = fibonacciLiquidityEngine.calculateDynamicFibonacci(mockM5, null, 1838);

    assert(fibo.swingHigh === 1850, `Swing High phải là 1850, nhận được: ${fibo.swingHigh}`);
    assert(fibo.swingLow === 1835, `Swing Low phải là 1835, nhận được: ${fibo.swingLow}`);
    assert(fibo.range === 15.0, `Range phải là 15.0đ, nhận được: ${fibo.range}`);

    // Fibo 50% = 1850 - 0.5 * 15 = 1842.5
    assert(fibo.f500 === 1842.5, `Fibo 50% phải là 1842.5, nhận được: ${fibo.f500}`);
    // Fibo 61.8% = 1850 - 0.618 * 15 = 1840.7
    assert(fibo.f618 === 1840.7, `Fibo 61.8% phải là 1840.7, nhận được: ${fibo.f618}`);
    // Fibo 38.2% = 1850 - 0.382 * 15 = 1844.3
    assert(fibo.f382 === 1844.3, `Fibo 38.2% phải là 1844.3, nhận được: ${fibo.f382}`);
    // Extension Quét SL Short (127.2%) = 1850 + 0.272 * 15 = 1854.1
    assert(fibo.fExtHigh1272 === 1854.1, `Fibo Ext 127.2% High phải là 1854.1, nhận được: ${fibo.fExtHigh1272}`);
    // Extension Quét SL Long (127.2%) = 1835 - 0.272 * 15 = 1830.9
    assert(fibo.fExtLow1272 === 1830.9, `Fibo Ext 127.2% Low phải là 1830.9, nhận được: ${fibo.fExtLow1272}`);
  });

  // ─── TEST 2: BẢN ĐỒ CUNG CẦU MỤC TIÊU SẮP QUÉT ────────────────
  console.log('\n📌 2. KIỂM THỬ BẢN ĐỒ CUNG CẦU & MỤC TIÊU SẮP QUÉT TỚI');

  it('Xác định chính xác mốc cản gần nhất, mốc quét đỉnh Short Squeeze và mốc hỗ trợ quét Long', () => {
    const fibo = {
      swingHigh: 1850,
      swingLow: 1835,
      range: 15,
      f0: 1835,
      f236: 1846.5,
      f382: 1844.3,
      f500: 1842.5,
      f618: 1840.7,
      f786: 1838.2,
      f100: 1850,
      fExtHigh1272: 1854.1,
      fExtHigh1618: 1859.3,
      fExtLow1272: 1830.9,
      fExtLow1618: 1825.7,
    };
    const currentPrice = 1837.0; // Đang ở dưới Fibo 78.6% (1838.2) và trên đáy Fibo 0% (1835)
    const targets = fibonacciLiquidityEngine.mapSupplyDemandTargets(fibo, currentPrice, null, null, null);

    assert(targets.nextSupplyTarget, 'Phải có mục tiêu Cung trên gần nhất');
    assert(targets.nextSupplyTarget.price === 1838.2, `Cung gần nhất phải là 1838.2, nhận: ${targets.nextSupplyTarget.price}`);
    assert(targets.nextSupplyTarget.dist === 1.2, `Khoảng cách phải là 1.2đ, nhận: ${targets.nextSupplyTarget.dist}`);

    assert(targets.nextDemandTarget, 'Phải có mục tiêu Cầu dưới gần nhất');
    assert(targets.nextDemandTarget.price === 1835.0, `Cầu gần nhất phải là đáy 1835.0, nhận: ${targets.nextDemandTarget.price}`);
    assert(targets.nextDemandTarget.dist === 2.0, `Khoảng cách cầu phải là 2.0đ, nhận: ${targets.nextDemandTarget.dist}`);

    assert(targets.huntSupplyTarget.price >= 1850, 'Mục tiêu quét cản Short Squeeze phải là đỉnh cũ hoặc cao hơn');
    assert(targets.huntDemandTarget.price <= 1835, 'Mục tiêu quét đáy Long Liquidation phải là đáy cũ hoặc thấp hơn');
  });

  // ─── TEST 3: NHẬN DIỆN VÙNG TỤ TẬP ĐÁM ĐÔNG / SIDEWAY (50/50 TÀI XỈU) ───
  console.log('\n📌 3. KIỂM THỬ NHẬN DIỆN VÙNG TỤ TẬP ĐÁM ĐÔNG / SIDEWAY NỀN');

  it('Phát hiện vùng kẹt nền hẹp (< 2.8đ) và cảnh báo cấm đoán hướng 50/50 tài xỉu', () => {
    const mockM5 = {
      c: [1842.0, 1842.8, 1841.8, 1842.5, 1842.2, 1842.4],
      h: [1843.0, 1843.2, 1842.9, 1843.1, 1842.8, 1843.0],
      l: [1841.5, 1842.0, 1841.4, 1841.9, 1841.7, 1841.8],
      v: [700, 650, 600, 800, 750, 700],
    };
    const fibo = { f500: 1842.5 };
    const sideway = fibonacciLiquidityEngine.detectSidewayCrowdZone(fibo, 1842.4, mockM5, null);

    assert(sideway.isSidewayChop === true, 'Phải phát hiện trạng thái Sideway kẹt nền');
    assert(sideway.warning.includes('VÙNG TỤ TẬP ĐÁM ĐÔNG'), 'Cảnh báo phải chứa từ khóa VÙNG TỤ TẬP ĐÁM ĐÔNG');
    assert(sideway.warning.includes('50/50 tài xỉu'), 'Cảnh báo phải khuyên tránh bẫy 50/50 tài xỉu');
  });

  // ─── TEST 4: PHÂN TÍCH VSA VOLUME VS NẾN (ĐẠP THIẾU VOL, KÉO CỐ, SÓNG THẬT) ───
  console.log('\n📌 4. KIỂM THỬ VSA VOLUME & BẪY LÁI');

  it('Tình huống 1: Giá giật -2.2đ về 1836 nhưng chỉ 900 HĐ ➔ Bẫy Kiệt Bán / Cấm Short đuổi', () => {
    const mockM5 = {
      c: [1840.0, 1838.2, 1836.0],
      o: [1840.5, 1840.0, 1838.2],
      h: [1841.0, 1840.2, 1838.5],
      l: [1839.5, 1838.0, 1835.8],
      v: [2200, 1900, 900], // Vol chỉ 900 HĐ
    };
    const vsa = fibonacciLiquidityEngine.analyzeVSAIntradayAction(mockM5, null, 1836.0, null, null);

    assert(vsa.isNoSupply === true, 'Phải nhận diện tín hiệu Đạp thiếu Vol / Kiệt Bán');
    assert(vsa.headline.includes('ĐẠP THIẾU VOL / KIỆT BÁN'), 'Tiêu đề phải chỉ rõ ĐẠP THIẾU VOL');
    assert(vsa.detail.includes('CẤM SHORT ĐUỔI'), 'Khuyến nghị phải cấm Short đuổi dính đáy');
  });

  it('Tình huống 2: Giá kéo +2.0đ nhưng Vol teo tóp hoặc râu trên dài ➔ Kéo cố / Long giả / Cấm đua Long', () => {
    const mockM5 = {
      c: [1840.0, 1841.0, 1843.0],
      o: [1839.0, 1840.0, 1841.0],
      h: [1840.5, 1841.5, 1844.5], // Râu trên 1.5đ
      l: [1838.5, 1839.5, 1840.8],
      v: [2000, 1800, 950], // Vol chỉ 950 HĐ
    };
    const vsa = fibonacciLiquidityEngine.analyzeVSAIntradayAction(mockM5, null, 1843.0, null, null);

    assert(vsa.isNoDemand === true, 'Phải nhận diện Kéo cố / Thiếu Cầu / Long giả');
    assert(vsa.detail.includes('CẤM ĐUA LONG'), 'Khuyến nghị phải cấm đua Long giá cao');
  });

  it('Tình huống 3: 3 cây nến nổ vol liên tiếp phá cản (> 2k HĐ) ➔ Xác nhận sóng thật tiếp diễn', () => {
    const mockM5 = {
      c: [1840.0, 1842.0, 1845.0],
      o: [1839.0, 1840.0, 1842.0],
      h: [1840.5, 1842.5, 1845.5],
      l: [1838.5, 1839.5, 1841.5],
      v: [2100, 2400, 3100], // Vol nổ mạnh 3100 HĐ
    };
    const mockM1 = {
      c: [1842.5, 1843.5, 1845.0],
      o: [1842.0, 1842.8, 1843.5],
      v: [1100, 1200, 1400],
    };
    const vsa = fibonacciLiquidityEngine.analyzeVSAIntradayAction(mockM5, mockM1, 1845.0, null, null);

    assert(vsa.isTrueBreakout === true, 'Phải xác nhận sóng thật Breakout nổ Vol');
    assert(vsa.headline.includes('SÓNG LONG THẬT') || vsa.headline.includes('SÓNG THẬT'), 'Phải thông báo Sóng Thật');
  });

  // ─── TEST 5: FORMAT TIN NHẮN NOTI REALTIME ĐẦY ĐỦ ───────────────
  console.log('\n📌 5. KIỂM THỬ FORMAT TIN NHẮN RADAR CUNG CẦU & FIBONACCI');

  it('Tin nhắn Telegram đưa THẾ & CẤU TRÚC lên DÒNG ĐẦU TIÊN, gộp cảnh báo giá giật/vol, không có đi lệnh hay N/A', () => {
    const msg = intradaySignalEngine.formatRadarNotification({
      f1mPrice: 1843.0,
      vn30Price: 1844.3,
      basis: { basis: -1.3 },
      fibo: {
        swingHigh: 1850.0,
        swingLow: 1836.0,
        range: 14.0,
        f500: 1843.0,
      },
      sdTargets: {
        nextSupplyTarget: { price: 1845.5, levelName: 'Fibo 38.2%', role: 'Cản gần nhất', dist: 2.5 },
        huntSupplyTarget: { price: 1853.8, levelName: 'Fibo Ext 127.2%', role: 'Quét râu vượt đỉnh', dist: 10.8 },
        nextDemandTarget: { price: 1840.0, levelName: 'Fibo 78.6%', role: 'Hỗ trợ gần nhất', dist: 3.0 },
        huntDemandTarget: { price: 1832.2, levelName: 'Fibo Ext 127.2%', role: 'Nhúng xuyên đáy', dist: 10.8 },
      },
      sidewayInfo: { isSidewayChop: false },
      vsaAction: {
        headline: '📊 Biến động 5p: +1.2đ | Vol: 2.500 HĐ (x1.4 TB)',
        detail: 'Lực cầu chủ động gia tăng.',
      },
      m15Analysis: { signal: 'BULLISH', description: '15p Uptrend (EMA5 > EMA13)' },
      m5Analysis: { signal: 'BULLISH', description: '5p Bullish (Giá > EMA9 > EMA20)' },
      m1Analysis: { signal: 'BULLISH', description: '1p Vi mô: 3/3 nến xanh' },
      structureInfo: { structureTag: '🟢 NÂNG ĐỈNH + NÂNG ĐÁY (Swing Up) ➔ THUẬN THẾ LONG' },
      liquidityInfo: { totalVal: 15200, speed: 65.5, modeLabel: 'SCALP' },
      smartMoneyInfo: {
        foreignNet: 1200,
        effectiveTD: -400,
        smartMoneyNet: 800,
        crowdNet: -800,
        foreignPct: 12.5,
        tdPct: 4.2,
        smartMoneyPct: 8.3,
      },
      triggerContext: {
        label: '⚡ GIÁ GIẬT -2.2đ (Vol chỉ 900 HĐ) ➔ ĐẠP THIẾU VOL / KIỆT BÁN'
      },
      signalCount: 1,
    });

    const lines = msg.trim().split('\n');
    assert(lines[0].includes('THẾ LONG') || lines[0].includes('THẾ SHORT') || lines[0].includes('THẾ SIDEWAY'), 'Dòng đầu tiên của tin nhắn BẮT BUỘC phải là THẾ VÀ CẤU TRÚC THỊ TRƯỜNG');
    assert(msg.includes('RADAR CUNG CẦU & BẢN ĐỒ FIBONACCI'), 'Phải có tiêu đề RADAR CUNG CẦU & BẢN ĐỒ FIBONACCI');
    assert(msg.includes('⚡ GIÁ GIẬT -2.2đ (Vol chỉ 900 HĐ)'), 'Phải gộp cảnh báo giá giật/vol vào chung tin nhắn');
    assert(msg.includes('<b>F1M: 1843.0</b>'), 'Phải hiển thị F1M: 1843.0');
    assert(msg.includes('VN30: <b>1844.3</b>'), 'Phải hiển thị VN30: 1844.3');
    assert(msg.includes('Basis: <b>-1.3đ</b>'), 'Phải hiển thị Basis: -1.3đ');
    assert(msg.includes('1845.5'), 'Phải hiển thị mốc Cung 1845.5');
    assert(msg.includes('1840'), 'Phải hiển thị mốc Cầu 1840');
    assert(!msg.includes('AI TRADER:'), 'TUYỆT ĐỐI không được có AI TRADER đi lệnh');
    assert(!msg.includes('Lệnh #1/4'), 'TUYỆT ĐỐI không được có Lệnh #1/4');
    assert(!msg.includes('N/A'), 'Không được xuất hiện N/A');
  });

  // ─── TEST 6: VALIDATE CRON EXPRESSIONS ──────────────────────────
  console.log('\n📌 6. KIỂM THỬ CRON EXPRESSIONS INTRADAY');

  it('Các cron expressions của chu kỳ 5p trong phiên đều hợp lệ', () => {
    const testSchedules = [
      '10 9 * * 1-5', '30 9 * * 1-5', '0 10 * * 1-5', '30 10 * * 1-5',
      '0 11 * * 1-5', '30 11 * * 1-5', '5 13 * * 1-5', '30 13 * * 1-5', '20 14 * * 1-5'
    ];
    for (const expr of testSchedules) {
      assert(cron.validate(expr), `Cron ${expr} không hợp lệ`);
    }
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`🎉 KẾT QUẢ KIỂM THỬ: ${passCount}/${totalCount} TEST CASES THÀNH CÔNG!`);
  console.log('═'.repeat(60));

  if (passCount === totalCount) {
    console.log('🚀 RADAR FIBONACCI & CUNG CẦU v9.0 HOÀN TOÀN CHUẨN XÁC VÀ SẴN SÀNG!');
  } else {
    process.exit(1);
  }
}

runAll().catch(e => {
  console.error('Fatal Test Error:', e);
  process.exit(1);
});
