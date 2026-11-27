/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     🇻🇳  VN STOCK BOT v3.0 — AI STOCK HUNTER T+ & VN30F       ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  CƠ SỞ T+:                                                    ║
 * ║   • 08:45: Refresh Cache D/W/M (131 mã Universe)              ║
 * ║   • 09:30, 11:30, 13:30, 14:00, 14:46: Báo cáo chính T+       ║
 * ║   • Mỗi 15p trong phiên: Quét Delta & Bắt đáy / Tránh xa      ║
 * ║   • Mỗi 45s trong phiên: Fast Position Guardian (SL/T+2)      ║
 * ║   • 15:05: Reconcile EOD & Cập nhật nến Đóng cửa              ║
 * ║   • 21:00: TTCK Quốc tế + Giá Vàng (hàng ngày)                ║
 * ║  PHÁI SINH VN30F: Giữ nguyên toàn bộ engine & Entrade Demo    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const cron = require('node-cron');
const http = require('http');
const { config, validateConfig, isCurrentInstanceActive } = require('./config');
const { sendTelegramMessage, sendDerivativesMessage } = require('./telegramService');
const { runDailyGlobalSummaryReport } = require('./globalMarketService');
const { startBotHandler, stopBotHandler } = require('./botHandler');
const {
  runStockHunterScan,
  runFastPositionGuardian,
  refreshPreMarketCache,
  STOCK_HUNTER_CONFIG,
  SEED_INSTRUMENTS,
} = require('./stock_hunter');
const {
  runAIDerivativesJob,
  runDerivativesOIJob,
  runMarginCutoffJob,
  runPreATCJob,
  runPostATCJob,
  resetDerivativesState,
  startVolumeScalper,
  stopVolumeScalper,
  runEveningPlanJob,
  runIntradaySignalJob,
  resetIntradayState,
  startDerivativeAlerts,
  stopDerivativeAlerts,
} = require('./derivatives');

const startedAt = new Date();
const lastJobRun = {};
const DEDUP_WINDOW = 2 * 60 * 1000;
const jobLastSuccess = {};
const jobLastError = {};
let guardianTimer = null;

function isDuplicate(jobName) {
  const now = Date.now();
  const lastRun = lastJobRun[jobName] || 0;
  if (now - lastRun < DEDUP_WINDOW) return true;
  lastJobRun[jobName] = now;
  return false;
}

function isWeekday() {
  const vnTime = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const day = vnTime.getDay();
  return day >= 1 && day <= 5;
}

