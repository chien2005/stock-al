const fs = require('fs');
const oiHist = JSON.parse(fs.readFileSync('data/oi_history.json')).history;
const fOi = JSON.parse(fs.readFileSync('data/foreign_oi.json')).history;

const days = [];
for (let i = 0; i < fOi.length; i++) {
  const f = fOi[i];
  const o = oiHist.find(h => h.date === f.date);
  if (o) {
    let td = f.tuDoanhOvernight;
    if (!td && f.overnightNet) {
      td = Math.round(-f.overnightNet * 0.35);
    }
    const crowd = -(f.overnightNet + td);
    days.push({
      date: f.date,
      nnNet: f.overnightNet,
      tdNet: td,
      crowdNet: crowd,
      f1mPrice: o.f1mPrice
    });
  }
}

let nnWins = 0, tdWins = 0, crowdWins = 0;
const results = [];

for (let i = 0; i < days.length - 1; i++) {
  const current = days[i];
  const next = days[i + 1];
  const priceChange = parseFloat((next.f1mPrice - current.f1mPrice).toFixed(1));
  const marketDirection = priceChange > 0 ? 'TĂNG (LONG ĂN)' : priceChange < 0 ? 'GIẢM (SHORT ĂN)' : 'ĐI NGANG (0đ)';

  const nnSide = current.nnNet > 0 ? 'LONG' : current.nnNet < 0 ? 'SHORT' : 'FLAT';
  const tdSide = current.tdNet > 0 ? 'LONG' : current.tdNet < 0 ? 'SHORT' : 'FLAT';
  const crowdSide = current.crowdNet > 0 ? 'LONG' : current.crowdNet < 0 ? 'SHORT' : 'FLAT';

  const nnWin = (priceChange > 0 && nnSide === 'LONG') || (priceChange < 0 && nnSide === 'SHORT');
  const tdWin = (priceChange > 0 && tdSide === 'LONG') || (priceChange < 0 && tdSide === 'SHORT');
  const crowdWin = (priceChange > 0 && crowdSide === 'LONG') || (priceChange < 0 && crowdSide === 'SHORT');

  if (nnWin) nnWins++;
  if (tdWin) tdWins++;
  if (crowdWin) crowdWins++;

  results.push({
    from: current.date,
    to: next.date,
    currentPrice: current.f1mPrice,
    nextPrice: next.f1mPrice,
    change: priceChange,
    marketDirection,
    nn: { net: current.nnNet, side: nnSide, win: nnWin },
    td: { net: current.tdNet, side: tdSide, win: tdWin },
    crowd: { net: current.crowdNet, side: crowdSide, win: crowdWin }
  });
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('📊 THỐNG KÊ CHI TIẾT TỪNG PHIÊN GĂM HĐ QUA ĐÊM (26/8 -> 11/9):');
console.log('═══════════════════════════════════════════════════════════════════════════════');
results.forEach((r, idx) => {
  const sign = r.change > 0 ? '+' : '';
  console.log(`\n[Phiên ${idx + 1}] Cầm đêm ${r.from} ➔ Kết quả ${r.to}:`);
  console.log(`   Giá F1M: ${r.currentPrice} ➔ ${r.nextPrice} (${sign}${r.change}đ) | ${r.marketDirection}`);
  console.log(`   🌐 Khối ngoại  (${r.nn.side.padEnd(5)} ${String(r.nn.net).padStart(6)} HĐ): ${r.nn.win ? '🟢 THẮNG (ĂN)' : '🔴 THUA (XỊT)'}`);
  console.log(`   🏛️ Tự doanh    (${r.td.side.padEnd(5)} ${String(r.td.net).padStart(6)} HĐ): ${r.td.win ? '🟢 THẮNG (ĂN)' : '🔴 THUA (XỊT)'}`);
  console.log(`   👥 Đám đông    (${r.crowd.side.padEnd(5)} ${String(r.crowd.net).padStart(6)} HĐ): ${r.crowd.win ? '🟢 THẮNG (ĂN)' : '🔴 THUA (XỊT)'}`);
});

console.log('\n═══════════════════════════════════════════════════════════════════════════════');
console.log('🏆 TỔNG KẾT TỶ LỆ THẮNG (WIN RATE) CẦM QUA ĐÊM:');
console.log('═══════════════════════════════════════════════════════════════════════════════');
const total = results.length;
console.log(`Tổng số cặp phiên khảo sát: ${total} phiên`);
console.log(`🌐 KHỐI NGOẠI:  ${nnWins}/${total} phiên thắng  ➔  TỶ LỆ ĂN: ${((nnWins/total)*100).toFixed(1)}%`);
console.log(`🏛️ TỰ DOANH:    ${tdWins}/${total} phiên thắng  ➔  TỶ LỆ ĂN: ${((tdWins/total)*100).toFixed(1)}%`);
console.log(`👥 ĐÁM ĐÔNG:    ${crowdWins}/${total} phiên thắng  ➔  TỶ LỆ ĂN: ${((crowdWins/total)*100).toFixed(1)}%`);
console.log('═══════════════════════════════════════════════════════════════════════════════');
