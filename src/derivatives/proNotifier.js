/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📱 VN30F v7.0 — Pro 5-Layer Notification Formatter          ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Chuẩn phong cách Senior Prop Trader & Playbook VN30F Hybrid: ║
 * ║  3 GIÂY ĐỂ HIỂU HÀNH ĐỘNG CẦN LÀM, KHÔNG LÝ THUYẾT SUÔNG:     ║
 * ║                                                               ║
 * ║  • Header: Khuyến nghị dứt khoát + Tên Setup + Độ tin cậy %  ║
 * ║  • Plan giao dịch: Entry, SL (MTL), TP1 (50%), TP2           ║
 * ║  • 01. Cấu Trúc Thị Trường (Thị trường đang ở đâu?)          ║
 * ║  • 02. Vùng Giá Quan Trọng (Giá đang ở vị trí nào?)          ║
 * ║  • 03. Hành Động Giá & Dòng Tiền (Điều gì đang xảy ra?)       ║
 * ║  • 04. Khối Lượng Tương Đối (Vol đạt hay bẫy thanh khoản?)   ║
 * ║  • 05. Giám Sát 7 Trụ Điều Tiết (Có bẫy kéo trụ ảo không?)   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { formatPillarsForNotification, TRACKED_PILLARS } = require('./pillarMonitor');

// ─── HELPERS ─────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getVnTimeHHMMSS() {
  const { config } = require('../config');
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ─── 1. ENTRY NOTIFICATION (5-LAYER HYBRID) ──────────────────
/**
 * Notification mở vị thế chuẩn 5 lớp Hybrid Playbook
 */
