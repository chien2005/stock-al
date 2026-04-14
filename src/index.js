/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                                                               ║
 * ║     🇻🇳  VN STOCK BOT v1.1.1  📊                            ║
 * ║     Multi-AI Team System                                      ║
 * ║                                                               ║
 * ║     📊 Báo giá: 10:00 | 13:00 | 16:00  (T2-T6)              ║
 * ║     🤖 AI Report: 20:30                (T2-T6)              ║
 * ║     📅 Weekly: 8:30                    (Thứ 2)              ║
 * ║     💬 Interactive Bot: 24/7 (chat hỏi AI)                  ║
 * ║                                                               ║
 * ║     🤖 AI 1: Trigger + Báo giá  (Gemini 2.5 Flash - Key 1)    ║
 * ║     📊 AI 2: Chuyên gia        (Gemini 2.5 Pro   - Key 2)    ║
 * ║     💬 AI 3: Chuyên gia Flash  (Gemini 2.5 Flash - Key 1)    ║
 * ║     ⚔️  AI 4: Phản biện + Cuối ngày (Gemini 2.5 Pro - Key 2)  ║
 * ║     🔒 Anti-spam: 60s giãn cách giữa 2 lần gọi cùng key       ║
 * ║                                                               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Source: VPS (VPBank Securities) Public API                   ║
 * ║  Stack:  Node.js + node-cron + Google Gemini (FREE)           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const cron = require('node-cron');
const http = require('http');
const { config, validateConfig } = require('./config');
const { fetchAllStocks, fetchVN30Index, fetchMarketScan } = require('./stockService');
const { sendTelegramMessage, formatStockMessage } = require('./telegramService');
const { initAIEngines, runScheduledAnalysis } = require('./aiTeam');
const { runWeeklyAnalysis } = require('./weeklyAnalysis');
const { startBotHandler, stopBotHandler } = require('./botHandler');

// ─── Thời điểm khởi động (cho health check) ─────────────
const startedAt = new Date();

// ─── DATA CACHE: Lưu data cuối phiên (16h) cho report 20h30 ──
let lastStockData = null;
let lastStockDataTime = 0;
let lastMarketScan = null;
let lastVN30Index = null;

// ─── DEDUP LOCK: Chống double message ──────────────────────
const lastJobRun = {};
const DEDUP_WINDOW = 4 * 60 * 1000; // 4 phút (chống double trigger)

/**
 * Check xem job đã chạy trong window chưa (chống double)
 * @param {string} jobName - Tên job
 * @returns {boolean} true nếu đã chạy gần đây (nên skip)
 */
function isDuplicate(jobName) {
  const now = Date.now();
  const lastRun = lastJobRun[jobName] || 0;
  if (now - lastRun < DEDUP_WINDOW) {
    console.log(`⏭️  [DEDUP] ${jobName} đã chạy ${Math.round((now - lastRun) / 1000)}s trước. SKIP!`);
    return true;
  }
  lastJobRun[jobName] = now;
  return false;
}

// ─── GUARD: Check ngày giờ hợp lệ ─────────────────────────

/**
 * Check xem có phải ngày giao dịch không (T2-T6)
 * Runtime check bổ sung cho cron expression
 */
function isWeekday() {
  const now = new Date();
  // Tạo date theo timezone Việt Nam
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  const day = vnTime.getDay(); // 0=CN, 1=T2, ..., 6=T7
  return day >= 1 && day <= 5;
}

/**
 * Check xem có phải thứ 2 không
 */
function isMonday() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  return vnTime.getDay() === 1;
}

// ─── JOB 1: BÁO GIÁ (10h, 13h, 16h T2-T6) ───────────────

