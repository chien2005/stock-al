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
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { sendTelegramMessage } = require('./telegramService');

// ─── PERSISTENT DATA FILE FOR OI ──────────────────────────────
const OI_HISTORY_FILE = path.join(__dirname, '..', 'data', 'oi_history.json');

/**
 * Đọc lịch sử OI từ file data/oi_history.json
 */
function loadOIHistory() {
  try {
    if (fs.existsSync(OI_HISTORY_FILE)) {
      const raw = fs.readFileSync(OI_HISTORY_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.log(`   ⚠️ Lỗi đọc file oi_history.json: ${e.message}`);
  }
  return { lastUpdated: new Date().toISOString(), history: [] };
}

/**
 * Lưu snapshot OI mới vào data/oi_history.json
 */
function saveOIHistory(item) {
  try {
    const dir = path.dirname(OI_HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const store = loadOIHistory();
    const existingIdx = store.history.findIndex(h => h.date === item.date);

    if (existingIdx >= 0) {
      store.history[existingIdx] = { ...store.history[existingIdx], ...item };
    } else {
      store.history.push(item);
    }

    if (store.history.length > 30) {
      store.history = store.history.slice(-30);
    }

    store.lastUpdated = new Date().toISOString();
    fs.writeFileSync(OI_HISTORY_FILE, JSON.stringify(store, null, 2), 'utf8');
    console.log(`   💾 Đã lưu snapshot Open Interest ngày ${item.date} vào oi_history.json`);
  } catch (e) {
    console.log(`   ⚠️ Lỗi ghi file oi_history.json: ${e.message}`);
  }
}

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

/**
 * Lấy tên mã hợp đồng phái sinh hiện hành (VN30FYYMM)
 * Tính từ tháng hiện tại: Tháng hiện tại, tháng sau, quý hiện tại, quý sau
 */
function getCurrentDerivativeSymbols() {
  const now = new Date();
  const vnNowDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vnNowDate.getFullYear() % 100; // 26
  const m = vnNowDate.getMonth() + 1; // 1-12

  // Tháng hiện tại + tháng sau
  const m1 = m;
  const m2 = m === 12 ? 1 : m + 1;
  const y2 = m === 12 ? y + 1 : y;

  // Quý hiện tại (tháng 3,6,9,12)
  const quarterMonths = [3, 6, 9, 12];
  const currentQuarterIdx = quarterMonths.findIndex(q => q >= m);
  const q1Month = quarterMonths[currentQuarterIdx >= 0 ? currentQuarterIdx : 0];
  const q1Year = currentQuarterIdx >= 0 ? y : y + 1;
  // Quý sau
  const nextQIdx = currentQuarterIdx >= 0 ? (currentQuarterIdx + 1) % 4 : 1;
  const q2Month = quarterMonths[nextQIdx];
  const q2Year = nextQIdx === 0 ? q1Year + 1 : q1Year;

  const pad = n => String(n).padStart(2, '0');
  const syms = [
    `VN30F${pad(y)}${pad(m1)}`,
    `VN30F${pad(y2)}${pad(m2)}`,
    `VN30F${pad(q1Year)}${pad(q1Month)}`,
    `VN30F${pad(q2Year)}${pad(q2Month)}`,
  ];

  // Deduplicate (tháng hiện tại có thể trùng quý)
  return [...new Set(syms)];
}

/**
 * Parse OI và volume data từ VPS realtime response
 * VPS API fields quan trọng cho phái sinh:
 *   oi        - Open Interest (Khối lượng hợp đồng mở)
 *   oichange  - Thay đổi OI so với hôm qua
 *   lot       - Tổng KLGD (đơn vị lô = 1 HĐ cho phái sinh)
 *   lastPrice - Giá khớp lệnh gần nhất
 *   g1-g3     - 3 giá bid (mua) tốt nhất: "giá|KL|trạng thái"
 *   g4-g6     - 3 giá ask (bán) tốt nhất: "giá|KL|trạng thái"
 */
function parseRealtimeOI(realtimeDataArr) {
  if (!realtimeDataArr || realtimeDataArr.length === 0) {
    return { contracts: [], totalOI: null, totalOIChange: null, totalVolume: null, bidVolume: 0, askVolume: 0 };
  }

  const contracts = [];
  let totalOI = 0;
  let totalOIChange = 0;
  let totalVolume = 0;
  let totalBidVol = 0;
  let totalAskVol = 0;
  let hasOI = false;

  for (const raw of realtimeDataArr) {
    const sym = raw.sym || '';
    const oi = parseInt(raw.oi || '0');
    const oiChange = parseInt(raw.oichange || '0');
    const volume = parseInt(raw.lot || '0'); // phái sinh lot = 1 HĐ
    const lastPrice = parseFloat(raw.lastPrice || '0');
    const refPrice = parseFloat(raw.r || '0');
    const changePct = refPrice > 0 ? ((lastPrice - refPrice) / refPrice * 100) : 0;

    // Parse bid/ask volumes từ g1-g6
    let bidVol = 0;
    let askVol = 0;
    for (const key of ['g1', 'g2', 'g3']) {
      if (raw[key]) {
        const parts = raw[key].split('|');
        bidVol += parseInt(parts[1] || '0');
      }
    }
    for (const key of ['g4', 'g5', 'g6']) {
      if (raw[key]) {
        const parts = raw[key].split('|');
        askVol += parseInt(parts[1] || '0');
      }
    }

    if (oi > 0) hasOI = true;
    totalOI += oi;
    totalOIChange += oiChange;
    totalVolume += volume;
    totalBidVol += bidVol;
    totalAskVol += askVol;

    contracts.push({
      symbol: sym,
      oi,
      oiChange,
      volume,
      lastPrice,
      changePct: parseFloat(changePct.toFixed(2)),
      bidVolume: bidVol,   // KL chờ mua (Long demand)
      askVolume: askVol,   // KL chờ bán (Short demand)
    });
  }

  // Ước tính Long vs Short từ:
  // 1. Bid volume (chờ mua) → Demand cho Long
  // 2. Ask volume (chờ bán) → Demand cho Short
  // 3. OI cho biết tổng hợp đồng đang mở
  // NOTE: Trong thực tế Tổng Long = Tổng Short = OI
  // Nhưng bid/ask volume cho biết AI ĐANG MUỐN MỞ thêm vị thế gì
  const totalBidAsk = totalBidVol + totalAskVol;
  const longPct = totalBidAsk > 0 ? totalBidVol / totalBidAsk : 0.5;
  const shortPct = totalBidAsk > 0 ? totalAskVol / totalBidAsk : 0.5;

  // Ước tính số HĐ Long vs Short dựa trên bid/ask ratio áp lên OI
  const estimatedLong = hasOI ? Math.round(totalOI * longPct) : null;
  const estimatedShort = hasOI ? Math.round(totalOI * shortPct) : null;

  return {
    contracts: contracts.sort((a, b) => b.oi - a.oi),
    totalOI: hasOI ? totalOI : null,
    totalOIChange: hasOI ? totalOIChange : null,
    totalVolume: totalVolume > 0 ? totalVolume : null,
    bidVolume: totalBidVol,
    askVolume: totalAskVol,
    estimatedLong,
    estimatedShort,
    longPct: parseFloat((longPct * 100).toFixed(1)),
    shortPct: parseFloat((shortPct * 100).toFixed(1)),
  };
}

/**
 * Lấy dữ liệu intraday 1 phút của phiên hôm nay từ VPS
 * Tính toán chính xác lượng hợp đồng Khớp Mua (Long chủ động) vs Khớp Bán (Short chủ động)
 */
async function fetchIntradayLongShort(symbol = 'VN30F1M') {
  const now = Math.floor(Date.now() / 1000);
  const vnNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  vnNow.setHours(0, 0, 0, 0);
  const startOfDay = Math.floor(vnNow.getTime() / 1000);

  try {
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=${symbol}&resolution=1&from=${startOfDay}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    if (res.data && res.data.c && res.data.c.length > 0) {
      const { o, c, v, t } = res.data;
      let buyVol = 0;
      let sellVol = 0;
      let neutralVol = 0;

      for (let i = 0; i < c.length; i++) {
        if (c[i] > o[i]) {
          buyVol += v[i];
        } else if (c[i] < o[i]) {
          sellVol += v[i];
        } else {
          const prev = i > 0 ? c[i - 1] : o[i];
          if (c[i] > prev) buyVol += v[i];
          else if (c[i] < prev) sellVol += v[i];
          else neutralVol += v[i];
        }
      }

      const total = buyVol + sellVol + neutralVol;
      const lastTs = t && t.length > 0 ? t[t.length - 1] : null;
      const lastDateStr = lastTs
        ? new Date(lastTs * 1000).toLocaleDateString('vi-VN', { timeZone: config.timezone })
        : vnNow();

      return {
        date: lastDateStr,
        totalVolume: total,
        longVolume: buyVol,
        shortVolume: sellVol,
        neutralVolume: neutralVol,
        longPct: total > 0 ? parseFloat((buyVol / total * 100).toFixed(1)) : 50,
        shortPct: total > 0 ? parseFloat((sellVol / total * 100).toFixed(1)) : 50,
        netLong: buyVol - sellVol,
        barsCount: c.length,
      };
    }
  } catch (e) {
    console.log(`   ⚠️ Intraday Long/Short fetch fallback for ${symbol}: ${e.message}`);
  }
  return null;
}

// ─── CORE: Lấy toàn bộ dữ liệu phái sinh ──────────────────
/**
 * Fetch tất cả dữ liệu cần thiết cho phân tích phái sinh
 * @returns {Object} { f1m, f2m, vn30, vnindex, realtimeF1M, realtimeF2M, realtimeOI, intradayLS }
 */
async function fetchAllDerivativesData() {
  console.log('   📡 Đang lấy dữ liệu phái sinh từ multi-source...');

  // Lấy mã hợp đồng hiện hành
  const derivSymbols = getCurrentDerivativeSymbols();
  console.log(`   📋 Mã HĐ phái sinh: ${derivSymbols.join(', ')}`);

  const [f1m, f2m, vn30, vnindex, intradayLS] = await Promise.all([
    fetchOHLCV('VN30F1M', 30),
    fetchOHLCV('VN30F2M', 30),
    fetchOHLCV('VN30', 30),
    fetchOHLCV('VNINDEX', 30),
    fetchIntradayLongShort('VN30F1M'),
  ]);

  // Lấy giá realtime + OI cho TẤT CẢ các mã HĐ phái sinh
  const allDerivSyms = ['VN30F1M', 'VN30F2M', ...derivSymbols].join(',');
  const realtimeData = await fetchRealtimePrice(allDerivSyms);
  const realtimeF1M = realtimeData.find(d => d.sym === 'VN30F1M') || null;
  const realtimeF2M = realtimeData.find(d => d.sym === 'VN30F2M') || null;

  // Parse OI data từ tất cả các mã HĐ cụ thể (VN30F2508, VN30F2509...)
  const derivContractData = realtimeData.filter(d => derivSymbols.includes(d.sym));
  const realtimeOI = parseRealtimeOI(derivContractData);

  // Đọc lịch sử OI lưu trong ổ đĩa (data/oi_history.json)
  const oiStore = loadOIHistory();

  // Nếu trong giờ GD lấy được realtimeOI → cập nhật vào file lưu trữ
  if (realtimeOI && realtimeOI.totalOI !== null && realtimeOI.totalOI > 0) {
    const todayStr = new Date().toLocaleDateString('vi-VN', { timeZone: config.timezone });
    const latestF1M = f1m && f1m.c && f1m.c.length > 0 ? f1m.c[f1m.c.length - 1] : 0;
    const latestVN30 = vn30 && vn30.c && vn30.c.length > 0 ? vn30.c[vn30.c.length - 1] : 0;
    const prevF1M = f1m && f1m.c && f1m.c.length > 1 ? f1m.c[f1m.c.length - 2] : latestF1M;

    let positionState = 'NEUTRAL';
    const deltaOI = realtimeOI.totalOIChange || 0;
    const deltaPrice = latestF1M - prevF1M;

    if (deltaOI > 0 && deltaPrice > 0) positionState = 'LONG_ACCUMULATION';
    else if (deltaOI > 0 && deltaPrice < 0) positionState = 'SHORT_ACCUMULATION';
    else if (deltaOI < 0 && deltaPrice < 0) positionState = 'LONG_LIQUIDATION';
    else if (deltaOI < 0 && deltaPrice > 0) positionState = 'SHORT_COVERING';

    saveOIHistory({
      date: todayStr,
      totalOI: realtimeOI.totalOI,
      oiChange: deltaOI,
      f1mPrice: latestF1M,
      vn30Price: latestVN30,
      basis: parseFloat((latestF1M - latestVN30).toFixed(2)),
      volume: intradayLS ? intradayLS.totalVolume : (f1m && f1m.v ? f1m.v[f1m.v.length - 1] : 0),
      positionState,
    });
  }

  console.log(`   ✅ F1M: ${f1m ? f1m.c.length + ' phiên' : 'FAIL'} | F2M: ${f2m ? f2m.c.length + ' phiên' : 'FAIL'} | VN30: ${vn30 ? vn30.c.length + ' phiên' : 'FAIL'}`);
  if (intradayLS) {
    console.log(`   📊 Intraday ${intradayLS.date}: Total ${intradayLS.totalVolume} HĐ | Long: ${intradayLS.longVolume} (${intradayLS.longPct}%) | Short: ${intradayLS.shortVolume} (${intradayLS.shortPct}%) | Net: ${intradayLS.netLong}`);
  }
  if (realtimeOI.totalOI !== null) {
    console.log(`   📊 OI realtime: ${realtimeOI.totalOI} HĐ (Δ${realtimeOI.totalOIChange >= 0 ? '+' : ''}${realtimeOI.totalOIChange}) | Bid: ${realtimeOI.bidVolume} | Ask: ${realtimeOI.askVolume}`);
  } else {
    console.log(`   ℹ️ Sử dụng dữ liệu OI lưu trữ persistent từ data/oi_history.json (${oiStore.history.length} phiên)`);
  }

  return { f1m, f2m, vn30, vnindex, realtimeF1M, realtimeF2M, realtimeOI, intradayLS, oiStore };
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

  // Lấy 10 phiên gần nhất (align theo index cuối, kết thúc ở hôm nay)
  const minLen = Math.min(f1mCloses.length, vn30Closes.length);
  const history = [];
  const startIdx = Math.max(0, minLen - 10);

  for (let i = startIdx; i < minLen; i++) {
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
  const { basisResult, oiResult, biasResult, f1mData, f2mData, vn30Data, realtimeOI, intradayLS, oiStore } = data;

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

  const positionStateLabels = {
    'LONG_ACCUMULATION': '🟢 TÍCH LŨY LONG (Mở thêm vị thế Mua qua đêm)',
    'SHORT_ACCUMULATION': '🔴 TÍCH LŨY SHORT (Mở thêm vị thế Bán qua đêm)',
    'LONG_LIQUIDATION': '📉 LONG THÁO CHẠY (Phe Mua chốt lời/cắt lỗ)',
    'SHORT_COVERING': '📈 SHORT CHỐT LỜI (Phe Bán đóng vị thế)',
    'NEUTRAL': '⚖️ CÂN BẰNG VỊ THẾ',
  };

  let msg = '';
  msg += `📊 <b>BÁO CÁO OPEN INTEREST PHÁI SINH — ${sessionLabels[session] || session}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ── SECTION 1: TRỌNG TÂM — OPEN INTEREST (VỊ THẾ CHƯA ĐÓNG QUA ĐÊM) ──
  const historyOI = oiStore && oiStore.history ? oiStore.history : [];
  const latestOIItem = historyOI.length > 0 ? historyOI[historyOI.length - 1] : null;

  const displayOI = (realtimeOI && realtimeOI.totalOI) ? realtimeOI.totalOI : (latestOIItem ? latestOIItem.totalOI : null);
  const displayDelta = (realtimeOI && realtimeOI.totalOIChange !== null) ? realtimeOI.totalOIChange : (latestOIItem ? latestOIItem.oiChange : null);
  const displayState = latestOIItem ? latestOIItem.positionState : 'NEUTRAL';

  if (displayOI !== null) {
    msg += `🔥 <b>OPEN INTEREST (HỢP ĐỒNG CÒN TỒN ĐỌNG CHƯA ĐÓNG):</b>\n`;
    msg += `   • Tổng OI qua đêm: <b>${displayOI.toLocaleString('vi-VN')} HĐ</b>`;
    if (displayDelta !== null) {
      msg += ` (${displayDelta >= 0 ? '+' : ''}${displayDelta.toLocaleString('vi-VN')} HĐ)`;
    }
    msg += '\n';
    msg += `   • Trạng thái: <b>${positionStateLabels[displayState] || displayState}</b>\n`;

    if (displayDelta > 0) {
      msg += `   • 💡 <i>OI TĂNG (+${displayDelta.toLocaleString('vi-VN')} HĐ) → Smart Money đang MỞ THÊM vị thế giữ qua đêm cho xu hướng tới.</i>\n`;
    } else if (displayDelta < 0) {
      msg += `   • 💡 <i>OI GIẢM (${displayDelta.toLocaleString('vi-VN')} HĐ) → Nhà đầu tư đang ĐÓNG VỊ THẾ / CHỐT LỜI rút bớt tiền.</i>\n`;
    }
    msg += '\n';
  }

  // ── SECTION 2: BẢNG LỊCH SỬ OPEN INTEREST (OI) 5 PHIÊN GẦN NHẤT ──
  if (historyOI.length > 0) {
    const recentOIHistory = historyOI.slice(-5);
    msg += `📅 <b>LỊCH SỬ OPEN INTEREST 5 PHIÊN GẦN NHẤT:</b>\n`;
    msg += `<code>`;
    msg += `Ngày       | Tổng OI   | ΔOI     | Trạng thái Vị thế\n`;
    msg += `-----------|-----------|---------|------------------\n`;
    for (const h of recentOIHistory) {
      const deltaStr = h.oiChange >= 0 ? `+${h.oiChange}` : `${h.oiChange}`;
      const stateShort = h.positionState === 'LONG_ACCUMULATION' ? 'Long Gom'
        : h.positionState === 'SHORT_ACCUMULATION' ? 'Short Gom'
        : h.positionState === 'LONG_LIQUIDATION' ? 'Long Xả'
        : h.positionState === 'SHORT_COVERING' ? 'Short Chốt' : 'Cân bằng';

      msg += `${h.date.padEnd(10)} | ${h.totalOI.toString().padStart(9)} | ${deltaStr.padStart(7)} | ${stateShort}\n`;
    }
    msg += `</code>\n\n`;
  }

  // ── SECTION 3: GIÁ THỊ TRƯỜNG & BASIS ──
  if (basisResult && basisResult.latestF1M) {
    const basisSign = basisResult.current >= 0 ? '+' : '';
    msg += `📈 <b>GIÁ THỊ TRƯỜNG & BASIS:</b>\n`;
    msg += `   • VN30F1M: <b>${formatNumber(basisResult.latestF1M)}</b> | VN30 Index: <b>${formatNumber(basisResult.latestVN30)}</b>\n`;
    msg += `   • Basis (Chênh lệch): <b>${basisSign}${formatNumber(basisResult.current)} điểm</b> (${basisResult.basisTrend === 'EXPANDING' ? '↗️ Mở rộng' : '↘️ Thu hẹp'})\n\n`;
  }

  // ── SECTION 4: PHÁN ĐOÁN VỊ THẾ LONG / SHORT ──
  if (biasResult) {
    const biasIcon = biasIcons[biasResult.bias] || '⚖️';
    const biasText = biasTexts[biasResult.bias] || biasResult.bias;

    msg += `🎯 <b>DỰ BÁO VỊ THẾ ĐẦU TƯ:</b>\n`;
    msg += `   ${biasIcon} <b>${biasText}</b>\n`;
    msg += `   📊 Điểm lực: Long ${biasResult.longScore} vs Short ${biasResult.shortScore}\n\n`;
  }

  // ── SECTION 5: THÔNG TIN KHỚP LỆNH PHIÊN (DÀNH CHO THAM KHẢO) ──
  if (intradayLS && intradayLS.totalVolume > 0) {
    msg += `📊 <i>Tham khảo KL khớp lệnh trong phiên (${intradayLS.date}): Mua ${intradayLS.longVolume.toLocaleString('vi-VN')} HĐ | Bán ${intradayLS.shortVolume.toLocaleString('vi-VN')} HĐ (Tổng ${intradayLS.totalVolume.toLocaleString('vi-VN')} HĐ)</i>\n\n`;
  }

  msg += `<i>📊 Open Interest Tracker v2.0 | VN Stock Bot v${config.version}</i>`;

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
      realtimeOI: allData.realtimeOI,
      intradayLS: allData.intradayLS,
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
