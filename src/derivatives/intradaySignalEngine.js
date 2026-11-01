/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚡ VN30F v8.0 — Senior Trader AI Trading Engine             ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  NÂNG CẤP AI TRADING NHƯ NGƯỜI THẬT (REALTIME POSITION AI)    ║
 * ║                                                                ║
 * ║  • Bộ nhớ lệnh liên tục: Mở/Giữ/Chốt/Cắt/Đảo vị thế           ║
 * ║  • Note rõ PnL thực tế: đang âm/dương bao nhiêu điểm          ║
 * ║  • 11 Trạng thái lệnh chuẩn Prop Trader:                       ║
 * ║    1. Đứng ngoài quan sát                                     ║
 * ║    2. Mở Short                                                ║
 * ║    3. Giữ Short (+Xđ / -Xđ)                                   ║
 * ║    4. Chốt lời Short                                          ║
 * ║    5. Cắt lỗ Short tạm đứng ngoài                             ║
 * ║    6. Đóng Short đảo Long                                     ║
 * ║    7. Mở Long                                                 ║
 * ║    8. Giữ Long (+Xđ / -Xđ)                                    ║
 * ║    9. Chốt lời Long                                           ║
 * ║    10. Cắt lỗ Long tạm đứng ngoài                             ║
 * ║    11. Đóng Long đảo Short                                    ║
 * ║    + Đóng vị thế bảo toàn vốn khi bất lợi                     ║
 * ║                                                                ║
 * ║  • Cấu trúc thị trường cơ bản:                                ║
 * ║    Đỉnh sau vs Đỉnh trước (Nâng đỉnh / Hạ đỉnh)               ║
 * ║    Đáy sau vs Đáy trước (Nâng đáy / Hạ đáy)                   ║
 * ║    Swing Down / Swing Up / Big Short / Big Long               ║
 * ║                                                                ║
 * ║  • Thanh khoản & Tốc độ thanh khoản:                          ║
 * ║    Tốc độ (tỷ/phút) + Dự phóng cả ngày                        ║
 * ║    < 16k tỷ: THANH KHOẢN THẤP ➔ SCALP 3-5-7đ chốt nhanh      ║
 * ║    ≥ 16k tỷ: THANH KHOẢN TỐT ➔ Lãi ≥ 10đ cho HOLD gồng trend, ║
 * ║              nhưng BẮT BUỘC CHẶN LÃI (Trailing Stop)           ║
 * ║                                                                ║
 * ║  • Smart Money: Khối ngoại (NN) & Tự doanh (TD) + Tỷ trọng %  ║
 * ║                                                                ║
 * ║  • Khung giờ bắn noti:                                        ║
 * ║    Sáng: 09h10 → 11h30 (5p/lần = 29 noti)                     ║
 * ║    Chiều: 13h05 → 14h20 (5p/lần = 16 noti)                    ║
 * ║    14h25: Xung lực sau cắt margin & Smart Money nhồi Long/Short║
 * ║    14h29: Quyết định mở ATC                                   ║
 * ║    14h44: Quyết định cầm qua đêm ATO hay đóng bảo toàn vốn     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');
const { config, isCurrentInstanceActive } = require('../config');
const dataFetcher = require('./dataFetcher');
const marketStructure = require('./marketStructure');
const marketContext = require('./marketContext');
const oiEstimator = require('./oiEstimator');
const pillarMonitor = require('./pillarMonitor');
const { fetchMarketLiquidity } = require('../stockService');
const { sendDerivativesMessage } = require('../telegramService');

// ─── FILE LƯU TRẠNG THÁI AI TRADER ───────────────────────────
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'ai_position_state.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createFreshPositionState(todayStr = '', archivedTrades = []) {
  return {
    date: todayStr,
    position: 'NONE',         // 'NONE' | 'LONG' | 'SHORT'
    status: 'STAND_ASIDE',    // mã trạng thái hệ thống
    statusLabel: 'ĐỨNG NGOÀI QUAN SÁT',
    entryPrice: null,
    entryTime: null,
    entryTimestamp: null,
    entryReason: '',
    stopLoss: null,
    trailingStop: null,
    takeProfit1: null,
    takeProfit2: null,
    currentPnL: 0,
    maxPnL: 0,
    minPnL: 0,
    holdingBars: 0,
    liquidityMode: 'SCALP',   // 'SCALP' (< 16k tỷ) | 'TREND' (>= 16k tỷ)
    todayTrades: archivedTrades,
    totalPnLToday: 0,
    winTrades: 0,
    lossTrades: 0,
    signalCount: 0,
    consecutiveSame: 0,
    lastSignal: null,
    lastUpdated: new Date().toISOString(),
  };
}

function loadAIPositionState() {
  ensureDataDir();
  const vnTime = dataFetcher.getVnTime();
  const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;

  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === todayStr) {
        return parsed;
      }
      // Khác ngày -> lưu lại lịch sử hôm trước và reset sang ngày mới
      console.log(`   🔄 Khởi tạo state ngày mới cho AI Trader: ${todayStr}`);
      const fresh = createFreshPositionState(todayStr);
      saveAIPositionState(fresh);
      return fresh;
    }
  } catch (e) {
    console.error('⚠️ Lỗi đọc ai_position_state.json:', e.message);
  }

  const fresh = createFreshPositionState(todayStr);
  saveAIPositionState(fresh);
  return fresh;
}

function saveAIPositionState(state) {
  ensureDataDir();
  try {
    state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('⚠️ Lỗi ghi ai_position_state.json:', e.message);
    return false;
  }
}

// ─── STATE IN-MEMORY (Đồng bộ với Persistent State) ───────────
let _state = loadAIPositionState();

function resetIntradayState() {
  const vnTime = dataFetcher.getVnTime();
  const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;
  _state = createFreshPositionState(todayStr);
  saveAIPositionState(_state);
  console.log('   🔄 AI Position State đã reset hoàn toàn về TRỐNG LỆNH');
}

// ─── PHÂN TÍCH THANH KHOẢN VÀ TỐC ĐỘ GIAO DỊCH ────────────────
/**
 * Tính toán tốc độ thanh khoản (tỷ/phút) và dự phóng giá trị giao dịch cả ngày
 * Quy tắc:
 * - Dưới 16k tỷ/ngày: THANH KHOẢN THẤP ➔ Ưu tiên SCALP 3-5-7đ chốt nhanh, không hold lâu
 * - Trên 16k tỷ/ngày: THANH KHOẢN TỐT ➔ Cho phép HOLD gồng trend nếu dương >= 10đ,
 *   nhưng BẮT BUỘC CHẶN LÃI (Trailing Stop) theo đỉnh/đáy gần nhất!
 */
async function calculateMarketLiquiditySpeed() {
  let liquidity = null;
  try {
    liquidity = await fetchMarketLiquidity();
  } catch (e) {
    console.error('⚠️ Lỗi fetchMarketLiquidity:', e.message);
  }

  const vnTime = dataFetcher.getVnTime();
  const hour = vnTime.getHours();
  const minute = vnTime.getMinutes();

  // Tính số phút giao dịch thực tế đã trôi qua trong ngày (tối đa 255 phút)
  // Sáng: 9h00 -> 11h30 (150 phút)
  // Chiều: 13h00 -> 14h30 (90 phút) + ATC 15p = 255 phút
  let elapsedMinutes = 0;
  if (hour < 9) {
    elapsedMinutes = 5;
  } else if (hour === 9) {
    elapsedMinutes = Math.max(5, minute);
  } else if (hour === 10) {
    elapsedMinutes = 60 + minute;
  } else if (hour === 11) {
    elapsedMinutes = 120 + Math.min(30, minute);
  } else if (hour === 12) {
    elapsedMinutes = 150;
  } else if (hour === 13) {
    elapsedMinutes = 150 + minute;
  } else if (hour >= 14) {
    elapsedMinutes = 150 + 60 + Math.min(45, minute);
  }
  elapsedMinutes = Math.max(10, Math.min(255, elapsedMinutes));

  const totalVal = liquidity ? (liquidity.total || 0) : 0; // tỷ VNĐ
  const hoseVal = liquidity ? (liquidity.hose || 0) : 0;

  // Tốc độ thanh khoản (tỷ VNĐ/phút)
  const speed = totalVal > 0 ? +(totalVal / elapsedMinutes).toFixed(1) : 0;

  // Dự phóng thanh khoản cả ngày (255 phút giao dịch)
  const totalTradingMinutes = 255;
  const projectedTotal = totalVal > 0 ? Math.round(totalVal * (totalTradingMinutes / elapsedMinutes)) : 0;

  // Ngưỡng 16.000 tỷ
  const isLowLiquidity = projectedTotal > 0 ? projectedTotal < 16000 : true;
  const mode = isLowLiquidity ? 'SCALP' : 'TREND';

  return {
    totalVal: Math.round(totalVal),
    hoseVal: Math.round(hoseVal),
    elapsedMinutes,
    speed, // tỷ/phút
    projectedTotal, // tỷ cả ngày
    isLowLiquidity,
    mode,
    modeLabel: isLowLiquidity
      ? '⚠️ THANH KHOẢN THẤP (< 16k tỷ) ➔ ƯU TIÊN SCALP 3-5-7Đ'
      : '🔥 THANH KHOẢN TỐT (≥ 16k tỷ) ➔ CHO PHÉP GỒNG TREND (CHẶN LÃI)',
  };
}

