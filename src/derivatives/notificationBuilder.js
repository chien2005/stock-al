/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📱 VN30F v4.0 — Notification Builder                     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Format noti Telegram 100% tiếng Việt                       ║
 * ║  Dữ liệu REALTIME tại thời điểm bắn                        ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { vnNow } = require('./dataFetcher');
const { VIN_SYMBOLS, BANK_SYMBOLS } = require('./breadthEngine');

/**
 * Build notification chính (signal mở vị thế)
 */
function buildSignalNotification(session, analysisResult) {
  const {
    scoreResult, priceMap, flowResult, absorptionResult, sweepResult,
    velocityResult, efficiencyResult, basisResult, oiState, leadLag,
    breadthResult, leaderResult, liquidityResult, regimeResult, targetMap,
  } = analysisResult;

  const sessionLabels = {
    'morning': '🌅 PHIÊN SÁNG',
    'midmorning': '⛅ GIỮA SÁNG',
    'afternoon': '🌆 PHIÊN CHIỀU',
  };
  const sessionLabel = sessionLabels[session] || '🔮 PHÂN TÍCH';

  const direction = scoreResult.direction;
  const dirIcon = direction === 'LONG' ? '🟢' : direction === 'SHORT' ? '🔴' : '⚪';
  const dirText = direction === 'LONG' ? 'LONG (MUA)' : direction === 'SHORT' ? 'SHORT (BÁN)' : 'KHÔNG GIAO DỊCH';

  let msg = `🔮 <b>VN30F v4.0 — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ─── DIRECTION & CONFIDENCE ───────────────────────
  msg += `${dirIcon} <b>HƯỚNG: ${dirText}</b>\n`;
  if (!scoreResult.vetoed) {
    msg += `📊 Độ tin cậy: <b>${scoreResult.confidence}/100</b> | Chất lượng: <b>${scoreResult.setupQuality}</b> | Rủi ro: <b>${scoreResult.risk}</b>\n`;
  }
  if (scoreResult.vetoed) {
    msg += `🚫 <b>${scoreResult.vetoReason}</b>\n`;
  }
  msg += `\n`;

  // ─── REGIME ───────────────────────────────────────
  if (regimeResult) {
    const regimeIcons = {
      'TREND_UP': '📈', 'TREND_DOWN': '📉', 'RANGE': '↔️',
      'TRAP_THEN_TREND': '🪤', 'TWO_SIDED_CHOP': '🔀',
      'LIQUIDITY_VACUUM': '🏜️', 'EXPIRY_DISTORTION': '⚠️',
    };
    msg += `<b>CHẾ ĐỘ THỊ TRƯỜNG:</b>\n`;
    msg += `${regimeIcons[regimeResult.regime] || '🌡️'} ${regimeResult.description}\n`;
    if (regimeResult.expiryMode && regimeResult.expiryMode.mode !== 'NORMAL') {
      msg += `📅 Đáo hạn: ${regimeResult.expiryMode.mode} (${regimeResult.expiryMode.daysToExpiry} ngày)\n`;
    }
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── BẢN ĐỒ GIÁ ──────────────────────────────────
  if (priceMap) {
    msg += `📍 <b>BẢN ĐỒ GIÁ</b>\n`;
    if (priceMap.currentPrice && basisResult) {
      msg += `   VN30: <b>${basisResult.vn30Price}</b> | F1M: <b>${basisResult.f1mPrice}</b>\n`;
    }
    if (priceMap.todayRange.high) {
      msg += `   Phiên nay: ${priceMap.todayRange.low?.toFixed(1)} → ${priceMap.todayRange.high?.toFixed(1)}\n`;
    }

    // Hiển thị key levels (tối đa 6)
    const keyLevels = priceMap.levels.slice(0, 8);
    for (const lvl of keyLevels) {
      const icon = lvl.type === 'RESISTANCE' || lvl.type === 'VAH' ? '🔴'
        : lvl.type === 'SUPPORT' || lvl.type === 'VAL' ? '🟢'
        : lvl.type === 'POC' || lvl.type === 'VWAP' ? '🟡' : '⚪';
      msg += `   ${icon} ${lvl.price.toFixed(1)} — ${lvl.label}\n`;
    }
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── CHẤT LƯỢNG CÚ TĂNG/GIẢM ────────────────────
  if (breadthResult) {
    msg += `🔥 <b>CHẤT LƯỢNG CÚ ${direction === 'LONG' ? 'TĂNG' : 'GIẢM'}</b>\n`;
    msg += `   Breadth: <b>${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴</b>`;
    if (breadthResult.acceleration.trend !== 'STABLE') {
      msg += ` (${breadthResult.acceleration.trend === 'IMPROVING' ? '↑ cải thiện' : '↓ xấu đi'})`;
    }
    msg += `\n`;

    // Index concentration
    if (breadthResult.concentration.level !== 'LOW' && breadthResult.concentration.topContributors.length > 0) {
      const top3 = breadthResult.concentration.topContributors.slice(0, 3);
      msg += `   ⚠️ <b>CHỈ SỐ TẬP TRUNG ${breadthResult.concentration.level}</b>\n`;
      msg += `   Top: ${top3.map(c => `${c.sym}(${c.changePct > 0 ? '+' : ''}${c.changePct}%)`).join(', ')}\n`;
    }

    // Bank participation
    msg += `   Bank: <b>${breadthResult.bank.label}</b> (${breadthResult.bank.greenCount}/${breadthResult.bank.totalCount} xanh)\n`;

    // Velocity & Efficiency
    if (velocityResult) {
      msg += `   Tốc độ: <b>${velocityResult.label}</b>`;
      if (velocityResult.isImpulse) msg += ` (${velocityResult.move5Pts > 0 ? '+' : ''}${velocityResult.move5Pts}đ / 5 phút)`;
      msg += `\n`;
    }
    if (efficiencyResult) {
      msg += `   Hiệu suất hướng: <b>${efficiencyResult.label}</b> (${(efficiencyResult.value * 100).toFixed(0)}%)\n`;
    }

    // Trap warning
    if (breadthResult.trap.detected) {
      const trapIcon = breadthResult.trap.detected === 'TRAP_LONG' ? '🪤🔴' : '🪤🟢';
      const trapText = breadthResult.trap.detected === 'TRAP_LONG'
        ? `BẪY LONG — ${breadthResult.greenCount} mã xanh nhưng biên độ nhỏ`
        : `BẪY SHORT — ${breadthResult.redCount} mã đỏ nhưng biên độ nhỏ`;
      msg += `   ${trapIcon} <b>${trapText}</b> (${breadthResult.trap.confidence}%)\n`;
    }

    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── DÒNG TIỀN ────────────────────────────────────
  if (flowResult) {
    msg += `📊 <b>DÒNG TIỀN</b>\n`;
    if (liquidityResult) {
      msg += `   Thanh khoản: <b>${liquidityResult.volumeRatio}x</b> (${liquidityResult.regime})\n`;
    }
    msg += `   Mua chủ động: <b>${flowResult.aggression.buyVol.toLocaleString('vi-VN')}</b> HĐ\n`;
    msg += `   Bán chủ động: <b>${flowResult.aggression.sellVol.toLocaleString('vi-VN')}</b> HĐ\n`;

    const deltaIcon = flowResult.delta.cumulative > 0 ? '↑' : '↓';
    msg += `   Delta: <b>${flowResult.delta.cumulative > 0 ? '+' : ''}${flowResult.delta.cumulative.toLocaleString('vi-VN')}</b> ${deltaIcon}\n`;
    msg += `   CVD: <b>${flowResult.cvd.direction === 'RISING' ? 'Tăng' : flowResult.cvd.direction === 'FALLING' ? 'Giảm' : 'Ngang'}</b>`;
    if (flowResult.cvd.divergence) {
      msg += ` ⚠️ ${flowResult.cvd.divergence === 'BEARISH_DIVERGENCE' ? 'PHÂN KỲ GIẢM' : 'PHÂN KỲ TĂNG'}`;
    }
    msg += `\n`;

    // Absorption
    if (absorptionResult && absorptionResult.detected) {
      const absIcon = absorptionResult.detected === 'SELL_ABSORPTION' ? '🟢' : '🔴';
      msg += `   ${absIcon} <b>${absorptionResult.description}</b>\n`;
    }

    // Sweep
    if (sweepResult && sweepResult.detected) {
      msg += `   ⚡ <b>${sweepResult.description}</b>\n`;
    }

    // Leader exhaustion
    if (leaderResult && leaderResult.exhaustion.length > 0) {
      msg += `\n   <b>Trụ kiệt sức:</b>\n`;
      for (const ex of leaderResult.exhaustion.slice(0, 3)) {
        const icon = ex.status === 'EXHAUSTING' ? '⚠️' : ex.status === 'REVERSED' ? '🔴' : '🟢';
        msg += `   ${icon} ${ex.sym}: +${ex.peak}% → +${ex.current}% (quay đầu ${ex.retracement.toFixed(1)}%)\n`;
      }
    }

    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── CHÊNH LỆCH CƠ SỞ ────────────────────────────
  if (basisResult) {
    msg += `📐 <b>CHÊNH LỆCH CƠ SỞ</b>\n`;
    const basisIcon = basisResult.current > 0 ? 'Phí bảo hiểm' : basisResult.current < 0 ? 'Chiết khấu' : 'Cân bằng';
    msg += `   Basis: <b>${basisResult.current > 0 ? '+' : ''}${basisResult.current}</b> (${basisIcon})\n`;
    msg += `   ΔBasis: <b>${basisResult.velocity}</b>\n`;
    if (basisResult.interaction !== 'NEUTRAL') {
      const interactionLabels = {
        'FUTURES_LEADING_UP': 'PS dẫn tăng',
        'SPOT_LEADING_UP': 'Cơ sở dẫn tăng',
        'FUTURES_LEADING_DOWN': 'PS dẫn giảm',
        'SPOT_DEFENDING': 'Cơ sở đang chống đỡ',
      };
      msg += `   Tương tác: <b>${interactionLabels[basisResult.interaction] || basisResult.interaction}</b>\n`;
    }
    msg += `\n`;
  }

  // OI State
  if (oiState && oiState.state !== 'UNKNOWN') {
    msg += `   OI: <b>${oiState.description}</b>\n`;
    if (oiState.totalOI) {
      msg += `   Tổng OI: <b>${oiState.totalOI.toLocaleString('vi-VN')}</b> HĐ (Δ${oiState.oiChange >= 0 ? '+' : ''}${oiState.oiChange})\n`;
    }
    msg += `\n`;
  }

  // ─── Foreign ──────────────────────────────────────
  if (liquidityResult && (liquidityResult.foreignBuy > 0 || liquidityResult.foreignSell > 0)) {
    const fnIcon = liquidityResult.foreignNet >= 0 ? '🟢' : '🔴';
    msg += `   ${fnIcon} NN: <b>${liquidityResult.foreignNet > 0 ? 'Mua' : 'Bán'} ròng ${Math.abs(liquidityResult.foreignNet).toFixed(1)} tỷ</b> (áp lực ${liquidityResult.foreignNet >= 0 ? 'tích cực' : 'tiêu cực'})\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // ─── BẢN ĐỒ GIAO DỊCH ────────────────────────────
  if (targetMap && direction !== 'NO_TRADE') {
    msg += `🎯 <b>BẢN ĐỒ GIAO DỊCH</b>\n`;
    msg += `\n`;
    msg += `   <b>VÙNG VÀO:</b> ${targetMap.entry.zone[0]}–${targetMap.entry.zone[1]}\n`;
    msg += `   Lý do: ${targetMap.entry.reason}\n\n`;

    for (const tp of targetMap.targets) {
      msg += `   <b>${tp.type}:</b> ${tp.price.toFixed(1)} (${tp.reason})\n`;
    }

    msg += `\n   <b>SAI KHI:</b> ${targetMap.invalidation.condition}\n`;
    msg += `   Hard SL: ±${targetMap.hardStop} điểm (bảo vệ vốn)\n`;

    if (targetMap.noTradeZone) {
      msg += `\n   🚫 <b>VÙNG KHÔNG GD:</b> ${targetMap.noTradeZone.from}–${targetMap.noTradeZone.to}\n`;
      msg += `   ${targetMap.noTradeZone.reason}\n`;
    }
  }

  // ─── SCORE BREAKDOWN ──────────────────────────────
  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 <b>ĐIỂM CHI TIẾT</b>\n`;
  msg += `   🟥 Cấu trúc: L${scoreResult.breakdown.structure.long} / S${scoreResult.breakdown.structure.short}\n`;
  msg += `   🟦 Dòng tiền: L${scoreResult.breakdown.flow.long} / S${scoreResult.breakdown.flow.short}\n`;
  msg += `   🟨 Liên thị trường: L${scoreResult.breakdown.crossMarket.long} / S${scoreResult.breakdown.crossMarket.short}\n`;
  msg += `   🟩 Chế độ/Rủi ro: L${scoreResult.breakdown.regime.long} / S${scoreResult.breakdown.regime.short}\n`;
  msg += `   <b>TỔNG: LONG ${scoreResult.longScore} / SHORT ${scoreResult.shortScore}</b>\n`;

  msg += `\n<i>🔮 VN30F Signal Engine v4.0 | VN Stock Bot</i>`;

  return msg;
}

/**
 * Build momentum alert (biến động nhanh)
 */
function buildMomentumAlert(alertType, priceChange, currentPrice, breadthResult) {
  const isUp = alertType === 'SURGE_UP';
  const icon = isUp ? '🚀📈' : '💥📉';
  const dirText = isUp ? 'TĂNG VỌT' : 'GIẢM SỐC';

  let msg = `${icon} <b>BIẾN ĐỘNG LỚN — VN30F ${dirText}!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `⚡ VN30 vừa ${isUp ? 'tăng' : 'giảm'} <b>${Math.abs(priceChange).toFixed(1)} điểm</b> trong ~5 phút!\n`;
  msg += `📍 Giá hiện tại: <b>${currentPrice.toFixed(1)}</b>\n`;

  if (breadthResult) {
    msg += `📊 Breadth: <b>${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴</b>\n`;
  }

  msg += `\n<i>🔮 VN30F v4.0 | Momentum Monitor</i>`;
  return msg;
}

/**
 * Build leader reversal alert
 */
function buildLeaderAlert(exhaustion) {
  let msg = `⚠️ <b>TRỤ KIỆT SỨC / ĐẢO CHIỀU</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const ex of exhaustion) {
    const icon = ex.status === 'EXHAUSTING' ? '⚠️' : ex.status === 'REVERSED' ? '🔴' : '🟢';
    msg += `${icon} <b>${ex.sym}</b>: +${ex.peak}% → ${ex.current > 0 ? '+' : ''}${ex.current}%\n`;
    msg += `   → ${ex.status === 'EXHAUSTING' ? 'Đang mất đà' : ex.status === 'REVERSED' ? 'Đã đảo chiều' : 'Đang hồi phục'}\n`;
  }

  msg += `\n💡 <b>Trụ kiệt sức = Chỉ số có thể quay đầu</b>\n`;
  msg += `\n<i>🔮 VN30F v4.0 | Leader Monitor</i>`;
  return msg;
}

/**
 * Build trap alert
 */
function buildTrapAlert(breadthResult) {
  const isTrapLong = breadthResult.trap.detected === 'TRAP_LONG';
  const icon = isTrapLong ? '🪤🔴' : '🪤🟢';
  const trapName = isTrapLong ? 'BẪY LONG' : 'BẪY SHORT';

  let msg = `${icon} <b>PHÁT HIỆN ${trapName}!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 Breadth: <b>${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴</b>\n`;
  msg += `📊 Max tăng: <b>+${breadthResult.bands.maxGreenPct}%</b> | Max giảm: <b>-${breadthResult.bands.maxRedPct}%</b>\n\n`;

  if (isTrapLong) {
    msg += `⚠️ ${breadthResult.greenCount} mã xanh nhưng biên độ nhỏ (<1.2%)\n`;
    msg += `→ Lái kéo dàn trải, tạo ảo giác tăng\n`;
    msg += `💡 <b>Cẩn thận vị thế LONG</b>\n`;
  } else {
    msg += `⚠️ ${breadthResult.redCount} mã đỏ nhưng biên độ nhỏ (<1.2%)\n`;
    msg += `→ Lái đè dàn trải, tạo ảo giác giảm\n`;
    msg += `💡 <b>Cẩn thận vị thế SHORT</b>\n`;
  }

  msg += `\n🔒 Confidence: <b>${breadthResult.trap.confidence}%</b>`;
  msg += `\n<i>🔮 VN30F v4.0 | Trap Detector</i>`;
  return msg;
}

module.exports = {
  buildSignalNotification,
  buildMomentumAlert,
  buildLeaderAlert,
  buildTrapAlert,
};
