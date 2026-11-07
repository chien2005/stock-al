/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🇻🇳 VN30F v9.0 — Vietnam Market Context Engine               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Bối cảnh thị trường phái sinh đặc thù Việt Nam:              ║
 * ║  1. Tam mã đồng thuận: VN30F1M vs VN30 vs VN-INDEX            ║
 * ║  2. Độ lệch Basis (Đo độ rướn Fomo hoặc Hoảng loạn cực đại)   ║
 * ║  3. Giám sát 7 Trụ điều tiết (VIC, VHM, VPL, MCH, VCB, GAS...)║
 * ║  4. Smart Money & Vị thế Lũy Kế Khối Ngoại (từ oiTracker)     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const dataFetcher = require('./dataFetcher');
const pillarMonitor = require('./pillarMonitor');
const oiTracker = require('./oiTracker');

async function analyzeVietnamMarketContext() {
  // Fetch đồng thời các nguồn dữ liệu realtime
  const [
    futuresPrice,
    vn30Price,
    vnindexPrice,
    realtimeOI,
    pillarData
  ] = await Promise.all([
    dataFetcher.fetchRealtimeFuturesPrice().catch(() => null),
    dataFetcher.fetchRealtimeVN30Price().catch(() => null),
    dataFetcher.fetchRealtimeVNINDEXPrice().catch(() => null),
    dataFetcher.fetchDerivativesOIData().catch(() => null),
    pillarMonitor.fetchPillarData().catch(() => null),
  ]);

  const f1m = futuresPrice ? futuresPrice.price : 0;
  const f1mPrev = futuresPrice ? futuresPrice.prevPrice : f1m;
  const f1mDelta = f1m - f1mPrev;

  const vn30 = vn30Price ? vn30Price.price : 0;
  const vn30Prev = vn30Price ? vn30Price.prevPrice : vn30;
  const vn30Delta = vn30 - vn30Prev;

  const vnidx = vnindexPrice ? vnindexPrice.price : 0;
  const vnidxPrev = vnindexPrice ? vnindexPrice.prevPrice : vnidx;
  const vnidxDelta = vnidx - vnidxPrev;

  // 1. Phân tích Basis (F1M - VN30)
  const basis = vn30 > 0 && f1m > 0 ? parseFloat((f1m - vn30).toFixed(2)) : 0;
  let basisState = 'NORMAL';
  let basisLabel = `Bình thường (${basis >= 0 ? '+' : ''}${basis}đ)`;
  let basisWarning = null;

  if (basis >= 7.0) {
    basisState = 'EXTREME_POSITIVE';
    basisLabel = `🔥 BASIS DƯƠNG RẤT CAO (+${basis}đ)`;
    basisWarning = 'Phe Long hưng phấn quá đà, phái sinh chạy trước cơ sở. RỦI RO BẪY ĐU ĐỈNH LONG!';
  } else if (basis <= -7.0) {
    basisState = 'EXTREME_NEGATIVE';
    basisLabel = `❄️ BASIS ÂM RẤT SÂU (${basis}đ)`;
    basisWarning = 'Phe Short hoảng loạn ép chiết khấu quá đà. RỦI RO SHORT SQUEEZE (BẬT TĂNG NGƯỢC)!';
  } else if (basis >= 3.0) {
    basisState = 'POSITIVE';
    basisLabel = `Thiên Long (+${basis}đ)`;
  } else if (basis <= -3.0) {
    basisState = 'NEGATIVE';
    basisLabel = `Thiên Short (${basis}đ)`;
  }

  // 2. Phân tích 7 Trụ Điều Tiết
  const pillarAnalysis = pillarMonitor.analyzePillars(pillarData);
  const pillarStatus = pillarAnalysis ? pillarAnalysis.consensusLabel : 'N/A';
  const pillarWarnings = pillarAnalysis?.manipulationWarnings || [];

  // 3. Phân tích Đồng Thuận 3 Chỉ Số
  let alignment = 'DIVIDED';
  let alignmentLabel = 'Phân hóa giằng co';

  const isF1mUp = f1mDelta > 0.5;
  const isVn30Up = vn30Delta > 0.5;
  const isVnidxUp = vnidxDelta > 0.5;

  const isF1mDown = f1mDelta < -0.5;
  const isVn30Down = vn30Delta < -0.5;
  const isVnidxDown = vnidxDelta < -0.5;

  if (isF1mUp && isVn30Up && isVnidxUp) {
    alignment = 'FULL_BULLISH';
    alignmentLabel = '🟢 ĐỒNG THUẬN TĂNG TOÀN DIỆN (F1M, VN30, VN-Index cùng xanh)';
  } else if (isF1mDown && isVn30Down && isVnidxDown) {
    alignment = 'FULL_BEARISH';
    alignmentLabel = '🔴 ĐỒNG THUẬN GIẢM TOÀN DIỆN (F1M, VN30, VN-Index cùng đỏ)';
  } else {
    alignment = 'DIVIDED';
    alignmentLabel = '🟡 LỆCH PHA CƠ SỞ & PHÁI SINH (Dấu hiệu giằng co hoặc bẫy giá)';
  }

  // 4. Lấy Snapshot vị thế Smart Money & OI từ oiTracker
  const oiAnalysis = oiTracker.analyzeOIPositions ? oiTracker.analyzeOIPositions() : null;
  const foreignCumNN = oiAnalysis ? oiAnalysis.foreign.cumNN : -4147;
  const foreignSessionNet = oiAnalysis ? oiAnalysis.foreign.sessionNet : 0;
  const totalOI = oiAnalysis ? oiAnalysis.market.totalOI : 35131;
  const oiChange = oiAnalysis ? oiAnalysis.market.oiChange : 0;

  return {
    prices: {
      f1m,
      f1mDelta: parseFloat(f1mDelta.toFixed(1)),
      vn30,
      vn30Delta: parseFloat(vn30Delta.toFixed(2)),
      vnidx,
      vnidxDelta: parseFloat(vnidxDelta.toFixed(2)),
    },
    basis: {
      value: basis,
      state: basisState,
      label: basisLabel,
      warning: basisWarning,
    },
    basisContext: {
      basis,
      state: basisState,
      description: basisLabel,
      warning: basisWarning,
    },
    pillars: {
      status: pillarStatus,
      warnings: pillarWarnings,
      raw: pillarAnalysis?.pillars || {},
    },
    pillarAnalysis,
    alignment: {
      state: alignment,
      label: alignmentLabel,
    },
    smartMoney: {
      foreignCumNN,
      foreignSessionNet,
      foreignNet: foreignSessionNet,
      totalOI,
      oiChange,
      side: foreignCumNN > 0 ? 'LONG' : 'SHORT',
    },
    lastUpdated: Date.now(),
  };
}

module.exports = {
  analyzeVietnamMarketContext,
  buildVNMarketContext: analyzeVietnamMarketContext,
};