// ─── PHÂN TÍCH CẤU TRÚC THỊ TRƯỜNG TỪ NẾN (SWING HIGH/LOW) ─────
/**
 * Nắm vững căn bản thuận thế thị trường:
 * - Đỉnh sau vs Đỉnh trước: Lower Highs (Hạ đỉnh) vs Higher Highs (Nâng đỉnh)
 * - Đáy sau vs Đáy trước: Lower Lows (Hạ đáy) vs Higher Lows (Nâng đáy)
 * - Nâng đỉnh nâng đáy: SWING UP (Uptrend) ➔ Thuận thế LONG
 * - Hạ đỉnh hạ đáy: SWING DOWN (Downtrend) ➔ Thuận thế SHORT
 * - BIG LONG: Vượt đỉnh cũ + Nâng đáy + Nến xanh nổ vol
 * - BIG SHORT: Thủng đáy cũ + Hạ đỉnh + Nến đỏ xả vol
 */
function analyzeMarketStructureFromCandles(m5Data, m15Data) {
  if (!m5Data || !m5Data.c || m5Data.c.length < 6) {
    return {
      highLowStructure: 'SIDEWAY',
      structureTag: '⚪ CHƯA RÕ CẤU TRÚC (Thiếu dữ liệu)',
      swingHighDesc: 'Chưa đủ nến',
      swingLowDesc: 'Chưa đủ nến',
      isHigherHighs: false,
      isLowerHighs: false,
      isHigherLows: false,
      isLowerLows: false,
      isBigLong: false,
      isBigShort: false,
      recentHigh: 0,
      recentLow: 0,
      secondHalfHigh: 0,
      secondHalfLow: 0,
    };
  }

  const closes = m5Data.c;
  const highs = m5Data.h || closes;
  const lows = m5Data.l || closes;
  const len = closes.length;

  const windowSize = Math.min(12, len);
  const recentHighs = highs.slice(-windowSize);
  const recentLows = lows.slice(-windowSize);

  const half = Math.floor(windowSize / 2);
  const firstHalfHigh = Math.max(...recentHighs.slice(0, half));
  const secondHalfHigh = Math.max(...recentHighs.slice(half));
  const firstHalfLow = Math.min(...recentLows.slice(0, half));
  const secondHalfLow = Math.min(...recentLows.slice(half));

  const isHigherHighs = secondHalfHigh > firstHalfHigh + 0.5;
  const isLowerHighs = secondHalfHigh < firstHalfHigh - 0.5;
  const isHigherLows = secondHalfLow > firstHalfLow + 0.5;
  const isLowerLows = secondHalfLow < firstHalfLow - 0.5;

  let swingHighDesc = '';
  if (isHigherHighs) {
    swingHighDesc = `Đỉnh sau (${secondHalfHigh.toFixed(1)}) > Đỉnh trước (${firstHalfHigh.toFixed(1)}) ➔ NÂNG ĐỈNH`;
  } else if (isLowerHighs) {
    swingHighDesc = `Đỉnh sau (${secondHalfHigh.toFixed(1)}) < Đỉnh trước (${firstHalfHigh.toFixed(1)}) ➔ HẠ ĐỈNH`;
  } else {
    swingHighDesc = `Đỉnh ngang bằng (${secondHalfHigh.toFixed(1)} ≈ ${firstHalfHigh.toFixed(1)})`;
  }

  let swingLowDesc = '';
  if (isHigherLows) {
    swingLowDesc = `Đáy sau (${secondHalfLow.toFixed(1)}) > Đáy trước (${firstHalfLow.toFixed(1)}) ➔ NÂNG ĐÁY`;
  } else if (isLowerLows) {
    swingLowDesc = `Đáy sau (${secondHalfLow.toFixed(1)}) < Đáy trước (${firstHalfLow.toFixed(1)}) ➔ HẠ ĐÁY`;
  } else {
    swingLowDesc = `Đáy ngang bằng (${secondHalfLow.toFixed(1)} ≈ ${firstHalfLow.toFixed(1)})`;
  }

  let highLowStructure = 'SIDEWAY';
  let structureTag = '';
  if (isHigherHighs && isHigherLows) {
    highLowStructure = 'UPTREND';
    structureTag = '🟢 NÂNG ĐỈNH + NÂNG ĐÁY (Swing Up) ➔ THUẬN THẾ LONG';
  } else if (isLowerHighs && isLowerLows) {
    highLowStructure = 'DOWNTREND';
    structureTag = '🔴 HẠ ĐỈNH + HẠ ĐÁY (Swing Down) ➔ THUẬN THẾ SHORT';
  } else if (isLowerHighs && isHigherLows) {
    highLowStructure = 'TRIANGLE';
    structureTag = '🟡 HẠ ĐỈNH + NÂNG ĐÁY (Thu hẹp tam giác) ➔ CHỜ BREAKOUT';
  } else if (isHigherHighs && isLowerLows) {
    highLowStructure = 'EXPANDING';
    structureTag = '⚠️ NÂNG ĐỈNH + HẠ ĐÁY (Kéo xả 2 đầu) ➔ RỦI RO BẪY CAO';
  } else {
    highLowStructure = 'SIDEWAY';
    structureTag = '⚪ ĐỈNH ĐÁY ĐAN XEN (Sideway giằng co)';
  }

  const currentPrice = closes[len - 1];
  const isBigLong = isHigherHighs && isHigherLows && currentPrice >= secondHalfHigh - 0.5;
  const isBigShort = isLowerHighs && isLowerLows && currentPrice <= secondHalfLow + 0.5;

  return {
    highLowStructure,
    structureTag,
    swingHighDesc,
    swingLowDesc,
    isHigherHighs,
    isLowerHighs,
    isHigherLows,
    isLowerLows,
    isBigLong,
    isBigShort,
    recentHigh: Math.max(...recentHighs),
    recentLow: Math.min(...recentLows),
    secondHalfHigh,
    secondHalfLow,
  };
}

// ─── MULTI-TIMEFRAME ANALYSIS ────────────────────────────────
function analyze1HTimeframe(hourlyData) {
  if (!hourlyData || !hourlyData.c || hourlyData.c.length < 5) {
    return { trend: 'UNKNOWN', strength: 0, description: 'Không đủ dữ liệu 1H' };
  }

  const closes = hourlyData.c;
  const len = closes.length;
  const ema5 = marketStructure.calculateEMA(closes, 5);
  const ema13 = marketStructure.calculateEMA(closes, 13);
  const last3 = closes.slice(-3);
  const slope = (last3[2] - last3[0]) / 2;

  let trend = 'NEUTRAL';
  let strength = 0;
  let description = '';

  if (ema5 && ema13) {
    const emaDiff = ema5 - ema13;
    if (emaDiff > 2 && slope > 0) {
      trend = 'UPTREND';
      strength = Math.min(90, 50 + Math.abs(emaDiff) * 5);
      description = `EMA5 > EMA13 (+${emaDiff.toFixed(1)}đ), slope dốc tăng ➔ Uptrend 1H`;
    } else if (emaDiff < -2 && slope < 0) {
      trend = 'DOWNTREND';
      strength = Math.min(90, 50 + Math.abs(emaDiff) * 5);
      description = `EMA5 < EMA13 (${emaDiff.toFixed(1)}đ), slope dốc giảm ➔ Downtrend 1H`;
    } else {
      trend = 'SIDEWAYS';
      strength = 30;
      description = `EMA5 ≈ EMA13 (diff: ${emaDiff.toFixed(1)}đ) ➔ Sideway 1H`;
    }
  }

  return {
    trend,
    strength,
    description,
    ema5: ema5 ? +ema5.toFixed(1) : null,
    ema13: ema13 ? +ema13.toFixed(1) : null,
    slope: +slope.toFixed(2),
    lastClose: +closes[len - 1].toFixed(1),
  };
}

