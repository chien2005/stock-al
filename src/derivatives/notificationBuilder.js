/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📱 VN30F v4.4 — Notification Builder (Compact)            ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Format noti Telegram rút gọn, tốc độ cao                   ║
 * ║  Trader liếc nhanh, hành động dứt khoát                     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { vnNow } = require('./dataFetcher');

/**
 * Build notification chính (signal mở vị thế / kế hoạch giao dịch)
 */
function buildSignalNotification(session, analysisResult, deltaData = null) {
  const {
    scoreResult, priceMap, flowResult, absorptionResult, sweepResult,
    velocityResult, efficiencyResult, basisResult, breadthResult, leaderResult, liquidityResult, regimeResult, targetMap,
    supplyDemandResult,
    allData,
  } = analysisResult;

  const sessionLabels = {
    'morning': '🌅 PHIÊN SÁNG',
    'midmorning': '⛅ GIỮA SÁNG',
    'afternoon': '🌆 PHIÊN CHIỀU',
    'update': '🔄 CẬP NHẬT REALTIME',
  };
  const sessionLabel = sessionLabels[session] || '🔄 CẬP NHẬT REALTIME';

  const direction = scoreResult.direction;
  const isTradeable = direction === 'LONG' || direction === 'SHORT';

  let msg = `🔮 <b>VN30F v4.4 — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ─── 1. KHUYẾN NGHỊ / TRẠNG THÁI CHÍNH ──────────────────
  if (isTradeable) {
    const dirIcon = direction === 'LONG' ? '🟢' : '🔴';
    const dirText = direction === 'LONG' ? 'MỞ VỊ THẾ LONG (MUA)' : 'MỞ VỊ THẾ SHORT (BÁN)';
    msg += `${dirIcon} <b>KHUYẾN NGHỊ: ${dirText}</b>\n`;
    msg += `📊 Độ tin cậy: <b>${scoreResult.confidence}/100</b> | Setup: <b>${scoreResult.setupQuality}</b> | Rủi ro: <b>${scoreResult.risk}</b>\n`;
    if (targetMap && targetMap.entry) {
      const tpStr = (targetMap.targets || []).slice(0, 2).map(t => `${t.type}: ${t.price.toFixed(1)}`).join(' | ');
      msg += `🎯 <b>KẾ HOẠCH:</b> Vùng vào <b>${targetMap.entry.zone[0]} – ${targetMap.entry.zone[1]}</b> | ${tpStr} | SL: <b>±${targetMap.hardStop}đ</b>\n`;
    }
    const reasonText = (supplyDemandResult && supplyDemandResult.summaryText)
      ? `${supplyDemandResult.summaryText}`
      : (scoreResult.layerSummaries ? scoreResult.layerSummaries.flow : 'Dòng tiền và cấu trúc xác nhận');
    msg += `⚠️ <b>Lý do:</b> ${reasonText}\n\n`;
  } else {
    msg += `⚪ <b>TRẠNG THÁI: ĐỨNG NGOÀI QUAN SÁT</b>\n`;
    const vetoTypeLabels = {
      'RR_VETO': '🛡️ R:R KHÔNG ĐỦ',
      'SUPPLY_DEMAND_VETO': '⚠️ CUNG CẦU F1 CHƯA ĐỒNG THUẬN',
      'ANTI_WHIPSAW': '⚠️ CHỐNG ĐẢO CHIỀU LIÊN TỤC',
      'RANGE_DAY': '⇔ NGÀY SIDEWAY',
    };
    const vetoLabel = scoreResult.vetoType ? (vetoTypeLabels[scoreResult.vetoType] || '') : '';
    if (vetoLabel) {
      msg += `🛡️ <b>${vetoLabel}</b>\n`;
    }
    msg += `⚠️ <b>Lý do:</b> ${scoreResult.vetoReason || 'Thị trường đang giằng co, chưa có phe nào chiếm ưu thế rõ ràng.'}\n\n`;
  }

  // ─── 2. CHẾ ĐỘ THỊ TRƯỜNG (1 dòng gọn) ────────────────────
  if (regimeResult) {
    const regimeIcons = {
      'TREND_UP': '📈', 'TREND_DOWN': '📉', 'RANGE': '↔️', 'RANGE_DAY': '⇔',
      'TRAP_THEN_TREND': '🪤', 'TWO_SIDED_CHOP': '🔀',
      'LIQUIDITY_VACUUM': '🏜️', 'EXPIRY_DISTORTION': '⚠️',
    };
    let regimeLine = `${regimeIcons[regimeResult.regime] || '↔️'} ${regimeResult.description}`;
    if (regimeResult.expiryMode && regimeResult.expiryMode.mode !== 'NORMAL') {
      regimeLine += ` | 📅 Đáo hạn ${regimeResult.expiryMode.daysToExpiry}d`;
    }
    msg += `${regimeLine}\n\n`;
  }

  // ─── 3. THANH KHOẢN + VNINDEX (1 dòng gọn) ────────────────
  if (deltaData || liquidityResult) {
    let liqLine = '💰';
    if (liquidityResult) {
      const liqPct = Math.round((liquidityResult.volumeRatio || 1) * 100);
      const totalVal = liquidityResult.totalValue != null ? liquidityResult.totalValue.toLocaleString('vi-VN') : '0';
      liqLine += ` VN30: <b>${totalVal}t</b> (${liqPct}%TB)`;
      if (deltaData && deltaData.liqDelta && deltaData.liqDelta.vn30Delta != null) {
        const sign = deltaData.liqDelta.vn30Delta >= 0 ? '+' : '';
        liqLine += ` ${sign}${deltaData.liqDelta.vn30Delta.toLocaleString('vi-VN')}t`;
      }
    }
    if (allData && allData.vnindexPrice) {
      const vnidx = allData.vnindexPrice;
      const vnidxChange = vnidx.prevPrice ? ((vnidx.price - vnidx.prevPrice) / vnidx.prevPrice * 100).toFixed(2) : '0';
      const vnidxIcon = parseFloat(vnidxChange) >= 0 ? '🟢' : '🔴';
      liqLine += ` | VNINDEX: ${vnidxIcon} <b>${Math.round(vnidx.price)}</b> (${parseFloat(vnidxChange) >= 0 ? '+' : ''}${vnidxChange}%)`;
    }
    msg += `${liqLine}\n\n`;

    // ─── 4. VỊ THẾ TAY TO & ĐÁM ĐÔNG (compact) ─────────────────
    const oiTracker = require('./oiTracker');
    const posSnap = (deltaData && deltaData.currentPosition) || oiTracker.getRealtimePositionSnapshot(allData);
    const fmtSign = (num) => {
      if (num == null || isNaN(num)) return '0';
      return num > 0 ? `+${num.toLocaleString('vi-VN')}` : num.toLocaleString('vi-VN');
    };
    const fmtK = (num) => {
      const n = (num == null || isNaN(num)) ? 0 : num;
      return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString('vi-VN');
    };

    msg += `🔥 <b>TAY TO & ĐÁM ĐÔNG:</b>\n`;
    msg += `   NN: <b>${fmtSign(posSnap.foreignNet)}</b> (M${fmtK(posSnap.foreignBuy)}|B${fmtK(posSnap.foreignSell)})`;
    msg += ` | TD: <b>${fmtSign(posSnap.tuDoanhNet)}</b>`;
    if (posSnap.crowdBuy > 0 || posSnap.crowdSell > 0) {
      msg += ` | ĐĐ: <b>${fmtSign(posSnap.crowdNet)}</b> (L${fmtK(posSnap.crowdBuy)}|S${fmtK(posSnap.crowdSell)})`;
    } else {
      msg += ` | ĐĐ: <b>${fmtSign(posSnap.crowdNet)}</b>`;
    }
    msg += `\n`;
    msg += `   OI: <b>${fmtSign(posSnap.oiChange)}</b> (Tổng ${fmtK(posSnap.totalOI)})`;

    if (deltaData && deltaData.positionDelta) {
      const pd = deltaData.positionDelta;
      const fnNetD = pd.foreignNetDelta || 0;
      const oiD = pd.oiDelta || 0;

      let actionDesc = '⚪ Cân bằng';
      if (fnNetD < -100 && oiD > 0) actionDesc = '🔴 Nhồi Short!';
      else if (fnNetD < -100 && oiD <= 0) actionDesc = '🔴 NN xả Short!';
      else if (fnNetD > 100 && oiD > 0) actionDesc = '🟢 Tăng Long!';
      else if (fnNetD > 100 && oiD <= 0) actionDesc = '🟡 Cover Short!';
      else if (fnNetD < -50) actionDesc = '🔴 Nghiêng Short';
      else if (fnNetD > 50) actionDesc = '🟢 Nghiêng Long';

      msg += ` | ${deltaData.timeDiffMin}p: NN <b>${fmtSign(fnNetD)}</b> → <i>${actionDesc}</i>`;
    }
    msg += `\n\n`;

    // ─── 5. VỊ THẾ PHÁI SINH (compact) ────────────────────────
    if (deltaData && deltaData.oiDelta) {
      const oi = deltaData.oiDelta;
      const posLabels = {
        'LONG_BUILDUP': '🟢 LONG MỞ THÊM',
        'SHORT_BUILDUP': '🔴 SHORT MỞ THÊM',
        'LONG_LIQUIDATION': '🟠 LONG THANH LÝ',
        'SHORT_COVERING': '🟡 COVER SHORT',
        'NEUTRAL': '⚪ CÂN BẰNG',
      };
      const deltaOIStr = oi.deltaOI != null ? `${oi.deltaOI >= 0 ? '+' : ''}${oi.deltaOI.toLocaleString('vi-VN')}` : '0';
      msg += `📊 <b>PHÁI SINH ${deltaData.timeDiffMin}p:</b> ΔOI <b>${deltaOIStr}</b>`;
      if (oi.deltaVol > 0) {
        msg += ` | KL <b>${oi.deltaVol.toLocaleString('vi-VN')}</b>`;
      }
      msg += ` | F1M ${oi.priceDelta >= 0 ? '+' : ''}${oi.priceDelta}đ\n`;
      msg += `   ${posLabels[oi.positionState] || oi.positionState}`;
      if (supplyDemandResult && supplyDemandResult.summaryText) {
        msg += ` | <i>${supplyDemandResult.summaryText}</i>`;
      }
      msg += `\n\n`;
    }
  }

  // ─── 6. BẢN ĐỒ GIÁ (compact 1 dòng) ──────────────────────
  if (priceMap && basisResult) {
    msg += `📍 VN30: <b>${basisResult.vn30Price}</b> | F1M: <b>${basisResult.f1mPrice}</b>`;
    if (priceMap.todayRange && priceMap.todayRange.high != null && priceMap.todayRange.low != null) {
      msg += ` | Phiên: <b>${priceMap.todayRange.low.toFixed(1)}</b>→<b>${priceMap.todayRange.high.toFixed(1)}</b>`;
    }
    msg += `\n`;
  }

  // ─── 7. TRAP WARNING (nếu có) ─────────────────────────────
  if (breadthResult && breadthResult.trap && breadthResult.trap.detected) {
    const isTrapLong = breadthResult.trap.detected === 'TRAP_LONG';
    const trapIcon = isTrapLong ? '🪤🔴' : '🪤🟢';
    const trapText = isTrapLong
      ? `BẪY LONG (${breadthResult.greenCount}🟢 nhưng biên độ nhỏ)`
      : `BẪY SHORT (${breadthResult.redCount}🔴 nhưng biên độ nhỏ)`;
    msg += `${trapIcon} <b>${trapText}</b>\n`;
  }

  msg += `\n<i>🔮 VN30F Signal Engine v4.4 — Thiên Hạ Ngũ Tuyệt | VN Stock Bot</i>`;

  return msg;
}

/**
 * Build momentum alert (biến động nhanh)
 */
function buildMomentumAlert(alertType, priceChange, currentPrice, breadthResult) {
  const isUp = alertType === 'SURGE_UP';
  const icon = isUp ? '🚀📈' : '💥📉';
  const dirText = isUp ? 'TĂNG VỌT' : 'GIẢM SỐC';

  let msg = `${icon} <b>CẢNH BÁO BIẾN ĐỘNG NHANH — VN30F ${dirText}!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `⚡ Chỉ số vừa ${isUp ? 'tăng mạnh' : 'giảm mạnh'} <b>${Math.abs(priceChange).toFixed(1)} điểm</b> trong vòng vài phút!\n`;
  msg += `📍 Giá phái sinh hiện tại: <b>${currentPrice.toFixed(1)}</b>\n`;

  if (breadthResult) {
    msg += `📊 Độ rộng: <b>${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴</b>\n`;
  }

  msg += `\n💡 <b>HÀNH ĐỘNG:</b> ${isUp ? 'Không mua đuổi giá trần, đợi nhịp test lại' : 'Không bán đuổi đáy, canh nhịp hồi để xử lý'}\n`;
  msg += `\n<i>🔮 VN30F v4.0 | Momentum Monitor</i>`;
  return msg;
}

