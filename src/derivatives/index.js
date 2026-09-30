/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN30F v5.0 — Main Orchestrator                          ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Volume Scalping Engine + AI Forecast + OI Tracker            ║
 * ║  • Volume Scalper: Poll 1p từ 09:12, Entry/Exit/Reverse       ║
 * ║  • AI Forecast: 3 phiên/ngày (9h22, 10h22, 13h50)            ║
 * ║  • OI Tracker: Pre-ATC, Post-ATC, Evening report              ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config, isCurrentInstanceActive } = require('../config');
const { sendDerivativesMessage } = require('../telegramService');

// ─── ENGINES ─────────────────────────────────────────────────
const dataFetcher = require('./dataFetcher');
const oiTracker = require('./oiTracker');
const volumeScalper = require('./volumeScalper');

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

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const prompt = `Bạn là Giám Đốc Quỹ Đầu Tư chuyên VN30F hàng đầu Việt Nam.

DỮ LIỆU THỰC TẾ VN30F v5.0 (${dataFetcher.vnNow()}):

GIÁ HIỆN TẠI:
- F1M: ${f1mPrice || 'N/A'} | VN30: ${vn30PriceVal || 'N/A'} | VNINDEX: ${vnindexVal || 'N/A'}

VỊ THẾ SCALPER: ${posInfo}
LỆNH HÔM NAY: ${tradeCount} lệnh | PnL: ${dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(1)}đ

OI: ${oiData.totalOI || 'N/A'} | Vol PS: ${oiData.totalVolume || 'N/A'}
NN: Mua ${oiData.foreignBuy} Bán ${oiData.foreignSell} Net ${oiData.foreignNet}

10 NẾN GẦN NHẤT:
${candleSummary || 'N/A'}

YÊU CẦU:
1. Đưa ra phán quyết LONG/SHORT dứt khoát, có phải bẫy không?
2. Đánh giá chất lượng cú tăng/giảm hiện tại (thật hay ảo?)
3. 3 lý do chính bằng tiếng Việt dễ hiểu
4. Entry, TP (theo cấu trúc), SL (khi nào luận điểm sai)
5. HTML cho Telegram (<b>, <i>). Ngắn gọn, súc tích.`;

    const result = await model.generateContent(prompt);
    let aiText = result.response.text().replace(/```html/gi, '').replace(/```/g, '').trim();

    let msg = `🤖 <b>DỰ BÁO AI v5.0 — ${sessionLabel}</b>\n`;
    msg += `🕐 <i>${dataFetcher.vnNow()}</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `${aiText}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>Scalper: ${posInfo} | PnL: ${dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(1)}đ</i>\n`;
    msg += `<i>🤖 AI VN30F v5.0 | VN Stock Bot</i>`;

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
  console.log('   🔄 Derivatives state reset v5.0');
}

// ─── VOLUME SCALPER CONTROLS ─────────────────────────────────
function startVolumeScalper() {
  volumeScalper.start();
}

function stopVolumeScalper() {
  volumeScalper.stop();
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
  }),
};