async function runDailyGlobalSummaryJob() {
  if (!isCurrentInstanceActive()) return;
  if (isDuplicate('dailyGlobalSummaryJob')) return;
  try {
    await runDailyGlobalSummaryReport();
    jobLastSuccess['dailyGlobalSummaryJob'] = Date.now();
  } catch (error) {
    jobLastError['dailyGlobalSummaryJob'] = { time: Date.now(), message: error.message };
  }
}

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║   🇻🇳  VN STOCK BOT — AI STOCK HUNTER T+ v2.0 & VN30F      ║
  ╠═══════════════════════════════════════════════════════════╣
  ║   📊 Cơ sở T+: 08:45 Cache | 15m Scan | 45s Guardian      ║
  ║   📋 Báo cáo chính: 09:30 | 11:30 | 13:30 | 14:00 | 14:46 ║
  ║   🌍 TTCK+Vàng: 21:00 (Mỗi ngày)                          ║
  ║   🔮 Phái sinh VN30F: Active                              ║
  ╚═══════════════════════════════════════════════════════════╝
  `);

  validateConfig();

  const startupTime = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
  if (isCurrentInstanceActive()) {
    try {
      await sendTelegramMessage(
        `🟢 <b>AI Stock Hunter T+ v${STOCK_HUNTER_CONFIG.schemaVersion} đã khởi động!</b>\n` +
        `🕐 ${startupTime}\n` +
        `📊 Universe: ${SEED_INSTRUMENTS.length} mã | Chế độ: <b>${STOCK_HUNTER_CONFIG.mode.toUpperCase()}</b>\n` +
        `⏰ Báo cáo chính: ${STOCK_HUNTER_CONFIG.market.reports.join(' | ')}\n` +
        `🛡️ Fast Position Guardian: mỗi 45s trong phiên`
      );
      if (config.telegram.chatIdDerivatives && config.telegram.chatIdDerivatives !== config.telegram.chatId) {
        await sendDerivativesMessage(`🔮 <b>VN30F Derivatives Engine đã kết nối!</b> (${startupTime})`);
      }
    } catch (e) {
      console.error('⚠️ Lỗi gửi thông báo khởi động:', e.message);
    }
  }

  // ─── 1. PRE-MARKET CACHE & EOD RECONCILE (CƠ SỞ T+) ─────────
  cron.schedule('45 8 * * 1-5', async () => {
    if (!isCurrentInstanceActive() || !isWeekday()) return;
    if (isDuplicate('shPreMarketCache')) return;
    try {
      await refreshPreMarketCache(true);
      jobLastSuccess['shPreMarketCache'] = Date.now();
    } catch (err) {
      jobLastError['shPreMarketCache'] = { time: Date.now(), message: err.message };
      console.error('❌ [StockHunter 08:45 Cache]:', err.message);
    }
  }, { scheduled: true, timezone: config.timezone });

  cron.schedule('5 15 * * 1-5', async () => {
    if (!isCurrentInstanceActive() || !isWeekday()) return;
    if (isDuplicate('shEodReconcile')) return;
    try {
      await refreshPreMarketCache(true);
      await runStockHunterScan({ label: '15:05 EOD', isMainReport: false, sendTelegram: false });
      jobLastSuccess['shEodReconcile'] = Date.now();
    } catch (err) {
      jobLastError['shEodReconcile'] = { time: Date.now(), message: err.message };
      console.error('❌ [StockHunter 15:05 EOD]:', err.message);
    }
  }, { scheduled: true, timezone: config.timezone });

  // ─── 2. LỊCH QUÉT 15 PHÚT & 5 BÁO CÁO CHÍNH CƠ SỞ T+ ───────
  const stockHunterSlots = [
    { cron: '30 9 * * 1-5',  label: '09:30', main: true },
    { cron: '45 9 * * 1-5',  label: '09:45', main: false },
    { cron: '0 10 * * 1-5',  label: '10:00', main: false },
    { cron: '15 10 * * 1-5', label: '10:15', main: false },
    { cron: '30 10 * * 1-5', label: '10:30', main: false },
    { cron: '45 10 * * 1-5', label: '10:45', main: false },
    { cron: '0 11 * * 1-5',  label: '11:00', main: false },
    { cron: '15 11 * * 1-5', label: '11:15', main: false },
    { cron: '30 11 * * 1-5', label: '11:30', main: true },
    { cron: '15 13 * * 1-5', label: '13:15', main: false },
    { cron: '30 13 * * 1-5', label: '13:30', main: true },
    { cron: '45 13 * * 1-5', label: '13:45', main: false },
    { cron: '0 14 * * 1-5',  label: '14:00', main: true },
    { cron: '15 14 * * 1-5', label: '14:15', main: false },
    { cron: '30 14 * * 1-5', label: '14:30', main: false },
    { cron: '46 14 * * 1-5', label: '14:46', main: true },
  ];

  for (const slot of stockHunterSlots) {
    cron.schedule(slot.cron, async () => {
      if (!isCurrentInstanceActive() || !isWeekday()) return;
      const key = `shScan_${slot.label}`;
      if (isDuplicate(key)) return;
      console.log(`\n📊 [StockHunter ${slot.label}] Bắt đầu quét...`);
      try {
        await runStockHunterScan({ label: slot.label, isMainReport: slot.main, sendTelegram: true });
        jobLastSuccess[key] = Date.now();
      } catch (err) {
        jobLastError[key] = { time: Date.now(), message: err.message };
        console.error(`❌ [StockHunter ${slot.label}]:`, err.message);
      }
    }, { scheduled: true, timezone: config.timezone });
  }

  // ─── 3. FAST POSITION GUARDIAN (45s/lần trong phiên) ────────
  guardianTimer = setInterval(async () => {
    if (!isCurrentInstanceActive() || !isWeekday()) return;
    try {
      await runFastPositionGuardian();
    } catch (e) {
      console.error('⚠️ [FastGuardian]:', e.message);
    }
  }, 45 * 1000);

  // ─── 4. TTCK QUỐC TẾ + VÀNG (21:00 MỖI NGÀY) ─────────────────
  cron.schedule(config.cronGlobalSchedule, runDailyGlobalSummaryJob, {
    scheduled: true,
    timezone: config.timezone,
  });

  // ─── 5. INTERACTIVE TELEGRAM BOT SYNC ────────────────────────
  let lastActiveState = null;
  function syncActiveState() {
    const active = isCurrentInstanceActive();
    if (active === lastActiveState) return;
    lastActiveState = active;
    if (config.enableInteractiveBot) {
      if (active) startBotHandler();
      else stopBotHandler();
    }
  }
  syncActiveState();
  setInterval(syncActiveState, 5 * 60 * 1000);

  // ─── 6. DERIVATIVES VN30F ENGINE (GIỮ NGUYÊN 100% + V10 PPFE) ──
  startVolumeScalper();
  startDerivativeAlerts();

  cron.schedule('59 8 * * 1-5', async () => {
    if (!isCurrentInstanceActive() || !isWeekday()) return;
    try {
      const { getDayManager } = require('./derivatives/volumeScalper');
      await getDayManager().startMorningRoutine();
    } catch (err) {
      console.error('🌅 [Entrade Demo 08:59] Lỗi:', err.message);
    }
  }, { scheduled: true, timezone: config.timezone });

  cron.schedule('0 9 * * 1-5', () => {
    if (!isCurrentInstanceActive() || !isWeekday()) return;
    try {
      resetDerivativesState();
      resetIntradayState();
      startVolumeScalper();
    } catch (err) { console.error('🔮 [Derivatives Reset] Lỗi:', err.message); }
  }, { scheduled: true, timezone: config.timezone });

  const derivSchedules = [
    { cron: '22 9 * * 1-5', fn: () => runAIDerivativesJob('morning'), key: 'aiDerivMorning' },
    { cron: '22 10 * * 1-5', fn: () => runAIDerivativesJob('midmorning'), key: 'aiDerivMid' },
    { cron: '50 13 * * 1-5', fn: () => runAIDerivativesJob('afternoon'), key: 'aiDerivAfter' },
    { cron: '25 14 * * 1-5', fn: runMarginCutoffJob, key: 'derivMargin1425' },
    { cron: '29 14 * * 1-5', fn: runPreATCJob, key: 'derivPreATC' },
    { cron: '44 14 * * 1-5', fn: runPostATCJob, key: 'derivPostATC' },
    { cron: '47 14 * * 1-5', fn: () => runDerivativesOIJob('afternoon'), key: 'derivOIAfter' },
    { cron: '35 19 * * 1-5', fn: () => runDerivativesOIJob('evening'), key: 'derivOIEve' },
    { cron: '50 19 * * 0-4', fn: runEveningPlanJob, key: 'eveningPlan1950', skipWeekdayCheck: true },
  ];
  for (const job of derivSchedules) {
    cron.schedule(job.cron, async () => {
      if (!isCurrentInstanceActive()) return;
      if (!job.skipWeekdayCheck && !isWeekday()) return;
      if (isDuplicate(job.key)) return;
      try {
        await job.fn();
        jobLastSuccess[job.key] = Date.now();
      } catch (err) {
        jobLastError[job.key] = { time: Date.now(), message: err.message };
      }
    }, { scheduled: true, timezone: config.timezone });
  }

  // Intraday VN30F 5p/lần
  const intradaySlots = [];
  for (let m = 10; m <= 55; m += 5) intradaySlots.push(`${m} 9 * * 1-5`);
  for (let m = 0; m <= 55; m += 5) intradaySlots.push(`${m} 10 * * 1-5`);
  for (let m = 0; m <= 30; m += 5) intradaySlots.push(`${m} 11 * * 1-5`);
  for (let m = 5; m <= 55; m += 5) intradaySlots.push(`${m} 13 * * 1-5`);
  for (let m = 0; m <= 20; m += 5) intradaySlots.push(`${m} 14 * * 1-5`);

  for (const expr of intradaySlots) {
    cron.schedule(expr, async () => {
      if (!isCurrentInstanceActive() || !isWeekday()) return;
      try { await runIntradaySignalJob(); } catch (e) { /* ignore */ }
    }, { scheduled: true, timezone: config.timezone });
  }

  // ─── 7. HTTP HEALTH SERVER ───────────────────────────────────
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    const uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        bot: `AI Stock Hunter T+ v${STOCK_HUNTER_CONFIG.schemaVersion}`,
        mode: STOCK_HUNTER_CONFIG.mode,
        active: isCurrentInstanceActive(),
        uptimeSeconds: uptime,
        universeSize: config.stockSymbols.length,
        lastSuccessCount: Object.keys(jobLastSuccess).length,
        lastErrorCount: Object.keys(jobLastError).length,
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h3>VN Stock Bot — AI Stock Hunter T+ v${STOCK_HUNTER_CONFIG.schemaVersion}</h3><p>Mode: ${STOCK_HUNTER_CONFIG.mode} | Uptime: ${uptime}s</p>`);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Health server listening on port ${PORT}`);
  });

  // ─── 8. SELF-PING KEEP-ALIVE (Chống Render Free Tier ngủ đông sau 15p) ──
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_URL || process.env.PING_URL || 'https://vn-stock-bot.onrender.com';
  if (process.env.RENDER || process.env.NODE_ENV === 'production' || process.env.RENDER_EXTERNAL_URL) {
    const axios = require('axios');
    const pingUrl = `${RENDER_URL.replace(/\/+$/, '')}/health`;
    setInterval(() => {
      axios.get(pingUrl, { timeout: 15000 }).then((res) => {
        console.log(`🏓 Self-ping: ${res.status} OK (${new Date().toLocaleTimeString('vi-VN', { timeZone: config.timezone })})`);
      }).catch((err) => {
        console.log(`🏓 Self-ping failed (${pingUrl}): ${err.message}`);
      });
    }, 8 * 60 * 1000);
    console.log(`🏓 Self-ping keep-alive active: ${pingUrl} (mỗi 8 phút)`);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection (prevented crash):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception (prevented crash):', err?.stack || err?.message || err);
});

function shutdown() {
  if (guardianTimer) clearInterval(guardianTimer);
  stopBotHandler();
  stopVolumeScalper();
  stopDerivativeAlerts();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('💥 Fatal startup error:', err);
  process.exit(1);
});
