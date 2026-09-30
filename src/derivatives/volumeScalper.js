/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN30F v5.1 — Volume Scalping Engine                     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  • Poll 1p nến đã đóng từ 09:12 → 14:30                      ║
 * ║  • Fast Tick 5s: Bắt Flash Crash / Cá mập úp bô / Force Sell   ║
 * ║  • Xu hướng MA9 & MA26: Sát dải trên → Long, sát dải dưới → Short║
 * ║  • Lọc Trap râu nến, Bollinger Bands (Cấm đuổi đỉnh/đáy)     ║
 * ║  • Cảnh báo Vượt đỉnh 3 lần thất bại (Triple Top Fakeout)      ║
 * ║  • Cấu trúc Đỉnh sau < Đỉnh trước (LH) / > Đỉnh trước (HH)    ║
 * ║  • Chế độ Quiet: Không spam khi thanh khoản < 1.000 HĐ         ║
 * ║  • Báo cáo đầy đủ giây lẻ (HH:mm:ss), NN, Tự doanh, Đám đông  ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const dataFetcher = require('./dataFetcher');
const oiEstimator = require('./oiEstimator');
const { sendDerivativesMessage } = require('../telegramService');
const { config, isCurrentInstanceActive } = require('../config');

// ─── CONSTANTS ───────────────────────────────────────────────
const POLL_INTERVAL_MS = 60 * 1000;       // 60 giây (Nến 1p)
const FAST_TICK_INTERVAL_MS = 5 * 1000;   // 5 giây (Bắt Flash Crash realtime)
const START_TIME = '09:12';               // Bỏ qua 12 phút đầu phiên (ATO noise)
const STOP_ENTRY_TIME = '14:20';          // Không mở mới sau 14:20
const END_TIME = '14:30';                 // Dừng poll nến 1p

// Volume thresholds
const VOL_ENTRY_MIN = 2300;               // Vol tối thiểu để vào lệnh
const VOL_ENTRY_MAX = 2800;               // Vol tối đa vào lệnh (trên = FOMO)
const VOL_FOMO = 2800;                    // Cấm FOMO trên mức này
const VOL_CLIMAX = 3000;                  // Nổ vol Climax chốt lời
const VOL_EXIT_OPPOSITE_MIN = 2300;       // Vol đối ứng tối thiểu để exit/đảo
const VOL_EXIT_OPPOSITE_MAX = 3200;       // Vol đối ứng tối đa để đảo (trên = chỉ chốt)
const VOL_HOLD_MAX = 1800;                // Xanh đỏ đan xen dưới mức này = giữ lệnh
const VOL_QUIET_THRESHOLD = 1000;         // Dưới 1.000 HĐ và không có biến động = Im lặng
const VOL_ANOMALY_LOW = 1300;             // Cảnh báo "bơm đểu" nếu dưới mức này
const VOL_ANOMALY_MED = 1500;             // Cảnh báo "cân nhắc quan sát"
const VOL_CONSECUTIVE_EXIT_RATIO = 0.9;   // 2-3 cây đối ứng cộng lại >= 90%

// Wick thresholds
const WICK_TRAP_MIN = 1.5;                // Râu >= 1.5đ = Trap
const WICK_ANOMALY_MIN = 2.0;             // Râu >= 2.0đ + vol thấp = Anomaly warning

// Flash Crash thresholds (Cá mập úp bô / Force Sell)
const FLASH_DROP_FAST_PTS = 5.0;          // Tụt >= 5 điểm trong vòng 15 giây
const FLASH_DROP_1M_PTS = 7.0;            // Tụt >= 7 điểm trong vòng 60 giây

// Triple Top Tolerance
const TRIPLE_TOP_TOLERANCE = 3.0;         // Đỉnh 3 chớm vượt đỉnh 1 & 2 từ 1-3đ

// Breakeven
const BREAKEVEN_THRESHOLD = 3.0;          // Lãi >= 3đ → Kích hoạt breakeven

// Technical Indicator Periods
const MA9_PERIOD = 9;
const MA26_PERIOD = 26;
const MA20_PERIOD = 20;
const MA50_PERIOD = 50;
const BB_PERIOD = 20;
const BB_STDDEV = 2;

// Cooldowns
const NOTI_COOLDOWN_MS = 30 * 1000;       // 30s giữa 2 noti thông thường
const ANOMALY_COOLDOWN_MS = 3 * 60 * 1000; // 3 phút giữa 2 cảnh báo anomaly
const FLASH_COOLDOWN_MS = 90 * 1000;      // 90s giữa 2 cảnh báo Flash Crash
const TRIPLE_TOP_COOLDOWN_MS = 15 * 60 * 1000; // 15 phút giữa 2 cảnh báo Triple Top
const SWING_COOLDOWN_MS = 5 * 60 * 1000;  // 5 phút giữa 2 cảnh báo Swing High

// ─── STATE ───────────────────────────────────────────────────
const _state = {
  timer: null,
  fastTimer: null,
  position: 'NONE',              // 'LONG', 'SHORT', 'NONE'
  entryPrice: 0,
  entryTime: '',
  entryIdx: -1,
  entryVol: 0,
  maxProfit: 0,
  breakevenActive: false,
  lastProcessedTimestamp: 0,     // Timestamp nến 1p cuối cùng đã xử lý
  processedCandles: [],          // Lịch sử nến đã xử lý trong ngày
  tradeLog: [],                  // Lịch sử lệnh trong ngày
  priceTicks: [],                // [{ time: ms, price: number }] lưu 70s gần nhất
  lastNotiTime: 0,
  lastAnomalyNotiTime: 0,
  lastMA50AlertTime: 0,
  lastMA20AlertTime: 0,
  lastFlashAlertTime: 0,
  lastTripleTopAlertTime: 0,
  lastSwingAlertTime: 0,
  lastConfirmedPeak: null,       // { time, high, close }
};

// ─── HELPERS ─────────────────────────────────────────────────
function getVnTimeStr() {
  return new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
}

function getVnTimeHHMM() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getVnTimeHHMMSS() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function candleTimeStr(timestamp) {
  const d = new Date(timestamp * 1000);
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return `${String(vn.getHours()).padStart(2, '0')}:${String(vn.getMinutes()).padStart(2, '0')}`;
}

function isTodayCandle(timestamp) {
  const d = new Date(timestamp * 1000);
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return vn.getDate() === now.getDate() && vn.getMonth() === now.getMonth();
}

// ─── INDICATOR CALCULATIONS ──────────────────────────────────
function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function calcBollingerBands(closes, period = BB_PERIOD, stddev = BB_STDDEV) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: Number((sma + stddev * sd).toFixed(1)),
    middle: Number(sma.toFixed(1)),
    lower: Number((sma - stddev * sd).toFixed(1)),
  };
}

/**
 * Phân tích xu hướng MA9 & MA26
 * - MA9 > MA26: Xu hướng Tăng. Giá >= MA9 (sát dải trên) -> Ưu tiên LONG.
 * - MA9 < MA26: Xu hướng Giảm. Giá <= MA9 (sát dải dưới) -> Ưu tiên SHORT.
 */
function getMA9_26Analysis(candle, ma9, ma26) {
  if (!ma9 || !ma26) return null;
  const isUptrend = ma9 > ma26;
  const isDowntrend = ma9 < ma26;
  let bandPos = 'middle';
  let desc = '';

  if (isUptrend) {
    if (candle.close >= ma9) {
      bandPos = 'upper_sat';
      desc = 'Sát dải trên (Ủng hộ LONG)';
    } else if (candle.close >= ma26) {
      bandPos = 'middle';
      desc = 'Nằm giữa MA9 & MA26';
    } else {
      bandPos = 'below';
      desc = 'Dưới MA26 (Suy yếu trend tăng)';
    }
  } else if (isDowntrend) {
    if (candle.close <= ma9) {
      bandPos = 'lower_sat';
      desc = 'Sát dải dưới (Ủng hộ SHORT)';
    } else if (candle.close <= ma26) {
      bandPos = 'middle';
      desc = 'Nằm giữa MA9 & MA26';
    } else {
      bandPos = 'above';
      desc = 'Trên MA26 (Hồi phục trend giảm)';
    }
  }

  return {
    isUptrend,
    isDowntrend,
    bandPos,
    desc,
    text: `${isUptrend ? '🟢 TĂNG (MA9 > MA26)' : '🔴 GIẢM (MA9 < MA26)'} — ${desc}`,
  };
}

