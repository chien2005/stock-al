/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     🚨 VN STOCK BOT - Alert Service v1.1                     ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Cảnh báo giao dịch bất thường trong phiên                   ║
 * ║  KHÔNG dùng AI — chỉ so sánh data, gửi thẳng Telegram       ║
 * ║                                                               ║
 * ║  📡 Poll VPS API mỗi 3 phút (9:15 - 14:45 T2-T6)           ║
 * ║  🚨 Phát hiện:                                               ║
 * ║    - Khối ngoại mua/bán ròng đột biến                       ║
 * ║    - KL giao dịch vượt SMA20 (KLTB 20 phiên)                ║
 * ║    - Lệnh gom lớn (NN thay đổi > % SMA20)                  ║
 * ║    - Biến động giá mạnh (>3%) / chạm trần sàn               ║
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
};

// ─── STATE ──────────────────────────────────────────────────
let _pollInterval = null;
let _previousData = {};       // { symbol: { foreignNet, volume, ... } }
let _alertedToday = {};       // { "VCB_foreign_buy": timestamp }
let _avgVolumes = {};         // { symbol: avgVolume } - KLTB 20 phiên
let _volumeAlerted = {};      // { symbol: true } - đã alert KL vượt SMA20 hôm nay
const ALERT_COOLDOWN = 15 * 60 * 1000; // 15 phút giữa 2 alert cùng loại/mã

// ─── MAIN ───────────────────────────────────────────────────

