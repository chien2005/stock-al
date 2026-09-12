const augDays = [
  { from: '30/7/2026', to: '31/7/2026', nnSide: 'LONG', nnNet: 1700, closeT: 1884.8, openT1: 1893.0, highT1: 1897.7, lowT1: 1866.0, closeT1: 1875.0 },
  { from: '31/7/2026', to: '03/8/2026', nnSide: 'LONG', nnNet: 1900, closeT: 1875.0, openT1: 1883.0, highT1: 1925.0, lowT1: 1881.9, closeT1: 1914.0 },
  { from: '03/8/2026', to: '04/8/2026', nnSide: 'LONG', nnNet: 1700, closeT: 1914.0, openT1: 1918.0, highT1: 1926.0, lowT1: 1911.0, closeT1: 1925.0 },
  { from: '04/8/2026', to: '05/8/2026', nnSide: 'LONG', nnNet: 800,  closeT: 1925.0, openT1: 1934.0, highT1: 1942.0, lowT1: 1907.4, closeT1: 1913.8 },
  { from: '05/8/2026', to: '06/8/2026', nnSide: 'SHORT', nnNet: -600, closeT: 1913.8, openT1: 1913.8, highT1: 1922.0, lowT1: 1894.8, closeT1: 1896.0 },
];

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('📊 THỐNG KÊ HỢP ĐỒNG THÁNG 8 (MẪU DỮ LIỆU ĐỐI SOÁT):');
console.log('═══════════════════════════════════════════════════════════════════════════════');
let atoWins = 0;
let maxProfitWins = 0;
let closeWins = 0;

augDays.forEach((d, idx) => {
  const isShort = d.nnSide === 'SHORT';
  const gap = parseFloat((d.openT1 - d.closeT).toFixed(1));
  const maxProfit = parseFloat((isShort ? (d.closeT - d.lowT1) : (d.highT1 - d.closeT)).toFixed(1));
  const closeProfit = parseFloat((isShort ? (d.closeT - d.closeT1) : (d.closeT1 - d.closeT)).toFixed(1));

  const gapWon = isShort ? gap < 0 : gap > 0;
  const maxWon = maxProfit >= 4.0;
  const closeWon = closeProfit > 0;

  if (gapWon) atoWins++;
  if (maxWon) maxProfitWins++;
  if (closeWon) closeWins++;

  console.log(`[Phiên ${idx + 1}] Cầm đêm ${d.from} ➔ Kết quả ${d.to}:`);
  console.log(`   Khối ngoại găm: ${d.nnSide} (${d.nnNet > 0 ? '+' : ''}${d.nnNet} HĐ) | Giá đóng đêm: ${d.closeT}`);
  console.log(`   🌅 Mở cửa ATO 9h00:   ${d.openT1} (Gap ${gap > 0 ? '+' : ''}${gap}đ) ➔ ${gapWon ? '🟢 ĂN TRỌN GAP ATO' : '🔴 XỊT GAP'}`);
  console.log(`   🎯 Đỉnh lãi cao nhất: +${maxProfit}đ ➔ ${maxWon ? '🟢 CÓ CỬA CHỐT LỜI CỰC ĐẬM' : '🔴 KHÔNG CÓ CỬA'}`);
  console.log(`   🏁 Chốt phiên 14h45:  ${d.closeT1} (Lãi/Lỗ: ${closeProfit > 0 ? '+' : ''}${closeProfit}đ) ➔ ${closeWon ? '🟢 THẮNG ATC' : '🔴 THUA ATC'}`);
  console.log('');
});

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log(`TỔNG KẾT MẪU THÁNG 8 (${augDays.length} phiên):`);
console.log(`- Tỷ lệ ăn Gap ATO ngay mở cửa: ${atoWins}/${augDays.length} (${((atoWins/augDays.length)*100).toFixed(1)}%)`);
console.log(`- Tỷ lệ có cửa chốt lời cực đậm (Lãi đỉnh >= 4.0đ): ${maxProfitWins}/${augDays.length} (${((maxProfitWins/augDays.length)*100).toFixed(1)}%)`);
console.log(`- Tỷ lệ giữ đến hết phiên ATC vẫn thắng: ${closeWins}/${augDays.length} (${((closeWins/augDays.length)*100).toFixed(1)}%)`);
console.log('═══════════════════════════════════════════════════════════════════════════════');
