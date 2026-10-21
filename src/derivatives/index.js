/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN30F v7.0 — Senior Trader AI Agent Orchestrator         ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Senior Prop Trader AI + Volume Scalper + Market Context      ║
 * ║  • Volume Scalper v6.0: Trap Shield + VSA + Pro Notifier      ║
 * ║  • Market Context: 6 Khung Giờ Vàng + Basis + Supply/Demand   ║
 * ║  • Trade Decision: Confidence Scoring % + Entry/SL/TP Plans   ║
 * ║  • AI Strategic Forecast: Phán quyết 3 phiên/ngày dứt khoát  ║
 * ║  • OI Tracker: Pre-ATC, Post-ATC, Evening report              ║
 * ║  • Evening Plan v7.0: Chiến lược phiên tiếp theo (19h50)     ║
 * ║  • Intraday Signal v7.0: 15p/noti realtime trong phiên       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config, isCurrentInstanceActive } = require('../config');
const { sendDerivativesMessage } = require('../telegramService');

// ─── ENGINES ─────────────────────────────────────────────────
const dataFetcher = require('./dataFetcher');
const oiTracker = require('./oiTracker');
const volumeScalper = require('./volumeScalper');
const eveningPlanEngine = require('./eveningPlanEngine');
const intradaySignalEngine = require('./intradaySignalEngine');

