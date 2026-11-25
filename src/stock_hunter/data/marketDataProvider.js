/**
 * AI STOCK HUNTER - Market Data Provider & Validator
 * Chuẩn hóa hợp đồng dữ liệu:
 * - Giá cổ phiếu lưu nội bộ bằng VND/cổ phiếu (VPS source nghìn đồng -> * 1000 đúng 1 lần)
 * - Volume lưu bằng số cổ phiếu (VPS realtime `lot` -> * 10; TradingView history `v` đã là shares)
 * - Kiểm tra chặt OHLC (low <= min(O,C) <= max(O,C) <= high, volume >= 0), chống duplicate, stale
 * - Tự tổng hợp 1W / 1M từ 1D hợp lệ để tiết kiệm 66% request và đảm bảo point-in-time (asOf)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { toVnComponents, sessionAt, isContinuousSession } = require('../core/calendar');

const VPS_REALTIME_URL = 'https://bgapidatafeed.vps.com.vn/getliststockdata';
const VPS_HISTORY_URL = 'https://histdatafeed.vps.com.vn/tradingview/history';
const VPS_INDEX_DETAIL_URL = 'https://bgapidatafeed.vps.com.vn/getlistindexdetail/10,02,03';
const VNDIRECT_CHART_URL = 'https://dchart-api.vndirect.com.vn/dchart/history';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const CACHE_D_FILE = path.join(DATA_DIR, 'sh_cache_d.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kiểm tra tính toàn vẹn của một cây nến OHLCV (Test D02, D03, D08)
 */
function validateBar(bar) {
  if (!bar || typeof bar !== 'object') return { valid: false, reason: 'NULL_BAR' };
  const { open, high, low, close, volume } = bar;
  if (![open, high, low, close, volume].every(Number.isFinite)) {
    return { valid: false, reason: 'NON_FINITE_OHLCV' };
  }
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    return { valid: false, reason: 'NON_POSITIVE_PRICE' };
  }
  if (volume < 0) {
    return { valid: false, reason: 'NEGATIVE_VOLUME' };
  }
  if (low > Math.min(open, close) + 1e-6 || high < Math.max(open, close) - 1e-6 || low > high) {
    return { valid: false, reason: 'INVALID_OHLC_BOUNDS' };
  }
  return { valid: true, reason: null };
}

/**
 * Chuẩn hóa danh sách nến TradingView (c, o, h, l, v, t) thành Bar Contract chuẩn
 * @param {string} symbol
 * @param {Object} rawTv - { t, o, h, l, c, v }
 * @param {'15m'|'1D'} timeframe
 * @param {'THOUSAND_VND'|'VND'|'POINTS'} priceUnit
 * @param {string} exchange
 * @param {string} source
 */
