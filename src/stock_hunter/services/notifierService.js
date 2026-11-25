/**
 * AI STOCK HUNTER - Practical Notification Formatter (Tiếng Việt thân thiện)
 * Tuân thủ Master Plan V2.0 Section 20:
 * - Ngắn gọn, thực dụng, số liệu trước, lý do sau
 * - Toàn bộ thuật ngữ & nhãn trạng thái hiển thị bằng Tiếng Việt rõ ràng cho nhà đầu tư
 * - Giá hiển thị theo nghìn VND (vd: 48.0), GT tỷ VND; thiếu số liệu ghi N/A
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { toVnComponents } = require('../core/calendar');

const MODE_LABELS = {
  paper: 'Giả lập',
  research: 'Nghiên cứu',
  live_advisory: 'Thực chiến',
};

const SESSION_LABELS = {
  ATO: 'Phiên ATO',
  CONTINUOUS_AM: 'Phiên sáng',
  LUNCH_BREAK: 'Nghỉ trưa',
  CONTINUOUS_PM: 'Phiên chiều',
  ATC: 'Phiên ATC',
  PUT_THROUGH_ONLY: 'Đã đóng cửa (Thỏa thuận)',
  PLO: 'Sau giờ (PLO)',
  CLOSED: 'Đã đóng cửa',
  CLOSED_HOLIDAY: 'Ngày nghỉ',
};

const REGIME_LABELS = {
  UPTREND_STRONG: 'Xu hướng tăng mạnh',
  UPTREND_WEAK: 'Xu hướng tăng yếu',
  RANGE_WIDE: 'Đi ngang biên rộng',
  RANGE_NARROW: 'Đi ngang biên hẹp',
  DOWNTREND: 'Xu hướng giảm',
  PANIC: 'Bán tháo / Hoảng loạn',
  RECOVERY: 'Phục hồi tạo đáy',
  UNKNOWN: 'Chưa rõ (thiếu dữ liệu)',
};

const LIQUIDITY_LABELS = {
  DRY: 'Cạn kiệt',
  LOW: 'Thấp',
  NORMAL: 'Trung bình',
  HIGH: 'Cao',
  UNKNOWN: 'Chưa rõ',
};

const SPECIAL_WATCH_LABELS = {
  B0_FALLING_KNIFE: 'Đang rơi tự do (Cấm mua)',
  B1_OVERSOLD_WATCH: 'Quá bán — Đưa vào theo dõi',
  B2_CLIMAX_OR_SPRING: 'Cao trào bán / Rút chân đáy',
  B3_STABILIZING: 'Ngừng rơi — Đang giữ đáy',
  B4_RECLAIM: 'Đã lấy lại nền giá',
  B5_CONFIRMED: 'Xác nhận Đáy 2 — Đạt chuẩn',
};

const AVOID_LABELS = {
  A01_DATA_STALE: 'Thiếu dữ liệu',
  A02_TRADING_STATUS: 'Diện cảnh báo / Hạn chế',
  A03_MATERIAL_EVENT: 'Rủi ro sự kiện trọng yếu',
  A04_STRUCTURAL_DOWN: 'Gãy xu hướng giảm',
  A05_SELLING_PRESSURE: 'Áp lực bán mạnh',
  A06_FAILED_BREAKOUT: 'Vượt đỉnh thất bại',
  A07_OVEREXTENDED: 'Tăng quá nóng xa nền',
  A08_NO_LIQUIDITY: 'Mất thanh khoản',
  A09_NO_ROOM: 'Sát kháng cự (hết dư địa)',
  A10_EVENT_WINDOW: 'Sát ngày sự kiện lớn',
  A11_QUALITY_UNKNOWN: 'Thiếu dữ liệu cơ bản',
};

const REASON_LABELS = {
  DAILY_HH_HL: 'Xu hướng tăng (đỉnh đáy cao dần)',
  NEAR_SUPPORT_OR_MA20: 'Chạm hỗ trợ / MA20',
  SUCCESSFUL_SUPPLY_TEST: 'Test cung thành công',
  HEALTHY_PULLBACK_LOW_VOL: 'Chỉnh nhẹ cạn cung',
  PULLBACK_LOW_VOL_WAIT_RECLAIM: 'Chỉnh cạn cung, chờ nến bật lại',
  DEMAND_IMPULSE_15M: 'Cầu vào mạnh khung 15 phút',
  DEMAND_FOLLOW_THROUGH_15M: 'Duy trì lực mua khung 15 phút',
  BREAK_15D_HIGH: 'Vượt đỉnh 15 phiên',
  CLV_STRONG: 'Đóng cửa sát giá cao nhất',
  RVOL_CONFIRMED: 'Khối lượng xác nhận',
  BREAKOUT_WEAK_LIQ_WAIT_RETEST: 'Vượt đỉnh nhưng tiền TT yếu, chờ kiểm tra lại',
  BREAKOUT_OVEREXTENDED_NO_CHASE: 'Đã chạy xa nền, không mua đuổi',
  RETEST_OLD_RESISTANCE: 'Kiểm tra lại đỉnh cũ thành công',
  DEMAND_RECLAIM: 'Cầu quay lại lấy nền',
  LOWER_RANGE_ZONE: 'Tại vùng biên dưới',
  DEMAND_CONFIRMATION: 'Có lực cầu xác nhận',
  SPECIAL_WATCH_B5_CONFIRMED: 'Xác nhận Đáy 2 (B5)',
  HIGHER_LOW_RECLAIM: 'Tạo đáy sau cao hơn & lấy lại nền',
  FAILED_BREAKDOWN_SPRING: 'Rũ thủng nền rồi kéo ngược lên',
  RECLAIM_SUPPORT: 'Lấy lại vùng hỗ trợ',
  VOLATILITY_COMPRESSION: 'Biên độ siết chặt',
  LOW_VOLUME_BASE: 'Thanh khoản nền cạn cung',
};

const EXIT_ACTION_LABELS = {
  DATA_RISK_ALERT: 'CẢNH BÁO MẤT DỮ LIỆU',
  EXIT: 'BÁN THOÁT VỊ THẾ',
  EXIT_PENDING_LOCKED: 'CHỜ HÀNG T+2 VỀ ĐỂ BÁN',
  EXIT_UNFILLED_LIMIT_DOWN: 'KẸT SÀN CHƯA THOÁT ĐƯỢC',
  TIME_STOP_BLOCKED: 'HẾT HẠN NẮM GIỮ (KẸT SÀN)',
  PROTECT: 'SIẾT CHẶN LÃI BẢO VỆ',
  HOLD: 'TIẾP TỤC NẮM GIỮ',
};

function fmtK(priceVnd) {
  if (!Number.isFinite(priceVnd) || priceVnd <= 0) return 'N/A';
  return (priceVnd / 1000).toFixed(2).replace(/\.?0+$/, '');
}

function fmtSignedPct(pct) {
  if (!Number.isFinite(pct)) return 'N/A';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function translateReasons(codes = []) {
  return codes
    .map(c => REASON_LABELS[c] || AVOID_LABELS[c] || c)
    .filter(Boolean);
}

function formatMainScanReport(result, label = null) {
  const vn = toVnComponents(new Date(result.asOf));
  const timeStr = label || vn.timeLabel;
  const mr = result.marketRegime;
  const b = mr.breadth || {};
  const modeStr = MODE_LABELS[STOCK_HUNTER_CONFIG.mode] || 'Giả lập';
  const sessionStr = SESSION_LABELS[result.session] || result.session;
  const regimeStr = REGIME_LABELS[mr.regime] || mr.regime;
  const liqStr = LIQUIDITY_LABELS[mr.liquidityLabel] || mr.liquidityLabel;
  const isPostClose = ['PUT_THROUGH_ONLY', 'CLOSED', 'CLOSED_HOLIDAY', 'PLO'].includes(result.session);

  const lines = [];
  lines.push(`📊 <b>[${timeStr} | ${modeStr} | ${sessionStr} | ${b.validCount || 0}/${b.expectedCount || 0} mã]</b>`);

  if (mr.vnindex) {
    lines.push(`• VN-Index: <b>${mr.vnindex.index}</b> (${fmtSignedPct(mr.vnindex.changePct)}) | MA20: ${mr.vnindex.ma20}`);
  } else {
    lines.push(`• VN-Index: <b>Chưa có dữ liệu</b>`);
  }

  const hoseValBil = mr.marketLiquidity?.hoseMatchedValueVnd
    ? `${Math.round(mr.marketLiquidity.hoseMatchedValueVnd / 1e9).toLocaleString('vi-VN')} tỷ`
    : 'Chưa có';
  const liqRatioStr = mr.liquidityRatio !== null ? `gấp ${mr.liquidityRatio} lần TB cùng giờ` : 'chưa rõ';
  lines.push(`• GT khớp HOSE: <b>${hoseValBil}</b> (${liqRatioStr}) | Thanh khoản: <b>${liqStr}</b>`);
  lines.push(`• Độ rộng TT: <b>${b.advancing ?? 0}</b> tăng / <b>${b.declining ?? 0}</b> giảm / <b>${b.unchanged ?? 0}</b> đứng (trên MA20: ${b.pctAboveMA20 ?? 'N/A'}%)`);
  lines.push(`• Bối cảnh TT: <b>${regimeStr}</b> — Giải ngân tối đa: <b>${Math.round((mr.exposureCap || 0) * 100)}%</b>${mr.concentrationFlag ? ' (⚠️ Trụ kéo xanh, đa số mã giảm)' : ''}`);
  lines.push('');

  if (isPostClose) {
    lines.push(`🌙 <i>Phiên khớp lệnh liên tục đã đóng — Không khuyến nghị mua ngay.</i>`);
    lines.push('');
  }

  // ── 1. KHUYẾN NGHỊ MUA / THEO DÕI PHIÊN KẾ ──
  if (result.buySignals && result.buySignals.length > 0) {
    const title = isPostClose ? '🔵 THEO DÕI PHIÊN KẾ TIẾP:' : '🟢 KHUYẾN NGHỊ MUA MỚI (Đạt chuẩn Cung - Cầu):';
    lines.push(`<b>${title}</b>`);
    for (const sig of result.buySignals) {
      const p = sig.tradePlan;
      const confVi = sig.confidence === 'HIGH' ? 'Cao' : sig.confidence === 'MEDIUM' ? 'Trung bình' : 'Thấp';
      const reasonsVi = translateReasons(sig.reasonCodes.slice(0, 4)).join(', ');
      lines.push(
        `• <b>[${sig.sector}] ${sig.symbol}</b> | Điểm: <b>${sig.score}/100</b> (Độ tin cậy: ${confVi})\n` +
        `  Vùng mua: <b>${fmtK(p.entryZone.min)} – ${fmtK(p.entryZone.max)}</b> | Cắt lỗ: <b>${fmtK(p.stopVnd)}</b> (-${p.stopDistancePct}%) | Mục tiêu: <b>${fmtK(p.tpRef1)}</b> (Tỷ lệ lời/lỗ ${p.rrNet})\n` +
        `  Khối lượng gợi ý: <b>${sig.recommendedQty} cp</b> (~${(sig.estimatedCashRequiredVnd / 1e6).toFixed(1)}tr | Rủi ro ${sig.riskPctOfNav}% vốn)\n` +
        `  Lý do: ${reasonsVi} (KL gấp ${sig.rvolD ?? 'N/A'}x TB)`
      );
    }
  } else {
    lines.push(`⚪ <b>MUA MỚI: KHÔNG CÓ KÈO ĐẠT CHUẨN</b> — Chưa mã nào thỏa mãn đồng thời Cung-Cầu và tỷ lệ lời/lỗ an toàn.`);
  }
  lines.push('');

  // ── 2. DANH SÁCH CHỜ ĐIỂM VÀO ──
  if (result.watchList && result.watchList.length > 0) {
    lines.push(`<b>🟡 DANH SÁCH CHỜ ĐIỂM VÀO:</b>`);
    for (const w of result.watchList.slice(0, 4)) {
      const reasonsVi = translateReasons(w.reasonCodes.slice(0, 2)).join(', ');
      lines.push(`• <b>${w.symbol}</b> (${w.sector}): ${w.strategyName} — ${reasonsVi}`);
    }
    lines.push('');
  }

  // ── 3. SĂN ĐÁY ĐẶC BIỆT ──
  if (result.specialWatchList && result.specialWatchList.length > 0) {
    lines.push(`<b>👀 SĂN ĐÁY ĐẶC BIỆT (Chỉ quan sát — Chưa mua nếu chưa xác nhận Đáy 2):</b>`);
    for (const sw of result.specialWatchList.slice(0, 4)) {
      const stVi = SPECIAL_WATCH_LABELS[sw.state] || sw.state;
      lines.push(`• <b>${sw.symbol}</b> — ${stVi} | Giảm từ đỉnh: ${sw.drawdown60D ?? 'N/A'}% | RSI: ${sw.rsi14 ?? 'N/A'} | Đáy hoảng loạn: ${fmtK(sw.climaxLow)} | Mốc cần vượt: ${fmtK(sw.reclaimLevel)}`);
    }
    lines.push('');
  }

  // ── 4. TOP TRÁNH XA ──
  if (result.avoidList && result.avoidList.length > 0) {
    lines.push(`<b>🚫 DANH SÁCH TRÁNH XA:</b>`);
    for (const av of result.avoidList.slice(0, 5)) {
      const codeVi = AVOID_LABELS[av.primaryCode] || av.primaryCode;
      lines.push(`• <b>${av.symbol}</b> — ${codeVi}: ${av.detail}`);
    }
    lines.push('');
  }

  // ── 5. TÓM TẮT DANH MỤC ──
  const exits = result.exitDecisions || [];
  const prs = result.portfolioRiskState;
  const exitCount = exits.filter(e => e.action === 'EXIT' || e.action === 'EXIT_PENDING_LOCKED').length;
  const protectCount = exits.filter(e => e.action === 'PROTECT').length;
  lines.push(
    `💼 <b>DANH MỤC:</b> Tổng vốn ${(prs.navVnd / 1e6).toFixed(2)}tr | Tiền mặt: ${(prs.availableCashVnd / 1e6).toFixed(2)}tr | ` +
    `Đang giữ: ${exits.length} mã (${exitCount} cần bán, ${protectCount} cần siết lãi)`
  );

  return lines.join('\n');
}

function formatUrgentExitAlert(exitDecision, asOf = new Date()) {
  const timeStr = toVnComponents(asOf).timeLabel;
  const iconMap = {
    DATA_RISK_ALERT: '⚠️',
    EXIT: '🔴',
    EXIT_PENDING_LOCKED: '🟠',
    EXIT_UNFILLED_LIMIT_DOWN: '🆘',
    TIME_STOP_BLOCKED: '⏳',
    PROTECT: '🟡',
  };
  const icon = iconMap[exitDecision.action] || '🔔';
  const actionVi = EXIT_ACTION_LABELS[exitDecision.action] || exitDecision.action;

  const lines = [
    `${icon} <b>[${timeStr} | ${actionVi}] ${exitDecision.symbol}</b>`,
    `• Giá vốn: <b>${fmtK(exitDecision.avgEntryVnd)}</b> | Giá hiện tại: <b>${fmtK(exitDecision.observedPriceVnd)}</b> (${fmtSignedPct(exitDecision.grossPnlPct)})`,
    `• Mức cắt lỗ kế hoạch: <b>${fmtK(exitDecision.plannedStopVnd)}</b>${exitDecision.proposedTrailStopVnd ? ` → Nâng chặn lãi lên: <b>${fmtK(exitDecision.proposedTrailStopVnd)}</b>` : ''}`,
    `• Bán được ngay: <b>${exitDecision.availableQty} cp</b> | Chờ T+2 về: <b>${exitDecision.lockedQty} cp</b>`,
    `• Chi tiết: ${exitDecision.note}`,
  ];
  return lines.join('\n');
}

module.exports = {
  formatMainScanReport,
  formatUrgentExitAlert,
  fmtK,
  fmtSignedPct,
};
