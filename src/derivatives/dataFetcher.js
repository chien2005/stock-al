/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📡 VN30F v4.0 — Data Fetcher                               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Multi-source OHLCV + Realtime + Intraday data               ║
 * ║  VPS → VNDirect → Entrade (fallback chain)                   ║
 * ║  Snapshot cache cho breadth acceleration tracking              ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('../config');
const { getLiveVN30Components } = require('../vn30Resolver');

// ─── DATA SOURCES ────────────────────────────────────────────
const VPS_HISTORY_URL  = 'https://histdatafeed.vps.com.vn/tradingview/history';
const VPS_REALTIME_URL = 'https://bgapidatafeed.vps.com.vn/getliststockdata';
const VPS_PS_LIST_MAP  = 'https://bgapidatafeed.vps.com.vn/pslistmap';
const VPS_PS_SNAPSHOT  = 'https://bgapidatafeed.vps.com.vn/getpsalldatalsnapshot';
const VPS_INDEX_DETAIL_URL = 'https://bgapidatafeed.vps.com.vn/getlistindexdetail';
const VNDIRECT_CHART_URL = 'https://dchart-api.vndirect.com.vn/dchart/history';
const ENTRADE_CHART_URL  = 'https://services.entrade.com.vn/chart-api/v2/ohlcs/derivative';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── IN-MEMORY LAST KNOWN PRICES (Zero N/A Protection) ────────
const _lastKnownPrices = {
  f1m: 1843.0,
  f2m: 1791.1,
  vn30: 1844.25,
  vnindex: 1736.89,
  f1mPrev: 1851.0,
  f2mPrev: 1808.0,
  vn30Prev: 1844.91,
  vnindexPrev: 1734.93,
  updatedAt: Date.now(),
};

let _activeDerivSymbolF2 = null;

let _indexSnapshotCache = { data: null, fetchedAt: 0 };

// ─── INTRADAY CACHE (lưu data 1p cho nhiều engine dùng chung) ──
const _cache = {
  intraday1m: null,     // { data, fetchedAt }
  intraday5m: null,
  dailyOHLCV: null,
  realtimeVN30: null,
  realtimeFutures: null,
  breadthSnapshots: [], // Mảng snapshot breadth (tối đa 60 cái = 5 giờ)
};

const CACHE_TTL_1M = 30 * 1000;    // 30s cho data 1 phút
const CACHE_TTL_5M = 2 * 60 * 1000; // 2 phút cho data 5 phút
const CACHE_TTL_DAILY = 5 * 60 * 1000; // 5 phút cho data daily

// ─── HELPERS ─────────────────────────────────────────────────
function vnNow() {
  return new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
}

function getVnTime() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
}

function isMarketHours() {
  const vnTime = getVnTime();
  const day = vnTime.getDay();
  if (day < 1 || day > 5) return false;
  const t = vnTime.getHours() * 100 + vnTime.getMinutes();
  return (t >= 900 && t <= 1130) || (t >= 1300 && t <= 1445);
}

function getVnHour() {
  const vnTime = getVnTime();
  return vnTime.getHours() + vnTime.getMinutes() / 60;
}

function getStartOfDayTimestamp() {
  const vnTime = getVnTime();
  vnTime.setHours(0, 0, 0, 0);
  return Math.floor(vnTime.getTime() / 1000);
}

/**
 * Tính ngày thứ 5 tuần thứ 3 trong tháng (Ngày đáo hạn chuẩn phái sinh VN30F)
 * @param {number} year - Năm (vd 2026)
 * @param {number} month - Tháng 1-12 (vd 11)
 * @returns {number} Ngày trong tháng (từ 15 đến 21)
 */
function getThirdThursdayOfMonth(year, month) {
  // Tìm ngày thứ 5 đầu tiên của tháng
  // JS Date: month là 0-indexed (0=Tháng 1, ..., 11=Tháng 12)
  const firstDay = new Date(year, month - 1, 1);
  const dayOfWeek = firstDay.getDay(); // 0 = CN, 1 = T2, ..., 4 = T5
  let firstThursdayDate;
  if (dayOfWeek <= 4) {
    firstThursdayDate = 1 + (4 - dayOfWeek);
  } else {
    firstThursdayDate = 1 + (11 - dayOfWeek);
  }
  // Thứ 5 tuần thứ 3 = Thứ 5 đầu tiên + 14 ngày
  return firstThursdayDate + 14;
}

