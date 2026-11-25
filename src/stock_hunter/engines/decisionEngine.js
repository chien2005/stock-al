/**
 * AI STOCK HUNTER - Decision Engine & Ranking Pipeline
 * Tuân thủ Master Plan V2.0 Section 15:
 * - Hard gates LUÔN override Score (chất lượng/sự kiện/dữ liệu/T+2/RR)
 * - Một mã tối đa 1 primary setup (không duplicate, Test S16)
 * - Chấm điểm minh bạch 0-100 (15 Market + 10 Sector + 20 Structure + 30 Supply/Demand + 15 Geometry/RR + 10 Execution)
 * - Trả về SHORTLIST thực dụng hoặc NO_TRADE khi không đủ chuẩn (Test N01, N04)
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { sessionAt, isContinuousSession } = require('../core/calendar');
const { computeSymbolFeatures } = require('./features');
const { buildPriceZones } = require('./zones');
const { classifyMarketRegime } = require('./marketRegime');
const { evaluateSectorRotation } = require('./sectorRotation');
const { analyzeSupplyDemand } = require('./supplyDemand');
const { evaluateSpecialWatch } = require('./specialWatch');
const { evaluateAvoidReasons } = require('./avoidList');
const { evaluateStrategies } = require('./strategies');
const { buildTradePlan } = require('./tradePlan');
const { allocatePortfolioCandidates } = require('./riskEngine');
const { evaluateExitForSymbol } = require('./exitEngine');

function scoreCandidate({ setup, tradePlan, marketRegime, sectorState, zones, supplyDemand, quote, feature }) {
  // 1. Market Context (max 15)
  const regimePtsMap = {
    UPTREND_STRONG: 15,
    RECOVERY: 13,
    UPTREND_WEAK: 10,
    RANGE_WIDE: 10,
    RANGE_NARROW: 6,
    DOWNTREND: setup.isReversal ? 8 : 3,
    PANIC: 0,
    UNKNOWN: 0,
  };
  const marketPts = regimePtsMap[marketRegime.regime] ?? 0;

  // 2. Sector + Relative Strength (max 10)
  let sectorPts = 5;
  if (sectorState) {
    if (sectorState.state === 'LEADING') sectorPts = 8;
    else if (sectorState.state === 'IMPROVING') sectorPts = 7;
    else if (sectorState.state === 'LAGGING') sectorPts = 3;
    else if (sectorState.state === 'DISTRIBUTION_RISK') sectorPts = 1;
  }
  if ((feature.rs20 || 0) > 3.0) sectorPts = Math.min(10, sectorPts + 2);

  // 3. Structure đa khung (max 20)
  let structPts = 8;
  if (!setup.isReversal) {
    if (zones.structure === 'HH_HL') structPts = 15;
    else if (zones.structure === 'RANGE' || zones.structure === 'TRANSITION') structPts = 11;
    if (feature.weekly?.trend === 'UP') structPts += 3;
    if (feature.monthly?.context === 'ABOVE_MA12M') structPts += 2;
  } else {
    // Reversal chấm điểm theo mức độ hoàn thiện Transition/Reclaim (không thưởng việc giảm sâu)
    structPts = 14;
    if (feature.m15) structPts += 4;
  }
  structPts = Math.min(20, structPts);

  // 4. Supply/Demand + confirmation (max 30)
  const sdPts = Math.min(30, supplyDemand?.demandScore || 0);

  // 5. Entry Geometry & Net R/R (max 15)
  let rrPts = 5;
  if (tradePlan && tradePlan.valid) {
    if (tradePlan.rrNet >= 2.5) rrPts = 15;
    else if (tradePlan.rrNet >= 2.0) rrPts = 12;
    else if (tradePlan.rrNet >= 1.5) rrPts = 9;
  }

  // 6. Execution Quality (max 10)
  let execPts = 6;
  if (feature.m15) execPts += 2;
  if (quote && quote.spreadPct !== null && quote.spreadPct <= 0.4) execPts += 2;
  if (quote && (quote.isLimitUpLocked || quote.isLimitDownLocked)) execPts = 0;

  const total = Math.min(100, Math.round(marketPts + sectorPts + structPts + sdPts + rrPts + execPts));
  return {
    total,
    breakdown: { marketPts, sectorPts, structPts, sdPts, rrPts, execPts },
  };
}

/**
 * Chạy toàn bộ pipeline quét & ra quyết định tại thời điểm `asOf`
 */
