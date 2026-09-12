/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧮 VN30F — OI Overnight Position Estimator v2              ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Ước lượng vị thế qua đêm THỰC TẾ của NN/Tự doanh/Đám đông  ║
 * ║  dựa trên Cross-Reference: ΔOI + Volume + Net phiên           ║
 * ║                                                                ║
 * ║  NGUYÊN TẮC CỐT LÕI:                                         ║
 * ║  1. NN_net (buy - sell) = thay đổi vị thế NN phiên đó (100%)  ║
 * ║  2. ΔOI chỉ dùng để PHÂN LOẠI hành vi (mở mới/đóng cũ)      ║
 * ║  3. TD khi = 0 → ước lượng ~35% đối ứng NN (lịch sử thống kê)║
 * ║  4. Đám đông = -(NN + TD) (Zero-Sum rule)                     ║
 * ║  5. Vị thế lũy kế = tổng tích lũy net hàng ngày             ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── Tỷ lệ ước lượng Tự Doanh (từ thống kê lịch sử) ──────────
// Dữ liệu 26/8 - 4/9: |TD/NN| ≈ 0.34 ~ 1.09, trung bình ~0.52
// Dùng 0.35 (bảo thủ) để tránh overestimate
const TD_ESTIMATION_RATIO = 0.35;

/**
 * Phân loại hành vi giao dịch dựa trên ΔOI và Net phiên
 * 
 * ΔOI > 0 + Net > 0 → MỞ MỚI LONG   (OI tăng, NN mua ròng)
 * ΔOI > 0 + Net < 0 → MỞ MỚI SHORT  (OI tăng, NN bán ròng)
 * ΔOI < 0 + Net > 0 → COVER SHORT    (OI giảm, NN mua ròng)
 * ΔOI < 0 + Net < 0 → ĐÓNG LONG      (OI giảm, NN bán ròng)
 * ΔOI ≈ 0            → CHUYỂN TAY     (OI giữ, chỉ chuyển vị thế)
 *
 * LƯU Ý: ΔOI chỉ phân loại HÀNH VI, KHÔNG cắt con số Net.
 *         Net (buy - sell) = thay đổi vị thế chính xác 100%.
 */
function classifyTradeAction(deltaOI, entityNet, totalVolume = 0) {
  const absNet = Math.abs(entityNet);
  const absDeltaOI = Math.abs(deltaOI);

  if (absDeltaOI < 200 && absNet < 200) {
    return {
      action: 'IDLE',
      confidence: 90,
      description: 'Đứng ngoài / Không giao dịch đáng kể',
      isNewPosition: false,
    };
  }

  let action = 'MIXED';
  let confidence = 60;
  let description = '';
  let isNewPosition = false;

  if (deltaOI > 200 && entityNet > 200) {
    action = 'OPEN_LONG';
    isNewPosition = true;
    confidence = absNet >= absDeltaOI * 0.5 ? 88 : 72;
    description = `Mở mới LONG ${absNet.toLocaleString('vi-VN')} HĐ (OI sàn tăng +${absDeltaOI.toLocaleString('vi-VN')})`;

  } else if (deltaOI > 200 && entityNet < -200) {
    action = 'OPEN_SHORT';
    isNewPosition = true;
    confidence = absNet >= absDeltaOI * 0.5 ? 88 : 72;
    description = `Mở mới SHORT ${absNet.toLocaleString('vi-VN')} HĐ (OI sàn tăng +${absDeltaOI.toLocaleString('vi-VN')})`;

  } else if (deltaOI < -200 && entityNet > 200) {
    action = 'COVER_SHORT';
    isNewPosition = false;
    confidence = absNet >= absDeltaOI * 0.5 ? 85 : 70;
    description = `Cover SHORT (đóng Short cũ) ${absNet.toLocaleString('vi-VN')} HĐ (OI sàn giảm ${deltaOI.toLocaleString('vi-VN')})`;

  } else if (deltaOI < -200 && entityNet < -200) {
    action = 'CLOSE_LONG';
    isNewPosition = false;
    confidence = absNet >= absDeltaOI * 0.5 ? 85 : 70;
    description = `Đóng LONG (thanh lý Long cũ) ${absNet.toLocaleString('vi-VN')} HĐ (OI sàn giảm ${deltaOI.toLocaleString('vi-VN')})`;

  } else if (absDeltaOI < 200) {
    action = entityNet > 0 ? 'TRANSFER_BUY' : entityNet < 0 ? 'TRANSFER_SELL' : 'IDLE';
    isNewPosition = false;
    confidence = 65;
    description = entityNet > 0
      ? `Chuyển tay mua +${absNet.toLocaleString('vi-VN')} HĐ (OI giữ nguyên → chuyển vị thế)`
      : entityNet < 0
        ? `Chuyển tay bán -${absNet.toLocaleString('vi-VN')} HĐ (OI giữ nguyên → chuyển vị thế)`
        : 'Thị trường cân bằng';
  } else {
    action = 'MIXED';
    confidence = 55;
    description = `Hỗn hợp: Net ${entityNet >= 0 ? '+' : ''}${entityNet.toLocaleString('vi-VN')} HĐ, ΔOI ${deltaOI >= 0 ? '+' : ''}${deltaOI.toLocaleString('vi-VN')}`;
  }

  return { action, confidence, description, isNewPosition };
}

