/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚡ VN30F v9.0 — Radar Cung Cầu & Bản Đồ Fibonacci Realtime ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Bản đồ Cung Cầu Realtime + Kẻ Fibonacci Động Đa Khung        ║
 * ║  • Xác định các mức Fibo giá có khả năng cao sắp quét tới     ║
 * ║  • Cảnh báo vùng Sideway / Tụ tập đám đông (Tránh bẫy 50/50) ║
 * ║  • Đọc VSA Volume vs Nến:                                    ║
 * ║    - Đạp thiếu Vol / Kiệt bán ➔ Cấm Short đuổi đáy           ║
 * ║    - Kéo cố / Long giả / Bull trap ➔ Cấm đua Long            ║
 * ║    - Nổ Vol liên tiếp phá cản ➔ Sóng thật tiếp diễn          ║
 * ║    - Vùng Quá bán / Quá mua kiệt sức                         ║
 * ║  • Đa khung 15p - 5p - 1p + Smart Money + Thanh khoản sàn    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');
const dataFetcher = require('./dataFetcher');
const marketStructure = require('./marketStructure');
const marketContext = require('./marketContext');
const oiEstimator = require('./oiEstimator');
const { fetchMarketLiquidity } = require('../stockService');
const { sendDerivativesMessage } = require('../telegramService');
const fibonacciLiquidityEngine = require('./fibonacciLiquidityEngine');

// ─── STATE QUẢN LÝ VÒNG CHẠY ─────────────────────────────────
let _signalCount = 0;
let _lastSignalTime = null;

function resetIntradayState() {
  _signalCount = 0;
  _lastSignalTime = null;
  console.log('   🔄 Radar Cung Cầu & Fibonacci State đã reset');
}

// ─── PHÂN TÍCH THANH KHOẢN VÀ TỐC ĐỘ GIAO DỊCH ────────────────
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

  const totalVal = liquidity ? (liquidity.total || 0) : 0;
  const hoseVal = liquidity ? (liquidity.hose || 0) : 0;

  const speed = totalVal > 0 ? +(totalVal / elapsedMinutes).toFixed(1) : 0;
  const totalTradingMinutes = 255;
  const projectedTotal = totalVal > 0 ? Math.round(totalVal * (totalTradingMinutes / elapsedMinutes)) : 0;

  const isLowLiquidity = projectedTotal > 0 ? projectedTotal < 16000 : true;
  const mode = isLowLiquidity ? 'SCALP' : 'TREND';

  return {
    totalVal: Math.round(totalVal),
    hoseVal: Math.round(hoseVal),
    elapsedMinutes,
    speed,
    projectedTotal,
    isLowLiquidity,
    mode,
    modeLabel: isLowLiquidity
      ? '⚠️ THANH KHOẢN THẤP (Dưới 16k tỷ) ➔ ƯU TIÊN ĂN NGẮN SCALP'
      : '🔥 THANH KHOẢN TỐT (Từ 16k tỷ trở lên) ➔ CÓ THỂ GỒNG THEO TREND',
  };
}

