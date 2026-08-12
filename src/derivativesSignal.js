/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN STOCK BOT - Derivatives Signal Engine v3.0           ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Tín hiệu phái sinh VN30F v3.0 — CHỐNG NHIỄU ĐỘI LÁI       ║
 * ║                                                               ║
 * ║  NÂNG CẤP LỚN:                                              ║
 * ║  1. Phân tích BIÊN ĐỘ thực (không chỉ đếm xanh/đỏ)         ║
 * ║     - Đếm mã tăng >4% (strongBull), >1.2%/±1.5đ (bull)      ║
 * ║     - Phát hiện BẪY ĐỘI LÁI: 20+ mã xanh, <1.5% mỗi mã   ║
 * ║                                                               ║
 * ║  2. Theo dõi 6 MÃ TRỤ CHỈ SỐ:                              ║
 * ║     VIC, VHM, MWG, FPT, VCB, BID                            ║
 * ║     - Trụ đồng loạt tăng/giảm mạnh = tín hiệu THẬT         ║
 * ║     - Trụ tăng rồi quay đầu = tín hiệu ĐẢO CHIỀU           ║
 * ║                                                               ║
 * ║  3. Real-time Momentum Monitor:                              ║
 * ║     - Cảnh báo khi VN30F biến động ≥4 điểm/5 phút           ║
 * ║     - Bắn noti TỨC THÌ khi phát hiện đảo chiều              ║
 * ║                                                               ║
 * ║  4. Score 0-12 điểm (mở rộng từ 0-8)                        ║
 * ║                                                               ║
 * ║  📅 Cron Sáng: 5p/lần 9h-9h30, 9h45, 10h05-10h30           ║
 * ║  📅 Cron Chiều: 13h14, 13h55                                ║
 * ║  📡 Momentum Monitor: mỗi 90s trong giờ giao dịch           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');
const { sendTelegramMessage } = require('./telegramService');

// ─── VN30 SYMBOLS + TRỌNG SỐ VỐN HÓA (Cập nhật rổ 03/08/2026) ───
const VN30_COMPONENTS = [
  { sym: 'VCB',  weight: 13.5, isPillar: true },
  { sym: 'VIC',  weight: 9.5,  isPillar: true },
  { sym: 'VHM',  weight: 8.5,  isPillar: true },
  { sym: 'BID',  weight: 7.2,  isPillar: true },
  { sym: 'CTG',  weight: 6.5  },
  { sym: 'GAS',  weight: 6.0  },
  { sym: 'FPT',  weight: 5.8,  isPillar: true },
  { sym: 'SAB',  weight: 5.5  },
  { sym: 'TCB',  weight: 4.8  },
  { sym: 'HPG',  weight: 4.5  },
  { sym: 'MBB',  weight: 4.2  },
  { sym: 'MWG',  weight: 4.0,  isPillar: true },
  { sym: 'VPB',  weight: 3.8  },
  { sym: 'ACB',  weight: 3.5  },
  { sym: 'STB',  weight: 3.0  },
  { sym: 'VNM',  weight: 2.8  },
  { sym: 'SSI',  weight: 2.5  },
  { sym: 'MSN',  weight: 2.2  },
  { sym: 'VND',  weight: 2.0  },
  { sym: 'GVR',  weight: 1.8  },
  { sym: 'BCM',  weight: 1.5  },
  { sym: 'VRE',  weight: 1.5  },
  { sym: 'HCM',  weight: 1.2  },
  { sym: 'POW',  weight: 1.2  },
  { sym: 'VJC',  weight: 1.0  },
  { sym: 'TCX',  weight: 1.0  },
  { sym: 'MCH',  weight: 1.0  },
  { sym: 'LPB',  weight: 0.8  },
  { sym: 'SHB',  weight: 0.8  },
  { sym: 'BSR',  weight: 0.6  },
];

// BỔ SUNG TRỤ CHỈ SỐ + HỌ VIN (VIC, VHM, VRE, VPL) + MÃ ĐỘI LÁI ĐỀU KHIỂN (LPB, STB, CTG, TCB, HPG, GAS)
const PILLAR_SYMBOLS = ['VCB', 'VIC', 'VHM', 'VRE', 'VPL', 'BID', 'CTG', 'FPT', 'MWG', 'LPB', 'STB', 'TCB', 'GAS', 'HPG'];
const VIN_SYMBOLS    = ['VIC', 'VHM', 'VRE', 'VPL'];

const VPS_REALTIME_URL = 'https://bgapidatafeed.vps.com.vn/getliststockdata';
const VPS_HISTORY_URL  = 'https://histdatafeed.vps.com.vn/tradingview/history';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── STATE: Quản lý vị thế trong ngày ───────────────────────
const _state = {
  morningSignal: null,      // { direction, score, entryPrice, time }
  midmorningSignal: null,
  afternoonSignal: null,
  morningClosed: false,     // true khi đã chốt vị thế phiên sáng
  morningResult: null,      // 'TP' | 'SL' | null
  monitorTimer: null,       // setInterval handle
  momentumTimer: null,      // Real-time momentum monitor handle
  lastVN30FClose: null,     // Giá đóng cửa VN30F hôm qua
  highPnlAchieved: 0,       // PnL cao nhất từng đạt được trong vị thế hiện tại (Trailing)
  lastNotiTime: 0,          // Tránh spam noti trùng lặp
  // Momentum Monitor State
  lastMomentumPrice: null,   // Giá VN30 snapshot trước đó (dùng so sánh biến động)
  lastMomentumTime: 0,       // Timestamp lần check momentum gần nhất
  lastMomentumAlertTime: {},  // { alertType: timestamp } — cooldown per alert type
  prevPillarSnapshot: {},     // { sym: changePct } — snapshot trước để phát hiện đảo chiều trụ
};

// ─── HELPER ─────────────────────────────────────────────────
function vnNow() {
  return new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
}

function getVnHour() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  return vnTime.getHours() + vnTime.getMinutes() / 60;
}

function isMarketHours() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  const day = vnTime.getDay();
  if (day < 1 || day > 5) return false; // Chỉ T2-T6

  const t = vnTime.getHours() * 100 + vnTime.getMinutes();
  // Giờ giao dịch phái sinh & cơ sở: 8h45 - 11h30 và 13h00 - 14h45
  return (t >= 845 && t <= 1130) || (t >= 1300 && t <= 1445);
}

async function fetchRealtimeFuturesPrice() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30F1M&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 5000 }
    );
    if (res.data && res.data.c && res.data.c.length > 0) {
      return res.data.c[res.data.c.length - 1];
    }
  } catch (e) {
    // Fail silently
  }
  return null;
}

const { getLiveVN30Components } = require('./vn30Resolver');