function normalizeTradingViewBars(symbol, rawTv, timeframe, priceUnit = 'THOUSAND_VND', exchange = 'HOSE', source = 'VPS') {
  if (!rawTv || !Array.isArray(rawTv.c) || !Array.isArray(rawTv.t) || rawTv.c.length === 0) {
    return { bars: [], rejected: 0 };
  }

  const mult = priceUnit === 'THOUSAND_VND' ? 1000 : 1;
  const dedup = new Map();
  let rejected = 0;

  for (let i = 0; i < rawTv.c.length; i++) {
    const tsSec = Number(rawTv.t[i]);
    if (!Number.isFinite(tsSec) || tsSec <= 0) {
      rejected++;
      continue;
    }

    const close = Math.round(Number(rawTv.c[i]) * mult * 100) / 100;
    const open = rawTv.o && rawTv.o[i] != null ? Math.round(Number(rawTv.o[i]) * mult * 100) / 100 : close;
    const high = rawTv.h && rawTv.h[i] != null ? Math.round(Number(rawTv.h[i]) * mult * 100) / 100 : Math.max(open, close);
    const low = rawTv.l && rawTv.l[i] != null ? Math.round(Number(rawTv.l[i]) * mult * 100) / 100 : Math.min(open, close);
    const volume = rawTv.v && rawTv.v[i] != null ? Math.round(Number(rawTv.v[i])) : 0;

    const endMs = tsSec * 1000;
    const vn = toVnComponents(new Date(endMs));
    const session = timeframe === '15m' ? sessionAt(new Date(endMs), exchange) : 'DAILY_CLOSE';

    // Với 15m: lọc bỏ nến nằm ngoài phiên khớp liên tục (tránh trộn ATO/ATC/nghỉ trưa vào feature 15m)
    if (timeframe === '15m' && !isContinuousSession(session) && session !== 'CLOSED_HOLIDAY') {
      // Cho phép giữ nến đóng cửa 11:30 hoặc 14:30 nếu timestamp đánh dấu end_at của nến cuối sáng/chiều
      if (vn.hhmm !== 1130 && vn.hhmm !== 1430) {
        continue;
      }
    }

    const bar = {
      symbol,
      exchange,
      timeframe,
      timestamp: tsSec,
      dateStr: vn.dateStr,
      timeLabel: vn.timeLabel,
      session,
      open,
      high,
      low,
      close,
      volume,
      matchedValueVnd: Math.round(close * volume),
      matchedValueEstimated: true,
      noTrade: volume === 0,
      source,
      final: true,
      quality: 'VALID',
    };

    const check = validateBar(bar);
    if (!check.valid) {
      rejected++;
      continue;
    }

    // Deduplicate theo timestamp (Test D03: không cộng trùng volume, giữ bản mới nhất)
    dedup.set(tsSec, bar);
  }

  const bars = Array.from(dedup.values()).sort((a, b) => a.timestamp - b.timestamp);
  return { bars, rejected };
}

function parseBidAskSide(g1, g2, g3) {
  return [g1, g2, g3]
    .map((g) => {
      if (!g || typeof g !== 'string') return null;
      const parts = g.split('|');
      if (parts.length < 2) return null;
      const rawPrice = parseFloat(parts[0]);
      const volLots = parseInt(parts[1], 10);
      if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(volLots) || volLots < 0) return null;
      return {
        priceVnd: Math.round(rawPrice * 1000),
        volumeShares: volLots * 10,
      };
    })
    .filter(Boolean);
}

/**
 * Chuẩn hóa quote realtime VPS (Test D01, D12, D13)
 * - Giá * 1000 = VND (chính xác 1 lần)
 * - Lot * 10 = cổ phiếu
 * - changePct tự tính từ price & refPrice (fix bug mất dấu âm của VPS)
 */
