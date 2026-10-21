/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🌙 VN30F v7.0 — Evening Plan Engine (19h50)                 ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Báo cáo chiến lược cho PHIÊN TIẾP THEO sau khi có data      ║
 * ║  kết phiên hôm nay. Chạy 19h50 T2-CN (chỉ ngày có giao dịch)║
 * ║                                                                ║
 * ║  PHÂN TÍCH:                                                    ║
 * ║  • Multi-timeframe S/R (1W, 1D, 1H, 15m)                     ║
 * ║  • Hỗ trợ gần nhất, S2, S3 (nhúng/thủng/rút chân)            ║
 * ║  • 2 kháng cự gần nhất                                        ║
 * ║  • Hành vi giá trong phiên (nến ngày, range, gap)              ║
 * ║  • Vị thế qua đêm: NN, Tự doanh, Cá nhân                     ║
 * ║  • Dòng tiền thông minh (Smart Money Flow)                     ║
 * ║  • OI change, F1 liquidity, Basis cuối phiên                  ║
 * ║  • Trend prediction cho phiên tiếp theo                        ║
 * ║  • Chiến lược mở vị thế ATO: gap up/down/tham chiếu           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');
const dataFetcher = require('./dataFetcher');
const marketStructure = require('./marketStructure');
const marketContext = require('./marketContext');
const oiTracker = require('./oiTracker');
const { sendDerivativesMessage } = require('../telegramService');

// ─── MULTI-TIMEFRAME SUPPORT / RESISTANCE ─────────────────────
/**
 * Tính hỗ trợ / kháng cự từ nhiều khung thời gian
 * Kết hợp: Pivot Points (PP, S1-S3, R1-R3) + Swing High/Low + Volume Profile
 */
function calculatePivotLevels(high, low, close) {
  const pp = (high + low + close) / 3;
  return {
    pp: +pp.toFixed(1),
    r1: +(2 * pp - low).toFixed(1),
    r2: +(pp + (high - low)).toFixed(1),
    r3: +(high + 2 * (pp - low)).toFixed(1),
    s1: +(2 * pp - high).toFixed(1),
    s2: +(pp - (high - low)).toFixed(1),
    s3: +(low - 2 * (high - pp)).toFixed(1),
  };
}

/**
 * Phân tích hỗ trợ/kháng cự đa khung thời gian
 * @param {Object} dailyData - Daily OHLCV data (30 phiên)
 * @param {Object} hourlyData - 1H OHLCV data
 * @param {Object} m15Data - 15m OHLCV data
 * @param {number} currentPrice - Giá hiện tại
 */
