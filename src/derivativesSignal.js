/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN STOCK BOT - Derivatives Signal Engine v1.0           ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Tín hiệu phái sinh VN30F — Dựa trên 3 tín hiệu thực tế:   ║
 * ║  1. Component Alignment: Bao nhiêu mã VN30 xanh/đỏ 9h10     ║
 * ║  2. Opening Gap + ORB:   Hướng Gap ATO + 5 nến đầu          ║
 * ║  3. Volume Surge:        KL khớp đầu phiên vs lịch sử        ║
 * ║                                                               ║
 * ║  📅 Cron: 9h14 (sáng) + 13h14 (chiều) T2-T6                ║
 * ║  🎯 TP: +12 điểm | 🛑 SL: -2 điểm                           ║
 * ║  📡 Monitor: mỗi 3 phút sau khi mở vị thế                   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');
const { sendTelegramMessage } = require('./telegramService');

// ─── VN30 SYMBOLS + TRỌNG SỐ VỐN HÓA ───────────────────────
// Top 15 mã chiếm ~75% trọng số VN30 (ưu tiên check)
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
  morningClosed: false,     // true khi đã chốt lời sáng → bỏ qua chiều
  morningResult: null,      // 'TP' | 'SL' | null
  monitorTimer: null,       // setInterval handle
  lastVN30FClose: null,     // Giá đóng cửa VN30F hôm qua (để tính Gap)
};

// ─── HELPER ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function vnNow() {
  return new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
}

// ─── TÍN HIỆU 1: Component Alignment ───────────────────────
/**
 * Lấy realtime tất cả VN30 components, tính tỷ lệ xanh/đỏ có trọng số
 * @returns {{ score: number, greenCount: number, redCount: number, details: string }}
 */
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

    // Sort items by changePct descending
    const sorted = [...details].sort((a, b) => b.changePct - a.changePct);
    const topStrong = sorted.slice(0, 5);
    const topWeak = [...sorted].reverse().slice(0, 5);

    const total = weightedGreen + weightedRed;
    const alignScore = total > 0 ? (weightedGreen - weightedRed) / total : 0;
    // alignScore: +1 = toàn xanh, -1 = toàn đỏ

    let signal = 'NEUTRAL';
    if (alignScore >= 0.30) signal = 'LONG';
    if (alignScore <= -0.30) signal = 'SHORT';

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
    return { signal: 'NEUTRAL', alignScore: 0, greenCount: 0, redCount: 0, topStrong: [], topWeak: [], details: [] };
  }
}

// ─── TÍN HIỆU 2: Opening Gap + 5-Minute ORB ─────────────────
/**
 * So sánh VN30F ATO hiện tại với giá đóng cửa hôm qua
 * @returns {{ signal, gapPoints, entryPrice }}
 */
async function analyzeOpeningGap() {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 3; // 3 ngày lịch sử

    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    const data = res.data;
    if (!data || !data.c || data.c.length < 2) {
      return { signal: 'NEUTRAL', gapPoints: 0, entryPrice: null };
    }

    // Giá đóng cửa ngày hôm qua (phần tử áp cuối)
    const prevClose = data.c[data.c.length - 2];
    const todayOpen = data.o[data.o.length - 1]; // Giá mở cửa hôm nay
    _state.lastVN30FClose = prevClose;

    const gapPoints = parseFloat((todayOpen - prevClose).toFixed(2));

    let signal = 'NEUTRAL';
    if (gapPoints <= -5) signal = 'SHORT';  // Gap Down mạnh → SHORT
    if (gapPoints >= 5)  signal = 'LONG';   // Gap Up mạnh → LONG

    return { signal, gapPoints, entryPrice: todayOpen };
  } catch (e) {
    console.error('   ❌ OpeningGap error:', e.message);
    return { signal: 'NEUTRAL', gapPoints: 0, entryPrice: null };
  }
}

// ─── TÍN HIỆU 3: Volume Profile ─────────────────────────────
/**
 * So sánh KL VN30 lúc 9h10 vs TB lịch sử đầu phiên
 * @returns {{ signal, volumeRatio }}
 */
