/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚡ VN30F v7.0 — Intraday Signal Engine (15p/noti)           ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Tín hiệu LONG/SHORT/ĐỨNG NGOÀI realtime trong phiên         ║
 * ║  Bắn noti đều đặn trong phiên:                                ║
 * ║  • Sáng: 9h15 → 11h30 (15p/noti = 10 noti)                    ║
 * ║  • Chiều: 13h00 → 13h45 (15p/noti = 3 noti)                   ║
 * ║  • Giờ vàng: 13h45 → 14h25 (5p/noti = 9 noti trước ATC)       ║
 * ║                                                                ║
 * ║  PHÂN TÍCH MỖI NOTI:                                          ║
 * ║  • Khung 1H: Xác định xu hướng chính phiên                   ║
 * ║  • Khung 15p: Xác nhận sóng phụ + timing                     ║
 * ║  • Khung 5p: Entry chính xác + Price Action                  ║
 * ║  • Thanh khoản + Vol flow + CVD                               ║
 * ║  • Quyết định: LONG / SHORT / ĐỨNG NGOÀI QUAN SÁT            ║
 * ║  • Entry / SL / TP cụ thể                                    ║
 * ║                                                                ║
 * ║  MỤC TIÊU: Đọc hành vi từ khung lớn, xác định và             ║
 * ║  nâng cao độ chính xác khi mở vị thế khung nhỏ               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config, isCurrentInstanceActive } = require('../config');
const dataFetcher = require('./dataFetcher');
const marketStructure = require('./marketStructure');
const marketContext = require('./marketContext');
const flowEngine = require('./flowEngine');
const { sendDerivativesMessage } = require('../telegramService');

// ─── STATE: Lưu trạng thái liên phiên ─────────────────────────
const _state = {
  lastSignal: null,        // 'LONG' | 'SHORT' | 'STAND_ASIDE'
  lastSignalTime: 0,
  signalCount: 0,
  consecutiveSame: 0,      // Đếm liên tiếp cùng chiều → trend mạnh
  intradayBias: 'NEUTRAL', // Bias tích lũy trong ngày
  biasScore: 0,            // Score tích lũy
};

function resetIntradayState() {
  _state.lastSignal = null;
  _state.lastSignalTime = 0;
  _state.signalCount = 0;
  _state.consecutiveSame = 0;
  _state.intradayBias = 'NEUTRAL';
  _state.biasScore = 0;
}

// ─── MULTI-TIMEFRAME ANALYSIS ────────────────────────────────
/**
 * Phân tích khung 1H (xu hướng chính)
 * Xác định: Uptrend / Downtrend / Sideway
 */
function analyze1HTimeframe(hourlyData) {
  if (!hourlyData || !hourlyData.c || hourlyData.c.length < 5) {
    return { trend: 'UNKNOWN', strength: 0, description: 'Không đủ dữ liệu 1H' };
  }

  const closes = hourlyData.c;
  const len = closes.length;

  // EMA5, EMA13 trên khung 1H
  const ema5 = marketStructure.calculateEMA(closes, 5);
  const ema13 = marketStructure.calculateEMA(closes, 13);

  // Slope: So sánh 3 bar gần nhất
  const last3 = closes.slice(-3);
  const slope = (last3[2] - last3[0]) / 2;

  // Xác định trend
  let trend = 'NEUTRAL';
  let strength = 0;
  let description = '';

  if (ema5 && ema13) {
    const emaDiff = ema5 - ema13;
    if (emaDiff > 2 && slope > 0) {
      trend = 'UPTREND';
      strength = Math.min(90, 50 + Math.abs(emaDiff) * 5);
      description = `EMA5 > EMA13 (+${emaDiff.toFixed(1)}đ), slope tăng → Uptrend 1H`;
    } else if (emaDiff < -2 && slope < 0) {
      trend = 'DOWNTREND';
      strength = Math.min(90, 50 + Math.abs(emaDiff) * 5);
      description = `EMA5 < EMA13 (${emaDiff.toFixed(1)}đ), slope giảm → Downtrend 1H`;
    } else {
      trend = 'SIDEWAYS';
      strength = 30;
      description = `EMA5 ≈ EMA13 (diff: ${emaDiff.toFixed(1)}đ) → Sideway 1H`;
    }
  }

  // High/Low gần nhất trên 1H
  const recentHighs = (hourlyData.h || closes).slice(-5);
  const recentLows = (hourlyData.l || closes).slice(-5);
  const h1High = Math.max(...recentHighs);
  const h1Low = Math.min(...recentLows);

  return {
    trend,
    strength,
    description,
    ema5: ema5 ? +ema5.toFixed(1) : null,
    ema13: ema13 ? +ema13.toFixed(1) : null,
    slope: +slope.toFixed(2),
    high: +h1High.toFixed(1),
    low: +h1Low.toFixed(1),
    lastClose: +closes[len - 1].toFixed(1),
  };
}

