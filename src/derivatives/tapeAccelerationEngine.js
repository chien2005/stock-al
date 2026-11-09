/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ⚡ VN30F — Tape Reading & Volume Acceleration Engine        ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  THEO DÕI GIA TỐC VOLUME, TỐC ĐỘ GIÁ & BĂNG CHUYỀN LỆNH TAPE   ║
 * ║                                                                ║
 * ║  1. GIA TỐC DỒN DẬP (Monochrome Surge / High Velocity Burst):  ║
 * ║     10s-35s đầu nến vol tăng vun vút (≥1500 HĐ hoặc ≥60 HĐ/s),  ║
 * ║     thuần 1 màu xanh hoặc đỏ, biên độ giá dồn dập ≥1.2đ         ║
 * ║     ➔ Lực Long/Short dứt khoát áp đảo, thuận thế đẩy tiếp.     ║
 * ║                                                                ║
 * ║  2. BẪY ĐẢO MÀU PHÚT CHÓT (Last-Second Color Flip / Trap):     ║
 * ║     40s đầu nến phủ 1 màu (đè bán / kéo ảo vol to), nhưng 15s  ║
 * ║     cuối nến bất ngờ giật lật màu ngược lại                    ║
 * ║     ➔ Cao trào bị hấp thụ / Lái giật kill S-L ➔ CẤM ĐUỔI LỆNH. ║
 * ║                                                                ║
 * ║  3. ĐÓNG NẾN RÚT RÂU TẠI CỰC TRỊ SÓNG NGẮN (Local Wave Peak/Low)║
 * ║     • Sau đà tăng dốc ngắn hạn lên đỉnh: rút râu trên ≥1.2đ    ║
 * ║       hoặc nến đóng đỏ vol lớn ➔ CẤM ĐU LONG, NGUY CƠ SẬP.     ║
 * ║     • Sau đà giảm dốc ngắn hạn xuống đáy: rút chân râu dưới    ║
 * ║       ≥1.2đ hoặc đóng xanh dưới đáy ➔ CẤM BÁN ĐÁY, SHORT SQUEEZE║
 * ║     • Doji nhấp nháy xanh đỏ liên tục đóng nến cân bằng        ║
 * ║       ➔ Thị trường giằng co, đứng ngoài quan sát.              ║
 * ║                                                                ║
 * ║  4. Khung giờ giám sát ngầm liên tục:                          ║
 * ║     Sáng: 09h00 - 11h30 | Chiều: 13h00 - 14h30                 ║
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

// ─── 1. FAST TICK HANDLER (XỬ LÝ MỖI 5 GIÂY) ────────────────
/**
 * Gọi từ fastTickCycle() trong volumeScalper.js mỗi 5 giây
 * @param {Object} tick { price, lot, prevPrice, high, low, time }
 */
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

  // Nếu chưa có barOpenPrice hoặc barOpenLot
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

  // Kiểm tra nến có thuần 1 màu không (không nhấp nháy cản)
  const nonNeutralTicks = _state.intraTicks.filter(t => t.color !== 'NEUTRAL');
  if (nonNeutralTicks.length < 2) return;

  const targetColor = priceDelta > 0 ? 'GREEN' : 'RED';
  const matchingTicks = nonNeutralTicks.filter(t => t.color === targetColor);
  const colorConsistency = matchingTicks.length / nonNeutralTicks.length;

  // Độ thuần nhất màu >= 85%
  if (colorConsistency < 0.85) return;

  // ĐÃ XÁC NHẬN GIA TỐC DỒN DẬP!
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

  // Lấy các tick trong 40s đầu nến
  const earlyTicks = _state.intraTicks.filter(t => t.sec <= FLIP_FIRST_PERIOD_SECONDS && t.color !== 'NEUTRAL');
  if (earlyTicks.length < 4) return;

  const redEarlyCount = earlyTicks.filter(t => t.color === 'RED').length;
  const greenEarlyCount = earlyTicks.filter(t => t.color === 'GREEN').length;
  const totalEarly = earlyTicks.length;

  const wasPredominantlyRed = (redEarlyCount / totalEarly) >= 0.70;
  const wasPredominantlyGreen = (greenEarlyCount / totalEarly) >= 0.70;

  // Tìm mức giá cực trị trong 40s đầu
  const earlyPrices = earlyTicks.map(t => t.price);
  const minEarlyPrice = Math.min(...earlyPrices);
  const maxEarlyPrice = Math.max(...earlyPrices);

  // Trường hợp 1: Đầu nến ĐỎ ép giá sâu, nhưng giây cuối bị quét thốc lên XANH
  const isRedToGreenFlip = wasPredominantlyRed && priceDelta >= 0.2 && (currentPrice - minEarlyPrice >= FLIP_MIN_REVERSAL_PTS);

  // Trường hợp 2: Đầu nến XANH kéo giá cao, nhưng giây cuối bị dập sập xuống ĐỎ
  const isGreenToRedFlip = wasPredominantlyGreen && priceDelta <= -0.2 && (maxEarlyPrice - currentPrice >= FLIP_MIN_REVERSAL_PTS);

  if (!isRedToGreenFlip && !isGreenToRedFlip) return;

  // ĐÃ XÁC NHẬN BẪY LẬT MÀU GIÂY CUỐI!
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
 * @param {Object} candle Nến vừa đóng hoàn chỉnh
 * @param {Array} allCandles Danh sách nến đã đóng trong phiên
 * @param {Object} oiData Dữ liệu OI từ dataFetcher
 */