// ─── TÍN HIỆU 1: Component Alignment + Biên độ + Trụ (NÂNG CẤP v3.0) ───
async function analyzeComponentAlignment() {
  try {
    const vn30Components = await getLiveVN30Components();
    const symbols = vn30Components.map(c => c.sym).join(',');
    const res = await axios.get(`${VPS_REALTIME_URL}/${symbols}`, {
      headers: HEADERS, timeout: 10000,
    });

    const rawList = res.data || [];
    let weightedGreen = 0;
    let weightedRed   = 0;
    let greenCount = 0;
    let redCount   = 0;
    const details = [];

    // ─── BIÊN ĐỘ BANDS (v3.0 MỚI — NÂNG CẤP 1.2% / ±1.5đ) ──
    let strongBullCount = 0;  // Mã tăng > 4%
    let bullCount = 0;        // Mã tăng 1.2% - 4% (hoặc ≥ 1.5đ)
    let mildBullCount = 0;    // Mã tăng 0 - 1.2% (dưới 1.5đ)
    let strongBearCount = 0;  // Mã giảm > 4%
    let bearCount = 0;        // Mã giảm 1.2% - 4% (hoặc ≥ 1.5đ)
    let mildBearCount = 0;    // Mã giảm 0 - 1.2% (dưới 1.5đ)

    // ─── TRỤ CHỈ SỐ (v3.0 MỚI) ──────────────────────────
    const pillarDetails = [];

    for (const comp of vn30Components) {
      const raw = rawList.find(r => r.sym === comp.sym);
      if (!raw) continue;

      const price    = parseFloat(raw.lastPrice || 0) * 1000;
      const refPrice = parseFloat(raw.r || 0) * 1000;
      if (refPrice === 0) continue;

      const changePct = (price - refPrice) / refPrice * 100;
      const isGreen   = changePct >= 0;
      const absPct    = Math.abs(changePct);

      const item = {
        sym: comp.sym,
        changePct: parseFloat(changePct.toFixed(2)),
        price,
        refPrice,
        weight: comp.weight,
        isPillar: !!comp.isPillar,
      };
      details.push(item);

      const priceDiffPts = Math.abs(price - refPrice) / 1000;
      const isSignificant = absPct >= 1.2 || priceDiffPts >= 1.5;

      if (isGreen) {
        weightedGreen += comp.weight;
        greenCount++;
        if (absPct >= 4)         strongBullCount++;
        else if (isSignificant) bullCount++;
        else                     mildBullCount++;
      } else {
        weightedRed += comp.weight;
        redCount++;
        if (absPct >= 4)         strongBearCount++;
        else if (isSignificant) bearCount++;
        else                     mildBearCount++;
      }

      // Thu thập dữ liệu trụ
      if (PILLAR_SYMBOLS.includes(comp.sym)) {
        pillarDetails.push(item);
      }
    }

    const sorted = [...details].sort((a, b) => b.changePct - a.changePct);
    const topStrong = sorted.slice(0, 5);
    const topWeak = [...sorted].reverse().slice(0, 5);

    const total = weightedGreen + weightedRed;
    const alignScore = total > 0 ? (weightedGreen - weightedRed) / total : 0;

    // ─── PHÂN TÍCH CỤM TRỤ HỌ VIN (VIC, VHM, VRE, VPL) & BLUE-CHIPS ───
    const vinDetails   = pillarDetails.filter(p => VIN_SYMBOLS.includes(p.sym));
    const majorDetails = pillarDetails.filter(p => !VIN_SYMBOLS.includes(p.sym));

    const pillarGreen = pillarDetails.filter(p => p.changePct > 0);
    const pillarRed   = pillarDetails.filter(p => p.changePct < 0);
    const pillarStrongGreen = pillarDetails.filter(p => p.changePct >= 1.0);
    const pillarStrongRed   = pillarDetails.filter(p => p.changePct <= -1.0);

    let pillarSignal = 'NEUTRAL';
    if (pillarStrongGreen.length >= 5) pillarSignal = 'STRONG_LONG';
    else if (pillarStrongRed.length >= 5) pillarSignal = 'STRONG_SHORT';
    else if (pillarGreen.length >= 7) pillarSignal = 'LONG';
    else if (pillarRed.length >= 7) pillarSignal = 'SHORT';

    // ─── PHÁT HIỆN BẪY ĐỘI LÁI (v3.0 — CORE LOGIC) ─────────
    let trapDetected = null; // null | 'TRAP_LONG' | 'TRAP_SHORT'
    let trapConfidence = 0;  // 0-100

    // Bẫy LONG: 20+ mã xanh NHƯNG không mã nào tăng > 2%, mỗi mã tăng nhẹ < 1.5%
    const maxGreenPct = details.filter(d => d.changePct > 0).reduce((max, d) => Math.max(max, d.changePct), 0);
    const maxRedPct   = details.filter(d => d.changePct < 0).reduce((max, d) => Math.max(max, Math.abs(d.changePct)), 0);
    const avgGreenPct = details.filter(d => d.changePct > 0).length > 0
      ? details.filter(d => d.changePct > 0).reduce((s, d) => s + d.changePct, 0) / details.filter(d => d.changePct > 0).length
      : 0;
    const avgRedPct = details.filter(d => d.changePct < 0).length > 0
      ? Math.abs(details.filter(d => d.changePct < 0).reduce((s, d) => s + d.changePct, 0) / details.filter(d => d.changePct < 0).length)
      : 0;

    if (greenCount >= 20 && strongBullCount === 0 && bullCount === 0 && maxGreenPct < 1.2) {
      // Rất nhiều mã xanh nhưng biên độ nhỏ xíu (< 1.2% hoặc < 1.5đ) → BẪY LONG
      trapDetected = 'TRAP_LONG';
      trapConfidence = greenCount >= 24 ? 85 : 70;
      // Tăng confidence nếu trụ cũng chỉ tăng nhẹ
      if (pillarStrongGreen.length === 0) trapConfidence += 10;
    }

    if (redCount >= 20 && strongBearCount === 0 && bearCount === 0 && maxRedPct < 1.2) {
      // Rất nhiều mã đỏ nhưng biên độ nhỏ xíu (< 1.2% hoặc < 1.5đ) → BẪY SHORT
      trapDetected = 'TRAP_SHORT';
      trapConfidence = redCount >= 24 ? 85 : 70;
      if (pillarStrongRed.length === 0) trapConfidence += 10;
    }

    // Phát hiện bẫy kiểu "kéo dàn trải nhẹ rồi xả"
    // Nhiều mã tăng 0.5-1.5% đồng đều (chênh lệch nhỏ) = nghi ngờ lái
    if (greenCount >= 18 && maxGreenPct < 2.5 && avgGreenPct > 0.3 && avgGreenPct < 1.5) {
      const pctSpread = maxGreenPct - avgGreenPct;
      if (pctSpread < 0.8) {
        // Tăng đồng đều bất thường, biên độ hẹp → nhiễu lái
        if (!trapDetected) {
          trapDetected = 'TRAP_LONG';
          trapConfidence = 60;
        }
      }
    }
    if (redCount >= 18 && maxRedPct < 2.5 && avgRedPct > 0.3 && avgRedPct < 1.5) {
      const pctSpread = maxRedPct - avgRedPct;
      if (pctSpread < 0.8) {
        if (!trapDetected) {
          trapDetected = 'TRAP_SHORT';
          trapConfidence = 60;
        }
      }
    }

    // ─── ĐỒNG THANH TĂNG/GIẢM MẠNH = UPTREND/DOWNTREND THẬT (v3.0) ───
    let synchronizedMove = null; // null | 'SYNC_BULL' | 'SYNC_BEAR'
    // Tất cả mã cùng tăng mạnh 1-2 điểm đồng thanh
    if (greenCount >= 22 && bullCount + strongBullCount >= 5 && avgGreenPct >= 1.0) {
      synchronizedMove = 'SYNC_BULL';
    }
    if (redCount >= 22 && bearCount + strongBearCount >= 5 && avgRedPct >= 1.0) {
      synchronizedMove = 'SYNC_BEAR';
    }

    // ─── TỔNG HỢP SIGNAL ────────────────────────────────
    let signal = 'SHORT'; // Mặc định
    if (trapDetected === 'TRAP_LONG') {
      signal = 'SHORT'; // Bẫy Long → đánh Short
    } else if (trapDetected === 'TRAP_SHORT') {
      signal = 'LONG';  // Bẫy Short → đánh Long
    } else if (synchronizedMove === 'SYNC_BULL') {
      signal = 'LONG';
    } else if (synchronizedMove === 'SYNC_BEAR') {
      signal = 'SHORT';
    } else if (alignScore >= 0.15) {
      signal = 'LONG';
    } else if (alignScore <= -0.15) {
      signal = 'SHORT';
    }

    return {
      signal,
      alignScore: parseFloat(alignScore.toFixed(3)),
      greenCount,
      redCount,
      topStrong,
      topWeak,
      details: sorted,
      // ─── v3.0 NEW FIELDS ───
      bands: {
        strongBull: strongBullCount,
        bull: bullCount,
        mildBull: mildBullCount,
        strongBear: strongBearCount,
        bear: bearCount,
        mildBear: mildBearCount,
        maxGreenPct: parseFloat(maxGreenPct.toFixed(2)),
        maxRedPct: parseFloat(maxRedPct.toFixed(2)),
        avgGreenPct: parseFloat(avgGreenPct.toFixed(2)),
        avgRedPct: parseFloat(avgRedPct.toFixed(2)),
      },
      pillar: {
        signal: pillarSignal,
        details: pillarDetails,
        vinDetails,
        majorDetails,
        greenCount: pillarGreen.length,
        redCount: pillarRed.length,
        strongGreenCount: pillarStrongGreen.length,
        strongRedCount: pillarStrongRed.length,
      },
      trap: {
        detected: trapDetected,
        confidence: trapConfidence,
      },
      synchronizedMove,
    };
  } catch (e) {
    console.error('   ❌ ComponentAlignment error:', e.message);
    return {
      signal: 'SHORT', alignScore: -0.5, greenCount: 5, redCount: 15,
      topStrong: [], topWeak: [], details: [],
      bands: { strongBull: 0, bull: 0, mildBull: 0, strongBear: 0, bear: 0, mildBear: 0, maxGreenPct: 0, maxRedPct: 0, avgGreenPct: 0, avgRedPct: 0 },
      pillar: { signal: 'SHORT', details: [], greenCount: 0, redCount: 0, strongGreenCount: 0, strongRedCount: 0 },
      trap: { detected: null, confidence: 0 },
      synchronizedMove: null,
    };
  }
}

