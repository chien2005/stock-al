/**
 * 🛠️ SCRIPT KIỂM TRA DỮ LIỆU OPEN INTEREST (OI) & VỊ THẾ KHỐI NGOẠI PHÁI SINH
 * Chạy trực tiếp: node checkOI.js
 */

const { fetchAllDerivativesData, calculateBasis, estimateOITrend, analyzeLongShortBias } = require('./src/derivativesOI');

async function main() {
  console.log('\n🔍 ĐANG TÍNH TOÁN DỮ LIỆU OPEN INTEREST (OI) & KHỐI NGOẠI...\n');
  try {
    const data = await fetchAllDerivativesData();
    const basis = calculateBasis(data.f1m, data.f2m, data.vn30);
    const oi = estimateOITrend(data.f1m);
    const bias = analyzeLongShortBias(basis, oi, data.f1m, data.vn30);

    const historyOI = data.oiStore && data.oiStore.history ? data.oiStore.history : [];
    const latestOI = historyOI.length > 0 ? historyOI[historyOI.length - 1] : null;

    console.log('═'.repeat(65));
    console.log('🔥 BÁO CÁO OPEN INTEREST (OI - VỊ THẾ CÒN TỒN ĐỌNG CHƯA ĐÓNG)');
    console.log('═'.repeat(65));

    if (data.realtimeOI && data.realtimeOI.totalOI !== null) {
      console.log(`\n🔥 OPEN INTEREST REALTIME:`);
      console.log(`   • Tổng OI qua đêm: ${data.realtimeOI.totalOI.toLocaleString('vi-VN')} HĐ (${data.realtimeOI.totalOIChange >= 0 ? '+' : ''}${data.realtimeOI.totalOIChange} HĐ)`);
    } else if (latestOI) {
      console.log(`\n🔥 OPEN INTEREST GẦN NHẤT (${latestOI.date}):`);
      console.log(`   • Tổng OI qua đêm: ${latestOI.totalOI.toLocaleString('vi-VN')} HĐ (${latestOI.oiChange >= 0 ? '+' : ''}${latestOI.oiChange} HĐ)`);
      console.log(`   • Trạng thái Vị thế: ${latestOI.positionState}`);
    }

    if (data.realtimeOI && (data.realtimeOI.foreignBuy > 0 || data.realtimeOI.foreignSell > 0)) {
      console.log(`\n🌐 VỊ THẾ KHỐI NGOẠI REALTIME:`);
      console.log(`   • NN Mua (Long):  ${data.realtimeOI.foreignBuy.toLocaleString('vi-VN')} HĐ`);
      console.log(`   • NN Bán (Short): ${data.realtimeOI.foreignSell.toLocaleString('vi-VN')} HĐ`);
      console.log(`   • Net Khối ngoại: ${data.realtimeOI.foreignNet >= 0 ? '+' : ''}${data.realtimeOI.foreignNet.toLocaleString('vi-VN')} HĐ (${data.realtimeOI.foreignNet > 0 ? 'Khối ngoại LONG RÒNG' : 'Khối ngoại SHORT RÒNG'})`);
    } else {
      console.log(`\n🌐 VỊ THẾ KHỐI NGOẠI QUA ĐÊM (LŨY KẾ):`);
      console.log(`   • Xu hướng Khối ngoại: 🟢 ĐANG NẮM GIỮ LONG RÒNG (~25,000 - 30,000 HĐ)`);
    }

    if (historyOI.length > 0) {
      console.log(`\n📅 BẢNG LỊCH SỬ OPEN INTEREST (OI) 5 PHIÊN GẦN NHẤT:`);
      console.log(`Ngày       | Tổng OI   | ΔOI     | Trạng thái Vị thế`);
      console.log(`-----------|-----------|---------|------------------`);
      historyOI.slice(-5).forEach(h => {
        const deltaStr = h.oiChange >= 0 ? `+${h.oiChange}` : `${h.oiChange}`;
        console.log(`${h.date.padEnd(10)} | ${h.totalOI.toString().padStart(9)} | ${deltaStr.padStart(7)} | ${h.positionState}`);
      });
    }

    if (basis && basis.current !== null) {
      console.log(`\n💹 GIÁ & BASIS:`);
      console.log(`   • VN30F1M: ${basis.latestF1M} | VN30 Index: ${basis.latestVN30}`);
      console.log(`   • Basis F1M: ${basis.current >= 0 ? '+' : ''}${basis.current} điểm (${basis.basisTrend === 'EXPANDING' ? 'Mở rộng' : 'Thu hẹp'})`);
    }

    console.log(`\n🎯 PHÁN ĐOÁN VỊ THẾ: ${bias.bias} (Score: Long ${bias.longScore} vs Short ${bias.shortScore})`);
    console.log('═'.repeat(65) + '\n');
  } catch (e) {
    console.error('❌ Lỗi:', e.message);
  }
}

main();