// Kiểm tra xem hôm nay có phải ngày đáo hạn hợp đồng phái sinh không (Thứ 5 tuần thứ 3)
function isDerivativesExpiryDay(date = new Date(), matureDateStr = null) {
  const vnTime = new Date(date.toLocaleString('en-US', { timeZone: config.timezone || 'Asia/Ho_Chi_Minh' }));
  const d = vnTime.getDate();
  const m = vnTime.getMonth() + 1;
  const y = vnTime.getFullYear();

  if (matureDateStr && typeof matureDateStr === 'string') {
    const parts = matureDateStr.trim().split('/').map(p => parseInt(p, 10));
    if (parts.length === 3 && parts[0] === d && parts[1] === m && parts[2] === y) {
      return true;
    }
  }

  // Tự động tính thứ 5 tuần thứ 3 của tháng
  const thirdThursday = getThirdThursdayOfMonth(y, m);
  return vnTime.getDay() === 4 && d === thirdThursday;
}

// Kiểm tra xem hôm nay có phải ngày T-1 trước ngày đáo hạn không (Thứ 4 ngay trước Thứ 5 tuần 3)
function isDerivativesPreExpiryDay(date = new Date(), matureDateStr = null) {
  const vnTime = new Date(date.toLocaleString('en-US', { timeZone: config.timezone || 'Asia/Ho_Chi_Minh' }));
  const d = vnTime.getDate();
  const m = vnTime.getMonth() + 1;
  const y = vnTime.getFullYear();

  if (matureDateStr && typeof matureDateStr === 'string') {
    const parts = matureDateStr.trim().split('/').map(p => parseInt(p, 10));
    if (parts.length === 3 && parts[1] === m && parts[2] === y) {
      const matureDay = parts[0];
      if (d === matureDay - 1 && vnTime.getDay() === 3) {
        return true;
      }
    }
  }

  const thirdThursday = getThirdThursdayOfMonth(y, m);
  return vnTime.getDay() === 3 && d === (thirdThursday - 1);
}

// Kiểm tra xem hôm nay có nằm trong kỳ theo dõi F2 sát sao không (Thứ 4 T-1 HOẶC Thứ 5 Đáo hạn)
function isDerivativesExpiryOrPreExpiryDay(date = new Date(), matureDateStr = null) {
  return isDerivativesExpiryDay(date, matureDateStr) || isDerivativesPreExpiryDay(date, matureDateStr);
}

