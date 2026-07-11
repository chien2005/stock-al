/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     🚨 VN STOCK BOT - Alert Service v2.0 (Smart Money)       ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Cảnh báo giao dịch THÔNG MINH — tư duy như quỹ đầu tư      ║
 * ║  KHÔNG dùng AI — phát hiện pattern, gửi thẳng Telegram       ║
 * ║                                                               ║
 * ║  📡 Poll VPS API mỗi 3 phút (9:15 - 14:45 T2-T6)           ║
 * ║  🧠 Smart Filters:                                           ║
 * ║    - Wash trading detection (lọc giao dịch ảo)               ║
 * ║    - Adaptive threshold (ngưỡng riêng mỗi mã)               ║
 * ║    - Accumulation/Distribution streak detection               ║
 * ║    - Max 3 alert/mã/ngày (trừ HIGH priority)                 ║
 * ║    - Cooldown 30 phút giữa 2 alert cùng loại                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');

const VPS_API = {
  realtime: 'https://bgapidatafeed.vps.com.vn/getliststockdata',
  history: 'https://histdatafeed.vps.com.vn/tradingview/history',
};
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── THRESHOLDS ─────────────────────────────────────────────
const THRESHOLDS = {
  foreignNetChange: 30000,   // NN ròng thay đổi > 30K CP / 3 phút
  foreignNetTotal: 80000,    // NN ròng tổng ngày > 80K CP
  foreignVsSMA20: 0.05,      // Lệnh gom NN > 5% KLTB20 phiên → bất thường
  volumeVsSMA20: 1.5,        // KL ngày vượt 150% SMA20 → alert
  priceChangePct: 3.0,       // Giá biến động > 3%
  nearCeilingFloor: 0.5,     // Gần trần/sàn < 0.5%

  // Cảnh báo giao dịch cho tất cả (tay to, quỹ, nhà nước...)
  totalVolume3MinPct: 0.08,  // Tổng KL khớp 3 phút > 8% KLTB20 → bất thường
  totalVolume3MinMin: 50000, // Hoặc ít nhất 50K CP

  // ─── SMART THRESHOLDS (v2.0) ──────────────────────────────
  // Ngưỡng giá trị ADAPTIVE thay vì cứng 5 tỷ
  alertMinValueFloor: 2e9,   // Ngưỡng sàn: tối thiểu 2 tỷ VND
  alertMinValuePct: 0.03,    // 3% giá trị GD trung bình ngày → ngưỡng alert
  bigTradeMinValue: 10e9,    // Giao dịch lớn (bất kỳ NĐT nào) >= 10 tỷ VND

  // Wash trading detection
  washFlipMax: 3,            // NN ròng đổi chiều > 3 lần/ngày → wash trading
  washPriceRange: 0.3,       // Giá dao động < 0.3% = stagnant (wash trading indicator)
  washMultiplier: 3,         // Nhân ngưỡng alert lên 3x khi phát hiện wash trading

  // Smart Money pattern (streak detection)
  streakMinChecks: 3,        // Cần ít nhất 3 poll liên tiếp cùng chiều
  accumulationMaxPriceMove: 1.0,  // Giá chỉ dao động ±1% = gom âm thầm
  distributionMinPriceDrop: 1.0,  // Giá giảm > 1% = xả mạnh

  // Alert limits
  maxAlertsPerSymbol: 3,     // Tối đa 3 noti/mã/ngày (trừ HIGH priority)
};

// ─── STATE ──────────────────────────────────────────────────
let _pollInterval = null;
let _previousData = {};       // { symbol: { foreignNet, volume, ... } }
let _alertedToday = {};       // { "VCB_foreign_buy": timestamp }
let _avgVolumes = {};         // { symbol: avgVolume } - KLTB 20 phiên
let _avgDailyValues = {};     // { symbol: avgDailyValue } - GT GD TB ngày (VND)
let _volumeAlerted = {};      // { symbol: true } - đã alert KL vượt SMA20 hôm nay
let _alertCountToday = {};    // { symbol: count } - số alert trong ngày mỗi mã

// ─── SMART MONEY STATE (v2.0) ────────────────────────────────
let _washTradingFlags = {};   // { symbol: { flipCount, lastSign } } - đếm đổi chiều
let _streakData = {};         // { symbol: { direction, count, totalDelta } } - streak tracking

