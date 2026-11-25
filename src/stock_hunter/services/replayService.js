/**
 * AI STOCK HUNTER V2.1 - Real Market Snapshot Recorder & Deterministic Replay
 * Ghi lại snapshot thực tế (quotes, regime, decisions) vào data/sh_replay_log.jsonl
 * để phục vụ kiểm thử replay & calibration không look-ahead.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const REPLAY_LOG_FILE = path.join(DATA_DIR, 'sh_replay_log.jsonl');

function recordScanSnapshot(pipelineResult, quotesBySymbol = new Map(), filePath = REPLAY_LOG_FILE) {
  if (!pipelineResult || !filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const compactQuotes = {};
    if (quotesBySymbol instanceof Map) {
      for (const [sym, q] of quotesBySymbol.entries()) {
        if (q && q.quality === 'VALID') {
          compactQuotes[sym] = {
            p: q.priceVnd,
            c: q.changePct,
            v: q.volumeShares,
          };
        }
      }
    }

    const entry = {
      asOf: pipelineResult.asOf,
      session: pipelineResult.session,
      regime: pipelineResult.marketRegime?.regime,
      liqRatio: pipelineResult.marketRegime?.liquidityRatio,
      coverage: pipelineResult.marketRegime?.breadth?.coverage,
      vni: pipelineResult.marketRegime?.vnindex?.index || null,
      buySignals: (pipelineResult.buySignals || []).map(b => ({
        symbol: b.symbol,
        strategyId: b.strategyId,
        score: b.score,
        entryZone: b.tradePlan?.entryZone,
        stopVnd: b.tradePlan?.stopVnd,
        tpRef1: b.tradePlan?.tpRef1,
        qty: b.recommendedQty,
      })),
      exitDecisions: (pipelineResult.exitDecisions || []).map(e => ({
        symbol: e.symbol,
        action: e.action,
        priority: e.priority,
        price: e.observedPriceVnd,
      })),
      quotes: compactQuotes,
    };

    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('⚠️ replayService.recordScanSnapshot error:', e.message);
  }
}

function readReplayLog(filePath = REPLAY_LOG_FILE, limit = 100) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l));
  } catch (e) {
    return [];
  }
}

module.exports = { recordScanSnapshot, readReplayLog };
