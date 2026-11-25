/**
 * AI STOCK HUNTER - Avoid List Engine (A01-A12)
 * Tạo danh sách các mã nên tránh mở vị thế mới kèm lý do minh bạch, không cảm tính.
 */

function evaluateAvoidReasons({
  symbol,
  universeGate,
  feature,
  zones,
  supplyDemand,
  marketRegime,
  quote = null,
  eventFlags = {},
  dataStatus = 'VALID',
}) {
  const reasons = [];

  // A01 DATA_STALE
  if (dataStatus !== 'VALID' || !feature || !feature.currentPrice) {
    reasons.push({ code: 'A01_DATA_STALE', severity: 100, detail: 'Thiếu dữ liệu hoặc dữ liệu cũ' });
  }

  // A02 TRADING_STATUS
  if (universeGate?.failReasons?.some(r => r.startsWith('U02'))) {
    reasons.push({ code: 'A02_TRADING_STATUS', severity: 95, detail: 'Cổ phiếu diện cảnh báo/kiểm soát/hạn chế GD' });
  }

  // A03 MATERIAL_EVENT
  if (eventFlags.materialRisk || universeGate?.failReasons?.some(r => r.startsWith('U07'))) {
    reasons.push({ code: 'A03_MATERIAL_EVENT', severity: 95, detail: eventFlags.materialDetail || 'Sự kiện rủi ro trọng yếu chưa xử lý' });
  }

  // A08 NO_LIQUIDITY (Limit-down hoặc thanh khoản quá thấp)
  if (quote?.isLimitDownLocked || universeGate?.failReasons?.some(r => r.startsWith('U04') || r.startsWith('U08'))) {
    reasons.push({
      code: 'A08_NO_LIQUIDITY',
      severity: quote?.isLimitDownLocked ? 90 : 60,
      detail: quote?.isLimitDownLocked ? 'Giảm sàn mất thanh khoản bên mua' : 'Thanh khoản thấp / Spread rộng',
    });
  }

  // A04 STRUCTURAL_DOWN
  if (
    feature?.daily &&
    zones?.structure === 'LH_LL' &&
    feature.daily.ma20 && feature.currentPrice < feature.daily.ma20 &&
    (feature.daily.ma50 === null || feature.currentPrice < feature.daily.ma50) &&
    (feature.rs20 === null || feature.rs20 < -2.0)
  ) {
    reasons.push({
      code: 'A04_STRUCTURAL_DOWN',
      severity: 75,
      detail: `Cấu trúc LH-LL dưới MA20/MA50, RS20 ${feature.rs20 ?? 'N/A'}`,
    });
  }

  // A05 SELLING_PRESSURE
  if (supplyDemand?.state === 'SUPPLY_PRESSURE' || supplyDemand?.cues?.includes('SUPPLY_PRESSURE_D')) {
    reasons.push({
      code: 'A05_SELLING_PRESSURE',
      severity: 80,
      detail: `Áp lực bán lớn (CLV ${supplyDemand.clvD ?? 'N/A'}, RVOL ${supplyDemand.rvolD ?? 'N/A'}x)`,
    });
  }

  // A06 FAILED_BREAKOUT
  if (supplyDemand?.cues?.includes('FAILED_BREAKOUT')) {
    reasons.push({
      code: 'A06_FAILED_BREAKOUT',
      severity: 78,
      detail: 'Vượt cản thất bại, rút râu trên bị bán ngược',
    });
  }

  // A07 OVEREXTENDED
  if (feature?.daily?.distMA20Atr !== null && feature?.daily?.distMA20Atr >= 2.5) {
    reasons.push({
      code: 'A07_OVEREXTENDED',
      severity: 45,
      detail: `Giá kéo xa MA20 (+${feature.daily.distMA20Atr} ATR), tránh mua đuổi`,
    });
  }

  // A10 EVENT_WINDOW
  if (eventFlags.highRiskUpcomingEvent) {
    reasons.push({
      code: 'A10_EVENT_WINDOW',
      severity: 70,
      detail: 'Sát ngày sự kiện trọng yếu trong cửa sổ T+2',
    });
  }

  // A11 QUALITY_UNKNOWN
  if (universeGate?.failReasons?.some(r => r.startsWith('U06'))) {
    reasons.push({ code: 'A11_QUALITY_UNKNOWN', severity: 55, detail: 'Thiếu dữ liệu chất lượng cơ bản bắt buộc' });
  }

  if (reasons.length === 0) return null;

  reasons.sort((a, b) => b.severity - a.severity);
  const topReason = reasons[0];
  return {
    symbol,
    primaryCode: topReason.code,
    severity: topReason.severity,
    detail: topReason.detail,
    allReasons: reasons,
    medianValue20Bil: universeGate?.medianValue20Bil || 0,
    priceVnd: feature?.currentPrice || null,
    changePct: feature?.changePct ?? null,
    regime: marketRegime?.regime || 'UNKNOWN',
  };
}

module.exports = { evaluateAvoidReasons };
