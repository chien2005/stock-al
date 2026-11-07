/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🏛️ VN30F — AI Supervisor & Master Copilot Orchestrator (v9.0)║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Tổng chỉ huy vận hành hệ thống Phái Sinh Thông Minh:         ║
 * ║  • Hợp nhất 7 Engines: Data, Trend, Zone, Context, Memory,    ║
 * ║    PositionRisk, Notifier.                                    ║
 * ║  • Triệt tiêu hoàn toàn robot scalper cào điểm -31đ           ║
 * ║  • AI đóng vai trò Giám Sát Viên Trưởng (Chief Risk Officer):  ║
 * ║    Chỉ lên tiếng khi có Biến cố Cấu trúc hoặc Vùng Cực Trị    ║
 * ║  • Bảo toàn tối đa nguồn vốn, kiên nhẫn săn sóng Swing lớn    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config, isCurrentInstanceActive } = require('../config');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── IMPORT CÁC ENGINES THÀNH PHẦN ───────────────────────────
const realtimeDataEngine = require('./realtimeDataEngine');
const trendEngine = require('./trendEngine');
const zoneManager = require('./zoneManager');
const marketContextVN = require('./marketContextVN');
const aiMemory = require('./aiMemory');
const positionRiskAssistant = require('./positionRiskAssistant');
const eventNotifier = require('./eventNotifier');
const oiTracker = require('./oiTracker');
const dataFetcher = require('./dataFetcher');

// ─── SYSTEM PROMPT CHO AI SUPERVISOR COPILOT ─────────────────
const SUPERVISOR_SYSTEM_PROMPT = `Bạn là Giám Sát Viên Trưởng (Chief Risk & Market Structure Officer) tại Quỹ Đầu Tư Phái Sinh VN30F Việt Nam với 15 năm thực chiến.
Vai trò của bạn KHÔNG PHẢI là thợ bấm lệnh scalping cào 3-5 điểm hay spam tin nhắn.
Vai trò của bạn là:
1. Quan sát đa khung thời gian (Daily định hướng, H1 xác định biên trên/dưới, M15 tìm điểm kích hoạt bẫy Reclaim).
2. Phát hiện chiêu bài bẫy thanh khoản của Lái (Kéo xả 2 đầu, gom phái sinh đạp trụ, bẫy gấu Bear Trap, bẫy bò Bull Trap).
3. Đọc vị dòng tiền Cá mập (Khối ngoại, Tự doanh, 7 Trụ điều tiết VIC, VHM, VCB, GAS, MCH, VJC, VPL).
4. Quản trị rủi ro vị thế lớn: R:R tối thiểu 1:3 (ăn sóng 20-50đ, SL 6-8đ). Tuyệt đối cấm bắt đáy khi trend giảm mạnh, cấm chặn tàu khi trend tăng mạnh, cấm vào lệnh lơ lửng giữa biên độ ("No Man's Land").
5. Đưa ra chỉ đạo dứt khoát, logic, dựa trên dữ liệu cụ thể, định dạng Telegram HTML súc tích, đọc trong 10 giây hiểu ngay hành động.`;

/**
 * Hàm bọc timeout cho Promise
 */
function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout sau ${ms}ms`)), ms)),
  ]);
}

/**
 * Tạo bình luận sâu từ Gemini AI khi có sự kiện trọng yếu
 */
async function generateAICommentary({
  event,
  currentPrice,
  trendAnalysis,
  zoneAnalysis,
  marketContext,
  positionEval,
  memoryContext,
}) {
  const candidateKeys = [
    config.geminiAI4?.apiKey,
    config.geminiAI2?.apiKey,
    config.geminiAI1?.apiKey,
    config.geminiAI3?.apiKey,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean);

  if (candidateKeys.length === 0) return null;

  const candidateModels = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash'];

  const f1mStr = currentPrice ? currentPrice.toFixed(1) : 'N/A';
  const vn30Str = marketContext?.prices?.vn30 ? marketContext.prices.vn30.toFixed(1) : 'N/A';
  const basisStr = marketContext?.basisContext?.basis !== undefined
    ? `${marketContext.basisContext.basis > 0 ? '+' : ''}${marketContext.basisContext.basis.toFixed(1)}đ`
    : 'N/A';

  const prompt = `${SUPERVISOR_SYSTEM_PROMPT}