// ─── PHÂN TÍCH CẤU TRÚC THỊ TRƯỜNG TỪ NẾN (SWING HIGH/LOW) ─────
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
      recentHigh: 0,
      recentLow: 0,
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
    swingHighDesc = `Đỉnh sau (${secondHalfHigh.toFixed(1)}) cao hơn Đỉnh trước (${firstHalfHigh.toFixed(1)}) ➔ NÂNG ĐỈNH`;
  } else if (isLowerHighs) {
    swingHighDesc = `Đỉnh sau (${secondHalfHigh.toFixed(1)}) thấp hơn Đỉnh trước (${firstHalfHigh.toFixed(1)}) ➔ HẠ ĐỈNH`;
  } else {
    swingHighDesc = `Đỉnh ngang bằng (${secondHalfHigh.toFixed(1)} ≈ ${firstHalfHigh.toFixed(1)})`;
  }

  let swingLowDesc = '';
  if (isHigherLows) {
    swingLowDesc = `Đáy sau (${secondHalfLow.toFixed(1)}) cao hơn Đáy trước (${firstHalfLow.toFixed(1)}) ➔ NÂNG ĐÁY`;
  } else if (isLowerLows) {
    swingLowDesc = `Đáy sau (${secondHalfLow.toFixed(1)}) thấp hơn Đáy trước (${firstHalfLow.toFixed(1)}) ➔ HẠ ĐÁY`;
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
    structureTag = '🟡 HẠ ĐỈNH + NÂNG ĐÁY (Thu hẹp tam giác) ➔ CHỜ BỨT PHÁ';
  } else if (isHigherHighs && isLowerLows) {
    highLowStructure = 'EXPANDING';
    structureTag = '⚠️ NÂNG ĐỈNH + HẠ ĐÁY (Kéo xả 2 đầu) ➔ RỦI RO BẪY CAO';
  } else {
    highLowStructure = 'SIDEWAY';
    structureTag = '⚪ ĐỈNH ĐÁY ĐAN XEN (Sideway giằng co)';
  }

  return {
    highLowStructure,
    structureTag,
    swingHighDesc,
    swingLowDesc,
    isHigherHighs,
    isLowerHighs,
    isHigherLows,
    isLowerLows,
    recentHigh: Math.max(...recentHighs),
    recentLow: Math.min(...recentLows),
    secondHalfHigh,
    secondHalfLow,
  };
}

// ─── MULTI-TIMEFRAME ANALYSIS (15M - 5M - 1M) ────────────────
function analyze15mTimeframe(m15Data) {
  if (!m15Data || !m15Data.c || m15Data.c.length < 5) {
    return { trend: 'UNKNOWN', signal: 'NEUTRAL', confidence: 50, description: '15p chưa đủ nến' };
  }

  const closes = m15Data.c;
  const len = closes.length;
  const ema5 = marketStructure.calculateEMA(closes, 5);
  const ema13 = marketStructure.calculateEMA(closes, 13);
  const last4 = closes.slice(-4);
  const slope = (last4[last4.length - 1] - last4[0]) / Math.max(1, last4.length - 1);

  let trend = 'SIDEWAY';
  let signal = 'NEUTRAL';
  let confidence = 50;
  let description = '';

  if (ema5 && ema13) {
    if (ema5 > ema13 + 0.5 && slope > 0.2) {
      trend = 'UPTREND';
      signal = 'BULLISH';
      confidence = Math.min(90, Math.round(60 + slope * 15));
      description = `15p Uptrend (EMA5 trên EMA13, dốc +${slope.toFixed(2)})`;
    } else if (ema5 < ema13 - 0.5 && slope < -0.2) {
      trend = 'DOWNTREND';
      signal = 'BEARISH';
      confidence = Math.min(90, Math.round(60 + Math.abs(slope) * 15));
      description = `15p Downtrend (EMA5 dưới EMA13, dốc ${slope.toFixed(2)})`;
    } else {
      trend = 'SIDEWAY';
      signal = 'NEUTRAL';
      confidence = 50;
      description = `15p Sideway đi ngang (EMA5 ≈ EMA13)`;
    }
  }

  return { trend, signal, confidence, description, ema5, ema13, slope };
}

