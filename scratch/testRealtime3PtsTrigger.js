/**
 * Test script kiểm tra VN30F Signal Engine v4.3:
 * 1. Multi-TF F1 Supply/Demand Analysis (1m, 3m, 5m, 15m)
 * 2. Cung Cầu Veto & Scoring Engine integration
 * 3. Bóc tách Delta Vị Thế 3 Phe trong nhịp biến động 3đ
 * 4. Format Notification mẫu v4.3 chuẩn Telegram
 */

const { analyzeMultiTFSupplyDemand } = require('../src/derivatives/flowEngine');
const { calculateScore } = require('../src/derivatives/scoringEngine');
const { buildSignalNotification } = require('../src/derivatives/notificationBuilder');
const oiTracker = require('../src/derivatives/oiTracker');

console.log('='.repeat(60));
console.log('🧪 TEST VN30F REALTIME SIGNAL ENGINE v4.3');
console.log('='.repeat(60));

// ─── 1. TEST MULTI-TF SUPPLY & DEMAND ANALYSIS ──────────────────
console.log('\n[1] Kiểm tra analyzeMultiTFSupplyDemand (1m, 3m, 5m, 15m)...');

// Tạo dữ liệu giả lập 30 nến 1 phút với áp lực xả đỉnh (râu trên dài)
const nowSec = Math.floor(Date.now() / 1000);
const mock1mData = {
  o: [], h: [], l: [], c: [], v: [], t: []
};

for (let i = 0; i < 30; i++) {
  const basePrice = 1950 + i * 0.5;
  const isLastBars = i >= 25;
  // Các nến cuối bị đè: High vọt lên 1965 nhưng Close bị xả về 1958 (râu trên dài)
  const open = basePrice;
  const high = isLastBars ? 1965 : basePrice + 1;
  const low = basePrice - 0.5;
  const close = isLastBars ? 1958 : basePrice + 0.8;
  const vol = isLastBars ? 800 : 300;

  mock1mData.o.push(open);
  mock1mData.h.push(high);
  mock1mData.l.push(low);
  mock1mData.c.push(close);
  mock1mData.v.push(vol);
  mock1mData.t.push(nowSec - (30 - i) * 60);
}

const sdResult = analyzeMultiTFSupplyDemand(mock1mData);
console.log('   Consensus:', sdResult.consensus);
console.log('   Summary:', sdResult.summaryText);
console.log('   TF 1p:', sdResult.tf1m?.label, `(râu trên: ${sdResult.tf1m?.upperWickPct}%)`);
console.log('   TF 3p:', sdResult.tf3m?.label, `(râu trên: ${sdResult.tf3m?.upperWickPct}%)`);
console.log('   TF 5p:', sdResult.tf5m?.label, `(râu trên: ${sdResult.tf5m?.upperWickPct}%)`);
console.log('   TF 15p:', sdResult.tf15m?.label);

// ─── 2. TEST SCORING VETO VỚI CUNG CẦU F1 ────────────────────────
console.log('\n[2] Kiểm tra Cung Cầu Veto trong scoringEngine...');
const mockPriceMap = {
  currentPrice: 1958,
  vwap: 1952,
  ema20: 1950,
  levels: [
    { price: 1965, type: 'RESISTANCE', label: 'Đỉnh hôm nay' },
    { price: 1945, type: 'SUPPORT', label: 'Hỗ trợ VAL' }
  ]
};

const scoreRes = calculateScore({
  priceMap: mockPriceMap,
  testResults: {},
  acceptanceResult: {},
  flowResult: {
    delta: { current: -200, cumulative: -500 },
    cvd: { direction: 'FALLING' },
    aggression: { dominant: 'SELLERS' }
  },
  supplyDemandResult: sdResult,
});

console.log('   Score Direction:', scoreRes.direction);
console.log('   Confidence:', scoreRes.confidence);
console.log('   Veto Type:', scoreRes.vetoType);
console.log('   Veto Reason:', scoreRes.vetoReason);

// ─── 3. TEST NOTIFICATION MẪU v4.3 (ĐỨNG NGOÀI QUAN SÁT) ─────────
console.log('\n[3] Kiểm tra Build Notification (Đứng ngoài quan sát theo đúng form user)...');

