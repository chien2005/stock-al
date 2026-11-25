/**
 * AI STOCK HUNTER - Exchange Tick Size & Price Band Rules
 * Chuẩn HOSE / HNX: làm tròn giá theo bước giá hợp lệ (VND/cổ phiếu).
 */

function getTickSize(priceVnd, exchange = 'HOSE') {
  const ex = (exchange || 'HOSE').toUpperCase();
  if (ex === 'HNX' || ex === 'UPCOM') {
    return 100;
  }
  // HOSE: <10,000đ -> 10đ; 10,000đ - 49,950đ -> 50đ; >=50,000đ -> 100đ
  if (priceVnd < 10000) return 10;
  if (priceVnd < 50000) return 50;
  return 100;
}

/**
 * Làm tròn giá về bước giá hợp lệ của sàn
 * @param {number} priceVnd
 * @param {string} exchange
 * @param {'nearest'|'floor'|'ceil'} mode
 */
function roundToTick(priceVnd, exchange = 'HOSE', mode = 'nearest') {
  if (!Number.isFinite(priceVnd) || priceVnd <= 0) return 0;
  const tick = getTickSize(priceVnd, exchange);
  let rounded;
  if (mode === 'floor') {
    rounded = Math.floor((priceVnd + 1e-6) / tick) * tick;
  } else if (mode === 'ceil') {
    rounded = Math.ceil((priceVnd - 1e-6) / tick) * tick;
  } else {
    rounded = Math.round(priceVnd / tick) * tick;
  }
  // Xử lý biên chuyển bậc giá trên HOSE (vd floor từ 50,020 -> 50,000, hoặc floor từ 49,980 -> 49,950)
  return Math.round(rounded);
}

function getPriceBand(refPriceVnd, exchange = 'HOSE') {
  if (!Number.isFinite(refPriceVnd) || refPriceVnd <= 0) {
    return { ceiling: 0, floor: 0 };
  }
  const ex = (exchange || 'HOSE').toUpperCase();
  const limitPct = ex === 'HNX' ? 0.10 : ex === 'UPCOM' ? 0.15 : 0.07;
  const ceiling = roundToTick(refPriceVnd * (1 + limitPct), ex, 'floor');
  const floor = roundToTick(refPriceVnd * (1 - limitPct), ex, 'ceil');
  return { ceiling, floor };
}

function isValidTick(priceVnd, exchange = 'HOSE') {
  if (!Number.isFinite(priceVnd) || priceVnd <= 0) return false;
  const tick = getTickSize(priceVnd, exchange);
  return Math.abs(priceVnd % tick) < 1e-6;
}

module.exports = {
  getTickSize,
  roundToTick,
  getPriceBand,
  isValidTick,
};