function analyze5mTimeframe(m5Data, m15Signal = 'NEUTRAL') {
  if (!m5Data || !m5Data.c || m5Data.c.length < 5) {
    return { signal: 'NEUTRAL', entrySignal: 'NONE', confidence: 50, description: '5p chưa đủ nến', currentPrice: 0 };
  }

  const closes = m5Data.c;
  const opens = m5Data.o || closes;
  const highs = m5Data.h || closes;
  const lows = m5Data.l || closes;
  const volumes = m5Data.v || [];
  const len = closes.length;

  const currentPrice = closes[len - 1];
  const prevPrice = len > 1 ? closes[len - 2] : currentPrice;
  const ema9 = marketStructure.calculateEMA(closes, 9);
  const ema20 = marketStructure.calculateEMA(closes, 20);

  let signal = 'NEUTRAL';
  let entrySignal = 'NONE';
  let confidence = 50;
  let description = '';

  if (ema9 && ema20) {
    if (currentPrice > ema9 && ema9 > ema20) {
      signal = 'BULLISH';
      entrySignal = 'LONG';
      confidence = 75;
      description = `5p Bullish (Giá trên EMA9 &amp; EMA20)`;
    } else if (currentPrice < ema9 && ema9 < ema20) {
      signal = 'BEARISH';
      entrySignal = 'SHORT';
      confidence = 75;
      description = `5p Bearish (Giá dưới EMA9 &amp; EMA20)`;
    } else {
      signal = 'NEUTRAL';
      entrySignal = 'NONE';
      confidence = 50;
      description = `5p Giằng co (Nến kẹp giữa EMA9/EMA20)`;
    }
  }

  return {
    signal,
    entrySignal,
    confidence,
    description,
    currentPrice,
    prevPrice,
    ema9,
    ema20,
  };
}

function analyze1mTimeframe(m1Data, m5EntrySignal = 'NONE') {
  if (!m1Data || !m1Data.c || m1Data.c.length < 5) {
    return { signal: 'NEUTRAL', confidence: 50, description: '1p chưa đủ nến' };
  }

  const closes = m1Data.c;
  const opens = m1Data.o || closes;
  const len = closes.length;
  const last3 = closes.slice(-3);
  const last3Opens = opens.slice(-3);

  let greenCount = 0;
  let redCount = 0;
  for (let i = 0; i < last3.length; i++) {
    if (last3[i] > last3Opens[i]) greenCount++;
    else if (last3[i] < last3Opens[i]) redCount++;
  }

  let signal = 'NEUTRAL';
  let confidence = 50;
  let description = '';

  if (greenCount >= 2) {
    signal = 'BULLISH';
    confidence = 70;
    description = `1p Vi mô: ${greenCount}/3 nến xanh ➔ Xung lực Mua áp đảo`;
  } else if (redCount >= 2) {
    signal = 'BEARISH';
    confidence = 70;
    description = `1p Vi mô: ${redCount}/3 nến đỏ ➔ Xung lực Bán áp đảo`;
  } else {
    signal = 'NEUTRAL';
    confidence = 50;
    description = `1p Vi mô: Nến giằng co phân hóa`;
  }

  return { signal, confidence, description, greenCount, redCount };
}

