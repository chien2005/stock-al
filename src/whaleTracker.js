/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     🐋 VN STOCK BOT - Whale Tracker Report v1.0              ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Theo dõi top 10 CP được tay to / quỹ lớn sở hữu nhiều nhất ║
 * ║  Phát hiện: gom âm thầm, xả có tổ chức, kéo giá, đảo DM     ║
 * ║  Gửi Telegram: 19h45 hàng ngày (T2-T6)                       ║
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

// ─── TOP 10 CP ĐƯỢC TAY TO NẮM GIỮ NHIỀU NHẤT ─────────────
const WHALE_STOCKS = ['VIC', 'VHM', 'VCB', 'HPG', 'FPT', 'MWG', 'TCB', 'MBB', 'STB', 'VPB'];

// Quỹ nào nắm giữ mã nào
const WHALE_OWNERS = {
  VIC: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF', 'PNV'],
  VHM: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  VCB: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  HPG: ['Dragon', 'Vina', 'PYN', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  FPT: ['Dragon', 'Vina', 'PYN', 'Fubon', 'VanEck', 'VCBF'],
  MWG: ['Dragon', 'Vina', 'PYN', 'Fubon', 'SSIAM', 'VCBF'],
  TCB: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  MBB: ['Dragon', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  STB: ['Dragon', 'PYN', 'KIM', 'Fubon', 'SSIAM'],
  VPB: ['Vina', 'KIM', 'Fubon', 'VCBF'],
};

// ─── STATE: Lưu dữ liệu multi-day cho streak detection ─────
let _prevDayForeignNet = {};
let _streakDays = {};

/**
 * Chạy Whale Tracker Report — gọi lúc 19:45 T2-T6
 */
async function runWhaleTrackerReport() {
  console.log('\n' + '═'.repeat(55));
  console.log('🐋 WHALE TRACKER REPORT...');
  console.log('═'.repeat(55));

  try {
    const symbols = WHALE_STOCKS;
    const res = await axios.get(`${VPS_API.realtime}/${symbols.join(',')}`, {
      headers: HEADERS, timeout: 10000,
    });
    const rawData = res.data || [];
    if (rawData.length === 0) {
      console.log('   ❌ Không lấy được dữ liệu');
      return;
    }

    // Fetch KLTB20
    const avgVolumes = {};
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 40;
    for (const sym of symbols) {
      try {
        const hRes = await axios.get(
          `${VPS_API.history}?symbol=${sym}&resolution=D&from=${from}&to=${now}`,
          { headers: HEADERS, timeout: 8000 }
        );
        const hData = hRes.data;
        if (hData && hData.v && hData.v.length >= 20) {
          const last20 = hData.v.slice(-20);
          avgVolumes[sym] = Math.round(last20.reduce((s, v) => s + v, 0) / 20);
        }
      } catch (e) { /* silent */ }
    }

    // Parse data
    const stocks = [];
    for (const raw of rawData) {
      const sym = raw.sym;
      if (!sym || !symbols.includes(sym)) continue;

      const price = parseFloat(raw.lastPrice || 0) * 1000;
      const refPrice = parseFloat(raw.r || 0) * 1000;
      const volume = parseInt(raw.lot || 0);
      const foreignBuy = parseInt(raw.fBVol || 0);
      const foreignSell = parseInt(raw.fSVolume || 0);
      const foreignNet = foreignBuy - foreignSell;
      const changePct = refPrice > 0 ? parseFloat(((price - refPrice) / refPrice * 100).toFixed(2)) : 0;
      const avgVol = avgVolumes[sym] || 0;
      const volRatio = avgVol > 0 ? (volume / avgVol) : 0;
      const fnValue = (foreignNet * price) / 1e9;
      const totalValue = (volume * price) / 1e9;

      updateStreak(sym, foreignNet);
      const pattern = detectPattern(sym, foreignNet, changePct, volRatio);

      stocks.push({
        symbol: sym, price, changePct, volume, avgVol, volRatio,
        foreignBuy, foreignSell, foreignNet, fnValue, totalValue,
        pattern, owners: WHALE_OWNERS[sym] || [],
        streakCount: _streakDays[sym]?.count || 0,
        streakDir: _streakDays[sym]?.direction || 0,
      });
    }

    stocks.sort((a, b) => Math.abs(b.fnValue) - Math.abs(a.fnValue));

    const msg = formatWhaleReport(stocks);

    await axios.post(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text: msg,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    for (const s of stocks) {
      _prevDayForeignNet[s.symbol] = s.foreignNet;
    }

    console.log('   ✅ Whale Tracker Report đã gửi');
  } catch (error) {
    console.error('   ❌ Whale Tracker lỗi:', error.message);
  }
}

// ─── STREAK DETECTION ───────────────────────────────────────

function updateStreak(symbol, foreignNet) {
  const dir = foreignNet > 0 ? 1 : foreignNet < 0 ? -1 : 0;
  if (dir === 0) return;
  if (!_streakDays[symbol]) {
    _streakDays[symbol] = { direction: dir, count: 1 };
    return;
  }
  const prev = _streakDays[symbol];
  if (dir === prev.direction) {
    prev.count++;
  } else {
    prev.direction = dir;
    prev.count = 1;
  }
}

// ─── PATTERN DETECTION ──────────────────────────────────────

function detectPattern(symbol, foreignNet, changePct, volRatio) {
  const streak = _streakDays[symbol];
  const streakCount = streak ? streak.count : 0;
  const streakDir = streak ? streak.direction : 0;

  if (streakDir > 0 && streakCount >= 3 && Math.abs(changePct) <= 1.5) {
    return { icon: '🧲', text: 'GOM ÂM THẦM', priority: 'HIGH' };
  }
  if (streakDir < 0 && streakCount >= 3) {
    return { icon: '🔻', text: 'XẢ CÓ TỔ CHỨC', priority: 'HIGH' };
  }
  if (volRatio > 2.0 && changePct > 2.0) {
    return { icon: '🚀', text: 'KÉO GIÁ', priority: 'MEDIUM' };
  }
  if (volRatio > 2.0 && changePct < -2.0) {
    return { icon: '💥', text: 'ĐẠP GIÁ', priority: 'MEDIUM' };
  }
  if (volRatio > 1.8) {
    return { icon: '📊', text: 'KL ĐỘT BIẾN', priority: 'LOW' };
  }
  if (foreignNet > 100000) {
    return { icon: '💚', text: 'NN MUA MẠNH', priority: 'MEDIUM' };
  }
  if (foreignNet < -100000) {
    return { icon: '💔', text: 'NN BÁN MẠNH', priority: 'MEDIUM' };
  }
  return null;
}

// ─── FORMAT REPORT ──────────────────────────────────────────

function formatWhaleReport(stocks) {
  const nowStr = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  const totalFnBuy = stocks.reduce((s, st) => s + (st.foreignNet > 0 ? st.fnValue : 0), 0);
  const totalFnSell = stocks.reduce((s, st) => s + (st.foreignNet < 0 ? st.fnValue : 0), 0);
  const totalFnNet = totalFnBuy + totalFnSell;

  let msg = `🐋 <b>WHALE TRACKER — TOP 10 CP TAY TO</b>\n`;
  msg += `🕐 <i>${nowStr}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `<code>#  Mã   Giá     %     NN Ròng    Tín hiệu</code>\n`;
  msg += `<code>── ──── ─────── ───── ────────── ──────────</code>\n`;

  for (let i = 0; i < stocks.length; i++) {
    const s = stocks[i];
    const rank = String(i + 1).padStart(2);
    const sym = s.symbol.padEnd(4);
    const price = fmtPriceShort(s.price).padStart(7);
    const pct = `${s.changePct >= 0 ? '+' : ''}${s.changePct}%`.padStart(6);
    const fnStr = `${s.fnValue >= 0 ? '+' : ''}${s.fnValue.toFixed(1)}tỷ`.padStart(9);
    const signal = s.pattern ? `${s.pattern.icon}${s.pattern.text}` : '—';
    const pctIcon = s.changePct > 0 ? '🟢' : s.changePct < 0 ? '🔴' : '🟡';

    msg += `${pctIcon}<code>${rank} ${sym} ${price} ${pct} ${fnStr}</code> ${signal}\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;

  msg += `💰 <b>DÒNG TIỀN NN:</b>\n`;
  msg += `   📈 Mua: <b>${totalFnBuy.toFixed(1)} tỷ</b>`;
  msg += ` | 📉 Bán: <b>${totalFnSell.toFixed(1)} tỷ</b>\n`;
  const netIcon = totalFnNet >= 0 ? '🟢' : '🔻';
  const netText = totalFnNet >= 0 ? 'TIỀN VÀO' : 'TIỀN RA';
  msg += `   ${netIcon} Ròng: <b>${totalFnNet >= 0 ? '+' : ''}${totalFnNet.toFixed(1)} tỷ</b> → ${netText}\n`;

  const signalStocks = stocks.filter(s => s.pattern);
  if (signalStocks.length > 0) {
    msg += `\n🧠 <b>TÍN HIỆU:</b>\n`;
    for (const s of signalStocks) {
      msg += `   ${s.pattern.icon} <b>${s.symbol}</b> — ${s.pattern.text}`;
      if (s.streakCount >= 2) {
        const dirText = s.streakDir > 0 ? 'mua' : 'bán';
        msg += ` (NN ${dirText} ròng ${s.streakCount} phiên)`;
      }
      if (s.volRatio > 1.5) {
        msg += ` | KL ${(s.volRatio * 100).toFixed(0)}% TB`;
      }
      msg += `\n`;
    }
  }

  msg += `\n📋 <b>QUỸ NẮM GIỮ:</b>\n`;
  for (const s of stocks.slice(0, 5)) {
    const owners = s.owners.slice(0, 4).join(', ');
    const more = s.owners.length > 4 ? ` +${s.owners.length - 4}` : '';
    msg += `   ${s.symbol}: ${owners}${more}\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🐋 Whale Tracker v1.0 | VN Stock Bot v${config.version}</i>`;

  return msg;
}

function fmtPriceShort(p) {
  if (!p) return '---';
  return (p / 1000).toFixed(1);
}

module.exports = { runWhaleTrackerReport };