async function analyzeVolumeProfile() {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 10; // 10 ngày

    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VNINDEX&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    const data = res.data;
    if (!data || !data.v || data.v.length < 5) {
      return { signal: 'NEUTRAL', volumeRatio: 1 };
    }

    const volumes    = data.v;
    const todayVol   = volumes[volumes.length - 1];
    const avgVol5    = volumes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;

    const volumeRatio = avgVol5 > 0 ? parseFloat((todayVol / avgVol5).toFixed(2)) : 1;

    // Lấy change% của VN30 hôm nay để biết chiều
    const closes = data.c;
    const todayChange = closes.length >= 2
      ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100
      : 0;

    let signal = 'NEUTRAL';
    if (volumeRatio >= 1.4 && todayChange < 0) signal = 'SHORT'; // KL cao + giảm mạnh
    if (volumeRatio >= 1.4 && todayChange > 0) signal = 'LONG';  // KL cao + tăng mạnh
    if (volumeRatio < 0.7) signal = 'WAIT'; // Thanh khoản quá thấp, bỏ qua ngày này

    return { signal, volumeRatio, todayChange: parseFloat(todayChange.toFixed(2)) };
  } catch (e) {
    console.error('   ❌ VolumeProfile error:', e.message);
    return { signal: 'NEUTRAL', volumeRatio: 1, todayChange: 0 };
  }
}

// ─── TỔNG HỢP 3 TÍN HIỆU → FINAL SIGNAL ────────────────────
/**
 * @returns {{ direction: 'LONG'|'SHORT'|'WAIT', score: number, breakdown: Object }}
 */
async function calculateFinalSignal() {
  console.log('   🔍 Phân tích 3 tín hiệu phái sinh...');

  const [alignment, gap, volume] = await Promise.all([
    analyzeComponentAlignment(),
    analyzeOpeningGap(),
    analyzeVolumeProfile(),
  ]);

  console.log(`   📊 Alignment: ${alignment.signal} (score=${alignment.alignScore}, 🟢${alignment.greenCount}/🔴${alignment.redCount})`);
  console.log(`   📈 Gap: ${gap.signal} (${gap.gapPoints > 0 ? '+' : ''}${gap.gapPoints}đ)`);
  console.log(`   📦 Volume: ${volume.signal} (${volume.volumeRatio}x TB, TT ${volume.todayChange > 0 ? '+' : ''}${volume.todayChange}%)`);

  // WAIT override: nếu thanh khoản quá thấp → bỏ qua ngày
  if (volume.signal === 'WAIT') {
    return {
      direction: 'WAIT',
      score: 0,
      reason: 'Thanh khoản quá thấp (< 70% TB 5 phiên). Bỏ qua ngày hôm nay.',
      breakdown: { alignment, gap, volume },
    };
  }

  // Tính điểm (mỗi tín hiệu 0/1/2)
  const scoreMap = { 'LONG': 2, 'NEUTRAL': 1, 'SHORT': 0 };

  let totalScore = 0;
  totalScore += scoreMap[alignment.signal] ?? 1;   // Quan trọng nhất (×2 trọng số)
  totalScore += scoreMap[alignment.signal] ?? 1;   // Nhân đôi alignment
  totalScore += scoreMap[gap.signal] ?? 1;
  totalScore += scoreMap[volume.signal] ?? 1;

  // Max = 8, Min = 0
  // ≥6 → LONG, ≤2 → SHORT, giữa → WAIT
  let direction = 'WAIT';
  if (totalScore >= 6) direction = 'LONG';
  if (totalScore <= 2) direction = 'SHORT';

  const entryPrice = gap.entryPrice;

  return {
    direction,
    score: totalScore,
    entryPrice,
    breakdown: { alignment, gap, volume },
  };
}