async function onCandleClosed(candle, allCandles, oiData) {
  if (!isCurrentInstanceActive()) return;
  if (!isMonitoringHours()) return;
  if (!candle || !allCandles || allCandles.length < 5) return;

  const now = Date.now();
  const timeStr = getVnTimeHHMMSS();

  // Tính râu nến và thân nến
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  // Lấy 5 nến gần nhất trước cây này để xác định xu hướng sóng ngắn (Local Wave)
  const recentSlice = allCandles.slice(-6, -1);
  if (recentSlice.length < 3) return;

  const recentCloses = recentSlice.map(c => c.close);
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

  // ─── KIỂM TRA 3B: RÚT RÂU TRÊN ĐỈNH SAU ĐÀ TĂNG DỐC (LOCAL WAVE PEAK) ───
  // Điều kiện: Vừa có nhịp tăng >= 2.5đ, nến hiện tại ở đỉnh sóng, xuất hiện râu trên dài hoặc đóng nến đỏ
  const isAtLocalPeak = (candle.high >= localWaveHigh - 0.3) && (waveUpAmplitude >= WAVE_EXTREME_PTS);
  const isPeakRejection = isAtLocalPeak && (upperWick >= WICK_REJECTION_MIN || (!candle.isGreen && upperWick >= 0.8));

  if (isPeakRejection && (now - _state.lastPeakAlertTime > COOLDOWN_EXTREME_MS)) {
    _state.lastPeakAlertTime = now;
    let msg = `🔴 <b>[CẢN TRỞ ĐÀ TĂNG TRÊN ĐỈNH] RÚT RÂU BỊ DỘI BÁN VOL LỚN!</b>\n`;
    msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `⛰️ <b>VỊ TRÍ: ĐỈNH NHỊP TĂNG NGẮN HẠN (Local Wave Peak):</b>\n`;
    msg += `  • Biên độ nhịp tăng vừa qua: <b>+${waveUpAmplitude.toFixed(1)}đ</b> (từ ${localWaveLow.toFixed(1)} ➔ ${candle.high.toFixed(1)})\n`;
    msg += `  • Hành vi nến tại đỉnh: Nhấp nháy cản, xuất hiện <b>Râu trên dài ${upperWick.toFixed(1)}đ</b>\n`;
    msg += `  • Đóng nến: <b>${candle.isGreen ? '🟢 Xanh rút râu cản' : '🔴 ĐỎ BỊ DỘI XẢ'}</b> | Vol: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

    msg += `🧠 <b>GIẢI MÃ TÂM LÝ & DÒNG TIỀN:</b>\n`;
    msg += `  👉 Lực mua đu Long bị chặn đứng tại vùng cản ngắn hạn. Phe Bán dội hàng phân phối mạnh khiến nến không giữ được đỉnh, đà tăng suy yếu rõ rệt!\n\n`;

    msg += `📋 <b>HÀNH ĐỘNG CỦA SENIOR TRADER:</b>\n`;
    msg += `  • <b>TUYỆT ĐỐI CẤM MUA ĐU LONG TRÊN ĐỈNH!</b> Tránh bẫy đu đỉnh giá cao.\n`;
    msg += `  • Đang giữ LONG ➔ <b>CHỐT LỜI NGAY / KHÓA LÃI BẢO TOÀN THÀNH QUẢ!</b>\n`;
    msg += `  • Canh nhịp kiểm tra lại (retest) hoặc chờ xác nhận đảo chiều để mở SHORT!\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

    console.log(`   🔴 [Tape Engine] Phát hiện Rút râu cản đỉnh Local Peak: Râu trên ${upperWick}đ, Vol: ${candle.volume}`);
    await sendDerivativesMessage(msg);
    return;
  }

  // ─── KIỂM TRA 3C: RÚT CHÂN DƯỚI ĐÁY SAU ĐÀ GIẢM DỐC (LOCAL WAVE TROUGH) ───
  // Điều kiện: Vừa có nhịp giảm >= 2.5đ, nến hiện tại ở đáy sóng, xuất hiện râu dưới dài hoặc đóng nến xanh
  const isAtLocalTrough = (candle.low <= localWaveLow + 0.3) && (waveDownAmplitude >= WAVE_EXTREME_PTS);
  const isTroughAbsorption = isAtLocalTrough && (lowerWick >= WICK_REJECTION_MIN || (candle.isGreen && lowerWick >= 0.8));

  if (isTroughAbsorption && (now - _state.lastTroughAlertTime > COOLDOWN_EXTREME_MS)) {
    _state.lastTroughAlertTime = now;
    let msg = `🟢 <b>[CẦU HẤP THỤ ĐÁY] RÚT CHÂN SAU PHA ĐẠP VOL LỚN!</b>\n`;
    msg += `🕐 <i>${timeStr} | F1M: <b>${candle.close.toFixed(1)}</b></i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `🌊 <b>VỊ TRÍ: ĐÁY NHỊP GIẢM NGẮN HẠN (Local Wave Trough):</b>\n`;
    msg += `  • Biên độ nhịp giảm vừa qua: <b>-${waveDownAmplitude.toFixed(1)}đ</b> (từ ${localWaveHigh.toFixed(1)} ➔ ${candle.low.toFixed(1)})\n`;
    msg += `  • Hành vi nến tại đáy: Xuất hiện <b>Râu dưới dài ${lowerWick.toFixed(1)}đ</b> gom hàng\n`;
    msg += `  • Đóng nến: <b>${candle.isGreen ? '🟢 XANH RÚT CHÂN HẤP THỤ' : '🔴 Đỏ chững đà giảm'}</b> | Vol: <b>${candle.volume.toLocaleString()} HĐ</b>\n\n`;

    msg += `🧠 <b>GIẢI MÃ TÂM LÝ & DÒNG TIỀN:</b>\n`;
    msg += `  👉 Sau pha Short xả mạnh vol lớn, lực bán đã bị hấp thụ hoàn toàn tại vùng đáy ngắn hạn. Dòng tiền gom đỡ giá quyết liệt, nguy cơ nảy sóng hồi (Short Squeeze) rất cao!\n\n`;

    msg += `📋 <b>HÀNH ĐỘNG CỦA SENIOR TRADER:</b>\n`;
    msg += `  • <b>TUYỆT ĐỐI CẤM BÁN ĐÁY / CẤM SHORT ĐUỔI!</b> Tránh bẫy bán đúng đáy.\n`;
    msg += `  • Đang giữ SHORT ➔ <b>CHỐT LỜI NGAY / KHÓA LÃI!</b>\n`;
    msg += `  • Đề phòng nhịp bật hồi kỹ thuật quét thủng các lệnh Short đuổi muộn!\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<i>🛡️ Tape & Acceleration Engine | Senior Trader v6.0</i>`;

    console.log(`   🟢 [Tape Engine] Phát hiện Cầu hấp thụ đáy Local Trough: Râu dưới ${lowerWick}đ, Vol: ${candle.volume}`);
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