DỮ LIỆU REALTIME THỊ TRƯỜNG PHÁI SINH VN30F (${new Date().toLocaleTimeString('vi-VN')}):
- Sự kiện kích hoạt: ${event.title}
- Giá F1M: ${f1mStr} | VN30: ${vn30Str} | VN-Index: ${marketContext?.prices?.vnindex || 'N/A'}
- Basis: ${basisStr} (${marketContext?.basisContext?.description || ''})
- Cấu trúc Đa khung: Regime [${trendAnalysis?.regime || 'N/A'}] | Composite Score: ${trendAnalysis?.compositeScore || 0}
- Hỗ trợ gần nhất: ${zoneAnalysis?.relativePosition?.nearestSupport ? zoneAnalysis.relativePosition.nearestSupport.low + ' - ' + zoneAnalysis.relativePosition.nearestSupport.high : 'N/A'}
- Kháng cự gần nhất: ${zoneAnalysis?.relativePosition?.nearestResistance ? zoneAnalysis.relativePosition.nearestResistance.low + ' - ' + zoneAnalysis.relativePosition.nearestResistance.high : 'N/A'}
- Vị trí giá: ${zoneAnalysis?.relativePosition?.locationDescription || 'N/A'}
- 7 Trụ điều tiết: ${marketContext?.pillarAnalysis?.consensusLabel || 'N/A'}
- Smart Money OI: Ngoại Net ${marketContext?.smartMoney?.foreignNet !== undefined ? marketContext.smartMoney.foreignNet.toLocaleString() : 'N/A'} HĐ | Tổng OI: ${marketContext?.smartMoney?.totalOI !== undefined ? marketContext.smartMoney.totalOI.toLocaleString() : 'N/A'}
- Vị thế hiện tại: ${positionEval?.statusText || 'TRỐNG'}

${memoryContext}

