/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📐 VN30F v4.0 — LỚP 4: Cross-Market Engine               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Basis Dynamics, OI State Classification, Lead-Lag VN30↔F1   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');
const { loadOIHistory, saveOIHistory } = require('./snapshotStore');

/**
 * Phân tích Basis Dynamics (không chỉ 1 con số)
 * @param {number} f1mPrice - Giá VN30F1M hiện tại
 * @param {number} vn30Price - Giá VN30 Index hiện tại
 * @param {Object} dailyF1M - Daily OHLCV F1M
 * @param {Object} dailyVN30 - Daily OHLCV VN30
 * @param {Object} prevBasis - Basis từ snapshot trước (nếu có)
 */
function analyzeBasis(f1mPrice, vn30Price, dailyF1M, dailyVN30, prevBasis) {
  if (!f1mPrice || !vn30Price) {
    return _emptyBasis();
  }

  const current = parseFloat((f1mPrice - vn30Price).toFixed(1));

  // Basis change so với snapshot trước (5 phút trước)
  const change5m = prevBasis != null ? parseFloat((current - prevBasis).toFixed(1)) : 0;

  // Velocity: Basis đang mở rộng hay thu hẹp?
  let velocity = 'STABLE';
  if (Math.abs(change5m) >= 1.5) velocity = change5m > 0 ? 'WIDENING_UP' : 'WIDENING_DOWN';
  else if (Math.abs(change5m) >= 0.5) velocity = change5m > 0 ? 'EXPANDING' : 'CONTRACTING';

  // Regime
  let regime = 'FAIR';
  if (current > 5) regime = 'PREMIUM_HIGH';
  else if (current > 2) regime = 'PREMIUM';
  else if (current < -5) regime = 'DISCOUNT_DEEP';
  else if (current < -2) regime = 'DISCOUNT';

  // Basis vs Price movement interaction
  // Tính price change gần nhất
  let priceDirection = 0;
  if (dailyF1M && dailyF1M.c && dailyF1M.c.length >= 2) {
    priceDirection = dailyF1M.c[dailyF1M.c.length - 1] - dailyF1M.c[dailyF1M.c.length - 2];
  }

  let interaction = 'NEUTRAL';
  if (priceDirection > 1 && change5m > 0.5) {
    interaction = 'FUTURES_LEADING_UP'; // Basis widening khi giá tăng → futures dẫn
  } else if (priceDirection > 1 && change5m < -0.5) {
    interaction = 'SPOT_LEADING_UP'; // Basis narrowing khi giá tăng → cơ sở mạnh hơn
  } else if (priceDirection < -1 && change5m < -0.5) {
    interaction = 'FUTURES_LEADING_DOWN'; // Basis widening khi giá giảm → futures bearish
  } else if (priceDirection < -1 && change5m > 0.5) {
    interaction = 'SPOT_DEFENDING'; // Basis narrowing khi giá giảm → cơ sở chống đỡ
  }

  // Historical basis average (5 phiên)
  let avgBasis5 = current;
  let basisTrend = 'STABLE';
  if (dailyF1M && dailyVN30 && dailyF1M.c && dailyVN30.c) {
    const minLen = Math.min(dailyF1M.c.length, dailyVN30.c.length);
    if (minLen >= 6) {
      const recentBases = [];
      for (let i = minLen - 6; i < minLen - 1; i++) {
        recentBases.push(dailyF1M.c[i] - dailyVN30.c[i]);
      }
      avgBasis5 = parseFloat((recentBases.reduce((s, b) => s + b, 0) / recentBases.length).toFixed(1));
      basisTrend = current > avgBasis5 ? 'EXPANDING' : 'CONTRACTING';
    }
  }

  return {
    current,
    change5m,
    velocity,
    regime,
    interaction,
    avgBasis5,
    basisTrend,
    f1mPrice: parseFloat(f1mPrice.toFixed(1)),
    vn30Price: parseFloat(vn30Price.toFixed(1)),
  };
}

/**
 * Phân loại trạng thái OI (4 trạng thái chuẩn)
 * Price ↑ + OI ↑ → LONG_BUILDUP
 * Price ↓ + OI ↑ → SHORT_BUILDUP
 * Price ↑ + OI ↓ → SHORT_COVERING
 * Price ↓ + OI ↓ → LONG_LIQUIDATION
 */
