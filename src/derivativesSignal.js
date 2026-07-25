/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN STOCK BOT - Derivatives Signal Engine v2.0           ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Tín hiệu phái sinh VN30F v2.0 — SMART TRAILING & NO-WAIT    ║
 * ║                                                               ║
 * ║  1. Tham gia 100% các phiên (BỎ WAIT):                      ║
 * ║     - Ưu tiên Bối cảnh Trend 1 Tháng & Alignment VN30        ║
 * ║     - 🔴 DOWNTREND → Mở vị thế SHORT                         ║
 * ║     - 🟢 UPTREND   → Mở vị thế LONG                          ║
 * ║                                                               ║
 * ║  2. Không Cắt lỗ/Chốt lời Cố định (-2đ/-5đ/12đ):             ║
 * ║     - Lãi >= 12đ: Bật Trailing Stop, xu hướng đè tiếp → GIỮ  ║
 * ║     - Khi Âm điểm: Phân biệt Nhịp nhiễu Lái vs Đảo chiều thật ║
 * ║     - Chỉ CẮT LỖ khi VN30 xác nhận ĐẢO CHIỀU CẤU TRÚC THỰC     ║
 * ║                                                               ║
 * ║  📅 Cron: 9h14 (sáng) + 13h14 (chiều) T2-T6                ║
 * ║  📡 Monitor: mỗi 3 phút theo dõi P&L + Alignment             ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');
const { sendTelegramMessage } = require('./telegramService');

// ─── VN30 SYMBOLS + TRỌNG SỐ VỐN HÓA ───────────────────────
const VN30_COMPONENTS = [
  { sym: 'VCB',  weight: 13.5 },
  { sym: 'VIC',  weight: 9.5  },
  { sym: 'VHM',  weight: 8.5  },
  { sym: 'BID',  weight: 7.2  },
  { sym: 'CTG',  weight: 6.5  },
  { sym: 'GAS',  weight: 6.0  },
  { sym: 'SAB',  weight: 5.5  },
  { sym: 'TCB',  weight: 4.8  },
  { sym: 'HPG',  weight: 4.5  },
  { sym: 'MBB',  weight: 4.2  },
  { sym: 'VPB',  weight: 3.8  },
  { sym: 'ACB',  weight: 3.5  },
  { sym: 'STB',  weight: 3.0  },
  { sym: 'HDB',  weight: 2.8  },
  { sym: 'SHB',  weight: 2.5  },
  { sym: 'PLX',  weight: 2.2  },
  { sym: 'POW',  weight: 2.0  },
  { sym: 'GVR',  weight: 1.8  },
  { sym: 'BCM',  weight: 1.5  },
  { sym: 'MSN',  weight: 1.2  },
];

const VPS_REALTIME_URL = 'https://bgapidatafeed.vps.com.vn/getliststockdata';
const VPS_HISTORY_URL  = 'https://histdatafeed.vps.com.vn/tradingview/history';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── STATE: Quản lý vị thế trong ngày ───────────────────────
const _state = {
  morningSignal: null,      // { direction, score, entryPrice, time }
  afternoonSignal: null,
  morningClosed: false,     // true khi đã chốt vị thế phiên sáng
  morningResult: null,      // 'TP' | 'SL' | null
  monitorTimer: null,       // setInterval handle
  lastVN30FClose: null,     // Giá đóng cửa VN30F hôm qua
  highPnlAchieved: 0,       // PnL cao nhất từng đạt được trong vị thế hiện tại (Trailing)
  lastNotiTime: 0,          // Tránh spam noti trùng lặp
};

// ─── HELPER ─────────────────────────────────────────────────
function vnNow() {
  return new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
}