YÊU CẦU ĐƯA RA Ý KIẾN CHỈ ĐẠO TRƯỞNG QUỸ:
Viết đúng 3 gạch đầu dòng súc tích:
1. Đọc vị hành vi của Lái tại thời điểm này (Có phải bẫy, cạn cung/cầu hay gom hàng?).
2. Đánh giá rủi ro nếu vào lệnh ở đây (Có bị lơ lửng giữa biên độ không?).
3. Kế hoạch hành động cụ thể (R:R, mốc giá chờ, hoặc giữ nguyên vị thế).
KHÔNG viết dài dòng lan man, KHÔNG lặp lại tiêu đề.`;

  for (const apiKey of candidateKeys) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      for (const modelName of candidateModels) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await withTimeout(model.generateContent(prompt), 8000);
          let rawText = result?.response?.text();
          if (rawText && rawText.trim().length > 0) {
            const cleanText = rawText
              .replace(/```html/gi, '')
              .replace(/```/g, '')
              .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
              .replace(/\*(.*?)\*/g, '<i>$1</i>')
              .trim();
            console.log(`   ✅ [AISupervisor] AI Gemini thành công với model ${modelName}`);
            return cleanText;
          }
        } catch (mErr) {
          continue;
        }
      }
    } catch (kErr) {
      continue;
    }
  }

  // Fallback thông minh dựa trên dữ liệu thuần nếu AI không phản hồi
  return [
    `• <b>Đọc vị Lái:</b> Thị trường đang vận động tại vùng ${f1mStr}đ. Dòng tiền lớn chưa có tín hiệu gom/xả đột biến.`,
    `• <b>Đánh giá Rủi ro:</b> ${zoneAnalysis?.relativePosition?.locationDescription || 'Giá lơ lửng giữa biên độ, rủi ro bị whipsaw cao.'}`,
    `• <b>Chỉ đạo:</b> Kiên nhẫn chờ giá test Vùng Cực Trị. Tuân thủ R:R ≥ 1:3 và bảo toàn vốn.`,
  ].join('\n');
}

/**
 * Vòng lặp giám sát trung tâm (Supervisor Tick)
 * Chạy nền mỗi 3 - 5 phút trong phiên.
 * TỰ ĐỘNG IM LẶNG nếu thị trường đi ngang hoặc lơ lửng giữa biên độ.
 * CHỈ GỬI TELEGRAM khi có biến cố cấu trúc thực sự!
 */
async function runSupervisorTick(options = {}) {
  const { isCheckpoint = false, checkpointName = '', forceAlert = false } = options;

  console.log(`\n🕵️ [AISupervisor] Bắt đầu chu kỳ giám sát... (${new Date().toLocaleTimeString('vi-VN')})`);

  try {
    // 1. Thu thập dữ liệu đa khung sạch
    const multiTfData = await realtimeDataEngine.fetchAllData('VN30F1M');
    const dataHealth = realtimeDataEngine.checkDataHealth(multiTfData);

    if (!dataHealth.isHealthy && dataHealth.isMarketHours) {
      console.log(`   ⚠️ [AISupervisor] Dữ liệu thị trường chậm (${dataHealth.m1DelaySec}s). Chuyển sang Safe Mode.`);
      return { success: false, reason: 'STALE_DATA' };
    }

    const currentPrice = multiTfData.m1 && multiTfData.m1.length > 0
      ? multiTfData.m1[multiTfData.m1.length - 1].close
      : (multiTfData.m5 && multiTfData.m5.length > 0 ? multiTfData.m5[multiTfData.m5.length - 1].close : null);

    if (!currentPrice) {
      console.log('   ⚠️ [AISupervisor] Không lấy được giá F1M realtime.');
      return { success: false, reason: 'NO_PRICE' };
    }

    // 2. Chạy Trend Engine Đa Khung
    const trendAnalysis = trendEngine.analyzeMultiTimeframe(multiTfData);

    // 3. Chạy Dynamic Zone Manager (Hỗ trợ / Kháng cự / Bẫy Reclaim)
    const zoneAnalysis = zoneManager.findDynamicZones(multiTfData, currentPrice);

    // 4. Lấy dữ liệu Smart Money OI & Bối cảnh VN30/VNIndex/7 Trụ
    let marketContext = null;
    try {
      marketContext = await marketContextVN.buildVNMarketContext();
    } catch (e) {
      console.log('   ⚠️ [AISupervisor] Không lấy đủ dữ liệu ngoại vi:', e.message);
    }

    // 5. Quản trị Vị thế & Rủi ro
    const positionEval = await positionRiskAssistant.evaluatePosition(currentPrice, marketContext);

    // 6. Bộ nhớ AI: So sánh biến đổi so với quá khứ (State Diffing)
    const currentSnapshot = {
      price: currentPrice,
      basis: marketContext?.basisContext?.basis,
      foreignNet: marketContext?.smartMoney?.foreignNet,
      regime: trendAnalysis?.regime,
      zoneAction: zoneAnalysis?.relativePosition?.locationDescription,
    };

    const memoryDiff = aiMemory.compareWithPreviousState(currentSnapshot);
    aiMemory.recordSnapshot(currentSnapshot);

    // 7. Đánh giá Sự kiện & Bộ lọc chống Spam (Event Gatekeeper)
    const eventResult = eventNotifier.evaluateEvents({
      currentPrice,
      trendAnalysis,
      zoneAnalysis,
      marketContext,
      positionEval,
      memoryDiff,
      isCheckpoint,
      checkpointName,
    });

    const hasNotableEvent = eventResult.hasEvents || forceAlert;

    console.log(`   📍 F1M: ${currentPrice} | Basis: ${marketContext?.basisContext?.basis ?? 'N/A'}đ | Regime: ${trendAnalysis?.regime}`);
    console.log(`   🎯 Vị trí S/R: ${zoneAnalysis?.relativePosition?.locationDescription}`);
    console.log(`   💼 Vị thế: ${positionEval?.statusText}`);
    console.log(`   🔔 Sự kiện kích hoạt: ${hasNotableEvent ? eventResult.topEvent?.title : 'Không có (Thị trường bình ổn / Lơ lửng giữa biên độ - Đứng ngoài quan sát)'}`);

    // NẾU KHÔNG CÓ SỰ KIỆN TRỌNG YẾU ➔ HOÀN TOÀN IM LẶNG, BẢO TOÀN SỰ TĨNH LẶNG CHO TRADER
    if (!hasNotableEvent) {
      return {
        success: true,
        sentNotification: false,
        status: 'STANDBY_SILENT',
        currentPrice,
        regime: trendAnalysis?.regime,
      };
    }

    // 8. Nếu có sự kiện hoặc Checkpoint ➔ Gọi Gemini AI tạo phân tích ngắn gọn và gửi Telegram
    const memoryContext = aiMemory.getMemoryContext();
    const aiCommentary = await generateAICommentary({
      event: eventResult.topEvent,
      currentPrice,
      trendAnalysis,
      zoneAnalysis,
      marketContext,
      positionEval,
      memoryContext,
    });

    await eventNotifier.dispatchEventNotification({
      event: eventResult.topEvent,
      currentPrice,
      trendAnalysis,
      zoneAnalysis,
      marketContext,
      positionEval,
      aiCommentary,
    });

    // Nếu là checkpoint Post-ATC thì lưu tóm tắt phiên vào bộ nhớ
    if (isCheckpoint && checkpointName.includes('POST_ATC')) {
      aiMemory.recordSessionNarrative({
        session: 'POST_ATC',
        closePrice: currentPrice,
        basis: marketContext?.basisContext?.basis,
        foreignNet: marketContext?.smartMoney?.foreignNet,
        strategicRegime: trendAnalysis?.regime,
        keySupport: zoneAnalysis?.relativePosition?.nearestSupport?.low,
        keyResistance: zoneAnalysis?.relativePosition?.nearestResistance?.high,
        summary: aiCommentary || 'Kết thúc phiên giao dịch.',
      });
    }

    return {
      success: true,
      sentNotification: true,
      event: eventResult.topEvent,
      currentPrice,
    };
  } catch (err) {
    console.error('❌ [AISupervisor] Lỗi xử lý Supervisor Tick:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  runSupervisorTick,
  openPosition: positionRiskAssistant.openPosition,
  closePosition: positionRiskAssistant.closePosition,
  evaluatePosition: positionRiskAssistant.evaluatePosition,
  loadPositionState: positionRiskAssistant.loadState,
  getPositionSummary: positionRiskAssistant.getPositionSummary,
  getMemoryContext: aiMemory.getMemoryContext,
  SUPERVISOR_SYSTEM_PROMPT,
};
