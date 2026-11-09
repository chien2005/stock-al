/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚡ VN30F — Tape Reading & Volume Acceleration Engine        ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  THEO DÕI GIA TỐC VOLUME, TỐC ĐỘ GIÁ & QUY TẮC BẢO VỆ 3 NẾN    ║
 * ║                                                                ║
 * ║  1. GIA TỐC DỒN DẬP (Monochrome Surge / High Velocity Burst):  ║
 * ║     10s-35s đầu nến vol tăng vun vút (≥1400 HĐ hoặc ≥50 HĐ/s),  ║
 * ║     thuần 1 màu xanh hoặc đỏ, biên độ giá dồn dập ≥1.2đ         ║
 * ║     ➔ Lực Long/Short dứt khoát áp đảo, thuận thế đẩy tiếp.     ║
 * ║                                                                ║
 * ║  2. BẪY ĐẢO MÀU PHÚT CHÓT (Last-Second Color Flip / Trap):     ║
 * ║     40s đầu nến phủ 1 màu (đè bán / kéo ảo vol to), nhưng 15s  ║
 * ║     cuối nến bất ngờ giật lật màu ngược lại                    ║
 * ║     ➔ Cao trào bị hấp thụ / Lái giật kill S-L ➔ CẤM ĐUỔI LỆNH. ║
 * ║                                                                ║
 * ║  3. QUY TẮC BẢO VỆ 3 NẾN LIỀN KỀ & VỊ TRÍ KHUNG NGÀY:          ║
 * ║     • Vị trí khung ngày: Đỉnh ngày, Đáy ngày, hay Giữa chừng.  ║
 * ║       (Giữa chừng rất dễ là bẫy giũ hàng để kéo/xả tiếp 20-30đ)║
 * ║     • Nến 1: Xuất hiện rút râu / đảo màu ➔ CẢNH BÁO QUAN SÁT,  ║
 * ║       TUYỆT ĐỐI CẤM MỞ LỆNH ĐU THEO CÂY NÀY (Dao 2 lưỡi)!      ║
 * ║     • Nến 2: Kiểm tra nhịp Retest (Có vượt đỉnh / thủng đáy    ║
 * ║       không? Nếu vượt/thủng ➔ VÔ HIỆU HÓA BẪY GIẢ).            ║
 * ║     • Nến 3: Đóng nến xác nhận bứt phá/phá vỡ nền vi mô         ║
 * ║       ➔ MỚI ĐỦ ĐIỀU KIỆN AN TOÀN ĐỂ MỞ LỆNH HOẶC CHỐT VỊ THẾ!  ║
 * ║                                                                ║
 * ║  4. Bối cảnh Thanh khoản (<16k tỷ Sideway vs ≥16k tỷ Big Trend)║
 * ║     và Yếu tố Khung giờ (Sóng sáng vs Giờ Call Margin 13h45)   ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config, isCurrentInstanceActive } = require('../config');
const { sendDerivativesMessage } = require('../telegramService');

// ─── THRESHOLDS & CONSTANTS ──────────────────────────────────
const SURGE_MIN_VOL = 1400;              // Vol tối thiểu đầu nến để tính surge
const SURGE_MIN_SPEED = 50;              // Tốc độ tối thiểu 50 HĐ/giây
const SURGE_MIN_PRICE_DELTA = 1.2;       // Giá chạy ít nhất 1.2đ
const SURGE_MAX_SECONDS = 35;            // Xét trong 35 giây đầu của nến 1p

const FLIP_FIRST_PERIOD_SECONDS = 40;    // Xét trạng thái trong 40s đầu
const FLIP_MIN_VOL = 1200;               // Vol tối thiểu của nến lật màu
const FLIP_MIN_REVERSAL_PTS = 1.2;       // Độ giật ngược từ cực trị

const WICK_REJECTION_MIN = 1.2;          // Râu nến tại cực trị sóng ngắn
const WAVE_EXTREME_PTS = 2.5;            // Nhịp tăng/giảm ngắn hạn >= 2.5đ

// Cooldown giữa các cảnh báo cùng loại (tránh spam)
const COOLDOWN_SURGE_MS = 90 * 1000;
const COOLDOWN_FLIP_MS = 120 * 1000;
const COOLDOWN_EXTREME_MS = 90 * 1000;
const COOLDOWN_DOJI_MS = 180 * 1000;

// ─── INTERNAL ENGINE STATE ───────────────────────────────────
const _state = {
  // Intra-minute bar tracking
  currentMinuteKey: null,      // e.g. "09:35"
  barOpenTime: 0,
  barOpenPrice: null,
  barOpenLot: null,
  intraTicks: [],              // [{ time, sec, price, lot, tickVol, delta, color }]
  colorFlipsInMinute: 0,
  lastTickColor: null,

  // Event alert flags per minute (chỉ bắn 1 lần mỗi loại trong 1 phút)
  hasFiredSurgeThisBar: false,
  hasFiredFlipThisBar: false,

  // 3-Candle Confirmation Pipeline
  // pendingSetups: array of { id, type: 'PEAK_REJECTION'|'TROUGH_ABSORPTION', step: 1|2, bar1, bar2, location, session, createdAt }
  pendingSetups: [],

  // Global cooldown timestamps
  lastSurgeAlertTime: 0,
  lastFlipAlertTime: 0,
  lastPeakAlertTime: 0,
  lastTroughAlertTime: 0,
  lastDojiAlertTime: 0,
};

// ─── HELPERS ─────────────────────────────────────────────────
function getVnTimeHHMMSS() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getVnTimeHHMM() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isMonitoringHours() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const day = d.getDay();
  if (day === 0 || day === 6) return false; // Cuối tuần

  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const isMorning = hhmm >= '09:00' && hhmm <= '11:30';
  const isAfternoon = hhmm >= '13:00' && hhmm <= '14:35';
  return isMorning || isAfternoon;
}