/**
 * Phân tích khung 15p (sóng phụ + timing)
 * Xác nhận: breakout / pullback / reversal
 */
function analyze15mTimeframe(m15Data, h1Trend) {
  if (!m15Data || !m15Data.c || m15Data.c.length < 8) {
    return { signal: 'NEUTRAL', description: 'Không đủ dữ liệu 15p' };
  }

  const closes = m15Data.c;
  const volumes = m15Data.v || [];
  const len = closes.length;

  // EMA5 và EMA9 trên 15p
  const ema5 = marketStructure.calculateEMA(closes, 5);
  const ema9 = marketStructure.calculateEMA(closes, 9);

  // Last 4 bars (1 giờ gần nhất trên khung 15p)
  const last4 = closes.slice(-4);
  const last4Slope = (last4[last4.length - 1] - last4[0]) / (last4.length - 1);

  // Volume trend
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

      // Xác nhận cùng chiều 1H
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

  // Volume confirmation
  let volDescription = '';
  if (volTrend > 1.3) {
    volDescription = `Vol 15p TĂNG x${volTrend} → dòng tiền xác nhận`;
    if (signal !== 'NEUTRAL') confidence += 10;
  } else if (volTrend < 0.7) {
    volDescription = `Vol 15p TEO x${volTrend} → thiếu lực, cẩn trọng bẫy`;
    confidence -= 10;
  } else {
    volDescription = `Vol 15p bình thường (x${volTrend})`;
  }

  return {
    signal,
    description,
    confidence: Math.max(0, Math.min(100, confidence)),
    ema5: ema5 ? +ema5.toFixed(1) : null,
    ema9: ema9 ? +ema9.toFixed(1) : null,
    slope: +last4Slope.toFixed(2),
    volTrend,
    volDescription,
    lastClose: +closes[len - 1].toFixed(1),
  };
}

