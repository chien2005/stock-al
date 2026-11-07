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

// ─── INTRADAY BASIS BASELINE TRACKER ─────────────────────────
const _basisTracker = {
  date: '',
  samples: [], // Lưu các mẫu { time, basis, vn30Delta, f1mDelta }
};

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

  // 1. Phân tích Basis (F1M - VN30) theo đặc thù TTCK Việt Nam
  // Nguyên tắc: Thị trường VN đa số giữ dương (+6 đến +8đ là bình thường, không có nhiều ý nghĩa)
  // Chỉ cảnh giác khi:
  //   a) VN30 tăng mà Basis chuyển âm / duy trì âm -> Bẫy Bò (Bull Trap), dấu hiệu sắp xả hàng, lực tăng sắp cạn!
  //   b) Thế Big Short / Xu hướng giảm mà Basis âm sâu -> Áp lực bán tháo hoặc chuẩn bị Short Squeeze.
  //   c) Đột ngột thay đổi lớn so với mức nền trung bình trong ngày.
  const basis = vn30 > 0 && f1m > 0 ? parseFloat((f1m - vn30).toFixed(2)) : 0;

  const todayStr = new Date().toLocaleDateString('vi-VN');
  if (_basisTracker.date !== todayStr) {
    _basisTracker.date = todayStr;
    _basisTracker.samples = [];
  }
  _basisTracker.samples.push({ time: Date.now(), basis, vn30Delta, f1mDelta });
  if (_basisTracker.samples.length > 100) _basisTracker.samples.shift();

  const baselineBasis = _basisTracker.samples.length > 0
    ? _basisTracker.samples.reduce((s, x) => s + x.basis, 0) / _basisTracker.samples.length
    : basis;
  const deltaFromBaseline = parseFloat((basis - baselineBasis).toFixed(1));

  let basisState = 'NORMAL_POSITIVE';
  let basisLabel = `Bình thường (${basis >= 0 ? '+' : ''}${basis}đ - Giữ dương chuẩn thị trường VN)`;
  let basisWarning = null;
  let isNotableAnomaly = false;

  // Trường hợp 1: VN30 tăng nhưng Basis chuyển Âm hoặc duy trì Âm
  if (vn30Delta > 0.3 && basis <= 0) {
    basisState = 'BEARISH_DIVERGENCE_BULL_TRAP';
    basisLabel = `⚠️ VN30 TĂNG NHƯNG BASIS ÂM (${basis}đ) ➔ BẪY BÒ / SẮP XẢ HÀNG`;
    basisWarning = 'Cơ sở kéo tăng nhưng Phái sinh chiết khấu âm. Dòng tiền nghi ngờ, dấu hiệu sắp xả hàng (Bull Trap), lực tăng sắp cạn kiệt!';
    isNotableAnomaly = true;
  }
  // Trường hợp 2: Thế Big Short / Giảm mạnh mà Basis âm sâu
  else if ((f1mDelta < -1.0 || vn30Delta < -1.0) && basis <= -3.0) {
    basisState = 'BIG_SHORT_PANIC_EXPANSION';
    basisLabel = `❄️ THẾ GIẢM MẠNH + BASIS ÂM SÂU (${basis}đ) ➔ CẢNH GIÁC BÁN THÁO / SHORT SQUEEZE`;
    basisWarning = 'Thế Short chủ đạo, Phái sinh chiết khấu âm sâu. Cảnh giác áp lực bán tháo hoặc chuẩn bị có cú nảy kỹ thuật giật quét Short Squeeze.';
    isNotableAnomaly = true;
  }
  // Trường hợp 3: Đột ngột biến động lệch mạnh so với nền trung bình trong ngày
  else if (_basisTracker.samples.length >= 5 && Math.abs(deltaFromBaseline) >= 4.0) {
    basisState = 'BASIS_SUDDEN_SHIFT';
    basisLabel = `⚡ BIẾN ĐỘNG BASIS BẤT THƯỜNG (${basis >= 0 ? '+' : ''}${basis}đ, lệch ${deltaFromBaseline > 0 ? '+' : ''}${deltaFromBaseline}đ so với nền ${baselineBasis.toFixed(1)}đ)`;
    basisWarning = `Basis đột ngột thay đổi lớn ngoài vùng nền dao động trong ngày. Theo dõi phản ứng dòng tiền tay to.`;
    isNotableAnomaly = true;
  }
  // Trường hợp 4: Basis âm đơn thuần (không có nhịp tăng)
  else if (basis < 0) {
    basisState = 'NEGATIVE_DISCOUNT';
    basisLabel = `Chiết khấu âm nhẹ (${basis}đ)`;
    basisWarning = 'Basis âm - phe Phái sinh đang thận trọng hơn cơ sở.';
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
      isNotableAnomaly,
      deltaFromBaseline,
      baselineBasis: parseFloat(baselineBasis.toFixed(1)),
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