function buildMultiTimeframeSR(dailyData, weeklyCandles, hourlyData, m15Data, currentPrice) {
  const result = {
    weekly: null,
    daily: null,
    hourly: null,
    m15: null,
    supports: [],
    resistances: [],
    keyLevels: [],
  };

  // ── 1. WEEKLY PIVOT ──────────────────────────────────
  if (weeklyCandles && weeklyCandles.length > 0) {
    const last = weeklyCandles[weeklyCandles.length - 1];
    result.weekly = calculatePivotLevels(last.high, last.low, last.close);
    result.weekly.label = 'Tuần';
    result.weekly.range = { high: last.high, low: last.low, close: last.close };
  }

  // ── 2. DAILY PIVOT (phiên hôm nay → pivot cho ngày mai) ────
  if (dailyData && dailyData.c && dailyData.c.length >= 2) {
    const len = dailyData.c.length;
    const h = dailyData.h ? dailyData.h[len - 1] : dailyData.c[len - 1];
    const l = dailyData.l ? dailyData.l[len - 1] : dailyData.c[len - 1];
    const c = dailyData.c[len - 1];
    result.daily = calculatePivotLevels(h, l, c);
    result.daily.label = 'Ngày';
    result.daily.range = { high: h, low: l, close: c };

    // Lấy thêm 2 phiên trước để xác định vùng tích lũy / đáy lặp
    const prevHighs = [];
    const prevLows = [];
    for (let i = Math.max(0, len - 5); i < len; i++) {
      prevHighs.push(dailyData.h ? dailyData.h[i] : dailyData.c[i]);
      prevLows.push(dailyData.l ? dailyData.l[i] : dailyData.c[i]);
    }
    result.daily.fiveDayHigh = Math.max(...prevHighs);
    result.daily.fiveDayLow = Math.min(...prevLows);
  }

  // ── 3. HOURLY PIVOT ─────────────────────────────────
  if (hourlyData && hourlyData.c && hourlyData.c.length >= 3) {
    const len = hourlyData.c.length;
    const h = hourlyData.h ? Math.max(...hourlyData.h.slice(-5)) : Math.max(...hourlyData.c.slice(-5));
    const l = hourlyData.l ? Math.min(...hourlyData.l.slice(-5)) : Math.min(...hourlyData.c.slice(-5));
    const c = hourlyData.c[len - 1];
    result.hourly = calculatePivotLevels(h, l, c);
    result.hourly.label = '1H';
    result.hourly.range = { high: h, low: l, close: c };
  }

  // ── 4. 15-MINUTE PIVOT ──────────────────────────────
  if (m15Data && m15Data.c && m15Data.c.length >= 5) {
    const len = m15Data.c.length;
    const recentBars = 8; // 8 bars gần nhất (2 giờ gần nhất)
    const start = Math.max(0, len - recentBars);
    const h = m15Data.h ? Math.max(...m15Data.h.slice(start)) : Math.max(...m15Data.c.slice(start));
    const l = m15Data.l ? Math.min(...m15Data.l.slice(start)) : Math.min(...m15Data.c.slice(start));
    const c = m15Data.c[len - 1];
    result.m15 = calculatePivotLevels(h, l, c);
    result.m15.label = '15p';
  }

  // ── 5. TẬP HỢP VÀ XẾP HẠNG ─────────────────────────
  if (currentPrice) {
    const allLevels = [];

    for (const tf of ['weekly', 'daily', 'hourly', 'm15']) {
      const pivot = result[tf];
      if (!pivot) continue;
      const weight = tf === 'weekly' ? 4 : tf === 'daily' ? 3 : tf === 'hourly' ? 2 : 1;

      // Supports
      for (const key of ['s1', 's2', 's3']) {
        if (pivot[key] && pivot[key] < currentPrice) {
          allLevels.push({ price: pivot[key], type: 'SUPPORT', tf: pivot.label, key, weight });
        }
      }
      // Resistances
      for (const key of ['r1', 'r2', 'r3']) {
        if (pivot[key] && pivot[key] > currentPrice) {
          allLevels.push({ price: pivot[key], type: 'RESISTANCE', tf: pivot.label, key, weight });
        }
      }
    }

    // Sort supports: gần nhất trước, weight cao hơn ưu tiên
    result.supports = allLevels
      .filter(l => l.type === 'SUPPORT')
      .sort((a, b) => {
        const distA = Math.abs(currentPrice - a.price);
        const distB = Math.abs(currentPrice - b.price);
        return distA - distB || b.weight - a.weight;
      })
      .slice(0, 5);

    // Sort resistances: gần nhất trước
    result.resistances = allLevels
      .filter(l => l.type === 'RESISTANCE')
      .sort((a, b) => {
        const distA = Math.abs(currentPrice - a.price);
        const distB = Math.abs(currentPrice - b.price);
        return distA - distB || b.weight - a.weight;
      })
      .slice(0, 5);

    // Key levels = confluence (vùng nhiều khung thời gian hội tụ)
    const priceBuckets = {};
    for (const l of allLevels) {
      const bucket = Math.round(l.price / 2) * 2; // nhóm ±2đ
      if (!priceBuckets[bucket]) priceBuckets[bucket] = { price: l.price, count: 0, weight: 0, types: [], tfs: [] };
      priceBuckets[bucket].count++;
      priceBuckets[bucket].weight += l.weight;
      if (!priceBuckets[bucket].types.includes(l.type)) priceBuckets[bucket].types.push(l.type);
      if (!priceBuckets[bucket].tfs.includes(l.tf)) priceBuckets[bucket].tfs.push(l.tf);
    }
    result.keyLevels = Object.values(priceBuckets)
      .filter(b => b.count >= 2 || b.weight >= 5)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);
  }

  return result;
}

// ─── PHÂN TÍCH HÀNH VI GIÁ TRONG PHIÊN ─────────────────────
/**
 * Đọc hành vi giá ngày hôm nay: pattern nến ngày, nhúng/thủng/rút chân, range
 */