function startAlertMonitor() {
  const POLL_INTERVAL = 3 * 60 * 1000; // 3 phút

  console.log('🚨 Alert Monitor khởi động (không dùng AI)');
  console.log(`   📡 Poll mỗi 3 phút | ${config.stockSymbols.length} mã`);
  console.log(`   🔔 NN ròng: ±${fmtVol(THRESHOLDS.foreignNetChange)}/check | Gom lớn: >${THRESHOLDS.foreignVsSMA20 * 100}% KLTB20`);
  console.log(`   📊 KL vượt SMA20: >${THRESHOLDS.volumeVsSMA20 * 100}% | Giá: ±${THRESHOLDS.priceChangePct}%`);

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
  // Reload avg volumes mỗi ngày mới
  loadAvgVolumes();
  console.log('🚨 Alert: Reset data đầu ngày');
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
  console.log('🚨 Đang tải KLTB 20 phiên...');
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
      } else if (data && data.v && data.v.length > 0) {
        _avgVolumes[symbol] = Math.round(data.v.reduce((s, v) => s + v, 0) / data.v.length);
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
  }
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

      // ═══ CHECK 1: NN mua/bán ròng THAY ĐỔI đột biến (3 phút) ═══
      const fnDelta = foreignNet - prev.foreignNet;
      if (Math.abs(fnDelta) >= THRESHOLDS.foreignNetChange) {
        const key = `${symbol}_fn_${fnDelta > 0 ? 'b' : 's'}`;
        if (!isCooldown(key, now)) {
          const act = fnDelta > 0 ? 'MUA RÒNG' : 'BÁN RÒNG';
          const ico = fnDelta > 0 ? '💚🔥' : '💔🔥';
          let detail = `Thay đổi 3ph: <b>${fnDelta > 0 ? '+' : ''}${fmtVol(fnDelta)}</b> CP\n`;
          detail += `   NN Mua: ${fmtVol(foreignBuy)} | Bán: ${fmtVol(foreignSell)} | Ròng: ${foreignNet >= 0 ? '+' : ''}${fmtVol(foreignNet)}`;

          // So sánh lệnh gom với KLTB20
          if (avgVol > 0) {
            const pctOfAvg = (Math.abs(fnDelta) / avgVol * 100).toFixed(1);
            detail += `\n   📊 Lệnh = <b>${pctOfAvg}%</b> KLTB20 (${fmtVol(avgVol)})`;
            if (parseFloat(pctOfAvg) >= THRESHOLDS.foreignVsSMA20 * 100) {
              detail += ` ← ⚡ <b>BẤT THƯỜNG</b>`;
            }
          }

          alerts.push({ symbol, icon: ico, title: `NN ${act} ĐỘT BIẾN`, detail, price, changePct, volume,
            priority: Math.abs(fnDelta) >= THRESHOLDS.foreignNetChange * 2 ? 'HIGH' : 'MEDIUM' });
          _alertedToday[key] = now;
        }
      }

      // ═══ CHECK 2: NN ròng TỔNG trong ngày lớn ═══
      if (Math.abs(foreignNet) >= THRESHOLDS.foreignNetTotal) {
        const key = `${symbol}_fnt_${foreignNet > 0 ? 'b' : 's'}`;
        if (!isCooldown(key, now)) {
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
        }
      }

      // ═══ CHECK 3: Lệnh gom NN lớn > 5% KLTB20 (lệnh đơn bất thường) ═══
      if (avgVol > 0 && Math.abs(fnDelta) >= avgVol * THRESHOLDS.foreignVsSMA20) {
        const key = `${symbol}_bigorder`;
        // Chỉ alert nếu chưa bắt bởi check 1 (tránh trùng)
        if (!isCooldown(key, now) && Math.abs(fnDelta) < THRESHOLDS.foreignNetChange) {
          const ico = fnDelta > 0 ? '⚡💹' : '⚡📉';
          const act = fnDelta > 0 ? 'GOM' : 'XẢ';
          const pct = (Math.abs(fnDelta) / avgVol * 100).toFixed(1);
          let detail = `Lệnh ${act}: <b>${fnDelta > 0 ? '+' : ''}${fmtVol(fnDelta)}</b> CP (${pct}% KLTB20)\n`;
          detail += `   KLTB20: ${fmtVol(avgVol)} | NN ròng tổng: ${foreignNet >= 0 ? '+' : ''}${fmtVol(foreignNet)}`;
          alerts.push({ symbol, icon: ico, title: `LỆNH ${act} LỚN BẤT THƯỜNG`, detail, price, changePct, volume,
            priority: 'MEDIUM' });
          _alertedToday[key] = now;
        }
      }

      // ═══ CHECK 4: KL giao dịch ngày VƯỢT SMA20 ═══
      if (avgVol > 0 && volume >= avgVol * THRESHOLDS.volumeVsSMA20 && !_volumeAlerted[symbol]) {
        const pct = (volume / avgVol * 100).toFixed(0);
        let detail = `KLGD hôm nay: <b>${fmtVol(volume)}</b> (${pct}% KLTB20)\n`;
        detail += `   KLTB20: ${fmtVol(avgVol)} — vượt <b>${(THRESHOLDS.volumeVsSMA20 * 100).toFixed(0)}%</b>`;
        if (foreignNet !== 0) {
          detail += `\n   ${foreignNet > 0 ? '💚' : '💔'} NN ròng: ${foreignNet >= 0 ? '+' : ''}${fmtVol(foreignNet)}`;
          detail += foreignNet > 0 ? ' → Dòng tiền VÀO' : ' → Dòng tiền RA';
        }
        alerts.push({ symbol, icon: '🔥📦', title: `KL VƯỢT SMA20 (${pct}%)`, detail, price, changePct, volume,
          priority: parseFloat(pct) >= 250 ? 'HIGH' : 'MEDIUM' });
        _volumeAlerted[symbol] = true; // Chỉ alert 1 lần/ngày
      }

      // ═══ CHECK 5: Biến động giá mạnh ═══
      if (Math.abs(changePct) >= THRESHOLDS.priceChangePct && Math.abs(prev.changePct) < THRESHOLDS.priceChangePct) {
        const key = `${symbol}_px_${changePct > 0 ? 'u' : 'd'}`;
        if (!isCooldown(key, now)) {
          const dir = changePct > 0 ? 'TĂNG MẠNH' : 'GIẢM MẠNH';
          const ico = changePct > 0 ? '🚀📈' : '💥📉';
          let detail = `Giá: <b>${fmtPrice(price)}</b> (${changePct >= 0 ? '+' : ''}${changePct}%)\n`;
          detail += `   TC: ${fmtPrice(refPrice)} | Trần: ${fmtPrice(ceilingPrice)} | Sàn: ${fmtPrice(floorPrice)}`;
          alerts.push({ symbol, icon: ico, title: `GIÁ ${dir}`, detail, price, changePct, volume,
            priority: Math.abs(changePct) >= 5 ? 'HIGH' : 'MEDIUM' });
          _alertedToday[key] = now;
        }
      }

      // ═══ CHECK 6: Chạm trần/sàn ═══
      if (ceilingPrice > 0 && price >= ceilingPrice * (1 - THRESHOLDS.nearCeilingFloor / 100)) {
        const key = `${symbol}_ceil`;
        if (!isCooldown(key, now)) {
          alerts.push({ symbol, icon: '🟣⬆️', title: 'CHẠM TRẦN',
            detail: `Giá: <b>${fmtPrice(price)}</b> | Trần: ${fmtPrice(ceilingPrice)} (+${changePct}%)`,
            price, changePct, volume, priority: 'HIGH' });
          _alertedToday[key] = now;
        }
      }
      if (floorPrice > 0 && price <= floorPrice * (1 + THRESHOLDS.nearCeilingFloor / 100)) {
        const key = `${symbol}_floor`;
        if (!isCooldown(key, now)) {
          alerts.push({ symbol, icon: '🔵⬇️', title: 'CHẠM SÀN',
            detail: `Giá: <b>${fmtPrice(price)}</b> | Sàn: ${fmtPrice(floorPrice)} (${changePct}%)`,
            price, changePct, volume, priority: 'HIGH' });
          _alertedToday[key] = now;
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

  let msg = `🚨 <b>CẢNH BÁO GIAO DỊCH BẤT THƯỜNG</b>\n`;
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
  msg += `<i>🚨 Auto Alert (không AI) | Poll 3 phút</i>\n`;
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
