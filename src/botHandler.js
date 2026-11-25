/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     💬 VN STOCK BOT - Interactive Bot Handler v3.0            ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Tích hợp AI Stock Hunter T+ (Cơ sở) + VN30F (Phái sinh)      ║
 * ║                                                               ║
 * ║  Commands Cơ sở T+:                                           ║
 * ║  /quet                - Quét toàn bộ Universe ngay            ║
 * ║  /gia <MÃ>            - Xem giá realtime chuẩn hóa VPS        ║
 * ║  /mua <MÃ> <SL> <GIÁ> [SL_STOP] - Ghi nhận fill mua vào sổ    ║
 * ║  /ban <MÃ> <SL> <GIÁ> - Ghi nhận fill bán FIFO                ║
 * ║  /danhmuc             - Xem NAV, tiền mặt, lô T+2 & SL        ║
 * ║                                                               ║
 * ║  Commands Phái sinh: /oi, /atc, /overnight                    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const TelegramBot = require('node-telegram-bot-api');
const { config } = require('./config');
const {
  runStockHunterScan,
  getLedgerService,
  marketDataProvider,
  notifierService,
  getInstrumentMeta,
} = require('./stock_hunter');
const { isLotSettledAt } = require('./stock_hunter/core/calendar');

let bot = null;

function startBotHandler() {
  if (!config.telegram.botToken) {
    console.log('⚠️ Không có TELEGRAM_BOT_TOKEN, bỏ qua bot handler.');
    return null;
  }

  if (bot && bot.isPolling && bot.isPolling()) {
    return bot;
  }

  if (bot) {
    try { bot.stopPolling(); } catch (e) { /* ignore */ }
    bot = null;
  }

  try {
    bot = new TelegramBot(config.telegram.botToken, {
      polling: {
        interval: 2000,
        autoStart: true,
        params: { timeout: 10 },
      },
    });

    bot.onText(/^\/start/, handleStartCommand);
    bot.onText(/^\/help/, handleHelpCommand);
    bot.onText(/^\/gia\s+(.+)/i, handlePriceCommand);
    bot.onText(/^\/quet/i, handleScanCommand);
    bot.onText(/^\/mua\s+(.+)/i, handleBuyFillCommand);
    bot.onText(/^\/ban\s+(.+)/i, handleSellFillCommand);
    bot.onText(/^\/xacnhanhang\s+(.+)/i, handleConfirmBrokerCommand);
    bot.onText(/^\/danhmuc/i, handlePortfolioCommand);
    bot.onText(/^\/(oi|vithe|ps)/i, handleOICommand);
    bot.onText(/^\/(atc|preatc|pre_atc)/i, handlePreATCCommand);
    bot.onText(/^\/(overnight|ato|postatc|post_atc|quadem)/i, handlePostATCCommand);

    bot.on('polling_error', (error) => {
      if (error.code !== 'ETELEGRAM') {
        console.error('❌ Bot polling error:', error.message);
      }
    });

    console.log('💬 Interactive Bot Handler v3.0 đã khởi động (polling mode)');
    return bot;
  } catch (error) {
    console.error('❌ Không thể khởi động Bot Handler:', error.message);
    return null;
  }
}

async function handleStartCommand(msg) {
  await handleHelpCommand(msg);
}

async function handleHelpCommand(msg) {
  const chatId = msg.chat.id;
  const help = `📖 <b>AI STOCK HUNTER v2.0 (T+ CƠ SỞ) & VN30F</b>\n\n` +
    `<b>📌 Lệnh Cơ sở T+:</b>\n` +
    `<code>/quet</code> - Quét toàn bộ Universe (131 mã) ngay\n` +
    `<code>/gia VCB,FPT</code> - Xem giá realtime + spread\n` +
    `<code>/mua VCB 200 62.5 60.0</code> - Ghi nhận mua (MÃ SL GIÁ_NGHÌN [SL_NGHÌN])\n` +
    `<code>/ban VCB 200 66.0</code> - Ghi nhận bán FIFO (MÃ SL GIÁ_NGHÌN)\n` +
    `<code>/danhmuc</code> - Xem NAV, tiền mặt, lô T+2 & Stop\n\n` +
    `<b>📌 Lệnh Phái sinh VN30F:</b>\n` +
    `<code>/oi</code> | <code>/atc</code> | <code>/overnight</code>\n\n` +
    `<b>⏰ Lịch báo cáo T+ tự động:</b>\n` +
    `• 09:30 | 11:30 | 13:30 | 14:00 | 14:46 (T2-T6)\n` +
    `• Quét ngầm 15p/lần + Guardian 45s cho vị thế đang giữ`;

  await bot.sendMessage(chatId, help, { parse_mode: 'HTML' });
}