// ─── FORMAT RADAR NOTIFICATION (FIBONACCI & CUNG CẦU) ─────────
function formatRadarNotification(params) {
  const {
    f1mPrice,
    vn30Price,
    basis,
    fibo,
    sdTargets,
    sidewayInfo,
    vsaAction,
    m15Analysis,
    m5Analysis,
    m1Analysis,
    structureInfo,
    liquidityInfo,
    smartMoneyInfo,
    contextInfo,
    signalCount,
    triggerContext,
  } = params;

  const basisVal = basis ? basis.basis : (f1mPrice && vn30Price ? +(f1mPrice - vn30Price).toFixed(1) : 0);
  const basisStr = `${basisVal >= 0 ? '+' : ''}${basisVal}đ`;

  // 1. BANNER THẾ VÀ CẤU TRÚC THỊ TRƯỜNG ĐẶT NGAY ĐẦU DÒNG ĐỂ QUAN SÁT NHANH (0.5s)
  const marketBiasBanner = fibonacciLiquidityEngine.generateMarketBiasBanner(structureInfo, m15Analysis, sidewayInfo, vsaAction);
  const practicalAdvice = fibonacciLiquidityEngine.generatePracticalTradingAdvice(structureInfo, fibo, sdTargets, sidewayInfo, vsaAction, f1mPrice);

  let msg = `${marketBiasBanner}\n`;
  msg += `⚡ <b>RADAR CUNG CẦU & BẢN ĐỒ FIBONACCI — VN30F1M</b>\n`;
  msg += `🕐 <i>${dataFetcher.vnNow()}</i> | Noti #${signalCount || 1}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 2. GIÁ HIỆN TẠI & BASIS
  msg += `📍 <b>F1M: ${f1mPrice?.toFixed(1) || 'N/A'}</b> | VN30: <b>${vn30Price?.toFixed(1) || 'N/A'}</b> | Basis: <b>${basisStr}</b>\n\n`;

  // 3. CẢNH BÁO BIẾN ĐỘNG THEO VOL & BẪY LÁI (Bỏ dòng tiêu đề theo yêu cầu user)
  if (triggerContext && triggerContext.label) {
    msg += `  ⚡ <b>CẢNH BÁO BIẾN ĐỘNG:</b> ${triggerContext.label}\n`;
  }
  if (vsaAction && vsaAction.headline) {
    msg += `  ${vsaAction.headline}\n`;
  }
  if (vsaAction && vsaAction.detail) {
    msg += `  ${vsaAction.detail}\n`;
  }
  if (practicalAdvice) {
    msg += `  ${practicalAdvice}\n`;
  }
  if (sidewayInfo && sidewayInfo.isSidewayChop && sidewayInfo.warning) {
    msg += `\n${sidewayInfo.warning}\n`;
  }
  msg += `\n`;

  // 4. CẤU TRÚC THỊ TRƯỜNG & ĐA KHUNG (15M - 5M - 1M)
  msg += `📊 <b>CẤU TRÚC THỊ TRƯỜNG & ĐA KHUNG:</b>\n`;
  const m15Emoji = m15Analysis.signal === 'BULLISH' ? '🟢' : m15Analysis.signal === 'BEARISH' ? '🔴' : '🟡';
  const m5Emoji = m5Analysis.signal === 'BULLISH' ? '🟢' : m5Analysis.signal === 'BEARISH' ? '🔴' : '🟡';
  const m1Emoji = m1Analysis.signal === 'BULLISH' ? '🟢' : m1Analysis.signal === 'BEARISH' ? '🔴' : '🟡';

  msg += `  ${m15Emoji} 15p: ${m15Analysis.description}\n`;
  msg += `  ${m5Emoji} 5p: ${m5Analysis.description}\n`;
  msg += `  ${m1Emoji} 1p: ${m1Analysis.description}\n`;
  if (structureInfo.structureTag) {
    msg += `  📈 <b>Cấu trúc Swing:</b> ${structureInfo.structureTag}\n`;
  }
  msg += `\n`;

  // 5. SMART MONEY & DÒNG TIỀN
  if (smartMoneyInfo) {
    const smSign = smartMoneyInfo.smartMoneyNet >= 0 ? `+${smartMoneyInfo.smartMoneyNet.toLocaleString('vi-VN')}` : smartMoneyInfo.smartMoneyNet.toLocaleString('vi-VN');
    const nnSign = smartMoneyInfo.foreignNet >= 0 ? `+${smartMoneyInfo.foreignNet.toLocaleString('vi-VN')}` : smartMoneyInfo.foreignNet.toLocaleString('vi-VN');
    const tdSign = smartMoneyInfo.effectiveTD >= 0 ? `+${smartMoneyInfo.effectiveTD.toLocaleString('vi-VN')}` : smartMoneyInfo.effectiveTD.toLocaleString('vi-VN');

    msg += `🐋 <b>SMART MONEY & DÒNG TIỀN:</b>\n`;
    msg += `  • 🌐 Khối Ngoại: <b>${smartMoneyInfo.foreignNet >= 0 ? '🟢 Mua' : '🔴 Bán'} ${nnSign} HĐ</b> (${smartMoneyInfo.foreignPct}%)\n`;
    msg += `  • 🏛️ Tự Doanh: <b>${smartMoneyInfo.effectiveTD >= 0 ? '🟢 Long' : '🔴 Short'} ${tdSign} HĐ</b>${smartMoneyInfo.tdIsEstimated ? ' <i>(ước)</i>' : ''} (${smartMoneyInfo.tdPct}%)\n`;
    msg += `  • 🔥 Hợp lực: <b>${smSign} HĐ</b> (${smartMoneyInfo.smartMoneyPct}%) | Đám đông: <b>${smartMoneyInfo.crowdNet >= 0 ? '+' : ''}${smartMoneyInfo.crowdNet.toLocaleString('vi-VN')} HĐ</b>\n`;
  }

  if (liquidityInfo && liquidityInfo.totalVal !== undefined) {
    msg += `  • 💧 Khớp: <b>${liquidityInfo.totalVal.toLocaleString('vi-VN')} tỷ</b> (Tốc độ: <b>${liquidityInfo.speed} tỷ/phút</b>) ➔ <i>${liquidityInfo.modeLabel}</i>\n`;
  }
  msg += `\n`;

  // 6. BẢN ĐỒ CUNG CẦU & CÁC MỐC FIBO SẮP QUÉT TỚI
  msg += `🎯 <b>BẢN ĐỒ FIBONACCI & MỤC TIÊU SẮP QUÉT TỚI:</b>\n`;
  msg += `  • <i>Biên sóng phiên: <b>${fibo.swingLow} ➔ ${fibo.swingHigh}</b> (Biên ${fibo.range}đ)</i>\n`;

  // Vùng Cung trên
  if (sdTargets.nextSupplyTarget) {
    const t = sdTargets.nextSupplyTarget;
    msg += `  🔴 <b>VÙNG CUNG TRÊN GẦN NHẤT:</b> <b>${t.price}</b> (${t.levelName}) — <i>cách ${t.dist}đ</i>\n`;
    msg += `     👉 <i>Mục đích: ${t.role}</i>\n`;
  }
  if (sdTargets.huntSupplyTarget && sdTargets.huntSupplyTarget.price !== sdTargets.nextSupplyTarget?.price) {
    const ht = sdTargets.huntSupplyTarget;
    msg += `  🚀 <b>VÙNG QUÉT SHORT SQUEEZE:</b> <b>${ht.price}</b> (${ht.levelName}) — <i>cách ${ht.dist}đ (Kéo rướn quét SL Short)</i>\n`;
  }

  // Điểm cân bằng
  msg += `  ⚖️ <b>RANH GIỚI CÂN BẰNG FIBO 50%:</b> <b>${fibo.f500}</b> <i>(Ranh giới Bull / Bear)</i>\n`;

  // Vùng Cầu dưới
  if (sdTargets.nextDemandTarget) {
    const d = sdTargets.nextDemandTarget;
    msg += `  🟢 <b>VÙNG CẦU DƯỚI GẦN NHẤT:</b> <b>${d.price}</b> (${d.levelName}) — <i>cách ${d.dist}đ</i>\n`;
    msg += `     👉 <i>Mục đích: ${d.role}</i>\n`;
  }
  if (sdTargets.huntDemandTarget && sdTargets.huntDemandTarget.price !== sdTargets.nextDemandTarget?.price) {
    const hd = sdTargets.huntDemandTarget;
    msg += `  💀 <b>VÙNG QUÉT LONG LIQUIDATION:</b> <b>${hd.price}</b> (${hd.levelName}) — <i>cách ${hd.dist}đ (Nhúng xuyên quét SL Long)</i>\n`;
  }

  return msg;
}

// ─── MASTER INTRADAY CYCLE ────────────────────────────────────
async function runIntradaySignal(triggerContext = null) {
  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('⚡ RADAR CUNG CẦU & BẢN ĐỒ FIBONACCI — 5p Intraday');
  console.log('═'.repeat(55));

  try {
    _signalCount++;

    // 1. Lấy toàn bộ dữ liệu song song
    const [
      m15Data,
      m5Data,
      m1Data,
      futuresPrice,
      vn30Price,
      vnindexPrice,
      oiData,
      liquidityInfo,
    ] = await Promise.all([
      dataFetcher.fetchOHLCV('VN30F1M', '15', 3).catch(e => null),
      dataFetcher.fetchIntraday5m('VN30F1M').catch(e => null),
      dataFetcher.fetchIntraday1m('VN30F1M').catch(e => null),
      dataFetcher.fetchRealtimeFuturesPrice().catch(e => null),
      dataFetcher.fetchRealtimeVN30Price().catch(e => null),
      dataFetcher.fetchRealtimeVNINDEXPrice().catch(e => null),
      dataFetcher.fetchDerivativesOIData().catch(e => null),
      calculateMarketLiquiditySpeed().catch(e => null),
    ]);

    const lastKnown = dataFetcher.getLastKnownPrices ? dataFetcher.getLastKnownPrices() : {};
    const f1mPrice = (futuresPrice && futuresPrice.price) || (m5Data?.c ? m5Data.c[m5Data.c.length - 1] : lastKnown.f1m);
    const vn30PriceVal = (vn30Price && vn30Price.price) || lastKnown.vn30;

    // 2. Phân tích Fibonacci & Cung cầu
    const fibo = fibonacciLiquidityEngine.calculateDynamicFibonacci(m5Data, m1Data, f1mPrice);
    const sdTargets = fibonacciLiquidityEngine.mapSupplyDemandTargets(fibo, f1mPrice, m5Data, m1Data, oiData);
    const sidewayInfo = fibonacciLiquidityEngine.detectSidewayCrowdZone(fibo, f1mPrice, m5Data, m1Data);
    const vsaAction = fibonacciLiquidityEngine.analyzeVSAIntradayAction(m5Data, m1Data, f1mPrice, oiData);

    // 3. Phân tích đa khung
    const m15Analysis = analyze15mTimeframe(m15Data);
    const m5Analysis = analyze5mTimeframe(m5Data, m15Analysis.signal);
    const m1Analysis = analyze1mTimeframe(m1Data, m5Analysis.entrySignal);
    const structureInfo = analyzeMarketStructureFromCandles(m5Data, m15Data);

    // 4. Smart Money
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

    const contextInfo = marketContext.buildMarketContext(f1mPrice, vn30PriceVal, oiData);

    // 5. Format & Gửi Telegram
    const msg = formatRadarNotification({
      f1mPrice,
      vn30Price: vn30PriceVal,
      basis: contextInfo?.basis,
      fibo,
      sdTargets,
      sidewayInfo,
      vsaAction,
      m15Analysis,
      m5Analysis,
      m1Analysis,
      structureInfo,
      liquidityInfo,
      smartMoneyInfo,
      contextInfo,
      signalCount: _signalCount,
      triggerContext,
    });

    await sendDerivativesMessage(msg);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Radar Cung Cầu & Fibo #${_signalCount} hoàn thành [${elapsed}s]`);

    return {
      fibo,
      sdTargets,
      sidewayInfo,
      vsaAction,
      signalCount: _signalCount,
    };
  } catch (err) {
    console.error(`   ❌ Radar Cung Cầu & Fibo lỗi:`, err.message);
    return null;
  }
}

// Giữ hàm tương thích nếu có module gọi
async function generateAndSendDailyReport() {
  return {};
}

module.exports = {
  runIntradaySignal,
  runAIEnhancedSignal: runIntradaySignal,
  generateAndSendDailyReport,
  resetIntradayState,
  calculateMarketLiquiditySpeed,
  analyzeMarketStructureFromCandles,
  analyze15mTimeframe,
  analyze5mTimeframe,
  analyze1mTimeframe,
  formatIntradaySignal: formatRadarNotification,
  formatRadarNotification,
  getState: () => ({ signalCount: _signalCount }),
};