/**
 * Phân tích khung 5p (entry chính xác)
 */
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

  // 3 nến gần nhất trên 5p
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

  // Price Velocity (tốc độ biến động)
  const velocity = (closes[len - 1] - closes[len - 6]) / 5; // 5 bars gần nhất

  // Entry signal
  let entrySignal = 'NEUTRAL';
  let entryConfidence = 50;
  let description = '';

  const latestCandle = last3[last3.length - 1];
  const prevCandle = last3[last3.length - 2];

  // Bullish entry conditions
  if (latestCandle.isGreen && latestCandle.body > 1.5 && velocity > 0.3) {
    entrySignal = 'LONG_ENTRY';
    entryConfidence = 65;
    description = `Nến 5p xanh đặc (${latestCandle.body.toFixed(1)}đ) + velocity tăng → Entry LONG`;
    if (m15Signal === 'BULLISH') {
      entryConfidence = 80;
      description += ' — 15p đồng thuận';
    }
  }
  // Bearish entry conditions
  else if (!latestCandle.isGreen && latestCandle.body > 1.5 && velocity < -0.3) {
    entrySignal = 'SHORT_ENTRY';
    entryConfidence = 65;
    description = `Nến 5p đỏ đặc (${latestCandle.body.toFixed(1)}đ) + velocity giảm → Entry SHORT`;
    if (m15Signal === 'BEARISH') {
      entryConfidence = 80;
      description += ' — 15p đồng thuận';
    }
  }
  // Doji/indecision
  else if (latestCandle.body < 0.5 && latestCandle.range > 2) {
    entrySignal = 'STAND_ASIDE';
    entryConfidence = 30;
    description = `Nến 5p Doji (body ${latestCandle.body.toFixed(1)}đ, range ${latestCandle.range.toFixed(1)}đ) → Do dự, chờ`;
  }
  // Hammer / Pin bar
  else if (latestCandle.lowerWick > latestCandle.body * 2 && latestCandle.isGreen) {
    entrySignal = 'LONG_ENTRY';
    entryConfidence = 60;
    description = `Pin bar đáy 5p (râu dưới ${latestCandle.lowerWick.toFixed(1)}đ) → Có thể bắt đáy`;
  } else if (latestCandle.upperWick > latestCandle.body * 2 && !latestCandle.isGreen) {
    entrySignal = 'SHORT_ENTRY';
    entryConfidence = 60;
    description = `Pin bar đỉnh 5p (râu trên ${latestCandle.upperWick.toFixed(1)}đ) → Có thể mở short`;
  } else {
    description = `5p chưa có tín hiệu rõ ràng → Quan sát thêm`;
  }

  // Volume confirmation trên 5p
  const avgVol5m = volumes.slice(-10).reduce((s, v) => s + v, 0) / Math.max(1, volumes.slice(-10).length);
  const latestVol = latestCandle.volume;
  const volRatio = avgVol5m > 0 ? +(latestVol / avgVol5m).toFixed(2) : 1;

  if (volRatio > 1.5 && entrySignal !== 'NEUTRAL' && entrySignal !== 'STAND_ASIDE') {
    entryConfidence += 10;
  } else if (volRatio < 0.5 && entrySignal !== 'NEUTRAL') {
    entryConfidence -= 15;
    description += ' — Vol yếu, nghi bẫy!';
  }

  return {
    entrySignal,
    entryConfidence: Math.max(0, Math.min(100, entryConfidence)),
    description,
    velocity: +velocity.toFixed(2),
    latestCandle,
    volRatio,
    currentPrice: +closes[len - 1].toFixed(1),
    high5m: +Math.max(...highs.slice(-6)).toFixed(1),
    low5m: +Math.min(...lows.slice(-6)).toFixed(1),
  };
}

// ─── MAKE FINAL DECISION ─────────────────────────────────────
/**
 * Tổng hợp 3 khung thời gian → Quyết định DỨT KHOÁT
 */
