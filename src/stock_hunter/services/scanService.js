/**
 * AI STOCK HUNTER - Scan Orchestrator & Position Guardian Runner
 * Điều phối toàn bộ chu trình quét 15 phút, pre-market cache và Guardian fast-poll 30-60s.
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { SEED_INSTRUMENTS, getInstrumentMeta } = require('../config/universeSeed');
const { toVnComponents, sessionAt, isTradingDay } = require('../core/calendar');
const {
  refreshDailyCache,
  loadDailyCache,
  fetchRealtimeBatch,
  fetchIntraday15mBatch,
  fetchMarketIndicesSnapshot,
  aggregateTimeframeBars,
} = require('../data/marketDataProvider');
const { buildActiveUniverse } = require('../engines/universe');
const { runDecisionPipeline } = require('../engines/decisionEngine');
const { evaluateExitForSymbol } = require('../engines/exitEngine');
const { LedgerService } = require('./ledgerService');
const { StateStore } = require('./stateStore');
const { formatMainScanReport, formatUrgentExitAlert } = require('./notifierService');
const { sendTelegramMessage } = require('../../telegramService');

let _ledgerService = null;
let _stateStore = null;

function getLedgerService() {
  if (!_ledgerService) _ledgerService = new LedgerService();
  return _ledgerService;
}

function getStateStore() {
  if (!_stateStore) _stateStore = new StateStore();
  return _stateStore;
}

async function refreshPreMarketCache(force = true) {
  console.log('\n🌅 [StockHunter] Cập nhật Cache D/W/M cho Universe...');
  const cache = await refreshDailyCache(SEED_INSTRUMENTS, force);
  console.log(`   ✅ Đã cache ${Object.keys(cache.barsBySymbol || {}).length} mã.`);
  return cache;
}

/**
 * Sơ loại ứng viên cần lấy nến 15m (tránh gọi 150 request 15m mỗi chu kỳ)
 */
function selectIntraday15mCandidates(universeResult, quotesBySymbol, ledgerSnapshot, stateData, maxCandidates = 25) {
  const mustInclude = new Set();

  // Luôn lấy 15m cho mã đang giữ và mã trong Special Watchlist
  for (const lot of ledgerSnapshot.positionLots || []) {
    if (lot.qty > 0) mustInclude.add(lot.symbol);
  }
  for (const [sym, ep] of Object.entries(stateData.specialWatchBySymbol || {})) {
    if (ep && !['B7_FAILED', 'B7_EXPIRED'].includes(ep.state)) {
      mustInclude.add(sym);
    }
  }

  // Chấm điểm sơ loại nhanh từ realtime quote cho nhóm eligible
  const scored = [];
  for (const inst of universeResult.eligible) {
    if (mustInclude.has(inst.symbol)) continue;
    const q = quotesBySymbol.get(inst.symbol);
    if (!q || q.quality !== 'VALID') continue;
    const absChg = Math.abs(q.changePct || 0);
    const valBil = (q.matchedValueVnd || 0) / 1e9;
    const liqBoost = inst.medianValue20Bil > 0 ? valBil / inst.medianValue20Bil : 0;
    const priority = absChg * 2 + liqBoost * 5;
    scored.push({ symbol: inst.symbol, priority });
  }

  scored.sort((a, b) => b.priority - a.priority);
  const selected = Array.from(mustInclude);
  for (const s of selected.length < maxCandidates ? scored.slice(0, maxCandidates - selected.length) : []) {
    selected.push(s.symbol);
  }
  return selected;
}

/**
 * Thực thi 1 chu kỳ quét đầy đủ (Main Report hoặc 15m Delta Scan)
 */