function formatEntryNotification(params) {
  const {
    candle,
    direction,            // 'LONG' or 'SHORT'
    decision,             // from calculateConfidence()
    plan,                 // from generateTradePlan()
    indicators,
    context,              // from buildMarketContext()
    marketStructureData,  // from marketStructure.buildPriceMap()
    flowData,             // from flowEngine.analyzeFlow()
    pillarAnalysis,       // from pillarMonitor.analyzePillars()
    liquidityInfo,        // from intradaySignalEngine.calculateMarketLiquiditySpeed()
    volRatio,
  } = params;

  const isLong = direction === 'LONG';
  const emoji = isLong ? '🟢' : '🔴';
  const confEmoji = decision.confidence >= 80 ? '🔥' : decision.confidence >= 65 ? '⚡' : '⚠️';
  const setupLabel = decision.setupLabel || (isLong ? 'Xung lực Long' : 'Xung lực Short');
  const modeLabel = plan.liquidityMode === 'SCALP' ? 'SCALP CHỐT NHANH' : 'TREND GỒNG LÃI';

  let msg = '';

  // ─── HEADER: KHUYẾN NGHỊ DỨT KHOÁT + SETUP + ĐỘ TIN CẬY ──────
  msg += `${emoji} <b>MỞ ${direction} [${setupLabel}]</b>\n`;
  msg += `🎯 Độ tin cậy: <b>${decision.confidence}%</b> ${confEmoji} | Chế độ: <b>${modeLabel}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ─── PLAN GIAO DỊCH THỰC CHIẾN ──────────────────────────────
  msg += `💰 <b>KẾ HOẠCH GIAO DỊCH:</b>\n`;
  msg += `• <b>Entry:</b> <b>${plan.entry.toFixed(1)}</b> | <b>SL:</b> <b>${plan.sl.toFixed(1)}</b> (-${plan.slDistance}đ MTL)\n`;
  msg += `• <b>TP1:</b> <b>${plan.tp1.toFixed(1)}</b> (+${plan.tp1Distance}đ, chốt 50% & dời hòa)\n`;
  msg += `• <b>TP2:</b> <b>${plan.tp2.toFixed(1)}</b> (+${plan.tp2Distance}đ, ${plan.liquidityMode === 'SCALP' ? 'chốt hết' : 'gồng trailing stop'})\n`;
  msg += `• Tỷ lệ R:R: <b>${plan.rr1}</b> (TP1) / <b>${plan.rr2}</b> (TP2)\n\n`;

  // ─── 01. CẤU TRÚC THỊ TRƯỜNG (MARKET STRUCTURE) ─────────────
  msg += `1️⃣ <b>CẤU TRÚC THỊ TRƯỜNG:</b>\n`;
  if (marketStructureData) {
    const waveTxt = marketStructureData.waveStructure === 'HIGHER_HIGHS_HIGHER_LOWS'
      ? 'Uptrend (Nâng đỉnh - Nâng đáy) 🟢'
      : marketStructureData.waveStructure === 'LOWER_HIGHS_LOWER_LOWS'
      ? 'Downtrend (Hạ đỉnh - Hạ đáy) 🔴'
      : 'Sideway / Dao động tích lũy 🟡';
    msg += `• Trạng thái sóng: <b>${waveTxt}</b>\n`;
    msg += `• Xu hướng chủ đạo: <b>${marketStructureData.trendBias || 'NEUTRAL'}</b> (Lực: ${marketStructureData.trendStrength || 0}%)\n`;
  } else if (indicators && indicators.ma9_26Analysis) {
    msg += `• MA: <b>${indicators.ma9_26Analysis.isUptrend ? 'Uptrend MA9 > MA26 🟢' : 'Downtrend MA9 < MA26 🔴'}</b>\n`;
  }
  msg += '\n';

  // ─── 02. VÙNG GIÁ QUAN TRỌNG (KEY LEVELS & VWAP) ────────────
  msg += `2️⃣ <b>VÙNG GIÁ QUAN TRỌNG (KEY LEVELS):</b>\n`;
  if (marketStructureData) {
    if (marketStructureData.vwap) {
      const vwapDiff = candle.close - marketStructureData.vwap;
      const vwapSign = vwapDiff >= 0 ? '+' : '';
      msg += `• VWAP: <b>${marketStructureData.vwap.toFixed(1)}</b> (Giá đang ${vwapSign}${vwapDiff.toFixed(1)}đ so với VWAP)\n`;
    }
    if (marketStructureData.poc) {
      msg += `• Volume Profile: POC <b>${marketStructureData.poc.toFixed(1)}</b>`;
      if (marketStructureData.vah && marketStructureData.val) {
        msg += ` | VAH ${marketStructureData.vah.toFixed(1)} - VAL ${marketStructureData.val.toFixed(1)}`;
      }
      msg += '\n';
    }
    const zoneDesc = marketStructureData.currentZone === 'AT_SUPPORT'
      ? 'Tại Hỗ trợ tốt 🟢'
      : marketStructureData.currentZone === 'AT_RESISTANCE'
      ? 'Tại Kháng cự 🔴'
      : 'Vùng giữa biên dao động ⚪';
    msg += `• Vị trí giá: <b>${zoneDesc}</b>\n`;
  } else {
    msg += `• Giá hiện tại: <b>${candle.close.toFixed(1)}</b>\n`;
  }
  msg += '\n';

  // ─── 03. HÀNH ĐỘNG GIÁ & DÒNG LỆNH (PA + FLOW) ──────────────
  msg += `3️⃣ <b>HÀNH ĐỘNG GIÁ & DÒNG LỆNH (PA + FLOW):</b>\n`;
  msg += `• Nến ${candle.time}: ${candle.isGreen ? '🟢 Tăng' : '🔴 Giảm'} | Thân ${candle.body.toFixed(1)}đ`;
  if (candle.upperWick > 0.5 || candle.lowerWick > 0.5) {
    msg += ` (Râu trên: ${candle.upperWick.toFixed(1)}đ, Râu dưới: ${candle.lowerWick.toFixed(1)}đ)`;
  }
  msg += '\n';

  if (flowData && flowData.delta) {
    const deltaSign = flowData.delta.current >= 0 ? '+' : '';
    msg += `• Dòng lệnh Flow: Delta <b>${deltaSign}${flowData.delta.current} HĐ</b> (${flowData.delta.trend})\n`;
    if (flowData.absorption && flowData.absorption.detected) {
      msg += `• Hấp thụ: <b>${flowData.absorption.type === 'BOTTOM_ABSORPTION' ? '🟢 Hấp thụ đáy' : '🔴 Hấp thụ đỉnh'}</b> (${flowData.absorption.strength})\n`;
    }
  }

  // Mẫu hình VSA nếu có
  if (decision.reasons && decision.reasons.length > 0) {
    const vsaReason = decision.reasons.find(r => r.includes('Engulfing') || r.includes('Hammer') || r.includes('Star') || r.includes('búa'));
    if (vsaReason) {
      msg += `• Mẫu hình: <b>${vsaReason}</b>\n`;
    }
  }
  msg += '\n';

  // ─── 04. KHỐI LƯỢNG TƯƠNG ĐỐI & THANH KHOẢN THỊ TRƯỜNG ──────
  msg += `4️⃣ <b>KHỐI LƯỢNG TƯƠNG ĐỐI & THANH KHOẢN:</b>\n`;
  msg += `• Vol nến 1p: <b>${candle.volume.toLocaleString()} HĐ</b>`;
  if (volRatio) {
    msg += ` (<b>${(volRatio * 100).toFixed(0)}%</b> MA20 Vol)`;
  }
  msg += '\n';

  if (liquidityInfo) {
    msg += `• Tốc độ TT: <b>${liquidityInfo.speed} tỷ/phút</b> | Dự phóng: <b>${liquidityInfo.projectedTotal?.toLocaleString()} tỷ</b>\n`;
    if (liquidityInfo.isLowLiquidity) {
      msg += `• Lưu ý: <i>Thanh khoản thấp → Bắt buộc chốt nhanh, không gồng non, chống bẫy fake breakout!</i>\n`;
    }
  }
  msg += '\n';

  // ─── 05. GIÁM SÁT 7 TRỤ ĐIỀU TIẾT (VN30/VNINDEX) ─────────────
  if (pillarAnalysis && pillarAnalysis.pillars) {
    const p = pillarAnalysis.pillars;
    const pItems = TRACKED_PILLARS.map(s => {
      const item = p[s];
      if (!item) return `${s}: N/A`;
      const sign = item.changePct > 0 ? '+' : '';
      return `${s}: ${sign}${item.changePct.toFixed(1)}% ${item.emoji}`;
    });
    msg += `5️⃣ <b>7 TRỤ ĐIỀU TIẾT (VIC, VPL, VHM, MCH, VCB, GAS, VJC):</b>\n`;
    msg += `• ${pItems.slice(0, 4).join(' | ')}\n`;
    msg += `• ${pItems.slice(4).join(' | ')}\n`;
    msg += `👉 Trạng thái Trụ: <b>${pillarAnalysis.consensusLabel}</b>\n`;

    if (pillarAnalysis.manipulationWarnings && pillarAnalysis.manipulationWarnings.length > 0) {
      for (const w of pillarAnalysis.manipulationWarnings) {
        msg += `${w}\n`;
      }
    }
    msg += '\n';
  }

  // ─── CẢNH BÁO NẾU CÓ ─────────────────────────────────────────
  if (decision.warnings && decision.warnings.length > 0) {
    msg += `⚠️ <b>CẢNH BÁO RỦI RO:</b>\n`;
    for (const w of decision.warnings.slice(0, 2)) {
      msg += `• <i>${escapeHtml(w)}</i>\n`;
    }
    msg += '\n';
  }

  // ─── BỐI CẢNH & GHI CHÚ SENIOR TRADER ───────────────────────
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  if (context) {
    let ctxLine = [];
    if (context.session) ctxLine.push(`${context.session.emoji} ${context.session.name}`);
    if (context.basis) ctxLine.push(`Basis: <b>${context.basis.basis >= 0 ? '+' : ''}${context.basis.basis}đ</b>`);
    if (context.supplyDemand) ctxLine.push(`NN: <b>${context.supplyDemand.nnNet >= 0 ? '+' : ''}${context.supplyDemand.nnNet.toLocaleString()} HĐ</b>`);
    if (ctxLine.length > 0) {
      msg += `⚡ ${ctxLine.join(' | ')}\n`;
    }
  }
  msg += `💡 <i>Kỷ luật: Khớp xong set ngay lệnh cắt lỗ MTL, không dời lỗ xa hơn!</i>\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 2. EXIT NOTIFICATION ────────────────────────────────────
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
    pillarAnalysis,
  } = params;

  const pnlEmoji = trade.pnl >= 0 ? '✅' : '❌';
  const pnlStr = `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(1)}đ`;

  let msg = '';

  if (isReverse) {
    const reverseEmoji = newDirection === 'LONG' ? '🟢' : '🔴';
    msg += `🔄 <b>ĐÓNG ${trade.type} ${pnlStr}</b> ➔ <b>ĐẢO ${newDirection}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `${pnlEmoji} Đóng ${trade.type} @ <b>${trade.exitPrice.toFixed(1)}</b> (${pnlStr})\n`;
    msg += `${reverseEmoji} Mở mới ${newDirection} @ <b>${candle.close.toFixed(1)}</b>\n\n`;

    if (newPlan) {
      msg += `💰 <b>Plan mới:</b> SL: <b>${newPlan.sl.toFixed(1)}</b> (-${newPlan.slDistance}đ) | TP1: <b>${newPlan.tp1.toFixed(1)}</b> | TP2: <b>${newPlan.tp2.toFixed(1)}</b>\n\n`;
    }
  } else {
    msg += `${pnlEmoji} <b>ĐÓNG VỊ THẾ ${trade.type} — ${pnlStr}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `📋 Entry: <b>${trade.entryPrice.toFixed(1)}</b> ➔ Exit: <b>${trade.exitPrice.toFixed(1)}</b>\n`;
    msg += `📊 Kết quả: <b>${pnlStr}</b> | Đỉnh lãi chạm tới: <b>+${trade.maxProfit.toFixed(1)}đ</b>\n\n`;
  }

  // Lý do đóng vị thế
  msg += `💡 <b>LÝ DO:</b> ${trade.reason}\n`;
  msg += `📊 Nến trigger: ${candle.time} (${candle.isGreen ? '🟢' : '🔴'}) | Vol: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

  // Nhắc nhẹ trụ điều tiết nếu có
  if (pillarAnalysis && pillarAnalysis.consensusLabel) {
    msg += `🏛️ Nhóm 7 trụ: <i>${pillarAnalysis.consensusLabel}</i>\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 3. TRAP SHIELD ALERT ───────────────────────────────────
