/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN STOCK BOT — Derivatives OI & Basis Tracker v1.0      ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║                                                               ║
 * ║  Phân tích chuyên sâu Phái sinh VN30F:                       ║
 * ║  1. Basis (Premium/Discount) = VN30F - VN30 Index             ║
 * ║  2. Ước tính xu hướng OI từ Volume + Price Action             ║
 * ║  3. Long/Short Bias — Phe nào đang chiếm ưu thế              ║
 * ║  4. Lịch sử Basis 5-10 phiên gần nhất                        ║
 * ║                                                               ║
 * ║  📅 Cron: 8h45 (pre-market) | 9h18 (sáng) | 19h30 (tối)     ║
 * ║  📡 Nguồn: VPS + VNDirect + Entrade (miễn phí, no API key)   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');
const { sendTelegramMessage } = require('./telegramService');

// ─── DATA SOURCES ────────────────────────────────────────────
const VPS_HISTORY_URL  = 'https://histdatafeed.vps.com.vn/tradingview/history';
const VPS_REALTIME_URL = 'https://bgapidatafeed.vps.com.vn/getliststockdata';
const VNDIRECT_CHART_URL = 'https://dchart-api.vndirect.com.vn/dchart/history';
const ENTRADE_CHART_URL  = 'https://services.entrade.com.vn/chart-api/v2/ohlcs/derivative';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── HELPER ─────────────────────────────────────────────────
function vnNow() {
  return new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
}

function formatNumber(n, decimals = 1) {
  if (n === null || n === undefined || isNaN(n)) return 'N/A';
  return Number(n).toFixed(decimals);
}

function formatVolume(v) {
  if (!v || isNaN(v)) return 'N/A';
  if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  return v.toString();
}

// ─── FETCH OHLCV DATA (Multi-source fallback) ───────────────
/**
 * Lấy dữ liệu lịch sử OHLCV cho một symbol
 * Thử VPS → VNDirect → Entrade (fallback chain)
 * @param {string} symbol - VN30F1M, VN30F2M, VN30, VNINDEX
 * @param {number} days - Số ngày lịch sử cần lấy
 * @returns {Object|null} { t[], o[], h[], l[], c[], v[] }
 */
