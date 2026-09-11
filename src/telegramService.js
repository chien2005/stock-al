/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║         📩 VN STOCK TRACKER - Telegram Service           ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║  Gửi thông tin cổ phiếu về Telegram Bot                 ║
 * ║  Format: HTML với emoji, icons, indicators               ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');
const { getStreakDays } = require('./whaleTracker');

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`;

/**
 * Gửi message text tới Telegram
 * @param {string} message - Nội dung message (hỗ trợ HTML)
 */
async function sendMessageSafe(chatId, text) {
  try {
    return await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (error) {
    const desc = error.response?.data?.description || error.message;
    if (desc && (desc.includes("can't parse entities") || desc.includes("Bad Request: can't parse"))) {
      console.warn(`⚠️ Telegram HTML entity parse error, retrying as plain text... (${desc})`);
      const plainText = text.replace(/<[^>]+>/g, '');
      return await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: plainText,
        disable_web_page_preview: true,
      });
    }
    throw error;
  }
}

async function sendTelegramMessage(message) {
  try {
    // Telegram giới hạn 4096 ký tự / message
    const chunks = splitMessage(message, 4000);

    for (const chunk of chunks) {
      await sendMessageSafe(config.telegram.chatId, chunk);
      // Delay nhẹ giữa các message để tránh rate limit
      if (chunks.length > 1) {
        await sleep(500);
      }
    }

    console.log('📩 Đã gửi message Telegram thành công!');
    return true;
  } catch (error) {
    console.error('❌ Lỗi gửi Telegram:', error.response?.data?.description || error.message);
    return false;
  }
}

/**
 * Gửi message tới nhóm Phái sinh (Ps) trên Telegram
 * Dùng cho tất cả noti phái sinh: tín hiệu, trailing, momentum, OI...
 * @param {string} message - Nội dung message (hỗ trợ HTML)
 */
async function sendDerivativesMessage(message) {
  try {
    const chatId = config.telegram.chatIdDerivatives || config.telegram.chatId;
    const chunks = splitMessage(message, 4000);

    for (const chunk of chunks) {
      await sendMessageSafe(chatId, chunk);
      if (chunks.length > 1) {
        await sleep(500);
      }
    }

    console.log('📩 Đã gửi message Telegram (Ps - Phái sinh) thành công!');
    return true;
  } catch (error) {
    console.error('❌ Lỗi gửi Telegram (Ps):', error.response?.data?.description || error.message);
    return false;
  }
}

/**
 * Format dữ liệu stock thành message Telegram đẹp
 * @param {Array} stocks - Danh sách thông tin stock
 * @returns {string} Message HTML formatted
 */
/**
 * Phát hiện hành vi của dòng tiền tay to/quỹ đối ứng dựa trên biến động giá, volume và ròng khối ngoại
 */
function detectPattern(symbol, changePct, volRatio, totalVal, fnValue) {
  const streakDays = getStreakDays() || {};
  const streak = streakDays[symbol];
  const streakCount = streak ? streak.count : 0;
  const streakDir = streak ? streak.direction : 0;

  if (changePct >= 1.2 && volRatio >= 1.2 && fnValue <= 2.0) {
    return { icon: '🔥', text: 'Nội Kéo', priority: 'HIGH' };
  }
  if (fnValue <= -5.0 && changePct >= -0.5) {
    return { icon: '🛡️', text: 'Nội Đỡ', priority: 'HIGH' };
  }
  if (changePct <= -1.2 && volRatio >= 1.2 && fnValue >= -2.0) {
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

/**
 * Format dữ liệu stock thành message Telegram đẹp dạng WHALE TRACKER v2.1 (kèm Tự doanh)
 * @param {Array} stocks - Danh sách thông tin stock
 * @param {Object} liquidity - Thông tin thanh khoản thị trường
 * @param {Object} vn30Index - Chỉ số VN30 / VNINDEX
 * @param {Object} propData - Bản ghi dữ liệu tự doanh từng mã
 * @returns {string} Message HTML formatted
 */
function formatStockMessage(stocks, liquidity = null, vn30Index = null, propData = null) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

  // Map stocks thành cấu trúc thuận tiện
  const formattedStocks = [];
  for (const s of stocks) {
    if (s.error) continue;

    const totalVal = (s.volume * s.price) / 1e9;
    const fnValue = (s.foreignNet * s.price) / 1e9;
    const fnBuyValue = (s.foreignBuy * s.price) / 1e9;
    const fnSellValue = (s.foreignSell * s.price) / 1e9;
    const volRatio = s.avgVolume > 0 ? (s.volume / s.avgVolume) : 0;

    const foreignParticipationPct = totalVal > 0 
      ? parseFloat((((s.foreignBuy + s.foreignSell) * s.price / 1e9) / (2 * totalVal) * 100).toFixed(1)) 
      : 0;

    const pattern = detectPattern(s.symbol, s.changePct, volRatio, totalVal, fnValue);
    
    // Đọc streak để hiển thị hành vi nổi bật
    const streakDays = getStreakDays() || {};
    const streak = streakDays[s.symbol];
    const streakCount = streak ? streak.count : 0;

    // Tích hợp dữ liệu tự doanh
    let propNet = null;
    let propBuy = 0;
    let propSell = 0;
    if (propData && propData[s.symbol]) {
      propNet = propData[s.symbol].netVal;
      propBuy = propData[s.symbol].buyVal;
      propSell = propData[s.symbol].sellVal;
    }

    formattedStocks.push({
      symbol: s.symbol,
      price: s.price,
      changePct: s.changePct,
      volume: s.volume,
      avgVolume: s.avgVolume,
      volRatio,
      foreignNet: s.foreignNet,
      fnValue,
      fnBuyValue,
      fnSellValue,
      totalVal,
      foreignParticipationPct,
      pattern,
      streakCount,
      propNet,
      propBuy,
      propSell
    });
  }

  // Mặc định sắp xếp theo khối lượng dòng tiền ròng của ngoại lớn nhất
  formattedStocks.sort((a, b) => Math.abs(b.fnValue) - Math.abs(a.fnValue));

  const totalFnBuy = formattedStocks.reduce((sum, st) => sum + st.fnBuyValue, 0);
  const totalFnSell = formattedStocks.reduce((sum, st) => sum + st.fnSellValue, 0);
  const totalFnNet = totalFnBuy - totalFnSell;

  let msg = `🐋 <b>WHALE TRACKER — TAY TO ĐỐI ỨNG</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Cấu trúc bảng 46 ký tự
  msg += `<code>Mã    Giá (Biến động)    Ngoại  TựDoanh TổngGD</code>\n`;
  msg += `<code>───── ─────────────── ─────── ──────── ───────</code>\n`;

  for (const s of formattedStocks) {
    const sym = s.symbol.length > 5 ? s.symbol.substring(0, 5) : s.symbol.padEnd(5);
    const priceStr = `${(s.price / 1000).toFixed(2)} (${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(1).replace('.', ',')}%)`.padStart(15);
    const fnStr = `${s.fnValue >= 0 ? '+' : ''}${s.fnValue.toFixed(1)}t`.padStart(7);
    
    let propStr = '---';
    if (s.propNet !== null && s.propNet !== undefined) {
      propStr = `${s.propNet >= 0 ? '+' : ''}${s.propNet.toFixed(1)}t`;
    }
    propStr = propStr.padStart(8);

    const totalGDStr = `${s.totalVal.toFixed(0)}t`.padStart(7);
    
    // Icon hướng giá trần/sàn/tăng/giảm/đứng giá
    let pctIcon;
    if (s.changePct > 6.5) {
      pctIcon = '🟣';
    } else if (s.changePct < -6.5) {
      pctIcon = '🔵';
    } else if (s.changePct > 0) {
      pctIcon = '🟢';
    } else if (s.changePct < 0) {
      pctIcon = '🔴';
    } else {
      pctIcon = '🟡';
    }
    
    msg += `${pctIcon}<code>${sym} ${priceStr} ${fnStr} ${propStr} ${totalGDStr}</code>\n`;
  }

  // Chèn lỗi nếu có mã nào bị lỗi
  const errors = stocks.filter(s => s.error);
  if (errors.length > 0) {
    msg += `\n⚠️ <b>MÃ LỖI:</b>\n`;
    for (const err of errors) {
      msg += `   • <b>${err.symbol}</b>: ${err.message}\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Chèn Chỉ số thị trường nếu có tham số vn30Index
  if (vn30Index) {
    msg += `📊 <b>CHỈ SỐ THỊ TRƯỜNG</b>\n`;
    if (vn30Index.vn30) {
      const v = vn30Index.vn30;
      const icon = v.changePct > 0 ? '🟢' : v.changePct < 0 ? '🔴' : '🟡';
      const sign = v.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>VN30</b>: ${v.close} (${sign}${v.changePct}%) | KL: ${(v.volume / 1000000).toFixed(0)}M\n`;
    }
    if (vn30Index.vnindex) {
      const v = vn30Index.vnindex;
      const icon = v.changePct > 0 ? '🟢' : v.changePct < 0 ? '🔴' : '🟡';
      const sign = v.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>VNINDEX</b>: ${v.close} (${sign}${v.changePct}%) | KL: ${(v.volume / 1000000).toFixed(0)}M\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Chèn thông tin Tổng thanh khoản (nếu có)
  if (liquidity) {
    msg += `💸 <b>TỔNG THANH KHOẢN TTCK VN</b>:\n`;
    msg += `   • <code>${liquidity.total.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tỷ</code>\n`;
    msg += `   • HOSE: ${liquidity.hose.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ | HNX: ${liquidity.hnx.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ | UPCOM: ${liquidity.upcom.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Thông số Dòng Tiền NN
  msg += `💰 <b>DÒNG TIỀN NN:</b>\n`;
  msg += `   📈 Mua: <b>${totalFnBuy.toFixed(1)} tỷ</b> | 📉 Bán: <b>-${totalFnSell.toFixed(1)} tỷ</b>\n`;
  const netIcon = totalFnNet >= 0 ? '🟢' : '🔻';
  const netText = totalFnNet >= 0 ? 'TIỀN VÀO' : 'TIỀN RA';
  msg += `   ${netIcon} Ròng: <b>${totalFnNet >= 0 ? '+' : ''}${totalFnNet.toFixed(1)} tỷ</b> → ${netText}\n\n`;

  // Thông số Dòng Tiền Tự Doanh (nếu có dữ liệu)
  const validPropStocks = formattedStocks.filter(s => s.propNet !== null);
  if (validPropStocks.length > 0) {
    const totalPropBuy = validPropStocks.reduce((sum, st) => sum + (st.propBuy || 0), 0);
    const totalPropSell = validPropStocks.reduce((sum, st) => sum + (st.propSell || 0), 0);
    const totalPropNet = totalPropBuy - totalPropSell;

    msg += `📊 <b>DÒNG TIỀN TỰ DOANH CTCK:</b>\n`;
    msg += `   📈 Mua: <b>${totalPropBuy.toFixed(1)} tỷ</b> | 📉 Bán: <b>-${totalPropSell.toFixed(1)} tỷ</b>\n`;
    const propNetIcon = totalPropNet >= 0 ? '🟢' : '🔻';
    const propNetText = totalPropNet >= 0 ? 'TIỀN VÀO' : 'TIỀN RA';
    msg += `   ${propNetIcon} Ròng: <b>${totalPropNet >= 0 ? '+' : ''}${totalPropNet.toFixed(1)} tỷ</b> → ${propNetText}\n\n`;

    // TỰ DOANH mua vào mạnh nhất
    const propBuyers = [...validPropStocks].filter(s => s.propNet > 0).sort((a, b) => b.propNet - a.propNet).slice(0, 5);
    msg += `📋 <b>TỰ DOANH mua vào mạnh nhất:</b>\n`;
    if (propBuyers.length > 0) {
      propBuyers.forEach((s, idx) => {
        msg += `   ${idx + 1}. <b>${s.symbol}</b> (+${s.propNet.toFixed(1)} tỷ)\n`;
      });
    } else {
      msg += `   — Không có mã nào được mua ròng\n`;
    }
    msg += `\n`;

    // TỰ DOANH bán ra mạnh nhất
    const propSellers = [...validPropStocks].filter(s => s.propNet < 0).sort((a, b) => a.propNet - b.propNet).slice(0, 5);
    msg += `📋 <b>TỰ DOANH bán ra mạnh nhất:</b>\n`;
    if (propSellers.length > 0) {
      propSellers.forEach((s, idx) => {
        msg += `   ${idx + 1}. <b>${s.symbol}</b> (${s.propNet.toFixed(1)} tỷ)\n`;
      });
    } else {
      msg += `   — Không có mã nào bị bán ròng\n`;
    }
    msg += `\n`;
  }

  // QUỸ mua vào mạnh nhất (Top 10 cp có fnValue dương lớn nhất)
  const buyers = [...formattedStocks].filter(s => s.fnValue > 0).sort((a, b) => b.fnValue - a.fnValue).slice(0, 10);
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
  const sellers = [...formattedStocks].filter(s => s.fnValue < 0).sort((a, b) => a.fnValue - b.fnValue).slice(0, 10);
  msg += `📋 <b>QUỸ bán ra mạnh nhất:</b>\n`;
  if (sellers.length > 0) {
    sellers.forEach((s, idx) => {
      msg += `   ${idx + 1}. <b>${s.symbol}</b> (${s.fnValue.toFixed(1)} tỷ)\n`;
    });
  } else {
    msg += `   — Không có mã nào bị bán ròng\n`;
  }
  msg += `\n`;

  // Diễn giải tín hiệu
  const signalStocks = formattedStocks.filter(s => s.pattern);
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

// ─── HELPER FUNCTIONS ───────────────────────────────────

/**
 * Format giá tiền VND (đơn vị: đồng)
 */
function fmtPrice(price) {
  if (!price || price === 0) return '---';
  return price.toLocaleString('vi-VN');
}

/**
 * Format khối lượng giao dịch
 */
function fmtVol(vol) {
  if (!vol) return '0';
  const absVol = Math.abs(vol);
  const sign = vol < 0 ? '-' : '';
  if (absVol >= 1000000) {
    return sign + (absVol / 1000000).toFixed(2) + 'M';
  }
  if (absVol >= 1000) {
    return sign + (absVol / 1000).toFixed(1) + 'K';
  }
  return sign + vol.toLocaleString('vi-VN');
}

/**
 * Format giá trị lớn (VND) ra tỷ/triệu
 */
function fmtBigValue(value) {
  if (!value) return '0đ';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1000000000) return sign + (abs / 1000000000).toFixed(1) + ' tỷ';
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(0) + ' triệu';
  return sign + value.toLocaleString('vi-VN') + 'đ';
}


/**
 * Chia message thành chunks nhỏ (Telegram limit 4096 chars)
 */
function splitMessage(msg, maxLen) {
  if (msg.length <= maxLen) return [msg];

  const chunks = [];
  let remaining = msg;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Tìm vị trí ngắt tốt nhất (2 newline liên tiếp - giữa các stocks)
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }

  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sendTelegramMessage, sendDerivativesMessage, formatStockMessage };