const ALERT_COOLDOWN = 30 * 60 * 1000; // 30 phút giữa 2 alert cùng loại/mã (tăng từ 15)

// ─── MAIN ───────────────────────────────────────────────────

function startAlertMonitor() {
  const POLL_INTERVAL = 3 * 60 * 1000; // 3 phút

  console.log('🚨 Alert Monitor v2.0 (Smart Money) khởi động');
  console.log(`   📡 Poll mỗi 3 phút | ${config.stockSymbols.length} mã`);
  console.log(`   🧠 Wash trading filter | Adaptive threshold | Streak detection`);
  console.log(`   🔒 Cooldown: 30 phút | Max: ${THRESHOLDS.maxAlertsPerSymbol} alert/mã/ngày`);

  // Lấy KLTB20 phiên trước, rồi poll lần đầu
  loadAvgVolumes().then(() => {
    pollAndCheck(true);
  });

  _pollInterval = setInterval(() => {
    if (isTradingHours()) {
      pollAndCheck(false);
    }
  }, POLL_INTERVAL);
}

function stopAlertMonitor() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
    console.log('🚨 Alert Monitor đã dừng');
  }
}

function resetDailyData() {
  _previousData = {};
  _alertedToday = {};
  _volumeAlerted = {};
  _alertCountToday = {};
  _washTradingFlags = {};
  _streakData = {};
  // Reload avg volumes mỗi ngày mới
  loadAvgVolumes();
  console.log('🚨 Alert v2.0: Reset data đầu ngày');
}

function isTradingHours() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  const day = vnTime.getDay();
  if (day < 1 || day > 5) return false;
  const t = vnTime.getHours() * 100 + vnTime.getMinutes();
  return (t >= 915 && t <= 1130) || (t >= 1300 && t <= 1445);
}

// ─── LOAD KLTB 20 PHIÊN ────────────────────────────────────

async function loadAvgVolumes() {
  console.log('🚨 Đang tải KLTB 20 phiên + GT GD TB ngày...');
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * 40; // 40 ngày để đủ 20 phiên giao dịch

  for (const symbol of config.stockSymbols) {
    try {
      const url = `${VPS_API.history}?symbol=${symbol}&resolution=D&from=${from}&to=${now}`;
      const res = await axios.get(url, { headers: HEADERS, timeout: 8000 });
      const data = res.data;

      if (data && data.v && data.v.length >= 20) {
        const last20 = data.v.slice(-20);
        _avgVolumes[symbol] = Math.round(last20.reduce((s, v) => s + v, 0) / 20);

        // Tính GT GD TB ngày = KLTB20 × giá đóng cửa gần nhất × 1000
        if (data.c && data.c.length > 0) {
          const lastClose = data.c[data.c.length - 1] * 1000;
          _avgDailyValues[symbol] = _avgVolumes[symbol] * lastClose;
        }
      } else if (data && data.v && data.v.length > 0) {
        _avgVolumes[symbol] = Math.round(data.v.reduce((s, v) => s + v, 0) / data.v.length);
        if (data.c && data.c.length > 0) {
          const lastClose = data.c[data.c.length - 1] * 1000;
          _avgDailyValues[symbol] = _avgVolumes[symbol] * lastClose;
        }
      }
    } catch (e) {
      // Silent
    }
  }

  const loaded = Object.keys(_avgVolumes).length;
  console.log(`   ✅ KLTB20: ${loaded}/${config.stockSymbols.length} mã`);
  if (loaded > 0) {
    const samples = Object.entries(_avgVolumes).slice(0, 4).map(([s, v]) => `${s}:${fmtVol(v)}`).join(', ');
    console.log(`   📊 VD: ${samples}`);
    const thresholdSamples = Object.entries(_avgDailyValues).slice(0, 4)
      .map(([s, v]) => `${s}:${fmtValue(getAdaptiveMinValue(s))}`)
      .join(', ');
    console.log(`   🧠 Ngưỡng adaptive: ${thresholdSamples}`);
  }
}

// ─── ADAPTIVE THRESHOLD ─────────────────────────────────────

/**
 * Tính ngưỡng alert riêng cho mỗi mã
 * = max(GT GD TB ngày × 3%, sàn 2 tỷ VND)
 */