function normalizeVpsQuote(raw, receivedAt = new Date(), exchangeHint = 'HOSE') {
  if (!raw || !raw.sym) return null;
  const symbol = String(raw.sym).trim().toUpperCase();
  const priceVnd = Math.round(parseFloat(raw.lastPrice || 0) * 1000);
  const refPriceVnd = Math.round(parseFloat(raw.r || 0) * 1000);
  const ceilingVnd = Math.round(parseFloat(raw.c || 0) * 1000);
  const floorVnd = Math.round(parseFloat(raw.f || 0) * 1000);
  const openVnd = Math.round(parseFloat(raw.openPrice || 0) * 1000);
  const highVnd = Math.round(parseFloat(raw.highPrice || 0) * 1000);
  const lowVnd = Math.round(parseFloat(raw.lowPrice || 0) * 1000);
  const avgVnd = Math.round(parseFloat(raw.avePrice || 0) * 1000);

  const volumeShares = Math.max(0, parseInt(raw.lot || 0, 10) * 10);
  const effectivePrice = priceVnd > 0 ? priceVnd : refPriceVnd;
  const changePct = refPriceVnd > 0 && effectivePrice > 0
    ? parseFloat((((effectivePrice - refPriceVnd) / refPriceVnd) * 100).toFixed(2))
    : 0;

  // Khối ngoại: nếu không có trường dữ liệu từ feed -> null (không tự gán 0 giả, Test D13)
  const hasForeignFields = raw.fBVol !== undefined && raw.fSVolume !== undefined;
  const foreignBuyShares = hasForeignFields ? parseInt(raw.fBVol || 0, 10) * 10 : null;
  const foreignSellShares = hasForeignFields ? parseInt(raw.fSVolume || 0, 10) * 10 : null;
  const foreignNetShares = hasForeignFields ? foreignBuyShares - foreignSellShares : null;
  const foreignNetValueVnd = hasForeignFields && effectivePrice > 0 ? foreignNetShares * effectivePrice : null;

  const bids = parseBidAskSide(raw.g1, raw.g2, raw.g3);
  const asks = parseBidAskSide(raw.g4, raw.g5, raw.g6);
  const bestBid = bids[0]?.priceVnd || null;
  const bestAsk = asks[0]?.priceVnd || null;
  const spreadPct = bestBid && bestAsk && bestBid > 0 ? parseFloat((((bestAsk - bestBid) / bestBid) * 100).toFixed(3)) : null;

  const exchange = raw.marketId === 'STO' ? 'HOSE'
    : raw.marketId === 'HNO' ? 'HNX'
      : raw.marketId === 'UPX' ? 'UPCOM'
        : exchangeHint;

  const matchedValueVnd = avgVnd > 0 ? volumeShares * avgVnd : volumeShares * effectivePrice;
  const isLimitDownLocked = floorVnd > 0 && effectivePrice <= floorVnd && (!bids || bids.length === 0);
  const isLimitUpLocked = ceilingVnd > 0 && effectivePrice >= ceilingVnd && (!asks || asks.length === 0);

  return {
    symbol,
    exchange,
    priceVnd: effectivePrice,
    refPriceVnd,
    ceilingVnd,
    floorVnd,
    openVnd: openVnd > 0 ? openVnd : effectivePrice,
    highVnd: highVnd > 0 ? highVnd : effectivePrice,
    lowVnd: lowVnd > 0 ? lowVnd : effectivePrice,
    avgVnd,
    changePct,
    volumeShares,
    matchedValueVnd,
    foreignBuyShares,
    foreignSellShares,
    foreignNetShares,
    foreignNetValueVnd,
    bids,
    asks,
    spreadPct,
    isLimitDownLocked,
    isLimitUpLocked,
    noTrade: volumeShares === 0,
    receivedAt: receivedAt.toISOString(),
    source: 'VPS',
    quality: effectivePrice > 0 ? 'VALID' : 'INVALID',
  };
}

/**
 * Tổng hợp nến Tuần (1W) hoặc Tháng (1M) từ nến Ngày (1D) point-in-time (Test T09)
 * Chỉ dùng các nến ngày đã có <= asOfDateStr. Nến tuần/tháng hiện tại chưa kết thúc gắn final: false.
 */
function aggregateTimeframeBars(dailyBars, timeframe = '1W', asOfDateStr = null) {
  if (!Array.isArray(dailyBars) || dailyBars.length === 0) return [];
  const filtered = asOfDateStr
    ? dailyBars.filter(b => b.dateStr <= asOfDateStr)
    : dailyBars;
  if (filtered.length === 0) return [];

  const groups = new Map();
  for (const bar of filtered) {
    let key;
    if (timeframe === '1M') {
      key = bar.dateStr.slice(0, 7); // YYYY-MM
    } else {
      // ISO week key (Thứ 2 -> Chủ nhật)
      const d = new Date(`${bar.dateStr}T12:00:00+07:00`);
      const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      const thursday = new Date(d.getTime() + (3 - dayNum) * 86400000);
      const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
      key = `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(bar);
  }

  const keys = Array.from(groups.keys()).sort();
  const lastKey = keys[keys.length - 1];

  return keys.map((key) => {
    const chunk = groups.get(key);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    let matchedValueVnd = 0;
    for (const b of chunk) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
      matchedValueVnd += b.matchedValueVnd || (b.close * b.volume);
    }

    // Tuần/tháng cuối cùng đang chạy chỉ coi là provisional trừ khi đã qua ngày cuối tuần/tháng
    const isCurrentPeriod = key === lastKey;
    return {
      symbol: first.symbol,
      exchange: first.exchange,
      timeframe,
      periodKey: key,
      timestamp: last.timestamp,
      dateStr: last.dateStr,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      matchedValueVnd,
      final: !isCurrentPeriod,
      provisional: isCurrentPeriod,
      quality: 'VALID',
    };
  });
}

/**
 * Fetch batch realtime quotes từ VPS theo chunk 40 mã
 */
async function fetchRealtimeBatch(symbols, exchangeMap = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) return new Map();
  const chunkSize = 40;
  const chunks = [];
  for (let i = 0; i < symbols.length; i += chunkSize) {
    chunks.push(symbols.slice(i, i + chunkSize));
  }

  const results = new Map();
  const now = new Date();

  await Promise.all(chunks.map(async (chunk) => {
    const url = `${VPS_REALTIME_URL}/${chunk.join(',')}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        if (Array.isArray(res.data)) {
          for (const raw of res.data) {
            const sym = String(raw?.sym || '').toUpperCase();
            if (!sym) continue;
            const norm = normalizeVpsQuote(raw, now, exchangeMap[sym] || 'HOSE');
            if (norm) results.set(sym, norm);
          }
          return;
        }
      } catch (err) {
        if (attempt < 3) await sleep(600 * attempt);
      }
    }
  }));

  return results;
}