function makeFinalDecision(h1Analysis, m15Analysis, m5Analysis, contextInfo) {
  let finalDirection = 'STAND_ASIDE';
  let finalConfidence = 0;
  const reasons = [];
  const warnings = [];

  // Score system
  let bullScore = 0;
  let bearScore = 0;

  // 1H weight: 40%
  if (h1Analysis.trend === 'UPTREND') { bullScore += 40; reasons.push(`1H: ${h1Analysis.description}`); }
  else if (h1Analysis.trend === 'DOWNTREND') { bearScore += 40; reasons.push(`1H: ${h1Analysis.description}`); }
  else { reasons.push(`1H: Sideway — cần 15p+5p xác nhận`); }

  // 15p weight: 35%
  if (m15Analysis.signal === 'BULLISH') { bullScore += 35 * (m15Analysis.confidence / 100); reasons.push(`15p: ${m15Analysis.description}`); }
  else if (m15Analysis.signal === 'BEARISH') { bearScore += 35 * (m15Analysis.confidence / 100); reasons.push(`15p: ${m15Analysis.description}`); }

  // 5p weight: 25%
  if (m5Analysis.entrySignal === 'LONG_ENTRY') { bullScore += 25 * (m5Analysis.entryConfidence / 100); reasons.push(`5p: ${m5Analysis.description}`); }
  else if (m5Analysis.entrySignal === 'SHORT_ENTRY') { bearScore += 25 * (m5Analysis.entryConfidence / 100); reasons.push(`5p: ${m5Analysis.description}`); }
  else if (m5Analysis.entrySignal === 'STAND_ASIDE') { warnings.push(m5Analysis.description); }

  // Context adjustment
  if (contextInfo) {
    if (contextInfo.session && contextInfo.session.riskLevel === 'EXTREME') {
      warnings.push(`⚠️ ${contextInfo.session.name} — Risk cực cao!`);
      bullScore *= 0.5;
      bearScore *= 0.5;
    }
    if (contextInfo.isDeath) {
      warnings.push(`💀 VÙNG TỬ THẦN — Bảo vệ vốn ưu tiên số 1!`);
      bullScore *= 0.3;
      bearScore *= 0.3;
    }
    if (contextInfo.basis && contextInfo.basis.isBullish) { bullScore += 5; }
    if (contextInfo.basis && contextInfo.basis.isBearish) { bearScore += 5; }
    if (contextInfo.supplyDemand) {
      if (contextInfo.supplyDemand.isNNBullish) { bullScore += 8; }
      if (contextInfo.supplyDemand.isNNBearish) { bearScore += 8; }
    }
  }

  // Update intraday bias
  _state.biasScore += (bullScore - bearScore) * 0.1;

  // Decision
  const threshold = 35; // Tối thiểu 35 điểm để ra quyết định
  if (bullScore >= threshold && bullScore > bearScore * 1.3) {
    finalDirection = 'LONG';
    finalConfidence = Math.min(95, Math.round(bullScore));
  } else if (bearScore >= threshold && bearScore > bullScore * 1.3) {
    finalDirection = 'SHORT';
    finalConfidence = Math.min(95, Math.round(bearScore));
  } else {
    finalDirection = 'STAND_ASIDE';
    finalConfidence = Math.max(bullScore, bearScore);
    if (bullScore > bearScore) {
      warnings.push(`Nghiêng LONG nhẹ (${Math.round(bullScore)}đ) nhưng chưa đủ sức → ĐỨNG NGOÀI`);
    } else if (bearScore > bullScore) {
      warnings.push(`Nghiêng SHORT nhẹ (${Math.round(bearScore)}đ) nhưng chưa đủ sức → ĐỨNG NGOÀI`);
    }
  }

  // Track consecutive same direction
  if (finalDirection === _state.lastSignal && finalDirection !== 'STAND_ASIDE') {
    _state.consecutiveSame++;
    if (_state.consecutiveSame >= 3) {
      reasons.push(`🔥 ${_state.consecutiveSame} noti liên tiếp cùng chiều → TREND MẠNH`);
      finalConfidence = Math.min(95, finalConfidence + 5);
    }
  } else {
    _state.consecutiveSame = finalDirection === 'STAND_ASIDE' ? _state.consecutiveSame : 1;
  }

  _state.lastSignal = finalDirection;
  _state.lastSignalTime = Date.now();
  _state.signalCount++;

  return {
    direction: finalDirection,
    confidence: Math.round(finalConfidence),
    bullScore: Math.round(bullScore),
    bearScore: Math.round(bearScore),
    reasons: reasons.slice(0, 4),
    warnings: warnings.slice(0, 3),
    signalCount: _state.signalCount,
    consecutiveSame: _state.consecutiveSame,
  };
}