function getAdaptiveMinValue(symbol) {
  const avgDaily = _avgDailyValues[symbol] || 0;
  const dynamicThreshold = avgDaily * THRESHOLDS.alertMinValuePct;
  return Math.max(dynamicThreshold, THRESHOLDS.alertMinValueFloor);
}

// ─── WASH TRADING DETECTION ─────────────────────────────────

/**
 * Phát hiện wash trading: NN ròng đổi chiều liên tục + giá không nhúc nhích
 */
function updateWashTradingState(symbol, foreignNet, changePct) {
  if (!_washTradingFlags[symbol]) {
    _washTradingFlags[symbol] = { flipCount: 0, lastSign: 0 };
  }

  const state = _washTradingFlags[symbol];
  const currentSign = foreignNet > 0 ? 1 : foreignNet < 0 ? -1 : 0;

  if (state.lastSign !== 0 && currentSign !== 0 && currentSign !== state.lastSign) {
    state.flipCount++;
  }
  state.lastSign = currentSign;

  return state.flipCount >= THRESHOLDS.washFlipMax
    && Math.abs(changePct) < THRESHOLDS.washPriceRange;
}

/**
 * Lấy multiplier cho ngưỡng alert (wash trading → nhân 3x)
 */
function getAlertMultiplier(symbol) {
  const state = _washTradingFlags[symbol];
  if (state && state.flipCount >= THRESHOLDS.washFlipMax) {
    return THRESHOLDS.washMultiplier;
  }
  return 1;
}

// ─── SMART MONEY STREAK DETECTION ───────────────────────────

/**
 * Theo dõi streak: NN ròng cùng chiều liên tiếp
 * 3+ mua liên tiếp + giá ổn = GOM ÂM THẦM
 * 3+ bán liên tiếp + giá giảm = XẢ MẠNH CÓ CHỦ ĐÍCH
 */
function updateStreakData(symbol, fnDelta, changePct) {
  if (!_streakData[symbol]) {
    _streakData[symbol] = { direction: 0, count: 0, totalDelta: 0 };
  }

  const streak = _streakData[symbol];
  const direction = fnDelta > 0 ? 1 : fnDelta < 0 ? -1 : 0;

  if (direction === 0) return null;

  if (direction === streak.direction) {
    streak.count++;
    streak.totalDelta += fnDelta;
  } else {
    streak.direction = direction;
    streak.count = 1;
    streak.totalDelta = fnDelta;
  }

  if (streak.count >= THRESHOLDS.streakMinChecks) {
    if (streak.direction > 0 && Math.abs(changePct) <= THRESHOLDS.accumulationMaxPriceMove) {
      return 'ACCUMULATION';
    }
    if (streak.direction < 0 && changePct <= -THRESHOLDS.distributionMinPriceDrop) {
      return 'DISTRIBUTION';
    }
  }

  return null;
}

// ─── CHECK ALERT LIMIT PER SYMBOL ───────────────────────────

function canAlertSymbol(symbol, priority) {
  if (priority === 'HIGH') return true;
  const count = _alertCountToday[symbol] || 0;
  return count < THRESHOLDS.maxAlertsPerSymbol;
}

function incrementAlertCount(symbol) {
  _alertCountToday[symbol] = (_alertCountToday[symbol] || 0) + 1;
}

// ─── POLL & CHECK ───────────────────────────────────────────