async function runStockHunterScan({ label = null, isMainReport = false, sendTelegram = true, forceCacheRefresh = false } = {}) {
  const asOf = new Date();
  const vn = toVnComponents(asOf);
  const ledgerService = getLedgerService();
  const stateStore = getStateStore();

  const ledgerSnapshot = ledgerService.reconcileAt(asOf);
  let dailyCache = loadDailyCache();
  if (forceCacheRefresh || !dailyCache.barsBySymbol || Object.keys(dailyCache.barsBySymbol).length < 50) {
    dailyCache = await refreshDailyCache(SEED_INSTRUMENTS, forceCacheRefresh);
  }

  const dailyBarsBySymbol = dailyCache.barsBySymbol || {};
  const exchangeMap = {};
  const symbols = SEED_INSTRUMENTS.map((i) => {
    exchangeMap[i.symbol] = i.exchange;
    return i.symbol;
  });

  // 1. Fetch Realtime Batch (4 requests) + Index Detail song song
  const [quotesBySymbol, marketLiquidity] = await Promise.all([
    fetchRealtimeBatch(symbols, exchangeMap),
    fetchMarketIndicesSnapshot(),
  ]);

  // 2. Build Universe Gates
  const universeResult = buildActiveUniverse(dailyBarsBySymbol, quotesBySymbol);

  // 3. Fetch 15m có chọn lọc cho Top ứng viên + Vị thế + Special Watch
  const stateData = stateStore.getState();
  const m15Targets = selectIntraday15mCandidates(universeResult, quotesBySymbol, ledgerSnapshot, stateData, 25);
  const bars15mBySymbol = await fetchIntraday15mBatch(m15Targets, exchangeMap);

  // 4. Tổng hợp 1W / 1M point-in-time từ 1D
  const weeklyBarsBySymbol = {};
  const monthlyBarsBySymbol = {};
  for (const sym of Object.keys(dailyBarsBySymbol)) {
    if (sym === 'VNINDEX' || sym === 'VN30') continue;
    weeklyBarsBySymbol[sym] = aggregateTimeframeBars(dailyBarsBySymbol[sym], '1W', vn.dateStr);
    monthlyBarsBySymbol[sym] = aggregateTimeframeBars(dailyBarsBySymbol[sym], '1M', vn.dateStr);
  }

  // 5. Chạy Decision Pipeline
  const result = runDecisionPipeline({
    universeResult,
    dailyBarsBySymbol,
    weeklyBarsBySymbol,
    monthlyBarsBySymbol,
    bars15mBySymbol,
    quotesBySymbol,
    vnindexBars: dailyBarsBySymbol['VNINDEX'] || [],
    vnindexLive: marketLiquidity?.vnindex || null,
    marketLiquidity,
    ledgerSnapshot,
    priorState: stateData,
    asOf,
  });

  // Cập nhật Trailing Stop tự động vào Ledger nếu Guardian đề xuất nâng SL
  for (const exitRes of result.exitDecisions || []) {
    if (exitRes.proposedTrailStopVnd) {
      const lots = ledgerService.state.positionLots.filter(l => l.symbol === exitRes.symbol && l.qty > 0);
      for (const lot of lots) {
        ledgerService.updateLotStop(lot.lotId, exitRes.proposedTrailStopVnd);
      }
    }
  }

  stateStore.updateFromPipeline(result);

  // 6. Routing Thông Báo Telegram
  if (sendTelegram) {
    const cfgN = STOCK_HUNTER_CONFIG.notifications;
    const nowMs = Date.now();

    // 6a. Urgent Exit / SL / Data Alert (ưu tiên số 1, gửi ngay)
    for (const exitRes of result.exitDecisions || []) {
      if (['P0', 'P1', 'P2', 'P3', 'P4'].includes(exitRes.priority) && exitRes.action !== 'HOLD') {
        const dedupeKey = `EXIT_${exitRes.symbol}_${exitRes.action}_${vn.dateStr}`;
        if (stateStore.shouldSend(dedupeKey, cfgN.alertReminderMinutes * 60 * 1000, nowMs)) {
          await sendTelegramMessage(formatUrgentExitAlert(exitRes, asOf));
          stateStore.markSent(dedupeKey, nowMs);
        }
      }
    }

    // 6b. Báo cáo chính hoặc Delta Alert (khi có BUY mới)
    if (isMainReport) {
      const reportMsg = formatMainScanReport(result, label);
      await sendTelegramMessage(reportMsg);
    } else if (result.buySignals && result.buySignals.length > 0) {
      const newBuys = result.buySignals.filter((sig) => {
        const key = `BUY_${sig.symbol}_${sig.strategyId}_${vn.dateStr}`;
        return stateStore.shouldSend(key, cfgN.buyDuplicateCooldownMinutes * 60 * 1000, nowMs);
      });
      if (newBuys.length > 0) {
        const deltaResult = { ...result, buySignals: newBuys };
        await sendTelegramMessage(formatMainScanReport(deltaResult, `${vn.timeLabel} (TÍN HIỆU MỚI)`));
        for (const sig of newBuys) {
          stateStore.markSent(`BUY_${sig.symbol}_${sig.strategyId}_${vn.dateStr}`, nowMs);
        }
      }
    }
  }

  return result;
}

