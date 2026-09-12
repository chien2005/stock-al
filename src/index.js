/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                                                               ║
 * ║     🇻🇳  VN STOCK BOT v2.0.0  📊                            ║
 * ║     Multi-AI Team + Global Market System                      ║
 * ║                                                               ║
 * ║     📊 Báo giá: 10:00 | 13:00 | 15:01  (T2-T6)              ║
 * ║     🤖 AI Report: 20:30                (T2-T6)              ║
 * ║     🌍 TTCK Quốc tế + Vàng: 21:00    (Mỗi ngày)           ║
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
 * ║  Source: VPS (VPBank Securities) + CNBC API + Vang.Today      ║
 * ║  Stack:  Node.js + node-cron + Google Gemini (FREE)           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const cron = require('node-cron');
const http = require('http');
const { config, validateConfig, isCurrentInstanceActive } = require('./config');
const { fetchAllStocks, fetchVN30Index, fetchMarketScan, fetchTopBoughtStocks, fetchMarketLiquidity } = require('./stockService');
const { sendTelegramMessage, sendDerivativesMessage, formatStockMessage } = require('./telegramService');
const { initAIEngines, runScheduledAnalysis, runDailyGlobalSummaryReport } = require('./aiTeam');
const { runWeeklyAnalysis } = require('./weeklyAnalysis');
const { startBotHandler, stopBotHandler } = require('./botHandler');
const { startAlertMonitor, stopAlertMonitor, resetDailyData, flushBigTradeBuffer } = require('./alertService');
const { runSmartMoneyReport } = require('./smartMoneyReport');
const { runWhaleTrackerReport } = require('./whaleTracker');
const { runDerivativesSignalJob, runMorningDerivativesJob, runMidMorningDerivativesJob, runAfternoonDerivativesJob, runAIDerivativesJob, runDerivativesOIJob, runPreATCJob, runPostATCJob, resetDerivativesState, startMomentumMonitor, startPriceChangeMonitor, stopMomentumMonitor, stopPriceChangeMonitor } = require('./derivatives');

// ─── Thời điểm khởi động (cho health check) ─────────────
const startedAt = new Date();

// ─── DATA CACHE: Lưu data cuối phiên (15h01) cho report 20h30 ──
let lastStockData = null;
let lastStockDataTime = 0;
let lastMarketScan = null;
let lastVN30Index = null;
let lastLiquidity = null;

// ─── DEDUP LOCK: Chống double message ──────────────────────
const lastJobRun = {};
const DEDUP_WINDOW = 2 * 60 * 1000; // 2 phút (chống double trigger)

