const fs = require('fs');
const oiHist = JSON.parse(fs.readFileSync('data/oi_history.json')).history;
const fOi = JSON.parse(fs.readFileSync('data/foreign_oi.json')).history;
const df = require('../src/derivatives/dataFetcher');

(async () => {
  const ohlcv = await df.fetchOHLCV('VN30F1M', 'D', 35);
  const ohlcMap = {};
  for (let i = 0; i < ohlcv.t.length; i++) {
    const d = new Date(ohlcv.t[i] * 1000);
    const dStr = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    ohlcMap[dStr] = { open: ohlcv.o[i], close: ohlcv.c[i], high: ohlcv.h[i], low: ohlcv.l[i] };
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('📊 PHÂN TÍCH: KHỐI NGOẠI CẦM ĐÊM CÓ CỬA CHỐT LỜI SỚM (ATO / SÁNG HÔM SAU)?');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  let nnProfitableWindow = 0;
  let nnAtoWinCount = 0;
  let total = fOi.length - 1;

  for (let i = 0; i < total; i++) {
    const curr = fOi[i];
    const next = fOi[i+1];
    const nextOHLC = ohlcMap[next.date];
    const currClose = ohlcMap[curr.date].close;

    const isShort = curr.overnightNet < 0;
    const side = isShort ? 'SHORT' : 'LONG';
    const maxProfit = isShort ? (currClose - nextOHLC.low) : (nextOHLC.high - currClose);
    const atoProfit = isShort ? (currClose - nextOHLC.open) : (nextOHLC.open - currClose);
    const closeProfit = isShort ? (currClose - nextOHLC.close) : (nextOHLC.close - currClose);

    const hadProfit = maxProfit >= 4.0; // có cửa ăn >= 4 điểm trong phiên
    if (hadProfit) nnProfitableWindow++;
    if (atoProfit > 0) nnAtoWinCount++;

    console.log(`\n[Phiên ${i+1}] ${curr.date} -> ${next.date}: NN ${side} (${curr.overnightNet} HĐ) | Giá đóng đêm: ${currClose}`);
    console.log(`   🌅 Ngay ATO 9h00:    ${atoProfit > 0 ? '+' : ''}${atoProfit.toFixed(1)}đ ${atoProfit > 0 ? '🟢 (Ăn Gap)' : '🔴 (Lỗ Gap)'}`);
    console.log(`   🎯 Đỉnh lời cao nhất: +${maxProfit.toFixed(1)}đ ${hadProfit ? '🟢 (CÓ CỬA CHỐT LỜI CỰC ĐẬM)' : '🔴 (Kẹt)'}`);
    console.log(`   🏁 Chốt phiên 14h45:  ${closeProfit > 0 ? '+' : ''}${closeProfit.toFixed(1)}đ`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('🏆 KẾT QUẢ PHÂN TÍCH CHI TIẾT:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`1. Tỷ lệ ăn ngay mở cửa ATO (9h00): ${nnAtoWinCount}/${total} (${((nnAtoWinCount/total)*100).toFixed(1)}%)`);
  console.log(`2. Tỷ lệ có khung giờ chốt lời ngon (Lãi đỉnh >= 4.0đ trong ngày): ${nnProfitableWindow}/${total} (${((nnProfitableWindow/total)*100).toFixed(1)}%)`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
})();