// ─── 0. PHÂN TÍCH VỊ TRÍ KHUNG NGÀY (DAY STRUCTURE LOCATION) ──
function analyzeDayLocation(candle, allCandles) {
  if (!allCandles || allCandles.length === 0) {
    return {
      dayHigh: candle.high,
      dayLow: candle.low,
      dayRange: 0,
      distToHigh: 0,
      distToLow: 0,
      type: 'MID_RANGE',
      badge: '⚪ VÙNG GIỮA CHỪNG SÓNG NGÀY (MID-RANGE)',
      warning: 'Cảnh giác rút râu giữa chừng: Rất dễ là nhịp nghỉ tích lũy để kéo/xả tiếp 20-30đ!',
      isExtremeLocation: false,
    };
  }

  const dayHigh = Math.max(...allCandles.map(c => c.high));
  const dayLow = Math.min(...allCandles.map(c => c.low));
  const dayRange = parseFloat((dayHigh - dayLow).toFixed(1));

  const distToHigh = parseFloat((dayHigh - candle.high).toFixed(1));
  const distToLow = parseFloat((candle.low - dayLow).toFixed(1));

  let type = 'MID_RANGE';
  let badge = '⚠️ VÙNG GIỮA CHỪNG SÓNG NGÀY (MID-RANGE)';
  let warning = 'Giá đang ở giữa chừng sóng ngày. Rút râu giữa chừng thường chỉ là nhịp nghỉ/chốt lời tạm thời của Trend, rất dễ retest rồi tăng/giảm tiếp 20-30đ!';
  let isExtremeLocation = false;

  if (distToHigh <= 1.0) {
    type = 'AT_DAY_HIGH';
    badge = `🎯 ĐẮC ĐỊA: SÁT ĐỈNH CAO NHẤT NGÀY (Day High ${dayHigh.toFixed(1)})`;
    warning = 'Vị trí cản uy tín cao nhất phiên hôm nay. Khả năng đảo chiều thực sự có trọng lượng.';
    isExtremeLocation = true;
  } else if (distToLow <= 1.0) {
    type = 'AT_DAY_LOW';
    badge = `🎯 ĐẮC ĐỊA: SÁT ĐÁY THẤP NHẤT NGÀY (Day Low ${dayLow.toFixed(1)})`;
    warning = 'Vị trí hỗ trợ uy tín cao nhất phiên hôm nay. Lực cầu hấp thụ tại đáy có trọng lượng.';
    isExtremeLocation = true;
  } else if (distToHigh <= 2.5) {
    type = 'NEAR_DAY_HIGH';
    badge = `⛰️ VÙNG CẬN ĐỈNH NGÀY (Cách Day High ${distToHigh}đ)`;
    warning = 'Gần đỉnh ngày, có áp lực bán cản trở nhất định.';
    isExtremeLocation = true;
  } else if (distToLow <= 2.5) {
    type = 'NEAR_DAY_LOW';
    badge = `🌊 VÙNG CẬN ĐÁY NGÀY (Cách Day Low ${distToLow}đ)`;
    warning = 'Gần đáy ngày, có lực cầu đỡ giá nhất định.';
    isExtremeLocation = true;
  }

  return {
    dayHigh,
    dayLow,
    dayRange,
    distToHigh,
    distToLow,
    type,
    badge,
    warning,
    isExtremeLocation,
  };
}

// ─── 0B. PHÂN TÍCH KHUNG GIỜ & RỦI RO BIG TREND ───────────────
function analyzeSessionContext(hhmm) {
  let sessionName = 'TRONG PHIÊN';
  let isBigTrendRiskHours = false;
  let timingAdvice = '';

  if (hhmm >= '09:00' && hhmm < '09:30') {
    sessionName = 'ATO & MỞ CỬA SÁNG (09:00 - 09:30)';
    timingAdvice = 'Sóng mở cửa còn nhiễu cung cầu, Lái test lực. Rút râu đầu phiên cần thận trọng bẫy thử thách.';
  } else if (hhmm >= '09:30' && hhmm < '11:00') {
    sessionName = 'SÓNG SÁNG CHÍNH THỨC (09:30 - 11:00)';
    timingAdvice = 'Khung giờ xu hướng buổi sáng. Dòng tiền xác lập hướng đi rõ nét.';
  } else if (hhmm >= '11:00' && hhmm <= '11:30') {
    sessionName = 'CHỐT LỜI CUỐI SÁNG (11:00 - 11:30)';
    timingAdvice = 'Thanh khoản bắt đầu hạ nhiệt, giằng co giữ biên.';
  } else if (hhmm >= '13:00' && hhmm < '13:45') {
    sessionName = 'TÍCH LŨY ĐẦU CHIỀU (13:00 - 13:45)';
    timingAdvice = 'Xây nền kiểm tra lại lượng hàng phiên sáng trước khi vào pha quyết định.';
  } else if (hhmm >= '13:45' && hhmm <= '14:25') {
    sessionName = '⚡ GIỜ VÀNG CALL MARGIN & XUNG LỰC BIG TREND (13:45 - 14:25)';
    isBigTrendRiskHours = true;
    timingAdvice = '⚠️ CỰC KỲ NGUY HIỂM: Khung giờ biến động khốc liệt nhất ngày! Nếu đang có Big Long/Big Short, TUYỆT ĐỐI KHÔNG ĐU NGƯỢC PHA (tránh bị bỏ rơi âm 20-30đ)!';
  } else if (hhmm > '14:25') {
    sessionName = 'ATC & ĐÓNG CỬA (14:25 - 14:35)';
    timingAdvice = 'ATC định hình giá đóng cửa ngày.';
  }

  return {
    sessionName,
    isBigTrendRiskHours,
    timingAdvice,
  };
}

// ─── 1. FAST TICK HANDLER (XỬ LÝ MỖI 5 GIÂY) ────────────────
async function onFastTick(tick) {
  if (!isCurrentInstanceActive()) return;
  if (!isMonitoringHours()) return;
  if (!tick || !tick.price) return;

  const now = tick.time || Date.now();
  const currentHHMM = getVnTimeHHMM();

  // Kiểm tra chuyển sang phút mới
  if (_state.currentMinuteKey !== currentHHMM) {
    _state.currentMinuteKey = currentHHMM;
    _state.barOpenTime = now;
    _state.barOpenPrice = tick.price;
    _state.barOpenLot = tick.lot || null;
    _state.intraTicks = [];
    _state.colorFlipsInMinute = 0;
    _state.lastTickColor = null;
    _state.hasFiredSurgeThisBar = false;
    _state.hasFiredFlipThisBar = false;
  }

  if (_state.barOpenPrice === null) _state.barOpenPrice = tick.price;
  if (_state.barOpenLot === null && tick.lot) _state.barOpenLot = tick.lot;

  const secondInBar = Math.min(59, Math.max(1, Math.floor((now - _state.barOpenTime) / 1000)));
  const accumulatedVol = (tick.lot && _state.barOpenLot) ? Math.max(0, tick.lot - _state.barOpenLot) : 0;
  const priceDelta = parseFloat((tick.price - _state.barOpenPrice).toFixed(1));

  let tickColor = 'NEUTRAL';
  if (priceDelta >= 0.2) tickColor = 'GREEN';
  else if (priceDelta <= -0.2) tickColor = 'RED';

  // Đếm số lần nhấp nháy đổi màu
  if (_state.lastTickColor && tickColor !== 'NEUTRAL' && _state.lastTickColor !== 'NEUTRAL' && tickColor !== _state.lastTickColor) {
    _state.colorFlipsInMinute++;
  }
  if (tickColor !== 'NEUTRAL') _state.lastTickColor = tickColor;

  const tickRecord = {
    time: now,
    sec: secondInBar,
    price: tick.price,
    lot: tick.lot,
    accumulatedVol,
    priceDelta,
    color: tickColor,
  };
  _state.intraTicks.push(tickRecord);

  // ─── KIỂM TRA ĐIỀU KIỆN 1: GIA TỐC DỒN DẬP (ACCELERATION SURGE) ───
  if (!_state.hasFiredSurgeThisBar && secondInBar <= SURGE_MAX_SECONDS && secondInBar >= 10) {
    await checkAccelerationSurge(secondInBar, accumulatedVol, priceDelta, tick.price);
  }

  // ─── KIỂM TRA ĐIỀU KIỆN 2: BẪY ĐẢO MÀU PHÚT CHÓT (LAST-SECOND FLIP) ───
  if (!_state.hasFiredFlipThisBar && secondInBar >= 45 && secondInBar <= 58) {
    await checkLastSecondFlip(secondInBar, accumulatedVol, priceDelta, tick.price);
  }
}