async function fetchOHLCV(symbol, days = 30) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * days;

  // Source 1: VPS History
  try {
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=${symbol}&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );
    if (res.data && res.data.s === 'ok' && res.data.c && res.data.c.length > 0) {
      return res.data;
    }
  } catch (e) {
    console.log(`   ⚠️ VPS History fallback for ${symbol}: ${e.message}`);
  }

  // Source 2: VNDirect Chart
  try {
    const res = await axios.get(
      `${VNDIRECT_CHART_URL}?symbol=${symbol}&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );
    if (res.data && res.data.s === 'ok' && res.data.c && res.data.c.length > 0) {
      return res.data;
    }
  } catch (e) {
    console.log(`   ⚠️ VNDirect Chart fallback for ${symbol}: ${e.message}`);
  }

  // Source 3: Entrade (chỉ cho derivative symbols)
  if (symbol.includes('VN30F')) {
    try {
      const res = await axios.get(
        `${ENTRADE_CHART_URL}?symbol=${symbol}&resolution=1D&from=${from}&to=${now}`,
        { headers: HEADERS, timeout: 8000 }
      );
      if (res.data && res.data.c && res.data.c.length > 0) {
        return { ...res.data, s: 'ok' };
      }
    } catch (e) {
      console.log(`   ⚠️ Entrade fallback for ${symbol}: ${e.message}`);
    }
  }

  return null;
}

/**
 * Lấy giá realtime từ VPS (chỉ hoạt động trong giờ giao dịch T2-T6)
 * @param {string[]} symbols
 * @returns {Object[]} array of stock data
 */
async function fetchRealtimePrice(symbols) {
  try {
    const syms = Array.isArray(symbols) ? symbols.join(',') : symbols;
    const res = await axios.get(`${VPS_REALTIME_URL}/${syms}`, {
      headers: HEADERS, timeout: 8000
    });
    return res.data || [];
  } catch (e) {
    return [];
  }
}

// ─── CORE: Lấy toàn bộ dữ liệu phái sinh ──────────────────
/**
 * Fetch tất cả dữ liệu cần thiết cho phân tích phái sinh
 * @returns {Object} { f1m, f2m, vn30, vnindex, realtimeF1M, realtimeVN30 }
 */
async function fetchAllDerivativesData() {
  console.log('   📡 Đang lấy dữ liệu phái sinh từ multi-source...');

  const [f1m, f2m, vn30, vnindex] = await Promise.all([
    fetchOHLCV('VN30F1M', 30),
    fetchOHLCV('VN30F2M', 30),
    fetchOHLCV('VN30', 30),
    fetchOHLCV('VNINDEX', 30),
  ]);

  // Thử lấy giá realtime (chỉ hoạt động trong giờ GD)
  const realtimeData = await fetchRealtimePrice('VN30F1M,VN30F2M');
  const realtimeF1M = realtimeData.find(d => d.sym === 'VN30F1M') || null;
  const realtimeF2M = realtimeData.find(d => d.sym === 'VN30F2M') || null;

  console.log(`   ✅ F1M: ${f1m ? f1m.c.length + ' phiên' : 'FAIL'} | F2M: ${f2m ? f2m.c.length + ' phiên' : 'FAIL'} | VN30: ${vn30 ? vn30.c.length + ' phiên' : 'FAIL'}`);

  return { f1m, f2m, vn30, vnindex, realtimeF1M, realtimeF2M };
}

// ─── ANALYSIS: Tính Basis (Premium/Discount) ────────────────
/**
 * Tính Basis = Giá Futures - Giá VN30 Index
 * Basis > 0 → Premium (Long mạnh)
 * Basis < 0 → Discount (Short mạnh)
 */
function calculateBasis(f1mData, f2mData, vn30Data) {
  if (!f1mData || !vn30Data || !f1mData.c || !vn30Data.c) {
    return { current: null, history: [], f2mBasis: null };
  }

  const f1mCloses = f1mData.c;
  const vn30Closes = vn30Data.c;
  const f2mCloses = f2mData ? f2mData.c : [];

  // Lấy các phiên có dữ liệu song song (align theo index cuối)
  const minLen = Math.min(f1mCloses.length, vn30Closes.length);
  const history = [];

  for (let i = 0; i < Math.min(minLen, 10); i++) {
    const idx1 = f1mCloses.length - minLen + i;
    const idx2 = vn30Closes.length - minLen + i;
    const basisF1M = f1mCloses[idx1] - vn30Closes[idx2];
    const basisF2M = f2mCloses.length > 0 && (f2mCloses.length - minLen + i) >= 0
      ? f2mCloses[f2mCloses.length - minLen + i] - vn30Closes[idx2]
      : null;
    const timestamp = f1mData.t ? f1mData.t[idx1] : null;

    history.push({
      date: timestamp ? new Date(timestamp * 1000).toLocaleDateString('vi-VN', { timeZone: config.timezone }) : `T-${minLen - 1 - i}`,
      f1mPrice: f1mCloses[idx1],
      vn30Price: vn30Closes[idx2],
      basisF1M: parseFloat(basisF1M.toFixed(2)),
      basisF2M: basisF2M !== null ? parseFloat(basisF2M.toFixed(2)) : null,
      f1mVolume: f1mData.v ? f1mData.v[idx1] : null,
    });
  }

  // Giá trị hiện tại (phiên gần nhất)
  const latestF1M = f1mCloses[f1mCloses.length - 1];
  const latestVN30 = vn30Closes[vn30Closes.length - 1];
  const currentBasis = parseFloat((latestF1M - latestVN30).toFixed(2));

  // Basis F2M
  const latestF2M = f2mCloses.length > 0 ? f2mCloses[f2mCloses.length - 1] : null;
  const f2mBasis = latestF2M !== null ? parseFloat((latestF2M - latestVN30).toFixed(2)) : null;

  // Basis trend (so sánh hiện tại vs TB5 phiên trước)
  const recentBases = history.slice(-6, -1).map(h => h.basisF1M);
  const avgBasis5 = recentBases.length > 0
    ? recentBases.reduce((s, b) => s + b, 0) / recentBases.length
    : currentBasis;
  const basisTrend = currentBasis > avgBasis5 ? 'EXPANDING' : 'CONTRACTING';

  return {
    current: currentBasis,
    f2mBasis,
    latestF1M,
    latestF2M,
    latestVN30,
    avgBasis5: parseFloat(avgBasis5.toFixed(2)),
    basisTrend,
    history: history.slice(-5), // 5 phiên gần nhất
  };
}

// ─── ANALYSIS: Ước tính xu hướng OI ─────────────────────────
/**
 * Ước tính xu hướng OI dựa trên Volume + Price Action
 *
 * Logic (Wyckoff Volume Spread Analysis):
 * - Volume tăng + Price trending (cùng chiều) → OI TĂNG (Mở HĐ mới)
 * - Volume tăng + Price reversal (ngược chiều) → OI GIẢM (Đóng HĐ cũ)
 * - Volume giảm + Price trending → OI không đổi hoặc giảm nhẹ
 * - Volume spike + Price sideway → Accumulation/Distribution
 */
function estimateOITrend(f1mData) {
  if (!f1mData || !f1mData.c || f1mData.c.length < 5) {
    return { trend: 'UNKNOWN', confidence: 'LOW', details: {} };
  }

  const closes = f1mData.c;
  const volumes = f1mData.v || [];
  const highs = f1mData.h || [];
  const lows = f1mData.l || [];

  const len = closes.length;

  // Volume analysis
  const todayVol = volumes[len - 1] || 0;
  const avgVol5 = volumes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
  const avgVol20 = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length - 1);
  const volRatio5 = avgVol5 > 0 ? todayVol / avgVol5 : 1;
  const volRatio20 = avgVol20 > 0 ? todayVol / avgVol20 : 1;
  const isVolumeHigh = volRatio5 >= 1.15;
  const isVolumeLow = volRatio5 < 0.85;

  // Price trend (3 phiên gần nhất)
  const priceChange1 = closes[len - 1] - closes[len - 2]; // Hôm nay vs hôm qua
  const priceChange3 = closes[len - 1] - closes[len - 4]; // Hôm nay vs 3 phiên trước
  const priceChange5 = closes[len - 1] - closes[len - 6 >= 0 ? len - 6 : 0];

  const isTrending = Math.sign(priceChange1) === Math.sign(priceChange3);
  const isReversing = Math.sign(priceChange1) !== Math.sign(priceChange3);

  // Price range (ATR ước tính)
  const ranges = [];
  for (let i = Math.max(0, len - 5); i < len; i++) {
    ranges.push(highs[i] - lows[i]);
  }
  const avgRange = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  const todayRange = highs[len - 1] - lows[len - 1];
  const rangeRatio = avgRange > 0 ? todayRange / avgRange : 1;

  // OI Trend estimation
  let oiTrend = 'STABLE';
  let confidence = 'MEDIUM';
  let explanation = '';

  if (isVolumeHigh && isTrending) {
    // Volume tăng + Price trending → OI TĂNG (mở hợp đồng mới)
    oiTrend = 'INCREASING';
    confidence = 'HIGH';
    explanation = 'Volume tăng mạnh + Giá trending cùng chiều → Mở HĐ mới (OI tăng)';
  } else if (isVolumeHigh && isReversing) {
    // Volume tăng + Price reversal → OI GIẢM (đóng hợp đồng cũ)
    oiTrend = 'DECREASING';
    confidence = 'HIGH';
    explanation = 'Volume tăng mạnh + Giá đảo chiều → Đóng HĐ cũ (OI giảm)';
  } else if (isVolumeLow && isTrending) {
    // Volume giảm + Price trending → OI ổn định hoặc giảm nhẹ
    oiTrend = 'STABLE';
    confidence = 'MEDIUM';
    explanation = 'Volume thấp + Giá trending → OI ổn định, thị trường chờ tín hiệu';
  } else if (isVolumeHigh && rangeRatio < 0.7) {
    // Volume spike + Range nhỏ → Accumulation/Distribution
    oiTrend = 'ACCUMULATING';
    confidence = 'MEDIUM';
    explanation = 'Volume đột biến nhưng giá không biến động → Tích lũy/Phân phối vị thế';
  } else {
    oiTrend = 'STABLE';
    confidence = 'LOW';
    explanation = 'Không có tín hiệu rõ ràng về thay đổi OI';
  }

  return {
    trend: oiTrend,
    confidence,
    explanation,
    details: {
      todayVolume: todayVol,
      avgVol5: Math.round(avgVol5),
      avgVol20: Math.round(avgVol20),
      volRatio5: parseFloat(volRatio5.toFixed(2)),
      volRatio20: parseFloat(volRatio20.toFixed(2)),
      priceChange1: parseFloat(priceChange1.toFixed(2)),
      priceChange3: parseFloat(priceChange3.toFixed(2)),
      priceChange5: parseFloat(priceChange5.toFixed(2)),
      todayRange: parseFloat(todayRange.toFixed(2)),
      avgRange: parseFloat(avgRange.toFixed(2)),
      isTrending,
      isReversing,
    },
  };
}

// ─── ANALYSIS: Long/Short Bias ──────────────────────────────
/**
 * Phân tích tổng hợp phe Long hay Short đang chiếm ưu thế
 * Kết hợp: Basis + Volume + Price Action + Trend
 */
function analyzeLongShortBias(basisResult, oiResult, f1mData, vn30Data) {
  let longScore = 0;
  let shortScore = 0;
  const reasons = [];

  if (!basisResult || basisResult.current === null) {
    return { bias: 'NEUTRAL', score: 0, reasons: ['Không đủ dữ liệu'] };
  }

  // ── Factor 1: Basis hiện tại (Weight: 3) ──
  const basis = basisResult.current;
  if (basis > 10) {
    longScore += 3;
    reasons.push(`✅ Basis = +${formatNumber(basis)}đ (Premium lớn → Phe Long rất mạnh)`);
  } else if (basis > 3) {
    longScore += 2;
    reasons.push(`✅ Basis = +${formatNumber(basis)}đ (Premium → Phe Long chiếm ưu thế)`);
  } else if (basis > 0) {
    longScore += 1;
    reasons.push(`📊 Basis = +${formatNumber(basis)}đ (Premium nhẹ → Phe Long hơi nhỉnh)`);
  } else if (basis < -10) {
    shortScore += 3;
    reasons.push(`🔴 Basis = ${formatNumber(basis)}đ (Discount sâu → Phe Short rất mạnh)`);
  } else if (basis < -3) {
    shortScore += 2;
    reasons.push(`🔴 Basis = ${formatNumber(basis)}đ (Discount → Phe Short chiếm ưu thế)`);
  } else if (basis < 0) {
    shortScore += 1;
    reasons.push(`📊 Basis = ${formatNumber(basis)}đ (Discount nhẹ → Phe Short hơi nhỉnh)`);
  } else {
    reasons.push(`⚖️ Basis = 0 (Cân bằng tuyệt đối)`);
  }

  // ── Factor 2: Basis Trend (Weight: 2) ──
  if (basisResult.basisTrend === 'EXPANDING') {
    if (basis > 0) {
      longScore += 2;
      reasons.push('📈 Basis đang MỞ RỘNG (Premium tăng → Long đang tích lũy thêm)');
    } else {
      shortScore += 2;
      reasons.push('📉 Basis đang MỞ RỘNG (Discount sâu hơn → Short đang tích lũy thêm)');
    }
  } else {
    if (basis > 0) {
      shortScore += 1;
      reasons.push('📉 Basis đang THU HẸP (Premium giảm → Long đang chốt lời/đóng vị thế)');
    } else {
      longScore += 1;
      reasons.push('📈 Basis đang THU HẸP (Discount giảm → Short đang đóng vị thế)');
    }
  }

  // ── Factor 3: OI Trend (Weight: 2) ──
  if (oiResult && oiResult.trend !== 'UNKNOWN') {
    const priceTrending = oiResult.details.priceChange1 > 0;

    if (oiResult.trend === 'INCREASING') {
      if (priceTrending) {
        longScore += 2;
        reasons.push('📊 OI ↑ TĂNG + Giá ↑ TĂNG → Mở Long mới (Xu hướng tăng mạnh)');
      } else {
        shortScore += 2;
        reasons.push('📊 OI ↑ TĂNG + Giá ↓ GIẢM → Mở Short mới (Xu hướng giảm mạnh)');
      }
    } else if (oiResult.trend === 'DECREASING') {
      if (priceTrending) {
        shortScore += 1;
        reasons.push('📊 OI ↓ GIẢM + Giá ↑ TĂNG → Short covering (Đóng Short → Giá tăng tạm)');
      } else {
        longScore += 1;
        reasons.push('📊 OI ↓ GIẢM + Giá ↓ GIẢM → Long liquidation (Đóng Long → Giá giảm tạm)');
      }
    }
  }

  // ── Factor 4: Price Momentum (Weight: 1) ──
  if (f1mData && f1mData.c && f1mData.c.length >= 5) {
    const closes = f1mData.c;
    const sma5 = closes.slice(-5).reduce((s, c) => s + c, 0) / 5;
    const latest = closes[closes.length - 1];

    if (latest > sma5) {
      longScore += 1;
      reasons.push(`📈 Giá VN30F1M (${formatNumber(latest)}) > SMA5 (${formatNumber(sma5)}) → Momentum tăng`);
    } else {
      shortScore += 1;
      reasons.push(`📉 Giá VN30F1M (${formatNumber(latest)}) < SMA5 (${formatNumber(sma5)}) → Momentum giảm`);
    }
  }

  // ── Factor 5: VN30 Index Trend (Weight: 1) ──
  if (vn30Data && vn30Data.c && vn30Data.c.length >= 20) {
    const closes = vn30Data.c;
    const sma20 = closes.slice(-20).reduce((s, c) => s + c, 0) / 20;
    const latest = closes[closes.length - 1];

    if (latest > sma20) {
      longScore += 1;
      reasons.push(`📈 VN30 (${formatNumber(latest)}) > SMA20 (${formatNumber(sma20)}) → Uptrend`);
    } else {
      shortScore += 1;
      reasons.push(`📉 VN30 (${formatNumber(latest)}) < SMA20 (${formatNumber(sma20)}) → Downtrend`);
    }
  }

  const totalScore = longScore - shortScore;
  let bias = 'NEUTRAL';
  if (totalScore >= 4) bias = 'STRONG_LONG';
  else if (totalScore >= 2) bias = 'LONG';
  else if (totalScore >= 1) bias = 'SLIGHT_LONG';
  else if (totalScore <= -4) bias = 'STRONG_SHORT';
  else if (totalScore <= -2) bias = 'SHORT';
  else if (totalScore <= -1) bias = 'SLIGHT_SHORT';

  return {
    bias,
    score: totalScore,
    longScore,
    shortScore,
    reasons,
  };
}

// ─── BUILD TELEGRAM REPORT ──────────────────────────────────
/**
 * Tạo báo cáo Telegram HTML
 * @param {string} session - 'pre-market' | 'morning' | 'evening'
 * @param {Object} data - Tất cả dữ liệu phân tích
 */
function buildReport(session, data) {
  const { basisResult, oiResult, biasResult, f1mData, f2mData, vn30Data } = data;

  const sessionLabels = {
    'pre-market': '🌅 TRƯỚC PHIÊN (8h45)',
    'morning': '📊 ĐẦU PHIÊN (9h18)',
    'evening': '🌙 TỔNG KẾT NGÀY (19h30)',
    'test': '🧪 TEST',
  };

  const biasIcons = {
    'STRONG_LONG': '🟢🟢🟢',
    'LONG': '🟢🟢',
    'SLIGHT_LONG': '🟢',
    'NEUTRAL': '⚖️',
    'SLIGHT_SHORT': '🔴',
    'SHORT': '🔴🔴',
    'STRONG_SHORT': '🔴🔴🔴',
  };

  const biasTexts = {
    'STRONG_LONG': 'PHE LONG ÁP ĐẢO HOÀN TOÀN',
    'LONG': 'PHE LONG CHIẾM ƯU THẾ',
    'SLIGHT_LONG': 'PHE LONG HƠI NHỈNH',
    'NEUTRAL': 'CÂN BẰNG — CHƯA PHÂN THẮNG BẠI',
    'SLIGHT_SHORT': 'PHE SHORT HƠI NHỈNH',
    'SHORT': 'PHE SHORT CHIẾM ƯU THẾ',
    'STRONG_SHORT': 'PHE SHORT ÁP ĐẢO HOÀN TOÀN',
  };

  const oiTrendIcons = {
    'INCREASING': '📈 TĂNG',
    'DECREASING': '📉 GIẢM',
    'STABLE': '➡️ ỔN ĐỊNH',
    'ACCUMULATING': '🔄 TÍCH LŨY',
    'UNKNOWN': '❓ CHƯA XÁC ĐỊNH',
  };

  let msg = '';
  msg += `📊 <b>BÁO CÁO PHÁI SINH VN30F — ${sessionLabels[session] || session}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ── Section 1: Giá hiện tại ──
  if (basisResult && basisResult.latestF1M) {
    const f1mChange = f1mData && f1mData.c && f1mData.c.length >= 2
      ? ((f1mData.c[f1mData.c.length - 1] - f1mData.c[f1mData.c.length - 2]) / f1mData.c[f1mData.c.length - 2] * 100)
      : 0;
    const vn30Change = vn30Data && vn30Data.c && vn30Data.c.length >= 2
      ? ((vn30Data.c[vn30Data.c.length - 1] - vn30Data.c[vn30Data.c.length - 2]) / vn30Data.c[vn30Data.c.length - 2] * 100)
      : 0;

    msg += `📈 <b>GIÁ PHIÊN GẦN NHẤT:</b>\n`;
    msg += `   • VN30F1M: <b>${formatNumber(basisResult.latestF1M)}</b>`;
    msg += f1mChange !== 0 ? ` (${f1mChange >= 0 ? '+' : ''}${formatNumber(f1mChange)}%)\n` : '\n';
    msg += `   • VN30 Index: <b>${formatNumber(basisResult.latestVN30)}</b>`;
    msg += vn30Change !== 0 ? ` (${vn30Change >= 0 ? '+' : ''}${formatNumber(vn30Change)}%)\n` : '\n';
    if (basisResult.latestF2M) {
      msg += `   • VN30F2M: <b>${formatNumber(basisResult.latestF2M)}</b>\n`;
    }
    msg += '\n';
  }

  // ── Section 2: Basis Analysis ──
  if (basisResult && basisResult.current !== null) {
    const basisSign = basisResult.current >= 0 ? '+' : '';
    const basisStatus = basisResult.current > 5
      ? '🔥 PREMIUM LỚN (Phe Long đang trả giá cao)'
      : basisResult.current > 0
      ? '✅ PREMIUM (Phe Long nhỉnh hơn)'
      : basisResult.current < -5
      ? '🔥 DISCOUNT SÂU (Phe Short đang ép giá)'
      : basisResult.current < 0
      ? '🔴 DISCOUNT (Phe Short nhỉnh hơn)'
      : '⚖️ NGANG BẰNG';

    msg += `💹 <b>BASIS (CHÊNH LỆCH PHÁI SINH vs CƠ SỞ):</b>\n`;
    msg += `   • Basis F1M: <b>${basisSign}${formatNumber(basisResult.current)} điểm</b>\n`;
    if (basisResult.f2mBasis !== null) {
      const f2mSign = basisResult.f2mBasis >= 0 ? '+' : '';
      msg += `   • Basis F2M: <b>${f2mSign}${formatNumber(basisResult.f2mBasis)} điểm</b>\n`;
    }
    msg += `   • TB Basis 5 phiên: <b>${basisResult.avgBasis5 >= 0 ? '+' : ''}${formatNumber(basisResult.avgBasis5)} điểm</b>\n`;
    msg += `   • Xu hướng: <b>${basisResult.basisTrend === 'EXPANDING' ? '↗️ MỞ RỘNG' : '↘️ THU HẸP'}</b>\n`;
    msg += `   • Trạng thái: ${basisStatus}\n\n`;
  }

  // ── Section 3: OI Estimate ──
  if (oiResult && oiResult.trend !== 'UNKNOWN') {
    msg += `📊 <b>ƯỚC TÍNH OPEN INTEREST (OI):</b>\n`;
    msg += `   • Xu hướng OI: <b>${oiTrendIcons[oiResult.trend]}</b> (Độ tin cậy: ${oiResult.confidence})\n`;
    msg += `   • <i>${oiResult.explanation}</i>\n`;
    if (oiResult.details) {
      msg += `   • Volume hôm nay: <b>${formatVolume(oiResult.details.todayVolume)} HĐ</b> (${oiResult.details.volRatio5}x TB5, ${oiResult.details.volRatio20}x TB20)\n`;
      msg += `   • ΔGiá 1 phiên: <b>${oiResult.details.priceChange1 >= 0 ? '+' : ''}${formatNumber(oiResult.details.priceChange1)}đ</b> | 3 phiên: <b>${oiResult.details.priceChange3 >= 0 ? '+' : ''}${formatNumber(oiResult.details.priceChange3)}đ</b>\n`;
    }
    msg += '\n';
  }

  // ── Section 4: Long/Short Bias ──
  if (biasResult) {
    const biasIcon = biasIcons[biasResult.bias] || '❓';
    const biasText = biasTexts[biasResult.bias] || biasResult.bias;

    msg += `🎯 <b>PHÁN ĐOÁN VỊ THẾ LONG/SHORT:</b>\n`;
    msg += `   ${biasIcon} <b>${biasText}</b>\n`;
    msg += `   📊 Điểm lực: Long ${biasResult.longScore} vs Short ${biasResult.shortScore} (Net: ${biasResult.score >= 0 ? '+' : ''}${biasResult.score})\n\n`;

    msg += `📋 <b>CĂN CỨ PHÂN TÍCH:</b>\n`;
    for (const reason of biasResult.reasons.slice(0, 5)) {
      msg += `   ${reason}\n`;
    }
    msg += '\n';
  }

  // ── Section 5: Lịch sử Basis 5 phiên ──
  if (basisResult && basisResult.history && basisResult.history.length > 0) {
    msg += `📅 <b>LỊCH SỬ BASIS 5 PHIÊN:</b>\n`;
    msg += `<code>`;
    msg += `Ngày       | F1M      | VN30     | Basis  | Vol\n`;
    msg += `-----------|----------|----------|--------|--------\n`;
    for (const h of basisResult.history) {
      const bSign = h.basisF1M >= 0 ? '+' : '';
      const volStr = h.f1mVolume ? formatVolume(h.f1mVolume) : 'N/A';
      msg += `${h.date.padEnd(10)} | ${formatNumber(h.f1mPrice).padStart(8)} | ${formatNumber(h.vn30Price).padStart(8)} | ${(bSign + formatNumber(h.basisF1M)).padStart(6)} | ${volStr.padStart(6)}\n`;
    }
    msg += `</code>\n\n`;
  }

  // ── Section 6: Nhận định chiến lược ──
  if (basisResult && basisResult.current !== null && biasResult) {
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🔮 <b>NHẬN ĐỊNH CHIẾN LƯỢC:</b>\n`;

    if (biasResult.bias.includes('LONG')) {
      msg += `   • Basis dương → Phe Long đang trả giá cao hơn giá trị thực\n`;
      if (basisResult.basisTrend === 'EXPANDING') {
        msg += `   • Basis mở rộng → VN30 còn room tăng, giữ vị thế LONG\n`;
        msg += `   • ⚠️ Cẩn thận khi Basis bắt đầu thu hẹp → Tín hiệu chốt lời\n`;
      } else {
        msg += `   • ⚠️ Basis thu hẹp → Room tăng đang hẹp dần, cân nhắc chốt lời\n`;
      }
    } else if (biasResult.bias.includes('SHORT')) {
      msg += `   • Basis âm → Phe Short đang ép giá xuống dưới giá trị thực\n`;
      if (basisResult.basisTrend === 'EXPANDING') {
        msg += `   • Basis mở rộng → VN30 còn áp lực giảm, giữ vị thế SHORT\n`;
        msg += `   • ⚠️ Cẩn thận khi Basis bắt đầu thu hẹp → Tín hiệu đảo chiều\n`;
      } else {
        msg += `   • ⚠️ Basis thu hẹp → Áp lực bán đang giảm, cân nhắc đóng Short\n`;
      }
    } else {
      msg += `   • Thị trường đang cân bằng → Chờ tín hiệu rõ ràng hơn\n`;
      msg += `   • Theo dõi sát Basis và Volume để phát hiện breakout\n`;
    }
    msg += '\n';
  }

  msg += `<i>📊 Derivatives OI Tracker v1.0 | VN Stock Bot v${config.version}</i>`;

  return msg;
}

// ─── AI ANALYSIS (Evening session only) ─────────────────────
/**
 * Dùng Gemini AI phân tích và dự báo phiên tới
 */
async function getAIDerivativesForecast(basisResult, oiResult, biasResult, f1mData) {
  const apiKey = config.geminiAI4.apiKey || config.geminiAI1.apiKey;
  if (!apiKey) return null;

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const basisHistory = basisResult.history
      .map(h => `${h.date}: F1M=${h.f1mPrice}, VN30=${h.vn30Price}, Basis=${h.basisF1M >= 0 ? '+' : ''}${h.basisF1M}, Vol=${h.f1mVolume || 'N/A'}`)
      .join('\n');

    const prompt = `Bạn là Giám Đốc Quỹ Đầu Tư chuyên về phái sinh VN30F hàng đầu Việt Nam.

DỮ LIỆU PHÁI SINH VN30F THỰC TẾ HÔM NAY:
- Thời gian: ${vnNow()}
- Giá VN30F1M: ${basisResult.latestF1M}
- Giá VN30 Index: ${basisResult.latestVN30}
- Basis (Chênh lệch): ${basisResult.current >= 0 ? '+' : ''}${basisResult.current} điểm (${basisResult.basisTrend === 'EXPANDING' ? 'Đang mở rộng' : 'Đang thu hẹp'})
- TB Basis 5 phiên: ${basisResult.avgBasis5 >= 0 ? '+' : ''}${basisResult.avgBasis5} điểm
${basisResult.f2mBasis !== null ? `- Basis F2M: ${basisResult.f2mBasis >= 0 ? '+' : ''}${basisResult.f2mBasis} điểm` : ''}
- Xu hướng OI ước tính: ${oiResult.trend} (${oiResult.confidence}) - ${oiResult.explanation}
- Volume: ${oiResult.details.todayVolume} HĐ (${oiResult.details.volRatio5}x TB5)
- Bias hiện tại: ${biasResult.bias} (Long ${biasResult.longScore} vs Short ${biasResult.shortScore})

LỊCH SỬ BASIS 5 PHIÊN:
${basisHistory}

YÊU CẦU:
1. Phân tích Basis đang ở vùng nào (Premium hay Discount) và xu hướng mở rộng hay thu hẹp
2. Dự báo VN30F phiên NGÀY MAI: LONG hay SHORT? Giá mục tiêu?
3. "Còn bao nhiêu room tăng/giảm?" dựa trên Basis
4. Cảnh báo rủi ro nếu có
5. Trình bày ngắn gọn, dùng HTML cho Telegram (<b>, <i>, <code>). Tối đa 500 từ.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e) {
    console.error('   ❌ AI Derivatives Forecast error:', e.message);
    return null;
  }
}

// ─── MAIN JOB RUNNER ────────────────────────────────────────
/**
 * Job chính — chạy phân tích và gửi báo cáo Telegram
 * @param {string} session - 'pre-market' | 'morning' | 'evening' | 'test'
 */
async function runDerivativesOIJob(session = 'test') {
  const sessionLabels = {
    'pre-market': '🌅 TRƯỚC PHIÊN 8h45',
    'morning': '📊 ĐẦU PHIÊN 9h18',
    'evening': '🌙 TỔNG KẾT 19h30',
    'test': '🧪 TEST',
  };

  console.log('\n' + '═'.repeat(55));
  console.log(`📊 DERIVATIVES OI TRACKER — ${sessionLabels[session] || session}`);
  console.log('═'.repeat(55));

  try {
    // 1. Fetch data
    const allData = await fetchAllDerivativesData();

    if (!allData.f1m || !allData.vn30) {
      console.error('   ❌ Không lấy được dữ liệu VN30F1M hoặc VN30 Index');
      await sendTelegramMessage(
        `⚠️ <b>Derivatives OI Tracker</b>\n` +
        `Không lấy được dữ liệu phái sinh. Có thể do ngoài giờ giao dịch hoặc lỗi kết nối.\n` +
        `<i>${vnNow()}</i>`
      );
      return;
    }

    // 2. Tính Basis
    const basisResult = calculateBasis(allData.f1m, allData.f2m, allData.vn30);
    console.log(`   💹 Basis F1M: ${basisResult.current >= 0 ? '+' : ''}${basisResult.current}đ (${basisResult.basisTrend})`);

    // 3. Ước tính OI trend
    const oiResult = estimateOITrend(allData.f1m);
    console.log(`   📊 OI Trend: ${oiResult.trend} (${oiResult.confidence})`);

    // 4. Phân tích Long/Short bias
    const biasResult = analyzeLongShortBias(basisResult, oiResult, allData.f1m, allData.vn30);
    console.log(`   🎯 Bias: ${biasResult.bias} (Score: ${biasResult.score})`);

    // 5. Build report
    const report = buildReport(session, {
      basisResult,
      oiResult,
      biasResult,
      f1mData: allData.f1m,
      f2mData: allData.f2m,
      vn30Data: allData.vn30,
    });

    // 6. Gửi báo cáo chính
    await sendTelegramMessage(report);
    console.log(`   ✅ Đã gửi báo cáo phái sinh [${session}]`);

    // 7. Evening session: AI dự báo
    if (session === 'evening') {
      console.log('   🤖 Đang tạo AI dự báo phiên tới...');
      const aiForecast = await getAIDerivativesForecast(basisResult, oiResult, biasResult, allData.f1m);
      if (aiForecast) {
        let aiMsg = `🤖 <b>DỰ BÁO AI — PHÁI SINH VN30F NGÀY MAI</b>\n`;
        aiMsg += `🕐 <i>${vnNow()}</i>\n`;
        aiMsg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        let cleanedText = aiForecast
          .replace(/```html/gi, '')
          .replace(/```/g, '')
          .trim();
        aiMsg += `${cleanedText}\n\n`;
        aiMsg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        aiMsg += `<i>🤖 AI Derivatives Forecast | VN Stock Bot v${config.version}</i>`;

        await sendTelegramMessage(aiMsg);
        console.log('   ✅ Đã gửi AI dự báo phái sinh');
      }
    }

    console.log(`   ✅ Derivatives OI Job [${session}] hoàn thành`);
  } catch (e) {
    console.error(`   ❌ Derivatives OI Job [${session}] lỗi:`, e.message);
    try {
      await sendTelegramMessage(
        `💥 <b>Derivatives OI Tracker lỗi</b>\n` +
        `Session: ${session}\n` +
        `<code>${e.message}</code>\n` +
        `<i>${vnNow()}</i>`
      );
    } catch (sendErr) { /* ignore */ }
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  runDerivativesOIJob,
  fetchAllDerivativesData,
  calculateBasis,
  estimateOITrend,
  analyzeLongShortBias,
};
