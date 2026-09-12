/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📱 VN30F v4.0 — Notification Builder                     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Format noti Telegram 100% tiếng Việt rõ ràng               ║
 * ║  Dễ hiểu cho Trader, có HÀNH ĐỘNG CỤ THỂ, không dùng thuật ngữ khó║
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

  let msg = `🔮 <b>VN30F v4.3 — ${sessionLabel}</b>\n`;
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

  // ─── 2. CHẾ ĐỘ THỊ TRƯỜNG ────────────────────────────────
  if (regimeResult) {
    const regimeIcons = {
      'TREND_UP': '📈', 'TREND_DOWN': '📉', 'RANGE': '↔️', 'RANGE_DAY': '⇔',
      'TRAP_THEN_TREND': '🪤', 'TWO_SIDED_CHOP': '🔀',
      'LIQUIDITY_VACUUM': '🏜️', 'EXPIRY_DISTORTION': '⚠️',
    };
    msg += `🌡️ <b>CHẾ ĐỘ THỊ TRƯỜNG:</b>\n`;
    msg += `${regimeIcons[regimeResult.regime] || '↔️'} ${regimeResult.description}\n`;
    if (regimeResult.expiryMode && regimeResult.expiryMode.mode !== 'NORMAL') {
      msg += `📅 <b>Đáo hạn:</b> ${regimeResult.expiryMode.mode} (Còn ${regimeResult.expiryMode.daysToExpiry} ngày)\n`;
    }
    msg += `\n`;
  }

  // ─── 3. THANH KHOẢN REALTIME ──────────────────────────────
  if (deltaData || liquidityResult) {
    msg += `💰 <b>THANH KHOẢN REALTIME:</b>\n`;

    if (liquidityResult) {
      const liqPct = Math.round(liquidityResult.volumeRatio * 100);
      msg += `   • VN30: <b>${liquidityResult.totalValue.toLocaleString('vi-VN')} tỷ</b> (${liqPct}% TB)`;
      if (deltaData && deltaData.liqDelta && deltaData.liqDelta.vn30Delta != null) {
        const sign = deltaData.liqDelta.vn30Delta >= 0 ? '+' : '';
        msg += ` | Δ${deltaData.timeDiffMin}p: <b>${sign}${deltaData.liqDelta.vn30Delta.toLocaleString('vi-VN')} tỷ</b>`;
      }
      msg += `\n`;
    }

    if (allData && allData.vnindexPrice) {
      const vnidx = allData.vnindexPrice;
      const vnidxChange = vnidx.prevPrice ? ((vnidx.price - vnidx.prevPrice) / vnidx.prevPrice * 100).toFixed(2) : '0';
      const vnidxIcon = parseFloat(vnidxChange) >= 0 ? '🟢' : '🔴';
      msg += `   • VNINDEX: ${vnidxIcon} <b>${vnidx.price.toFixed(2)}</b> (${parseFloat(vnidxChange) >= 0 ? '+' : ''}${vnidxChange}%)\n`;
    }

    // ─── 4. VỊ THẾ TAY TO & ĐÁM ĐÔNG REALTIME ─────────────────
    const oiTracker = require('./oiTracker');
    const posSnap = (deltaData && deltaData.currentPosition) || oiTracker.getRealtimePositionSnapshot(allData);
    const fmtSign = (num) => (num > 0 ? `+${num.toLocaleString('vi-VN')}` : num.toLocaleString('vi-VN'));
    const fmtNum = (num) => (num || 0).toLocaleString('vi-VN');

    msg += `\n🔥 <b>VỊ THẾ TAY TO & ĐÁM ĐÔNG REALTIME:</b>\n`;
    msg += `   • Ròng Khối ngoại: <b>${fmtSign(posSnap.foreignNet)} HĐ</b> (Mua ${fmtNum(posSnap.foreignBuy)} | Bán ${fmtNum(posSnap.foreignSell)})\n`;
    msg += `   • Ròng Tự doanh: <b>${fmtSign(posSnap.tuDoanhNet)} HĐ</b> (Mua ${fmtNum(posSnap.tuDoanhBuy)} | Bán ${fmtNum(posSnap.tuDoanhSell)})\n`;
    if (posSnap.crowdBuy > 0 || posSnap.crowdSell > 0) {
      msg += `   • Ròng Đám đông: <b>${fmtSign(posSnap.crowdNet)} HĐ</b> (Long ${fmtNum(posSnap.crowdBuy)} | Short ${fmtNum(posSnap.crowdSell)})\n`;
    } else {
      msg += `   • Ròng Đám đông: <b>${fmtSign(posSnap.crowdNet)} HĐ</b> (Nhỏ lẻ ôm đối ứng)\n`;
    }
    msg += `   • Biến động OI thay đổi đến thời điểm hiện tại: <b>${fmtSign(posSnap.oiChange)} HĐ</b> (Tổng OI sàn: <b>${fmtNum(posSnap.totalOI)} HĐ</b>)\n`;

    if (deltaData && deltaData.positionDelta) {
      const pd = deltaData.positionDelta;
      const fnNetD = pd.foreignNetDelta || 0;
      const oiD = pd.oiDelta || 0;

      let actionDesc = '⚪ Cân bằng';
      if (fnNetD < -100 && oiD > 0) actionDesc = '🔴 Phe Short được nhồi mới!';
      else if (fnNetD < -100 && oiD <= 0) actionDesc = '🔴 Khối ngoại ép bán xả Short!';
      else if (fnNetD > 100 && oiD > 0) actionDesc = '🟢 Phe Long được gia tăng!';
      else if (fnNetD > 100 && oiD <= 0) actionDesc = '🟡 Khối ngoại cover chốt Short!';
      else if (fnNetD < -50) actionDesc = '🔴 Nghiêng nhồi Short';
      else if (fnNetD > 50) actionDesc = '🟢 Nghiêng gia tăng Long';

      msg += `   • Nhịp ${deltaData.timeDiffMin}p qua: NN <b>${fmtSign(fnNetD)} HĐ</b> (Mua +${fmtNum(pd.foreignBuyDelta)} | Bán +${fmtNum(pd.foreignSellDelta)}) → <i>${actionDesc}</i>\n`;
    }
    msg += `\n`;

    // ─── 5. BIẾN ĐỘNG VN30 (xp qua) ──────────────────────────
    if (deltaData && deltaData.vn30Deltas) {
      const { buyers, sellers } = deltaData.vn30Deltas;
      if (buyers.length > 0 || sellers.length > 0) {
        msg += `🔄 <b>BIẾN ĐỘNG VN30 (${deltaData.timeDiffMin}p qua):</b>\n`;
        if (buyers.length > 0) {
          msg += `   📈 Mua vào: ${buyers.map(b => `<b>${b.sym}</b> (+${b.deltaVal.toFixed(1)}t)`).join(', ')}\n`;
        }
        if (sellers.length > 0) {
          msg += `   📉 Bán ra: ${sellers.map(s => `<b>${s.sym}</b> (${s.deltaVal.toFixed(1)}t)`).join(', ')}\n`;
        }
        msg += `\n`;
      }
    }

    // ─── 6. VỊ THẾ PHÁI SINH (xp qua) ────────────────────────
    if (deltaData && deltaData.oiDelta) {
      const oi = deltaData.oiDelta;
      const posLabels = {
        'LONG_BUILDUP': '🟢 LONG MỞ THÊM (Giá ↑ + OI ↑)',
        'SHORT_BUILDUP': '🔴 SHORT MỞ THÊM (Giá ↓ + OI ↑)',
        'LONG_LIQUIDATION': '🟠 LONG THANH LÝ (Giá ↓ + OI ↓)',
        'SHORT_COVERING': '🟡 SHORT ĐÓNG VỊ THẾ (Giá ↑ + OI ↓)',
        'NEUTRAL': '⚪ CÂN BẰNG',
      };
      msg += `📊 <b>VỊ THẾ PHÁI SINH (${deltaData.timeDiffMin}p qua):</b>\n`;
      msg += `   • Δ OI: <b>${oi.deltaOI >= 0 ? '+' : ''}${oi.deltaOI.toLocaleString('vi-VN')} HĐ</b> (Tổng OI: ${oi.totalOI.toLocaleString('vi-VN')} HĐ)\n`;
      if (oi.deltaVol > 0) {
        msg += `   • KL giao dịch ${deltaData.timeDiffMin}p: <b>${oi.deltaVol.toLocaleString('vi-VN')} HĐ</b>\n`;
      }
      msg += `   • Giá F1M: ${oi.priceDelta >= 0 ? '+' : ''}${oi.priceDelta}đ\n`;
      msg += `   • Trạng thái: <b>${posLabels[oi.positionState] || oi.positionState}</b>\n`;
      if (supplyDemandResult && supplyDemandResult.summaryText) {
        msg += `   • Cung Cầu F1: <i>${supplyDemandResult.summaryText}</i>\n`;
      }
      msg += `\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── 7. BẢN ĐỒ GIÁ REALTIME ──────────────────────────────
  if (priceMap) {
    msg += `📍 <b>BẢN ĐỒ GIÁ REALTIME:</b>\n`;
    if (priceMap.currentPrice && basisResult) {
      msg += `   • VN30: <b>${basisResult.vn30Price}</b> | Phái sinh F1M: <b>${basisResult.f1mPrice}</b>\n`;
    }
    if (priceMap.todayRange && priceMap.todayRange.high) {
      msg += `   • Biên độ phiên nay: <b>${priceMap.todayRange.low?.toFixed(1)}</b> → <b>${priceMap.todayRange.high?.toFixed(1)}</b>\n\n`;
    }

    msg += `   <b>Các mốc cản & hỗ trợ quan trọng:</b>\n\n`;
    const keyLevels = Array.isArray(priceMap.levels) ? priceMap.levels.slice(0, 6) : [];
    for (const lvl of keyLevels) {
      const icon = lvl.type === 'RESISTANCE' || lvl.type === 'VAH' ? '🔴'
        : lvl.type === 'SUPPORT' || lvl.type === 'VAL' ? '🟢'
        : lvl.type === 'POC' || lvl.type === 'VWAP' ? '🟡' : '⚪';
      msg += `   ${icon} <b>${lvl.price.toFixed(1)}</b> — ${lvl.label}\n`;
    }
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── 8. ĐỘ RỘNG & XUNG LỰC ───────────────────────────────
  if (breadthResult) {
    msg += `🔥 <b>ĐỘ RỘNG & XUNG LỰC:</b>\n`;
    msg += `   • Độ rộng VN30: <b>${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴</b>\n`;
    msg += `   • Nhóm Ngân hàng: <b>${breadthResult.bank.label}</b> (${breadthResult.bank.greenCount}/${breadthResult.bank.totalCount} mã xanh)\n`;

    if (velocityResult) {
      msg += `   • Tốc độ biến động: <b>${velocityResult.label}</b>\n`;
    }

    if (efficiencyResult) {
      msg += `   • Trạng thái sóng: <b>${efficiencyResult.label}</b>\n`;
      msg += `     → <i>${efficiencyResult.actionAdvice}</i>\n`;
    }

    if (breadthResult.trap && breadthResult.trap.detected) {
      const isTrapLong = breadthResult.trap.detected === 'TRAP_LONG';
      const trapIcon = isTrapLong ? '🪤🔴' : '🪤🟢';
      const trapText = isTrapLong
        ? `CẢNH BÁO BẪY LONG (${breadthResult.greenCount} mã xanh nhưng biên độ rất nhỏ)`
        : `CẢNH BÁO BẪY SHORT (${breadthResult.redCount} mã đỏ nhưng biên độ rất nhỏ)`;
      msg += `   ${trapIcon} <b>${trapText}</b>\n`;
    }

    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── 9. ĐÁNH GIÁ TỔNG HỢP ────────────────────────────────
  if (scoreResult.layerSummaries) {
    msg += `📊 <b>ĐÁNH GIÁ TỔNG HỢP:</b>\n`;
    msg += `   • 🟥 Cấu trúc đồ thị: ${scoreResult.layerSummaries.structure}\n`;
    msg += `   • 🟦 Dòng tiền chủ động: ${scoreResult.layerSummaries.flow}\n`;
    msg += `   • 🟨 Độ rộng thị trường: ${scoreResult.layerSummaries.breadth}\n`;
    msg += `   • 🟩 Chế độ thị trường: ${scoreResult.layerSummaries.regime}\n`;

    if (scoreResult.layerSummaries.macroBias && scoreResult.layerSummaries.macroBias !== 'NEUTRAL') {
      const biasIcon = scoreResult.layerSummaries.macroBias === 'BULLISH' ? '🟢' : '🔴';
      const biasText = scoreResult.layerSummaries.macroBias === 'BULLISH' ? 'TĂNG (EMA50)' : 'GIẢM (EMA50)';
      msg += `   • 🌍 Xu hướng lớn: ${biasIcon} <b>${biasText}</b>\n`;
    }

    msg += `\n`;
    if (isTradeable) {
      msg += `   → <b>KẾT LUẬN:</b> Ưu tiên vị thế <b>${direction}</b> theo đúng kế hoạch trên, tuân thủ kỷ luật cắt lỗ.\n`;
    } else {
      msg += `   → <b>KẾT LUẬN:</b> Hai phe chưa có ưu thế rõ ràng. <b>Kiên nhẫn đứng ngoài</b> chờ giá chạm các vùng cản/hỗ trợ lớn.\n`;
    }
  }

  msg += `\n<i>🔮 VN30F Signal Engine v4.3 — Thiên Hạ Ngũ Tuyệt | VN Stock Bot</i>`;

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