/**
 * Ước lượng Tự Doanh khi chưa có data chốt sổ (= 0)
 *
 * Nguyên tắc:
 * - TD thường đối ứng NN (hedging) với tỷ lệ ~35%
 * - NN < 0 → TD > 0 (TD phòng hộ bên Long)
 * - NN > 0 → TD < 0 (TD phòng hộ bên Short)
 * - Tỷ lệ 35% là bảo thủ từ thống kê 5 phiên có data TD
 */
function estimateTuDoanh(nnNet, actualTD) {
  // Nếu có data thực → dùng trực tiếp
  if (actualTD !== 0 && actualTD !== undefined && actualTD !== null) {
    return { value: actualTD, isEstimated: false };
  }
  // Ước lượng: ~35% đối ứng NN
  const estimated = Math.round(-nnNet * TD_ESTIMATION_RATIO);
  return { value: estimated, isEstimated: true };
}

/**
 * Ước lượng vị thế lũy kế qua đêm qua nhiều phiên
 *
 * NGUYÊN TẮC QUAN TRỌNG:
 * - NN position delta = NN_net (buy - sell) → 100% chính xác
 *   (KHÔNG dùng min(ΔOI, Net) như trước — đó là SAI)
 * - TD: dùng data thực nếu có, ước lượng 35% đối ứng nếu = 0
 * - Crowd = -(NN + TD) (Zero-Sum rule)
 * - Vị thế lũy kế = tổng tích lũy từng phiên
 */
function estimateCumulativePositions(history) {
  if (!history || history.length === 0) return [];

  let cumulativeNN = 0;
  let cumulativeTD = 0;

  const results = history.map((session) => {
    const nnNet = session.overnightNet || 0;
    const deltaOI = session.oiChange || 0;
    const totalVolume = session.volume || 0;
    const actualTD = session.tuDoanhOvernight || 0;

    // 1. Classify hành vi NN (chỉ để mô tả, KHÔNG thay đổi con số)
    const nnAction = classifyTradeAction(deltaOI, nnNet, totalVolume);

    // 2. NN position delta = NN_net trực tiếp (100% chính xác)
    const nnPositionDelta = nnNet;

    // 3. TD: dùng data thực hoặc ước lượng
    const tdEstimate = estimateTuDoanh(nnNet, actualTD);
    const tdPositionDelta = tdEstimate.value;

    // 4. Lũy kế
    cumulativeNN += nnPositionDelta;
    cumulativeTD += tdPositionDelta;
    const cumulativeCrowd = -(cumulativeNN + cumulativeTD);

    // 5. Crowd phiên = -(NN + TD)
    const crowdDelta = -(nnNet + tdEstimate.value);

    return {
      ...session,
      nnAction,
      nnPositionDelta,
      tdPositionDelta,
      tdIsEstimated: tdEstimate.isEstimated,
      crowdDelta,
      cumulativeNN,
      cumulativeTD,
      cumulativeCrowd,
      nnPositionLabel: _formatPositionLabel(cumulativeNN),
      tdPositionLabel: _formatPositionLabel(cumulativeTD, tdEstimate.isEstimated),
      crowdPositionLabel: _formatPositionLabel(cumulativeCrowd),
    };
  });

  return results;
}

/**
 * Tạo báo cáo chi tiết phiên gần nhất
 */