async function handlePriceCommand(msg, match) {
  const chatId = msg.chat.id;
  const symbols = match[1].toUpperCase().split(/[,\s]+/).filter(Boolean);
  if (symbols.length === 0) return;

  try {
    const exchangeMap = {};
    for (const s of symbols) exchangeMap[s] = getInstrumentMeta(s).exchange;
    const quotes = await marketDataProvider.fetchRealtimeBatch(symbols, exchangeMap);

    let out = `💰 <b>BẢNG GIÁ REALTIME</b>\n`;
    for (const sym of symbols) {
      const q = quotes.get(sym);
      if (!q) {
        out += `⚠️ <b>${sym}</b>: Không có dữ liệu\n`;
        continue;
      }
      const icon = q.changePct > 0 ? '🟢' : q.changePct < 0 ? '🔴' : '🟡';
      const valBil = (q.matchedValueVnd / 1e9).toFixed(1);
      out += `${icon} <b>${sym}</b>: <b>${notifierService.fmtK(q.priceVnd)}</b> (${notifierService.fmtSignedPct(q.changePct)}) | GT: ${valBil} tỷ | Spread: ${q.spreadPct ?? 'N/A'}%\n`;
    }
    await bot.sendMessage(chatId, out, { parse_mode: 'HTML' });
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Lỗi lấy giá: ${error.message}`);
  }
}

async function handleScanCommand(msg) {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, '⏳ Đang chạy AI Stock Hunter Scan toàn Universe...');
  try {
    const result = await runStockHunterScan({ isMainReport: false, sendTelegram: false });
    const report = notifierService.formatMainScanReport(result, 'QUÉT TAY');
    await sendSafeTelegramMessage(chatId, report);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Lỗi quét: ${error.message}`);
  }
}

async function handleBuyFillCommand(msg, match) {
  const chatId = msg.chat.id;
  const parts = match[1].trim().split(/\s+/);
  if (parts.length < 3) {
    await bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/mua VCB 200 62.5 [60.0]</code> (giá nghìn đ)', { parse_mode: 'HTML' });
    return;
  }

  const symbol = parts[0].toUpperCase();
  const qty = parseInt(parts[1], 10);
  const rawPrice = parseFloat(parts[2]);
  const priceVnd = rawPrice < 1000 ? Math.round(rawPrice * 1000) : Math.round(rawPrice);
  const rawStop = parts[3] ? parseFloat(parts[3]) : null;
  const stopVnd = rawStop ? (rawStop < 1000 ? Math.round(rawStop * 1000) : Math.round(rawStop)) : null;

  const ledger = getLedgerService();
  const res = ledger.recordBuyFill({
    symbol,
    qty,
    priceVnd,
    stopVnd,
    strategyId: 'MANUAL',
  });

  if (!res.ok) {
    await bot.sendMessage(chatId, `❌ Không ghi nhận được lệnh mua: <code>${res.reason}</code>`, { parse_mode: 'HTML' });
    return;
  }

  await bot.sendMessage(
    chatId,
    `✅ <b>ĐÃ GHI NHẬN MUA ${res.lot.symbol}</b>\n` +
    `• SL: <b>${res.lot.qty} cp</b> @ <b>${notifierService.fmtK(res.lot.entryPriceVnd)}</b>\n` +
    `• SL kế hoạch: <b>${notifierService.fmtK(res.lot.stopVnd)}</b> | Ngày T+2 về: <b>${res.lot.settleDate}</b>\n` +
    `• Tiền mặt khả dụng còn lại: <b>${(ledger.state.availableCashVnd / 1e6).toFixed(2)} tr</b>`,
    { parse_mode: 'HTML' }
  );
}