function runDecisionPipeline({
  universeResult,
  dailyBarsBySymbol = {},
  weeklyBarsBySymbol = {},
  monthlyBarsBySymbol = {},
  bars15mBySymbol = new Map(),
  quotesBySymbol = new Map(),
  vnindexBars = [],
  vnindexLive = null,
  marketLiquidity = null,
  ledgerSnapshot = null,
  priorState = {},
  metadataBySymbol = {},
  asOf = new Date(),
}) {
  const cfg = STOCK_HUNTER_CONFIG;
  const benchmarkDailyBars = dailyBarsBySymbol['VNINDEX'] || vnindexBars || [];
  const allInstruments = [...(universeResult?.eligible || []), ...(universeResult?.rejected || [])];

  // 1. Tính Feature & Zones & SupplyDemand cho toàn bộ Universe
  const featuresMap = new Map();
  const zonesMap = new Map();
  const sdMap = new Map();

  for (const inst of allInstruments) {
    const sym = inst.symbol;
    const dBars = dailyBarsBySymbol[sym] || [];
    if (dBars.length === 0) continue;

    const quote = quotesBySymbol instanceof Map ? quotesBySymbol.get(sym) : quotesBySymbol[sym];
    const bars15 = bars15mBySymbol instanceof Map ? (bars15mBySymbol.get(sym) || []) : (bars15mBySymbol[sym] || []);

    const feat = computeSymbolFeatures({
      symbol: sym,
      dailyBars: dBars,
      weeklyBars: weeklyBarsBySymbol[sym] || [],
      monthlyBars: monthlyBarsBySymbol[sym] || [],
      bars15m: bars15,
      benchmarkDailyBars,
      quote,
      asOf,
    });
    const zones = buildPriceZones(feat, inst.exchange);
    const sd = analyzeSupplyDemand({
      feature: feat,
      zones,
      bars15m: bars15,
      priorState: priorState.supplyDemandBySymbol?.[sym],
    });

    featuresMap.set(sym, feat);
    zonesMap.set(sym, zones);
    sdMap.set(sym, sd);
  }

  const featureList = Array.from(featuresMap.values());

  // 2. Market Regime (Fail-closed nếu coverage < 90% hoặc thiếu benchmark)
  const marketRegime = classifyMarketRegime({
    vnindexBars: benchmarkDailyBars,
    vnindexLive,
    marketLiquidity,
    featureList,
    expectedUniverseCount: universeResult?.totalSeed || allInstruments.length,
    priorRegimeState: priorState.marketRegime,
    asOf,
  });

  // 3. Sector Rotation
  const sectorRotation = evaluateSectorRotation(featureList, universeResult?.eligibleMap || new Map(), sdMap);

  // 4. Exit Guardian (ĐỘC LẬP với Universe/Entry — chạy cho mọi lô đang giữ!)
  const exitDecisions = [];
  const openLots = ledgerSnapshot?.positionLots || [];
  const lotsBySym = new Map();
  for (const lot of openLots) {
    if (lot.qty <= 0) continue;
    if (!lotsBySym.has(lot.symbol)) lotsBySym.set(lot.symbol, []);
    lotsBySym.get(lot.symbol).push(lot);
  }

  for (const [sym, lots] of lotsBySym.entries()) {
    const quote = quotesBySymbol instanceof Map ? quotesBySymbol.get(sym) : quotesBySymbol[sym];
    const feat = featuresMap.get(sym) || null;
    const zones = zonesMap.get(sym) || null;
    const sd = sdMap.get(sym) || null;
    const dataStatus = quote && quote.quality === 'VALID' ? 'VALID' : 'STALE_OR_MISSING';

    const exitRes = evaluateExitForSymbol({
      symbol: sym,
      lots,
      quote,
      feature: feat,
      zones,
      supplyDemand: sd,
      marketRegime,
      dataStatus,
      asOf,
    });
    if (exitRes) exitDecisions.push(exitRes);
  }

  // Sắp xếp cảnh báo vị thế theo mức độ nghiêm trọng P0 -> P6
  const priOrder = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6 };
  exitDecisions.sort((a, b) => (priOrder[a.priority] ?? 9) - (priOrder[b.priority] ?? 9));

  // 5. Quét Entry / Special Watch / Avoid cho từng mã trong Universe
  const buyCandidates = [];
  const watchCandidates = [];
  const specialWatchList = [];
  const avoidCandidates = [];
  const nextSpecialEpisodes = { ...(priorState.specialWatchBySymbol || {}) };

  const currentSessionHOSE = sessionAt(asOf, 'HOSE');
  const isSessionOpenContinuous = isContinuousSession(currentSessionHOSE);

  for (const inst of allInstruments) {
    const sym = inst.symbol;
    const feat = featuresMap.get(sym);
    const zones = zonesMap.get(sym);
    const sd = sdMap.get(sym);
    const quote = quotesBySymbol instanceof Map ? quotesBySymbol.get(sym) : quotesBySymbol[sym];
    const metaFlags = metadataBySymbol[sym] || {};
    const sectorState = sectorRotation.sectorMap.get(inst.sectorCode);

    // Special Watch state machine
    const ep = evaluateSpecialWatch({
      symbol: sym,
      feature: feat,
      zones,
      supplyDemand: sd,
      universeGate: inst,
      quote,
      priorEpisode: nextSpecialEpisodes[sym] || null,
      asOf,
    });
    if (ep) {
      nextSpecialEpisodes[sym] = ep;
      if (['B1_OVERSOLD_WATCH', 'B2_CLIMAX_OR_SPRING', 'B3_STABILIZING', 'B4_RECLAIM', 'B5_CONFIRMED'].includes(ep.state)) {
        specialWatchList.push({
          ...ep,
          sector: inst.sector,
          priceVnd: feat?.currentPrice || null,
          changePct: feat?.changePct ?? null,
        });
      }
    }

    // Avoid List
    const avoid = evaluateAvoidReasons({
      symbol: sym,
      universeGate: inst,
      feature: feat,
      zones,
      supplyDemand: sd,
      marketRegime,
      quote,
      eventFlags: metaFlags,
      dataStatus: feat && quote?.quality === 'VALID' ? 'VALID' : (!feat ? 'MISSING' : 'VALID'),
    });
    if (avoid) avoidCandidates.push({ ...avoid, sector: inst.sector });

    // Nếu không đạt Universe Hard Gates hoặc có Hard Block -> dừng xét MUA
    // V2.1: Khóa BUY toàn thị trường nếu độ phủ dữ liệu Universe < minUniverseCoverage (98%)
    if ((marketRegime.breadth?.coverage ?? 0) < cfg.market.minUniverseCoverage) continue;
    if (!inst.eligibleForBuy || !feat || !zones || !sd) continue;
    if (metaFlags.materialRisk || metaFlags.highRiskUpcomingEvent) continue;
    if (marketRegime.regime === 'UNKNOWN' || marketRegime.regime === 'PANIC') continue;

    // Nếu đang có cảnh báo EXIT/PROTECT cho mã này -> EXIT ưu tiên tuyệt đối, không phát BUY mới (Test E10)
    if (lotsBySym.has(sym)) continue;

    // Tìm setups
    const setups = evaluateStrategies({
      symbol: sym,
      feature: feat,
      zones,
      supplyDemand: sd,
      marketRegime,
      sectorState,
      specialWatchEpisode: ep,
    });

    if (setups.length === 0) continue;

    // Đánh giá từng setup -> Chọn tối đa 1 primary setup cho mã (Test S16)
    const evaluatedSetups = [];
    for (const setup of setups) {
      if (setup.status === 'WATCH' || setup.status === 'RESEARCH_ONLY') {
        evaluatedSetups.push({
          symbol: sym,
          sector: inst.sector,
          sectorCode: inst.sectorCode,
          riskCluster: inst.riskCluster,
          exchange: inst.exchange,
          action: setup.status === 'RESEARCH_ONLY' ? 'SPECIAL_WATCH' : 'WATCH',
          strategyId: setup.strategyId,
          strategyName: setup.name,
          isReversal: !!setup.isReversal,
          triggerLevel: setup.triggerLevel,
          score: 70,
          reasonCodes: setup.reasonCodes,
          priceVnd: feat.currentPrice,
          changePct: feat.changePct,
        });
        continue;
      }

      const plan = buildTradePlan({
        symbol: sym,
        exchange: inst.exchange,
        setup,
        feature: feat,
        zones,
        asOf,
      });

      if (!plan.valid) {
        // Bị loại bởi Stop quá rộng / No Room / Low RR / Chase -> chuyển WATCH hoặc bỏ
        evaluatedSetups.push({
          symbol: sym,
          sector: inst.sector,
          sectorCode: inst.sectorCode,
          riskCluster: inst.riskCluster,
          exchange: inst.exchange,
          action: 'WATCH',
          strategyId: setup.strategyId,
          strategyName: setup.name,
          rejectReason: plan.rejectReason,
          score: 60,
          reasonCodes: [...setup.reasonCodes, plan.rejectReason],
          priceVnd: feat.currentPrice,
          changePct: feat.changePct,
        });
        continue;
      }

      const scored = scoreCandidate({
        setup,
        tradePlan: plan,
        marketRegime,
        sectorState,
        zones,
        supplyDemand: sd,
        quote,
        feature: feat,
      });

      const minScore = setup.isReversal ? cfg.strategies.reversalScoreMin : cfg.strategies.buyScoreMin;
      if (scored.total >= minScore) {
        const action = isSessionOpenContinuous
          ? 'BUY_ZONE'
          : (currentSessionHOSE === 'ATO' || currentSessionHOSE === 'LUNCH_BREAK' ? 'WATCH' : 'NEXT_SESSION_WATCH');

        evaluatedSetups.push({
          symbol: sym,
          sector: inst.sector,
          sectorCode: inst.sectorCode,
          riskCluster: inst.riskCluster,
          exchange: inst.exchange,
          action,
          strategyId: setup.strategyId,
          strategyName: setup.name,
          isReversal: !!setup.isReversal,
          score: scored.total,
          scoreBreakdown: scored.breakdown,
          confidence: feat.m15 ? (marketRegime.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM') : 'MEDIUM',
          tradePlan: plan,
          medianVol20: feat.daily.medianVol20,
          priceVnd: feat.currentPrice,
          changePct: feat.changePct,
          rvolD: sd.rvolD,
          rvol15: sd.rvol15,
          clvD: sd.clvD,
          clv15: sd.clv15,
          reasonCodes: setup.reasonCodes,
          evidenceIds: sd.evidenceIds,
          cancelConditions: ['PRICE_ABOVE_MAX_ENTRY', 'SUPPORT_OR_STOP_LOST', 'REGIME_PANIC'],
        });
      } else if (scored.total >= cfg.strategies.watchScoreMin) {
        evaluatedSetups.push({
          symbol: sym,
          sector: inst.sector,
          sectorCode: inst.sectorCode,
          riskCluster: inst.riskCluster,
          exchange: inst.exchange,
          action: 'WATCH',
          strategyId: setup.strategyId,
          strategyName: setup.name,
          score: scored.total,
          reasonCodes: [...setup.reasonCodes, `SCORE_BELOW_${minScore}`],
          priceVnd: feat.currentPrice,
          changePct: feat.changePct,
        });
      }
    }

    // Chọn duy nhất 1 primary setup tốt nhất cho mỗi mã
    if (evaluatedSetups.length > 0) {
      const actionRank = { BUY_ZONE: 4, NEXT_SESSION_WATCH: 3, WATCH: 2, SPECIAL_WATCH: 1 };
      evaluatedSetups.sort((a, b) => (actionRank[b.action] - actionRank[a.action]) || (b.score - a.score));
      const primary = evaluatedSetups[0];
      if (primary.action === 'BUY_ZONE' || primary.action === 'NEXT_SESSION_WATCH') {
        buyCandidates.push(primary);
      } else if (primary.action === 'WATCH') {
        watchCandidates.push(primary);
      }
    }
  }

  // 6. Xếp hạng & Phân bổ Vốn/Rủi ro đồng thời cho Top BUY Candidates
  buyCandidates.sort((a, b) => (b.score - a.score) || ((b.tradePlan?.rrNet || 0) - (a.tradePlan?.rrNet || 0)) || a.symbol.localeCompare(b.symbol));

  const effectiveLedger = ledgerSnapshot || {
    availableCashVnd: cfg.risk.initialNavVnd,
    positionLots: [],
    navPeakVnd: cfg.risk.initialNavVnd,
  };
  const { portfolioRiskState, allocated } = allocatePortfolioCandidates(
    buyCandidates,
    effectiveLedger,
    quotesBySymbol,
    marketRegime
  );

  const approvedBuys = allocated
    .filter(c => c.allocationStatus === 'APPROVED_BUY')
    .slice(0, cfg.notifications.topBuy);

  const capitalBlockedWatches = allocated
    .filter(c => c.allocationStatus !== 'APPROVED_BUY')
    .map(c => ({ ...c, action: 'WATCH', reasonCodes: [...(c.reasonCodes || []), c.allocationStatus] }));

  const topWatch = [...capitalBlockedWatches, ...watchCandidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.notifications.topWatch);

  specialWatchList.sort((a, b) => {
    const order = { B5_CONFIRMED: 5, B4_RECLAIM: 4, B3_STABILIZING: 3, B2_CLIMAX_OR_SPRING: 2, B1_OVERSOLD_WATCH: 1 };
    return (order[b.state] || 0) - (order[a.state] || 0);
  });

  avoidCandidates.sort((a, b) => (b.severity - a.severity) || (b.medianValue20Bil - a.medianValue20Bil));

  const overallAction = approvedBuys.length > 0
    ? (isSessionOpenContinuous ? 'BUY_OPPORTUNITIES' : 'NEXT_SESSION_PREP')
    : 'NO_TRADE';

  return {
    schemaVersion: cfg.schemaVersion,
    ruleVersion: cfg.ruleVersion,
    asOf: asOf.toISOString(),
    session: currentSessionHOSE,
    overallAction,
    marketRegime,
    sectorRotation: sectorRotation.sectors,
    portfolioRiskState,
    exitDecisions,
    buySignals: approvedBuys,
    watchList: topWatch,
    specialWatchList: specialWatchList.slice(0, cfg.notifications.topSpecialWatch),
    avoidList: avoidCandidates.slice(0, cfg.notifications.topAvoid),
    nextStateUpdates: {
      marketRegime,
      specialWatchBySymbol: nextSpecialEpisodes,
    },
  };
}

module.exports = { runDecisionPipeline, scoreCandidate };
