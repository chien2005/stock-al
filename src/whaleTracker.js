/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     🐋 VN STOCK BOT - Whale Tracker Report v2.1              ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Theo dõi top 14 CP được tay to / quỹ lớn sở hữu nhiều nhất ║
 * ║  Phát hiện hành vi: Nội kéo, Nội đỡ, Nội xả, Gom âm thầm     ║
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

// 14 CP theo yêu cầu chính xác của user
const WHALE_STOCKS = ['VCB', 'HPG', 'BID', 'MWG', 'SSI', 'FPT', 'VIC', 'VHM', 'CTR', 'MBB', 'TCB', 'ACB', 'CTG', 'VPB'];

const WHALE_OWNERS = {
  VCB: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  HPG: ['Dragon', 'Vina', 'PYN', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  BID: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  MWG: ['Dragon', 'Vina', 'PYN', 'Fubon', 'SSIAM', 'VCBF'],
  SSI: ['Dragon', 'Vina', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  FPT: ['Dragon', 'Vina', 'PYN', 'Fubon', 'VanEck', 'VCBF'],
  VIC: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF', 'PNV'],
  VHM: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  CTR: ['Dragon', 'Vina', 'VanEck'],
  MBB: ['Dragon', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  TCB: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  ACB: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  CTG: ['Dragon', 'Vina', 'KIM', 'Fubon', 'VanEck', 'SSIAM', 'VCBF'],
  VPB: ['Vina', 'KIM', 'Fubon', 'VCBF'],
};

let _prevDayForeignNet = {};
let _streakDays = {};

async function runWhaleTrackerReport() {
  console.log('\n' + '═'.repeat(55));
  console.log('🐋 RUNNING WHALE TRACKER REPORT v2.1...');
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

      const totalVal = (volume * price) / 1e9;
      const fnValue = (foreignNet * price) / 1e9;
      const fnBuyValue = (foreignBuy * price) / 1e9;
      const fnSellValue = (foreignSell * price) / 1e9;

      const foreignParticipationPct = totalVal > 0 
        ? parseFloat((((foreignBuy + foreignSell) * price / 1e9) / (2 * totalVal) * 100).toFixed(1)) 
        : 0;

      updateStreak(sym, foreignNet);
      const pattern = detectAdvancedPattern(sym, foreignNet, changePct, volRatio, totalVal, fnValue);

      stocks.push({
        symbol: sym, price, changePct, volume, avgVol, volRatio,
        foreignBuy, foreignSell, foreignNet, fnValue, fnBuyValue, fnSellValue, totalVal,
        foreignParticipationPct, pattern, owners: WHALE_OWNERS[sym] || [],
        streakCount: _streakDays[sym]?.count || 0,
        streakDir: _streakDays[sym]?.direction || 0,
      });
    }

    // Mặc định sắp xếp theo khối lượng dòng tiền ròng của ngoại lớn nhất
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

    console.log('   ✅ Whale Tracker Report v2.1 đã gửi');
  } catch (error) {
    console.error('   ❌ Whale Tracker lỗi:', error.message);
  }
}

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

function detectAdvancedPattern(symbol, foreignNet, changePct, volRatio, totalVal, fnValue) {
  const streak = _streakDays[symbol];
  const streakCount = streak ? streak.count : 0;
  const streakDir = streak ? streak.direction : 0;

  if (changePct >= 2.0 && volRatio >= 1.2 && fnValue <= 2.0) {
    return { icon: '🔥', text: 'Nội Kéo', priority: 'HIGH' };
  }
  if (fnValue <= -5.0 && changePct >= -0.5) {
    return { icon: '🛡️', text: 'Nội Đỡ', priority: 'HIGH' };
  }
  if (changePct <= -2.0 && volRatio >= 1.2 && fnValue >= -2.0) {
    return { icon: '💔', text: 'Nội Xả', priority: 'HIGH' };
  }
  if (streakDir > 0 && streakCount >= 3 && Math.abs(changePct) <= 1.2) {
    return { icon: '🧲', text: 'Gom Âm Thầm', priority: 'MEDIUM' };
  }
  if (streakDir < 0 && streakCount >= 3) {
    return { icon: '🔻', text: 'Ngoại Xả', priority: 'MEDIUM' };
  }
  if (volRatio >= 2.0) {
    return { icon: '⚡', text: 'KL Đột Biến', priority: 'LOW' };
  }
  return null;
}

function formatWhaleReport(stocks) {
  const nowStr = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  const totalFnBuy = stocks.reduce((s, st) => s + st.fnBuyValue, 0);
  const totalFnSell = stocks.reduce((s, st) => s + st.fnSellValue, 0);
  const totalFnNet = totalFnBuy - totalFnSell;

  let msg = `🐋 <b>WHALE TRACKER — TAY TO ĐỐI ỨNG</b>\n`;
  msg += `🕐 <i>${nowStr}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Bỏ cột % theo yêu cầu của user
  msg += `<code>Mã   Giá    Ngoại   TổngGD  %Ngoại</code>\n`;
  msg += `<code>─── ───── ─────── ─────── ──────</code>\n`;

  for (const s of stocks) {
    const sym = s.symbol.padEnd(3);
    const price = fmtPriceShort(s.price).padStart(5);
    const fnStr = `${s.fnValue >= 0 ? '+' : ''}${s.fnValue.toFixed(1)}t`.padStart(7);
    const totalGDStr = `${s.totalVal.toFixed(0)}t`.padStart(7);
    const participation = `${s.foreignParticipationPct}%`.padStart(6);
    
    // Icon hướng giá tăng/giảm nhẹ để dễ nhận biết
    const pctIcon = s.changePct > 0 ? '🟢' : s.changePct < 0 ? '🔴' : '🟡';
    
    msg += `${pctIcon}<code>${sym} ${price} ${fnStr} ${totalGDStr} ${participation}</code>\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Thêm thông số Dòng Tiền NN theo yêu cầu
  msg += `💰 <b>DÒNG TIỀN NN:</b>\n`;
  msg += `   📈 Mua: <b>${totalFnBuy.toFixed(1)} tỷ</b> | 📉 Bán: <b>-${totalFnSell.toFixed(1)} tỷ</b>\n`;
  const netIcon = totalFnNet >= 0 ? '🟢' : '🔻';
  const netText = totalFnNet >= 0 ? 'TIỀN VÀO' : 'TIỀN RA';
  msg += `   ${netIcon} Ròng: <b>${totalFnNet >= 0 ? '+' : ''}${totalFnNet.toFixed(1)} tỷ</b> → ${netText}\n\n`;

  // QUỸ mua vào mạnh nhất (Top 10 cp có fnValue dương lớn nhất)
  const buyers = [...stocks].filter(s => s.fnValue > 0).sort((a, b) => b.fnValue - a.fnValue).slice(0, 10);
  msg += `📋 <b>QUỸ mua vào mạnh nhất:</b>\n`;
  if (buyers.length > 0) {
    buyers.forEach((s, idx) => {
      msg += `   ${idx + 1}. <b>${s.symbol}</b> (+${s.fnValue.toFixed(1)} tỷ)\n`;
    });
  } else {
    msg += `   — Không có mã nào được mua ròng\n`;
  }
  msg += `\n`;

  // QUỸ bán ra mạnh nhất (Top 10 cp có fnValue âm lớn nhất)
  const sellers = [...stocks].filter(s => s.fnValue < 0).sort((a, b) => a.fnValue - b.fnValue).slice(0, 10);
  msg += `📋 <b>QUỸ bán ra mạnh nhất:</b>\n`;
  if (sellers.length > 0) {
    sellers.forEach((s, idx) => {
      msg += `   ${idx + 1}. <b>${s.symbol}</b> (${s.fnValue.toFixed(1)} tỷ)\n`;
    });
  } else {
    msg += `   — Không có mã nào bị bán ròng\n`;
  }
  msg += `\n`;

  // Phần diễn giải tín hiệu
  const signalStocks = stocks.filter(s => s.pattern);
  if (signalStocks.length > 0) {
    msg += `🧠 <b>HÀNH VI TAY TO NỔI BẬT:</b>\n`;
    for (const s of signalStocks) {
      msg += `   ${s.pattern.icon} <b>${s.symbol}</b>: ${s.pattern.text}`;
      if (s.pattern.text === 'Nội Kéo') {
        msg += ` (Nội mua đẩy giá, Ngoại ròng ${s.fnValue >= 0 ? '+' : ''}${s.fnValue.toFixed(1)} tỷ)`;
      } else if (s.pattern.text === 'Nội Đỡ') {
        msg += ` (Nội hấp thụ lực xả ${Math.abs(s.fnValue).toFixed(1)} tỷ của Ngoại)`;
      } else if (s.pattern.text === 'Nội Xả') {
        msg += ` (Nội chủ động xả bán)`;
      } else if (s.pattern.text === 'Gom Âm Thầm') {
        msg += ` (Ngoại gom ròng ${s.streakCount} phiên)`;
      } else if (s.pattern.text === 'Ngoại Xả') {
        msg += ` (Ngoại bán liên tiếp ${s.streakCount} phiên)`;
      } else {
        msg += ` (KLGD gấp ${s.volRatio.toFixed(1)} lần trung bình)`;
      }
      msg += `\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🐋 Whale Tracker v2.1 | VN Stock Bot</i>`;

  return msg;
}

function fmtPriceShort(p) {
  if (!p) return '---';
  return (p / 1000).toFixed(1);
}

module.exports = { runWhaleTrackerReport };