// ─── 1A. LOGIC GIA TỐC DỒN DẬP (BURST) ──────────────────────
async function checkAccelerationSurge(secondInBar, accumulatedVol, priceDelta, currentPrice) {
  const now = Date.now();
  if (now - _state.lastSurgeAlertTime < COOLDOWN_SURGE_MS) return;

  const absDelta = Math.abs(priceDelta);
  if (absDelta < SURGE_MIN_PRICE_DELTA) return;

  const volSpeed = secondInBar > 0 ? (accumulatedVol / secondInBar) : 0;
  const isVolHeavy = accumulatedVol >= SURGE_MIN_VOL || volSpeed >= SURGE_MIN_SPEED;
  if (!isVolHeavy) return;

  const nonNeutralTicks = _state.intraTicks.filter(t => t.color !== 'NEUTRAL');
  if (nonNeutralTicks.length < 2) return;

  const targetColor = priceDelta > 0 ? 'GREEN' : 'RED';
  const matchingTicks = nonNeutralTicks.filter(t => t.color === targetColor);
  const colorConsistency = matchingTicks.length / nonNeutralTicks.length;

  if (colorConsistency < 0.85) return;

  _state.hasFiredSurgeThisBar = true;
  _state.lastSurgeAlertTime = now;

  const isLong = priceDelta > 0;
  const timeStr = getVnTimeHHMMSS();
  const speedStr = volSpeed.toFixed(1);

  let msg = isLong
    ? `🚀 <b>[GIA TỐC DỒN DẬP] LỰC LONG ĐẨY VÀO DỨT KHOÁT!</b>\n`
    : `⚡ <b>[GIA TỐC DỒN DẬP] LỰC SHORT ĐÈ BÁN DỨT KHOÁT!</b>\n`;
  msg += `🕐 <i>${timeStr} | F1M: <b>${currentPrice.toFixed(1)}</b> (${isLong ? '+' : ''}${priceDelta.toFixed(1)}đ)</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `⚡ <b>TỐC ĐỘ VOLUME & XUNG LỰC VI MÔ:</b>\n`;
  msg += `  • Khớp dồn dập: <b>${isLong ? '+' : ''}${priceDelta.toFixed(1)}đ</b> chỉ trong <b>${secondInBar}s đầu nến!</b>\n`;
  if (accumulatedVol > 0) {
    msg += `  • Volume đầu nến: <b>${accumulatedVol.toLocaleString()} HĐ</b> (Tốc độ: <b>${speedStr} HĐ/giây</b>) 🔥\n`;
  }
  msg += `  • Trạng thái nến: <b>${isLong ? '🟢 Thuần 1 màu XANH' : '🔴 Thuần 1 màu ĐỎ'} (Lệnh vào quyết liệt)</b>\n\n`;

  msg += `🧠 <b>GIẢI MÃ TAPE READING:</b>\n`;
  if (isLong) {
    msg += `  👉 Phe Long dùng lệnh thị trường (MP/MTL) quét sạch thanh khoản bán, chủ động ăn lên áp đảo. Xung lực kéo tăng rất dứt khoát!\n\n`;
  } else {
    msg += `  👉 Phe Short dồn lệnh thị trường quét thẳng xuống các bước giá đối ứng, áp lực bán tháo dứt khoát. Bên mua hoàn toàn lép vế!\n\n`;
  }

  msg += `📋 <b>HÀNH ĐỘNG CỦA SENIOR TRADER:</b>\n`;
  if (isLong) {
    msg += `  • Đang giữ LONG ➔ <b>TIẾP TỤC GỒNG LÃI THEO XUNG LỰC MẠNH!</b>\n`;
    msg += `  • Đang giữ SHORT ➔ <b>CẢNH GIÁC CAO / HẠ BỚT TỶ TRỌNG HOẶC NÂNG SL!</b>\n`;
    msg += `  • Chưa có lệnh ➔ Thuận theo đà tăng, canh nhịp retest nhẹ để mở Long, <b>CẤM CHẶN ĐẦU SHORT!</b>\n`;
  } else {
    msg += `  • Đang giữ SHORT ➔ <b>TIẾP TỤC GỒNG LÃI THEO SÓNG GIẢM!</b>\n`;
    msg += `  • Đang giữ LONG ➔ <b>CẮT LỖ KHẨN CẤP / THOÁT VỊ THẾ BẢO TOÀN VỐN!</b>\n`;
    msg += `  • Chưa có lệnh ➔ Thuận theo đà giảm, canh nhịp hồi kỹ thuật để Short, <b>CẤM BẮT ĐÁY LONG!</b>\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>⚡ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

  console.log(`   🚀 [Tape Engine] Phát hiện Gia tốc dồn dập ${isLong ? 'LONG' : 'SHORT'}: ${priceDelta}đ trong ${secondInBar}s, Vol: ${accumulatedVol}`);
  await sendDerivativesMessage(msg);
}

