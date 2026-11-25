/**
 * AI STOCK HUNTER - Universe & Quality Gate Engine
 * Áp dụng Hard Gates U01-U08 để tách rạch ròi:
 * - Eligible Core Universe (đủ điều kiện quét tìm cơ hội MUA)
 * - Rejected / Blocked symbols (ghi rõ reason codes A02/A08/A11...)
 * Lưu ý: Vị thế đang nắm giữ luôn được Exit Guardian theo dõi độc lập dù bị loại khỏi Universe!
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { SEED_INSTRUMENTS } = require('../config/universeSeed');
const { getQualityProfile } = require('../config/qualityProfiles');

function computeMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Đánh giá chất lượng & thanh khoản cho 1 mã cổ phiếu theo Hard Gates U01-U08
 */
function evaluateInstrumentGates(instrument, dailyBars = [], realtimeQuote = null, metadataOverride = {}) {
  const cfg = STOCK_HUNTER_CONFIG.universe;
  const failReasons = [];

  const exchange = (realtimeQuote?.exchange || instrument.exchange || 'HOSE').toUpperCase();
  const status = (metadataOverride.status || 'ACTIVE').toUpperCase();

  // U01: Exchange support (HOSE / HNX mặc định; UPCoM tách riêng chính sách)
  if (!cfg.supportedExchanges.includes(exchange)) {
    failReasons.push(`U01_UNSUPPORTED_EXCHANGE_${exchange}`);
  }

  // U02: Trạng thái giao dịch (đình chỉ / hạn chế / cảnh báo / kiểm soát)
  if (['SUSPENDED', 'HALTED', 'RESTRICTED', 'WARNING', 'CONTROL'].includes(status)) {
    failReasons.push(`U02_TRADING_STATUS_${status}`);
  }

  // U03: Độ dài lịch sử nến Ngày
  const validBars = Array.isArray(dailyBars) ? dailyBars : [];
  if (validBars.length < cfg.minDailyBars) {
    failReasons.push(`U03_INSUFFICIENT_HISTORY_${validBars.length}_OF_${cfg.minDailyBars}`);
  }

  // U04: Thanh khoản thực tế (Median GT khớp lệnh 20 phiên >= 20 tỷ VND)
  const last20 = validBars.slice(-20);
  const matchedValues20 = last20.map(b => b.matchedValueVnd || (b.close * b.volume));
  const medianValue20 = computeMedian(matchedValues20);
  if (last20.length >= 15 && medianValue20 < cfg.minMedianMatchedValue20dVnd) {
    failReasons.push(`U04_LOW_LIQUIDITY_${Math.round(medianValue20 / 1e9)}B`);
  }

  // U05: Giá tối thiểu & vốn hóa (nếu có dữ liệu vốn hóa)
  const latestPrice = realtimeQuote?.priceVnd || (validBars.length > 0 ? validBars[validBars.length - 1].close : 0);
  if (latestPrice > 0 && latestPrice < cfg.minPriceVnd) {
    failReasons.push(`U05_PENNY_PRICE_${latestPrice}`);
  }
  if (Number.isFinite(metadataOverride.marketCapVnd) && metadataOverride.marketCapVnd < cfg.minMarketCapVnd) {
    failReasons.push('U05_LOW_MARKET_CAP');
  }

  // U06 / U07: Material risk event & Quality score (nếu có fundamental feed)
  if (metadataOverride.materialEventBlock === true) {
    failReasons.push('U07_MATERIAL_EVENT_BLOCK');
  }
  let qualityState = 'UNKNOWN';
  if (Number.isFinite(metadataOverride.qualityScore) && Number.isFinite(metadataOverride.qualityCoverage)) {
    if (metadataOverride.qualityCoverage < cfg.minQualityCoverage) {
      qualityState = 'QUALITY_COVERAGE_LOW';
      failReasons.push('U06_QUALITY_COVERAGE_LOW');
    } else if (metadataOverride.qualityScore < cfg.minQualityScore) {
      qualityState = 'QUALITY_FAIL';
      failReasons.push('U06_QUALITY_SCORE_LOW');
    } else {
      qualityState = 'QUALITY_PASS';
    }
  }

  // U08: Spread quá rộng hoặc sàn mất thanh khoản tại thời điểm xét
  if (realtimeQuote) {
    if (realtimeQuote.isLimitDownLocked) {
      failReasons.push('U08_LIMIT_DOWN_LOCKED');
    }
    if (realtimeQuote.spreadPct !== null && realtimeQuote.spreadPct > 2.5) {
      failReasons.push(`U08_WIDE_SPREAD_${realtimeQuote.spreadPct}%`);
    }
  }

  return {
    symbol: instrument.symbol,
    sector: instrument.sector,
    sectorCode: instrument.sectorCode,
    exchange,
    riskCluster: instrument.riskCluster,
    eligibleForBuy: failReasons.length === 0,
    failReasons,
    medianValue20Bil: parseFloat((medianValue20 / 1e9).toFixed(2)),
    historyBarsCount: validBars.length,
    qualityState,
  };
}

/**
 * Lọc toàn bộ Seed Universe tại thời điểm hiện tại
 */
function buildActiveUniverse(dailyBarsBySymbol = {}, quotesBySymbol = new Map(), metadataBySymbol = {}) {
  const eligible = [];
  const rejected = [];

  for (const inst of SEED_INSTRUMENTS) {
    const bars = dailyBarsBySymbol[inst.symbol] || [];
    const quote = quotesBySymbol instanceof Map ? quotesBySymbol.get(inst.symbol) : quotesBySymbol[inst.symbol];
    const profile = getQualityProfile(inst.symbol);
    const meta = {
      ...profile,
      ...(metadataBySymbol[inst.symbol] || {}),
    };
    const evalRes = evaluateInstrumentGates(inst, bars, quote, meta);
    if (evalRes.eligibleForBuy) {
      eligible.push(evalRes);
    } else {
      rejected.push(evalRes);
    }
  }

  return {
    universeVersion: STOCK_HUNTER_CONFIG.universe.version,
    totalSeed: SEED_INSTRUMENTS.length,
    eligibleCount: eligible.length,
    rejectedCount: rejected.length,
    eligible,
    rejected,
    eligibleMap: new Map(eligible.map(e => [e.symbol, e])),
  };
}

module.exports = {
  computeMedian,
  evaluateInstrumentGates,
  buildActiveUniverse,
};