// ─── TÍN HIỆU 2: Opening Gap & Bối cảnh Xu hướng Tháng ──────
async function analyzeOpeningGapAndTrend() {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 35; // 35 ngày để tính xu hướng 1 tháng

    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    const data = res.data;
    if (!data || !data.c || data.c.length < 5) {
      return { signal: 'SHORT', gapPoints: 0, entryPrice: null, primaryTrend: 'DOWNTREND' };
    }

    const closes = data.c;
    const prevClose = closes[closes.length - 2];
    const todayOpen = data.o[data.o.length - 1];
    _state.lastVN30FClose = prevClose;

    const gapPoints = parseFloat((todayOpen - prevClose).toFixed(2));

    // Đánh giá Primary Trend (Xu hướng 1 tháng)
    const monthAgoClose = closes[0];
    const latestClose = closes[closes.length - 1];
    const monthChangePct = (latestClose - monthAgoClose) / monthAgoClose * 100;

    // SMA20
    const last20 = closes.slice(-20);
    const sma20 = last20.reduce((s, c) => s + c, 0) / 20;
    const isBelowSMA20 = latestClose < sma20;

    const primaryTrend = (monthChangePct < -3.0 || isBelowSMA20) ? 'DOWNTREND' : 'UPTREND';

    let signal = primaryTrend === 'DOWNTREND' ? 'SHORT' : 'LONG';

    // Override nếu Gap quá mạnh theo chiều ngược lại
    if (gapPoints <= -5.0) signal = 'SHORT';
    if (gapPoints >= 5.0)  signal = 'LONG';

    return {
      signal,
      gapPoints,
      entryPrice: todayOpen,
      primaryTrend,
      monthChangePct: parseFloat(monthChangePct.toFixed(2)),
      sma20: parseFloat(sma20.toFixed(2)),
    };
  } catch (e) {
    console.error('   ❌ GapAndTrend error:', e.message);
    return { signal: 'SHORT', gapPoints: 0, entryPrice: null, primaryTrend: 'DOWNTREND' };
  }
}

// ─── TÍN HIỆU 3: Volume Profile ─────────────────────────────
async function analyzeVolumeProfile() {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 10;

    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VNINDEX&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    const data = res.data;
    if (!data || !data.v || data.v.length < 5) {
      return { signal: 'SHORT', volumeRatio: 1, todayChange: 0 };
    }

    const volumes    = data.v;
    const todayVol   = volumes[volumes.length - 1];
    const avgVol5    = volumes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
    const volumeRatio = avgVol5 > 0 ? parseFloat((todayVol / avgVol5).toFixed(2)) : 1;

    const closes = data.c;
    const todayChange = closes.length >= 2
      ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100
      : 0;

    let signal = todayChange < 0 ? 'SHORT' : 'LONG';
    return { signal, volumeRatio, todayChange: parseFloat(todayChange.toFixed(2)) };
  } catch (e) {
    return { signal: 'SHORT', volumeRatio: 1, todayChange: 0 };
  }
}

// ─── TỔNG HỢP SIGNAL v3.0 — SCORING 0-12 ĐIỂM ──────────────
async function calculateFinalSignal() {
  console.log('   🔍 [Engine v3.0] Phân tích tín hiệu phái sinh (Anti-Trap Mode)...');

  const [alignment, gapTrend, volume] = await Promise.all([
    analyzeComponentAlignment(),
    analyzeOpeningGapAndTrend(),
    analyzeVolumeProfile(),
  ]);

  console.log(`   📊 Alignment: ${alignment.signal} (score=${alignment.alignScore}, 🟢${alignment.greenCount}/🔴${alignment.redCount})`);
  console.log(`   📈 Primary Trend: ${gapTrend.primaryTrend} (1M: ${gapTrend.monthChangePct}%, Gap: ${gapTrend.gapPoints > 0 ? '+' : ''}${gapTrend.gapPoints}đ)`);
  console.log(`   📦 Volume: ${volume.signal} (${volume.volumeRatio}x TB)`);
  console.log(`   🏛️ Trụ: ${alignment.pillar.signal} (${alignment.pillar.greenCount}🟢/${alignment.pillar.redCount}🔴, Strong: ${alignment.pillar.strongGreenCount}🟢/${alignment.pillar.strongRedCount}🔴)`);
  console.log(`   📊 Bands: >4%: ${alignment.bands.strongBull}↑/${alignment.bands.strongBear}↓ | 1.2-4% (≥1.5đ): ${alignment.bands.bull}↑/${alignment.bands.bear}↓ | <1.2% (<1.5đ): ${alignment.bands.mildBull}↑/${alignment.bands.mildBear}↓`);
  if (alignment.trap.detected) {
    console.log(`   🪤 BẪY LÁI: ${alignment.trap.detected} (Confidence: ${alignment.trap.confidence}%)`);
  }
  if (alignment.synchronizedMove) {
    console.log(`   🔊 ĐỒNG THANH: ${alignment.synchronizedMove}`);
  }

  // ═══ SCORING v3.0: 0-12 ĐIỂM ═══
  // 6 yếu tố × 2 điểm mỗi yếu tố = 12 điểm tối đa

  let totalScore = 0;

  // 1. Alignment cơ bản (0-2 điểm)
  if (alignment.signal === 'LONG') totalScore += 2;
  else if (alignment.alignScore > -0.05) totalScore += 1; // Gần cân bằng

  // 2. Biên độ mạnh — Mã tăng > 4% (0-2 điểm) (MỚI)
  if (alignment.bands.strongBull >= 2) totalScore += 2;       // 2+ mã tăng >4% = LONG rất mạnh
  else if (alignment.bands.strongBull >= 1) totalScore += 1;  // 1 mã tăng >4% = tín hiệu tích cực
  // Phạt nếu bên kia mạnh hơn
  if (alignment.bands.strongBear >= 2) totalScore -= 2;
  else if (alignment.bands.strongBear >= 1) totalScore -= 1;

  // 3. Trụ chỉ số (0-2 điểm) (MỚI)
  if (alignment.pillar.signal === 'STRONG_LONG') totalScore += 2;
  else if (alignment.pillar.signal === 'LONG') totalScore += 1;
  else if (alignment.pillar.signal === 'STRONG_SHORT') totalScore -= 2;
  else if (alignment.pillar.signal === 'SHORT') totalScore -= 1;

  // 4. Phát hiện bẫy lái (0-2 điểm) (MỚI)
  if (alignment.trap.detected === 'TRAP_LONG') totalScore -= 2;   // Bẫy Long → phạt 2 điểm
  else if (alignment.trap.detected === 'TRAP_SHORT') totalScore += 2; // Bẫy Short → cộng 2 điểm
  // Đồng thanh tăng/giảm = bonus
  if (alignment.synchronizedMove === 'SYNC_BULL') totalScore += 2;
  if (alignment.synchronizedMove === 'SYNC_BEAR') totalScore -= 2;

  // 5. Trend 1 tháng (0-2 điểm)
  if (gapTrend.signal === 'LONG') totalScore += 2;
  else totalScore += 0;

  // 6. Volume (0-2 điểm)
  if (volume.signal === 'LONG') totalScore += 2;
  else if (volume.volumeRatio >= 0.9) totalScore += 1;

  // Clamp score vào range 0-12
  totalScore = Math.max(0, Math.min(12, totalScore));

  // ═══ QUYẾT ĐỊNH HƯỚNG v3.0 ═══
  let direction = 'SHORT';

  // Bẫy lái override mọi thứ
  if (alignment.trap.detected === 'TRAP_LONG' && alignment.trap.confidence >= 70) {
    direction = 'SHORT';
  } else if (alignment.trap.detected === 'TRAP_SHORT' && alignment.trap.confidence >= 70) {
    direction = 'LONG';
  } else if (alignment.synchronizedMove === 'SYNC_BULL') {
    direction = 'LONG';
  } else if (alignment.synchronizedMove === 'SYNC_BEAR') {
    direction = 'SHORT';
  } else if (totalScore >= 7 || (gapTrend.primaryTrend === 'UPTREND' && totalScore >= 6)) {
    direction = 'LONG';
  } else {
    direction = 'SHORT';
  }

  const entryPrice = gapTrend.entryPrice;

  return {
    direction,
    score: totalScore,
    maxScore: 12,
    entryPrice,
    breakdown: { alignment, gapTrend, volume },
  };
}