const mockAnalysisStandby = {
  scoreResult: {
    direction: 'NO_TRADE',
    confidence: 0,
    setupQuality: 'N/A',
    risk: 'VỪA PHẢI',
    vetoType: 'RR_VETO',
    vetoReason: 'Giá cách hỗ trợ (1941.5) chỉ 0.5 điểm — R:R < 1:1 → Chờ giá hồi lên kháng cự rồi Short.',
    layerSummaries: {
      structure: 'Nghiêng Bán (Giá dưới, cản trên đè)',
      flow: 'Phe Bán chiếm ưu thế / CVD dốc xuống',
      breadth: 'Đồng thuận Giảm (28 đỏ / 2 xanh)',
      regime: 'BẪY VƯỢT ĐỈNH THẤT BẠI → Xu hướng GIẢM (Phe Bán kiểm soát)',
    }
  },
  priceMap: {
    currentPrice: 1947,
    todayRange: { low: 1941.5, high: 1965.4 },
    levels: [
      { price: 1965.4, type: 'RESISTANCE', label: 'Đỉnh hôm nay' },
      { price: 1957.0, type: 'SUPPORT', label: 'Đáy ngày trước' },
      { price: 1952.0, type: 'POC', label: 'Vùng khớp nhiều nhất (POC)' },
      { price: 1947.7, type: 'SUPPORT', label: 'Đáy ngắn hạn' },
      { price: 1945.0, type: 'VAL', label: 'Hỗ trợ dưới vùng giá trị (VAL)' },
    ]
  },
  flowResult: {
    cvd: { direction: 'FALLING' }
  },
  supplyDemandResult: sdResult,
  basisResult: {
    f1mPrice: 1947.0,
    vn30Price: 1940.7,
    current: 6.3,
  },
  liquidityResult: {
    totalValue: 7935.8,
    volumeRatio: 1.36,
  },
  breadthResult: {
    greenCount: 2,
    redCount: 28,
    bank: { label: 'THẤP', greenCount: 0, totalCount: 8 },
  },
  velocityResult: {
    label: 'Bình thường',
  },
  efficiencyResult: {
    label: 'Nhiễu nhiều (Giằng co)',
    actionAdvice: '⚠️ Đứng ngoài hoặc đánh ngắn, chốt lời nhanh',
  },
  regimeResult: {
    regime: 'TRAP_THEN_TREND',
    description: 'BẪY VƯỢT ĐỈNH THẤT BẠI → Xu hướng GIẢM (Phe Bán kiểm soát)',
  },
  targetMap: null,
  allData: {
    vnindexPrice: { price: 1798.47, prevPrice: 1798.3 },
    oiData: {
      foreignBuy: 5747,
      foreignSell: 7938,
      foreignNet: -2191,
      totalOI: 35352,
      totalOIChange: -1549,
    }
  }
};

const mockDeltaData = {
  timeDiffMin: 7,
  liqDelta: { vn30Delta: 575.2 },
  oiDelta: {
    deltaOI: 0,
    deltaVol: 8742,
    totalOI: 35352,
    positionState: 'NEUTRAL',
    priceDelta: 2.7,
  },
  vn30Deltas: {
    buyers: [
      { sym: 'VIC', deltaVal: 91.0 },
      { sym: 'SSI', deltaVal: 53.7 },
      { sym: 'VHM', deltaVal: 40.8 },
      { sym: 'VPB', deltaVal: 39.5 },
      { sym: 'HPG', deltaVal: 38.1 },
    ],
    sellers: [],
  },
  positionDelta: {
    foreignBuyDelta: 120,
    foreignSellDelta: 470,
    foreignNetDelta: -350,
    tuDoanhNetDelta: 0,
    crowdNetDelta: 350,
    oiDelta: 200,
  },
  currentPosition: {
    foreignBuy: 5747,
    foreignSell: 7938,
    foreignNet: -2191,
    tuDoanhBuy: 0,
    tuDoanhSell: 0,
    tuDoanhNet: 0,
    crowdNet: 2191,
    totalOI: 35352,
    oiChange: -1549,
  }
};

const notiMsg = buildSignalNotification('update', mockAnalysisStandby, mockDeltaData);
console.log('\n--- KẾT QUẢ RENDER THÔNG BÁO TELEGRAM (HTML) ---');
console.log(notiMsg);

// ─── 4. TEST NOTIFICATION MẪU v4.3 (CÓ TÍN HIỆU VÀO LỆNH SHORT) ───
console.log('\n[4] Kiểm tra Build Notification khi có LỆNH SHORT...');
const mockAnalysisShort = {
  ...mockAnalysisStandby,
  scoreResult: {
    direction: 'SHORT',
    confidence: 82,
    setupQuality: 'A+',
    risk: 'THẤP',
    layerSummaries: {
      structure: 'Nghiêng Bán (Giá dưới VWAP, cản trên 1965.4 đè)',
      flow: 'Phe Bán xả hàng liên tục / 5m râu trên dài',
      breadth: 'Đồng thuận Giảm (28 đỏ / 2 xanh)',
      regime: 'BẪY VƯỢT ĐỈNH THẤT BẠI → Xu hướng GIẢM (Phe Bán kiểm soát)',
    }
  },
  targetMap: {
    entry: { zone: [1955.0, 1958.0], reason: 'Vùng kháng cự test lại' },
    targets: [
      { price: 1945.0, type: 'TP1', reason: 'Vùng hỗ trợ VAL' },
      { price: 1938.0, type: 'TP2', reason: 'Đáy phiên trước' },
    ],
    hardStop: 3.0,
  }
};

const shortNotiMsg = buildSignalNotification('update', mockAnalysisShort, mockDeltaData);
console.log('\n--- KẾT QUẢ RENDER LỆNH SHORT ---');
console.log(shortNotiMsg);

console.log('\n✅ ALL TESTS COMPLETED SUCCESSFULLY!');
