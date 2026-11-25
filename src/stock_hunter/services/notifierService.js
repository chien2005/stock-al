/**
 * AI STOCK HUNTER - Practical Notification Formatter & Router
 * Tuân thủ Master Plan V2.0 Section 20:
 * - Bản tin ngắn gọn, thực dụng, số liệu trước, lý do sau
 * - Hiển thị giá theo nghìn VND (vd: 48.0), GT tỷ VND; thiếu số liệu ghi N/A
 * - Phân tách rõ BUY_ZONE / NEXT_SESSION_WATCH / NO_TRADE / EXIT / PROTECT / SPECIAL_WATCH / AVOID
 * - Không bao giờ giả mạo giá hay bịa số lượng nếu chưa có ledger
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { toVnComponents } = require('../core/calendar');

function fmtK(priceVnd) {
  if (!Number.isFinite(priceVnd) || priceVnd <= 0) return 'N/A';
  return (priceVnd / 1000).toFixed(2).replace(/\.?0+$/, '');
}

function fmtSignedPct(pct) {
  if (!Number.isFinite(pct)) return 'N/A';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatMainScanReport(result, label = null) {
  const vn = toVnComponents(new Date(result.asOf));
  const timeStr = label || vn.timeLabel;
  const mr = result.marketRegime;
  const b = mr.breadth || {};
  const modeTag = (STOCK_HUNTER_CONFIG.mode || 'paper').toUpperCase();
  const isPostClose = result.session === 'PUT_THROUGH_ONLY' || result.session === 'CLOSED' || result.session === 'CLOSED_HOLIDAY';

  const lines = [];
  lines.push(`📊 <b>[${timeStr} | ${modeTag} | ${result.session} | ${b.validCount || 0}/${b.expectedCount || 0} mã]</b>`);

  if (mr.vnindex) {
    lines.push(`• VN-Index: <b>${mr.vnindex.index}</b> (${fmtSignedPct(mr.vnindex.changePct)}) | MA20: ${mr.vnindex.ma20}`);
  } else {
    lines.push(`• VN-Index: <b>N/A</b>`);
  }

  const hoseValBil = mr.marketLiquidity?.hoseMatchedValueVnd
    ? `${Math.round(mr.marketLiquidity.hoseMatchedValueVnd / 1e9).toLocaleString('vi-VN')} tỷ`
    : 'N/A';
  const liqRatioStr = mr.liquidityRatio !== null ? `${mr.liquidityRatio}x median cùng giờ` : 'N/A';
  lines.push(`• GT khớp HOSE: <b>${hoseValBil}</b> (${liqRatioStr}) | TT: <b>${mr.liquidityLabel}</b>`);
  lines.push(`• Breadth: <b>${b.advancing ?? 0}</b> tăng / <b>${b.declining ?? 0}</b> giảm / <b>${b.unchanged ?? 0}</b> đứng (>MA20: ${b.pctAboveMA20 ?? 'N/A'}%)`);
  lines.push(`• Regime: <b>${mr.regime}</b> (Cap: ${Math.round((mr.exposureCap || 0) * 100)}%${mr.concentrationFlag ? ' | ⚠️ Trụ kéo' : ''})`);
  lines.push('');

  if (isPostClose) {
    lines.push(`🌙 <i>Phiên khớp lệnh liên tục đã đóng — Không phát lệnh BUY_NOW.</i>`);
    lines.push('');
  }

  // ── 1. KHUYẾN NGHỊ MUA / WATCH PHIÊN KẾ ──
  if (result.buySignals && result.buySignals.length > 0) {
    const title = isPostClose ? '🔵 THEO DÕI PHIÊN KẾ TIẾP (NEXT_SESSION_WATCH):' : '🟢 KHUYẾN NGHỊ MUA MỚI (Đạt chuẩn Cung-Cầu):';
    lines.push(`<b>${title}</b>`);
    for (const sig of result.buySignals) {
      const p = sig.tradePlan;
      lines.push(
        `• <b>[${sig.sector}] ${sig.symbol}</b> | ${sig.strategyId} | Điểm: <b>${sig.score}/100</b> (${sig.confidence})\n` +
        `  Vùng mua: <b>${fmtK(p.entryZone.min)}–${fmtK(p.entryZone.max)}</b> | SL: <b>${fmtK(p.stopVnd)}</b> (-${p.stopDistancePct}%) | TP/Cung: <b>${fmtK(p.tpRef1)}</b> (R:R ${p.rrNet})\n` +
        `  Size: <b>${sig.recommendedQty} cp</b> (~${(sig.estimatedCashRequiredVnd / 1e6).toFixed(1)}tr | Rủi ro ${sig.riskPctOfNav}% NAV)\n` +
        `  Lý do: ${sig.reasonCodes.slice(0, 4).join(', ')} (RVOL ${sig.rvolD ?? 'N/A'}x, CLV ${sig.clvD ?? 'N/A'})`
      );
    }
  } else {
    lines.push(`⚪ <b>MUA MỚI: NO_TRADE</b> — Không có mã đạt đủ toàn bộ Hard Gates & R:R.`);
  }
  lines.push('');

  // ── 2. WATCHLIST CHỜ XÁC NHẬN ──
  if (result.watchList && result.watchList.length > 0) {
    lines.push(`<b>🟡 WATCHLIST CHỜ ĐIỂM VÀO:</b>`);
    for (const w of result.watchList.slice(0, 4)) {
      lines.push(`• ${w.symbol} (${w.sector}): ${w.strategyName} — ${w.reasonCodes.slice(0, 2).join(', ')}`);
    }
    lines.push('');
  }

  // ── 3. SĂN ĐÁY ĐẶC BIỆT (B1-B5) ──
  if (result.specialWatchList && result.specialWatchList.length > 0) {
    lines.push(`<b>👀 SĂN ĐÁY ĐẶC BIỆT (Chưa mua nếu chưa đạt B5):</b>`);
    for (const sw of result.specialWatchList.slice(0, 4)) {
      lines.push(`• <b>${sw.symbol}</b> [${sw.state}] | DD: ${sw.drawdown60D ?? 'N/A'}% | RSI: ${sw.rsi14 ?? 'N/A'} | Đáy climax: ${fmtK(sw.climaxLow)} | Reclaim: ${fmtK(sw.reclaimLevel)}`);
    }
    lines.push('');
  }

  // ── 4. TOP TRÁNH XA ──
  if (result.avoidList && result.avoidList.length > 0) {
    lines.push(`<b>🚫 DANH SÁCH TRÁNH XA:</b>`);
    for (const av of result.avoidList.slice(0, 5)) {
      lines.push(`• <b>${av.symbol}</b> (${av.primaryCode}): ${av.detail}`);
    }
    lines.push('');
  }

  // ── 5. TÓM TẮT DANH MỤC ──
  const exits = result.exitDecisions || [];
  const prs = result.portfolioRiskState;
  lines.push(
    `💼 <b>DANH MỤC:</b> NAV ${(prs.navVnd / 1e6).toFixed(2)}tr | Tiền: ${(prs.availableCashVnd / 1e6).toFixed(2)}tr | ` +
    `Đang giữ: ${exits.length} mã (${exits.filter(e => e.action === 'EXIT' || e.action === 'EXIT_PENDING_LOCKED').length} EXIT, ${exits.filter(e => e.action === 'PROTECT').length} PROTECT)`
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

  const lines = [
    `${icon} <b>[${timeStr} | ${exitDecision.priority} | ${exitDecision.action}] ${exitDecision.symbol}</b>`,
    `• Giá vốn: <b>${fmtK(exitDecision.avgEntryVnd)}</b> | Hiện tại: <b>${fmtK(exitDecision.observedPriceVnd)}</b> (${fmtSignedPct(exitDecision.grossPnlPct)})`,
    `• SL kế hoạch: <b>${fmtK(exitDecision.plannedStopVnd)}</b>${exitDecision.proposedTrailStopVnd ? ` -> Trail mới: <b>${fmtK(exitDecision.proposedTrailStopVnd)}</b>` : ''}`,
    `• Khả dụng: <b>${exitDecision.availableQty} cp</b> | Chờ T+2: <b>${exitDecision.lockedQty} cp</b>`,
    `• Lý do: ${exitDecision.note}`,
  ];
  return lines.join('\n');
}

module.exports = {
  formatMainScanReport,
  formatUrgentExitAlert,
  fmtK,
  fmtSignedPct,
};
