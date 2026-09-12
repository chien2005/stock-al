/**
 * 🧪 TEST: OI Overnight Position Estimator
 * Chạy: node scratch/testOvernightEstimator.js
 * 
 * Backtest dữ liệu 26/8 → 11/9/2026 từ foreign_oi.json + oi_history.json
 * Kiểm tra xem module ước lượng có cho ra kết quả hợp lý không
 */

const path = require('path');
const fs = require('fs');

// Load estimator module
const oiEstimator = require('../src/derivatives/oiEstimator');

// Load raw data
const foreignOI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'foreign_oi.json'), 'utf8'));
const oiHistory = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'oi_history.json'), 'utf8'));

console.log('═'.repeat(80));
console.log('🧪 TEST: OI Overnight Position Estimator — Backtest 26/8 → 11/9/2026');
console.log('═'.repeat(80));

// Merge data theo ngày
function normDate(d) {
  const parts = d.split('/');
  return `${parseInt(parts[0])}/${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

const mergedHistory = foreignOI.history.map(f => {
  const normF = normDate(f.date);
  const oiItem = oiHistory.history.find(o => normDate(o.date) === normF);
  
  return {
    date: f.date,
    buy: f.buy || 0,
    sell: f.sell || 0,
    overnightNet: f.overnightNet || 0,
    tuDoanhOvernight: f.tuDoanhOvernight || 0,
    oiChange: oiItem ? oiItem.oiChange : 0,
    totalOI: oiItem ? oiItem.totalOI : 0,
    f1mPrice: oiItem ? oiItem.f1mPrice : 0,
    volume: oiItem ? oiItem.volume : 0,
  };
});

console.log(`\n📊 Dữ liệu đầu vào: ${mergedHistory.length} phiên\n`);

// ─── TEST 1: Classify từng phiên ─────────────────────────────────
console.log('┌─────────────────────────────────────────────────────────────────────────────────────┐');
console.log('│ TEST 1: Classify hành vi giao dịch NN từng phiên                                   │');
console.log('├──────────┬──────────┬──────────┬───────┬──────────────────────────────────┬─────────┤');
console.log('│ Ngày     │ NN Net   │ ΔOI      │ OI    │ Hành vi                          │ Conf %  │');
console.log('├──────────┼──────────┼──────────┼───────┼──────────────────────────────────┼─────────┤');

mergedHistory.forEach(s => {
  const action = oiEstimator.classifyTradeAction(s.oiChange, s.overnightNet, s.volume);
  const dateStr = s.date.padEnd(8);
  const netStr = (s.overnightNet >= 0 ? `+${s.overnightNet}` : `${s.overnightNet}`).padStart(8);
  const oiStr = (s.oiChange >= 0 ? `+${s.oiChange}` : `${s.oiChange}`).padStart(8);
  const totalOIStr = s.totalOI ? s.totalOI.toString().padStart(5) : '    ?';
  const actionStr = action.action.padEnd(32);
  const confStr = `${action.confidence}%`.padStart(7);
  
  console.log(`│ ${dateStr} │ ${netStr} │ ${oiStr} │ ${totalOIStr} │ ${actionStr} │ ${confStr} │`);
});

console.log('└──────────┴──────────┴──────────┴───────┴──────────────────────────────────┴─────────┘');

// ─── TEST 2: Estimate Cumulative Positions ───────────────────────
console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────────┐');
console.log('│ TEST 2: Vị thế lũy kế qua đêm ước lượng (baseline = 0 từ 26/8)                       │');
console.log('├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────────────────┤');
console.log('│ Ngày     │ NN Net   │ ΔOI      │ NN Δ     │ NN Lũy   │ Crowd    │ Hành vi              │');
console.log('│          │ (phiên)  │ (sàn)    │ (ước)    │ kế(ước)  │ Lũy kế   │                      │');
console.log('├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────────────────┤');

const estimated = oiEstimator.estimateCumulativePositions(mergedHistory);

estimated.forEach(s => {
  const dateStr = s.date.padEnd(8);
  const netStr = (s.overnightNet >= 0 ? `+${s.overnightNet}` : `${s.overnightNet}`).padStart(8);
  const oiStr = (s.oiChange >= 0 ? `+${s.oiChange}` : `${s.oiChange}`).padStart(8);
  const deltaStr = (s.nnPositionDelta >= 0 ? `+${s.nnPositionDelta}` : `${s.nnPositionDelta}`).padStart(8);
  const cumStr = (s.cumulativeNN >= 0 ? `+${s.cumulativeNN}` : `${s.cumulativeNN}`).padStart(8);
  const crowdStr = (s.cumulativeCrowd >= 0 ? `+${s.cumulativeCrowd}` : `${s.cumulativeCrowd}`).padStart(8);
  const actionStr = s.nnAction.action.padEnd(20);
  
  console.log(`│ ${dateStr} │ ${netStr} │ ${oiStr} │ ${deltaStr} │ ${cumStr} │ ${crowdStr} │ ${actionStr} │`);
});

console.log('└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────────────────┘');

// ─── TEST 3: Latest Report (ngày 11/9/2026) ─────────────────────
console.log('\n═'.repeat(80));
console.log('🔍 TEST 3: Báo cáo phiên gần nhất (11/9/2026)');
console.log('═'.repeat(80));

const report = oiEstimator.generateLatestReport(mergedHistory);

if (report) {
  console.log(`\n📅 Ngày: ${report.date}`);
  console.log(`\n🌐 KHỐI NGOẠI:`);
  console.log(`   Net phiên: ${report.nnSessionNet} HĐ`);
  console.log(`   ΔOI sàn:   ${report.deltaOI} HĐ`);
  console.log(`   Hành vi:   ${report.nnAction.action} (Confidence: ${report.nnAction.confidence}%)`);
  console.log(`   Chi tiết:  ${report.nnAction.description}`);
  
  console.log(`\n📊 VỊ THẾ LŨY KẾ ƯỚC LƯỢNG:`);
  console.log(`   NN:        ${report.nnLabel} (${report.nnCumulative} HĐ)`);
  console.log(`   Tự doanh:  ${report.tdLabel} (${report.tdCumulative} HĐ)`);
  console.log(`   Đám đông:  ${report.crowdLabel} (${report.crowdCumulative} HĐ)`);
  
  console.log(`\n📈 THAY ĐỔI PHIÊN NAY:`);
  console.log(`   NN vị thế trước: ${report.prevNN} → sau: ${report.nnCumulative} (Δ=${report.nnDelta})`);
  
  // Test message builder
  console.log(`\n📱 TELEGRAM MESSAGE PREVIEW:`);
  console.log('─'.repeat(60));
  const telegramMsg = oiEstimator.buildEstimatedPositionMessage(report);
  // Strip HTML tags for console
  const cleanMsg = telegramMsg
    .replace(/<b>/g, '**').replace(/<\/b>/g, '**')
    .replace(/<i>/g, '_').replace(/<\/i>/g, '_')
    .replace(/<code>/g, '`').replace(/<\/code>/g, '`')
    .replace(/\\n/g, '\n');
  console.log(cleanMsg);
  console.log('─'.repeat(60));
}

// ─── TEST 4: Verify ngày 11/9 cụ thể (Dữ liệu thực tế HNX) ───────
console.log('\n═'.repeat(80));
console.log('🎯 TEST 4: Verify logic ngày 11/9/2026 (Dữ liệu thực tế HNX)');
console.log('═'.repeat(80));
console.log(`
  Dữ kiện thực tế từ HNX:
  - NN Mua: 6,050 HĐ | NN Bán: 9,094 HĐ → Net phiên = -3,044 HĐ
  - ΔOI sàn: -1,549 HĐ (OI thực tế HNX giảm: 35,352 → 33,803)
  - F1M: 1,940 (giảm -35.5đ)
  
  Suy luận:
  - ΔOI < 0 (OI GIẢM -1.549) + NN Net < 0 (BÁN RÒNG -3.044) → NN ĐÓNG LONG (thanh lý Long cũ) ✅
  - OI giảm 1,549 = có 1,549 HĐ bị hủy hoàn toàn trên toàn sàn (đóng vị thế)
  - NN bán ròng 3,044 HĐ → NN đóng ít nhất 1,549 HĐ Long cũ, và chuyển nhượng phần còn lại
  - → Hành vi NN: CLOSE_LONG (Confidence: 85%)
`);

const sept11Action = oiEstimator.classifyTradeAction(-1549, -3044, 221675);
console.log('Kết quả module:');
console.log(`  Action:      ${sept11Action.action}`);
console.log(`  Confidence:  ${sept11Action.confidence}%`);
console.log(`  Description: ${sept11Action.description}`);
console.log(`  Is New Pos:  ${sept11Action.isNewPosition}`);

const expectedAction = 'CLOSE_LONG';
const isCorrect = sept11Action.action === expectedAction;
console.log(`\n${isCorrect ? '✅ PASS' : '❌ FAIL'}: Expected ${expectedAction}, Got ${sept11Action.action}`);

console.log('\n' + '═'.repeat(80));
console.log('✅ All tests completed!');
console.log('═'.repeat(80));