/**
 * Build leader reversal alert
 */
function buildLeaderAlert(exhaustion) {
  let msg = `⚠️ <b>CẢNH BÁO TRỤ ĐẢO CHIỀU / MẤT ĐÀ</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const ex of exhaustion) {
    const icon = ex.status === 'EXHAUSTING' ? '⚠️' : ex.status === 'REVERSED' ? '🔴' : '🟢';
    msg += `${icon} Mã <b>${ex.sym}</b>: từ +${ex.peak}% → ${ex.current > 0 ? '+' : ''}${ex.current}%\n`;
    msg += `   → <i>${ex.status === 'EXHAUSTING' ? 'Đang hụt hơi' : ex.status === 'REVERSED' ? 'Đã đảo chiều giảm' : 'Đang hồi phục'}</i>\n`;
  }

  msg += `\n💡 <b>HÀNH ĐỘNG:</b> Trụ dẫn dắt suy yếu thường báo hiệu chỉ số chung sắp điều chỉnh. Cân nhắc hạ tỷ trọng vị thế Long.\n`;
  msg += `\n<i>🔮 VN30F v4.0 | Leader Monitor</i>`;
  return msg;
}

/**
 * Build trap alert
 */
function buildTrapAlert(breadthResult) {
  const isTrapLong = breadthResult.trap.detected === 'TRAP_LONG';
  const icon = isTrapLong ? '🪤🔴' : '🪤🟢';
  const trapName = isTrapLong ? 'BẪY TĂNG GIÁ (TRAP LONG)' : 'BẪY GIẢM GIÁ (TRAP SHORT)';

  let msg = `${icon} <b>PHÁT HIỆN ${trapName}!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 Độ rộng VN30: <b>${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴</b>\n\n`;

  if (isTrapLong) {
    msg += `⚠️ Có tới <b>${breadthResult.greenCount} mã xanh</b> nhưng mức tăng rất nhỏ (<1.2%), không có trụ lớn bứt phá.\n`;
    msg += `→ Đây là dạng kéo điểm dàn trải tạo cảm giác thị trường khỏe.\n`;
    msg += `💡 <b>HÀNH ĐỘNG:</b> Tuyệt đối không Long đuổi, ưu tiên canh Short khi giá chạm kháng cự trên.\n`;
  } else {
    msg += `⚠️ Có tới <b>${breadthResult.redCount} mã đỏ</b> nhưng biên độ giảm nhỏ, không có lực bán tháo ồ ạt.\n`;
    msg += `→ Lái đang ép điểm thăm dò tâm lý.\n`;
    msg += `💡 <b>HÀNH ĐỘNG:</b> Không Short đuổi đáy, quan sát lực gom đỡ giá tại hỗ trợ.\n`;
  }

  msg += `\n<i>🔮 VN30F v4.0 | Trap Detector</i>`;
  return msg;
}

module.exports = {
  buildSignalNotification,
  buildMomentumAlert,
  buildLeaderAlert,
  buildTrapAlert,
};
