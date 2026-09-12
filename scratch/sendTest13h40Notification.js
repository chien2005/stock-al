/**
 * Script bắn test tin giả lập lúc 13h40 chiều hôm qua (11/09/2026)
 * Kiểm tra hiển thị thực tế trên Telegram theo định dạng v4.3
 */

const { buildSignalNotification } = require('../src/derivatives/notificationBuilder');
const { sendDerivativesMessage } = require('../src/telegramService');

async function sendTest13h40() {
  console.log('🚀 Đang chuẩn bị bản tin test giả lập 13h40 chiều 11/09/2026 (v4.3)...');

  const mockAnalysis = {
    scoreResult: {
      direction: 'NO_TRADE',
      confidence: 0,
      setupQuality: 'N/A',
      risk: 'VỪA PHẢI',
      vetoType: 'RR_VETO',
      vetoReason: 'Giá cách hỗ trợ (1945.0) chỉ 2.0 điểm — R:R &lt; 1:1 → Chờ giá hồi lên kháng cự (1952 - 1955) rồi Short.',
      layerSummaries: {
        structure: 'Nghiêng Bán (Giá dưới VWAP 1952, cản 1965.4 đè)',
        flow: 'Phe Bán chiếm ưu thế / CVD dốc xuống',
        breadth: 'Đồng thuận Giảm (28 đỏ / 2 xanh)',
        regime: 'BẪY VƯỢT ĐỈNH THẤT BẠI → Xu hướng GIẢM (Phe Bán kiểm soát)',
      }
    },
    priceMap: {
      currentPrice: 1947.0,
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
    supplyDemandResult: {
      consensus: 'BEARISH',
      summaryText: '🔴 Cung đè chiếm ưu thế (5m râu trên xả hàng 83%), áp lực bán đè',
      exhaustion: null,
      rejection: 'UPPER_REJECTION',
    },
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
      positionState: 'SHORT_BUILDUP',
      priceDelta: -3.0,
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
      crowdBuy: 154253,
      crowdSell: 152062,
      totalOI: 35352,
      oiChange: -1549,
    }
  };

  // Build message v4.3
  let msg = buildSignalNotification('update', mockAnalysis, mockDeltaData);

  // Đổi timestamp hiển thị thành 13:40:22 11/09/2026 cho đúng ngữ cảnh test
  msg = msg.replace(/🕐 <i>.*<\/i>/, '🕐 <i>13:40:22 11/09/2026 (Mô phỏng Test v4.3)</i>');

  console.log('\n--- NỘI DUNG MESSAGE GỬI TELEGRAM ---');
  console.log(msg);

  const sent = await sendDerivativesMessage(msg);
  if (sent) {
    console.log('\n✅ BẮN TEST THÀNH CÔNG ĐẾN TELEGRAM!');
  } else {
    console.error('\n❌ BẮN TEST THẤT BẠI!');
  }
}

sendTest13h40();
