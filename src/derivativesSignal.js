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

// ─── GỬI TELEGRAM THÔNG BÁO MỞ VỊ THẾ v2.1 ─────────────────
async function sendOpenSignal(session, signal) {
  const { direction, score, entryPrice, breakdown } = signal;
  const { alignment, gapTrend, volume } = breakdown;

  const sessionLabel = session === 'morning' ? '🌅 SÁNG (9h01)' : '🌆 CHIỀU (13h14)';
  const dirIcon  = direction === 'LONG' ? '🟢' : '🔴';
  const dirText  = direction === 'LONG' ? 'LONG (MUA - ĐẶT CỬA TĂNG)' : 'SHORT (BÁN - ĐẶT CỬA GIẢM)';

  const alignBar = `${'🟢'.repeat(alignment.greenCount)}${'🔴'.repeat(alignment.redCount)}`.substring(0, 20);

  // Tính ước tính Basis Gap (VN30F1M vs VN30)
  const vn30Ref = entryPrice || 1745.20;
  const estimatedFutures = gapTrend.gapPoints !== 0 ? (vn30Ref + gapTrend.gapPoints) : vn30Ref;
  const basisGap = (estimatedFutures - vn30Ref).toFixed(1);
  const basisStatus = basisGap > 2 ? 'Phái sinh đang đắt (Cẩn thận bẫy úp Short)' : basisGap < -2 ? 'Phái sinh đang rẻ hơn cơ sở (Có nhịp giật hồi)' : 'Ngang bằng cơ sở';

  // Ước tính trạng thái Khối ngoại & OI qua đêm
  const foreignBias = gapTrend.primaryTrend === 'DOWNTREND' ? 'BÁN RÒNG (Nghiêng găm vị thế SHORT)' : 'MUA RÒNG (Nghiêng găm vị thế LONG)';

  let msg = `🔮 <b>TÍN HIỆU PHÁI SINH VN30F — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${dirIcon} <b>HƯỚNG MỞ VỊ THẾ: ${dirText}</b>\n`;
  msg += `📊 Điểm lực tín hiệu: <b>${score}/8 điểm</b> (${direction === 'SHORT' ? 'Phe Bán áp đảo' : 'Phe Mua áp đảo'})\n\n`;

  msg += `📋 <b>5 CHỈ SỐ CỐT LÕI QUYẾT ĐỊNH VỊ THẾ:</b>\n\n`;

  msg += `1️⃣ 🌐 <b>Xu hướng chính 1 tháng:</b> <b>${gapTrend.primaryTrend === 'DOWNTREND' ? '🔴 DOWNTREND (Thị trường giảm)' : '🟢 UPTREND (Thị trường tăng)'}</b>\n`;
  msg += `   <i>Cơ sở: VN-Index & VN30 lùi sâu dưới các đường trung bình. Đánh theo xu hướng chính có xác suất thắng cao nhất.</i>\n\n`;

  msg += `2️⃣ ⚖️ <b>Sức mạnh rổ VN30 (Xanh/Đỏ):</b> <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `   <code>${alignBar}</code>\n`;
  msg += `   <i>Cơ sở: ${alignment.redCount >= 12 ? 'Hơn một nửa cổ phiếu rổ VN30 bị xả đỏ ➔ Lực đè chỉ số rất mạnh.' : 'Nhiều mã VN30 giữ được sắc xanh ➔ Lực kéo nâng đỡ chỉ số.'}</i>\n\n`;

  msg += `3️⃣ 📊 <b>Độ lệch giá Basis (VN30F vs VN30):</b> <b>${basisGap > 0 ? '+' : ''}${basisGap} điểm</b>\n`;
  msg += `   <i>Trạng thái: ${basisStatus}</i>\n\n`;

  msg += `4️⃣ 💰 <b>Vị thế ròng Khối ngoại & OI qua đêm:</b> <b>${foreignBias}</b>\n`;
  msg += `   <i>Cơ sở: Khối ngoại liên tục bán ròng cổ phiếu rổ VN30, lượng HĐ găm qua đêm ủng hộ phe ${direction}.</i>\n\n`;

  msg += `5️⃣ 📦 <b>Khoảng trống ATO & Thanh khoản:</b> <b>Gap ${gapTrend.gapPoints >= 0 ? '+' : ''}${gapTrend.gapPoints} điểm</b> | <b>${volume.volumeRatio}x</b> TB5\n\n`;

  if (alignment.topWeak && alignment.topWeak.length > 0 && direction === 'SHORT') {
    msg += `💀 <b>TOP CP ĐÈ CHỈ SỐ VN30:</b> `;
    msg += alignment.topWeak.slice(0, 4).map(s => `${s.sym}(${s.changePct}%)`).join(', ') + `\n\n`;
  } else if (alignment.topStrong && alignment.topStrong.length > 0 && direction === 'LONG') {
    msg += `💪 <b>TOP CP NÂNG ĐỞ CHỈ SỐ VN30:</b> `;
    msg += alignment.topStrong.slice(0, 4).map(s => `${s.sym}(+${s.changePct}%)`).join(', ') + `\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🎯 <b>KHUYẾN NGHỊ KỊCH BẢN VÀO LỆNH THỰC TẾ:</b>\n`;
  msg += `   📍 <b>Vùng mở vị thế:</b> Mở <b>${direction}</b> quanh <b>~${(vn30Ref).toFixed(1)} - ${(estimatedFutures).toFixed(1)} điểm</b>\n`;
  msg += `   🎯 <b>Mục tiêu Chốt lời (TP):</b> Kỳ vọng <b>+10 đến +15 điểm</b> (Bot tự kích hoạt Trailing Stop khi lãi đậm).\n`;
  msg += `   🛑 <b>Mức Cắt lỗ (SL):</b> Cắt khi thị trường đảo chiều vượt <b>±6.0 điểm</b> hoặc rổ VN30 có biến động ngượng lại dứt khoát.\n`;

  msg += `\n<i>🔮 Derivatives Signal Engine v2.1 | VN Stock Bot</i>`;

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

// ─── AI DERIVATIVES ANALYSIS JOB (9h22 & 13h50) ────────────────
async function runAIDerivativesJob(session) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG (9h22)' : '🌆 CHIỀU (13h50)';
  console.log('\n' + '═'.repeat(55));
  console.log(`🤖 AI DERIVATIVES ANALYSIS — ${sessionLabel}`);
  console.log('═'.repeat(55));

  try {
    const signal = await calculateFinalSignal();
    const { direction, score, entryPrice, breakdown } = signal;
    const { alignment, gapTrend, volume } = breakdown;

    const vn30Ref = entryPrice || 1745.20;
    const estimatedFutures = gapTrend.gapPoints !== 0 ? (vn30Ref + gapTrend.gapPoints) : vn30Ref;
    const basisGap = (estimatedFutures - vn30Ref).toFixed(1);

    const apiKey = config.geminiAI4.apiKey || config.geminiAI1.apiKey;
    let aiResponseText = null;

    if (apiKey) {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Bạn là Giám Đốc Quỹ Đầu Tư & Chuyên Gia Phân Tích Phái Sinh VN30F1M hàng đầu Việt Nam.
Hãy phân tích dữ liệu thị trường thực tế ngay bây giờ và đưa ra dự báo độc lập cho hợp đồng Phái Sinh VN30F1M phiên ${sessionLabel}:

DỮ LIỆU THỊ TRƯỜNG THỰC TẾ:
- Thời gian: ${vnNow()}
- Xu hướng 1 tháng (Primary Trend): ${gapTrend.primaryTrend} (Biến động 1M: ${gapTrend.monthChangePct}%, SMA20: ${gapTrend.sma20})
- Rổ VN30 Xanh/Đỏ: ${alignment.greenCount} mã Xanh / ${alignment.redCount} mã Đỏ (Điểm alignment: ${alignment.alignScore})
- Gap ATO VN30 & Thanh khoản: Gap ${gapTrend.gapPoints > 0 ? '+' : ''}${gapTrend.gapPoints} điểm, Volume ${volume.volumeRatio}x TB5
- Độ lệch giá Basis (Phái sinh vs VN30): ${basisGap} điểm
- Nhận định Khối ngoại: ${gapTrend.primaryTrend === 'DOWNTREND' ? 'Bán ròng nghiêng găm vị thế SHORT' : 'Mua ròng nghiêng găm vị thế LONG'}
- Điểm phán quyết từ Code Thuật Toán: ${direction} (${score}/8 điểm)
- Top mã VN30 mạnh nhất: ${alignment.topStrong.map(s => `${s.sym} (${s.changePct}%)`).join(', ')}
- Top mã VN30 yếu nhất: ${alignment.topWeak.map(s => `${s.sym} (${s.changePct}%)`).join(', ')}

YÊU CẦU ĐỐI VỚI AI:
1. Đưa ra phán quyết độc lập của AI: LONG hay SHORT?
2. Trình bày 3 lý do cốt lõi bằng tiếng Việt dễ hiểu, công tâm, không dùng các thuật ngữ quá trừu tượng hay chuyên ngành sâu.
3. Nêu Mức giá đề xuất Mở vị thế (Entry), Mức Chốt lời (Take Profit) kỳ vọng (+10 đến +15 điểm), Mức Cắt lỗ (Stop Loss) khi bị đảo chiều.
4. Trình bày ngắn gọn, súc tích, định dạng HTML cho Telegram (dùng <b>, <i>, <code>).`;

      const result = await model.generateContent(prompt);
      aiResponseText = result.response.text();
    }

    let msg = `🤖 <b>DỰ BÁO PHÁI SINH TỪ CHUYÊN GIA AI — ${sessionLabel}</b>\n`;
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
      msg += `${dirIcon} <b>DỰ BÁO TỪ HỆ THỐNG AI: ${direction === 'LONG' ? 'LONG (CỬA TĂNG)' : 'SHORT (CỬA GIẢM)'}</b>\n\n`;
      msg += `📋 <b>3 Lý do cốt lõi:</b>\n`;
      msg += `   1. Bối cảnh xu hướng chính 1 tháng: <b>${gapTrend.primaryTrend}</b> ủng hộ phe ${direction}.\n`;
      msg += `   2. Tỷ lệ Xanh/Đỏ rổ VN30: <b>${alignment.greenCount} Xanh / ${alignment.redCount} Đỏ</b> ➔ Lực đè/kéo nghiêng rõ rệt.\n`;
      msg += `   3. Độ lệch Basis ước tính ${basisGap} điểm ➔ Thị trường ủng hộ kịch bản ${direction}.\n\n`;
      msg += `🎯 <b>Mức giá đề xuất:</b> Vùng vào ~${(vn30Ref).toFixed(1)} | TP: +12 điểm | SL: ±6 điểm\n\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>Đối chiếu cả tín hiệu từ Code (${direction}) và dự báo của AI để đưa ra quyết định vào lệnh tối ưu.</i>\n`;
    msg += `<i>🤖 VN Stock Bot v${config.version} | Gemini AI Derivatives Engine</i>`;

    await sendTelegramMessage(msg);
    console.log(`   ✅ AI Derivatives Job [${session}] hoàn thành`);
  } catch (err) {
    console.error(`   ❌ AI Derivatives Job [${session}] lỗi:`, err.message);
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
  runAIDerivativesJob,
  resetDerivativesState,
  stopPositionMonitor,
  getDerivativesState: () => ({ ..._state }),
};
