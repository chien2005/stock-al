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
const VNDIRECT_CHART_URL = 'https://dchart-api.vndirect.com.vn/dchart/history';
const ENTRADE_CHART_URL  = 'https://services.entrade.com.vn/chart-api/v2/ohlcs/derivative';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

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

// ─── FETCH REALTIME FUTURES PRICE ────────────────────────────
async function fetchRealtimeFuturesPrice() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30F1M&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 5000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      const c = res.data.c;
      return {
        price: c[c.length - 1],
        prevPrice: c.length > 1 ? c[c.length - 2] : c[c.length - 1],
        high: Math.max(...c.slice(-60)),
        low: Math.min(...c.slice(-60)),
      };
    }
  } catch (e) { /* fail silently */ }
  return null;
}

// ─── FETCH REALTIME VN30 INDEX PRICE ─────────────────────────
async function fetchRealtimeVN30Price() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 5000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      const c = res.data.c;
      return {
        price: c[c.length - 1],
        prevPrice: c.length > 1 ? c[c.length - 2] : c[c.length - 1],
      };
    }
  } catch (e) { /* fail silently */ }
  return null;
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
  const derivSymbols = getCurrentDerivativeSymbols();
  const allSyms = ['VN30F1M', 'VN30F2M', ...derivSymbols].join(',');

  try {
    const res = await axios.get(`${VPS_REALTIME_URL}/${allSyms}`, {
      headers: HEADERS, timeout: 8000,
    });

    const rawList = res.data || [];
    const f1mData = rawList.find(d => d.sym === 'VN30F1M');
    const derivContractData = rawList.filter(d => derivSymbols.includes(d.sym));

    let totalOI = 0;
    let totalOIChange = 0;
    let totalVolume = 0;
    let hasOI = false;
    let totalForeignBuy = 0;
    let totalForeignSell = 0;

    for (const raw of derivContractData) {
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

    return {
      totalOI: hasOI ? totalOI : null,
      totalOIChange: hasOI ? totalOIChange : null,
      totalVolume: totalVolume > 0 ? totalVolume : null,
      foreignBuy: totalForeignBuy,
      foreignSell: totalForeignSell,
      foreignNet: totalForeignBuy - totalForeignSell,
      f1mRealtime: f1mData,
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
    oiData,
  ] = await Promise.all([
    fetchDailyData(),
    fetchIntraday1m('VN30F1M'),
    fetchVN30Intraday1m(),
    fetchRealtimeVN30(),
    fetchRealtimeFuturesPrice(),
    fetchRealtimeVN30Price(),
    fetchDerivativesOIData(),
  ]);

  const result = {
    daily,
    intraday1m,
    vn30Intraday,
    realtimeVN30,
    futuresPrice,
    vn30Price,
    oiData,
    timestamp: Date.now(),
    timeLabel: vnNow(),
  };

  console.log(`   ✅ Data: F1M=${futuresPrice?.price?.toFixed(1) || 'N/A'} | VN30=${vn30Price?.price?.toFixed(1) || 'N/A'} | Intraday=${intraday1m ? intraday1m.c.length + ' bars' : 'N/A'} | OI=${oiData.totalOI || 'N/A'}`);

  return result;
}

module.exports = {
  fetchOHLCV,
  fetchIntraday1m,
  fetchVN30Intraday1m,
  fetchRealtimeVN30,
  fetchRealtimeFuturesPrice,
  fetchRealtimeVN30Price,
  fetchDailyData,
  fetchDerivativesOIData,
  fetchAllData,
  addBreadthSnapshot,
  getBreadthSnapshots,
  resetDailyCache,
  getCurrentDerivativeSymbols,
  vnNow,
  getVnTime,
  isMarketHours,
  getVnHour,
  HEADERS,
  VPS_HISTORY_URL,
  VPS_REALTIME_URL,
};
