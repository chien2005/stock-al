/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🕯️ VN30F v4.4 — 5-Minute Candle Tracker                    ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Theo dõi nến 5 phút chuẩn F1 phái sinh                      ║
 * ║  Thống kê Long/Short từng nến + tích lũy từ đầu ngày         ║
 * ║  Pattern Recognition: Tích lũy / Đảo chiều / Dụ FOMO         ║
 * ║  Gợi ý LONG/SHORT/ĐỨNG NGOÀI — cẩn thận, kỷ luật             ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const dataFetcher = require('./dataFetcher');
const oiTracker = require('./oiTracker');
const { sendDerivativesMessage } = require('../telegramService');
const { config, isCurrentInstanceActive } = require('../config');

// ─── STATE ──────────────────────────────────────────────────────
const _state = {
  candleSnapshots: [],    // [{ time, ohlcv, position, oi, pattern }]
  prevSnapshot: null,     // Snapshot trước đó (để tính delta)
  timer: null,
  lastCandleTime: null,   // Tránh bắn trùng
};

// ─── KHUNG GIỜ CHUẨN 5P F1 PHÁI SINH ─────────────────────────
// Sàn chạy: 09:00-11:30, 13:00-14:45
// Nến 5p chuẩn: 09:05, 09:10, ..., 11:25, 11:30, 13:05, ..., 14:25, 14:30
function getStandard5MinSlots() {
  const slots = [];
  // Phiên sáng: 09:00 → 11:30
  for (let h = 9; h <= 11; h++) {
    const maxM = h === 11 ? 30 : 55;
    for (let m = (h === 9 ? 5 : 0); m <= maxM; m += 5) {
      slots.push({ h, m });
    }
  }
  // Phiên chiều: 13:00 → 14:30  
  for (let h = 13; h <= 14; h++) {
    const maxM = h === 14 ? 30 : 55;
    for (let m = (h === 13 ? 5 : 0); m <= maxM; m += 5) {
      slots.push({ h, m });
    }
  }
  return slots;
}

/**
 * Kiểm tra xem giờ hiện tại có phải đúng khung 5p chuẩn không
 * Cho phép sai lệch ±30 giây
 */
function isStandard5MinMark() {
  const vnTime = dataFetcher.getVnTime();
  const m = vnTime.getMinutes();
  const s = vnTime.getSeconds();
  // Nến 5p đóng tại :00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55
  // Check nến vừa đóng (vd: 09:05:00 → nến 09:00-09:05 vừa đóng)
  return (m % 5 === 0) && (s <= 30);
}

/**
 * Lấy label khung thời gian nến 5p vừa đóng
 * VD: Gọi lúc 10:15 → trả về "10:10→10:15"
 */
function getCandleTimeLabel() {
  const vnTime = dataFetcher.getVnTime();
  const h = vnTime.getHours();
  const m = vnTime.getMinutes();
  const pad = n => String(n).padStart(2, '0');
  
  // Nến vừa đóng: từ (h:m-5) đến (h:m)
  let prevH = h, prevM = m - 5;
  if (prevM < 0) { prevM = 55; prevH = h - 1; }
  
  return `${pad(prevH)}:${pad(prevM)}→${pad(h)}:${pad(m)}`;
}