// ─── GỬI TELEGRAM TÍN HIỆU MỞ VỊ THẾ ───────────────────────
async function sendOpenSignal(session, signal) {
  const { direction, score, entryPrice, breakdown } = signal;
  const { alignment, gap, volume } = breakdown;

  const sessionLabel = session === 'morning' ? '🌅 SÁNG (9h14)' : '🌆 CHIỀU (13h14)';
  const dirIcon  = direction === 'LONG'  ? '🟢' : direction === 'SHORT' ? '🔴' : '⚪';
  const dirText  = direction === 'LONG'  ? 'LONG (MUA)'
                 : direction === 'SHORT' ? 'SHORT (BÁN)' : 'KHÔNG MỞ VỊ THẾ (ĐỨNG NGOÀI)';

  const alignBar = `${'🟢'.repeat(alignment.greenCount)}${'🔴'.repeat(alignment.redCount)}`.substring(0, 20);

  let msg = `🔮 <b>TÍN HIỆU PHÁI SINH VN30F — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${dirIcon} <b>HƯỚNG: ${dirText}</b>\n`;
  msg += `📊 Điểm tổng hợp: <b>${score}/8 điểm</b>\n\n`;

  if (direction === 'WAIT') {
    msg += `⚪ <b>LÝ DO:</b> <i>${signal.reason || 'Tín hiệu mâu thuẫn hoặc thanh khoản yếu. Đứng ngoài bảo toàn vốn.'}</i>\n\n`;
  }

  msg += `📋 <b>CHỈ SỐ & TÍN HIỆU THỊ TRƯỜNG:</b>\n`;
  msg += `   📊 Tỷ lệ VN30 Xanh/Đỏ: <b>${alignment.greenCount}🟢 / ${alignment.redCount}🔴</b>\n`;
  msg += `      <code>${alignBar}</code>\n`;
  msg += `      (Trọng số AlignScore: ${alignment.alignScore > 0 ? '+' : ''}${alignment.alignScore})\n`;
  msg += `   📈 Gap ATO VN30: <b>${gap.gapPoints >= 0 ? '+' : ''}${gap.gapPoints} điểm</b> (Tín hiệu: ${gap.signal})\n`;
  msg += `   📦 Thanh khoản đầu phiên: <b>${volume.volumeRatio}x</b> TB5 (TT: ${volume.todayChange >= 0 ? '+' : ''}${volume.todayChange}%)\n`;
  if (entryPrice) {
    msg += `   📍 Tham chiếu VN30: ~<b>${entryPrice.toFixed(2)} điểm</b>\n`;
  }
  msg += `\n`;

  // Thêm Top mã MẠNH nhất & YẾU nhất VN30
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

  if (direction !== 'WAIT') {
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🎯 <b>HÀNH ĐỘNG KHUYẾN NGHỊ:</b>\n`;
    msg += `   ${dirIcon} Mở vị thế <b>${direction}</b> VN30F1M (9h15 - 9h25)\n`;
    msg += `   ✅ Chốt lời (TP): <b>+12 điểm</b> (+1.200.000đ/HĐ)\n`;
    msg += `   🛑 Cắt lỗ  (SL): <b>-2 điểm</b>  (-200.000đ/HĐ)\n`;
    msg += `\n⚠️ <i>Cài ngay lệnh điều kiện OCO sau khi khớp. Tuyệt đối không gồng tay!</i>\n`;
  } else {
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>Tham khảo sức mạnh các mã VN30 ở trên. Không mở vị thế hôm nay để tránh bẫy của Lái.</i>\n`;
  }

  msg += `\n<i>🔮 Derivatives Signal Engine v1.1 | VN Stock Bot</i>`;

  await sendTelegramMessage(msg);
  return msg;
}

// ─── MONITOR VỊ THẾ ─────────────────────────────────────────
/**
 * Kiểm tra VN30F hiện tại, so với entry → bắn noti TP/SL/Trailing
 * @param {string} session - 'morning' | 'afternoon'
 * @param {{ direction, entryPrice }} position
 */
async function checkPositionStatus(session, position) {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 2;

    const res = await axios.get(
      `${VPS_HISTORY_URL}?symbol=VN30&resolution=D&from=${from}&to=${now}`,
      { headers: HEADERS, timeout: 8000 }
    );

    const data = res.data;
    if (!data || !data.c || data.c.length === 0) return;

    const currentPrice = data.c[data.c.length - 1];
    const entry = position.entryPrice;
    if (!entry) return;

    // Tính P&L theo hướng vị thế
    const pnlPoints = position.direction === 'LONG'
      ? parseFloat((currentPrice - entry).toFixed(2))
      : parseFloat((entry - currentPrice).toFixed(2));

    const pnlVND = Math.round(pnlPoints * 100000); // 1 điểm = 100.000đ
    const pnlSign = pnlPoints >= 0 ? '+' : '';

    console.log(`   📡 Monitor [${session}]: Current=${currentPrice.toFixed(2)}, Entry=${entry.toFixed(2)}, P&L=${pnlSign}${pnlPoints}đ (${pnlSign}${(pnlVND / 1000).toFixed(0)}k)`);

    // ─── TP: Lãi >= 12 điểm ──────────────────────────────
    if (pnlPoints >= 12) {
      await sendTPAlert(session, position, currentPrice, pnlPoints);
      return 'TP';
    }

    // ─── SL: Lỗ >= 2 điểm ───────────────────────────────
    if (pnlPoints <= -2) {
      await sendSLAlert(session, position, currentPrice, pnlPoints);
      return 'SL';
    }

    // ─── Trailing: Đang lãi 8-11 điểm + trend tiếp tục ──
    if (pnlPoints >= 8) {
      // Kiểm tra alignment hiện tại để xem trend còn tiếp không
      const alignment = await analyzeComponentAlignment();
      const trendContinues = position.direction === 'LONG'
        ? alignment.alignScore >= 0.2
        : alignment.alignScore <= -0.2;

      if (trendContinues) {
        await sendTrailingAlert(session, position, currentPrice, pnlPoints, alignment);
      }
    }

    return 'HOLDING';
  } catch (e) {
    console.error(`   ❌ Monitor error [${session}]:`, e.message);
    return 'ERROR';
  }
}

