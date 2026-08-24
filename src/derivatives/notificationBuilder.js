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
    allData,
  } = analysisResult;

  const sessionLabels = {
    'morning': '🌅 PHIÊN SÁNG',
    'midmorning': '⛅ GIỮA SÁNG',
    'afternoon': '🌆 PHIÊN CHIỀU',
    'update': '🔄 CẬP NHẬT REALTIME',
  };
  const sessionLabel = sessionLabels[session] || '🔮 BẢN TIN PHÂN TÍCH';

  const direction = scoreResult.direction;
  const isTradeable = direction === 'LONG' || direction === 'SHORT';

  let msg = `🔮 <b>VN30F v4.1 — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ─── 1. KHUYẾN NGHỊ / TRẠNG THÁI CHÍNH ──────────────────
  if (isTradeable) {
    const dirIcon = direction === 'LONG' ? '🟢' : '🔴';
    const dirText = direction === 'LONG' ? 'MỞ VỊ THẾ LONG (MUA)' : 'MỞ VỊ THẾ SHORT (BÁN)';
    msg += `${dirIcon} <b>KHUYẾN NGHỊ: ${dirText}</b>\n`;
    msg += `📊 Độ tin cậy: <b>${scoreResult.confidence}/100</b> | Chất lượng Setup: <b>${scoreResult.setupQuality}</b> | Rủi ro: <b>${scoreResult.risk}</b>\n\n`;
  } else {
    msg += `⚪ <b>TRẠNG THÁI: ĐỨNG NGOÀI QUAN SÁT</b>\n`;
    msg += `⚠️ <b>Lý do:</b> ${scoreResult.vetoReason || 'Thị trường đang giằng co, chưa có phe nào chiếm ưu thế rõ ràng.'}\n\n`;
  }

  // ─── 2. CHẾ ĐỘ THỊ TRƯỜNG ────────────────────────────────
  if (regimeResult) {
    const regimeIcons = {
      'TREND_UP': '📈', 'TREND_DOWN': '📉', 'RANGE': '↔️',
      'TRAP_THEN_TREND': '🪤', 'TWO_SIDED_CHOP': '🔀',
      'LIQUIDITY_VACUUM': '🏜️', 'EXPIRY_DISTORTION': '⚠️',
    };
    msg += `🌡️ <b>CHẾ ĐỘ THỊ TRƯỜNG:</b>\n`;
    msg += `${regimeIcons[regimeResult.regime] || '↔️'} ${regimeResult.description}\n`;
    if (regimeResult.expiryMode && regimeResult.expiryMode.mode !== 'NORMAL') {
      msg += `📅 <b>Đáo hạn:</b> ${regimeResult.expiryMode.mode} (Còn ${regimeResult.expiryMode.daysToExpiry} ngày — lưu ý biến động bất ngờ)\n`;
    }
    msg += `\n`;
  }

  // ─── THANH KHOẢN & VỊ THẾ PHÁI SINH (delta giữa 2 noti) ───
  if (deltaData || liquidityResult) {
    msg += `💰 <b>THANH KHOẢN REALTIME:</b>\n`;

    // VN30 liquidity
    if (liquidityResult) {
      const liqPct = Math.round(liquidityResult.volumeRatio * 100);
      msg += `   • VN30: <b>${liquidityResult.totalValue.toLocaleString('vi-VN')} tỷ</b> (${liqPct}% TB)`;
      if (deltaData && deltaData.liqDelta && deltaData.liqDelta.vn30Delta != null) {
        const sign = deltaData.liqDelta.vn30Delta >= 0 ? '+' : '';
        msg += ` | Δ${deltaData.timeDiffMin}p: <b>${sign}${deltaData.liqDelta.vn30Delta.toLocaleString('vi-VN')} tỷ</b>`;
      }
      msg += `\n`;
    }

    // VNINDEX price
    if (allData && allData.vnindexPrice) {
      const vnidx = allData.vnindexPrice;
      const vnidxChange = vnidx.prevPrice ? ((vnidx.price - vnidx.prevPrice) / vnidx.prevPrice * 100).toFixed(2) : '0';
      const vnidxIcon = parseFloat(vnidxChange) >= 0 ? '🟢' : '🔴';
      msg += `   • VNINDEX: ${vnidxIcon} <b>${vnidx.price.toFixed(2)}</b> (${parseFloat(vnidxChange) >= 0 ? '+' : ''}${vnidxChange}%)\n`;
    }

    msg += `\n`;

    // VN30 buy/sell delta
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

    // OI position delta (long/short contracts)
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
      msg += `\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── 3. BẢN ĐỒ GIÁ (PRICE MAP) ───────────────────────────
  if (priceMap) {
    msg += `📍 <b>BẢN ĐỒ GIÁ REALTIME:</b>\n`;
    if (priceMap.currentPrice && basisResult) {
      msg += `   • VN30: <b>${basisResult.vn30Price}</b> | Phái sinh F1M: <b>${basisResult.f1mPrice}</b>\n`;
    }
    if (priceMap.todayRange.high) {
      msg += `   • Biên độ phiên nay: <b>${priceMap.todayRange.low?.toFixed(1)}</b> → <b>${priceMap.todayRange.high?.toFixed(1)}</b>\n\n`;
    }

    msg += `   <b>Các mốc cản & hỗ trợ quan trọng:</b>\n`;
    const keyLevels = (priceMap.levels || []).slice(0, 7);
    for (const lvl of keyLevels) {
      const icon = lvl.type === 'RESISTANCE' || lvl.type === 'VAH' ? '🔴'
        : lvl.type === 'SUPPORT' || lvl.type === 'VAL' ? '🟢'
        : lvl.type === 'POC' || lvl.type === 'VWAP' ? '🟡' : '⚪';
      msg += `   ${icon} <b>${lvl.price.toFixed(1)}</b> — ${lvl.label}\n`;
    }
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── 4. ĐỘ RỘNG & XUNG LỰC GIÁ ───────────────────────────
  if (breadthResult) {
    msg += `🔥 <b>ĐỘ RỘNG & XUNG LỰC:</b>\n`;
    msg += `   • Độ rộng VN30: <b>${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴</b>`;
    if (breadthResult.acceleration.trend === 'IMPROVING') msg += ` (Đang cải thiện ↑)`;
    else if (breadthResult.acceleration.trend === 'DETERIORATING') msg += ` (Đang xấu đi ↓)`;
    msg += `\n`;

    // Bank
    msg += `   • Nhóm Ngân hàng: <b>${breadthResult.bank.label}</b> (${breadthResult.bank.greenCount}/${breadthResult.bank.totalCount} mã xanh)\n`;

    // Concentration
    if (breadthResult.concentration.level === 'HIGH' && breadthResult.concentration.topContributors.length > 0) {
      const top3 = breadthResult.concentration.topContributors.slice(0, 3);
      msg += `   ⚠️ <b>Chỉ số tập trung vào vài trụ:</b> ${top3.map(c => `${c.sym} (${c.changePct > 0 ? '+' : ''}${c.changePct}%)`).join(', ')}\n`;
    }

    // Velocity action
    if (velocityResult) {
      msg += `   • Tốc độ biến động: <b>${velocityResult.label}</b>`;
      if (velocityResult.isImpulse) msg += ` (${velocityResult.move5Pts > 0 ? '+' : ''}${velocityResult.move5Pts}đ/5p)`;
      msg += `\n     → <i>${velocityResult.actionAdvice}</i>\n`;
    }

    // Efficiency action
    if (efficiencyResult) {
      msg += `   • Trạng thái sóng: <b>${efficiencyResult.label}</b>\n`;
      msg += `     → <i>${efficiencyResult.actionAdvice}</i>\n`;
    }

    // Trap warning
    if (breadthResult.trap.detected) {
      const isTrapLong = breadthResult.trap.detected === 'TRAP_LONG';
      const trapIcon = isTrapLong ? '🪤🔴' : '🪤🟢';
      const trapText = isTrapLong
        ? `CẢNH BÁO BẪY LONG (${breadthResult.greenCount} mã xanh nhưng biên độ rất nhỏ, lái kéo dàn trải)`
        : `CẢNH BÁO BẪY SHORT (${breadthResult.redCount} mã đỏ nhưng biên độ nhỏ, lái đè dàn trải)`;
      msg += `   ${trapIcon} <b>${trapText}</b>\n`;
    }

    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── 5. DÒNG TIỀN & HÀNH ĐỘNG THỰC TẾ ───────────────────
  if (flowResult) {
    msg += `📊 <b>DÒNG TIỀN & HÀNH ĐỘNG:</b>\n`;
    if (liquidityResult) {
      const liqPct = Math.round(liquidityResult.volumeRatio * 100);
      let liqDesc = 'Bình thường';
      if (liqPct < 60) liqDesc = 'Thanh khoản cạn, dòng tiền yếu';
      else if (liqPct < 80) liqDesc = 'Thanh khoản thấp hơn trung bình';
      else if (liqPct >= 120) liqDesc = 'Thanh khoản bùng nổ, dòng tiền vào mạnh';
      msg += `   • Thanh khoản: <b>${liqPct}% mức trung bình</b> (${liqDesc})\n`;
    }

    const buyVolK = Math.round(flowResult.aggression.buyVol / 1000);
    const sellVolK = Math.round(flowResult.aggression.sellVol / 1000);
    const deltaK = (flowResult.delta.cumulative / 1000).toFixed(1);
    const deltaIcon = flowResult.delta.cumulative > 0 ? '↑ Mua áp đảo' : '↓ Bán áp đảo';

    msg += `   • Khớp lệnh: <b>${buyVolK}k HĐ Mua</b> / <b>${sellVolK}k HĐ Bán</b>\n`;
    msg += `   • Chênh lệch lệnh (Delta): <b>${deltaK > 0 ? '+' : ''}${deltaK}k HĐ</b> (${deltaIcon})\n`;

    // CVD trend
    const cvdText = flowResult.cvd.direction === 'RISING' ? 'Dốc lên (Phe mua duy trì lực)'
      : flowResult.cvd.direction === 'FALLING' ? 'Dốc xuống (Phe bán xả hàng liên tục)' : 'Đi ngang (Giằng co)';
    msg += `   • Xu hướng dòng tiền (CVD): <b>${cvdText}</b>\n`;

    if (flowResult.cvd.divergence) {
      const divText = flowResult.cvd.divergence === 'BEARISH_DIVERGENCE'
        ? '⚠️ PHÂN KỲ GIẢM: Giá tăng nhưng dòng tiền không vào → Dễ quay đầu giảm'
        : '⚠️ PHÂN KỲ TĂNG: Giá giảm nhưng dòng tiền ngầm mua gom → Dễ bật tăng';
      msg += `   <b>${divText}</b>\n`;
    }

    // Absorption action tip
    if (absorptionResult && absorptionResult.detected) {
      const absIcon = absorptionResult.detected === 'SELL_ABSORPTION' ? '🟢' : '🔴';
      msg += `   ${absIcon} <b>HẤP THỤ CUNG CẦU:</b> ${absorptionResult.actionTip || absorptionResult.description}\n`;
    }

    // Sweep action tip
    if (sweepResult && sweepResult.detected) {
      msg += `   ⚡ <b>QUÉT THANH KHOẢN (BẪY GIÁ):</b> ${sweepResult.actionTip || sweepResult.description}\n`;
    }

    // Leader exhaustion action tip
    if (leaderResult && leaderResult.exhaustion.length > 0) {
      const ex = leaderResult.exhaustion[0];
      msg += `   ⚠️ <b>Trụ mất đà (${ex.sym}):</b> Đã tăng +${ex.peak}% nay quay đầu còn +${ex.current}% → Cẩn thận chỉ số hạ nhiệt\n`;
    }

    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── 6. KẾ HOẠCH GIAO DỊCH CHI TIẾT ──────────────────────
  if (targetMap && isTradeable) {
    msg += `🎯 <b>KẾ HOẠCH GIAO DỊCH:</b>\n\n`;
    msg += `   • <b>VÙNG VÀO LỆNH:</b> <b>${targetMap.entry.zone[0]} – ${targetMap.entry.zone[1]}</b>\n`;
    msg += `     <i>(${targetMap.entry.reason})</i>\n\n`;

    for (const tp of targetMap.targets) {
      msg += `   • <b>${tp.type}:</b> <b>${tp.price.toFixed(1)}</b> (${tp.reason})\n`;
    }

    msg += `\n   • <b>ĐIỀU KIỆN HUỶ KẾ HOẠCH:</b> ${targetMap.invalidation.condition}\n`;
    msg += `   • <b>Cắt lỗ cứng:</b> Tối đa ±${targetMap.hardStop} điểm để bảo vệ vốn\n`;

    if (targetMap.noTradeZone) {
      msg += `\n   🚫 <b>VÙNG TRÁNH GIAO DỊCH:</b> ${targetMap.noTradeZone.from} – ${targetMap.noTradeZone.to}\n`;
      msg += `     <i>(${targetMap.noTradeZone.reason})</i>\n`;
    }
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  }

  // ─── 7. ĐÁNH GIÁ TỔNG HỢP ĐA LỚP ────────────────────────
  if (scoreResult.layerSummaries) {
    msg += `📊 <b>ĐÁNH GIÁ TỔNG HỢP:</b>\n`;
    msg += `   • 🟥 Cấu trúc đồ thị: <b>${scoreResult.layerSummaries.structure}</b>\n`;
    msg += `   • 🟦 Dòng tiền chủ động: <b>${scoreResult.layerSummaries.flow}</b>\n`;
    msg += `   • 🟨 Độ rộng thị trường: <b>${scoreResult.layerSummaries.breadth}</b>\n`;
    msg += `   • 🟩 Chế độ thị trường: <b>${scoreResult.layerSummaries.regime}</b>\n\n`;

    if (isTradeable) {
      msg += `   → <b>KẾT LUẬN:</b> Ưu tiên vị thế <b>${direction}</b> theo đúng kế hoạch trên, tuân thủ kỷ luật cắt lỗ.\n`;
    } else {
      msg += `   → <b>KẾT LUẬN:</b> Hai phe chưa có ưu thế rõ ràng. <b>Kiên nhẫn đứng ngoài</b> chờ giá chạm các vùng cản/hỗ trợ lớn.\n`;
    }
  }

  msg += `\n<i>🔮 VN30F Signal Engine v4.1 | VN Stock Bot</i>`;

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