/**
 * Fetch TradingView OHLCV history (VPS primary -> VNDirect fallback)
 */
async function fetchTvHistory(symbol, resolution = 'D', lookbackDays = 140, priceUnit = 'THOUSAND_VND', exchange = 'HOSE') {
  const toSec = Math.floor(Date.now() / 1000);
  const fromSec = toSec - lookbackDays * 86400;

  const sources = [
    { name: 'VPS', url: `${VPS_HISTORY_URL}?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${fromSec}&to=${toSec}` },
    { name: 'VNDIRECT', url: `${VNDIRECT_CHART_URL}?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${fromSec}&to=${toSec}` },
  ];

  const timeframe = resolution === '15' ? '15m' : '1D';
  for (const src of sources) {
    try {
      const res = await axios.get(src.url, { headers: HEADERS, timeout: 9000 });
      if (res.data && Array.isArray(res.data.c) && res.data.c.length > 0) {
        const parsed = normalizeTradingViewBars(symbol, res.data, timeframe, priceUnit, exchange, src.name);
        if (parsed.bars.length > 0) {
          return parsed.bars;
        }
      }
    } catch (e) {
      // Fallback sang nguồn tiếp theo
    }
  }
  return [];
}

function loadDailyCache() {
  try {
    if (fs.existsSync(CACHE_D_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_D_FILE, 'utf8'));
      return parsed || { updatedAt: null, dateStr: null, barsBySymbol: {} };
    }
  } catch (e) { /* ignore */ }
  return { updatedAt: null, dateStr: null, barsBySymbol: {} };
}

function saveDailyCache(cacheObj) {
  try {
    ensureDataDir();
    fs.writeFileSync(CACHE_D_FILE, JSON.stringify(cacheObj), 'utf8');
  } catch (e) {
    console.error('⚠️ Không lưu được sh_cache_d.json:', e.message);
  }
}

/**
 * Tải & cập nhật Cache nến Ngày (1D) cho toàn bộ universe + VNINDEX + VN30 theo batch an toàn
 */
async function refreshDailyCache(instruments, force = false) {
  const todayStr = toVnComponents(new Date()).dateStr;
  const existing = loadDailyCache();
  const barsBySymbol = existing.barsBySymbol || {};

  const targets = [
    { symbol: 'VNINDEX', exchange: 'HOSE', priceUnit: 'POINTS' },
    { symbol: 'VN30', exchange: 'HOSE', priceUnit: 'POINTS' },
    ...instruments.map(inst => ({
      symbol: inst.symbol,
      exchange: inst.exchange || 'HOSE',
      priceUnit: 'THOUSAND_VND',
    })),
  ];

  // Nếu cache đã update trong hôm nay và đủ dữ liệu, bỏ qua các mã đã có trừ khi force=true
  const toFetch = force
    ? targets
    : targets.filter(t => !barsBySymbol[t.symbol] || barsBySymbol[t.symbol].length < 40 || existing.dateStr !== todayStr);

  if (toFetch.length === 0) {
    return existing;
  }

  const batchSize = 6;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(t => fetchTvHistory(t.symbol, 'D', 200, t.priceUnit, t.exchange))
    );
    batch.forEach((t, idx) => {
      if (fetched[idx] && fetched[idx].length > 0) {
        barsBySymbol[t.symbol] = fetched[idx];
      }
    });
    if (i + batchSize < toFetch.length) {
      await sleep(250);
    }
  }

  const updated = {
    updatedAt: new Date().toISOString(),
    dateStr: todayStr,
    barsBySymbol,
  };
  saveDailyCache(updated);
  return updated;
}

