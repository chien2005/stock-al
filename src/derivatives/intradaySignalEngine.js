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
const googleSheetService = require('./googleSheetService');

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
    currentNetPnL: 0,
    maxPnL: 0,
    minPnL: 0,
    holdingBars: 0,
    breakevenActive: false,
    tp1Hit: false,
    liquidityMode: 'SCALP',   // 'SCALP' (< 16k tỷ) | 'TREND' (>= 16k tỷ)
    todayTrades: archivedTrades,
    totalPnLToday: 0,
    totalGrossPnLToday: 0,
    totalNetPnLToday: 0,
    totalFeeToday: 0,
    winTrades: 0,
    lossTrades: 0,
    maxDailyTrades: 4,
    lastExitTime: null,
    lastExitTimestamp: 0,
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

// ─── MULTI-TIMEFRAME ANALYSIS (15M - 5M - 1M) ────────────────
/**
 * Phân tích khung 15p: Xu hướng chính trong phiên giao dịch
 */
function analyze15mTimeframe(m15Data) {
  if (!m15Data || !m15Data.c || m15Data.c.length < 5) {
    return { trend: 'UNKNOWN', signal: 'NEUTRAL', confidence: 50, description: '15p chưa đủ nến' };
  }

  const closes = m15Data.c;
  const volumes = m15Data.v || [];
  const len = closes.length;

  const ema5 = marketStructure.calculateEMA(closes, 5);
  const ema13 = marketStructure.calculateEMA(closes, 13);
  const last4 = closes.slice(-4);
  const slope = (last4[last4.length - 1] - last4[0]) / Math.max(1, last4.length - 1);

  let trend = 'NEUTRAL';
  let signal = 'NEUTRAL';
  let description = '';
  let confidence = 50;

  if (ema5 && ema13) {
    const emaDiff = ema5 - ema13;
    if (emaDiff > 1.0 && slope > 0) {
      trend = 'UPTREND';
      signal = 'BULLISH';
      confidence = 75;
      description = `EMA5 > EMA13 (+${emaDiff.toFixed(1)}đ), dốc tăng ➔ Uptrend 15p`;
    } else if (emaDiff < -1.0 && slope < 0) {
      trend = 'DOWNTREND';
      signal = 'BEARISH';
      confidence = 75;
      description = `EMA5 < EMA13 (${emaDiff.toFixed(1)}đ), dốc giảm ➔ Downtrend 15p`;
    } else {
      trend = 'SIDEWAYS';
      signal = 'NEUTRAL';
      confidence = 35;
      description = `EMA5 ≈ EMA13 (diff ${emaDiff.toFixed(1)}đ) ➔ Sideway 15p`;
    }
  }

  return {
    trend,
    signal,
    confidence,
    description,
    lastClose: +closes[len - 1].toFixed(1),
  };
}

/**
 * Phân tích khung 1p: Micro-timing điểm vào & xung lực vi mô
 */