// ─── JOB TRACKING: Ghi nhận lần chạy cuối của mỗi job ─────
const jobLastSuccess = {};  // { jobName: timestamp }
const jobLastError = {};    // { jobName: { time, message } }

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
  // Guard: check active days
  if (!isCurrentInstanceActive()) return;

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
    // Fetch stock data + VN30 index + liquidity song song
    const [stocks, vn30Index, liquidity] = await Promise.all([
      fetchAllStocks(),
      fetchVN30Index(),
      fetchMarketLiquidity(),
    ]);

    if (stocks.length === 0) {
      console.error('❌ Không lấy được dữ liệu nào!');
      await sendTelegramMessage('⚠️ VN Stock Bot: Không lấy được dữ liệu chứng khoán.');
      jobLastError['stockJob'] = { time: Date.now(), message: 'Không lấy được dữ liệu' };
      return;
    }

    // Fetch tự doanh cho các mã thành công song song
    const { fetchProprietaryTrading } = require('./stockService');
    const validSymbols = stocks.filter(s => !s.error).map(s => s.symbol);
    const propResults = await Promise.all(
      validSymbols.map(sym => fetchProprietaryTrading(sym).catch(() => null))
    );
    const propData = {};
    validSymbols.forEach((sym, idx) => {
      if (propResults[idx]) {
        propData[sym] = propResults[idx];
      }
    });

    // Cache data cho báo cáo cuối ngày 20h30
    lastStockData = stocks;
    lastStockDataTime = Date.now();
    lastVN30Index = vn30Index;
    lastLiquidity = liquidity;
    console.log('   💾 Đã cache dữ liệu cho báo cáo cuối ngày');

    // Format message với VN30 index và tự doanh
    let message = formatStockMessage(stocks, liquidity, vn30Index, propData);
    const sent = await sendTelegramMessage(message);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (sent) {
      jobLastSuccess['stockJob'] = Date.now();
      console.log(`\n✅ BÁO GIÁ HOÀN THÀNH! (${elapsed}s)`);
      console.log(`   📊 ${stocks.filter(s => !s.error).length}/${stocks.length} mã thành công`);
    } else {
      jobLastError['stockJob'] = { time: Date.now(), message: 'Gửi Telegram thất bại' };
      console.log(`\n⚠️ Lấy dữ liệu OK nhưng gửi Telegram thất bại (${elapsed}s)`);
    }
  } catch (error) {
    jobLastError['stockJob'] = { time: Date.now(), message: error.message };
    console.error('\n💥 LỖI:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi báo giá:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

// ─── JOB 1.5: AI PHÂN TÍCH CUỐI PHIÊN (16h05 T2-T6) ──────────
// Chạy ngay sau báo giá 16h, dùng data thật từ VPS (thay cho Gemini scheduled action)
// Gửi data chính xác cho AI phân tích, không dựa vào Google Search (bị sai data)

async function runAfterCloseJob() {
  // Guard: check active days
  if (!isCurrentInstanceActive()) return;

  // Guard: skip T7/CN
  if (!isWeekday()) {
    console.log('⏭️  [GUARD] Hôm nay T7/CN - skip AI cuối phiên');
    return;
  }

  // Guard: chống double
  if (isDuplicate('afterCloseJob')) return;

  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('🧠 AI PHÂN TÍCH CUỐI PHIÊN 16h...');
  console.log('═'.repeat(55));

  try {
    // Dùng data cache từ báo giá 16h (vừa fetch xong 5 phút trước)
    if (!lastStockData || lastStockData.length === 0) {
      console.log('   ⚠️ Không có data cache từ 16h, fetch mới...');
      lastStockData = await fetchAllStocks();
      lastStockDataTime = Date.now();
      lastVN30Index = await fetchVN30Index();
      lastLiquidity = await fetchMarketLiquidity();
    }

    if (!lastStockData || lastStockData.length === 0) {
      console.error('❌ Không có dữ liệu!');
      jobLastError['afterCloseJob'] = { time: Date.now(), message: 'Không có dữ liệu' };
      return;
    }

    // Gọi AI phân tích với data thật
    await runScheduledAnalysis(lastStockData, { vn30Index: lastVN30Index, liquidity: lastLiquidity });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    jobLastSuccess['afterCloseJob'] = Date.now();
    console.log(`\n✅ AI PHÂN TÍCH CUỐI PHIÊN HOÀN THÀNH! (${elapsed}s)`);

  } catch (error) {
    jobLastError['afterCloseJob'] = { time: Date.now(), message: error.message };
    console.error('\n💥 LỖI AI cuối phiên:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi AI cuối phiên:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

const { runTPlusSwingReport } = require('./tPlusSwingSignal');

// ─── JOB 2: AI PHÂN TÍCH ĐẦU TƯ NGẮN HẠN T+ & KIỆT BÁN (20h30 T2-T6) ────────
// Thay thế 3 noti trùng cũ bằng 1 Báo cáo AI T+ Swing Investment tập trung vào Kiệt bán & Tín hiệu kỹ thuật cao

async function runAiJob() {
  // Guard: check active days
  if (!isCurrentInstanceActive()) return;

  // Guard: skip nếu T7/CN
  if (!isWeekday()) {
    console.log('⏭️  [GUARD] Hôm nay T7/CN - skip T+ Swing AI report');
    return;
  }

  // Guard: chống double
  if (isDuplicate('aiJob')) return;

  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('🚀 AI BÁO CÁO ĐẦU TƯ NGẮN HẠN T+ (20h30)...');
  console.log('═'.repeat(55));

  try {
    await runTPlusSwingReport();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    jobLastSuccess['aiJob'] = Date.now();
    console.log(`\n✅ BÁO CÁO T+ SWING 20H30 HOÀN THÀNH! (${elapsed}s)`);
  } catch (error) {
    jobLastError['aiJob'] = { time: Date.now(), message: error.message };
    console.error('\n💥 LỖI AI T+ Swing:', error.message);
  }
}

// ─── JOB 3: WEEKLY ANALYSIS (8h30 Thứ 2) ──────────────────

async function runWeeklyJob() {
  // Guard: check active days
  if (!isCurrentInstanceActive()) return;

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
      jobLastSuccess['weeklyJob'] = Date.now();
      console.log('\n✅ WEEKLY REPORT HOÀN THÀNH!');
    }
  } catch (error) {
    jobLastError['weeklyJob'] = { time: Date.now(), message: error.message };
    console.error('\n💥 LỖI WEEKLY:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi weekly analysis:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}

// ─── JOB 4: BÁO CÁO TTCK QUỐC TẾ + GIÁ VÀNG (21h00 MỖI NGÀY) ───
// Lấy chỉ số TTCK Trung Quốc, Mỹ, Hàn, Indo, Thái, Nhật...
// + Giá vàng thế giới + Giá vàng Việt Nam (1 lượng, 1 chỉ)

async function runDailyGlobalSummaryJob() {
  // Guard: check active days
  if (!isCurrentInstanceActive()) return;

  // KHÔNG check weekday - chạy mỗi ngày kể cả T7/CN

  // Guard: chống double
  if (isDuplicate('dailyGlobalSummaryJob')) return;

  const startTime = Date.now();
  console.log('\n' + '═'.repeat(55));
  console.log('🌍 BÁO CÁO TTCK QUỐC TẾ + GIÁ VÀNG...');
  console.log('═'.repeat(55));

  try {
    await runDailyGlobalSummaryReport();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    jobLastSuccess['dailyGlobalSummaryJob'] = Date.now();
    console.log(`\n✅ BÁO CÁO TTCK QUỐC TẾ + VÀNG HOÀN THÀNH! (${elapsed}s)`);

  } catch (error) {
    jobLastError['dailyGlobalSummaryJob'] = { time: Date.now(), message: error.message };
    console.error('\n💥 LỖI TTCK QUỐC TẾ + VÀNG:', error.message);
    try {
      await sendTelegramMessage(`💥 VN Stock Bot lỗi báo cáo TTCK quốc tế + vàng:\n<code>${error.message}</code>`);
    } catch (e) { /* ignore */ }
  }
}



// ─── STARTUP ──────────────────────────────────────────────

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🇻🇳  VN STOCK BOT v${config.version}  📊                       ║
  ║   Multi-AI Team + Global Market (ALL FREE)                ║
  ║                                                           ║
  ║   📊 Báo giá:  10:00 | 13:00 | 15:01  (T2-T6)           ║
  ║   🤖 AI Report: 20:30                 (T2-T6)           ║
  ║   🌍 TTCK+Vàng: 21:00                 (Mỗi ngày)        ║
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
  console.log(`   ⚙️ AI Cuối phiên: ${config.cronAfterCloseSchedule}`);
  console.log(`   🤖 AI phân tích: ${config.cronAiSchedule}`);
  console.log(`   🌍 TTCK+Vàng:    ${config.cronGlobalSchedule}`);
  console.log(`   📅 Weekly:       ${config.cronWeeklySchedule}`);
  console.log(`   🌏 Timezone:     ${config.timezone}`);
  console.log(`   📩 Chat ID:      ${config.telegram.chatId}`);
  console.log(`   💬 Interactive:  ${config.enableInteractiveBot ? 'ON' : 'OFF'}`);
  const hasKey1 = config.geminiAI1.apiKey;
  const hasKey2 = config.geminiAI2.apiKey;
  console.log(`   🔑 Key 1 (AI 1+3): ${hasKey1 ? '✅ OK' : '❌ Thiếu'}`);
  console.log(`   🔑 Key 2 (AI 2+4): ${hasKey2 ? '✅ OK' : '❌ Thiếu'}`);
  console.log(`   🔒 Anti-spam: 15s giãn cách / key`);
  console.log(`   💾 Cache: Dùng data 15h01 cho báo cáo 20h30`);
  console.log(`   💰 Chi phí: $0 (100% FREE Gemini Flash + CNBC API)`);
  console.log('');

  // Validate cron expressions
  const cronChecks = [
    { name: 'Báo giá', expr: config.cronSchedule },
    { name: 'Báo giá kết phiên', expr: config.cronCloseSchedule },
    { name: 'AI Cuối phiên', expr: config.cronAfterCloseSchedule },
    { name: 'AI Report', expr: config.cronAiSchedule },
    { name: 'TTCK+Vàng', expr: config.cronGlobalSchedule },
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

  // ─── GỬI THÔNG BÁO KHỞI ĐỘNG VỀ TELEGRAM (CHỈ GỬI KHI ACTIVE) ─────────────
  const startupTime = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
  if (isCurrentInstanceActive()) {
    try {
      await sendTelegramMessage(
        `🟢 <b>VN Stock Bot v${config.version} đã khởi động! (Nhóm Cơ Sở)</b>\n` +
        `🕐 ${startupTime}\n` +
        `📊 Theo dõi: ${config.stockSymbols.length} mã\n` +
        `📅 Ngày hoạt động: <b>${config.activeDays}</b> (ACTIVE)\n` +
        `⏰ Báo giá: ${config.cronSchedule}\n` +
        `🤖 AI Report: ${config.cronAiSchedule}\n` +
        `🌍 TTCK+Vàng: ${config.cronGlobalSchedule} (mỗi ngày)\n` +
        `💬 Interactive: ${config.enableInteractiveBot ? 'ON' : 'OFF'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Nếu bạn thấy tin này nhiều lần → bot đang bị restart liên tục!</i>`
      );

      if (config.telegram.chatIdDerivatives && config.telegram.chatIdDerivatives !== config.telegram.chatId) {
        await sendDerivativesMessage(
          `🔮 <b>VN Stock Bot v${config.version} đã kết nối! (Nhóm Phái Sinh VN30F)</b>\n` +
          `🕐 ${startupTime}\n` +
          `📊 Chế độ: <b>Tín hiệu Phái Sinh v4.3 (Bản Đồ Giá & 8 Lớp Phân Tích)</b>\n` +
          `📅 Ngày hoạt động: <b>${config.activeDays}</b> (ACTIVE)\n` +
          `⏰ Tín hiệu: 9h05 - 14h45 (bắn khi biến động ≥4đ, realtime)\n` +
          `🤖 AI Phái sinh: 9h22 | 10h22 | 13h50\n` +
          `⚡ Pre-ATC (Vào ATC hay không?): 14h29\n` +
          `🌙 Post-ATC (Cầm qua đêm hay Đóng?): 14h44\n` +
          `📊 OI Sơ bộ sau ATC: 14h47\n` +
          `📊 OI & Basis (Chính thức HNX/VSDC): 19h35\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>Kênh chuyên biệt phân tích & tín hiệu phái sinh realtime 24/24</i>`
        );
      }
      console.log('📩 Đã gửi thông báo khởi động về Telegram');
    } catch (e) {
      console.error('⚠️ Không gửi được thông báo khởi động:', e.message);
    }
  } else {
    console.log(`⏸️ [STANDBY] Instance ngoài ngày hoạt động (${config.activeDays}) — Chờ đến lượt xoay tua.`);
  }

  // ─── SCHEDULE JOB 1: BÁO GIÁ (T2-T6, 10h) ────
  cron.schedule(config.cronSchedule, () => {
    if (!isCurrentInstanceActive()) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n⏰ [Báo giá] Cron triggered: ${now}`);
    runStockJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── SCHEDULE JOB 1a: BÁO GIÁ TRONG PHIÊN (T2-T6, 13h35/14h10/14h40) ────
  const intradaySchedules = [
    { cron: '35 13 * * 1-5', label: '13:35' },
    { cron: '10 14 * * 1-5', label: '14:10' },
    { cron: '40 14 * * 1-5', label: '14:40' },
  ];
  for (const schedule of intradaySchedules) {
    cron.schedule(schedule.cron, () => {
      if (!isCurrentInstanceActive()) return;
      const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
      console.log(`\n⏰ [Báo giá ${schedule.label}] Cron triggered: ${now}`);
      runStockJob();
    }, { scheduled: true, timezone: config.timezone });
  }

  // ─── SCHEDULE JOB 1b: BÁO GIÁ KẾT PHIÊN (T2-T6, 15h01) ────
  cron.schedule(config.cronCloseSchedule, () => {
    if (!isCurrentInstanceActive()) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n⏰ [Báo giá kết phiên] Cron triggered: ${now}`);
    runStockJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── SCHEDULE JOB 2: AI REPORT (T2-T6, 20h30) ─────────
  cron.schedule(config.cronAiSchedule, () => {
    if (!isCurrentInstanceActive()) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n🤖 [AI Analysis] Cron triggered: ${now}`);
    runAiJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── SCHEDULE JOB 3: WEEKLY (Thứ 2, 8h30) ─────────────
  cron.schedule(config.cronWeeklySchedule, () => {
    if (!isCurrentInstanceActive()) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n📅 [Weekly Analysis] Cron triggered: ${now}`);
    runWeeklyJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── SCHEDULE JOB 4: TTCK QUỐC TẾ + VÀNG (MỖI NGÀY, 21h00) ────
  cron.schedule(config.cronGlobalSchedule, () => {
    if (!isCurrentInstanceActive()) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n🌍 [TTCK+Vàng] Cron triggered: ${now}`);
    runDailyGlobalSummaryJob();
  }, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── DYNAMIC INTERACTIVE BOT & ACTIVE STATE SYNCHRONIZATION ──
  let lastActiveState = null;

  function syncActiveState() {
    const active = isCurrentInstanceActive();
    if (active === lastActiveState) return;
    lastActiveState = active;

    if (config.enableInteractiveBot) {
      if (active) {
        startBotHandler();
      } else {
        stopBotHandler();
      }
    }
  }

  // Khởi động đồng bộ ban đầu
  syncActiveState();

  // Kiểm tra mỗi 5 phút để tự động chuyển giao giữa các ngày xoay tua
  setInterval(() => {
    syncActiveState();
  }, 5 * 60 * 1000);

  // ─── START ALERT MONITOR (cảnh báo giao dịch bất thường) ───
  startAlertMonitor();

  // ─── START DERIVATIVES MONITORS (chạy cả khi khởi động lại trong phiên) ───
  startMomentumMonitor();
  startPriceChangeMonitor();

  // Reset alert data mỗi ngày lúc 9:00 (trước phiên)
  cron.schedule('0 9 * * 1-5', () => {
    if (!isCurrentInstanceActive()) return;
    resetDailyData();
  }, { scheduled: true, timezone: config.timezone });

  // ─── SCHEDULE: FLUSH GIAO DỊCH LỚN (11h, 13h35, 14h10, 14h40 T2-T6) ───
  // Gom tất cả lệnh >= 5 tỷ rồi gửi tổng hợp 1 lần, tránh spam
  const bigTradeFlushSchedules = [
    { cron: '0 11 * * 1-5', label: '11:00' },
    { cron: '35 13 * * 1-5', label: '13:35' },
    { cron: '10 14 * * 1-5', label: '14:10' },
    { cron: '40 14 * * 1-5', label: '14:40' },
  ];

  for (const schedule of bigTradeFlushSchedules) {
    cron.schedule(schedule.cron, async () => {
      if (!isCurrentInstanceActive()) return;
      console.log(`\n📦 [BigTrade Flush ${schedule.label}] Cron triggered`);
      try {
        await flushBigTradeBuffer();
      } catch (err) {
        console.error(`📦 [BigTrade Flush ${schedule.label}] Lỗi:`, err.message);
      }
    }, { scheduled: true, timezone: config.timezone });
  }
  console.log('   📦 BigTrade Flush: 11:00 | 13:35 | 14:10 | 14:40 (T2-T6, ≥5 tỷ)');

  // ─── SCHEDULE: WHALE TRACKER REPORT (T2-T6, 19h45) ───
  cron.schedule('45 19 * * 1-5', async () => {
    if (!isCurrentInstanceActive()) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n🐋 [Whale Tracker] Cron triggered: ${now}`);
    try {
      await runWhaleTrackerReport();
    } catch (err) {
      console.error('🐋 [Whale Tracker] Lỗi:', err.message);
    }
  }, { scheduled: true, timezone: config.timezone });
  console.log('   🐋 Whale Tracker: 19:45 (T2-T6)');

  // ─── SCHEDULE: DERIVATIVES SIGNAL — RESET & START MONITORS 9h00 ───
  cron.schedule('0 9 * * 1-5', async () => {
    if (!isCurrentInstanceActive()) return;
    if (!isWeekday()) return;
    console.log('\n🔮 [Derivatives v4.3] Reset daily state & start monitors');
    try { 
      resetDerivativesState();
      startMomentumMonitor();
      startPriceChangeMonitor();
    } catch (err) { console.error('🔮 [Derivatives Reset] Lỗi:', err.message); }
  }, { scheduled: true, timezone: config.timezone });

  // ─── DERIVATIVES SIGNAL: PRICE-CHANGE BASED (thay thế cron 5p cố định) ───
  // Monitor được start lúc 9h00 ở trên, poll giá mỗi 10s
  // Bắn noti khi VN30F1M biến động >= 3 điểm so với lần noti trước
  // Noti đầu phiên tự động bắn lúc ~9h05 (baseline)
  console.log('   🔮 Derivatives Signal v4.3: Price-Change Monitor (≥3đ trigger, poll 10s, critical windows boosted)');

  // ─── SCHEDULE: AI DERIVATIVES FORECAST (9h22, 10h22 & 13h50, T2-T6) ───
  cron.schedule('22 9 * * 1-5', async () => {
    if (!isWeekday()) return;
    if (isDuplicate('aiDerivativesMorning')) return;
    console.log(`\n🤖 [AI Derivatives Morning v4.0] Cron triggered`);
    try {
      await runAIDerivativesJob('morning');
      jobLastSuccess['aiDerivativesMorning'] = Date.now();
    } catch (err) {
      console.error('🤖 [AI Derivatives Morning] Lỗi:', err.message);
    }
  }, { scheduled: true, timezone: config.timezone });

  cron.schedule('22 10 * * 1-5', async () => {
    if (!isWeekday()) return;
    if (isDuplicate('aiDerivativesMidMorning')) return;
    console.log(`\n🤖 [AI Derivatives Mid-Morning v4.0] Cron triggered`);
    try {
      await runAIDerivativesJob('midmorning');
      jobLastSuccess['aiDerivativesMidMorning'] = Date.now();
    } catch (err) {
      console.error('🤖 [AI Derivatives Mid-Morning] Lỗi:', err.message);
    }
  }, { scheduled: true, timezone: config.timezone });

  cron.schedule('50 13 * * 1-5', async () => {
    if (!isWeekday()) return;
    if (isDuplicate('aiDerivativesAfternoon')) return;
    console.log(`\n🤖 [AI Derivatives Afternoon v4.0] Cron triggered`);
    try {
      await runAIDerivativesJob('afternoon');
      jobLastSuccess['aiDerivativesAfternoon'] = Date.now();
    } catch (err) {
      console.error('🤖 [AI Derivatives Afternoon] Lỗi:', err.message);
    }
  }, { scheduled: true, timezone: config.timezone });
  console.log('   🤖 AI Derivatives Forecast: 9:22, 10:22 & 13:50 (T2-T6)');

  // ─── SCHEDULE: DERIVATIVES PRE-ATC REALTIME (14h29 T2-T6) ────
  // Quyết định realtime: Có nên mở vị thế để vào ATC hay không?
  // Cảnh báo chốt lệnh trước 14h29 nếu thanh khoản cạn kiệt, tay to đóng bớt HĐ, ảm đạm
  cron.schedule('29 14 * * 1-5', async () => {
    if (!isWeekday()) return;
    if (isDuplicate('derivativesPreATC_1429')) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n⚡ [Derivatives Pre-ATC 14h29] Cron triggered: ${now}`);
    try {
      await runPreATCJob();
      jobLastSuccess['derivativesPreATC_1429'] = Date.now();
    } catch (err) {
      console.error('⚡ [Derivatives Pre-ATC 14h29] Lỗi:', err.message);
      jobLastError['derivativesPreATC_1429'] = { time: Date.now(), message: err.message };
    }
  }, { scheduled: true, timezone: config.timezone });
  console.log('   ⚡ Derivatives Pre-ATC (Vào ATC hay không?): 14:29 (T2-T6)');

  // ─── SCHEDULE: DERIVATIVES POST-ATC / OVERNIGHT (14h44 T2-T6) ─
  // Quyết định realtime: Có nên giữ vị thế qua đêm vào ATO hay đóng chốt lời/lỗ luôn?
  // Cảnh báo đóng hết (Flat) nếu thanh khoản cạn kiệt, thị trường ảm đạm, tay to không găm vị thế
  cron.schedule('44 14 * * 1-5', async () => {
    if (!isWeekday()) return;
    if (isDuplicate('derivativesPostATC_1444')) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n🌙 [Derivatives Post-ATC 14h44] Cron triggered: ${now}`);
    try {
      await runPostATCJob();
      jobLastSuccess['derivativesPostATC_1444'] = Date.now();
    } catch (err) {
      console.error('🌙 [Derivatives Post-ATC 14h44] Lỗi:', err.message);
      jobLastError['derivativesPostATC_1444'] = { time: Date.now(), message: err.message };
    }
  }, { scheduled: true, timezone: config.timezone });
  console.log('   🌙 Derivatives Post-ATC (Cầm qua đêm hay Đóng?): 14:44 (T2-T6)');

  // ─── SCHEDULE: DERIVATIVES OI & TAY TO TRACKER (14h47 T2-T6 - Sơ bộ sau ATC) ─
  // Báo cáo sơ bộ vị thế 3 phe, Khối ngoại chốt phiên, bảng 5 phiên ngay sau khi đóng cửa ATC 2 phút
  cron.schedule('47 14 * * 1-5', async () => {
    if (!isWeekday()) return;
    if (isDuplicate('derivativesOI_afternoon_1447')) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n📊 [Derivatives OI Afternoon 14h47] Cron triggered: ${now}`);
    try {
      await runDerivativesOIJob('afternoon');
      jobLastSuccess['derivativesOI_afternoon_1447'] = Date.now();
    } catch (err) {
      console.error('📊 [Derivatives OI Afternoon 14h47] Lỗi:', err.message);
      jobLastError['derivativesOI_afternoon_1447'] = { time: Date.now(), message: err.message };
    }
  }, { scheduled: true, timezone: config.timezone });
  console.log('   📊 Derivatives OI Sơ bộ sau ATC: 14:47 (T2-T6)');

  // ─── SCHEDULE: DERIVATIVES OI & TAY TO TRACKER (19h35 T2-T6) ─
  // Báo cáo vị thế qua đêm Khối ngoại, Tự doanh, Tổng OI 5 ngày gần nhất
  cron.schedule('35 19 * * 1-5', async () => {
    if (!isWeekday()) return;
    if (isDuplicate('derivativesOI_evening')) return;
    const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
    console.log(`\n📊 [Derivatives OI Evening 19h35] Cron triggered: ${now}`);
    try {
      await runDerivativesOIJob('evening');
      jobLastSuccess['derivativesOI_evening'] = Date.now();
    } catch (err) {
      console.error('📊 [Derivatives OI Evening] Lỗi:', err.message);
      jobLastError['derivativesOI_evening'] = { time: Date.now(), message: err.message };
    }
  }, { scheduled: true, timezone: config.timezone });
  console.log('   📊 Derivatives OI & Tay To Tracker: 19:35 (T2-T6)');

  // ─── HEARTBEAT: Gửi "đang sống" mỗi ngày 9:00 T2-T6 ───────
  // DISABLED: Bỏ tin nhắn heartbeat hàng ngày theo yêu cầu của user
  /*
  cron.schedule('0 9 * * 1-5', async () => {
    try {
      const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
      const uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

      // Tổng hợp trạng thái jobs
      let jobStatus = '';
      const jobs = ['stockJob', 'afterCloseJob', 'aiJob', 'dailyGlobalSummaryJob', 'weeklyJob'];
      const jobNames = ['Báo giá', 'AI Cuối phiên', 'AI Report', 'TTCK+Vàng', 'Weekly'];
      for (let i = 0; i < jobs.length; i++) {
        const last = jobLastSuccess[jobs[i]];
        const err = jobLastError[jobs[i]];
        if (last) {
          const ago = Math.round((Date.now() - last) / 3600000);
          jobStatus += `   ✅ ${jobNames[i]}: ${ago}h trước\n`;
        } else if (err) {
          jobStatus += `   ❌ ${jobNames[i]}: LỖI - ${err.message.substring(0, 50)}\n`;
        } else {
          jobStatus += `   ⏳ ${jobNames[i]}: chưa chạy\n`;
        }
      }

      await sendTelegramMessage(
        `💓 <b>HEARTBEAT - Bot đang hoạt động</b>\n` +
        `...`
      );
      console.log('💓 Heartbeat sent');
    } catch (e) {
      console.error('💓 Heartbeat error:', e.message);
    }
  }, { scheduled: true, timezone: config.timezone });
  */

  // ─── HTTP HEALTH SERVER (Render.com keep-alive) ────────
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    const uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
    const vnNow = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });

    const isActive = isCurrentInstanceActive();
    const currentDay = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone })).getDate();

    if (req.url === '/health') {
      // Health check endpoint cho cron-job.org / UptimeRobot
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        bot: `VN Stock Bot v${config.version}`,
        instanceStatus: isActive ? 'active' : 'standby',
        activeDays: config.activeDays,
        currentDay: currentDay,
        uptime: uptimeStr,
        uptimeSeconds: uptime,
        serverTime: vnNow,
        startedAt: startedAt.toISOString(),
        stocks: config.stockSymbols.length,
        stockSymbols: config.stockSymbols,
        interactive: config.enableInteractiveBot && isActive,
        jobs: {
          lastSuccess: Object.fromEntries(
            Object.entries(jobLastSuccess).map(([k, v]) => [k, new Date(v).toISOString()])
          ),
          lastError: Object.fromEntries(
            Object.entries(jobLastError).map(([k, v]) => [k, { time: new Date(v.time).toISOString(), message: v.message }])
          ),
        },
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
          .status { font-size: 18px; }
          .info { margin: 8px 0; color: #bbb; }
          .badge-active { display: inline-block; background: #00ff88; color: #000; padding: 4px 12px;
                   border-radius: 12px; font-weight: bold; font-size: 14px; }
          .badge-standby { display: inline-block; background: #ffaa00; color: #000; padding: 4px 12px;
                   border-radius: 12px; font-weight: bold; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🇻🇳 VN Stock Bot</h1>
          <p class="status">
            <span class="${isActive ? 'badge-active' : 'badge-standby'}">● ${isActive ? 'ACTIVE (Đang chạy)' : 'STANDBY (Chờ xoay tua)'}</span>
            v${config.version}
          </p>
          <p class="info">📅 Ngày hoạt động: <b>${config.activeDays}</b> (Hôm nay: Ngày ${currentDay})</p>
          <p class="info">⏱ Uptime: ${uptimeStr}</p>
          <p class="info">🕐 Server: ${vnNow}</p>
          <p class="info">📊 Theo dõi: ${config.stockSymbols.length} mã CP</p>
          <p class="info">📋 Schedule: ${config.cronSchedule}</p>
          <p class="info">🤖 AI Report: ${config.cronAiSchedule}</p>
          <p class="info">💬 Interactive: ${config.enableInteractiveBot && isActive ? 'ON' : 'OFF'}</p>
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

  // ─── SELF-PING: Chống Render Free Tier ngủ (tự ping mỗi 8 phút) ──
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_URL;
  if (RENDER_URL || process.env.RENDER || process.env.NODE_ENV === 'production') {
    const https = require('https');
    const pingUrl = RENDER_URL 
      ? `${RENDER_URL}/health` 
      : `https://stock-al-yoq4.onrender.com/health`;
    const PING_INTERVAL = 8 * 60 * 1000; // 8 phút (chống Render ngủ đông sau 15p)
    
    setInterval(() => {
      https.get(pingUrl, (res) => {
        console.log(`🏓 Self-ping: ${res.statusCode} OK (${new Date().toLocaleTimeString('vi-VN', { timeZone: config.timezone })})`);
      }).on('error', (err) => {
        console.log(`🏓 Self-ping failed: ${err.message}`);
      });
    }, PING_INTERVAL);
    
    console.log(`   🏓 Self-ping: ${pingUrl} (mỗi 8 phút)`);
  }

  console.log('\n' + '─'.repeat(55));
  console.log(`🟢 VN Stock Bot v${config.version} đang chạy!`);
  console.log('');
  console.log('   📊 Báo giá:     ' + config.cronSchedule + ` (${config.timezone})`);
  console.log('   📊 Kết phiên:   ' + config.cronCloseSchedule + ` (${config.timezone})`);
  console.log('   🧠 AI Cuối phiên:' + config.cronAfterCloseSchedule + ` (${config.timezone})`);
  console.log('   🤖 AI Report:   ' + config.cronAiSchedule + ` (${config.timezone})`);
  console.log('   🌍 TTCK+Vàng:   ' + config.cronGlobalSchedule + ` (${config.timezone}) [MỖI NGÀY]`);
  console.log('   📅 Weekly:      ' + config.cronWeeklySchedule + ` (${config.timezone})`);
  console.log('   💬 Interactive: ' + (config.enableInteractiveBot ? 'ON (polling)' : 'OFF'));
  console.log('   🌐 Health:      http://localhost:' + PORT + '/health');
  console.log('   📅 Báo giá/AI: Thứ 2 → Thứ 6 | TTCK+Vàng: Mỗi ngày');
  console.log('   🔒 Dedup lock:  4 phút (chống double message)');
  console.log('   🔮 Derivatives: Price-Change Monitor (≥4đ, poll 30s)');
  console.log('   💡 Nhấn Ctrl+C để dừng');
  console.log('─'.repeat(55) + '\n');
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n👋 Bot đang dừng...');
  stopBotHandler();
  stopAlertMonitor();
  stopMomentumMonitor();
  stopPriceChangeMonitor();
  console.log('👋 Bot đã dừng. Hẹn gặp lại!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Bot đang dừng (SIGTERM)...');
  stopBotHandler();
  stopAlertMonitor();
  stopMomentumMonitor();
  stopPriceChangeMonitor();
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
