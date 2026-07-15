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

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`;

/**
 * Gửi message text tới Telegram
 * @param {string} message - Nội dung message (hỗ trợ HTML)
 */
async function sendTelegramMessage(message) {
  try {
    // Telegram giới hạn 4096 ký tự / message
    const chunks = splitMessage(message, 4000);

    for (const chunk of chunks) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: config.telegram.chatId,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
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
 * Format dữ liệu stock thành message Telegram đẹp
 * @param {Array} stocks - Danh sách thông tin stock
 * @returns {string} Message HTML formatted
 */
function formatStockMessage(stocks, liquidity = null) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
  const weekday = new Date().toLocaleDateString('vi-VN', { weekday: 'long', timeZone: config.timezone });

  let msg = '';
  msg += `📊 <b>BÁO CÁO CHỨNG KHOÁN VIỆT NAM</b>\n`;
  msg += `🗓 ${weekday}, ${now}\n`;
  if (liquidity) {
    msg += `💸 <b>Tổng thanh khoản TTCK VN</b>: <code>${liquidity.total.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tỷ</code> (HOSE: ${liquidity.hose.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ, HNX: ${liquidity.hnx.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ, UPCOM: ${liquidity.upcom.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ)\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Phân loại
  const validStocks = stocks.filter(s => !s.error);
  const gainers = validStocks.filter(s => s.change > 0);
  const losers = validStocks.filter(s => s.change < 0);
  const unchanged = validStocks.filter(s => s.change === 0);
  const errors = stocks.filter(s => s.error);

  // Hiển thị từng mã
  for (const stock of stocks) {
    if (stock.error) {
      msg += `⚠️ <b>${stock.symbol}</b> - ${stock.message}\n\n`;
      continue;
    }

    // Icon tăng/giảm
    let trend;
    if (stock.changePct > 6.5) {
      trend = '🟣'; // Trần
    } else if (stock.changePct < -6.5) {
      trend = '🔵'; // Sàn
    } else if (stock.change > 0) {
      trend = '🟢';
    } else if (stock.change < 0) {
      trend = '🔴';
    } else {
      trend = '🟡';
    }

    const arrow = stock.change > 0 ? '▲' : stock.change < 0 ? '▼' : '▬';
    const sign = stock.change > 0 ? '+' : '';

    // Header: Mã + Sàn
    msg += `${trend} <b>${stock.symbol}</b> (${stock.exchange})`;
    msg += ` ${arrow}\n`;

    // Giá & thay đổi
    msg += `💰 <b>${fmtPrice(stock.price)}</b>`;
    msg += ` (${sign}${fmtPrice(stock.change)} | ${sign}${stock.changePct}%)\n`;

    // OHLC
    msg += `📈 O: ${fmtPrice(stock.openPrice)}`;
    msg += ` H: ${fmtPrice(stock.highPrice)}`;
    msg += ` L: ${fmtPrice(stock.lowPrice)}\n`;

    // Khối lượng
    msg += `📦 KLGD: <b>${fmtVol(stock.volume)}</b>`;
    if (stock.avgVolume > 0) {
      const volRatio = (stock.volume / stock.avgVolume * 100).toFixed(0);
      const volIcon = volRatio > 150 ? '🔥' : volRatio > 100 ? '📊' : '📉';
      msg += ` ${volIcon} (TB20: ${fmtVol(stock.avgVolume)} | ${volRatio}%)`;
    }
    msg += `\n`;

    // Khối ngoại
    if (stock.foreignBuy > 0 || stock.foreignSell > 0) {
      const fSign = stock.foreignNet > 0 ? '+' : '';
      const fIcon = stock.foreignNet > 0 ? '💚' : stock.foreignNet < 0 ? '💔' : '💛';
      msg += `${fIcon} NN: M ${fmtVol(stock.foreignBuy)}`;
      msg += ` | B ${fmtVol(stock.foreignSell)}`;
      msg += ` | Ròng: ${fSign}${fmtVol(stock.foreignNet)}\n`;

      // Giá trị tổng giao dịch (tỷ VND)
      const totalTradeVal = (stock.volume || 0) * (stock.price || 0);
      if (totalTradeVal > 0) {
        msg += `💵 Tổng GT GD: ${fmtBigValue(totalTradeVal)}\n`;
      }
    }

    // SMA20 indicator
    if (stock.sma20 > 0) {
      const sma20Pct = ((stock.price - stock.sma20) / stock.sma20 * 100).toFixed(1);
      const sma20Icon = stock.price > stock.sma20 ? '⬆️' : '⬇️';
      const sma20Level = Math.abs(sma20Pct) >= 15 ? '⚡' : Math.abs(sma20Pct) >= 5 ? '🔥' : '';
      msg += `📊 SMA20: ${fmtPrice(stock.sma20)} ${sma20Icon} ${sma20Pct > 0 ? '+' : ''}${sma20Pct}%${sma20Level ? ' ' + sma20Level : ''}\n`;
    }

    // SMA50 indicator
    if (stock.sma50 > 0) {
      const sma50Pct = ((stock.price - stock.sma50) / stock.sma50 * 100).toFixed(1);
      const sma50Icon = stock.price > stock.sma50 ? '⬆️' : '⬇️';
      const sma50Level = Math.abs(sma50Pct) >= 15 ? '⚡' : Math.abs(sma50Pct) >= 5 ? '🔥' : '';
      msg += `📉 SMA50: ${fmtPrice(stock.sma50)} ${sma50Icon} ${sma50Pct > 0 ? '+' : ''}${sma50Pct}%${sma50Level ? ' ' + sma50Level : ''}\n`;
    }

    msg += `\n`;
  }

  // ─── SUMMARY ───────────────────────────────────────────
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 <b>TỔNG KẾT:</b>\n`;
  msg += `🟢 Tăng: ${gainers.length} | 🔴 Giảm: ${losers.length} | 🟡 Đứng: ${unchanged.length}`;
  if (errors.length > 0) msg += ` | ⚠️ Lỗi: ${errors.length}`;
  msg += `\n`;

  // Top tăng / giảm
  if (gainers.length > 0) {
    const topGainer = gainers.sort((a, b) => b.changePct - a.changePct)[0];
    msg += `🏆 Tăng nhất: <b>${topGainer.symbol}</b> (+${topGainer.changePct}%)\n`;
  }
  if (losers.length > 0) {
    const topLoser = losers.sort((a, b) => a.changePct - b.changePct)[0];
    msg += `💣 Giảm nhất: <b>${topLoser.symbol}</b> (${topLoser.changePct}%)\n`;
  }

  // Top khối lượng
  if (validStocks.length > 0) {
    const topVol = [...validStocks].sort((a, b) => b.volume - a.volume)[0];
    msg += `🔥 KL cao nhất: <b>${topVol.symbol}</b> (${fmtVol(topVol.volume)})\n`;
  }

  // Tổng KL giao dịch
  const totalVolume = validStocks.reduce((sum, s) => sum + s.volume, 0);
  msg += `📦 Tổng KLGD: <b>${fmtVol(totalVolume)}</b>\n`;

  msg += `\n<i>📡 Nguồn: VPS | 🤖 VN Stock Bot</i>`;

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

module.exports = { sendTelegramMessage, formatStockMessage };