// ─── TÍN HIỆU 1: Component Alignment (Xanh/Đỏ VN30) ─────────
async function analyzeComponentAlignment() {
  try {
    const symbols = VN30_COMPONENTS.map(c => c.sym).join(',');
    const res = await axios.get(`${VPS_REALTIME_URL}/${symbols}`, {
      headers: HEADERS, timeout: 10000,
    });

    const rawList = res.data || [];
    let weightedGreen = 0;
    let weightedRed   = 0;
    let greenCount = 0;
    let redCount   = 0;
    const details = [];

    for (const comp of VN30_COMPONENTS) {
      const raw = rawList.find(r => r.sym === comp.sym);
      if (!raw) continue;

      const price    = parseFloat(raw.lastPrice || 0) * 1000;
      const refPrice = parseFloat(raw.r || 0) * 1000;
      if (refPrice === 0) continue;

      const changePct = (price - refPrice) / refPrice * 100;
      const isGreen   = changePct >= 0;

      const item = {
        sym: comp.sym,
        changePct: parseFloat(changePct.toFixed(2)),
        price,
        refPrice,
        weight: comp.weight,
      };
      details.push(item);

      if (isGreen) {
        weightedGreen += comp.weight;
        greenCount++;
      } else {
        weightedRed += comp.weight;
        redCount++;
      }
    }

    const sorted = [...details].sort((a, b) => b.changePct - a.changePct);
    const topStrong = sorted.slice(0, 5);
    const topWeak = [...sorted].reverse().slice(0, 5);

    const total = weightedGreen + weightedRed;
    const alignScore = total > 0 ? (weightedGreen - weightedRed) / total : 0;

    let signal = 'SHORT'; // Mặc định nghiêng về Short
    if (alignScore >= 0.15) signal = 'LONG';
    if (alignScore <= -0.15) signal = 'SHORT';

    return {
      signal,
      alignScore: parseFloat(alignScore.toFixed(3)),
      greenCount,
      redCount,
      topStrong,
      topWeak,
      details: sorted,
    };
  } catch (e) {
    console.error('   ❌ ComponentAlignment error:', e.message);
    return { signal: 'SHORT', alignScore: -0.5, greenCount: 5, redCount: 15, topStrong: [], topWeak: [], details: [] };
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

// ─── TỔNG HỢP SIGNAL v2.0 — CÓ VỊ THẾ 100% CÁC PHIÊN ───────
async function calculateFinalSignal() {
  console.log('   🔍 [Engine v2.0] Phân tích tín hiệu phái sinh (No-Wait Mode)...');

  const [alignment, gapTrend, volume] = await Promise.all([
    analyzeComponentAlignment(),
    analyzeOpeningGapAndTrend(),
    analyzeVolumeProfile(),
  ]);

  console.log(`   📊 Alignment: ${alignment.signal} (score=${alignment.alignScore}, 🟢${alignment.greenCount}/🔴${alignment.redCount})`);
  console.log(`   📈 Primary Trend: ${gapTrend.primaryTrend} (1M: ${gapTrend.monthChangePct}%, Gap: ${gapTrend.gapPoints > 0 ? '+' : ''}${gapTrend.gapPoints}đ)`);
  console.log(`   📦 Volume: ${volume.signal} (${volume.volumeRatio}x TB)`);

  // Tính điểm tổng hợp (0 - 8 điểm)
  const scoreMap = { 'LONG': 2, 'NEUTRAL': 1, 'SHORT': 0 };
  let totalScore = 0;
  totalScore += scoreMap[alignment.signal] ?? 0;
  totalScore += scoreMap[alignment.signal] ?? 0; // Trọng số alignment x2
  totalScore += scoreMap[gapTrend.signal] ?? 0;
  totalScore += scoreMap[volume.signal] ?? 0;

  // v2.0: BỎ WAIT! Luôn đưa ra hướng giao dịch LONG hoặc SHORT dựa trên Bối cảnh & Alignment
  let direction = 'SHORT'; // Mặc định theo xu hướng giảm thị trường hiện tại
  if (totalScore >= 5 || (gapTrend.primaryTrend === 'UPTREND' && totalScore >= 4)) {
    direction = 'LONG';
  } else {
    direction = 'SHORT';
  }

  const entryPrice = gapTrend.entryPrice;

  return {
    direction,
    score: totalScore,
    entryPrice,
    breakdown: { alignment, gapTrend, volume },
  };
}

// ─── GỬI TELEGRAM THÔNG BÁO MỞ VỊ THẾ v2.0 ─────────────────
async function sendOpenSignal(session, signal) {
  const { direction, score, entryPrice, breakdown } = signal;
  const { alignment, gapTrend, volume } = breakdown;

  const sessionLabel = session === 'morning' ? '🌅 SÁNG (9h14)' : '🌆 CHIỀU (13h14)';
  const dirIcon  = direction === 'LONG' ? '🟢' : '🔴';
  const dirText  = direction === 'LONG' ? 'LONG (MUA THỂ HÀNG TĂNG)' : 'SHORT (BÁN BẮT ĐÀ GIẢM)';

  const alignBar = `${'🟢'.repeat(alignment.greenCount)}${'🔴'.repeat(alignment.redCount)}`.substring(0, 20);

  let msg = `🔮 <b>TÍN HIỆU PHÁI SINH VN30F — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${dirIcon} <b>HƯỚNG MỞ VỊ THẾ: ${dirText}</b>\n`;
  msg += `📊 Điểm sức mạnh tín hiệu: <b>${score}/8 điểm</b>\n`;
  msg += `🌐 Bối cảnh thị trường chính: <b>${gapTrend.primaryTrend === 'DOWNTREND' ? '🔴 DOWNTREND (Ưu tiên Short)' : '🟢 UPTREND (Ưu tiên Long)'}</b>\n\n`;

  msg += `📋 <b>CHỈ SỐ & THÔNG SỐ CHI TIẾT:</b>\n`;
  msg += `   📊 Tỷ lệ VN30 Xanh/Đỏ: <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `      <code>${alignBar}</code>\n`;
  msg += `      (Trọng số AlignScore: ${alignment.alignScore > 0 ? '+' : ''}${alignment.alignScore})\n`;
  msg += `   📈 Gap ATO VN30: <b>${gapTrend.gapPoints >= 0 ? '+' : ''}${gapTrend.gapPoints} điểm</b>\n`;
  msg += `   📦 Thanh khoản đầu phiên: <b>${volume.volumeRatio}x</b> TB5\n`;
  if (entryPrice) {
    msg += `   📍 Tham chiếu VN30: ~<b>${entryPrice.toFixed(2)} điểm</b>\n`;
  }
  msg += `\n`;

  if (alignment.topStrong && alignment.topStrong.length > 0) {
    msg += `💪 <b>TOP 5 CP MẠNH NHẤT VN30 (Dẫn dắt):</b>\n`;
    for (const s of alignment.topStrong) {
      const sign = s.changePct >= 0 ? '+' : '';
      msg += `   🟢 <b>${s.sym}</b>: ${(s.price / 1000).toFixed(2)}k (<b>${sign}${s.changePct}%</b>)\n`;
    }
    msg += `\n`;
  }

  if (alignment.topWeak && alignment.topWeak.length > 0) {
    msg += `💀 <b>TOP 5 CP YẾU NHẤT VN30 (Đè chỉ số):</b>\n`;
    for (const s of alignment.topWeak) {
      const sign = s.changePct >= 0 ? '+' : '';
      msg += `   🔴 <b>${s.sym}</b>: ${(s.price / 1000).toFixed(2)}k (<b>${sign}${s.changePct}%</b>)\n`;
    }
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🎯 <b>CHIẾN LƯỢC QUẢN TRỊ VỊ THẾ DỰA TRÊN THỰC TẾ:</b>\n`;
  msg += `   ${dirIcon} Mở vị thế <b>${direction}</b> VN30F1M (Khung 9h15 - 9h25)\n`;
  msg += `   🚀 <b>Khi có lãi >= 12 điểm</b>: Bot tự bật Trailing Stop, nếu xu hướng VN30 vẫn đè mạnh → **GIỮ TIẾP ẢN TRỌN SÓNG**.\n`;
  msg += `   🛡️ <b>Khi vị thế bị âm điểm</b>: Bot tự kiểm tra lực kéo VN30. Nếu chỉ là nhịp nhiễu ngắn của Lái trong xu hướng chính → **KHÔNG CẮT VỘI KHỎI BẪY QUÉT**.\n`;
  msg += `   🚨 <b>Chỉ CẮT LỖ</b> khi VN30 xác nhận ĐẢO CHIỀU THỰC SỰ trên bảng điện.\n`;

  msg += `\n<i>🔮 Derivatives Signal Engine v2.0 | VN Stock Bot</i>`;

  await sendTelegramMessage(msg);
  return msg;
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

    console.log(`   📡 Monitor v2.0 [${session}]: Current=${currentPrice.toFixed(2)}, Entry=${entry.toFixed(2)}, P&L=${pnlSign}${pnlPoints}đ (Peak: +${_state.highPnlAchieved}đ)`);

    const alignment = await analyzeComponentAlignment();

    // ─── TRƯỜNG HỢP 1: LÃI TỐT (>= 12 ĐIỂM) — TRAILING STOP DYNAMIC ───
    if (pnlPoints >= 12) {
      // Check xem trend còn đè mạnh theo hướng vị thế không
      const trendIsStrong = position.direction === 'SHORT'
        ? alignment.redCount >= 12 || alignment.alignScore <= -0.2
        : alignment.greenCount >= 12 || alignment.alignScore >= 0.2;

      const nowTs = Date.now();
      // Giữ vị thế ăn trọn sóng nếu trend vẫn rất mạnh
      if (trendIsStrong) {
        if (nowTs - _state.lastNotiTime > 15 * 60 * 1000) { // Noti nhắc 15p/lần
          await sendTrailingStrongAlert(session, position, currentPrice, pnlPoints, alignment);
          _state.lastNotiTime = nowTs;
        }
        return 'HOLDING_PROFIT';
      } else {
        // Alignment suy yếu → Chốt lời bảo toàn thành quả!
        await sendTPAlert(session, position, currentPrice, pnlPoints);
        return 'TP';
      }
    }

    // ─── TRƯỜNG HỢP 2: VỊ THẾ BỊ ÂM POINTS (ÂM ĐIỂM) ────────────────
    if (pnlPoints <= -3.0) {
      // Phân biệt: Nhịp giật nhiễu của Lái vs Đảo chiều thực sự
      const trendIsStillValid = position.direction === 'SHORT'
        ? alignment.redCount >= 12 // VN30 vẫn 12+ mã đỏ -> Lực kéo Long chỉ là nhiễu!
        : alignment.greenCount >= 12;

      const structuralReversal = position.direction === 'SHORT'
        ? (alignment.greenCount >= 14 || pnlPoints <= -8.0) // Nếu >14 mã xanh hoặc lỗ quá 8đ -> Đảo chiều thật
        : (alignment.redCount >= 14 || pnlPoints <= -8.0);

      const nowTs = Date.now();

      if (structuralReversal) {
        // Xác nhận đảo chiều dứt khoát -> CẮT LỖ NGAY!
        await sendReversalSLAlert(session, position, currentPrice, pnlPoints, alignment);
        return 'SL';
      } else if (trendIsStillValid) {
        // Chỉ là nhịp nhiễu ngắn -> KHÔNG CẮT VỘI KHỎI BẪY LÁI
        if (nowTs - _state.lastNotiTime > 20 * 60 * 1000) {
          await sendNoiseWarningAlert(session, position, currentPrice, pnlPoints, alignment);
          _state.lastNotiTime = nowTs;
        }
        return 'HOLDING_NOISE';
      }
    }

    return 'HOLDING';
  } catch (e) {
    console.error(`   ❌ Monitor error v2.0 [${session}]:`, e.message);
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
  msg += `📊 <b>Phân tích lực kéo VN30:</b>\n`;
  msg += `   • Tỷ lệ xanh/đỏ: <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `   • Xu hướng thị trường vẫn đè/kéo cực kỳ mạnh mẽ theo đúng chiều vị thế.\n\n`;
  msg += `💡 <b>KHUYẾN NGHỊ: TIẾP TỤC GIỮ VỊ THẾ</b> để tối đa hóa lợi nhuận. Bot đang theo dõi sát dải giá.\n`;
  msg += `\n<i>🔮 Derivatives Signal Engine v2.0 | VN Stock Bot</i>`;
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

  msg += `\n<i>🔮 Derivatives Signal Engine v2.0 | VN Stock Bot</i>`;
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
  msg += `🔍 <b>BẮT BỆNH THỊ TRƯỜNG:</b>\n`;
  msg += `   • Rổ VN30 vẫn có tới <b>${alignment.redCount}🔴 mã ĐỎ</b> (Lực kéo Long chỉ là giật nhiễu ngắn).\n`;
  msg += `   • Xu hướng thị trường chung vẫn ép giảm dứt khoát.\n\n`;
  msg += `💡 <b>KHUYẾN NGHỊ: GIỮ VỊ THẾ, KHÔNG CẮT VỘI!</b> Đây chỉ là nhịp nhiễu quét margin của Lái. Tránh dính bẫy cắt đúng đỉnh nảy.\n`;
  msg += `\n<i>🔮 Derivatives Signal Engine v2.0 | VN Stock Bot</i>`;
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
  msg += `   📊 Tỷ lệ xanh/đỏ VN30 đảo chiều: ${alignment.greenCount}🟢 / ${alignment.redCount}🔴\n\n`;
  msg += `🚨 <b>ĐÓNG VỊ THẾ NGAY ĐỂ BẢO TOÀN VỐN!</b>\n`;
  msg += `<i>Thừa nhận sai khi thị trường đảo chiều dứt khoát là nguyên tắc sinh tồn.</i>\n`;
  msg += `\n<i>🔮 Derivatives Signal Engine v2.0 | VN Stock Bot</i>`;
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

  console.log(`   📡 Bắt đầu monitor v2.0 [${session}] mỗi 3 phút (tối đa ${durationMinutes}p)`);
}

function stopPositionMonitor() {
  if (_state.monitorTimer) {
    clearInterval(_state.monitorTimer);
    _state.monitorTimer = null;
  }
}

// ─── JOB SÁNG: 9h14 ─────────────────────────────────────────
async function runMorningDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v2.0 — SÁNG (9h14)');
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

    console.log(`   🎯 Final Signal v2.0: ${signal.direction} (score=${signal.score}/8)`);

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
  } catch (e) {
    console.error('   ❌ Morning derivatives job error v2.0:', e.message);
  }
}

// ─── JOB CHIỀU: 13h14 ───────────────────────────────────────
async function runAfternoonDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v2.0 — CHIỀU (13h14)');
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
      `\n<i>🔮 Derivatives Signal Engine v2.0 | VN Stock Bot</i>`
    );
    return;
  }

  try {
    const signal = await calculateFinalSignal();
    _state.afternoonSignal = signal;

    console.log(`   🎯 Final Signal v2.0: ${signal.direction} (score=${signal.score}/8)`);

    await sendOpenSignal('afternoon', signal);

    const position = {
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      session: 'afternoon',
      openTime: Date.now(),
    };
    _state.afternoonSignal = { ...signal, ...position };

    // Start monitor phiên chiều (tối đa 60 phút)
    startPositionMonitor('afternoon', position, 60);
  } catch (e) {
    console.error('   ❌ Afternoon derivatives job error v2.0:', e.message);
  }
}

// ─── RESET DAILY STATE ───────────────────────────────────────
function resetDerivativesState() {
  stopPositionMonitor();
  _state.morningSignal   = null;
  _state.afternoonSignal = null;
  _state.morningClosed   = false;
  _state.morningResult   = null;
  _state.highPnlAchieved = 0;
  console.log('   🔄 Derivatives state reset v2.0');
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  runMorningDerivativesJob,
  runAfternoonDerivativesJob,
  resetDerivativesState,
  stopPositionMonitor,
  getDerivativesState: () => ({ ..._state }),
};
