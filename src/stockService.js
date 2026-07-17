/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║        📊 VN STOCK TRACKER - Stock Data Service          ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║  Lấy dữ liệu chứng khoán từ VPS (VPBank Securities)    ║
 * ║  API: bgapidatafeed.vps.com.vn                           ║
 * ║  + histdatafeed.vps.com.vn (lịch sử giá)                ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');

// ─── API ENDPOINTS ─────────────────────────────────────────

const VPS_API = {
  // Realtime: giá, khối lượng, spread, khối ngoại
  realtime: 'https://bgapidatafeed.vps.com.vn/getliststockdata',
  // Lịch sử giá (TradingView format)
  history: 'https://histdatafeed.vps.com.vn/tradingview/history',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── MAIN FUNCTIONS ─────────────────────────────────────────

/**
 * Lấy dữ liệu realtime của nhiều mã cùng lúc từ VPS
 * @param {string[]} symbols - Danh sách mã (ví dụ: ['FPT', 'ACB'])
 * @returns {Object[]} Danh sách dữ liệu stock
 */
async function fetchRealtimeData(symbols) {
  const symbolStr = symbols.join(',');
  const url = `${VPS_API.realtime}/${symbolStr}`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: HEADERS,
        timeout: 10000,
      });

      if (response.data && response.data.length > 0) {
        return response.data;
      }
      console.log(`⚠️ Attempt ${attempt}/${maxRetries}: VPS API returned empty data. Retrying...`);
    } catch (error) {
      console.error(`⚠️ Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
    }
    if (attempt < maxRetries) {
      await new Promise(res => setTimeout(res, 1500));
    }
  }
  return [];
}

/**
 * Lấy dữ liệu lịch sử giá (30 ngày gần nhất) để tính trung bình
 * @param {string} symbol - Mã cổ phiếu
 * @returns {Object|null}
 */
async function fetchHistoryData(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * 60; // 60 ngày trước (cần >= 35 cho MACD, 50 cho SMA50)
  const url = `${VPS_API.history}?symbol=${symbol}&resolution=D&from=${from}&to=${now}`;
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: HEADERS,
        timeout: 8000,
      });
      if (response.data) {
        return response.data;
      }
    } catch (error) {
      // Non-critical, silently fail
    }
    if (attempt < maxRetries) {
      await new Promise(res => setTimeout(res, 1000));
    }
  }
  return null;
}

/**
 * Lấy toàn bộ thông tin của tất cả mã cổ phiếu
 * @returns {Array} Danh sách thông tin stock đã format
 */
async function fetchAllStocks() {
  const symbols = config.stockSymbols;
  console.log(`\n📡 Đang lấy dữ liệu ${symbols.length} mã: ${symbols.join(', ')}...`);

  // 1. Lấy realtime data cho tất cả mã cùng 1 lần (VPS hỗ trợ batch)
  const realtimeData = await fetchRealtimeData(symbols);

  if (!realtimeData || realtimeData.length === 0) {
    console.error('❌ Không lấy được dữ liệu realtime từ VPS!');
    return symbols.map(sym => ({
      symbol: sym,
      error: true,
      message: 'Không kết nối được API VPS',
    }));
  }

  // 2. Lấy lịch sử giá để tính KLTB, trend (song song)
  const historyPromises = symbols.map(sym => fetchHistoryData(sym));
  const histories = await Promise.all(historyPromises);

  // 3. Parse và ghép dữ liệu
  const results = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const rawStock = realtimeData.find(s => s.sym === symbol);
    const history = histories[i];

    if (rawStock) {
      const stockInfo = parseVPSData(rawStock, history);
      results.push(stockInfo);
      console.log(`   ✅ ${symbol}: ${stockInfo.price.toLocaleString('vi-VN')} ₫ (${stockInfo.changePct >= 0 ? '+' : ''}${stockInfo.changePct}%)`);
    } else {
      console.log(`   ❌ ${symbol}: Không tìm thấy trong dữ liệu trả về`);
      results.push({
        symbol,
        error: true,
        message: 'Mã không tồn tại hoặc ngưng giao dịch',
      });
    }
  }

  return results;
}

/**
 * Parse dữ liệu từ VPS API format
 * 
 * VPS API fields:
 *   sym        - Mã cổ phiếu
 *   lastPrice  - Giá khớp lệnh gần nhất (đơn vị: nghìn đồng, vd: 77.0 = 77,000 VND)
 *   r          - Giá tham chiếu
 *   c          - Giá trần
 *   f          - Giá sàn
 *   openPrice  - Giá mở cửa
 *   highPrice  - Giá cao nhất
 *   lowPrice   - Giá thấp nhất
 *   lot        - Tổng KL khớp lệnh (đơn vị: cổ phiếu)
 *   avePrice   - Giá trung bình
 *   fBVol      - KL mua khối ngoại  
 *   fSVolume   - KL bán khối ngoại
 *   fRoom      - Room khối ngoại còn lại
 *   g1-g3      - 3 giá bid tốt nhất (format: "giá|KL|trạng thái")
 *   g4-g6      - 3 giá ask tốt nhất
 *   changePc   - % thay đổi
 *   ot         - Thay đổi tuyệt đối
 */
function parseVPSData(raw, history) {
  const symbol = raw.sym;

  // Giá (VPS trả về đơn vị nghìn đồng, vd: 77.0 = 77,000 VND)
  const price = parseFloat(raw.lastPrice || 0) * 1000;
  const refPrice = parseFloat(raw.r || 0) * 1000;
  const ceilingPrice = parseFloat(raw.c || 0) * 1000;
  const floorPrice = parseFloat(raw.f || 0) * 1000;
  const openPrice = parseFloat(raw.openPrice || 0) * 1000;
  const highPrice = parseFloat(raw.highPrice || 0) * 1000;
  const lowPrice = parseFloat(raw.lowPrice || 0) * 1000;
  const avgPrice = parseFloat(raw.avePrice || 0) * 1000;

  // Thay đổi
  const change = price - refPrice;
  // FIX: VPS API trả changePc KHÔNG có dấu âm (vd: 0.88 khi giảm)
  // → Tính lại từ price/refPrice để đảm bảo đúng dấu
  const changePct = refPrice > 0
    ? parseFloat(((price - refPrice) / refPrice * 100).toFixed(2))
    : parseFloat(raw.changePc || 0);

  // Khối lượng
  const volume = parseInt(raw.lot || 0);

  // Khối ngoại  
  const foreignBuy = parseInt(raw.fBVol || 0);
  const foreignSell = parseInt(raw.fSVolume || 0);
  const foreignRoom = parseFloat(raw.fRoom || 0);

  // Parse sổ lệnh (bid/ask)
  const bids = parseBidAsk(raw.g1, raw.g2, raw.g3);
  const asks = parseBidAsk(raw.g4, raw.g5, raw.g6);

  // Tính KLTB từ lịch sử (nếu có)
  let avgVolume = 0;
  if (history && history.v && history.v.length > 0) {
    const volumes = history.v;
    avgVolume = Math.round(volumes.reduce((sum, v) => sum + v, 0) / volumes.length);
  }

  // Tính giá trung bình 20 phiên (SMA20) từ lịch sử
  let sma20 = 0;
  if (history && history.c && history.c.length >= 20) {
    const last20 = history.c.slice(-20);
    sma20 = Math.round(last20.reduce((sum, p) => sum + p, 0) / 20 * 1000);
  }

  // Tính giá trung bình 50 phiên (SMA50) từ lịch sử
  let sma50 = 0;
  if (history && history.c && history.c.length >= 50) {
    const last50 = history.c.slice(-50);
    sma50 = Math.round(last50.reduce((sum, p) => sum + p, 0) / 50 * 1000);
  }

  // Lấy 5 phiên gần nhất (cho AI phân tích xu hướng)
  let historyPrices = [];
  if (history && history.c && history.c.length >= 5) {
    historyPrices = history.c.slice(-5).map(p => Math.round(p * 1000));
  }

  // Raw history data cho Predictive Engine (giữ nguyên đơn vị gốc: nghìn đồng)
  let historyData = null;
  if (history && history.c && history.c.length >= 14) {
    historyData = {
      c: history.c,           // Giá đóng cửa
      o: history.o || [],      // Giá mở cửa
      h: history.h || [],      // Giá cao nhất
      l: history.l || [],      // Giá thấp nhất
      v: history.v || [],      // Khối lượng
      t: history.t || [],      // Timestamps
    };
  }

  return {
    symbol,
    error: false,
    // Giá
    price,
    refPrice,
    change,
    changePct,
    openPrice,
    highPrice,
    lowPrice,
    ceilingPrice,
    floorPrice,
    avgPrice,
    // SMA20 + SMA50
    sma20,
    sma50,
    // Khối lượng
    volume,
    avgVolume,
    // Khối ngoại
    foreignBuy,
    foreignSell,
    foreignBuyValue: foreignBuy * price,   // Giá trị mua NN (VND)
    foreignSellValue: foreignSell * price,  // Giá trị bán NN (VND)
    foreignNet: foreignBuy - foreignSell,
    foreignRoom,
    // Sổ lệnh
    bids,
    asks,
    // Market info
    exchange: raw.marketId === 'STO' ? 'HOSE' : (raw.marketId === 'HNO' ? 'HNX' : raw.marketId || ''),
    boardId: raw.boardId || '',
    // Lịch sử giá 5 phiên
    historyPrices,
    // Full history cho Predictive Engine
    historyData,
  };
}

/**
 * Parse chuỗi bid/ask từ VPS
 * Format: "giá|KL|trạng thái" (vd: "77.0|10580|d")
 * trạng thái: d = decrease, i = increase, e = equal/empty
 */
function parseBidAsk(g1, g2, g3) {
  const parse = (g) => {
    if (!g) return null;
    const parts = g.split('|');
    if (parts.length < 2) return null;
    const p = parseFloat(parts[0]);
    const v = parseInt(parts[1]);
    if (p === 0 && v === 0) return null;
    return { price: p * 1000, volume: v };
  };
  return [parse(g1), parse(g2), parse(g3)].filter(Boolean);
}

// ─── VN30 INDEX DATA ───────────────────────────────────────

/**
 * Lấy dữ liệu chỉ số VN30 và VNINDEX từ VPS History API
 * @returns {Object} { vn30: {...}, vnindex: {...} }
 */
async function fetchVN30Index() {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * 5; // 5 ngày gần nhất

  const results = {};
  const maxRetries = 2;

  for (const indexSymbol of ['VN30', 'VNINDEX']) {
    let success = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const url = `${VPS_API.history}?symbol=${indexSymbol}&resolution=D&from=${from}&to=${now}`;
        const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        const data = response.data;

        if (data && data.s === 'ok' && data.c && data.c.length > 0) {
          const lastIdx = data.c.length - 1;
          const prevIdx = lastIdx > 0 ? lastIdx - 1 : 0;

          const close = data.c[lastIdx];
          const prevClose = data.c[prevIdx];
          const open = data.o[lastIdx];
          const high = data.h[lastIdx];
          const low = data.l[lastIdx];
          const volume = data.v[lastIdx];
          const change = close - prevClose;
          const changePct = prevClose > 0 ? parseFloat(((close - prevClose) / prevClose * 100).toFixed(2)) : 0;

          results[indexSymbol.toLowerCase()] = {
            symbol: indexSymbol,
            close: parseFloat(close.toFixed(2)),
            open: parseFloat(open.toFixed(2)),
            high: parseFloat(high.toFixed(2)),
            low: parseFloat(low.toFixed(2)),
            volume,
            prevClose: parseFloat(prevClose.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            changePct,
          };
          console.log(`   📊 ${indexSymbol}: ${close.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct}%)`);
          success = true;
          break;
        }
      } catch (error) {
        console.error(`   ⚠️ Attempt ${attempt}/${maxRetries} failed for ${indexSymbol}:`, error.message);
      }
      if (attempt < maxRetries) {
        await new Promise(res => setTimeout(res, 1000));
      }
    }
  }

  return results;
}

// ─── MARKET SCAN: Quét toàn thị trường ─────────────────────

// Mở rộng: VN30 + HOSE blue-chip + Midcap + Penny đáng chú ý (~100+ mã)
const SCAN_SYMBOLS = [
  // ── VN30 components ──
  'ACB', 'BCM', 'BVH', 'CTG', 'GAS', 'GVR', 'HDB', 'KDH',
  'PLX', 'POW', 'SAB', 'SHB', 'SSB', 'STB', 'TCB', 'TPB',
  'VHM', 'VIB', 'VJC', 'VPB', 'VRE',
  // ── HOSE Blue-chip (ngoài VN30) ──
  'DGC', 'PNJ', 'REE', 'VND', 'HCM', 'DPM', 'DCM', 'GEX',
  'NLG', 'PHR', 'HAG', 'PDR', 'EIB', 'LPB', 'OCB', 'MSB',
  'DHG', 'FRT', 'VCI', 'GMD', 'VTP', 'PC1', 'NT2', 'BWE',
  'DBC', 'HSG', 'NKG', 'TLG', 'DXG', 'KBC', 'IJC', 'HDC',
  // ── Midcap HOSE + HNX ──
  'SHS', 'VDS', 'CTS', 'AGG', 'DIG', 'HDG', 'KOS', 'ANV',
  'VHC', 'IDC', 'PVT', 'PVD', 'TCH', 'HBC', 'LDG', 'CEO',
  'TIG', 'FCN', 'SCR', 'DXS', 'NVL', 'AAA', 'GIL', 'PTB',
  // ── Penny đáng chú ý (thanh khoản cao) ──
  'FLC', 'ROS', 'HQC', 'OGC', 'KSB', 'CII', 'SBT', 'ASM',
  'QBS', 'HVN', 'TSC', 'PAN', 'VOS', 'HHS', 'VGC', 'CRE',
];

/**
 * Parse raw VPS data thành object (dùng chung cho scan + top bought)
 */
function parseRawScanData(raw) {
  const symbol = raw.sym;
  const price = parseFloat(raw.lastPrice || 0) * 1000;
  const refPrice = parseFloat(raw.r || 0) * 1000;
  const volume = parseInt(raw.lot || 0);
  const foreignBuy = parseInt(raw.fBVol || 0);
  const foreignSell = parseInt(raw.fSVolume || 0);
  const foreignNet = foreignBuy - foreignSell;
  const changePct = refPrice > 0 ? parseFloat(((price - refPrice) / refPrice * 100).toFixed(2)) : 0;
  const openPrice = parseFloat(raw.openPrice || 0) * 1000;
  const highPrice = parseFloat(raw.highPrice || 0) * 1000;
  const lowPrice = parseFloat(raw.lowPrice || 0) * 1000;

  // Buy pressure: tỷ lệ mua NN so với tổng KL
  const buyPressure = volume > 0 ? parseFloat((foreignBuy / volume * 100).toFixed(2)) : 0;
  // Giá trị mua/bán NN (VND)
  const foreignBuyValue = foreignBuy * price;
  const foreignSellValue = foreignSell * price;
  const foreignNetValue = foreignNet * price;

  return {
    symbol,
    price,
    refPrice,
    change: price - refPrice,
    changePct,
    openPrice,
    highPrice,
    lowPrice,
    volume,
    foreignBuy,
    foreignSell,
    foreignNet,
    foreignBuyValue,
    foreignSellValue,
    foreignNetValue,
    buyPressure,
    exchange: raw.marketId === 'STO' ? 'HOSE' : (raw.marketId === 'HNO' ? 'HNX' : raw.marketId || ''),
  };
}

/**
 * Quét thị trường rộng để tìm dòng tiền vào/ra mạnh nhất
 * @param {string[]} trackedSymbols - Mã đã theo dõi (loại trừ)
 * @returns {Object} { leaders: [...], laggards: [...], all: [...] }
 */
async function fetchMarketScan(trackedSymbols = []) {
  try {
    // Loại bỏ mã đã tracked để tránh trùng
    const scanList = SCAN_SYMBOLS.filter(s => !trackedSymbols.includes(s));
    console.log(`\n🔍 Quét thị trường: ${scanList.length} mã...`);

    const realtimeData = await fetchRealtimeData(scanList);
    if (!realtimeData || realtimeData.length === 0) {
      console.error('   ❌ Không lấy được dữ liệu scan');
      return null;
    }

    // Parse dữ liệu scan
    const scanResults = realtimeData.map(parseRawScanData);

    // Sắp xếp theo dòng tiền khối ngoại (foreignNet)
    const byForeignNet = [...scanResults].sort((a, b) => b.foreignNet - a.foreignNet);

    // Top 5 leader (dòng tiền vào mạnh nhất)
    const leaders = byForeignNet.filter(s => s.foreignNet > 0).slice(0, 5);

    // Top 5 laggard (dòng tiền ra mạnh nhất)
    const laggards = byForeignNet.filter(s => s.foreignNet < 0).slice(-5).reverse();

    // Top biến động mạnh
    const topMovers = [...scanResults]
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .filter(s => Math.abs(s.changePct) >= 2)
      .slice(0, 5);

    // Top khối lượng
    const topVolume = [...scanResults].sort((a, b) => b.volume - a.volume).slice(0, 5);

    console.log(`   ✅ Scan xong ${scanResults.length} mã`);
    if (leaders.length > 0) {
      console.log(`   💚 Top dòng tiền vào: ${leaders.map(s => s.symbol + '(+' + fmtVol(s.foreignNet) + ')').join(', ')}`);
    }
    if (laggards.length > 0) {
      console.log(`   💔 Top dòng tiền ra: ${laggards.map(s => s.symbol + '(' + fmtVol(s.foreignNet) + ')').join(', ')}`);
    }

    return {
      all: scanResults,
      leaders,
      laggards,
      topMovers,
      topVolume,
    };
  } catch (error) {
    console.error('   ❌ Lỗi scan thị trường:', error.message);
    return null;
  }
}

// ─── TOP BOUGHT STOCKS: Quét CP mua nhiều nhất ─────────────

/**
 * Tìm Top N cổ phiếu được MUA NHIỀU NHẤT trong ngày
 * Kết hợp: khối ngoại mua ròng + KL giao dịch + tín hiệu giá
 * 
 * Composite Score = 
 *   40% Foreign Net Value (giá trị NN mua ròng)
 *   30% Volume Score (KL so với TB)
 *   20% Price Momentum (% tăng giá trong phiên)
 *   10% Buy Pressure (tỷ lệ NN mua / tổng KL)
 * 
 * @param {number} topN - Số lượng top (default 5)
 * @returns {Object} { topBought: [...], scanAll: [...], stats }
 */
async function fetchTopBoughtStocks(topN = 5) {
  console.log(`\n🏆 Tìm Top ${topN} CP mua nhiều nhất...`);
  
  try {
    // Scan toàn bộ (bao gồm cả tracked stocks)
    const allSymbols = [...new Set([...SCAN_SYMBOLS, ...config.stockSymbols])];
    console.log(`   📡 Quét ${allSymbols.length} mã...`);

    const realtimeData = await fetchRealtimeData(allSymbols);
    if (!realtimeData || realtimeData.length === 0) {
      console.error('   ❌ Không lấy được dữ liệu');
      return null;
    }

    // Parse all
    const allStocks = realtimeData.map(parseRawScanData);

    // Chỉ lấy mã có giao dịch (volume > 0 & price > 0)
    const activeStocks = allStocks.filter(s => s.volume > 0 && s.price > 0);

    if (activeStocks.length === 0) {
      console.log('   ⚠️ Không có mã nào giao dịch');
      return null;
    }

    // ─── Tính Composite Score ───
    // Normalize each factor to 0-100 range

    // Max values for normalization
    const maxForeignNetValue = Math.max(...activeStocks.map(s => Math.max(s.foreignNetValue, 0)), 1);
    const maxVolume = Math.max(...activeStocks.map(s => s.volume), 1);
    const maxChangePct = Math.max(...activeStocks.map(s => Math.max(s.changePct, 0)), 1);
    const maxBuyPressure = Math.max(...activeStocks.map(s => s.buyPressure), 1);

    for (const stock of activeStocks) {
      // Factor scores (0-100)
      const foreignScore = stock.foreignNetValue > 0
        ? (stock.foreignNetValue / maxForeignNetValue) * 100
        : 0;
      const volumeScore = (stock.volume / maxVolume) * 100;
      const momentumScore = stock.changePct > 0
        ? (stock.changePct / maxChangePct) * 100
        : 0;
      const pressureScore = (stock.buyPressure / maxBuyPressure) * 100;

      // Composite score (weighted)
      stock.compositeScore = parseFloat((
        foreignScore * 0.40 +
        volumeScore * 0.30 +
        momentumScore * 0.20 +
        pressureScore * 0.10
      ).toFixed(2));

      // Tín hiệu thêm
      stock.signals = [];
      if (stock.foreignNet > 50000) stock.signals.push('🟢 NN mua ròng mạnh');
      if (stock.foreignNet > 200000) stock.signals.push('🔥 NN gom hàng lớn');
      if (stock.changePct > 3) stock.signals.push('📈 Tăng giá mạnh');
      if (stock.changePct > 0 && stock.changePct < 1 && stock.foreignNet > 100000) {
        stock.signals.push('🧊 Tích lũy (giá sideway + NN gom)');
      }
      if (stock.buyPressure > 10) stock.signals.push('💪 Áp lực mua cao');
    }

    // Sort by composite score
    const sorted = [...activeStocks].sort((a, b) => b.compositeScore - a.compositeScore);
    const topBought = sorted.slice(0, topN);

    // Stats tổng hợp
    const totalForeignNet = activeStocks.reduce((sum, s) => sum + s.foreignNet, 0);
    const totalVolume = activeStocks.reduce((sum, s) => sum + s.volume, 0);
    const gainers = activeStocks.filter(s => s.changePct > 0).length;
    const losers = activeStocks.filter(s => s.changePct < 0).length;

    console.log(`   ✅ Top ${topN} CP mua nhiều nhất:`);
    for (let i = 0; i < topBought.length; i++) {
      const s = topBought[i];
      const sign = s.changePct >= 0 ? '+' : '';
      console.log(`   ${i + 1}. ${s.symbol}: ${s.price.toLocaleString()}đ (${sign}${s.changePct}%) | NN: ${fmtVol(s.foreignNet)} | Score: ${s.compositeScore}`);
    }

    return {
      topBought,
      scanAll: sorted,
      stats: {
        totalScanned: activeStocks.length,
        totalForeignNet,
        totalVolume,
        gainers,
        losers,
        avgChange: parseFloat((activeStocks.reduce((sum, s) => sum + s.changePct, 0) / activeStocks.length).toFixed(2)),
      },
    };
  } catch (error) {
    console.error('   ❌ Lỗi tìm top bought:', error.message);
    return null;
  }
}

function fmtVol(vol) {
  if (!vol) return '0';
  const absVol = Math.abs(vol);
  const sign = vol < 0 ? '-' : '';
  if (absVol >= 1000000) return sign + (absVol / 1000000).toFixed(2) + 'M';
  if (absVol >= 1000) return sign + (absVol / 1000).toFixed(1) + 'K';
  return sign + vol.toLocaleString('vi-VN');
}

/**
 * Lấy thanh khoản tổng TTCK Việt Nam (HOSE, HNX, UPCOM) realtime từ VPS index detail API
 * @returns {Object|null}
 */
async function fetchMarketLiquidity() {
  const url = 'https://bgapidatafeed.vps.com.vn/getlistindexdetail/10,02,03';
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: HEADERS,
        timeout: 10000,
      });

      if (response.data && Array.isArray(response.data)) {
        let hoseVal = 0;
        let hnxVal = 0;
        let upcomVal = 0;

        for (const item of response.data) {
          const val = parseFloat(item.value || 0) / 1000; // Quy ra tỷ VNĐ
          if (item.mc === '10') {
            hoseVal = val;
          } else if (item.mc === '02') {
            hnxVal = val;
          } else if (item.mc === '03') {
            upcomVal = val;
          }
        }

        const totalVal = hoseVal + hnxVal + upcomVal;

        return {
          hose: hoseVal,
          hnx: hnxVal,
          upcom: upcomVal,
          total: totalVal,
        };
      }
    } catch (error) {
      console.error(`⚠️ Attempt ${attempt}/${maxRetries} failed for market liquidity:`, error.message);
    }
    if (attempt < maxRetries) {
      await new Promise(res => setTimeout(res, 1000));
    }
  }
  return null;
}

/**
 * Lấy dữ liệu tự doanh mới nhất của mã cổ phiếu từ VNDIRECT API
 * @param {string} symbol - Mã cổ phiếu
 * @returns {Object|null}
 */
async function fetchProprietaryTrading(symbol) {
  const url = `https://finfo-api.vndirect.com.vn/v4/proprietary_trading?q=code:${symbol}&size=1`;
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: HEADERS,
        timeout: 5000,
      });
      if (response.data && response.data.data && response.data.data.length > 0) {
        const item = response.data.data[0];
        const buyVal = (parseFloat(item.matchedValueBuy || 0) + parseFloat(item.putthroughValueBuy || 0)) / 1e9;
        const sellVal = (parseFloat(item.matchedValueSell || 0) + parseFloat(item.putthroughValueSell || 0)) / 1e9;
        const netVal = buyVal - sellVal;
        return {
          buyVal,
          sellVal,
          netVal,
          date: item.date,
        };
      }
    } catch (error) {
      // Non-critical, silently fail
    }
    if (attempt < maxRetries) {
      await new Promise(res => setTimeout(res, 500));
    }
  }
  return null;
}

module.exports = { fetchAllStocks, fetchRealtimeData, fetchVN30Index, fetchMarketScan, fetchTopBoughtStocks, fetchMarketLiquidity, fetchProprietaryTrading };