// ─── MACD & RSI CALCULATIONS ─────────────────────────────────
function calcEMA(data, period) {
  if (!data || data.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [data.slice(0, period).reduce((s, v) => s + v, 0) / period];
  for (let i = period; i < data.length; i++) {
    ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

function calcMACDSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (!closes || closes.length < slow + signalPeriod) return [];
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + (slow - fast)] - emaSlow[i]);
  }
  if (macdLine.length < signalPeriod) return [];
  const signalLine = calcEMA(macdLine, signalPeriod);
  const result = [];
  for (let i = 0; i < signalLine.length; i++) {
    const m = macdLine[i + (signalPeriod - 1)];
    const s = signalLine[i];
    result.push({
      macd: Number(m.toFixed(2)),
      signal: Number(s.toFixed(2)),
      hist: Number((m - s).toFixed(2)),
    });
  }
  return result;
}

function calcRSISeries(closes, period = 14) {
  if (!closes || closes.length < period + 1) return [];
  const rsi = [];
  for (let i = period + 1; i <= closes.length; i++) {
    const slice = closes.slice(i - (period + 1), i);
    let gains = 0, losses = 0;
    for (let j = 1; j < slice.length; j++) {
      const d = slice[j] - slice[j - 1];
      if (d > 0) gains += d;
      else losses += Math.abs(d);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const val = avgLoss === 0 ? 100 : Number((100 - (100 / (1 + avgGain / avgLoss))).toFixed(1));
    rsi.push(val);
  }
  return rsi;
}

/**
 * Phân tích chuyên sâu MACD:
 * - Hướng lên / hướng xuống
 * - Vùng: Dương dốc lên, Dương dốc xuống, Âm dốc xuống, Âm dốc lên
 * - Phân kỳ âm / dương
 */
function analyzeMACD(closes) {
  const macdList = calcMACDSeries(closes);
  if (!macdList || macdList.length < 2) return null;

  const curM = macdList[macdList.length - 1];
  const prevM = macdList[macdList.length - 2];

  const isSlopeUp = curM.macd > prevM.macd;
  const isPositive = curM.macd >= 0;

  let zoneDesc = '';
  if (isPositive) {
    zoneDesc = isSlopeUp ? '🟢 Dương dốc lên ↗' : '⚠️ Dương dốc xuống ↘';
  } else {
    zoneDesc = isSlopeUp ? '⚡ Âm dốc lên ↗' : '🔴 Âm dốc xuống ↘';
  }

  const directionStr = isSlopeUp ? 'Hướng lên ↗' : (curM.macd < prevM.macd ? 'Hướng xuống ↘' : 'Đi ngang →');

  // Phân kỳ MACD trong 25 nến gần nhất
  let divDesc = 'Không phân kỳ';
  let hasBearishDiv = false;
  let hasBullishDiv = false;

  if (closes.length >= 25 && macdList.length >= 25) {
    const cSlice = closes.slice(-25);
    const mSlice = macdList.slice(-25);
    let maxI1 = 0, maxI2 = 13;
    for (let i = 1; i < 12; i++) if (cSlice[i] > cSlice[maxI1]) maxI1 = i;
    for (let i = 14; i < 25; i++) if (cSlice[i] > cSlice[maxI2]) maxI2 = i;

    if (cSlice[maxI2] >= cSlice[maxI1] + 0.3 && mSlice[maxI2].macd < mSlice[maxI1].macd - 0.1) {
      divDesc = '⚠️ Phân kỳ âm (Đỉnh MACD hạ)';
      hasBearishDiv = true;
    } else {
      let minI1 = 0, minI2 = 13;
      for (let i = 1; i < 12; i++) if (cSlice[i] < cSlice[minI1]) minI1 = i;
      for (let i = 14; i < 25; i++) if (cSlice[i] < cSlice[minI2]) minI2 = i;

      if (cSlice[minI2] <= cSlice[minI1] - 0.3 && mSlice[minI2].macd > mSlice[minI1].macd + 0.1) {
        divDesc = '⚡ Phân kỳ dương (Đáy MACD nâng)';
        hasBullishDiv = true;
      }
    }
  }

  const text = `${zoneDesc} (MACD: <b>${curM.macd >= 0 ? '+' : ''}${curM.macd.toFixed(2)}</b> | Sig: <b>${curM.signal >= 0 ? '+' : ''}${curM.signal.toFixed(2)}</b>) | ${directionStr} | ${divDesc}`;

  return {
    curM,
    prevM,
    isPositive,
    isSlopeUp,
    directionStr,
    zoneDesc,
    divDesc,
    hasBearishDiv,
    hasBullishDiv,
    text,
  };
}

/**
 * Phân tích chuyên sâu RSI:
 * - Hướng lên / hướng xuống
 * - Xung lực: Mạnh / Yếu / Quá mua / Quá bán / Cân bằng
 */
function analyzeRSI(closes) {
  const rsiList = calcRSISeries(closes);
  if (!rsiList || rsiList.length < 2) return null;

  const curRSI = rsiList[rsiList.length - 1];
  const prevRSI = rsiList[rsiList.length - 2];

  const isSlopeUp = curRSI > prevRSI;
  const directionStr = isSlopeUp ? 'Hướng lên ↗' : (curRSI < prevRSI ? 'Hướng xuống ↘' : 'Đi ngang →');

  let momentum = '';
  let isStrong = false;
  let isWeak = false;

  if (curRSI >= 70) {
    momentum = 'Quá Mua (Xung lực Cực Mạnh / Đỉnh cao trào ⚠️)';
    isStrong = true;
  } else if (curRSI >= 60) {
    momentum = isSlopeUp ? 'Xung lực MẠNH (Phe Mua áp đảo 🟢)' : 'Xung lực Khá (Hạ nhiệt ↘)';
    isStrong = isSlopeUp;
  } else if (curRSI > 45) {
    momentum = isSlopeUp ? 'Xung lực Trung bình (Nghiêng Tăng ↗)' : 'Xung lực Trung bình (Nghiêng Giảm ↘)';
  } else if (curRSI > 30) {
    momentum = !isSlopeUp ? 'Xung lực YẾU (Phe Bán áp đảo 🔴)' : 'Xung lực Yếu (Hồi phục nhẹ ↗)';
    isWeak = !isSlopeUp;
  } else {
    momentum = 'Quá Bán (Xung lực Cực Yếu / Đáy cao trào ⚡)';
    isWeak = true;
  }

  const text = `<b>${curRSI.toFixed(1)}</b> | ${directionStr} | ${momentum}`;

  return {
    curRSI,
    prevRSI,
    val: curRSI.toFixed(1),
    isSlopeUp,
    directionStr,
    momentum,
    isStrong,
    isWeak,
    text,
  };
}

// ─── PARSE RAW OHLCV → CANDLE OBJECTS ────────────────────────
function parseCandles(rawData) {
  if (!rawData || !rawData.t || !rawData.c) return [];
  const candles = [];
  for (let i = 0; i < rawData.t.length; i++) {
    if (!isTodayCandle(rawData.t[i])) continue;
    const timeStr = candleTimeStr(rawData.t[i]);
    if (timeStr < '09:00' || timeStr > '14:45') continue;

    const o = rawData.o[i];
    const h = rawData.h[i];
    const l = rawData.l[i];
    const c = rawData.c[i];
    const v = rawData.v[i];
    const isGreen = c >= o;
    const body = Math.abs(c - o);
    const upperWick = h - Math.max(o, c);
    const lowerWick = Math.min(o, c) - l;

    candles.push({
      timestamp: rawData.t[i],
      time: timeStr,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
      isGreen,
      body: Number(body.toFixed(2)),
      upperWick: Number(upperWick.toFixed(2)),
      lowerWick: Number(lowerWick.toFixed(2)),
    });
  }
  return candles;
}

// ─── CORE: XỬ LÝ NẾN MỚI ────────────────────────────────────
async function processNewCandle(candle, allCandles, oiData) {
  const now = Date.now();
  const closes = allCandles.map(c => c.close);

  // Tính các chỉ báo kỹ thuật
  const ma9 = calcSMA(closes, MA9_PERIOD);
  const ma26 = calcSMA(closes, MA26_PERIOD);
  const ma20 = calcSMA(closes, MA20_PERIOD);
  const ma50 = calcSMA(closes, MA50_PERIOD);
  const bb = calcBollingerBands(closes);
  const ma9_26Analysis = getMA9_26Analysis(candle, ma9, ma26);
  const macdAnalysis = analyzeMACD(closes);
  const rsiAnalysis = analyzeRSI(closes);
  const indicators = { ma9, ma26, ma20, ma50, bb, ma9_26Analysis, macdAnalysis, rsiAnalysis };

  // Cập nhật floating profit & breakeven
  if (_state.position === 'LONG') {
    const p = candle.high - _state.entryPrice;
    if (p > _state.maxProfit) _state.maxProfit = p;
    if (p >= BREAKEVEN_THRESHOLD) _state.breakevenActive = true;
  } else if (_state.position === 'SHORT') {
    const p = _state.entryPrice - candle.low;
    if (p > _state.maxProfit) _state.maxProfit = p;
    if (p >= BREAKEVEN_THRESHOLD) _state.breakevenActive = true;
  }

  // ─── CHECK VƯỢT ĐỈNH 3 LẦN THẤT BẠI (TRIPLE TOP FAKEOUT) ──
  const tripleTop = checkTripleTopFakeout(candle, allCandles);
  if (tripleTop) {
    _state.lastTripleTopAlertTime = now;
    if (_state.position === 'LONG') {
      const pnl = candle.close - _state.entryPrice;
      const trade = {
        type: 'LONG',
        entryTime: _state.entryTime,
        entryPrice: _state.entryPrice,
        exitTime: candle.time,
        exitPrice: candle.close,
        pnl: Number(pnl.toFixed(2)),
        reason: `⚠️ Chốt lời: Vượt đỉnh 3 lần thất bại (Triple Top @ ${tripleTop.resistanceLevel.toFixed(1)})`,
        maxProfit: Number(_state.maxProfit.toFixed(2)),
      };
      _state.tradeLog.push(trade);
      _state.position = 'NONE';
    }
    await sendTripleTopWarning(candle, tripleTop, indicators, oiData);
    return;
  }

  // ─── CHECK CẤU TRÚC ĐỈNH SAU VS ĐỈNH TRƯỚC (SWING HIGHS) ─
  await checkSwingHighStructure(candle, allCandles);

  // ─── CHECK ANOMALY WARNING (biến động mạnh + vol thấp) ────
  const maxWick = Math.max(candle.upperWick, candle.lowerWick);
  if (maxWick >= WICK_ANOMALY_MIN && candle.volume < VOL_ANOMALY_LOW && now - _state.lastAnomalyNotiTime > ANOMALY_COOLDOWN_MS) {
    await sendAnomalyWarning(candle, indicators, oiData, 'critical');
    _state.lastAnomalyNotiTime = now;
  } else if (maxWick >= WICK_ANOMALY_MIN && candle.volume >= VOL_ANOMALY_LOW && candle.volume < VOL_ANOMALY_MED && now - _state.lastAnomalyNotiTime > ANOMALY_COOLDOWN_MS) {
    await sendAnomalyWarning(candle, indicators, oiData, 'caution');
    _state.lastAnomalyNotiTime = now;
  }

  // ─── CHECK MA CROSSOVER (3 cây liên tiếp) ────────────────
  await checkMACrossover(allCandles, indicators, oiData);

  // ─── 1. KIỂM TRA EXIT KHI ĐANG CÓ VỊ THẾ ────────────────
  if (_state.position === 'LONG') {
    const exitResult = checkLongExit(candle, allCandles);
    if (exitResult) {
      const pnl = exitResult.exitPrice - _state.entryPrice;
      const trade = {
        type: 'LONG',
        entryTime: _state.entryTime,
        entryPrice: _state.entryPrice,
        exitTime: candle.time,
        exitPrice: exitResult.exitPrice,
        pnl: Number(pnl.toFixed(2)),
        reason: exitResult.reason,
        maxProfit: Number(_state.maxProfit.toFixed(2)),
      };
      _state.tradeLog.push(trade);

      // Bộ lọc Bollinger Bands bảo vệ: Không đảo SHORT nếu giá đã thủng BB Lower
      const isBBLowerBlocked = bb && candle.close < bb.lower;
      // Bộ lọc MA9/26 bảo vệ: Không đảo SHORT nếu MA9 > MA26 và giá còn trên MA26
      const isMAUptrendBlocked = ma9_26Analysis && ma9_26Analysis.isUptrend && ma26 && candle.close > ma26;

      let canReverseToShort = exitResult.shouldReverse && candle.time <= STOP_ENTRY_TIME;
      if (canReverseToShort && isBBLowerBlocked) {
        trade.reason += ` (🚫 BB Lower ${bb.lower} chặn đảo Short — Cấm đuổi đáy)`;
        canReverseToShort = false;
      }
      if (canReverseToShort && isMAUptrendBlocked) {
        trade.reason += ` (🚫 MA9/26 Uptrend chặn đảo Short)`;
        canReverseToShort = false;
      }

      if (canReverseToShort) {
        // ĐẢO LỆNH → SHORT
        await sendSignalNoti('CLOSE_LONG_REVERSE_SHORT', candle, trade, indicators, oiData);
        _state.position = 'SHORT';
        _state.entryPrice = candle.close;
        _state.entryTime = candle.time;
        _state.entryIdx = allCandles.length - 1;
        _state.entryVol = candle.volume;
        _state.maxProfit = 0;
        _state.breakevenActive = false;
      } else {
        await sendSignalNoti('CLOSE_LONG', candle, trade, indicators, oiData);
        _state.position = 'NONE';
      }
      return;
    }
  } else if (_state.position === 'SHORT') {
    const exitResult = checkShortExit(candle, allCandles);
    if (exitResult) {
      const pnl = _state.entryPrice - exitResult.exitPrice;
      const trade = {
        type: 'SHORT',
        entryTime: _state.entryTime,
        entryPrice: _state.entryPrice,
        exitTime: candle.time,
        exitPrice: exitResult.exitPrice,
        pnl: Number(pnl.toFixed(2)),
        reason: exitResult.reason,
        maxProfit: Number(_state.maxProfit.toFixed(2)),
      };
      _state.tradeLog.push(trade);

      // Bộ lọc Bollinger Bands bảo vệ: Không đảo LONG nếu giá đã vượt BB Upper
      const isBBUpperBlocked = bb && candle.close > bb.upper;
      // Bộ lọc MA9/26 bảo vệ: Không đảo LONG nếu MA9 < MA26 và giá còn dưới MA26
      const isMADowntrendBlocked = ma9_26Analysis && ma9_26Analysis.isDowntrend && ma26 && candle.close < ma26;

      let canReverseToLong = exitResult.shouldReverse && candle.time <= STOP_ENTRY_TIME;
      if (canReverseToLong && isBBUpperBlocked) {
        trade.reason += ` (🚫 BB Upper ${bb.upper} chặn đảo Long — Cấm đuổi đỉnh)`;
        canReverseToLong = false;
      }
      if (canReverseToLong && isMADowntrendBlocked) {
        trade.reason += ` (🚫 MA9/26 Downtrend chặn đảo Long)`;
        canReverseToLong = false;
      }

      if (canReverseToLong) {
        await sendSignalNoti('CLOSE_SHORT_REVERSE_LONG', candle, trade, indicators, oiData);
        _state.position = 'LONG';
        _state.entryPrice = candle.close;
        _state.entryTime = candle.time;
        _state.entryIdx = allCandles.length - 1;
        _state.entryVol = candle.volume;
        _state.maxProfit = 0;
        _state.breakevenActive = false;
      } else {
        await sendSignalNoti('CLOSE_SHORT', candle, trade, indicators, oiData);
        _state.position = 'NONE';
      }
      return;
    }
  }

  // ─── 2. KIỂM TRA ENTRY KHI ĐANG NONE ─────────────────────
  if (_state.position === 'NONE' && candle.time >= START_TIME && candle.time <= STOP_ENTRY_TIME) {
    // Cấm FOMO khi nổ vol quá lớn (> 2.800 HĐ)
    if (candle.volume > VOL_FOMO) {
      if (now - _state.lastNotiTime > NOTI_COOLDOWN_MS) {
        await sendFomoWarning(candle, indicators, oiData);
        _state.lastNotiTime = now;
      }
      return;
    }

    // Vùng vào lệnh chuẩn: 2.300 - 2.800 HĐ
    if (candle.volume >= VOL_ENTRY_MIN && candle.volume <= VOL_ENTRY_MAX) {
      // A. Lọc trap râu nến
      if (candle.isGreen && candle.upperWick >= WICK_TRAP_MIN && candle.upperWick > candle.body) {
        console.log(`   🚫 [Scalper] Lọc Bull Trap ${candle.time}: UpWick ${candle.upperWick}đ > Body ${candle.body}đ`);
        return;
      }
      if (!candle.isGreen && candle.lowerWick >= WICK_TRAP_MIN && candle.lowerWick > candle.body) {
        console.log(`   🚫 [Scalper] Lọc Bear Trap ${candle.time}: LowWick ${candle.lowerWick}đ > Body ${candle.body}đ`);
        return;
      }

      // B. Lọc Bollinger Bands
      if (bb) {
        if (candle.isGreen && candle.close > bb.upper) {
          console.log(`   🚫 [Scalper] Chặn LONG ${candle.time}: Giá ${candle.close} > BB Upper ${bb.upper} → Cấm đuổi đỉnh`);
          if (now - _state.lastNotiTime > NOTI_COOLDOWN_MS) {
            await sendBBBlockWarning(candle, indicators, oiData, 'LONG');
            _state.lastNotiTime = now;
          }
          return;
        }
        if (!candle.isGreen && candle.close < bb.lower) {
          console.log(`   🚫 [Scalper] Chặn SHORT ${candle.time}: Giá ${candle.close} < BB Lower ${bb.lower} → Cấm đuổi đáy`);
          if (now - _state.lastNotiTime > NOTI_COOLDOWN_MS) {
            await sendBBBlockWarning(candle, indicators, oiData, 'SHORT');
            _state.lastNotiTime = now;
          }
          return;
        }
      }

      // C. Lọc MA9 & MA26 Trend
      if (ma9_26Analysis) {
        if (candle.isGreen && ma9_26Analysis.isDowntrend && ma26 && candle.close < ma26) {
          console.log(`   🚫 [Scalper] Chặn LONG ${candle.time}: Ngược xu hướng MA9 < MA26 (Downtrend)`);
          if (now - _state.lastNotiTime > NOTI_COOLDOWN_MS) {
            await sendMA9_26BlockWarning(candle, indicators, oiData, 'LONG');
            _state.lastNotiTime = now;
          }
          return;
        }
        if (!candle.isGreen && ma9_26Analysis.isUptrend && ma26 && candle.close > ma26) {
          console.log(`   🚫 [Scalper] Chặn SHORT ${candle.time}: Ngược xu hướng MA9 > MA26 (Uptrend)`);
          if (now - _state.lastNotiTime > NOTI_COOLDOWN_MS) {
            await sendMA9_26BlockWarning(candle, indicators, oiData, 'SHORT');
            _state.lastNotiTime = now;
          }
          return;
        }
      }

      // Mở vị thế
      _state.position = candle.isGreen ? 'LONG' : 'SHORT';
      _state.entryPrice = candle.close;
      _state.entryTime = candle.time;
      _state.entryIdx = allCandles.length - 1;
      _state.entryVol = candle.volume;
      _state.maxProfit = 0;
      _state.breakevenActive = false;

      await sendSignalNoti('ENTRY', candle, null, indicators, oiData);
      _state.lastNotiTime = now;
    }
  }
}

// ─── EXIT CHECK: LONG ────────────────────────────────────────
function checkLongExit(candle, allCandles) {
  const idx = allCandles.length - 1;

  // A. Breakeven
  if (_state.breakevenActive && candle.close <= _state.entryPrice) {
    return { exitPrice: _state.entryPrice, reason: `🛡️ Breakeven hòa vốn (từng lãi +${_state.maxProfit.toFixed(1)}đ)`, shouldReverse: false };
  }

  // B. Cây đối ứng ĐỎ 2.3k - 3.2k → Exit và kiểm tra đảo
  if (!candle.isGreen && candle.volume >= VOL_EXIT_OPPOSITE_MIN && candle.volume <= VOL_EXIT_OPPOSITE_MAX) {
    const isBearTrap = candle.lowerWick >= WICK_TRAP_MIN && candle.lowerWick > candle.body;
    return {
      exitPrice: candle.close,
      reason: `🔴 Cây đối ứng ĐỎ nổ vol ${candle.volume.toLocaleString()} HĐ${isBearTrap ? ' (Bear Trap — CHỈ ĐÓNG, KHÔNG ĐẢO)' : ' → ĐẢO SHORT'}`,
      shouldReverse: !isBearTrap,
    };
  }

  // C. Climax Long > 3k (chốt lời đỉnh cao trào)
  if (candle.isGreen && candle.volume > VOL_CLIMAX) {
    const hasLongWick = candle.upperWick >= 1.0;
    return {
      exitPrice: candle.close,
      reason: `🔥 Nổ vol Long Climax ${candle.volume.toLocaleString()} HĐ${hasLongWick ? ' + Rút râu trên ' + candle.upperWick + 'đ → Cân nhắc ĐẢO SHORT' : ' → Chốt lời'}`,
      shouldReverse: hasLongWick,
    };
  }

  // D. Bull trap rút râu trên dài (cùng chiều)
  if (candle.isGreen && candle.upperWick >= WICK_TRAP_MIN && candle.upperWick >= candle.body) {
    return {
      exitPrice: candle.close,
      reason: `⚠️ Bull trap rút râu trên ${candle.upperWick}đ (Body: ${candle.body}đ) → Chốt lời, cân nhắc đảo SHORT`,
      shouldReverse: false,
    };
  }

  // E. 2-3 cây đỏ liên tiếp cộng lại >= 90% vol entry (chỉ khi chưa breakeven)
  if (!_state.breakevenActive && idx - _state.entryIdx >= 2 && idx - _state.entryIdx <= 3) {
    let redVolSum = 0;
    for (let k = _state.entryIdx + 1; k <= idx; k++) {
      if (!allCandles[k].isGreen) redVolSum += allCandles[k].volume;
    }
    if (redVolSum >= VOL_CONSECUTIVE_EXIT_RATIO * _state.entryVol) {
      return {
        exitPrice: candle.close,
        reason: `📊 2-3 cây đỏ cộng lại ${redVolSum.toLocaleString()} HĐ (≥ 90% cây vào ${_state.entryVol.toLocaleString()})`,
        shouldReverse: false,
      };
    }
  }

  // F. Hết phiên
  if (candle.time >= '14:28') {
    return { exitPrice: candle.close, reason: `⏰ Hết phiên giao dịch`, shouldReverse: false };
  }

  return null; // Giữ lệnh
}

// ─── EXIT CHECK: SHORT ───────────────────────────────────────
function checkShortExit(candle, allCandles) {
  const idx = allCandles.length - 1;

  // A. Breakeven
  if (_state.breakevenActive && candle.close >= _state.entryPrice) {
    return { exitPrice: _state.entryPrice, reason: `🛡️ Breakeven hòa vốn (từng lãi +${_state.maxProfit.toFixed(1)}đ)`, shouldReverse: false };
  }

  // B. Cây đối ứng XANH 2.3k - 3.2k → Exit và kiểm tra đảo
  if (candle.isGreen && candle.volume >= VOL_EXIT_OPPOSITE_MIN && candle.volume <= VOL_EXIT_OPPOSITE_MAX) {
    const isBullTrap = candle.upperWick >= WICK_TRAP_MIN && candle.upperWick > candle.body;
    return {
      exitPrice: candle.close,
      reason: `🟢 Cây đối ứng XANH nổ vol ${candle.volume.toLocaleString()} HĐ${isBullTrap ? ' (Bull Trap — CHỈ ĐÓNG, KHÔNG ĐẢO)' : ' → ĐẢO LONG'}`,
      shouldReverse: !isBullTrap,
    };
  }

  // C. Climax Short > 3k
  if (!candle.isGreen && candle.volume > VOL_CLIMAX) {
    const hasLongWick = candle.lowerWick >= 1.0;
    return {
      exitPrice: candle.close,
      reason: `🔥 Nổ vol Short Climax ${candle.volume.toLocaleString()} HĐ${hasLongWick ? ' + Rút râu dưới ' + candle.lowerWick + 'đ → Cân nhắc ĐẢO LONG' : ' → Chốt lời'}`,
      shouldReverse: hasLongWick,
    };
  }

  // D. Nến đỏ rút râu dưới nhanh (bear trap cùng chiều)
  if (!candle.isGreen && candle.lowerWick >= WICK_TRAP_MIN && candle.lowerWick >= candle.body) {
    return {
      exitPrice: candle.close,
      reason: `⚠️ Bear trap rút râu dưới ${candle.lowerWick}đ (Body: ${candle.body}đ) → Chốt lời, cân nhắc đảo LONG`,
      shouldReverse: false,
    };
  }

  // E. 2-3 cây xanh liên tiếp cộng lại >= 90%
  if (!_state.breakevenActive && idx - _state.entryIdx >= 2 && idx - _state.entryIdx <= 3) {
    let greenVolSum = 0;
    for (let k = _state.entryIdx + 1; k <= idx; k++) {
      if (allCandles[k].isGreen) greenVolSum += allCandles[k].volume;
    }
    if (greenVolSum >= VOL_CONSECUTIVE_EXIT_RATIO * _state.entryVol) {
      return {
        exitPrice: candle.close,
        reason: `📊 2-3 cây xanh cộng lại ${greenVolSum.toLocaleString()} HĐ (≥ 90% cây vào ${_state.entryVol.toLocaleString()})`,
        shouldReverse: false,
      };
    }
  }

  // F. Hết phiên
  if (candle.time >= '14:28') {
    return { exitPrice: candle.close, reason: `⏰ Hết phiên giao dịch`, shouldReverse: false };
  }

  return null;
}

// ─── CHECK VƯỢT ĐỈNH 3 LẦN THẤT BẠI (TRIPLE TOP FAKEOUT) ─────
function checkTripleTopFakeout(candle, allCandles) {
  if (allCandles.length < 15) return null;
  const now = Date.now();
  if (now - _state.lastTripleTopAlertTime < TRIPLE_TOP_COOLDOWN_MS) return null;

  // Tìm các đỉnh swing trước đó trong ngày
  const peaks = [];
  for (let i = 2; i < allCandles.length - 1; i++) {
    const c = allCandles[i];
    if (c.high >= allCandles[i - 1].high && c.high >= allCandles[i - 2].high &&
        c.high >= allCandles[i + 1].high && c.volume >= 600) {
      peaks.push({ idx: i, time: c.time, high: c.high, close: c.close });
    }
  }

  if (peaks.length < 2) return null;

  const p1 = peaks[peaks.length - 2];
  const p2 = peaks[peaks.length - 1];

  // 2 đỉnh trước phải cách nhau ít nhất 5 phút và cùng vùng giá (chênh <= 2.5đ)
  if (Math.abs(p1.high - p2.high) > 2.5 || (p2.idx - p1.idx < 5)) return null;

  const resistanceLevel = Math.max(p1.high, p2.high);

  // Đỉnh 3 là nến hiện tại: test vùng kháng cự (chênh lệch trong khoảng -0.5đ đến +3.0đ)
  const diffFromRes = candle.high - resistanceLevel;
  if (diffFromRes >= -0.5 && diffFromRes <= TRIPLE_TOP_TOLERANCE) {
    const hasLongWick = candle.upperWick >= 1.5 || (candle.upperWick >= 1.0 && candle.upperWick > candle.body);
    const closedBelow = candle.close <= resistanceLevel + 0.5;

    if (hasLongWick && closedBelow) {
      return {
        p1,
        p2,
        p3: { time: candle.time, high: candle.high, close: candle.close, upperWick: candle.upperWick },
        resistanceLevel,
      };
    }
  }
  return null;
}

// ─── CHECK CẤU TRÚC ĐỈNH SAU VS ĐỈNH TRƯỚC (HIGHER / LOWER HIGH) ──
async function checkSwingHighStructure(candle, allCandles) {
  if (allCandles.length < 5) return;
  const idx = allCandles.length - 1;

  // Kiểm tra nến áp chót (idx - 1) có phải đỉnh swing cục bộ được xác nhận không
  const prevC = allCandles[idx - 1];
  const prePrevC = allCandles[idx - 2];

  if (prevC.high > prePrevC.high && prevC.high > candle.high && prevC.volume >= 800) {
    const newPeak = { time: prevC.time, high: prevC.high, close: prevC.close };

    if (_state.lastConfirmedPeak && _state.lastConfirmedPeak.time !== newPeak.time) {
      const diff = newPeak.high - _state.lastConfirmedPeak.high;
      const now = Date.now();

      if (diff <= -0.5 && now - _state.lastSwingAlertTime > SWING_COOLDOWN_MS) {
        // Đỉnh sau THẤP HƠN đỉnh trước (Lower High)
        _state.lastSwingAlertTime = now;
        let msg = `📉 <b>[CẤU TRÚC THỊ TRƯỜNG] ĐỈNH SAU THẤP HƠN ĐỈNH TRƯỚC (Lower High)</b>\n`;
        msg += `🕐 ${getVnTimeHHMMSS()} | F1M: <b>${candle.close.toFixed(1)}</b>\n`;
        msg += `⛰️ Đỉnh mới: <b>${newPeak.high.toFixed(1)}</b> (${newPeak.time}) < Đỉnh cũ: <b>${_state.lastConfirmedPeak.high.toFixed(1)}</b> (${_state.lastConfirmedPeak.time}) [${diff.toFixed(1)}đ]\n\n`;
        msg += `💡 <i>Phe Bán đang ép đỉnh thấp dần. Cân nhắc chốt LONG / Đứng ngoài / Tìm điểm SHORT!</i>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `<i>🔮 Volume Scalper v5.1</i>`;
        await sendDerivativesMessage(msg);
      } else if (diff >= 0.5 && _state.position === 'LONG' && now - _state.lastSwingAlertTime > SWING_COOLDOWN_MS) {
        // Đỉnh sau CAO HƠN đỉnh trước (Higher High) -> GIỮ LONG
        _state.lastSwingAlertTime = now;
        let msg = `📈 <b>[CẤU TRÚC THỊ TRƯỜNG] ĐỈNH SAU CAO HƠN ĐỈNH TRƯỚC (Higher High)</b>\n`;
        msg += `🕐 ${getVnTimeHHMMSS()} | F1M: <b>${candle.close.toFixed(1)}</b>\n`;
        msg += `⛰️ Đỉnh mới: <b>${newPeak.high.toFixed(1)}</b> (${newPeak.time}) > Đỉnh cũ: <b>${_state.lastConfirmedPeak.high.toFixed(1)}</b> (${_state.lastConfirmedPeak.time}) [+${diff.toFixed(1)}đ]\n\n`;
        msg += `💡 <i>Cấu trúc Uptrend tiếp diễn vững chắc → <b>TIẾP TỤC GIỮ VỊ THẾ LONG!</b></i>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `<i>🔮 Volume Scalper v5.1</i>`;
        await sendDerivativesMessage(msg);
      }
    }
    _state.lastConfirmedPeak = newPeak;
  }
}

// ─── CHECK MA CROSSOVER (3 CÂY LIÊN TIẾP) ───────────────────
async function checkMACrossover(allCandles, indicators, oiData) {
  if (allCandles.length < 3) return;
  const now = Date.now();
  const last3 = allCandles.slice(-3);

  const allGreen = last3.every(c => c.isGreen);
  const allRed = last3.every(c => !c.isGreen);
  if (!allGreen && !allRed) return;

  const direction = allGreen ? 'LONG' : 'SHORT';
  const avgVol = last3.reduce((s, c) => s + c.volume, 0) / 3;
  if (avgVol < 800) return;

  const latestClose = last3[last3.length - 1].close;

  // MA50 crossover
  if (indicators.ma50 && now - _state.lastMA50AlertTime > 10 * 60 * 1000) {
    const prevClose = allCandles[allCandles.length - 4] ? allCandles[allCandles.length - 4].close : null;
    if (prevClose) {
      const crossedAbove = prevClose <= indicators.ma50 && latestClose > indicators.ma50;
      const crossedBelow = prevClose >= indicators.ma50 && latestClose < indicators.ma50;
      if (crossedAbove || crossedBelow) {
        const crossDir = crossedAbove ? '📈 Vượt lên' : '📉 Phá xuống';
        let msg = `📊 <b>3 CÂY ${direction} LIÊN TIẾP — ${crossDir} MA50</b>\n`;
        msg += `🕐 ${getVnTimeHHMMSS()} | Avg Vol: ${Math.round(avgVol).toLocaleString()} HĐ\n`;
        msg += `💹 F1M: <b>${latestClose.toFixed(1)}</b> | MA50: ${indicators.ma50.toFixed(1)}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `💡 <i>Cân nhắc ${crossedAbove ? 'LONG' : 'SHORT'} / Đứng ngoài / Chốt lời</i>\n`;
        msg += `<i>🔮 Volume Scalper v5.1</i>`;
        await sendDerivativesMessage(msg);
        _state.lastMA50AlertTime = now;
      }
    }
  }

  // MA20 crossover
  if (indicators.ma20 && now - _state.lastMA20AlertTime > 10 * 60 * 1000) {
    const prevClose = allCandles[allCandles.length - 4] ? allCandles[allCandles.length - 4].close : null;
    if (prevClose) {
      const crossedAbove = prevClose <= indicators.ma20 && latestClose > indicators.ma20;
      const crossedBelow = prevClose >= indicators.ma20 && latestClose < indicators.ma20;
      if (crossedAbove || crossedBelow) {
        const crossDir = crossedAbove ? '📈 Vượt lên' : '📉 Phá xuống';
        let msg = `📊 <b>3 CÂY ${direction} LIÊN TIẾP — ${crossDir} MA20</b>\n`;
        msg += `🕐 ${getVnTimeHHMMSS()} | Avg Vol: ${Math.round(avgVol).toLocaleString()} HĐ\n`;
        msg += `💹 F1M: <b>${latestClose.toFixed(1)}</b> | MA20: ${indicators.ma20.toFixed(1)}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `💡 <i>Cân nhắc ${crossedAbove ? 'LONG' : 'SHORT'} / Đứng ngoài / Chốt lời</i>\n`;
        msg += `<i>🔮 Volume Scalper v5.1</i>`;
        await sendDerivativesMessage(msg);
        _state.lastMA20AlertTime = now;
      }
    }
  }
}

// ─── FAST TICK CYCLE: BẮT FLASH CRASH / CÁ MẬP ÚP BÔ (MỖI 5 GIÂY) ──
async function fastTickCycle() {
  if (!isCurrentInstanceActive()) return;
  if (!dataFetcher.isMarketHours()) return;

  const currentTime = getVnTimeHHMM();
  if (currentTime < '09:00' || currentTime > '14:35') return;

  try {
    const futuresPrice = await dataFetcher.fetchRealtimeFuturesPrice();
    if (!futuresPrice || !futuresPrice.price) return;

    const currentPrice = futuresPrice.price;
    const now = Date.now();

    _state.priceTicks.push({ time: now, price: currentPrice });

    // Giữ tick trong vòng 70 giây gần nhất
    const cutoff = now - 70 * 1000;
    _state.priceTicks = _state.priceTicks.filter(t => t.time >= cutoff);

    if (_state.priceTicks.length < 2) return;

    // Tìm giá cao nhất trong 15s và 60s
    const ticks15s = _state.priceTicks.filter(t => t.time >= now - 15 * 1000);
    const ticks60s = _state.priceTicks;

    const maxPrice15s = Math.max(...ticks15s.map(t => t.price));
    const maxPrice60s = Math.max(...ticks60s.map(t => t.price));

    const drop15s = maxPrice15s - currentPrice;
    const drop60s = maxPrice60s - currentPrice;

    const isFastDrop = drop15s >= FLASH_DROP_FAST_PTS;
    const is1mDrop = drop60s >= FLASH_DROP_1M_PTS;

    if ((isFastDrop || is1mDrop) && (now - _state.lastFlashAlertTime > FLASH_COOLDOWN_MS)) {
      _state.lastFlashAlertTime = now;
      const dropPts = isFastDrop ? drop15s : drop60s;
      const dropWindow = isFastDrop ? '15 giây' : '60 giây';
      const fromPrice = isFastDrop ? maxPrice15s : maxPrice60s;
      const isAfter14h = currentTime >= '14:00';

      const wasLong = _state.position === 'LONG';
      if (wasLong) {
        // TỰ ĐỘNG THOÁT KHẨN CẤP VỊ THẾ LONG ĐỂ BẢO VỆ TÀI KHOẢN
        const pnl = currentPrice - _state.entryPrice;
        const trade = {
          type: 'LONG',
          entryTime: _state.entryTime,
          entryPrice: _state.entryPrice,
          exitTime: getVnTimeHHMMSS(),
          exitPrice: currentPrice,
          pnl: Number(pnl.toFixed(2)),
          reason: `🚨 THOÁT KHẨN CẤP: Flash Crash / Cá mập úp bô đạp -${dropPts.toFixed(1)}đ`,
          maxProfit: Number(_state.maxProfit.toFixed(2)),
        };
        _state.tradeLog.push(trade);
        _state.position = 'NONE';
      }

      // Đính kèm chỉ báo MACD & RSI nếu có dữ liệu
      let indicators = null;
      if (_state.processedCandles && _state.processedCandles.length >= 26) {
        const cArr = _state.processedCandles.map(c => c.close);
        const macdAnalysis = analyzeMACD(cArr);
        const rsiAnalysis = analyzeRSI(cArr);
        indicators = { macdAnalysis, rsiAnalysis };
      }

      await sendFlashCrashWarning(currentPrice, dropPts, dropWindow, fromPrice, isAfter14h, wasLong, indicators);
    }
  } catch (e) {
    // Fast tick error silently
  }
}

// ─── BUILD NOTIFICATION BLOCKS ──────────────────────────────
function buildIndicatorBlock(indicators) {
  if (!indicators) return '';
  let block = '';
  if (indicators.ma9 && indicators.ma26) {
    block += `MA9: ${indicators.ma9.toFixed(1)} | MA26: ${indicators.ma26.toFixed(1)}`;
  }
  if (indicators.ma20) block += ` | MA20: ${indicators.ma20.toFixed(1)}`;
  if (indicators.ma50) block += ` | MA50: ${indicators.ma50.toFixed(1)}`;
  if (indicators.ma9_26Analysis) {
    block += `\n   Xu hướng MA9/26: <b>${indicators.ma9_26Analysis.text}</b>`;
  }
  if (indicators.bb) {
    block += `\n   BB: ↑${indicators.bb.upper} | Mid ${indicators.bb.middle} | ↓${indicators.bb.lower}`;
  }
  if (indicators.macdAnalysis) {
    block += `\n   🌊 <b>MACD:</b> ${indicators.macdAnalysis.text}`;
  }
  if (indicators.rsiAnalysis) {
    block += `\n   ⚡ <b>RSI(14):</b> ${indicators.rsiAnalysis.text}`;
  }
  return block;
}

function buildOIBlock(oiData) {
  if (!oiData) return '';
  let block = '';
  if (oiData.foreignBuy !== undefined) {
    const fnNet = oiData.foreignBuy - oiData.foreignSell;
    block += `NN Mua: ${oiData.foreignBuy.toLocaleString()} | NN Bán: ${oiData.foreignSell.toLocaleString()} | Net: <b>${fnNet >= 0 ? '+' : ''}${fnNet.toLocaleString()} HĐ</b> (${fnNet > 0 ? 'Long ròng' : 'Short ròng'})`;

    const tdEst = oiEstimator.estimateTuDoanh(fnNet, oiData.tuDoanhNet || 0);
    const tdNet = tdEst.value;
    const crowdNet = -(fnNet + tdNet);
    block += `\n   Tự doanh${tdEst.isEstimated ? ' (ước tính)' : ''}: <b>${tdNet >= 0 ? '+' : ''}${tdNet.toLocaleString()} HĐ</b> | Đám đông: <b>${crowdNet >= 0 ? '+' : ''}${crowdNet.toLocaleString()} HĐ</b>`;
  }
  if (oiData.totalVolume) {
    block += `\n   Tổng Vol PS: ${oiData.totalVolume.toLocaleString()} HĐ`;
  }
  if (oiData.totalOI) {
    block += ` | OI: ${oiData.totalOI.toLocaleString()} HĐ`;
  }
  return block;
}

function buildPositionBlock() {
  if (_state.position === 'NONE') return '🔘 Không có vị thế';
  const dir = _state.position === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const lastC = _state.processedCandles.length > 0 ? _state.processedCandles[_state.processedCandles.length - 1] : null;
  const floatingPnl = _state.position === 'LONG'
    ? (lastC ? lastC.close - _state.entryPrice : 0)
    : (lastC ? _state.entryPrice - lastC.close : 0);
  let block = `${dir} @ ${_state.entryPrice.toFixed(1)} (Entry: ${_state.entryTime})`;
  block += `\n   Floating: ${floatingPnl >= 0 ? '+' : ''}${floatingPnl.toFixed(1)}đ | Max: +${_state.maxProfit.toFixed(1)}đ`;
  block += `\n   Breakeven: ${_state.breakevenActive ? '✅ Kích hoạt' : '❌ Chưa'}`;
  return block;
}

function buildDayPnL() {
  if (_state.tradeLog.length === 0) return '';
  const totalPnl = _state.tradeLog.reduce((s, t) => s + t.pnl, 0);
  const wins = _state.tradeLog.filter(t => t.pnl > 0).length;
  const losses = _state.tradeLog.filter(t => t.pnl < 0).length;
  return `📊 Hôm nay: ${_state.tradeLog.length} lệnh (${wins}W/${losses}L) | PnL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}đ</b>`;
}

// ─── SEND NOTIFICATIONS ──────────────────────────────────────
async function sendSignalNoti(signalType, candle, trade, indicators, oiData) {
  const isEntry = signalType === 'ENTRY';
  const isReverse = signalType.includes('REVERSE');

  let emoji = '🔮';
  let action = '';
  if (isEntry) {
    emoji = _state.position === 'LONG' ? '🟢' : '🔴';
    action = `MỞ ${_state.position} @ ${_state.entryPrice.toFixed(1)}`;
  } else if (isReverse) {
    emoji = '🔄';
    const newPos = signalType.includes('REVERSE_LONG') ? 'LONG' : 'SHORT';
    action = `ĐÓNG ${trade.type} (${trade.pnl >= 0 ? '+' : ''}${trade.pnl}đ) → ĐẢO ${newPos} @ ${candle.close.toFixed(1)}`;
  } else {
    emoji = trade && trade.pnl >= 0 ? '✅' : '❌';
    action = `ĐÓNG ${trade.type} @ ${trade.exitPrice.toFixed(1)} (${trade.pnl >= 0 ? '+' : ''}${trade.pnl}đ)`;
  }

  let msg = `${emoji} <b>[VN30F v5.1] ${action}</b>\n`;
  msg += `🕐 <b>${getVnTimeHHMMSS()}</b> (Nến ${candle.time}) | F1M: <b>${candle.close.toFixed(1)}</b>\n\n`;

  // Nến trigger
  msg += `📊 <b>Nến ${candle.time}:</b>\n`;
  msg += `   ${candle.isGreen ? '🟢' : '🔴'} Vol: <b>${candle.volume.toLocaleString()} HĐ</b> | O:${candle.open.toFixed(1)} C:${candle.close.toFixed(1)}\n`;
  msg += `   Body: ${candle.body}đ | Râu ↑${candle.upperWick}đ ↓${candle.lowerWick}đ\n\n`;

  // OI & Thanh khoản
  const oiBlock = buildOIBlock(oiData);
  if (oiBlock) {
    msg += `💰 <b>Thanh khoản:</b>\n   ${oiBlock}\n\n`;
  }

  // Indicators
  msg += `📈 <b>Chỉ báo:</b>\n   ${buildIndicatorBlock(indicators)}\n\n`;

  // Xác nhận Xung Lực Đồng Thuận MACD + RSI
  if (indicators && indicators.macdAnalysis && indicators.rsiAnalysis) {
    const isLongConf = indicators.macdAnalysis.isSlopeUp && indicators.rsiAnalysis.isSlopeUp;
    const isShortConf = !indicators.macdAnalysis.isSlopeUp && !indicators.rsiAnalysis.isSlopeUp;
    if (_state.position === 'LONG') {
      msg += `🎯 <b>Xác nhận Xung Lực:</b> ${isLongConf ? '✅ MACD & RSI đều hướng lên dốc mạnh → Ủng hộ LONG vững chắc' : '⚠️ Xung lực có dấu hiệu phân hóa, quan sát chặt chẽ'}\n\n`;
    } else if (_state.position === 'SHORT') {
      msg += `🎯 <b>Xác nhận Xung Lực:</b> ${isShortConf ? '✅ MACD & RSI đều cắm đầu dốc xuống → Ủng hộ SHORT vững chắc' : '⚠️ Xung lực có dấu hiệu phân hóa, quan sát chặt chẽ'}\n\n`;
    }
  }

  // Vị thế
  msg += `📋 <b>Vị thế:</b> ${buildPositionBlock()}\n`;

  // Lý do exit
  if (trade && trade.reason) {
    msg += `\n💡 <b>Lý do:</b> ${trade.reason}\n`;
  }

  // Day PnL
  const dayPnl = buildDayPnL();
  if (dayPnl) {
    msg += `\n${dayPnl}\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 Volume Scalper v5.1 | VN Stock Bot</i>`;

  await sendDerivativesMessage(msg);
}

async function sendFomoWarning(candle, indicators, oiData) {
  let msg = `⛔ <b>[VN30F v5.1] CẤM FOMO — Vol ${candle.volume.toLocaleString()} HĐ</b>\n`;
  msg += `🕐 <b>${getVnTimeHHMMSS()}</b> (Nến ${candle.time}) | ${candle.isGreen ? '🟢 XANH' : '🔴 ĐỎ'} | F1M: <b>${candle.close.toFixed(1)}</b>\n`;
  msg += `   Body: ${candle.body}đ | Râu ↑${candle.upperWick}đ ↓${candle.lowerWick}đ\n\n`;
  msg += `💡 <i>Vol > ${VOL_FOMO.toLocaleString()} HĐ → Tuyệt đối KHÔNG vào lệnh FOMO!</i>\n\n`;
  msg += `📈 <b>Chỉ báo:</b>\n   ${buildIndicatorBlock(indicators)}\n\n`;
  msg += `📋 Vị thế: ${buildPositionBlock()}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 Volume Scalper v5.1</i>`;
  await sendDerivativesMessage(msg);
}

async function sendAnomalyWarning(candle, indicators, oiData, severity) {
  const isCritical = severity === 'critical';
  let msg = `${isCritical ? '🚨' : '⚠️'} <b>[VN30F v5.1] ${isCritical ? 'BƠM ĐỂU GÂY NHIỄU' : 'CÂN NHẮC QUAN SÁT'}</b>\n`;
  msg += `🕐 <b>${getVnTimeHHMMSS()}</b> (Nến ${candle.time}) | ${candle.isGreen ? '🟢' : '🔴'} | F1M: <b>${candle.close.toFixed(1)}</b>\n`;
  msg += `   Vol: <b>${candle.volume.toLocaleString()} HĐ</b> (thấp!) | Râu ↑${candle.upperWick}đ ↓${candle.lowerWick}đ\n\n`;
  msg += `📈 <b>Chỉ báo:</b>\n   ${buildIndicatorBlock(indicators)}\n\n`;

  if (_state.position !== 'NONE') {
    msg += `📋 Đang cầm ${_state.position} @ ${_state.entryPrice.toFixed(1)}\n`;
    msg += `💡 <i>Quan sát, KHÔNG vội đảo/đóng. Vol quá thấp = Nhiễu!</i>\n`;
  } else {
    msg += `💡 <i>KHÔNG có lệnh → Tuyệt đối KHÔNG FOMO nến bơm đểu này!</i>\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 Volume Scalper v5.1</i>`;
  await sendDerivativesMessage(msg);
}

async function sendBBBlockWarning(candle, indicators, oiData, blockedDir) {
  const bb = indicators ? indicators.bb : null;
  let msg = `🚧 <b>[VN30F v5.1] BOLLINGER CHẶN ${blockedDir}</b>\n`;
  msg += `🕐 <b>${getVnTimeHHMMSS()}</b> (Nến ${candle.time}) | Vol: ${candle.volume.toLocaleString()} HĐ | F1M: ${candle.close.toFixed(1)}\n`;
  if (bb) msg += `   BB Upper: ${bb.upper} | BB Lower: ${bb.lower}\n\n`;
  msg += `📈 <b>Chỉ báo:</b>\n   ${buildIndicatorBlock(indicators)}\n\n`;
  msg += `💡 <i>Giá ${blockedDir === 'LONG' ? 'trên đỉnh BB → Cấm đuổi LONG' : 'dưới đáy BB → Cấm đuổi SHORT'}!</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 Volume Scalper v5.1</i>`;
  await sendDerivativesMessage(msg);
}

async function sendMA9_26BlockWarning(candle, indicators, oiData, blockedDir) {
  let msg = `⚠️ <b>[VN30F v5.1] MA9/26 CHẶN ${blockedDir}</b>\n`;
  msg += `🕐 <b>${getVnTimeHHMMSS()}</b> (Nến ${candle.time}) | F1M: <b>${candle.close.toFixed(1)}</b>\n\n`;
  msg += `📈 <b>Chỉ báo:</b>\n   ${buildIndicatorBlock(indicators)}\n\n`;
  msg += `💡 <i>Tín hiệu ${blockedDir} ngược cấu trúc MA9 & MA26 → Cấm đuổi lệnh!</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 Volume Scalper v5.1</i>`;
  await sendDerivativesMessage(msg);
}

async function sendFlashCrashWarning(currentPrice, dropPts, dropWindow, fromPrice, isAfter14h, wasLong, indicators) {
  let msg = `🚨🚨🚨 <b>[CẢNH BÁO KHẨN CẤP] CÁ MẬP ÚP BÔ / FORCE SELL / FLASH CRASH!</b>\n`;
  msg += `🕐 <b>${getVnTimeHHMMSS()}</b> | F1M: <b>${currentPrice.toFixed(1)}</b>\n\n`;

  msg += `⚡ <b>BIẾN ĐỘNG CỰC ĐỘ:</b>\n`;
  msg += `   Giá tụt <b>-${dropPts.toFixed(1)} điểm</b> trong vòng <b>${dropWindow}</b>! (Từ ${fromPrice.toFixed(1)} → ${currentPrice.toFixed(1)})\n`;
  if (isAfter14h) {
    msg += `   ⚠️ <b>ĐẶC BIỆT NGUY HIỂM SAU 14H00 — Giờ Call Margin & Xả Kho Lái!</b>\n`;
  }

  if (indicators) {
    msg += `\n📈 <b>Chỉ báo:</b>\n   ${buildIndicatorBlock(indicators)}\n`;
  }

  msg += `\n🛡️ <b>HÀNH ĐỘNG HỆ THỐNG:</b>\n`;
  if (wasLong) {
    msg += `   🛑 <b>ĐÃ TỰ ĐỘNG THOÁT KHẨN CẤP VỊ THẾ LONG @ ${currentPrice.toFixed(1)}!</b>\n`;
    msg += `   👉 Bảo toàn vốn, tuyệt đối không gồng lỗ khi lái úp bô tháo cống!\n`;
  } else {
    msg += `   ⛔ Đang cầm SHORT hoặc ĐỨNG NGOÀI.\n`;
    msg += `   👉 <b>TUYỆT ĐỐI CẤM BẮT ĐÁY DAO RƠI!</b> Chờ thị trường ổn định.\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 Volume Scalper v5.1 | VN Stock Bot</i>`;
  await sendDerivativesMessage(msg);
}

async function sendTripleTopWarning(candle, tripleTop, indicators, oiData) {
  let msg = `⚠️ <b>[VN30F v5.1] CẢNH BÁO: VƯỢT ĐỈNH 3 LẦN THẤT BẠI (TRIPLE TOP FAKEOUT)</b>\n`;
  msg += `🕐 <b>${getVnTimeHHMMSS()}</b> (Nến ${candle.time}) | F1M: <b>${candle.close.toFixed(1)}</b>\n\n`;

  msg += `⛰️ <b>Vùng Kháng Cự 3 Đỉnh:</b>\n`;
  msg += `   • Đỉnh 1: <b>${tripleTop.p1.high.toFixed(1)}</b> (${tripleTop.p1.time})\n`;
  msg += `   • Đỉnh 2: <b>${tripleTop.p2.high.toFixed(1)}</b> (${tripleTop.p2.time})\n`;
  msg += `   • Đỉnh 3: <b>${candle.high.toFixed(1)}</b> (${candle.time}) → Rút râu trên ↑<b>${candle.upperWick}đ</b> tụt về ${candle.close.toFixed(1)}\n\n`;

  msg += `📈 <b>Chỉ báo:</b>\n   ${buildIndicatorBlock(indicators)}\n\n`;

  msg += `💡 <b>Nhận định:</b> Lái kéo fakeout dụ Long đỉnh rồi xả!\n`;
  msg += `👉 <b>ĐANG CẦM LONG:</b> Đã đóng / Chốt lời ngay lập tức!\n`;
  msg += `👉 <b>TUYỆT ĐỐI CẤM FOMO LONG ĐỈNH!</b>\n`;
  msg += `👉 Cân nhắc mở SHORT khi xác nhận gãy lại vùng đỉnh ${tripleTop.resistanceLevel.toFixed(1)}.\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🔮 Volume Scalper v5.1</i>`;
  await sendDerivativesMessage(msg);
}

// ─── MAIN POLL CYCLE (NẾN 1 PHÚT) ────────────────────────────
async function pollCycle() {
  if (!isCurrentInstanceActive()) return;
  if (!dataFetcher.isMarketHours()) return;

  const currentTime = getVnTimeHHMM();
  if (currentTime < START_TIME || currentTime > END_TIME) return;

  try {
    const [rawIntraday, oiData] = await Promise.all([
      dataFetcher.fetchIntraday1m('VN30F1M'),
      dataFetcher.fetchDerivativesOIData(),
    ]);

    if (!rawIntraday || !rawIntraday.t || rawIntraday.t.length === 0) return;

    const candles = parseCandles(rawIntraday);
    if (candles.length === 0) return;

    // Lọc nến đã đóng hoàn chỉnh (timestamp <= now - 50s)
    const nowSec = Math.floor(Date.now() / 1000);
    const closedCandles = candles.filter(c => c.timestamp <= nowSec - 50);
    if (closedCandles.length === 0) return;

    // Lấy nến mới nhất vừa đóng xong
    const targetCandle = closedCandles[closedCandles.length - 1];
    if (targetCandle.timestamp <= _state.lastProcessedTimestamp) return;

    console.log(`   🔮 [Scalper] Nến mới: ${targetCandle.time} (${getVnTimeHHMMSS()}) | ${targetCandle.isGreen ? 'XANH' : 'ĐỎ'} | Vol:${targetCandle.volume} | C:${targetCandle.close.toFixed(1)}`);

    _state.processedCandles = closedCandles;
    _state.lastProcessedTimestamp = targetCandle.timestamp;

    await processNewCandle(targetCandle, closedCandles, oiData);
  } catch (e) {
    console.error(`   ⚠️ [Scalper] Poll error: ${e.message}`);
  }
}

// ─── START / STOP / RESET ────────────────────────────────────
function start() {
  stop();
  console.log(`   🔮 Volume Scalper v5.1: Started (poll 60s, fast tick 5s, entry ${START_TIME}-${STOP_ENTRY_TIME})`);

  // Poll nến 1p mỗi 60s
  _state.timer = setInterval(() => {
    pollCycle().catch(e => console.error('   ⚠️ [Scalper] cycle error:', e.message));
  }, POLL_INTERVAL_MS);

  // Fast tick mỗi 5s bắt Flash Crash
  _state.fastTimer = setInterval(() => {
    fastTickCycle().catch(e => console.error('   ⚠️ [Scalper] fast tick error:', e.message));
  }, FAST_TICK_INTERVAL_MS);

  // Chạy ngay lần đầu sau 3s
  setTimeout(() => {
    pollCycle().catch(e => console.error('   ⚠️ [Scalper] initial cycle error:', e.message));
    fastTickCycle().catch(e => console.error('   ⚠️ [Scalper] initial tick error:', e.message));
  }, 3000);
}

function stop() {
  if (_state.timer) {
    clearInterval(_state.timer);
    _state.timer = null;
  }
  if (_state.fastTimer) {
    clearInterval(_state.fastTimer);
    _state.fastTimer = null;
  }
}

function reset() {
  stop();
  _state.position = 'NONE';
  _state.entryPrice = 0;
  _state.entryTime = '';
  _state.entryIdx = -1;
  _state.entryVol = 0;
  _state.maxProfit = 0;
  _state.breakevenActive = false;
  _state.lastProcessedTimestamp = 0;
  _state.processedCandles = [];
  _state.tradeLog = [];
  _state.lastNotiTime = 0;
  _state.lastAnomalyNotiTime = 0;
  _state.lastMA50AlertTime = 0;
  _state.lastMA20AlertTime = 0;
  _state.priceTicks = [];
  _state.lastFlashAlertTime = 0;
  _state.lastTripleTopAlertTime = 0;
  _state.lastSwingAlertTime = 0;
  _state.lastConfirmedPeak = null;
  console.log('   🔄 Volume Scalper v5.1: State reset');
}

function getState() {
  return { ..._state };
}

module.exports = {
  start,
  stop,
  reset,
  getState,
  pollCycle,
  fastTickCycle,
};