function analyzeDailyPriceAction(dailyData) {
  if (!dailyData || !dailyData.c || dailyData.c.length < 3) return null;

  const len = dailyData.c.length;
  const today = {
    o: dailyData.o ? dailyData.o[len - 1] : dailyData.c[len - 1],
    h: dailyData.h ? dailyData.h[len - 1] : dailyData.c[len - 1],
    l: dailyData.l ? dailyData.l[len - 1] : dailyData.c[len - 1],
    c: dailyData.c[len - 1],
    v: dailyData.v ? dailyData.v[len - 1] : 0,
  };
  const prevClose = dailyData.c[len - 2];

  const body = Math.abs(today.c - today.o);
  const upperWick = today.h - Math.max(today.o, today.c);
  const lowerWick = Math.min(today.o, today.c) - today.l;
  const range = today.h - today.l;
  const change = today.c - prevClose;
  const changePct = prevClose ? ((change / prevClose) * 100) : 0;
  const isGreen = today.c >= today.o;
  const isBullish = today.c > prevClose;

  // Xác định pattern nến ngày
  let candlePattern = '';
  let candleSignal = 'NEUTRAL';

  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    candlePattern = isGreen ? '🔨 Hammer (nến búa tăng)' : '🔨 Hanging Man (treo cổ)';
    candleSignal = isGreen ? 'BULLISH' : 'BEARISH';
  } else if (upperWick > body * 2 && lowerWick < body * 0.5) {
    candlePattern = '🌠 Shooting Star (sao băng giảm)';
    candleSignal = 'BEARISH';
  } else if (body < range * 0.1) {
    candlePattern = '➕ Doji (do dự giằng co)';
    candleSignal = 'NEUTRAL';
  } else if (body > range * 0.7) {
    candlePattern = isGreen ? '🟢 Marubozu xanh (lực mua áp đảo)' : '🔴 Marubozu đỏ (lực bán áp đảo)';
    candleSignal = isGreen ? 'BULLISH' : 'BEARISH';
  } else {
    candlePattern = isGreen ? '🟢 Nến xanh' : '🔴 Nến đỏ';
    candleSignal = isGreen ? 'MILD_BULLISH' : 'MILD_BEARISH';
  }

  // Phân tích nhúng/thủng
  // Xem nến hôm nay có nhúng xuống dưới low hôm trước rồi rút chân không
  const prevLow = dailyData.l ? dailyData.l[len - 2] : dailyData.c[len - 2];
  const prevHigh = dailyData.h ? dailyData.h[len - 2] : dailyData.c[len - 2];
  const breachLow = today.l < prevLow;
  const recoverFromLow = breachLow && today.c > prevLow; // Thủng rồi rút chân
  const breakoutHigh = today.h > prevHigh;
  const failBreakout = breakoutHigh && today.c < prevHigh; // Phá rồi quay lại

  // Volume so với trung bình 5 phiên
  let volRatio = 0;
  if (dailyData.v && dailyData.v.length >= 5) {
    const avg5Vol = dailyData.v.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
    volRatio = avg5Vol > 0 ? +(today.v / avg5Vol).toFixed(2) : 0;
  }

  return {
    today,
    prevClose,
    body: +body.toFixed(1),
    range: +range.toFixed(1),
    upperWick: +upperWick.toFixed(1),
    lowerWick: +lowerWick.toFixed(1),
    change: +change.toFixed(1),
    changePct: +changePct.toFixed(2),
    isGreen,
    isBullish,
    candlePattern,
    candleSignal,
    breachLow,
    recoverFromLow,
    breakoutHigh,
    failBreakout,
    volRatio,
    volLabel: volRatio > 1.3 ? 'Đột biến ↑' : volRatio < 0.7 ? 'Teo tóp ↓' : 'Bình thường',
  };
}

// ─── SMART MONEY OVERNIGHT POSITIONING ──────────────────────
/**
 * Phân tích vị thế qua đêm của dòng tiền thông minh
 * Dựa trên OI data cuối phiên
 */
function analyzeSmartMoneyOvernight(oiData) {
  if (!oiData) return null;

  const nnNet = (oiData.foreignBuy || 0) - (oiData.foreignSell || 0);
  const totalOI = oiData.totalOI || 0;
  const oiChange = oiData.totalOIChange || 0;
  const f1mVol = oiData.f1mVolume || 0;

  // OI interpretation
  let oiSignal = 'NEUTRAL';
  let oiDesc = '';
  if (oiChange > 500) {
    oiSignal = nnNet > 0 ? 'BULLISH_ACCUMULATE' : 'BEARISH_ACCUMULATE';
    oiDesc = `OI tăng +${oiChange.toLocaleString()} HĐ → Vị thế MỚI đang được mở (${nnNet > 0 ? 'nghiêng LONG' : 'nghiêng SHORT'})`;
  } else if (oiChange < -500) {
    oiDesc = `OI giảm ${oiChange.toLocaleString()} HĐ → Đang ĐÓNG vị thế (chốt lời hoặc cắt lỗ)`;
    oiSignal = 'CLOSING';
  } else {
    oiDesc = `OI biến động nhẹ (${oiChange >= 0 ? '+' : ''}${oiChange.toLocaleString()} HĐ) → Thận trọng`;
    oiSignal = 'NEUTRAL';
  }

  // Smart Money interpretation
  let smartMoneyBias = 'NEUTRAL';
  let smartMoneyDesc = '';
  if (nnNet > 500) {
    smartMoneyBias = 'STRONG_LONG';
    smartMoneyDesc = `🐋 NN Long ròng mạnh +${nnNet.toLocaleString()} HĐ → Smart Money đặt cược TĂNG mạnh phiên tới`;
  } else if (nnNet > 200) {
    smartMoneyBias = 'LONG';
    smartMoneyDesc = `🐋 NN Long ròng +${nnNet.toLocaleString()} HĐ → Nghiêng về phe mua`;
  } else if (nnNet < -500) {
    smartMoneyBias = 'STRONG_SHORT';
    smartMoneyDesc = `🦈 NN Short ròng mạnh ${nnNet.toLocaleString()} HĐ → Smart Money đặt cược GIẢM mạnh phiên tới`;
  } else if (nnNet < -200) {
    smartMoneyBias = 'SHORT';
    smartMoneyDesc = `🦈 NN Short ròng ${nnNet.toLocaleString()} HĐ → Nghiêng về phe bán`;
  } else {
    smartMoneyDesc = `🔘 NN cân bằng (${nnNet >= 0 ? '+' : ''}${nnNet.toLocaleString()} HĐ) → Chưa rõ ý đồ`;
  }

  return {
    nnNet,
    totalOI,
    oiChange,
    f1mVol,
    oiSignal,
    oiDesc,
    smartMoneyBias,
    smartMoneyDesc,
    nnBuy: oiData.foreignBuy || 0,
    nnSell: oiData.foreignSell || 0,
    allNNBuy: oiData.allForeignBuy || 0,
    allNNSell: oiData.allForeignSell || 0,
    allNNNet: oiData.allForeignNet || 0,
  };
}

