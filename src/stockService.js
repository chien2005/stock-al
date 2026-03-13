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
 * @param {string[]} symbols - Danh sách mã (ví dụ: ['FPT', 'VNM'])
 * @returns {Object[]} Danh sách dữ liệu stock
 */
async function fetchRealtimeData(symbols) {
  try {
    const symbolStr = symbols.join(',');
    const url = `${VPS_API.realtime}/${symbolStr}`;

    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });

    return response.data || [];
  } catch (error) {
    console.error('⚠️  Lỗi khi lấy realtime data từ VPS:', error.message);
    return [];
  }
}

/**
 * Lấy dữ liệu lịch sử giá (30 ngày gần nhất) để tính trung bình
 * @param {string} symbol - Mã cổ phiếu
 * @returns {Object|null}
 */
async function fetchHistoryData(symbol) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 30; // 30 ngày trước
    const url = `${VPS_API.history}?symbol=${symbol}&resolution=D&from=${from}&to=${now}`;

    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    // Non-critical, silently fail
    return null;
  }
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
  const changePct = parseFloat(raw.changePc || 0);

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

  // Lấy 5 phiên gần nhất (cho AI phân tích xu hướng)
  let historyPrices = [];
  if (history && history.c && history.c.length >= 5) {
    historyPrices = history.c.slice(-5).map(p => Math.round(p * 1000));
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
    // SMA20
    sma20,
    // Khối lượng
    volume,
    avgVolume,
    // Khối ngoại
    foreignBuy,
    foreignSell,
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

module.exports = { fetchAllStocks, fetchRealtimeData };