/**
 * Luồng nhanh Position Guardian (30-60s): chỉ kiểm tra quote cho các mã đang giữ
 */
async function runFastPositionGuardian() {
  const asOf = new Date();
  if (!isTradingDay(asOf)) return;
  const session = sessionAt(asOf, 'HOSE');
  if (session === 'CLOSED' || session === 'CLOSED_HOLIDAY' || session === 'LUNCH_BREAK') return;

  const ledgerService = getLedgerService();
  const stateStore = getStateStore();
  const ledger = ledgerService.reconcileAt(asOf);
  const openLots = (ledger.positionLots || []).filter(l => l.qty > 0);
  if (openLots.length === 0) return;

  const heldSymbols = Array.from(new Set(openLots.map(l => l.symbol)));
  const exchangeMap = {};
  for (const s of heldSymbols) exchangeMap[s] = getInstrumentMeta(s).exchange;

  const quotes = await fetchRealtimeBatch(heldSymbols, exchangeMap);
  const dailyCache = loadDailyCache();
  const dailyBarsBySymbol = dailyCache.barsBySymbol || {};
  const vn = toVnComponents(asOf);
  const nowMs = Date.now();
  const reminderMs = STOCK_HUNTER_CONFIG.notifications.alertReminderMinutes * 60 * 1000;

  for (const sym of heldSymbols) {
    const lots = openLots.filter(l => l.symbol === sym);
    const quote = quotes.get(sym);
    const dataStatus = quote && quote.quality === 'VALID' ? 'VALID' : 'STALE_OR_MISSING';

    // Cập nhật highWatermark trong ledger
    if (quote && quote.priceVnd > 0) {
      for (const lot of lots) {
        const realLot = ledgerService.state.positionLots.find(l => l.lotId === lot.lotId);
        if (realLot) {
          realLot.lastPriceVnd = quote.priceVnd;
          realLot.highWatermarkVnd = Math.max(realLot.highWatermarkVnd || 0, quote.highVnd || quote.priceVnd);
        }
      }
      ledgerService.save();
    }

    const res = evaluateExitForSymbol({
      symbol: sym,
      lots,
      quote,
      feature: dailyBarsBySymbol[sym] ? { currentPrice: quote?.priceVnd, daily: { closedBars: dailyBarsBySymbol[sym] } } : null,
      dataStatus,
      asOf,
    });

    if (res && (res.priority === 'P0' || res.priority === 'P1')) {
      const key = `FAST_EXIT_${sym}_${res.action}_${vn.dateStr}`;
      if (stateStore.shouldSend(key, reminderMs, nowMs)) {
        await sendTelegramMessage(formatUrgentExitAlert(res, asOf));
        stateStore.markSent(key, nowMs);
      }
    }
  }
}

module.exports = {
  runStockHunterScan,
  runFastPositionGuardian,
  refreshPreMarketCache,
  getLedgerService,
  getStateStore,
};