async function handleSellFillCommand(msg, match) {
  const chatId = msg.chat.id;
  const parts = match[1].trim().split(/\s+/);
  if (parts.length < 3) {
    await bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/ban VCB 200 66.0</code> (giá nghìn đ)', { parse_mode: 'HTML' });
    return;
  }

  const symbol = parts[0].toUpperCase();
  const qty = parseInt(parts[1], 10);
  const rawPrice = parseFloat(parts[2]);
  const priceVnd = rawPrice < 1000 ? Math.round(rawPrice * 1000) : Math.round(rawPrice);

  const ledger = getLedgerService();
  const res = ledger.recordSellFill({ symbol, qty, priceVnd, reason: 'MANUAL_SELL' });

  if (!res.ok) {
    await bot.sendMessage(chatId, `❌ Không ghi nhận được lệnh bán: <code>${res.reason}</code> (Khả dụng: ${res.available ?? 0} cp)`, { parse_mode: 'HTML' });
    return;
  }

  await bot.sendMessage(
    chatId,
    `✅ <b>ĐÃ GHI NHẬN BÁN ${symbol}</b>\n` +
    `• SL bán: <b>${res.qtySold} cp</b> @ <b>${notifierService.fmtK(priceVnd)}</b>\n` +
    `• PnL ròng (sau phí+thuế): <b>${res.totalNetPnl >= 0 ? '+' : ''}${res.totalNetPnl.toLocaleString('vi-VN')} đ</b>\n` +
    `• Tiền về T+2 ngày: <b>${res.settleDate}</b>`,
    { parse_mode: 'HTML' }
  );
}

async function handleConfirmBrokerCommand(msg, match) {
  const chatId = msg.chat.id;
  const symbol = match[1].trim().toUpperCase();
  const ledger = getLedgerService();
  ledger.confirmBrokerAvailable(symbol, true);
  await bot.sendMessage(chatId, `✅ Đã xác nhận hàng <b>${symbol}</b> khả dụng trên broker.`, { parse_mode: 'HTML' });
}

async function handlePortfolioCommand(msg) {
  const chatId = msg.chat.id;
  const ledger = getLedgerService();
  const snap = ledger.reconcileAt(new Date());
  const now = new Date();

  const lines = [
    `💼 <b>SỔ DANH MỤC T+ (LEDGER)</b>`,
    `• Tiền mặt khả dụng: <b>${(snap.availableCashVnd / 1e6).toFixed(2)} tr</b>`,
    `• Tiền bán chờ T+2: <b>${((snap.pendingReceivableVnd || 0) / 1e6).toFixed(2)} tr</b>`,
    `• Đỉnh NAV: <b>${(snap.navPeakVnd / 1e6).toFixed(2)} tr</b> | Kill Switch: ${snap.killSwitchActive ? '🔴 ON' : '🟢 OFF'}`,
    '',
  ];

  if (snap.positionLots.length === 0) {
    lines.push('<i>Hiện chưa có vị thế mở nào (100% tiền mặt).</i>');
  } else {
    for (const lot of snap.positionLots) {
      const settled = isLotSettledAt(lot, now);
      lines.push(
        `• <b>${lot.symbol}</b> [${lot.strategyId}]: ${lot.qty} cp @ ${notifierService.fmtK(lot.entryPriceVnd)} | ` +
        `SL: <b>${notifierService.fmtK(lot.stopVnd)}</b> | ${settled ? `🟢 Bán được (${lot.availableQty})` : `🟠 Khóa T+2 (về ${lot.settleDate})`}`
      );
    }
  }

  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
}

async function handleOICommand(msg) {
  const chatId = msg.chat.id;
  try {
    const { buildOIEveningNotification } = require('./derivatives/oiTracker');
    const reply = buildOIEveningNotification();
    await bot.sendMessage(chatId, reply, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    await bot.sendMessage(chatId, '❌ Không thể lấy báo cáo OI & Vị thế lúc này.');
  }
}

async function handlePreATCCommand(msg) {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, '⏳ Đang phân tích Realtime trước ATC (NN, Tay to, Đám đông)...');
    const { buildPreATCNotificationAsync } = require('./derivatives/oiTracker');
    const reply = await buildPreATCNotificationAsync();
    await bot.sendMessage(chatId, reply, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    await bot.sendMessage(chatId, '❌ Không thể lấy báo cáo Pre-ATC lúc này.');
  }
}

async function handlePostATCCommand(msg) {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, '⏳ Đang phân tích Realtime chốt ATC & Vị thế qua đêm...');
    const { buildPostATCNotificationAsync } = require('./derivatives/oiTracker');
    const reply = await buildPostATCNotificationAsync();
    await bot.sendMessage(chatId, reply, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    await bot.sendMessage(chatId, '❌ Không thể lấy báo cáo Post-ATC lúc này.');
  }
}

async function sendSafeTelegramMessage(chatId, message) {
  if (!message || message.length === 0) return;
  const maxLen = 4000;
  for (let i = 0; i < message.length; i += maxLen) {
    await bot.sendMessage(chatId, message.substring(i, i + maxLen), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
}

function stopBotHandler() {
  if (bot) {
    try { bot.stopPolling(); } catch (e) { /* ignore */ }
    bot = null;
    console.log('💬 Bot Handler đã dừng (standby mode)');
  }
}

module.exports = { startBotHandler, stopBotHandler };