function analyze1mTimeframe(m1Data, m5Signal = null) {
  if (!m1Data || !m1Data.c || m1Data.c.length < 5) {
    return { signal: 'NEUTRAL', confidence: 50, description: '1p chưa đủ nến' };
  }

  const closes = m1Data.c;
  const opens = m1Data.o || closes;
  const volumes = m1Data.v || [];
  const len = closes.length;

  const ema3 = marketStructure.calculateEMA(closes, 3);
  const ema7 = marketStructure.calculateEMA(closes, 7);

  const mom3 = +(closes[len - 1] - closes[Math.max(0, len - 4)]).toFixed(1);

  let signal = 'NEUTRAL';
  let confidence = 50;
  let description = '';

  if (ema3 && ema7) {
    const diff = ema3 - ema7;
    if (diff > 0.4 && mom3 > 0.5) {
      signal = 'BULLISH';
      confidence = 70;
      description = `Cầu chủ động dồn lên (+${mom3}đ, EMA3 > EMA7)`;
      if (m5Signal && m5Signal.includes('LONG')) {
        confidence = 85;
        description += ' — Đồng thuận 5p ↑';
      }
    } else if (diff < -0.4 && mom3 < -0.5) {
      signal = 'BEARISH';
      confidence = 70;
      description = `Cung dội bán ép giá (${mom3}đ, EMA3 < EMA7)`;
      if (m5Signal && m5Signal.includes('SHORT')) {
        confidence = 85;
        description += ' — Đồng thuận 5p ↓';
      }
    } else {
      signal = 'NEUTRAL';
      confidence = 35;
      description = `Giằng co vi mô (${mom3 >= 0 ? '+' : ''}${mom3}đ, EMA3 ≈ EMA7)`;
    }
  }

  return {
    signal,
    confidence,
    description,
    momentum: mom3,
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

// ─── ĐÓNG VỊ THẾ HIỆN TẠI & GHI NHẬN GOOGLE SHEETS ──────────
/**
 * Đóng vị thế hiện tại, tính toán phí và PnL thực tế, ghi nhận vào Google Sheets & state
 */
async function closeCurrentPosition(exitPrice, exitReason, timeStr) {
  if (!_state.position || _state.position === 'NONE') return null;

  const grossPnL = +(_state.position === 'LONG'
    ? (exitPrice - _state.entryPrice)
    : (_state.entryPrice - exitPrice)).toFixed(1);
  const fee = googleSheetService.FEE_PER_TRADE; // 0.6đ/lệnh
  const netPnL = +(grossPnL - fee).toFixed(1);

  const orderNum = ((_state.todayTrades && _state.todayTrades.length) || 0) + 1;
  const isWin = netPnL > 0;
  const cumulativeDayNetPnL = +((_state.totalNetPnLToday || 0) + netPnL).toFixed(1);

  const closedTrade = {
    id: orderNum,
    orderNum,
    type: _state.position,
    entryPrice: _state.entryPrice,
    exitPrice: parseFloat(Number(exitPrice).toFixed(1)),
    entryTime: _state.entryTime || 'N/A',
    exitTime: timeStr,
    grossPnL,
    fee,
    netPnL,
    isWin,
    reason: exitReason,
    cumulativeDayNetPnL,
  };

  // Đồng bộ sang Google Sheets & File local JSON/CSV
  await googleSheetService.logTrade(closedTrade).catch(e => {
    console.error('⚠️ Lỗi logTrade sang Google Sheets:', e.message);
  });

  if (!_state.todayTrades) _state.todayTrades = [];
  _state.todayTrades.push(closedTrade);

  _state.totalGrossPnLToday = +((_state.totalGrossPnLToday || 0) + grossPnL).toFixed(1);
  _state.totalFeeToday = +((_state.totalFeeToday || 0) + fee).toFixed(1);
  _state.totalNetPnLToday = cumulativeDayNetPnL;
  _state.totalPnLToday = _state.totalNetPnLToday;

  if (isWin) {
    _state.winTrades = (_state.winTrades || 0) + 1;
  } else if (netPnL < 0) {
    _state.lossTrades = (_state.lossTrades || 0) + 1;
  }

  _state.lastExitTime = timeStr;
  _state.lastExitTimestamp = Date.now();
  _state.position = 'NONE';
  _state.entryPrice = null;
  _state.entryTime = null;
  _state.entryTimestamp = null;
  _state.stopLoss = null;
  _state.trailingStop = null;
  _state.takeProfit1 = null;
  _state.takeProfit2 = null;
  _state.currentPnL = 0;
  _state.currentNetPnL = 0;
  _state.holdingBars = 0;
  _state.breakevenActive = false;
  _state.tp1Hit = false;

  saveAIPositionState(_state);
  return closedTrade;
}

// ─── AI TRADER STATE MACHINE & RA QUYẾT ĐỊNH NHƯ NGƯỜI THẬT ───
/**
 * Tổng hợp Đa khung (15p - 5p - 1p) + Cấu trúc Swing + Thanh khoản + Smart Money
 * Quản trị vị thế liên tục như một Prop Trader:
 * 1. ĐỨNG NGOÀI QUAN SÁT
 * 2. MỞ SHORT (Tối đa 4 lệnh/ngày)
 * 3. GIỮ SHORT (+Xđ / -Xđ) — Duy trì vị thế, không đóng mở lung tung
 * 4. CHỐT LỜI SHORT (+Xđ) ➔ Trống lệnh
 * 5. CẮT LỖ SHORT TẠM ĐỨNG NGOÀI (-Xđ) ➔ Trống lệnh
 * 6. ĐÓNG SHORT ĐẢO LONG
 * 7. MỞ LONG (Tối đa 4 lệnh/ngày)
 * 8. GIỮ LONG (+Xđ / -Xđ) — Duy trì vị thế, không đóng mở lung tung
 * 9. CHỐT LỜI LONG (+Xđ) ➔ Trống lệnh
 * 10. CẮT LỖ LONG TẠM ĐỨNG NGOÀI (-Xđ) ➔ Trống lệnh
 * 11. ĐÓNG LONG ĐẢO SHORT
 * + TẤT TOÁN CUỐI PHIÊN TRÁNH BIẾN ĐỘNG ATC
 */
async function makeAITraderDecision(m15, m5, m1, structure, liquidity, smartMoney, contextInfo) {
  // Đồng bộ state hiện tại
  _state = loadAIPositionState();

  const currentPrice = m5.currentPrice;
  const vnTime = dataFetcher.getVnTime();
  const timeStr = `${String(vnTime.getHours()).padStart(2, '0')}:${String(vnTime.getMinutes()).padStart(2, '0')}:${String(vnTime.getSeconds()).padStart(2, '0')}`;

  _state.signalCount = (_state.signalCount || 0) + 1;
  _state.liquidityMode = liquidity.mode;

  // Tính toán Bull/Bear Score từ Đa khung (15p - 5p - 1p)
  let bullScore = 0;
  let bearScore = 0;
  const reasons = [];
  const warnings = [];

  // 15p (35%): Xu hướng chính trong phiên (Uptrend / Downtrend)
  if (m15.signal === 'BULLISH') {
    bullScore += 35 * (m15.confidence / 100);
    reasons.push(m15.description);
  } else if (m15.signal === 'BEARISH') {
    bearScore += 35 * (m15.confidence / 100);
    reasons.push(m15.description);
  }

  // 5p (35%): Nhịp sóng và Setup vào lệnh
  if (m5.entrySignal === 'LONG_ENTRY') {
    bullScore += 35 * (m5.entryConfidence / 100);
    reasons.push(m5.description);
  } else if (m5.entrySignal === 'SHORT_ENTRY') {
    bearScore += 35 * (m5.entryConfidence / 100);
    reasons.push(m5.description);
  }

  // 1p (15%): Micro-timing điểm vào & xung lực vi mô
  if (m1.signal === 'BULLISH') {
    bullScore += 15 * (m1.confidence / 100);
    reasons.push(m1.description);
  } else if (m1.signal === 'BEARISH') {
    bearScore += 15 * (m1.confidence / 100);
    reasons.push(m1.description);
  }

  // Cấu trúc thị trường Swing High/Low (15%)
  if (structure.highLowStructure === 'UPTREND') {
    bullScore += 15;
    reasons.push(structure.structureTag);
  } else if (structure.highLowStructure === 'DOWNTREND') {
    bearScore += 15;
    reasons.push(structure.structureTag);
  } else if (structure.structureTag) {
    warnings.push(structure.structureTag);
  }

  // Smart Money tác động (10%)
  if (smartMoney) {
    if (smartMoney.smartMoneyNet >= 800) {
      bullScore += 10;
      reasons.push(`Smart Money gom ròng +${smartMoney.smartMoneyNet.toLocaleString('vi-VN')} HĐ (${smartMoney.smartMoneyPct}%)`);
    } else if (smartMoney.smartMoneyNet <= -800) {
      bearScore += 10;
      reasons.push(`Smart Money xả ròng ${smartMoney.smartMoneyNet.toLocaleString('vi-VN')} HĐ (${smartMoney.smartMoneyPct}%)`);
    }
  }

  // Basis (5%)
  if (contextInfo && contextInfo.basis) {
    if (contextInfo.basis.isBullish) bullScore += 5;
    if (contextInfo.basis.isBearish) bearScore += 5;
  }

  let actionDecision = 'STAND_ASIDE';
  let actionTitle = 'ĐỨNG NGOÀI QUAN SÁT';
  let actionAdvice = 'Thị trường chưa có điểm vào tối ưu. Kiên nhẫn chờ setup rõ ràng.';
  let tradePlan = null;

  const tradeCount = (_state.todayTrades || []).length;
  const hour = vnTime.getHours();
  const minute = vnTime.getMinutes();
  const isATO = (hour === 8 && minute >= 45) || (hour === 9 && minute <= 15);
  const isATC = (hour === 14 && minute >= 30);
  const isAtoAtc = isATO || isATC;

  // ═══════════════════════════════════════════════════════════
  // TRƯỜNG HỢP 1: AI ĐANG TRỐNG LỆNH (position === 'NONE')
  // ═══════════════════════════════════════════════════════════
  if (!_state.position || _state.position === 'NONE') {
    // 1. Kiểm tra giới hạn kỷ luật 4 lệnh/ngày
    if (tradeCount >= 4 && !isAtoAtc) {
      actionDecision = 'STAND_ASIDE';
      actionTitle = '🔒 ĐÃ ĐỦ 4 LỆNH HÔM NAY (ĐỨNG NGOÀI NGHỈ NGƠI)';
      actionAdvice = `Kỷ luật Senior Trader: Đã hoàn thành ${tradeCount}/4 lệnh trong ngày. Khóa mở vị thế mới để bảo toàn vốn và thành quả, tuyệt đối không overtrading!`;
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = actionTitle;
      saveAIPositionState(_state);
      return {
        decision: actionDecision,
        title: actionTitle,
        advice: actionAdvice,
        bullScore: Math.round(bullScore),
        bearScore: Math.round(bearScore),
        reasons,
        warnings,
        tradePlan: null,
        state: _state,
      };
    }

    // 2. Kiểm tra thời gian tĩnh tâm (Cooldown 15p) sau khi vừa đóng lệnh
    const cooldownMs = 15 * 60 * 1000;
    const timeSinceLastExit = Date.now() - (_state.lastExitTimestamp || 0);
    if (_state.lastExitTimestamp && timeSinceLastExit < cooldownMs) {
      const remainMin = Math.ceil((cooldownMs - timeSinceLastExit) / 60000);
      actionDecision = 'STAND_ASIDE';
      actionTitle = `⚪ ĐỨNG NGOÀI (TĨNH TÂM SAU LỆNH #${tradeCount})`;
      actionAdvice = `Vừa đóng lệnh lúc ${_state.lastExitTime || 'N/A'}. AI Trader đang trong thời gian tĩnh tâm (${remainMin}p còn lại) để ổn định tâm lý và chờ cấu trúc thị trường mới.`;
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = actionTitle;
      saveAIPositionState(_state);
      return {
        decision: actionDecision,
        title: actionTitle,
        advice: actionAdvice,
        bullScore: Math.round(bullScore),
        bearScore: Math.round(bearScore),
        reasons,
        warnings,
        tradePlan: null,
        state: _state,
      };
    }

    // 3. Đánh giá tín hiệu mở lệnh mới với bộ lọc kỷ luật nghiêm ngặt
    const entryThreshold = 52;
    const isAtSupport = structure && structure.recentLow && (currentPrice >= structure.recentLow - 0.3 && currentPrice <= structure.recentLow + 1.8);
    const isAtResist = structure && structure.recentHigh && (currentPrice <= structure.recentHigh + 0.3 && currentPrice >= structure.recentHigh - 1.8);
    const isDowntrend = m15.signal === 'BEARISH' && structure.isLowerHighs;
    const isUptrend = m15.signal === 'BULLISH' && structure.isHigherLows;

    // MỞ LONG
    if (bullScore >= entryThreshold && bullScore > bearScore * 1.3) {
      if (isAtResist && !structure.isBigLong) {
        actionDecision = 'STAND_ASIDE';
        actionTitle = `⚪ ĐỨNG NGOÀI (CẤM ĐU ĐỈNH SÁT CẢN ${structure.recentHigh.toFixed(1)})`;
        actionAdvice = `Giá ${currentPrice} đang ngay sát cản/đỉnh ${structure.recentHigh.toFixed(1)} chưa có xác nhận bứt phá. CẤM MUA ĐU ĐỈNH! Chờ vượt cản hoặc chỉnh về hỗ trợ.`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
      } else if (isDowntrend && !structure.isBigLong) {
        actionDecision = 'STAND_ASIDE';
        actionTitle = `⚪ ĐỨNG NGOÀI (CẤM BẮT ĐÁY KHI TREND GIẢM)`;
        actionAdvice = `Xu hướng 15p vẫn là DOWNTREND hạ đỉnh. CẤM BẮT ĐÁY LONG ngược xu hướng (tránh bẫy bull-trap / dao rơi)!`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
      } else {
        const orderNum = tradeCount + 1;
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
        _state.currentNetPnL = -0.6;
        _state.maxPnL = 0;
        _state.minPnL = 0;
        _state.holdingBars = 1;
        _state.breakevenActive = false;
        _state.tp1Hit = false;

        actionDecision = 'OPEN_LONG';
        actionTitle = `🟢 MỞ LONG @ ${currentPrice} (Lệnh #${orderNum}/4)`;
        actionAdvice = `Khớp mở vị thế LONG quanh ${currentPrice} thuận sóng nâng đáy. Tuân thủ kỷ luật SL -3đ (${_state.stopLoss}đ).`;
        tradePlan = {
          action: 'MỞ LONG',
          entry: currentPrice,
          sl: _state.stopLoss,
          tp1: _state.takeProfit1,
          tp2: _state.takeProfit2,
          trailing: _state.trailingStop,
        };
      }
    }
    // MỞ SHORT
    else if (bearScore >= entryThreshold && bearScore > bullScore * 1.3) {
      if (isAtSupport && !structure.isBigShort) {
        actionDecision = 'STAND_ASIDE';
        actionTitle = `⚪ ĐỨNG NGOÀI (CẤM BÁN ĐÁY SÁT HỖ TRỢ ${structure.recentLow.toFixed(1)})`;
        actionAdvice = `Giá ${currentPrice} đang ngay sát hỗ trợ/đáy ${structure.recentLow.toFixed(1)} chưa có xác nhận thủng đáy. CẤM BÁN THÁO VÀO ĐÁY (tránh bẫy Short Squeeze / rút chân)!`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
      } else if (isUptrend && !structure.isBigShort) {
        actionDecision = 'STAND_ASIDE';
        actionTitle = `⚪ ĐỨNG NGOÀI (CẤM SHORT CẢN TÀU KHI TREND TĂNG)`;
        actionAdvice = `Xu hướng 15p vẫn là UPTREND nâng đỉnh nâng đáy. CẤM SHORT CẢN TÀU ngược dòng tiền lớn!`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
      } else {
        const orderNum = tradeCount + 1;
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
        _state.currentNetPnL = -0.6;
        _state.maxPnL = 0;
        _state.minPnL = 0;
        _state.holdingBars = 1;
        _state.breakevenActive = false;
        _state.tp1Hit = false;

        actionDecision = 'OPEN_SHORT';
        actionTitle = `🔴 MỞ SHORT @ ${currentPrice} (Lệnh #${orderNum}/4)`;
        actionAdvice = `Khớp mở vị thế SHORT quanh ${currentPrice} thuận thế hạ đỉnh. Tuân thủ kỷ luật SL +3đ (${_state.stopLoss}đ).`;
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
      actionAdvice = 'AI đang TRỐNG LỆNH. Hai phe giằng co hoặc thanh khoản chưa xác nhận ➔ Kiên nhẫn chờ setup rõ ràng.';
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = 'ĐỨNG NGOÀI QUAN SÁT';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TRƯỜNG HỢP 2: AI ĐANG GIỮ LỆNH LONG (position === 'LONG')
  // ═══════════════════════════════════════════════════════════
  else if (_state.position === 'LONG') {
    const grossPnL = +(currentPrice - _state.entryPrice).toFixed(1);
    const netPnL = +(grossPnL - googleSheetService.FEE_PER_TRADE).toFixed(1);
    _state.currentPnL = grossPnL;
    _state.currentNetPnL = netPnL;
    _state.maxPnL = Math.max(_state.maxPnL || 0, grossPnL);
    _state.minPnL = Math.min(_state.minPnL || 0, grossPnL);
    _state.holdingBars = (_state.holdingBars || 0) + 1;

    // Quản trị vốn: Dời SL về hòa vốn khi lãi >= 3.5đ
    if (grossPnL >= 3.5 && !_state.breakevenActive) {
      _state.stopLoss = Math.max(_state.stopLoss || 0, _state.entryPrice);
      _state.trailingStop = Math.max(_state.trailingStop || 0, _state.entryPrice);
      _state.breakevenActive = true;
    }
    // Đạt TP1 (+5đ): Khóa lãi tối thiểu +2đ
    if (grossPnL >= 5.0) {
      _state.tp1Hit = true;
      _state.trailingStop = Math.max(_state.trailingStop || 0, _state.entryPrice + 2.0);
    }
    // Lãi >= 8đ: Khóa lãi tối thiểu +5đ
    if (grossPnL >= 8.0) {
      _state.trailingStop = Math.max(_state.trailingStop || 0, _state.entryPrice + 5.0);
    }

    const isExitTime = (vnTime.getHours() === 14 && vnTime.getMinutes() >= 25);

    // 1. DÍNH STOP LOSS HOẶC CHẶN LÃI
    if (currentPrice <= _state.stopLoss || (_state.trailingStop && currentPrice <= _state.trailingStop)) {
      if (grossPnL < 0) {
        actionDecision = 'STOP_LOSS_LONG';
        actionTitle = `🛑 CẮT LỖ LONG TẠM ĐỨNG NGOÀI (${grossPnL}đ | Net: ${netPnL}đ)`;
        actionAdvice = `Giá chạm ngưỡng cắt lỗ (${currentPrice} <= ${_state.stopLoss}). Dứt khoát cắt lỗ bảo vệ tài khoản, tạm đứng ngoài quan sát!`;
        _state.status = 'STOP_LOSS_LONG';
        _state.statusLabel = actionTitle;
        await closeCurrentPosition(currentPrice, 'Dính Stop Loss cắt lỗ', timeStr);
      } else {
        actionDecision = 'CLOSE_PRESERVE';
        actionTitle = `🛡️ ĐÓNG LONG CHẶN LÃI (+${grossPnL}đ | Net: +${netPnL}đ)`;
        actionAdvice = `Giá điều chỉnh chạm mốc chặn lãi (${_state.trailingStop}đ). Chủ động đóng lệnh bảo toàn lợi nhuận, tạm đứng ngoài!`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
        await closeCurrentPosition(currentPrice, 'Chạm mốc chặn lãi bảo toàn lợi nhuận', timeStr);
      }
    }
    // 2. TẤT TOÁN TRƯỚC ATC (14h25)
    else if (isExitTime) {
      actionDecision = 'CLOSE_END_OF_DAY';
      actionTitle = `🌙 TẤT TOÁN LONG TRƯỚC ATC (${grossPnL >= 0 ? '+' : ''}${grossPnL}đ | Net: ${netPnL >= 0 ? '+' : ''}${netPnL}đ)`;
      actionAdvice = `Đã đến 14h25 cuối phiên. Tất toán toàn bộ vị thế Long đưa tài khoản về Flat (tiền mặt) tránh biến động bất ngờ trong ATC.`;
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = actionTitle;
      await closeCurrentPosition(currentPrice, 'Tất toán trước ATC bảo vệ tài khoản', timeStr);
    }
    // 3. ĐẠT TARGET TP2 (+8đ ĐẾN +10đ) & CÓ TÍN HIỆU ĐẢO CHIỀU NẾN / GẶP CẢN
    else if (grossPnL >= 10.0 || (grossPnL >= 8.0 && (bearScore >= 45 || m5.latestCandle?.upperWick > 1.2))) {
      actionDecision = 'TAKE_PROFIT_LONG';
      actionTitle = `🎯 CHỐT LỜI LONG TP2 (+${grossPnL}đ | Net: +${netPnL}đ)`;
      actionAdvice = `Đạt target chốt lời lớn TP2 (+${grossPnL}đ, Net +${netPnL}đ). Chủ động hiện thực hóa lợi nhuận, đưa tài khoản về an toàn!`;
      _state.status = 'TAKE_PROFIT_LONG';
      _state.statusLabel = actionTitle;
      await closeCurrentPosition(currentPrice, 'Chốt lời TP2 target thành công', timeStr);
    }
    // 4. XÁC NHẬN ĐẢO CHIỀU GÃY XU HƯỚNG MẠNH (ĐÓNG LONG ĐẢO SHORT)
    else if (bearScore >= 65 && bearScore > bullScore * 1.6 && structure.isLowerHighs && structure.isLowerLows) {
      await closeCurrentPosition(currentPrice, 'Đảo chiều gãy xu hướng sang Short', timeStr);

      if ((_state.todayTrades || []).length < 4) {
        const orderNum = (_state.todayTrades || []).length + 1;
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
        _state.currentNetPnL = -0.6;
        _state.maxPnL = 0;
        _state.minPnL = 0;
        _state.holdingBars = 1;
        _state.breakevenActive = false;
        _state.tp1Hit = false;

        actionDecision = 'REVERSE_LONG_TO_SHORT';
        actionTitle = `🔄 ĐÓNG LONG ĐẢO SHORT (Chốt Long ${grossPnL >= 0 ? '+' : ''}${grossPnL}đ ➔ Đảo Short @ ${currentPrice})`;
        actionAdvice = `Thị trường gãy hỗ trợ và hạ đỉnh hạ đáy rõ nét. Đã đóng sạch Long và đảo ngay vị thế SHORT mới!`;
        tradePlan = {
          action: 'MỞ SHORT (ĐẢO CHIỀU)',
          entry: currentPrice,
          sl: _state.stopLoss,
          tp1: _state.takeProfit1,
          tp2: _state.takeProfit2,
          trailing: _state.trailingStop,
        };
      } else {
        actionDecision = 'CLOSE_LONG';
        actionTitle = `🛡️ ĐÓNG LONG (${grossPnL >= 0 ? '+' : ''}${grossPnL}đ) ➔ ĐÃ ĐỦ 4 LỆNH, ĐỨNG NGOÀI`;
        actionAdvice = `Đã chốt Long bảo toàn lợi nhuận. Tài khoản đã đạt chỉ tiêu 4 lệnh trong ngày nên đứng ngoài quan sát!`;
      }
    }
    // 5. TIẾP TỤC GIỮ LỆNH LONG (Maintain Position Memory)
    else {
      actionDecision = 'HOLD_LONG';
      let holdTag = '';
      if (_state.trailingStop && _state.trailingStop > _state.entryPrice) {
        holdTag = ` — ĐÃ KHÓA LÃI ${_state.trailingStop}đ 🛡️`;
      } else if (_state.breakevenActive) {
        holdTag = ` — ĐÃ HÒA VỐN 🛡️`;
      }

      actionTitle = `🟢 GIỮ LONG (${grossPnL >= 0 ? '+' : ''}${grossPnL}đ | Net: ${netPnL >= 0 ? '+' : ''}${netPnL}đ${holdTag})`;
      actionAdvice = `Tiếp tục nắm giữ vị thế Long mở từ ${_state.entryPrice} (${_state.entryTime}). ${
        _state.trailingStop ? `Chặn lãi bảo vệ tại ${_state.trailingStop}đ.` : `Cắt lỗ tại ${_state.stopLoss}đ.`
      } Kiên định tuân thủ kế hoạch!`;

      _state.status = 'HOLD_LONG';
      _state.statusLabel = actionTitle;
      tradePlan = {
        action: 'GIỮ LONG',
        entry: _state.entryPrice,
        sl: _state.stopLoss,
        trailing: _state.trailingStop,
        tp1: _state.takeProfit1,
        tp2: _state.takeProfit2,
        grossPnL,
        netPnL,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TRƯỜNG HỢP 3: AI ĐANG GIỮ LỆNH SHORT (position === 'SHORT')
  // ═══════════════════════════════════════════════════════════
  else if (_state.position === 'SHORT') {
    const grossPnL = +(_state.entryPrice - currentPrice).toFixed(1);
    const netPnL = +(grossPnL - googleSheetService.FEE_PER_TRADE).toFixed(1);
    _state.currentPnL = grossPnL;
    _state.currentNetPnL = netPnL;
    _state.maxPnL = Math.max(_state.maxPnL || 0, grossPnL);
    _state.minPnL = Math.min(_state.minPnL || 0, grossPnL);
    _state.holdingBars = (_state.holdingBars || 0) + 1;

    // Quản trị vốn: Dời SL về hòa vốn khi lãi >= 3.5đ
    if (grossPnL >= 3.5 && !_state.breakevenActive) {
      _state.stopLoss = Math.min(_state.stopLoss || 99999, _state.entryPrice);
      _state.trailingStop = Math.min(_state.trailingStop || 99999, _state.entryPrice);
      _state.breakevenActive = true;
    }
    // Đạt TP1 (+5đ): Khóa lãi tối thiểu +2đ
    if (grossPnL >= 5.0) {
      _state.tp1Hit = true;
      _state.trailingStop = Math.min(_state.trailingStop || 99999, _state.entryPrice - 2.0);
    }
    // Lãi >= 8đ: Khóa lãi tối thiểu +5đ
    if (grossPnL >= 8.0) {
      _state.trailingStop = Math.min(_state.trailingStop || 99999, _state.entryPrice - 5.0);
    }

    const isExitTime = (vnTime.getHours() === 14 && vnTime.getMinutes() >= 25);

    // 1. DÍNH STOP LOSS HOẶC CHẶN LÃI
    if (currentPrice >= _state.stopLoss || (_state.trailingStop && currentPrice >= _state.trailingStop)) {
      if (grossPnL < 0) {
        actionDecision = 'STOP_LOSS_SHORT';
        actionTitle = `🛑 CẮT LỖ SHORT TẠM ĐỨNG NGOÀI (${grossPnL}đ | Net: ${netPnL}đ)`;
        actionAdvice = `Giá chạm ngưỡng cắt lỗ (${currentPrice} >= ${_state.stopLoss}). Dứt khoát cắt lỗ bảo vệ tài khoản, tạm đứng ngoài quan sát!`;
        _state.status = 'STOP_LOSS_SHORT';
        _state.statusLabel = actionTitle;
        await closeCurrentPosition(currentPrice, 'Dính Stop Loss cắt lỗ', timeStr);
      } else {
        actionDecision = 'CLOSE_PRESERVE';
        actionTitle = `🛡️ ĐÓNG SHORT CHẶN LÃI (+${grossPnL}đ | Net: +${netPnL}đ)`;
        actionAdvice = `Giá hồi phục chạm mốc chặn lãi (${_state.trailingStop}đ). Chủ động đóng lệnh bảo toàn lợi nhuận, tạm đứng ngoài!`;
        _state.status = 'STAND_ASIDE';
        _state.statusLabel = actionTitle;
        await closeCurrentPosition(currentPrice, 'Chạm mốc chặn lãi bảo toàn lợi nhuận', timeStr);
      }
    }
    // 2. TẤT TOÁN TRƯỚC ATC (14h25)
    else if (isExitTime) {
      actionDecision = 'CLOSE_END_OF_DAY';
      actionTitle = `🌙 TẤT TOÁN SHORT TRƯỚC ATC (${grossPnL >= 0 ? '+' : ''}${grossPnL}đ | Net: ${netPnL >= 0 ? '+' : ''}${netPnL}đ)`;
      actionAdvice = `Đã đến 14h25 cuối phiên. Tất toán toàn bộ vị thế Short đưa tài khoản về Flat (tiền mặt) tránh biến động bất ngờ trong ATC.`;
      _state.status = 'STAND_ASIDE';
      _state.statusLabel = actionTitle;
      await closeCurrentPosition(currentPrice, 'Tất toán trước ATC bảo vệ tài khoản', timeStr);
    }
    // 3. ĐẠT TARGET TP2 (+8đ ĐẾN +10đ) & CÓ TÍN HIỆU ĐẢO CHIỀU NẾN / GẶP HỖ TRỢ
    else if (grossPnL >= 10.0 || (grossPnL >= 8.0 && (bullScore >= 45 || m5.latestCandle?.lowerWick > 1.2))) {
      actionDecision = 'TAKE_PROFIT_SHORT';
      actionTitle = `🎯 CHỐT LỜI SHORT TP2 (+${grossPnL}đ | Net: +${netPnL}đ)`;
      actionAdvice = `Đạt target chốt lời lớn TP2 (+${grossPnL}đ, Net +${netPnL}đ). Chủ động hiện thực hóa lợi nhuận, đưa tài khoản về an toàn!`;
      _state.status = 'TAKE_PROFIT_SHORT';
      _state.statusLabel = actionTitle;
      await closeCurrentPosition(currentPrice, 'Chốt lời TP2 target thành công', timeStr);
    }
    // 4. XÁC NHẬN ĐẢO CHIỀU NÂNG ĐÁY MẠNH (ĐÓNG SHORT ĐẢO LONG)
    else if (bullScore >= 65 && bullScore > bearScore * 1.6 && structure.isHigherHighs && structure.isHigherLows) {
      await closeCurrentPosition(currentPrice, 'Đảo chiều nâng đáy sang Long', timeStr);

      if ((_state.todayTrades || []).length < 4) {
        const orderNum = (_state.todayTrades || []).length + 1;
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
        _state.currentNetPnL = -0.6;
        _state.maxPnL = 0;
        _state.minPnL = 0;
        _state.holdingBars = 1;
        _state.breakevenActive = false;
        _state.tp1Hit = false;

        actionDecision = 'REVERSE_SHORT_TO_LONG';
        actionTitle = `🔄 ĐÓNG SHORT ĐẢO LONG (Chốt Short ${grossPnL >= 0 ? '+' : ''}${grossPnL}đ ➔ Đảo Long @ ${currentPrice})`;
        actionAdvice = `Thị trường xuất hiện lực cầu lớn nâng đáy vượt cản rõ nét. Đã đóng sạch Short và đảo ngay vị thế LONG mới!`;
        tradePlan = {
          action: 'MỞ LONG (ĐẢO CHIỀU)',
          entry: currentPrice,
          sl: _state.stopLoss,
          tp1: _state.takeProfit1,
          tp2: _state.takeProfit2,
          trailing: _state.trailingStop,
        };
      } else {
        actionDecision = 'CLOSE_SHORT';
        actionTitle = `🛡️ ĐÓNG SHORT (${grossPnL >= 0 ? '+' : ''}${grossPnL}đ) ➔ ĐÃ ĐỦ 4 LỆNH, ĐỨNG NGOÀI`;
        actionAdvice = `Đã chốt Short bảo toàn lợi nhuận. Tài khoản đã đạt chỉ tiêu 4 lệnh trong ngày nên đứng ngoài quan sát!`;
      }
    }
    // 5. TIẾP TỤC GIỮ LỆNH SHORT (Maintain Position Memory)
    else {
      actionDecision = 'HOLD_SHORT';
      let holdTag = '';
      if (_state.trailingStop && _state.trailingStop < _state.entryPrice) {
        holdTag = ` — ĐÃ KHÓA LÃI ${_state.trailingStop}đ 🛡️`;
      } else if (_state.breakevenActive) {
        holdTag = ` — ĐÃ HÒA VỐN 🛡️`;
      }

      actionTitle = `🔴 GIỮ SHORT (${grossPnL >= 0 ? '+' : ''}${grossPnL}đ | Net: ${netPnL >= 0 ? '+' : ''}${netPnL}đ${holdTag})`;
      actionAdvice = `Tiếp tục nắm giữ vị thế Short mở từ ${_state.entryPrice} (${_state.entryTime}). ${
        _state.trailingStop ? `Chặn lãi bảo vệ tại ${_state.trailingStop}đ.` : `Cắt lỗ tại ${_state.stopLoss}đ.`
      } Kiên định tuân thủ kế hoạch!`;

      _state.status = 'HOLD_SHORT';
      _state.statusLabel = actionTitle;
      tradePlan = {
        action: 'GIỮ SHORT',
        entry: _state.entryPrice,
        sl: _state.stopLoss,
        trailing: _state.trailingStop,
        tp1: _state.takeProfit1,
        tp2: _state.takeProfit2,
        grossPnL,
        netPnL,
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
function formatIntradaySignal(result, m15, m5, m1, structure, liquidity, smartMoney, contextInfo) {
  const { title, advice, bullScore, bearScore, reasons, warnings, tradePlan, state } = result;

  const tradeCount = (state.todayTrades || []).length;
  const currentTradeNum = state.position && state.position !== 'NONE' ? tradeCount + 1 : tradeCount;

  let msg = `🤖 <b>AI TRADER: ${title}</b>\n`;
  msg += `🕐 <i>${dataFetcher.vnNow()}</i> | Noti #${state.signalCount || 1} | Lệnh #${currentTradeNum}/4\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. Giá hiện tại & Basis
  const basisText = contextInfo?.basis ? `${contextInfo.basis.basis >= 0 ? '+' : ''}${contextInfo.basis.basis}đ` : 'N/A';
  msg += `📍 <b>F1M: ${m5.currentPrice || 'N/A'}</b> | VN30: <b>${contextInfo?.vn30Price || 'N/A'}</b> | Basis: <b>${basisText}</b>\n\n`;

  // 2. VỊ THẾ HIỆN TẠI (POSITION MEMORY NHƯ NGƯỜI THẬT)
  msg += `🎯 <b>VỊ THẾ & TRẠNG THÁI AI TRADER:</b>\n`;
  if (state.position && state.position !== 'NONE') {
    const posEmoji = state.position === 'LONG' ? '🟢' : '🔴';
    const grossPnL = state.currentPnL !== undefined ? state.currentPnL : 0;
    const netPnL = state.currentNetPnL !== undefined ? state.currentNetPnL : +(grossPnL - googleSheetService.FEE_PER_TRADE).toFixed(1);
    const grossEmoji = grossPnL >= 0 ? '🟢' : '🔴';
    const netEmoji = netPnL >= 0 ? '🟢' : '🔴';

    msg += `  • Vị thế: ${posEmoji} <b>${state.position}</b> (Lệnh #${currentTradeNum}/4 lệnh tối đa)\n`;
    msg += `  • Điểm vào: <b>${state.entryPrice}</b> (Khớp lúc <b>${state.entryTime || 'N/A'}</b>)\n`;
    msg += `  • Giá F1M hiện tại: <b>${m5.currentPrice}</b>\n`;
    msg += `  • Lãi/Lỗ thô (Gross): <b>${grossEmoji} ${grossPnL >= 0 ? '+' : ''}${grossPnL.toFixed(1)}đ</b>\n`;
    msg += `  • Phí mở + đóng: <b>-0.6đ</b>\n`;
    msg += `  • <b>LÃI/LỖ THỰC TẾ (NET):</b> <b>${netEmoji} ${netPnL >= 0 ? '+' : ''}${netPnL.toFixed(1)}đ</b>\n`;
    msg += `  • Cắt lỗ (SL): <b>${state.stopLoss}</b> (MTL)${state.breakevenActive ? ' 🛡️ <i>(Đã dời về hòa vốn)</i>' : ''}\n`;
    if (state.trailingStop && state.trailingStop !== state.stopLoss) {
      msg += `  • Chặn lãi (Trailing): <b>${state.trailingStop}</b> 🛡️ <i>(Khóa bảo vệ lợi nhuận)</i>\n`;
    }
    msg += `  • Mục tiêu: <b>TP1: ${state.takeProfit1}</b> | <b>TP2: ${state.takeProfit2}</b>\n\n`;
  } else {
    msg += `  • Vị thế: ⚪ <b>TRỐNG LỆNH (ĐỨNG NGOÀI)</b>\n`;
    msg += `  • Lượt giao dịch: <b>${tradeCount}/4 lệnh trong ngày</b>\n`;
    if (state.todayTrades && state.todayTrades.length > 0) {
      const last = state.todayTrades[state.todayTrades.length - 1];
      const resEmoji = last.netPnL > 0 ? '🟢' : (last.netPnL === 0 ? '🟡' : '🔴');
      msg += `  • Lệnh gần nhất: ${resEmoji} <b>${last.type} @ ${last.entryPrice} (${last.entryTime}) ➔ ${last.exitPrice} (${last.exitTime})</b>\n`;
      msg += `     └ Thô: <b>${last.grossPnL >= 0 ? '+' : ''}${last.grossPnL}đ</b> | Phí: <b>-0.6đ</b> | Thực nhận: <b>${last.netPnL >= 0 ? '+' : ''}${last.netPnL}đ</b> [${last.resultLabel}] (${last.reason})\n`;
    }
    msg += `\n`;
  }

  // 3. Cấu trúc thị trường & Đa khung 15p - 5p - 1p
  msg += `📊 <b>CẤU TRÚC THỊ TRƯỜNG & ĐA KHUNG (15M - 5M - 1M):</b>\n`;
  const m15Emoji = m15.signal === 'BULLISH' ? '🟢' : m15.signal === 'BEARISH' ? '🔴' : '🟡';
  const m5Emoji = m5.entrySignal.includes('LONG') ? '🟢' : m5.entrySignal.includes('SHORT') ? '🔴' : '🟡';
  const m1Emoji = m1.signal === 'BULLISH' ? '🟢' : m1.signal === 'BEARISH' ? '🔴' : '🟡';

  msg += `  ${m15Emoji} 15p: ${m15.description}\n`;
  msg += `  ${m5Emoji} 5p: ${m5.description}\n`;
  msg += `  ${m1Emoji} 1p: ${m1.description}\n`;
  msg += `  📈 <b>Cấu trúc:</b> ${structure.structureTag}\n`;
  if (structure.swingHighDesc) msg += `     • ${structure.swingHighDesc}\n`;
  if (structure.swingLowDesc) msg += `     • ${structure.swingLowDesc}\n`;
  msg += `\n`;

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
    if (tradePlan.grossPnL !== undefined) {
      const pnlEmoji = tradePlan.grossPnL >= 0 ? '🟢' : '🔴';
      msg += `  💰 Điểm thô: <b>${pnlEmoji} ${tradePlan.grossPnL >= 0 ? '+' : ''}${tradePlan.grossPnL}đ</b> | Thực nhận sau phí: <b>${tradePlan.netPnL >= 0 ? '+' : ''}${tradePlan.netPnL}đ</b>\n`;
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
    msg += `⚠️ <b>LƯU Ý RỦI RO & KỶ LUẬT:</b>\n`;
    warnings.forEach(w => { msg += `  • ${w}\n`; });
    msg += `\n`;
  }

  // Hiệu suất hôm nay
  const dayNetPnl = state.totalNetPnLToday !== undefined ? state.totalNetPnLToday : (state.totalPnLToday || 0);
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 <i>Hiệu suất hôm nay: <b>${tradeCount}/4 lệnh</b> | <b>Net PnL: ${dayNetPnl >= 0 ? '🟢 +' : '🔴 '}${dayNetPnl.toFixed(1)}đ</b> (${state.winTrades || 0}W - ${state.lossTrades || 0}L)</i>\n`;
  msg += `💡 <i>Phí 0.6đ/lệnh | Dữ liệu tự động đồng bộ Google Sheets Nhật ký</i>\n`;
  msg += `<i>⚡ Senior Trader AI Trading Engine v8.2 | VN Stock Bot</i>`;

  return msg;
}

// ─── RUN INTRADAY SIGNAL JOB ─────────────────────────────────
async function runIntradaySignal() {
  if (!isCurrentInstanceActive()) return;

  const startTime = Date.now();

  try {
    // Fetch dữ liệu song song 15m, 5m, 1m (bỏ khung 1H vì phiên VN30F chỉ 3-4 tiếng)
    const [m15Data, m5Data, m1Data, oiData, futuresPrice, vn30Price, liquidityInfo] = await Promise.all([
      dataFetcher.fetchOHLCV('VN30F1M', '15', 3),
      dataFetcher.fetchOHLCV('VN30F1M', '5', 2),
      dataFetcher.fetchOHLCV('VN30F1M', '1', 1),
      dataFetcher.fetchDerivativesOIData(),
      dataFetcher.fetchRealtimeFuturesPrice(),
      dataFetcher.fetchRealtimeVN30Price(),
      calculateMarketLiquiditySpeed(),
    ]);

    // Phân tích kỹ thuật đa khung: 15p (xu hướng lớn) - 5p (setup) - 1p (micro-timing)
    const m15Analysis = analyze15mTimeframe(m15Data);
    const m5Analysis = analyze5mTimeframe(m5Data, m15Analysis.signal);
    const m1Analysis = analyze1mTimeframe(m1Data, m5Analysis.entrySignal);

    // Cấu trúc thị trường Swing High/Low
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

    // AI Trader ra quyết định theo Đa khung 15p - 5p - 1p (Async)
    const traderResult = await makeAITraderDecision(
      m15Analysis,
      m5Analysis,
      m1Analysis,
      structureInfo,
      liquidityInfo,
      smartMoneyInfo,
      contextInfo
    );

    // Format & send tin nhắn Telegram
    const msg = formatIntradaySignal(
      traderResult,
      m15Analysis,
      m5Analysis,
      m1Analysis,
      structureInfo,
      liquidityInfo,
      smartMoneyInfo,
      contextInfo
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

// ─── TỔNG KẾT NHẬT KÝ GIAO DỊCH CUỐI NGÀY ────────────────────
/**
 * Chạy cuối ngày (sau phiên ATC, 14h44):
 * 1. Đóng vị thế còn mở (nếu có) theo giá ATC
 * 2. Lưu tổng kết ngày vào Google Sheets & trades_history.json
 * 3. Gửi tin nhắn Telegram Báo Cáo Nhật Ký Giao Dịch
 */
async function generateAndSendDailyReport() {
  const vnTime = dataFetcher.getVnTime();
  const todayStr = `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()}`;
  _state = loadAIPositionState();

  // 1. Nếu còn vị thế mở, đóng tại giá hiện tại / ATC
  if (_state.position && _state.position !== 'NONE') {
    let lastPrice = _state.entryPrice;
    try {
      const fut = await dataFetcher.fetchRealtimeFuturesPrice();
      if (fut && fut.price) lastPrice = fut.price;
    } catch (e) { /* ignore */ }
    const timeStr = `${String(vnTime.getHours()).padStart(2, '0')}:${String(vnTime.getMinutes()).padStart(2, '0')}:${String(vnTime.getSeconds()).padStart(2, '0')}`;
    await closeCurrentPosition(lastPrice, 'Tất toán cuối ngày (ATC)', timeStr);
  }

  const trades = _state.todayTrades || [];
  const totalTrades = trades.length;
  const winTrades = _state.winTrades || 0;
  const lossTrades = _state.lossTrades || 0;
  const totalGrossPnL = _state.totalGrossPnLToday || 0;
  const totalFees = +(totalTrades * googleSheetService.FEE_PER_TRADE).toFixed(1);
  const totalNetPnL = _state.totalNetPnLToday || 0;

  const summary = {
    date: todayStr,
    totalTrades,
    winTrades,
    lossTrades,
    totalGrossPnL,
    totalFees,
    totalNetPnL,
  };

  // 2. Ghi nhận Daily Summary vào Google Sheets & local JSON
  const dailyRecord = await googleSheetService.logDailySummary(summary);

  // 3. Format tin nhắn Telegram
  const reportMsg = googleSheetService.formatDailyTradingReport(dailyRecord, trades);

  // 4. Gửi Telegram
  await sendDerivativesMessage(reportMsg);
  console.log(`   📊 [Daily Report] Đã gửi báo cáo tổng kết ngày ${todayStr} lên Telegram & Google Sheets`);

  return { summary: dailyRecord, trades };
}

// ─── AI-ENHANCED SIGNAL ──────────────────────────────────────
async function runAIEnhancedSignal() {
  return runIntradaySignal();
}

module.exports = {
  runIntradaySignal,
  runAIEnhancedSignal,
  generateAndSendDailyReport,
  closeCurrentPosition,
  resetIntradayState,
  loadAIPositionState,
  saveAIPositionState,
  calculateMarketLiquiditySpeed,
  analyzeMarketStructureFromCandles,
  analyze15mTimeframe,
  analyze5mTimeframe,
  analyze1mTimeframe,
  makeAITraderDecision,
  formatIntradaySignal,
  getState: () => ({ ..._state }),
};