// ─── FETCH OHLCV (Multi-source fallback) ─────────────────────
async function fetchOHLCV(symbol, resolution = 'D', days = 30) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * days;

  // Source 1: VPS
  try {
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      return res.data;
    }
  } catch (e) { /* fallback */ }

  // Source 2: VNDirect
  try {
    const res = await axios.get(
      `${VNDIRECT_CHART_URL}?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      return res.data;
    }
  } catch (e) { /* fallback */ }

  // Source 3: Entrade (chỉ cho derivatives)
  if (symbol.includes('VN30F')) {
    try {
      const entRes = resolution === '1' ? '1' : resolution === '5' ? '5' : '1D';
      const res = await axios.get(
        `${ENTRADE_CHART_URL}?symbol=${symbol}&resolution=${entRes}&from=${from}&to=${now}`,
        { headers: HEADERS, timeout: 8000 }
      );
      if (res.data && res.data.c && res.data.c.length > 0) {
        return { ...res.data, s: 'ok' };
      }
    } catch (e) { /* fail silently */ }
  }

  return null;
}

// ─── FETCH INTRADAY 1-MINUTE (cho Flow Engine, Market Structure) ──
async function fetchIntraday1m(symbol = 'VN30F1M') {
  // Check cache
  if (_cache.intraday1m && (Date.now() - _cache.intraday1m.fetchedAt < CACHE_TTL_1M)) {
    return _cache.intraday1m.data;
  }

  const now = Math.floor(Date.now() / 1000);
  const from = getStartOfDayTimestamp() - 86400; // Include yesterday for reference

  try {
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=${symbol}&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 10000 }
    );

    if (res.data && res.data.c && res.data.c.length > 0) {
      _cache.intraday1m = { data: res.data, fetchedAt: Date.now() };
      return res.data;
    }
  } catch (e) {
    console.error('   ⚠️ Intraday 1m fetch error:', e.message);
  }
  return null;
}

// ─── FETCH INTRADAY 5-MINUTE (cho Volume & Flow Engine 5M) ─────
async function fetchIntraday5m(symbol = 'VN30F1M') {
  if (_cache.intraday5m && (Date.now() - _cache.intraday5m.fetchedAt < CACHE_TTL_5M)) {
    return _cache.intraday5m.data;
  }

  try {
    const data = await fetchOHLCV(symbol, '5', 5);
    if (data && data.c && data.c.length > 0) {
      _cache.intraday5m = { data, fetchedAt: Date.now() };
      return data;
    }
  } catch (e) {
    console.error('   ⚠️ Intraday 5m fetch error:', e.message);
  }
  return null;
}

// ─── FETCH INTRADAY VN30 INDEX 1-MINUTE ──────────────────────
async function fetchVN30Intraday1m() {
  const now = Math.floor(Date.now() / 1000);
  const from = getStartOfDayTimestamp() - 86400;

  try {
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 10000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      return res.data;
    }
  } catch (e) { /* fail silently */ }
  return null;
}

// ─── FETCH REALTIME VN30 COMPONENTS ──────────────────────────
async function fetchRealtimeVN30() {
  if (_cache.realtimeVN30 && (Date.now() - _cache.realtimeVN30.fetchedAt < CACHE_TTL_1M)) {
    return _cache.realtimeVN30.data;
  }

  try {
    const vn30Components = await getLiveVN30Components();
    const symbols = vn30Components.map(c => c.sym).join(',');
    const res = await axios.get(`${VPS_REALTIME_URL}/${symbols}`, {
      headers: HEADERS, timeout: 10000,
    });

    const result = { raw: res.data || [], components: vn30Components };
    _cache.realtimeVN30 = { data: result, fetchedAt: Date.now() };
    return result;
  } catch (e) {
    console.error('   ⚠️ Realtime VN30 fetch error:', e.message);
    return { raw: [], components: [] };
  }
}

let _activeDerivSymbol = '41I1GB000';
let _lastMapFetchedAt = 0;

// ─── FETCH REALTIME INDICES SNAPSHOT (VNINDEX & VN30) ─────────
async function fetchRealtimeIndicesSnapshot() {
  if (_indexSnapshotCache.data && (Date.now() - _indexSnapshotCache.fetchedAt < 3000)) {
    return _indexSnapshotCache.data;
  }
  try {
    const res = await axios.get(`${VPS_INDEX_DETAIL_URL}/10,11`, {
      headers: HEADERS,
      timeout: 4000,
    });
    if (Array.isArray(res.data) && res.data.length > 0) {
      _indexSnapshotCache = { data: res.data, fetchedAt: Date.now() };
      for (const item of res.data) {
        if (item.mc === '10' && item.cIndex) {
          _lastKnownPrices.vnindex = parseFloat(item.cIndex);
          if (item.oIndex) _lastKnownPrices.vnindexPrev = parseFloat(item.oIndex);
        } else if (item.mc === '11' && item.cIndex) {
          _lastKnownPrices.vn30 = parseFloat(item.cIndex);
          if (item.oIndex) _lastKnownPrices.vn30Prev = parseFloat(item.oIndex);
        }
      }
      _lastKnownPrices.updatedAt = Date.now();
      return res.data;
    }
  } catch (e) {
    // Snapshot error fallback silently
  }
  return _indexSnapshotCache.data || null;
}

// ─── FETCH REALTIME FUTURES PRICE ────────────────────────────
async function fetchRealtimeFuturesPrice(chartCode = 'VN30F1M') {
  const isF2 = chartCode === 'VN30F2M';
  const priceKey = isF2 ? 'f2m' : 'f1m';
  const prevKey = isF2 ? 'f2mPrev' : 'f1mPrev';

  // Ưu tiên 1: Snapshot phái sinh realtime từ VPS (nhanh, chính xác từng giây)
  try {
    if ((!_activeDerivSymbol || (isF2 && !_activeDerivSymbolF2)) || Date.now() - _lastMapFetchedAt > 3600000) {
      try {
        const mapRes = await axios.get(VPS_PS_LIST_MAP, { headers: HEADERS, timeout: 3000 });
        if (Array.isArray(mapRes.data) && mapRes.data.length > 0) {
          const f1mItem = mapRes.data.find(d => (d.CHART_CODE || '') === 'VN30F1M');
          if (f1mItem) {
            _activeDerivSymbol = f1mItem.SYMBOL;
          }
          const f2mItem = mapRes.data.find(d => (d.CHART_CODE || '') === 'VN30F2M');
          if (f2mItem) {
            _activeDerivSymbolF2 = f2mItem.SYMBOL;
          }
          _lastMapFetchedAt = Date.now();
        }
      } catch (e) {}
    }
    const sym = isF2 ? (_activeDerivSymbolF2 || '41I1GC000') : (_activeDerivSymbol || '41I1GB000');
    const res = await axios.get(`${VPS_PS_SNAPSHOT}/${sym}`, { headers: HEADERS, timeout: 3000 });
    if (res.data && Array.isArray(res.data) && res.data.length > 0 && res.data[0].lastPrice) {
      const d = res.data[0];
      const p = parseFloat(d.lastPrice);
      const r = d.r ? parseFloat(d.r) : (d.closePrice ? parseFloat(d.closePrice) : p);
      _lastKnownPrices[priceKey] = p;
      _lastKnownPrices[prevKey] = r;
      _lastKnownPrices.updatedAt = Date.now();
      return {
        price: p,
        prevPrice: r,
        high: d.highPrice ? parseFloat(d.highPrice) : p,
        low: d.lowPrice ? parseFloat(d.lowPrice) : p,
        lot: parseInt(d.lot || '0'),
        lastVolume: parseInt(d.lastVolume || '0'),
        symbol: d.sym,
      };
    }
  } catch (e) { /* fail silently, fallback to history */ }

  // Ưu tiên 2: TradingView history feed
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=${chartCode}&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 5000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      const c = res.data.c;
      const p = c[c.length - 1];
      const r = c.length > 1 ? c[c.length - 2] : p;
      _lastKnownPrices[priceKey] = p;
      _lastKnownPrices[prevKey] = r;
      _lastKnownPrices.updatedAt = Date.now();
      return {
        price: p,
        prevPrice: r,
        high: Math.max(...c.slice(-60)),
        low: Math.min(...c.slice(-60)),
      };
    }
  } catch (e) { /* fail silently */ }

  // Ưu tiên 3: Intraday 1m/5m cache fallback
  if (!isF2 && _cache.intraday1m && _cache.intraday1m.data && _cache.intraday1m.data.c && _cache.intraday1m.data.c.length > 0) {
    const c = _cache.intraday1m.data.c;
    const p = c[c.length - 1];
    const r = c.length > 1 ? c[c.length - 2] : p;
    _lastKnownPrices.f1m = p;
    _lastKnownPrices.f1mPrev = r;
    return { price: p, prevPrice: r, high: p, low: p };
  }

  // Ưu tiên 4: In-memory cache bảo vệ tuyệt đối không bao giờ trả về null/N/A
  return {
    price: _lastKnownPrices[priceKey],
    prevPrice: _lastKnownPrices[prevKey],
    high: _lastKnownPrices[priceKey],
    low: _lastKnownPrices[priceKey],
    isCached: true,
  };
}

// ─── FETCH REALTIME VN30 INDEX PRICE ─────────────────────────
async function fetchRealtimeVN30Price() {
  // Ưu tiên 1: Snapshot trực tiếp từ VPS Index Detail (cực nhanh, chuẩn sàn từng giây)
  try {
    const list = await fetchRealtimeIndicesSnapshot();
    if (Array.isArray(list)) {
      const vn30Item = list.find(d => d.mc === '11');
      if (vn30Item && vn30Item.cIndex) {
        const price = parseFloat(vn30Item.cIndex);
        const prevPrice = vn30Item.oIndex ? parseFloat(vn30Item.oIndex) : price;
        _lastKnownPrices.vn30 = price;
        _lastKnownPrices.vn30Prev = prevPrice;
        _lastKnownPrices.updatedAt = Date.now();
        return {
          price,
          prevPrice,
          totalVolume: vn30Item.vol || 0,
          change: +(price - prevPrice).toFixed(2),
        };
      }
    }
  } catch (e) {}

  // Ưu tiên 2: TradingView history feed
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 5000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      const c = res.data.c;
      const v = res.data.v;
      const price = c[c.length - 1];
      const prevPrice = c.length > 1 ? c[c.length - 2] : price;
      _lastKnownPrices.vn30 = price;
      _lastKnownPrices.vn30Prev = prevPrice;
      _lastKnownPrices.updatedAt = Date.now();
      return {
        price,
        prevPrice,
        totalVolume: v ? v.reduce((s, x) => s + x, 0) : 0,
        change: +(price - prevPrice).toFixed(2),
      };
    }
  } catch (e) {}

  // Ưu tiên 3: Intraday 5m fallback
  try {
    const dData = await fetchOHLCV('VN30', '5', 2);
    if (dData && dData.c && dData.c.length > 0) {
      const price = dData.c[dData.c.length - 1];
      const prevPrice = dData.c.length > 1 ? dData.c[dData.c.length - 2] : price;
      _lastKnownPrices.vn30 = price;
      _lastKnownPrices.vn30Prev = prevPrice;
      return { price, prevPrice, totalVolume: 0 };
    }
  } catch (e) {}

  // Ưu tiên 4: In-memory cache bảo vệ tuyệt đối
  return {
    price: _lastKnownPrices.vn30,
    prevPrice: _lastKnownPrices.vn30Prev,
    totalVolume: 0,
    isCached: true,
  };
}

// ─── FETCH REALTIME VNINDEX PRICE ────────────────────────────
async function fetchRealtimeVNINDEXPrice() {
  // Ưu tiên 1: Snapshot trực tiếp từ VPS Index Detail (cực nhanh, chuẩn sàn từng giây)
  try {
    const list = await fetchRealtimeIndicesSnapshot();
    if (Array.isArray(list)) {
      const vnidxItem = list.find(d => d.mc === '10');
      if (vnidxItem && vnidxItem.cIndex) {
        const price = parseFloat(vnidxItem.cIndex);
        const prevPrice = vnidxItem.oIndex ? parseFloat(vnidxItem.oIndex) : price;
        _lastKnownPrices.vnindex = price;
        _lastKnownPrices.vnindexPrev = prevPrice;
        _lastKnownPrices.updatedAt = Date.now();
        return {
          price,
          prevPrice,
          totalVolume: vnidxItem.vol || 0,
          change: +(price - prevPrice).toFixed(2),
        };
      }
    }
  } catch (e) {}

  // Ưu tiên 2: TradingView history feed
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VNINDEX&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 5000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      const c = res.data.c;
      const v = res.data.v;
      const price = c[c.length - 1];
      const prevPrice = c.length > 1 ? c[c.length - 2] : price;
      _lastKnownPrices.vnindex = price;
      _lastKnownPrices.vnindexPrev = prevPrice;
      _lastKnownPrices.updatedAt = Date.now();
      return {
        price,
        prevPrice,
        totalVolume: v ? v.reduce((s, x) => s + x, 0) : 0,
        change: +(price - prevPrice).toFixed(2),
      };
    }
  } catch (e) {}

  // Ưu tiên 3: Daily fallback
  try {
    const dData = await fetchOHLCV('VNINDEX', 'D', 5);
    if (dData && dData.c && dData.c.length > 0) {
      const price = dData.c[dData.c.length - 1];
      const prevPrice = dData.c.length > 1 ? dData.c[dData.c.length - 2] : price;
      _lastKnownPrices.vnindex = price;
      _lastKnownPrices.vnindexPrev = prevPrice;
      return { price, prevPrice, totalVolume: 0 };
    }
  } catch (e) {}

  // Ưu tiên 4: In-memory cache bảo vệ tuyệt đối
  return {
    price: _lastKnownPrices.vnindex,
    prevPrice: _lastKnownPrices.vnindexPrev,
    totalVolume: 0,
    isCached: true,
  };
}

// ─── FETCH DAILY OHLCV (VN30, VN30F1M, VNINDEX) ─────────────
async function fetchDailyData() {
  if (_cache.dailyOHLCV && (Date.now() - _cache.dailyOHLCV.fetchedAt < CACHE_TTL_DAILY)) {
    return _cache.dailyOHLCV.data;
  }

  const [f1m, vn30, vnindex] = await Promise.all([
    fetchOHLCV('VN30F1M', 'D', 30),
    fetchOHLCV('VN30', 'D', 30),
    fetchOHLCV('VNINDEX', 'D', 10),
  ]);

  const result = { f1m, vn30, vnindex };
  _cache.dailyOHLCV = { data: result, fetchedAt: Date.now() };
  return result;
}

// ─── FETCH DERIVATIVES OI DATA ───────────────────────────────
function getCurrentDerivativeSymbols() {
  const now = new Date();
  const vnNowDate = getVnTime();
  const y = vnNowDate.getFullYear() % 100;
  const m = vnNowDate.getMonth() + 1;

  const m1 = m;
  const m2 = m === 12 ? 1 : m + 1;
  const y2 = m === 12 ? y + 1 : y;

  const quarterMonths = [3, 6, 9, 12];
  const currentQuarterIdx = quarterMonths.findIndex(q => q >= m);
  const q1Month = quarterMonths[currentQuarterIdx >= 0 ? currentQuarterIdx : 0];
  const q1Year = currentQuarterIdx >= 0 ? y : y + 1;
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

  return [...new Set(syms)];
}

async function fetchDerivativesOIData() {
  try {
    let derivSymbols = ['41I1G9000', '41I1GA000', '41I1GC000', '41I1H3000'];
    let mapData = null;
    try {
      const mapRes = await axios.get(VPS_PS_LIST_MAP, { headers: HEADERS, timeout: 5000 });
      if (Array.isArray(mapRes.data) && mapRes.data.length > 0) {
        mapData = mapRes.data;
        const vn30fSyms = mapRes.data
          .filter(d => (d.CHART_CODE || '').startsWith('VN30F'))
          .map(d => d.SYMBOL);
        if (vn30fSyms.length > 0) derivSymbols = vn30fSyms;
      }
    } catch (e) { /* fallback default symbols */ }

    const res = await axios.get(`${VPS_PS_SNAPSHOT}/${derivSymbols.join(',')}`, {
      headers: HEADERS, timeout: 8000,
    });

    const rawList = Array.isArray(res.data) ? res.data : [];

    // Tìm contract F1M (tháng hiện tại)
    let f1mCode = derivSymbols[0];
    if (mapData) {
      const f1mItem = mapData.find(d => d.CHART_CODE === 'VN30F1M');
      if (f1mItem) f1mCode = f1mItem.SYMBOL;
    }
    _activeDerivSymbol = f1mCode;
    const f1mData = rawList.find(d => d.sym === f1mCode) || rawList[0];

    // Tìm contract F2M (tháng kế tiếp) — quan trọng vào ngày đáo hạn
    let f2mCode = null;
    let f2mData = null;
    if (mapData) {
      const f2mItem = mapData.find(d => d.CHART_CODE === 'VN30F2M');
      if (f2mItem) {
        f2mCode = f2mItem.SYMBOL;
        _activeDerivSymbolF2 = f2mCode;
        f2mData = rawList.find(d => d.sym === f2mCode) || null;
      }
    }

    // Kiểm tra ngày đáo hạn từ matureDate F1M
    const f1mMatureDate = f1mData ? (f1mData.matureDate || null) : null;
    const isExpiry = isDerivativesExpiryDay(new Date(), f1mMatureDate);
    const isPreExpiry = isDerivativesPreExpiryDay(new Date(), f1mMatureDate);

    let totalOI = 0;
    let totalOIChange = 0;
    let totalVolume = 0;
    let hasOI = false;
    let totalForeignBuy = 0;
    let totalForeignSell = 0;

    for (const raw of rawList) {
      const oi = parseInt(raw.oi || '0');
      const oiChange = parseInt(raw.oichange || '0');
      const volume = parseInt(raw.lot || '0');
      const foreignBuy = parseInt(raw.fBVol || '0');
      const foreignSell = parseInt(raw.fSVolume || '0');

      if (oi > 0) hasOI = true;
      totalOI += oi;
      totalOIChange += oiChange;
      totalVolume += volume;
      totalForeignBuy += foreignBuy;
      totalForeignSell += foreignSell;
    }

    const f1mForeignBuy = f1mData ? parseInt(f1mData.fBVol || '0') : 0;
    const f1mForeignSell = f1mData ? parseInt(f1mData.fSVolume || '0') : 0;
    const f1mOI = f1mData ? parseInt(f1mData.oi || '0') : 0;
    const f1mPrice = f1mData && f1mData.lastPrice ? parseFloat(f1mData.lastPrice) : null;

    // F2M data (quan trọng vào ngày đáo hạn vì Smart Money chuyển sang F2)
    const f2mForeignBuy = f2mData ? parseInt(f2mData.fBVol || '0') : 0;
    const f2mForeignSell = f2mData ? parseInt(f2mData.fSVolume || '0') : 0;
    const f2mOI = f2mData ? parseInt(f2mData.oi || '0') : 0;
    const f2mVolume = f2mData ? parseInt(f2mData.lot || '0') : 0;
    const f2mPrice = f2mData && f2mData.lastPrice ? parseFloat(f2mData.lastPrice) : null;
    const f2mMatureDate = f2mData ? (f2mData.matureDate || null) : null;

    return {
      totalOI: hasOI ? totalOI : null,
      totalOIChange: totalOIChange,
      totalVolume: totalVolume > 0 ? totalVolume : null,
      f1mVolume: f1mData ? parseInt(f1mData.lot || '0') : (totalVolume || 0),
      // Dữ liệu hợp đồng chính VN30F1M (chuẩn phái sinh nhất)
      foreignBuy: f1mForeignBuy,
      foreignSell: f1mForeignSell,
      foreignNet: f1mForeignBuy - f1mForeignSell,
      // Tổng toàn bộ các kỳ hạn
      allForeignBuy: totalForeignBuy,
      allForeignSell: totalForeignSell,
      allForeignNet: totalForeignBuy - totalForeignSell,
      f1mOI,
      f1mForeignBuy,
      f1mForeignSell,
      f1mForeignNet: f1mForeignBuy - f1mForeignSell,
      f1mPrice,
      f1mRealtime: f1mData,
      f1mMatureDate,
      // ─── F2M DATA (Hợp đồng tháng kế tiếp) ─────────────
      f2mForeignBuy,
      f2mForeignSell,
      f2mForeignNet: f2mForeignBuy - f2mForeignSell,
      f2mOI,
      f2mVolume,
      f2mPrice,
      f2mRealtime: f2mData,
      f2mMatureDate,
      // Structured objects cho F1 và F2
      f1mData: {
        symbol: f1mCode,
        price: f1mPrice,
        volume: f1mData ? parseInt(f1mData.lot || '0') : 0,
        oi: f1mOI,
        foreignBuy: f1mForeignBuy,
        foreignSell: f1mForeignSell,
        foreignNet: f1mForeignBuy - f1mForeignSell,
        matureDate: f1mMatureDate,
      },
      f2mData: {
        symbol: f2mCode,
        price: f2mPrice,
        volume: f2mVolume,
        oi: f2mOI,
        foreignBuy: f2mForeignBuy,
        foreignSell: f2mForeignSell,
        foreignNet: f2mForeignBuy - f2mForeignSell,
        matureDate: f2mMatureDate,
      },
      // Ngày đáo hạn & T-1
      isExpiryDay: isExpiry,
      isPreExpiryDay: isPreExpiry,
      isExpiryOrPreExpiry: isExpiry || isPreExpiry,
      derivSymbols,
    };
  } catch (e) {
    console.error('   ⚠️ Derivatives OI fetch error:', e.message);
    return { totalOI: null, totalOIChange: null, totalVolume: null, foreignBuy: 0, foreignSell: 0, foreignNet: 0 };
  }
}

// ─── BREADTH SNAPSHOT CACHE ──────────────────────────────────
function addBreadthSnapshot(snapshot) {
  _cache.breadthSnapshots.push({
    ...snapshot,
    timestamp: Date.now(),
    timeLabel: new Date().toLocaleTimeString('vi-VN', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }),
  });
  // Giữ tối đa 60 snapshots (5 giờ × 12 lần/giờ)
  if (_cache.breadthSnapshots.length > 60) {
    _cache.breadthSnapshots = _cache.breadthSnapshots.slice(-60);
  }
}

function getBreadthSnapshots() {
  return _cache.breadthSnapshots;
}

function resetDailyCache() {
  _cache.intraday1m = null;
  _cache.intraday5m = null;
  _cache.dailyOHLCV = null;
  _cache.realtimeVN30 = null;
  _cache.realtimeFutures = null;
  _cache.breadthSnapshots = [];
}

// ─── MASTER FETCH: Lấy tất cả data cần thiết cho 1 cycle ────
async function fetchAllData() {
  console.log('   📡 [v4.0] Đang lấy dữ liệu thị trường...');

  const [
    daily,
    intraday1m,
    vn30Intraday,
    realtimeVN30,
    futuresPrice,
    vn30Price,
    vnindexPrice,
    oiData,
  ] = await Promise.all([
    fetchDailyData(),
    fetchIntraday1m('VN30F1M'),
    fetchVN30Intraday1m(),
    fetchRealtimeVN30(),
    fetchRealtimeFuturesPrice(),
    fetchRealtimeVN30Price(),
    fetchRealtimeVNINDEXPrice(),
    fetchDerivativesOIData(),
  ]);

  const result = {
    daily,
    intraday1m,
    vn30Intraday,
    realtimeVN30,
    futuresPrice,
    vn30Price,
    vnindexPrice,
    oiData,
    timestamp: Date.now(),
    timeLabel: vnNow(),
  };

  console.log(`   ✅ Data: F1M=${futuresPrice?.price?.toFixed(1) || 'N/A'} | VN30=${vn30Price?.price?.toFixed(1) || 'N/A'} | VNINDEX=${vnindexPrice?.price?.toFixed(1) || 'N/A'} | Intraday=${intraday1m ? intraday1m.c.length + ' bars' : 'N/A'} | OI=${oiData.totalOI || 'N/A'}`);

  return result;
}

function getLastKnownPrices() {
  return { ..._lastKnownPrices };
}

function getLastKnownPrice(symbolKey) {
  return _lastKnownPrices[symbolKey] || null;
}

async function fetchRealtimeF2Price() {
  return fetchRealtimeFuturesPrice('VN30F2M');
}

module.exports = {
  fetchOHLCV,
  fetchIntraday1m,
  fetchIntraday5m,
  fetchVN30Intraday1m,
  fetchRealtimeVN30,
  fetchRealtimeFuturesPrice,
  fetchRealtimeF2Price,
  fetchRealtimeVN30Price,
  fetchRealtimeVNINDEXPrice,
  fetchRealtimeIndicesSnapshot,
  getLastKnownPrices,
  getLastKnownPrice,
  _lastKnownPrices,
  fetchDailyData,
  fetchDerivativesOIData,
  fetchAllData,
  addBreadthSnapshot,
  getBreadthSnapshots,
  resetDailyCache,
  getCurrentDerivativeSymbols,
  getThirdThursdayOfMonth,
  isDerivativesExpiryDay,
  isDerivativesPreExpiryDay,
  isDerivativesExpiryOrPreExpiryDay,
  vnNow,
  getVnTime,
  isMarketHours,
  getVnHour,
  HEADERS,
  VPS_HISTORY_URL,
  VPS_REALTIME_URL,
};