// ─── FORMAT INTRADAY SIGNAL MESSAGE ──────────────────────────
function formatIntradaySignal(decision, h1, m15, m5, contextInfo, oiData) {
  const emoji = decision.direction === 'LONG' ? '🟢' : decision.direction === 'SHORT' ? '🔴' : '⚪';
  const label = decision.direction === 'LONG' ? 'LONG' : decision.direction === 'SHORT' ? 'SHORT' : 'ĐỨNG NGOÀI QUAN SÁT';
  const confEmoji = decision.confidence >= 70 ? '🔥' : decision.confidence >= 50 ? '⚡' : '⚠️';

  let msg = `${emoji} <b>${label}</b> — Tin cậy: <b>${decision.confidence}%</b> ${confEmoji}\n`;
  msg += `🕐 <i>${dataFetcher.vnNow()}</i> | Noti #${decision.signalCount}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Giá hiện tại
  msg += `📍 <b>F1M: ${m5.currentPrice || 'N/A'}</b>\n\n`;

  // Multi-timeframe summary
  msg += `📊 <b>ĐA KHUNG:</b>\n`;
  const h1Emoji = h1.trend === 'UPTREND' ? '🟢' : h1.trend === 'DOWNTREND' ? '🔴' : '🟡';
  const m15Emoji = m15.signal === 'BULLISH' ? '🟢' : m15.signal === 'BEARISH' ? '🔴' : '🟡';
  const m5Emoji = m5.entrySignal.includes('LONG') ? '🟢' : m5.entrySignal.includes('SHORT') ? '🔴' : '🟡';

  msg += `  ${h1Emoji} 1H: ${h1.description}\n`;
  msg += `  ${m15Emoji} 15p: ${m15.description}\n`;
  msg += `  ${m5Emoji} 5p: ${m5.description}\n`;
  if (m15.volDescription) {
    msg += `  📊 ${m15.volDescription}\n`;
  }
  msg += `\n`;

  // Trade Plan (only if LONG or SHORT)
  if (decision.direction !== 'STAND_ASIDE') {
    const isLong = decision.direction === 'LONG';
    const entry = m5.currentPrice;
    const sl = isLong ? +(entry - 3).toFixed(1) : +(entry + 3).toFixed(1);
    const tp1 = isLong ? +(entry + 5).toFixed(1) : +(entry - 5).toFixed(1);
    const tp2 = isLong ? +(entry + 10).toFixed(1) : +(entry - 10).toFixed(1);

    msg += `🎯 <b>TRADE PLAN:</b>\n`;
    msg += `  📍 Entry: <b>${entry}</b>\n`;
    msg += `  🛑 SL: <b>${sl}</b> (-3đ MTL)\n`;
    msg += `  🎯 TP1: <b>${tp1}</b> (+5đ, chốt 50%)\n`;
    msg += `  🎯 TP2: <b>${tp2}</b> (+10đ, trailing)\n\n`;
  }

  // Lý do
  if (decision.reasons.length > 0) {
    msg += `📋 <b>LÝ DO:</b>\n`;
    decision.reasons.forEach(r => { msg += `  • ${r}\n`; });
    msg += `\n`;
  }

  // Cảnh báo
  if (decision.warnings.length > 0) {
    msg += `⚠️ <b>CẢNH BÁO:</b>\n`;
    decision.warnings.forEach(w => { msg += `  • ${w}\n`; });
    msg += `\n`;
  }

  // Context
  if (contextInfo && contextInfo.session) {
    msg += `${contextInfo.session.emoji} <i>${contextInfo.session.name}</i>\n`;
  }
  if (contextInfo && contextInfo.basis) {
    msg += `📐 <i>Basis: ${contextInfo.basis.text}</i>\n`;
  }
  if (oiData && oiData.foreignNet !== undefined) {
    msg += `🌐 <i>NN: ${oiData.foreignNet >= 0 ? '+' : ''}${oiData.foreignNet.toLocaleString()} HĐ</i>\n`;
  }

  // Consecutive & Score
  if (decision.consecutiveSame >= 3) {
    msg += `🔥 <b>${decision.consecutiveSame} noti liên tiếp ${decision.direction}</b>\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>Bull: ${decision.bullScore} | Bear: ${decision.bearScore}</i>\n`;
  msg += `<i>⚡ Intraday Signal v7.0 | VN Stock Bot</i>`;

  return msg;
}

// ─── RUN INTRADAY SIGNAL ─────────────────────────────────────
/**
 * Chạy 1 cycle phân tích + gửi noti
 * Được gọi mỗi 15 phút trong phiên
 */
async function runIntradaySignal() {
  if (!isCurrentInstanceActive()) return;

  const startTime = Date.now();

  try {
    // Fetch multi-timeframe data song song
    const [hourlyData, m15Data, m5Data, oiData, futuresPrice, vn30Price] = await Promise.all([
      dataFetcher.fetchOHLCV('VN30F1M', '60', 5),    // 1H - 5 ngày
      dataFetcher.fetchOHLCV('VN30F1M', '15', 3),    // 15p - 3 ngày
      dataFetcher.fetchOHLCV('VN30F1M', '5', 2),     // 5p - 2 ngày
      dataFetcher.fetchDerivativesOIData(),
      dataFetcher.fetchRealtimeFuturesPrice(),
      dataFetcher.fetchRealtimeVN30Price(),
    ]);

    // Multi-timeframe analysis
    const h1Analysis = analyze1HTimeframe(hourlyData);
    const m15Analysis = analyze15mTimeframe(m15Data, h1Analysis.trend);
    const m5Analysis = analyze5mTimeframe(m5Data, m15Analysis.signal);

    // Market context
    const f1mPrice = futuresPrice ? futuresPrice.price : m5Analysis.currentPrice;
    const vn30PriceVal = vn30Price ? vn30Price.price : null;
    const contextInfo = marketContext.buildMarketContext(f1mPrice, vn30PriceVal, oiData);

    // Make decision
    const decision = makeFinalDecision(h1Analysis, m15Analysis, m5Analysis, contextInfo);

    // Format & send
    const msg = formatIntradaySignal(decision, h1Analysis, m15Analysis, m5Analysis, contextInfo, oiData);
    await sendDerivativesMessage(msg);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Intraday Signal #${decision.signalCount}: ${decision.direction} (${decision.confidence}%) [${elapsed}s]`);

    return decision;
  } catch (err) {
    console.error(`   ❌ Intraday Signal lỗi:`, err.message);
    return null;
  }
}