function generateLatestReport(history) {
  const estimated = estimateCumulativePositions(history);
  if (estimated.length === 0) return null;

  const latest = estimated[estimated.length - 1];
  const previous = estimated.length > 1 ? estimated[estimated.length - 2] : null;

  return {
    date: latest.date,
    nnAction: latest.nnAction,
    nnSessionNet: latest.overnightNet,
    deltaOI: latest.oiChange,
    // Thay đổi phiên
    nnDelta: latest.nnPositionDelta,
    tdDelta: latest.tdPositionDelta,
    tdIsEstimated: latest.tdIsEstimated,
    crowdDelta: latest.crowdDelta,
    // Vị thế lũy kế
    nnCumulative: latest.cumulativeNN,
    tdCumulative: latest.cumulativeTD,
    crowdCumulative: latest.cumulativeCrowd,
    nnLabel: latest.nnPositionLabel,
    tdLabel: latest.tdPositionLabel,
    crowdLabel: latest.crowdPositionLabel,
    // So sánh phiên trước
    prevNN: previous ? previous.cumulativeNN : 0,
    prevTD: previous ? previous.cumulativeTD : 0,
    // Full history
    history: estimated,
  };
}

/**
 * Format vị thế thành label
 */
function _formatPositionLabel(position, isEstimated = false) {
  const suffix = isEstimated ? ' (ước)' : '';
  if (position > 200) {
    return `🟢 LONG +${position.toLocaleString('vi-VN')} HĐ${suffix}`;
  } else if (position < -200) {
    return `🔴 SHORT ${position.toLocaleString('vi-VN')} HĐ${suffix}`;
  } else {
    return `⚖️ CÂN BẰNG ~${Math.abs(position)} HĐ${suffix}`;
  }
}

/**
 * Tạo thông báo Telegram section 5
 */
function buildEstimatedPositionMessage(report) {
  if (!report) return '';

  const fmt = (n) => (n !== undefined && n !== null ? Math.round(n).toLocaleString('vi-VN') : '0');
  const fmtSign = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

  const action = report.nnAction;
  const actionIcon = action.isNewPosition ? '🆕' : '🔄';
  const actionLabel = {
    'OPEN_LONG': '🟢 MỞ MỚI LONG',
    'OPEN_SHORT': '🔴 MỞ MỚI SHORT',
    'COVER_SHORT': '🟢 COVER SHORT (đóng Short cũ)',
    'CLOSE_LONG': '🔴 ĐÓNG LONG (thanh lý Long cũ)',
    'TRANSFER_BUY': '🔄 CHUYỂN TAY MUA',
    'TRANSFER_SELL': '🔄 CHUYỂN TAY BÁN',
    'IDLE': '⏸️ ĐỨNG NGOÀI',
    'MIXED': '🔀 HỖN HỢP',
  }[action.action] || '❓ KHÔNG RÕ';

  let msg = '';
  msg += `\n🧮 <b>5. ƯỚC LƯỢNG VỊ THẾ QUA ĐÊM (CROSS-REFERENCE ΔOI):</b>\n`;
  msg += `• ${actionIcon} <b>Hành vi NN phiên nay:</b> <b>${actionLabel}</b>\n`;
  msg += `   └ ${action.description}\n`;
  msg += `   └ Tin cậy phân loại: <b>${action.confidence}%</b>\n`;

  // Thay đổi vị thế phiên nay (3 phe)
  msg += `• 📈 <b>Thay đổi vị thế phiên nay:</b>\n`;
  msg += `   └ 🌐 NN: <b>${fmtSign(report.nnDelta)} HĐ</b>\n`;
  msg += `   └ 🏛️ TD: <b>${fmtSign(report.tdDelta)} HĐ</b>${report.tdIsEstimated ? ' <i>(ước ~35% đối ứng NN)</i>' : ''}\n`;
  msg += `   └ 👥 Đám đông: <b>${fmtSign(report.crowdDelta)} HĐ</b>\n`;

  // Vị thế lũy kế
  msg += `• 📊 <b>Vị thế lũy kế qua đêm (tích lũy):</b>\n`;
  msg += `   └ 🌐 NN: <b>${report.nnLabel}</b>\n`;
  msg += `   └ 🏛️ TD: <b>${report.tdLabel}</b>\n`;
  msg += `   └ 👥 Đám đông: <b>${report.crowdLabel}</b>\n`;

  msg += `   └ <i>⚠️ NN net = buy - sell (chính xác). TD ước lượng khi chưa có chốt sổ.</i>\n`;

  return msg;
}

module.exports = {
  classifyTradeAction,
  estimateCumulativePositions,
  estimateTuDoanh,
  generateLatestReport,
  buildEstimatedPositionMessage,
  TD_ESTIMATION_RATIO,
};