async function runStockJob() {
  // Guard: skip nếu không phải ngày giao dịch
  if (!isWeekday()) {
    console.log('⏭️  [GUARD] Hôm nay T7/CN - skip báo giá');
    return;
  }

  // Guard: chống double message
  if (isDuplicate('stockJob')) return;

  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('📊 BÁO GIÁ CHỨNG KHOÁN...');
  console.log('═'.repeat(55));

  try {
    // Fetch stock data + VN30 index song song
    const [stocks, vn30Index] = await Promise.all([
      fetchAllStocks(),
      fetchVN30Index(),
    ]);

    if (stocks.length === 0) {
      console.error('❌ Không lấy được dữ liệu nào!');
      await sendTelegramMessage('⚠️ VN Stock Bot: Không lấy được dữ liệu chứng khoán.');
      return;
    }

    // Cache data cho báo cáo cuối ngày 20h30
    lastStockData = stocks;
    lastStockDataTime = Date.now();
    lastVN30Index = vn30Index;
    console.log('   💾 Đã cache dữ liệu cho báo cáo cuối ngày');

    // Format message với VN30 index
    let message = formatStockMessage(stocks);
    if (vn30Index) {
      let idxMsg = '\n📊 <b>CHỈ SỐ THỊ TRƯỜNG</b>\n';
      if (vn30Index.vn30) {
        const v = vn30Index.vn30;
        const icon = v.changePct > 0 ? '🟢' : v.changePct < 0 ? '🔴' : '🟡';
        const sign = v.changePct >= 0 ? '+' : '';
        idxMsg += `${icon} <b>VN30</b>: ${v.close} (${sign}${v.changePct}%) | KL: ${(v.volume / 1000000).toFixed(0)}M\n`;
      }
      if (vn30Index.vnindex) {
        const v = vn30Index.vnindex;
        const icon = v.changePct > 0 ? '🟢' : v.changePct < 0 ? '🔴' : '🟡';
        const sign = v.changePct >= 0 ? '+' : '';
        idxMsg += `${icon} <b>VNINDEX</b>: ${v.close} (${sign}${v.changePct}%) | KL: ${(v.volume / 1000000).toFixed(0)}M\n`;
      }
      // Chèn trước phần TỔNG KẾT
      message = message.replace('━━━━━━━━━━━━━━━━━━━━━━\n📊 <b>TỔNG KẾT', idxMsg + '\n━━━━━━━━━━━━━━━━━━━━━━\n📊 <b>TỔNG KẾT');
    }
    const sent = await sendTelegramMessage(message);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (sent) {
      console.log(`\n✅ BÁO GIÁ HOÀN THÀNH! (${elapsed}s)`);
      console.log(`   📊 ${stocks.filter(s => !s.error).length}/${stocks.length} mã thành công`);
    } else {
      console.log(`\n⚠️ Lấy dữ liệu OK nhưng gửi Telegram thất bại (${elapsed}s)`);
    }
  } catch (error) {
    console.error('\n💥 LỖI:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi báo giá:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

// ─── JOB 2: AI PHÂN TÍCH CUỐI NGÀY (20h30 T2-T6) ────────
// AI 1 trigger → AI 4 (DeepSeek R1) phân tích → Gửi qua bot AI 4

async function runAiJob() {
  // Guard: skip nếu T7/CN
  if (!isWeekday()) {
    console.log('⏭️  [GUARD] Hôm nay T7/CN - skip AI report');
    return;
  }

  // Guard: chống double
  if (isDuplicate('aiJob')) return;

  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('🤖 AI 1 TRIGGER → AI 4 PHÂN TÍCH CUỐI NGÀY...');
  console.log('═'.repeat(55));

  try {
    // Ưu tiên dùng data từ cache 16h00 (giá cuối phiên chính xác)
    // Chỉ fetch mới nếu chưa có cache trong ngày
    let stocks;
    const cacheAge = Date.now() - lastStockDataTime;
    const MAX_CACHE_AGE = 8 * 60 * 60 * 1000; // 8 tiếng (đủ cho cache từ 10h/13h/16h)

    if (lastStockData && lastStockData.length > 0 && cacheAge < MAX_CACHE_AGE) {
      stocks = lastStockData;
      const cacheTimeStr = new Date(lastStockDataTime).toLocaleString('vi-VN', { timeZone: config.timezone });
      console.log(`   💾 Sử dụng data cache từ ${cacheTimeStr} (${Math.round(cacheAge / 60000)} phút trước)`);
    } else {
      console.log('   ⚠️ Không có cache, fetch data mới...');
      stocks = await fetchAllStocks();
    }

    if (!stocks || stocks.length === 0) {
      console.error('❌ Không có dữ liệu!');
      await sendTelegramMessage('⚠️ VN Stock Bot: Không có dữ liệu để phân tích AI.');
      return;
    }

    // Fetch market scan (dòng tiền toàn thị trường)
    console.log('\n🔍 Quét dòng tiền toàn thị trường...');
    const trackedSymbols = config.stockSymbols;
    const marketScan = await fetchMarketScan(trackedSymbols);
    lastMarketScan = marketScan;

    // Fetch VN30 index nếu chưa có cache
    let vn30Index = lastVN30Index;
    if (!vn30Index) {
      vn30Index = await fetchVN30Index();
    }

    // runScheduledAnalysis với market scan data
    await runScheduledAnalysis(stocks, { marketScan, vn30Index });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ BÁO CÁO CUỐI NGÀY HOÀN THÀNH! (${elapsed}s)`);

  } catch (error) {
    console.error('\n💥 LỖI AI:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi AI analysis:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

// ─── JOB 3: WEEKLY ANALYSIS (8h30 Thứ 2) ──────────────────

async function runWeeklyJob() {
  // Guard: phải là thứ 2
  if (!isMonday()) {
    console.log('⏭️  [GUARD] Không phải thứ 2 - skip weekly report');
    return;
  }

  // Guard: chống double
  if (isDuplicate('weeklyJob')) return;

  console.log('\n' + '═'.repeat(55));
  console.log('📅 PHÂN TÍCH THỊ TRƯỜNG ĐẦU TUẦN...');
  console.log('═'.repeat(55));

  try {
    const report = await runWeeklyAnalysis();
    const sent = await sendTelegramMessage(report);

    if (sent) {
      console.log('\n✅ WEEKLY REPORT HOÀN THÀNH!');
    }
  } catch (error) {
    console.error('\n💥 LỖI WEEKLY:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi weekly analysis:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

// ─── STARTUP ──────────────────────────────────────────────

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🇻🇳  VN STOCK BOT v${config.version}  📊                       ║
  ║   Multi-AI Team System (ALL FREE)                         ║
  ║                                                           ║
  ║   📊 Báo giá:  10:00 | 13:00 | 16:00  (T2-T6)           ║
  ║   🤖 AI Report: 20:30                 (T2-T6)           ║
  ║   📅 Weekly:    8:30                  (Thứ 2)           ║
  ║   💬 Interactive Bot: 24/7                                ║
  ║                                                           ║
  ║   🤖 AI 1: Trigger + Báo giá (Gemini Flash - Key 1)        ║
  ║   📊 AI 2: Chuyên gia        (Gemini Flash - Key 2→1)      ║
  ║   💬 AI 3: Chuyên gia Flash  (Gemini Flash - Key 1)        ║
  ║   ⚔️  AI 4: Phản biện + Cuối ngày (Gemini Flash - Key 2→1)  ║
  ║   🔒 Anti-spam: 15s giãn cách / key                        ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);

  // Validate config
  validateConfig();

  // Init AI engines
  console.log('\n🧠 Khởi tạo AI Engines...');
  initAIEngines();

  console.log('\n📋 Cấu hình:');
  console.log(`   📌 Mã theo dõi:  ${config.stockSymbols.join(', ')}`);
  console.log(`   ⏰ Báo giá:      ${config.cronSchedule}`);
  console.log(`   🤖 AI phân tích: ${config.cronAiSchedule}`);
  console.log(`   📅 Weekly:       ${config.cronWeeklySchedule}`);
  console.log(`   🌏 Timezone:     ${config.timezone}`);
  console.log(`   📩 Chat ID:      ${config.telegram.chatId}`);
  console.log(`   💬 Interactive:  ${config.enableInteractiveBot ? 'ON' : 'OFF'}`);
  const hasKey1 = config.geminiAI1.apiKey;
  const hasKey2 = config.geminiAI2.apiKey;
  console.log(`   🔑 Key 1 (AI 1+3): ${hasKey1 ? '✅ OK' : '❌ Thiếu'}`);
  console.log(`   🔑 Key 2 (AI 2+4): ${hasKey2 ? '✅ OK' : '❌ Thiếu'}`);
  console.log(`   🔒 Anti-spam: 15s giãn cách / key`);
  console.log(`   💾 Cache: Dùng data 16h00 cho báo cáo 20h30`);
  console.log(`   💰 Chi phí: $0 (100% FREE Gemini Flash)`);
  console.log('');

  // Validate cron expressions
  const cronChecks = [
    { name: 'Báo giá', expr: config.cronSchedule },
    { name: 'AI Report', expr: config.cronAiSchedule },
    { name: 'Weekly', expr: config.cronWeeklySchedule },
  ];

  for (const { name, expr } of cronChecks) {
    if (!cron.validate(expr)) {
      console.error(`❌ Cron ${name} không hợp lệ: ${expr}`);
      process.exit(1);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BUG FIX: KHÔNG chạy job khi khởi động (gây noti dư thừa)
  // Railway/Render restart container → trigger noti ngoài giờ
  // ═══════════════════════════════════════════════════════════
  console.log('☁️  Chờ đến giờ schedule (không chạy khi khởi động)...');

  // ─── SCHEDULE JOB 1: BÁO GIÁ (T2-T6, 10h/13h/16h) ────
  cron.schedule(config.cronSchedule, () => {
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n⏰ [Báo giá] Cron triggered: ${now}`);
    runStockJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── SCHEDULE JOB 2: AI REPORT (T2-T6, 20h30) ─────────
  cron.schedule(config.cronAiSchedule, () => {
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n🤖 [AI Analysis] Cron triggered: ${now}`);
    runAiJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── SCHEDULE JOB 3: WEEKLY (Thứ 2, 8h30) ─────────────
  cron.schedule(config.cronWeeklySchedule, () => {
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n📅 [Weekly Analysis] Cron triggered: ${now}`);
    runWeeklyJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── START INTERACTIVE BOT HANDLER ─────────────────────
  if (config.enableInteractiveBot) {
    startBotHandler();
  }

  // ─── HTTP HEALTH SERVER (Render.com keep-alive) ────────
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    const uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
    const vnNow = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

    if (req.url === '/health') {
      // Health check endpoint cho cron-job.org / UptimeRobot
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        bot: `VN Stock Bot v${config.version}`,
        uptime: uptimeStr,
        uptimeSeconds: uptime,
        serverTime: vnNow,
        stocks: config.stockSymbols.length,
        interactive: config.enableInteractiveBot,
      }));
      return;
    }

    // Status page (trang chủ)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <title>VN Stock Bot v${config.version}</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #0f0f23; color: #e0e0e0; 
                 display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .card { background: #1a1a2e; border-radius: 16px; padding: 40px; max-width: 500px;
                  box-shadow: 0 8px 32px rgba(0,0,0,0.4); border: 1px solid #333; }
          h1 { color: #00d4ff; margin-top: 0; }
          .status { color: #00ff88; font-size: 18px; }
          .info { margin: 8px 0; color: #bbb; }
          .badge { display: inline-block; background: #00ff88; color: #000; padding: 4px 12px;
                   border-radius: 12px; font-weight: bold; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🇻🇳 VN Stock Bot</h1>
          <p class="status"><span class="badge">● ONLINE</span> v${config.version}</p>
          <p class="info">⏱ Uptime: ${uptimeStr}</p>
          <p class="info">🕐 Server: ${vnNow}</p>
          <p class="info">📊 Theo dõi: ${config.stockSymbols.length} mã CP</p>
          <p class="info">📋 Schedule: ${config.cronSchedule}</p>
          <p class="info">🤖 AI Report: ${config.cronAiSchedule}</p>
          <p class="info">💬 Interactive: ${config.enableInteractiveBot ? 'ON' : 'OFF'}</p>
          <p class="info">💰 Chi phí: $0 (100% FREE)</p>
          <hr style="border-color:#333">
          <p style="color:#666; font-size:12px">Health check: <a href="/health" style="color:#00d4ff">/health</a></p>
        </div>
      </body>
      </html>
    `);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌐 Health server listening on port ${PORT}`);
    console.log(`   📍 Status page: http://localhost:${PORT}/`);
    console.log(`   💓 Health check: http://localhost:${PORT}/health`);
  });

  console.log('\n' + '─'.repeat(55));
  console.log(`🟢 VN Stock Bot v${config.version} đang chạy!`);
  console.log('');
  console.log('   📊 Báo giá:     ' + config.cronSchedule + ` (${config.timezone})`);
  console.log('   🤖 AI Report:   ' + config.cronAiSchedule + ` (${config.timezone})`);
  console.log('   📅 Weekly:      ' + config.cronWeeklySchedule + ` (${config.timezone})`);
  console.log('   💬 Interactive: ' + (config.enableInteractiveBot ? 'ON (polling)' : 'OFF'));
  console.log('   🌐 Health:      http://localhost:' + PORT + '/health');
  console.log('   📅 Chỉ chạy Thứ 2 → Thứ 6 (có double-check runtime)');
  console.log('   🔒 Dedup lock:  4 phút (chống double message)');
  console.log('   💡 Nhấn Ctrl+C để dừng');
  console.log('─'.repeat(55) + '\n');
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n👋 Bot đang dừng...');
  stopBotHandler();
  console.log('👋 Bot đã dừng. Hẹn gặp lại!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Bot đang dừng (SIGTERM)...');
  stopBotHandler();
  process.exit(0);
});

// Prevent crash on unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
});

// Run!
main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