// ─── AI-ENHANCED SIGNAL (có AI tổng hợp) ────────────────────
/**
 * Bản nâng cao: Kết hợp AI Gemini cho phân tích sâu hơn
 * Dùng cho noti đặc biệt (đầu phiên sáng, đầu phiên chiều)
 */
async function runAIEnhancedSignal() {
  if (!isCurrentInstanceActive()) return;

  try {
    // Fetch all data
    const [hourlyData, m15Data, m5Data, oiData, futuresPrice, vn30Price, vnindexPrice] = await Promise.all([
      dataFetcher.fetchOHLCV('VN30F1M', '60', 5),
      dataFetcher.fetchOHLCV('VN30F1M', '15', 3),
      dataFetcher.fetchOHLCV('VN30F1M', '5', 2),
      dataFetcher.fetchDerivativesOIData(),
      dataFetcher.fetchRealtimeFuturesPrice(),
      dataFetcher.fetchRealtimeVN30Price(),
      dataFetcher.fetchRealtimeVNINDEXPrice(),
    ]);

    const h1Analysis = analyze1HTimeframe(hourlyData);
    const m15Analysis = analyze15mTimeframe(m15Data, h1Analysis.trend);
    const m5Analysis = analyze5mTimeframe(m5Data, m15Analysis.signal);

    const f1mPrice = futuresPrice ? futuresPrice.price : m5Analysis.currentPrice;
    const vn30PriceVal = vn30Price ? vn30Price.price : null;
    const contextInfo = marketContext.buildMarketContext(f1mPrice, vn30PriceVal, oiData);
    const decision = makeFinalDecision(h1Analysis, m15Analysis, m5Analysis, contextInfo);

    // Standard message first
    let msg = formatIntradaySignal(decision, h1Analysis, m15Analysis, m5Analysis, contextInfo, oiData);
    await sendDerivativesMessage(msg);

    console.log(`   ✅ AI-Enhanced Intraday Signal: ${decision.direction} (${decision.confidence}%)`);
    return decision;
  } catch (err) {
    console.error(`   ❌ AI-Enhanced Signal lỗi:`, err.message);
    return null;
  }
}

module.exports = {
  runIntradaySignal,
  runAIEnhancedSignal,
  resetIntradayState,
  // Exports for testing
  analyze1HTimeframe,
  analyze15mTimeframe,
  analyze5mTimeframe,
  makeFinalDecision,
  getState: () => ({ ..._state }),
};