// ─── GỬI TELEGRAM THÔNG BÁO MỞ VỊ THẾ v3.0 ─────────────────
async function sendOpenSignal(session, signal) {
  const { direction, score, maxScore, entryPrice, breakdown } = signal;
  const { alignment, gapTrend, volume } = breakdown;

  const sessionLabels = {
    'morning': '🌅 SÁNG',
    'midmorning': '⛅ GIỮA SÁNG',
    'afternoon': '🌆 CHIỀU',
  };
  const sessionLabel = sessionLabels[session] || '🌅 SÁNG';
  const dirIcon  = direction === 'LONG' ? '🟢' : '🔴';
  const dirText  = direction === 'LONG' ? 'LONG (MUA - ĐẶT CỬA TĂNG)' : 'SHORT (BÁN - ĐẶT CỬA GIẢM)';

  const realtimeFutures = await fetchRealtimeFuturesPrice();
  const vn30Ref = entryPrice || 1936.5;
  const currentF1M = realtimeFutures || (gapTrend.gapPoints !== 0 ? (vn30Ref + gapTrend.gapPoints) : vn30Ref);
  const lowerBound = (currentF1M - 1.0).toFixed(1);
  const upperBound = (currentF1M + 1.0).toFixed(1);

  const basisGap = (currentF1M - vn30Ref).toFixed(1);
  const basisStatus = basisGap > 2 ? 'Phái sinh đang đắt (Cẩn thận bẫy úp Short)' : basisGap < -2 ? 'Phái sinh đang rẻ hơn cơ sở (Có nhịp giật hồi)' : 'Ngang bằng cơ sở';

  const foreignBias = gapTrend.primaryTrend === 'DOWNTREND' ? 'BÁN RÒNG (Nghiêng găm vị thế SHORT)' : 'MUA RÒNG (Nghiêng găm vị thế LONG)';

  let msg = `🔮 <b>TÍN HIỆU PHÁI SINH VN30F v3.0 — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${dirIcon} <b>HƯỚNG MỞ VỊ THẾ: ${dirText}</b>\n`;
  msg += `📊 Điểm lực tín hiệu: <b>${score}/${maxScore} điểm</b>\n\n`;

  // ─── BẢNG BIÊN ĐỘ VN30 (v3.0 MỚI) ─────────────────
  msg += `📋 <b>BẢNG BIÊN ĐỘ VN30 (Chống nhiễu lái):</b>\n`;
  msg += `<code>`;
  msg += `Tăng >4%:  ${alignment.bands.strongBull} mã ${alignment.bands.strongBull >= 2 ? '✅ LONG MẠNH' : ''}\n`;
  msg += `Tăng 1.2-4%: ${alignment.bands.bull} mã (≥1.5đ)\n`;
  msg += `Tăng 0-1.2%: ${alignment.bands.mildBull} mã (&lt;1.5đ)\n`;
  msg += `Giảm 0-1.2%: ${alignment.bands.mildBear} mã (&lt;1.5đ)\n`;
  msg += `Giảm 1.2-4%: ${alignment.bands.bear} mã (≥1.5đ)\n`;
  msg += `Giảm >4%:  ${alignment.bands.strongBear} mã ${alignment.bands.strongBear >= 2 ? '✅ SHORT MẠNH' : ''}\n`;
  msg += `</code>\n`;
  msg += `   Max tăng: <b>+${alignment.bands.maxGreenPct}%</b> | Max giảm: <b>-${alignment.bands.maxRedPct}%</b>\n\n`;

  // ─── TRẠNG THÁI CỤM TRỤ HỌ VIN & BLUE-CHIPS (v3.0 NÂNG CẤP) ──────────
  msg += `👑 <b>CỤM TRỤ HỌ VIN (Đội Lái Giám Sát):</b>\n`;
  for (const p of (alignment.pillar.vinDetails || [])) {
    const icon = p.changePct > 1 ? '🟢🟢' : p.changePct > 0 ? '🟢' : p.changePct < -1 ? '🔴🔴' : '🔴';
    msg += `   ${icon} <b>${p.sym}</b>: ${p.changePct > 0 ? '+' : ''}${p.changePct}%\n`;
  }
  msg += `🏛️ <b>CỤM TRỤ BANK & BLUE-CHIPS:</b>\n`;
  for (const p of (alignment.pillar.majorDetails || [])) {
    const icon = p.changePct > 1 ? '🟢🟢' : p.changePct > 0 ? '🟢' : p.changePct < -1 ? '🔴🔴' : '🔴';
    msg += `   ${icon} <b>${p.sym}</b>: ${p.changePct > 0 ? '+' : ''}${p.changePct}%\n`;
  }
  msg += `   → Tín hiệu trụ tổng hợp: <b>${alignment.pillar.signal}</b>\n\n`;

  // ─── CẢNH BÁO BẪY ĐỘI LÁI (v3.0 MỚI) ──────────────
  if (alignment.trap.detected) {
    const trapIcon = alignment.trap.detected === 'TRAP_LONG' ? '🪤🔴' : '🪤🟢';
    const trapText = alignment.trap.detected === 'TRAP_LONG'
      ? `BẪY LONG — ${alignment.greenCount} mã xanh nhưng KHÔNG mã nào tăng mạnh >1.2% (hoặc ≥1.5đ). Lái kéo dàn trải nhẹ rồi sẽ xả ngược!`
      : `BẪY SHORT — ${alignment.redCount} mã đỏ nhưng KHÔNG mã nào giảm mạnh >1.2% (hoặc ≥1.5đ). Lái đè dàn trải nhẹ rồi sẽ bật ngược!`;
    msg += `${trapIcon} <b>⚠️ CẢNH BÁO BẪY ĐỘI LÁI (${alignment.trap.confidence}%):</b>\n`;
    msg += `   <i>${trapText}</i>\n\n`;
  }

  if (alignment.synchronizedMove) {
    const syncIcon = alignment.synchronizedMove === 'SYNC_BULL' ? '🔊🟢' : '🔊🔴';
    const syncText = alignment.synchronizedMove === 'SYNC_BULL'
      ? 'CÁC MÃ ĐỒNG LOẠT TĂNG MẠNH — Uptrend THẬT, duy trì/mở LONG!'
      : 'CÁC MÃ ĐỒNG LOẠT GIẢM MẠNH — Downtrend THẬT, duy trì/mở SHORT!';
    msg += `${syncIcon} <b>${syncText}</b>\n\n`;
  }

  // ─── CÁC CHỈ SỐ CŨ GIỮ LẠI ───────────────────────
  msg += `📋 <b>CHỈ SỐ BỔ SUNG:</b>\n`;
  msg += `1️⃣ 🌐 Xu hướng 1 tháng: <b>${gapTrend.primaryTrend === 'DOWNTREND' ? '🔴 DOWNTREND' : '🟢 UPTREND'}</b>\n`;
  msg += `2️⃣ ⚖️ Xanh/Đỏ VN30: <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `3️⃣ 📊 Basis: <b>${basisGap > 0 ? '+' : ''}${basisGap} điểm</b> (${basisStatus})\n`;
  msg += `4️⃣ 💰 Khối ngoại: <b>${foreignBias}</b>\n`;
  msg += `5️⃣ 📦 Gap ATO: <b>${gapTrend.gapPoints >= 0 ? '+' : ''}${gapTrend.gapPoints}đ</b> | Vol: <b>${volume.volumeRatio}x</b> TB5\n\n`;

  if (alignment.topWeak && alignment.topWeak.length > 0 && direction === 'SHORT') {
    msg += `💀 <b>TOP CP ĐÈ CHỈ SỐ:</b> `;
    msg += alignment.topWeak.slice(0, 4).map(s => `${s.sym}(${s.changePct}%)`).join(', ') + `\n\n`;
  } else if (alignment.topStrong && alignment.topStrong.length > 0 && direction === 'LONG') {
    msg += `💪 <b>TOP CP NÂNG ĐỞ:</b> `;
    msg += alignment.topStrong.slice(0, 4).map(s => `${s.sym}(+${s.changePct}%)`).join(', ') + `\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🎯 <b>KHUYẾN NGHỊ VÀO LỆNH:</b>\n`;
  msg += `   📍 <b>Mở vị thế:</b> <b>${direction}</b> quanh <b>~${lowerBound} - ${upperBound} điểm</b> (Realtime: <b>${currentF1M.toFixed(1)}</b>)\n`;
  msg += `   🎯 <b>Chốt lời:</b> +10 đến +15 điểm (Trailing tự động)\n`;
  msg += `   🛑 <b>Cắt lỗ:</b> Khi đảo chiều cấu trúc ±6 điểm hoặc rổ VN30 đảo chiều dứt khoát\n`;

  msg += `\n<i>🔮 Derivatives Signal Engine v3.0 | VN Stock Bot</i>`;

  await sendTelegramMessage(msg);
  return msg;
}

// ═══════════════════════════════════════════════════════════════
// ║  REAL-TIME MOMENTUM MONITOR (v3.0 MỚI)                     ║
// ║  Theo dõi mỗi 90 giây, bắn noti khi biến động lớn          ║
// ═══════════════════════════════════════════════════════════════

async function checkMomentum() {
  if (!isMarketHours()) return;

  try {
    // 1. Fetch giá VN30 hiện tại
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;
    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=1&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    const data = res.data;
    if (!data || !data.c || data.c.length < 2) return;

    const currentPrice = data.c[data.c.length - 1];
    const nowTs = Date.now();

    // 2. So sánh với snapshot trước (5 phút trước)
    if (_state.lastMomentumPrice !== null) {
      const priceChange = currentPrice - _state.lastMomentumPrice;
      const timeDiffMin = (nowTs - _state.lastMomentumTime) / 60000;

      // Biến động ≥ 4 điểm trong vòng 5 phút
      if (Math.abs(priceChange) >= 4.0 && timeDiffMin <= 6) {
        const alertType = priceChange > 0 ? 'SURGE_UP' : 'SURGE_DOWN';
        const cooldownMs = 5 * 60 * 1000; // 5 phút cooldown
        const lastAlert = _state.lastMomentumAlertTime[alertType] || 0;

        if (nowTs - lastAlert > cooldownMs) {
          await sendMomentumAlert(alertType, priceChange, currentPrice);
          _state.lastMomentumAlertTime[alertType] = nowTs;
        }
      }
    }

    // 3. Fetch alignment để check trụ đảo chiều
    const alignment = await analyzeComponentAlignment();

    // Check trụ đảo chiều: trụ đang tăng mạnh rồi quay đầu giảm hoặc ngược lại
    if (Object.keys(_state.prevPillarSnapshot).length > 0) {
      for (const p of alignment.pillar.details) {
        const prevPct = _state.prevPillarSnapshot[p.sym];
        if (prevPct === undefined) continue;

        // Trụ đã tăng > 1.5% rồi quay đầu giảm (hiện tại < 0.3%)
        if (prevPct >= 1.5 && p.changePct <= 0.3) {
          const alertType = `PILLAR_REVERSAL_DOWN_${p.sym}`;
          const cooldownMs = 10 * 60 * 1000;
          const lastAlert = _state.lastMomentumAlertTime[alertType] || 0;
          if (nowTs - lastAlert > cooldownMs) {
            await sendPillarReversalAlert(p.sym, prevPct, p.changePct, 'DOWN');
            _state.lastMomentumAlertTime[alertType] = nowTs;
          }
        }
        // Trụ đã giảm > 1.5% rồi quay đầu tăng (hiện tại > -0.3%)
        if (prevPct <= -1.5 && p.changePct >= -0.3) {
          const alertType = `PILLAR_REVERSAL_UP_${p.sym}`;
          const cooldownMs = 10 * 60 * 1000;
          const lastAlert = _state.lastMomentumAlertTime[alertType] || 0;
          if (nowTs - lastAlert > cooldownMs) {
            await sendPillarReversalAlert(p.sym, prevPct, p.changePct, 'UP');
            _state.lastMomentumAlertTime[alertType] = nowTs;
          }
        }
      }
    }

    // Check bẫy lái realtime
    if (alignment.trap.detected && alignment.trap.confidence >= 70) {
      const alertType = `TRAP_${alignment.trap.detected}`;
      const cooldownMs = 15 * 60 * 1000; // 15 phút cooldown cho bẫy
      const lastAlert = _state.lastMomentumAlertTime[alertType] || 0;
      if (nowTs - lastAlert > cooldownMs) {
        await sendTrapAlert(alignment);
        _state.lastMomentumAlertTime[alertType] = nowTs;
      }
    }

    // Check đồng thanh realtime
    if (alignment.synchronizedMove) {
      const alertType = `SYNC_${alignment.synchronizedMove}`;
      const cooldownMs = 10 * 60 * 1000;
      const lastAlert = _state.lastMomentumAlertTime[alertType] || 0;
      if (nowTs - lastAlert > cooldownMs) {
        await sendSyncMoveAlert(alignment);
        _state.lastMomentumAlertTime[alertType] = nowTs;
      }
    }

    // Update snapshots
    _state.lastMomentumPrice = currentPrice;
    _state.lastMomentumTime = nowTs;
    _state.prevPillarSnapshot = {};
    for (const p of alignment.pillar.details) {
      _state.prevPillarSnapshot[p.sym] = p.changePct;
    }

  } catch (e) {
    // Momentum check fails silently — không crash bot
    console.error('   ⚠️ Momentum check error:', e.message);
  }
}

// ─── CẢNH BÁO BIẾN ĐỘNG NHANH VN30 (≥4 điểm) ───────────────
async function sendMomentumAlert(alertType, priceChange, currentPrice) {
  const isUp = alertType === 'SURGE_UP';
  const icon = isUp ? '🚀📈' : '💥📉';
  const dirText = isUp ? 'TĂNG VỌT' : 'GIẢM SỐC';
  const actionText = isUp
    ? 'Phe LONG đang chiếm ưu thế. Nếu đang SHORT → Cân nhắc cắt lỗ hoặc hedge. Nếu đang LONG → Giữ vị thế.'
    : 'Phe SHORT đang chiếm ưu thế. Nếu đang LONG → Cân nhắc cắt lỗ hoặc hedge. Nếu đang SHORT → Giữ vị thế.';

  let msg = `${icon} <b>CẢNH BÁO BIẾN ĐỘNG LỚN — VN30F ${dirText}!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `⚡ VN30 vừa ${isUp ? 'tăng' : 'giảm'} <b>${Math.abs(priceChange).toFixed(1)} điểm</b> trong ~5 phút!\n`;
  msg += `📍 Giá hiện tại: <b>${currentPrice.toFixed(2)}</b>\n\n`;
  msg += `💡 <b>HÀNH ĐỘNG:</b>\n`;
  msg += `   ${actionText}\n`;
  msg += `\n<i>🔮 Momentum Monitor v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── CẢNH BÁO TRỤ ĐẢO CHIỀU ─────────────────────────────────
async function sendPillarReversalAlert(sym, prevPct, currentPct, direction) {
  const isReverseDown = direction === 'DOWN';
  const icon = isReverseDown ? '⚠️🔻' : '⚠️🔺';
  const desc = isReverseDown
    ? `${sym} đã tăng +${prevPct.toFixed(1)}% rồi QUAY ĐẦU GIẢM về ${currentPct > 0 ? '+' : ''}${currentPct.toFixed(1)}%`
    : `${sym} đã giảm ${prevPct.toFixed(1)}% rồi QUAY ĐẦU TĂNG về ${currentPct > 0 ? '+' : ''}${currentPct.toFixed(1)}%`;
  const action = isReverseDown
    ? 'Trụ quay đầu giảm = Tín hiệu phái sinh CÓ THỂ đảo chiều sang SHORT. Cẩn thận vị thế LONG!'
    : 'Trụ quay đầu tăng = Tín hiệu phái sinh CÓ THỂ đảo chiều sang LONG. Cẩn thận vị thế SHORT!';

  let msg = `${icon} <b>TRỤ ${sym} ĐẢO CHIỀU!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 ${desc}\n\n`;
  msg += `💡 <b>${action}</b>\n`;
  msg += `\n<i>🔮 Momentum Monitor v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── CẢNH BÁO BẪY ĐỘI LÁI REALTIME ─────────────────────────
async function sendTrapAlert(alignment) {
  const isTrapLong = alignment.trap.detected === 'TRAP_LONG';
  const icon = isTrapLong ? '🪤🔴' : '🪤🟢';
  const trapName = isTrapLong ? 'BẪY LONG (Úp bô phe Mua)' : 'BẪY SHORT (Úp bô phe Bán)';

  let msg = `${icon} <b>PHÁT HIỆN ${trapName}!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 Tình trạng: <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `📊 Max tăng: <b>+${alignment.bands.maxGreenPct}%</b> | Max giảm: <b>-${alignment.bands.maxRedPct}%</b>\n`;
  msg += `📊 TB tăng: <b>+${alignment.bands.avgGreenPct}%</b> | TB giảm: <b>-${alignment.bands.avgRedPct}%</b>\n\n`;

  if (isTrapLong) {
    msg += `⚠️ <b>CẢNH BÁO:</b> ${alignment.greenCount} mã xanh nhưng KHÔNG mã nào tăng >${alignment.bands.maxGreenPct < 2 ? '2' : '3'}%!\n`;
    msg += `   → Lái kéo dàn trải nhẹ, tạo ảo giác LONG.\n`;
    msg += `   → Khả năng cao sẽ bị XẢ NGƯỢC cuối phiên → Phe SHORT thắng.\n\n`;
    msg += `💡 <b>HÀNH ĐỘNG:</b> Không mở LONG. Nếu đang LONG → thu hẹp/cắt vị thế.\n`;
  } else {
    msg += `⚠️ <b>CẢNH BÁO:</b> ${alignment.redCount} mã đỏ nhưng KHÔNG mã nào giảm >${alignment.bands.maxRedPct < 2 ? '2' : '3'}%!\n`;
    msg += `   → Lái đè dàn trải nhẹ, tạo ảo giác SHORT.\n`;
    msg += `   → Khả năng cao sẽ BẬT NGƯỢC → Phe LONG thắng.\n\n`;
    msg += `💡 <b>HÀNH ĐỘNG:</b> Không mở SHORT. Nếu đang SHORT → thu hẹp/cắt vị thế.\n`;
  }

  msg += `\n🔒 Confidence: <b>${alignment.trap.confidence}%</b>`;
  msg += `\n<i>🔮 Momentum Monitor v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── CẢNH BÁO ĐỒNG THANH TĂNG/GIẢM MẠNH ────────────────────
async function sendSyncMoveAlert(alignment) {
  const isBull = alignment.synchronizedMove === 'SYNC_BULL';
  const icon = isBull ? '🔊🟢' : '🔊🔴';

  let msg = `${icon} <b>TOÀN THỊ TRƯỜNG ĐỒNG LOẠT ${isBull ? 'TĂNG' : 'GIẢM'} MẠNH!</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 ${alignment.greenCount}🟢 / ${alignment.redCount}🔴\n`;
  msg += `📊 TB ${isBull ? 'tăng' : 'giảm'}: <b>${isBull ? '+' + alignment.bands.avgGreenPct : '-' + alignment.bands.avgRedPct}%</b>\n`;
  msg += `📊 Mã tăng >${isBull ? '2' : '4'}%: <b>${isBull ? alignment.bands.bull + alignment.bands.strongBull : alignment.bands.bear + alignment.bands.strongBear} mã</b>\n\n`;
  msg += `✅ <b>Đây là ${isBull ? 'UPTREND' : 'DOWNTREND'} THẬT</b> — không phải nhiễu lái.\n`;
  msg += `💡 <b>HÀNH ĐỘNG:</b> ${isBull ? 'Mở/giữ vị thế LONG. Không mở SHORT.' : 'Mở/giữ vị thế SHORT. Không mở LONG.'}\n`;
  msg += `\n<i>🔮 Momentum Monitor v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── START/STOP MOMENTUM MONITOR ─────────────────────────────
function startMomentumMonitor() {
  stopMomentumMonitor();
  const INTERVAL_MS = 90 * 1000; // 90 giây
  _state.momentumTimer = setInterval(() => {
    // Guard: CHỈ chạy trong giờ giao dịch (8h45-11h30 & 13h-14h45 T2-T6)
    if (!isMarketHours()) return;
    checkMomentum().catch(e => console.error('   ⚠️ Momentum monitor error:', e.message));
  }, INTERVAL_MS);
  console.log('   📡 Momentum Monitor v3.0: Started (mỗi 90s, chỉ trong giờ GD)');
}

function stopMomentumMonitor() {
  if (_state.momentumTimer) {
    clearInterval(_state.momentumTimer);
    _state.momentumTimer = null;
  }
}

// ─── MONITOR VỊ THẾ DÙNG THUẬT TOÁN TRAILING & CONTEXTUAL RISK ───
async function checkPositionStatus(session, position) {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;

    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    const data = res.data;
    if (!data || !data.c || data.c.length === 0) return 'HOLDING';

    const currentPrice = data.c[data.c.length - 1];
    const entry = position.entryPrice;
    if (!entry) return 'HOLDING';

    // P&L theo hướng vị thế
    const pnlPoints = position.direction === 'LONG'
      ? parseFloat((currentPrice - entry).toFixed(2))
      : parseFloat((entry - currentPrice).toFixed(2));

    const pnlVND = Math.round(pnlPoints * 100000);
    const pnlSign = pnlPoints >= 0 ? '+' : '';

    if (pnlPoints > _state.highPnlAchieved) {
      _state.highPnlAchieved = pnlPoints;
    }

    console.log(`   📡 Monitor v3.0 [${session}]: Current=${currentPrice.toFixed(2)}, Entry=${entry.toFixed(2)}, P&L=${pnlSign}${pnlPoints}đ (Peak: +${_state.highPnlAchieved}đ)`);

    const alignment = await analyzeComponentAlignment();

    // ─── TRƯỜNG HỢP 1: LÃI TỐT (>= 12 ĐIỂM) — TRAILING STOP DYNAMIC ───
    if (pnlPoints >= 12) {
      // v3.0: Dùng cả trụ + bands + alignment để quyết định giữ hay chốt
      const trendIsStrong = position.direction === 'SHORT'
        ? (alignment.redCount >= 12 || alignment.alignScore <= -0.2 || alignment.pillar.signal === 'STRONG_SHORT')
        : (alignment.greenCount >= 12 || alignment.alignScore >= 0.2 || alignment.pillar.signal === 'STRONG_LONG');

      const nowTs = Date.now();
      if (trendIsStrong) {
        if (nowTs - _state.lastNotiTime > 15 * 60 * 1000) {
          await sendTrailingStrongAlert(session, position, currentPrice, pnlPoints, alignment);
          _state.lastNotiTime = nowTs;
        }
        return 'HOLDING_PROFIT';
      } else {
        await sendTPAlert(session, position, currentPrice, pnlPoints);
        return 'TP';
      }
    }

    // ─── TRƯỜNG HỢP 2: VỊ THẾ BỊ ÂM POINTS ────────────────
    if (pnlPoints <= -3.0) {
      // v3.0: Thêm kiểm tra trụ + bẫy lái để phân biệt nhiễu vs đảo chiều
      const trendIsStillValid = position.direction === 'SHORT'
        ? (alignment.redCount >= 12 || alignment.pillar.strongRedCount >= 3)
        : (alignment.greenCount >= 12 || alignment.pillar.strongGreenCount >= 3);

      // Nếu phát hiện bẫy lái NGƯỢC chiều vị thế → đây là nhiễu, giữ vị thế
      const isTrapAgainstPosition = (position.direction === 'SHORT' && alignment.trap.detected === 'TRAP_LONG')
        || (position.direction === 'LONG' && alignment.trap.detected === 'TRAP_SHORT');

      const structuralReversal = position.direction === 'SHORT'
        ? (alignment.greenCount >= 14 || alignment.pillar.signal === 'STRONG_LONG' || pnlPoints <= -8.0)
        : (alignment.redCount >= 14 || alignment.pillar.signal === 'STRONG_SHORT' || pnlPoints <= -8.0);

      const nowTs = Date.now();

      if (structuralReversal && !isTrapAgainstPosition) {
        await sendReversalSLAlert(session, position, currentPrice, pnlPoints, alignment);
        return 'SL';
      } else if (trendIsStillValid || isTrapAgainstPosition) {
        if (nowTs - _state.lastNotiTime > 20 * 60 * 1000) {
          await sendNoiseWarningAlert(session, position, currentPrice, pnlPoints, alignment);
          _state.lastNotiTime = nowTs;
        }
        return 'HOLDING_NOISE';
      }
    }

    return 'HOLDING';
  } catch (e) {
    console.error(`   ❌ Monitor error v3.0 [${session}]:`, e.message);
    return 'HOLDING';
  }
}

// ─── GỬI NOTI TRAILING KHI LÃI ĐẬM ─────────────────────────
async function sendTrailingStrongAlert(session, position, currentPrice, pnlPoints, alignment) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG' : '🌆 CHIỀU';
  const dirText = position.direction === 'LONG' ? 'LONG 🟢' : 'SHORT 🔴';
  const pnlVND = Math.round(pnlPoints * 100000);

  let msg = `🚀 <b>TRAILING STOP — GIỮ ĂN TRỌN SÓNG (${sessionLabel})</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💰 Vị thế <b>${dirText}</b> đang lãi <b>+${pnlPoints.toFixed(1)} điểm (+${(pnlVND / 1000000).toFixed(2)} triệu)</b>!\n\n`;
  msg += `📊 <b>Phân tích v3.0:</b>\n`;
  msg += `   • Xanh/Đỏ: <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `   • Trụ: <b>${alignment.pillar.signal}</b>\n`;
  msg += `   • Xu hướng vẫn đè/kéo mạnh mẽ theo chiều vị thế.\n\n`;
  msg += `💡 <b>KHUYẾN NGHỊ: TIẾP TỤC GIỮ VỊ THẾ</b>\n`;
  msg += `\n<i>🔮 Derivatives Signal Engine v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── GỬI NOTI CHỐT LỜI KHI XU HƯỚNG YẾU ────────────────────
async function sendTPAlert(session, position, currentPrice, pnlPoints) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG' : '🌆 CHIỀU';
  const pnlVND = Math.round(pnlPoints * 100000);

  let msg = `🎯 <b>CHỐT LỜI THÀNH CÔNG — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `✅ <b>ĐẠT MỤC TIÊU LÃI +${pnlPoints.toFixed(1)} ĐIỂM!</b>\n\n`;
  msg += `   📍 Giá vào (Entry): ~${position.entryPrice?.toFixed(2) || 'N/A'}\n`;
  msg += `   📍 Giá đóng hiện tại: ${currentPrice.toFixed(2)}\n`;
  msg += `   💰 Lãi thực nhận: <b>+${pnlPoints.toFixed(1)} điểm (+${(pnlVND / 1000000).toFixed(2)} triệu / 1 HĐ)</b>\n\n`;
  msg += `⚡ <b>Lực kéo VN30 chần chừ → ĐÓNG VỊ THẾ BỎ TÚI LỢI NHUẬN NGAY!</b>\n`;

  if (session === 'morning') {
    msg += `\n☕ <i>Đã thắng đậm phiên sáng. Phiên chiều nghỉ ngơi bảo toàn thành quả.</i>\n`;
  }

  msg += `\n<i>🔮 Derivatives Signal Engine v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── GỬI NOTI CẢNH BÁO NHỊP NHIỄU (KHÔNG CẮT VỘI) ─────────────
async function sendNoiseWarningAlert(session, position, currentPrice, pnlPoints, alignment) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG' : '🌆 CHIỀU';
  const dirText = position.direction === 'LONG' ? 'LONG 🟢' : 'SHORT 🔴';

  let msg = `🛡️ <b>CẢNH BÁO NHỊP GIẬT NHIỄU LÁI — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `⚠️ Vị thế <b>${dirText}</b> đang tạm âm <b>${pnlPoints.toFixed(1)} điểm</b>.\n\n`;
  msg += `🔍 <b>BẮT BỆNH v3.0:</b>\n`;
  msg += `   • Rổ VN30: <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `   • Trụ: <b>${alignment.pillar.signal}</b> (${alignment.pillar.greenCount}🟢/${alignment.pillar.redCount}🔴)\n`;

  if (alignment.trap.detected) {
    msg += `   • 🪤 Phát hiện <b>${alignment.trap.detected}</b> — Đây là NHIỄU lái!\n`;
  }

  msg += `\n💡 <b>KHUYẾN NGHỊ: GIỮ VỊ THẾ, KHÔNG CẮT VỘI!</b>\n`;
  msg += `   Đây chỉ là nhịp nhiễu quét margin của Lái.\n`;
  msg += `\n<i>🔮 Derivatives Signal Engine v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── GỬI NOTI CẮT LỖ KHI XÁC NHẬN ĐẢO CHIỀU ─────────────────
async function sendReversalSLAlert(session, position, currentPrice, pnlPoints, alignment) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG' : '🌆 CHIỀU';
  const pnlVND = Math.round(pnlPoints * 100000);

  let msg = `🚨 <b>CẮT LỖ XÁC NHẬN ĐẢO CHIỀU — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🔴 <b>VN30 XÁC NHẬN ĐẢO CHIỀU CẤU TRÚC THỰC SỰ!</b>\n\n`;
  msg += `   📍 Giá vào (Entry): ~${position.entryPrice?.toFixed(2) || 'N/A'}\n`;
  msg += `   📍 Giá hiện tại: ${currentPrice.toFixed(2)}\n`;
  msg += `   💸 Lỗ: <b>${pnlPoints.toFixed(1)} điểm (${(pnlVND / 1000000).toFixed(2)} triệu)</b>\n`;
  msg += `   📊 Xanh/Đỏ: ${alignment.greenCount}🟢 / ${alignment.redCount}🔴\n`;
  msg += `   🏛️ Trụ: ${alignment.pillar.signal}\n\n`;
  msg += `🚨 <b>ĐÓNG VỊ THẾ NGAY ĐỂ BẢO TOÀN VỐN!</b>\n`;
  msg += `<i>Thừa nhận sai khi thị trường đảo chiều dứt khoát là nguyên tắc sinh tồn.</i>\n`;
  msg += `\n<i>🔮 Derivatives Signal Engine v3.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── BẮT ĐẦU MONITOR POSITION ───────────────────────────────
function startPositionMonitor(session, position, durationMinutes = 120) {
  stopPositionMonitor();

  let elapsed = 0;
  _state.highPnlAchieved = 0;
  _state.lastNotiTime = 0;
  const INTERVAL_MS = 3 * 60 * 1000;

  _state.monitorTimer = setInterval(async () => {
    elapsed += 3;

    // Guard: CHỈ chạy trong giờ giao dịch — TUYỆT ĐỐI không bắn noti ngoài giờ
    if (!isMarketHours()) {
      // Ngoài giờ giao dịch → tự dừng monitor luôn
      console.log(`   ⏱ Monitor [${session}] tự dừng — ngoài giờ giao dịch`);
      stopPositionMonitor();
      return;
    }

    if (elapsed >= durationMinutes) {
      console.log(`   ⏱ Monitor [${session}] timeout sau ${durationMinutes} phút`);
      stopPositionMonitor();
      return;
    }

    const result = await checkPositionStatus(session, position);

    if (result === 'TP') {
      console.log(`   ✅ [${session}] ĐẠT TP CHỐT LỜI! Dừng monitor.`);
      stopPositionMonitor();
      if (session === 'morning') {
        _state.morningClosed = true;
        _state.morningResult = 'TP';
      }
    }

    if (result === 'SL') {
      console.log(`   🚨 [${session}] ĐẢO CHIỀU CẮT LỖ! Dừng monitor.`);
      stopPositionMonitor();
      if (session === 'morning') {
        _state.morningClosed = true;
        _state.morningResult = 'SL';
      }
    }
  }, INTERVAL_MS);

  console.log(`   📡 Bắt đầu monitor v3.0 [${session}] mỗi 3 phút (tối đa ${durationMinutes}p)`);
}

function stopPositionMonitor() {
  if (_state.monitorTimer) {
    clearInterval(_state.monitorTimer);
    _state.monitorTimer = null;
  }
}

// ─── JOB SÁNG (Gọi từ cron 5p/lần 9h-9h30, rồi 9h45, 10h05...) ───
async function runMorningDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v3.0 — SÁNG');
  console.log('═'.repeat(55));

  _state.morningSignal   = null;
  _state.afternoonSignal = null;
  _state.morningClosed   = false;
  _state.morningResult   = null;
  _state.highPnlAchieved = 0;
  stopPositionMonitor();

  try {
    const signal = await calculateFinalSignal();
    _state.morningSignal = signal;

    console.log(`   🎯 Final Signal v3.0: ${signal.direction} (score=${signal.score}/${signal.maxScore})`);

    await sendOpenSignal('morning', signal);

    const position = {
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      session: 'morning',
      openTime: Date.now(),
    };
    _state.morningSignal = { ...signal, ...position };

    // Start monitor phiên sáng (tối đa 150 phút)
    startPositionMonitor('morning', position, 150);
    // Start momentum monitor (bắn noti khi biến động lớn)
    startMomentumMonitor();
  } catch (e) {
    console.error('   ❌ Morning derivatives job error v3.0:', e.message);
  }
}

// ─── JOB GIỮA SÁNG (chạy mỗi 5 phút từ 9h05-9h30, rồi các mốc cố định) ───
async function runMidMorningDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v3.0 — GIỮA SÁNG');
  console.log('═'.repeat(55));

  try {
    const signal = await calculateFinalSignal();
    _state.midmorningSignal = signal;

    console.log(`   🎯 Final Signal v3.0: ${signal.direction} (score=${signal.score}/${signal.maxScore})`);

    await sendOpenSignal('midmorning', signal);

    const position = {
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      session: 'midmorning',
      openTime: Date.now(),
    };
    _state.midmorningSignal = { ...signal, ...position };

    startPositionMonitor('midmorning', position, 120);
  } catch (e) {
    console.error('   ❌ Mid-morning derivatives job error v3.0:', e.message);
  }
}

// ─── JOB CHIỀU: 13h14 ───────────────────────────────────────
async function runAfternoonDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v3.0 — CHIỀU (13h14)');
  console.log('═'.repeat(55));

  // Nếu sáng đã thắng TP → nghỉ chiều
  if (_state.morningClosed && _state.morningResult === 'TP') {
    console.log('   ✅ Phiên sáng đã chốt lời. Nghỉ buổi chiều.');
    await sendTelegramMessage(
      `☕ <b>PHÁI SINH CHIỀU — NGHỈ NGHƠI</b>\n` +
      `🕐 <i>${vnNow()}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ Phiên sáng đã <b>chốt lời thành công</b>.\n` +
      `☕ Không mở vị thế chiều. Bảo toàn lợi nhuận đã đạt được!\n` +
      `\n<i>🔮 Derivatives Signal Engine v3.0 | VN Stock Bot</i>`
    );
    return;
  }

  try {
    const signal = await calculateFinalSignal();
    _state.afternoonSignal = signal;

    console.log(`   🎯 Final Signal v3.0: ${signal.direction} (score=${signal.score}/${signal.maxScore})`);

    await sendOpenSignal('afternoon', signal);

    const position = {
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      session: 'afternoon',
      openTime: Date.now(),
    };
    _state.afternoonSignal = { ...signal, ...position };

    startPositionMonitor('afternoon', position, 60);
  } catch (e) {
    console.error('   ❌ Afternoon derivatives job error v3.0:', e.message);
  }
}

// ─── AI DERIVATIVES ANALYSIS JOB (9h22, 10h22 & 13h50) ────────────────
async function runAIDerivativesJob(session) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG (9h22)' : session === 'midmorning' ? '⛅ GIỮA SÁNG (10h22)' : '🌆 CHIỀU (13h50)';
  console.log('\n' + '═'.repeat(55));
  console.log(`🤖 AI DERIVATIVES ANALYSIS v3.0 — ${sessionLabel}`);
  console.log('═'.repeat(55));

  try {
    const signal = await calculateFinalSignal();
    const { direction, score, maxScore, entryPrice, breakdown } = signal;
    const { alignment, gapTrend, volume } = breakdown;

    const vn30Ref = entryPrice || 1745.20;
    const estimatedFutures = gapTrend.gapPoints !== 0 ? (vn30Ref + gapTrend.gapPoints) : vn30Ref;
    const basisGap = (estimatedFutures - vn30Ref).toFixed(1);

    const apiKey = config.geminiAI4.apiKey || config.geminiAI1.apiKey;
    let aiResponseText = null;

    if (apiKey) {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

      const prompt = `Bạn là Giám Đốc Quỹ Đầu Tư & Chuyên Gia Phân Tích Phái Sinh VN30F1M hàng đầu Việt Nam.
Hãy phân tích dữ liệu thị trường thực tế ngay bây giờ và đưa ra dự báo độc lập cho hợp đồng Phái Sinh VN30F1M phiên ${sessionLabel}:

DỮ LIỆU THỊ TRƯỜNG THỰC TẾ (v3.0 — Anti-Trap):
- Thời gian: ${vnNow()}
- Xu hướng 1 tháng (Primary Trend): ${gapTrend.primaryTrend} (Biến động 1M: ${gapTrend.monthChangePct}%, SMA20: ${gapTrend.sma20})
- Rổ VN30 Xanh/Đỏ: ${alignment.greenCount} mã Xanh / ${alignment.redCount} mã Đỏ (Alignment: ${alignment.alignScore})
- BIÊN ĐỘ VN30: Tăng >4%: ${alignment.bands.strongBull} mã | 1.2-4% (≥1.5đ): ${alignment.bands.bull} mã | 0-1.2%: ${alignment.bands.mildBull} mã | Giảm >4%: ${alignment.bands.strongBear} mã | 1.2-4% (≥1.5đ): ${alignment.bands.bear} mã | 0-1.2%: ${alignment.bands.mildBear} mã
- Max tăng: +${alignment.bands.maxGreenPct}% | Max giảm: -${alignment.bands.maxRedPct}% | TB tăng: +${alignment.bands.avgGreenPct}% | TB giảm: -${alignment.bands.avgRedPct}%
- 6 TRỤ CHỈ SỐ: ${alignment.pillar.details.map(p => `${p.sym}(${p.changePct > 0 ? '+' : ''}${p.changePct}%)`).join(', ')} → Tín hiệu: ${alignment.pillar.signal}
- BẪY ĐỘI LÁI: ${alignment.trap.detected ? `${alignment.trap.detected} (Confidence: ${alignment.trap.confidence}%)` : 'Không phát hiện'}
- ĐỒNG THANH: ${alignment.synchronizedMove || 'Không'}
- Gap ATO VN30: ${gapTrend.gapPoints > 0 ? '+' : ''}${gapTrend.gapPoints} điểm | Volume: ${volume.volumeRatio}x TB5
- Basis: ${basisGap} điểm
- Điểm phán quyết v3.0: ${direction} (${score}/${maxScore} điểm)
- Top mã VN30 mạnh nhất: ${alignment.topStrong.map(s => `${s.sym}(${s.changePct}%)`).join(', ')}
- Top mã VN30 yếu nhất: ${alignment.topWeak.map(s => `${s.sym}(${s.changePct}%)`).join(', ')}

YÊU CẦU ĐỐI VỚI AI:
1. Đưa ra phán quyết: LONG hay SHORT? Có phải bẫy đội lái không?
2. Phân tích 6 trụ chỉ số: VIC, VHM, MWG, FPT, VCB, BID đang kéo thật hay kéo ảo?
3. Đánh giá: Nếu 20+ mã xanh nhưng mỗi mã chỉ tăng <1.5% → có phải bẫy úp bô Long không?
4. Trình bày 3 lý do bằng tiếng Việt dễ hiểu.
5. Nêu Entry, TP (+10-15 điểm), SL (khi đảo chiều cấu trúc).
6. Định dạng HTML cho Telegram (dùng <b>, <i>, <code>). Ngắn gọn.`;

      const result = await model.generateContent(prompt);
      aiResponseText = result.response.text();
    }

    let msg = `🤖 <b>DỰ BÁO PHÁI SINH TỪ AI v3.0 — ${sessionLabel}</b>\n`;
    msg += `🕐 <i>${vnNow()}</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (aiResponseText && aiResponseText.trim().length > 0) {
      let cleanedText = aiResponseText
        .replace(/```html/gi, '')
        .replace(/```/g, '')
        .trim();
      msg += `${cleanedText}\n\n`;
    } else {
      const dirIcon = direction === 'LONG' ? '🟢' : '🔴';
      msg += `${dirIcon} <b>DỰ BÁO: ${direction === 'LONG' ? 'LONG (CỬA TĂNG)' : 'SHORT (CỬA GIẢM)'}</b>\n\n`;
      msg += `📋 <b>3 Lý do:</b>\n`;
      msg += `   1. Trend 1 tháng: <b>${gapTrend.primaryTrend}</b>\n`;
      msg += `   2. Xanh/Đỏ: <b>${alignment.greenCount}/${alignment.redCount}</b>\n`;
      msg += `   3. Trụ: <b>${alignment.pillar.signal}</b>\n\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>Đối chiếu tín hiệu Code (${direction} ${score}/${maxScore}) với AI.</i>\n`;
    msg += `<i>🤖 VN Stock Bot v${config.version} | AI Derivatives Engine v3.0</i>`;

    await sendTelegramMessage(msg);
    console.log(`   ✅ AI Derivatives Job [${session}] hoàn thành`);
  } catch (err) {
    console.error(`   ❌ AI Derivatives Job [${session}] lỗi:`, err.message);
  }
}

// ─── RESET DAILY STATE ───────────────────────────────────────
function resetDerivativesState() {
  stopPositionMonitor();
  stopMomentumMonitor();
  _state.morningSignal   = null;
  _state.midmorningSignal = null;
  _state.afternoonSignal = null;
  _state.morningClosed   = false;
  _state.morningResult   = null;
  _state.highPnlAchieved = 0;
  _state.lastMomentumPrice = null;
  _state.lastMomentumTime = 0;
  _state.lastMomentumAlertTime = {};
  _state.prevPillarSnapshot = {};
  console.log('   🔄 Derivatives state reset v3.0');
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  runMorningDerivativesJob,
  runMidMorningDerivativesJob,
  runAfternoonDerivativesJob,
  runAIDerivativesJob,
  resetDerivativesState,
  startMomentumMonitor,
  stopMomentumMonitor,
  stopPositionMonitor,
  getDerivativesState: () => ({ ..._state }),
};