/**
 * Fetch nến 15m có chọn lọc cho danh sách ứng viên (batch 6 mã/lần)
 */
async function fetchIntraday15mBatch(symbols, exchangeMap = {}) {
  const result = new Map();
  if (!Array.isArray(symbols) || symbols.length === 0) return result;
  const batchSize = 6;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(sym => fetchTvHistory(sym, '15', 7, 'THOUSAND_VND', exchangeMap[sym] || 'HOSE'))
    );
    batch.forEach((sym, idx) => {
      if (fetched[idx] && fetched[idx].length > 0) {
        result.set(sym, fetched[idx]);
      }
    });
    if (i + batchSize < symbols.length) await sleep(150);
  }
  return result;
}

/**
 * Fetch chỉ số VN-Index, VN30 và thanh khoản thị trường (phân biệt khớp lệnh vs thỏa thuận nếu API cung cấp)
 */
async function fetchMarketIndicesSnapshot() {
  try {
    const res = await axios.get(VPS_INDEX_DETAIL_URL, { headers: HEADERS, timeout: 10000 });
    if (!Array.isArray(res.data)) return null;

    const out = {
      receivedAt: new Date().toISOString(),
      vnindex: null,
      hnxindex: null,
      upcomindex: null,
      hoseMatchedValueVnd: null,
      hosePutThroughValueVnd: null, // VPS index detail trả tổng value; tách null nếu feed không tách rõ (Test D12)
      totalValueBil: 0,
    };

    for (const item of res.data) {
      const idxPoint = parseFloat(item.cIndex || item.indexValue || 0);
      const refPoint = parseFloat(item.refIndex || item.oIndex || 0);
      const changePct = refPoint > 0
        ? parseFloat((((idxPoint - refPoint) / refPoint) * 100).toFixed(2))
        : parseFloat(item.changePercent || 0);
      const valBil = parseFloat(item.value || 0) / 1000; // tỷ VND
      const volShares = parseInt(item.vol || 0, 10); // getlistindexdetail trả về vol đơn vị cổ phiếu

      const entry = {
        index: idxPoint,
        refIndex: refPoint,
        changePct,
        valueBil: valBil,
        volumeShares: volShares,
        advances: item.advances !== undefined ? parseInt(item.advances, 10) : null,
        declines: item.declines !== undefined ? parseInt(item.declines, 10) : null,
        noChanges: item.noChanges !== undefined ? parseInt(item.noChanges, 10) : null,
      };

      if (item.mc === '10') {
        out.vnindex = entry;
        out.hoseMatchedValueVnd = valBil * 1e9; // Lưu ý: nguồn VPS gộp value; đánh dấu ước tính nếu cần
      } else if (item.mc === '02') {
        out.hnxindex = entry;
      } else if (item.mc === '03') {
        out.upcomindex = entry;
      }
      out.totalValueBil += valBil;
    }

    return out;
  } catch (e) {
    return null;
  }
}

module.exports = {
  validateBar,
  normalizeTradingViewBars,
  normalizeVpsQuote,
  aggregateTimeframeBars,
  fetchRealtimeBatch,
  fetchTvHistory,
  loadDailyCache,
  saveDailyCache,
  refreshDailyCache,
  fetchIntraday15mBatch,
  fetchMarketIndicesSnapshot,
};