function formatTrapShieldAlert(params) {
  const {
    level,
    candle,
    priceChange,
    currentPosition,
    context,
    pillarAnalysis,
  } = params;

  const isLevel1 = level === 1;
  const alertEmoji = isLevel1 ? '🚨' : '⚠️';
  const levelDesc = isLevel1
    ? 'MỨC 1 — BƠM/ĐẠP ĐỂU (VOL KIỆT QUỆ, 100% BẪY LÁI)'
    : 'MỨC 2 — KÉO/XẢ ẢO (THIẾU DÒNG TIỀN XÁC NHẬN)';

  let msg = `${alertEmoji} <b>[TRAP SHIELD v7.0] ${levelDesc}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `⚡ Giá giật <b>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}đ</b> nhưng Vol chỉ <b>${candle.volume.toLocaleString()} HĐ</b>!\n`;
  msg += `📊 Cảnh báo: Thị trường thanh khoản thấp, lái dùng lệnh mỏng vẽ nến dụ con mồi.\n\n`;

  // Kiểm tra trụ điều tiết có đang kéo ảo không
  if (pillarAnalysis && pillarAnalysis.manipulationWarnings && pillarAnalysis.manipulationWarnings.length > 0) {
    msg += `🏛️ <b>DẤU VẾT ĐIỀU TIẾT TRỤ:</b>\n`;
    for (const w of pillarAnalysis.manipulationWarnings) {
      msg += `• ${w}\n`;
    }
    msg += '\n';
  }

  msg += `🛡️ <b>HÀNH ĐỘNG TUÂN THỦ:</b>\n`;
  msg += `• <b>KHÓA MỞ VỊ THẾ MỚI 2 PHÚT!</b>\n`;

  if (currentPosition === 'LONG') {
    msg += `• Đang LONG ➔ <b>CẤM BÁN THÁO, CẤM ĐẢO SHORT!</b> Đòn dọa quét SL điển hình.\n`;
  } else if (currentPosition === 'SHORT') {
    msg += `• Đang SHORT ➔ <b>CẤM CẮT LỖ NON, CẤM ĐU LONG!</b> Đòn kéo ảo ép cover.\n`;
  } else {
    msg += `• ĐANG ĐỨNG NGOÀI ➔ <b>TUYỆT ĐỐI KHÔNG FOMO!</b> Đợi nến có vol thật.\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🛡️ Trap Shield v7.0 | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 4. PILLAR MANIPULATION ALERT (Cảnh báo riêng về Trụ) ───