// ─── 1B. LOGIC BẪY ĐẢO MÀU PHÚT CHÓT (FLIP) ─────────────────
async function checkLastSecondFlip(secondInBar, accumulatedVol, priceDelta, currentPrice) {
  const now = Date.now();
  if (now - _state.lastFlipAlertTime < COOLDOWN_FLIP_MS) return;

  const earlyTicks = _state.intraTicks.filter(t => t.sec <= FLIP_FIRST_PERIOD_SECONDS && t.color !== 'NEUTRAL');
  if (earlyTicks.length < 4) return;

  const redEarlyCount = earlyTicks.filter(t => t.color === 'RED').length;
  const greenEarlyCount = earlyTicks.filter(t => t.color === 'GREEN').length;
  const totalEarly = earlyTicks.length;

  const wasPredominantlyRed = (redEarlyCount / totalEarly) >= 0.70;
  const wasPredominantlyGreen = (greenEarlyCount / totalEarly) >= 0.70;

  const earlyPrices = earlyTicks.map(t => t.price);
  const minEarlyPrice = Math.min(...earlyPrices);
  const maxEarlyPrice = Math.max(...earlyPrices);

  const isRedToGreenFlip = wasPredominantlyRed && priceDelta >= 0.2 && (currentPrice - minEarlyPrice >= FLIP_MIN_REVERSAL_PTS);
  const isGreenToRedFlip = wasPredominantlyGreen && priceDelta <= -0.2 && (maxEarlyPrice - currentPrice >= FLIP_MIN_REVERSAL_PTS);

  if (!isRedToGreenFlip && !isGreenToRedFlip) return;

  _state.hasFiredFlipThisBar = true;
  _state.lastFlipAlertTime = now;

  const timeStr = getVnTimeHHMMSS();
  let msg = `⚠️ <b>[CẢNH BÁO BẪY ĐẢO MÀU PHÚT CHÓT] NẾN LẬT MÀU GIÂY CUỐI!</b>\n`;
  msg += `🕐 <i>${timeStr} | F1M: <b>${currentPrice.toFixed(1)}</b></i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (isRedToGreenFlip) {
    const rebound = (currentPrice - minEarlyPrice).toFixed(1);
    msg += `🔄 <b>DIỄN BIẾN BẺ LÁI TRONG NẾN:</b>\n`;
    msg += `  • 40s đầu nến: Phủ màu <b>🔴 ĐỎ</b> đè bán ép về thấp nhất <b>${minEarlyPrice.toFixed(1)}</b>\n`;
    msg += `  • 15s cuối nến: Bất ngờ có lực gom quét thốc ngược lên đóng <b>🟢 XANH @ ${currentPrice.toFixed(1)}</b>!\n`;
    msg += `  • Tốc độ giật ngược: <b>+${rebound}đ</b> từ đáy nến trong tích tắc!\n\n`;

    msg += `🧠 <b>GIẢI MÃ TẠO LẬP & CUNG CẦU:</b>\n`;
    msg += `  👉 <b>BẪY QUÉT SHORT / CAO TRÀO BÁN BỊ HẤP THỤ SẠCH:</b> Phe Short bị dụ bán tháo ở đáy nến (FOMO Short trap), sau đó tạo lập quét ngược gom sạch hàng để ép Short cắt lỗ (Short Squeeze).\n\n`;

    msg += `📋 <b>HÀNH ĐỘNG CỦA SENIOR TRADER:</b>\n`;
    msg += `  • <b>TUYỆT ĐỐI CẤM SHORT ĐUỔI!</b> Cực kỳ dễ dính bẫy rút chân của Lái.\n`;
    msg += `  • Đang giữ Short ➔ <b>CÂN NHẮC CHỐT LÃI HOẶC DỜI CHẶN LÃI HÒA VỐN!</b>\n`;
    msg += `  • Đứng ngoài ➔ Chờ nến tiếp theo xác nhận, không hấp tấp vào lệnh trong nến bẫy!\n`;
  } else {
    const dump = (maxEarlyPrice - currentPrice).toFixed(1);
    msg += `🔄 <b>DIỄN BIẾN BẺ LÁI TRONG NẾN:</b>\n`;
    msg += `  • 40s đầu nến: Phủ màu <b>🟢 XANH</b> kéo tăng lên cao nhất <b>${maxEarlyPrice.toFixed(1)}</b>\n`;
    msg += `  • 15s cuối nến: Bất ngờ dội xả đạp gãy thủng nền đóng <b>🔴 ĐỎ @ ${currentPrice.toFixed(1)}</b>!\n`;
    msg += `  • Tốc độ tụt dốc: <b>-${dump}đ</b> từ đỉnh nến trong tích tắc!\n\n`;

    msg += `🧠 <b>GIẢI MÃ TẠO LẬP & CUNG CẦU:</b>\n`;
    msg += `  👉 <b>BẪY BULL TRAP / KÉO XẢ CHẶN ĐẦU:</b> Lái kéo mồi nhử con mồi đu Long (FOMO Long trap) rồi bất ngờ xả hàng giá cao, úp bô giây cuối.\n\n`;

    msg += `📋 <b>HÀNH ĐỘNG CỦA SENIOR TRADER:</b>\n`;
    msg += `  • <b>TUYỆT ĐỐI CẤM ĐU LONG!</b> Rủi ro dính bẫy bull-trap đứt gãy.\n`;
    msg += `  • Đang giữ Long ➔ <b>HẠ TỶ TRỌNG NGAY HOẶC KHÓA LÃI!</b>\n`;
    msg += `  • Đứng ngoài ➔ Chờ nhịp kiểm tra xác nhận, bảo toàn vị thế!\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

  console.log(`   ⚠️ [Tape Engine] Phát hiện Bẫy lật màu giây cuối: ${isRedToGreenFlip ? 'ĐỎ->XANH' : 'XANH->ĐỎ'} @ ${currentPrice}`);
  await sendDerivativesMessage(msg);
}

// ─── 2. CANDLE CLOSED HANDLER (XỬ LÝ KHI NẾN 1 PHÚT ĐÓNG) ─────
/**
 * Gọi từ processNewCandle() trong volumeScalper.js khi 1 nến 1p đóng hoàn chỉnh
 * ÁP DỤNG QUY TẮC BẢO VỆ 3 NẾN LIỀN KỀ & ĐÁNH GIÁ VỊ TRÍ KHUNG NGÀY
 * @param {Object} candle Nến vừa đóng hoàn chỉnh
 * @param {Array} allCandles Danh sách nến đã đóng trong phiên
 * @param {Object} oiData Dữ liệu OI từ dataFetcher
 * @param {Object} extraData Dữ liệu phụ trợ (liquidityInfo, etc.)
 */