async function pollAndCheck(isFirstPoll) {
  try {
    const symbols = config.stockSymbols;
    const res = await axios.get(`${VPS_API.realtime}/${symbols.join(',')}`, {
      headers: HEADERS, timeout: 10000,
    });
    const data = res.data || [];
    if (data.length === 0) return;

    const alerts = [];
    const now = Date.now();

    for (const raw of data) {
      const symbol = raw.sym;
      if (!symbol) continue;

      const price = parseFloat(raw.lastPrice || 0) * 1000;
      const refPrice = parseFloat(raw.r || 0) * 1000;
      const ceilingPrice = parseFloat(raw.c || 0) * 1000;
      const floorPrice = parseFloat(raw.f || 0) * 1000;
      const volume = parseInt(raw.lot || 0);
      const foreignBuy = parseInt(raw.fBVol || 0);
      const foreignSell = parseInt(raw.fSVolume || 0);
      const foreignNet = foreignBuy - foreignSell;
      const changePct = refPrice > 0 ? parseFloat(((price - refPrice) / refPrice * 100).toFixed(2)) : 0;

      const prev = _previousData[symbol];
      const avgVol = _avgVolumes[symbol] || 0;
      const cur = { price, refPrice, ceilingPrice, floorPrice, volume, foreignBuy, foreignSell, foreignNet, changePct };

      if (isFirstPoll || !prev) {
        _previousData[symbol] = cur;
        continue;
      }

      // ─── SMART FILTERS (v2.0) ────────────────────────────
      const adaptiveMinValue = getAdaptiveMinValue(symbol);
      const alertMultiplier = getAlertMultiplier(symbol);
      const effectiveMinValue = adaptiveMinValue * alertMultiplier;

      // Update wash trading state
      updateWashTradingState(symbol, foreignNet, changePct);

      // NN ròng thay đổi trong 3 phút
      const fnDelta = foreignNet - prev.foreignNet;

      // Update streak detection
      const smartPattern = updateStreakData(symbol, fnDelta, changePct);

      // ═══ CHECK 1: Smart Money Pattern — GOM ÂM THẦM / XẢ MẠNH ═══
      if (smartPattern && canAlertSymbol(symbol, 'HIGH')) {
        const key = `${symbol}_smart_${smartPattern}`;
        if (!isCooldown(key, now)) {
          const streak = _streakData[symbol];
          const totalValue = Math.abs(streak.totalDelta) * price;

          if (totalValue >= effectiveMinValue) {
            if (smartPattern === 'ACCUMULATION') {
              let detail = `🧠 NN mua ròng <b>${streak.count} lần liên tiếp</b>\n`;
              detail += `   Tổng gom: <b>+${fmtVol(streak.totalDelta)}</b> CP (~${fmtValue(totalValue)})\n`;
              detail += `   Giá chỉ dao động ${changePct >= 0 ? '+' : ''}${changePct}% → <b>CHƯA PHẢN ÁNH</b>\n`;
              detail += `   <i>Dấu hiệu tay to gom hàng âm thầm trước khi đẩy giá.</i>`;

              alerts.push({
                symbol, icon: '🧲🐋', title: 'GOM ÂM THẦM (Accumulation)', detail,
                price, changePct, volume, priority: 'HIGH',
              });
            } else if (smartPattern === 'DISTRIBUTION') {
              let detail = `🧠 NN bán ròng <b>${streak.count} lần liên tiếp</b>\n`;
              detail += `   Tổng xả: <b>${fmtVol(streak.totalDelta)}</b> CP (~${fmtValue(totalValue)})\n`;
              detail += `   Giá giảm ${changePct}% → <b>XẢ CÓ CHỦ ĐÍCH</b>\n`;
              detail += `   <i>Cảnh báo: Dòng tiền lớn đang rút khỏi cổ phiếu.</i>`;

              alerts.push({
                symbol, icon: '🔻🐋', title: 'XẢ MẠNH CÓ TỔ CHỨC (Distribution)', detail,
                price, changePct, volume, priority: 'HIGH',
              });
            }
            _alertedToday[key] = now;
            incrementAlertCount(symbol);
          }
        }
      }

      // ═══ CHECK 2: NN mua/bán ròng THAY ĐỔI đột biến (3 phút) ═══
      const fnDeltaValue = Math.abs(fnDelta) * price;
      if (Math.abs(fnDelta) >= THRESHOLDS.foreignNetChange && fnDeltaValue >= effectiveMinValue) {
        const key = `${symbol}_fn_${fnDelta > 0 ? 'b' : 's'}`;
        if (!isCooldown(key, now) && canAlertSymbol(symbol, 'MEDIUM')) {
          const act = fnDelta > 0 ? 'MUA RÒNG' : 'BÁN RÒNG';
          const ico = fnDelta > 0 ? '💚🔥' : '💔🔥';
          let detail = `Thay đổi 3ph: <b>${fnDelta > 0 ? '+' : ''}${fmtVol(fnDelta)}</b> CP (~${fmtValue(fnDeltaValue)})\n`;
          detail += `   NN Mua: ${fmtVol(foreignBuy)} | Bán: ${fmtVol(foreignSell)} | Ròng: ${foreignNet >= 0 ? '+' : ''}${fmtVol(foreignNet)}`;

          if (avgVol > 0) {
            const pctOfAvg = (Math.abs(fnDelta) / avgVol * 100).toFixed(1);
            detail += `\n   📊 Lệnh = <b>${pctOfAvg}%</b> KLTB20 (${fmtVol(avgVol)})`;
            if (parseFloat(pctOfAvg) >= THRESHOLDS.foreignVsSMA20 * 100) {
              detail += ` ← ⚡ <b>BẤT THƯỜNG</b>`;
            }
          }

          // Wash trading warning
          const washState = _washTradingFlags[symbol];
          if (washState && washState.flipCount >= THRESHOLDS.washFlipMax) {
            detail += `\n   ⚠️ <i>Lưu ý: Mã này có dấu hiệu wash trading (NN đổi chiều ${washState.flipCount} lần)</i>`;
          }

          const priority = Math.abs(fnDelta) >= THRESHOLDS.foreignNetChange * 2 ? 'HIGH' : 'MEDIUM';
          alerts.push({ symbol, icon: ico, title: `NN ${act} ĐỘT BIẾN`, detail, price, changePct, volume, priority });
          _alertedToday[key] = now;
          incrementAlertCount(symbol);
        }
      }

      // ═══ CHECK 3: NN ròng TỔNG trong ngày lớn ═══
      const foreignNetValue = Math.abs(foreignNet) * price;
      if (Math.abs(foreignNet) >= THRESHOLDS.foreignNetTotal && foreignNetValue >= effectiveMinValue) {
        const key = `${symbol}_fnt_${foreignNet > 0 ? 'b' : 's'}`;
        if (!isCooldown(key, now) && canAlertSymbol(symbol, 'MEDIUM')) {
          const act = foreignNet > 0 ? 'GOM HÀNG LỚN' : 'XẢ HÀNG LỚN';
          const ico = foreignNet > 0 ? '🐋💰' : '🐋💸';
          let detail = `NN Ròng ngày: <b>${foreignNet >= 0 ? '+' : ''}${fmtVol(foreignNet)}</b> CP\n`;
          detail += `   Giá trị: ~${fmtValue(Math.abs(foreignNet) * price)}`;
          if (avgVol > 0) {
            detail += `\n   📊 NN ròng = <b>${(Math.abs(foreignNet) / avgVol * 100).toFixed(1)}%</b> KLTB20`;
          }
          alerts.push({ symbol, icon: ico, title: `NN ${act} TRONG PHIÊN`, detail, price, changePct, volume,
            priority: Math.abs(foreignNet) >= THRESHOLDS.foreignNetTotal * 2 ? 'HIGH' : 'MEDIUM' });
          _alertedToday[key] = now;
          incrementAlertCount(symbol);
        }
      }

      // ═══ CHECK 4: KL giao dịch ngày VƯỢT SMA20 ═══
      if (avgVol > 0 && volume >= avgVol * THRESHOLDS.volumeVsSMA20 && !_volumeAlerted[symbol]) {
        if (canAlertSymbol(symbol, 'MEDIUM')) {
          const pct = (volume / avgVol * 100).toFixed(0);
          let detail = `KLGD hôm nay: <b>${fmtVol(volume)}</b> (${pct}% KLTB20)\n`;
          detail += `   KLTB20: ${fmtVol(avgVol)} — vượt <b>${(THRESHOLDS.volumeVsSMA20 * 100).toFixed(0)}%</b>`;
          if (foreignNet !== 0) {
            detail += `\n   ${foreignNet > 0 ? '💚' : '💔'} NN ròng: ${foreignNet >= 0 ? '+' : ''}${fmtVol(foreignNet)}`;
            detail += foreignNet > 0 ? ' → Dòng tiền VÀO' : ' → Dòng tiền RA';
          }
          alerts.push({ symbol, icon: '🔥📦', title: `KL VƯỢT SMA20 (${pct}%)`, detail, price, changePct, volume,
            priority: parseFloat(pct) >= 250 ? 'HIGH' : 'MEDIUM' });
          _volumeAlerted[symbol] = true;
          incrementAlertCount(symbol);
        }
      }

      // ═══ CHECK 5: Biến động giá mạnh ═══
      if (Math.abs(changePct) >= THRESHOLDS.priceChangePct && Math.abs(prev.changePct) < THRESHOLDS.priceChangePct) {
        const key = `${symbol}_px_${changePct > 0 ? 'u' : 'd'}`;
        if (!isCooldown(key, now) && canAlertSymbol(symbol, 'MEDIUM')) {
          const dir = changePct > 0 ? 'TĂNG MẠNH' : 'GIẢM MẠNH';
          const ico = changePct > 0 ? '🚀📈' : '💥📉';
          let detail = `Giá: <b>${fmtPrice(price)}</b> (${changePct >= 0 ? '+' : ''}${changePct}%)\n`;
          detail += `   TC: ${fmtPrice(refPrice)} | Trần: ${fmtPrice(ceilingPrice)} | Sàn: ${fmtPrice(floorPrice)}`;
          alerts.push({ symbol, icon: ico, title: `GIÁ ${dir}`, detail, price, changePct, volume,
            priority: Math.abs(changePct) >= 5 ? 'HIGH' : 'MEDIUM' });
          _alertedToday[key] = now;
          incrementAlertCount(symbol);
        }
      }

      // ═══ CHECK 6: Chạm trần/sàn ═══
      if (ceilingPrice > 0 && price >= ceilingPrice * (1 - THRESHOLDS.nearCeilingFloor / 100)) {
        const key = `${symbol}_ceil`;
        if (!isCooldown(key, now) && canAlertSymbol(symbol, 'HIGH')) {
          alerts.push({ symbol, icon: '🟣⬆️', title: 'CHẠM TRẦN',
            detail: `Giá: <b>${fmtPrice(price)}</b> | Trần: ${fmtPrice(ceilingPrice)} (+${changePct}%)`,
            price, changePct, volume, priority: 'HIGH' });
          _alertedToday[key] = now;
          incrementAlertCount(symbol);
        }
      }
      if (floorPrice > 0 && price <= floorPrice * (1 + THRESHOLDS.nearCeilingFloor / 100)) {
        const key = `${symbol}_floor`;
        if (!isCooldown(key, now) && canAlertSymbol(symbol, 'HIGH')) {
          alerts.push({ symbol, icon: '🔵⬇️', title: 'CHẠM SÀN',
            detail: `Giá: <b>${fmtPrice(price)}</b> | Sàn: ${fmtPrice(floorPrice)} (${changePct}%)`,
            price, changePct, volume, priority: 'HIGH' });
          _alertedToday[key] = now;
          incrementAlertCount(symbol);
        }
      }

      // ═══ CHECK 7: Tổng KL khớp thay đổi đột biến (3 phút) ═══
      const volDelta = volume - prev.volume;
      const dynamicVolThreshold = avgVol > 0 ? Math.max(Math.round(avgVol * THRESHOLDS.totalVolume3MinPct), THRESHOLDS.totalVolume3MinMin) : 100000;
      const volDeltaValue = volDelta * price;
      
      if (volDelta >= dynamicVolThreshold && volDeltaValue >= effectiveMinValue) {
        const key = `${symbol}_total_vol_spike`;
        if (!isCooldown(key, now) && canAlertSymbol(symbol, 'MEDIUM')) {
          const pctOfAvg = avgVol > 0 ? (volDelta / avgVol * 100).toFixed(1) : '---';
          let detail = `Khớp lệnh 3ph: <b>+${fmtVol(volDelta)}</b> CP (~${fmtValue(volDeltaValue)})\n`;
          if (avgVol > 0) {
            detail += `   📊 Tương đương: <b>${pctOfAvg}%</b> KLTB20 (${fmtVol(avgVol)})\n`;
          }
          if (Math.abs(fnDelta) > 0) {
            const fnPct = Math.min(Math.round((Math.abs(fnDelta) / volDelta) * 100), 100);
            detail += `   🛸 Khối ngoại ròng: ${fnDelta >= 0 ? '+' : ''}${fmtVol(fnDelta)} CP (~${fnPct}% lượng khớp 3ph)\n`;
          }
          detail += `   <i>Tín hiệu dòng tiền lớn từ Tay to, Các quỹ hoặc Tổ chức.</i>`;

          alerts.push({
            symbol, icon: '🐋🔥', title: 'TAY TO / QUỸ GIAO DỊCH ĐỘT BIẾN', detail,
            price, changePct, volume,
            priority: volDelta >= dynamicVolThreshold * 2 ? 'HIGH' : 'MEDIUM',
          });
          _alertedToday[key] = now;
          incrementAlertCount(symbol);
        }
      }

      // ═══ CHECK 8: Giao dịch lớn >= 10 tỷ VND ═══
      if (volDelta > 0 && volDeltaValue >= THRESHOLDS.bigTradeMinValue) {
        const key = `${symbol}_big_trade`;
        if (!isCooldown(key, now) && canAlertSymbol(symbol, 'MEDIUM')) {
          const valStr = fmtValue(volDeltaValue);
          let detail = `Giao dịch lớn 3ph: <b>+${fmtVol(volDelta)}</b> CP\n`;
          detail += `   💰 Giá trị: <b>${valStr}</b>\n`;
          if (avgVol > 0) {
            const pctOfAvg = (volDelta / avgVol * 100).toFixed(1);
            detail += `   📊 Tương đương: <b>${pctOfAvg}%</b> KLTB20 (${fmtVol(avgVol)})\n`;
          }
          if (Math.abs(fnDelta) > 0) {
            const fnPct = Math.min(Math.round((Math.abs(fnDelta) / volDelta) * 100), 100);
            const nnValStr = fmtValue(Math.abs(fnDelta) * price);
            detail += `   🛸 Trong đó NN: ${fnDelta >= 0 ? '+' : ''}${fmtVol(fnDelta)} CP (~${nnValStr}, ${fnPct}%)\n`;
            const domesticPct = 100 - fnPct;
            detail += `   🏠 Nội địa (tổ chức/cá nhân): ~${domesticPct}% lượng khớp\n`;
          } else {
            detail += `   🏠 100% giao dịch nội địa (tổ chức/cá nhân lớn)\n`;
          }
          detail += `   <i>⚡ Giao dịch giá trị rất lớn — có thể từ quỹ, tổ chức hoặc cá nhân lớn.</i>`;

          alerts.push({
            symbol, icon: '💎🐋', title: `GIAO DỊCH LỚN ${valStr}`, detail,
            price, changePct, volume,
            priority: volDeltaValue >= THRESHOLDS.bigTradeMinValue * 2 ? 'HIGH' : 'MEDIUM',
          });
          _alertedToday[key] = now;
          incrementAlertCount(symbol);
        }
      }

      _previousData[symbol] = cur;
    }

    if (alerts.length > 0) {
      await sendAlerts(alerts);
    }
  } catch (error) {
    if (isTradingHours()) {
      console.error('🚨 Alert poll error:', error.message);
    }
  }
}