function formatPillarAlert(params) {
  const { pillarAnalysis, currentPrice, currentPosition } = params;

  let msg = `🏛️🚨 <b>CẢNH BÁO BẪY ĐIỀU TIẾT 7 TRỤ (VN30/VNINDEX)</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (pillarAnalysis.manipulationWarnings && pillarAnalysis.manipulationWarnings.length > 0) {
    for (const w of pillarAnalysis.manipulationWarnings) {
      msg += `• ${w}\n`;
    }
    msg += '\n';
  }

  msg += formatPillarsForNotification(pillarAnalysis);
  msg += `\n`;

  msg += `💡 <b>LỜI KHUYÊN SENIOR TRADER:</b>\n`;
  msg += `• Phái sinh VN30F thường xuyên bị chi phối bởi lệnh khớp cơ sở ở VIC, VHM, VCB...\n`;
  msg += `• Khi chỉ số bị kéo lệch bởi 1 vài trụ, tuyệt đối KHÔNG đua lệnh breakout!\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 5. CLIMAX ALERT ────────────────────────────────────────
function formatClimaxAlert(params) {
  const {
    candle,
    timeframe,
    volRatio,
    currentPosition,
    indicators,
  } = params;

  const isGreen = candle.isGreen;
  const tfLabel = timeframe === '5M' ? '5M' : '1M';

  let msg = `🔥🔥🔥 <b>[${tfLabel} CLIMAX] CAO TRÀO — Vol ${candle.volume.toLocaleString()} HĐ</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (isGreen) {
    msg += `⚡ <b>ĐỈNH MUA CAO TRÀO (BUYING CLIMAX):</b>\n`;
    msg += `• Tay to CHỐT LỜI trên đỉnh + Đám đông FOMO mua đuổi!\n`;
    msg += `• <b>CẤM TUYỆT ĐỐI ĐU LONG VÀO CÂY NÀY!</b>\n\n`;
  } else {
    msg += `⚡ <b>ĐÁY BÁN THÁO CAO TRÀO (SELLING CLIMAX):</b>\n`;
    msg += `• Tay to HẤP THỤ gom hàng đáy + Nhỏ lẻ hoảng loạn xả hoảng!\n`;
    msg += `• <b>CẤM BỒI SHORT! CẤM BÁN THÁO THEO!</b>\n\n`;
  }

  msg += `📊 Vol: <b>${candle.volume.toLocaleString()}</b> HĐ`;
  if (volRatio) msg += ` (<b>${(volRatio * 100).toFixed(0)}%</b> MA Vol)`;
  msg += `\n`;
  msg += `📊 Nến: ${isGreen ? '🟢' : '🔴'} Body ${candle.body.toFixed(1)}đ | Râu ↑${candle.upperWick.toFixed(1)}đ ↓${candle.lowerWick.toFixed(1)}đ\n\n`;

  if (currentPosition !== 'NONE') {
    const dir = currentPosition;
    const isSameDir = (dir === 'LONG' && isGreen) || (dir === 'SHORT' && !isGreen);
    if (isSameDir) {
      msg += `🛑 Đang ${dir} ➔ <b>CHỐT LỜI BẢO TOÀN LÃI NGAY!</b>\n`;
    } else {
      msg += `✅ Đang ${dir} ➔ Chiều ngược đỉnh/đáy ➔ Giữ chặt vị thế\n`;
    }
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 6. FLASH CRASH ALERT ───────────────────────────────────
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
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `⚡ Giá tụt <b>-${dropPts.toFixed(1)} điểm</b> trong <b>${dropWindow}</b>!\n`;
  msg += `📉 ${fromPrice.toFixed(1)} ➔ <b>${currentPrice.toFixed(1)}</b>\n\n`;

  if (isAfter14h) {
    msg += `💀 <b>SAU 14H — GIỜ CALL MARGIN KHO & ĐẠP ÉP ĐÓNG VỊ THẾ!</b>\n\n`;
  }

  if (wasLong) {
    msg += `🛑 <b>ĐÃ THOÁT KHẨN CẤP VỊ THẾ LONG @ ${currentPrice.toFixed(1)}</b>\n`;
    msg += `• Kỷ luật sinh tồn số 1 — Không gồng lỗ khi lái tháo cống!\n\n`;
  }

  msg += `⛔ <b>CẤM TUYỆT ĐỐI BẮT ĐÁY DAO RƠI!</b> Chờ giá ngưng rơi và có vol hấp thụ.\n`;

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 7. 5M BREAKOUT SIGNAL ──────────────────────────────────
function format5mBreakoutSignal(params) {
  const {
    candle,
    direction,
    indicators,
    oiData,
    plan,
    decision,
    context,
    pillarAnalysis,
  } = params;

  const isLong = direction === 'LONG';
  const emoji = isLong ? '🟢' : '🔴';
  const confEmoji = decision && decision.confidence >= 80 ? '🔥' : '⚡';

  let msg = `🚀 <b>[5M BREAKOUT] ${direction} — Vol ${candle.volume.toLocaleString()} HĐ</b>\n`;
  msg += `🎯 Độ tin cậy: <b>${decision?.confidence || 75}%</b> ${confEmoji}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `💰 <b>Plan 5M:</b> Entry: <b>${plan.entry.toFixed(1)}</b> | SL: <b>${plan.sl.toFixed(1)}</b> (-${plan.slDistance}đ)\n`;
  msg += `🎯 TP1: <b>${plan.tp1.toFixed(1)}</b> (+${plan.tp1Distance}đ) | TP2: <b>${plan.tp2.toFixed(1)}</b> (+${plan.tp2Distance}đ)\n\n`;

  msg += `📊 <b>XÁC NHẬN ĐA LỚP:</b>\n`;
  msg += `• Nến 5M ${candle.time}: ${emoji} Vol bùng nổ chuẩn (${(indicators.volRatioAvg * 100).toFixed(0)}% MA Vol)\n`;
  msg += `• Vị thế: Giá ${isLong ? 'TRÊN' : 'DƯỚI'} cả MA20 & MA50 khung 5 phút\n`;

  if (pillarAnalysis && pillarAnalysis.consensusLabel) {
    msg += `• 7 Trụ điều tiết: <b>${pillarAnalysis.consensusLabel}</b>\n`;
  }
  msg += '\n';

  if (context && context.supplyDemand) {
    msg += `⚡ NN: <b>${context.supplyDemand.nnNet >= 0 ? '+' : ''}${context.supplyDemand.nnNet.toLocaleString()} HĐ</b>`;
    if (context.basis) msg += ` | Basis: <b>${context.basis.basis >= 0 ? '+' : ''}${context.basis.basis}đ</b>`;
    msg += '\n';
  }

  msg += `\n💡 <i>Khung 5M lọc nhiễu vi mô rất tốt — Tự tin bám theo kế hoạch!</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 8. 5M CONTINUATION ─────────────────────────────────────
function format5mContinuationSignal(params) {
  const {
    candle,
    prevCandle,
    direction,
    indicators,
    ratios,
    context,
    plan,
  } = params;

  let msg = `🌊 <b>[5M SÓNG ĐẨY] 2 NẾN ${direction} LIÊN TIẾP — Dòng tiền giữ nhịp</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 <b>DÒNG TIỀN ĐỀU ĐẶN KHÔNG CẢN:</b>\n`;
  msg += `• Nến 1 (${prevCandle.time}): <b>${prevCandle.volume.toLocaleString()} HĐ</b> (${(ratios.prevRatio * 100).toFixed(0)}% MA)\n`;
  msg += `• Nến 2 (${candle.time}): <b>${candle.volume.toLocaleString()} HĐ</b> (${(ratios.volRatioAvg * 100).toFixed(0)}% MA)\n\n`;

  msg += `✅ 2 nến 5p đẩy dứt khoát không có râu ngược ➔ <b>Phe đối lập bỏ vị thế!</b>\n`;
  msg += `👉 <b>TIẾP TỤC GỒNG VỊ THẾ ${direction}</b> tới mục tiêu lớn!\n`;

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 9. FOMO WARNING (Cải tiến với phân tích Low Liquidity Trap) ──
function formatFomoWarning(params) {
  const { candle, indicators, context, liquidityInfo, pillarAnalysis } = params;

  let msg = `⛔ <b>CẤNH BÁO BẪY FOMO & VOL ĐỘT BIẾN!</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 Nến ${candle.time}: ${candle.isGreen ? '🟢' : '🔴'} Vol <b>${candle.volume.toLocaleString()} HĐ</b>\n`;
  msg += `• Biên độ thân nến: ${candle.body.toFixed(1)}đ | Râu trên: ${candle.upperWick.toFixed(1)}đ | Râu dưới: ${candle.lowerWick.toFixed(1)}đ\n\n`;

  msg += `⚠️ <b>TẠI SAO CẤM ĐU LỆNH:</b>\n`;
  msg += `• Trong môi trường thanh khoản thấp, vol vọt lên đột biến thường là nến chốt lời của tay to hoặc bẫy quét thanh khoản đỉnh/đáy (Liquidity Sweep)!\n`;
  msg += `• Khả năng cao giá sẽ đảo chiều hoặc quét ngược 2-4 điểm ngay sau đó.\n`;

  if (pillarAnalysis && pillarAnalysis.manipulationWarnings && pillarAnalysis.manipulationWarnings.length > 0) {
    msg += `• Phát hiện điều tiết: <i>${pillarAnalysis.manipulationWarnings[0]}</i>\n`;
  }

  msg += `\n👉 <b>HÀNH ĐỘNG:</b> Giữ nguyên vị thế hiện tại hoặc chốt bớt lãi, TUYỆT ĐỐI KHÔNG mở mới!\n`;

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 VN30F v7.0 Hybrid | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 10. STAND ASIDE / TRAP SHIELD NOTIFICATION ────────────
/**
 * Thông báo vị thế: ĐỨNG NGOÀI QUAN SÁT (STAND ASIDE)
 * Khi thị trường thiếu cơ sở, dính bẫy sát Hỗ trợ / Kháng cự, hoặc cạn thanh khoản
 */
function formatStandAsideNotification(params) {
  const {
    candle,
    direction,            // Hướng tín hiệu bị từ chối ('SHORT' hoặc 'LONG')
    decision,             // from calculateConfidence()
    reason,               // Lý do từ chối vào lệnh
    marketStructureData,
    indicators,
    context,
    pillarAnalysis,
    liquidityInfo,
  } = params;

  let msg = `⏸️ <b>TRẠNG THÁI: ĐỨNG NGOÀI QUAN SÁT (STAND ASIDE)</b>\n`;
  msg += `🛡️ <b>PHÁT HIỆN BẪY: ${escapeHtml(reason || decision?.standAsideReason || 'Chưa đủ điều kiện 5 lớp xác nhận')}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. Vị trí giá & Key Levels
  msg += `1️⃣ <b>VỊ TRÍ GIÁ & CẢN / HỖ TRỢ:</b>\n`;
  if (candle) {
    msg += `• Giá hiện tại: <b>${candle.close.toFixed(1)}</b> (Nến ${candle.time})\n`;
  }
  if (marketStructureData) {
    if (marketStructureData.nearestSupport) {
      const dist = Math.abs(candle.close - marketStructureData.nearestSupport.price).toFixed(1);
      msg += `• Hỗ trợ gần nhất: <b>${marketStructureData.nearestSupport.price.toFixed(1)}</b> (Cách ${dist}đ) 🧱\n`;
    }
    if (marketStructureData.nearestResistance) {
      const dist = Math.abs(marketStructureData.nearestResistance.price - candle.close).toFixed(1);
      msg += `• Kháng cự gần nhất: <b>${marketStructureData.nearestResistance.price.toFixed(1)}</b> (Cách ${dist}đ) 🚧\n`;
    }
    if (marketStructureData.vwap) {
      const vwapDiff = candle.close - marketStructureData.vwap;
      msg += `• VWAP: <b>${marketStructureData.vwap.toFixed(1)}</b> (Độ lệch: <b>${vwapDiff >= 0 ? '+' : ''}${vwapDiff.toFixed(1)}đ</b>)\n`;
    }
  }
  msg += '\n';

  // 2. Cảnh báo kỹ thuật
  msg += `2️⃣ <b>CẢNH BÁO RỦI RO:</b>\n`;
  if (decision && decision.warnings && decision.warnings.length > 0) {
    for (const w of decision.warnings.slice(0, 3)) {
      msg += `• ${escapeHtml(w)}\n`;
    }
  } else {
    msg += `• Thiếu dòng tiền xác nhận, biên độ biến động rủi ro cao\n`;
  }
  msg += '\n';

  // 3. Giám sát 7 trụ
  if (pillarAnalysis && pillarAnalysis.pillars) {
    msg += `3️⃣ <b>7 TRỤ ĐIỀU TIẾT:</b>\n`;
    msg += formatPillarsForNotification(pillarAnalysis) + '\n\n';
  }

  // 4. Lời khuyên Senior Trader
  msg += `💡 <b>NGUYÊN TẮC QUẢN TRỊ VỐN:</b>\n`;
  msg += `<i>"Tiền trong túi là tiền của mình. Cấm bán vào hỗ trợ, cấm mua vào kháng cự khi chưa có xác nhận phá vỡ. Kiên nhẫn đứng ngoài quan sát!"</i>\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>⏱ VN30F v7.0 Stand Aside Shield | ${getVnTimeHHMMSS()}</i>`;

  return msg;
}

// ─── 11. DAY PNL SUMMARY ─────────────────────────────────────
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
  formatStandAsideNotification,
  formatPillarAlert,
  formatClimaxAlert,
  formatFlashCrashAlert,
  format5mBreakoutSignal,
  format5mContinuationSignal,
  formatFomoWarning,
  formatDayPnL,
};