function analyze15mTimeframe(m15Data, h1Trend) {
  if (!m15Data || !m15Data.c || m15Data.c.length < 8) {
    return { signal: 'NEUTRAL', description: 'Không đủ dữ liệu 15p' };
  }

  const closes = m15Data.c;
  const volumes = m15Data.v || [];
  const len = closes.length;

  const ema5 = marketStructure.calculateEMA(closes, 5);
  const ema9 = marketStructure.calculateEMA(closes, 9);
  const last4 = closes.slice(-4);
  const last4Slope = (last4[last4.length - 1] - last4[0]) / (last4.length - 1);

  const last4Vol = volumes.slice(-4);
  const prev4Vol = volumes.slice(-8, -4);
  const avgLast4Vol = last4Vol.length > 0 ? last4Vol.reduce((s, v) => s + v, 0) / last4Vol.length : 0;
  const avgPrev4Vol = prev4Vol.length > 0 ? prev4Vol.reduce((s, v) => s + v, 0) / prev4Vol.length : 0;
  const volTrend = avgPrev4Vol > 0 ? +(avgLast4Vol / avgPrev4Vol).toFixed(2) : 1;

  let signal = 'NEUTRAL';
  let description = '';
  let confidence = 50;

  if (ema5 && ema9) {
    const emaDiff = ema5 - ema9;
    if (emaDiff > 1 && last4Slope > 0) {
      signal = 'BULLISH';
      description = `15p: EMA5 > EMA9 (+${emaDiff.toFixed(1)}đ), 4 bar gần nhất tăng`;
      confidence = 65;
      if (h1Trend === 'UPTREND') {
        confidence = 80;
        description += ' — ĐỒNG THUẬN 1H ↑';
      } else if (h1Trend === 'DOWNTREND') {
        confidence = 40;
        description += ' — ⚠️ NGƯỢC 1H ↓ (pullback/bẫy?)';
      }
    } else if (emaDiff < -1 && last4Slope < 0) {
      signal = 'BEARISH';
      description = `15p: EMA5 < EMA9 (${emaDiff.toFixed(1)}đ), 4 bar gần nhất giảm`;
      confidence = 65;
      if (h1Trend === 'DOWNTREND') {
        confidence = 80;
        description += ' — ĐỒNG THUẬN 1H ↓';
      } else if (h1Trend === 'UPTREND') {
        confidence = 40;
        description += ' — ⚠️ NGƯỢC 1H ↑ (pullback/bẫy?)';
      }
    } else {
      signal = 'NEUTRAL';
      description = `15p: Sideway/chưa rõ (EMA diff: ${emaDiff.toFixed(1)}đ)`;
      confidence = 30;
    }
  }

  let volDescription = '';
  if (volTrend > 1.3) {
    volDescription = `Vol 15p TĂNG x${volTrend} ➔ dòng tiền xác nhận`;
    if (signal !== 'NEUTRAL') confidence += 10;
  } else if (volTrend < 0.7) {
    volDescription = `Vol 15p TEO x${volTrend} ➔ thiếu lực, cẩn trọng bẫy`;
    confidence -= 10;
  } else {
    volDescription = `Vol 15p bình thường (x${volTrend})`;
  }

  return {
    signal,
    description,
    confidence: Math.max(0, Math.min(100, confidence)),
    volTrend,
    volDescription,
    lastClose: +closes[len - 1].toFixed(1),
  };
}

function analyze5mTimeframe(m5Data, m15Signal) {
  if (!m5Data || !m5Data.c || m5Data.c.length < 10) {
    return { entrySignal: 'NEUTRAL', description: 'Không đủ dữ liệu 5p' };
  }

  const closes = m5Data.c;
  const opens = m5Data.o || closes;
  const highs = m5Data.h || closes;
  const lows = m5Data.l || closes;
  const volumes = m5Data.v || [];
  const len = closes.length;

  const last3 = [];
  for (let i = len - 3; i < len; i++) {
    const o = opens[i];
    const c = closes[i];
    const h = highs[i];
    const l = lows[i];
    const v = volumes[i] || 0;
    last3.push({
      open: o, close: c, high: h, low: l, volume: v,
      isGreen: c >= o,
      body: Math.abs(c - o),
      range: h - l,
      upperWick: h - Math.max(o, c),
      lowerWick: Math.min(o, c) - l,
    });
  }

  const velocity = (closes[len - 1] - closes[len - 6]) / 5;
  let entrySignal = 'NEUTRAL';
  let entryConfidence = 50;
  let description = '';

  const latestCandle = last3[last3.length - 1];

  if (latestCandle.isGreen && latestCandle.body > 1.5 && velocity > 0.3) {
    entrySignal = 'LONG_ENTRY';
    entryConfidence = 65;
    description = `Nến 5p xanh đặc (${latestCandle.body.toFixed(1)}đ) + velocity tăng ➔ Entry LONG`;
    if (m15Signal === 'BULLISH') {
      entryConfidence = 80;
      description += ' — 15p đồng thuận';
    }
  } else if (!latestCandle.isGreen && latestCandle.body > 1.5 && velocity < -0.3) {
    entrySignal = 'SHORT_ENTRY';
    entryConfidence = 65;
    description = `Nến 5p đỏ đặc (${latestCandle.body.toFixed(1)}đ) + velocity giảm ➔ Entry SHORT`;
    if (m15Signal === 'BEARISH') {
      entryConfidence = 80;
      description += ' — 15p đồng thuận';
    }
  } else if (latestCandle.body < 0.5 && latestCandle.range > 2) {
    entrySignal = 'STAND_ASIDE';
    entryConfidence = 30;
    description = `Nến 5p Doji (range ${latestCandle.range.toFixed(1)}đ) ➔ Do dự, chờ`;
  } else if (latestCandle.lowerWick > latestCandle.body * 2 && latestCandle.isGreen) {
    entrySignal = 'LONG_ENTRY';
    entryConfidence = 60;
    description = `Pin bar đáy 5p (râu dưới ${latestCandle.lowerWick.toFixed(1)}đ) ➔ Cầu bắt đáy`;
  } else if (latestCandle.upperWick > latestCandle.body * 2 && !latestCandle.isGreen) {
    entrySignal = 'SHORT_ENTRY';
    entryConfidence = 60;
    description = `Pin bar đỉnh 5p (râu trên ${latestCandle.upperWick.toFixed(1)}đ) ➔ Cung dội bán`;
  } else {
    description = `5p chưa có tín hiệu bứt phá ➔ Quan sát thêm`;
  }

  return {
    entrySignal,
    entryConfidence: Math.max(0, Math.min(100, entryConfidence)),
    description,
    velocity: +velocity.toFixed(2),
    latestCandle,
    currentPrice: +closes[len - 1].toFixed(1),
  };
}

// ─── AI TRADER STATE MACHINE & RA QUYẾT ĐỊNH NHƯ NGƯỜI THẬT ───
/**
 * Tổng hợp Đa khung + Cấu trúc + Thanh khoản + Smart Money
 * Quản trị vị thế liên tục như một Prop Trader:
 * 1. ĐỨNG NGOÀI QUAN SÁT
 * 2. MỞ SHORT
 * 3. GIỮ SHORT (+Xđ / -Xđ)
 * 4. CHỐT LỜI SHORT (+Xđ) ➔ Trống lệnh
 * 5. CẮT LỖ SHORT TẠM ĐỨNG NGOÀI (-Xđ) ➔ Trống lệnh
 * 6. ĐÓNG SHORT ĐẢO LONG
 * 7. MỞ LONG
 * 8. GIỮ LONG (+Xđ / -Xđ)
 * 9. CHỐT LỜI LONG (+Xđ) ➔ Trống lệnh
 * 10. CẮT LỖ LONG TẠM ĐỨNG NGOÀI (-Xđ) ➔ Trống lệnh
 * 11. ĐÓNG LONG ĐẢO SHORT
 * + ĐÓNG BẢO TOÀN VỊ THẾ KHI BẤT LỢI
 */
