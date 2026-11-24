/**
 * Kịch bản gửi bài toán chiến lược & code sang Claude Opus 5.5
 */
const fs = require('fs');
require('dotenv').config();
const OpenAI = require('openai');

const apiKey = process.env.CLAUDE_API_KEY;
const baseURL = process.env.CLAUDE_BASE_URL || 'https://api.miraiapi.com/v1';
const model = process.env.CLAUDE_MODEL || 'ccmax-claude-opus-5.5';

const client = new OpenAI({
  apiKey: apiKey,
  baseURL: baseURL,
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
  }
});

const OPUS_SYSTEM_PROMPT = `Bạn là Senior Quantitative Trading Engineer kiêm Lead Architect cho quỹ phái sinh VN30F Việt Nam.
Tư duy: Lạnh lùng, không cảm xúc, thực dụng, bảo vệ vốn là trên hết, kiếm tiền thực chiến ("kiếm cơm, không phải kiếm bài học").
Bạn nắm rõ cấu trúc thị trường VN30F: lái hay tạo bẫy nổ vol 1k-3k HĐ, bẫy breakout, các nhịp quét thanh khoản (Liquidity Sweep) và bẫy rũ bỏ (Spring/Upthrust).`;

const OPUS_USER_PROMPT = `
Chào Claude Opus, đây là bài toán chiến lược cấp cao cần bạn phân tích và code hoàn thiện cho hệ thống AI Trading VN30F:

1. BỐI CẢNH & VẤN ĐỀ THỰC CHIẾN:
- Đội ngũ đã có bot đọc cung cầu hiệu quả, nhưng các phiên đánh đúng kỹ thuật chỉ chiếm 40-50%.
- Phân tích 4 phương pháp của broker trên thị trường:
  + PP1: Fade đầu ngày (bắt đỉnh sớm): ăn trọn biên độ lớn nếu đúng, nhưng gặp ngày "Big Long" chủ quan tiếp tục short là chết cháy tài khoản.
  + PP2: Đánh Breakout thuần túy: Tỷ lệ ăn chỉ 30%. Lái hay bơm nổ vol giả 1k - 3k HĐ dụ retail đu Long đỉnh / Short đáy rồi đạp ngược quét sạch SL.
  + PP3: Đánh Cung Cầu + Retest (ăn khúc giữa): Tỷ lệ thắng 60-80% lúc chuẩn, nhưng 30-40% dính bull trap hoặc đạp không thủng kéo ngược chữ V, khiến bán đúng đáy mua đúng đỉnh.
  + PP4: Sát thủ M1 (Bắt đảo chiều cực trị Pin bar / Climax): Rút râu dưới dài chuyển xanh ở đáy quá bán -> Long; Quá mua rút râu trên đỏ -> Short. R:R cực cao nhưng đòi hỏi kỷ luật thép, nếu tâm lý nôn nóng sau lệnh lỗ rất dễ đu phải râu giả ở lưng chừng sóng.

2. YÊU CẦU ĐỐI VỚI BẠN (CLAUDE OPUS):
- Phát huy điểm mạnh lạnh lùng, không cảm xúc, theo sát chart, vol, cung cầu realtime.
- Không để bot đu lệnh khi vol đã nổ quá rõ ràng (vì lúc đó cá mập đã ăn cỗ xong, retail chỉ vào làm thanh khoản thoát hàng cho họ).
- Đưa ra giải pháp "PREDICTIVE POSITIONING" (Đón đầu thanh khoản):
  a) Thuật toán nhận diện "Thế trận ngày" (Dominance Classifier): Ngày Big Trend vs Ngày Sideway. Khóa hẳn chiều ngược lại nếu là Big Trend.
  b) Thuật toán bắt điểm xoay M1 (Spring / Upthrust / Hấp thụ cung cầu) với Stop Loss siêu chặt (1.0 - 1.5đ) ngay sau râu nến.
  c) Cơ chế Profit Lock Guard: Lãi chạm +1.0đ lập tức dời SL khóa +0.6đ bảo toàn lợi nhuận sau phí (0.6đ/HĐ).
  d) Kỷ luật sinh tồn: Thua 2 lệnh liên tiếp dừng 30 phút.
- Viết code Node.js chuẩn chỉnh hoàn thiện cho bộ não này để tích hợp vào src/derivatives/tradeDecision.js và src/entrade/autonomousDayManager.js.
`;

async function runOpus() {
  console.log(`\n⏳ Đang kết nối tới Claude Opus 5.5 (${model}) tại ${baseURL}...`);
  try {
    const res = await client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: OPUS_SYSTEM_PROMPT },
        { role: 'user', content: OPUS_USER_PROMPT }
      ],
      temperature: 0.2
    });

    console.log('\n🤖 [KẾT QUẢ PHÂN TÍCH & CODE TỪ CLAUDE OPUS 5.5]:\n');
    console.log(res.choices[0].message.content);
    return res.choices[0].message.content;
  } catch (err) {
    console.error('❌ Lỗi kết nối Claude Opus:', err.response?.status, err.response?.data || err.message);
    return null;
  }
}

if (require.main === module) {
  runOpus();
}

module.exports = { runOpus };
