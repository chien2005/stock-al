require('dotenv').config();
const { sendDerivativesMessage } = require('../src/telegramService');

async function broadcastPlan() {
  const msg = [
    '🔮 <b>[KẾ HOẠCH PHÁI SINH 03/09/2026] VN30F1M TRƯỚC GIỜ G</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '📊 <b>1. SỐ LIỆU VỊ THẾ QUA ĐÊM (KẾT PHIÊN 28/08):</b>',
    '• <b>Tổng OI lưu qua kỳ nghỉ:</b> 29.092 HĐ (-4.560 HĐ so với 27/08 do đóng bớt phòng hộ nghỉ 4 ngày)',
    '• <b>Khối ngoại phiên 28/08:</b> Giữ qua đêm +522 HĐ Long',
    '• <b>Lũy kế F2609 khối ngoại:</b> Đang nắm vị thế <b>SHORT ròng -5.010 HĐ</b>',
    '• <b>Điểm số đóng cửa 28/08:</b> F1M: 1.981,5 | VN30: 1.982,96 | Basis: -1,46 điểm',
    '',
    '🌍 <b>2. BIẾN ĐỘNG VĨ MÔ THẾ GIỚI TRONG KỲ LỄ (1-2/9):</b>',
    '• Chứng khoán Mỹ giảm sâu: Dow Jones -419đ (-0,79%), Nasdaq -1,03%',
    '• Căng thẳng quân sự Mỹ - Iran leo thang, dầu thô WTI/Brent vọt > 90-95 USD/thùng',
    '• Lợi suất trái phiếu tăng cao, tâm lý toàn cầu chuyển sang Risk-Off',
    '',
    '🎯 <b>3. KẾ HOẠCH HÀNH ĐỘNG PHIÊN 03/09:</b>',
    '👉 <b>ĐỊNH HƯỚNG DỨT KHOÁT: 🔴 SHORT</b>',
    '• <b>Entry:</b> Vùng 1.978 - 1.982 điểm (Chờ nhịp hồi kỹ thuật sau ATO)',
    '• <b>TP1:</b> 1.970 điểm | <b>TP2:</b> 1.962 điểm | <b>TP3:</b> 1.954 điểm',
    '• <b>Stop Loss:</b> 1.986,5 điểm (vượt cản trên)',
    '• <b>Độ tự tin:</b> 85%',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '⚠️ <i>Chiến thuật: ATO dễ mở Gap Down, KHÔNG đu Short giá thấp lúc 9h00-9h15. Canh nhịp kéo hồi lấp Gap (9h20-9h45) để vào vị thế Short với vị thế tối ưu!</i>'
  ].join('\n');

  console.log('Sending message to Telegram...');
  const sent = await sendDerivativesMessage(msg);
  console.log('Broadcast status:', sent);
}

broadcastPlan();