function makeAITraderDecision(h1, m15, m5, structure, liquidity, smartMoney, contextInfo, pillarAnalysis = null) {
  // Đồng bộ state hiện tại
  _state = loadAIPositionState();

  const currentPrice = m5.currentPrice;
  const vnTime = dataFetcher.getVnTime();
  const timeStr = `${String(vnTime.getHours()).padStart(2, '0')}:${String(vnTime.getMinutes()).padStart(2, '0')}`;

  _state.signalCount = (_state.signalCount || 0) + 1;
  _state.liquidityMode = liquidity.mode;

  // Tính toán Bull/Bear Score từ các yếu tố
  let bullScore = 0;
  let bearScore = 0;
  const reasons = [];
  const warnings = [];

  // 1H (35%)
  if (h1.trend === 'UPTREND') { bullScore += 35; reasons.push(`1H: ${h1.description}`); }
  else if (h1.trend === 'DOWNTREND') { bearScore += 35; reasons.push(`1H: ${h1.description}`); }

  // 15p (25%)
  if (m15.signal === 'BULLISH') { bullScore += 25 * (m15.confidence / 100); reasons.push(`15p: ${m15.description}`); }
  else if (m15.signal === 'BEARISH') { bearScore += 25 * (m15.confidence / 100); reasons.push(`15p: ${m15.description}`); }

  // 5p (20%)
  if (m5.entrySignal === 'LONG_ENTRY') { bullScore += 20 * (m5.entryConfidence / 100); reasons.push(`5p: ${m5.description}`); }
  else if (m5.entrySignal === 'SHORT_ENTRY') { bearScore += 20 * (m5.entryConfidence / 100); reasons.push(`5p: ${m5.description}`); }

  // Cấu trúc thị trường (20%)
  if (structure.highLowStructure === 'UPTREND') {
    bullScore += 20;
    reasons.push(structure.structureTag);
  } else if (structure.highLowStructure === 'DOWNTREND') {
    bearScore += 20;
    reasons.push(structure.structureTag);
  } else if (structure.structureTag) {
    warnings.push(structure.structureTag);
  }

  // Smart Money tác động
  if (smartMoney) {
    if (smartMoney.smartMoneyNet >= 800) {
      bullScore += 10;
      reasons.push(`Smart Money (NN+TD) gom ròng +${smartMoney.smartMoneyNet.toLocaleString('vi-VN')} HĐ (${smartMoney.smartMoneyPct}%)`);
    } else if (smartMoney.smartMoneyNet <= -800) {
      bearScore += 10;
      reasons.push(`Smart Money (NN+TD) xả ròng ${smartMoney.smartMoneyNet.toLocaleString('vi-VN')} HĐ (${smartMoney.smartMoneyPct}%)`);
    }
  }

  // 7 Trụ điều tiết (VIC, VPL, VHM, MCH, VCB, GAS, VJC)
  if (pillarAnalysis) {
    if (pillarAnalysis.consensus === 'LONG' || pillarAnalysis.consensus === 'STRONG_LONG') {
      bullScore += 12;
      reasons.push(`🏛️ 7 Trụ: ${pillarAnalysis.consensusLabel} (${pillarAnalysis.bullishCount}/7 xanh)`);
    } else if (pillarAnalysis.consensus === 'SHORT' || pillarAnalysis.consensus === 'STRONG_SHORT') {
      bearScore += 12;
      reasons.push(`🏛️ 7 Trụ: ${pillarAnalysis.consensusLabel} (${pillarAnalysis.bearishCount}/7 đỏ)`);
    }

    if (pillarAnalysis.manipulationWarnings && pillarAnalysis.manipulationWarnings.length > 0) {
      for (const w of pillarAnalysis.manipulationWarnings) {
        warnings.push(w);
      }
    }
  }

  // Basis
  if (contextInfo && contextInfo.basis) {
    if (contextInfo.basis.isBullish) bullScore += 5;
    if (contextInfo.basis.isBearish) bearScore += 5;
  }

  let actionDecision = 'STAND_ASIDE';
  let actionTitle = 'ĐỨNG NGOÀI QUAN SÁT';
  let actionAdvice = 'Thị trường chưa có điểm vào tối ưu. Kiên nhẫn chờ setup rõ ràng.';
  let tradePlan = null;

  // ═══════════════════════════════════════════════════════════
  // TRƯỜNG HỢP 1: AI ĐANG TRỐNG LỆNH (position === 'NONE')
  // ═══════════════════════════════════════════════════════════
  if (_state.position === 'NONE') {
    const entryThreshold = 52;

    // Kiểm tra vùng cản & hỗ trợ trước khi mở lệnh (Hard Filter chống bán vào hỗ trợ / mua vào kháng cự)
    const isAtSupport = structure && structure.recentLow && (currentPrice >= structure.recentLow - 0.3 && currentPrice <= structure.recentLow + 1.8);
    const isAtResist = structure && structure.recentHigh && (currentPrice <= structure.recentHigh + 0.3 && currentPrice >= structure.recentHigh - 1.8);

    if (bullScore >= entryThreshold && bullScore > bearScore * 1.3) {
      if (isAtResist && !structure.isBigLong) {
        // Chặn MUA VÀO KHÁNG CỰ
        actionDecision = 'STAND_ASIDE';
        actionTitle = `⚪ ĐỨNG NGOÀI QUAN SÁT (SÁT CẢN ${structure.recentHigh.toFixed(1)})`;
        actionAdvice = `Giá ${currentPrice} đang ngay sát cản/đỉnh ${structure.recentHigh.toFixed(1)} chưa có xác nhận vượt đỉnh. CẤM MUA ĐUỔI VÀO CẢN! Vị thế: Đứng ngoài quan sát.`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
      } else {
        // MỞ LONG MỚI
        _state.position = 'LONG';
        _state.status = 'OPEN_LONG';
        _state.statusLabel = 'MỞ LONG';
        _state.entryPrice = currentPrice;
        _state.entryTime = timeStr;
        _state.entryTimestamp = Date.now();
        _state.stopLoss = +(currentPrice - 3.0).toFixed(1);
        _state.trailingStop = _state.stopLoss;
        _state.takeProfit1 = +(currentPrice + 5.0).toFixed(1);
        _state.takeProfit2 = +(currentPrice + 10.0).toFixed(1);
        _state.currentPnL = 0;
        _state.maxPnL = 0;
        _state.minPnL = 0;
        _state.holdingBars = 1;

        actionDecision = 'OPEN_LONG';
        actionTitle = `🟢 MỞ LONG @ ${currentPrice}`;
        actionAdvice = `Khớp mở vị thế LONG quanh ${currentPrice}. Tuân thủ kỷ luật SL -3đ.`;
        tradePlan = {
          action: 'MỞ LONG',
          entry: currentPrice,
          sl: _state.stopLoss,
          tp1: _state.takeProfit1,
          tp2: _state.takeProfit2,
          trailing: _state.trailingStop,
        };
      }
    } else if (bearScore >= entryThreshold && bearScore > bullScore * 1.3) {
      if (isAtSupport && !structure.isBigShort) {
        // Chặn BÁN VÀO HỖ TRỢ
        actionDecision = 'STAND_ASIDE';
        actionTitle = `⚪ ĐỨNG NGOÀI QUAN SÁT (SÁT HỖ TRỢ ${structure.recentLow.toFixed(1)})`;
        actionAdvice = `Giá ${currentPrice} đang ngay sát hỗ trợ/đáy ${structure.recentLow.toFixed(1)} chưa có xác nhận thủng đáy. CẤM BÁN VÀO HỖ TRỢ (tránh Short Squeeze / bẫy rút chân)! Vị thế: Đứng ngoài quan sát.`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
      } else {
        // MỞ SHORT MỚI
        _state.position = 'SHORT';
        _state.status = 'OPEN_SHORT';
        _state.statusLabel = 'MỞ SHORT';
        _state.entryPrice = currentPrice;
        _state.entryTime = timeStr;
        _state.entryTimestamp = Date.now();
        _state.stopLoss = +(currentPrice + 3.0).toFixed(1);
        _state.trailingStop = _state.stopLoss;
        _state.takeProfit1 = +(currentPrice - 5.0).toFixed(1);
        _state.takeProfit2 = +(currentPrice - 10.0).toFixed(1);
        _state.currentPnL = 0;
        _state.maxPnL = 0;
        _state.minPnL = 0;
        _state.holdingBars = 1;

        actionDecision = 'OPEN_SHORT';
        actionTitle = `🔴 MỞ SHORT @ ${currentPrice}`;
        actionAdvice = `Khớp mở vị thế SHORT quanh ${currentPrice}. Tuân thủ kỷ luật SL +3đ.`;
        tradePlan = {
          action: 'MỞ SHORT',
          entry: currentPrice,
          sl: _state.stopLoss,
          tp1: _state.takeProfit1,
          tp2: _state.takeProfit2,
          trailing: _state.trailingStop,
        };
      }
    } else {
      actionDecision = 'STAND_ASIDE';
      actionTitle = '⚪ ĐỨNG NGOÀI QUAN SÁT';
      actionAdvice = 'AI đang TRỐNG LỆNH. Hai phe giằng co hoặc cạn thanh khoản ➔ Kiên nhẫn chờ setup rõ ràng.';
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = 'ĐỨNG NGOÀI QUAN SÁT';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TRƯỜNG HỢP 2: AI ĐANG GIỮ LỆNH LONG (position === 'LONG')
  // ═══════════════════════════════════════════════════════════
  else if (_state.position === 'LONG') {
    const pnl = +(currentPrice - _state.entryPrice).toFixed(1);
    _state.currentPnL = pnl;
    _state.maxPnL = Math.max(_state.maxPnL || 0, pnl);
    _state.minPnL = Math.min(_state.minPnL || 0, pnl);
    _state.holdingBars = (_state.holdingBars || 0) + 1;

    // 1. Kiểm tra CẮT LỖ hoặc CHẶN LÃI BẢO TOÀN VỐN
    if (currentPrice <= _state.stopLoss || (_state.trailingStop && currentPrice <= _state.trailingStop)) {
      if (pnl < 0) {
        actionDecision = 'STOP_LOSS_LONG';
        actionTitle = `🛑 CẮT LỖ LONG TẠM ĐỨNG NGOÀI (${pnl}đ)`;
        actionAdvice = `Giá chạm ngưỡng cắt lỗ (${currentPrice} <= ${_state.stopLoss}). Dứt khoát cắt lỗ bảo vệ tài khoản, tạm đứng ngoài quan sát!`;
        _state.status = 'STOP_LOSS_LONG';
        _state.statusLabel = `CẮT LỖ LONG TẠM ĐỨNG NGOÀI (${pnl}đ)`;
      } else {
        actionDecision = 'CLOSE_PRESERVE';
        actionTitle = `🛡️ ĐÓNG LONG BẢO TOÀN VỊ THẾ (+${pnl}đ)`;
        actionAdvice = `Giá điều chỉnh chạm mốc chặn lãi/bảo toàn vốn (${_state.trailingStop}đ). Chủ động đóng lệnh bảo vệ lợi nhuận, tạm đứng ngoài!`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = `ĐỨNG NGOÀI QUAN SÁT (Đã đóng bảo toàn vị thế +${pnl}đ)`;
      }

      // Ghi nhận lịch sử lệnh
      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'LONG',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: pnl < 0 ? 'Dính Stop Loss cắt lỗ' : 'Chạm mốc chặn lãi bảo toàn vốn',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      if (pnl >= 0) _state.winTrades++; else _state.lossTrades++;

      // Reset về TRỐNG LỆNH
      _state.position = 'NONE';
      _state.entryPrice = null;
      _state.stopLoss = null;
      _state.trailingStop = null;
    }

    // 2. Kiểm tra ĐẢO CHIỀU (ĐÓNG LONG ĐẢO SHORT)
    else if (bearScore >= 60 && bearScore > bullScore * 1.5 && (structure.isLowerHighs || structure.isLowerLows)) {
      actionDecision = 'REVERSE_LONG_TO_SHORT';
      actionTitle = `🔄 ĐÓNG LONG ĐẢO SHORT (Chốt Long ${pnl >= 0 ? '+' : ''}${pnl}đ ➔ Đảo Short @ ${currentPrice})`;
      actionAdvice = `Thị trường đảo chiều giảm mạnh (hạ đỉnh/đáy, phe gấu áp đảo). Đóng sạch Long và mở ngay SHORT mới!`;

      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'LONG',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: 'Đảo chiều gãy xu hướng sang Short',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      if (pnl >= 0) _state.winTrades++; else _state.lossTrades++;

      // Đảo sang SHORT
      _state.position = 'SHORT';
      _state.status = 'REVERSE_LONG_TO_SHORT';
      _state.statusLabel = `ĐÓNG LONG ĐẢO SHORT`;
      _state.entryPrice = currentPrice;
      _state.entryTime = timeStr;
      _state.entryTimestamp = Date.now();
      _state.stopLoss = +(currentPrice + 3.0).toFixed(1);
      _state.trailingStop = _state.stopLoss;
      _state.takeProfit1 = +(currentPrice - 5.0).toFixed(1);
      _state.takeProfit2 = +(currentPrice - 10.0).toFixed(1);
      _state.currentPnL = 0;
      _state.maxPnL = 0;
      _state.minPnL = 0;
      _state.holdingBars = 1;

      tradePlan = {
        action: 'MỞ SHORT (ĐẢO CHIỀU)',
        entry: currentPrice,
        sl: _state.stopLoss,
        tp1: _state.takeProfit1,
        tp2: _state.takeProfit2,
        trailing: _state.trailingStop,
      };
    }

    // 3. Kiểm tra CHỐT LỜI
    else if (
      liquidity.isLowLiquidity && (
        pnl >= 7.0 ||
        (pnl >= 5.0 && (m5.entrySignal === 'NEUTRAL' || bearScore >= 40 || m5.latestCandle?.upperWick > 0.8 || m5.latestCandle?.isGreen === false)) ||
        (pnl >= 3.0 && (structure.isLowerHighs || m5.latestCandle?.upperWick > 1.2 || bearScore >= 45))
      )
    ) {
      // Thanh khoản thấp: Ưu tiên SCALP lấy điểm nhỏ 3-5-7đ là chốt lời
      actionDecision = 'TAKE_PROFIT_LONG';
      actionTitle = `🎯 CHỐT LỜI LONG (+${pnl}đ)`;
      actionAdvice = `Thanh khoản thị trường thấp (< 16k tỷ). Đạt target chốt lời scalp +${pnl}đ. Tất toán đưa tài khoản về trống lệnh!`;

      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'LONG',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: 'Chốt lời Scalp khi thanh khoản thấp',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      _state.winTrades++;

      _state.position = 'NONE';
      _state.status = 'TAKE_PROFIT_LONG';
      _state.statusLabel = `CHỐT LỜI LONG (+${pnl}đ)`;
      _state.entryPrice = null;
      _state.stopLoss = null;
      _state.trailingStop = null;
    }

    // 4. Kiểm tra BẢO TOÀN VỊ THẾ KHI BẤT LỢI (Giằng co cạn vol, kéo xả)
    else if (_state.holdingBars >= 4 && pnl <= 0.5 && (bearScore >= 45 || structure.isLowerHighs)) {
      actionDecision = 'CLOSE_PRESERVE';
      actionTitle = `🛡️ ĐÓNG LONG BẢO TOÀN VỊ THẾ (${pnl >= 0 ? '+' : ''}${pnl}đ)`;
      actionAdvice = `Diễn biến đi ngang kéo xả, xung lực tăng chững lại. Chủ động đóng lệnh bảo toàn vốn, tạm đứng ngoài quan sát!`;

      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'LONG',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: 'Đóng bảo toàn vị thế khi diễn biến bất lợi',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      if (pnl >= 0) _state.winTrades++; else _state.lossTrades++;

      _state.position = 'NONE';
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = `ĐỨNG NGOÀI QUAN SÁT (Vừa đóng bảo toàn vốn)`;
      _state.entryPrice = null;
      _state.stopLoss = null;
      _state.trailingStop = null;
    }

    // 5. TIẾP TỤC GIỮ LỆNH LONG (Gồng Trend hoặc giữ nhịp)
    else {
      actionDecision = 'HOLD_LONG';
      // Nếu thanh khoản tốt và lãi >= 10đ: Nâng chặn lãi Trailing Stop theo đáy gần nhất
      if (!liquidity.isLowLiquidity && pnl >= 10.0) {
        const lockFloor = Math.max(_state.entryPrice + 5.0, currentPrice - 3.5, structure.secondHalfLow || (currentPrice - 3.5));
        _state.trailingStop = +lockFloor.toFixed(1);
        actionTitle = `🟢 GIỮ LONG (+${pnl}đ — GỒNG TREND 🔥)`;
        actionAdvice = `Thanh khoản tốt + Lãi lớn (+${pnl}đ). Cho phép HOLD gồng lãi, ĐÃ NÂNG CHẶN LÃI LÊN ${_state.trailingStop}đ.`;
      } else if (pnl >= 5.0) {
        // Khóa hòa vốn
        _state.trailingStop = Math.max(_state.trailingStop || _state.stopLoss, _state.entryPrice + 1.0);
        actionTitle = `🟢 GIỮ LONG (+${pnl}đ — ĐÃ KHÓA LÃI)`;
        actionAdvice = `Xu hướng tăng duy trì (+${pnl}đ). Đã dời chặn lãi lên ${_state.trailingStop}đ để bảo toàn thành quả.`;
      } else {
        actionTitle = `🟢 GIỮ LONG (${pnl >= 0 ? '+' : ''}${pnl}đ)`;
        actionAdvice = `Tiếp tục giữ vị thế Long (${pnl >= 0 ? '+' : ''}${pnl}đ). Xu hướng tăng vẫn được bảo vệ trên mốc SL ${_state.stopLoss}đ.`;
      }

      _state.status = 'HOLD_LONG';
      _state.statusLabel = actionTitle;
      tradePlan = {
        action: 'GIỮ LONG',
        entry: _state.entryPrice,
        sl: _state.stopLoss,
        trailing: _state.trailingStop,
        tp1: _state.takeProfit1,
        tp2: _state.takeProfit2,
        pnl: pnl,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TRƯỜNG HỢP 3: AI ĐANG GIỮ LỆNH SHORT (position === 'SHORT')
  // ═══════════════════════════════════════════════════════════
  else if (_state.position === 'SHORT') {
    const pnl = +(_state.entryPrice - currentPrice).toFixed(1);
    _state.currentPnL = pnl;
    _state.maxPnL = Math.max(_state.maxPnL || 0, pnl);
    _state.minPnL = Math.min(_state.minPnL || 0, pnl);
    _state.holdingBars = (_state.holdingBars || 0) + 1;

    // 1. Kiểm tra CẮT LỖ hoặc CHẶN LÃI BẢO TOÀN VỐN
    if (currentPrice >= _state.stopLoss || (_state.trailingStop && currentPrice >= _state.trailingStop)) {
      if (pnl < 0) {
        actionDecision = 'STOP_LOSS_SHORT';
        actionTitle = `🛑 CẮT LỖ SHORT TẠM ĐỨNG NGOÀI (${pnl}đ)`;
        actionAdvice = `Giá chạm ngưỡng cắt lỗ (${currentPrice} >= ${_state.stopLoss}). Dứt khoát cắt lỗ bảo vệ tài khoản, tạm đứng ngoài quan sát!`;
        _state.status = 'STOP_LOSS_SHORT';
        _state.statusLabel = `CẮT LỖ SHORT TẠM ĐỨNG NGOÀI (${pnl}đ)`;
      } else {
        actionDecision = 'CLOSE_PRESERVE';
        actionTitle = `🛡️ ĐÓNG SHORT BẢO TOÀN VỊ THẾ (+${pnl}đ)`;
        actionAdvice = `Giá hồi phục chạm mốc chặn lãi/bảo toàn vốn (${_state.trailingStop}đ). Chủ động đóng lệnh bảo vệ lợi nhuận, tạm đứng ngoài!`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = `ĐỨNG NGOÀI QUAN SÁT (Đã đóng bảo toàn vị thế +${pnl}đ)`;
      }

      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'SHORT',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: pnl < 0 ? 'Dính Stop Loss cắt lỗ' : 'Chạm mốc chặn lãi bảo toàn vốn',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      if (pnl >= 0) _state.winTrades++; else _state.lossTrades++;

      // Reset về TRỐNG LỆNH
      _state.position = 'NONE';
      _state.entryPrice = null;
      _state.stopLoss = null;
      _state.trailingStop = null;
    }

    // 2. Kiểm tra ĐẢO CHIỀU (ĐÓNG SHORT ĐẢO LONG)
    else if (bullScore >= 60 && bullScore > bearScore * 1.5 && (structure.isHigherHighs || structure.isHigherLows)) {
      actionDecision = 'REVERSE_SHORT_TO_LONG';
      actionTitle = `🔄 ĐÓNG SHORT ĐẢO LONG (Chốt Short ${pnl >= 0 ? '+' : ''}${pnl}đ ➔ Đảo Long @ ${currentPrice})`;
      actionAdvice = `Thị trường xuất hiện cầu mạnh nâng đáy đảo chiều. Lập tức đóng sạch Short và mở ngay LONG mới!`;

      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'SHORT',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: 'Đảo chiều nâng đáy sang Long',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      if (pnl >= 0) _state.winTrades++; else _state.lossTrades++;

      // Đảo sang LONG
      _state.position = 'LONG';
      _state.status = 'REVERSE_SHORT_TO_LONG';
      _state.statusLabel = `ĐÓNG SHORT ĐẢO LONG`;
      _state.entryPrice = currentPrice;
      _state.entryTime = timeStr;
      _state.entryTimestamp = Date.now();
      _state.stopLoss = +(currentPrice - 3.0).toFixed(1);
      _state.trailingStop = _state.stopLoss;
      _state.takeProfit1 = +(currentPrice + 5.0).toFixed(1);
      _state.takeProfit2 = +(currentPrice + 10.0).toFixed(1);
      _state.currentPnL = 0;
      _state.maxPnL = 0;
      _state.minPnL = 0;
      _state.holdingBars = 1;

      tradePlan = {
        action: 'MỞ LONG (ĐẢO CHIỀU)',
        entry: currentPrice,
        sl: _state.stopLoss,
        tp1: _state.takeProfit1,
        tp2: _state.takeProfit2,
        trailing: _state.trailingStop,
      };
    }

    // 3. Kiểm tra CHỐT LỜI
    else if (
      liquidity.isLowLiquidity && (
        pnl >= 7.0 ||
        (pnl >= 5.0 && (m5.entrySignal === 'NEUTRAL' || bullScore >= 40 || m5.latestCandle?.lowerWick > 0.8 || m5.latestCandle?.isGreen === true)) ||
        (pnl >= 3.0 && (structure.isHigherLows || m5.latestCandle?.lowerWick > 1.2 || bullScore >= 45))
      )
    ) {
      // Thanh khoản thấp: Ưu tiên SCALP chốt nhanh 3-5-7đ
      actionDecision = 'TAKE_PROFIT_SHORT';
      actionTitle = `🎯 CHỐT LỜI SHORT (+${pnl}đ)`;
      actionAdvice = `Thanh khoản thị trường thấp (< 16k tỷ). Đạt target chốt lời scalp +${pnl}đ. Tất toán đưa tài khoản về trống lệnh!`;

      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'SHORT',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: 'Chốt lời Scalp khi thanh khoản thấp',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      _state.winTrades++;

      _state.position = 'NONE';
      _state.status = 'TAKE_PROFIT_SHORT';
      _state.statusLabel = `CHỐT LỜI SHORT (+${pnl}đ)`;
      _state.entryPrice = null;
      _state.stopLoss = null;
      _state.trailingStop = null;
    }

    // 4. Kiểm tra BẢO TOÀN VỊ THẾ KHI BẤT LỢI
    else if (_state.holdingBars >= 4 && pnl <= 0.5 && (bullScore >= 45 || structure.isHigherLows)) {
      actionDecision = 'CLOSE_PRESERVE';
      actionTitle = `🛡️ ĐÓNG SHORT BẢO TOÀN VỊ THẾ (${pnl >= 0 ? '+' : ''}${pnl}đ)`;
      actionAdvice = `Đà giảm chững lại, có tín hiệu kéo hồi đảo chiều. Đóng sạch Short bảo toàn vốn, tạm đứng ngoài quan sát!`;

      _state.todayTrades.push({
        id: _state.todayTrades.length + 1,
        type: 'SHORT',
        entryPrice: _state.entryPrice,
        exitPrice: currentPrice,
        pnl,
        entryTime: _state.entryTime,
        exitTime: timeStr,
        reason: 'Đóng bảo toàn vị thế khi diễn biến bất lợi',
      });
      _state.totalPnLToday = +(_state.totalPnLToday + pnl).toFixed(1);
      if (pnl >= 0) _state.winTrades++; else _state.lossTrades++;

      _state.position = 'NONE';
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = `ĐỨNG NGOÀI QUAN SÁT (Vừa đóng bảo toàn vốn)`;
      _state.entryPrice = null;
      _state.stopLoss = null;
      _state.trailingStop = null;
    }

    // 5. TIẾP TỤC GIỮ LỆNH SHORT (Gồng Trend hoặc giữ nhịp)
    else {
      actionDecision = 'HOLD_SHORT';
      // Nếu thanh khoản tốt và lãi >= 10đ: Dời chặn lãi Trailing Stop xuống đỉnh gần nhất
      if (!liquidity.isLowLiquidity && pnl >= 10.0) {
        const lockCeil = Math.min(_state.entryPrice - 5.0, currentPrice + 3.5, structure.secondHalfHigh || (currentPrice + 3.5));
        _state.trailingStop = +lockCeil.toFixed(1);
        actionTitle = `🔴 GIỮ SHORT (+${pnl}đ — GỒNG TREND 🔥)`;
        actionAdvice = `Thanh khoản tốt + Lãi lớn (+${pnl}đ). Cho phép HOLD gồng lãi, ĐÃ HẠ CHẶN LÃI XUỐNG ${_state.trailingStop}đ.`;
      } else if (pnl >= 5.0) {
        // Khóa hòa vốn
        _state.trailingStop = Math.min(_state.trailingStop || _state.stopLoss, _state.entryPrice - 1.0);
        actionTitle = `🔴 GIỮ SHORT (+${pnl}đ — ĐÃ KHÓA LÃI)`;
        actionAdvice = `Xu hướng giảm duy trì (+${pnl}đ). Đã dời chặn lãi xuống ${_state.trailingStop}đ để bảo vệ lợi nhuận.`;
      } else {
        actionTitle = `🔴 GIỮ SHORT (${pnl >= 0 ? '+' : ''}${pnl}đ)`;
        actionAdvice = `Tiếp tục giữ vị thế Short (${pnl >= 0 ? '+' : ''}${pnl}đ). Xu hướng giảm vẫn duy trì dưới mốc SL ${_state.stopLoss}đ.`;
      }

      _state.status = 'HOLD_SHORT';
      _state.statusLabel = actionTitle;
      tradePlan = {
        action: 'GIỮ SHORT',
        entry: _state.entryPrice,
        sl: _state.stopLoss,
        trailing: _state.trailingStop,
        tp1: _state.takeProfit1,
        tp2: _state.takeProfit2,
        pnl: pnl,
      };
    }
  }

  // Lưu persistent state
  saveAIPositionState(_state);

  return {
    decision: actionDecision,
    title: actionTitle,
    advice: actionAdvice,
    bullScore: Math.round(bullScore),
    bearScore: Math.round(bearScore),
    reasons: reasons.slice(0, 4),
    warnings: warnings.slice(0, 3),
    tradePlan,
    state: _state,
  };
}

// ─── FORMAT INTRADAY SIGNAL MESSAGE ──────────────────────────
function formatIntradaySignal(result, h1, m15, m5, structure, liquidity, smartMoney, contextInfo, pillarAnalysis = null) {
  const { title, advice, bullScore, bearScore, reasons, warnings, tradePlan, state } = result;

  let msg = `🤖 <b>AI TRADER: ${title}</b>\n`;
  msg += `🕐 <i>${dataFetcher.vnNow()}</i> | Noti #${state.signalCount || 1}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. Giá hiện tại & Basis
  const basisText = contextInfo?.basis ? `${contextInfo.basis.basis >= 0 ? '+' : ''}${contextInfo.basis.basis}đ` : 'N/A';
  msg += `📍 <b>F1M: ${m5.currentPrice || 'N/A'}</b> | VN30: <b>${contextInfo?.vn30Price || 'N/A'}</b> | Basis: <b>${basisText}</b>\n\n`;

  // 2. Cấu trúc thị trường & Đa khung
  msg += `📊 <b>CẤU TRÚC THỊ TRƯỜNG & ĐA KHUNG:</b>\n`;
  const h1Emoji = h1.trend === 'UPTREND' ? '🟢' : h1.trend === 'DOWNTREND' ? '🔴' : '🟡';
  const m15Emoji = m15.signal === 'BULLISH' ? '🟢' : m15.signal === 'BEARISH' ? '🔴' : '🟡';
  const m5Emoji = m5.entrySignal.includes('LONG') ? '🟢' : m5.entrySignal.includes('SHORT') ? '🔴' : '🟡';

  msg += `  ${h1Emoji} 1H: ${h1.description}\n`;
  msg += `  ${m15Emoji} 15p: ${m15.description}\n`;
  msg += `  ${m5Emoji} 5p: ${m5.description}\n`;
  msg += `  📈 <b>Cấu trúc:</b> ${structure.structureTag}\n`;
  if (structure.swingHighDesc) msg += `     • ${structure.swingHighDesc}\n`;
  if (structure.swingLowDesc) msg += `     • ${structure.swingLowDesc}\n`;
  msg += `\n`;

  // 3. 7 Trụ điều tiết trọng yếu
  if (pillarAnalysis && pillarAnalysis.pillars) {
    msg += pillarMonitor.formatPillarsForNotification(pillarAnalysis) + '\n';
  }

  // 4. Thanh khoản thị trường & Tốc độ
  msg += `💧 <b>THANH KHOẢN THỊ TRƯỜNG:</b>\n`;
  msg += `  • Khớp hiện tại: <b>${liquidity.totalVal.toLocaleString('vi-VN')} tỷ</b> (Tốc độ: <b>${liquidity.speed} tỷ/phút</b>)\n`;
  msg += `  • Dự phóng cả ngày: <b>~${liquidity.projectedTotal.toLocaleString('vi-VN')} tỷ</b>\n`;
  msg += `  • Chiến lược: <i>${liquidity.modeLabel}</i>\n\n`;

  // 5. Smart Money (NN & Tự Doanh)
  if (smartMoney) {
    const smSign = smartMoney.smartMoneyNet >= 0 ? `+${smartMoney.smartMoneyNet.toLocaleString('vi-VN')}` : smartMoney.smartMoneyNet.toLocaleString('vi-VN');
    const nnSign = smartMoney.foreignNet >= 0 ? `+${smartMoney.foreignNet.toLocaleString('vi-VN')}` : smartMoney.foreignNet.toLocaleString('vi-VN');
    const tdSign = smartMoney.effectiveTD >= 0 ? `+${smartMoney.effectiveTD.toLocaleString('vi-VN')}` : smartMoney.effectiveTD.toLocaleString('vi-VN');
    const crowdSign = smartMoney.crowdNet >= 0 ? `+${smartMoney.crowdNet.toLocaleString('vi-VN')}` : smartMoney.crowdNet.toLocaleString('vi-VN');

    msg += `🐋 <b>SMART MONEY (KHỐI NGOẠI & TỰ DOANH):</b>\n`;
    msg += `  • 🌐 NN: <b>${smartMoney.foreignNet >= 0 ? '🟢 Mua' : '🔴 Bán'} ${nnSign} HĐ</b> (Tỷ trọng: <b>${smartMoney.foreignPct}%</b>)\n`;
    msg += `  • 🏛️ TD: <b>${smartMoney.effectiveTD >= 0 ? '🟢 Long' : '🔴 Short'} ${tdSign} HĐ</b>${smartMoney.tdIsEstimated ? ' <i>(ước)</i>' : ''} (Tỷ trọng: <b>${smartMoney.tdPct}%</b>)\n`;
    msg += `  • 🔥 <b>Hợp lực Smart Money:</b> <b>${smSign} HĐ</b> (Tỷ trọng: <b>${smartMoney.smartMoneyPct}%</b>)\n`;
    msg += `  • 👥 Đám đông đối ứng: <b>${crowdSign} HĐ</b>\n\n`;
  }

  // 6. Kế hoạch lệnh (Trade Plan)
  if (tradePlan) {
    msg += `🎯 <b>KẾ HOẠCH LỆNH (TRADE PLAN):</b>\n`;
    msg += `  📍 Entry: <b>${tradePlan.entry}</b> ${state.entryTime ? `(Khớp lúc ${state.entryTime})` : ''}\n`;
    if (tradePlan.pnl !== undefined) {
      const pnlEmoji = tradePlan.pnl >= 0 ? '🟢' : '🔴';
      msg += `  💰 PnL hiện tại: <b>${pnlEmoji} ${tradePlan.pnl >= 0 ? '+' : ''}${tradePlan.pnl}đ</b>\n`;
    }
    msg += `  🛑 Cắt lỗ (SL): <b>${tradePlan.sl}</b> (MTL)\n`;
    if (tradePlan.trailing) {
      msg += `  🛡️ Chặn lãi (Trailing): <b>${tradePlan.trailing}</b>\n`;
    }
    msg += `  🎯 TP1: <b>${tradePlan.tp1}</b> | TP2: <b>${tradePlan.tp2}</b>\n\n`;
  }

  // 7. Lý do & Khuyến nghị hành động
  msg += `📋 <b>HÀNH ĐỘNG CỦA SENIOR TRADER:</b>\n`;
  msg += `  👉 <b>${advice}</b>\n`;
  if (reasons.length > 0) {
    reasons.forEach(r => { msg += `  • ${r}\n`; });
  }
  msg += `\n`;

  if (warnings.length > 0) {
    msg += `⚠️ <b>LƯU Ý RỦI RO:</b>\n`;
    warnings.forEach(w => { msg += `  • ${w}\n`; });
    msg += `\n`;
  }

  // Hiệu suất hôm nay
  const totalTrades = state.todayTrades ? state.todayTrades.length : 0;
  const dayPnl = state.totalPnLToday || 0;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💼 <i>Vị thế: ${state.position !== 'NONE' ? `${state.position} @ ${state.entryPrice} (${state.currentPnL >= 0 ? '+' : ''}${state.currentPnL}đ)` : 'TRỐNG LỆNH'}</i>\n`;
  msg += `📊 <i>Hôm nay: ${totalTrades} lệnh | PnL: ${dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(1)}đ (${state.winTrades || 0}W - ${state.lossTrades || 0}L)</i>\n`;
  msg += `<i>⚡ Senior Trader AI Trading Engine v8.0 | VN Stock Bot</i>`;

  return msg;
}

// ─── RUN INTRADAY SIGNAL JOB ─────────────────────────────────
async function runIntradaySignal() {
  if (!isCurrentInstanceActive()) return;

  const startTime = Date.now();

  try {
    // Fetch dữ liệu song song
    const [hourlyData, m15Data, m5Data, oiData, futuresPrice, vn30Price, liquidityInfo, pillarAnalysis] = await Promise.all([
      dataFetcher.fetchOHLCV('VN30F1M', '60', 5),
      dataFetcher.fetchOHLCV('VN30F1M', '15', 3),
      dataFetcher.fetchOHLCV('VN30F1M', '5', 2),
      dataFetcher.fetchDerivativesOIData(),
      dataFetcher.fetchRealtimeFuturesPrice(),
      dataFetcher.fetchRealtimeVN30Price(),
      calculateMarketLiquiditySpeed(),
      pillarMonitor.analyzePillars().catch(() => null),
    ]);

    // Phân tích kỹ thuật đa khung
    const h1Analysis = analyze1HTimeframe(hourlyData);
    const m15Analysis = analyze15mTimeframe(m15Data, h1Analysis.trend);
    const m5Analysis = analyze5mTimeframe(m5Data, m15Analysis.signal);

    // Cấu trúc thị trường
    const structureInfo = analyzeMarketStructureFromCandles(m5Data, m15Data);

    // Smart Money
    const foreignBuy = oiData ? (oiData.foreignBuy || 0) : 0;
    const foreignSell = oiData ? (oiData.foreignSell || 0) : 0;
    const foreignNet = oiData ? (oiData.foreignNet !== undefined ? oiData.foreignNet : (foreignBuy - foreignSell)) : 0;
    const totalVolume = oiData ? (oiData.totalVolume || 0) : 1;

    const vnTime = dataFetcher.getVnTime();
    const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;
    const foreignStore = oiEstimator.loadForeignOIData ? oiEstimator.loadForeignOIData() : { history: [] };
    const existingToday = (foreignStore.history || []).find(h => h.date === todayStr);
    const tuDoanhNet = existingToday ? (existingToday.tuDoanhOvernight || 0) : 0;
    const tdEst = oiEstimator.estimateTuDoanh(foreignNet, tuDoanhNet);
    const effectiveTD = tuDoanhNet !== 0 ? tuDoanhNet : tdEst.value;
    const smartMoneyNet = foreignNet + effectiveTD;
    const crowdNet = -smartMoneyNet;

    const totalVolSafe = Math.max(1, totalVolume);
    const smartMoneyInfo = {
      foreignBuy,
      foreignSell,
      foreignNet,
      effectiveTD,
      tdIsEstimated: tdEst.isEstimated,
      smartMoneyNet,
      crowdNet,
      foreignPct: ((Math.abs(foreignNet) / totalVolSafe) * 100).toFixed(1),
      tdPct: ((Math.abs(effectiveTD) / totalVolSafe) * 100).toFixed(1),
      smartMoneyPct: ((Math.abs(smartMoneyNet) / totalVolSafe) * 100).toFixed(1),
    };

    // Market context
    const f1mPrice = futuresPrice ? futuresPrice.price : m5Analysis.currentPrice;
    const vn30PriceVal = vn30Price ? vn30Price.price : null;
    const contextInfo = marketContext.buildMarketContext(f1mPrice, vn30PriceVal, oiData);

    // AI Trader ra quyết định
    const traderResult = makeAITraderDecision(
      h1Analysis,
      m15Analysis,
      m5Analysis,
      structureInfo,
      liquidityInfo,
      smartMoneyInfo,
      contextInfo,
      pillarAnalysis
    );

    // Format & send tin nhắn
    const msg = formatIntradaySignal(
      traderResult,
      h1Analysis,
      m15Analysis,
      m5Analysis,
      structureInfo,
      liquidityInfo,
      smartMoneyInfo,
      contextInfo,
      pillarAnalysis
    );

    await sendDerivativesMessage(msg);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ AI Trader Signal #${traderResult.state.signalCount}: ${traderResult.title} [${elapsed}s]`);

    return traderResult;
  } catch (err) {
    console.error(`   ❌ Intraday Signal lỗi:`, err.message);
    return null;
  }
}

// ─── AI-ENHANCED SIGNAL ──────────────────────────────────────
async function runAIEnhancedSignal() {
  return runIntradaySignal();
}

module.exports = {
  runIntradaySignal,
  runAIEnhancedSignal,
  resetIntradayState,
  loadAIPositionState,
  saveAIPositionState,
  calculateMarketLiquiditySpeed,
  analyzeMarketStructureFromCandles,
  analyze1HTimeframe,
  analyze15mTimeframe,
  analyze5mTimeframe,
  makeAITraderDecision,
  formatIntradaySignal,
  getState: () => ({ ..._state }),
};