// ─── SEND ALERTS (không dùng AI) ────────────────────────────

async function sendAlerts(alerts) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  let msg = `🚨 <b>CẢNH BÁO GIAO DỊCH THÔNG MINH</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const a of alerts) {
    const prio = a.priority === 'HIGH' ? '‼️' : '❗';
    msg += `${a.icon} <b>${a.symbol}</b> — ${prio} ${a.title}\n`;
    msg += `   💰 ${fmtPrice(a.price)} (${a.changePct >= 0 ? '+' : ''}${a.changePct}%)\n`;
    msg += `   ${a.detail}\n`;
    msg += `   📦 KLGD: ${fmtVol(a.volume)}\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🧠 Smart Alert v2.0 | Adaptive Threshold | Poll 3 phút</i>\n`;
  msg += `<i>🤖 VN Stock Bot v${config.version}</i>`;

  try {
    await axios.post(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text: msg,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    console.log(`🚨 Alert: ${alerts.map(a => `${a.symbol}(${a.title})`).join(', ')}`);
  } catch (error) {
    console.error('🚨 Lỗi gửi alert:', error.response?.data?.description || error.message);
  }
}

// ─── HELPERS ────────────────────────────────────────────────

function isCooldown(key, now) {
  return (now - (_alertedToday[key] || 0)) < ALERT_COOLDOWN;
}

function fmtVol(v) {
  if (!v) return '0';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + v.toLocaleString('vi-VN');
}

function fmtPrice(p) {
  return p ? p.toLocaleString('vi-VN') : '---';
}

function fmtValue(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + ' tỷ đ';
  if (a >= 1e6) return (v / 1e6).toFixed(0) + ' triệu đ';
  return v.toLocaleString('vi-VN') + ' đ';
}

module.exports = { startAlertMonitor, stopAlertMonitor, resetDailyData, isTradingHours };