// ─── TREND PREDICTION ────────────────────────────────────────
/**
 * Dự đoán khả năng trend phiên tiếp theo
 * Kết hợp: price action hôm nay + OI positioning + smart money + S/R
 */
function predictNextDayTrend(priceAction, smartMoney, srLevels, currentPrice) {
  let score = 0; // -100 to +100 (negative = bearish, positive = bullish)
  const factors = [];

  // 1. Price Action hôm nay
  if (priceAction) {
    if (priceAction.candleSignal === 'BULLISH') { score += 20; factors.push('Nến ngày tăng mạnh'); }
    else if (priceAction.candleSignal === 'MILD_BULLISH') { score += 10; factors.push('Nến ngày tăng nhẹ'); }
    else if (priceAction.candleSignal === 'BEARISH') { score -= 20; factors.push('Nến ngày giảm mạnh'); }
    else if (priceAction.candleSignal === 'MILD_BEARISH') { score -= 10; factors.push('Nến ngày giảm nhẹ'); }

    if (priceAction.recoverFromLow) { score += 15; factors.push('Nhúng đáy rồi rút chân V — lực cầu mạnh'); }
    if (priceAction.failBreakout) { score -= 15; factors.push('Phá đỉnh rồi quay lại — bẫy long, phân phối'); }

    if (priceAction.volRatio > 1.3 && priceAction.isBullish) { score += 10; factors.push('Vol đột biến + giá tăng → dòng tiền vào'); }
    if (priceAction.volRatio > 1.3 && !priceAction.isBullish) { score -= 10; factors.push('Vol đột biến + giá giảm → bán tháo'); }
    if (priceAction.volRatio < 0.7) { score -= 5; factors.push('Thanh khoản teo tóp → thiếu niềm tin'); }
  }

  // 2. Smart Money positioning
  if (smartMoney) {
    if (smartMoney.smartMoneyBias === 'STRONG_LONG') { score += 25; factors.push('Smart Money Long ròng mạnh'); }
    else if (smartMoney.smartMoneyBias === 'LONG') { score += 15; factors.push('Smart Money nghiêng Long'); }
    else if (smartMoney.smartMoneyBias === 'STRONG_SHORT') { score -= 25; factors.push('Smart Money Short ròng mạnh'); }
    else if (smartMoney.smartMoneyBias === 'SHORT') { score -= 15; factors.push('Smart Money nghiêng Short'); }

    if (smartMoney.oiSignal === 'BULLISH_ACCUMULATE') { score += 10; factors.push('OI tăng → tích lũy vị thế mới'); }
    if (smartMoney.oiSignal === 'BEARISH_ACCUMULATE') { score -= 10; factors.push('OI tăng theo hướng Short'); }
    if (smartMoney.oiSignal === 'CLOSING') { score += 5; factors.push('OI giảm → đóng vị thế, có thể sắp đảo chiều'); }
  }

  // 3. S/R proximity
  if (srLevels && currentPrice) {
    const nearestSup = srLevels.supports[0];
    const nearestRes = srLevels.resistances[0];
    if (nearestSup && (currentPrice - nearestSup.price) <= 5) {
      score += 10; factors.push(`Giá sát hỗ trợ ${nearestSup.tf} (${nearestSup.price})`);
    }
    if (nearestRes && (nearestRes.price - currentPrice) <= 5) {
      score -= 10; factors.push(`Giá sát kháng cự ${nearestRes.tf} (${nearestRes.price})`);
    }
  }

  // Normalize
  const normalizedScore = Math.max(-100, Math.min(100, score));
  let trendPrediction = '';
  let trendEmoji = '';
  let gapPrediction = '';

  if (normalizedScore >= 30) {
    trendPrediction = 'BULLISH';
    trendEmoji = '🟢';
    gapPrediction = 'Khả năng GAP UP hoặc mở cửa trên tham chiếu → Ưu tiên LONG ATO';
  } else if (normalizedScore >= 10) {
    trendPrediction = 'MILD_BULLISH';
    trendEmoji = '🟡';
    gapPrediction = 'Có thể sideway-up → Quan sát 15p đầu rồi vào Long nếu breakout';
  } else if (normalizedScore <= -30) {
    trendPrediction = 'BEARISH';
    trendEmoji = '🔴';
    gapPrediction = 'Khả năng GAP DOWN hoặc mở cửa dưới tham chiếu → Ưu tiên SHORT ATO';
  } else if (normalizedScore <= -10) {
    trendPrediction = 'MILD_BEARISH';
    trendEmoji = '🟠';
    gapPrediction = 'Có thể sideway-down → Quan sát 15p đầu rồi vào Short nếu breakdown';
  } else {
    trendPrediction = 'NEUTRAL';
    trendEmoji = '⚪';
    gapPrediction = 'Không rõ xu hướng → ĐỨNG NGOÀI ATO, đợi 09:15 xác nhận';
  }

  return {
    score: normalizedScore,
    trendPrediction,
    trendEmoji,
    gapPrediction,
    factors,
    confidence: Math.abs(normalizedScore),
  };
}

