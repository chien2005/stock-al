/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔔 VN30F — Event Notifier & Anti-Spam Gatekeeper (v9.0)     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Bộ lọc cảnh báo sự kiện thông minh (Zero Noise):            ║
 * ║  • Chấm dứt triệt để spam 5 phút/tin                         ║
 * ║  • Chỉ phát thông báo khi xuất hiện BIẾN CỐ CẤU TRÚC:        ║
 * ║    1. Giá chạm Vùng Cực Trị H1/D1 (Extreme Zone Approach)     ║
 * ║    2. Bẫy Lái xác nhận (Bear Trap Reclaim / Bull Trap Reject) ║
 * ║    3. Bất thường Basis / Khối ngoại quay xe đột ngột         ║
 * ║    4. Cảnh báo Graduation vị thế qua đêm (14h25 - 14h40)      ║
 * ║    5. Các mốc chiến lược: 08h45 (ATO), 11h30 (Trưa), 14h45    ║
 * ║  • Cooldown thông minh: 45–60 phút/sự kiện cùng loại          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');
const { sendDerivativesMessage } = require('../telegramService');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const NOTIFIER_STATE_FILE = path.join(DATA_DIR, 'event_notifier_state.json');

const DEFAULT_COOLDOWN_MS = 45 * 60 * 1000; // 45 phút cooldown mỗi sự kiện

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadNotifierState() {
  ensureDataDir();
  try {
    if (fs.existsSync(NOTIFIER_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(NOTIFIER_STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('⚠️ [EventNotifier] Lỗi đọc state file:', err.message);
  }
  return {
    lastSentTimestamp: 0,
    lastSentType: null,
    cooldowns: {}, // { eventKey: timestamp }
  };
}

function saveNotifierState(state) {
  ensureDataDir();
  try {
    fs.writeFileSync(NOTIFIER_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️ [EventNotifier] Lỗi ghi state file:', err.message);
  }
}

/**
 * Kiểm tra xem một sự kiện có đang trong thời gian Cooldown hay không
 */
function isUnderCooldown(eventKey, cooldownMs = DEFAULT_COOLDOWN_MS) {
  const state = loadNotifierState();
  const lastTime = state.cooldowns[eventKey] || 0;
  const elapsed = Date.now() - lastTime;
  return elapsed < cooldownMs;
}

/**
 * Đánh dấu sự kiện đã được gửi
 */
function markEventSent(eventKey, eventType) {
  const state = loadNotifierState();
  state.lastSentTimestamp = Date.now();
  state.lastSentType = eventType;
  state.cooldowns[eventKey] = Date.now();
  saveNotifierState(state);
}

/**
 * Đánh giá các biến cố thị trường xem có cần phát thông báo hay không
 * @param {object} params
 *   - currentPrice: Giá F1M
 *   - trendAnalysis: Kết quả từ trendEngine
 *   - zoneAnalysis: Kết quả từ zoneManager
 *   - marketContext: Kết quả từ marketContextVN
 *   - positionEval: Kết quả từ positionRiskAssistant
 *   - memoryDiff: Kết quả từ aiMemory
 *   - isCheckpoint: Có phải checkpoint cố định (08h45, 11h30, 14h45) không
 *   - checkpointName: Tên checkpoint
 */
function evaluateEvents({
  currentPrice,
  trendAnalysis,
  zoneAnalysis,
  marketContext,
  positionEval,
  memoryDiff,
  isCheckpoint = false,
  checkpointName = '',
}) {
  const events = [];

  // 1. Checkpoint định kỳ (08h45, 11h30, 14h45)
  if (isCheckpoint) {
    events.push({
      type: 'MACRO_CHECKPOINT',
      key: `CHECKPOINT_${checkpointName}`,
      priority: 1,
      title: `🏛️ BÁO CÁO CHIẾN LƯỢC ĐA KHUNG — ${checkpointName}`,
      details: { checkpointName },
    });
  }

  // 2. Sự kiện Vị thế & Rủi ro (Graduation hoặc Đóng vị thế)
  if (positionEval && positionEval.actionRequired) {
    if (positionEval.actionType === 'POSITION_CLOSED') {
      events.push({
        type: 'POSITION_CLOSED',
        key: `POS_CLOSED_${Date.now()}`,
        priority: 1,
        title: '🚨 VỊ THẾ ĐÃ ĐƯỢC ĐÓNG BẢO TOÀN VỐN',
        details: positionEval,
      });
    } else if (positionEval.graduationAlert) {
      const gradKey = `GRAD_${positionEval.graduationAlert.type}`;
      if (!isUnderCooldown(gradKey, 60 * 60 * 1000)) {
        events.push({
          type: 'GRADUATION_ALERT',
          key: gradKey,
          priority: 1,
          title: positionEval.graduationAlert.title,
          details: positionEval.graduationAlert,
        });
      }
    }
  }

  // 3. Sự kiện Bẫy Lái xác nhận (Bear Trap Reclaim / Bull Trap Reject)
  if (zoneAnalysis && zoneAnalysis.trapSignals && zoneAnalysis.trapSignals.length > 0) {
    for (const trap of zoneAnalysis.trapSignals) {
      const trapKey = `TRAP_${trap.type}_${trap.zone.low.toFixed(0)}`;
      if (!isUnderCooldown(trapKey, 60 * 60 * 1000)) {
        events.push({
          type: 'TRAP_RECLAIM_CONFIRMED',
          key: trapKey,
          priority: 2,
          title: trap.type === 'BEAR_TRAP_RECLAIM'
            ? '🚨 XÁC NHẬN BẪY GẤU (BEAR TRAP RECLAIM) — CƠ HỘI SWING LONG'
            : '🚨 XÁC NHẬN BẪY BÒ (BULL TRAP REJECT) — CƠ HỘI SWING SHORT',
          details: trap,
        });
      }
    }
  }

  // 4. Sự kiện Giá chạm Vùng Cực Trị H1/D1
  if (zoneAnalysis && zoneAnalysis.relativePosition) {
    const rel = zoneAnalysis.relativePosition;
    if (rel.status === 'AT_SUPPORT' && !isUnderCooldown(`ZONE_SUP_${rel.zone.low.toFixed(0)}`, DEFAULT_COOLDOWN_MS)) {
      events.push({
        type: 'ZONE_SUPPORT_APPROACH',
        key: `ZONE_SUP_${rel.zone.low.toFixed(0)}`,
        priority: 3,
        title: '🎯 F1M CHẠM VÙNG HỖ TRỢ CHIẾN LƯỢC',
        details: { zone: rel.zone, distance: rel.distanceToSupport, price: currentPrice },
      });
    } else if (rel.status === 'AT_RESISTANCE' && !isUnderCooldown(`ZONE_RES_${rel.zone.high.toFixed(0)}`, DEFAULT_COOLDOWN_MS)) {
      events.push({
        type: 'ZONE_RESISTANCE_APPROACH',
        key: `ZONE_RES_${rel.zone.high.toFixed(0)}`,
        priority: 3,
        title: '🎯 F1M CHẠM VÙNG KHÁNG CỰ CHIẾN LƯỢC',
        details: { zone: rel.zone, distance: rel.distanceToResistance, price: currentPrice },
      });
    }
  }

  // 5. Bất thường Basis hoặc Dòng tiền Khối ngoại
  if (marketContext && marketContext.basisContext) {
    const basisVal = marketContext.basisContext.basis;
    if (basisVal <= -7.0 && !isUnderCooldown('BASIS_EXTREME_NEGATIVE', 60 * 60 * 1000)) {
      events.push({
        type: 'BASIS_STRETCH',
        key: 'BASIS_EXTREME_NEGATIVE',
        priority: 4,
        title: '⚡ BẤT THƯỜNG BASIS: CHIẾT KHẤU ÂM NẶNG (≤ -7đ) — ĐỀ PHÒNG SPRING',
        details: { basisVal, description: marketContext.basisContext.description },
      });
    } else if (basisVal >= 7.0 && !isUnderCooldown('BASIS_EXTREME_POSITIVE', 60 * 60 * 1000)) {
      events.push({
        type: 'BASIS_STRETCH',
        key: 'BASIS_EXTREME_POSITIVE',
        priority: 4,
        title: '⚡ BẤT THƯỜNG BASIS: FOMO DƯƠNG CAO (≥ +7đ) — ĐỀ PHÒNG UPTHRUST',
        details: { basisVal, description: marketContext.basisContext.description },
      });
    }
  }

  // Sắp xếp theo thứ tự ưu tiên (priority thấp hơn = ưu tiên cao hơn)
  events.sort((a, b) => a.priority - b.priority);

  return {
    hasEvents: events.length > 0,
    topEvent: events[0] || null,
    allEvents: events,
  };
}

/**
 * Định dạng thông báo gửi Telegram chuẩn Senior Copilot (Súc tích, 3 gạch đầu dòng)
 */
function formatEventNotification({
  event,
  currentPrice,
  trendAnalysis,
  zoneAnalysis,
  marketContext,
  positionEval,
  aiCommentary = null,
}) {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const vnTime = new Date(utc + (3600000 * 7));
  const timeStr = `${String(vnTime.getHours()).padStart(2, '0')}:${String(vnTime.getMinutes()).padStart(2, '0')}:${String(vnTime.getSeconds()).padStart(2, '0')} ${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;

  const f1mStr = currentPrice ? currentPrice.toFixed(1) : 'N/A';
  const vn30Str = marketContext?.prices?.vn30 ? marketContext.prices.vn30.toFixed(1) : 'N/A';
  const basisStr = marketContext?.basisContext?.basis !== undefined
    ? `${marketContext.basisContext.basis > 0 ? '+' : ''}${marketContext.basisContext.basis.toFixed(1)}đ`
    : 'N/A';

  let msg = `🤖 <b>AI SUPERVISOR & RISK COPILOT v9.0</b>\n`;
  msg += `<b>${event.title}</b>\n`;
  msg += `🕐 <i>${timeStr}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. Dòng dữ liệu thị trường
  msg += `📍 <b>F1M:</b> <b>${f1mStr}</b> | <b>VN30:</b> <b>${vn30Str}</b> | <b>Basis:</b> <b>${basisStr}</b>\n`;
  if (trendAnalysis) {
    msg += `🧭 <b>Regime Đa Khung:</b> <b>${trendAnalysis.regime}</b> (Score: ${trendAnalysis.compositeScore > 0 ? '+' : ''}${trendAnalysis.compositeScore})\n`;
  }
  msg += '\n';

  // 2. Nội dung chi tiết sự kiện
  if (event.type === 'GRADUATION_ALERT' && event.details?.content) {
    msg += `${event.details.content}\n\n`;
  } else if (event.type === 'POSITION_CLOSED') {
    msg += `${event.details.message}\n\n`;
  } else if (event.type === 'TRAP_RECLAIM_CONFIRMED') {
    const t = event.details;
    msg += `🎯 <b>BẢN CHẤT CẤU TRÚC:</b>\n`;
    msg += `• Giá vừa thủng/vượt vùng <b>[${t.zone.low} - ${t.zone.high}]</b> nhưng bị từ chối dứt khoát.\n`;
    msg += `• Đám đông fomo đã bị nhốt thanh khoản ➔ Xu hướng đảo chiều xác nhận trên M15.\n`;
    msg += `• <b>Kế hoạch Swing:</b> Cắt lỗ tuyệt đối ${t.type === 'BEAR_TRAP_RECLAIM' ? (t.zone.low - 2.5).toFixed(1) : (t.zone.high + 2.5).toFixed(1)} | Target R:R 1:3 (+15 đến +25đ).\n\n`;
  } else if (event.type.startsWith('ZONE_')) {
    msg += `🎯 <b>BỐI CẢNH VÙNG CỰC TRỊ:</b>\n`;
    msg += `• Vùng S/R: <b>[${event.details.zone.low} - ${event.details.zone.high}]</b> (${event.details.zone.timeframe})\n`;
    msg += `• Số lần kiểm tra: <b>${event.details.zone.touchCount} lần</b> | Trạng thái: <b>${event.details.zone.lifecycle}</b>\n`;
    msg += `• <b>HÀNH ĐỘNG:</b> Kiên nhẫn chờ nến M15 đóng cửa xác nhận phản ứng hoặc Bẫy Reclaim. Tuyệt đối không fomo bắt dao rơi!\n\n`;
  }

  // 3. Bình luận sâu từ AI Copilot (nếu có)
  if (aiCommentary) {
    msg += `📋 <b>PHÂN TÍCH SENIOR TRADER:</b>\n`;
    msg += `${aiCommentary.trim()}\n\n`;
  }

  // 4. Vị thế hiện tại & Kỷ luật
  const posText = positionEval?.statusText || 'Vị thế: TRỐNG (Đang đứng ngoài quan sát)';
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💼 <i>${posText}</i>\n`;
  msg += `🛡️ <i>Quy tắc: R:R ≥ 1:3 | SL 6-8đ | Không cào phím scalping</i>`;

  return msg;
}

/**
 * Gửi thông báo sự kiện qua Telegram có kèm quản lý Cooldown
 */
async function dispatchEventNotification(notificationData) {
  const { event } = notificationData;
  const message = formatEventNotification(notificationData);

  try {
    await sendDerivativesMessage(message);
    markEventSent(event.key, event.type);
    console.log(`   🔔 [EventNotifier] Đã gửi thông báo Telegram: [${event.type}] - ${event.title}`);
    return true;
  } catch (err) {
    console.error('   ❌ [EventNotifier] Lỗi gửi thông báo Telegram:', err.message);
    return false;
  }
}

module.exports = {
  evaluateEvents,
  formatEventNotification,
  dispatchEventNotification,
  isUnderCooldown,
  markEventSent,
};