// ─── FETCH 5-MIN CANDLE DATA ────────────────────────────────────
async function fetch5MinCandleData() {
  const now = Math.floor(Date.now() / 1000);
  const from = dataFetcher.getVnTime();
  from.setHours(0, 0, 0, 0);
  const fromTs = Math.floor(from.getTime() / 1000);

  try {
    const res = await require('axios').get(
      `${dataFetcher.VPS_HISTORY_URL}?symbol=VN30F1M&resolution=5&from=${fromTs}&to=${now}`,
      { headers: dataFetcher.HEADERS, timeout: 8000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      return res.data;
    }
  } catch (e) {
    console.error('   ⚠️ [5mCandle] Fetch 5m data error:', e.message);
  }
  return null;
}

// ─── CANDLE PATTERN RECOGNITION ─────────────────────────────────

/**
 * Phân loại pattern nến 5p
 * @returns { pattern, label, emoji, confidence }
 */
function classifyCandle(candle, prevCandle, avgVol) {
  const { o, h, l, c, v } = candle;
  const range = Math.max(0.1, h - l);
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  
  const bodyPct = (body / range) * 100;
  const upperWickPct = (upperWick / range) * 100;
  const lowerWickPct = (lowerWick / range) * 100;
  const volRatio = avgVol > 0 ? v / avgVol : 1;
  const isBullish = c > o;
  const isBearish = c < o;

  // ─── 1. DỤ FOMO (vol cao + râu dài = bẫy) ────────
  if (volRatio >= 1.5 && (upperWickPct >= 40 || lowerWickPct >= 40)) {
    if (upperWickPct >= 40 && isBearish) {
      return { pattern: 'FOMO_TRAP_LONG', label: 'Dụ FOMO Long (kéo lên xả)', emoji: '🪤📈', confidence: 80 };
    }
    if (lowerWickPct >= 40 && isBullish) {
      return { pattern: 'FOMO_TRAP_SHORT', label: 'Dụ FOMO Short (đè xuống gom)', emoji: '🪤📉', confidence: 80 };
    }
  }

  // ─── 2. ĐẢO CHIỀU (hammer, shooting star, engulfing) ────
  if (prevCandle) {
    const prevBody = Math.abs(prevCandle.c - prevCandle.o);
    const prevBullish = prevCandle.c > prevCandle.o;
    
    // Bullish Engulfing
    if (isBullish && !prevBullish && body > prevBody * 1.2 && c > prevCandle.o && o <= prevCandle.c) {
      return { pattern: 'BULLISH_ENGULFING', label: 'Engulfing tăng (đảo chiều lên)', emoji: '🔄📈', confidence: 75 };
    }
    // Bearish Engulfing
    if (isBearish && prevBullish && body > prevBody * 1.2 && c < prevCandle.o && o >= prevCandle.c) {
      return { pattern: 'BEARISH_ENGULFING', label: 'Engulfing giảm (đảo chiều xuống)', emoji: '🔄📉', confidence: 75 };
    }
  }

  // Hammer (đảo chiều tăng)
  if (lowerWickPct >= 55 && bodyPct <= 35 && upperWickPct <= 15) {
    return { pattern: 'HAMMER', label: 'Búa tăng (rút chân gom)', emoji: '🔨📈', confidence: 70 };
  }
  // Shooting Star (đảo chiều giảm)
  if (upperWickPct >= 55 && bodyPct <= 35 && lowerWickPct <= 15) {
    return { pattern: 'SHOOTING_STAR', label: 'Sao băng giảm (kéo lên xả)', emoji: '⭐📉', confidence: 70 };
  }

  // ─── 3. XU HƯỚNG MẠNH (body lớn, vol tốt) ────────
  if (bodyPct >= 60 && volRatio >= 0.8) {
    if (isBullish) {
      return { pattern: 'STRONG_BULL', label: 'Nến tăng mạnh (body lớn, vol tốt)', emoji: '🟢📈', confidence: 65 };
    } else {
      return { pattern: 'STRONG_BEAR', label: 'Nến giảm mạnh (body lớn, vol tốt)', emoji: '🔴📉', confidence: 65 };
    }
  }

  // ─── 4. TÍCH LŨY (vol thấp, range nhỏ) ────────
  if (volRatio <= 0.6 && range <= 2.0) {
    return { pattern: 'ACCUMULATION', label: 'Tích lũy (vol thấp, range hẹp)', emoji: '⏸️', confidence: 55 };
  }

  // ─── 5. Doji (range nhỏ, body nhỏ) ────────
  if (bodyPct <= 15 && range >= 1.0) {
    return { pattern: 'DOJI', label: 'Doji (phân vân, chuẩn bị chọn hướng)', emoji: '❓', confidence: 50 };
  }

  // ─── 6. Nến bình thường ────────
  if (isBullish) {
    return { pattern: 'NORMAL_BULL', label: 'Nến tăng nhẹ', emoji: '🟢', confidence: 40 };
  } else if (isBearish) {
    return { pattern: 'NORMAL_BEAR', label: 'Nến giảm nhẹ', emoji: '🔴', confidence: 40 };
  }
  
  return { pattern: 'NEUTRAL', label: 'Cân bằng', emoji: '⚪', confidence: 30 };
}

/**
 * Phân tích multi-candle pattern (2-3 nến liên tiếp)
 */
function analyzeMultiCandlePattern(snapshots) {
  if (snapshots.length < 2) return null;

  const last = snapshots[snapshots.length - 1];
  const prev = snapshots[snapshots.length - 2];
  const prev2 = snapshots.length >= 3 ? snapshots[snapshots.length - 3] : null;

  const lastPattern = last.pattern?.pattern || '';
  const prevPattern = prev.pattern?.pattern || '';

  // 2 nến tích lũy + 1 nến xu hướng = Breakout
  if (prev2) {
    const prev2Pattern = prev2.pattern?.pattern || '';
    if ((prev2Pattern === 'ACCUMULATION' || prevPattern === 'ACCUMULATION') && 
        (lastPattern === 'STRONG_BULL' || lastPattern === 'BULLISH_ENGULFING')) {
      return { signal: 'BREAKOUT_UP', label: 'Breakout tăng sau tích lũy', emoji: '🚀📈', confidence: 80 };
    }
    if ((prev2Pattern === 'ACCUMULATION' || prevPattern === 'ACCUMULATION') && 
        (lastPattern === 'STRONG_BEAR' || lastPattern === 'BEARISH_ENGULFING')) {
      return { signal: 'BREAKOUT_DOWN', label: 'Breakout giảm sau tích lũy', emoji: '💥📉', confidence: 80 };
    }
  }

  // 2 nến tăng liên tiếp mạnh
  if ((prevPattern === 'STRONG_BULL' || prevPattern === 'BULLISH_ENGULFING') &&
      (lastPattern === 'STRONG_BULL' || lastPattern === 'NORMAL_BULL')) {
    return { signal: 'CONTINUATION_UP', label: 'Tiếp diễn tăng (2 nến xanh liên tiếp)', emoji: '📈📈', confidence: 65 };
  }

  // 2 nến giảm liên tiếp mạnh
  if ((prevPattern === 'STRONG_BEAR' || prevPattern === 'BEARISH_ENGULFING') &&
      (lastPattern === 'STRONG_BEAR' || lastPattern === 'NORMAL_BEAR')) {
    return { signal: 'CONTINUATION_DOWN', label: 'Tiếp diễn giảm (2 nến đỏ liên tiếp)', emoji: '📉📉', confidence: 65 };
  }

  // Doji sau xu hướng mạnh = cảnh báo đảo chiều
  if ((prevPattern === 'STRONG_BULL' || prevPattern === 'STRONG_BEAR') && lastPattern === 'DOJI') {
    return { signal: 'REVERSAL_WARNING', label: 'Doji sau nến mạnh — cảnh báo đảo chiều', emoji: '⚠️🔄', confidence: 60 };
  }

  return null;
}

// ─── INTELLIGENT SIGNAL ─────────────────────────────────────────

/**
 * Ra quyết định gợi ý dựa trên pattern + position data
 * Trả về: { direction: 'LONG'|'SHORT'|'WAIT', reason, emoji, confidence }
 */
function generateSignal(currentSnapshot, snapshots, positionData, oiData) {
  const pattern = currentSnapshot.pattern;
  const multiPattern = analyzeMultiCandlePattern(snapshots);
  
  // Yếu tố vị thế
  const nnNet = positionData?.foreignNet || 0;
  const nnDelta = currentSnapshot.positionDelta?.foreignNetDelta || 0;
  const oiChange = oiData?.oiChange || 0;
  const longShortDelta = (currentSnapshot.candleVolStats?.longContracts || 0) - (currentSnapshot.candleVolStats?.shortContracts || 0);

  let score = 0; // Dương = Long, Âm = Short
  let reasons = [];

  // 1. Pattern nến đơn
  if (pattern) {
    const bullishPatterns = ['STRONG_BULL', 'BULLISH_ENGULFING', 'HAMMER', 'FOMO_TRAP_SHORT'];
    const bearishPatterns = ['STRONG_BEAR', 'BEARISH_ENGULFING', 'SHOOTING_STAR', 'FOMO_TRAP_LONG'];
    
    if (bullishPatterns.includes(pattern.pattern)) {
      score += 2;
      reasons.push(`Nến 5p: ${pattern.label}`);
    } else if (bearishPatterns.includes(pattern.pattern)) {
      score -= 2;
      reasons.push(`Nến 5p: ${pattern.label}`);
    } else if (pattern.pattern === 'ACCUMULATION' || pattern.pattern === 'DOJI') {
      reasons.push(`Nến 5p: ${pattern.label}`);
    }
  }

  // 2. Multi-candle pattern
  if (multiPattern) {
    if (multiPattern.signal.includes('UP') || multiPattern.signal === 'CONTINUATION_UP') {
      score += 3;
      reasons.push(multiPattern.label);
    } else if (multiPattern.signal.includes('DOWN') || multiPattern.signal === 'CONTINUATION_DOWN') {
      score -= 3;
      reasons.push(multiPattern.label);
    } else if (multiPattern.signal === 'REVERSAL_WARNING') {
      // Giảm confidence, đứng ngoài
      score = Math.round(score * 0.3);
      reasons.push(multiPattern.label);
    }
  }

  // 3. Khối ngoại delta (mạnh nhất)
  if (nnDelta > 30) {
    score += 2;
    reasons.push(`NN mua ròng +${nnDelta} HĐ`);
  } else if (nnDelta < -30) {
    score -= 2;
    reasons.push(`NN bán ròng ${nnDelta} HĐ`);
  }

  // 4. OI change
  if (oiChange > 200 && score > 0) {
    score += 1;
    reasons.push(`OI tăng +${oiChange} (xác nhận Long)`);
  } else if (oiChange > 200 && score < 0) {
    score -= 1;
    reasons.push(`OI tăng +${oiChange} (xác nhận Short)`);
  } else if (oiChange < -200) {
    // OI giảm = đóng vị thế, cẩn thận
    reasons.push(`OI giảm ${oiChange} (đóng vị thế)`);
  }

  // 5. Long/Short delta trong nến
  if (longShortDelta > 100) {
    score += 1;
    reasons.push(`Long > Short +${longShortDelta}`);
  } else if (longShortDelta < -100) {
    score -= 1;
    reasons.push(`Short > Long +${Math.abs(longShortDelta)}`);
  }

  // Quyết định
  let direction = 'WAIT';
  let emoji = '⏸️';
  let confidence = Math.min(90, Math.abs(score) * 15 + 20);

  if (score >= 3) {
    direction = 'LONG';
    emoji = '🟢';
  } else if (score <= -3) {
    direction = 'SHORT';
    emoji = '🔴';
  } else if (score >= 1) {
    direction = 'LONG';
    emoji = '🟡📈';
    confidence = Math.min(55, confidence);
    reasons.push('Tín hiệu chưa mạnh — size nhỏ, SL chặt');
  } else if (score <= -1) {
    direction = 'SHORT';
    emoji = '🟡📉';
    confidence = Math.min(55, confidence);
    reasons.push('Tín hiệu chưa mạnh — size nhỏ, SL chặt');
  } else {
    reasons.push('Chưa có tín hiệu rõ ràng');
  }

  return {
    direction,
    emoji,
    confidence,
    score,
    reasons,
    multiPattern,
  };
}

// ─── KIỂM TRA NẾN CÓ PATTERN ĐÁNG CHÚ Ý KHÔNG ────────────────
function isNotableCandle(pattern, multiPattern, positionDelta) {
  if (!pattern) return false;

  // Luôn bắn nếu có multi-candle pattern
  if (multiPattern) return true;

  // Luôn bắn nếu pattern đáng chú ý
  const notablePatterns = [
    'FOMO_TRAP_LONG', 'FOMO_TRAP_SHORT',
    'BULLISH_ENGULFING', 'BEARISH_ENGULFING',
    'HAMMER', 'SHOOTING_STAR',
    'STRONG_BULL', 'STRONG_BEAR',
  ];
  if (notablePatterns.includes(pattern.pattern)) return true;

  // Bắn nếu NN biến động mạnh
  if (positionDelta) {
    const nnDelta = Math.abs(positionDelta.foreignNetDelta || 0);
    if (nnDelta >= 50) return true;
  }

  return false;
}

// ─── BUILD 5-MIN CANDLE NOTIFICATION ────────────────────────────
function buildCandleNotification(snapshot, signal, totalStats) {
  const { candle, pattern, positionData, positionDelta, oiData } = snapshot;
  const timeLabel = snapshot.timeLabel;
  const fmtSign = (num) => (num > 0 ? `+${num.toLocaleString('vi-VN')}` : num.toLocaleString('vi-VN'));
  const fmtK = (num) => {
    const n = num || 0;
    return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString('vi-VN');
  };

  let msg = `🕯️ <b>VN30F — NẾN 5P | ${timeLabel}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  // Giá OHLC
  if (candle) {
    const candleIcon = candle.c >= candle.o ? '🟢' : '🔴';
    const changePts = (candle.c - candle.o).toFixed(1);
    msg += `📍 F1M: <b>${candle.c.toFixed(1)}</b> | O ${candle.o.toFixed(1)} H ${candle.h.toFixed(1)} L ${candle.l.toFixed(1)} | ${candleIcon}${changePts >= 0 ? '+' : ''}${changePts}đ\n\n`;
  }

  // Pattern nến
  if (pattern) {
    msg += `🕯️ <b>NẾN:</b> ${pattern.emoji} ${pattern.label}\n`;
  }

  // Multi-candle pattern
  if (signal.multiPattern) {
    msg += `   Pattern: <b>${signal.multiPattern.label}</b>\n`;
  }

  // Thống kê nến này
  if (snapshot.candleVolStats) {
    const stats = snapshot.candleVolStats;
    const lsDelta = stats.longContracts - stats.shortContracts;
    const lsIcon = lsDelta > 0 ? '🟢' : lsDelta < 0 ? '🔴' : '⚪';
    msg += `\n📊 <b>NẾN NÀY:</b>\n`;
    msg += `   L: <b>${fmtK(stats.longContracts)}</b> | S: <b>${fmtK(stats.shortContracts)}</b> → ${lsIcon} ${lsDelta > 0 ? 'Long' : lsDelta < 0 ? 'Short' : 'Cân bằng'} (${fmtSign(lsDelta)})\n`;
    
    if (positionDelta) {
      const nnD = positionDelta.foreignNetDelta || 0;
      const nnIcon = nnD > 0 ? '🟢' : nnD < 0 ? '🔴' : '⚪';
      msg += `   NN: M${fmtSign(positionDelta.foreignBuyDelta || 0)} B${fmtSign(positionDelta.foreignSellDelta || 0)} → ${nnIcon} NN ${fmtSign(nnD)}\n`;
    }
  }

  // Tích lũy từ đầu ngày
  if (totalStats) {
    msg += `\n📊 <b>TỪ ĐẦU NGÀY</b> (${totalStats.totalCandles} nến):\n`;
    msg += `   Tổng L: <b>${fmtK(totalStats.totalLong)}</b> | S: <b>${fmtK(totalStats.totalShort)}</b>`;
    const totalDelta = totalStats.totalLong - totalStats.totalShort;
    msg += ` | Lệch: ${fmtSign(totalDelta)}\n`;
    msg += `   NN ròng: <b>${fmtSign(totalStats.nnNet)}</b> | OI: <b>${fmtSign(totalStats.oiChange)}</b> (${fmtK(totalStats.totalOI)})\n`;
  }

  // Gợi ý
  msg += `\n🎯 <b>GỢI Ý:</b> ${signal.emoji} <b>${signal.direction === 'LONG' ? 'LONG' : signal.direction === 'SHORT' ? 'SHORT' : 'ĐỨNG NGOÀI'}</b>`;
  if (signal.confidence > 0) {
    msg += ` (${signal.confidence}%)`;
  }
  msg += `\n`;
  
  if (signal.reasons.length > 0) {
    msg += `   ${signal.reasons.slice(0, 3).join(' | ')}\n`;
  }

  // SL hint
  if (candle && signal.direction !== 'WAIT') {
    const slLevel = signal.direction === 'LONG' ? candle.l.toFixed(1) : candle.h.toFixed(1);
    msg += `   ⚠️ SL: ${signal.direction === 'LONG' ? 'Dưới' : 'Trên'} ${slLevel} (${signal.direction === 'LONG' ? 'đáy' : 'đỉnh'} nến 5p)\n`;
  }

  msg += `\n<i>🕯️ VN30F Candle Tracker v4.4 | VN Stock Bot</i>`;

  return msg;
}

// ─── MAIN JOB: Chạy mỗi nến 5p chuẩn ───────────────────────────
async function run5MinCandleJob() {
  if (!isCurrentInstanceActive()) return;
  if (!dataFetcher.isMarketHours()) return;

  // Chỉ chạy đúng khung 5p
  if (!isStandard5MinMark()) return;

  const vnTime = dataFetcher.getVnTime();
  const candleKey = `${vnTime.getHours()}:${vnTime.getMinutes()}`;
  
  // Tránh bắn trùng cùng nến
  if (_state.lastCandleTime === candleKey) return;
  _state.lastCandleTime = candleKey;

  console.log(`\n   🕯️ [5mCandle] Nến 5p đóng: ${getCandleTimeLabel()}`);

  try {
    // 1. Fetch 5-min OHLCV data
    const candleData = await fetch5MinCandleData();
    if (!candleData || !candleData.c || candleData.c.length < 2) {
      console.log('   ⚠️ [5mCandle] Không đủ dữ liệu nến 5p');
      return;
    }

    // 2. Fetch position data
    const allData = await dataFetcher.fetchAllData();
    const positionData = oiTracker.getRealtimePositionSnapshot(allData);
    
    // 3. Tính delta so với snapshot trước
    let positionDelta = null;
    if (_state.prevSnapshot && _state.prevSnapshot.positionData) {
      const prev = _state.prevSnapshot.positionData;
      positionDelta = {
        foreignBuyDelta: positionData.foreignBuy - prev.foreignBuy,
        foreignSellDelta: positionData.foreignSell - prev.foreignSell,
        foreignNetDelta: positionData.foreignNet - prev.foreignNet,
        tuDoanhNetDelta: positionData.tuDoanhNet - prev.tuDoanhNet,
        crowdNetDelta: positionData.crowdNet - prev.crowdNet,
        oiDelta: (positionData.totalOI && prev.totalOI) ? (positionData.totalOI - prev.totalOI) : 0,
      };
    }

    // 4. Parse nến cuối cùng (nến vừa đóng)
    const idx = candleData.c.length - 1;
    const candle = {
      o: candleData.o ? candleData.o[idx] : candleData.c[idx],
      h: candleData.h ? candleData.h[idx] : candleData.c[idx],
      l: candleData.l ? candleData.l[idx] : candleData.c[idx],
      c: candleData.c[idx],
      v: candleData.v ? candleData.v[idx] : 0,
      t: candleData.t ? candleData.t[idx] : 0,
    };

    // Nến trước
    const prevIdx = idx - 1;
    const prevCandle = prevIdx >= 0 ? {
      o: candleData.o ? candleData.o[prevIdx] : candleData.c[prevIdx],
      h: candleData.h ? candleData.h[prevIdx] : candleData.c[prevIdx],
      l: candleData.l ? candleData.l[prevIdx] : candleData.c[prevIdx],
      c: candleData.c[prevIdx],
      v: candleData.v ? candleData.v[prevIdx] : 0,
    } : null;

    // Volume trung bình 10 nến gần nhất
    const recentVols = (candleData.v || []).slice(Math.max(0, idx - 10), idx);
    const avgVol = recentVols.length > 0 ? recentVols.reduce((s, x) => s + x, 0) / recentVols.length : 1;

    // 5. Pattern recognition
    const pattern = classifyCandle(candle, prevCandle, avgVol);

    // 6. Ước tính Long/Short contracts trong nến 5p này
    // Logic: Nến tăng → đa phần là Long; Nến giảm → đa phần là Short
    // Kết hợp volume + delta price + OI change
    const totalVol = candle.v || 0;
    const priceDelta = candle.c - candle.o;
    let longPct = 0.5; // Mặc định 50/50

    if (priceDelta > 0.5) longPct = 0.5 + Math.min(0.35, priceDelta / 10);
    else if (priceDelta < -0.5) longPct = 0.5 - Math.min(0.35, Math.abs(priceDelta) / 10);

    // Điều chỉnh theo NN delta
    if (positionDelta && positionDelta.foreignNetDelta > 20) longPct = Math.min(0.85, longPct + 0.1);
    else if (positionDelta && positionDelta.foreignNetDelta < -20) longPct = Math.max(0.15, longPct - 0.1);

    const candleVolStats = {
      longContracts: Math.round(totalVol * longPct),
      shortContracts: Math.round(totalVol * (1 - longPct)),
      totalVol,
    };

    // 7. Build snapshot
    const snapshot = {
      timeLabel: getCandleTimeLabel(),
      timestamp: Date.now(),
      candle,
      pattern,
      positionData,
      positionDelta,
      oiData: {
        totalOI: positionData.totalOI,
        oiChange: positionData.oiChange,
      },
      candleVolStats,
    };

    _state.candleSnapshots.push(snapshot);
    _state.prevSnapshot = snapshot;

    // Giữ tối đa 60 snapshots (cả ngày)
    if (_state.candleSnapshots.length > 60) {
      _state.candleSnapshots = _state.candleSnapshots.slice(-60);
    }

    // 8. Generate signal
    const signal = generateSignal(snapshot, _state.candleSnapshots, positionData, snapshot.oiData);

    // 9. Multi-candle pattern
    const multiPattern = analyzeMultiCandlePattern(_state.candleSnapshots);

    // 10. Tích lũy từ đầu ngày
    const totalStats = {
      totalCandles: _state.candleSnapshots.length,
      totalLong: _state.candleSnapshots.reduce((s, snap) => s + (snap.candleVolStats?.longContracts || 0), 0),
      totalShort: _state.candleSnapshots.reduce((s, snap) => s + (snap.candleVolStats?.shortContracts || 0), 0),
      nnNet: positionData.foreignNet,
      oiChange: positionData.oiChange,
      totalOI: positionData.totalOI,
    };

    // 11. Chỉ bắn noti nếu nến đáng chú ý
    if (isNotableCandle(pattern, multiPattern, positionDelta)) {
      console.log(`   🕯️ [5mCandle] Pattern đáng chú ý: ${pattern.emoji} ${pattern.label} → ${signal.emoji} ${signal.direction}`);
      const msg = buildCandleNotification(snapshot, signal, totalStats);
      await sendDerivativesMessage(msg);
    } else {
      console.log(`   🕯️ [5mCandle] ${pattern.emoji} ${pattern.label} — Bình thường, skip noti`);
    }

  } catch (e) {
    console.error('   ❌ [5mCandle] Job error:', e.stack || e.message);
  }
}

// ─── MONITOR START / STOP ────────────────────────────────────────
function start5MinCandleMonitor() {
  stop5MinCandleMonitor();
  
  // Poll mỗi 15 giây, check nếu đúng khung 5p thì chạy job
  _state.timer = setInterval(() => {
    if (!dataFetcher.isMarketHours()) return;
    run5MinCandleJob().catch(e => console.error('   ⚠️ [5mCandle] error:', e.message));
  }, 15 * 1000);

  console.log('   🕯️ 5-Min Candle Monitor v4.4: Started (poll 15s, notable patterns only)');
}

function stop5MinCandleMonitor() {
  if (_state.timer) {
    clearInterval(_state.timer);
    _state.timer = null;
  }
}

function reset5MinCandleState() {
  stop5MinCandleMonitor();
  _state.candleSnapshots = [];
  _state.prevSnapshot = null;
  _state.lastCandleTime = null;
  console.log('   🕯️ [5mCandle] State reset');
}

// ─── EXPORTS ────────────────────────────────────────────────────
module.exports = {
  run5MinCandleJob,
  start5MinCandleMonitor,
  stop5MinCandleMonitor,
  reset5MinCandleState,
  // Exposed for testing
  classifyCandle,
  analyzeMultiCandlePattern,
  generateSignal,
  buildCandleNotification,
  isNotableCandle,
  getStandard5MinSlots,
};