// ─── FORMAT S/R TEXT ──────────────────────────────────────────
function formatSRText(srLevels, currentPrice) {
  let text = '';

  text += `📍 <b>GIÁ HIỆN TẠI: ${currentPrice?.toFixed(1) || 'N/A'}</b>\n\n`;

  // Supports
  text += `🟩 <b>HỖ TRỢ (dưới giá):</b>\n`;
  if (srLevels.supports.length > 0) {
    srLevels.supports.forEach((s, i) => {
      const dist = currentPrice ? +(currentPrice - s.price).toFixed(1) : '?';
      const label = i === 0 ? 'S1 (gần nhất)' : `S${i + 1}`;
      text += `  • ${label}: <b>${s.price}</b> (${s.tf}/${s.key}) — cách ${dist}đ\n`;
    });
  } else {
    text += `  • Không có hỗ trợ rõ ràng\n`;
  }

  text += `\n🟥 <b>KHÁNG CỰ (trên giá):</b>\n`;
  if (srLevels.resistances.length > 0) {
    srLevels.resistances.slice(0, 3).forEach((r, i) => {
      const dist = currentPrice ? +(r.price - currentPrice).toFixed(1) : '?';
      const label = i === 0 ? 'R1 (gần nhất)' : `R${i + 1}`;
      text += `  • ${label}: <b>${r.price}</b> (${r.tf}/${r.key}) — cách ${dist}đ\n`;
    });
  } else {
    text += `  • Không có kháng cự rõ ràng\n`;
  }

  // Key confluence zones
  if (srLevels.keyLevels && srLevels.keyLevels.length > 0) {
    text += `\n⭐ <b>VÙNG HỘI TỤ (nhiều khung thời gian):</b>\n`;
    srLevels.keyLevels.forEach(kl => {
      text += `  • <b>${kl.price.toFixed(1)}</b> — ${kl.tfs.join('+')} (sức mạnh: ${kl.weight})\n`;
    });
  }

  return text;
}

// ─── BUILD EVENING PLAN NOTIFICATION ─────────────────────────
/**
 * Build full evening plan notification message
 * Gọi AI Gemini phân tích tổng hợp
 */