function classifyOIState(oiData, f1mPrice, dailyF1M) {
  if (!oiData || oiData.totalOI === null) {
    // Fallback: dùng dữ liệu persistent
    const history = loadOIHistory();
    if (history.history.length > 0) {
      const latest = history.history[history.history.length - 1];
      return {
        state: latest.positionState || 'NEUTRAL',
        totalOI: latest.totalOI || null,
        oiChange: latest.oiChange || 0,
        source: 'PERSISTENT',
        description: _getOIDescription(latest.positionState),
      };
    }
    return { state: 'UNKNOWN', totalOI: null, oiChange: 0, source: 'NONE', description: 'Không có dữ liệu OI' };
  }

  const deltaOI = oiData.totalOIChange || 0;

  // Price change: so sánh với phiên trước
  let deltaPrice = 0;
  if (dailyF1M && dailyF1M.c && dailyF1M.c.length >= 2) {
    deltaPrice = dailyF1M.c[dailyF1M.c.length - 1] - dailyF1M.c[dailyF1M.c.length - 2];
  }

  let state = 'NEUTRAL';
  if (deltaOI > 0 && deltaPrice > 0) state = 'LONG_BUILDUP';
  else if (deltaOI > 0 && deltaPrice < 0) state = 'SHORT_BUILDUP';
  else if (deltaOI < 0 && deltaPrice < 0) state = 'LONG_LIQUIDATION';
  else if (deltaOI < 0 && deltaPrice > 0) state = 'SHORT_COVERING';

  // Lưu vào persistent store
  const todayStr = new Date().toLocaleDateString('vi-VN', { timeZone: config.timezone });
  saveOIHistory({
    date: todayStr,
    totalOI: oiData.totalOI,
    oiChange: deltaOI,
    f1mPrice: f1mPrice || 0,
    positionState: state,
  });

  return {
    state,
    totalOI: oiData.totalOI,
    oiChange: deltaOI,
    source: 'REALTIME',
    foreignNet: oiData.foreignNet || 0,
    description: _getOIDescription(state),
  };
}

/**
 * Phân tích Lead-Lag: VN30 dẫn hay F1M dẫn?
 */
function analyzeLeadLag(vn30Intraday, f1mIntraday) {
  if (!vn30Intraday || !f1mIntraday || !vn30Intraday.c || !f1mIntraday.c) {
    return { leader: 'UNKNOWN', description: 'Không đủ dữ liệu' };
  }

  // So sánh 10 nến gần nhất
  const len = Math.min(vn30Intraday.c.length, f1mIntraday.c.length, 10);
  if (len < 5) return { leader: 'UNKNOWN', description: 'Không đủ dữ liệu' };

  const vn30Changes = [];
  const f1mChanges = [];

  for (let i = vn30Intraday.c.length - len; i < vn30Intraday.c.length - 1; i++) {
    vn30Changes.push(vn30Intraday.c[i + 1] - vn30Intraday.c[i]);
  }
  for (let i = f1mIntraday.c.length - len; i < f1mIntraday.c.length - 1; i++) {
    f1mChanges.push(f1mIntraday.c[i + 1] - f1mIntraday.c[i]);
  }

  // Tính cross-correlation (F1M dẫn = F1M thay đổi trước VN30)
  let f1mLeadScore = 0;
  let vn30LeadScore = 0;

  for (let i = 0; i < f1mChanges.length - 1; i++) {
    if (Math.sign(f1mChanges[i]) === Math.sign(vn30Changes[i + 1]) && Math.sign(f1mChanges[i]) !== 0) {
      f1mLeadScore++;
    }
    if (Math.sign(vn30Changes[i]) === Math.sign(f1mChanges[i + 1]) && Math.sign(vn30Changes[i]) !== 0) {
      vn30LeadScore++;
    }
  }

  let leader = 'SYNC';
  let description = 'VN30 và F1M đồng bộ';
  if (f1mLeadScore > vn30LeadScore + 2) {
    leader = 'F1M_LEADS';
    description = 'Phái sinh (F1M) đang DẪN DẮT thị trường';
  } else if (vn30LeadScore > f1mLeadScore + 2) {
    leader = 'VN30_LEADS';
    description = 'Cơ sở (VN30) đang DẪN DẮT';
  }

  return { leader, f1mLeadScore, vn30LeadScore, description };
}

// ─── HELPERS ─────────────────────────────────────────────────
function _emptyBasis() {
  return {
    current: 0, change5m: 0, velocity: 'STABLE', regime: 'FAIR',
    interaction: 'NEUTRAL', avgBasis5: 0, basisTrend: 'STABLE',
    f1mPrice: 0, vn30Price: 0,
  };
}

function _getOIDescription(state) {
  const descriptions = {
    'LONG_BUILDUP': 'Giá ↑ + OI ↑ → Phe Long đang tích lũy thêm vị thế',
    'SHORT_BUILDUP': 'Giá ↓ + OI ↑ → Phe Short đang tích lũy thêm vị thế',
    'LONG_LIQUIDATION': 'Giá ↓ + OI ↓ → Phe Long đang thanh lý vị thế (bán tháo)',
    'SHORT_COVERING': 'Giá ↑ + OI ↓ → Phe Short đang đóng vị thế (chốt lời)',
    'LONG_ACCUMULATION': 'Phe Long gom vị thế qua đêm',
    'SHORT_ACCUMULATION': 'Phe Short găm vị thế qua đêm',
    'STRONG_LONG_PRESSURE': 'Áp lực Long mạnh',
    'STRONG_SHORT_PRESSURE': 'Áp lực Short mạnh',
    'HOLD': 'Duy trì vị thế ổn định',
    'NEUTRAL': 'Cân bằng — chưa rõ xu hướng',
  };
  return descriptions[state] || 'Cân bằng — vị thế ổn định';
}

module.exports = {
  analyzeBasis,
  classifyOIState,
  analyzeLeadLag,
};
