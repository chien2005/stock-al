/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📱 VN30F v6.0 — Pro Notification Formatter                  ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Format notification như senior trader ngồi cạnh bạn:         ║
 * ║  • Dòng 1: Khuyến nghị DỨT KHOÁT + Confidence               ║
 * ║  • Dòng 2: Entry / SL / TP1 / TP2                            ║
 * ║  • Dòng 3-4: "Tại sao?" — logic ngắn gọn                    ║
 * ║  • Dòng 5: Bối cảnh / Cảnh báo đặc biệt                     ║
 * ║                                                                ║
 * ║  MỤC TIÊU: 3 giây để hiểu, không cần đọc lại                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const marketContext = require('./marketContext');

// ─── HELPERS ─────────────────────────────────────────────────
function getVnTimeHHMMSS() {
  const { config } = require('../config');
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ─── ENTRY NOTIFICATION (Senior Trader Style) ───────────────
/**
 * Notification mở vị thế mới — phong cách senior trader
 */
function formatEntryNotification(params) {
  const {
    candle,
    direction,      // 'LONG' or 'SHORT'
    decision,       // from calculateConfidence()
    plan,           // from generateTradePlan()
    indicators,
    context,        // from buildMarketContext()
    oiData,
    reasons,        // from buildSeniorReasoning()
  } = params;

  const isLong = direction === 'LONG';
  const emoji = isLong ? '🟢' : '🔴';
  const confEmoji = decision.confidence >= 80 ? '🔥' : decision.confidence >= 60 ? '⚡' : '⚠️';

  let msg = '';

  // ─── DÒNG 1: KHUYẾN NGHỊ DỨT KHOÁT ──────────────────────
  msg += `${emoji} <b>MỞ ${direction}</b> — Tin cậy: <b>${decision.confidence}%</b> ${confEmoji}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  // ─── DÒNG 2: PLAN GD ─────────────────────────────────────
  msg += `💰 <b>Entry:</b> <b>${plan.entry.toFixed(1)}</b> | <b>SL:</b> ${plan.sl.toFixed(1)} (-${plan.slDistance}đ MTL)\n`;
  msg += `🎯 <b>TP1:</b> ${plan.tp1.toFixed(1)} (+${plan.tp1Distance}đ, chốt 50%)\n`;
  msg += `🎯 <b>TP2:</b> ${plan.tp2.toFixed(1)} (+${plan.tp2Distance}đ, gồng sóng)\n\n`;

  // ─── DÒNG 3-4: TẠI SAO? ──────────────────────────────────
  msg += `📊 <b>TẠI SAO MỞ ${direction}:</b>\n`;
  const topReasons = (reasons && reasons.length > 0) ? reasons : (decision.reasons || []);
  for (const r of topReasons.slice(0, 3)) {
    msg += `• ${r}\n`;
  }

  // Đồng thuận MACD + RSI
  if (indicators && indicators.macdAnalysis && indicators.rsiAnalysis) {
    const macdUp = indicators.macdAnalysis.isSlopeUp;
    const rsiUp = indicators.rsiAnalysis.isSlopeUp;
    const isAligned = (isLong && macdUp && rsiUp) || (!isLong && !macdUp && !rsiUp);
    if (isAligned) {
      msg += `• MACD + RSI <b>đồng thuận</b> → xung lực <b>${isLong ? 'TĂNG' : 'GIẢM'} mạnh</b>\n`;
    }
  }
  msg += '\n';

  // ─── DÒNG 5: BỐI CẢNH ────────────────────────────────────
  msg += `⚡ <b>BỐI CẢNH:</b>\n`;

  // Khung giờ
  if (context && context.session) {
    msg += `• ${context.session.emoji} ${context.session.name}\n`;
  }

  // NN + Basis
  if (context && context.supplyDemand) {
    const sd = context.supplyDemand;
    msg += `• NN: <b>${sd.nnNet >= 0 ? '+' : ''}${sd.nnNet.toLocaleString()} HĐ</b> (${sd.isNNBullish ? 'Long ròng' : sd.isNNBearish ? 'Short ròng' : 'Cân bằng'})\n`;
  }
  if (context && context.basis) {
    msg += `• Basis: <b>${context.basis.basis >= 0 ? '+' : ''}${context.basis.basis}đ</b> (${context.basis.description})\n`;
  }

  // Nến detail
  msg += `• Nến ${candle.time}: ${candle.isGreen ? '🟢' : '🔴'} Vol <b>${candle.volume.toLocaleString()}</b> HĐ | Body ${candle.body}đ\n`;
  msg += '\n';

  // ─── CẢNH BÁO ────────────────────────────────────────────
  if (decision.warnings && decision.warnings.length > 0) {
    msg += `⚠️ <b>LƯU Ý:</b>\n`;
    for (const w of decision.warnings.slice(0, 2)) {
      msg += `• <i>${w}</i>\n`;
    }
    msg += '\n';
  }

  // ─── INDICATORS COMPACT ──────────────────────────────────
  msg += `📈 `;
  if (indicators) {
    if (indicators.macdAnalysis) msg += `MACD: ${indicators.macdAnalysis.zoneDesc} `;
    if (indicators.rsiAnalysis) msg += `| RSI: <b>${indicators.rsiAnalysis.val}</b> ${indicators.rsiAnalysis.directionStr}`;
  }
  msg += '\n';

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── EXIT NOTIFICATION ──────────────────────────────────────
function formatExitNotification(params) {
  const {
    trade,          // { type, entryPrice, exitPrice, pnl, reason, maxProfit }
    candle,
    indicators,
    context,
    isReverse,
    newDirection,
    newPlan,
    decision,
  } = params;

  const pnlEmoji = trade.pnl >= 0 ? '✅' : '❌';
  const pnlStr = `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(1)}đ`;

  let msg = '';

  if (isReverse) {
    const reverseEmoji = newDirection === 'LONG' ? '🟢' : '🔴';
    msg += `🔄 <b>ĐÓNG ${trade.type} ${pnlStr}</b> → <b>ĐẢO ${newDirection}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `${pnlEmoji} Đóng ${trade.type} @ ${trade.exitPrice.toFixed(1)} (${pnlStr})\n`;
    msg += `${reverseEmoji} Mở ${newDirection} @ ${candle.close.toFixed(1)}\n\n`;

    if (newPlan) {
      msg += `💰 <b>Plan mới:</b> SL: ${newPlan.sl.toFixed(1)} | TP1: ${newPlan.tp1.toFixed(1)} | TP2: ${newPlan.tp2.toFixed(1)}\n\n`;
    }
  } else {
    msg += `${pnlEmoji} <b>ĐÓNG ${trade.type} — ${pnlStr}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `📋 Entry: ${trade.entryPrice.toFixed(1)} → Exit: ${trade.exitPrice.toFixed(1)}\n`;
    msg += `📊 PnL: <b>${pnlStr}</b> | Max lãi: +${trade.maxProfit.toFixed(1)}đ\n\n`;
  }

  // Lý do
  msg += `💡 <b>Lý do:</b> ${trade.reason}\n\n`;

  // Nến trigger
  msg += `📊 Nến ${candle.time}: ${candle.isGreen ? '🟢' : '🔴'} Vol <b>${candle.volume.toLocaleString()}</b> HĐ\n`;

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── TRAP SHIELD NOTIFICATION ───────────────────────────────
function formatTrapShieldAlert(params) {
  const {
    level,           // 1 or 2
    candle,
    priceChange,     // biến động giá (đ)
    currentPosition, // 'LONG', 'SHORT', 'NONE'
    context,
  } = params;

  const isLevel1 = level === 1;
  const alertEmoji = isLevel1 ? '🚨' : '⚠️';
  const levelDesc = isLevel1
    ? 'MỨC 1 — BƠM/ĐẠP ĐỂU, VOL KIỆT QUỆ!'
    : 'MỨC 2 — KÉO/XẢ ẢO, THIẾU DÒNG TIỀN!';

  let msg = `${alertEmoji} <b>[TRAP SHIELD] ${levelDesc}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `⚡ Giá giật <b>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}đ</b> nhưng Vol CHỈ <b>${candle.volume.toLocaleString()} HĐ</b>\n`;
  msg += `📊 Ngưỡng bẫy: Vol < ${isLevel1 ? '1,300' : '1,500'} HĐ\n\n`;

  msg += `🛡️ <b>HÀNH ĐỘNG:</b>\n`;
  msg += `• <b>KHÓA MỞ LỆNH MỚI 2 PHÚT!</b> Dù giá có vẻ ${priceChange > 0 ? 'tăng' : 'giảm'} mạnh\n`;

  if (currentPosition === 'LONG') {
    msg += `• Đang LONG → <b>CẤM BÁN THÁO, CẤM ĐẢO SHORT!</b>\n`;
    msg += `• Đây là chiêu đạp dọa quét SL — Giữ chặt vị thế!\n`;
  } else if (currentPosition === 'SHORT') {
    msg += `• Đang SHORT → <b>CẤM CẮT LỖ NON, CẤM ĐẢO LONG!</b>\n`;
    msg += `• Đây là chiêu kéo dụ Long — Giữ chặt vị thế!\n`;
  } else {
    msg += `• ĐỨNG NGOÀI → <b>TUYỆT ĐỐI KHÔNG MỞ LỆNH FOMO!</b>\n`;
    msg += `• Chờ 2 phút cho lái xong trò, vol thật sẽ lộ diện\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🛡️ Trap Shield v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── CLIMAX NOTIFICATION ────────────────────────────────────
function formatClimaxAlert(params) {
  const {
    candle,
    timeframe,      // '1M' or '5M'
    volRatio,       // % so với MA
    currentPosition,
    indicators,
  } = params;

  const isGreen = candle.isGreen;
  const tfLabel = timeframe === '5M' ? '5M' : '1M';

  let msg = `🔥🔥🔥 <b>[${tfLabel} CLIMAX] CAO TRÀO — Vol ${candle.volume.toLocaleString()} HĐ</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  if (isGreen) {
    msg += `⚡ <b>ĐỈNH MUA CAO TRÀO:</b>\n`;
    msg += `• Tay to CHỐT LỜI trên đỉnh + Đám đông FOMO mua đuổi!\n`;
    msg += `• <b>CẤM TUYỆT ĐỐI ĐU LONG VÀO CÂY NÀY!</b>\n\n`;
  } else {
    msg += `⚡ <b>ĐÁY BÁN THÁO CAO TRÀO:</b>\n`;
    msg += `• Tay to HẤP THỤ gom hàng đáy + Nhỏ lẻ hoảng loạn xả!\n`;
    msg += `• <b>CẤM BỒI SHORT! CẤM BÁN THÁO THEO!</b>\n\n`;
  }

  msg += `📊 Vol: <b>${candle.volume.toLocaleString()}</b> HĐ`;
  if (volRatio) msg += ` (<b>${(volRatio * 100).toFixed(0)}%</b> MA Vol)`;
  msg += `\n`;
  msg += `📊 Nến: ${isGreen ? '🟢' : '🔴'} Body ${candle.body}đ | Râu ↑${candle.upperWick}đ ↓${candle.lowerWick}đ\n\n`;

  if (currentPosition !== 'NONE') {
    const dir = currentPosition;
    const isSameDir = (dir === 'LONG' && isGreen) || (dir === 'SHORT' && !isGreen);
    if (isSameDir) {
      msg += `🛑 Đang ${dir} → <b>CHỐT LỜI BẢO TOÀN LÃI NGAY!</b>\n`;
    } else {
      msg += `✅ Đang ${dir} → Chiều ngược → Tiếp tục giữ vị thế\n`;
    }
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── FLASH CRASH NOTIFICATION ───────────────────────────────
function formatFlashCrashAlert(params) {
  const {
    currentPrice,
    dropPts,
    dropWindow,
    fromPrice,
    isAfter14h,
    wasLong,
    indicators,
  } = params;

  let msg = `🚨🚨🚨 <b>CÁ MẬP ÚP BÔ / FORCE SELL / FLASH CRASH!</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `⚡ Giá tụt <b>-${dropPts.toFixed(1)} điểm</b> trong <b>${dropWindow}</b>!\n`;
  msg += `📉 ${fromPrice.toFixed(1)} → <b>${currentPrice.toFixed(1)}</b>\n\n`;

  if (isAfter14h) {
    msg += `💀 <b>SAU 14H — GIỜ CALL MARGIN & XẢ KHO!</b>\n\n`;
  }

  if (wasLong) {
    msg += `🛑 <b>ĐÃ THOÁT KHẨN CẤP LONG @ ${currentPrice.toFixed(1)}</b>\n`;
    msg += `• Bảo toàn vốn — Không gồng lỗ khi lái tháo cống!\n\n`;
  }

  msg += `⛔ <b>CẤM TUYỆT ĐỐI BẮT ĐÁY DAO RƠI!</b>\n`;
  msg += `• Chờ thị trường ổn định + nến vol xác nhận đáy\n`;

  if (indicators && indicators.macdAnalysis) {
    msg += `\n📈 MACD: ${indicators.macdAnalysis.zoneDesc}`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 5M BREAKOUT NOTIFICATION ───────────────────────────────
function format5mBreakoutSignal(params) {
  const {
    candle,
    direction,
    indicators,
    oiData,
    plan,
    decision,
    context,
  } = params;

  const isLong = direction === 'LONG';
  const emoji = isLong ? '🟢' : '🔴';
  const confEmoji = decision && decision.confidence >= 80 ? '🔥' : '⚡';

  let msg = `🚀 <b>[5M BREAKOUT] ${direction} — Vol ${candle.volume.toLocaleString()} HĐ (${(indicators.volRatioAvg * 100).toFixed(0)}% MA)</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  // Plan
  msg += `💰 <b>Entry:</b> ${plan.entry.toFixed(1)} | <b>SL:</b> ${plan.sl.toFixed(1)} (-${plan.slDistance}đ)\n`;
  msg += `🎯 <b>TP1:</b> ${plan.tp1.toFixed(1)} (+${plan.tp1Distance}đ, chốt 50%) | <b>TP2:</b> ${plan.tp2.toFixed(1)} (+${plan.tp2Distance}đ)\n\n`;

  // Tại sao
  msg += `📊 <b>TẠI SAO:</b>\n`;
  msg += `• Nến 5M ${candle.time}: ${emoji} Vol <b>${candle.volume.toLocaleString()}</b> HĐ — bùng nổ chuẩn (115-145% MA)\n`;
  msg += `• Giá ${isLong ? 'TRÊN' : 'DƯỚI'} cả MA20 & MA50 — đồng thuận ${isLong ? 'Uptrend' : 'Downtrend'}\n`;

  if (indicators.macdAnalysis) {
    msg += `• MACD 5M: ${indicators.macdAnalysis.zoneDesc}\n`;
  }
  msg += '\n';

  // Context
  if (context && context.supplyDemand) {
    msg += `⚡ NN: <b>${context.supplyDemand.nnNet >= 0 ? '+' : ''}${context.supplyDemand.nnNet.toLocaleString()}</b> HĐ`;
    if (context.basis) msg += ` | Basis: <b>${context.basis.basis >= 0 ? '+' : ''}${context.basis.basis}</b>đ`;
    msg += '\n';
  }

  msg += `\n💡 <i>Khung 5M lọc sạch nhiễu vi mô → Tự tin gồng trọn TP1 & TP2!</i>\n`;

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 5M CONTINUATION ────────────────────────────────────────
function format5mContinuationSignal(params) {
  const {
    candle,
    prevCandle,
    direction,
    indicators,
    ratios,
    context,
  } = params;

  let msg = `🌊 <b>[5M SÓNG ĐẨY] 2 CÂY ${direction} LIÊN TIẾP — Cá mập giữ nhịp</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 <b>Dòng tiền đều đặn:</b>\n`;
  msg += `• Cây 1 (${prevCandle.time}): <b>${prevCandle.volume.toLocaleString()}</b> HĐ (${(ratios.prevRatio * 100).toFixed(0)}% MA)\n`;
  msg += `• Cây 2 (${candle.time}): <b>${candle.volume.toLocaleString()}</b> HĐ (${(ratios.volRatioAvg * 100).toFixed(0)}% MA)\n\n`;

  msg += `✅ 2 cây cùng chiều, vol đều đặn 90-110% MA → <b>Không có lực cản!</b>\n`;
  msg += `👉 <b>TIẾP TỤC GỒNG ${direction}</b> ăn trọn TP1 (+4-6đ) và TP2 (+8-12đ)!\n`;

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── FOMO WARNING ───────────────────────────────────────────
function formatFomoWarning(params) {
  const { candle, indicators, context } = params;

  let msg = `⛔ <b>CẤM FOMO — Vol ${candle.volume.toLocaleString()} HĐ > 2,800!</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 Nến ${candle.time}: ${candle.isGreen ? '🟢' : '🔴'} Vol <b>${candle.volume.toLocaleString()}</b> HĐ\n`;
  msg += `• Body ${candle.body}đ | Râu ↑${candle.upperWick}đ ↓${candle.lowerWick}đ\n\n`;

  msg += `⚠️ Vol trên 2,800 HĐ = đám đông hoảng loạn đu bám!\n`;
  msg += `👉 <b>TUYỆT ĐỐI KHÔNG VÀO LỆNH!</b> Chờ vol hạ nhiệt.\n`;

  if (indicators && indicators.rsiAnalysis) {
    msg += `\n📈 RSI: <b>${indicators.rsiAnalysis.val}</b> ${indicators.rsiAnalysis.momentum}\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v6.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── DAY PNL SUMMARY ────────────────────────────────────────
function formatDayPnL(tradeLog) {
  if (!tradeLog || tradeLog.length === 0) return '';
  const totalPnl = tradeLog.reduce((s, t) => s + t.pnl, 0);
  const wins = tradeLog.filter(t => t.pnl > 0).length;
  const losses = tradeLog.filter(t => t.pnl < 0).length;
  return `📊 Hôm nay: ${tradeLog.length} lệnh (${wins}W/${losses}L) | PnL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}đ</b>`;
}

module.exports = {
  formatEntryNotification,
  formatExitNotification,
  formatTrapShieldAlert,
  formatClimaxAlert,
  formatFlashCrashAlert,
  format5mBreakoutSignal,
  format5mContinuationSignal,
  formatFomoWarning,
  formatDayPnL,
};