async function buildEveningPlanNotification() {
  console.log('   📡 [Evening Plan] Đang lấy dữ liệu...');

  // Fetch tất cả data cần thiết
  const [dailyF1M, dailyVN30, weeklyF1M, hourlyF1M, m15F1M, oiData, futuresPrice, vn30Price, vnindexPrice] = await Promise.all([
    dataFetcher.fetchOHLCV('VN30F1M', 'D', 30),
    dataFetcher.fetchOHLCV('VN30', 'D', 30),
    dataFetcher.fetchOHLCV('VN30F1M', 'W', 12),  // 12 tuần
    dataFetcher.fetchOHLCV('VN30F1M', '60', 7),   // 7 ngày khung 1H
    dataFetcher.fetchOHLCV('VN30F1M', '15', 5),   // 5 ngày khung 15p
    dataFetcher.fetchDerivativesOIData(),
    dataFetcher.fetchRealtimeFuturesPrice(),
    dataFetcher.fetchRealtimeVN30Price(),
    dataFetcher.fetchRealtimeVNINDEXPrice(),
  ]);

  const f1mPrice = futuresPrice ? futuresPrice.price : null;
  const vn30PriceVal = vn30Price ? vn30Price.price : null;
  const vnindexVal = vnindexPrice ? vnindexPrice.price : null;

  // Build weekly candles từ raw data
  let weeklyCandles = [];
  if (weeklyF1M && weeklyF1M.c && weeklyF1M.c.length > 0) {
    weeklyCandles = weeklyF1M.c.map((c, i) => ({
      high: weeklyF1M.h ? weeklyF1M.h[i] : c,
      low: weeklyF1M.l ? weeklyF1M.l[i] : c,
      close: c,
      open: weeklyF1M.o ? weeklyF1M.o[i] : c,
    }));
  }

  // Multi-timeframe S/R
  const srLevels = buildMultiTimeframeSR(dailyF1M, weeklyCandles, hourlyF1M, m15F1M, f1mPrice);

  // Price Action analysis
  const priceAction = analyzeDailyPriceAction(dailyF1M);

  // Smart Money overnight
  const smartMoney = analyzeSmartMoneyOvernight(oiData);

  // Basis analysis
  const basis = marketContext.analyzeBasis(f1mPrice, vn30PriceVal);

  // Trend prediction
  const prediction = predictNextDayTrend(priceAction, smartMoney, srLevels, f1mPrice);

  // ─── FORMAT: DATA SECTION ──────────────────────────
  let dataSection = '';

  // Giá kết phiên
  dataSection += `📊 <b>KẾT PHIÊN HÔM NAY:</b>\n`;
  dataSection += `  F1M: <b>${f1mPrice?.toFixed(1) || 'N/A'}</b>`;
  if (priceAction) {
    dataSection += ` (${priceAction.change >= 0 ? '+' : ''}${priceAction.change}đ | ${priceAction.changePct >= 0 ? '+' : ''}${priceAction.changePct}%)`;
  }
  dataSection += `\n`;
  dataSection += `  VN30: <b>${vn30PriceVal?.toFixed(1) || 'N/A'}</b> | VNINDEX: <b>${vnindexVal?.toFixed(1) || 'N/A'}</b>\n`;
  if (basis) {
    dataSection += `  Basis: ${basis.basis >= 0 ? '+' : ''}${basis.basis}đ — ${basis.description}\n`;
  }
  dataSection += `\n`;

  // Nến ngày
  if (priceAction) {
    dataSection += `🕯 <b>NẾN NGÀY:</b> ${priceAction.candlePattern}\n`;
    dataSection += `  Range: ${priceAction.range}đ | Thân: ${priceAction.body}đ | Râu trên: ${priceAction.upperWick}đ | Râu dưới: ${priceAction.lowerWick}đ\n`;
    dataSection += `  Vol: ${priceAction.volLabel} (x${priceAction.volRatio} so với TB5)\n`;
    if (priceAction.recoverFromLow) {
      dataSection += `  🟢 <b>NHÚNG ĐÁY + RÚT CHÂN V</b> — Lực cầu bắt đáy mạnh!\n`;
    }
    if (priceAction.failBreakout) {
      dataSection += `  🔴 <b>PHÁ ĐỈNH RỒI QUAY LẠI</b> — Bẫy Long, phân phối!\n`;
    }
    dataSection += `\n`;
  }

  // S/R levels
  dataSection += formatSRText(srLevels, f1mPrice);
  dataSection += `\n`;

  // Smart Money
  if (smartMoney) {
    dataSection += `🐋 <b>DÒNG TIỀN QUA ĐÊM:</b>\n`;
    dataSection += `  ${smartMoney.smartMoneyDesc}\n`;
    dataSection += `  ${smartMoney.oiDesc}\n`;
    dataSection += `  NN: Mua ${smartMoney.nnBuy.toLocaleString()} | Bán ${smartMoney.nnSell.toLocaleString()} | Net: ${smartMoney.nnNet >= 0 ? '+' : ''}${smartMoney.nnNet.toLocaleString()} HĐ\n`;
    dataSection += `  Tổng OI: ${smartMoney.totalOI.toLocaleString()} HĐ | Vol F1: ${smartMoney.f1mVol.toLocaleString()} HĐ\n`;
    dataSection += `\n`;
  }

  // Trend prediction
  dataSection += `${prediction.trendEmoji} <b>DỰ BÁO PHIÊN KẾ TIẾP:</b>\n`;
  dataSection += `  Xu hướng: <b>${prediction.trendPrediction}</b> (Score: ${prediction.score >= 0 ? '+' : ''}${prediction.score} | Tin cậy: ${prediction.confidence}%)\n`;
  dataSection += `  ${prediction.gapPrediction}\n`;
  if (prediction.factors.length > 0) {
    dataSection += `  Yếu tố:\n`;
    prediction.factors.slice(0, 5).forEach(f => {
      dataSection += `    • ${f}\n`;
    });
  }

  // ─── GỌI AI GEMINI TỔNG HỢP (Multi-model & Multi-key failover) ──
  let aiAnalysis = '';
  const candidateKeys = [
    config.geminiAI4?.apiKey,
    config.geminiAI2?.apiKey,
    config.geminiAI1?.apiKey,
    config.geminiAI3?.apiKey,
  ].filter(Boolean);

  const candidateModels = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash'];

  const prompt = `Bạn là Senior Prop Trader kỳ cựu 15 năm phái sinh VN30F. Phân tích dữ liệu KẾT PHIÊN hôm nay và đưa ra CHIẾN LƯỢC cho PHIÊN NGÀY MAI.

DỮ LIỆU KẾT PHIÊN (${dataFetcher.vnNow()}):

GIÁ:
- F1M: ${f1mPrice?.toFixed(1) || 'N/A'} | VN30: ${vn30PriceVal?.toFixed(1) || 'N/A'} | VNINDEX: ${vnindexVal?.toFixed(1) || 'N/A'}
- Basis: ${basis ? `${basis.basis >= 0 ? '+' : ''}${basis.basis}đ (${basis.description})` : 'N/A'}

NẾN NGÀY:
- Pattern: ${priceAction?.candlePattern || 'N/A'}
- Range: ${priceAction?.range || 'N/A'}đ | Body: ${priceAction?.body || 'N/A'}đ
- Thay đổi: ${priceAction ? `${priceAction.change >= 0 ? '+' : ''}${priceAction.change}đ (${priceAction.changePct}%)` : 'N/A'}
- Vol: ${priceAction?.volLabel || 'N/A'} (x${priceAction?.volRatio || 'N/A'})
${priceAction?.recoverFromLow ? '- NHÚNG ĐÁY RÚT CHÂN V!' : ''}${priceAction?.failBreakout ? '- PHÁ ĐỈNH RỒI QUAY LẠI!' : ''}

HỖ TRỢ / KHÁNG CỰ ĐA KHUNG:
${srLevels.supports.map((s, i) => `  S${i + 1}: ${s.price} (${s.tf})`).join('\n') || '  Không có'}
${srLevels.resistances.slice(0, 3).map((r, i) => `  R${i + 1}: ${r.price} (${r.tf})`).join('\n') || '  Không có'}
${srLevels.keyLevels?.length > 0 ? `  Vùng hội tụ: ${srLevels.keyLevels.map(k => `${k.price.toFixed(1)} (${k.tfs.join('+')})`).join(', ')}` : ''}

DÒNG TIỀN THÔNG MINH QUA ĐÊM:
- ${smartMoney?.smartMoneyDesc || 'N/A'}
- ${smartMoney?.oiDesc || 'N/A'}
- NN: Mua ${smartMoney?.nnBuy?.toLocaleString() || '0'} | Bán ${smartMoney?.nnSell?.toLocaleString() || '0'} | Net: ${smartMoney?.nnNet?.toLocaleString() || '0'} HĐ
- Tổng OI: ${smartMoney?.totalOI?.toLocaleString() || 'N/A'} | Vol F1: ${smartMoney?.f1mVol?.toLocaleString() || 'N/A'}

PREDICTION ENGINE: ${prediction.trendPrediction} (Score: ${prediction.score}, Tin cậy: ${prediction.confidence}%)
Factors: ${prediction.factors.join('; ')}

YÊU CẦU PHÂN TÍCH NHƯ SENIOR TRADER:
1. ĐỌC HÀNH VI GIÁ từ khung lớn (tuần, ngày) → xác định bối cảnh xu hướng chính
2. XÁC ĐỊNH S/R QUAN TRỌNG NHẤT cho ngày mai — giá nào phải canh, giá nào phải cắt lỗ
3. PHÂN TÍCH DÒNG TIỀN THÔNG MINH: NN, Tự doanh đang ôm gì qua đêm? Đám đông đang ở chiều nào?
4. DỰ BÁO PHIÊN TIẾP THEO: GAP UP / GAP DOWN / THAM CHIẾU? Khả năng trend nào cao nhất?
5. CHIẾN LƯỢC MỞ VỊ THẾ NGÀY MAI:
   - ATO có nên mở vị thế không? LONG hay SHORT?
   - Nếu gap up → chiến lược gì?
   - Nếu gap down → chiến lược gì?
   - Nếu tham chiếu → chờ gì?
   - Entry / SL / TP cụ thể
6. KỊCH BẢN NGUY HIỂM: Khi nào phải đứng ngoài hoặc cắt lỗ ngay lập tức?

ĐỊNH DẠNG HTML Telegram (<b>, <i>, bullet points). Viết ngắn gọn, dứt khoát, không ba phải. TỐI ĐA 1500 ký tự.`;

  const { GoogleGenerativeAI } = require('@google/generative-ai');

  for (const apiKey of candidateKeys) {
    if (aiAnalysis) break;
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      for (const modelName of candidateModels) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          let rawText = result?.response?.text();
          if (rawText && rawText.trim().length > 0) {
            aiAnalysis = rawText
              .replace(/```html/gi, '')
              .replace(/```/g, '')
              .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
              .replace(/\*(.*?)\*/g, '<i>$1</i>')
              .replace(/<(?!\/?(?:b|i|code|pre|a)\b)[^>]+>/g, '')
              .trim();
            console.log(`   ✅ [Evening Plan] AI thành công với model ${modelName}`);
            break;
          }
        } catch (mErr) {
          // Thử model tiếp theo
          continue;
        }
      }
    } catch (kErr) {
      continue;
    }
  }

  // Fallback nếu AI không khả dụng: Rule-based Senior Trader Synthesis
  if (!aiAnalysis) {
    const s1 = srLevels.supports[0]?.price || (f1mPrice ? f1mPrice - 10 : 0);
    const r1 = srLevels.resistances[0]?.price || (f1mPrice ? f1mPrice + 10 : 0);
    const isBull = prediction.score > 0;
    const isBear = prediction.score < 0;

    aiAnalysis = `<b>1. BỐI CẢNH & HÀNH VI GIÁ KHUNG LỚN:</b>\n` +
      `• Xu hướng chủ đạo: <b>${prediction.trendPrediction}</b> (Độ tin cậy: ${prediction.confidence}%).\n` +
      `• Nến ngày hôm nay thể hiện <i>${priceAction?.candlePattern || 'giằng co'}</i> với biên độ ${priceAction?.range || 0}đ.\n\n` +
      `<b>2. VÙNG THEN CHỐT NGÀY MAI:</b>\n` +
      `• Hỗ trợ trọng yếu S1: <b>${s1}</b> | Kháng cự trọng yếu R1: <b>${r1}</b>.\n` +
      `• Vùng hội tụ đa khung: ${srLevels.keyLevels?.length > 0 ? srLevels.keyLevels.map(k => k.price.toFixed(1)).join(', ') : 'Theo dõi phản ứng tại S1/R1'}.\n\n` +
      `<b>3. DÒNG TIỀN QUA ĐÊM (SMART MONEY):</b>\n` +
      `• Khối ngoại net: <b>${smartMoney?.nnNet >= 0 ? '+' : ''}${smartMoney?.nnNet?.toLocaleString() || 0} HĐ</b> qua đêm.\n` +
      `• Dòng tiền lớn: <i>${smartMoney?.smartMoneyDesc || 'Cân bằng'}</i>.\n\n` +
      `<b>4. CHIẾN LƯỢC MỞ VỊ THẾ PHIÊN MAI:</b>\n` +
      `• <b>Dự báo mở phiên:</b> ${prediction.gapPrediction}\n` +
      (isBull
        ? `• <b>Kịch bản ưu tiên (LONG):</b> Canh nhịp chỉnh test lại vùng hỗ trợ <b>${s1}</b> hoặc khi vượt dứt khoát <b>${r1}</b> với vol lớn. Entry: ${s1} - ${s1 + 2}đ. Cắt lỗ (SL): ${s1 - 3.5}đ. Chốt lời (TP): ${r1} (+8~12đ).\n`
        : isBear
        ? `• <b>Kịch bản ưu tiên (SHORT):</b> Canh hồi lên vùng kháng cự <b>${r1}</b> suy yếu hoặc thủng hỗ trợ <b>${s1}</b>. Entry: ${r1} - ${r1 - 2}đ. Cắt lỗ (SL): ${r1 + 3.5}đ. Chốt lời (TP): ${s1} (+8~12đ).\n`
        : `• <b>Kịch bản Sideway:</b> Không mở vị thế ATO. Chờ giá tiệm cận biên S1 (<b>${s1}</b>) đánh Long hồi ngắn hoặc R1 (<b>${r1}</b>) đánh Short pullback. SL tối đa 3đ.\n`) +
      `\n<b>5. KỊCH BẢN NGUY HIỂM & QUẢN TRỊ:</b>\n` +
      `• Tuyệt đối KHÔNG đu lệnh khi ATO gap quá 6 điểm; chờ ít nhất 9h15 để nến 15m đầu tiên xác nhận hướng.`;
  }

  // ─── BUILD FINAL MESSAGE ──────────────────────────
  let msg = `🌙 <b>CHIẾN LƯỢC PHIÊN TIẾP THEO — 19h50</b>\n`;
  msg += `🕐 <i>${dataFetcher.vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += dataSection;
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🤖 <b>PHÂN TÍCH AI SENIOR TRADER:</b>\n\n`;
  msg += aiAnalysis;
  msg += `\n\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🌙 Evening Plan Engine v7.0 | VN Stock Bot</i>`;

  return msg;
}

// ─── RUN EVENING PLAN JOB ────────────────────────────────────
async function runEveningPlanJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🌙 EVENING PLAN v7.0 — CHIẾN LƯỢC PHIÊN TIẾP THEO (19h50)');
  console.log('═'.repeat(55));

  try {
    const msg = await buildEveningPlanNotification();
    await sendDerivativesMessage(msg);
    console.log('   ✅ Evening Plan hoàn thành');
    return true;
  } catch (err) {
    console.error('   ❌ Evening Plan lỗi:', err.message);
    return false;
  }
}

module.exports = {
  buildEveningPlanNotification,
  runEveningPlanJob,
  // Export internals for reuse
  calculatePivotLevels,
  buildMultiTimeframeSR,
  analyzeDailyPriceAction,
  analyzeSmartMoneyOvernight,
  predictNextDayTrend,
  formatSRText,
};