// ─── AI DERIVATIVES JOB ─────────────────────────────────────
async function runAIDerivativesJob(session) {
  if (!isCurrentInstanceActive()) return;

  const sessionLabels = {
    'morning': 'SÁNG (9h22)',
    'midmorning': 'GIỮA SÁNG (10h22)',
    'afternoon': 'CHIỀU (13h50)',
  };
  const sessionLabel = sessionLabels[session] || session;

  console.log('\n' + '═'.repeat(55));
  console.log(`🤖 AI DERIVATIVES ANALYSIS v5.0 — ${sessionLabel}`);
  console.log('═'.repeat(55));

  try {
    const apiKey = config.geminiAI4.apiKey || config.geminiAI1.apiKey;
    if (!apiKey) {
      console.log('   ⚠️ Không có API key cho AI');
      return;
    }

    // Fetch data cần thiết
    const [rawIntraday, oiData, futuresPrice, vn30Price, vnindexPrice] = await Promise.all([
      dataFetcher.fetchIntraday1m('VN30F1M'),
      dataFetcher.fetchDerivativesOIData(),
      dataFetcher.fetchRealtimeFuturesPrice(),
      dataFetcher.fetchRealtimeVN30Price(),
      dataFetcher.fetchRealtimeVNINDEXPrice(),
    ]);

    const f1mPrice = futuresPrice ? futuresPrice.price : null;
    const vn30PriceVal = vn30Price ? vn30Price.price : null;
    const vnindexVal = vnindexPrice ? vnindexPrice.price : null;

    // Volume Scalper state
    const scalperState = volumeScalper.getState();
    const posInfo = scalperState.position !== 'NONE'
      ? `${scalperState.position} @ ${scalperState.entryPrice} (Entry: ${scalperState.entryTime})`
      : 'NONE (Đứng ngoài)';

    const tradeCount = scalperState.tradeLog.length;
    const dayPnl = scalperState.tradeLog.reduce((s, t) => s + t.pnl, 0);

    // Tổng vol và last 10 candles
    const last10Candles = scalperState.processedCandles.slice(-10);
    const candleSummary = last10Candles.map(c =>
      `${c.time}: ${c.isGreen ? '🟢' : '🔴'} Vol:${c.volume} O:${c.open.toFixed(1)} C:${c.close.toFixed(1)}`
    ).join('\n');

    const marketContext = require('./marketContext');
    const context = marketContext.buildMarketContext(f1mPrice, vn30PriceVal, oiData);
    const contextSummary = marketContext.buildContextSummary(context);

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const prompt = `Bạn là Senior Prop Trader kỳ cựu 15 năm thực chiến thị trường Phái Sinh VN30F Việt Nam (phong cách dứt khoát, kết hợp VSA Wyckoff, Price Action và Đọc Bối Cảnh Lái).

DỮ LIỆU REALTIME THỰC CHIẾN VN30F v6.0 (${dataFetcher.vnNow()}):

GIÁ HIỆN TẠI:
- F1M: ${f1mPrice || 'N/A'} | VN30: ${vn30PriceVal || 'N/A'} | VNINDEX: ${vnindexVal || 'N/A'}
- Basis: ${context?.basis ? `${context.basis.basis >= 0 ? '+' : ''}${context.basis.basis}đ (${context.basis.description})` : 'N/A'}

BỐI CẢNH PHIÊN:
${contextSummary || 'N/A'}

VỊ THẾ HIỆN TẠI CỦA ROBOT SCALPER:
- Vị thế: ${posInfo}
- Hiệu suất hôm nay: ${tradeCount} lệnh | PnL: ${dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(1)}đ

DÒNG TIỀN & OI:
- OI lũy kế: ${oiData.totalOI?.toLocaleString() || 'N/A'} | Tổng Vol: ${oiData.totalVolume?.toLocaleString() || 'N/A'}
- Khối ngoại: Mua ${oiData.foreignBuy?.toLocaleString()} | Bán ${oiData.foreignSell?.toLocaleString()} | Net: ${oiData.foreignNet >= 0 ? '+' : ''}${oiData.foreignNet?.toLocaleString()} HĐ

10 NẾN 1 PHÚT GẦN NHẤT:
${candleSummary || 'N/A'}

YÊU CẦU PHÂN TÍCH NHƯ SENIOR TRADER KỲ CỰU:
1. ĐƯA RA QUYẾT ĐỊNH DỨT KHOÁT: LONG, SHORT, hay ĐỨNG NGOÀI? (Không ba phải, không nói hai chiều, tin cậy bao nhiêu %)
2. ĐÁNH GIÁ CUNG CẦU & BẪY LÁI: Có tín hiệu Trap Shield, nến rút râu ảo, hay gom/xả hàng không?
3. TRADE PLAN RÕ RÀNG: Entry chuẩn, Cắt lỗ MTL ở đâu (tối đa 2.5-3đ), Chốt lời TP1 (+4-5đ) và TP2 (+8-10đ).
4. ĐỊNH DẠNG HTML Telegram (<b>, <i>, bullet points). Súc tích, đọc 5 giây hiểu ngay hành động cần làm.`;

    const result = await model.generateContent(prompt);
    let aiText = result.response.text().replace(/```html/gi, '').replace(/```/g, '').trim();

    let msg = `🤖 <b>CHIẾN LƯỢC TRADER KỲ CỰU v6.0 — ${sessionLabel}</b>\n`;
    msg += `🕐 <i>${dataFetcher.vnNow()}</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `${aiText}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>Scalper: ${posInfo} | PnL: ${dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(1)}đ</i>\n`;
    msg += `<i>🔮 Senior Trader AI Agent v6.0 | VN Stock Bot</i>`;

    await sendDerivativesMessage(msg);
    console.log(`   ✅ AI Derivatives [${session}] hoàn thành`);
  } catch (err) {
    console.error(`   ❌ AI Derivatives [${session}] lỗi:`, err.message);
  }
}

// ─── DERIVATIVES OI & TAY TO JOB ─────────────────────────────
async function runDerivativesOIJob(session = 'evening') {
  if (!isCurrentInstanceActive()) return;

  console.log('\n' + '═'.repeat(55));
  console.log(`📊 DERIVATIVES OI & TAY TO v5.0 — ${session}`);
  console.log('═'.repeat(55));

  try {
    const msg = await oiTracker.buildOIEveningNotificationAsync(session);
    await sendDerivativesMessage(msg);
    console.log(`   ✅ Derivatives OI [${session}] hoàn thành`);
    return true;
  } catch (e) {
    console.error(`   ❌ Derivatives OI [${session}] lỗi:`, e.message);
    return false;
  }
}

// ─── DERIVATIVES PRE-ATC JOB (14h29 T2-T6) ───────────────────
async function runPreATCJob() {
  if (!isCurrentInstanceActive()) return;

  console.log('\n' + '═'.repeat(55));
  console.log('⚡ DERIVATIVES PRE-ATC v5.0 — 14h29');
  console.log('═'.repeat(55));

  try {
    const msg = await oiTracker.buildPreATCNotificationAsync();
    await sendDerivativesMessage(msg);
    console.log('   ✅ Derivatives Pre-ATC [14h29] hoàn thành');
    return true;
  } catch (e) {
    console.error('   ❌ Derivatives Pre-ATC [14h29] lỗi:', e.message);
    return false;
  }
}

// ─── DERIVATIVES POST-ATC / OVERNIGHT JOB (14h44 T2-T6) ──────
async function runPostATCJob() {
  if (!isCurrentInstanceActive()) return;

  console.log('\n' + '═'.repeat(55));
  console.log('🌙 DERIVATIVES POST-ATC / OVERNIGHT v5.0 — 14h44');
  console.log('═'.repeat(55));

  try {
    const msg = await oiTracker.buildPostATCNotificationAsync();
    await sendDerivativesMessage(msg);
    console.log('   ✅ Derivatives Post-ATC [14h44] hoàn thành');
    return true;
  } catch (e) {
    console.error('   ❌ Derivatives Post-ATC [14h44] lỗi:', e.message);
    return false;
  }
}

// ─── RESET DAILY ─────────────────────────────────────────────
function resetDerivativesState() {
  volumeScalper.reset();
  dataFetcher.resetDailyCache();
  intradaySignalEngine.resetIntradayState();
  console.log('   🔄 Derivatives state reset v7.0');
}

// ─── VOLUME SCALPER CONTROLS ─────────────────────────────────
function startVolumeScalper() {
  volumeScalper.start();
}

function stopVolumeScalper() {
  volumeScalper.stop();
}

// ─── EVENING PLAN JOB (19h50) ────────────────────────────────
async function runEveningPlanJob() {
  if (!isCurrentInstanceActive()) return;
  return eveningPlanEngine.runEveningPlanJob();
}

// ─── INTRADAY SIGNAL JOB (15p/lần trong phiên) ──────────────
async function runIntradaySignalJob() {
  if (!isCurrentInstanceActive()) return;
  return intradaySignalEngine.runIntradaySignal();
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  // Volume Scalper v5.0
  startVolumeScalper,
  stopVolumeScalper,
  resetDerivativesState,
  // AI & OI Jobs (giữ nguyên)
  runAIDerivativesJob,
  runDerivativesOIJob,
  runPreATCJob,
  runPostATCJob,
  // Evening Plan v7.0
  runEveningPlanJob,
  // Intraday Signal v7.0
  runIntradaySignalJob,
  resetIntradayState: intradaySignalEngine.resetIntradayState,
  // Tracker references
  oiTracker,
  buildOIEveningNotification: oiTracker.buildOIEveningNotification,
  buildOIEveningNotificationAsync: oiTracker.buildOIEveningNotificationAsync,
  buildPreATCNotificationAsync: oiTracker.buildPreATCNotificationAsync,
  buildPostATCNotificationAsync: oiTracker.buildPostATCNotificationAsync,
  // Compatibility
  fetchOHLCV: dataFetcher.fetchOHLCV,
  getDerivativesState: () => ({
    scalper: volumeScalper.getState(),
    intradaySignal: intradaySignalEngine.getState(),
  }),
};