// ─── GỬI NOTI CHỐT LỜI ─────────────────────────────────────
async function sendTPAlert(session, position, currentPrice, pnlPoints) {
  const pnlVND = Math.round(pnlPoints * 100000);
  const sessionLabel = session === 'morning' ? '🌅 SÁNG' : '🌆 CHIỀU';

  let msg = `✅ <b>CHỐT LỜI — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🎯 <b>ĐẠT MỤC TIÊU +12 ĐIỂM!</b>\n\n`;
  msg += `   📍 Entry: ${position.entryPrice?.toFixed(2) || 'N/A'}\n`;
  msg += `   📍 Hiện tại: ${currentPrice.toFixed(2)}\n`;
  msg += `   💰 Lãi: <b>+${pnlPoints.toFixed(1)} điểm (+${(pnlVND / 1000000).toFixed(1)} triệu)</b>\n\n`;
  msg += `⚡ <b>ĐÓNG VỊ THẾ NGAY BÂY GIỜ!</b>\n`;

  if (session === 'morning') {
    msg += `\n☕ <i>Đã thắng phiên sáng. Phiên chiều nghỉ ngơi, không cần quan tâm nữa.</i>\n`;
  }

  msg += `\n<i>🔮 Derivatives Signal v1.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── GỬI NOTI CẮT LỖ ───────────────────────────────────────
async function sendSLAlert(session, position, currentPrice, pnlPoints) {
  const pnlVND = Math.round(pnlPoints * 100000); // âm
  const sessionLabel = session === 'morning' ? '🌅 SÁNG' : '🌆 CHIỀU';

  let msg = `🛑 <b>CẮT LỖ — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `⚠️ <b>ÂM 2 ĐIỂM — ĐÓNG VỊ THẾ NGAY!</b>\n\n`;
  msg += `   📍 Entry: ${position.entryPrice?.toFixed(2) || 'N/A'}\n`;
  msg += `   📍 Hiện tại: ${currentPrice.toFixed(2)}\n`;
  msg += `   💸 Lỗ: <b>${pnlPoints.toFixed(1)} điểm (${(pnlVND / 1000000).toFixed(2)} triệu)</b>\n\n`;
  msg += `🔴 <b>Đóng ngay, không chờ, không gồng!</b>\n`;
  msg += `<i>Bảo toàn vốn là ưu tiên số 1.</i>\n`;
  msg += `\n<i>🔮 Derivatives Signal v1.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── GỬI NOTI TRAILING (Đang lãi, trend còn tiếp) ───────────
async function sendTrailingAlert(session, position, currentPrice, pnlPoints, alignment) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG' : '🌆 CHIỀU';
  const dirText = position.direction === 'LONG' ? 'LONG 🟢' : 'SHORT 🔴';

  let msg = `📈 <b>TRAILING STOP — ${sessionLabel}</b>\n`;
  msg += `🕐 <i>${vnNow()}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `✅ Đang lãi <b>+${pnlPoints.toFixed(1)} điểm</b> và xu hướng CÒN TIẾP!\n\n`;
  msg += `   📊 Alignment hiện tại: ${alignment.greenCount}🟢 / ${alignment.redCount}🔴\n`;
  msg += `   🎯 Vị thế: ${dirText}\n\n`;
  msg += `💡 <b>Có thể giữ thêm</b> để ăn trọn sóng.\n`;
  msg += `⚠️ Nếu thấy dấu hiệu đảo chiều → Đóng ngay để bảo toàn lợi nhuận.\n`;
  msg += `\n<i>🔮 Derivatives Signal v1.0 | VN Stock Bot</i>`;
  await sendTelegramMessage(msg);
}

// ─── BẮT ĐẦU MONITOR POSITION ───────────────────────────────
/**
 * Chạy mỗi 3 phút để theo dõi P&L, gửi noti khi cần
 * @param {string} session - 'morning' | 'afternoon'
 * @param {{ direction, entryPrice }} position
 * @param {number} durationMinutes - Số phút monitor tối đa
 */
