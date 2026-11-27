/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ✍️ VN30F V10.0 — Forecast Formatter (Section 12)             ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Vietnamese Telegram notification formatter:                  ║
 * ║  • Súc tích, không spam, đọc 3 giây hiểu ngay                 ║
 * ║  • Ghi rõ điểm bằng chứng / 100 (không bịa xác suất %)        ║
 * ║  • Phân biệt rõ: DỰ BÁO SỚM, THEO DÕI, SUY YẾU, VÔ HIỆU HÓA   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class ForecastFormatter {
  /**
   * Format Early Forecast (Section 12.1)
   */
  formatEarlyForecast(forecast) {
    const d = new Date(forecast.asOf || Date.now());
    const timeStr = d.toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const expiryD = new Date(forecast.validUntil || (forecast.asOf + 300000));
    const expiryStr = expiryD.toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const isUp = forecast.direction === 'UP';
    const icon = isUp ? '🟢' : '🔴';
    const dirText = isUp ? 'TĂNG' : 'GIẢM';
    const target = forecast.primaryTarget;
    const origin = forecast.origin?.price || 0;

    let pathDesc = `${origin.toFixed(1)} → ${target.low}–${target.high}`;
    if (forecast.conditionalExtension) {
      pathDesc += `; nếu giữ được vùng này mới xét ${forecast.conditionalExtension.low}–${forecast.conditionalExtension.high}`;
    }

    const evidenceList = (forecast.evidence || []).map(e => `• ${e}`).join('\n');
    const invalidationText = forecast.invalidation?.level
      ? `Giá ${isUp ? 'thủng' : 'vượt'} và duy trì ${isUp ? 'dưới' : 'trên'} vùng ${forecast.invalidation.level} theo quy tắc xác nhận`
      : 'Thị trường đảo chiều ngược dự báo';

    const score = forecast.scores?.direction || 75;

    return `🔮 <b>[DỰ BÁO SỚM V10] VN30F1M | ${timeStr} | H${Math.round((forecast.horizon?.seconds || 300) / 60)}p</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${icon} <b>VIEW CHÍNH: ${dirText} kiểm tra ${target.low}–${target.high}</b>\n\n` +
      `📍 <b>Đường giá ưu tiên:</b> ${pathDesc}\n\n` +
      `🔍 <b>Cơ sở bằng chứng:</b>\n` +
      `${evidenceList}\n\n` +
      `❌ <b>Mất hiệu lực khi:</b> ${invalidationText}\n` +
      `⏰ <b>Hạn hiệu lực:</b> ${expiryStr} | <b>Điểm bằng chứng:</b> ${score}/100 <i>(không phải xác suất %)</i>\n` +
      `📡 <i>Dữ liệu: Snapshot VPS 5s | Chế độ: ${forecast.stage || 'EARLY_FORECAST'}</i>`;
  }

  /**
   * Format Weakening Warning (Section 12.4)
   */
  formatWeakening({ price, zoneName, side = 'SHORT', reasons = [] }) {
    const isShort = side === 'SHORT';
    const reasonsText = reasons.length > 0 ? reasons.map(r => `• ${r}`).join('\n') : '• Áp lực phe bán không còn tạo đáy mới';

    return `⚠️ <b>[CẢNH BÁO SUY YẾU] VN30F1M | Giá ${price.toFixed(1)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <b>LỢI THẾ PHE ${isShort ? 'SHORT' : 'LONG'} ĐANG SUY YẾU RÕ RỆT</b>\n` +
      (zoneName ? `📍 Vùng phản ứng: ${zoneName}\n` : '') +
      `🔍 <b>Quan sát:</b>\n` +
      `${reasonsText}\n\n` +
      `👉 <i>Khuyến nghị: Không bán/mua đuổi vùng này, cân nhắc chặn lãi bảo toàn vị thế!</i>`;
  }

  /**
   * Format Invalidation notification (Section 12.6)
   */
  formatInvalidated(forecast, currentPrice) {
    return `❌ <b>[DỰ BÁO MẤT HIỆU LỰC] #${forecast.forecastId || 'F0'}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Giá ${currentPrice.toFixed(1)} đã chạm vùng vô hiệu (${forecast.invalidation?.level || 'N/A'}).\n` +
      `Nhận định ${forecast.direction} kiểm tra ${forecast.primaryTarget?.low}–${forecast.primaryTarget?.high} đã không còn giá trị.\n\n` +
      `⚪ <b>Trạng thái hiện tại:</b> ĐỨNG NGOÀI QUAN SÁT (Chưa đủ lợi thế, không tự động đảo lệnh).`;
  }

  /**
   * Format Target Hit notification
   */
  formatTargetHit(forecast, currentPrice) {
    return `🎯 <b>[CHẠM ĐÍCH DỰ BÁO] #${forecast.forecastId || 'F0'}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Giá ${currentPrice.toFixed(1)} đã chạm đúng vùng đích ${forecast.primaryTarget?.low}–${forecast.primaryTarget?.high}.\n` +
      (forecast.conditionalExtension ? `📍 Mục tiêu mở rộng tiếp theo: ${forecast.conditionalExtension.low}–${forecast.conditionalExtension.high}\n` : '') +
      `💡 <i>Dự báo V10 hoàn thành trọn vẹn trước hạn.</i>`;
  }

  /**
   * Format Shock notification
   */
  formatShock(shockEvent) {
    const isUp = shockEvent.direction === 'UP';
    return `⚡ <b>[BIẾN ĐỘNG NHANH — SHOCK ${shockEvent.direction}] VN30F1M</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${isUp ? '🚀' : '🩸'} <b>Giá giật ${isUp ? '+' : '-'}${shockEvent.pts.toFixed(1)}đ trong vòng ${shockEvent.window || '15s'}!</b>\n` +
      `⚠️ <i>Dễ bị quét dừng lỗ hai chiều, TUYỆT ĐỐI KHÔNG FOMO ĐUỔI LỆNH, chờ thị trường tái cân bằng!</i>`;
  }
}

module.exports = {
  ForecastFormatter,
};