async function onCandleClosed(candle, allCandles, oiData, extraData = {}) {
  if (!isCurrentInstanceActive()) return;
  if (!isMonitoringHours()) return;
  if (!candle || !allCandles || allCandles.length < 5) return;

  const now = Date.now();
  const timeStr = getVnTimeHHMMSS();
  const currentHHMM = getVnTimeHHMM();

  // Phân tích vị trí trong khung ngày và bối cảnh khung giờ
  const location = analyzeDayLocation(candle, allCandles);
  const session = analyzeSessionContext(currentHHMM);

  const liquidityInfo = extraData.liquidityInfo || null;
  const isHighLiquidity = liquidityInfo ? !liquidityInfo.isLowLiquidity : false;
  const liquidityLabel = isHighLiquidity
    ? '🔥 THANH KHOẢN TỐT (≥ 16k tỷ) — Nguy cơ Big Trend'
    : '💧 THANH KHOẢN THẤP (< 16k tỷ) — Ưu tiên Sideway biên';

  // ═════════════════════════════════════════════════════════════
  // PHẦN A: XỬ LÝ CÁC PENDING SETUP ĐANG QUAN SÁT (NẾN 2 VÀ NẾN 3)
  // ═════════════════════════════════════════════════════════════
  if (_state.pendingSetups.length > 0) {
    const activeSetup = _state.pendingSetups[0];

    // ─── BƯỚC 2: QUAN SÁT NẾN 2 (RETEST BAR) ───
    if (activeSetup.step === 1) {
      if (activeSetup.type === 'PEAK_REJECTION') {
        const bar1High = activeSetup.bar1.high;

        // KỊCH BẢN 2A: PHỦ ĐỊNH — NẾN 2 VƯỢT ĐỈNH (BULL CONTINUATION)
        if (candle.high > bar1High + 0.3) {
          let msg = `❌ <b>[VÔ HIỆU HÓA BẪY ĐỈNH] NẾN 2 VƯỢT ĐỈNH — ĐÀ TĂNG TIẾP DIỄN!</b>\n`;
          msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

          msg += `📊 <b>KẾT QUẢ QUAN SÁT CÂY NẾN THỨ 2:</b>\n`;
          msg += `  • Đỉnh Nến 1: <b>${bar1High.toFixed(1)}</b> (cú rút râu trước đó)\n`;
          msg += `  • Nến 2 Retest: Vượt đỉnh lên <b>${candle.high.toFixed(1)}</b> (+${(candle.high - bar1High).toFixed(1)}đ)!\n`;
          msg += `  • Đóng nến 2: <b>${candle.isGreen ? '🟢 XANH' : '🔴 Đỏ'} @ ${candle.close.toFixed(1)}</b> | Vol: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

          msg += `🧠 <b>GIẢI MÃ SENIOR TRADER:</b>\n`;
          msg += `  👉 Cú rút râu của Nến 1 chỉ là <b>nhịp nghỉ / chốt lời tạm thời</b> của sóng tăng. Cầu mua gom dồi dào đã đẩy nến 2 vượt đỉnh, xu hướng tăng tiếp diễn!\n`;
          msg += `  🛡️ <i>Kỷ luật 3 nến: Tuyệt đối không mở Short chặn đầu khi chưa có xác nhận đã bảo vệ bạn không bị bỏ rơi âm nặng tài khoản!</i>\n\n`;

          msg += `📋 <b>HÀNH ĐỘNG:</b>\n`;
          msg += `  • <b>TIẾP TỤC BẢO TOÀN VỊ THẾ LONG</b> nếu đang có hàng sẵn.\n`;
          msg += `  • <b>TUYỆT ĐỐI CẤM SHORT CẢN TÀU!</b> Chờ cấu trúc rõ ràng hơn.\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

          console.log(`   ❌ [Tape Engine] Vô hiệu hóa bẫy đỉnh: Nến 2 vượt đỉnh ${bar1High} -> ${candle.high}`);
          await sendDerivativesMessage(msg);
          _state.pendingSetups = [];
          return;
        } else {
          // KỊCH BẢN 2B: NẾN 2 RETEST THẤT BẠI (HẠ ĐỈNH VI MÔ) -> CHUYỂN BƯỚC 3
          activeSetup.bar2 = candle;
          activeSetup.step = 2;
          console.log(`   ⏱️ [Tape Engine] Setup Đỉnh: Nến 2 retest không qua đỉnh (${candle.high} <= ${bar1High}). Chờ nến 3 xác nhận.`);
          return;
        }
      } else if (activeSetup.type === 'TROUGH_ABSORPTION') {
        const bar1Low = activeSetup.bar1.low;

        // KỊCH BẢN 2A: PHỦ ĐỊNH — NẾN 2 THỦNG ĐÁY (BEAR CONTINUATION)
        if (candle.low < bar1Low - 0.3) {
          let msg = `❌ <b>[VÔ HIỆU HÓA TẠO ĐÁY] NẾN 2 THỦNG ĐÁY — ĐÀ XẢ TIẾP DIỄN!</b>\n`;
          msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

          msg += `📊 <b>KẾT QUẢ QUAN SÁT CÂY NẾN THỨ 2:</b>\n`;
          msg += `  • Đáy Nến 1: <b>${bar1Low.toFixed(1)}</b> (cú rút chân trước đó)\n`;
          msg += `  • Nến 2 Retest: Đè thủng đáy về <b>${candle.low.toFixed(1)}</b> (-${(bar1Low - candle.low).toFixed(1)}đ)!\n`;
          msg += `  • Đóng nến 2: <b>🔴 ĐỎ @ ${candle.close.toFixed(1)}</b> | Vol: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

          msg += `🧠 <b>GIẢI MÃ SENIOR TRADER:</b>\n`;
          msg += `  👉 Cú rút chân nến 1 chỉ là <b>bẫy nảy hồi kỹ thuật yếu ớt (Dead-cat bounce)</b>. Cung bán tháo vẫn áp đảo đè thủng đáy.\n`;
          msg += `  🛡️ <i>Kỷ luật 3 nến: Tuyệt đối không bắt dao rơi Long khi chưa đủ 3 nến xác nhận đã giúp bạn tránh bị kẹp Long âm 20-30đ!</i>\n\n`;

          msg += `📋 <b>HÀNH ĐỘNG:</b>\n`;
          msg += `  • <b>TIẾP TỤC NẮM GIỮ SHORT</b> nếu đang có vị thế Short.\n`;
          msg += `  • <b>TUYỆT ĐỐI CẤM BẮT ĐÁY LONG!</b> Sóng giảm vẫn đang làm chủ.\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

          console.log(`   ❌ [Tape Engine] Vô hiệu hóa bẫy đáy: Nến 2 thủng đáy ${bar1Low} -> ${candle.low}`);
          await sendDerivativesMessage(msg);
          _state.pendingSetups = [];
          return;
        } else {
          // KỊCH BẢN 2B: NẾN 2 GIỮ ĐƯỢC ĐÁY (NÂNG ĐÁY VI MÔ) -> CHUYỂN BƯỚC 3
          activeSetup.bar2 = candle;
          activeSetup.step = 2;
          console.log(`   ⏱️ [Tape Engine] Setup Đáy: Nến 2 test đáy thành công (${candle.low} >= ${bar1Low}). Chờ nến 3 xác nhận.`);
          return;
        }
      }
    }

    // ─── BƯỚC 3: QUAN SÁT NẾN 3 (CONFIRMATION BAR) ───
    else if (activeSetup.step === 2) {
      if (activeSetup.type === 'PEAK_REJECTION') {
        const bar1High = activeSetup.bar1.high;
        const bar2High = activeSetup.bar2.high;
        const confirmCondition = !candle.isGreen && (candle.close < activeSetup.bar2.open || candle.close < activeSetup.bar1.close - 0.3);

        if (candle.high > bar1High + 0.3) {
          // Nến 3 vượt đỉnh -> Phủ định
          _state.pendingSetups = [];
          return;
        }

        if (confirmCondition) {
          // ĐÃ XÁC NHẬN ĐỦ 3 NẾN LIỀN KỀ TẠO ĐỈNH!
          let msg = `🎯 <b>[XÁC NHẬN ĐỦ 3 NẾN LIỀN KỀ] ĐẢO CHIỀU TẠI ĐỈNH XÁC LẬP!</b>\n`;
          msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

          msg += `📊 <b>TỔ HỢP 3 CÂY NẾN ĐẢO CHIỀU HOÀN HẢO:</b>\n`;
          msg += `  • <b>Nến 1:</b> Rút râu từ chối đỉnh cao nhất <b>${bar1High.toFixed(1)}</b> (Vol: ${activeSetup.bar1.volume.toLocaleString()} HĐ)\n`;
          msg += `  • <b>Nến 2:</b> Retest thất bại hạ đỉnh <b>${bar2High.toFixed(1)} < ${bar1High.toFixed(1)}</b> (Cạn cầu)\n`;
          msg += `  • <b>Nến 3:</b> Đóng <b>🔴 ĐỎ XÁC NHẬN @ ${candle.close.toFixed(1)}</b> phá vỡ nền vi mô! (Vol: ${candle.volume.toLocaleString()} HĐ)\n\n`;

          msg += `📍 <b>BỐI CẢNH THỊ TRƯỜNG & KHUNG NGÀY:</b>\n`;
          msg += `  • Vị trí khung ngày: <b>${activeSetup.location.badge}</b>\n`;
          msg += `  • Môi trường: <i>${activeSetup.liquidityLabel}</i>\n`;
          msg += `  • Khung giờ: <i>${activeSetup.session.sessionName}</i>\n\n`;

          msg += `📋 <b>HÀNH ĐỘNG CHUẨN SENIOR TRADER:</b>\n`;
          msg += `  👉 <b>ĐÃ ĐỦ ĐIỀU KIỆN KỶ LUẬT 3 NẾN AN TOÀN ĐỂ HÀNH ĐỘNG:</b>\n`;
          msg += `  • Đang giữ LONG ➔ <b>CHỐT SẠCH LỜI LONG HOẶC HẠ TỶ TRỌNG NGAY!</b>\n`;
          msg += `  • Có thể mở SHORT thăm dò thuận thế hạ đỉnh.\n`;
          msg += `  🛑 <b>Cắt lỗ (SL) tuyệt đối:</b> <b>${(bar1High + 0.5).toFixed(1)}đ</b> (ngay trên đỉnh nến 1, rủi ro SL cực nhỏ chỉ 1.5-2đ)!\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

          console.log(`   🎯 [Tape Engine] XÁC NHẬN ĐỦ 3 NẾN ĐẢO CHIỀU TẠI ĐỈNH @ ${candle.close}`);
          await sendDerivativesMessage(msg);
        } else {
          console.log(`   ⚪ [Tape Engine] Nến 3 không đủ điều kiện xác nhận đảo chiều đỉnh. Hủy setup.`);
        }
        _state.pendingSetups = [];
        return;
      } else if (activeSetup.type === 'TROUGH_ABSORPTION') {
        const bar1Low = activeSetup.bar1.low;
        const bar2Low = activeSetup.bar2.low;
        const confirmCondition = candle.isGreen && (candle.close > activeSetup.bar2.open || candle.close > activeSetup.bar1.close + 0.3);

        if (candle.low < bar1Low - 0.3) {
          // Nến 3 thủng đáy -> Phủ định
          _state.pendingSetups = [];
          return;
        }

        if (confirmCondition) {
          // ĐÃ XÁC NHẬN ĐỦ 3 NẾN LIỀN KỀ TẠO ĐÁY!
          let msg = `🎯 <b>[XÁC NHẬN ĐỦ 3 NẾN LIỀN KỀ] TẠO ĐÁY THỰC SỰ XÁC LẬP!</b>\n`;
          msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

          msg += `📊 <b>TỔ HỢP 3 CÂY NẾN TẠO ĐÁY HOÀN HẢO:</b>\n`;
          msg += `  • <b>Nến 1:</b> Rút chân gom hàng tại đáy <b>${bar1Low.toFixed(1)}</b> (Vol: ${activeSetup.bar1.volume.toLocaleString()} HĐ)\n`;
          msg += `  • <b>Nến 2:</b> Test đáy thành công nâng đáy <b>${bar2Low.toFixed(1)} > ${bar1Low.toFixed(1)}</b> (Cạn cung)\n`;
          msg += `  • <b>Nến 3:</b> Đóng <b>🟢 XANH XÁC NHẬN @ ${candle.close.toFixed(1)}</b> bứt phá nền vi mô! (Vol: ${candle.volume.toLocaleString()} HĐ)\n\n`;

          msg += `📍 <b>BỐI CẢNH THỊ TRƯỜNG & KHUNG NGÀY:</b>\n`;
          msg += `  • Vị trí khung ngày: <b>${activeSetup.location.badge}</b>\n`;
          msg += `  • Môi trường: <i>${activeSetup.liquidityLabel}</i>\n`;
          msg += `  • Khung giờ: <i>${activeSetup.session.sessionName}</i>\n\n`;

          msg += `📋 <b>HÀNH ĐỘNG CHUẨN SENIOR TRADER:</b>\n`;
          msg += `  👉 <b>ĐÃ ĐỦ ĐIỀU KIỆN KỶ LUẬT 3 NẾN AN TOÀN ĐỂ HÀNH ĐỘNG:</b>\n`;
          msg += `  • Đang giữ SHORT ➔ <b>CHỐT SẠCH LÃI SHORT / KHÓA LÃI TOÀN BỘ!</b>\n`;
          msg += `  • Có thể mở LONG thăm dò thuận sóng nâng đáy.\n`;
          msg += `  🛑 <b>Cắt lỗ (SL) tuyệt đối:</b> <b>${(bar1Low - 0.5).toFixed(1)}đ</b> (ngay dưới đáy nến 1, rủi ro SL cực nhỏ chỉ 1.5-2đ)!\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

          console.log(`   🎯 [Tape Engine] XÁC NHẬN ĐỦ 3 NẾN TẠO ĐÁY @ ${candle.close}`);
          await sendDerivativesMessage(msg);
        } else {
          console.log(`   ⚪ [Tape Engine] Nến 3 không đủ điều kiện xác nhận tạo đáy. Hủy setup.`);
        }
        _state.pendingSetups = [];
        return;
      }
    }
  }

  // ═════════════════════════════════════════════════════════════
  // PHẦN B: PHÁT HIỆN SETUP BAR MỚI (NẾN 1 - WATCHLIST / WARNING)
  // ═════════════════════════════════════════════════════════════
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  const recentSlice = allCandles.slice(-6, -1);
  if (recentSlice.length < 3) return;

  const recentHighs = recentSlice.map(c => c.high);
  const recentLows = recentSlice.map(c => c.low);

  const localWaveLow = Math.min(...recentLows);
  const localWaveHigh = Math.max(...recentHighs);
  const waveUpAmplitude = candle.high - localWaveLow;
  const waveDownAmplitude = localWaveHigh - candle.low;

  // ─── KIỂM TRA 3A: DOJI NHẤP NHÁY CÂN BẰNG ───
  if (_state.colorFlipsInMinute >= 3 && body <= 0.3 && Math.abs(upperWick - lowerWick) <= 0.5) {
    if (now - _state.lastDojiAlertTime > COOLDOWN_DOJI_MS) {
      _state.lastDojiAlertTime = now;
      let msg = `⚪ <b>[THỊ TRƯỜNG CÂN BẰNG] DOJI NHẤP NHÁY LƯỠNG LỰ</b>\n`;
      msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

      msg += `⚖️ <b>TRẠNG THÁI GIẰNG CO TRONG PHIÊN:</b>\n`;
      msg += `  • Trong 1 phút: Nến nhấp nháy đảo màu Xanh/Đỏ liên tục (<b>${_state.colorFlipsInMinute} lần</b>)\n`;
      msg += `  • Đóng nến: Mở <b>${candle.open.toFixed(1)}</b> ≈ Đóng <b>${candle.close.toFixed(1)}</b> (Thân: <b>${body.toFixed(1)}đ</b>)\n`;
      msg += `  • Râu trên: <b>${upperWick.toFixed(1)}đ</b> ≈ Râu dưới: <b>${lowerWick.toFixed(1)}đ</b> | Vol: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

      msg += `🧠 <b>Ý NGHĨA KỸ THUẬT:</b>\n`;
      msg += `  👉 Hai phe Mua và Bán giằng co quyết liệt nhưng hoàn toàn triệt tiêu lẫn nhau, chưa bên nào giành được quyền kiểm soát thị trường.\n\n`;

      msg += `📋 <b>HÀNH ĐỘNG CỦA SENIOR TRADER:</b>\n`;
      msg += `  • <b>ĐỨNG NGOÀI QUAN SÁT!</b> Tuyệt đối không giao dịch trong vùng nhiễu giằng co.\n`;
      msg += `  • Kiên nhẫn chờ một cây nến bứt phá có volume dứt khoát xác nhận hướng đi mới.\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

      console.log(`   ⚪ [Tape Engine] Phát hiện Doji nhấp nháy cân bằng @ ${candle.close}`);
      await sendDerivativesMessage(msg);
      return;
    }
  }

  // ─── KIỂM TRA 3B: PHÁT HIỆN NẾN 1 RÚT RÂU TRÊN ĐỈNH (LOCAL WAVE PEAK) ───
  const isAtLocalPeak = (candle.high >= localWaveHigh - 0.3) && (waveUpAmplitude >= WAVE_EXTREME_PTS);
  const isPeakRejection = isAtLocalPeak && (upperWick >= WICK_REJECTION_MIN || (!candle.isGreen && upperWick >= 0.8));

  if (isPeakRejection && (now - _state.lastPeakAlertTime > COOLDOWN_EXTREME_MS)) {
    _state.lastPeakAlertTime = now;

    // Lưu vào Pipeline 3 nến
    _state.pendingSetups = [{
      id: Date.now(),
      type: 'PEAK_REJECTION',
      step: 1,
      bar1: candle,
      bar2: null,
      location,
      session,
      liquidityLabel,
      createdAt: now,
    }];

    let msg = `⚠️ <b>[TÍN HIỆU CÂY 1: RÚT RÂU ĐỈNH] VÀO CHẾ ĐỘ QUAN SÁT 3 NẾN!</b>\n`;
    msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `⛰️ <b>ĐẶC ĐIỂM CÂY NẾN THỨ NHẤT (NẾN 1):</b>\n`;
    msg += `  • Nhịp tăng vừa qua: <b>+${waveUpAmplitude.toFixed(1)}đ</b> (từ ${localWaveLow.toFixed(1)} ➔ ${candle.high.toFixed(1)})\n`;
    msg += `  • Râu trên bị dội bán: <b>${upperWick.toFixed(1)}đ</b> | Đóng nến: <b>${candle.isGreen ? '🟢 Xanh rút râu' : '🔴 ĐỎ BỊ DỘI XẢ'}</b>\n`;
    msg += `  • Khối lượng khớp: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

    msg += `📍 <b>VỊ TRÍ KHUNG NGÀY & BỐI CẢNH:</b>\n`;
    msg += `  • Vị trí: <b>${location.badge}</b>\n`;
    msg += `  • Đánh giá: <i>${location.warning}</i>\n`;
    msg += `  • Môi trường: <b>${liquidityLabel}</b>\n`;
    msg += `  • Khung giờ: <b>${session.sessionName}</b>\n\n`;

    if (!location.isExtremeLocation && isHighLiquidity) {
      msg += `🚨 <b>CẢNH BÁO ĐẶC BIỆT (CHỐNG BẪY ĐU NGƯỢC PHA):</b>\n`;
      msg += `  • Giá đang ở <b>GIỮA CHỪNG</b> trong môi trường thanh khoản lớn! Cú rút râu này rất dễ chỉ là nhịp chốt lời tạm thời để kéo tiếp 20-30đ vào chiều!\n`;
      msg += `  • <b>TUYỆT ĐỐI KHÔNG SHORT ĐU ĐUỔI! CẤM CHẶN ĐẦU TÀU HỎA!</b>\n\n`;
    }

    msg += `🛡️ <b>KỶ LUẬT SENIOR TRADER — CẤM ĐU VÀO LỆNH NGAY CÂY NÀY:</b>\n`;
    msg += `  👉 <b>ĐÂY LÀ CON DAO 2 LƯỠI!</b> Bắt buộc phải quan sát thêm <b>2 CÂY NẾN TIẾP THEO:</b>\n`;
    msg += `  • <b>Nến 2:</b> Quan sát nhịp Retest đỉnh. Nếu vượt đỉnh ➔ Hủy bẫy, trend tăng tiếp diễn!\n`;
    msg += `  • <b>Nến 3:</b> Chờ nến đỏ dứt khoát xác nhận thủng nền vi mô ➔ Lúc đó mới mở lệnh an toàn!\n`;
    msg += `  • Hành động tức thì: <b>CẤM ĐU LONG MUA THÊM</b>, cân nhắc chặn lãi bảo vệ vốn.\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

    console.log(`   ⚠️ [Tape Engine] Phát hiện Nến 1 Peak Rejection @ ${candle.close}. Vào chế độ quan sát 3 nến.`);
    await sendDerivativesMessage(msg);
    return;
  }

  // ─── KIỂM TRA 3C: PHÁT HIỆN NẾN 1 RÚT CHÂN DƯỚI ĐÁY (LOCAL WAVE TROUGH) ───
  const isAtLocalTrough = (candle.low <= localWaveLow + 0.3) && (waveDownAmplitude >= WAVE_EXTREME_PTS);
  const isTroughAbsorption = isAtLocalTrough && (lowerWick >= WICK_REJECTION_MIN || (candle.isGreen && lowerWick >= 0.8));

  if (isTroughAbsorption && (now - _state.lastTroughAlertTime > COOLDOWN_EXTREME_MS)) {
    _state.lastTroughAlertTime = now;

    // Lưu vào Pipeline 3 nến
    _state.pendingSetups = [{
      id: Date.now(),
      type: 'TROUGH_ABSORPTION',
      step: 1,
      bar1: candle,
      bar2: null,
      location,
      session,
      liquidityLabel,
      createdAt: now,
    }];

    let msg = `⚠️ <b>[TÍN HIỆU CÂY 1: RÚT CHÂN ĐÁY] VÀO CHẾ ĐỘ QUAN SÁT 3 NẾN!</b>\n`;
    msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `🌊 <b>ĐẶC ĐIỂM CÂY NẾN THỨ NHẤT (NẾN 1):</b>\n`;
    msg += `  • Nhịp giảm vừa qua: <b>-${waveDownAmplitude.toFixed(1)}đ</b> (từ ${localWaveHigh.toFixed(1)} ➔ ${candle.low.toFixed(1)})\n`;
    msg += `  • Râu dưới hấp thụ: <b>${lowerWick.toFixed(1)}đ</b> | Đóng nến: <b>${candle.isGreen ? '🟢 XANH RÚT CHÂN' : '🔴 Đỏ chững đà'}</b>\n`;
    msg += `  • Khối lượng khớp: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

    msg += `📍 <b>VỊ TRÍ KHUNG NGÀY & BỐI CẢNH:</b>\n`;
    msg += `  • Vị trí: <b>${location.badge}</b>\n`;
    msg += `  • Đánh giá: <i>${location.warning}</i>\n`;
    msg += `  • Môi trường: <b>${liquidityLabel}</b>\n`;
    msg += `  • Khung giờ: <b>${session.sessionName}</b>\n\n`;

    if (!location.isExtremeLocation && isHighLiquidity) {
      msg += `🚨 <b>CẢNH BÁO ĐẶC BIỆT (CHỐNG BẮT ĐÁY NGƯỢC PHA):</b>\n`;
      msg += `  • Giá đang ở <b>GIỮA CHỪNG</b> trong môi trường thanh khoản lớn! Cú rút chân này rất dễ chỉ là nảy kỹ thuật tạm thời trước khi xả tiếp 20-30đ vào chiều!\n`;
      msg += `  • <b>TUYỆT ĐỐI KHÔNG BẮT ĐÁY LONG SỚM! CẤM CẢN TÀU BIG SHORT!</b>\n\n`;
    }

    msg += `🛡️ <b>KỶ LUẬT SENIOR TRADER — CẤM ĐU VÀO LỆNH NGAY CÂY NÀY:</b>\n`;
    msg += `  👉 <b>ĐÂY LÀ CON DAO 2 LƯỠI!</b> Bắt buộc phải quan sát thêm <b>2 CÂY NẾN TIẾP THEO:</b>\n`;
    msg += `  • <b>Nến 2:</b> Quan sát nhịp Retest đáy. Nếu thủng đáy ➔ Hủy bẫy, đà xả tiếp diễn!\n`;
    msg += `  • <b>Nến 3:</b> Chờ nến xanh dứt khoát xác nhận bứt phá nền vi mô ➔ Lúc đó mới mở lệnh an toàn!\n`;
    msg += `  • Hành động tức thì: <b>CẤM BÁN ĐÁY SHORT ĐUỔI</b>, cân nhắc chặn lãi Short bảo vệ vốn.\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

    console.log(`   ⚠️ [Tape Engine] Phát hiện Nến 1 Trough Absorption @ ${candle.close}. Vào chế độ quan sát 3 nến.`);
    await sendDerivativesMessage(msg);
    return;
  }
}

// ─── RESET DAILY ─────────────────────────────────────────────
function reset() {
  _state.currentMinuteKey = null;
  _state.barOpenTime = 0;
  _state.barOpenPrice = null;
  _state.barOpenLot = null;
  _state.intraTicks = [];
  _state.colorFlipsInMinute = 0;
  _state.lastTickColor = null;
  _state.hasFiredSurgeThisBar = false;
  _state.hasFiredFlipThisBar = false;
  _state.pendingSetups = [];
  _state.lastSurgeAlertTime = 0;
  _state.lastFlipAlertTime = 0;
  _state.lastPeakAlertTime = 0;
  _state.lastTroughAlertTime = 0;
  _state.lastDojiAlertTime = 0;
  console.log('   🔄 Tape & Volume Acceleration Engine: State reset');
}

function getState() {
  return { ..._state };
}

module.exports = {
  onFastTick,
  onCandleClosed,
  reset,
  getState,
};