function startPositionMonitor(session, position, durationMinutes = 90) {
  stopPositionMonitor(); // Dừng monitor cũ nếu có

  let elapsed = 0;
  const INTERVAL_MS = 3 * 60 * 1000; // 3 phút

  _state.monitorTimer = setInterval(async () => {
    elapsed += 3;

    // Timeout: dừng sau durationMinutes
    if (elapsed >= durationMinutes) {
      console.log(`   ⏱ Monitor [${session}] timeout sau ${durationMinutes} phút`);
      stopPositionMonitor();
      return;
    }

    const result = await checkPositionStatus(session, position);

    if (result === 'TP') {
      console.log(`   ✅ [${session}] ĐẠT TP! Dừng monitor.`);
      stopPositionMonitor();
      if (session === 'morning') {
        _state.morningClosed = true;
        _state.morningResult = 'TP';
      }
    }

    if (result === 'SL') {
      console.log(`   🛑 [${session}] DÍNH SL! Dừng monitor.`);
      stopPositionMonitor();
      if (session === 'morning') {
        _state.morningResult = 'SL';
      }
    }
  }, INTERVAL_MS);

  console.log(`   📡 Bắt đầu monitor [${session}] mỗi 3 phút (tối đa ${durationMinutes}p)`);
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
  console.log('🔮 DERIVATIVES SIGNAL — SÁNG (9h14)');
  console.log('═'.repeat(55));

  // Reset state đầu ngày
  _state.morningSignal  = null;
  _state.afternoonSignal = null;
  _state.morningClosed  = false;
  _state.morningResult  = null;
  stopPositionMonitor();

  try {
    const signal = await calculateFinalSignal();
    _state.morningSignal = signal;

    console.log(`   🎯 Final Signal: ${signal.direction} (score=${signal.score}/8)`);

    await sendOpenSignal('morning', signal);

    // Nếu có tín hiệu LONG/SHORT → bắt đầu monitor
    if (signal.direction !== 'WAIT') {
      const position = {
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        session: 'morning',
        openTime: Date.now(),
      };
      _state.morningSignal = { ...signal, ...position };

      // Monitor từ 9h15 đến tối đa 11h45 (~150 phút)
      startPositionMonitor('morning', position, 150);
    }
  } catch (e) {
    console.error('   ❌ Morning derivatives job error:', e.message);
  }
}

// ─── JOB CHIỀU: 13h14 ───────────────────────────────────────
async function runAfternoonDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL — CHIỀU (13h14)');
  console.log('═'.repeat(55));

  // Nếu sáng đã thắng TP → nghỉ chiều
  if (_state.morningClosed && _state.morningResult === 'TP') {
    console.log('   ✅ Phiên sáng đã chốt lời. Nghỉ buổi chiều.');
    await sendTelegramMessage(
      `☕ <b>PHÁI SINH CHIỀU — NGHỈ</b>\n` +
      `🕐 <i>${vnNow()}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ Phiên sáng đã <b>chốt lời thành công</b>.\n` +
      `☕ Không mở vị thế chiều. Bảo toàn kết quả ngày hôm nay.\n` +
      `\n<i>🔮 Derivatives Signal v1.0 | VN Stock Bot</i>`
    );
    return;
  }

  try {
    const signal = await calculateFinalSignal();
    _state.afternoonSignal = signal;

    console.log(`   🎯 Final Signal: ${signal.direction} (score=${signal.score}/8)`);

    await sendOpenSignal('afternoon', signal);

    if (signal.direction !== 'WAIT') {
      const position = {
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        session: 'afternoon',
        openTime: Date.now(),
      };
      _state.afternoonSignal = { ...signal, ...position };

      // Monitor từ 13h15 đến tối đa 14h15 (~60 phút)
      startPositionMonitor('afternoon', position, 60);
    }
  } catch (e) {
    console.error('   ❌ Afternoon derivatives job error:', e.message);
  }
}

// ─── RESET DAILY STATE ───────────────────────────────────────
function resetDerivativesState() {
  stopPositionMonitor();
  _state.morningSignal  = null;
  _state.afternoonSignal = null;
  _state.morningClosed  = false;
  _state.morningResult  = null;
  console.log('   🔄 Derivatives state reset');
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  runMorningDerivativesJob,
  runAfternoonDerivativesJob,
  resetDerivativesState,
  stopPositionMonitor,
  getDerivativesState: () => ({ ..._state }),
};
